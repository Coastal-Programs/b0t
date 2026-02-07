---
description: Run all checks and fix issues until clean
---

Run all available quality checks (type checking, linting, builds, tests) and automatically fix all issues until everything passes.

**Step 1: Discover what checks are available**

Examine the project to identify what quality checks exist. Look for:
- Build/task configuration files (package.json, Makefile, build.gradle, Cargo.toml, pyproject.toml, etc.)
- Scripts or commands related to checking code quality
- Common patterns: check, lint, test, build, compile, verify, validate

Identify which commands should be run to validate the codebase.

**Step 2: Run all discovered checks**

Execute each check and capture full output. Record:
- Which checks were run
- Exit codes and status
- All errors, warnings, and failure messages
- File locations and line numbers

**Step 3: Fix all issues in parallel**

For each check that failed, spawn a Task agent to fix it. Each agent receives:
- The check command that failed
- Complete error output
- Instructions to fix ALL issues

All agents run simultaneously. Wait for completion.

**Step 4: Verify everything is fixed**

Re-run all checks from Step 2. For each:
- Success with no issues: Mark as passed
- Any failures remain: Return to Step 3 with remaining issues

Loop until all checks pass completely.

**Step 5: Report final status**

Show results for each check and confirm everything passed.

If unable to reach clean state, explain what's blocking resolution.
