# Live Atlassian benchmark V1 — DSBENCH-1 (first paired observation)

**Date:** 2026-11-19 (date of reporting; exact run timestamps not supplied)  
**Source:** two complete scoped benchmark panels pasted by the project owner.  
**Jira issue:** DSBENCH-1 — Migrate payment gateway to API v2  
**Confluence scope:** `space = "DSBMK" AND ancestor = 5177345` (15 synthetic pages; benchmark-only scope).  
**Corpus annotation revision:** 1.1.  
**Forge development version:** 2.9.0, previously confirmed successfully deployed.  
**Implementation commit:** `219747f06c7a21ebec730de181823e8f91e7303a` (main at deployment preparation).  
**Run identity:** not captured; user-supplied first paired observation, not independent evaluator output.

## Observed browser-visible results

| Measurement | B0 (scoped) | B1 (scoped) |
| --- | ---: | ---: |
| Configured maximum body reads | 10 | 10 |
| Planned CQL queries | 1 | 3 |
| Executed CQL queries | 1 | 3 |
| Successful CQL queries | 1 | 3 |
| Failed CQL queries | 0 | 0 |
| Authorized readable documents shown | 4 | 4 |
| End-to-end elapsed | 1,627 ms | 1,613 ms |
| Sum of reported CQL durations | 519 ms | 749 ms |

B1 query families and durations: `endpoint_old` 223 ms, `service_identity` 317 ms, `endpoint_new` 209 ms. These are **distinct discovery routes**, with no assumption of independence.

## Retrieved pages and frozen gold interpretation

| Document (public synthetic corpus) | B0 read | B1 read | BMK-101 relevance gold | Gold instruction incompatibility |
| --- | --- | --- | --- | --- |
| Payment Gateway Recovery Runbook | Yes | Yes | Relevant, procedure to review | Yes, subject to later qualification logic |
| Payment Gateway Rollback Procedure | Yes | Yes | Relevant, procedure to review | No (old endpoint is for rollback only) |
| Payments Platform Architecture | Yes | Yes | Relevant, context | No |
| Legacy API Archive (Historical Only) | Yes | Yes | Not relevant | Not applicable |

Under these *synthetic, single-case, controlled* gold annotations, both variants retrieved 3 of 3 relevant expected documents among the four readable pages, for a **3/3 case-specific relevant-document retrieval coverage** and **3/4 relevant-document fraction among shown pages**. This is not downstream drift-classification performance, a permission-sensitive production precision result, or a generalized recall claim.

The runbook was associated with B1 paths `endpoint_old`, `service_identity`; rollback and architecture also appeared through `endpoint_new`. The signals may be correlated.

## Interpretation and limits

1. Both variants completed the live scoped request successfully and recovered the same documents. **No incremental retrieval coverage advantage for B1 is observed on DSBENCH-1.**
2. With only four shown pages and a read cap of ten, this case does not stress ranking or candidate selection.
3. B1's additional CQL calls do not prove improved recall. Their aggregate measured query duration was greater than B0's single query, while end-to-end latency differed by only 14 ms in B1's favor; **one paired observation is insufficient for a latency improvement claim**. Repeat runs in alternating order.
4. Only successful/usable documents are included in the browser report; the raw list of hits, candidate exclusions and versions were **not** captured here. Complete stage-loss attribution requires a separate developer-only evaluation trace.
5. Forge v2.9.0 is known from the user's deployment log, not from a live Forge metadata query. Jira/Confluence content version stamps and exact run times were not included in the panel output.
6. Do not use BMK-103/106 for full-fidelity benchmark interpretation until the native Jira components `Voyager Scheduler` / `Settlement Core` are created and attached.
7. Do not confuse the scoped benchmark with the separate future **unscoped zero-configuration** trial. Permissions for a second principal have not yet been validated.

## Next experiment

Run **DSBENCH-2** with the same two scoped buttons and record planned/executed searches, readable pages and timings. Its Jira narrative mentions the old settlement path and hostname in free prose. The current deterministic profiler may fail to extract them because it expects explicit key/value lines; this is a hypothesis to test, not a confirmed live outcome. If it fails, separate the **Jira signal-extraction issue** from the known **Confluence hostname tokenization issue** (the exact old endpoint path has been found via CQL in previous manual checks).

Then run at least two additional alternating B0/B1 pairs for DSBENCH-1 if latency comparisons are required.
