# Pattern: Cascading Classifiers

When one `textClassifier` is connected to a second `textClassifier` that only
runs for a specific category from the first.

## Source shape — n8n

```json
// First classifier — Finance / Personal
// Second classifier — Invoice to Pay / Not an Invoice
//                     (connected only to the "Finance" output of the first)
```

The `connections` object distinguishes the two — `Main Category` node's `main`
array has multiple output indices, one per category.

## Odin target

Convert to TWO sequential `ai.ai-sdk.generateJSON` calls with a JS gate
between them:

```yaml
- id: main-category
  module: ai.ai-sdk.generateJSON
  outputAs: mainCat
  inputs:
    schema:
      properties:
        category:
          enum: ["Finance", "Personal"]

- id: gate
  module: utilities.javascript.execute
  outputAs: gate
  inputs:
    code: |
      return { needsSub: mainCat.category === "Finance" };
    context:
      mainCat: "{{mainCat}}"

- id: sub-classify
  module: ai.ai-sdk.generateJSON
  when: "{{gate.needsSub}}"
  outputAs: subCat
  inputs:
    schema:
      properties:
        invoiceType:
          enum: ["Invoice to Pay", "Not an Invoice"]
```

## Decision criteria

- **Two `textClassifier` nodes, connection between them?** → Cascading.
- **Connection is to one specific output index, not 0?** → That branch
  feeds the sub-classifier. The `when:` clause should test that exact value.

## Never substitute

Keep both classifications even if they look redundant. The author wrote two
classifiers for a reason — fewer steps is not a goal.
