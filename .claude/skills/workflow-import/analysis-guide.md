# Workflow Analysis Guide

Detailed patterns for analyzing N8N and Make.com workflows.

## N8N AI Classification Patterns (CRITICAL!)

### Text Classifier - Single Level

```json
{
  "type": "@n8n/n8n-nodes-langchain.textClassifier",
  "name": "Categorize Email",
  "parameters": {
    "inputText": "={{$json.subject}}",
    "categories": {
      "categories": [
        {
          "category": "Urgent",
          "description": "Time-sensitive requests, deadlines, emergencies"
        },
        {
          "category": "Spam",
          "description": "Marketing emails, promotions, newsletters"
        }
      ]
    }
  }
}
```

**Extract:**
1. Input: `inputText` field (what's being classified)
2. Categories: Array of category names
3. **Descriptions** (CRITICAL): Contains decision criteria!
4. Model: Check if specified (usually Claude/GPT)

**Maps to Odin:**
```yaml
- module: ai.ai-sdk.generateJSON
  inputs:
    prompt: |
      Classify this email subject: {{trigger.subject}}

      Categories:
      - Urgent: Time-sensitive requests, deadlines, emergencies
      - Spam: Marketing emails, promotions, newsletters
    model: claude-3-5-haiku-20241022
    provider: anthropic
    schema:
      type: object
      properties:
        category:
          type: string
          enum: ["Urgent", "Spam"]
      required: ["category"]
```

### Text Classifier - Cascading (Two Levels)

```json
// First classifier
{
  "type": "@n8n/n8n-nodes-langchain.textClassifier",
  "name": "Main Category",
  "parameters": {
    "categories": {
      "categories": [
        {"category": "Finance", "description": "..."},
        {"category": "Personal", "description": "..."}
      ]
    }
  }
}

// Second classifier (connected only to Finance output)
{
  "type": "@n8n/n8n-nodes-langchain.textClassifier",
  "name": "Invoice Type",
  "parameters": {
    "inputText": "={{$json.subject}}\n{{$json.hasAttachments}}",
    "categories": {
      "categories": [
        {
          "category": "Invoice to Pay",
          "description": "Bills FROM vendors with PDF attached..."
        },
        {
          "category": "Not an Invoice",
          "description": "Everything else..."
        }
      ]
    }
  }
}
```

**Check connections object!** Second classifier only runs if first returns "Finance".

**Maps to Odin:**
```yaml
# Main classification
- module: ai.ai-sdk.generateJSON
  id: main-category
  inputs:
    prompt: "..."
    schema:
      properties:
        category:
          enum: ["Finance", "Personal"]
  outputAs: mainCat

# Conditional sub-classification
- module: utilities.javascript.execute
  id: check-if-finance
  inputs:
    code: |
      return { isFinance: category === "Finance" };
    context:
      category: "{{mainCat.category}}"
  outputAs: needsSub

# Invoice detection (only if Finance)
- module: ai.ai-sdk.generateJSON
  id: invoice-check
  inputs:
    prompt: "..."
    schema:
      properties:
        invoiceType:
          enum: ["Invoice to Pay", "Not an Invoice"]
  outputAs: invoiceType
```

## N8N Analysis Patterns

### Trigger Identification

```json
// Schedule Trigger
{
  "type": "n8n-nodes-base.scheduleTrigger",
  "parameters": {
    "rule": {"interval": [{"field": "hours", "hoursInterval": 1}]}
  }
}
→ Odin: trigger: cron, schedule every hour

// Gmail Trigger
{
  "type": "n8n-nodes-base.gmailTrigger",
  "parameters": {
    "filters": {},
    "pollTimes": {"item": [{"mode": "everyMinute"}]}
  }
}
→ Odin: trigger: gmail, poll every 60 seconds
```

### Variable Extraction

N8N variables: `={{ $json.fieldName }}` or `={{ $('NodeName').item.json.field }}`

Map to Odin: `"{{outputAs.field}}"`

### Conditional Nodes

```json
{
  "type": "n8n-nodes-base.if",
  "parameters": {
    "conditions": {
      "boolean": [{"value1": "={{$json.status}}", "value2": "active"}]
    }
  }
}
```

This creates branching - ask user how to handle.

## Make.com Analysis Patterns

### Module Identification

```json
{
  "module": "airtable:ActionSearchRecords",
  "mapper": {
    "base": "appXXX",
    "table": "Contacts"
  }
}
→ Odin: data.airtable.searchRecords
```

### Router Nodes

```json
{
  "module": "builtin:BasicRouter",
  "mapper": {},
  "routes": [
    {"filter": {"conditions": [[{"a": "{{status}}", "b": "new"}]]}},
    {"filter": {"conditions": [[{"a": "{{status}}", "b": "existing"}]]}}
  ]
}
```

This is multi-branch routing - likely needs multiple Odin workflows.

## Common N8N Nodes → Odin Modules

| N8N Node | Odin Module |
|----------|-------------|
| `n8n-nodes-base.airtable` | `data.airtable.*` |
| `@n8n/n8n-nodes-langchain.anthropic` | `ai.ai-sdk.generateText` (provider: anthropic) |
| `n8n-nodes-base.openAi` | `ai.ai-sdk.generateText` (provider: openai) |
| `n8n-nodes-base.gmail` | `communication.gmail.*` |
| `n8n-nodes-base.code` | `utilities.javascript.execute` |
| `n8n-nodes-base.slack` | `communication.slack.*` |
| `n8n-nodes-base.httpRequest` | `utilities.http.request` |

## Common Make.com Modules → Odin Modules

| Make Module | Odin Module |
|-------------|-------------|
| `airtable:ActionSearchRecords` | `data.airtable.searchRecords` |
| `gmail:sendEmail` | `communication.gmail.sendEmail` |
| `http:ActionSendData` | `utilities.http.request` |
| `util:SetVariables` | `utilities.javascript.execute` |
| `slack:sendMessage` | `communication.slack.sendMessage` |
