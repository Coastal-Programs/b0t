---
name: create-skill
description: Create new Claude Code skills following best practices. Use when the user wants to create a custom skill, slash command, or extend Claude's capabilities.
argument-hint: [skill-name] [description]
---

# Create Claude Code Skill

Create a new Claude Code skill following Agent Skills best practices. This skill guides you through creating effective, well-structured skills that Claude can discover and use successfully.

## Quick start workflow

Copy this checklist and track progress:

```
Skill Creation Progress:
- [ ] Step 1: Define skill purpose and scope
- [ ] Step 2: Choose skill location and invocation pattern
- [ ] Step 3: Write effective frontmatter
- [ ] Step 4: Create concise skill content
- [ ] Step 5: Add supporting files (if needed)
- [ ] Step 6: Test the skill
```

## Step 1: Define skill purpose and scope

**Ask the user these questions:**

1. **What should this skill do?** (Be specific about the task or knowledge it provides)
2. **When should Claude use it?** (Triggers, keywords, or contexts)
3. **What type of skill is this?**
   - **Reference skill**: Adds knowledge Claude applies to current work (conventions, patterns, domain knowledge)
   - **Task skill**: Step-by-step instructions for specific actions (deployment, commits, code generation)

**Key principle**: Focused skills are better than multipurpose skills. Each skill should excel at one specific task.

## Step 2: Choose skill location and invocation pattern

**Skill location determines who can use it:**

| Location | Path | Applies to |
|----------|------|------------|
| Personal | `~/.claude/skills/<skill-name>/SKILL.md` | All your projects |
| Project | `.claude/skills/<skill-name>/SKILL.md` | This project only |
| Plugin | `<plugin>/skills/<skill-name>/SKILL.md` | Where plugin is enabled |

**Invocation pattern:**

- **Default**: Both user and Claude can invoke (most skills)
- **Manual only**: Add `disable-model-invocation: true` (for side effects like `/deploy`)
- **Claude only**: Add `user-invocable: false` (for background knowledge)

## Step 3: Write effective frontmatter

**Required fields:**

```yaml
---
name: skill-name              # lowercase, hyphens, max 64 chars
description: What this skill does and when to use it
---
```

**Description best practices:**

- ✅ **Good**: "Processes Excel files and generates reports. Use when analyzing spreadsheets, tabular data, or .xlsx files."
- ❌ **Bad**: "Helps with documents"
- Include specific keywords users would naturally say
- Write in third person ("Processes files" not "I can help you")
- Mention both what it does and when to use it

**Optional fields:**

```yaml
argument-hint: [filename] [format]        # Shows in autocomplete
disable-model-invocation: true            # Manual invocation only
user-invocable: false                     # Claude-only invocation
allowed-tools: Read, Grep, Glob           # Restrict tools
context: fork                             # Run in subagent
agent: Explore                            # Which subagent to use
```

## Step 4: Create concise skill content

**Core principle: Be concise**

Assume Claude is smart. Only include what Claude doesn't already know.

**For reference skills** (conventions, patterns, guidelines):

```markdown
## API Conventions

Use RESTful naming:
- GET /resources/:id for retrieval
- POST /resources for creation
- PUT /resources/:id for updates

Error format:
```json
{"error": "message", "code": "ERROR_CODE"}
```

See [error-codes.md](error-codes.md) for complete list.
```

**For task skills** (workflows with steps):

````markdown
## Deployment Workflow

Deploy $ARGUMENTS to production:

1. **Run tests**: `npm test`
2. **Build**: `npm run build`
3. **Verify build**: Check dist/ directory exists
4. **Deploy**: `./scripts/deploy.sh $ARGUMENTS`
5. **Verify**: Run health check at https://api.example.com/health

If step 1 or 2 fails, do not proceed.
````

**Keep SKILL.md under 500 lines**. Move detailed content to supporting files.

## Step 5: Add supporting files (if needed)

**When to add supporting files:**

- Detailed API documentation
- Multiple examples
- Large reference tables
- Utility scripts

**Progressive disclosure pattern:**

```markdown
## Quick reference

Basic usage here...

## Detailed documentation

For complete API details, see [reference.md](reference.md)
For usage examples, see [examples.md](examples.md)
```

**Supporting file structure:**

```
my-skill/
├── SKILL.md              # Main instructions (required)
├── reference.md          # Detailed docs (loaded when needed)
├── examples.md           # Usage examples
└── scripts/
    └── helper.py         # Utility script (executed)
```

See [templates.md](templates.md) for common skill patterns.

## Step 6: Test the skill

**Testing checklist:**

1. **Verify skill loads**: Run "What skills are available?" and confirm it appears
2. **Test automatic invocation**: Ask a question that should trigger it
3. **Test manual invocation**: Try `/skill-name` with arguments
4. **Check content quality**: Does Claude follow the instructions correctly?
5. **Test edge cases**: Try scenarios that might confuse Claude

**If skill doesn't trigger:**

- Make description more specific with clearer keywords
- Check the skill file has proper YAML frontmatter
- Try invoking directly with `/skill-name` to verify it works

**If skill triggers too often:**

- Make description more specific
- Add `disable-model-invocation: true` for manual-only

## Common patterns

### Template pattern

````markdown
## Report structure

ALWAYS use this exact template:

```markdown
# [Analysis Title]

## Executive summary
[One-paragraph overview]

## Key findings
- Finding 1 with supporting data
- Finding 2 with supporting data

## Recommendations
1. Specific actionable recommendation
```
````

### Example-driven pattern

````markdown
## Commit message format

Follow these examples:

**Example 1:**
Input: Added user authentication
Output:
```
feat(auth): implement JWT-based authentication

Add login endpoint and token validation middleware
```

**Example 2:**
Input: Fixed date bug
Output:
```
fix(reports): correct date formatting in timezone conversion
```

Use format: type(scope): brief description, then detailed explanation.
````

### Workflow with validation

````markdown
## Workflow

1. Make changes to the code
2. **Validate**: Run `npm run lint`
3. If validation fails:
   - Fix the issues
   - Run validation again
4. **Only proceed when validation passes**
5. Commit the changes
````

## Best practices reminder

**DO:**
- ✅ Keep SKILL.md concise (under 500 lines)
- ✅ Use specific, keyword-rich descriptions
- ✅ Include examples for complex tasks
- ✅ Use workflows with checklists for multi-step processes
- ✅ Test with real usage scenarios
- ✅ Use forward slashes in paths (not backslashes)

**DON'T:**
- ❌ Include time-sensitive information
- ❌ Offer too many options (provide one default)
- ❌ Assume packages are installed
- ❌ Use inconsistent terminology
- ❌ Create deeply nested file references
- ❌ Write verbose explanations of basic concepts

## Additional resources

- **Skill templates**: See [templates.md](templates.md)
- **Example skills**: See [examples.md](examples.md)
- **Troubleshooting**: See [troubleshooting.md](troubleshooting.md)

## After creating the skill

1. **Create the directory**: `mkdir -p ~/.claude/skills/skill-name` or `.claude/skills/skill-name`
2. **Write SKILL.md**: Create the file with frontmatter and content
3. **Test immediately**: Ask Claude a question that should trigger it
4. **Iterate**: Observe how Claude uses it and refine
5. **Share**: Commit project skills to version control or package as plugin
