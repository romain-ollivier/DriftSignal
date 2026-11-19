# Live Atlassian benchmark V1 — DSBENCH-3 (first paired observation)

**Date reported:** 2026-11-19; exact run timestamp and source version stamps not provided.  
**Source:** user-pasted scoped benchmark panels from Forge Development **v2.9.0**; not a private raw-trace evaluator export.  
**Jira issue:** [DSBENCH-3](https://one-atlas-mezt.atlassian.net/browse/DSBENCH-3) — Voyager scheduler migration.  
**Jira source fidelity:** native component **Voyager Scheduler** (Jira project component ID 10116) was created, attached and independently verified before this run. Description: `Could someone verify our job recovery procedure after the scheduler move?`  
**Gold case:** BMK-103, synthetic corpus annotation revision 1.1.  
**Fixed corpus:** `space = "DSBMK" AND ancestor = 5177345`, 15 descendant pages; maximum 10 body-read attempts per variant.

## Live browser-visible results

| Measurement | Scoped B0 | Scoped B1 |
| --- | ---: | ---: |
| CQL planned | 0 | 1 |
| CQL attempted | 0 | 1 |
| Successful / failed CQL | 0 / 0 | 1 / 0 |
| Query family | none (structured M1 input absent) | component |
| Query execution time | n/a | 689 ms |
| Authorized usable pages surfaced | 0 | 1 |
| Frozen-gold relevant pages surfaced | 0/2 | 1/2 |
| Frozen-gold relevant **operational procedures** surfaced | 0/1 | 0/1 |
| End-to-end elapsed | 541 ms | 1,049 ms |
| Execution status | COMPLETE_WITHIN_BUDGET | COMPLETE_WITHIN_BUDGET |

## Page-level gold comparison

| Confluence document | Role for BMK-103 | B0 read | B1 read | Incompatibility |
| --- | --- | --- | --- | --- |
| **Voyager Scheduler Service Catalog** (synthetic 10012) | relevant context | no | **yes** | `no` |
| **Queue Worker Recovery Guide** (synthetic 10011) | relevant procedure to review | no | **no** | `unknown` |

## Interpretation

1. Native Jira component extraction and CQL execution work: B1 found the right service catalog under the fixed corpus with one successful search. The B0 structured-only historical search correctly did not execute.
2. The catalog is **context**, not the sought operational recovery procedure. The primary operational outcome remains **0/1 expected runbooks found** for both engines; B1's case-specific gain of **one relevant document** should not be presented as discovery of the required procedure.
3. The corpus annotation says the catalog points to the recovery guide; current B1 retrieval performs no verified **second-hop document-relation follow-up**. Thus the failure is consistent with the known single-hop retrieval design, but a causal claim that traversal alone would have succeeded still requires a controlled link/title follow-up test.
4. No compatibility/drift decision was made. The recovery guide's instruction incompatibility annotation is **unknown**.
5. These timings are each single observations and do not demonstrate a stable latency difference.
6. The browser reports only read/usable authorized documents and does not provide raw candidate ranks, full request counts, or a developer-only trace; do not infer stage losses more precisely than the observed catalog-only result.

## Next experiment, separate from B1.1 narrative extraction

Add a **bounded evidence-preserving follow-up** from an authorized service catalog, e.g. a discovered runbook title or vetted linked Confluence page. Validate tenant, ancestry and user permissions **on every follow-up page**. Treat the hint as a candidate, not proof of relevance or outdated instructions; account for its query/read cost in a fixed total-call budget. Test an independent indirect-link service family, not only Voyager.
