# Pattern: Polling / Watch Triggers

Airtable / Gmail / Outlook "watch" triggers — they wake up on a schedule,
look for new items, and run once per item.

## Critical rule

**NEVER map a polling trigger to `manual`.** Use the matching trigger type:

| Source                                       | Odin trigger |
|----------------------------------------------|--------------|
| `n8n-nodes-base.airtableTrigger`             | `airtable`   |
| `n8n-nodes-base.gmailTrigger`                | `gmail`      |
| `n8n-nodes-base.microsoftOutlookTrigger`     | `outlook`    |
| `airtable:TriggerWatchRecords` (Make.com)    | `airtable`   |

## Required config

### Airtable

```yaml
trigger: airtable
airtableConfig:
  baseId: appXXXXXXXXXXXXXX
  tableId: tblXXXXXXXXXXXXXX
  triggerField: Created      # field that changes when a record becomes "new"
  # optional:
  view: viwXXXXXXXXXXXXXX
  formula: "AND(...)"
```

### Gmail

```yaml
trigger: gmail
gmailPollInterval: 60        # seconds — 60 for everyMinute, 300 for slower
gmailFilters:
  q: "is:unread"             # optional gmail query
```

### Outlook

```yaml
trigger: outlook
outlookPollInterval: 60
```

## Inside the workflow

The trigger emits one item per run. Reference it as `{{trigger.<field>}}` —
never `{{trigger.body.<field>}}` (that's the webhook shape).
