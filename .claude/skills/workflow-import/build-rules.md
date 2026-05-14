# Build Rules

Known gotchas from real workflow builds. Read this BEFORE your first build attempt.

---

## YAML Structure

- Steps go at the top level under `steps:`, NOT nested under `config:`. The YAML has three top-level keys: `name`, `trigger`, `steps`.
- Each step is a list item with `module`, `id`, `inputs`, and optionally `outputAs`, `dependsOn`.

```yaml
name: My Workflow
trigger:
  type: cron
  schedule: "0 * * * *"
steps:
  - module: data.airtable.selectRecords
    id: fetch_records
    inputs:
      baseId: "appXXX"
      tableName: "Contacts"
    outputAs: records
```

---

## Step IDs

- Underscores only, no hyphens. `send_email` not `send-email`.
- Must be unique across the workflow.
- Used for `outputAs` references and `dependsOn` declarations.

---

## Trigger Config Field Names

Use the specific field name for each trigger type, NOT a generic `triggerConfig`:

| Trigger Type | Config Field |
|-------------|-------------|
| `airtable` | `airtableConfig` |
| `gmail` | `gmailFilters` |
| `outlook` | `outlookFilters` |
| `cron` | `schedule` |
| `webhook` | (no extra config) |

```yaml
# CORRECT
trigger:
  type: airtable
  airtableConfig:
    baseId: "appXXX"
    tableName: "Contacts"
    pollingInterval: 60

# WRONG
trigger:
  type: airtable
  triggerConfig:
    baseId: "appXXX"
```

---

## Airtable

- Use `tableName` (human-readable name like "Contacts"), NOT `tableId` (tblXXX IDs).
- `selectRecords` takes `filterByFormula` and `maxRecords` — use for search/filter queries.
- `findRecord` takes `fieldName` and `value` — use for single-record lookup by one field.
- `filterByFormula` goes on `selectRecords`, NEVER on `findRecord`.
- `createRecord` and `updateRecord` take `fields` as an object.

---

## Email HTML Templates

- Use YAML `|` block scalar for multiline HTML.
- Escape characters that break YAML parsing: backticks, colons at line start, `#` at line start.
- Do NOT use `>` (folded scalar) — it collapses newlines and breaks HTML.

```yaml
inputs:
  body: |
    <html>
      <body>
        <h1>Hello {{records.fields.Name}}</h1>
        <p>Your appointment is confirmed.</p>
      </body>
    </html>
```

---

## Credential References

Use the `"{{credential.platform}}"` format:

```yaml
inputs:
  credentials: "{{credential.gmail}}"
```

Valid platform values match what's in the credentials table: `gmail`, `outlook`, `slack`, `airtable`, `google-drive`, etc.

---

## AI Modules

- Model IDs must be exact. Common ones:
  - Anthropic: `claude-3-5-haiku-20241022`, `claude-3-5-sonnet-20241022`
  - OpenAI: `gpt-4o`, `gpt-4o-mini`, `o3-mini`
  - OpenRouter: needs vendor prefix like `anthropic/claude-haiku-4.5`, NOT just `claude-haiku-4.5`
- `generateJSON` requires a `schema` with `type: object`, `properties`, and `required`.
- `generateText` returns a string, `generateJSON` returns structured data.
- **`context:` is ONLY for `utilities.javascript.execute`** — do NOT use `context:` on `ai.ai-sdk.*` steps. Instead, reference variables directly in the prompt: `{{outputAs.field}}`. The executor resolves `{{}}` in all string inputs before calling the module.

---

## Google Drive

- Use `uploadFileFromParams`, NOT `uploadFile`. The `uploadFile` function is wrapped in `rateLimit()` which breaks the executor's parameter passing.
- Correct params: `fileName`, `fileContent`, `mimeType`, `parentId` (folder ID).
- NOT: `name`, `fileData`, `folderId`.

---

## Gmail

- Supports param aliases: `messageId` maps to `emailId`, `labelIds` maps to `labels`.
- OAuth scope must include `gmail.modify` for label operations (not just `gmail.readonly`).

---

## Dry-Run Failures

- Dry-run validation fails on trigger data references like `{{trigger.fields.Name}}` because mock data doesn't include those fields. This is expected behavior, NOT a real error.
- If the only errors are from trigger field references in a dry-run, the build is successful.

---

## Build Command

Always use `--skip-import`:

```bash
npx tsx scripts/build-workflow-from-plan.ts plans/my-workflow.yaml --skip-import
```

The orchestrator handles import in a separate layer. Never import from the build step.

---

## NEVER Substitute Services (CRITICAL — #1 Rule)

The import pipeline replicates source workflows **exactly**. Same services, same credentials, same providers.

- If the source uses Perplexity, the output uses Perplexity — not OpenRouter, not a generic HTTP call
- If a module doesn't exist in Odin for a service, **STOP and report the missing module**. Do not silently substitute
- This applies to AI providers, communication services, data platforms — everything
- Only use fallbacks (`utilities.http.httpRequest`, `utilities.javascript.execute`) when the user or orchestrator explicitly approves it

---

## Module Path Lookup

If you're unsure about a module path, search for it:

```bash
npm run modules:search <term>
```

This searches the module registry and returns matching paths. Use exact paths from the results.

---

## Dependencies Between Steps

- Use `dependsOn` when the parallel executor can't auto-detect dependencies (e.g., JS steps that reference variables by bare name instead of `{{template}}` syntax).
- `dependsOn` takes an array of step IDs.

```yaml
- module: utilities.javascript.execute
  id: calculate_tax
  dependsOn: ["fetch_order"]
  inputs:
    code: |
      const total = order.line_items.reduce((sum, item) => sum + item.price, 0);
      return { tax: total * 0.29 };
    context:
      order: "{{fetch_order}}"
```
