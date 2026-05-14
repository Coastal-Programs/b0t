# Architecture

High-level map of the Odin (b0t) codebase. Use this as a navigator — every section points to the directory or file where the real source lives. For setup and feature overview, see [README.md](./README.md). For day-to-day rules, see [CLAUDE.md](./CLAUDE.md).

## System overview

Odin is a **YAML-driven workflow automation platform**. Users describe automations in plain English; Claude Code (the AI builder) generates YAML workflow plans; the executor runs them against 140+ integrated services. Long-running and scheduled work runs in a background worker over a Redis queue.

```
┌────────────────────────────────────────────────────────────────────┐
│                        Next.js 15 (App Router)                     │
│  src/app/(public|dashboard|api)/                                   │
│   ├── React 19 UI            ── src/components/                    │
│   └── API routes             ── src/app/api/                       │
└──────────────┬──────────────────────────────────┬──────────────────┘
               │                                  │
               │ enqueue                          │ direct calls
               ▼                                  ▼
       ┌───────────────┐                  ┌────────────────┐
       │ Redis (BullMQ)│                  │ Workflow engine│
       └──────┬────────┘                  │ src/lib/       │
              │                           │   workflows/   │
              ▼                           └───────┬────────┘
       ┌───────────────┐                          │
       │   worker.ts   │ ───── executes ─────────►│
       │ (BullMQ wkr)  │                          │
       └───────┬───────┘                          ▼
               │                          ┌────────────────┐
               │                          │  Modules (140+)│
               │                          │ src/modules/   │
               │                          └───────┬────────┘
               │                                  │
               ▼                                  ▼
       ┌────────────────────────────────────────────────┐
       │  PostgreSQL (pgvector) — Drizzle ORM            │
       │  src/lib/schema.ts · src/lib/db.ts · drizzle/   │
       └────────────────────────────────────────────────┘
```

## Process model

Odin runs as **two long-lived processes** plus a database:

| Process       | Entry point        | Responsibility                                              |
| ------------- | ------------------ | ----------------------------------------------------------- |
| Web server    | `next start`       | HTTP API, UI, webhook ingestion, ad-hoc workflow execution. |
| Worker        | `worker.ts` (tsx)  | BullMQ consumer: scheduled runs, retries, long-running jobs.|
| Postgres      | `docker-compose`   | App data + pgvector for memory embeddings.                  |
| Redis         | `docker-compose`   | BullMQ queue + rate-limit/lock storage.                     |

Local dev: `npm run dev:full` boots both Next.js and the worker (see `scripts/dev-start.sh`).

## Top-level layout

```
src/
  app/           Next.js App Router: pages, layouts, API routes
  components/    React UI (feature-folder, Radix UI primitives)
  hooks/         Custom React hooks
  lib/           Cross-cutting infrastructure (see below)
  modules/       140+ integrations, grouped by domain
  types/         Shared TypeScript types
  middleware.ts  Next.js edge middleware (auth, rate-limit)
  instrumentation.ts  Next.js server-side init hook
  env.ts         Typed env vars (@t3-oss/env-nextjs + Zod)

drizzle/         SQL migrations (Drizzle Kit)
scripts/         CLI utilities (workflow:*, db:*, modules:*)
tests/           Vitest suite, fixtures, templates
worker.ts        BullMQ worker entry point
```

## Subsystems

### Workflow engine — `src/lib/workflows/`

The core executor. Takes a YAML plan, validates it, resolves credentials, executes steps sequentially (or in parallel where the plan permits), and streams progress.

| File                          | Role                                                         |
| ----------------------------- | ------------------------------------------------------------ |
| `executor.ts`                 | Main step-by-step interpreter for workflow plans.            |
| `executor-stream.ts`          | Streaming variant for chat-style real-time execution.        |
| `parallel-executor.ts`        | Fan-out/fan-in for steps marked parallel.                    |
| `Pipeline.ts`                 | Lower-level stage pipeline abstraction.                      |
| `workflow-schema.ts`          | Zod schema for workflow YAML.                                |
| `workflow-validator.ts`       | Static checks (types, credential bindings, references).      |
| `workflow-queue.ts`           | BullMQ producer; submits runs to the worker.                 |
| `workflow-scheduler.ts`       | Cron trigger management.                                     |
| `workflow-patch.ts`           | JSON-Patch-style edits to live workflows.                    |
| `module-registry.ts`          | Generated registry of every module + action signature.       |
| `module-preloader.ts`         | Lazy-imports module code on first use to keep startup fast.  |
| `credentials.ts`              | Resolves and injects credentials at step boundaries.         |
| `credential-cache.ts`         | In-memory cache for hot credential lookups.                  |
| `analyze-credentials.ts`      | Static analysis: which credentials does this plan require?  |
| `analyze-output-display.ts`   | Static analysis: how should each step's output render?       |
| `control-flow.ts`             | `if`/`switch`/`foreach` step semantics.                      |
| `import-export.ts`            | Importers for n8n / Make.com blueprints; export to YAML.     |
| `airtable-triggers.ts` / `email-triggers.ts` | Polling-trigger implementations.              |
| `platform-configs.ts`         | Per-platform constants (rate limits, scopes, endpoints).     |
| `workflow-to-mermaid.ts`      | Visualizes a workflow plan as a Mermaid diagram.             |

### Modules — `src/modules/`

Each subdirectory is a domain; each file in a domain is one service integration exposing a stable action API. Categories:

`ai/` · `business/` · `communication/` · `content/` · `data/` · `dataprocessing/` · `devtools/` · `ecommerce/` · `external-apis/` · `leads/` · `mcp/` · `payments/` · `productivity/` · `social/` · `utilities/` · `video/`

The registry at `src/lib/workflows/module-registry.ts` is the single source of truth the executor (and the AI builder) consults to discover actions, their parameters, and credential requirements. Regenerate with `npm run modules:generate-registry`.

### Memory system — `src/lib/memory/`

Hybrid retrieval (vector + keyword) for the AI builder. Backed by Postgres + pgvector with OpenAI 768-dim embeddings.

| Table                       | Purpose                                                     |
| --------------------------- | ----------------------------------------------------------- |
| `agent_memory_facts`        | Core fact storage with full-text search.                    |
| `agent_memory_embeddings`   | Vector embeddings (768-dim) for semantic recall.            |

Public API: the `MemoryManager` class in `src/lib/memory/memory-manager.ts`.

### Workflow translator — `scripts/translate-n8n.ts` · `scripts/translate-make.ts`

Deterministic n8n / Make.com → Odin translator. No DB, no LLM in the hot path. Driven by the `/import-n8n` and `/import-make` slash commands (see `.claude/commands/`).

| File / path                                          | Role                                                                  |
| ---------------------------------------------------- | --------------------------------------------------------------------- |
| `scripts/translate-n8n.ts` · `scripts/translate-make.ts` | Pure-code translators; emit YAML plans and structured warnings.    |
| `scripts/shared/node-mappings.json`                  | Source of truth for node-type → Odin module mappings.                 |
| `data/workflow-translator/learnings.jsonl`           | User-correction override layer, appended only on active corrections.  |
| `src/app/api/memory/workflow-mappings/route.ts`      | Read-only HTTP view of the JSON, consumed by the MindMap dialog UI.   |

### Persistence — `src/lib/db.ts` + `src/lib/schema.ts` + `drizzle/`

- `db.ts` exports a Drizzle client wired with the schema so `db.query.*` is fully typed.
- `schema.ts` defines every table in one file (28 KB) — easier to audit than scattered files.
- `drizzle/` holds raw SQL migrations; generate with `npm run db:generate`, apply with `npm run db:migrate`.

### Auth — `src/lib/auth.ts` + `src/middleware.ts`

NextAuth v5 with session lookups in middleware for route gating. OAuth credential exchange for third-party services is a separate concern handled by `src/lib/oauth-token-manager.ts` and `src/lib/oauth-service-configs.ts` (per-provider configuration).

### Queue, rate-limit, resilience — `src/lib/`

| Concern         | File(s)                                  | Backing store   |
| --------------- | ---------------------------------------- | --------------- |
| Job queue       | `queue.ts`, `workflow-queue.ts`          | Redis (BullMQ)  |
| Rate limiting   | `rate-limiter.ts`, `ratelimit.ts`        | Redis (Upstash) |
| Distributed lock| `redis-lock.ts`                          | Redis           |
| Circuit breaker | `resilience.ts` (opossum)                | in-memory       |
| Scheduler       | `scheduler.ts`                           | node-cron       |
| Logging         | `logger.ts` (+ `.node.ts` / `-edge.ts`)  | pino            |
| HTTP client     | `axios-config.ts` (axios + axios-retry)  | —               |

### UI — `src/app/` + `src/components/`

- App Router with route groups for `(public)` and `(dashboard)` segments.
- Components organized by feature (`workflows/`, `credentials/`, `clients/`, …), not by layer.
- Styling: Tailwind v4 + Radix UI primitives + Lucide icons.
- Client data fetching: SWR.
- Forms/validation: Zod schemas shared between client and server where possible.

## Data flow examples

**Manual workflow run from the UI**

1. User clicks "Run" in `src/components/workflows/`.
2. `POST /api/workflows/[id]/run` enqueues a BullMQ job (`workflow-queue.ts`).
3. `worker.ts` picks up the job → `executor.ts` loads the plan, validates, resolves credentials.
4. Each step calls into `src/modules/<domain>/<service>.ts`.
5. Progress is written back to Postgres; the UI polls or subscribes for updates.

**Webhook trigger**

1. Third party POSTs to `/api/webhooks/[token]`.
2. Handler in `src/app/api/webhooks/` validates the token, normalizes the payload, enqueues a workflow run.
3. Same execution path as above.

**Scheduled workflow**

1. `workflow-scheduler.ts` registers a cron entry per scheduled workflow.
2. On tick, it enqueues a BullMQ job; same execution path.

## Conventions

- **Imports** use the `@/` alias (mapped to `src/` in `tsconfig.json`).
- **One concept per file**; feature folders, not layer folders.
- **Zod at boundaries** — every external input (HTTP body, env, third-party response) is validated.
- **Structured logging** via `pino` (`logger`); no `console.log` in committed code.
- **Modules are stateless** — credentials and config are passed in, never read from globals.

## Where to start reading

- New to the workflow engine? → `src/lib/workflows/executor.ts` and `src/lib/workflows/workflow-schema.ts`.
- New to a single module? → `src/modules/index.ts`, then pick a domain.
- New to the AI builder side? → `src/lib/memory/memory-manager.ts` (facts/embeddings) and `scripts/translate-n8n.ts` / `scripts/translate-make.ts` (the deterministic workflow translators driven by `/import-n8n` and `/import-make`).
- New to the schema? → `src/lib/schema.ts` (top-down by table group).
