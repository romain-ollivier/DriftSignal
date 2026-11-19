# DriftSignal — B1 Observability + Realistic Benchmark V1

**Status:** protocol and synthetic gold annotations frozen before algorithmic tuning.  
**Date:** 2026-11-19  
**Frozen engine reference:** Git commit `090e74f` (Forge development v2.8.0, B0/B1).  
**Source:** consultant technical checkpoint following CLSD-6 B1, as reviewed by project owner.

## Purpose and non-claims

Determine **where** expected, authorized documents were lost, then select one targeted engine improvement. Do not treat more CQL queries, fewer reads, a lower latency observation, or a legacy `SOURCE_CONFLICT` as proof of increased discovery quality.

Observed, **not equal-budget**, CLSD-6 runs:
- B0: historical term `payment`, 10 reads, 3,009 ms, one M1-recognized related runbook, its search rank was 5.
- B1: three CQL **queries planned**, one document with usable body reported, 2,065 ms; runbook discovered via paths `endpoint_old` and `service_identity`. The UI does **not** yet show a verified count of successful CQL executions. These paths are not proven statistically independent.
- The current B1 retrieval component does **not** assess contextual relevance or instruction incompatibility.

These two observations are diagnostic only. They cannot establish recall, precision, or reliable latency savings.

## Dataset V1

`fixtures/benchmark-v1/corpus.synthetic.json` is **entirely synthetic** and public:
- Six synthetic Jira change cases (`BMK-101` through `BMK-106`), 15 invented Confluence pages, 90 explicit per-case page annotations, two simulated access profiles (`engineer`, `limited`).
- Four development cases: structured change, natural language, indirect relationship, and justified abstention.
- Two reserved validation cases: generic health endpoint plus rollback/architecture, and restricted failover procedure.
- Reserved validation labels are in the public repo, so this is **not a truly blind holdout**. Future private real-world evaluation must keep its gold separate from the system and the public repository.

Each page is annotated independently on:
1. **relevance**: `relevant` or `not_relevant`;
2. **role**: `procedure_to_review`, `context`, or `irrelevant`;
3. **incompatibleInstruction**: `yes`, `no`, `unknown`, or `not_applicable`.

A rollback-only V1 procedure may be a **relevant** document with **no** incompatible instruction. An architecture page may be relevant context but not a procedure to change. A shared `/health` across services never proves service identity. For insufficient input, `signalWhere=absent` means abstention is correct, rather than fabrication. Other incomplete tickets identify whether useful information is in Jira narrative or linked documentation.

**Important:** synthetic mock search does not reproduce Confluence tokenization, real Jira/Confluence permissions, or a production-like corpus. It is only a test of *measurement and harness semantics*.

## Evaluation order and fairness

1. **Freeze** the engine reference and annotate the gold cases before tuning. Record any later code/configuration changes and source versions.
2. In a dedicated Atlassian demonstration space, create realistic **authorized** tickets and pages mapped to privately held gold IDs. Do **not** blindly upload mock page titles or IDs into a real tenant. Confirm access rights with each test persona.
3. Use the same unchanged corpus and same persona for each B0/B1 paired run, alternate run order, and record page/ticket versions to detect corpus drift.
4. **Comparison A — fixed read budget:** at most 10 attempted page-body reads per variant. B0 keeps one historical CQL query; B1 at most four CQL calls including pagination once implemented. Measure actual queries **executed**, not just those planned.
5. **Comparison B — fixed total request budget (proposed 12):** count Jira reads, link verification/lookup, CQL and paginated searches, and attempted Confluence body reads; keep the read cap at 10. Implement total-budget enforcement before claiming this comparison. Never treat a planned request as executed.
6. Record repeated timings, e.g. at least three alternating pairs per persona/case. Report distribution and API costs, not a single winner.
7. Evaluate stage-by-stage **against the private, accessible gold only**. Select the top two failure categories, test one narrow improvement (possibly a bounded LLM extraction/rerank spike), then verify it on held-out cases before making a claim.

## Minimum private evaluation table

| Expected accessible page | Search hit | Selected to read | Usable body | Relevant decision | Loss / status |
| --- | --- | --- | --- | --- | --- |
| A | Yes | No | — | — | `READ_BUDGET_OR_RANKING` |
| B | Yes | Yes | Yes | No | `RELEVANCE_REJECTED` (only when a relevance assessor exists) |
| C | No | — | — | — | `NOT_RETRIEVED` (subject to incomplete/failed search caveats) |
| D (rollback only) | Yes | Yes | Yes | Not yet assessed | `NOT_YET_ASSESSED` — **not** automatically a drift |

The expected-page identity and annotations belong to the **developer-only evaluator**, never to the end-user Jira panel. If a Confluence read fails and its identity is redacted, the evaluator must not invent a definite search-miss diagnosis.

## Diagnostic contract and implementation gates

- Record plan/config version, run pair, persona, source versions or fingerprints, request budgets configured and **consumed**, query outcomes/durations, search raw ranks, merge ranks, selection ranks, fetch status, content usability, stopping/exclusion reasons, and coverage limitations.
- The B1 Forge UI is deliberately a *readable-document* diagnostic, not yet a complete private benchmark export. It only shows pages that were successfully read with usable bodies.
- Do not change the published B0/B1 retrieval algorithms to optimize benchmark cases until the initial measurements are captured.
- Keep permission-restricted labels, unselected hit identities, error bodies, and private corpus mappings out of user-visible counts and titles.
- `COMPLETE_WITHIN_BUDGET` means execution stayed within configured limits; it does **not** mean all relevant Confluence content was searched.
- A semantic vector index is **not required** for V1. Bounded LLM experiments may be introduced when a specific stage-level miss justifies them.

## Deliverables and go/no-go

1. Frozen, annotated synthetic V1 corpus and validator.
2. Small, developer-only stage-loss report generator; no dashboard requirement.
3. Live tenant equivalent with per-persona, preannotated gold and explicit execution telemetry.
4. First paired B0/B1 report including request counts and stop reasons.
5. **Decision:** choose a single improvement tied to the top failure mode; do not aim to make every case green.

**Go** to algorithm iteration when the report explains *which expected authorized pages were missed, at what stage, and with what uncertainty*. Otherwise fix benchmark telemetry first.
