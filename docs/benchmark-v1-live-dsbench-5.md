# Live Atlassian benchmark V1 — DSBENCH-5 (first paired observation)

**Date of reporting:** 2026-11-19; exact wall-clock run timestamp not recorded.  
**Source:** two browser-visible scoped benchmark outputs supplied by the project owner.  
**Issue:** [DSBENCH-5](https://one-atlas-mezt.atlassian.net/browse/DSBENCH-5) — Payment health probe update.  
**Input:** service `payment-gateway`, new endpoint `/health`, deployment `Planned`.  
**Gold case:** BMK-105, corpus annotation revision **1.1**; **2 relevant contextual documents**, no relevant procedure-to-review annotations.  
**Environment:** Forge Development **v2.9.0**, as confirmed by the user's previous deployment log.  
**Controlled scope:** `space = "DSBMK" AND ancestor = 5177345`, with a maximum of 10 body-read attempts per variant.

## Observed measurements

| Measurement | B0 scoped | B1 scoped |
| --- | ---: | ---: |
| Planned CQL searches | 1 | 1 |
| Executed CQL searches | 1 | 1 |
| Succeeded / failed searches | 1 / 0 | 1 / 0 |
| Search family | m1_service_token | service_identity |
| Search duration | 540 ms | 293 ms |
| Readable documents | 4 | 3 |
| Relevant context documents among read pages (gold) | 2/2 | 2/2 |
| Irrelevant documents among read pages (gold) | 2 | 1 |
| Gold-relevant share among read pages (diagnostic ratio only) | 2/4 | 2/3 |
| End-to-end duration | 1,140 ms | 1,018 ms |

## Exact observed sets and gold roles

| Synthetic document | B0 | B1 | Frozen BMK-105 gold |
| --- | --- | --- | --- |
| Payment Gateway Rollback Procedure (`10002`) | Read | Read | Relevant **context**, incompatible `no` |
| Payments Platform Architecture (`10003`) | Read | Read | Relevant **context**, incompatible `unknown` |
| Payment Gateway Recovery Runbook (`10001`) | Read | Read | **Not relevant** |
| Legacy API Archive (Historical Only) (`10015`) | Read | Not returned | **Not relevant** |

The historical single-token search `payment` was independently preflighted against the corpus and returned these four pages; the service identity `payment-gateway` search returned the latter set of three excluding the archive. **The live browser output** supports that difference too.

## Interpretation

**Both engines retrieved 2/2 annotated contextual documents.** B1 made **one** CQL request, the same count as B0, and surfaced **one fewer irrelevant document**. That is a **case-specific reduction of one unnecessary page read (4 -> 3)** without losing gold-relevant context.

The retrieved recovery runbook (`10001`) is **not relevant** to BMK-105 under its fixed gold, despite sharing the payment service. This illustrates why service identity alone is not a relevance decision.

The source ticket declares a **Planned** health-probe change. `/health` is generic and cannot establish service identity by itself, and a retrieved older API path or rollback instruction **does not establish a current operational drift**. The benchmark UI is retrieval-only and did not classify drift.

The 122 ms end-to-end and 247 ms CQL timing differences are **single observations**, so no latency improvement or API-cost generalization follows. The total API-call budget is not yet enforced, and raw CQL hit ranks/selection-exclusions are not exported by the public panel.

## Next check

Keep B1 v2.9.0 frozen. Re-run B1 after the B1.1 extractor is integrated to confirm it does not create `endpoint_new` CQL on generic `/health` or misclassify `Planned` changes as incompatible. Evaluate actual relevance and investigation workflow only as a later, separate stage.
