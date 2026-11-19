# Live Atlassian benchmark V1 — DSBENCH-6 (first paired observation)

**Date reported:** 2026-11-19; exact run timestamp/source version stamps not supplied.  
**Source:** user-pasted scoped Forge Development **v2.9.0** benchmark panels, not a private raw-trace evaluator output.  
**Issue:** [DSBENCH-6](https://one-atlas-mezt.atlassian.net/browse/DSBENCH-6) — Settlement gateway migration.  
**Jira source fidelity:** native component **Settlement Core** (project component ID 10117) attached and independently verified. Old endpoint `/settlement/v1/route`, new `/settlement/v2/route`, deployment declared production.  
**Gold case:** BMK-106, synthetic annotation revision 1.1.  
**Controlled scope:** `space = "DSBMK" AND ancestor = 5177345`, at most 10 page-body read attempts per variant.  
**Permission persona used:** the user with access to the restricted emergency procedure; **limited persona not yet tested**.

## Live browser-visible results

| Measurement | Scoped B0 | Scoped B1 |
| --- | ---: | ---: |
| CQL planned | 1 | 4 |
| CQL attempted | 1 | 4 |
| Successful / failed CQL | 1 / 0 | 4 / 0 |
| CQL families | m1_service_token | endpoint_old, service_identity, component, endpoint_new |
| Observed summed CQL time | 409 ms | 952 ms |
| Authorized usable pages surfaced | 5 | 4 |
| Relevant pages read per frozen BMK-106 gold | 4/4 | 4/4 |
| Relevant procedures-to-review read | 2/2 | 2/2 |
| Irrelevant pages read | 1 | 0 |
| End-to-end elapsed | 1,201 ms | 1,508 ms |
| Execution status | COMPLETE_WITHIN_BUDGET | COMPLETE_WITHIN_BUDGET |

B1 CQL durations: `endpoint_old` 195 ms; `service_identity` 186 ms; `component` 237 ms; `endpoint_new` 334 ms. The query sums do not equal total request duration (Jira reads, body reads, overhead). Query-family coverage is not proof of statistical independence.

## Page-level comparison against frozen gold

| Document | BMK-106 role | B0 read | B1 read | Gold incompatible instruction |
| --- | --- | --- | --- | --- |
| **Orchid Operations Handbook** (10006) | relevant procedure_to_review | yes | yes | yes |
| **Settlement Core Service Home** (10007) | relevant context | yes | yes | no |
| **Settlement Dataflow Architecture** (10008) | relevant context | yes | yes | no |
| **Settlement Emergency Failover Procedure** (10014) | relevant **restricted** procedure_to_review | yes | yes | yes |
| **Legacy API Archive (Historical Only)** (10015) | not relevant | yes | **no** | not_applicable |

## Interpretation

1. With this **authorized user**, both versions retrieve 4/4 expected relevant pages and 2/2 operational procedures. B1 omits the non-relevant historical archive while preserving all four gold positives.
2. The additional selectivity is achieved under **four CQL requests versus one**; it is not a demonstrably lower **total** API cost, particularly when accounting for CQL calls.
3. The restricted procedure appears legitimately for this account. **This does not validate confidentiality.** Run the *same* issue under a distinct limited Atlassian principal, confirm denied page is not readable and not surfaced in UI or public counts, and calculate relevant coverage with the restricted page **removed from that principal's accessible-gold denominator**.
4. Synthetic gold annotates two procedures with incompatible instructions. The displayed Forge test is **retrieval-only**, so **no live drift-classification claim follows** merely from their presence or the gold labels.
5. 307 ms elapsed-time difference is a **single pair of observations**; do not infer a stable speed advantage or degradation.
6. The comparison did not stress the common read cap of ten, and the public panel does not expose raw candidate ranking, exclusions or a fixed total-request-budget score.

## Next experiment

- Validate user-specific retrieval and metadata redaction as a limited Atlassian user; do not expose denied content or candidate identity.
- Retest B1 after any narrative-profiler integration without changing the unchanged B1 comparator, to check regressions.
- Separately evaluate a total API-call budget and at least one crowded case in which candidate pages exceed ten.
