---
description: Set active package focus and initialize workflow
argument-hint: [package-path]
---

# Current Focus
Package: $ARGUMENTS

This is the active package within the larger project. Explore and understand this package before taking any action.

## Workflow

### 1. Context Preservation
Spawn sub-agents (Task tool) for exploration, research, and validation. Keep orchestration in main thread.

### 2. Systematic Execution
- Plan in discrete phases using TodoWrite
- Complete each phase fully before proceeding
- Run validation after each phase (build, tests, lint)
- Mark phases complete as you finish them

### 3. Investigation First
Read and understand relevant files before proposing changes. Do not speculate about code you have not inspected.

### 4. Structured Reasoning
Use Sequential Thinking MCP (mcp__sequential-thinking__sequentialthinking) for complex problem-solving. It outperforms built-in thinking on agentic workflows (+54% on benchmarks) by providing:
- Auditable step-by-step reasoning
- Ability to revise and branch thoughts
- Better performance on multi-tool chains and policy-heavy scenarios

## Available MCP Tools
- **Grep** - Search GitHub for real-world code patterns
- **Supabase** - Database, migrations, edge functions
- **Serena** - Semantic code analysis, symbol navigation
- **Sequential Thinking** - Structured problem decomposition for complex tasks

---

## Your Task
Begin by exploring the package structure at the path above. Use the Task tool with the Explore agent to understand the codebase before proceeding with any work.
