---
argument-hint: [task-description]
description: Execute task with systematic research, planning, and validation
---

# Systematic Task Execution

**Task:** $ARGUMENTS

**⚠️ MCP Tool Availability:**
- Anthropic models (Claude): Full MCP access (Supabase, Grep, Sequential Thinking)
- Other models (GLM, Moonshot): Limited - use fallback approaches when MCP unavailable

## Execution Philosophy

This command follows a rigorous, research-driven methodology:
- **No guessing** - Research before acting
- **Systematic thinking** - Use Sequential Thinking MCP for complex problems
- **Context preservation** - Spawn sub-agents to save main thread context
- **Phased execution** - Break into discrete, testable phases
- **Prevent hallucinations** - Verify information before proceeding
- **Documentation** - Document plans and decisions
- **Test each phase** - Validate after every phase
- **Iterative fixes** - If tests fail, fix and retest
- **Tool utilization** - Use grep, supabase, GitHub CLI, shadcn CLI

---

## Phase 0: Understanding & Research

**DO NOT SKIP THIS PHASE - NO GUESSING ALLOWED**

### 1. Use Sequential Thinking for Complex Planning

If the task is complex or has multiple approaches:
```
Use mcp__sequential-thinking__sequentialthinking to:
- Break down the problem
- Identify unknowns
- Evaluate approaches
- Plan systematically
```

### 2. Research What We Don't Know

Spawn sub-agents for research using the Task tool:

**For codebase exploration:**
```
Task (Explore agent): "Understand the architecture and patterns in [relevant area]"
```

**For external patterns (if MCP tools available):**
```
Try mcp__grep__searchGitHub if available, otherwise use web search or manual research
Query: "[technology] [pattern] [use-case]"
Language: ["TypeScript", "JavaScript", "Python", etc.]
```

**For database operations (if MCP tools available):**
```
Try mcp__supabase__* tools if available, otherwise use direct Bash commands:
- supabase db dump
- psql commands
- SQL files
```

**For existing implementations:**
```
Task (Explore agent): "Find similar implementations in the codebase"
```

### 3. Document Research Findings

Create a clear summary of:
- What we learned
- What approaches are viable
- What patterns we'll follow
- What tools/libraries we need

---

## Phase 1: Planning

**Use TodoWrite to create phase checklist**

Break the task into discrete phases:
1. Phase goals must be specific and testable
2. Each phase should be completable independently
3. Include validation criteria for each phase
4. Document expected outcomes

Example structure:
```
Phase 1: [Setup/Scaffolding]
Phase 2: [Core Implementation]
Phase 3: [Integration]
Phase 4: [Testing]
Phase 5: [Validation]
```

**Document the plan clearly** - Include:
- What each phase does
- Why we're doing it this way
- How we'll test it
- What success looks like

---

## Phase 2+: Execution Loop

**FOR EACH PHASE:**

### A. Execute Phase

**If exploration is needed:**
- Spawn Task (Explore agent) to investigate
- Keep main thread for orchestration
- Summarize findings

**If implementation is needed:**
- Use appropriate tools (Read, Write, Edit)
- Follow discovered patterns
- Document decisions

**Available CLI tools:**
```bash
# GitHub CLI
gh pr list
gh issue create
gh repo view

# shadcn (if UI components)
npx shadcn-ui@latest add [component]
npx shadcn-ui@latest diff

# Database (via Supabase MCP)
mcp__supabase__list_projects
mcp__supabase__execute_sql
mcp__supabase__apply_migration
```

### B. Test Phase

**After completing phase, immediately test:**

Run appropriate validation:
```bash
# TypeScript checks
bunx tsc --noEmit

# Linting
bunx eslint .

# Unit tests
bun test [relevant-test-file]

# Build verification
bun run build

# Type checks for specific file
bunx tsc --noEmit [file-path]
```

**Test criteria:**
- Does it compile/build?
- Do tests pass?
- Does lint pass?
- Does it match requirements?

### C. Validate or Iterate

**If tests PASS:**
✅ Mark phase as completed in TodoWrite
✅ Document what was accomplished
✅ Move to next phase

**If tests FAIL:**
❌ DO NOT mark phase as completed
❌ Analyze failure
❌ Use Sequential Thinking if failure is complex
❌ Spawn research sub-agent if needed
❌ Fix the issue
❌ Re-test
❌ Repeat until tests pass

**Never move forward with failing tests**

---

## Phase N: Final Validation

**Complete system verification:**

### 1. Run Full Test Suite
```bash
bun test
bunx tsc --noEmit
bunx eslint .
```

### 2. Verify Integration
- All phases work together
- No regressions introduced
- Requirements fully met

### 3. Documentation Check
- Code is documented
- Changes are clear
- TODOs are resolved

### 4. Final Report

Provide summary:
- ✅ What was implemented
- ✅ How it was tested
- ✅ What patterns were used
- ✅ Any decisions made
- ⚠️ Any caveats or limitations
- 📝 Next steps (if any)

---

## Tool Usage Patterns

**Note:** MCP tools (Sequential Thinking, GitHub Grep, Supabase) may not be available when using non-Anthropic models (GLM, Moonshot). Use fallback approaches when needed.

### Sequential Thinking MCP (if available)
**Use for:**
- Complex problem decomposition
- Multiple solution evaluation
- Systematic debugging
- Architecture decisions

**How:**
```
Try mcp__sequential-thinking__sequentialthinking if available
Otherwise: Use step-by-step reasoning in main thread
```

### Task Tool (Sub-Agents) - ALWAYS AVAILABLE
**Use for:**
- Codebase exploration (Explore agent)
- Research tasks (general-purpose agent)
- Independent validation
- Context preservation

**How:**
```
Task tool with subagent_type:
- "Explore" for codebase navigation
- "general-purpose" for research
```

### GitHub Grep MCP (if available)
**Use for:**
- Finding real-world patterns
- Understanding best practices
- Discovering implementation examples

**Fallback:**
```
If mcp__grep__searchGitHub not available:
- Use web search
- Check GitHub directly via browser
- Search documentation sites
```

### Supabase MCP (if available)
**Use for:**
- Database operations
- Migrations
- Edge Functions

**Fallback:**
```
If mcp__supabase__* not available:
- Use Bash: supabase --help
- Use psql commands
- Write SQL migration files manually
```

---

## Anti-Patterns to Avoid

❌ **Don't guess** - If uncertain, research first
❌ **Don't skip testing** - Every phase must be validated
❌ **Don't continue with failures** - Fix before proceeding
❌ **Don't pollute main context** - Use sub-agents for exploration
❌ **Don't make assumptions** - Verify with research
❌ **Don't skip documentation** - Document decisions and plans
❌ **Don't rush** - Systematic > Fast
❌ **Don't ignore unknowns** - Research gaps immediately

---

## Execution Checklist

Before starting:
- [ ] Understand the task completely
- [ ] Research unknowns using sub-agents
- [ ] Use Sequential Thinking for complex planning
- [ ] Create phase plan with TodoWrite

During execution:
- [ ] Work one phase at a time
- [ ] Test immediately after each phase
- [ ] Fix failures before proceeding
- [ ] Document decisions
- [ ] Use sub-agents to preserve context

After completion:
- [ ] Full test suite passes
- [ ] All phases validated
- [ ] Documentation complete
- [ ] Final report provided

---

## Example Usage

```
/go Implement OAuth2 authentication with Supabase
```

**What happens:**
1. Sequential Thinking: Plan OAuth2 approach
2. Task (Explore): Find existing auth patterns in codebase
3. grep GitHub: Real-world OAuth2 + Supabase examples
4. TodoWrite: Create phased plan
5. Phase 1: Setup Supabase auth - TEST - ✅
6. Phase 2: Implement auth flow - TEST - ✅
7. Phase 3: Add protected routes - TEST - ✅
8. Phase 4: Integration tests - TEST - ✅
9. Final validation: All tests pass
10. Report: Complete implementation summary

**Result:** Systematically researched, planned, implemented, and validated OAuth2 authentication with full test coverage and documentation.

---

## Remember

**Research → Plan → Execute → Test → Validate → Document**

This is not just a command - it's a methodology for rigorous software development.

Let's begin with Phase 0: Understanding & Research.
