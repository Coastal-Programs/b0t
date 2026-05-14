---
name: update
description: Update dependencies, fix deprecations, address known major-version migrations for this repo
---

This project is npm + Next.js 15 + React 19 + AI SDK v6 + Drizzle + BullMQ + 140+ third-party integrations. It already overrides `esbuild`, `lodash-es`, `undici`, `glob` in `package.json` to deal with transitive vulns, and the dev script sets `NODE_OPTIONS='--no-deprecation'` — meaning runtime warnings are being silenced. Treat the audit + raw `npm install` output as the source of truth, not the dev console.

Before doing anything destructive, make a snapshot:

```bash
cp package.json package.json.bak
cp package-lock.json package-lock.json.bak
git status
```

If `git status` shows uncommitted work, stop and ask the user before continuing.

## Step 1: Baseline — what's outdated and what's vulnerable?

```bash
npm outdated || true
npm audit --json > .gg/eyes/out/audit-before.json
npm audit
```

Read both. The patterns to look for in this repo specifically:

- **Transitive vulns** in `bullmq → uuid`, `mermaid → uuid`, anything → `vite`, anything → `yaml`, anything → `axios`, `ajv`, `next` itself. These get fixed by `npm audit fix` because the direct deps already moved.
- **Deprecated transitive packages** the bare `npm install` reports (silenced in `npm run dev` by `--no-deprecation`). Recover them with:

  ```bash
  npm install --no-fund --no-audit 2>&1 | grep -iE "deprecat|warn" | sort -u
  ```

  Currently expected sources: `@mailchimp/mailchimp_marketing` → `superagent@3` → `formidable@1`; `twilio` → `scmp`; `cheerio` → `whatwg-encoding`; `@google-analytics/data` → `node-fetch` → `node-domexception`; old `glob`. Most are fixed by upgrading the direct dep or adding to `overrides`.

## Step 2: Safe updates first (within current semver)

```bash
npm update
npm audit fix
```

Then re-run the audit. If anything moderate/high remains, it's because:

- The fix requires a major bump (handled in Step 3).
- A nested dep needs an `overrides` entry in `package.json`. Pattern:

  ```json
  "overrides": {
    "esbuild": "^0.25.10",
    "lodash-es": "4.17.21",
    "undici": "^6.23.0",
    "glob": "^11.0.0"
  }
  ```

  Add the minimum-fixed version listed in the GHSA advisory. Do NOT widen ranges blindly — overrides bypass peer-dep checks.

## Step 3: Known major bumps for THIS repo

Each is a separate decision. Do them one at a time, run `npm run typecheck && npm run lint && npm run test:run && npm run build` after each, and commit between them. Do NOT batch them.

### 3a. `stripe` 19 → 22 (used in `src/modules/payments/stripe.ts`)
Migration guide: <https://github.com/stripe/stripe-node/wiki/Migration-guide-for-v22>. Our usage is already async/await with `(params, options)` order and no per-request `host`, so the breaking surface is mostly type-only: `Stripe.StripeContext` → `Stripe.StripeContextType`, `Stripe.errors.StripeError` is no longer a type (use `typeof Stripe.errors.StripeError` or `Stripe.ErrorType`). Grep for both:

```bash
grep -rn "Stripe\.StripeContext\b\|Stripe\.errors\.StripeError\b" src/
```

Bump `apiVersion` only if you also update server-side webhook handlers to match.

### 3b. `twilio` 5 → 6 (used in `src/modules/communication/twilio.ts`)
v6 raises min Node from 14 → 20. We're on Node 22, so this is fine. The only other breaker for us is type tightening on Trunk phone-number capabilities (we don't use Trunk). Upgrading also drops the `scmp` deprecation warning.

### 3c. `mongodb` 6 → 7 (used in `src/modules/data/mongodb.ts`)
Min Node 20.19.0 ✔. Breakers that could touch us: `Buffer` APIs replaced with `Uint8Array`, `crypto` with `globalThis.crypto`, cursor `batchSize` default removed, AWS auth URI format changed. Grep:

```bash
grep -n "batchSize\|MONGODB-AWS" src/modules/data/mongodb.ts
```

If neither appears, the upgrade is mechanical.

### 3d. `eslint` 9 → 10 + `eslint-config-next` matching major
Min Node 20.19 ✔. We're already on flat config in `eslint.config.mjs`. ESLint 10 drops legacy `.eslintrc.*` entirely (we don't have one — verify with `find . -name ".eslintrc*" -not -path "./node_modules/*"`). Replace any `context.getFilename() / getCwd() / getSourceCode()` calls in custom rules with `context.filename / cwd / sourceCode`. We don't author custom rules, so this should be a clean bump — but `eslint-config-next` must move to its ESLint-10-compatible major in the same step.

### 3e. `vitest` 3 → 4 (+ `@vitest/ui`)
Breakers: `workspace` → `projects`, `poolOptions` gone (top-level now), `vi.restoreAllMocks()` only restores `spyOn` (not `vi.fn` / automocks), `mock.invocationCallOrder` starts at 1, `basic` reporter removed, coverage `all` removed. Our `vitest.config.ts` is minimal and doesn't use any of these — likely a clean bump. Grep before upgrading:

```bash
grep -rn "restoreAllMocks\|invocationCallOrder\|poolOptions\|reporter.*basic\|coverage.*all\b" tests/ vitest.config.ts
```

### 3f. `lucide-react` 0.x → 1.x (67 import sites in `src/`)
v1 dropped UMD, switched to ESM/CJS only, **removed all brand icons** (Discord, Slack, GitHub, etc.), set `aria-hidden=true` by default, and there's a [known SSR issue](https://github.com/lucide-icons/lucide/issues/4230) where the default `Icon` export errors in Next.js server components in some setups. Audit brand-icon usage first:

```bash
grep -rnoE "from 'lucide-react'\s*\}|<(Discord|Slack|Github|Twitter|Facebook|Linkedin|Instagram|Youtube|Tiktok|Whatsapp)Icon\b" src/
```

If brand icons appear, plan replacements (Simple Icons or local SVGs) BEFORE bumping. Otherwise pin to a known-good 1.x patch (not just `^1`) until the Next 16 SSR interaction is stable.

### 3g. `ai` + `@ai-sdk/*` (already on v6/v3 — patch updates only)
Stay within the v6 line. v7 is in beta. If you need to migrate later, `npx @ai-sdk/codemod v6` runs the v5→v6 transforms (we're already past that), and `npx @ai-sdk/codemod upgrade` runs all of them.

### 3h. Don't bump
- `next-auth` is on `5.0.0-beta.31` — the `latest` tag points to 4.x. Stay on `next` / explicit beta.
- `@types/node` 25.x — fine on Node 22, do NOT jump to 26 unless Node engine bumps.
- `typescript` 5 → 6 — defer; verify `next`, `drizzle-kit`, `eslint-config-next`, and `@typescript-eslint` all support TS 6 first.

## Step 4: Re-audit and patch transitives via `overrides`

```bash
npm audit
```

For each remaining advisory:
1. Open the GHSA link to find the minimum patched version.
2. If a direct dep won't move (unmaintained, e.g. `@mailchimp/mailchimp_marketing` pulls `superagent@3`), add to `overrides` with the patched range. Confirm the override is actually applied with `npm ls <pkg>`.
3. If a vuln has no fix path and the affected code isn't reachable from our use, document the exception in this file.

Re-run `npm install` and confirm both audit count drops and deprecation warnings clear:

```bash
npm install --no-fund --no-audit 2>&1 | grep -iE "deprecat|warn"
npm audit
```

## Step 5: Quality gates (this repo's commands)

```bash
npm run typecheck
npm run lint
npm run format:check
npm run test:run
npm run build
```

Per CLAUDE.md: zero tolerance — no warnings left behind. If `next build` complains about `serverExternalPackages` or `optimizePackageImports` after a Next minor bump, reconcile against `next.config.ts`.

## Step 6: Runtime verification (eyes)

Server/worker code is not hot-reloadable — restart:

```bash
npm run dev:full
```

In another shell, smoke-test the surfaces most likely to break from these upgrades:

```bash
.gg/eyes/logs.sh                                           # tail for unhandled rejections, BullMQ retries, Drizzle errors
.gg/eyes/http.sh http://localhost:3123/api/health          # confirm the app boots
.gg/eyes/visual.sh http://localhost:3123/dashboard         # confirm Radix + lucide-react still render
```

If Stripe / Twilio / MongoDB / Mailchimp modules were touched, trigger a workflow that exercises them and read the logs.

## Step 7: Fresh-install check

```bash
rm -rf node_modules .next tsconfig.tsbuildinfo
npm cache verify
npm install --no-fund --no-audit 2>&1 | tee /tmp/install.log | grep -iE "deprecat|warn"
npm audit --json > .gg/eyes/out/audit-after.json
diff <(jq '.metadata.vulnerabilities' .gg/eyes/out/audit-before.json) \
     <(jq '.metadata.vulnerabilities' .gg/eyes/out/audit-after.json)
npm run build
```

Report: vuln delta (before → after), deprecations cleared, any majors deferred and why.

## Step 8: Commit

One commit per major bump (Step 3 items), one commit for transitive/`overrides` work, one for patch-level `npm update`. Don't squash — leaves a clean revert path if a single dep regresses in prod.
