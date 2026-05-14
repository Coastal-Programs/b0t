---
name: fix
description: Fix all typecheck, lint, and format issues. Defaults to changed files; pass `all` for whole project.
argument-hint: "[all | changed | <path-prefix>]"
allowed-tools: Read, Write, Edit, Bash, Grep, Glob, subagent
---

# /fix — Iterative, scoped, structured code-quality fixer

Drive `tsc`, `eslint`, and `prettier` to a clean state on the in-scope files. Deterministic autofix first, structured diagnostics next, parallel `bee` subagents for the residue, then verify and iterate (cap 3 rounds). Persist artifacts to `.gg/eyes/out/fix/$TS/` (a per-run, timestamped subdir) for audit.

## Preamble — dynamic context

The agent should inline this block at the top of its run so it starts with ground truth, not assumptions. Use Claude Code's `` !`<cmd>` `` pre-execution pattern:

- `` !`git rev-parse --abbrev-ref HEAD` `` — current branch.
- `` !`git diff --name-only --diff-filter=d` `` — unstaged changed files.
- `` !`git diff --name-only --diff-filter=d --staged` `` — staged changed files.
- `` !`node --version && npx tsc --version && npx eslint --version && npx prettier --version` `` — tool versions for the artifact log.
- `` !`echo "ARGS: $ARGUMENTS"` `` — echo the resolved arguments. `$ARGUMENTS` here is the Claude Code template token (substituted into the markdown before the `` !`…` `` pre-execution shell runs), not a bash env var.

The run timestamp and artifact directory are bound as real bash variables at the top of Stage 1 (`TS`, `ARTIFACTS`) — NOT via the `` !`<cmd>` `` pre-execution pattern. That pattern only interpolates at the call site of the markdown template; it does not bind a variable usable by downstream bash blocks. Every later bash block in this command relies on `$ARTIFACTS` being in scope, so all stages must be executed inside the same shell session (or `TS`/`ARTIFACTS` re-exported at the top of each block).

Create the artifact dir up front (Stage 1 does this — see below).

Source-of-truth references (read live at runtime; do not hard-code):
- Autofix glob → tool mapping: `package.json` `lint-staged` field. Current value: `*.{ts,tsx}` → `eslint --fix` + `prettier --write`; `*.{js,jsx,mjs,cjs,json,yml,yaml}` → `prettier --write`.
- TypeScript exclude list: `tsconfig.json` `exclude` array. Currently excludes `src/modules/social/reddit.ts`, `src/modules/utilities/pdf.ts`, `tests/templates/**/*.ts`, `tests/scripts/check-coverage.ts`, `scripts/test-multi-org-workflows.ts` (plus `node_modules`).
- ESLint ignore list: `eslint.config.mjs` `ignores` array. Currently: `node_modules/**`, `.next/**`, `out/**`, `build/**`, `next-env.d.ts`, `tests/templates/**`.
- Prettier ignore list: `.prettierignore` at the repo root. Gitignore-style patterns, one per line. Currently includes `node_modules`, `.next`, `dist`, `drizzle`, `*.md`, `tsconfig.tsbuildinfo`, `package-lock.json`, `coverage`, `logs`, `build`, `out`, `.gg`, `tests/templates`.

If any of these have drifted, the live read wins. Never hard-code the lists into the fix loop.

---

## Stage 1 — Scope resolution (deterministic)

Parse `$ARGUMENTS` (substituted by Claude Code into the markdown as a literal string before bash runs — it is NOT inherited as a bash environment variable, so `${ARGUMENTS:-...}` does not work). Default mode is `changed`.

```bash
# Bind the run timestamp + artifact dir as real bash variables so every
# downstream block can reference them. Do this BEFORE anything else in
# Stage 1 — subsequent blocks assume $ARTIFACTS is set.
TS=$(date -u +%Y%m%dT%H%M%SZ)
ARTIFACTS=".gg/eyes/out/fix/$TS"
mkdir -p "$ARTIFACTS"

# Capture the git ref at run start. Stage 6c reads this back to scope
# the round-N autofix re-run to files touched since the run began — so
# unused imports / formatting drift introduced by round-1 subagents get
# cleaned deterministically instead of being shipped to round-2 agents.
START_REF=$(git rev-parse HEAD)

MODE="$ARGUMENTS"
if [ -z "$MODE" ]; then MODE="changed"; fi
```

Resolve the file list according to mode:

- **`changed`** (default): union of unstaged + staged changes.
  ```bash
  FILES=$(
    { git diff --name-only --diff-filter=d
      git diff --name-only --diff-filter=d --staged
    } | sort -u
  )
  ```
  If `FILES` is empty, fall back to the last commit: `git diff --name-only --diff-filter=d HEAD~1 HEAD`.
  If that is also empty, write a "nothing to do" report and exit (<5s, no agents spawned).

- **`all`** or **`full`**: every tracked source file in the repo. `git ls-files` respects `.gitignore`; the Stage 1 filter below drops anything excluded by `tsconfig.json` / `eslint.config.mjs`.
  ```bash
  FILES=$(git ls-files -- '*.ts' '*.tsx' '*.js' '*.jsx' '*.mjs' '*.cjs' '*.json' '*.yml' '*.yaml' | sort -u)
  ```

- **`<path-prefix>`** (anything else): treat as a path prefix. `git ls-files -- "<prefix>*" | grep -E '\.(ts|tsx|js|jsx|mjs|cjs|json|yml|yaml)$'`.

Filter `FILES` against the live exclude / ignore lists:

1. Read `tsconfig.json` → `compilerOptions` is irrelevant; read top-level `exclude`. Convert each entry to a regex. Drop any file in `FILES` matching.
2. Read `eslint.config.mjs` → extract the `ignores` array literal. Convert each glob to a regex. Drop any file in `FILES` matching.
3. Read `.prettierignore` if it exists at the repo root. Each non-comment, non-empty line is a gitignore-style pattern. Convert to a regex and drop matching files from `FILES`.
4. Always drop: anything outside the repo, anything under `node_modules/`, `.next/`, `.gg/eyes/out/`, `drizzle/meta/`.

**Database-truth guard.** If `FILES` includes `src/lib/schema.ts` or anything under `drizzle/` other than migration SQL (i.e. any `drizzle/` file that is NOT a numbered `*.sql` migration — config, meta snapshots, journal, generators), STOP execution of this command immediately. Do not run any further bash, do not spawn any subagents. Reply to the user with EXACTLY this message (substituting the real file list):

> ⚠ /fix detected schema/migration files in scope:
> - `src/lib/schema.ts`
> - `drizzle/0042_xxx.sql`
>
> These have CLAUDE.md ownership boundaries. Reply with one of:
> - `proceed` — include them in the fix loop
> - `skip` — remove them from scope and continue with the rest
> - `cancel` — abort the run

Wait for the user's reply before continuing. On `proceed`, keep the files in `FILES` and resume from the persistence step below. On `skip`, remove them from `FILES`, record them under "Skipped (schema/drizzle, user declined)" in the final report, and resume from the persistence step. On `cancel`, exit the command with no further action.

Persist the resolved scope:
```bash
jq -n --arg mode "$MODE" --arg start_ref "$START_REF" --argjson files "$(printf '%s\n' "$FILES" | jq -R . | jq -s .)" \
  '{mode: $mode, start_ref: $start_ref, files: $files, generated_at: now | todate}' \
  > "$ARTIFACTS/scope.json"

# Also persist a NUL-delimited file list for safe xargs piping in later
# stages. Using NUL as the delimiter handles filenames with spaces, and
# the explicit emptiness guards downstream prevent xargs from ever
# invoking a command with zero file arguments (which would cause
# prettier/eslint to walk the entire working tree).
printf '%s' "$FILES" | tr '\n' '\0' > "$ARTIFACTS/files.nul"
```

---

## Stage 2 — Deterministic autofix (no LLM)

Run autofixers per the `lint-staged` mapping. Snapshot the working tree first so we can compute the deterministic delta after autofix runs.

```bash
git diff > "$ARTIFACTS/pre-autofix.diff"
git diff --staged >> "$ARTIFACTS/pre-autofix.diff"

# Partition FILES by lint-staged globs (read live from package.json).
# Build NUL-delimited streams so `xargs -0` is safe against filenames
# with spaces. NEVER pipe an unguarded list to xargs — macOS xargs has
# no --no-run-if-empty, so an empty input runs the command once with
# zero file arguments, and `prettier --write` with no positional args
# would format the entire working tree. We guard with an explicit
# `[ -n ... ]` test instead.
TS_FILES_NUL=$(tr '\0' '\n' < "$ARTIFACTS/files.nul" \
  | grep -E '\.(ts|tsx)$' \
  | tr '\n' '\0')
FMT_NUL=$(tr '\0' '\n' < "$ARTIFACTS/files.nul" \
  | grep -E '\.(js|jsx|mjs|cjs|json|yml|yaml)$' \
  | tr '\n' '\0')

# Order matches package.json `lint-staged` — eslint --fix first (project uses
# eslint-config-prettier, so eslint doesn't fight prettier), then prettier --write
# to normalize final formatting. Running prettier first here would let eslint's
# subsequent rewrites re-introduce formatting drift that Stage 3c would then
# misreport as a "prettier residual" config bug.
if [ -n "$TS_FILES_NUL" ]; then
  printf '%s' "$TS_FILES_NUL" \
    | xargs -0 npx eslint --fix --no-error-on-unmatched-pattern 2>&1 \
    | tee "$ARTIFACTS/eslint-fix.log"
fi

if [ -n "$TS_FILES_NUL$FMT_NUL" ]; then
  printf '%s%s' "$TS_FILES_NUL" "$FMT_NUL" \
    | xargs -0 npx prettier --write --log-level=warn 2>&1 \
    | tee "$ARTIFACTS/prettier.log"
fi
```

Record the deterministic delta:
```bash
git diff --name-only > "$ARTIFACTS/autofix-delta.txt"
git diff > "$ARTIFACTS/autofix.diff"
```

The `autofix-delta.txt` is the list of files autofix actually changed. Anything that *remains* broken after this stage is what the LLM is for.

---

## Stage 3 — Structured diagnostics collection (deterministic)

Collect machine-readable diagnostics from all three tools, then merge into a single JSON file.

### 3a. TypeScript

`tsc` has no JSON formatter. Use `--pretty false` and run the output through the dedicated parser at `tests/fix-command/parser.ts` (`parseTscOutput`). That parser is the single source of truth for tsc-output parsing — do not re-implement the regex inline.

```bash
npx tsc --noEmit --pretty false 2>&1 | tee "$ARTIFACTS/tsc.txt"
ARTIFACTS="$ARTIFACTS" npx tsx -e "
import { readFileSync, writeFileSync } from 'node:fs';
import { parseTscOutput } from './tests/fix-command/parser';
const dir = process.env.ARTIFACTS;
if (!dir) throw new Error('ARTIFACTS env var not set');
const text = readFileSync(\`\${dir}/tsc.txt\`, 'utf8');
writeFileSync(
  \`\${dir}/tsc.json\`,
  JSON.stringify(parseTscOutput(text), null, 2),
);
"
```

Each diagnostic record has the shape:
```json
{
  "source": "tsc",
  "file": "src/lib/queue.ts",
  "line": 42,
  "column": 7,
  "severity": "error",
  "rule": "TS2322",
  "message": "Type 'string' is not assignable to type 'number'."
}
```

Filter to in-scope files (intersect with the resolved `FILES` from Stage 1). `tsc` is whole-project by nature; filtering happens post-hoc.

**Preserve global diagnostics.** Records with `file: null` (e.g. `TS18003`, `TS5023` — tsconfig misconfigurations, missing inputs) are NOT subject to the scope intersection. They have no file to compare against and must be carried through to Stage 4 verbatim. Dropping them here is how project-level tsc errors became invisible to /fix in the past.

The parser handles four shapes the inline regex used to miss — all of them pinned by fixtures in `tests/fix-command/tsc-output-fixtures/` and exercised by `tests/fix-command/parser.test.ts`:

1. **Multi-line continuations with arbitrary indent depth.** tsc emits 2-, 4-, and 6+-space-indented continuation lines for nested incompatibility chains (`Type 'A' is not assignable to type 'B'.` → `  The types of 'foo.bar.baz' are incompatible...` → `    Type 'number' is not assignable to type 'string'.`). The parser attaches any line starting with whitespace to the prior diagnostic — not just lines at a fixed depth.
2. **Global diagnostics with no file location** — e.g. `error TS18003: No inputs were found in config file '...'` or `error TS5023: Unknown compiler option '...'`. These have no `file(line,col):` prefix; the parser emits them with `file: null, line: null, column: null` instead of silently dropping them.
3. **`~~~~~` underline lines and ANSI colour are absent under `--pretty false`** (verified against `typescript@5`). No filtering needed; the parser would ignore them anyway as unmatched lines.
4. **Windows-style drive-letter paths** (`C:\foo\bar.ts(1,1):`). The path capture is anchored on the trailing `(\d+,\d+):` rather than a non-greedy `.+?`, so the drive-letter colon does not truncate the path.

If you ever need to extend the parser, add a new fixture under `tests/fix-command/tsc-output-fixtures/`, extend `parser.test.ts`, and only then touch `parser.ts`. Never edit the regex without a fixture pinning the new behaviour.

### 3b. ESLint

```bash
if [ -n "$TS_FILES_NUL" ]; then
  printf '%s' "$TS_FILES_NUL" \
    | xargs -0 npx eslint \
      --format=json \
      --output-file "$ARTIFACTS/eslint.json" \
      --no-error-on-unmatched-pattern \
      2>"$ARTIFACTS/eslint.stderr" || true
else
  echo '[]' > "$ARTIFACTS/eslint.json"
fi
```

ESLint's JSON shape is `[{filePath, messages: [{line, column, severity, message, ruleId, fix?}], errorCount, warningCount}]`. Filter out entries with `messages: []` — zero-message files are noise.

Normalize each message to the diagnostic record shape:
```json
{
  "source": "eslint",
  "file": "<filePath relative to repo>",
  "line": 12,
  "column": 5,
  "severity": "error|warning",
  "rule": "@typescript-eslint/no-unused-vars",
  "message": "...",
  "fixable": true|false
}
```

### 3c. Prettier

```bash
if [ -n "$TS_FILES_NUL$FMT_NUL" ]; then
  printf '%s%s' "$TS_FILES_NUL" "$FMT_NUL" \
    | xargs -0 npx prettier --check 2>&1 \
    | tee "$ARTIFACTS/prettier-check.log" || true
else
  : > "$ARTIFACTS/prettier-check.log"
fi
```

If Stage 2 ran cleanly, this should be empty. If anything remains, it's a prettier↔eslint formatting conflict. **Do not auto-loop on this** — surface to the user in the final report as a config issue, not an agent task.

### 3d. Merge

Write the merged diagnostics file:
```json
{
  "scope": { "mode": "changed", "files": ["..."] },
  "autofixDelta": ["src/foo.ts", "..."],
  "tsc": [ { "source": "tsc", ... }, ... ],
  "eslint": [ { "source": "eslint", ... }, ... ],
  "prettierResidual": ["src/bar.ts"],
  "round": 1
}
```

Path: `$ARTIFACTS/diagnostics-round-<N>.json` (use `1` on the first pass).

**Early exit.** If `tsc` is empty, `eslint` is empty, and `prettierResidual` is empty → write the success report and stop. No agents needed.

---

## Stage 4 — Bucket partitioning (deterministic)

Build a `byFile: Map<file, Diagnostic[]>` over the merged JSON (tsc + eslint together — agents fix both kinds for a file in one pass).

### Bucket type A — single-rule sweeps

For each ESLint `rule` that appears in **≥ 5 distinct files** in the current round, peel those files into a dedicated "rule sweep" bucket. The agent owning that bucket sees one rule pattern across many files — it learns it once and applies it.

Examples that typically trigger A: `@typescript-eslint/no-unused-vars`, `@typescript-eslint/no-explicit-any`, `react-hooks/exhaustive-deps`.

### Bucket type B — per-file mixed

Remaining files (those not claimed by a Type-A bucket) get grouped together. Cap each B bucket at:
- **≤ 8 files**, OR
- **≤ 40 total diagnostics**

whichever is hit first. New bucket when either cap is reached. Prefer co-locating files from the same top-level folder (e.g. all `src/app/api/clients/*` in one bucket) when it fits within the caps — same blast radius, easier merge.

### Bucket type G — global (no-file) diagnostics

Any diagnostic with `file: null` (tsc-only — `TS18003`, `TS5023`, and similar project-level errors) goes into a single dedicated **global bucket**. The global bucket is **never assigned to a subagent** — an LLM editing a source file cannot fix a tsconfig misconfiguration, a missing-inputs error, or an unknown compiler option. These surface directly in the final report (Stage 6e) under an `Unresolvable (global)` section so the user can act on them.

If the global bucket is the *only* non-empty bucket in a round, treat the round as "no agent-fixable work" — write the report and stop, do not spawn agents and do not iterate.

### Invariants

1. **No file appears in more than one bucket.** A file's full diagnostic set goes to exactly one agent.
2. **Schema / drizzle files are never in a Type-A bucket.** If they survived the Stage 1 user-confirm, they get their own dedicated Type-B bucket (cap: 1 file) so the agent's blast radius is contained.
3. **Bucket has at least one diagnostic.** No empty buckets.
4. **Global diagnostics never enter a Type-A or Type-B bucket.** They live exclusively in the type-G global bucket and are never spawned to an agent.

Persist the plan:
```json
{
  "round": 1,
  "buckets": [
    {
      "id": "A-no-unused-vars",
      "kind": "rule-sweep",
      "rule": "@typescript-eslint/no-unused-vars",
      "files": ["..."],
      "diagnosticCount": 17
    },
    {
      "id": "B-api-clients",
      "kind": "per-file",
      "files": ["src/app/api/clients/route.ts", "..."],
      "diagnosticCount": 23
    },
    {
      "id": "G-global",
      "kind": "global",
      "files": [],
      "diagnosticCount": 2,
      "agentAssigned": false
    }
  ]
}
```

Path: `$ARTIFACTS/plan-round-<N>.json`.

---

## Stage 5 — Spawn parallel `bee` subagents (one batch)

Issue all `subagent` calls in a **single tool-call batch** so they run concurrently. One call per bucket.

### Task prompt template (per bucket)

```
You are fixing TypeScript / ESLint diagnostics in a scoped bucket.

BUCKET:
  id: <bucket.id>
  kind: <rule-sweep | per-file>
  files (you may ONLY edit these — no others):
    - <file 1>
    - <file 2>
    ...

DIAGNOSTICS (JSON):
  See `$ARTIFACTS/diagnostics-round-<N>.json` (resolve $ARTIFACTS to the absolute path before pasting) — the entries where
  `file` matches one of yours. Inlined here for convenience:
  <paste the filtered subset>

PROJECT CONVENTIONS (from CLAUDE.md, non-negotiable):
  - Zero tolerance for `any`. Use `unknown` + narrowing, branded types, or
    discriminated unions. Never `as any`.
  - Named exports only. No `export default`.
  - Structured logging at I/O boundaries (use `logger` from `@/lib/logger`).
  - No floating promises; always `await` or explicitly return.
  - Strict mode is on (`noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`,
    `noImplicitOverride`). Respect them.
  - Validate external boundaries with Zod.
  - Path alias `@/` → `src/`.

HARD RULES:
  1. Do NOT edit any file outside the bucket's file list.
  2. Do NOT edit `src/lib/schema.ts` or anything under `drizzle/` unless it
     is explicitly in your file list.
  3. If a diagnostic cannot be fixed without changing a public type, exported
     interface, or shared contract, DO NOT GUESS. Leave it and add an entry
     to your report's `escalations` array describing the type change needed.
  4. Do NOT use `// @ts-expect-error`, `// @ts-ignore`, or `// eslint-disable`
     to silence a diagnostic unless the diagnostic itself is a false positive
     AND you justify it in a comment on the same line.
  5. Do NOT broaden types to `any` or `unknown` just to make tsc happy.

VERIFICATION (run before reporting done):
  1. tsc:
     - Run `npx tsc --noEmit --pretty false` with the Bash tool and capture
       the full combined output.
     - For EACH file in your bucket, search the captured output for lines
       that start with that exact file path followed by `(` (e.g. using the
       Grep tool on the captured output, or `grep -F "<file>(" <captured>`).
       Expect zero matching lines per file. Any match = a remaining tsc error
       you must fix or escalate.
  2. eslint:
     - Run `npx eslint --format=json` with the Bash tool, passing each of
       your bucket files as a separate space-separated argument. Capture the
       JSON output.
     - Parse the JSON (it is an array, one entry per file). For each entry
       whose `filePath` matches one of your bucket files, confirm
       `errorCount: 0` AND `warningCount: 0`. Any non-zero count = a
       remaining lint diagnostic you must fix or escalate.
  Do NOT report success until both checks pass for every file in your bucket.

REPORT BACK (concise):
  - filesEdited: [...]
  - diagnosticsFixed: <count>
  - diagnosticsRemaining: [{file, line, rule, reason}]
  - escalations: [{file, line, rule, neededChange}]
```

Spawn all buckets in one batch. Wait for all to return before Stage 6.

---

## Stage 6 — Verify, iterate, report

### 6a. Re-run diagnostics

Repeat Stage 3 (tsc + eslint, scope-aware) → produce `diagnostics-round-<N+1>.json`.

### 6b. Diff against the previous round

For each diagnostic, identity = `(file ?? "<global>", line ?? 0, rule)` (column ignored — autofixes shift columns).

The `?? "<global>"` / `?? 0` fallback is load-bearing: tsc global diagnostics (`file: null, line: null`) would otherwise collide on the tuple `(undefined, undefined, rule)`, so two distinct `TS18003` errors would dedupe to one across rounds. Use the literal string `"<global>"` (with the angle brackets — they can't appear in a real path) so global vs file-located diagnostics never share a key by accident.

- **Fixed**: in round N, not in round N+1 → win.
- **Persisted**: in both → agent failed to fix.
- **Regressed**: not in round N, in round N+1 → agent introduced a new error.

Persisted diagnostics where the responsible bucket's agent reported `escalations` for them get tagged `escalated` (not the agent's fault — needs a human or a wider-scope change).

Write `$ARTIFACTS/round-<N>-diff.json`:
```json
{
  "fixed": N, "persisted": N, "regressed": N, "escalated": N,
  "regressedDetail": [{file, line, rule, message}],
  "persistedDetail": [...]
}
```

### 6c. Iterate or stop

- **Stop if**: round N+1 has zero diagnostics → success.
- **Stop if**: `fixed == 0 && regressed == 0` between two consecutive rounds → no progress, escalate.
- **Stop if**: round counter reached **3** → cap hit.
- **Otherwise**: re-run Stage 2 autofix scoped to files changed since the run started, then regenerate buckets from the new diagnostic set (Stage 4) and spawn again (Stage 5). Round-1 subagents routinely introduce new autofix-eligible drift — unused imports left after a refactor, prettier residue from `Edit`-tool writes that bypass the formatter, missing trailing commas in array literals the agent wrote — and shipping that to round-2 subagents wastes LLM tokens on cosmetic fixes prettier/eslint can do deterministically in <1s. It also surfaces as a false "prettier residual" config-issue escalation in Stage 3c (see task `0b98a16a`).

  Read `START_REF` back from `$ARTIFACTS/scope.json` and intersect the diff against the resolved scope `FILES` so we don't autofix anything that was out of scope to begin with:

  ```bash
  START_REF=$(jq -r '.start_ref' "$ARTIFACTS/scope.json")
  CHANGED_SINCE_START=$(git diff --name-only --diff-filter=d "$START_REF" | sort -u)

  # Intersect with the original in-scope file list (NUL-delimited from Stage 1).
  IN_SCOPE=$(tr '\0' '\n' < "$ARTIFACTS/files.nul" | sort -u)
  ROUND_FILES=$(comm -12 <(printf '%s\n' "$CHANGED_SINCE_START") <(printf '%s\n' "$IN_SCOPE"))
  ```

  If `ROUND_FILES` is non-empty, partition it by the lint-staged globs and run the same `eslint --fix` → `prettier --write` sequence as Stage 2, writing logs to `$ARTIFACTS/eslint-fix-round-<N>.log` and `$ARTIFACTS/prettier-round-<N>.log`. If it is empty, skip autofix for this round (genuinely nothing changed on disk that's in scope). Then proceed to Stage 4.

### 6d. Server / worker restart hint

After the loop ends, inspect `git diff --name-only` since the run started. If any of these were touched:
- `worker.ts`
- `src/lib/queue.ts`
- `src/lib/scheduler.ts`
- `src/lib/workflows/**`
- `src/middleware.ts`
- `next.config.*`

…add a hint to the final report:

> Server-side files changed — restart with `npm run dev:full` before testing.

### 6e. Final report

Write `$ARTIFACTS/report.md`:
```markdown
# /fix report — $TS

Scope: <mode> (<N> files)
Rounds: <N>
Tools: tsc <ver>, eslint <ver>, prettier <ver>

## Round-by-round
| Round | Fixed | Persisted | Regressed | Escalated |
|-------|-------|-----------|-----------|-----------|
| 1     | ...   | ...       | ...       | ...       |
| ...   |       |           |           |           |

## Final state
- typecheck: pass | <N> errors
- eslint: pass | <N> errors, <N> warnings
- prettier: clean | <N> files

## Files changed
<output of `git diff --stat`>

## Unresolved (if any)
file:line — ruleId — message

## Unresolvable (global — tsconfig / compiler options)
ruleId — message
(These are tsc diagnostics with no file location, e.g. TS18003, TS5023.
 No subagent was spawned for them — fix the tsconfig directly.)

## Escalations (manual review)
file:line — ruleId — needed change

## Skipped (schema/drizzle, user declined)
- src/lib/schema.ts — listed for manual review
```

### 6f. Inline summary to the user

Match `trace.md`'s reporting discipline — tight, no preamble:

```
/fix complete
Scope: <mode> (<N> files)
Round 1: <fixed>/<total> · Round 2: <fixed>/<total> · Round 3: <fixed>/<total>
Final: <pass | N residual>
Files changed: <N>
Artifacts: $ARTIFACTS/
```

Then, only if residual or regressed:
```
[residual]  src/foo.ts:42 — @typescript-eslint/no-explicit-any — Unexpected any.
[regressed] src/bar.ts:17 — TS2322 — Type 'string' not assignable to 'number'.
```

Then, only if the restart hint applies:
```
⚠ Server-side files changed — restart: npm run dev:full
```

Then, only if schema/drizzle was skipped:
```
⚠ Manual review: src/lib/schema.ts (schema ownership boundary)
```

That's it. No "let me know if…", no recap, no chatter.

---

## Notes for the agent running this command

- **Read `package.json` `lint-staged` live**, not the values pasted above. They're documented for context only.
- **ESLint `--format=json` writes to stdout by default**; use `--output-file` to avoid buffering huge stdout.
- **3-iteration cap is the safety valve, not the target.** If you're hitting it routinely, buckets are too large — measure and tune.
- **Parallel agent file ownership is the load-bearing invariant.** Two agents editing the same file = lost edits. The bucket partitioner enforces this; do not relax it.
- **Mirror `trace.md`'s "do not create vague tasks" principle.** A bucket with a vague file list and no concrete diagnostics is the same failure mode — never spawn an agent without specific `{file, line, rule, message}` records.
