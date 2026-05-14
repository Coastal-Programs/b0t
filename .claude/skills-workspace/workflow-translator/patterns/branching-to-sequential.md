# Pattern: n8n `if` / `switch` → Sequential

Odin executes sequentially. n8n `if` and `switch` create true/false (or
multi-way) branches where downstream nodes only run on the matching branch.

## When to use this pattern

The translator emits a warning like:

> Branching node "Filter Important" (n8n-nodes-base.if) — Odin is sequential.

That's your cue.

## Three resolution paths — ASK THE USER

```typescript
AskUserQuestion({
  questions: [{
    question: "This workflow has an n8n IF/Switch branch. How should I handle it?",
    header: "Branching",
    multiSelect: false,
    options: [
      {
        label: "JavaScript gate + `when:` on downstream steps (Recommended)",
        description: "One workflow. JS evaluates the condition; downstream steps use `when:`."
      },
      {
        label: "Split into multiple workflows",
        description: "One workflow per branch. More accurate, more setup."
      },
      {
        label: "Linearize — run all branches in order",
        description: "Only valid if branches are independent side-effects (e.g. logging to two places)."
      }
    ]
  }]
})
```

## JavaScript gate target

```yaml
- id: gate
  module: utilities.javascript.execute
  outputAs: gate
  inputs:
    code: |
      return { matched: status === "important" };
    context:
      status: "{{trigger.status}}"

- id: send-alert
  module: communication.slack.sendMessage
  when: "{{gate.matched}}"
  inputs:
    channel: "#alerts"
    text: "Important: {{trigger.subject}}"
```

## Rules

- Never collapse branches silently — always raise the question.
- If the user chooses "JavaScript gate", apply `when:` to every step that
  was downstream of the matching branch.
- If the user chooses "multiple workflows", produce one YAML file per
  branch, named `<original>-<branch>.yaml`.
