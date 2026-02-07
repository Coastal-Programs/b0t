# Troubleshooting Skills

Common issues and solutions when creating Claude Code skills.

## Skill not appearing in `/` menu

**Possible causes:**

1. **Missing SKILL.md file**
   - Solution: Ensure file is named exactly `SKILL.md` (case-sensitive)
   - Location: `~/.claude/skills/skill-name/SKILL.md` or `.claude/skills/skill-name/SKILL.md`

2. **Invalid YAML frontmatter**
   - Solution: Check YAML syntax is correct
   - Ensure `---` markers are present at start and end
   - Validate with: `python -c "import yaml; yaml.safe_load(open('SKILL.md').read().split('---')[1])"`

3. **Skill name conflicts with built-in command**
   - Solution: Choose a different name
   - Built-in commands: `/help`, `/compact`, `/init`, `/permissions`, etc.

4. **Session not restarted**
   - Solution: Restart Claude Code or run `/reload` if available
   - Skills are loaded at session start

5. **`user-invocable: false` set**
   - Solution: Remove this field or set to `true`
   - This field hides skills from the menu

**Verification:**
```bash
# Check file exists
ls -la ~/.claude/skills/*/SKILL.md

# Check YAML is valid
head -20 ~/.claude/skills/skill-name/SKILL.md
```

---

## Claude doesn't trigger skill automatically

**Possible causes:**

1. **Description too vague**
   - Bad: "Helps with code"
   - Good: "Reviews code for security vulnerabilities. Use when reviewing security-sensitive code or auth logic."
   - Solution: Add specific keywords users would naturally say

2. **Missing description field**
   - Solution: Add `description` field to frontmatter
   - Or ensure first paragraph of markdown is descriptive

3. **`disable-model-invocation: true` set**
   - Solution: Remove this field if you want automatic invocation
   - This field prevents Claude from loading the skill

4. **Skill not loaded into context**
   - Solution: Run "What skills are available?" to verify skill appears
   - Check for character budget warnings with `/context`

5. **Description doesn't match user's phrasing**
   - Solution: Include synonyms and variations in description
   - Example: "API endpoints, REST routes, HTTP handlers"

**Debugging:**
```
Ask Claude: "What skills are available?"
Check if your skill appears in the list.

Ask Claude: "When should you use the [skill-name] skill?"
Verify Claude understands when to use it.

Try: "/skill-name" to verify it works when invoked manually.
```

---

## Skill triggers too often

**Possible causes:**

1. **Description too broad**
   - Bad: "Helps with files"
   - Good: "Processes PDF files to extract text and tables. Use when working with PDF documents."
   - Solution: Make description more specific

2. **Too many triggering keywords**
   - Solution: Remove generic keywords, focus on specific use case

3. **Skill should be manual-only**
   - Solution: Add `disable-model-invocation: true` to frontmatter
   - Use for tasks with side effects like deployments

**Fix example:**

**Before (triggers too often):**
```yaml
description: Helps analyze and process data
```

**After (more specific):**
```yaml
description: Analyzes SQL query performance and suggests indexes. Use when optimizing database queries or investigating slow queries.
```

---

## Claude doesn't follow skill instructions

**Possible causes:**

1. **Instructions too vague**
   - Solution: Be specific and explicit
   - Use examples to clarify expected behavior

2. **Too much content in SKILL.md**
   - Solution: Keep SKILL.md under 500 lines
   - Move detailed content to supporting files

3. **Conflicting instructions**
   - Solution: Remove contradictions
   - Ensure consistent terminology

4. **Instructions assume too much knowledge**
   - Solution: Include necessary context
   - But avoid over-explaining basic concepts

5. **No examples provided**
   - Solution: Add concrete examples showing expected input/output

**Before (vague):**
```markdown
Generate good commit messages.
```

**After (specific with examples):**
````markdown
Generate commit messages following Conventional Commits format.

**Format:** type(scope): description

**Examples:**
- feat(auth): add login endpoint
- fix(api): handle null user in validator
- docs: update API documentation

Always include:
1. Type (feat, fix, docs, etc.)
2. Optional scope in parentheses
3. Brief description in imperative mood
````

---

## Supporting files not loading

**Possible causes:**

1. **Files not referenced in SKILL.md**
   - Solution: Add clear references in SKILL.md
   - Example: "For details, see [reference.md](reference.md)"

2. **Wrong file path**
   - Solution: Use forward slashes, relative paths
   - Good: `[docs](docs/api.md)`
   - Bad: `[docs](docs\api.md)` or `[docs](/absolute/path/docs/api.md)`

3. **Files nested too deeply**
   - Solution: Keep references one level deep from SKILL.md
   - Avoid: SKILL.md → advanced.md → details.md → actual-content.md

4. **Claude doesn't know when to load them**
   - Solution: Add clear triggers in SKILL.md
   - Example: "For error codes, see [errors.md](errors.md)"

**Good structure:**
```
skill/
├── SKILL.md                # References all files clearly
├── reference.md            # Loaded when needed
└── examples.md             # Loaded when needed
```

**Bad structure:**
```
skill/
├── SKILL.md               # Vague references
└── docs/
    └── advanced/
        └── details.md     # Too deeply nested
```

---

## Skill works for you but not teammates

**Possible causes:**

1. **Personal skill location**
   - Issue: Skill is in `~/.claude/skills/` (personal only)
   - Solution: Move to `.claude/skills/` in project (commit to git)

2. **Absolute paths in skill**
   - Issue: Paths like `/Users/yourname/project/script.sh`
   - Solution: Use relative paths or `$HOME` variable

3. **Hardcoded environment variables**
   - Issue: References specific to your machine
   - Solution: Use env vars or config files

4. **Missing dependencies**
   - Issue: Skill assumes tools are installed
   - Solution: Document required tools in SKILL.md
   - Add installation instructions

**Fix:**
```yaml
---
name: deploy
description: Deploy application
---

# Deploy

## Prerequisites

Install required tools:
```bash
# Install kubectl
brew install kubectl  # macOS
# or apt-get install kubectl  # Linux

# Install helm
brew install helm
```

Then run deployment:
```bash
./scripts/deploy.sh
```
```

---

## Arguments not being passed correctly

**Possible causes:**

1. **Missing `$ARGUMENTS` placeholder**
   - Solution: Add `$ARGUMENTS` in skill content
   - Example: `Fix issue $ARGUMENTS`

2. **Using wrong argument syntax**
   - Wrong: `$1` (bash-style)
   - Right: `$ARGUMENTS[0]` or `$0` (skill syntax)

3. **Arguments with spaces not quoted**
   - Solution: Users should quote arguments
   - Example: `/fix-issue "bug with login form"`

4. **Trying to parse complex argument structure**
   - Solution: Keep arguments simple
   - Use flags: `/deploy --env=prod` not `/deploy prod true false 3`

**Example:**
```yaml
---
name: migrate-file
description: Move file from one location to another
---

# Migrate File

Move $ARGUMENTS[0] to $ARGUMENTS[1]

1. Copy $0 to $1
2. Verify copy succeeded
3. Delete $0
4. Confirm $1 exists

Usage: /migrate-file src/old.js src/new.js
```

---

## Skill using wrong tools

**Possible causes:**

1. **`allowed-tools` too restrictive**
   - Issue: Skill needs Edit but only Read is allowed
   - Solution: Add required tools to `allowed-tools` field

2. **`allowed-tools` too permissive**
   - Issue: Read-only skill is modifying files
   - Solution: Restrict to read-only tools: `Read, Grep, Glob`

3. **Conflicting permission modes**
   - Solution: Review `permissionMode` setting
   - Use `default` for most skills

**Example fix:**

**Before (too restrictive):**
```yaml
---
name: fix-bug
description: Debug and fix issues
allowed-tools: Read
---
```

**After (appropriate tools):**
```yaml
---
name: fix-bug
description: Debug and fix issues
allowed-tools: Read, Edit, Bash
---
```

---

## Skill context issues with `context: fork`

**Possible causes:**

1. **Skill content is guidelines, not a task**
   - Issue: Subagent receives "Use these patterns" but no actual task
   - Solution: Include actionable instructions
   - Or remove `context: fork` to run inline

2. **Expecting conversation history in subagent**
   - Issue: Subagent doesn't have access to main conversation
   - Solution: Pass necessary context explicitly in skill content

3. **Wrong agent type specified**
   - Issue: Using `Explore` agent for tasks that need Edit tool
   - Solution: Use `general-purpose` or custom agent with Edit

**Before (wrong):**
```yaml
---
name: api-patterns
description: API design patterns
context: fork
agent: Explore
---

When building APIs, follow these patterns:
- Use RESTful naming
- Return consistent errors
```

This won't work because it has no actionable task.

**After (correct):**
```yaml
---
name: analyze-api
description: Analyze API endpoints
context: fork
agent: Explore
---

Analyze the API endpoints in this codebase:

1. Find all route definitions using Grep
2. Read endpoint handlers
3. Document each endpoint:
   - HTTP method
   - Path
   - Request/response format
   - Error cases

Provide a summary table of all endpoints.
```

---

## Character budget warnings

**Issue:**
```
Warning: Some skills excluded due to character budget.
```

**Solution:**

1. **Reduce skill count**
   - Remove unused skills
   - Combine related skills

2. **Shorten descriptions**
   - Keep descriptions under 200 characters
   - Remove redundant keywords

3. **Increase budget**
   - Set environment variable: `export SLASH_COMMAND_TOOL_CHAR_BUDGET=25000`
   - Default is 15,000 characters

4. **Use `disable-model-invocation: true` for manual skills**
   - Prevents description from loading into context
   - Skill still available via `/skill-name`

**Check current usage:**
```
Run: /context
Look for: "Slash commands: X/15000 characters"
```

---

## Skill not finding files

**Possible causes:**

1. **Wrong working directory**
   - Issue: Skill assumes specific directory
   - Solution: Use absolute paths or check current directory
   - Get project root: `git rev-parse --show-toplevel`

2. **Relative paths incorrect**
   - Solution: Verify paths are relative to working directory
   - Not relative to skill file location

3. **File patterns too specific**
   - Solution: Use glob patterns: `src/**/*.ts` instead of `src/components/Button.ts`

**Example fix:**
```yaml
---
name: analyze-tests
description: Analyze test coverage
---

# Analyze Tests

Find and analyze test files:

```bash
# Find test files from project root
cd $(git rev-parse --show-toplevel)
find . -name "*.test.ts" -o -name "*.spec.ts"
```

Or use glob pattern:
- Test files: `**/*.{test,spec}.ts`
```

---

## Get help

If you're still having issues:

1. **Check skill is valid:**
   ```bash
   cat ~/.claude/skills/skill-name/SKILL.md
   ```

2. **Verify frontmatter:**
   ```bash
   head -10 ~/.claude/skills/skill-name/SKILL.md
   ```

3. **Test manually:**
   ```
   /skill-name test arguments
   ```

4. **Ask Claude:**
   ```
   What skills are available?
   When should you use the X skill?
   ```

5. **Check documentation:**
   - Skills overview: /Users/jakeschepis/Documents/GitHub/WiseHub/claude/skills/skills-overview.md
   - Best practices: /Users/jakeschepis/Documents/GitHub/WiseHub/claude/skills/skills-best-practices.md
   - Extending skills: /Users/jakeschepis/Documents/GitHub/WiseHub/claude/skills/extend-skills.md
