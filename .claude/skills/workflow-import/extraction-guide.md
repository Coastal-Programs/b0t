# Extraction Guide

Patterns for extracting service-specific config, AI models, and sub-node data from N8N workflows.

---

## AI Model & Provider Extraction

N8N AI nodes use sub-nodes for the model. The parent node (agent, classifier, chain) doesn't contain the model — a child sub-node does.

### Anthropic

```json
{
  "type": "@n8n/n8n-nodes-langchain.lmChatAnthropic",
  "parameters": {
    "model": "claude-3-5-haiku-20241022",
    "options": {}
  }
}
```

**Extract:** `model` value. Use as the `model` param on the parent agent/classifier step. Provider is `anthropic`.

### OpenAI

```json
{
  "type": "@n8n/n8n-nodes-langchain.lmChatOpenAi",
  "parameters": {
    "model": "gpt-4o",
    "options": {}
  }
}
```

**Extract:** `model` value. Provider is `openai`.

### OpenRouter

```json
{
  "type": "@n8n/n8n-nodes-langchain.lmChatOpenRouter",
  "parameters": {
    "model": "anthropic/claude-haiku-4.5",
    "options": {}
  }
}
```

**Extract:** `model` value — must include the vendor prefix (e.g., `anthropic/claude-haiku-4.5`). Provider is `openrouter`.

### Default Model

If no model sub-node is found, default to `claude-3-5-haiku-20241022` with provider `anthropic`.

---

## N8N Sub-Node Patterns

Sub-nodes are connected to a parent node via the `connections` object under non-`main` output types (e.g., `ai_languageModel`, `ai_tool`, `ai_memory`). They are NOT separate workflow steps.

### `lmChatAnthropic` / `lmChatOpenAi` / `lmChatOpenRouter`

**Not a step.** Extract `model` and use it as the `model` param on the parent node's Odin step. See AI model extraction above.

### `memoryBufferWindow`

```json
{
  "type": "@n8n/n8n-nodes-langchain.memoryBufferWindow",
  "parameters": {
    "sessionKey": "={{$json.chatId}}",
    "contextWindowLength": 10
  }
}
```

**Not a step.** Extract `contextWindowLength` (default 5). If the parent is an AI agent, add `memoryWindowSize` to its config. In most Odin conversions, memory is handled by the agent system — note it but don't create a step for it.

### `toolWorkflow`

```json
{
  "type": "@n8n/n8n-nodes-langchain.toolWorkflow",
  "parameters": {
    "name": "Research Company",
    "description": "Looks up company info using web search",
    "workflowId": "abc123"
  }
}
```

**Not a step.** This references an external N8N workflow used as a tool. Extract `name` and `description` — fold the description into the parent agent's `systemPrompt` so the AI knows what capability it had. The actual tool workflow would need separate import.

### `toolCode`

```json
{
  "type": "@n8n/n8n-nodes-langchain.toolCode",
  "parameters": {
    "name": "Extract Emails",
    "description": "Parses email addresses from text",
    "jsCode": "const emails = $input.text.match(/[\\w.-]+@[\\w.-]+/g); return emails;"
  }
}
```

**Not a step** if connected as a sub-node tool. Extract `jsCode` and `description`. If it's a simple utility, inline it as a `utilities.javascript.execute` step. If it's a tool for an AI agent, fold the description into the agent's system prompt.

### Disconnected Tool-Code Nodes

Some N8N workflows have `code` nodes that aren't connected to the main flow — they serve as prompt templates or config holders. Check the `connections` object: if a node has no inbound connections and isn't a trigger, it's likely a template. Extract its content and fold it into the relevant AI step's `systemPrompt` or `prompt` field.

---

## Outlook Operations

| N8N Operation | Odin Module |
|--------------|-------------|
| Send email | `communication.outlook.sendEmail` |
| Get emails | `communication.outlook.getEmails` |
| Get email | `communication.outlook.getEmail` |
| Move email | `communication.outlook.moveEmail` |
| Reply to email | `communication.outlook.replyToEmail` |
| Watch emails (trigger) | trigger type `outlook` with `outlookFilters` |

Outlook params:
- `sendEmail`: `to`, `subject`, `body` (HTML), `cc`, `bcc`
- `getEmails`: `folderId`, `count`, `filter`
- `moveEmail`: `messageId`, `destinationFolderId`
- `replyToEmail`: `messageId`, `body`

---

## Gmail Service Config

Trigger config:
```yaml
trigger:
  type: gmail
  gmailFilters:
    labelIds: ["INBOX"]
    query: "is:unread"
    pollingInterval: 60
```

Operations:
- `communication.gmail.sendEmail`: `to`, `subject`, `body`, `cc`, `bcc`
- `communication.gmail.addLabels`: `emailId` (alias: `messageId`), `labels` (alias: `labelIds`)
- `communication.gmail.getEmails`: `query`, `maxResults`, `labelIds`

OAuth scopes needed: `gmail.modify` for label operations, `gmail.send` for sending, `gmail.readonly` for reading.

---

## Airtable Service Config

Trigger config:
```yaml
trigger:
  type: airtable
  airtableConfig:
    baseId: "appXXXXXXXXXX"
    tableName: "Contacts"
    pollingInterval: 60
```

Operations:
- `data.airtable.selectRecords`: `baseId`, `tableName`, `filterByFormula`, `maxRecords`, `fields`, `sort`
- `data.airtable.findRecord`: `baseId`, `tableName`, `fieldName`, `value`
- `data.airtable.createRecord`: `baseId`, `tableName`, `fields`
- `data.airtable.updateRecord`: `baseId`, `tableName`, `recordId`, `fields`

---

## Telegram Operations

| N8N Operation | Odin Approach |
|--------------|---------------|
| `sendMessage` | `communication.telegram.sendMessage` — params: `chatId`, `text`, `parseMode` |
| Trigger (bot message) | trigger type `telegram` — receives `message.text`, `message.chat.id`, `message.from` |
| `getFile` / download | No native module. Use `utilities.http.request` to call `https://api.telegram.org/bot<token>/getFile?file_id=<id>`, then download from `https://api.telegram.org/file/bot<token>/<file_path>` |

Trigger data shape:
```
{{trigger.message.text}}
{{trigger.message.chat.id}}
{{trigger.message.from.first_name}}
{{trigger.message.voice.file_id}}
```

---

## Voice / Audio Transcription

### Whisper via Odin module

If the platform has a Whisper module:
```yaml
- module: video.whisper.transcribeAudioFromURL
  inputs:
    audioUrl: "{{download_step.fileUrl}}"
    model: "whisper-1"
```

### Whisper via JavaScript fallback

If no native module, use JS with the OpenAI API:
```yaml
- module: utilities.javascript.execute
  inputs:
    code: |
      const response = await fetch("https://api.openai.com/v1/audio/transcriptions", {
        method: "POST",
        headers: { "Authorization": "Bearer " + apiKey },
        body: formData
      });
      return await response.json();
    context:
      apiKey: "{{credential.openai}}"
      audioUrl: "{{download_step.fileUrl}}"
```

### Common pattern: Telegram voice message transcription

1. Receive voice message via Telegram trigger (`trigger.message.voice.file_id`)
2. Get file path via Telegram API (`getFile`)
3. Download audio file
4. Transcribe with Whisper
5. Process transcription text

---

## N8N Expression Patterns

Common expressions and their Odin equivalents:

| N8N Expression | Odin Equivalent |
|---------------|-----------------|
| `={{ $json.field }}` | `{{previousStep.field}}` |
| `={{ $('Node Name').item.json.field }}` | `{{stepOutputAs.field}}` |
| `={{ $json.body.match(/pattern/)[1] }}` | Use JS step to extract |
| `={{ $now.toISO() }}` | Use JS step: `new Date().toISOString()` |
| `={{ $json.items.length }}` | `{{step.items.length}}` or JS step |
| `={{ $if($json.status === "active", "yes", "no") }}` | JS step with conditional |

For complex expressions (regex, date math, array operations), always convert to a `utilities.javascript.execute` step rather than trying to inline them.
