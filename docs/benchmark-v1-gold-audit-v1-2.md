# Benchmark V1 — Gold label audit (proposed annotation revision 1.2)

**Date:** 2026-11-19  
**Status:** Separate review branch; **not merged and not deployed**.  
**Original live baseline:** six scoped B0/B1 cases executed in Forge Development v2.9.0 with UI label **corpus revision 1.1**. Preserve those observations and reported per-scenario relevance counts exactly.

## Root problem: deployment is not retirement

The frozen V1.1 gold annotated three operational procedures `incompatibleInstruction: yes`, despite their Jira tickets only declaring that V2 was **deployed to production**, not that V1 was disabled, decommissioned, or forbidden in a disaster-recovery path.

- BMK-101 × `10001` Payment Gateway Recovery Runbook: operational recovery continues to reference `/api/v1/payments`. Relevance and procedure role are supported, but incompatibility is **unknown** without an authoritative V1-retirement statement.
- BMK-106 × `10006` Orchid Operations Handbook: normal recovery refers to the legacy settlement route. The ticket describes V2 deployment but not its V1 decommissioning; incompatibility **unknown**.
- BMK-106 × `10014` Settlement Emergency Failover Procedure: normal recovery says switch back to v1. The record does not establish the old route is invalid; incompatibility **unknown**.

These three labels are updated to `unknown` in a proposed **annotation revision 1.2** and recorded individually in `annotationChangeLog`. This aligns with the earlier BMK-102 correction in revision 1.1.

**Unchanged:** all six synthetic Jira issue descriptions, fifteen Confluence page bodies/titles, page IDs, relevance labels, roles, accessibility profiles, and B0/B1 engine behavior. No additional scenarios or new sources have been seeded into the live Atlassian tenant.

## Scientific interpretation

- All live B0/B1 discovery results remain historically valid: B0 9/13 and B1 10/13 gold-relevant ticket/page pairs; B0/B1 both 4/6 annotated relevant operational procedures retrieved.
- Those counts **do not** depend on the `incompatibleInstruction` values. They must not be presented as automatic conflict-detection accuracy.
- The v2.9.0 Forge UI will still show `Revision 1.1` because its deployed `LIVE_BENCHMARK.corpusRevision` is intentionally frozen. Do **not** silently relabel those runs as v1.2 or redeploy the frozen baseline merely to change a label.
- Future qualification evaluation must record `annotationRevision: 1.2` separately from the historical `sourceCorpusRevision: 1.1`. Historical results should be interpreted under original labels when discussing the originally frozen assessment; a corrected annotation view may be used only with an explicit post-hoc correction disclosure.
- Because public gold is not blind and this is a post-baseline correction, do **not** use V1.2 cases alone to claim independent qualification accuracy.
- A consistent source of truth is needed before implementing a visible `SOURCE_CONFLICT` decision for normal recovery, while a rollback-only reference must stay non-conflicting.

## New independent positive qualification fixture: proposal, NOT added to V1

Use a **separately versioned synthetic test**, not an edit to BMK-101 or BMK-106, with a ticket that contains an explicit retirement guarantee, e.g.:

> Service: example-payments
> Old endpoint: /api/v1/settle
> New endpoint: /api/v2/settle
> Change effective: 2026-12-01T10:00Z
> Old endpoint retired: yes, confirmed by completed gateway decommission and route returning HTTP 410

And a documented active operational procedure saying:

> For **normal** production recovery, call /api/v1/settle.

This creates a **grounded incompatibility candidate**. Add a distinct *rollback-only* document explicitly scoped to a permitted contingency and *staging/planned* counterexamples to test the difference. Human review should still be required before document mutation or resolution.

Annotate the new fixtures **before** running the qualifier. Keep them out of the public frozen retrieval benchmark or reserve new services and labels privately for a stronger independent result.

## Consultant's proposed internal go/no-go thresholds

These are **contest-oriented acceptance gates**, not production safety estimates:

- **Discovery:** at least **8/10** accessible, annotated operational procedures retrieved across unseen cases from at least two service families, with ten-read cap and at least one crowded (>10 candidates) run.
- **Qualification:** at least **3/4** explicitly evidenced incompatibilities surfaced with correct source references, and **zero** strong unjustified conclusions across **6** negative cases (rollback, staging, planned, insufficient evidence).
- **Permissions and resolution:** no restricted-document leakage for the limited account and no false closure after incomplete correction or a permission loss.

A small sample with zero observed false positives cannot establish a reliable population false-positive rate or production-grade security.

## Codegeist delivery focus

Proposed sequence: B1.1 experimental route extraction with a genuine live before/after; then Jira investigation UI with source-linked evidence, review and verified Confluence re-check; only a limited one-hop catalog→runbook spike if it materially strengthens this demonstration. Exclude broader search infrastructure and speculative scoring. For the final demo, prefer a new ticket whose **explicitly retired** endpoint contradicts the **active** runbook, while rollback references remain correctly separated.

The official deadline shown by Devpost is **2026-12-22 at 12:00 PM PST** (= **21:00 Paris CET**). Internal feature-freeze target **2026-12-18**. Submission requires a Forge app installation link usable by judges, a public YouTube demo **under five minutes**, and clear testing instructions. Official rules: https://codegeist2026.devpost.com/rules

## Next review gate

1. Technical reviewer signs off on the three evidence-based gold-label corrections and on preservation of the frozen v2.9.0 discovery baseline.
2. Technical reviewer separately audits draft B1.1 PR #1 for scope isolation, evidence provenance, secure query construction, permission redaction, B0/B1 regressions, and failure-path telemetry.
3. After approval, merge gold correction and run CI (not yet performed on this proposed revision); preserve version tags in reports.
4. Only after B1.1 has its own reviewed deployment, measure the DSBENCH-2 before/after and new privately annotated services.
