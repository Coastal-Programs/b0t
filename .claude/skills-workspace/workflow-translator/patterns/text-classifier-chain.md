# Pattern: Text Classifier (single level)

## Source shape — n8n

```json
{
  "type": "@n8n/n8n-nodes-langchain.textClassifier",
  "parameters": {
    "inputText": "={{$json.subject}}",
    "categories": {
      "categories": [
        {"category": "Urgent", "description": "Time-sensitive requests"},
        {"category": "Spam", "description": "Promotional emails"}
      ]
    }
  }
}
```

## Odin target

```yaml
- id: classify
  module: ai.ai-sdk.generateJSON
  inputs:
    provider: anthropic
    model: claude-3-5-haiku-20241022
    prompt: |
      Classify the following input:
      {{trigger.subject}}

      Categories:
      - Urgent: Time-sensitive requests
      - Spam: Promotional emails

      Return ONLY the category name.
    schema:
      type: object
      properties:
        category:
          type: string
          enum: ["Urgent", "Spam"]
      required: ["category"]
  outputAs: classify
```

## Notes

- The deterministic translator (`translate-n8n.ts`) already handles this case.
  You should only revisit it when the parameters look unusual (no `categories`
  array, dynamic categories, etc.).
- **NEVER substitute the provider** — if the source uses OpenAI, keep OpenAI.
  Default to `anthropic` only when the source had no model attached.
- Downstream nodes connected only to a specific output branch become a
  cascading classifier (see `cascading-classifier.md`).
