# Security Audit — Pre-Push to GitHub

## Summary

Overall the codebase is in **decent shape** for secrets — no API keys, tokens, or credentials are hardcoded in source code. But there are several issues to fix before pushing, mostly around **untracked directories with personal data** and **personal email addresses in tracked files**.

---

## 🔴 CRITICAL — Must Fix Before Push

### 1. `plans/` directory is NOT gitignored — contains personal/client data
- **28 YAML files** with client-specific workflow plans (Coastal Programs, Spritz & Co, Wise Weddings, etc.)
- Contains real email addresses: `kiaghasem.dev@gmail.com`, `kia@kamexa.ai` in `plans/outreach-prep.yaml`
- **Fix**: Add `/plans/` to `.gitignore`

### 2. `make.com workflows/` directory is NOT gitignored — contains client data
- 4 blueprint JSON files with real Google connection labels showing `info@coastalprograms.com`
- Contains Make.com webhook IDs and connection references
- **Fix**: Add `/make.com workflows/` to `.gitignore`

### 3. Personal email in tracked test script
- `scripts/test-gmail-workflow.ts` lines 30, 39, 49: `jake@coastalprograms.com` and `jake.schepis@gmail.com`
- **Fix**: Replace with generic test emails like `test@example.com`

### 4. `.env.example` has personal email as default
- Line 28: `ADMIN_EMAIL=jake@b0t.dev` — this is your personal email
- **Fix**: Change to `ADMIN_EMAIL=admin@example.com`

### 5. Root-level test files not gitignored
- `test-webhook-plan.yaml`, `test-webhook-workflow.json`, `test-webhook.json` — dev artifacts
- `activitypage.png`, `clientpage.png`, `credentialspage.png`, `workflowpage.png` — ~2.5MB of screenshots (keep only if intentional for README)
- **Fix**: Add test-webhook files to `.gitignore` or delete them

---

## 🟡 MODERATE — Should Fix

### 6. `docs/archive/` contains local filesystem paths
- `docs/archive/workflow-generator-v2-completion/WORKFLOW-GENERATOR-V2-VALIDATION.md` has 7 instances of `/Users/kenkai/Documents/...` paths
- `STATUS.md` line 131: `/Users/kenkai/Documents/odin/.claude/skills/...`
- Not a security risk but leaks dev machine structure
- **Fix**: Scrub local paths or gitignore `docs/archive/`

### 7. `WORKFLOW.md` and `STATUS.md` contain internal dev notes
- References to client names, internal workflow details
- **Fix**: Review whether these should be pushed publicly

### 8. `CONTRIBUTING.md` references `kenkai/b0t` repo
- Lines 11, 78, 126-127: GitHub URLs pointing to `kenkai/b0t`
- **Fix**: Update to your fork's repo URL or make generic

### 9. Large binary files in repo root
- `activitypage.png` (1.1MB), `clientpage.png` (310KB), `credentialspage.png` (397KB), `workflowpage.png` (1.1MB)
- `pictures/` directory with 3 images (~640KB)
- `tsconfig.tsbuildinfo` (5.9MB) — **this should be gitignored**
- **Fix**: Add `tsconfig.tsbuildinfo` to `.gitignore`. Decide if screenshots belong in repo.

---

## ✅ GOOD — No Issues Found

### Secrets & Keys
- ✅ No hardcoded API keys, tokens, or secrets in source code
- ✅ `.env*` files properly gitignored (only `.env.example` tracked)
- ✅ `n8n-workflows/` is gitignored (contains real credential references)
- ✅ `/workflow/` and `/logs/` are gitignored
- ✅ OAuth secrets sourced from env vars/DB, never hardcoded
- ✅ Encryption module requires separate `ENCRYPTION_KEY` in production
- ✅ AWS key in test file (`AKIAIOSFODNN7EXAMPLE`) is the official AWS example key

### Authentication & Authorization
- ✅ All sensitive API routes require `auth()` session check
- ✅ Credential reveal endpoint scoped to user's own credentials + POST-only
- ✅ Admin password requires bcrypt hash (plaintext rejected)
- ✅ Registration requires invitation token
- ✅ Dev-only test endpoints (`execute-test`, `test`) blocked in production via `NODE_ENV` check

### SQL Injection
- ✅ PostgreSQL module uses parameterized queries with `$1, $2...` 
- ✅ Identifier validation with allowlist regex (`/^[a-zA-Z0-9_.]+$/`)
- ✅ MySQL module uses `pool.execute(sql, params)` — parameterized
- ✅ Drizzle ORM queries use `sql` tagged template literals

### XSS
- ✅ Only `innerHTML` usage is for Mermaid SVG rendering (Mermaid's own sanitized output)

### Rate Limiting  
- ✅ Already fixed (IP spoofing + fail-open documentation)

---

## Implementation Plan

### Step 1: Update `.gitignore`
Add these entries:
```
/plans/
/make.com workflows/
tsconfig.tsbuildinfo
test-webhook-plan.yaml
test-webhook-workflow.json
test-webhook.json
/pictures/
```

### Step 2: Scrub personal emails from tracked files
- `scripts/test-gmail-workflow.ts`: Replace `jake@coastalprograms.com` → `user@example.com`, `jake.schepis@gmail.com` → `user@example.com`
- `.env.example`: `ADMIN_EMAIL=jake@b0t.dev` → `ADMIN_EMAIL=admin@example.com`

### Step 3: Remove tracked files that should be ignored
After updating `.gitignore`, run:
```bash
git rm --cached -r plans/
git rm --cached -r "make.com workflows/"
git rm --cached tsconfig.tsbuildinfo
git rm --cached test-webhook-plan.yaml test-webhook-workflow.json test-webhook.json
```

### Step 4: Review docs for personal paths
- Clean `/Users/kenkai/` paths from `docs/archive/` and `STATUS.md`
- Or add `/docs/archive/` to `.gitignore` if it's internal-only

### Step 5: Verify
```bash
git diff --cached --name-only  # Confirm what's being removed
grep -r "jake@\|jakeschepis\|coastalprograms\|kenkai\|kiaghasem\|kamexa" --include='*.ts' --include='*.json' --include='*.yaml' --include='*.md' -- ':!node_modules' ':!n8n-workflows'
```

---

## Risk Assessment

| Issue | Severity | Exploitable? |
|-------|----------|-------------|
| Personal emails in plans/test scripts | 🔴 Privacy | No, but exposes identity |
| make.com workflows with connection IDs | 🟡 Info leak | Low — IDs not directly useful |
| Local filesystem paths in docs | 🟢 Low | No — just info leak |
| Test webhook files in root | 🟢 Low | No secrets, just clutter |
| Large binary files | 🟢 Low | Bloats repo history |
