---
argument-hint: [capability or scope — optional]
description: Trace recently implemented work through every layer of the project. Finds dropped config, missing wiring, drifted duplicates, and shape mismatches — then creates a prioritised task for every gap found.
allowed-tools: Task, Bash, Read, Write, Edit, Grep, Glob
---

# Wiring Trace

Analyse recently implemented work and trace it through every layer of the project. Create one actionable task per gap found. Do not edit any files.

## Step 1: Determine what to trace

If `$ARGUMENTS` is provided, use it as the capability or scope to trace.

If `$ARGUMENTS` is empty, infer what to trace from context — in this order:
1. **Git diff** — run `git diff --name-only HEAD~1 HEAD` and `git status --short` to find recently changed files
2. **Active plan** — check `.gg/plans/` for the most recently modified plan file and read it
3. **Session context** — use what was discussed or implemented in the current conversation

From that, extract:
- The **capability** being traced (e.g. "push notifications", "auth flow", "skin system")
- The **set of files** that are in scope (everything touched by the recent work)

If nothing can be inferred, ask the user what to trace. Do not proceed blind.

## Step 2: Map the architecture

Identify every layer this capability touches:

```
Entry Points → Orchestration → Capability Modules → External (APIs, DB, browser, network)
```

Use Glob and Grep to find all files that reference the capability. Build a map of:
- **Entry points**: API routes, UI event handlers, CLI commands, cron triggers, server actions
- **Orchestration**: middleware, service layers, shared helpers, context providers
- **Modules**: the functions/components that implement the capability
- **External**: API calls, DB queries/schema, browser APIs, third-party SDKs

## Step 3: Trace every path

Starting from each entry point, follow the capability through to where it's consumed. Read each file in the chain. Track:
- What data/config enters at each layer
- What gets passed to the next layer
- What actually arrives at the destination

Follow real imports and function calls. Do not guess at the chain.

## Step 4: Find gaps

At every layer boundary, check for:

1. **Dropped config** — option or flag exists at entry but never reaches the function that needs it
2. **Silent defaults** — value gets replaced with a default mid-pipeline instead of being passed through
3. **Partial wiring** — feature works in path A but not path B (e.g. admin route wired, portal route missing)
4. **Stale wrappers** — adapter or wrapper exposes a subset of the underlying interface and has fallen behind
5. **Missing gates** — decision point where a check or prompt should exist but doesn't
6. **Dead exports** — module exports a function or type that nothing imports
7. **Shape mismatches** — data enters as one shape, gets transformed, arrives at the destination missing fields
8. **Missing env wiring** — feature requires an env var that isn't validated or documented
9. **Schema drift** — DB schema, Zod schema, and TypeScript type describe the same thing differently

For each gap, record:
- **WHERE**: `file:line` at both the source end and the destination end
- **WHAT**: what gets lost or broken between those two points
- **WHY IT MATTERS**: what actually fails or silently degrades as a result

Do NOT track:
- Style issues, naming conventions, code quality
- Theoretical problems that cannot actually be triggered
- Things that work correctly end-to-end

## Step 5: Classify by severity

- **Critical** — feature is broken or data is lost
- **High** — silent degradation, wrong behaviour in a real scenario
- **Medium** — edge case failure, works in the happy path only
- **Low** — latent risk, minor drift, dead code that could mislead

## Step 6: Create tasks

For every gap found, create one task using the Task tool.

Each task must be self-contained — a fix agent in a separate chat should be able to execute it with no additional context. Include in every task:

- Severity label (Critical / High / Medium / Low)
- The capability being fixed
- Exact file paths and line numbers at both ends of the gap
- A plain-english description of what is wrong
- A concrete description of what the fix looks like (not pseudocode — actual field names, function names, import paths from this project)
- Any related files the fix agent should read before editing

Order tasks: Critical first, then High, Medium, Low.

Do not create vague tasks. If a gap is too ambiguous to write a concrete fix for, note it in the summary as **Skipped** with a reason — do not silently drop it.

## Step 7: Report

Reply inline with:

```
Traced: <capability inferred or provided>
Files scanned: <N>
Gaps found: <N> (<N> Critical, <N> High, <N> Medium, <N> Low)
Tasks created: <N>
Skipped: <N> (listed below if any)
```

Then one line per task created:
```
[Critical] file:line — one sentence description
[High]     file:line — one sentence description
...
```

Then any skipped gaps:
```
Skipped: file:line — reason a concrete fix couldn't be written
```

Keep the report tight. The detail lives in the tasks.
