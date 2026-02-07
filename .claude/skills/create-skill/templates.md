# Skill Templates

Common skill patterns you can adapt for your needs.

## Basic reference skill

Adds knowledge Claude applies to current work.

```yaml
---
name: api-conventions
description: API design patterns and conventions for this codebase. Use when creating or modifying API endpoints.
---

# API Conventions

## Endpoint naming

Use RESTful conventions:
- GET /resources/:id - Retrieve single resource
- GET /resources - List resources
- POST /resources - Create resource
- PUT /resources/:id - Update resource
- DELETE /resources/:id - Delete resource

## Error responses

Return consistent format:

```json
{
  "error": "Human-readable message",
  "code": "ERROR_CODE",
  "details": {}
}
```

## Authentication

All endpoints require JWT in Authorization header:
```
Authorization: Bearer <token>
```
```

---

## Task skill with workflow

Step-by-step instructions for specific action.

````yaml
---
name: deploy
description: Deploy the application to production
disable-model-invocation: true
argument-hint: [environment]
---

# Deploy Application

Deploy to $ARGUMENTS:

**Checklist:**
```
Deployment Progress:
- [ ] Step 1: Run test suite
- [ ] Step 2: Build application
- [ ] Step 3: Verify build artifacts
- [ ] Step 4: Deploy
- [ ] Step 5: Run health checks
```

## Step 1: Run test suite

```bash
npm test
```

**Do not proceed if tests fail.**

## Step 2: Build application

```bash
npm run build
```

Check that `dist/` directory contains expected files.

## Step 3: Verify build artifacts

Confirm these files exist:
- dist/index.html
- dist/assets/main.js
- dist/assets/main.css

## Step 4: Deploy

```bash
./scripts/deploy.sh $ARGUMENTS
```

## Step 5: Run health checks

Verify deployment:
```bash
curl https://$ARGUMENTS.example.com/health
```

Expected response: `{"status": "healthy"}`
````

---

## Code review skill

Read-only analysis skill.

```yaml
---
name: review-code
description: Review code for quality, security, and best practices. Use after writing or modifying code.
allowed-tools: Read, Grep, Glob, Bash
---

# Code Review

Review recent changes for quality and security.

## Review process

1. **Get changes**: Run `git diff HEAD~1`
2. **Focus on modified files**
3. **Check each item** in the checklist below
4. **Report findings** organized by severity

## Review checklist

- Code is clear and readable
- Functions and variables are well-named
- No duplicated code
- Proper error handling
- No exposed secrets or API keys
- Input validation implemented
- Good test coverage
- Performance considerations addressed

## Output format

Organize feedback by priority:

**Critical issues** (must fix):
- Issue 1 with specific example and fix

**Warnings** (should fix):
- Issue 1 with suggestion

**Suggestions** (consider improving):
- Issue 1 with rationale
```

---

## Commit message generator

Analyzes changes and generates commit messages.

````yaml
---
name: commit-msg
description: Generate conventional commit messages from git diff. Use when creating commits or when user asks for commit message help.
---

# Commit Message Generator

Generate a commit message for staged changes.

## Process

1. **Get staged changes**: Run `git diff --staged`
2. **Analyze the changes**: Understand what changed and why
3. **Generate message** following format below

## Commit message format

Follow Conventional Commits:

```
type(scope): brief description

Detailed explanation of what and why.
```

**Types:**
- feat: New feature
- fix: Bug fix
- docs: Documentation only
- style: Formatting, no code change
- refactor: Code restructuring
- test: Adding tests
- chore: Maintenance

## Examples

**Example 1:**
Changes: Added login form with validation
```
feat(auth): implement login form with validation

Add email and password fields with client-side validation.
Include error messages for invalid credentials.
```

**Example 2:**
Changes: Fixed timezone bug in reports
```
fix(reports): correct date formatting in timezone conversion

Use UTC timestamps consistently across report generation
to prevent timezone-related display issues.
```

**Example 3:**
Changes: Updated dependencies
```
chore: update dependencies

- Upgrade React to 18.2.0
- Update TypeScript to 5.0.0
```

Generate commit message now.
````

---

## Data analysis skill

Domain-specific skill for SQL/data work.

```yaml
---
name: analyze-data
description: Analyze data with SQL queries and BigQuery. Use for data analysis, querying databases, or generating reports from data.
allowed-tools: Bash, Read
---

# Data Analysis

Perform data analysis with SQL and BigQuery.

## Available datasets

**Sales data**: See [schemas/sales.md](schemas/sales.md)
**User analytics**: See [schemas/analytics.md](schemas/analytics.md)
**Financial data**: See [schemas/finance.md](schemas/finance.md)

## Query process

1. **Understand requirement**: What question are we answering?
2. **Identify tables**: Which tables contain relevant data?
3. **Write query**: Use efficient SQL with proper filters
4. **Analyze results**: Summarize findings clearly
5. **Provide recommendations**: Data-driven next steps

## Query best practices

- Use WHERE clauses to filter data early
- Include LIMIT for exploratory queries
- Add comments explaining complex logic
- Test queries with small datasets first
- Use appropriate aggregations

## BigQuery commands

```bash
# Run query
bq query --use_legacy_sql=false 'SELECT * FROM dataset.table LIMIT 10'

# Save results
bq query --use_legacy_sql=false --format=csv 'SELECT ...' > results.csv
```
```

---

## Documentation generator

Generates documentation from code.

````yaml
---
name: document-code
description: Generate documentation for code. Use when documenting functions, modules, or APIs.
---

# Code Documentation Generator

Generate clear, concise documentation for code.

## Documentation format

For functions:

```markdown
## functionName

Brief description of what the function does.

**Parameters:**
- `param1` (type): Description
- `param2` (type): Description

**Returns:**
- `type`: Description

**Example:**
```language
exampleUsage()
```

**Notes:**
- Any important details or edge cases
```

## Process

1. **Read the code**: Understand what it does
2. **Identify key components**: Functions, classes, methods
3. **Document each component**: Follow format above
4. **Include examples**: Show real usage
5. **Add notes**: Mention gotchas or important details

## Documentation principles

- Start with what, not how
- Include practical examples
- Document edge cases
- Explain non-obvious behavior
- Keep it concise
````

---

## Bug fix workflow skill

Systematic debugging approach.

````yaml
---
name: debug-issue
description: Debug errors, test failures, and unexpected behavior. Use when encountering bugs or issues.
---

# Debug Issue

Systematic debugging workflow for finding and fixing issues.

## Debugging checklist

```
Debug Progress:
- [ ] Step 1: Capture error details
- [ ] Step 2: Reproduce the issue
- [ ] Step 3: Form hypothesis
- [ ] Step 4: Test hypothesis
- [ ] Step 5: Implement fix
- [ ] Step 6: Verify fix works
```

## Step 1: Capture error details

Collect:
- Full error message and stack trace
- Environment (browser, Node version, OS)
- Steps that trigger the issue
- Expected vs actual behavior

## Step 2: Reproduce the issue

Create minimal reproduction:
1. Strip away unrelated code
2. Identify exact trigger
3. Document reproduction steps

## Step 3: Form hypothesis

Based on error message and code:
- Where does the error occur?
- What causes it?
- What recently changed?

## Step 4: Test hypothesis

Add logging or debugging:
```javascript
console.log('Before operation:', variable)
// Operation
console.log('After operation:', variable)
```

Or use debugger:
```javascript
debugger; // Execution pauses here
```

## Step 5: Implement fix

Create minimal fix that addresses root cause, not symptoms.

## Step 6: Verify fix works

- Confirm error no longer occurs
- Verify edge cases work
- Ensure no new issues introduced
- Add test to prevent regression
````

---

## Test generator skill

Creates tests for code.

````yaml
---
name: generate-tests
description: Generate unit tests for code. Use when writing tests or when user asks for test coverage.
---

# Test Generator

Generate comprehensive unit tests for code.

## Test structure

```language
describe('Component/Function name', () => {
  describe('method/feature', () => {
    it('should behavior when condition', () => {
      // Arrange: Set up test data
      // Act: Execute the code
      // Assert: Verify results
    })
  })
})
```

## Test coverage checklist

- [ ] Happy path (normal expected usage)
- [ ] Edge cases (boundary values, empty inputs)
- [ ] Error cases (invalid inputs, exceptions)
- [ ] State changes (before/after verification)
- [ ] Integration points (mocked dependencies)

## Test patterns

**Unit test example:**

```typescript
describe('calculateTotal', () => {
  it('should sum item prices', () => {
    const items = [{ price: 10 }, { price: 20 }]
    const total = calculateTotal(items)
    expect(total).toBe(30)
  })

  it('should return 0 for empty array', () => {
    const total = calculateTotal([])
    expect(total).toBe(0)
  })

  it('should handle negative prices', () => {
    const items = [{ price: -10 }, { price: 20 }]
    const total = calculateTotal(items)
    expect(total).toBe(10)
  })
})
```

## Process

1. **Read the code**: Understand functionality
2. **Identify test cases**: Happy path, edges, errors
3. **Write tests**: Follow structure above
4. **Run tests**: Verify they pass
5. **Check coverage**: Aim for critical paths
````

---

## Configuration generator

Creates config files.

```yaml
---
name: generate-config
description: Generate configuration files for tools and frameworks. Use when setting up projects or configuring tools.
argument-hint: [tool-name]
---

# Configuration Generator

Generate configuration files for common tools.

## Process

1. **Identify tool**: What needs configuration? ($ARGUMENTS)
2. **Determine requirements**: What features are needed?
3. **Generate config**: Use appropriate template
4. **Explain settings**: Document important options

## Available templates

**TypeScript** (tsconfig.json):
- Strict mode configuration
- Modern ES features
- Path aliases
- Source maps

**ESLint** (.eslintrc.js):
- TypeScript support
- React rules
- Prettier integration
- Custom rules

**Prettier** (.prettierrc):
- Consistent formatting
- Team preferences

**Vitest** (vitest.config.ts):
- Test setup
- Coverage config
- Global mocks

**Tailwind** (tailwind.config.js):
- Theme customization
- Plugin configuration
- Content paths

Ask: Which tool needs configuration?
```

---

## Custom subagent creator

Creates custom subagent definitions.

````yaml
---
name: create-subagent
description: Create custom subagent definitions for specialized tasks. Use when building reusable agents.
---

# Create Custom Subagent

Create a custom subagent with specific tools and permissions.

## Subagent structure

```yaml
---
name: agent-name
description: When Claude should delegate to this subagent
tools: Read, Grep, Glob
model: sonnet
permissionMode: default
---

System prompt for the subagent.

When invoked, the subagent should:
1. Step one
2. Step two
3. Return results
```

## Process

1. **Define purpose**: What specific task will this agent handle?
2. **Choose tools**: Which tools does it need?
3. **Set permissions**: What permission mode?
4. **Write prompt**: Clear instructions for behavior
5. **Save file**: `.claude/agents/name.md` (project) or `~/.claude/agents/name.md` (personal)

## Common subagent patterns

**Read-only researcher:**
```yaml
tools: Read, Grep, Glob
permissionMode: default
```

**Code modifier:**
```yaml
tools: Read, Edit, Bash
permissionMode: acceptEdits
```

**Test runner:**
```yaml
tools: Bash
permissionMode: default
```

## Example subagents

See [examples/subagents.md](examples/subagents.md)
````
