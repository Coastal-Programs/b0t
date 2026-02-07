# Odin - Workflow Automation Platform

Open-source, self-hostable workflow automation platform where you describe workflows in plain English to Claude Code, which generates, validates, and executes production-grade automations across 140+ integrated services.

## Project Structure

```
src/
  ├── app/              # Next.js App Router (pages, layouts, API routes)
  ├── components/       # React UI components (workflows, credentials, clients)
  ├── lib/              # Core utilities (workflow engine, auth, db, queue, scheduler)
  │   ├── memory/       # Agent memory system (MemoryManager, facts, embeddings)
  │   └── workflows/    # Workflow engine (executor, credentials, module registry)
  ├── modules/          # 16 domain modules, 140+ services (AI, social, communication, business, etc.)
  ├── types/            # TypeScript type definitions
  └── hooks/            # Custom React hooks
scripts/                # Workflow & database management utilities
tests/                  # Test suite with templates & fixtures
drizzle/                # Database migrations (Drizzle ORM)
worker.ts               # Background job worker (BullMQ)
```

## Organization Rules

**Keep code organized and modularized:**
- API routes → `src/app/api/`, one file per resource
- Components → `src/components/`, feature-based folders
- Workflows → `src/lib/workflows/`, separated by executor type
- Modules → `src/modules/`, one folder per domain (social, AI, etc.)
- Memory system → `src/lib/memory/`
- Types → `src/types/` or co-located with usage
- Tests → `tests/` with matching structure

**Modularity principles:**
- Single responsibility per file
- Clear, descriptive naming
- Group related functionality together
- No monolithic files

## Code Quality - Zero Tolerance

After editing ANY file, run:

```bash
npm run typecheck
npm run lint
```

Fix ALL errors/warnings before continuing.

If changes affect server/worker (not hot-reloadable):
1. Restart: `npm run dev:full` (starts Next.js + worker)
2. Read server logs for errors
3. Fix ALL warnings/errors before continuing

## Tech Stack

- **Frontend:** React 19, Next.js 15, Tailwind CSS 4, Radix UI
- **Backend:** Node.js 20+, Next.js API Routes, NextAuth v5
- **Database:** PostgreSQL (pgvector), Drizzle ORM, Redis (BullMQ)
- **AI:** Anthropic Claude, OpenAI GPT, OpenAI Embeddings (768-dim)
- **Testing:** Vitest, JSDOM

## Key Systems

### Memory System (`src/lib/memory/`)
Agent memory with hybrid search (vector + keyword). Tables:
- `agent_memory_facts` - Core fact storage with FTS
- `agent_memory_embeddings` - 768-dim vector embeddings
- `workflow_node_mappings` - N8N/Make.com → Odin module mappings
- `workflow_patterns` - Complex conversion patterns
- `workflow_embeddings` - Semantic similarity for past conversions

API: `MemoryManager` class in `src/lib/memory/memory-manager.ts`

### Workflow Engine (`src/lib/workflows/`)
YAML-based workflow execution with 140+ module integrations. Supports triggers (cron, webhook, chat), sequential steps, and credential injection.

### Database
PostgreSQL with Drizzle ORM. Schema in `src/lib/schema.ts`. DB client in `src/lib/db.ts` (includes schema for `db.query.*` access). Migrations in `drizzle/`.

## Agent Team Guidelines

Agent Teams are enabled for this project. Teammates read this file on spawn but do NOT inherit conversation history.

### File Ownership - Avoid Conflicts

When working as a team, each teammate MUST own distinct files. Two teammates editing the same file causes overwrites.

**Ownership boundaries:**
- **Frontend work**: `src/components/`, `src/app/dashboard/`, `src/hooks/`
- **Backend/API work**: `src/app/api/`, `src/lib/`, `src/modules/`
- **Database work**: `drizzle/`, `src/lib/schema.ts`, `src/lib/db.ts`
- **Scripts**: `scripts/`
- **Tests**: `tests/`

If you need to modify a file another teammate owns, message them first.

### Coordination

- Check the shared task list before starting work
- Claim tasks before working on them
- Mark tasks completed when done, then check for next available
- If blocked by another teammate's work, message them directly
- Run `npm run typecheck` after your changes - don't leave broken types for others

### For Teammates: What You Need to Know

- **DB access**: Import `db` from `@/lib/db` and tables from `@/lib/schema`
- **Auth**: Use `auth()` from `@/lib/auth` in API routes for session
- **Logging**: Use `logger` from `@/lib/logger` (pino)
- **API pattern**: Next.js 15 route handlers with `NextRequest`, `Response.json()`
- **Component pattern**: Client components with `'use client'`, Radix UI primitives, Tailwind
- **Imports**: Use `@/` path alias (maps to `src/`)

## Documentation

Do not create documentation UNLESS specifically requested to by the user as this wastes context.

## Compaction Instructions

When summarizing this conversation (via /compact), follow these rules to minimize token usage:

**Preserve:**
- Current project architecture and key technical decisions.
- The exact "Next Steps" or current task list.
- Core code snippets that were successfully implemented.

**Discard:**
- All verbose terminal output, logs, and stack traces.
- Failed attempts or discarded approaches.
- Intermediate file listings and search results (grep outputs).

**Format:** Keep the final summary under 3,000 tokens if possible.
