-- Enable pgvector extension for vector similarity search
CREATE EXTENSION IF NOT EXISTS vector;

-- CORE MEMORY TABLE (Facts)
CREATE TABLE agent_memory_facts (
  id VARCHAR(255) PRIMARY KEY DEFAULT gen_random_uuid()::text,
  user_id VARCHAR(255) NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  organization_id VARCHAR(255) REFERENCES organizations(id) ON DELETE CASCADE,
  category TEXT NOT NULL,  -- user_info, preferences, projects, people, work, notes, decisions
  subject TEXT NOT NULL,
  content TEXT NOT NULL,
  metadata JSONB DEFAULT '{}'::jsonb,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

-- Indexes for performance
CREATE INDEX idx_memory_facts_user_org ON agent_memory_facts(user_id, organization_id);
CREATE INDEX idx_memory_facts_category ON agent_memory_facts(category);
CREATE INDEX idx_memory_facts_subject ON agent_memory_facts(subject);

-- Full-Text Search (PostgreSQL equivalent to FTS5)
ALTER TABLE agent_memory_facts ADD COLUMN fts_document tsvector
  GENERATED ALWAYS AS (
    setweight(to_tsvector('english', coalesce(category, '')), 'A') ||
    setweight(to_tsvector('english', coalesce(subject, '')), 'B') ||
    setweight(to_tsvector('english', coalesce(content, '')), 'C')
  ) STORED;

CREATE INDEX idx_memory_facts_fts ON agent_memory_facts USING GIN(fts_document);

-- EMBEDDING CHUNKS TABLE (for vector search)
CREATE TABLE agent_memory_embeddings (
  id VARCHAR(255) PRIMARY KEY DEFAULT gen_random_uuid()::text,
  fact_id VARCHAR(255) NOT NULL REFERENCES agent_memory_facts(id) ON DELETE CASCADE,
  content TEXT NOT NULL,  -- Combined: category + subject + content
  embedding vector(768),  -- Optimized: 768-dim for 50% storage savings, 2-3x faster search
  created_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX idx_memory_embeddings_fact ON agent_memory_embeddings(fact_id);
CREATE INDEX idx_memory_embeddings_vector ON agent_memory_embeddings USING ivfflat (embedding vector_cosine_ops);

-- WORKFLOW CONVERSION KNOWLEDGE BASE (for workflow-import subagent)
CREATE TABLE workflow_node_mappings (
  id VARCHAR(255) PRIMARY KEY DEFAULT gen_random_uuid()::text,
  source_platform TEXT NOT NULL,        -- 'n8n' | 'make'
  source_identifier TEXT NOT NULL,      -- N8N: 'n8n-nodes-base.airtable' | Make: 'airtable:TriggerWatchRecords'
  identifier_type TEXT NOT NULL,        -- 'node_type' (N8N) | 'module_action' (Make.com)
  odin_module_path TEXT NOT NULL,       -- 'data.airtable.watchRecords'
  conversion_config JSONB DEFAULT '{}'::jsonb,
  confidence_score REAL DEFAULT 1.0,
  usage_count INTEGER DEFAULT 1,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

-- Unique per platform + identifier
CREATE UNIQUE INDEX idx_workflow_mappings_platform_identifier
  ON workflow_node_mappings(source_platform, source_identifier);

-- Fast lookups by platform
CREATE INDEX idx_workflow_mappings_platform ON workflow_node_mappings(source_platform);

COMMENT ON COLUMN workflow_node_mappings.source_identifier IS
  'N8N uses type field (e.g., n8n-nodes-base.airtable), Make.com uses module field (e.g., airtable:TriggerWatchRecords)';

-- WORKFLOW PATTERNS (complex patterns like cascading classifiers, routers, etc.)
CREATE TABLE workflow_patterns (
  id VARCHAR(255) PRIMARY KEY DEFAULT gen_random_uuid()::text,
  source_platform TEXT NOT NULL,        -- 'n8n' | 'make' | 'both'
  pattern_name TEXT NOT NULL,
  description TEXT,
  detection_criteria JSONB NOT NULL,     -- Platform-specific detection rules
  conversion_strategy JSONB NOT NULL,    -- How to convert pattern
  yaml_template TEXT,                    -- Template for this pattern
  example_workflows JSONB DEFAULT '[]'::jsonb,
  success_rate REAL DEFAULT 1.0,
  created_at TIMESTAMP DEFAULT NOW()
);

CREATE UNIQUE INDEX idx_workflow_patterns_platform_name
  ON workflow_patterns(source_platform, pattern_name);

COMMENT ON COLUMN workflow_patterns.source_platform IS
  'N8N patterns (cascading classifiers), Make.com patterns (routers), or universal patterns (both)';

-- WORKFLOW EMBEDDINGS (semantic similarity search for past conversions)
CREATE TABLE workflow_embeddings (
  id VARCHAR(255) PRIMARY KEY DEFAULT gen_random_uuid()::text,
  source_platform TEXT NOT NULL,          -- 'n8n' | 'make'
  workflow_description TEXT NOT NULL,
  structure_summary JSONB NOT NULL,       -- { "steps": 8, "services": ["apify", "perplexity"], "pattern": "multi_service_research" }
  embedding vector(768),                   -- 768-dim optimized
  conversion_approach TEXT,
  odin_workflow_id VARCHAR(255),
  services TEXT[],                         -- Extracted service names for quick filtering
  pattern_type TEXT,                       -- E.g., "multi_service_research", "ai_agent_with_tools", "scheduled_enrichment"
  similarity_threshold REAL DEFAULT 0.75,  -- Min similarity to consider a match
  created_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX idx_workflow_embeddings_vector ON workflow_embeddings USING ivfflat (embedding vector_cosine_ops);
CREATE INDEX idx_workflow_embeddings_platform ON workflow_embeddings(source_platform);
CREATE INDEX idx_workflow_embeddings_services ON workflow_embeddings USING GIN(services);
CREATE INDEX idx_workflow_embeddings_pattern ON workflow_embeddings(pattern_type);

-- Composite index for platform-filtered semantic search (most common query)
CREATE INDEX idx_workflow_embeddings_platform_vector
  ON workflow_embeddings(source_platform)
  INCLUDE (embedding);

COMMENT ON COLUMN workflow_embeddings.source_platform IS
  'Separate embeddings by platform to avoid N8N/Make.com cross-contamination in similarity search';

-- MEMORY GRAPH DATA (cached graph for visualization)
CREATE TABLE agent_memory_graphs (
  id VARCHAR(255) PRIMARY KEY DEFAULT gen_random_uuid()::text,
  user_id VARCHAR(255) NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  organization_id VARCHAR(255) REFERENCES organizations(id) ON DELETE CASCADE,
  graph_data JSONB NOT NULL,  -- Nodes and edges for D3.js
  version INTEGER DEFAULT 1,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

CREATE UNIQUE INDEX idx_memory_graphs_user_org ON agent_memory_graphs(user_id, organization_id);
