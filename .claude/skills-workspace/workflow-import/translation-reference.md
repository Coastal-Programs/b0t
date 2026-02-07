# Translation Reference

Quick reference for converting N8N/Make.com workflows to Odin.

## Trigger Mappings

| Source | N8N Type | Make Type | Odin Trigger |
|--------|----------|-----------|--------------|
| Manual | `manualTrigger` | N/A | `trigger: manual` |
| Schedule | `scheduleTrigger` | N/A | `trigger: cron` |
| Webhook | `webhook` | `gateway:CustomWebHook` | `trigger: webhook` |
| Gmail | `gmailTrigger` | N/A | `trigger: gmail` |
| Outlook | N/A | `outlook:watchEmails` | `trigger: outlook` |

## Common Action Mappings

### AI/ML
- N8N `@n8n/n8n-nodes-langchain.anthropic` → `ai.ai-sdk.generateText` (provider: anthropic)
- N8N `openAi` → `ai.ai-sdk.generateText` (provider: openai)
- Make `openai:createCompletion` → `ai.ai-sdk.generateText`

### Communication
- N8N `gmail` send → `communication.gmail.sendEmail`
- N8N `gmail` addLabels → `communication.gmail.addLabels`
- N8N `slack` → `communication.slack.sendMessage`
- Make `gmail:sendEmail` → `communication.gmail.sendEmail`
- Make `slack:sendMessage` → `communication.slack.sendMessage`

### Data/Storage
- N8N `airtable` → `data.airtable.*`
- N8N `googleSheets` → `data.google-sheets.*`
- Make `airtable:ActionSearchRecords` → `data.airtable.searchRecords`
- Make `googleSheets:addRow` → `data.google-sheets.appendRow`

### Utilities
- N8N `code` (JavaScript) → `utilities.javascript.execute`
- N8N `httpRequest` → `utilities.http.request`
- Make `util:SetVariables` → `utilities.javascript.execute`
- Make `http:ActionSendData` → `utilities.http.request`

### Control Flow
- N8N `if` → ⚠️ Use `utilities.javascript.execute` with conditional logic
- N8N `switch` → ⚠️ Ask user: multiple workflows or JavaScript routing
- Make `builtin:BasicRouter` → ⚠️ Ask user: multiple workflows or JavaScript routing

## Variable Syntax

| Platform | Syntax | Odin Equivalent |
|----------|--------|-----------------|
| N8N | `={{ $json.field }}` | `"{{triggerOrStepOutput.field}}"` |
| N8N | `={{ $('NodeName').item.json.field }}` | `"{{stepOutputAs.field}}"` |
| Make | `{{1.field}}` (module 1) | `"{{step1Output.field}}"` |
| Make | `{{email}}` (variable) | `"{{trigger.body.email}}"` |

## Special Cases

### N8N Text Classifier → Odin AI Classification

N8N:
```json
{
  "type": "@n8n/n8n-nodes-langchain.textClassifier",
  "parameters": {
    "inputText": "={{$json.text}}",
    "categories": {
      "categories": [
        {"category": "Spam", "description": "..."},
        {"category": "Important", "description": "..."}
      ]
    }
  }
}
```

Odin:
```yaml
- module: ai.ai-sdk.generateJSON
  inputs:
    prompt: |
      Classify this text: {{input.text}}

      Categories:
      - Spam: ...
      - Important: ...

      Return the category name.
    model: claude-3-5-haiku-20241022
    provider: anthropic
    schema:
      type: object
      properties:
        category:
          type: string
          enum: ["Spam", "Important"]
```

### Make.com Router → Odin Multiple Workflows

Make:
```json
{
  "module": "builtin:BasicRouter",
  "routes": [
    {"filter": {"conditions": [[{"a": "{{status}}", "b": "new"}]]}},
    {"filter": {"conditions": [[{"a": "{{status}}", "b": "returning"}]]}}
  ]
}
```

Odin: Split into 2 workflows or use JavaScript:
```yaml
- module: utilities.javascript.execute
  inputs:
    code: |
      if (status === "new") {
        return { route: "new", ...data };
      } else {
        return { route: "returning", ...data };
      }
```
