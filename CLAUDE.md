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

> For a deeper system map, see [ARCHITECTURE.md](./ARCHITECTURE.md).

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

API: `MemoryManager` class in `src/lib/memory/memory-manager.ts`

### Workflow Translator
Deterministic N8N / Make.com → Odin translator. No DB, no LLM in the hot
path. Mappings live in `scripts/shared/node-mappings.json` (the source of
truth). User corrections append to `data/workflow-translator/learnings.jsonl`
and override the JSON at translate time. Entry points: `scripts/translate-n8n.ts`
and `scripts/translate-make.ts`.

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

## Workflow Import Rules

To import an N8N or Make.com workflow, use the slash commands:
- `/import-n8n <path>` — N8N JSON workflow
- `/import-make <path>` — Make.com `.blueprint.json` workflow

Both commands run a deterministic translator (`scripts/translate-n8n.ts` /
`scripts/translate-make.ts`) first, then only invoke the LLM for warnings
and unknown nodes. Mappings live in `scripts/shared/node-mappings.json`;
user corrections append to `data/workflow-translator/learnings.jsonl`.

Rules:
1. ALWAYS ask the user which client (organization) the workflow should be assigned to before importing.
2. NEVER substitute services. If the source uses Perplexity, the output uses Perplexity. If no Odin module exists, STOP and ask the user — do not silently swap providers.
3. NEVER map polling/watch triggers (Airtable, Gmail, Outlook) to `manual` — they must use their corresponding trigger type (`airtable`, `gmail`, `outlook`).
4. NEVER silently flatten branches or routers. Always raise an `AskUserQuestion` per the matching pattern file in `.claude/skills-workspace/workflow-translator/patterns/`.
5. Append a line to `data/workflow-translator/learnings.jsonl` ONLY when the user actively corrects a mapping during import. Do not write on every successful import — that's noise, not learning.

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

## Eyes

Perception probes live in `.gg/eyes/`. All headless. Artifacts → `.gg/eyes/out/` (gitignored). Invoke probes yourself; don't ask the user to verify what you can verify.

### Available probes

| Need | Run | Then |
|---|---|---|
| Hit an API route and see status/body | `.gg/eyes/http.sh <url> [METHOD] [body-or-@file] [-H "K: V"]` | Read the `body` path in the returned JSON to confirm shape; check `status` for the expected code. |
| Tail Next.js or worker logs after an action | `.gg/eyes/logs.sh <container-or-process>` (docker by default) | If the project isn't dockerized, run `npm run dev:full` in another shell and `tail -f` its stderr — same idea. |
| Screenshot a dashboard page after a UI change | `.gg/eyes/visual.sh http://localhost:3000/<path> [WxH] [--wait-for-selector <css>]` | Open the printed PNG path; check the affected component rendered correctly. |
| Read emails Odin sent (Mailpit SMTP sink) | `.gg/eyes/mail.sh latest` / `list` / `read <id>` / `clear` | Point the app's SMTP host/port at the values stored under `.gg/eyes/state/` (`mailpit.smtp_*`). Use `clear` before triggering a workflow so `latest` is unambiguous. |

### When to use these eyes (automatically, without being asked)

Reach for probes ON YOUR OWN INITIATIVE when any of these apply:

- **After adding or modifying any route under `src/app/api/`** — hit it with `.gg/eyes/http.sh http://localhost:3000/api/<path>` (with `-H "Cookie: ..."` if auth is required) and confirm the response status and JSON shape match what the handler intends. Do this before declaring the endpoint done.
- **After editing any `.tsx` under `src/components/` or `src/app/dashboard/`** — screenshot the page that renders it: `.gg/eyes/visual.sh http://localhost:3000/dashboard/<route>`. For credential UIs and workflow editors, use `--wait-for-selector` on a stable element (e.g. a form heading) so the capture isn't taken mid-render.
- **After touching `worker.ts`, `src/lib/queue.ts`, `src/lib/scheduler.ts`, or anything under `src/lib/workflows/`** — tail logs with `.gg/eyes/logs.sh` while you trigger the affected job, and confirm no unhandled rejections / Drizzle errors / BullMQ retries appear.
- **Whenever a workflow sends email** (modules under `src/modules/communication/`, anything wiring SMTP, or workflow templates that include email steps) — run `.gg/eyes/mail.sh clear`, trigger the workflow, then `.gg/eyes/mail.sh latest` and confirm subject + body + recipient match the template. The app must be pointed at Mailpit's SMTP port (see `.gg/eyes/state/`) for this to work.
- **After changing `src/lib/schema.ts` or a `drizzle/` migration**, run the app, then probe any read endpoint that touches the affected table with `.gg/eyes/http.sh` to confirm the migration didn't break query shapes.

If a probe fails or returns unexpected results, investigate the artifact directly before assuming the probe itself is broken.

### When NOT to use

- Docs-only changes, comments, formatting.
- Refactors covered by tests — let `npm run test` carry it.
- Dev server / worker / Mailpit isn't up AND the task doesn't require runtime verification.
- Same probe already ran this turn on the same artifact — reuse the output.

### When to escalate a capability gap (the self-improvement loop)

If you're about to **guess**, **skip verification**, or **hand-wave** about something a better probe would show you — STOP and surface the tradeoff inline. Phrasing like:

> "I tried screenshotting but the failure is a JS error I can only see in the browser console — and there's no `browser_console` probe. Two paths: (a) ~3 min to add it, then I can diagnose properly. (b) Workaround: I'd guess from the DOM state. Your call?"

Wait for the user's choice. **Don't escalate more than once per request** — if the user picked the workaround, don't re-ask in the same turn.

For minor friction (worked around it but wished it were better), don't interrupt — log it for later review:
- `ggcoder eyes log rough "<reason>" [--probe <name>]` — minor friction, you handled it
- `ggcoder eyes log wish "<gap>"` — capability you wished existed
- `ggcoder eyes log blocked "<reason>"` — call this AFTER the user approves an inline-escalation fix, for the audit trail

These accumulate quietly. The user reviews them periodically. Open signals will appear in your context on future turns until they're acked.
