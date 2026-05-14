-- Drop the workflow-knowledge tables. These were superseded by the
-- deterministic translator (scripts/translate-n8n.ts, scripts/translate-make.ts)
-- backed by scripts/shared/node-mappings.json. The 188 rows historically
-- present in workflow_node_mappings are fully reconstructable from JSON;
-- workflow_patterns / workflow_embeddings / agent_memory_graphs had no
-- production usage worth preserving.

DROP TABLE IF EXISTS workflow_embeddings CASCADE;
DROP TABLE IF EXISTS workflow_patterns CASCADE;
DROP TABLE IF EXISTS workflow_node_mappings CASCADE;
DROP TABLE IF EXISTS agent_memory_graphs CASCADE;
