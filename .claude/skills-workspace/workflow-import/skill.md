---
name: workflow-import
description: "Import N8N and Make.com workflows by understanding what they do and rebuilding them in Odin format. Use when the user wants to migrate, import, or convert workflows from N8N (.json) or Make.com (.blueprint.json) into Odin."
argument-hint: [workflow-file-path] [client-name]
---

# Workflow Import - Understand & Rebuild

Import N8N and Make.com workflows by analyzing business logic and rebuilding in Odin.

## Core Concept

**Don't convert JSON → JSON. Instead:**
1. Read the workflow file
2. Understand what it does (business logic)
3. Handle platform differences
4. Use workflow-generator to rebuild in Odin

**This is more robust than direct conversion.**

## Critical Platform Difference

⚠️ **N8N/Make.com use BRANCHING** (if X then run step Y, else skip)
⚠️ **Odin uses SEQUENTIAL execution** (all steps run in order)

**Impact:** Workflows with conditional logic may need:
- Multiple separate Odin workflows
- JavaScript-based conditional execution
- Simplified logic

---

## Workflow

### 1. Read & Identify Platform

Ask for file path if not provided:
```
"Please provide the path to your N8N (.json) or Make.com (.blueprint.json) workflow file."
```

Read file and identify platform:
- **N8N**: Has `nodes` array and `connections` object
- **Make.com**: Has `flow` array with `module` fields

### 2. Analyze Workflow

Extract these key elements:

**Purpose:**
- Read workflow `name` and `description`
- Identify the main goal

**Trigger Type:**
- Manual, Webhook, Cron, Gmail, Outlook, etc.
- Note polling intervals if applicable

**Main Actions:**
- List each step in plain English
- Track data flow between steps
- Note which services/APIs are used

**AI Classification Nodes (VERY IMPORTANT):**
- N8N: `@n8n/n8n-nodes-langchain.textClassifier`
- Make.com: Usually custom logic or routers
- **Extract the category descriptions** - they contain the decision logic!
- **Identify cascading classifiers** - classifier → classifier chains
- **Check connections** - which nodes run after classification?

Example N8N pattern:
```json
{
  "type": "@n8n/n8n-nodes-langchain.textClassifier",
  "parameters": {
    "categories": {
      "categories": [
        {"category": "Spam", "description": "Promotional emails, marketing..."},
        {"category": "Important", "description": "Urgent requests, deadlines..."}
      ]
    }
  }
}
```
→ Maps to Odin `ai.ai-sdk.generateJSON` with schema

**Conditional Logic (Traditional IF/ELSE):**
- `n8n-nodes-base.if` nodes (true/false branches)
- `n8n-nodes-base.switch` nodes (multi-way branches)
- `builtin:BasicRouter` in Make.com
- Document conditions being evaluated
- **Distinguish from AI classifiers** - these are rule-based, not AI

**Output:**
- What does the workflow return?
- JSON, email sent, database update, etc.

See [analysis-guide.md](analysis-guide.md) for detailed extraction patterns.

### 3. Handle Decision Logic

**CRITICAL: Distinguish AI classification from traditional branching!**

#### AI Classifiers (Common in N8N) → Direct Conversion ✅

If using `textClassifier` or similar AI nodes:

**Pattern: Single AI classifier**
```
textClassifier(categories) → route by category
```
→ Odin: `ai.ai-sdk.generateJSON` with category enum schema

**Pattern: Cascading AI classifiers**
```
textClassifier(main categories) → if Category X → textClassifier(sub-categories)
```
→ Odin: Two sequential `ai.ai-sdk.generateJSON` calls with conditional execution

**Extract category descriptions** - they contain the decision criteria!

Example conversion:
```yaml
# Step 1: Main classification
- module: ai.ai-sdk.generateJSON
  inputs:
    prompt: "Classify: {{email.subject}}"
    schema:
      type: object
      properties:
        category:
          enum: ["Spam", "Important", "Newsletter"]

# Step 2: Sub-classification (only if needed)
- module: utilities.javascript.execute
  inputs:
    code: |
      if (mainCategory.category === "Important") {
        return { needsSubClassification: true };
      }
```

#### Traditional Branching (IF/ELSE/ROUTER) → Ask User ⚠️

If using traditional `if`, `switch`, or `router` nodes:

**Use AskUserQuestion to decide approach:**

```typescript
AskUserQuestion({
  questions: [{
    question: "This workflow has traditional if/else branching. How should I handle this?",
    header: "Approach",
    multiSelect: false,
    options: [
      {
        label: "Single workflow with JavaScript conditionals (Recommended)",
        description: "Build one workflow. Use JavaScript for conditional logic."
      },
      {
        label: "Multiple focused workflows",
        description: "Split into separate workflows. More accurate but requires manual triggering."
      },
      {
        label: "Best effort conversion",
        description: "Let me decide the best approach and explain tradeoffs after."
      }
    ]
  }]
})
```

### 4. Build Requirements Document

Create plain-language summary:

```markdown
# Workflow: [Name]

## Purpose
[1-2 sentence description]

## Trigger
When: [Manual/Webhook/Cron/Gmail/etc.]
[Details: polling interval, webhook data, etc.]

## Steps

1. [First action in plain English]
   - Service: [What service/API]
   - Action: [What it does]
   - Data: [What data it uses]

2. [Second action]
   - Service: [...]
   - Action: [...]
   - Data: [...]

[Continue for all steps]

## Conditional Logic (if any)
- If [condition], then [action]
- Route [data type] to [different handler]

## Output
Returns: [Description of output]
Format: [JSON/Email/etc.]

## Required Credentials
- [Service 1]: [OAuth/API key]
- [Service 2]: [Credential type]

## Conversion Notes
- [Platform differences]
- [Simplified features]
- [Limitations]
```

### 5. Invoke workflow-generator

Pass requirements to workflow-generator:

```typescript
Skill(
  skill: "workflow-generator",
  args: "[brief description for client]"
)
```

When workflow-generator asks questions:
- Provide trigger type from analysis
- Provide output format from analysis
- Describe each step in plain English
- Let workflow-generator handle module selection and YAML

### 6. Report Results

After workflow-generator completes:

```markdown
✅ **Workflow imported successfully!**

**Original:** [N8N/Make.com name]
**Odin:** [New workflow name]
**Client:** [Organization name]

### What was converted:
- ✅ [Feature 1]
- ✅ [Feature 2]

### What was simplified:
- ⚠️ [Conditional logic → JavaScript wrapper]
- ⚠️ [Complex branching → Linear flow]

### What wasn't converted:
- ❌ [Feature that requires separate workflow]

### Next steps:
1. Set up credentials: [List required]
2. Test the workflow with sample data
3. [Any additional setup needed]
```

---

## Common Patterns

### Pattern 1: Email Automation (Linear)
**N8N/Make:** Trigger → Classify → Label → Archive
**Odin:** ✅ Direct conversion (no branching)

### Pattern 2: Conditional Processing (Branching)
**N8N/Make:** Trigger → If(condition) → {Action A | Action B}
**Odin:** ⚠️ Needs JavaScript wrapper or multiple workflows

### Pattern 3: Multi-Route (Complex Branching)
**N8N/Make:** Trigger → Router → {Route 1 | Route 2 | Route 3}
**Odin:** ⚠️ Best as multiple workflows or simplified logic

---

## Key Translation Patterns

### Triggers
- `n8n-nodes-base.scheduleTrigger` → `trigger: cron`
- `n8n-nodes-base.webhook` → `trigger: webhook`
- `n8n-nodes-base.gmailTrigger` → `trigger: gmail`
- `gateway:CustomWebHook` → `trigger: webhook`

### Common Actions
- Email operations → `communication.gmail.*`
- AI generation → `ai.ai-sdk.generateText`
- Database operations → `data.*`
- Custom logic → `utilities.javascript.execute`

See [translation-reference.md](translation-reference.md) for complete mappings.

---

## When to Ask for Clarification

Ask user if:
- ❓ Workflow has complex conditional logic (multiple if/else chains)
- ❓ Business purpose is unclear from JSON structure
- ❓ Multiple valid approaches exist (linear vs multiple workflows)
- ❓ Data transformations have specific requirements

**Example:**
```
"This workflow has a 3-way router based on email type. Should I:
1. Build 3 separate Odin workflows (one per route)
2. Build 1 workflow with JavaScript conditional logic
3. Simplify to handle the most common case?"
```

---

## Troubleshooting

**If workflow-generator fails:**
- Simplify requirements (remove advanced features)
- Break into smaller workflows
- Check module availability with `npm run modules:search`

**If conversion loses functionality:**
- Document what was simplified
- Offer to build separate workflow for missing features
- Explain platform limitations clearly

---

## Remember

**You are a workflow analyst, not a code converter.**

Your job:
- ✅ Understand business logic
- ✅ Extract clear requirements
- ✅ Handle platform differences gracefully
- ✅ Set realistic expectations
- ✅ Let workflow-generator handle Odin specifics

Not your job:
- ❌ Direct JSON-to-JSON conversion
- ❌ Preserving every technical detail
- ❌ Making impossible conversions work
- ❌ Hiding platform limitations

**Be honest about what can and can't be converted!**
