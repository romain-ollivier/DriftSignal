# Live Atlassian benchmark V1 — DSBENCH-4 (first paired observation)

**Date of reporting:** 2026-11-19; exact wall-clock run timestamp not recorded.  
**Source:** two browser-visible scoped benchmark outputs supplied by the project owner.  
**Issue:** [DSBENCH-4](https://one-atlas-mezt.atlassian.net/browse/DSBENCH-4) — Review docs.  
**Input:** `Something changed. Please check documentation.`  
**Gold case:** BMK-104, corpus annotation revision **1.1**; **zero annotated relevant documents**.  
**Environment:** Forge Development **v2.9.0**, as confirmed by the user's previous deployment log.  
**Controlled scope:** `space = "DSBMK" AND ancestor = 5177345`, with a maximum of 10 body-read attempts per variant.

## Observed measurements

| Measurement | B0 scoped | B1 scoped |
| --- | ---: | ---: |
| Planned CQL searches | 0 | 0 |
| Attempted CQL searches | 0 | 0 |
| Successful / failed CQL searches | 0 / 0 | 0 / 0 |
| Readable documents returned | 0 | 0 |
| End-to-end duration | 537 ms | 300 ms |
| Report execution status | COMPLETE_WITHIN_BUDGET | COMPLETE_WITHIN_BUDGET |

B1 explicitly displayed **Input lacks discriminating search signals; no retrieval performed**. The B0 historical parser also had no structured service/endpoint declaration.

## Interpretation

**Expected abstention achieved by both variants.** The corpus has no expected relevant pages for BMK-104; neither variant fabricated a Jira technical anchor or consumed Confluence search/body-read requests.

This is an abstention *behavior* test, not a relevance-ranking win or evidence of completeness for other vague tickets. **Zero CQL** is correct here, unlike BMK-102 which contained extractable factual prose but also received zero CQL under v2.9.0.

The 237 ms observed elapsed-time difference is one observation with no Confluence retrieval and must **not** be interpreted as a general performance advantage. `COMPLETE_WITHIN_BUDGET` is execution status, not discovery success.

## Next check

Re-run this case after B1.1 narrative extraction ships, to ensure that speculative signal extraction does not break justified abstention. A second identity / more diverse vague-tickets corpus is still needed for a broader false-positive claim. Preserve v2.9.0 results unchanged.
