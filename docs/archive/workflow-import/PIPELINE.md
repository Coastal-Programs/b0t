# Workflow Import Pipeline — Audit & Fix Plan

Full audit of the N8N/Make.com workflow ingestion system, the learning/knowledge base, and the execution layer. Findings and phased fix plan below.

---

## How The Pipeline Works

```
Raw JSON (.json / .blueprint.json)
  → Detect platform (N8N vs Make.com)
  → Query knowledge base for known node mappings
  → Deep extract parameters (AI models, folder IDs, triggers, credentials)
  → Generate Odin YAML via workflow-generator
  → Validate & import to database
  → Store conversion learnings (mappings, embeddings, patterns)
```

**Key files:**
- `src/lib/workflows/import-export.ts` — import/export logic
- `src/lib/workflows/executor.ts` — runtime execution + credential injection
- `src/lib/workflows/workflow-validator.ts` — semantic validation
- `src/lib/workflows/module-registry.ts` — auto-generated module reference
- `src/app/api/memory/workflow-knowledge/` — knowledge base API (mappings, patterns, similar)
- `src/lib/memory/memory-manager.ts` — memory manager (embeddings, node mappings, cache)
- `scripts/seed-workflow-knowledge.ts` — initial knowledge base seed
- `.claude/skills/workflow-import/` — skill docs (translation reference, extraction guide)

---

## Audit Findings

### Layer 1: Seed Data — Wrong Function Names

These mappings in `scripts/seed-workflow-knowledge.ts` point to functions that don't exist. The executor will crash at runtime.

| Seeded `odinModulePath` | Actual Export | Correct Path |
|---|---|---|
| `utilities.http.request` | `httpRequest` | `utilities.http.httpRequest` |
| `communication.slack.sendMessage` | `postMessage` | `communication.slack.postMessage` |
| `data.airtable.searchRecords` | `findRecord` / `selectRecords` | `data.airtable.findRecord` |
| `data.google-sheets.getRange` | `getRows` | `data.google-sheets.getRows` |
| `data.google-sheets.appendRow` | `addRow` | `data.google-sheets.addRow` |
| `data.postgres.*` | file is `postgresql.ts` | `data.postgresql.*` |

**6 two-part paths** (e.g. `data.airtable`, `communication.gmail`) will also crash — the executor requires exactly 3 parts (`category.module.function`). These are used as "reference" mappings with `operationMap` in conversionConfig, but if the import agent uses them as-is, execution fails.

### Layer 2: Translation Reference Docs — Same Bugs + Coverage Gaps

The skill docs (`.claude/skills/workflow-import/translation-reference.md` and `extraction-guide.md`) have the same wrong function names as the seed data.

**Missing N8N node mappings (~15):**
- `n8n-nodes-base.merge` — merge/join branches
- `n8n-nodes-base.set` / `itemLists` — data transformation
- `n8n-nodes-base.splitInBatches` — batch processing
- `n8n-nodes-base.wait` — delay execution
- `n8n-nodes-base.filter` — filter items
- `n8n-nodes-base.noOp` — pass-through (omit from Odin)
- `n8n-nodes-base.respondToWebhook` — webhook response
- `n8n-nodes-base.notion` — Notion CRUD → `data.notion.*`
- `n8n-nodes-base.hubspot` — HubSpot CRM → `business.hubspot.*`
- `n8n-nodes-base.salesforce` — Salesforce CRM → `business.salesforce.*`
- `n8n-nodes-base.discordTrigger` — Discord trigger
- `n8n-nodes-langchain.agent` — AI Agent → `ai.ai-agent.runAgent`
- `n8n-nodes-langchain.chainSummarization` — summarize → `ai.ai-sdk.generateText`
- `n8n-nodes-base.removeDuplicates` — deduplication
- `n8n-nodes-base.xml` / `csv` — format parsing

**Missing Make.com module mappings (~12):**
- `gmail:sendAnEmail` / `gmail:createADraft`
- `airtable:ActionCreateRecord` / `ActionUpdateRecord` / `ActionGetRecord`
- `notion:createADatabaseItem` / `ActionSearchObjects`
- `hubspot:*` / `salesforce:*` / `discord:*` / `telegram:*`
- `google-drive:*` (flagged as non-existent in docs, but module exists)
- `google-sheets:getCell` / `updateCell`
- `http:ActionMakeARequest`
- `builtin:BasicFeeder` / `BasicAggregator` / `TextAggregator`
- `builtin:BasicScheduler` → `trigger: cron`

**Extraction guide gaps:**
- No Outlook parameter extraction guidance (Gmail has detailed docs)
- No AI Agent node extraction (only textClassifier covered)
- Missing N8N expression edge cases (`$input`, `$execution`, `$env`, `$now`, `$binary`)
- Missing Make.com function syntax (`ifempty`, `formatDate`, nested refs)
- Google Drive flagged as "non-existent" but `data.google-drive` module exists

### Layer 3: Module Registry — One Missing Module

- `ai/memory-search` (4 functions: `storeFact`, `searchMemories`, `deleteFact`, `getFactsContext`) is missing from the registry entirely
- Fix: run `npm run generate:registry`
- Minor: async generator functions not flagged as generators in signatures

### Layer 4: Executor Runtime — Silent Credential Failures

**Critical: missing credentials fail silently.** `loadUserCredentials` returns `{}` on failure. Auto-injection silently does nothing when credentials aren't found. Workflows proceed with empty credentials and fail at the API call level with unhelpful auth errors.

**Read-only API key injection bug:** Line ~700 of `executor.ts` injects a template string `"{{credential.youtube_api_key}}"` literally instead of resolving it. The function receives the raw template as the API key.

**Other issues:**
- Gmail/Outlook credential selection does a DB query on every execution (not cached)
- Function signature detection via `func.toString()` is fragile — breaks with minification
- No pre-execution module path validation (only happens at import time through CLI)

### Layer 5: Validation — API Imports Skip ALL Semantic Checks

Two entry points with wildly different validation coverage:

| Check | CLI Build (`workflow:build`) | API Import (`/api/workflows/import`) |
|---|---|---|
| AJV schema validation | Yes | No |
| Module path exists in registry | Yes | No |
| Variable references valid | Yes | No |
| AI/Storage param checks | Yes | No |
| Deep import (dynamic module load) | Yes | No |
| Credential warnings | Yes | No |
| Dry-run | Yes | No |

Workflows imported via the dashboard API bypass all semantic validation. Only structural format is checked (required fields, 3-part module path format, output display).

**AJV schema bug:** `airtable` is missing from the trigger type enum in `workflow-schema.ts`. Airtable-triggered workflows fail schema validation even through the CLI.

**No validation for:**
- Control flow steps (condition/forEach/while — nested steps never validated)
- `when` expressions (evaluated via `new Function()` at runtime, never parsed beforehand)
- Input types/shapes against module function signatures
- Trigger configs for gmail, outlook, webhook, telegram, discord (fall through to `valid: true`)

---

## Fix Plan

### Phase 1: Fix Wrong Mappings (Highest Priority)

Everything downstream depends on correct mappings. Wrong function names = instant runtime crash.

- [ ] Fix all 6 wrong function names in `scripts/seed-workflow-knowledge.ts`
- [ ] Fix 6 two-part paths — add default function or mark as reference-only with clear conversionConfig
- [ ] Fix `data.postgres` → `data.postgresql` module name
- [ ] Update `translation-reference.md` with corrected function names
- [ ] Update `extraction-guide.md` — fix Google Drive "non-existent" claim
- [ ] Re-seed the knowledge base (run seed script against DB)
- [ ] Regenerate module registry: `npm run generate:registry`

### Phase 2: Close the Validation Gap

The API import route is a wide-open door. Any JSON gets through.

- [ ] Wire `validateWorkflowComplete()` into `POST /api/workflows/import` route
- [ ] Add `airtable` to AJV trigger type enum in `workflow-schema.ts`
- [ ] Add trigger-specific validation for gmail, outlook, webhook, telegram, discord
- [ ] Validate control flow nested steps (condition/forEach/while branches)
- [ ] Consider validating `when` expressions at import time (syntax check only)

### Phase 3: Fix Runtime Silent Failures

Silent credential failures are the hardest to debug. Users see unhelpful API errors with no indication the credential was never injected.

- [ ] Log warnings when credential auto-injection finds no credential for a required platform
- [ ] Fix read-only API key template string bug — resolve value directly instead of injecting template
- [ ] Cache Gmail/Outlook credential selections (currently queries DB every execution)
- [ ] Consider pre-execution module path validation (check module exists before dynamic import)
- [ ] Evaluate `func.toString()` signature detection — consider requiring single-options-object pattern

### Phase 4: Expand Coverage

More mappings = fewer unknown nodes during import = better conversion quality.

- [ ] Add ~15 missing N8N node mappings to seed data + translation reference
- [ ] Add ~12 missing Make.com module mappings to seed data + translation reference
- [ ] Add Outlook parameter extraction guidance to extraction guide
- [ ] Add AI Agent node extraction guidance (not just textClassifier)
- [ ] Add N8N expression edge cases to extraction guide
- [ ] Add Make.com function syntax to extraction guide
- [ ] Add missing trigger mappings (Discord trigger, Make BasicScheduler)

### Phase 5: Learning Loop Hardening

The knowledge base learns from imports, but has some reliability issues.

- [ ] Fix confidence score race condition in store endpoint (double-increment when same mapping in both `nodeMappings` and `usageUpdates`)
- [ ] Evaluate production guard on knowledge endpoints — if learning should work in prod, remove the 403
- [ ] Fix `newMappings` counter that counts upserts as new
- [ ] Add low-confidence mapping detection — warn import agent when using a mapping with score < 0.5

---

## Wave 2 Audit Findings (Deeper Angles)

### Layer 6: Build Script & Auto-Fix — Destructive Corrections

The auto-fix script (`scripts/auto-fix-workflow-plan.ts`) runs in-place before validation — no backup created.

**Critical bugs:**
- **`outputAs` vs `id` gap:** Steps without explicit `outputAs` lose their output entirely. The executor only stores results via `outputAs`, not `id`. Plan authors likely expect `id` to double as the variable name — it doesn't. This is arguably the biggest correctness bug in the build pipeline.
- **Auto-fix silently removes unrecognized parameters.** Any parameter not in `expectedParams` gets deleted. Valid wrapper/options params get dropped.
- **Auto-fix injects wrong credential format.** Injects `{{credential.openai_api_key}}` but the executor stores credentials under `openai`, not `openai_api_key`.

**Medium bugs:**
- `deepMerge` alias maps to a rest-param function that won't work in workflows (rest params not supported)
- Cron regex is too restrictive — rejects `*/5`, `0,15,30`, ranges, and other valid cron patterns
- Fuzzy matching (Levenshtein <= 2) can silently rename params incorrectly (e.g. `arr` → `str`)
- MODULE_ALIASES duplicated between `build-workflow-from-plan.ts` and `auto-fix-workflow-plan.ts` — maintenance risk

### Layer 7: Variable Resolution & Security — Code Injection

**CRITICAL security vulnerabilities:**

1. **`evaluateCondition` uses `new Function()` with improper string escaping** (`control-flow.ts:73-84`). String values are interpolated with simple double quotes — no escaping. A value containing `"` breaks out and executes arbitrary server-side code. Example: trigger data with `foo"; process.exit(1); "` would run `process.exit(1)`.

2. **`executeAsync` runs user code in a Worker with full Node.js access** (`utilities/javascript.ts:360-385`). No sandbox — `require`, `fs`, `child_process` all available. All workflow credentials dumped into global scope via `Object.assign(global, context)`.

3. **`vm.Script` sandbox is escapable** via `this.constructor.constructor('return process')()` — well-known Node.js vm escape.

**Other variable resolution issues:**
- Skipped steps (via `when`) set `outputAs` to `null` — no way to distinguish "skipped" from "returned null"
- ForEach loop variables (`itemAs`, `indexAs`) leak into outer context after loop
- `{{}}` (empty path) resolves to the entire variables object including all credentials
- Validator doesn't know about top-level credential variables (false positive "undeclared variable" warnings)

### Layer 8: Credential Analysis & OAuth Scope Mismatches

**Critical mismatches between analyzer, executor, and OAuth scopes:**

| Issue | Impact |
|---|---|
| Outlook token refresh hardcodes `Mail.Send` scope | Teams/OneDrive tokens lose permissions on refresh |
| Instagram token refresh is broken | URL params never passed correctly |
| `microsoft-teams` module uses hyphens, executor checks underscores | Auto-injection never fires for Teams |
| `onedrive` classified as `api_key` but needs Microsoft OAuth | Analyzer tells UI wrong credential type |
| `calendar` module has no auto-injection in executor | Calendar workflows get no credentials injected |
| Slack OAuth scopes too narrow | `getChannelHistory`, `addReaction` fail at runtime |
| Slack has no token refresh config | Expired Slack tokens can't be refreshed |
| Discord OAuth scopes (`identify email guilds`) don't match module needs (`bot` scope) | Discord module functions fail |
| ~40 modules have no `PLATFORM_CAPABILITIES` entry | Default to `api_key` even if they're OAuth-only |

### Layer 9: Caching — Double Cache with Zero Invalidation

**8 caching layers found. The credential cache is critically broken:**

1. **Redis credential cache (5 min TTL)** — never invalidated on credential CRUD operations. `invalidateUserCredentialCache()` exists but has **zero callers** anywhere in the codebase. Dead code.
2. **In-memory credential cache (`globalThis._credentialCache`)** — sits behind the Redis cache, also never invalidated, unbounded growth (memory leak in long-running worker).
3. After a user updates a credential or re-authenticates via OAuth, **stale credentials are served for up to 5 minutes** from either cache layer.
4. No distributed coordination for OAuth token refresh — two workers can race, and providers with single-use refresh tokens (GoHighLevel) can have the second refresh invalidate the first's new token.

**Other caches (mostly fine):**
- MemoryCache (knowledge base) — properly invalidated on write, but unbounded growth
- SettingsCache — self-cleaning every 10 min
- OAuth refresh failure cache — process-local, doesn't prevent cross-worker stampedes

### Layer 10: Error Handling & Observability Gaps

**Swallowed errors:**
- Fire-and-forget notification calls use `.catch(() => {})` — zero logging on failure
- Credential loading returns `null` on failure — workflow continues with missing creds, fails later with confusing error
- Knowledge store endpoint returns 201 even when individual mappings fail

**Missing error context:**
- Outer catch in `executor.ts` and `executor-stream.ts` doesn't update `workflowsTable.lastRunStatus` — dashboard shows stale status from previous run
- Queue direct-execution fallback discards `result.success === false` — caller never knows workflow failed
- Import route returns generic "Failed to import workflow" — actual error only logged server-side

**Missing failure handling:**
- No permanent-failure flagging when BullMQ exhausts retries — workflow stays `active`, gets triggered again, fails again, indefinitely
- No circuit breaker on email polling triggers — failing Gmail/Outlook polls spam every 60s forever
- Parallel execution reports only the first failure — other failures silently lost
- Workflow timeout doesn't cancel running steps — a 5min timeout can run much longer if a step hangs

### Layer 11: Database — Schema Drift & Missing Constraints

- **Broken btree index in migration 0015**: `idx_workflow_embeddings_platform_vector` uses `INCLUDE (embedding)` on a 768-dim vector — exceeds btree's 2704-byte row limit. Will fail on fresh deploys.
- **NOT NULL drift**: Schema.ts declares timestamps as `.notNull()` but migration 0015 creates them as nullable. Direct SQL inserts could violate Drizzle's expectations.
- **Missing FK constraints on notifications**: `notifications` and `notification_preferences` have no foreign key to `users` — orphaned records accumulate on user deletion.
- **No `.references()` in schema.ts**: All FKs exist only in raw SQL migrations. `drizzle-kit generate` won't produce FKs for future tables.

---

## Updated Fix Plan

### Phase 1: Fix Wrong Mappings (Highest Priority)

Everything downstream depends on correct mappings. Wrong function names = instant runtime crash.

- [ ] Fix all 6 wrong function names in `scripts/seed-workflow-knowledge.ts`
- [ ] Fix 6 two-part paths — add default function or mark as reference-only with clear conversionConfig
- [ ] Fix `data.postgres` → `data.postgresql` module name
- [ ] Update `translation-reference.md` with corrected function names
- [ ] Update `extraction-guide.md` — fix Google Drive "non-existent" claim
- [ ] Re-seed the knowledge base (run seed script against DB)
- [ ] Regenerate module registry: `npm run generate:registry`

### Phase 2: Security — Code Injection Fixes

Server-side code execution via crafted trigger data or step outputs.

- [ ] Fix `evaluateCondition` string interpolation — use `JSON.stringify()` for ALL value types (control-flow.ts:73)
- [ ] Sandbox `executeAsync` Worker threads — restrict `require`, `fs`, `child_process` access
- [ ] Evaluate replacing `vm.Script` with `vm.createContext` + frozen globals or isolated-vm
- [ ] Prevent `{{}}` empty path from resolving to full variable context

### Phase 3: Close the Validation Gap

The API import route is a wide-open door. Any JSON gets through.

- [ ] Wire `validateWorkflowComplete()` into `POST /api/workflows/import` route
- [ ] Add `airtable` to AJV trigger type enum in `workflow-schema.ts`
- [ ] Add trigger-specific validation for gmail, outlook, webhook, telegram, discord
- [ ] Validate control flow nested steps (condition/forEach/while branches)
- [ ] Fix `outputAs` vs `id` gap — either auto-set `outputAs` from `id` or warn when missing

### Phase 4: Fix Runtime Silent Failures

Silent credential failures are the hardest to debug.

- [ ] Log warnings when credential auto-injection finds no credential for a required platform
- [ ] Fix read-only API key template string bug — resolve value directly instead of injecting template
- [ ] Cache Gmail/Outlook credential selections (currently queries DB every execution)
- [ ] Fix outer catch in executor.ts and executor-stream.ts to update `workflowsTable.lastRunStatus`
- [ ] Fix queue direct-execution fallback to propagate `result.success === false`

### Phase 5: Fix Credential Cache Invalidation

Stale credentials served for up to 5 minutes after updates.

- [ ] Wire `invalidateUserCredentialCache()` into credential CRUD operations (store, update, delete)
- [ ] Wire cache invalidation into OAuth callback routes
- [ ] Extend `invalidateUserCredentialCache()` to also clear `globalThis._credentialCache`
- [ ] Add max-size cap or LRU eviction to in-memory credential cache
- [ ] Add distributed locking for OAuth token refresh (prevent cross-worker stampedes)

### Phase 6: Fix OAuth Scope & Token Refresh Issues

Tokens lose permissions on refresh. Some platforms can't refresh at all.

- [ ] Fix Outlook token refresh — store originally-granted scopes, include them in refresh request
- [ ] Fix Instagram token refresh — URL params not passed correctly
- [ ] Fix `microsoft-teams` hyphen/underscore mismatch in executor auto-injection
- [ ] Fix `onedrive` classification — change from `api_key` to `oauth` in PLATFORM_CAPABILITIES
- [ ] Add `calendar` module to executor auto-injection list
- [ ] Add Slack token refresh config to OAUTH_PROVIDERS
- [ ] Expand Slack OAuth scopes for `channels:history`, `reactions:write`

### Phase 7: Fix Build Script & Auto-Fix Issues

- [ ] Auto-set `outputAs` from `id` when not explicitly provided (build script)
- [ ] Fix auto-fix credential injection format (`openai` not `openai_api_key`)
- [ ] Fix cron regex to accept ranges, lists, and step values
- [ ] Add backup before in-place auto-fix runs
- [ ] Remove `deepMerge` alias or warn about rest-param limitation
- [ ] Deduplicate MODULE_ALIASES between the two scripts

### Phase 8: Expand Coverage

More mappings = fewer unknown nodes during import.

- [ ] Add ~15 missing N8N node mappings to seed data + translation reference
- [ ] Add ~12 missing Make.com module mappings to seed data + translation reference
- [ ] Add Outlook parameter extraction guidance to extraction guide
- [ ] Add AI Agent node extraction guidance (not just textClassifier)
- [ ] Add N8N expression edge cases to extraction guide
- [ ] Add Make.com function syntax to extraction guide
- [ ] Add ~40 missing modules to PLATFORM_CAPABILITIES

### Phase 9: Error Handling & Observability

- [ ] Replace `.catch(() => {})` with `.catch(err => logger.error(...))` on notification calls
- [ ] Add permanent-failure flagging when BullMQ exhausts retries
- [ ] Add circuit breaker / backoff to email polling triggers
- [ ] Report all parallel step failures (not just the first)
- [ ] Clean up DEBUG-prefixed log statements from production code
- [ ] Add error categorization for user-facing messages (auth/config/rate-limit/timeout)

### Phase 10: Database & Learning Loop Hardening

- [ ] Fix broken btree INCLUDE index in migration 0015 (guard or remove for fresh deploys)
- [ ] Add NOT NULL constraints to timestamp columns in memory tables
- [ ] Add FK constraints on notification tables
- [ ] Fix confidence score race condition in store endpoint
- [ ] Evaluate production guard on knowledge endpoints
- [ ] Add `.references()` to schema.ts for Drizzle relational query support

---

## Wave 3 Trace Findings (End-to-End Path Traces)

Six end-to-end traces through the system, following data through every layer.

### Trace 1: Gmail Credentials — OAuth to Module Call

Traced how Gmail OAuth credentials flow from authorization through execution.

**CRITICAL: Gmail module always uses an expired token after ~60 minutes.**
`getGmailCredentialToken()` in `gmail.ts` reads the `access_token` from `userCredentialsTable` — this is the token stored at initial authorization and is **never updated on refresh**. `refreshOAuthToken()` only updates `accountsTable`, not `userCredentialsTable`. Since `getGmailCredentialToken()` always returns a non-null (stale) token, the fallback to the refresh-capable `getValidOAuthToken()` path is **never reached**. Every Gmail API call fails with 401 after the first hour.

**Fix:** Either check `expires_at` in `getGmailCredentialToken` and return `null` if expired, or remove it entirely and always use `getValidOAuthToken(userId, 'google')`.

Other findings:
- **Google callback missing `appSettingsTable` lookup** — if OAuth configured via Settings UI (not env vars), authorize works but token exchange fails
- **`credentialMap['gmail']` contains raw JSON string** (`'{"access_token":"...","refresh_token":"..."}'`) — not a usable token. The platform alias logic doesn't overwrite it because the key already exists
- **Token refresh doesn't invalidate credential cache** — stale tokens served for up to 5 min after refresh

### Trace 2: Workflow Import to Execution — Config Shape Drift

Traced the workflow config shape from import through database to executor.

**Key findings:**
- **Control flow steps (`condition`/`forEach`/`while`) fail import validation.** `importWorkflow()` requires `module` and `inputs` on every step, but control flow steps use `condition`/`then`/`else` instead. These step types can't be imported via the API.
- **`when` and `optional` step fields pass through by accident** — not in AJV schema, not in DB type annotations, but work at runtime because JSON passthrough preserves unknown fields
- **Import route hardcodes `organizationId: null`** — violates CLAUDE.md rule about scoping to a client. API doesn't accept `organizationId` from request body.
- **Module path regex differs** — AJV requires function name starts lowercase (`^[a-z]`), import only checks 3 dot-separated parts. `AI.openai.GenerateText` passes import but fails AJV.

### Trace 3: Gmail Trigger Config — Field Naming Disaster

Traced trigger configuration from YAML plan through to email polling.

**CRITICAL: Trigger variable references in UI docs are all wrong.**
The `gmail-trigger-config.tsx` UI tells users to reference `{{trigger.email.from}}`, `{{trigger.email.subject}}`, `{{trigger.email.id}}`. But the email trigger poller flattens email data directly into trigger root — actual references are `{{trigger.from}}`, `{{trigger.subject}}`, `{{trigger.messageId}}`. Every workflow using the documented references gets `undefined`.

**Other findings:**
- **`pollInterval` config field is completely ignored** — all email workflows share one hardcoded 60s interval regardless of per-workflow config
- **Field naming mismatch:** Build script writes `pollingInterval`, UI reads `pollInterval`, poller reads neither
- **No Gmail/Outlook trigger schema validation** — these trigger types hit the `default` case in `validateTrigger()` and return `{ valid: true }` with no checks

### Trace 4: Knowledge Base Learning Loop — Cache Defeats Learning

Traced the full query → convert → store → re-query cycle.

**CRITICAL: Store endpoint bypasses MemoryManager cache invalidation.**
The store route inserts mappings directly via a DB transaction (`tx.insert(...)`) instead of calling `MemoryManager.storeNodeMapping()`. The cache invalidation in `storeNodeMapping()` is never reached. Freshly stored mappings are invisible for up to 1 hour (the mapping cache TTL). The learning loop appears broken to rapid successive imports.

**Other findings:**
- **Skill template for `nodeMappings` omits `conversionConfig` in its example** — agents following the example literally store empty configs, defeating the purpose of rich conversion hints
- **Patterns endpoint is queried but never written to by the store endpoint** — `storeWorkflowPattern()` exists but is never called by any API route. Always returns empty unless manually seeded.
- **`usageUpdates` for existing mappings also don't invalidate cache** — stale confidence/usage data for up to 1 hour

### Trace 5: Platform Config to OAuth UI — Routing Mismatches

Traced how platform configs drive the scope selection UI and OAuth flows.

**Key findings:**
- **YouTube authorize routes to wrong path** — credential form routes YouTube through `/api/auth/google/authorize` but a separate `/api/auth/youtube/authorize` exists that redirects to `/api/auth/youtube/callback`. The YouTube-specific routes are dead code (never reached from UI). YouTube callback sends `type: 'youtube-auth-success'` but form listens for `'google-auth-success'`.
- **6 OAuth providers have hardcoded scopes that ignore user selections** — Slack, Discord, Airtable, GitHub, HubSpot, GoHighLevel, Salesforce, Notion all hardcode scopes in authorize routes. No `oauth-service-configs.ts` entry, so no checkboxes shown. Users have zero visibility into what permissions they're granting.
- **Microsoft callback stores requested scopes as "granted" scopes** — ignores what Microsoft actually granted. If admin restricts scopes via consent policies, credential metadata is wrong.
- **YouTube callback doesn't create `userCredentialsTable` entry** — only stores in `accountsTable`. Won't appear in standard credential management UI.

### Trace 6: Trigger to Queue to Execution — Workers Potentially Never Start

Traced the full path from trigger firing through queue to execution result.

**CRITICAL: BullMQ workers may never start processing jobs.**
`defaultWorkerOptions` in `queue.ts` sets `autorun: false`. When `workflow-queue.ts` creates workers, it doesn't override this. `startAllWorkers()` (which calls `worker.run()`) is defined but **never called anywhere**. If this is live, all queued jobs sit in Redis forever. The direct-execution fallback (no Redis) still works, which may mask this in development.

**Other findings:**
- **Airtable trigger bypasses queue system entirely** — calls `executeWorkflow()` directly, skipping concurrency control, retry logic, and queue monitoring. Compare: email triggers properly use `queueWorkflowExecution()`.
- **Leader lock renewal can extend another process's lock** — uses `redis.expire(key, ttl)` without checking ownership. Two workers can both believe they're leader simultaneously.
- **No email/airtable trigger reload on workflow create/update** — `workflowScheduler.refresh()` only syncs cron workflows. New Gmail-triggered workflows aren't picked up until worker restart.
- **Airtable trigger poller not stopped on shutdown** — `stop()` calls `emailTriggerPoller.stop()` but not `airtableTriggerPoller.stop()`
- **`processedEmailIds` dedup set is in-memory only** — on worker restart, previously processed emails are re-processed, causing duplicate workflow executions

---

## Wave 4 Deep Dive Findings

### Layer 12: Multi-Tenant Isolation — Auth Gaps

**Unauthenticated endpoints:**
- **Conversations list route** (`/api/workflows/[id]/conversations`) has NO auth check — any user with a workflow ID can list all conversations
- **Agent chat session delete** (`/api/agent-chat/sessions` DELETE) authenticates but doesn't verify session ownership — any authenticated user can delete another user's sessions
- **Agent chat messages fetch** (`/api/agent-chat/sessions/[id]/messages`) authenticates but doesn't verify session ownership — any authenticated user can read another user's chat messages

**Credential isolation gaps:**
- `accountsTable` (OAuth tokens) has NO `organizationId` column — all OAuth tokens for a user are loaded into every workflow regardless of org
- `getCredential(userId, platform)` ignores `organizationId` — returns first matching credential regardless of org
- When `organizationId` is not provided, `loadUserCredentials` loads ALL credentials including org-specific ones (no `isNull()` filter)
- Workflow knowledge base (mappings, patterns, embeddings) is completely global — no user or org scoping

**Org membership not verified:**
- API routes accept `organizationId` from query params but never verify the user is a member of that org (except `/api/dashboard/stats`). Currently mitigated by single-admin model, but opens up if multi-user per org is enabled.

### Layer 13: Frontend-Backend Contract Mismatches

**SSE pipeline drops `errorStep`:**
- Server sends `errorStep` in `workflow_failed` SSE event
- `useWorkflowProgress` hook doesn't capture it (no `errorStep` field in `WorkflowExecutionState`)
- `WorkflowExecutionDialog` creates `ExecutionResult` with `errorStep: null`
- User sees "Failed at step: null" instead of the actual step name

**Server-side SSE `error` events mishandled:**
- Stream route sends `event: error` with the actual error message
- Client's EventSource `error` handler treats it as a connection error, shows "Connection lost" instead of the real message

**Missing UI components:**
- No `airtable-trigger-config.tsx` exists — Airtable trigger falls through to `ManualTriggerConfig`
- `airtable` missing from `WorkflowExecutionDialog` and `TriggerConfigDialog` type unions
- `lastRunError` not selected by `GET /api/workflows` — never shown on workflow cards even though executor writes it to DB

**Outer catch dashboard status bug (confirmed from frontend side):**
- `executor.ts` and `executor-stream.ts` outer catch blocks don't update `workflowsTable` — workflow cards show stale `lastRunStatus` and `runCount` after early failures

### Layer 14: Concurrent Execution Safety

**OAuth token refresh race — can permanently break auth:**
- Two concurrent workflows with same expired token both try to refresh
- For providers with single-use refresh tokens (GoHighLevel, Airtable): second refresh uses already-invalidated refresh token
- Can permanently break auth until user manually re-authenticates
- No distributed lock between "check expired" and "refresh"

**`lastRunStatus` is last-write-wins:**
- Two concurrent runs both update `workflowsTable.lastRunStatus` — last to commit wins
- Run A succeeds, Run B fails → if B commits last, dashboard shows `error` even though A succeeded
- `runCount` uses atomic SQL increment (correct), but status fields don't

**No workflow execution deduplication:**
- Same workflow can be queued N times simultaneously with no guard
- Cron can fire while previous execution of same workflow is still running
- No `jobId`-based deduplication in BullMQ `addJob()` calls

**DB pool exhaustion under load:**
- Worker concurrency: 25, parallel steps per wave: 10
- Worst case: 25 x 10 = 250 concurrent DB queries, pool max = 30
- Queries queue with 30s timeout → workflows timeout rather than fail fast

### Layer 15: Chat/Conversation Workflows — Three Independent Systems

**Three completely separate chat systems with no shared code:**

| System | Trigger | Tables | Uses Workflow Engine? |
|---|---|---|---|
| Workflow Chat | `chat` | `chat_conversations`, `chat_messages` | Agent path: yes. Non-agent: fire-and-forget side effect |
| Chat-Input | `chat-input` | Standard workflow runs | Yes (structured form → trigger data) |
| Agent Chat | Standalone | `agent_chat_sessions`, `agent_chat_messages` | No (direct Claude Code subprocess) |

**Non-agent chat workflow is fundamentally broken:**
- Conversation history filters to `user` role only — strips all assistant messages, so AI has no context of its own previous replies
- Workflow execution happens in `onFinish` callback — result is completely discarded (fire-and-forget)
- AI response is generated by `streamText()` with just a system prompt about the workflow — disconnected from what the workflow actually does
- Uses `process.env` API keys directly instead of user credential system

**Agent vs streaming agent use different tool systems:**
- `ai-agent.ts` uses `agent-tools-library.ts` (curated tool library)
- `ai-agent-stream.ts` uses `ai-tools.ts` (`generateToolsFromModules`)
- Same config produces different tool sets depending on which executor path is used

**Other chat bugs:**
- `/clear` command saves duplicate user message to DB (saved unconditionally at top of handler AND inside the `/clear` branch)

### Layer 16: Rate Limiting & Resource Management

**Public unauthenticated endpoints that trigger expensive operations:**
- `/api/workflows/execute-test` — trigger workflow execution with no login, no rate limit
- `/api/workflows/build-from-plan` — trigger AI generation with no login, no rate limit
- `/api/workflows/import-test` — import workflows with no login, no rate limit

**80 of 85 API routes have no rate limiting.** Only protected: credentials (10 req/10s), register (3 req/60s), workflow run (3 req/60s), webhook (3 req/60s).

**Unprotected expensive routes include:**
- All `/api/agent-chat/*` routes (AI chat = expensive)
- All `/api/memory/*` routes (embedding generation = expensive)
- `/api/workflows/import` (can spam workflow imports)

**Dead code:** `resilience.ts` defines circuit breakers for Twitter, YouTube, OpenAI, Instagram, RapidAPI, WordPress — but **none are imported or used anywhere**.

**Unbounded resource usage:**
- `context.variables` accumulates all step outputs — no size cap. 100 steps x 1MB = 100MB per workflow. 25 concurrent = 2.5GB.
- `forEach` loops have no iteration cap (unlike `while` which caps at 100). Could process unlimited records.
- Embedding input text not truncated — large texts fail at OpenAI API level with no graceful handling.
- In-memory rate limiter fallback (`Map()`) resets on restart, not shared across instances.

**Distributed rate limiting is off by default:**
- Bottleneck rate limiters are per-process singletons
- N worker processes = N times the rate limit capacity
- `ENABLE_DISTRIBUTED_RATE_LIMITING` defaults to false
- Multiple workers can collectively exceed external API rate limits

### Layer 17: Workflow-Generator Skill — 17 Errors in Reference Docs (FIXED)

All 17 errors found and fixed in this session:
- 5 wrong function names (slack.sendMessage→postMessage, google-sheets.appendRow→addRow, docusign.sendDocument→createAndSendEnvelope, reddit.search→searchPosts, elevenlabs.textToSpeech→generateSpeech)
- 3 non-existent functions removed (gmail.getAttachments, outlook.getAttachments, reddit.comment)
- 2 wrong module paths fixed (teams→microsoft-teams, addCategory→addCategories)
- 4 missing `context:` added to JavaScript examples
- tryCatch examples replaced with `optional: true` pattern
- Missing trigger types added to yaml-format enum
- Hardcoded `/Users/kenkai/` paths removed

### Layer 18: Test Suite — Near-Zero Real Coverage

- **Executor has ZERO direct tests** — no test calls `executeWorkflow`, `executeModuleFunction`, or `resolveValue`
- **Variable interpolation tests validate a reimplemented function** — not the real `resolveValue` from executor.ts. Uses `path.split('.')` while real code uses regex with bracket notation support.
- **140+ module tests are all stubs** — only check `expect(module).toBeDefined()`
- **2 credential tests actively failing** — mock doesn't chain `.limit()` but real code does
- **Executor credential loading tests are hollow** — only assert `expect(fn).toBeDefined()`, never call `loadUserCredentials`
- **Control flow test is a stub** — single test, all real tests commented out as TODOs

---

## Updated Fix Plan

### Phase 0: Fix Workflow-Generator Skill References (DONE)

- [x] Fix 5 wrong function names in generator skill references
- [x] Remove 3 non-existent functions from generator skill references
- [x] Fix 2 wrong module paths in generator skill references
- [x] Add missing `context:` to 5 JavaScript examples
- [x] Fix tryCatch examples, trigger enum, hardcoded paths
- [x] Sync all fixes to workspace versions

### Phase 1: Fix Wrong Mappings (Highest Priority)

Everything downstream depends on correct mappings. Wrong function names = instant runtime crash.

- [ ] Fix all 6 wrong function names in `scripts/seed-workflow-knowledge.ts`
- [ ] Fix 6 two-part paths — add default function or mark as reference-only with clear conversionConfig
- [ ] Fix `data.postgres` → `data.postgresql` module name
- [ ] Update `translation-reference.md` with corrected function names
- [ ] Update `extraction-guide.md` — fix Google Drive "non-existent" claim
- [ ] Re-seed the knowledge base (run seed script against DB)
- [ ] Regenerate module registry: `npm run generate:registry`

### Phase 2: Security — Code Injection & Auth Fixes

Server-side code execution via crafted trigger data or step outputs. Unauthenticated endpoints.

- [ ] Fix `evaluateCondition` string interpolation — use `JSON.stringify()` for ALL value types (control-flow.ts:73)
- [ ] Sandbox `executeAsync` Worker threads — restrict `require`, `fs`, `child_process` access
- [ ] Evaluate replacing `vm.Script` with `vm.createContext` + frozen globals or isolated-vm
- [ ] Prevent `{{}}` empty path from resolving to full variable context
- [ ] Add auth to conversations list endpoint
- [ ] Add ownership check to agent chat session delete and messages fetch
- [ ] Add auth + rate limiting to public endpoints: `execute-test`, `build-from-plan`, `import-test`

### Phase 3: Fix Gmail Token Expiry (Workflows Break After 1 Hour)

- [ ] Fix `getGmailCredentialToken()` — check `expires_at` and return `null` if expired, OR remove entirely and always use `getValidOAuthToken(userId, 'google')`
- [ ] Apply same fix to Outlook if similar pattern exists
- [ ] Fix Google callback to include `appSettingsTable` lookup for client credentials
- [ ] Fix `credentialMap['gmail']` containing raw JSON string instead of usable token

### Phase 4: Fix Queue Workers Not Starting

- [ ] Fix `autorun: false` in `defaultWorkerOptions` — either remove it, override in workflow-queue.ts, or call `worker.run()` after creation
- [ ] Fix Airtable trigger to use `queueWorkflowExecution()` instead of direct `executeWorkflow()`
- [ ] Fix leader lock renewal to check ownership before extending TTL
- [ ] Add `airtableTriggerPoller.stop()` to shutdown handler
- [ ] Wire email/airtable trigger reload into `workflowScheduler.refresh()`

### Phase 5: Fix Trigger Variable References

Users following the documented variable names get `undefined`.

- [ ] Fix `gmail-trigger-config.tsx` docs — change `{{trigger.email.from}}` to `{{trigger.from}}`, etc.
- [ ] Standardize the field name: pick either `pollingInterval` or `pollInterval` and use it everywhere
- [ ] Actually read per-workflow `pollInterval` from trigger config instead of hardcoding 60s
- [ ] Add Gmail/Outlook trigger config validation schemas
- [ ] Persist `processedEmailIds` to Redis instead of in-memory Set (prevent dupes on restart)

### Phase 6: Close the Validation Gap

The API import route is a wide-open door. Any JSON gets through.

- [ ] Wire `validateWorkflowComplete()` into `POST /api/workflows/import` route
- [ ] Add `airtable` to AJV trigger type enum in `workflow-schema.ts`
- [ ] Add trigger-specific validation for gmail, outlook, webhook, telegram, discord
- [ ] Validate control flow nested steps (condition/forEach/while branches)
- [ ] Fix `outputAs` vs `id` gap — either auto-set `outputAs` from `id` or warn when missing
- [ ] Accept `organizationId` in import route request body

### Phase 7: Fix Knowledge Base Cache Invalidation

Learning loop is silently broken — freshly stored mappings invisible for up to 1 hour.

- [ ] Fix store endpoint to invalidate MemoryManager cache after transaction commits
- [ ] Export `invalidateMappingCache(platform, identifier)` from MemoryManager
- [ ] Add `conversionConfig` example to the skill template `nodeMappings` section
- [ ] Wire `storeWorkflowPattern()` into the store endpoint (or remove patterns query from skill)

### Phase 8: Fix Credential Cache & Token Refresh Races

Stale credentials served for up to 5 minutes. Concurrent refresh can permanently break auth.

- [ ] Wire `invalidateUserCredentialCache()` into credential CRUD operations (store, update, delete)
- [ ] Wire cache invalidation into OAuth callback routes
- [ ] Extend `invalidateUserCredentialCache()` to also clear `globalThis._credentialCache`
- [ ] Add max-size cap or LRU eviction to in-memory credential cache
- [ ] Add distributed locking for OAuth token refresh (prevent cross-worker stampedes with single-use refresh tokens)
- [ ] Fix `loadUserCredentials` null-org case — add `isNull(organizationId)` filter when no org provided
- [ ] Add `organizationId` column to `accountsTable` (or create mapping table) for org-scoped OAuth tokens

### Phase 9: Fix OAuth Scope & Token Refresh Issues

Tokens lose permissions on refresh. Some platforms can't refresh at all.

- [ ] Fix Outlook token refresh — store originally-granted scopes, include them in refresh request
- [ ] Fix Instagram token refresh — URL params not passed correctly
- [ ] Fix `microsoft-teams` hyphen/underscore mismatch in executor auto-injection
- [ ] Fix `onedrive` classification — change from `api_key` to `oauth` in PLATFORM_CAPABILITIES
- [ ] Add `calendar` module to executor auto-injection list
- [ ] Add Slack token refresh config to OAUTH_PROVIDERS
- [ ] Expand Slack OAuth scopes for `channels:history`, `reactions:write`
- [ ] Fix Microsoft callback to store actually-granted scopes (not just requested)
- [ ] Fix YouTube routing — either remove dead YouTube routes or wire them into the UI
- [ ] Add informational scope display for hardcoded-scope providers

### Phase 10: Fix Build Script & Auto-Fix Issues

- [ ] Auto-set `outputAs` from `id` when not explicitly provided (build script)
- [ ] Fix auto-fix credential injection format (`openai` not `openai_api_key`)
- [ ] Fix cron regex to accept ranges, lists, and step values
- [ ] Add backup before in-place auto-fix runs
- [ ] Remove `deepMerge` alias or warn about rest-param limitation
- [ ] Deduplicate MODULE_ALIASES between the two scripts

### Phase 11: Expand Coverage

More mappings = fewer unknown nodes during import.

- [ ] Add ~15 missing N8N node mappings to seed data + translation reference
- [ ] Add ~12 missing Make.com module mappings to seed data + translation reference
- [ ] Add Outlook parameter extraction guidance to extraction guide
- [ ] Add AI Agent node extraction guidance (not just textClassifier)
- [ ] Add N8N expression edge cases to extraction guide
- [ ] Add Make.com function syntax to extraction guide
- [ ] Add ~40 missing modules to PLATFORM_CAPABILITIES

### Phase 12: Fix Frontend-Backend Contract Mismatches

- [ ] Capture `errorStep` in `useWorkflowProgress` hook and `WorkflowExecutionState` type
- [ ] Fix SSE `error` event handling — parse `e.data` instead of showing "Connection lost"
- [ ] Create `airtable-trigger-config.tsx` component
- [ ] Add `airtable` to `WorkflowExecutionDialog` and `TriggerConfigDialog` type unions
- [ ] Select `lastRunError` in `GET /api/workflows` response
- [ ] Fix outer catch in executor.ts and executor-stream.ts to update `workflowsTable.lastRunStatus`

### Phase 13: Fix Concurrent Execution Issues

- [ ] Add `jobId`-based deduplication to BullMQ `addJob()` — prevent same workflow running N times
- [ ] Make `lastRunStatus` update use conditional SQL (only overwrite if run is newer)
- [ ] Fix queue direct-execution fallback to propagate `result.success === false`

### Phase 14: Fix Non-Agent Chat Workflow

- [ ] Include assistant messages in conversation history (remove `user`-only filter)
- [ ] Use user credential system for AI keys instead of `process.env`
- [ ] Decide: should non-agent chat workflow execution results be used in the response?
- [ ] Fix `/clear` duplicate message save
- [ ] Unify tool loading between `ai-agent.ts` and `ai-agent-stream.ts`

### Phase 15: Rate Limiting & Resource Management

- [ ] Add rate limiting to `/api/agent-chat/*`, `/api/memory/*`, `/api/workflows/import`
- [ ] Add auth requirement to `execute-test`, `build-from-plan`, `import-test` endpoints (or remove if dev-only)
- [ ] Add size cap to `context.variables` step outputs
- [ ] Add iteration cap to `forEach` loops (like `while` has `maxIterations: 100`)
- [ ] Enable distributed rate limiting by default (or document the risk)
- [ ] Remove dead `resilience.ts` circuit breaker code (or wire it up)
- [ ] Add embedding input text truncation before OpenAI API call

### Phase 16: Error Handling & Observability

- [ ] Replace `.catch(() => {})` with `.catch(err => logger.error(...))` on notification calls
- [ ] Add permanent-failure flagging when BullMQ exhausts retries
- [ ] Add circuit breaker / backoff to email polling triggers
- [ ] Report all parallel step failures (not just the first)
- [ ] Clean up DEBUG-prefixed log statements from production code
- [ ] Add error categorization for user-facing messages (auth/config/rate-limit/timeout)

### Phase 17: Database & Learning Loop Hardening

- [ ] Fix broken btree INCLUDE index in migration 0015 (guard or remove for fresh deploys)
- [ ] Add NOT NULL constraints to timestamp columns in memory tables
- [ ] Add FK constraints on notification tables
- [ ] Evaluate production guard on knowledge endpoints
- [ ] Add `.references()` to schema.ts for Drizzle relational query support

### Phase 18: Test Suite

- [ ] Write real executor tests — call `executeWorkflow`, `executeModuleFunction`, `resolveValue` directly
- [ ] Fix variable interpolation tests to import real `resolveValue` instead of reimplementing
- [ ] Fix 2 failing credential tests (add `.limit()` to mock chain)
- [ ] Write import pipeline tests — `importWorkflow()` with valid and invalid inputs
- [ ] Write credential auto-injection tests — verify correct platform gets injected
- [ ] Flesh out control flow tests (currently stub only)

---

## Architecture Notes

### The Learning Loop

```
Import workflow → Query KB → Convert nodes → Store learnings
                    ↑                              ↓
                    └──── Bayesian confidence ──────┘
```

Each successful import strengthens mappings (confidence → 1.0). Failed imports weaken them (confidence → 0.0). High-usage mappings are more stable (immune to single failures). Formula: `(oldScore * count + successValue) / (count + 1)`.

### Three Knowledge Stores

1. **Node Mappings** (`workflow_node_mappings`) — direct translation: N8N node type → Odin module path + extraction config
2. **Workflow Embeddings** (`workflow_embeddings`) — 768-dim vectors for semantic similarity search ("find similar past conversions")
3. **Patterns** (`workflow_patterns`) — named structural patterns (cascading classifiers, polling+condition+action) with detection criteria and YAML templates

### Two Executor Files (Don't Duplicate Code)

- `executor.ts` — CLI/API/worker execution
- `executor-stream.ts` — dashboard SSE streaming execution
- Stream imports shared functions from executor.ts: `loadUserCredentials`, `executeModuleFunction`, `resolveVariables`, `resolveValue`
