# Pattern: Code / SetVariables

Both platforms have a "run some JavaScript" or "compute these variables"
node. Map both to `utilities.javascript.execute`.

## n8n source

```json
{
  "type": "n8n-nodes-base.code",
  "parameters": {
    "jsCode": "return { upperName: $json.name.toUpperCase() };"
  }
}
```

## Make.com source

```json
{
  "module": "util:SetVariables",
  "mapper": {
    "variables": [
      { "name": "firstName", "value": "{{4.data.blocks[1].value}}" },
      { "name": "lastName", "value": "{{4.data.blocks[2].value}}" }
    ]
  }
}
```

## Odin target

```yaml
- id: vars
  module: utilities.javascript.execute
  outputAs: vars
  inputs:
    code: |
      return {
        firstName: trigger.blocks[1].value,
        lastName: trigger.blocks[2].value,
      };
    context:
      trigger: "{{trigger}}"
```

## Rules

- The translator already converts these. Touch only if the conversion is
  obviously broken (e.g. variable name has whitespace, value is a complex
  Make.com expression the translator couldn't resolve).
- Make.com variable names with trailing whitespace (`"lastName  "`) — trim.
- Downstream references to `{{firstName}}` should resolve to
  `{{vars.firstName}}` after the translator runs.
