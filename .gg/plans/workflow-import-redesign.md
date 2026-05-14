# Workflow Import Redesign

## The Problem in One Sentence

You have **two parallel node-mapping stores** (a 2,350-line JSON file the parser uses, plus a 188-row Postgres table the agent queries via curl), **three sub-agents** that mostly read the same markdown, and **a "memory" layer that doesn't actually learn** — and the whole thing is overbuilt for what's really a translation problem with a small library of structural patterns.

## What's Actually There Today

### The Working Parts (keep)
- **`scripts/parse-n8n-workflow.ts`** (2,084 LOC) — mechanical N8N JSON → structured markdown. Pure code, no AI, no DB. This is solid.
- **`scripts/shared/node-mappings.json`** (2,350 lines, 147 mappings) — the parser's lookup table. This is the real source of truth.
- **`scripts/build-workflow-from-plan.ts`** — YAML plan → Odin workflow JSON with module validation.
- **`scripts/import-workflow.ts`** — DB insert with duplicate detection.
- **`scripts/search-modules-llm.ts`** (`npm run modules:search`) — concise module lookup for the LLM.
- **The fact-memory layer** (`/remember`, `/recall`, embeddings, hybrid search) — separate concern, works fine, stays.

### The Redundant Parts (cut or fold in)
- **`workflow_node_mappings` table + 6 API routes + cache + Bayesian confidence math** — duplicates `node-mappings.json`. 149 rows, 1.04 uses each, 0.99 avg confidence. No real signal.
- **`workflow_patterns` table** — schema exists, barely populated, schema is too rigid (JSON blobs for `detectionCriteria`/`conversionStrategy`).
- **`workflow_embeddings` table + similarity endpoint** — called once from `yaml-writer.md`, returns past conversions, no evidence it's actually useful.
- **`agent_memory_graphs` table** — declared, never referenced.
- **`scripts/seed-workflow-knowledge.ts`** (91 KB) — seeds the redundant tables. Already mirrored as JSON.
- **`scripts/generate-node-mappings.ts`** (53 KB) — generates the JSON FROM the seed script. Backwards: the JSON should be the source.
- **Four sub-agents** (`yaml-writer`, `build-fixer`, `workflow-tester`, `workflow-import`) — heavy ceremony for what is mostly: parse → write YAML → build → test.

### Real-World Reference
**TM9657/flow-like** (854★) ships a production N8N importer. Their architecture (`packages/ui/lib/importer/`):
- One translator file with a `switch`-table of node-type → handler functions
- One `overrides.ts` for special cases (e.g. Gmail → SMTP-connect + send pair)
- `emitMappingWarnings(diag, node, [...])` — warnings as data, returned to the caller
- **No DB. No embeddings. No "memory". No sub-agents.**

This is what the industry consensus looks like for this exact problem.

## The Core Insight

What you're actually building is **two things**, not one:

1. **A deterministic translator** — `n8n-nodes-base.gmail` + `operation: "send"` → `communication.gmail.sendEmail`. This is a pure function. No LLM, no memory needed. Should be code.
2. **A structural transformer** — N8N branches → Odin sequential. `textClassifier` → `ai.ai-sdk.generateJSON`. IF/Switch → `utilities.javascript.execute`. This needs judgement, prompts, sometimes user input. This is where the LLM lives.

Today you have one tangled pipeline trying to do both with LLM ceremony around code that should just run.

## Proposed Architecture

```
┌──────────────────────────────────────────────────────────────┐
│  /import-n8n <path>      /import-make <path>                 │
│  (separate slash commands — clean, focused, one job each)    │
└──────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌──────────────────────────────────────────────────────────────┐
│  PHASE 1 — Translate (pure code, deterministic)              │
│  scripts/translate-n8n.ts <file>  →  plans/<name>.yaml       │
│                                                              │
│  • Reads node-mappings.json (source of truth)                │
│  • Walks N8N nodes + connections                             │
│  • For each node: mapping[type].translate(node) → YAML step  │
│  • Returns: { yamlPath, warnings[], unknownNodes[] }         │
│  • NO LLM, NO DB. ~80% of conversions complete here.         │
└──────────────────────────────────────────────────────────────┘
                              │
                              ▼
                  ┌───────────┴───────────┐
                  │ Unknown nodes / warns? │
                  └───────────┬───────────┘
                              │ Yes
                              ▼
┌──────────────────────────────────────────────────────────────┐
│  PHASE 2 — Resolve (LLM, only for the gaps)                  │
│  Inline in slash command, single agent turn                  │
│                                                              │
│  • Reads patterns/*.md (structural patterns library)         │
│  • Reads modules:search output for unknown services          │
│  • Asks user when ambiguous (AskUserQuestion)                │
│  • Edits the YAML in place                                   │
│  • Records corrections to learnings.jsonl (append-only)      │
└──────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌──────────────────────────────────────────────────────────────┐
│  PHASE 3 — Build & Test (already works, just call directly)  │
│  npx tsx scripts/build-workflow-from-plan.ts <yaml>          │
│  POST /api/workflows/execute-test (with mock trigger data)   │
└──────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌──────────────────────────────────────────────────────────────┐
│  PHASE 4 — Import (ask client → import)                      │
│  Ask: "Which organization?"                                  │
│  npx tsx scripts/import-workflow.ts <json>                   │
└──────────────────────────────────────────────────────────────┘
```

## Answering Your Questions Directly

### "Do we even need agents and skills, or just a slash command?"

**Just a slash command.** Anthropic's own conclusion across Claude Code, Codex, and Hermes: "every clever architecture lost. The simple thing won. LLM plus markdown plus a bash tool."

Your sub-agents (`yaml-writer`, `build-fixer`, `workflow-tester`) each spin up a fresh context, lose state on exit, and then need to be re-fed information the parent already had. That's overhead, not value. The parent agent running a slash command with the right tool calls beats a 4-agent pipeline for this scale of work.

Skills make sense for **reference material** (`patterns/*.md`, `translation-reference.md`) — the agent globs and reads what it needs. Skills do NOT make sense as **execution orchestrators** when you already have shell scripts that do the deterministic work better.

### "Should N8N and Make.com be separated?"

**Yes — separate slash commands, shared infrastructure.**

- `/import-n8n <path>` → runs `translate-n8n.ts`
- `/import-make <path>` → runs `translate-make.ts`
- Both feed into the same build/test/import phases
- Both share `patterns/*.md` for structural transforms
- Both log corrections to the same `learnings.jsonl`

Why separate the entry points:
- N8N and Make.com have **fundamentally different shapes** (N8N: nodes+connections graph; Make.com: flat flow array with routers). Trying to abstract that in one entry point creates a fake polymorphism that just dispatches on platform anyway.
- Errors stay specific ("unknown N8N node type X" vs "unknown Make module Y") instead of generic.
- Each translator is ~500 LOC, focused, testable. Together they'd be 1500+ LOC of `if (platform === ...)` branches.
- New platforms (Zapier, Pipedream, Workato eventually) get their own `/import-X` command without touching existing code.

### "Building something smarter"

The smarter system isn't a bigger memory layer — it's three things that don't exist today:

1. **Deterministic translation** — most N8N conversions are mechanical. Make them mechanical. Save LLM cycles and tokens for the parts that actually need judgement.
2. **A patterns library** as markdown files, one file per pattern: `text-classifier-chain.md`, `branching-to-sequential.md`, `polling-trigger.md`, `cascading-classifiers.md`. The agent globs them. This is what Claude Code is post-trained to consume.
3. **A real learning loop** — append-only `learnings.jsonl` written ONLY when the user corrects something. Each line is one row: `{date, sourceType, wrongMapping, correctMapping, userNote}`. The translator reads this at startup and applies corrections as overrides. This is the actual learning your current system pretends to do.

## The Migration

### What gets deleted
- `src/app/api/memory/workflow-knowledge/` (6 routes, 555 LOC)
- `workflow_node_mappings`, `workflow_patterns`, `workflow_embeddings`, `agent_memory_graphs` tables + drizzle migrations
- `scripts/seed-workflow-knowledge.ts` (91 KB)
- `scripts/generate-node-mappings.ts` (53 KB) — replaced by hand-edited JSON
- `MemoryManager` methods: `getNodeMapping`, `getNodeMappings`, `getPatterns`, `storeNodeMapping`, `findSimilarWorkflows`, `storeWorkflowPattern`, `storeWorkflowEmbedding`, `updateNodeMappingUsage` (~300 LOC)
- `.claude/agents/yaml-writer.md`, `build-fixer.md`, `workflow-tester.md`, `workflow-import.md`
- `.claude/skills-workspace/workflow-import/` (folded into `.claude/skills-workspace/workflow-translator/`)
- `.claude/commands/iw.md` (replaced by `/import-n8n` and `/import-make`)

### What gets added
- `scripts/translate-n8n.ts` — deterministic translator, ~600 LOC
- `scripts/translate-make.ts` — deterministic translator, ~500 LOC
- `scripts/shared/node-mappings.json` — already exists, becomes the **only** source of truth (add Make.com mappings to it)
- `.claude/skills-workspace/workflow-translator/patterns/*.md` — one file per structural pattern (~10 files)
- `.claude/commands/import-n8n.md` — slash command, ~80 lines
- `.claude/commands/import-make.md` — slash command, ~80 lines
- `data/workflow-translator/learnings.jsonl` — append-only corrections log

### What stays untouched
- `src/lib/memory/memory-manager.ts` — keep the FACTS half (`saveFact`, `searchFacts`, `getAllFacts`, `getFactsForContext`, `deleteFact`, embeddings). Strip the workflow-knowledge methods.
- `agent_memory_facts` + `agent_memory_embeddings` tables
- `/remember`, `/recall`, `/forget` commands in agent-chat
- `scripts/parse-n8n-workflow.ts` — still useful for human inspection, kept as a separate read-only tool
- `scripts/build-workflow-from-plan.ts` and `scripts/import-workflow.ts`

### Net change
- **~2,500 LOC deleted** (DB tables, API routes, seed scripts, agent definitions, redundant memory methods)
- **~1,200 LOC added** (two translators)
- **~10 markdown pattern files added**
- **4 DB tables dropped**
- **0 sub-agents** for workflow import (down from 4)

## Risks and Tradeoffs

### Risk 1: The deterministic translator misses platform edge cases
Mitigation: every translator function emits `warnings[]`. Phase 2 sees them and asks the LLM/user. Failure mode is "user gets asked a question," not "silent wrong conversion."

### Risk 2: `node-mappings.json` becomes a giant unmaintainable blob
It's already 2,350 lines. Mitigation: split by category into `mappings/triggers.json`, `mappings/ai.json`, `mappings/communication.json`, etc. Merge at load time. Diff-friendly.

### Risk 3: Losing the "similarity search" capability for past conversions
Honest answer: there's no evidence anyone is using it. `workflow_embeddings` has no DB-side query log proving impact. If we miss it later, it's 50 LOC to add back as a thin endpoint over the same table — but only after we measure that we actually want it.

### Risk 4: Existing imports in flight
None. The pipeline is internal tooling. Migration can be done in one PR.

## Verification

After implementation:
1. `npm run typecheck` — clean
2. `npm run lint` — clean
3. **Real test:** drop your three most-imported N8N workflows (Gmail trigger + classify + label, Airtable polling + AI, Webhook + multi-step) through `/import-n8n` end-to-end. Compare output to current pipeline. Should produce equivalent YAML with fewer LLM tokens consumed.
4. Drop one real Make.com blueprint through `/import-make`. Verify it produces valid YAML or fails loudly with a specific unknown-module error.
5. Manually feed a "wrong" conversion through `/import-n8n`, correct it, verify the correction lands in `learnings.jsonl`. Re-run with a similar workflow — verify the correction is applied automatically by the translator.

## Open Questions to Decide Before Implementation

1. **Make.com mapping coverage:** the JSON file is N8N-heavy. We have ~39 Make.com mappings in the DB. Do we port them to JSON as-is, or rebuild the Make.com mapping set from the actual `.blueprint.json` files you've imported? (Recommend: port as-is to unblock, expand on demand.)
2. **Where does `learnings.jsonl` live?** Recommend `data/workflow-translator/learnings.jsonl` (gitignored) for local dev, with a separate "promote to mappings" review command you run manually when a correction has proven stable across multiple imports. This avoids untrusted user input poisoning the canonical mappings file.
3. **Keep `scripts/parse-n8n-workflow.ts` as-is, or fold its node-walking into `translate-n8n.ts`?** Recommend: keep it separate. It's useful as a `--format=md` debugging tool ("show me what this N8N file actually contains") even when not translating.
4. **Drop the DB tables in this PR, or mark deprecated and drop in a follow-up?** Recommend: same PR, with a drizzle migration. There's no production data worth preserving (188 rows, all reconstructable from JSON).

## Steps

1. Audit Make.com mappings in the DB and export the 39 rows to JSON, merged into `scripts/shared/node-mappings.json` under a `make` platform key (or split into `node-mappings-n8n.json` + `node-mappings-make.json` — decide based on file size).
2. Reshape `scripts/shared/node-mappings.json` schema to support both platforms cleanly: `{ "<platform>": { "<source-type>": { b0tModule, category, operations?, conversionConfig?, triggerType? } } }`.
3. Write `scripts/translate-n8n.ts` — walks nodes + connections, applies mappings, produces `plans/<name>.yaml`, returns `{ yamlPath, warnings, unknownNodes }`.
4. Write `scripts/translate-make.ts` — walks flow array, applies mappings, handles routers as the documented "ask user" pattern, produces `plans/<name>.yaml`, returns the same shape.
5. Create `.claude/skills-workspace/workflow-translator/patterns/` and migrate the 5–10 known structural patterns (text-classifier, cascading-classifier, branching-to-sequential, polling-trigger, basic-router, http-request, code-step, sub-node-fold) from `analysis-guide.md` into one file each.
6. Write `.claude/commands/import-n8n.md` — slash command orchestrating: translate → resolve unknowns → build → test → ask client → import → log learnings.
7. Write `.claude/commands/import-make.md` — same shape, calls `translate-make.ts`.
8. Add `data/workflow-translator/learnings.jsonl` handling: translators read it at startup as an override layer over `node-mappings.json`; the import commands append a line whenever the user corrects a mapping.
9. Strip workflow-knowledge methods from `MemoryManager` (`getNodeMapping`, `getNodeMappings`, `getPatterns`, `storeNodeMapping`, `findSimilarWorkflows`, `storeWorkflowPattern`, `storeWorkflowEmbedding`, `updateNodeMappingUsage`) and remove their imports.
10. Delete `src/app/api/memory/workflow-knowledge/` directory (6 routes).
11. Write a drizzle migration dropping `workflow_node_mappings`, `workflow_patterns`, `workflow_embeddings`, `agent_memory_graphs` tables; remove the schema definitions from `src/lib/schema.ts`.
12. Delete `scripts/seed-workflow-knowledge.ts` and `scripts/generate-node-mappings.ts`.
13. Delete `.claude/agents/yaml-writer.md`, `.claude/agents/build-fixer.md`, `.claude/agents/workflow-tester.md`, `.claude/agents/workflow-import.md`.
14. Delete `.claude/skills-workspace/workflow-import/` and `.claude/commands/iw.md`.
15. Update `CLAUDE.md` Workflow Import Rules section to reference `/import-n8n` and `/import-make` instead of the knowledge-base API.
16. Run `npm run typecheck` and `npm run lint`; fix any references to deleted symbols.
17. End-to-end test: take 3 representative N8N workflows and 1 Make.com blueprint, run them through the new commands, verify output parity with previous pipeline (or document deliberate differences).
18. Manually verify the learnings loop: introduce a wrong mapping, correct it during an import, confirm the next similar import applies the correction without re-asking.
