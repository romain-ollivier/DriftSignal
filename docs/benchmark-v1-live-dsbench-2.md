# Live Atlassian benchmark V1 — DSBENCH-2 (first paired observation)

**Date:** 2026-11-19 (reported date; exact run timestamps not supplied).  
**Source:** two scoped benchmark panels pasted by the project owner.  
**Issue:** [DSBENCH-2](https://one-atlas-mezt.atlassian.net/browse/DSBENCH-2) — Orchid settlement traffic switched over.  
**Corpus:** synthetic annotation revision **1.1**, 15 Confluence descendant pages in `DSBMK`.  
**Scope:** `space = "DSBMK" AND ancestor = 5177345`.  
**Engine behavior under test:** unchanged deterministic B0/B1 discovery logic, deployed in Forge development **v2.9.0** (previous user deployment record).  
**Code reference:** `219747f06c7a21ebec730de181823e8f91e7303a`.  
**Access profile:** user who ran the panel; separate limited-profile test not performed.

## Observed results

| Measurement | B0 scoped | B1 scoped |
| --- | ---: | ---: |
| Planned CQL | 0 | 0 |
| Attempted CQL | 0 | 0 |
| Successful CQL | 0 | 0 |
| Failed CQL | 0 | 0 |
| Authorized readable pages | 0 | 0 |
| Relevant accessible pages retrieved according to frozen synthetic gold | 0/2 | 0/2 |
| End-to-end duration | 301 ms | 267 ms |
| Report status | COMPLETE_WITHIN_BUDGET | COMPLETE_WITHIN_BUDGET |

B1 additionally reports: *Input lacks discriminating search signals; no retrieval performed*. A completed invocation is **not** a successful discovery. Timing measures **abstention without any Confluence search**, and cannot be interpreted as faster retrieval.

## Root cause: recoverable Jira signals were not extracted

The existing Jira description is:

> We moved the settlement traffic last night. The old route /settlement/v1/route was on legacy-settle.example.internal. Please verify the recovery playbook.

- The source contains an explicit **old route**, `/settlement/v1/route`, and a historical host, `legacy-settle.example.internal`, embedded in prose.
- B0 requires a structured legacy M1 change: it correctly performs no query with this description.
- The B1 deterministic profiler currently anchors `ENDPOINT_RE` and `HOST_RE` on field-style labels such as `Old endpoint:` or `Host:`, and extracts no signals from the narrative.
- B1's query planner therefore receives no usable search signal and generates no CQL. This is a **Jira signal-extraction failure**, not an observed failure of CQL ranking, body reading, or relevance classification.
- The annotation fix for BMK-102 is maintained: **old traffic moved** is NOT equivalent to **old route disabled or incompatible**. Page 10006 remains relevant, with `incompatibleInstruction = unknown`.

## Independent CQL control (not a B1 run)

After the user's observed no-query run, a separate authorized Confluence CQL probe used:

```cql
space = "DSBMK" AND ancestor = 5177345 AND type = page AND text ~ "/settlement/v1/route"
```

The query returned **two pages**:
- `Orchid Operations Handbook`, an annotated **relevant operational procedure** for BMK-102.
- `Settlement Emergency Failover Procedure`, a private page for a **different** scenario. It is not relevant to BMK-102 according to the frozen gold, although the authorized account could read it. Its visibility has not yet been checked for the limited persona.

This control supports the **technical feasibility of route-based discovery** under this tenant's current index. It is **not evidence** that the unmodified B1 found the runbook, nor that its ranking/read-budget handling would succeed on the first attempt after an extractor change. The other annotated relevant BMK-102 page, `Settlement Core Service Home`, was not returned by this path-only query.

Previous manually scoped hostname probes on `legacy-settle.example.internal` and `legacy-settle` returned zero results; Confluence tokenization must therefore be treated independently from Jira extraction.

## Targeted next experiment (not yet implemented)

Implement a **versioned B1 extraction-only variant** that recognizes an explicit narrative pattern such as `old route /... was on ...` with:
- Strict URL-path and hostname validation, bounded lengths and safe normalization; no query parameters, secrets, arbitrary prose or guessed service names.
- `role = old`, with Jira text provenance (exact quote + line/ADF block path) and separate extraction label `narrative_pattern`; never infer `deployed` or `retired` from traffic movement alone.
- No change to the existing query planner, retrieval ranking, read budget, permission filtering, or relevance/drift logic for the first experiment.
- Unit/negative tests for prose in future/conditional/historical contexts, generic endpoints (`/health`), quoted documentation rather than declared changes, malformed hosts/paths and unrelated service mentions.
- Run paired tests before/after with **the same live issue and same descendant-only corpus**, fixed read cap 10, logging actual CQL executed and relevant document identities through authorized read. Test a separate genuinely new narrative to avoid overfitting to the single known example.

Record the code commit and new Forge version before retesting; do not overwrite this **v2.9.0** baseline.

## Interpretation

The failure is diagnostic and actionable, not a validated performance improvement: **B1 v2.9.0 retrieves 0/2 accessible relevant documents on DSBENCH-2, because it never initiates discovery.** The first hypothesis to test is whether extracting the explicit old route can recover the `Orchid Operations Handbook` in a subsequent version.
