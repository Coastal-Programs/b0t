import { db } from '@/lib/db';
import {
  agentMemoryFactsTable,
  agentMemoryEmbeddingsTable,
  type AgentMemoryFact,
} from '@/lib/schema';
import { eq, and, desc, sql } from 'drizzle-orm';
import { embed } from 'ai';
import { createOpenAI } from '@ai-sdk/openai';
import pino from 'pino';
import { settingsCache } from '@/lib/cache/settings-cache';
import { appSettingsTable } from '@/lib/schema';
import { decrypt } from '@/lib/encryption';

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

// In-memory cache for hot data
interface CacheEntry<T> {
  data: T;
  expiry: number;
}

class MemoryCache {
  private cache = new Map<string, CacheEntry<unknown>>();
  private maxSize: number;
  private TTL: Record<string, number> = {
    facts: 5 * 60 * 1000, // 5 minutes
    graph: 10 * 60 * 1000, // 10 minutes
  };

  constructor(maxSize = 100) {
    this.maxSize = maxSize;

    // Proactively evict expired entries every 60s
    const cleanup = setInterval(() => {
      const now = Date.now();
      for (const [key, entry] of this.cache) {
        if (now >= entry.expiry) this.cache.delete(key);
      }
    }, 60_000);
    // Don't prevent Node.js from exiting
    cleanup.unref();
  }

  get<T>(key: string, type: keyof typeof this.TTL = 'facts'): T | undefined {
    const cached = this.cache.get(key);
    if (!cached) return undefined;
    if (Date.now() >= cached.expiry) {
      this.cache.delete(key);
      return undefined;
    }
    // Move to end to maintain LRU order (Map preserves insertion order)
    this.cache.delete(key);
    this.cache.set(key, cached);
    return cached.data as T;
  }

  set<T>(key: string, data: T, type: keyof typeof this.TTL = 'facts'): void {
    // If at max size, evict the oldest (least recently used) entry
    if (this.cache.size >= this.maxSize && !this.cache.has(key)) {
      const oldestKey = this.cache.keys().next().value;
      if (oldestKey) this.cache.delete(oldestKey);
    }
    // Delete and re-add to maintain insertion order
    this.cache.delete(key);
    this.cache.set(key, {
      data,
      expiry: Date.now() + this.TTL[type],
    });
  }

  invalidate(key: string): void {
    this.cache.delete(key);
  }

  invalidateByPrefix(prefix: string): void {
    for (const key of this.cache.keys()) {
      if (key.startsWith(prefix)) {
        this.cache.delete(key);
      }
    }
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
  async getAllFacts(limit?: number): Promise<AgentMemoryFact[]> {
    const safeCap = limit || 1000;
    const cacheKey = `facts:${this.userId}:${this.organizationId || 'none'}:${safeCap}`;
    const cached = cache.get<AgentMemoryFact[]>(cacheKey, 'facts');
    if (cached !== undefined) {
      logger.debug('Returning cached facts');
      return cached;
    }

    logger.debug({ userId: this.userId, limit: safeCap }, 'Loading facts from database');
    const facts = await db.query.agentMemoryFactsTable.findMany({
      where: and(
        eq(agentMemoryFactsTable.userId, this.userId),
        this.organizationId
          ? eq(agentMemoryFactsTable.organizationId, this.organizationId)
          : sql`organization_id IS NULL`
      ),
      orderBy: [desc(agentMemoryFactsTable.updatedAt)],
      limit: safeCap,
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
      // Convert embedding array to pgvector literal string '[0.1,0.2,...]'
      const vectorLiteral = `[${embedding.join(',')}]`;
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
            1 - (e.embedding <=> ${vectorLiteral}::vector) as similarity
          FROM agent_memory_facts f
          JOIN agent_memory_embeddings e ON e.fact_id = f.id
          WHERE f.user_id = ${this.userId}
            AND ${
              this.organizationId
                ? sql`f.organization_id = ${this.organizationId}`
                : sql`f.organization_id IS NULL`
            }
          ORDER BY e.embedding <=> ${vectorLiteral}::vector
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

    await db
      .delete(agentMemoryFactsTable)
      .where(and(eq(agentMemoryFactsTable.id, id), eq(agentMemoryFactsTable.userId, this.userId)));

    this.invalidateFactsCache();
  }

  // ============================================
  // EMBEDDING GENERATION
  // ============================================

  /**
   * Generate 768-dim embedding for text.
   * Loads OpenAI API key from DB settings (dashboard config) or falls back to env.
   * Uses slice(0, 768) because @ai-sdk/openai's embedding() does not support
   * a dimensions parameter. text-embedding-3-small uses MRL so truncation
   * preserves meaningful structure; pgvector cosine distance normalizes.
   */
  async generateEmbedding(text: string): Promise<number[]> {
    const apiKey = await this.getOpenAIKey();
    if (!apiKey) {
      throw new Error(
        'OpenAI API key is not configured. Add it in Settings > Keys or set OPENAI_API_KEY env var.'
      );
    }

    // Truncate input to ~8000 tokens (approx 32000 chars) to stay within model limits
    const truncatedText = text.slice(0, 32000);

    const openai = createOpenAI({ apiKey });
    const { embedding } = await embed({
      model: openai.embedding('text-embedding-3-small'),
      value: truncatedText,
    });
    return embedding.slice(0, 768);
  }

  /**
   * Load the OpenAI API key from DB settings, falling back to env var.
   */
  private async getOpenAIKey(): Promise<string | null> {
    // Check env first (fast path)
    if (process.env.OPENAI_API_KEY) {
      return process.env.OPENAI_API_KEY;
    }
    // Load from DB (dashboard settings)
    try {
      const [setting] = await db
        .select({ value: appSettingsTable.value })
        .from(appSettingsTable)
        .where(eq(appSettingsTable.key, 'ai_openai_api_key'))
        .limit(1);
      if (setting?.value) {
        return decrypt(setting.value);
      }
    } catch (err) {
      logger.warn({ err }, 'Failed to load OpenAI key from DB settings');
    }
    return null;
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
    const grouped = facts.reduce(
      (acc, fact) => {
        if (!acc[fact.category]) {
          acc[fact.category] = [];
        }
        acc[fact.category].push(fact);
        return acc;
      },
      {} as Record<string, AgentMemoryFact[]>
    );

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
    const facts = await this.getAllFacts(200);

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
    const wordSets = cappedFacts.map(
      (fact) =>
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

  // Workflow-knowledge methods (getNodeMapping, getPatterns, storeNodeMapping,
  // findSimilarWorkflows, storeWorkflowPattern, storeWorkflowEmbedding,
  // updateNodeMappingUsage) were removed in favor of a deterministic translator
  // backed by scripts/shared/node-mappings.json. See .claude/commands/import-n8n.md
  // and .claude/commands/import-make.md.

  // ============================================
  // CACHE MANAGEMENT
  // ============================================

  private invalidateFactsCache(): void {
    cache.invalidateByPrefix(`facts:${this.userId}:${this.organizationId || 'none'}`);
    cache.invalidate(`graph:${this.userId}:${this.organizationId || 'none'}`);
  }
}
