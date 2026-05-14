# Pattern: Make.com `builtin:BasicRouter`

Multi-branch routing. Each route has a filter (the condition) and a chain
of modules.

## When you'll hit this

`translate-make.ts` emits this exact warning:

> Router node id N — Make.com has K routes. ASK USER how to handle.

The translator leaves a placeholder `utilities.javascript.execute` step with
the route filters in the comment so the LLM resolve phase can read them.

## Always ask the user

```typescript
AskUserQuestion({
  questions: [{
    question: "Make.com BasicRouter with K routes detected. How should I handle this?",
    header: "Router",
    multiSelect: false,
    options: [
      {
        label: "Multiple workflows (one per route) — RECOMMENDED",
        description: "Most accurate. Each route becomes its own Odin workflow with its own trigger."
      },
      {
        label: "One workflow with JS branching",
        description: "Keep as one workflow. JS evaluates the filter; downstream steps use `when:`."
      },
      {
        label: "Simplify to the primary route",
        description: "Take the first/most-used route only. Discard the rest. ONLY use if user confirms losing the other routes."
      }
    ]
  }]
})
```

## Multi-workflow output

If the user picks multiple workflows, emit:

```
plans/<original>-route-<routeName>.yaml
```

Each file gets the trigger + the chain of modules from that route. The
slash command should call `build-workflow-from-plan.ts` once per file.

## Never silently flatten

The default placeholder the translator emits is `utilities.javascript.execute`
with a TODO. If you leave that in place, the workflow runs but ignores the
routing logic — that's a regression. Always resolve the placeholder before
moving to the build phase.
