---
description: Audit dependencies and fix all issues
---

Audit dependencies for security vulnerabilities, deprecations, outdated packages, and unused dependencies. Fix everything found.

**Step 1: Identify package manager and audit tools**

Detect what's used:
- JavaScript/Node: npm, yarn, pnpm, bun
- Python: pip, poetry, pipenv
- Rust: cargo
- Go: go mod
- Java: maven, gradle
- Ruby: bundler
- PHP: composer

**Step 2: Run security audit**

Check for known vulnerabilities in dependencies. Run appropriate command for the package manager.

**Step 3: Check for deprecations**

Find deprecated packages or deprecated package versions that need migration.

**Step 4: Check for outdated dependencies**

List all dependencies with available updates. Categorize by severity (major/minor/patch).

**Step 5: Check for unused dependencies**

Identify dependencies listed but not imported/used anywhere in the codebase.

**Step 6: Fix all issues**

For each category with issues:
- Security vulnerabilities: Update to patched versions immediately
- Deprecations: Migrate to recommended alternatives
- Outdated packages: Update to latest compatible versions
- Unused packages: Remove from dependency list

**Step 7: Verify clean state**

Re-run audit. Continue fixing until:
- 0 security vulnerabilities
- 0 deprecation warnings
- All packages up to date (or document why not)
- No unused dependencies

Report final status concisely.
