# Benchmark V1 — Atlassian seeding plan (NOT EXECUTED)

**Status (2026-11-19):** Confluence **15/15 pages created** under a dedicated synthetic corpus parent in DSBMK; one private page has independently verified `VIEW_RESTRICTED` state and creator-only update grant. **Jira project creation remains blocked by connector capabilities; 0/6 test tickets created.**  
**Tenant provided by project owner:** `https://one-atlas-mezt.atlassian.net`  
**Target Confluence space key:** `DSBMK`  
**Space overview supplied:** `https://one-atlas-mezt.atlassian.net/wiki/spaces/DSBMK/overview?homepageId=5013747`  
**Space homepage ID:** `5013747` (verified by authenticated Confluence read; space id `5013508`).  
**Baseline corpus:** `fixtures/benchmark-v1/corpus.synthetic.json` (six scenarios, fifteen pages, 90 annotations, corpus annotation revision 1.1).  
**Frozen engine:** `090e74f` and v2.8.0 Forge development.

## Principle: seed source materials, never seed answers into the app

**Page bodies:** use only `documents[].title` and `documents[].body`, not `annotations`, `positives`, relevance labels, family names, scenario IDs, or success criteria.

**Ticket descriptions:** use `scenarios[].issue.fields.summary`, `description`, and components when the target project supports them. No benchmark gold labels in Jira issue text. Do not make runbook linkage mandatory.

**No production records:** all source materials are entirely invented. Never copy customer tickets or confidential operations content.

**Avoid benchmark leakage:** keep synthetic labels and mapping in a developer-only evaluation file. Do not display relevant/irrelevant labels, restricted page IDs, or unselected search hits in the Jira user-facing panel.

## Actual import plan (requires authorized Atlassian write access)

1. **Verify space and Jira project** using the authenticated Atlassian connector. Do not infer a Jira project key from `CLSD-6` without checking creation permission and project suitability.
2. **Create one parent Confluence page** beneath the verified DSBMK homepage, e.g. `DriftSignal Benchmark V1 — Synthetic Corpus`. Check before creating to avoid duplicate parents. Keep its text neutral so benchmark hints do not contaminate search results.
3. **Create the fifteen child pages** with their original synthetic titles and HTML bodies, no benchmark prefixes in titles. Use the connector's supported content representation; where conversion is required, verify text and headings survived. Record each returned page ID and page version.
4. **Apply access restrictions for synthetic `10014`**, the `Settlement Emergency Failover Procedure` test page, then verify as an authorized and limited reader. Its contents are synthetic, but a real permissions test demands genuinely different Atlassian identities/access, not two artificial labels.
5. **Create six test Jira tickets** in a verified dedicated or authorized project, using the original summaries/descriptions. Components must actually exist (or be explicitly recorded as unavailable). The user can choose a separate test project if the current Jira project is unsuitable.
6. **Store the mapping** `syntheticPageId -> actualConfluencePageId` and `syntheticTicketKey -> actualJiraIssueKey` in a **private local evaluator artifact**, not the public repository or user-visible panel. Record source page versions and read permissions for each test persona.
7. **Verify corpus**: retrieve 15 pages and six tickets with the authorized test identity, review normalized text and ADF, ensure the Confluence link/text nature of BMK-103 remains as designed, then run permission checks separately.
8. **Run baseline B0/B1 paired**, under the same persona and 10-read cap, collecting actual search calls, Jira/body reads, failures, stop reasons, and repeated timings. The fixed total-API-call comparison must wait until the request accounting and enforcement are implemented.

**Do not create pages or tickets until connected-write access and project selection are confirmed.** Avoid creating duplicate objects on retries. If an attempt partially fails, retain created IDs and retry only missing items.

## Actual progress and indexability checks

- Created 15 distinct synthetic pages in Confluence space DSBMK under the synthetic corpus parent; 15/15 were visible in a controlled CQL space listing to the creator, in addition to the homepage, parent and automatically generated template pages. Their **actual IDs belong to a private evaluation mapping**, not this public document.
- Created private `Settlement Emergency Failover Procedure` with the `private` create option. Verified `VIEW_RESTRICTED` by reading Confluence restriction state; explicit grant was creator `update`. **The limited persona has not yet been tested in a separate Atlassian session.**
- Confirmed at least one uploaded document's HTML headings/text survive a full Confluence read.
- CQL probes with `space = "DSBMK"` (initial results, same authorized principal):
  - `title ~ "Orchid"` → 1 expected runbook
  - `title ~ "Queue Worker Recovery Guide"` → 1 expected runbook
  - `text ~ "payment-gateway"` → 3 pages
  - `text ~ "/settlement/v1/route"` → 2 pages
  - `text ~ "legacy-settle.example.internal"` → **0 pages**, even though the string appears in the synthetic text
  - `text ~ "legacy-settle"` → **0 pages**
  - `text ~ "Voyager Scheduler"` → 1 service catalog page
- Interpret CQL results cautiously: Confluence tokenization and asynchronous indexing are genuine confounders. A literal hostname miss does not mean the page is unreadable or impossible to find through the old endpoint.
- Jira project `CLSD` belongs to a legal service desk, and is deliberately not repurposed. **Do not use the connector's `createProject` tool to create Jira project**: it creates an Atlassian Projects (Atlas) entity, not a Jira software project. The available Atlassian plugin does not expose Jira project creation. Manual Jira UI setup is required before connector-based ticket import.
- Reverify six Jira source field values, especially component **Voyager Scheduler** for BMK-103 and **Settlement Core** for BMK-106. Jira components require actual component records; do not silently omit them or substitute text labels.
- Before the first live comparative trial, implement identical CQL scope for both B0 and B1 and a 10-read limit for both in a **benchmark-only execution path**. The current Forge v2.8.0 B0 production diagnostic still has a different read budget and unscoped searches.

## Scenario-to-ticket mapping

| Synthetic key | Split | Ticket type |
| --- | --- | --- |
| BMK-101 | Development | Structured payment migration |
| BMK-102 | Development | Natural-language settlement migration |
| BMK-103 | Development | Indirect scheduler runbook reference |
| BMK-104 | Development | Deliberately insufficient evidence |
| BMK-105 | Reserved validation | Generic health endpoint / context |
| BMK-106 | Reserved validation | Permissions-sensitive settlement case |

**Expected limitations before the first live run:**
- These synthetic descriptions are still shorter and cleaner than many real production tickets.
- BMK-103 contains a **plain-text title reference**, not a Confluence hyperlink. Title-follow-up lookup and graph traversal are different capabilities.
- B1's current panel reports **planned** CQL searches, not counts of successfully executed searches.
- CQL punctuation and exact path matching require live measurement.
- Two roles in JSON are not a substitute for two real Atlassian permission identities.
- B0/B1 may return different page sets and costs; a single run is not a fair performance comparison.

## Acceptance criteria before calling the corpus "live"

- Authenticated read confirms DSBMK identity and the created synthetic parent.
- Fifteen uniquely mapped pages and six uniquely mapped test tickets are retrievable.
- No labels from the gold annotations appear in pages or tickets.
- The restricted page is unreadable to the limited persona and readable to the engineer persona.
- Source versions, content fidelity, and live mapping are saved for a controlled paired run.
- Existing CLSD-6 demo and its historical runbook are unchanged.
