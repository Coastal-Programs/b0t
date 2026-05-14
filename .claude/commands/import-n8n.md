---
description: "Translate, build, test, and import an N8N JSON workflow into Odin"
argument-hint: "<path-to-n8n-json>"
---

# /import-n8n — Import an N8N Workflow

Translate an N8N JSON workflow into an Odin workflow, build it, test it,
ask the user which client to assign, then import.

**Usage:** `/import-n8n path/to/workflow.json`

**Argument:** `$ARGUMENTS` (path to the source N8N JSON file)

---

## Phase 1 — Translate (deterministic)

```bash
npx tsx scripts/translate-n8n.ts "$ARGUMENTS"
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

Filter by `w.level === "error"` to find blockers (e.g. unknown trigger nodes
that MUST be resolved before the workflow can run). `w.level === "warn"`
entries are placeholder/TODO emissions that the resolve phase should review.
`info` entries are non-actionable notes.

If the translator failed (non-zero exit), report the stderr and STOP.

---

## Phase 2 — Resolve gaps (LLM, only if needed)

Skip this phase entirely if `warnings` and `unknownNodes` are both empty.

Start by partitioning `warnings`: `errors = warnings.filter(w => w.level === "error")`
are blockers that must be resolved. `warns = warnings.filter(w => w.level === "warn")`
are review items. Each diagnostic carries `nodeId` / `nodeName` to locate the
originating step in the YAML.

Otherwise:

1. Read the patterns library:
   ```
   .claude/skills-workspace/workflow-translator/README.md
   .claude/skills-workspace/workflow-translator/patterns/<relevant>.md
   ```
   Glob `patterns/*.md` and read only the files relevant to each `w.message`.

2. For each `unknownNodes[]` entry, run:
   ```bash
   npm run modules:search -- "<service name>"
   ```
   to find a candidate Odin module.

3. Edit `yamlPath` in place to replace placeholder steps with real modules.

4. If a structural decision is required (branching, routers, ambiguous
   service mapping), use `AskUserQuestion` per the matching pattern file.

5. **NEVER substitute services.** If the source uses Perplexity, the output
   uses Perplexity. If no Odin module exists, STOP and ask the user — do
   not silently swap to a different provider.

---

## Phase 3 — Build & test

```bash
export $(grep -v '^#' .env.local | xargs)
npx tsx scripts/build-workflow-from-plan.ts <yamlPath> --skip-import
```

If the build fails, read the error, fix the YAML, rebuild. Up to 3 attempts.
If still failing, STOP and report.

If the build succeeds, capture the built `<json-path>`.

Optionally test execution (only if a trigger sample is obvious from the
parsed N8N file — check `pinData` or `webhookId`):

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
  step failed (e.g. missing credentials). Structurally valid; note and
  continue.
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

Ask the user (use `AskUserQuestion` if a list of orgs is available, else
plain text):

> Which client/organization should this workflow be assigned to?

Wait for the answer.

### 4b. Import

```bash
export $(grep -v '^#' .env.local | xargs)
npx tsx scripts/import-workflow.ts <json-path>
```

The import script handles duplicate detection — same workflow name on the
same org will be replaced.

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

Followed by any user corrections made in Phase 2 — these become the
input to Phase 5.

---

## Phase 5 — Log learnings (only if the user corrected something)

If during Phase 2 the user told you the translator's default mapping was
wrong, append one JSON line per correction to:

```
data/workflow-translator/learnings.jsonl
```

Each line is:

```json
{"date":"2026-05-14T...","sourcePlatform":"n8n","sourceType":"n8n-nodes-base.gmail","wrongMapping":"communication.gmail.sendEmail","correctMapping":"communication.gmail.replyToThread","userNote":"User wanted thread reply, not new email"}
```

DO NOT append a learning if the user didn't correct a mapping. This file
is the agent's actual memory — keep the signal-to-noise high.

---

## Hard rules

1. **Never substitute services.** Same source = same target service.
2. **Never silently flatten branches.** Always ask the user.
3. **Polling triggers are never `manual`.** Gmail/Outlook/Airtable watch
   triggers must use their matching trigger type.
4. **Stop on failure.** Don't continue to the next phase if the current
   one didn't succeed.
5. **Append to `learnings.jsonl` only when corrected.** No write-on-success.
