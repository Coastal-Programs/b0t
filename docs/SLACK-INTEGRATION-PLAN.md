# Slack Deep Integration Plan

## Status: Not Started
## Priority: High
## Context: Slack app already created at https://api.slack.com/apps with ngrok redirect URL

---

## Current State (What Exists)

- OAuth flow: `src/app/api/auth/slack/authorize/route.ts` + `callback/route.ts`
- Slack module: `src/modules/communication/slack.ts` (postMessage, sendText, uploadFile, addReaction)
- Platform config: `slack` (bot token) + `slack_oauth` (OAuth user token) in `platform-configs.ts`
- Slack app dashboard has redirect URL configured
- User scopes currently requested: `users:read,channels:read,chat:write,files:read` (too limited, needs expanding)

## What Needs Building

### Phase 1: Slack Events Backend (Foundation)

Create 3 new API routes that receive payloads from Slack:

**1. `src/app/api/integrations/slack/events/route.ts`**
- POST handler that receives ALL Slack events
- Must verify Slack signing secret (HMAC-SHA256 with `SLACK_SIGNING_SECRET` env var)
- Must handle Slack's URL verification challenge (`{ "type": "url_verification", "challenge": "..." }`) by returning the challenge string
- Must respond within 3 seconds (acknowledge fast, process async)
- Events to handle: `message.im`, `app_mention`, `app_home_opened`, `reaction_added`, `assistant_thread_started`, `assistant_thread_context_changed`, `link_shared`, `function_executed`
- After verifying, dispatch events to handler functions

**2. `src/app/api/integrations/slack/commands/route.ts`**
- POST handler for slash commands (e.g., `/odin`)
- Same signing secret verification
- Must respond within 3 seconds
- Parse `command`, `text`, `user_id`, `channel_id`, `response_url`, `trigger_id` from form-urlencoded body
- Commands to implement:
  - `/odin run <workflow-name>` -- trigger a workflow by name
  - `/odin status` -- show running workflows
  - `/odin list` -- list available workflows
  - `/odin help` -- show command reference

**3. `src/app/api/integrations/slack/interactions/route.ts`**
- POST handler for button clicks, modal submissions, shortcuts
- Same signing secret verification
- Parse `payload` from form-urlencoded body (it's JSON inside a form field)
- Handle `block_actions` (button clicks), `view_submission` (modal forms), `shortcut` (global/message shortcuts)

### Phase 2: Slash Commands

After Phase 1 events endpoint is live:
1. Register `/odin` command in Slack app dashboard pointing to the commands route
2. Implement command parsing and response logic
3. Use `response_url` for delayed responses (workflow results take time)
4. Use `trigger_id` to open modals for complex interactions (e.g., workflow creation form)

### Phase 3: App Home Dashboard

When user opens the Odin app in Slack, show a dashboard:
- Use `app_home_opened` event to trigger `views.publish` API call
- Show: active workflows count, recent executions (last 5), credential status
- Quick-launch buttons for top workflows
- "Open Odin Dashboard" link to web UI
- Personalized per-user (only show their workflows)
- Update on each open (fresh data)

### Phase 4: Notification Delivery to Slack

Extend the notification system (already built in `src/lib/notifications.ts`):
- Add `slack` channel support to `notification_preferences` table (already has the column structure)
- When creating a notification, check if user has Slack channel enabled
- Send notification as a DM to the user via Slack bot
- Use Block Kit for rich formatting (type icon, title, action button)
- Remove the "Coming soon" text from `src/components/notifications/notification-preferences-dialog.tsx` Slack section
- Add Slack DM toggles matching the email toggles

### Phase 5: AI Agent (Agents & AI Apps)

This is the big one. Make Odin a conversational AI agent inside Slack:
- Enable "Agents & AI Apps" toggle in Slack app dashboard (adds `assistant:write` scope)
- Handle `assistant_thread_started` event: set suggested prompts ("Create a workflow", "Check my workflows", "What can you automate?")
- Handle `message.im` in assistant context: pipe user message to Claude with Odin context
- Use `chat.startStream` / `chat.appendStream` / `chat.stopStream` for streaming responses
- Agent capabilities:
  - Describe a workflow in plain English -> Odin generates it
  - "Run my social media workflow" -> triggers execution
  - "What workflows failed today?" -> queries activity
  - "Show my credentials" -> lists connected accounts
- Requires connecting to existing workflow generation pipeline

### Phase 6: Link Unfurling

When someone pastes an Odin URL in Slack:
- Register domain (e.g., `b0t.dev`) in Slack app Event Subscriptions
- Handle `link_shared` event
- Call `chat.unfurl` with Block Kit showing: workflow name, status, last run, action buttons
- URL patterns to unfurl: `/dashboard/workflows/{id}`, `/dashboard/credentials`

## Scopes to Add on Slack Dashboard

### Bot Token Scopes (add all of these now)
```
assistant:write
chat:write
chat:write.public
commands
channels:read
channels:history
im:read
im:write
im:history
users:read
users:read.email
app_mentions:read
reactions:read
reactions:write
files:read
files:write
links:read
links:write
```

### User Token Scopes (expand from current 4 to these)
```
users:read
channels:read
channels:history
chat:write
files:read
files:write
reactions:read
reactions:write
groups:read
groups:history
im:read
im:write
im:history
search:read
```

Then update `src/app/api/auth/slack/authorize/route.ts` line 109 to request the expanded user_scope list.

### Event Subscriptions (configure after Phase 1 endpoint is deployed)
```
assistant_thread_started
assistant_thread_context_changed
message.im
message.channels
app_home_opened
app_mention
reaction_added
link_shared
function_executed
```

## Env Vars Needed
```
SLACK_CLIENT_ID=xxx          # Already exists
SLACK_CLIENT_SECRET=xxx      # Already exists
SLACK_SIGNING_SECRET=xxx     # NEW - from Slack app Basic Information page
SLACK_BOT_TOKEN=xxx          # Already exists (optional, for bot-level operations)
SLACK_APP_TOKEN=xxx          # NEW - only needed if using Socket Mode (self-hosted/firewall)
```

## Key Technical Constraints
- ALL Slack interactions must respond within **3 seconds** or Slack retries
- Signing secret verification is mandatory for security
- Socket Mode (WebSocket) available for self-hosted deployments behind firewalls (no public URL needed)
- HTTP mode required for Slack Marketplace distribution
- Rate limit: 30,000 events per workspace per app per 60 minutes
- Max 50 slash commands, 5 global shortcuts, 5 message shortcuts per app
- Block Kit: max 50 blocks per message, 100 per modal/home tab

## Implementation Order
1. Events endpoint + signing secret verification
2. Slash commands (`/odin run`, `/odin status`)
3. App Home dashboard
4. Slack notification delivery (extend existing notification system)
5. Interactions handler (buttons, modals)
6. AI Agent (assistant thread handling)
7. Link unfurling
