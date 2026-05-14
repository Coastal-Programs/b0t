# Workflow Pipeline Visualization

## Goal
Replace the current workflow settings dialog with a full pipeline visualization that shows ALL steps in the workflow — not just the configurable ones. Users should be able to see the complete flow of their workflow, understand what each step does, and still edit configurable steps inline.

## Current State
- `workflow-settings-dialog.tsx` only shows steps with configurable fields (AI steps with prompts, etc.)
- For a 10-step Gmail workflow, users only see 3 sections: Trigger, Step 2 (AI), Step 5 (AI)
- Steps 1, 3, 4, 6-10 are completely invisible
- System prompts that are already configured show up as empty-feeling form fields rather than readable content
- No sense of flow/pipeline — just stacked collapsible sections

## Approach
Build a new **Workflow Pipeline View** component that replaces the settings dialog content with a visual step-by-step flow. Two deliverables:

### 1. Pipeline Flow Visualization (new component)
A vertical pipeline showing all steps connected by flow lines:
- Each step rendered as a card with: step name/ID, module path, key metadata
- Visual connectors (vertical lines/arrows) between steps
- Conditional steps (`when`) shown with a condition badge
- Configurable steps have an "Edit" expand that shows the existing settings fields inline
- System prompts displayed as readable preview text (truncated), not empty textareas
- Color/style differentiation by step type: trigger, AI, action, condition, JavaScript

### 2. Integration
- Replace the settings dialog body with the pipeline view
- Keep the same dialog shell (header, save/cancel buttons)
- Keep all existing save logic intact
- Trigger config still editable at the top

## Affected Files
- `src/components/workflows/workflow-settings-dialog.tsx` — Refactor to use pipeline view
- `src/components/workflows/workflow-pipeline-view.tsx` — NEW: the pipeline visualization
- `src/components/workflows/workflow-step-card.tsx` — NEW: individual step card component

## Key Design Decisions
- Pure CSS/Tailwind — no external flow library (React Flow, etc.) needed for a vertical read-only pipeline
- Show ALL steps, not just configurable ones
- Use step `name` field if available, otherwise generate readable name from module path
- System prompt and other pre-filled values shown as readable content by default, editable on click/expand
- Conditional steps (`when`) get a visual indicator showing the condition
