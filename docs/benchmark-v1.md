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

## First complete live paired campaign on the scoped corpus (Forge Development v2.9.0)

**As reported on 2026-11-19:** **all six** synthetic Jira scenarios have one B0/B1 scoped comparison. All use the same 15-page DSBMK descendant corpus and at most **ten attempted body reads per engine**, but **not an equal total request budget**. Results are developer-side comparisons between browser-visible **authorized readable documents** and pre-existing synthetic gold annotations. They do **not** reflect an independent relevance assessor or live drift classifier.

| Scenario | B0: CQL / readable pages / relevant gold | B1: CQL / readable pages / relevant gold | Interpretation |
| --- | --- | --- | --- |
| [DSBENCH-1](benchmark-v1-live-dsbench-1.md) — structured | 1 / 4 / **3 of 3** | 3 / 4 / **3 of 3** | Identical retrieval set; no observed relevant-page gain |
| [DSBENCH-2](benchmark-v1-live-dsbench-2.md) — narrative | 0 / 0 / **0 of 2** | 0 / 0 / **0 of 2** | Jira prose extraction failure before any CQL; B1.1 PR addresses this in isolation |
| [DSBENCH-3](benchmark-v1-live-dsbench-3.md) — indirect | 0 / 0 / **0 of 2** | 1 / 1 / **1 of 2** | B1 discovers relevant **service catalog**, but **not** the expected recovery runbook |
| [DSBENCH-4](benchmark-v1-live-dsbench-4.md) — vague | 0 / 0 / **N/A** | 0 / 0 / **N/A** | Correct abstention; no gold-relevant documents |
| [DSBENCH-5](benchmark-v1-live-dsbench-5.md) — generic `/health` | 1 / 4 / **2 of 2** | 1 / 3 / **2 of 2** | Same relevant **context**; one unnecessary read avoided |
| [DSBENCH-6](benchmark-v1-live-dsbench-6.md) — restricted case, authorized user | 1 / 5 / **4 of 4** | 4 / 4 / **4 of 4** | All relevant pages recovered, one irrelevant archive avoided with three extra CQL calls |

**Descriptive corpus aggregate**, one observed run of each case: B0 performed **3 CQL** requests and surfaced **13 usable pages** containing **9/13 gold-relevant case/page pairs**; B1 performed **9 CQL** requests and surfaced **12 usable pages** containing **10/13 gold-relevant case/page pairs**. The difference of one relevant pair is **the service catalog in DSBENCH-3**. Both found **4/6 expected relevant operational procedure pairs**; **no incremental operational runbook recall gain** has yet been observed. B1 read 2 non-relevant pages versus 4 for B0, at the price of more CQL requests. These are **small-corpus descriptive totals only**, not statistical or generalization results. Scenario 4 has no relevant page and correctly abstains.

**Evidence caveats:**
- A completed `COMPLETE_WITHIN_BUDGET` run is not evidence of relevant coverage.
- For DSBENCH-5 the two gold-relevant pages are **context**; a planned generic `/health` change is not demonstrated drift.
- For DSBENCH-6 the authorized principal saw a restricted procedure, legitimately; **permission isolation against a separate limited user remains untested**. Accessible gold denominators must be persona-specific.
- B1 can retrieve pages through multiple search families but the first B1 design does **not** follow a catalog's runbook title or link to a second-hop document. DSBENCH-3 isolates this gap.
- All measurements are first observations from panels pasted by the project owner, not raw private stage-loss traces. Source version stamps, exact run timestamps, repeated latency distributions and complete API request budgets are missing.
- B1.1 narrative extraction lives in an isolated **draft PR** and is **not deployed**; v2.9.0 remains the baseline.
- The controlled scope cannot support a claim of **zero-configuration document discovery**. A separate unscoped experiment, crowded corpus (>10 candidates), privately annotated unseen tickets and access-limited persona are required.

**Go-forward sequence:** preserve v2.9.0 results; validate B1.1's isolated narrative improvement against DSBENCH-2 and unseen services, measure unnecessary pages/CQL; test the **second-hop service-catalog-to-runbook hypothesis** separately; complete real permission checks on DSBENCH-6; and only then build the broader human review/resolution demo.

## Dataset V1

`fixtures/benchmark-v1/corpus.synthetic.json` is **entirely synthetic** and public (corpus annotation revision **1.1**; schema version remains 1.0). The baseline synthetic retrieval outputs were captured before the annotation-only correction; 1.1 changes BMK-102 page `10006` incompatibility from `yes` to `unknown`, without changing any source ticket, page, relevance label, or discovery behavior:
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

## Live Atlassian corpus-scoping protocol (consultant amendment)

- For the **primary benchmark**, apply the **same Confluence CQL space constraint** `space = "DSBMK"` for both B0 and B1, *before* the ranked results are selected or fetched. A parent page alone does not isolate search results. Do not compare scoped B0 with unscoped B1.
- Keep a **separate zero-configuration trial** without a space constraint and record out-of-corpus hits and their read-budget impact using the **developer-only** evaluator. This is an ecological test, not the primary same-corpus result.
- Run both variants with **at most 10 page read attempts**, recording successful/failed search calls, search-query text, pagination limits, and timings. B0's existing default 15-read panel is *not* the comparable 10-read benchmark.
- Restricted pages must **not** count against the limited persona's accessible recall denominator. Test both identities against the *same* Jira issue; check the complete UI output for title, page ID, excerpt, or any aggregate that could betray denied material. A real second user identity is necessary.
- Check **both direct body-read fidelity and CQL indexability** after import; record title/host/path search probes including negative results. A page readable by ID but absent from a specific CQL query is not necessarily a ranking failure.
- Always record corpus revision, retrieval commit, **actually deployed Forge version**, per-page and Jira issue versions, and access-profile identity before executing live paired tests.
- Reserved cases BMK-105/106 are known public synthetic labels, **not** an independent blind holdout. Later add genuinely unseen services and documents before announcing external generalization.

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
