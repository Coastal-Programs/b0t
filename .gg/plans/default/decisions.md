# Decisions

## 1. Pure CSS pipeline vs external library
**Decision:** Pure Tailwind CSS vertical pipeline
**Rationale:** We only need a read-only vertical flow. No drag-and-drop, no canvas, no zoom/pan. A vertical list of cards connected by CSS border lines is simpler, faster, and doesn't add a dependency. Can always upgrade to React Flow later if we need an interactive canvas.

## 2. Replace settings dialog vs new separate view
**Decision:** Replace the body of the existing settings dialog
**Rationale:** User wants to see this where they currently go for settings. Keep the same entry point (settings button on card). The dialog just gets better content inside it. Avoids adding a new page/route for now.

## 3. Show pre-filled values as readable content
**Decision:** System prompts and other pre-configured values display as readable text by default, with an edit toggle
**Rationale:** Current UX feels like a setup form. But these workflows are already configured — the user wants to SEE what the prompt says, not fill in an empty field. Click "Edit" to modify.

## 4. Step naming strategy
**Decision:** Use `step.name` if present, otherwise generate from module path (e.g., `communication.gmail.addLabels` → "Add Labels (Gmail)")
**Rationale:** Some workflows have `name` on every step (lead-research-agent), others have none (gmail-labeling). Need a fallback that's still readable.

## 5. All steps expandable with plain English descriptions
**Decision:** Every step is a clickable row that drops down to explain what it does. AI prompts shown as the description. Other steps get auto-generated descriptions.
**Rationale:** User feedback — "Prepare Email, what does that mean?" Steps should be self-explanatory.

## 6. Remove "AI:" prefix, use step IDs for generic AI functions
**Decision:** `generateJSON`, `generateText`, `runAgent` treated as generic names. Fall back to step ID which is always descriptive.
**Rationale:** "AI: Generate JSON" is meaningless. Step ID `classify-primary` → "Classify Primary" describes the purpose.

## 7. Visualization first, editing second
**Decision:** Pipeline is primarily for understanding. "Edit Settings" is a secondary action inside the expanded dropdown.
**Rationale:** User said "I don't necessarily think we need to edit it" — this view explains, editing is secondary.
