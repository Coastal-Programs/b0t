# Workflow Ingestion — Reference Guide

Reference material for converting N8N and Make.com workflows to Odin format. For the current plan and system status, see **WORKFLOW.md**.

---

## Expression Translation

### N8N → Odin

| N8N Expression | What It Means | Odin Equivalent |
|---|---|---|
| `={{ $json.fieldName }}` | Current node's input data | `{{previousStep.fieldName}}` or `{{trigger.fieldName}}` |
| `={{ $('NodeName').item.json.field }}` | Output from a specific named node | `{{stepId.field}}` (where stepId = slugified NodeName) |
| `={{ $input.first().json.field }}` | First item from input | `{{previousStep.field}}` (Odin doesn't batch) |
| `={{ $json["field name"] }}` | Field with spaces | `{{previousStep.field_name}}` (normalize the key) |
| `={{ $json.fields['First Name'] }}` | Airtable field with spaces | `{{trigger.fields.First Name}}` |
| `={{ $now }}` | Current datetime | Use `utilities.datetime.now` step |
| `={{ $execution.id }}` | Workflow run ID | `{{workflowId}}` (closest equivalent) |
| `={{ $env.VAR_NAME }}` | Environment variable | Not supported — must be hardcoded or use credentials |
| `={{ $json.items.map(i => i.name).join(', ') }}` | Inline JS in expression | Extract to a `utilities.javascript.execute` step |

### Make.com → Odin

| Make Expression | What It Means | Odin Equivalent |
|---|---|---|
| `{{1.field}}` | Output from module at position 1 | `{{step1.field}}` |
| `{{2.body.data[0].id}}` | Nested field from module 2 | `{{step2.body.data[0].id}}` or extract via JS step |
| `{{ifempty(1.field, "default")}}` | Fallback value | Extract to JS step: `field \|\| "default"` |
| `{{formatDate(1.date, "YYYY-MM-DD")}}` | Format date | Use `utilities.datetime.formatDate` step |
| `{{length(1.items)}}` | Array length | Extract to JS step: `items.length` |

---

## Code Node Translation

N8N code nodes contain full JavaScript. Handle them in order:

1. **Read the code** — understand what it does (don't just copy it)
2. **Check if Odin has a module** — e.g., string manipulation → `utilities.string-utils.*`, date formatting → `utilities.datetime.*`
3. **If custom logic** → use `utilities.javascript.execute` with:
   - Code in the `code` field
   - All referenced variables passed via `context:` mapping
   - The sandbox does NOT have access to `trigger`, `previousStep`, etc. without explicit `context:`

### Common patterns:

| Code Pattern | Odin Alternative |
|---|---|
| `items.filter(i => i.json.status === 'active')` | `utilities.filtering.filter` or JS step |
| `items.map(i => ({ name: i.json.name }))` | `utilities.transform.mapFields` or JS step |
| `return [{ json: { ...items[0].json, processedAt: new Date() } }]` | JS step with context mapping |
| `const response = await fetch(url)` | `utilities.http.httpRequest` step |
| `JSON.parse(items[0].json.body)` | `utilities.json-transform.parse` or JS step |

---

## Make.com Structural Patterns

Make.com has different structural patterns than N8N:

| Make Pattern | Odin Equivalent |
|---|---|
| **Router** (fan-out to branches with filter conditions) | `when` guards on steps |
| **Iterator** (BasicFeeder — loop over arrays) | `forEach` control flow |
| **Aggregator** (collect items back to single array) | JS step that builds array |
| **Error handler** (attached to specific modules) | `optional: true` on the step |
| **Scheduler** (builtin:BasicScheduler) | `trigger: cron` |

---

## Trigger Type Mapping (Critical)

**Rule: If the source workflow fires automatically, the Odin trigger must also fire automatically. Only use `manual` if the source was truly a manual/button trigger.**

| N8N Trigger | Odin Trigger Type |
|---|---|
| `airtableTrigger` (polling) | `airtable` |
| `gmailTrigger` (polling) | `gmail` |
| `microsoftOutlookTrigger` (polling) | `outlook` |
| `scheduleTrigger` (cron) | `cron` |
| `webhook` / `webhookTrigger` | `webhook` |
| `telegramTrigger` | `telegram` or `chat` |
| `manualTrigger` | `manual` |
| `executeWorkflowTrigger` | `manual` (sub-workflow) |

---

## Open Source Resources

### Useful for reference:

| Project | What It Has | Use For |
|---------|------------|---------|
| **FlowEngine** (`FlowEngine-cloud/mcp-n8n-workflow-builder-flowengine`) | 600+ N8N node types database | Expanding node coverage beyond ~150 |
| **n8n-as-code** (`EtienneLescot/n8n-as-code`) | Full AST parser for N8N JSON | Reference for parser improvements |
| **n8n-workflow** (npm) | Canonical TypeScript types for N8N nodes | Type definitions, graph traversal |
| **czlonkowski/n8n-mcp** | Workflow validator, node similarity matching | Validation ideas |

### Not found anywhere:

- No open-source Make.com blueprint parser exists. We build from scratch.
- No cross-platform workflow converter exists. Odin's approach is novel.

---

## Test Workflows

**N8N (8 files in `n8n-workflows/`):**
| File | Nodes | Lines | Key Features |
|------|-------|-------|-------------|
| `spritz-and-co-wet-tax.json` | 23 | 224 | Already Odin format, Shopify→Xero→Airtable |
| `Airtable 30min Follow up Email.json` | 7 | 524 | Email templates, IF branch, Cal.com links |
| `Gmail Labeling.json` | 16 | 636 | AI classifiers, 8+ branches, Google Drive |
| `Blog Content Generator.json` | 15 | 723 | 4 Anthropic AI calls, 5 tool code nodes |
| `outreach-system/Lead Outreach Agent.json` | 12 | 456 | Telegram bot, AI agent with tools |
| `outreach-system/Lead Research Agent.json` | 23 | 984 | Apify, Perplexity, 3 AI passes |
| `outreach-system/Outreach Prep.json` | 18 | 1960 | Batch loop, 2 AI passes, Instantly API |
| `outreach-system/Lead Scraper Tool.json` | 18 | 1080 | Apify APIs, merge/switch logic |

**Make.com (4 files in `make.com workflows/`):**
| File | Lines | Key Features |
|------|-------|-------------|
| `GBP Instagram Post.blueprint.json` | 553 | Smallest, good for parser dev |
| `Wedding Enquires Send Brosure.blueprint.json` | 689 | Email workflow |
| `Helicopter Landing Agreement.blueprint.json` | 1299 | Complex business logic |
| `Record Event Booking times.blueprint.json` | 3936 | Largest, batch processing |
