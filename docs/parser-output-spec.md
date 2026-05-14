# Parser Output Specification — Optimized for YAML Conversion

The parser markdown output needs to answer these questions in order:

1. **What does this workflow do?** (1 paragraph — I decide if I understand it)
2. **What's the shape?** (flow diagram — I see the execution path)
3. **What services/credentials are needed?** (table — I know what to wire up)
4. **What does each step do and what does it need?** (per-step cards — I write the YAML)
5. **What are the prompts?** (separate section — long content doesn't clutter the step cards)
6. **What are the unknowns?** (warnings — I know what needs manual decisions)

---

## Section 1: Summary

One paragraph. What the workflow does in plain English. Generated from trigger type + node types + connection flow.

```markdown
# Outreach Prep

**Summary:** Scheduled weekly (Sun 11pm), pulls unanalysed leads from Google Sheets, loops through each one: scrapes their LinkedIn profile and posts via Apify, researches their company via Perplexity AI, analyses the prospect with O3-Mini (system fragmentation, pain points, WAVE framework), generates a 3-email cold sequence with O3-Mini, injects timezone/sender/opt-out data, pushes the lead to Instantly API, and updates the Google Sheet with results.

**Trigger:** `cron` — `0 23 * * SUN`
**Nodes:** 18 | **Loop:** Yes (splitInBatches)
```

## Section 2: Flow

Same as current but cleaner. Show the execution path with step types inline.

```markdown
## Flow

Schedule Trigger [cron]
  → Get Rows [google-sheets: read, filter: Analysed=No]
    → Limit [limit to N items]
      → Loop Over Items [batch loop]
        ├─ BRANCH A (scrape → research → AI → emails):
        │   → Scrape Profile [http: POST apify linkedin-profile-scraper]
        │   → Scrape Posts [http: POST apify linkedin-post]
        │   → Transform Apify Data [javascript: merge profile+posts+sheet data]
        │   → Perplexity Research [perplexity: company research]
        │   → Analyse Prospect [openai: o3-mini, see PROMPT-1]
        │   → Generate Emails [openai: o3-mini, see PROMPT-2]
        │   → Set Email Fields [set: extract email1/2/3 from JSON]
        │   → (merge back)
        ├─ BRANCH B (after merge):
        │   → Add Timezone [javascript: AU timezone from location]
        │   → Add Sender Email [javascript: rotate sender]
        │   → Add Opt-Out Token [javascript: random 6-digit token]
        │   → Push to Instantly [http: POST instantly.ai/leads]
        │   → Update Google Sheet [google-sheets: appendOrUpdate]
        │   → Wait 30s
        │   → (loop back)
```

## Section 3: Services & Credentials

Quick reference table. What external services are used and what auth they need.

```markdown
## Services & Credentials

| Service | Used By | Credential Type | Notes |
|---------|---------|-----------------|-------|
| Google Sheets | Get Rows, Update Sheet | googleSheetsOAuth2Api | Doc: `1C5ufCuDoOy6MOvYu-nFAyQ6LplEuT_K-yS3Oay6i_ag` |
| Apify (LinkedIn) | Scrape Profile, Scrape Posts | API key (query param) | Token in URL params |
| Perplexity | Research | perplexityApi | Model: sonar |
| OpenAI | Analyse, Emails | openAiApi | Model: o3-mini |
| Instantly | Send Lead | httpHeaderAuth | POST to api.instantly.ai |
```

## Section 4: Steps

Each step gets a compact card. The goal: I can write the YAML step directly from this card.

**Key rules:**
- NO raw N8N expressions. Translate them to plain English data references.
- NO dumping full params blobs. Only the params I need to write the YAML.
- Code blocks summarized (what it does + what it returns), full code in appendix only if complex.
- AI prompts referenced by ID (PROMPT-1, PROMPT-2), full text in Section 5.

```markdown
## Steps

### 1. Get Rows — `data.google-sheets.getRows`
- **Sheet:** `1C5ufCuDoOy6MOvYu-nFAyQ6LplEuT_K-yS3Oay6i_ag` / Sheet1
- **Filter:** Where `Analysed` = `No`
- **Produces:** Array of row objects with fields: First Name, Last Name, Email Address, Phone Number, Country, Location, Industry, Company Name, Company Size, Company Technologies, Company Revenue, Founded Year, Job Title, Seniority, Website URL, LinkedIn URL

### 2. Limit — no Odin equivalent
- **What:** Limits to first N items from Get Rows
- **Decision needed:** Use JS step to slice array, or just set maxRecords on the sheets call?

### 3. Loop Over Items — `forEach` control flow
- **What:** Processes each lead one at a time
- **Batch size:** 1
- **Contains steps 4-14**

### 4. Scrape Profile — `utilities.http.httpRequest`
- **Method:** POST
- **URL:** `https://api.apify.com/v2/acts/supreme_coder~linkedin-profile-scraper/run-sync-get-dataset-items`
- **Auth:** Query param `token` = Apify API key
- **Body:** `{ "urls": [{ "url": "<LinkedIn URL from current lead>" }] }`
- **Reads from:** Current loop item → `LinkedIn URL`
- **Produces:** LinkedIn profile object (name, headline, summary, positions, skills, etc.)

### 5. Scrape Posts — `utilities.http.httpRequest`
- **Method:** POST
- **URL:** `https://api.apify.com/v2/acts/supreme_coder~linkedin-post/run-sync-get-dataset-items`
- **Auth:** Query param `token` = Apify API key
- **Body:** `{ "urls": ["<LinkedIn URL>"], "limitPerSource": 30, "deepScrape": true }`
- **Reads from:** Current loop item → `LinkedIn URL`
- **Produces:** Array of post objects (text, postedAt, reactions, etc.)

### 6. Transform Apify Data — `utilities.javascript.execute`
- **What:** Merges scraped profile + posts + original sheet data into a single structured object
- **Reads from:** Scrape Profile output, Scrape Posts output, current loop item (sheet row)
- **Produces:** `{ linkedin_profile_details_data: {...}, last_30_days_posts_transformed: [...], google_sheet_data: {...} }`
- **Full code:** See APPENDIX-CODE-1

### 7. Perplexity Research — needs manual mapping (no Odin module)
- **What:** Researches the company using Perplexity AI search
- **Model:** sonar
- **System prompt:** See PROMPT-1
- **User prompt template:** Company name, website, industry, size, technologies, location from Transform step
- **Produces:** Research text about company's tech stack, operations, growth signals

### 8. Analyse Prospect — `ai.ai-sdk.generateText`
- **Model:** o3-mini (via OpenAI)
- **System prompt:** See PROMPT-2 (6757 chars — WAVE Framework business analyst)
- **User prompt:** Contact info + LinkedIn profile + tech stack + Perplexity research + recent posts
- **Reads from:** Transform Apify Data (all fields), Perplexity output
- **Produces:** Structured analysis (personalization hooks, pain points, solution scale, email positioning guidance)

### 9. Generate Emails — `ai.ai-sdk.generateText`
- **Model:** o3-mini (via OpenAI)
- **System prompt:** See PROMPT-3 (4334 chars — cold email sequence generator)
- **User prompt:** Prospect first name, company, analysis output
- **Reads from:** Transform Apify Data (first_name, company), Analyse output
- **Produces:** JSON `{ email1: {subject, body}, email2: {body}, email3: {body} }`
- **Note:** Output is JSON string, needs parsing

### 10. Set Email Fields — `utilities.javascript.execute`
- **What:** Extracts email1/2/3 from the AI JSON response
- **Reads from:** Generate Emails output (parsed JSON)
- **Produces:** Flat object with email1.subject, email1.body, email2.body, email3.body, email3.subject

### 11. Add Timezone — `utilities.javascript.execute`
- **What:** Maps Australian location to IANA timezone
- **Reads from:** Current loop item → Location field
- **Produces:** Adds `Time Zone` field (e.g., "Australia/Perth")
- **Full code:** See APPENDIX-CODE-2

### 12. Add Sender Email — `utilities.javascript.execute`
- **What:** Rotates through sender email addresses
- **Logic:** Round-robin from array of 4 sender emails
- **Produces:** Adds `Sender Email` field

### 13. Add Opt-Out Token — `utilities.javascript.execute`
- **What:** Generates random 6-digit token for opt-out tracking
- **Produces:** Adds `token` field (6-digit number)

### 14. Push to Instantly — `utilities.http.httpRequest`
- **Method:** POST
- **URL:** `https://api.instantly.ai/api/v2/leads`
- **Auth:** httpHeaderAuth
- **Body:** Lead data (email, name, company, phone, LinkedIn, location, industry, token, email1/2/3 content)
- **Reads from:** All accumulated fields from steps 10-13

### 15. Update Google Sheet — `data.google-sheets.updateRow` (or appendOrUpdate)
- **Sheet:** Same as step 1
- **Updates:** LinkedIn URL, Research Report (Perplexity output), Email#1-3 bodies/subjects, Sender Email, Time Zone, Token
- **Match on:** Row identity from loop item
- **Decision needed:** Odin has `updateRow` and `addRow` — which matches appendOrUpdate?

### 16. Wait — `utilities.delay`
- **Duration:** 30 seconds
- **Purpose:** Rate limiting between Apify/Instantly API calls
```

## Section 5: AI Prompts

Full prompts in their own section, referenced by ID. This keeps step cards compact but preserves all detail.

```markdown
## AI Prompts

### PROMPT-1: Perplexity Research (system)
<full system prompt text>

### PROMPT-2: Analyse Prospect (system)
<full system prompt text — the 6757 char one>

### PROMPT-2-USER: Analyse Prospect (user template)
<user prompt with field references translated to Odin variable syntax>

### PROMPT-3: Generate Emails (system)
<full system prompt text>

### PROMPT-3-USER: Generate Emails (user template)
<user prompt template>
```

## Section 6: Code Appendix

Full code blocks for JavaScript steps, referenced by ID.

```markdown
## Code Appendix

### APPENDIX-CODE-1: Transform Apify Data
```javascript
// full code here
```

### APPENDIX-CODE-2: Add Timezone
```javascript
// full code here
```
```

## Section 7: Decisions & Warnings

Things that need human/AI judgment before writing the YAML.

```markdown
## Decisions Needed

1. **Perplexity has no Odin module** — Options: (a) Use `utilities.http.httpRequest` to call Perplexity API directly, (b) Use `ai.ai-sdk.generateText` with a web-search-capable model
2. **Loop pattern** — N8N uses splitInBatches. Odin has `forEach` control flow. Need to structure the loop correctly.
3. **Limit node** — Fold into Google Sheets query (add maxRecords) or add a JS slice step?
4. **appendOrUpdate** — Odin has `updateRow` and `addRow` separately. Since we're updating existing rows, use `updateRow`.
5. **Apify API keys** — Currently hardcoded as query params. Should use Odin credentials system.
6. **Sender email rotation** — Hardcoded email list. Should this be configurable?

## Warnings
- `appendOrUpdate` operation not in mapping table
- `n8n-nodes-base.limit` — no direct Odin equivalent
- `n8n-nodes-base.splitInBatches` — maps to forEach control flow
- `n8n-nodes-base.perplexity` — no Odin module exists
```

## Section 8: Data Shape Reference

Quick reference for what the trigger/first step produces — so I know what fields are available downstream.

```markdown
## Data Shapes

### Google Sheet Row (input)
Fields: First Name, Last Name, Email Address, Phone Number, Country, Location, Industry, Company Name, Company Size, Company Technologies, Company Revenue, Founded Year, Job Title, Seniority, Website URL, LinkedIn URL, Analysed

### Transform Apify Data (output)
```json
{
  "linkedin_profile_details_data": {
    "full_name", "first_name", "last_name", "headline", "location",
    "about", "job_title", "company", "skills": [], "experiences": [], "educations": []
  },
  "last_30_days_posts_transformed": [{ "user_post", "posted" }],
  "google_sheet_data": {
    "first_name", "last_name", "email", "phone", "country", "location",
    "industry", "company_name", "company_size", "company_technologies",
    "company_revenue", "founded_year", "job_title", "seniority", "website_url", "linkedin_url"
  }
}
```
```

---

## Why This Structure Works

1. **Summary first** — I know what I'm building before reading details
2. **Flow diagram** — I see the shape and branching at a glance
3. **Services table** — I know all external dependencies upfront
4. **Step cards are actionable** — each one maps directly to a YAML step, with "Reads from" and "Produces" clearly stated
5. **Prompts separated** — long AI prompts don't clutter the step cards. I reference them by ID when writing the YAML.
6. **Code in appendix** — same principle. Summary in the card, full code when I need it.
7. **Decisions explicit** — unknowns are called out, not buried in warnings at the bottom
8. **Data shapes** — I know what fields are available without scrolling through sample data tables
