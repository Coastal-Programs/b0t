# `/fix` Command Redesign

## Why the current version is weak

The current `.gg/commands/fix.md` (and `.claude/commands/fix.md`) is functionally a wrapper around two `npm run` calls plus a fan-out to subagents. Concretely, the gaps are:

1. **No structured input to the agents.** It greps human-formatted `tsc` output and pastes log slices. Subagents get noisy text instead of `{file, line, col, rule, message}` JSON. ESLint's `--format=json` and tsc's `--pretty false` are both standard for exactly this — qwen-code's bundled `review` skill does it ([SKILL.md](https://github.com/QwenLM/qwen-code/blob/93c5ce162fa404245953d9486c2f4b9b037b99cf/packages/core/src/skills/bundled/review/SKILL.md)) and so does agentwise's `AutomatedReviewPipeline` (`npx eslint --format json` → `JSON.parse(stdout)` → typed issues).
2. **No scope.** Always whole-project. On this repo (`src/` + `src/modules/` is huge, 140+ integration files) that's slow and produces enormous diff batches that subagents can't reason about. Should support "changed files only" by default and "all" on demand, mirroring qwen-code's diff-driven approach.
3. **No use of free wins.** Doesn't run `eslint --fix` or `prettier --write` first, even though `lint-staged` in this project already proves they're safe and idempotent on this codebase (`package.json` lines 218–226). Sending an LLM at a problem `eslint --fix` already solves is pure cost.
4. **No verification loop.** "Run agents → re-run checks → maybe escalate" is one round. Real fix workflows iterate (cap at N) because fixing a type error often creates lint errors and vice versa.
5. **No use of the project's own infrastructure.** This project has `bee` available as a subagent and has Husky+lint-staged with exactly the right safe-autofix rules. The command should reuse `lint-staged`'s already-defined autofix glob set, not redefine it.
6. **No use of Claude Code's dynamic context injection.** The official slash-commands docs document the `` !`<cmd>` `` pre-execution pattern. Currently the agent is told "run these commands" — better is to inline the output so the agent reads ground truth without a tool call.
7. **No artifact persistence.** Logs go to `/tmp/`, which means a second invocation in the same session can't diff against the first to detect regressions an agent introduced.
8. **Brittle grouping.** "Group by directory cluster" is heuristic — `src/lib/` and `src/modules/` are lumped together. A type error in `src/lib/schema.ts` and one in `src/modules/social/twitter.ts` are unrelated and should be parallel agents, but the current rules give them the same agent.
9. **No handling of the `tests/templates/**` and `tsconfig.json` `exclude` list.** The tsconfig already excludes specific files known to be broken (`src/modules/social/reddit.ts`, `src/modules/utilities/pdf.ts`, etc.). The current command doesn't filter, so any drift will surface as "fix this!" when in fact it's intentionally excluded.

## What "way better" looks like — design principles

Borrowed from the qwen-code `review` SKILL, the Claude Code official skills docs, and the patterns this repo already follows in `.gg/commands/trace.md`:

- **Structured diagnostics over text scraping.** Always invoke tools with machine-readable output and parse JSON. Pass a list of `{file, line, col, severity, source, rule, message}` records to each subagent, never raw logs.
- **Deterministic first, LLM second.** Run `eslint --fix` and `prettier --write` *before* anything that costs tokens. Only LLM the residue.
- **Scope-aware by default.** Default to the changed files (uncommitted + staged), fall through to `HEAD~1..HEAD` when nothing is dirty, and only do a full-project sweep on `/fix all` or `/fix full`. `tsc` is whole-project by nature (filter diagnostics post-hoc), `eslint` is per-file (pass the file list).
- **Conflict-free agent partitioning.** Bucket residual diagnostics by *file*, then group buckets so no two agents share a file. Then within that constraint, group by error similarity (same rule across many files = one agent that learns the pattern once). Borrowed from qwen-code's per-file/per-source bundling.
- **Bounded iteration.** Loop "fix → re-check → identify residual" with a cap of 3 iterations. Stop early on full pass, escalate on no-progress between rounds.
- **Persistent artifacts.** Write JSON diagnostics + diff manifests to `.gg/eyes/out/fix/<timestamp>/` so subsequent runs can diff and so the user can audit what each agent did.
- **One agent type, well-scoped prompts.** Use the project's `bee` subagent (it's the documented worker). Differentiate via the *task prompt*, not by inventing new agent types — that keeps the project's `.gg/agents/` directory clean.
- **Respect existing config.** Read `tsconfig.json` `exclude` and `eslint.config.mjs` ignores. Read `package.json`'s `lint-staged` block as the source of truth for "which autofix runs against which globs".
- **Dynamic context injection in the command itself.** Use Claude Code's `` !`<cmd>` `` pattern at the top of the command to inline `git diff --name-only` and tool versions, so the agent starts already knowing the project state.

## Final design

### Frontmatter
```yaml
---
name: fix
description: Fix all typecheck, lint, and format issues. Defaults to changed files; pass `all` for whole project.
argument-hint: "[all | changed | <path-prefix>]"
allowed-tools: Read, Write, Edit, Bash, Grep, Glob, Task
---
```

### Body — high level

A 6-stage pipeline. Each stage is a numbered section in the command with explicit pass/skip conditions.

1. **Scope resolution** (deterministic)
   - Parse `$ARGUMENTS`. Default = `changed`.
   - For `changed`: union of `git diff --name-only --diff-filter=d` + `git diff --name-only --diff-filter=d --staged`. If empty, fall back to `git diff --name-only --diff-filter=d HEAD~1 HEAD`.
   - For `all`: every `.ts`/`.tsx` file the linter would touch (let eslint resolve via its config).
   - For path prefix: glob under the prefix.
   - Filter by `tsconfig.json` `exclude` and `eslint.config.mjs` `ignores` — read both files and apply the patterns. Never report on excluded files.
   - Inject the resolved file list via `` !`<cmd>` `` in the command preamble so the agent sees it without a tool call.

2. **Run safe autofixers** (deterministic, no LLM)
   - `npx prettier --write <files>` — Prettier is deterministic, this codebase already runs it via `lint-staged` so behavior is proven safe.
   - `npx eslint --fix <files>` — only the rules eslint marks fixable get fixed; rest stay reported.
   - Record what changed: `git diff --name-only` after autofix. This is the "deterministic delta", logged to the artifact dir.

3. **Collect structured diagnostics** (deterministic)
   - **Typecheck**: `npx tsc --noEmit --pretty false 2>&1 | tee .gg/eyes/out/fix/<ts>/tsc.txt`. `tsc` lacks `--format=json` but its text format (`path(line,col): error TS####: msg`) is trivially regex-parseable. Parse into JSON. Filter to in-scope files.
   - **Lint**: `npx eslint --format=json --output-file .gg/eyes/out/fix/<ts>/eslint.json <files>` — single JSON file, already shaped as `[{filePath, messages: [{line, column, severity, message, ruleId, fix?}]}]` (this is the exact format `AutomatedReviewPipeline.ts` parses).
   - **Format**: `npx prettier --check <files>` — if step 2 ran successfully there should be zero output here; if any remains it's a sign of conflict between prettier and an eslint formatting rule and gets reported to the user, not auto-fixed in a loop.
   - Merge into one diagnostics file: `.gg/eyes/out/fix/<ts>/diagnostics.json` with shape `{tsc: TscDiag[], eslint: EslintResult[], scope: {mode, files}, autofixDelta: string[]}`.

4. **Partition diagnostics into agent buckets** (deterministic)
   - Build `byFile: Map<file, Diagnostic[]>` over the merged JSON.
   - Build agent buckets:
     - **Bucket A — single-rule sweeps.** If a single ESLint rule (e.g. `@typescript-eslint/no-unused-vars`) appears in ≥5 files, dedicate one agent to that rule across all those files. The pattern is uniform; one agent learns it once. This is the same pattern qwen-code uses for "consolidate findings by source".
     - **Bucket B — per-file mixed.** Remaining files (each file's diagnostics, regardless of type vs lint) go into per-file groups. Then merge groups so no agent owns more than ~8 files OR ~40 total diagnostics (rough cap — past that the prompt blows up).
   - Hard rule: a file appears in exactly one bucket. No bucket contains a file another bucket touches.
   - Persist the bucket plan to `.gg/eyes/out/fix/<ts>/plan.json` for audit.

5. **Spawn parallel `bee` subagents** (one batch, parallel)
   - One `subagent` call per bucket, all issued in a single tool-call batch so they run concurrently (Claude Code official guidance: "single response with multiple Task tool calls" — already noted in the existing `.claude/commands/fix.md`).
   - Each task prompt contains:
     - The bucket's JSON (file list + diagnostics).
     - The relative paths of `.gg/eyes/out/fix/<ts>/diagnostics.json` and `plan.json` for context if needed.
     - The exact verification command scoped to its files: `npx tsc --noEmit --pretty false` (whole-project, but agent filters output) + `npx eslint --format=json <its-files>`.
     - Project conventions cite from `CLAUDE.md`: zero-tolerance for `any`, structured logging at boundaries, named exports only, etc. (paste the relevant slice, not the whole file).
     - Hard rule: do not edit any file outside the bucket's file list. Do not edit `src/lib/schema.ts` or anything in `drizzle/` unless explicitly in the bucket (these are database-truth files; uncoordinated edits cascade).
     - Hard rule: if a diagnostic is impossible to fix without changing public types or shared interfaces, report back rather than guess.

6. **Verify, iterate, report**
   - After all agents return, re-run step 3 (typecheck + lint, scope-aware).
   - Compare to the previous round's diagnostics by `{file, line, ruleId}` identity:
     - **Fixed**: was present, now absent → win.
     - **Persisted**: was present, still present → agent failed on this one.
     - **Regressed**: was absent, now present → agent introduced a new error (highest priority next round).
   - If anything remains, loop back to step 4 with the residual set. Cap at **3 iterations** total.
   - After loop ends:
     - Write `.gg/eyes/out/fix/<ts>/report.md` with: counts per round, files touched (from `git diff --stat`), unresolved diagnostics, regressions.
     - Print to user (matching the `trace.md` style):
       ```
       /fix complete
       Scope: <mode> (<N> files)
       Round 1: <fixed>/<total> · Round 2: ... · Round 3: ...
       Final: <pass | N residual>
       Files changed: <N>
       Artifacts: .gg/eyes/out/fix/<ts>/
       ```
     - If anything residual: one-line-per-issue listing with `file:line — ruleId — message`, mirroring trace.md's reporting format.

### Specifics this project needs

- **Worker / Next.js process restart.** `CLAUDE.md` says: "If changes affect server/worker (not hot-reloadable): Restart: npm run dev:full". Detect: did any agent touch `worker.ts`, `src/lib/queue.ts`, `src/lib/scheduler.ts`, `src/lib/workflows/**`, or `src/middleware.ts`? If yes, the final report includes a prompt to the user: "Server-side files changed — restart with `npm run dev:full` before testing."
- **DB schema guard.** If a bucket touches `src/lib/schema.ts` or `drizzle/`, surface to the user before spawning (this is the project's own ownership-boundary rule). Default: skip those files in autofix, list them as "needs manual review".
- **Use `lint-staged` config as source of truth for autofix globs.** Read `package.json` `lint-staged` field at runtime and respect its pattern→tool mapping. Today it's `*.{ts,tsx}` → eslint+prettier and `*.{js,jsx,mjs,cjs,json,yml,yaml}` → prettier only. If the user changes that, the command follows.
- **Mirror trace.md's discipline.** Use the exact same severity/report idiom, the same "do not create vague tasks" principle (here: "do not give an agent a vague file list"), and the same final-report shape.

## Risks / known limitations

- `tsc --pretty false` doesn't emit JSON, only line-based text. Parser is regex; need to handle related-info continuation lines (the `  related: …` style) and multi-line messages. Test with this repo's current tsc output before shipping.
- Parallel agents racing on autofix outputs: mitigated because autofix runs in step 2 (single deterministic pass) before agents spawn. Agents only run on the already-autofixed tree.
- 3-iteration cap is arbitrary. If we always burn 3 rounds it means buckets are too big — measure on first real use and tune.
- ESLint's `--format=json` writes one object per file scanned, including files with zero messages. Filter before passing to agents to avoid noise.

## Verification criteria

The new command is "way better than the current one" iff:

1. Running `/fix` with no changes pending exits in <5s and writes a "nothing to do" report.
2. Running `/fix` after introducing one type error in `src/lib/queue.ts` and one unused-import in a component fans out to exactly the right scope, fixes both in one round, and produces a JSON artifact.
3. Running `/fix all` on the repo with the current `exclude`d files in tsconfig does *not* report on `src/modules/social/reddit.ts` or `src/modules/utilities/pdf.ts`.
4. Introducing a deliberate `any` and running `/fix` produces a diagnostic that cites `CLAUDE.md`'s "no `any`" rule in the agent prompt, and the agent attempts a typed fix rather than `as any`.
5. Touching `worker.ts` triggers the "restart dev:full" hint in the final report.

## Steps

1. Read existing `.gg/commands/fix.md`, `.claude/commands/fix.md`, `.claude/commands/check.md`, and `.gg/commands/trace.md` once more in full so the new file's style matches the project's conventions exactly.
2. Read `package.json` `lint-staged` block, `tsconfig.json` `exclude` array, and `eslint.config.mjs` `ignores` array; bake the actual current values into the command body as the source-of-truth references.
3. Draft the frontmatter (`name`, `description`, `argument-hint`, `allowed-tools`) and the dynamic-context `` !`...` `` preamble (git diff, tool versions, scope echo).
4. Write Stage 1 (scope resolution) with the exact `git diff` commands, exclude-filter logic, and fallback rules.
5. Write Stage 2 (deterministic autofix) — `prettier --write` then `eslint --fix`, capturing the post-autofix `git diff --name-only` as the "deterministic delta".
6. Write Stage 3 (structured diagnostics collection) — tsc text parsing rules, `eslint --format=json --output-file`, the merged `diagnostics.json` shape spec.
7. Write Stage 4 (bucket partitioning) — single-rule sweeps first, then per-file mixed with the ~8-file / ~40-diagnostic cap and the no-file-overlap invariant.
8. Write Stage 5 (parallel `bee` subagent spawn) — task-prompt template, hard rules (no edits outside bucket, no schema/drizzle edits without explicit inclusion), citations to `CLAUDE.md` conventions.
9. Write Stage 6 (verify + iterate + report) — the round-diff logic (fixed / persisted / regressed), the 3-iteration cap, the final report format, and the server-restart-hint detection.
10. Add the "Specifics this project needs" callouts: worker/scheduler restart hint, schema/drizzle guard, lint-staged-as-source-of-truth.
11. Write the final `/fix complete` user-facing report block in trace.md's exact reporting style.
12. Save the file to `.gg/commands/fix.md`, overwriting the current weak version. Keep `.claude/commands/fix.md` untouched (it's the older Claude-Code-native version; the new one lives under `.gg/` where this project's gg-coder commands belong).
13. Sanity-check by re-reading the saved file end-to-end against the verification criteria above.
