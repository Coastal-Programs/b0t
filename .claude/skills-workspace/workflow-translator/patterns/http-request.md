# Pattern: HTTP Request

Both platforms have a generic "make an HTTP call" node. Map to
`utilities.http.request`.

## n8n source

```json
{
  "type": "n8n-nodes-base.httpRequest",
  "parameters": {
    "url": "https://api.example.com/items",
    "method": "POST",
    "sendBody": true,
    "bodyParameters": { "parameters": [{ "name": "id", "value": "={{$json.id}}" }] },
    "sendHeaders": true,
    "headerParameters": { "parameters": [{ "name": "Authorization", "value": "Bearer ..." }] }
  }
}
```

## Make.com source

```json
{
  "module": "http:ActionSendData",
  "mapper": {
    "url": "https://api.example.com/items",
    "method": "post",
    "data": "{\"id\":\"{{1.id}}\"}",
    "headers": [{ "name": "Authorization", "value": "Bearer ..." }]
  }
}
```

## Odin target

```yaml
- id: call-api
  module: utilities.http.request
  outputAs: call
  inputs:
    url: "https://api.example.com/items"
    method: POST
    headers:
      Authorization: "Bearer ..."
    body:
      id: "{{trigger.id}}"
```

## Rules

- **Never substitute** — if the source uses Perplexity's REST API directly,
  keep it as `utilities.http.request` against Perplexity. Don't swap to an
  AI-SDK call just because Odin has one.
- If the source uses auth headers with literal API keys, leave a TODO in
  the YAML so the user provides a credential ref instead.
- `headers` and `body` in Odin are flat objects, not n8n's
  `{parameters: [{name, value}]}` shape.
