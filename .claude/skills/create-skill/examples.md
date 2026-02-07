# Skill Examples

Real-world skill examples demonstrating effective patterns.

## Example 1: Code explanation skill

Shows how to structure an educational skill.

```yaml
---
name: explain-code
description: Explains code with visual diagrams and analogies. Use when explaining how code works or teaching about a codebase.
---

# Explain Code

When explaining code, always include:

1. **Start with an analogy**: Compare the code to something from everyday life
2. **Draw a diagram**: Use ASCII art to show flow, structure, or relationships
3. **Walk through the code**: Explain step-by-step what happens
4. **Highlight a gotcha**: What's a common mistake or misconception?

Keep explanations conversational. For complex concepts, use multiple analogies.

## Example explanation

For a rate limiter:

**Analogy**: Like a bouncer at a club who only lets 10 people in per minute.

**Diagram**:
```
Requests → [Rate Limiter] → API
           ↓ Allow (10/min)
           ↓ Block (>10/min)
```

**How it works**:
1. Each request increments a counter
2. Counter resets every minute
3. If counter > 10, request is blocked
4. Allowed requests pass through to API

**Gotcha**: The counter resets at fixed intervals, so you could get 10 requests at 0:59 and 10 more at 1:00 (20 requests in 2 seconds).
```

---

## Example 2: Git workflow skill

Shows task-oriented workflow skill.

````yaml
---
name: git-workflow
description: Standard git workflow for creating feature branches and pull requests. Use when starting new features or creating PRs.
disable-model-invocation: true
---

# Git Workflow

Standard workflow for feature development.

## Starting a feature

```bash
# Update main
git checkout main
git pull origin main

# Create feature branch
git checkout -b feature/description

# Make changes and commit
git add .
git commit -m "feat: description"

# Push branch
git push -u origin feature/description
```

## Creating a pull request

```bash
# Use GitHub CLI
gh pr create --title "Feature: Description" --body "Description of changes"

# Or open in browser
gh pr create --web
```

## PR template

```markdown
## Summary
Brief description of what this PR does

## Changes
- Change 1
- Change 2
- Change 3

## Testing
How to test these changes

## Screenshots
If applicable
```

## After approval

```bash
# Merge and delete branch
gh pr merge --squash
git checkout main
git pull origin main
git branch -d feature/description
```
````

---

## Example 3: API documentation skill

Shows reference skill with progressive disclosure.

```yaml
---
name: api-docs
description: API documentation and usage examples for internal services. Use when working with internal APIs or building integrations.
---

# Internal API Documentation

## Quick reference

**Base URL**: https://api.internal.example.com
**Authentication**: Bearer token in Authorization header
**Rate limit**: 100 requests/minute

## Core endpoints

**Users API**: See [apis/users.md](apis/users.md)
**Orders API**: See [apis/orders.md](apis/orders.md)
**Products API**: See [apis/products.md](apis/products.md)

## Authentication

```bash
curl -H "Authorization: Bearer $TOKEN" https://api.internal.example.com/users
```

Get token from: https://dashboard.internal.example.com/tokens

## Error codes

| Code | Meaning | Action |
|------|---------|--------|
| 401 | Unauthorized | Check token validity |
| 429 | Rate limited | Wait and retry |
| 500 | Server error | Check status page |

## Common patterns

**Pagination:**
```bash
GET /users?page=1&limit=20
```

**Filtering:**
```bash
GET /users?status=active&role=admin
```

**Sorting:**
```bash
GET /users?sort=created_at:desc
```
```

---

## Example 4: Database migration skill

Shows skill with validation loops.

````yaml
---
name: db-migrate
description: Create and run database migrations safely. Use when making schema changes or database updates.
---

# Database Migration

Create and run database migrations safely.

## Migration workflow

```
Migration Progress:
- [ ] Step 1: Create migration file
- [ ] Step 2: Write migration SQL
- [ ] Step 3: Test locally
- [ ] Step 4: Review migration
- [ ] Step 5: Apply to production
```

## Step 1: Create migration file

```bash
# Generate timestamped migration
npm run migrate:create -- add_users_table
# Creates: migrations/20240115120000_add_users_table.sql
```

## Step 2: Write migration SQL

```sql
-- Up migration
CREATE TABLE users (
  id SERIAL PRIMARY KEY,
  email VARCHAR(255) UNIQUE NOT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Down migration (for rollback)
DROP TABLE IF EXISTS users;
```

## Step 3: Test locally

```bash
# Apply migration
npm run migrate:up

# Verify schema
npm run db:schema

# Test rollback
npm run migrate:down
npm run migrate:up
```

**Do not proceed unless migration applies cleanly both up and down.**

## Step 4: Review migration

Checklist:
- [ ] Migration is idempotent (safe to run multiple times)
- [ ] Includes both up and down migrations
- [ ] No data loss on down migration
- [ ] Indexes added for foreign keys
- [ ] Tested locally

## Step 5: Apply to production

```bash
# Backup first
npm run db:backup production

# Apply migration
npm run migrate:up -- --env=production

# Verify
npm run db:schema -- --env=production
```

If anything fails, roll back immediately:
```bash
npm run migrate:down -- --env=production
npm run db:restore production <backup-file>
```
````

---

## Example 5: Performance profiling skill

Shows analytical skill with tool execution.

````yaml
---
name: profile-performance
description: Profile application performance and identify bottlenecks. Use when investigating slow performance or optimization opportunities.
allowed-tools: Bash, Read
---

# Performance Profiling

Profile and analyze application performance.

## Profiling workflow

```
Profiling Progress:
- [ ] Step 1: Establish baseline
- [ ] Step 2: Profile the application
- [ ] Step 3: Analyze results
- [ ] Step 4: Identify bottlenecks
- [ ] Step 5: Recommend optimizations
```

## Step 1: Establish baseline

Measure current performance:

```bash
# Web app - Lighthouse
npx lighthouse https://example.com --output=json --output-path=baseline.json

# Node.js app - autocannon
npx autocannon -c 10 -d 30 http://localhost:3000 > baseline.txt

# Bundle size
npm run build
ls -lh dist/
```

## Step 2: Profile the application

**Browser profiling:**
```bash
# Chrome DevTools Protocol
npm run build
npm run serve
# Then open Chrome DevTools > Performance > Record
```

**Node.js profiling:**
```bash
# CPU profile
node --prof app.js
node --prof-process isolate-*.log > profile.txt

# Memory profile
node --inspect app.js
# Then open chrome://inspect
```

## Step 3: Analyze results

Look for:
- Long-running functions (>100ms)
- Large bundle sizes (>500KB)
- Memory leaks (growing heap)
- Unnecessary re-renders
- Blocking operations

## Step 4: Identify bottlenecks

Categorize issues:

**Critical** (>500ms impact):
- Database queries without indexes
- Large synchronous operations
- Unoptimized images

**Moderate** (100-500ms impact):
- Inefficient algorithms
- Unnecessary computations
- Large bundle sizes

**Minor** (<100ms impact):
- Small inefficiencies
- Suboptimal patterns

## Step 5: Recommend optimizations

Provide specific recommendations with expected impact:

**Example:**
```markdown
## Optimization recommendations

### 1. Add database index (Critical)
**Issue**: Query takes 800ms
**Fix**: Add index on user_id column
**Expected impact**: Reduce to <50ms
**Implementation**:
```sql
CREATE INDEX idx_user_id ON orders(user_id);
```

### 2. Code split large bundle (Moderate)
**Issue**: Initial bundle is 2MB
**Fix**: Lazy load admin routes
**Expected impact**: Reduce initial bundle to 500KB
**Implementation**: See [code-splitting.md](code-splitting.md)
```
````

---

## Example 6: Security audit skill

Shows checklist-based review skill.

```yaml
---
name: security-audit
description: Audit code for security vulnerabilities. Use when reviewing security-sensitive code or before deployment.
allowed-tools: Read, Grep, Bash
---

# Security Audit

Audit code for common security vulnerabilities.

## Security checklist

```
Security Audit:
- [ ] Authentication & Authorization
- [ ] Input Validation
- [ ] Injection Attacks
- [ ] Sensitive Data
- [ ] Error Handling
- [ ] Dependencies
```

## 1. Authentication & Authorization

**Check for:**
- Weak password requirements
- Missing session timeout
- Insecure token storage
- Missing authorization checks

**Common issues:**
```javascript
// BAD: No authorization check
app.get('/admin', (req, res) => {
  // Anyone can access
})

// GOOD: Check user role
app.get('/admin', requireRole('admin'), (req, res) => {
  // Only admins can access
})
```

## 2. Input Validation

**Check for:**
- Unvalidated user input
- Missing sanitization
- Type coercion issues

**Common issues:**
```javascript
// BAD: Direct database query with user input
db.query(`SELECT * FROM users WHERE id = ${req.params.id}`)

// GOOD: Parameterized query
db.query('SELECT * FROM users WHERE id = ?', [req.params.id])
```

## 3. Injection Attacks

**Check for:**
- SQL injection
- XSS vulnerabilities
- Command injection
- Path traversal

**Scan for patterns:**
```bash
# SQL injection
grep -r "db.query.*req\." src/

# XSS
grep -r "dangerouslySetInnerHTML" src/

# Command injection
grep -r "exec.*req\." src/
```

## 4. Sensitive Data

**Check for:**
- Hardcoded credentials
- API keys in code
- Secrets in logs
- Sensitive data in URLs

**Scan for secrets:**
```bash
# API keys
grep -r "api[_-]key" src/

# Passwords
grep -r "password.*=.*['\"]" src/

# Tokens
grep -r "token.*=.*['\"]" src/
```

## 5. Error Handling

**Check for:**
- Exposed stack traces
- Detailed error messages to clients
- Unhandled errors

**Common issues:**
```javascript
// BAD: Expose internal details
res.status(500).send(error.stack)

// GOOD: Generic error message
res.status(500).send('Internal server error')
logger.error(error.stack)
```

## 6. Dependencies

**Check for:**
- Known vulnerabilities
- Outdated packages

```bash
# Audit dependencies
npm audit

# Check for updates
npm outdated
```

## Report format

```markdown
# Security Audit Report

## Critical Issues
- Issue 1: Description, location, fix
- Issue 2: Description, location, fix

## Warnings
- Issue 1: Description, location, recommendation

## Recommendations
- Best practice suggestions
```
```

---

## Example 7: Refactoring skill

Shows code improvement workflow.

````yaml
---
name: refactor-code
description: Refactor code to improve structure and maintainability. Use when code needs restructuring or cleanup.
---

# Refactor Code

Refactor code systematically to improve quality.

## Refactoring checklist

```
Refactoring Progress:
- [ ] Identify code smells
- [ ] Ensure tests exist
- [ ] Make small changes
- [ ] Run tests after each change
- [ ] Verify functionality unchanged
```

## Common code smells

**Long functions** (>50 lines):
- Extract helper functions
- Split into smaller pieces

**Duplicated code**:
- Extract to shared function
- Use composition

**Magic numbers**:
- Extract to named constants

**Deep nesting** (>3 levels):
- Extract conditions
- Use early returns

**Long parameter lists** (>4 params):
- Use options object
- Consider builder pattern

## Refactoring patterns

### Extract function

**Before:**
```javascript
function processOrder(order) {
  // Validate order
  if (!order.items || order.items.length === 0) {
    throw new Error('No items')
  }

  // Calculate total
  let total = 0
  for (const item of order.items) {
    total += item.price * item.quantity
  }

  // Apply discounts
  if (order.coupon) {
    total *= 0.9
  }

  return total
}
```

**After:**
```javascript
function processOrder(order) {
  validateOrder(order)
  const total = calculateTotal(order.items)
  return applyDiscounts(total, order.coupon)
}

function validateOrder(order) {
  if (!order.items || order.items.length === 0) {
    throw new Error('No items')
  }
}

function calculateTotal(items) {
  return items.reduce((sum, item) => sum + item.price * item.quantity, 0)
}

function applyDiscounts(total, coupon) {
  return coupon ? total * 0.9 : total
}
```

### Extract constant

**Before:**
```javascript
if (age >= 18) {
  // Can vote
}
if (age >= 18) {
  // Can buy lottery
}
```

**After:**
```javascript
const LEGAL_AGE = 18

if (age >= LEGAL_AGE) {
  // Can vote
}
if (age >= LEGAL_AGE) {
  // Can buy lottery
}
```

### Replace conditional with polymorphism

**Before:**
```javascript
function getPrice(item) {
  if (item.type === 'book') {
    return item.price * 0.9
  } else if (item.type === 'food') {
    return item.price * 0.95
  }
  return item.price
}
```

**After:**
```javascript
class Item {
  getPrice() {
    return this.price
  }
}

class Book extends Item {
  getPrice() {
    return this.price * 0.9
  }
}

class Food extends Item {
  getPrice() {
    return this.price * 0.95
  }
}
```

## Refactoring process

1. **Ensure tests exist**: Write tests if missing
2. **Make one change**: Keep changes small
3. **Run tests**: Verify nothing broke
4. **Commit**: Save working state
5. **Repeat**: Continue with next refactoring
````

These examples demonstrate effective skill patterns. Adapt them for your specific needs.
