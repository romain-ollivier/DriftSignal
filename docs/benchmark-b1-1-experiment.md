# B1.1 — Narrative Signal Extraction experiment (NOT DEPLOYED)

**Decision:** strategic consultant checkpoint, 2026-11-19. Develop B1.1 while independently completing DSBENCH-3 through DSBENCH-6 diagnostics.

## Why this experiment

Live Forge **v2.9.0** baseline:
- DSBENCH-1 (structured): B0 and B1 each retrieved 3/3 annotated relevant documents from the same four readable pages. B1 used three CQL calls, B0 one. No gain demonstrated.
- DSBENCH-2 (narrative): B0 and B1 each planned **zero searches**, retrieved **0/2** expected relevant pages. Existing B1 profiler did not extract the old route or historical hostname.
- An independent manual `DSBMK` descendant CQL probe for `/settlement/v1/route` retrieved **Orchid Operations Handbook** (relevant) **and** a restricted emergency procedure belonging to a different case (irrelevant to BMK-102). A hostname-only CQL probe retrieved nothing.

This supports **testing an extraction-only intervention**, not claiming a retrieval improvement yet.

## The isolated implementation

- Existing B0, B1, Change Profiler, Query Planner, retrieval ranking and budgets **must remain untouched**.
- New `src/discovery/narrative-profiler.mjs` wraps the existing profiler. Conservative patterns add explicitly declared `old` routes/hostnames from Jira text, with `narrative_pattern` extraction and anchored Jira source quote and field/block path.
- It must not synthesize service identities, infer deployment/retirement/incompatibility, or turn vague/quoted/hypothetical content into discovered change claims.
- New benchmark-only Forge resolver `scanBenchmarkB11` uses the **same** CQL scope, ten-read cap, asUser access and existing query planner/retrieval as `scanBenchmarkB1`. The extra output is limited to Jira-source extraction evidence.
- Separate B1.1 UI button appears only on DSBENCH-1...DSBENCH-6. The previous buttons and their results are untouched, for side-by-side measurement.
- The public UI must display **only successfully authorized/readable Confluence documents**. Do not reveal restricted candidate IDs, unselected hit counts or private gold labels.
- No live Forge deploy is part of this PR. Only deploy after CI, user local validation and code review.

## Acceptance gate — DSBENCH-2

1. Rerun **existing v2.9.0 scoped B1** to confirm unchanged baseline: 0 planned CQL, 0 reads, 0/2 relevant.
2. Run **B1.1** on the same unmodified DSBENCH-2 with the same account, same scope and ten-read limit.
3. Positive extraction checks: `/settlement/v1/route`, role `old`; provenance includes the verbatim Jira sentence and its field/block path. Historical host is optional auxiliary evidence. It **must not** imply route retirement.
4. The existing Query Planner generates an `endpoint_old` query, and its execution is actually observed. Do not mistake a planned query for an executed query.
5. `Orchid Operations Handbook` must be **readable under asUser** and surfaced among the result pages. Success on this single case would be **at least one of two expected relevant documents** compared with 0/2 for unchanged B1.
6. Record the out-of-case private failover procedure separately as an irrelevant result, and tally unnecessary reads; **no drift/incompatibility judgment** follows automatically.
7. Explain missing `Settlement Core Service Home` separately; a single old-route CQL control was not expected to retrieve that second document.
8. Preserve v2.9.0 observations as baseline and record exact new deployed version, code commit, account, source versions, all CQL calls, end-to-end timings and page reads.

**Failure taxonomy:** missing Jira extraction; no executable query; CQL index miss; candidate missed after search; read-budget selection miss; permissions/read failure; document relevance/qualification unknown. Keep causal categories distinct.

## Additional validation cases

- Execute baseline `DSBENCH-4` (insufficient input) and `DSBENCH-5` (generic `/health` + rollback/context) as independent checks in the deployed v2.9.0 app.
- Before treating `DSBENCH-3` or `DSBENCH-6` as full-fidelity, create and assign their native Jira components `Voyager Scheduler` and `Settlement Core`. A real limited Atlassian identity is required for the permissions case.
- Hold out **new, privately annotated narrative tickets** from at least two other service families that were not used when writing these patterns. Include conditional/hypothetical quotations, a different narrative formulation, missing service identity, and unrelated CQL hits.
- Include a **crowded-retrieval** test with more than ten candidate pages (separate fixture/space or deliberately controlled corpus extension) to exercise ranking under the read cap. Do not silently alter the frozen 15-page V1 corpus.
- Alternate B1 and B1.1 run order and repeat timings. Follow **operational procedures found / expected accessible**, their ranks, irrelevant page reads, CQL and overall request costs, and latency distributions. The first paired run is diagnostic, not statistically meaningful.
- For a future Codegeist user journey, use a **separate** ticket with explicit proof that V1 was retired; demonstrate finding the active runbook, distinguishing rollback references, human review and a verifiable Confluence correction. Do not rewrite DSBENCH-2 or change its gold `incompatibleInstruction = unknown`.
- The **unscoped zero-configuration** experiment is distinct from this deliberately scoped equal-corpus comparison.

## Change scope & exit decision

This milestone should end with an **observed before/after on DSBENCH-2** and several unseen narrative cases. Do not move to LLM extraction unless the new error breakdown demonstrates that source evidence remains too diffuse or ambiguous for bounded deterministic rules. Do not prioritize a search-ranking change until the Jira signal is emitted correctly.
