---
description: "Translate, build, test, and import a Make.com .blueprint.json workflow into Odin"
argument-hint: "<path-to-make-blueprint-json>"
---

# /import-make — Import a Make.com Workflow

Translate a Make.com `.blueprint.json` workflow into an Odin workflow, build
it, test it, ask the user which client to assign, then import.

**Usage:** `/import-make path/to/workflow.blueprint.json`

**Argument:** `$ARGUMENTS` (path to the source Make.com blueprint file)

---

## Phase 1 — Translate (deterministic)

```bash
npx tsx scripts/translate-make.ts "$ARGUMENTS"
```

The last line of stdout is JSON:

```
{"yamlPath":"plans/<name>.yaml","warnings":[{...}],"unknownNodes":[...],"steps":N,"trigger":"..."}
```

Parse it. Note `yamlPath`, `warnings`, `unknownNodes`.

Each entry in `warnings` is a `TranslationDiagnostic`:

```ts
{ level: "info" | "warn" | "error", nodeId?: string, nodeName?: string, message: string }
```

For Make.com, `nodeId` is the module's numeric id (stringified) and
`nodeName` is the module identifier (e.g. `builtin:BasicRouter`,
`airtable:ActionSearchRecords`) — Make modules don't have a separate display
name. Filter by `w.level === "error"` to find blockers (e.g. unknown trigger
modules) vs `w.level === "warn"` for review items (routers, missing default
functions).

If the translator failed (non-zero exit), report the stderr and STOP.

---

## Phase 2 — Resolve gaps (LLM, only if needed)

Skip if `warnings` and `unknownNodes` are both empty.

Partition `warnings` by level: `errors = warnings.filter(w => w.level === "error")`
must be resolved before import; `warns = warnings.filter(w => w.level === "warn")`
are review items (routers, missing default functions, etc).

Otherwise:

1. **If you see a `BasicRouter` warning** (`w.nodeName === "builtin:BasicRouter"`) — read
   `.claude/skills-workspace/workflow-translator/patterns/basic-router.md`
   and follow its `AskUserQuestion` exactly. Routers are the most common
   Make.com case that needs intervention.

2. For each `unknownNodes[]` entry, run:
   ```bash
   npm run modules:search -- "<service name>"
   ```
   to find a candidate Odin module. Make.com module names follow
   `<service>:<action>` — the service half is the keyword to search.

3. Read other relevant pattern files (`patterns/*.md`).

4. Edit `yamlPath` in place to replace placeholder steps with real modules.

5. **NEVER substitute services.** Canva → Canva. Cal.com → Cal.com.
   If no Odin module exists for the source service, STOP and ask the user.

---

## Phase 3 — Build & test

```bash
export $(grep -v '^#' .env.local | xargs)
npx tsx scripts/build-workflow-from-plan.ts <yamlPath> --skip-import
```

If the build fails, read the error, fix the YAML, rebuild. Up to 3 attempts.
If still failing, STOP and report.

If the build succeeds, capture the built `<json-path>`. If the user chose
"multiple workflows" in Phase 2 (router resolution), build each YAML file
separately and treat each `<json-path>` independently below.

Optionally test execution — Make.com workflows MORE often need this pass
because `builtin:BasicRouter` warnings and `util:SetVariables` placeholders
should be exercised before import. Only run the test if a trigger sample is
obvious from the parsed Make.com file:

- **Webhook trigger** (`gateway:CustomWebHook`, `gateway:CustomWebHookResponse`):
  the route's `mockTriggerData` defaults (`{ body: { test: 'data' }, headers: {}, query: {} }`)
  are usually enough. Safe to run.
- **Airtable / Gmail / Outlook polling triggers**: skip — these need a real
  record/message id and credentials. Note it and continue.
- **Manual / unknown trigger**: safe to run; the route will use an empty
  `mockTriggerData`.

```bash
export $(grep -v '^#' .env.local | xargs)
jq -Rs '{workflowJson: .}' <json-path> | \
  curl -s -X POST "http://localhost:3123/api/workflows/execute-test" \
    -H "Authorization: Bearer $B0T_API_KEY" \
    -H "Content-Type: application/json" \
    --data-binary @-
```

Body-shape rules (matching the route handler in
`src/app/api/workflows/execute-test/route.ts`):

- Field name is `workflowJson`. The endpoint does NOT accept `workflowJsonPath`.
- `workflowJson` MUST be a JSON **string** (the raw file contents), not an
  inlined object. The handler calls `importWorkflow(workflowJson)`, which runs
  `JSON.parse` on it. Passing an object yields
  `"[object Object]" is not valid JSON`. `jq -Rs` reads the file as a raw
  string and wraps it — do not replace it with `$(cat ...)`.
- Do NOT send `triggerData`. Trigger data is derived from the workflow's
  trigger config server-side (see `executeWorkflow(workflowId, '1',
  triggerType, mockTriggerData)` in the route).
- The `Authorization: Bearer $B0T_API_KEY` header IS required — NextAuth
  middleware (`src/middleware.ts`) gates every `/api/*` route except a small
  allowlist, and API-key auth is the script path. The route handler's own
  `NODE_ENV !== 'production'` check runs AFTER middleware, not instead of it.
  The env var is `B0T_API_KEY` (not `ODIN_API_KEY`); load it from
  `.env.local`.

Expected responses:

- HTTP 200 with `{ "success": true, ... }` — workflow executed.
- HTTP 200 with `{ "success": false, "error": "..." }` — workflow ran but a
  step failed (e.g. missing credentials, router placeholder). Structurally
  valid; note and continue.
- HTTP 400 with `Missing required field: workflowJson` — body shape is
  wrong.
- HTTP 400 with `Invalid workflow format` + `"[object Object]" is not valid
  JSON` — you passed an object instead of a string; use `jq -Rs` as above.
- HTTP 307 to `/auth/signin` — missing/wrong `Authorization` header.

If the test BLOCKS on credentials, that's fine — the workflow is structurally
valid. Note it and continue.

---

## Phase 4 — Import

### 4a. Ask which client

> Which client/organization should this workflow be assigned to?

Wait for the answer.

### 4b. Import

```bash
export $(grep -v '^#' .env.local | xargs)
npx tsx scripts/import-workflow.ts <json-path>
```

For multi-workflow imports (router split), import each one.

### 4c. Report

```
Import complete.

Workflow:  <name>
Client:    <organization>
Trigger:   <type>
Steps:     <count>
YAML:      <yamlPath>
JSON:      <json-path>
```

---

## Phase 5 — Log learnings (only if corrected)

Same shape as `/import-n8n` Phase 5 — append to
`data/workflow-translator/learnings.jsonl` only when the user actively
corrected a mapping. Set `sourcePlatform: "make"`.

```json
{"date":"...","sourcePlatform":"make","sourceType":"canva:exportDesign","wrongMapping":"content.canva.exportDesign","correctMapping":"content.canva.exportToPng","userNote":"User wanted PNG export specifically"}
```

---

## Hard rules

1. **Never substitute services.** Same source = same target service.
2. **Routers always need user input** — never silently flatten or pick the
   first route without confirmation.
3. **Webhook triggers register with the external service** — the user must
   update the source-system webhook URL after import. Tell them.
4. **Stop on failure.** Don't continue if the previous phase didn't succeed.
5. **Append to `learnings.jsonl` only when corrected.**
