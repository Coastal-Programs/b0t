# Context

## Current State
Plan finalized. Ready to create tasks.

## Key Findings
- Gmail Auto-Labeling has 10 steps, settings dialog only shows 3 (trigger + 2 AI steps)
- Steps have: `id`, `module`, `inputs`, `outputAs`, optional `name`, optional `when` condition
- `name` field is preserved from YAML in DB config but unused in UI
- `extractConfigurableSteps()` in settings dialog filters to only steps with tunable fields
- No flow visualization libraries installed — building with pure Tailwind
- Settings dialog is ~900 lines, heavily coupled — needs careful refactoring

## What's Done
- Task 1 (001b7c01): Step card component ✅
- Task 2 (cc9e89d7): Pipeline view component ✅  
- Task 3 (ef1c5efa): Settings dialog refactor ✅
- Task 4 (dff225e2): Simplify/compact the visual — in progress

## What's Next
- Task 4 executing: Compact non-configurable steps to single rows, hide raw when expressions, remove module paths and outputAs, shorten connectors
- After that: Review the result, see if further polish needed
