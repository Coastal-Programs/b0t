import { db } from '@/lib/db';
import {
  agentMemoryFactsTable,
  agentMemoryEmbeddingsTable,
  workflowNodeMappingsTable,
  workflowPatternsTable,
  workflowEmbeddingsTable,
  agentMemoryGraphsTable,
  type AgentMemoryFact,
  type NewAgentMemoryFact,
  type WorkflowNodeMapping,
  type WorkflowPattern,
  type WorkflowEmbedding,
} from '@/lib/schema';
import { eq, and, desc, sql, or, like } from 'drizzle-orm';
import { embed } from 'ai';
import { openai } from '@ai-sdk/openai';
import pino from 'pino';
import { settingsCache } from '@/lib/cache/settings-cache';

const logger = pino({ name: 'memory-manager' });

export interface SearchResult {
  id: string;
  category: string;
  subject: string;
  content: string;
  score: number;
  metadata?: Record<string, unknown>;
}

export interface GraphNode {
  id: string;
  subject: string;
  category: string;
  content: string;
  group: number;
}

export interface GraphLink {
  source: string;
  target: string;
  type: 'category' | 'semantic' | 'keyword';
  strength: number;
}

export interface GraphData {
  nodes: GraphNode[];
  links: GraphLink[];
}

export interface SimilarWorkflow {
  id: string;
  similarity: number;
  approach: string | null;
  patternType: string | null;
  description: string;
}

// In-memory cache for hot data
interface CacheEntry<T> {
  data: T;
  expiry: number;
}

class MemoryCache {
  private cache = new Map<string, CacheEntry<unknown>>();
  private TTL: Record<string, number> = {
    facts: 5 * 60 * 1000, // 5 minutes
    graph: 10 * 60 * 1000, // 10 minutes
    mapping: 60 * 60 * 1000, // 1 hour
  };

  get<T>(key: string, type: keyof typeof this.TTL = 'facts'): T | undefined {
    const cached = this.cache.get(key);
    if (cached && Date.now() < cached.expiry) {
      return cached.data as T;
    }
    return undefined;
  }

  set<T>(key: string, data: T, type: keyof typeof this.TTL = 'facts'): void {
    this.cache.set(key, {
      data,
      expiry: Date.now() + this.TTL[type],
    });
  }

  invalidate(key: string): void {
    this.cache.delete(key);
  }
}

const cache = new MemoryCache();

interface MemorySearchConfig {
  vectorWeight: number;
  keywordWeight: number;
  minScore: number;
  maxResults: number;
}

async function getMemorySearchConfig(): Promise<MemorySearchConfig> {
  try {
    const settings = await settingsCache.get('memory');
    return {
      vectorWeight: parseFloat((settings.vector_weight as string) || '0.7'),
      keywordWeight: parseFloat((settings.keyword_weight as string) || '0.3'),
      minScore: parseFloat((settings.min_score as string) || '0.35'),
      maxResults: parseInt((settings.max_results as string) || '6', 10),
    };
  } catch {
    return { vectorWeight: 0.7, keywordWeight: 0.3, minScore: 0.35, maxResults: 6 };
  }
}

export class MemoryManager {
  private userId: string;
  private organizationId?: string;

  constructor(userId: string, organizationId?: string) {
    this.userId = userId;
    this.organizationId = organizationId;
  }

  // ============================================
  // FACT MANAGEMENT
  // ============================================

  /**
   * Save or update a memory fact
   */
  async saveFact(
    category: string,
    subject: string,
    content: string,
    metadata?: Record<string, unknown>
  ): Promise<{ id: string }> {
    logger.info({ category, subject, userId: this.userId }, 'Saving memory fact');

    // Check if fact with same subject exists
    const existing = await db.query.agentMemoryFactsTable.findFirst({
      where: and(
        eq(agentMemoryFactsTable.userId, this.userId),
        eq(agentMemoryFactsTable.subject, subject),
        this.organizationId
          ? eq(agentMemoryFactsTable.organizationId, this.organizationId)
          : sql`organization_id IS NULL`
      ),
    });

    let factId: string;

    if (existing) {
      // Update existing fact
      await db
        .update(agentMemoryFactsTable)
        .set({
          category,
          content,
          metadata: metadata || {},
          updatedAt: new Date(),
        })
        .where(eq(agentMemoryFactsTable.id, existing.id));
      factId = existing.id;
      logger.info({ factId }, 'Updated existing fact');
    } else {
      // Insert new fact
      const [inserted] = await db
        .insert(agentMemoryFactsTable)
        .values({
          userId: this.userId,
          organizationId: this.organizationId,
          category,
          subject,
          content,
          metadata: metadata || {},
        })
        .returning({ id: agentMemoryFactsTable.id });
      factId = inserted.id;
      logger.info({ factId }, 'Inserted new fact');
    }

    // Invalidate cache
    this.invalidateFactsCache();

    // Generate embedding in background (non-blocking)
    this.embedFact(factId).catch((err) => {
      logger.error({ err, factId }, 'Failed to generate embedding');
    });

    return { id: factId };
  }

  /**
   * Get all facts for the user
   */
  async getAllFacts(): Promise<AgentMemoryFact[]> {
    const cacheKey = `facts:${this.userId}:${this.organizationId || 'none'}`;
    const cached = cache.get<AgentMemoryFact[]>(cacheKey, 'facts');
    if (cached !== undefined) {
      logger.debug('Returning cached facts');
      return cached;
    }

    logger.debug({ userId: this.userId }, 'Loading facts from database');
    const facts = await db.query.agentMemoryFactsTable.findMany({
      where: and(
        eq(agentMemoryFactsTable.userId, this.userId),
        this.organizationId
          ? eq(agentMemoryFactsTable.organizationId, this.organizationId)
          : sql`organization_id IS NULL`
      ),
      orderBy: [desc(agentMemoryFactsTable.updatedAt)],
    });

    cache.set(cacheKey, facts, 'facts');
    return facts;
  }

  /**
   * Search facts using hybrid search (vector + keyword)
   */
  async searchFacts(query: string, topK?: number): Promise<SearchResult[]> {
    const config = await getMemorySearchConfig();
    const limit = topK ?? config.maxResults;
    const { vectorWeight, keywordWeight, minScore } = config;

    logger.info({ query, limit, vectorWeight, keywordWeight, minScore }, 'Searching facts');

    // Try to generate embedding for hybrid search, fall back to keyword-only
    let embedding: number[] | null = null;
    try {
      embedding = await this.generateEmbedding(query);
    } catch (err) {
      logger.warn({ err }, 'Embedding generation failed, falling back to keyword-only search');
    }

    if (embedding) {
      const results = await db.execute<{
        id: string;
        category: string;
        subject: string;
        content: string;
        metadata: Record<string, unknown>;
        vector_score: number;
        keyword_score: number;
        combined_score: number;
      }>(sql`
        WITH vector_results AS (
          SELECT
            f.id,
            f.category,
            f.subject,
            f.content,
            f.metadata,
            1 - (e.embedding <=> ${embedding}::vector) as similarity
          FROM agent_memory_facts f
          JOIN agent_memory_embeddings e ON e.fact_id = f.id
          WHERE f.user_id = ${this.userId}
            AND ${
              this.organizationId
                ? sql`f.organization_id = ${this.organizationId}`
                : sql`f.organization_id IS NULL`
            }
          ORDER BY e.embedding <=> ${embedding}::vector
          LIMIT 200
        ),
        keyword_results AS (
          SELECT
            id,
            category,
            subject,
            content,
            metadata,
            ts_rank(fts_document, plainto_tsquery('english', ${query})) as rank
          FROM agent_memory_facts
          WHERE user_id = ${this.userId}
            AND ${
              this.organizationId
                ? sql`organization_id = ${this.organizationId}`
                : sql`organization_id IS NULL`
            }
            AND fts_document @@ plainto_tsquery('english', ${query})
          LIMIT 200
        )
        SELECT
          COALESCE(v.id, k.id) as id,
          COALESCE(v.category, k.category) as category,
          COALESCE(v.subject, k.subject) as subject,
          COALESCE(v.content, k.content) as content,
          COALESCE(v.metadata, k.metadata) as metadata,
          COALESCE(v.similarity, 0) as vector_score,
          COALESCE(k.rank, 0) as keyword_score,
          (COALESCE(v.similarity, 0) * ${vectorWeight} + LEAST(COALESCE(k.rank, 0), 1.0) * ${keywordWeight}) as combined_score
        FROM vector_results v
        FULL OUTER JOIN keyword_results k ON v.id = k.id
        ORDER BY combined_score DESC
        LIMIT ${limit}
      `);

      return results.rows
        .filter((row) => row.combined_score >= minScore)
        .map((row) => ({
          id: row.id,
          category: row.category,
          subject: row.subject,
          content: row.content,
          score: row.combined_score,
          metadata: row.metadata,
        }));
    }

    // Keyword-only fallback
    const results = await db.execute<{
      id: string;
      category: string;
      subject: string;
      content: string;
      metadata: Record<string, unknown>;
      rank: number;
    }>(sql`
      SELECT
        id,
        category,
        subject,
        content,
        metadata,
        ts_rank(fts_document, plainto_tsquery('english', ${query})) as rank
      FROM agent_memory_facts
      WHERE user_id = ${this.userId}
        AND ${
          this.organizationId
            ? sql`organization_id = ${this.organizationId}`
            : sql`organization_id IS NULL`
        }
        AND fts_document @@ plainto_tsquery('english', ${query})
      ORDER BY rank DESC
      LIMIT ${limit}
    `);

    return results.rows
      .filter((row) => Math.min(row.rank, 1.0) >= minScore)
      .map((row) => ({
        id: row.id,
        category: row.category,
        subject: row.subject,
        content: row.content,
        score: Math.min(row.rank, 1.0),
        metadata: row.metadata,
      }));
  }

  /**
   * Delete a fact
   */
  async deleteFact(id: string): Promise<void> {
    logger.info({ factId: id }, 'Deleting fact');

    await db.delete(agentMemoryFactsTable).where(
      and(
        eq(agentMemoryFactsTable.id, id),
        eq(agentMemoryFactsTable.userId, this.userId)
      )
    );

    this.invalidateFactsCache();
  }

  // ============================================
  // EMBEDDING GENERATION
  // ============================================

  /**
   * Generate 768-dim embedding for text
   * Note: text-embedding-3-small supports dimensions parameter but it must be passed via embedMany/embed settings
   * For now using default 1536 dims, can optimize to 768 later if needed
   */
  async generateEmbedding(text: string): Promise<number[]> {
    const { embedding } = await embed({
      model: openai.embedding('text-embedding-3-small'),
      value: text,
    });
    // Truncate to 768 dimensions for storage optimization
    // This is a simple approach - ideally use the API's dimension parameter
    return embedding.slice(0, 768);
  }

  /**
   * Generate and store embedding for a fact
   */
  async embedFact(factId: string): Promise<void> {
    logger.debug({ factId }, 'Generating embedding for fact');

    // Load fact
    const fact = await db.query.agentMemoryFactsTable.findFirst({
      where: eq(agentMemoryFactsTable.id, factId),
    });

    if (!fact) {
      throw new Error(`Fact ${factId} not found`);
    }

    // Combine category, subject, content for embedding
    const text = `${fact.category}: ${fact.subject} - ${fact.content}`;

    // Generate embedding
    const embedding = await this.generateEmbedding(text);

    // Check if embedding already exists
    const existing = await db.query.agentMemoryEmbeddingsTable.findFirst({
      where: eq(agentMemoryEmbeddingsTable.factId, factId),
    });

    if (existing) {
      // Update
      await db
        .update(agentMemoryEmbeddingsTable)
        .set({
          content: text,
          embedding,
        })
        .where(eq(agentMemoryEmbeddingsTable.id, existing.id));
    } else {
      // Insert
      await db.insert(agentMemoryEmbeddingsTable).values({
        factId,
        content: text,
        embedding,
      });
    }

    logger.debug({ factId }, 'Embedding stored');
  }

  // ============================================
  // CONTEXT GENERATION
  // ============================================

  /**
   * Get facts formatted as markdown context for agent prompts
   */
  async getFactsForContext(): Promise<string> {
    const facts = await this.getAllFacts();

    if (facts.length === 0) {
      return '';
    }

    // Group by category
    const grouped = facts.reduce((acc, fact) => {
      if (!acc[fact.category]) {
        acc[fact.category] = [];
      }
      acc[fact.category].push(fact);
      return acc;
    }, {} as Record<string, AgentMemoryFact[]>);

    // Format as markdown
    let markdown = '## Known Facts\n\n';
    for (const [category, categoryFacts] of Object.entries(grouped)) {
      markdown += `### ${category}\n`;
      for (const fact of categoryFacts) {
        markdown += `- **${fact.subject}**: ${fact.content}\n`;
      }
      markdown += '\n';
    }

    return markdown;
  }

  // ============================================
  // GRAPH GENERATION
  // ============================================

  /**
   * Generate graph data for visualization
   */
  async getGraphData(): Promise<GraphData> {
    const cacheKey = `graph:${this.userId}:${this.organizationId || 'none'}`;
    const cached = cache.get<GraphData>(cacheKey, 'graph');
    if (cached !== undefined) {
      logger.debug('Returning cached graph');
      return cached;
    }

    logger.debug('Generating graph data');
    const facts = await this.getAllFacts();

    // Create nodes
    const categoryGroups: Record<string, number> = {
      user_info: 1,
      preferences: 2,
      projects: 3,
      people: 4,
      work: 5,
      notes: 6,
      decisions: 7,
    };

    const nodes: GraphNode[] = facts.map((fact) => ({
      id: fact.id,
      subject: fact.subject,
      category: fact.category,
      content: fact.content,
      group: categoryGroups[fact.category] || 0,
    }));

    // Create links - cap at 200 facts for performance
    const links: GraphLink[] = [];
    const cappedFacts = facts.slice(0, 200);

    // Pre-compute word sets for keyword matching (avoid recomputing in O(n^2) loop)
    const wordSets = cappedFacts.map((fact) =>
      new Set(
        `${fact.subject} ${fact.content}`
          .toLowerCase()
          .split(/\W+/)
          .filter((w) => w.length > 3)
      )
    );

    // Single pass: category + keyword links
    for (let i = 0; i < cappedFacts.length; i++) {
      for (let j = i + 1; j < cappedFacts.length; j++) {
        // Category links
        if (cappedFacts[i].category === cappedFacts[j].category) {
          links.push({
            source: cappedFacts[i].id,
            target: cappedFacts[j].id,
            type: 'category',
            strength: 0.3,
          });
        }

        // Keyword links (using pre-computed word sets)
        const intersection = [...wordSets[i]].filter((x) => wordSets[j].has(x));
        if (intersection.length > 0) {
          links.push({
            source: cappedFacts[i].id,
            target: cappedFacts[j].id,
            type: 'keyword',
            strength: Math.min(intersection.length / 10, 1),
          });
        }
      }
    }

    const graphData = { nodes, links };
    cache.set(cacheKey, graphData, 'graph');
    return graphData;
  }

  // ============================================
  // WORKFLOW KNOWLEDGE BASE
  // ============================================

  /**
   * Get node mapping for platform and node type
   */
  async getNodeMapping(platform: string, nodeIdentifier: string): Promise<WorkflowNodeMapping | null> {
    const cacheKey = `mapping:${platform}:${nodeIdentifier}`;
    const cached = cache.get<WorkflowNodeMapping | null>(cacheKey, 'mapping');
    if (cached !== undefined) {
      return cached;
    }

    logger.debug({ platform, nodeIdentifier }, 'Looking up node mapping');
    const mapping = await db.query.workflowNodeMappingsTable.findFirst({
      where: and(
        eq(workflowNodeMappingsTable.sourcePlatform, platform),
        eq(workflowNodeMappingsTable.sourceIdentifier, nodeIdentifier)
      ),
    });

    cache.set(cacheKey, mapping || null, 'mapping');
    return mapping || null;
  }

  /**
   * Find similar workflows using semantic search
   */
  async findSimilarWorkflows(
    platform: string,
    description: string,
    services?: string[],
    topK: number = 5
  ): Promise<SimilarWorkflow[]> {
    logger.info({ platform, description, services }, 'Finding similar workflows');

    // Generate embedding
    const embedding = await this.generateEmbedding(description);

    // Vector similarity search with platform and optional service filter
    const results = await db.execute<{
      id: string;
      workflow_description: string;
      conversion_approach: string | null;
      pattern_type: string | null;
      similarity: number;
    }>(sql`
      SELECT
        id,
        workflow_description,
        conversion_approach,
        pattern_type,
        1 - (embedding <=> ${embedding}::vector) as similarity
      FROM workflow_embeddings
      WHERE source_platform = ${platform}
        ${services && services.length > 0 ? sql`AND services && ${services}` : sql``}
      ORDER BY embedding <=> ${embedding}::vector
      LIMIT ${topK}
    `);

    return results.rows.map((row) => ({
      id: row.id,
      similarity: row.similarity,
      approach: row.conversion_approach,
      patternType: row.pattern_type,
      description: row.workflow_description,
    }));
  }

  /**
   * Store workflow pattern
   */
  async storeWorkflowPattern(pattern: {
    sourcePlatform: string;
    patternName: string;
    description?: string;
    detectionCriteria: Record<string, unknown>;
    conversionStrategy: Record<string, unknown>;
    yamlTemplate?: string;
    exampleWorkflows?: unknown[];
  }): Promise<{ id: string }> {
    logger.info({ pattern: pattern.patternName }, 'Storing workflow pattern');

    const [inserted] = await db
      .insert(workflowPatternsTable)
      .values(pattern)
      .returning({ id: workflowPatternsTable.id });

    return { id: inserted.id };
  }

  /**
   * Store workflow embedding for future similarity search
   */
  async storeWorkflowEmbedding(workflow: {
    sourcePlatform: string;
    workflowDescription: string;
    structureSummary: Record<string, unknown>;
    conversionApproach?: string;
    odinWorkflowId?: string;
    services?: string[];
    patternType?: string;
  }): Promise<{ id: string }> {
    logger.info({ workflow: workflow.workflowDescription }, 'Storing workflow embedding');

    // Generate embedding
    const embedding = await this.generateEmbedding(workflow.workflowDescription);

    const [inserted] = await db
      .insert(workflowEmbeddingsTable)
      .values({
        ...workflow,
        embedding,
      })
      .returning({ id: workflowEmbeddingsTable.id });

    return { id: inserted.id };
  }

  /**
   * Update node mapping usage count and confidence
   */
  async updateNodeMappingUsage(id: string, success: boolean = true): Promise<void> {
    const newConfidence = success ? 1.0 : 0.8;

    await db
      .update(workflowNodeMappingsTable)
      .set({
        usageCount: sql`usage_count + 1`,
        confidenceScore: newConfidence,
        updatedAt: new Date(),
      })
      .where(eq(workflowNodeMappingsTable.id, id));

    logger.debug({ mappingId: id, success }, 'Updated node mapping usage');
  }

  // ============================================
  // CACHE MANAGEMENT
  // ============================================

  private invalidateFactsCache(): void {
    const cacheKey = `facts:${this.userId}:${this.organizationId || 'none'}`;
    cache.invalidate(cacheKey);
    cache.invalidate(`graph:${this.userId}:${this.organizationId || 'none'}`);
  }
}
