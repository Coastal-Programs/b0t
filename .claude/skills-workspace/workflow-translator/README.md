# Workflow Translator — Reference Material

Read this when running `/import-n8n` or `/import-make` and the deterministic
translator emits `warnings[]` or `unknownNodes[]` — those are the only cases
where you need to make a judgement call.

For each unresolved structural shape, glob the corresponding file in
`patterns/`. Each file describes one transformation: what it looks like on
the source side, what shape it should produce in Odin YAML, and any
boundaries that should be a hard "ask the user" instead of a guess.

```
patterns/
  text-classifier-chain.md         # @n8n/n8n-nodes-langchain.textClassifier (single)
  cascading-classifier.md          # textClassifier → textClassifier chains
  branching-to-sequential.md       # n8n `if` / `switch` flattening
  polling-trigger.md               # Airtable / Gmail / Outlook watch triggers
  basic-router.md                  # Make.com `builtin:BasicRouter`
  http-request.md                  # Raw HTTP requests
  code-step.md                     # n8n `code` and Make.com `util:SetVariables`
  sub-node-fold.md                 # n8n LangChain sub-node connections
```
