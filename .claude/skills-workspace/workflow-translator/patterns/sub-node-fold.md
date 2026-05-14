# Pattern: n8n LangChain Sub-Node Folding

n8n's LangChain agent nodes use auxiliary "sub-nodes" attached via non-`main`
connections (e.g. `ai_languageModel`, `ai_tool`, `ai_memory`). These appear
as separate nodes in `nodes[]` but aren't directly in the linear flow.

## Detection

A node is a sub-node if its only connection to the main flow is via a key
other than `main` in some other node's `connections` entry — typically
`ai_languageModel`, `ai_tool`, `ai_outputParser`.

```json
"connections": {
  "Claude 3.5": {
    "ai_languageModel": [[{ "node": "AI Agent", "type": "ai_languageModel", "index": 0 }]]
  },
  "AI Agent": {
    "main": [[{ "node": "Send Email", "type": "main", "index": 0 }]]
  }
}
```

Here, `Claude 3.5` configures `AI Agent` — it isn't its own step.

## Resolution

Fold sub-node config into the parent's `inputs`:

```yaml
- id: ai-agent
  module: ai.ai-sdk.generateText
  outputAs: agent
  inputs:
    provider: anthropic          # from the Claude 3.5 sub-node
    model: claude-3-5-sonnet-20241022
    system: "..."                # from the parent node parameters
    prompt: "..."
```

## Rules

- The deterministic translator does NOT fold sub-nodes — it emits them as
  separate steps. If you see two consecutive steps where one is a "model"
  config and the next is the actual agent call, fold them.
- `ai_tool` sub-nodes become entries in a `tools:` array on the agent step.
- `ai_outputParser` sub-nodes become a `schema:` on the agent step (switch
  module to `ai.ai-sdk.generateJSON`).
- Never leave a bare "model config" step in the output — Odin has no
  notion of "configure the model, then call it" as two steps.
