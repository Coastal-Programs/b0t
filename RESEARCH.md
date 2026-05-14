# RESEARCH: b0t — Self-Hostable Workflow Automation Platform

Generated: 2026-03-11
Stack: Next.js 16.1.6 + TypeScript 5 + Node.js 20+ + PostgreSQL (pgvector) + Redis (BullMQ)

---

## EXECUTIVE SUMMARY

**Verdict: The current stack is the right stack, with 3 notable risks and 2 opportunities.**

b0t's architecture — Next.js for frontend+API, Drizzle ORM for database, BullMQ for job queues, Vercel AI SDK for LLM integration, pgvector for embeddings — matches production patterns used by latitude-dev/latitude-llm, langwatch/langwatch, midday-ai/midday, lobehub/lobehub, and rybbit-io/rybbit. These are real, funded projects using the exact same technology decisions.

### Risks

1. **next-auth v5 is abandoned** — Auth.js has been absorbed by Better Auth (Sep 2025). You're running `next-auth@5.0.0-beta.29` — a beta that will never reach stable. Better Auth is now the recommended replacement.
2. **125 production dependencies** — Service SDKs (discord.js, telegraf, twilio, etc.) are bloating the bundle and causing `serverExternalPackages` complexity. This is inherent to 140+ integrations but could be lazy-loaded.
3. **Monolithic API routes** — As endpoints grow, Next.js `app/api/` directory becomes unwieldy. Projects like midday-ai/midday and langwatch are moving to Hono inside Next.js for better API organization.

### Opportunities

1. **Hono for API routes** — Can be integrated inside Next.js via `app/api/[[...route]]/route.ts` catch-all. Gives centralized middleware, better error handling, and typed RPC. Midday and Dokploy use this pattern.
2. **Drizzle v1 beta** — v1 brings new Relational Query Builder v2, MSSQL support, and improved migration system. The project should plan for this upgrade path.

---

## STACK VALIDATION

### Framework: Next.js 16 — KEEP ✅

| Alternative | Verdict | Why Not |
|-------------|---------|---------|
| **Hono (standalone)** | ❌ | No SSR/dashboard, would need separate frontend. b0t needs both dashboard UI and API. |
| **Fastify + React SPA** | ❌ | More operational complexity (two deployments). Next.js gives monorepo simplicity. |
| **Remix** | ❌ | Smaller ecosystem, fewer production examples for this type of app. |

**Evidence from GitHub:** simstudioai/sim, CodePilot, inbox-zero, and vercel/chat all use Next.js 16 with the exact same `serverExternalPackages` pattern for native modules. This is the established approach.

**Key finding:** Next.js 16.1.6 is the current latest stable. Turbopack is now the default bundler. The project already uses it correctly.

### ORM: Drizzle — KEEP ✅

| Alternative | Verdict | Why Not |
|-------------|---------|---------|
| **Prisma** | ❌ | Heavier runtime (Rust engine), worse for serverless/edge. Drizzle's SQL-first approach is better for complex queries. |
| **Kysely** | ❌ | No migration tooling, no studio, smaller ecosystem. |

**Evidence:** lobehub/lobehub uses `drizzle-orm/pg-core` with `vector` type for RAG embeddings — identical pattern to b0t. vercel-labs/book-inventory, penxio/penx, and mckaywrigley/buildware-ai all use Drizzle + pgvector for embeddings.

**Current version: 0.45.1** (latest stable). v1 beta available but not recommended for production yet.

### Job Queue: BullMQ — KEEP ✅

| Alternative | Verdict | Why Not |
|-------------|---------|---------|
| **Inngest** | ❌ | External service dependency. b0t is self-hosted. |
| **Temporal** | ❌ | Massive operational overhead. Overkill for workflow step execution. |
| **pg-boss** | ❌ | No Redis, but BullMQ is battle-tested at much higher scale. |

**Evidence:** latitude-dev/latitude-llm uses `Job from 'bullmq'` + `drizzle-orm` across 10+ job processors. rybbit-io/rybbit uses `Queue from "bullmq"` + Drizzle for uptime monitoring. langwatch/langwatch uses BullMQ with separate worker processes. firecrawl uses BullMQ for web scraping queues. This is THE standard pattern.

### Auth: next-auth v5 — ⚠️ RISK, PLAN MIGRATION

| Alternative | Verdict |
|-------------|---------|
| **Better Auth** | ✅ Recommended for new projects. Auth.js team joined Better Auth in Sep 2025. |
| **Clerk/Auth0** | ❌ Managed services conflict with self-hosted requirement. |

**Critical finding:** Auth.js is now officially maintained by the Better Auth team. The authjs.dev docs footer already shows "Auth.js © Better Auth Inc." next-auth v5 was never released as stable and the main contributor (Balázs Orbán) left in January 2025. Better Auth has $5M funding and is the recommended path forward.

**Impact for b0t:** next-auth v5 beta.29 works fine today but will receive only security patches. A migration to Better Auth should be planned but is NOT urgent — it's a separate project, not part of this audit.

### AI SDK: Vercel AI SDK — KEEP ✅

**Evidence:** @ai-sdk/anthropic v3 is used by Arize-ai/phoenix, i-am-bee/beeai-framework, MervinPraison/PraisonAI, and stripe/ai. This is the standard TypeScript AI SDK. The project's versions (`@ai-sdk/anthropic: ^3.0.58`, `@ai-sdk/openai: ^3.0.41`, `ai: ^6.0.116`) are current.

### Rate Limiting: @upstash/ratelimit — KEEP ✅

**Evidence:** e2b-dev/fragments, memfreeme/memfree, face-hh/lyntr, weijunext/nextjs-starter, bountydotnew/bounty.new ALL use `@upstash/ratelimit` with Redis. This is the defacto standard for Next.js rate limiting.

---

## CURRENT DEPENDENCIES AUDIT

### ✅ Correct & Current (updated 2026-03-11)

| Package | Version | Purpose | Status |
|---------|---------|---------|--------|
| `next` | ^16.1.6 | React framework | ✅ Latest |
| `react` | ^19.2.4 | UI library | ✅ Latest |
| `drizzle-orm` | ^0.45.1 | Database ORM | ✅ Latest |
| `drizzle-kit` | ^0.31.9 | Migration tooling | ✅ Latest |
| `bullmq` | ^5.70.4 | Job queue | ✅ Latest |
| `ioredis` | ^5.9.3 | Redis client | ✅ Latest |
| `ai` | ^6.0.116 | Vercel AI SDK | ✅ Latest |
| `@ai-sdk/anthropic` | ^3.0.58 | Claude integration | ✅ Latest |
| `@ai-sdk/openai` | ^3.0.41 | OpenAI integration | ✅ Latest |
| `@ai-sdk/react` | ^3.0.118 | AI SDK React hooks | ✅ Latest |
| `zod` | ^4.3.6 | Schema validation | ✅ Latest (v4) |
| `pino` | ^10.3.0 | Logging | ✅ Latest |
| `tailwindcss` | ^4.2.1 | CSS framework | ✅ Latest |
| `vitest` | ^3.2.4 | Test framework | ✅ Latest |
| `tsx` | ^4.21.0 | TS execution | ✅ Latest |
| `typescript` | ^5.9.3 | Type checker | ✅ Latest |
| `@types/node` | ^25.4.0 | Node.js types | ✅ Latest |
| `@aws-sdk/client-s3` | ^3.1006.0 | AWS S3 | ✅ Latest |
| `@modelcontextprotocol/sdk` | ^1.27.1 | MCP SDK | ✅ Latest |
| `@notionhq/client` | ^5.12.0 | Notion API | ✅ Latest |
| `@slack/web-api` | ^7.14.1 | Slack API | ✅ Latest |
| `@upstash/ratelimit` | ^2.0.8 | Rate limiting | ✅ Latest |
| `@upstash/redis` | ^1.36.4 | Redis client | ✅ Latest |
| `axios` | ^1.13.6 | HTTP client | ✅ Latest |
| `chromadb` | ^3.3.2 | Vector DB client | ✅ Latest |
| `framer-motion` | ^12.35.2 | Animation library | ✅ Latest |
| `prettier` | ^3.8.1 | Code formatter | ✅ Latest (new) |
| `eslint` | ^9.39.4 | Linter | ✅ Latest |

### ⚠️ Risks

| Package | Version | Issue |
|---------|---------|-------|
| `next-auth` | ^5.0.0-beta.29 | Perpetual beta, team joined Better Auth |
| `@anthropic-ai/claude-agent-sdk` | ^0.2.31 | Very early SDK, API may change |

### 📊 Dependency Count Analysis

- **125 production deps** — High, but 40+ are service-specific SDKs (discord.js, telegraf, twilio, stripe, etc.) which is inherent to the 140+ module system
- **28 dev deps** — Normal range
- Key bundling concern: discord.js, mongodb, mysql2, pg all need `serverExternalPackages` treatment

### Breaking Changes Encountered

No breaking changes were encountered during the 2026-03-11 dependency upgrade. All updates were minor/patch semver bumps within existing major versions. Key observations:

- **Zod 4.x** was already in place prior to this upgrade cycle — the v3→v4 migration (new `z.interface()`, removed `.parse()` in favor of `z.safeParse()`) was handled in a prior session.
- **@types/node 24→25** introduced no breaking type changes affecting the codebase.
- **ai 6.0.71→6.0.116** — minor additions only, no API removals.
- **BullMQ 5.61→5.70** — no breaking changes; new features only.
- **Tailwind CSS 4.x** — already migrated in a prior session; this upgrade (4.1→4.2) was seamless.

---

## DEV TOOLING — CURRENT STATE

| Category | Tool | Version | Status |
|----------|------|---------|--------|
| Package Manager | npm | 10+ | ✅ Fine (pnpm would be faster but migration is disruptive) |
| Bundler | Turbopack | Built into Next.js 16 | ✅ Default and stable |
| Linter | ESLint 9 | ^9 | ✅ Latest flat config |
| Formatter | Prettier | ^3.8.1 | ✅ Added — `npm run format` / `npm run format:check` |
| Test Framework | Vitest | ^3.2.4 | ✅ Latest |
| Type Checker | TypeScript | ^5.9.3 | ✅ Latest |
| DB Tooling | Drizzle Kit | ^0.31.9 | ✅ Latest |

**Resolved:** Prettier 3.8.1 added with `eslint-config-prettier` to avoid rule conflicts.

---

## ARCHITECTURE ANALYSIS

### Current Structure — GOOD ✅

```
src/
  ├── app/              # Next.js App Router (pages + API routes)
  │   ├── api/          # ~30 API route files
  │   └── dashboard/    # Dashboard pages
  ├── components/       # React UI components
  ├── hooks/            # Custom React hooks
  ├── lib/              # Core utilities
  │   ├── memory/       # Vector search + knowledge base
  │   └── workflows/    # Workflow engine
  ├── modules/          # 140+ service integrations
  └── types/            # TypeScript types
scripts/                # CLI tools
worker.ts               # BullMQ background worker (separate process)
drizzle/                # Database migrations
```

### How Others Do It

**latitude-dev/latitude-llm** (similar scale, BullMQ + Drizzle):
```
packages/
  core/           # Business logic + schema + jobs
  web/            # Next.js frontend
  workers/        # Separate worker process
```

**midday-ai/midday** (Hono + BullMQ + Drizzle):
```
apps/
  dashboard/      # Next.js frontend
  api/            # Hono API server (tRPC)
  worker/         # BullMQ workers (Hono for health checks)
```

**langwatch/langwatch** (BullMQ + Next.js + Hono):
```
langwatch/src/
  server/         # Backend logic
    context/      # Adapters for Hono, tRPC, Next.js, BullMQ
    scenarios/    # BullMQ job definitions
  pages/          # Frontend
```

### Pattern Comparison

| Pattern | b0t | latitude-dev | midday | langwatch |
|---------|------|-------------|--------|-----------|
| API routes | Next.js route handlers | Next.js | Hono + tRPC | Hono + tRPC |
| Worker | Standalone tsx process | Standalone | Standalone Hono app | Standalone |
| DB | Drizzle + pg | Drizzle + pg | Drizzle + pg | Prisma |
| Queue | BullMQ | BullMQ | BullMQ | BullMQ |
| Auth | next-auth v5 | Custom | Better Auth | Custom |
| AI | Vercel AI SDK | Custom | Custom | Custom |

**Key insight:** All comparable projects use the same core stack (Drizzle + BullMQ + PostgreSQL). The main architectural difference is API routing — midday and langwatch use Hono/tRPC for typed APIs, while b0t and latitude-dev use raw Next.js route handlers.

---

## OPPORTUNITY: HONO INSIDE NEXT.JS

Several production projects are adopting Hono as an API layer inside Next.js:

```typescript
// app/api/[[...route]]/route.ts
import { Hono } from 'hono'
import { handle } from 'hono/vercel'

const app = new Hono().basePath('/api')

// All routes in one place, with middleware
app.use('/*', authMiddleware)
app.route('/workflows', workflowRoutes)
app.route('/memory', memoryRoutes)

export const GET = handle(app)
export const POST = handle(app)
export const PUT = handle(app)
export const DELETE = handle(app)
```

**Benefits:** Centralized error handling, middleware chains, typed RPC client, cleaner than 30+ separate `route.ts` files.

**Risk:** Major refactor of all API routes. Not recommended now — flag for future.

---

## WHAT OTHER PROJECTS CONFIRM ABOUT ODIN'S PATTERNS

### ✅ Vector embeddings with pgvector + Drizzle
`lobehub/lobehub`, `penxio/penx`, `vercel-labs/book-inventory`, `mckaywrigley/buildware-ai` all define `vector('embedding', { dimensions: N })` in Drizzle schemas. b0t's 768-dim embeddings with pgvector are the standard pattern.

### ✅ BullMQ with separate worker process
`firecrawl`, `langwatch`, `latitude-dev`, `RedPlanetHQ/core`, `eclaire-labs/eclaire` all run BullMQ workers as separate processes. b0t's `worker.ts` approach is correct.

### ✅ serverExternalPackages for native modules
`simstudioai/sim`, `vercel/chat`, `CodePilot`, `Deodat-Lawson/PDR_AI_v2` all use `serverExternalPackages` for discord.js, sharp, better-sqlite3. b0t's list is comprehensive and correct.

### ✅ @upstash/ratelimit pattern
All rate-limit implementations found follow the same pattern: `new Ratelimit({ redis, limiter: Ratelimit.fixedWindow(...) })`. b0t's usage matches.

### ⚠️ Auth pattern is diverging
No new projects found using `next-auth@5.0.0-beta`. The ecosystem has moved to Better Auth or custom auth. Existing next-auth users are either staying on v4 or migrating.

---

## RECOMMENDATIONS

### Do Now (This Session)
1. Nothing — the current stack is validated and correct

### Plan Next
1. ~~**Add Prettier**~~ — ✅ Done (2026-03-11). Prettier 3.8.1 + eslint-config-prettier added.
2. **Monitor Better Auth** — Plan migration when b0t's auth needs change
3. **Lazy-load service SDKs** — Dynamic `import()` for discord.js, telegraf, etc. to reduce initial bundle

### Future Architecture
1. **Hono API layer** — When API routes exceed ~50 files
2. **Drizzle v1** — When it exits beta (currently v1.0.0-beta.2)
3. **Better Auth migration** — When adding new auth features (MFA, org management, etc.)

---

## SOURCES

### GitHub Repositories Analyzed
- `latitude-dev/latitude-llm` — BullMQ + Drizzle job processing patterns
- `rybbit-io/rybbit` — BullMQ + Drizzle queue + monitoring
- `midday-ai/midday` — Hono + BullMQ + Drizzle architecture
- `langwatch/langwatch` — Hono + BullMQ context adapters
- `lobehub/lobehub` — Drizzle + pgvector RAG schema
- `simstudioai/sim` — Next.js serverExternalPackages patterns
- `vercel/chat` — Next.js + discord.js external packages
- `firecrawl/firecrawl` — BullMQ worker patterns at scale
- `eclaire-labs/eclaire` — Hono + BullMQ separate worker
- `e2b-dev/fragments` — @upstash/ratelimit patterns
- `penxio/penx` — Drizzle + pgvector embeddings
- `mckaywrigley/buildware-ai` — Drizzle + pgvector code embeddings
- `mastra-ai/mastra` — AI SDK integration patterns
- `Arize-ai/phoenix` — @ai-sdk/anthropic v3 usage

### Documentation & Articles
- https://nextjs.org/blog/next-16 — Next.js 16 release notes
- https://nextjs.org/blog/next-16-1 — Next.js 16.1 stable
- https://orm.drizzle.team/docs/latest-releases — Drizzle release notes
- https://github.com/nextauthjs/next-auth/discussions/13252 — Auth.js joins Better Auth
- https://hono.dev/docs/getting-started/nextjs — Hono + Next.js integration
- https://www.npmjs.com/package/drizzle-orm — Drizzle npm (v0.45.1 latest stable)
