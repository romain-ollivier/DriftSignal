# DriftSignal — Investigation MVP contract (Codegeist 2026)

**Status:** Milestone I read-only evidence panel implemented in a **draft branch**, pending CI, technical review and isolated Forge deployment. Milestones II/III remain design proposals. Drafted after strategic and technical reviews on 2026-11-19.  
**Stable backend reference:** Forge Development v2.9.0, B1 scoped retrieval (benchmark corpus 1.1).  
**New gold labels:** annotation revision 1.2 was merged independently; this does not modify the historical Forge v2.9.0 runs.

## Product objective

A single Jira issue panel should let a production engineer follow the end-to-end chain:

**Jira technical change → authorized Confluence documents → source-backed incompatibility candidate → explicit human review → Confluence edit → verified recheck.**

The user interface must not mistake **document retrieval**, **contextual relevance**, and **instruction incompatibility** for the same decision.

## Milestone I implementation (review branch only)

- New Forge resolver startInvestigation reuses the existing B1 Change Profiler, Query Planner and B1 retrieval engine, with read budget 10 and CQL cap 4.
- Frozen DSBENCH issues remain DSBMK descendant-scoped at search time, with no direct links. Other Jira issues use normal asUser B1 discovery. The existing B0/B1 benchmark resolvers remain unchanged.
- Every Confluence evidence excerpt is taken during an already-authorized page-body read. No additional body reads are performed for the preview. Up to 260 characters of literal text and page version (when provided) are available only for usable bodies.
- A Jira quote omitting its extracted value is not presented as evidence. The Jira source field/path and modified timestamp are shown.
- A dedicated Jira UI panel lets the user inspect authorized source excerpts and open Confluence links, with no saved review state.
- Retrieved pages are NOT_ASSESSED; no automatic relevance, incompatible-instruction, V1 retirement, correction or closure verdict is produced.
- The historical M1 scan may still display legacy SOURCE_CONFLICT outputs. This new panel is distinct and must not be confused with that scan.

### Smoke tests after technical review and isolated Forge deploy

1. DSBENCH-4: no technical signals and no search; no false success claim.
2. DSBENCH-5: generic /health and Planned status do not imply operational drift; all candidate documents remain NOT_ASSESSED.
3. DSBENCH-3: catalog discovered, indirect recovery guide still missing; limitation visible.
4. DSBENCH-6 authorized user: check page versions and excerpts, without inferring V1 retirement.
5. DSBENCH-6 genuinely limited user: restricted document must be absent by ID/title/URL/quote.
6. Confirm previous scoped B0/B1 results unchanged and no source page is edited.
## Proposed investigation states

| State | Trigger / meaning | Closure allowed? |
| --- | --- | --- |
| `DISCOVERED` | Candidate Confluence document was read under invoking user's permissions | No |
| `NEEDS_EVIDENCE` | Old route, retirement status, or document instruction cannot be established | No |
| `REVIEW_REQUIRED` | Source-backed potential contradiction needs human decision | No |
| `CONFIRMED` | Reviewer confirmed a specific source-backed incompatibility and why it matters | No |
| `DISMISSED` | Reviewer rejected the specific claim with a reason; not an automated global "in sync" verdict | No |
| `RECHECK_FAILED` | Recheck encountered access loss, unverified source, API error, page deletion/move, or stale version | No |
| `RESOLVED_VERIFIED` | A new accessible source version was fetched and the previously confirmed active instruction no longer contradicts a sufficiently established Jira change, with reviewer acknowledgement | **Yes**, for the specific confirmed finding only |

## Minimum evidence contract

**Jira change evidence**
- Issue ID, `updated` timestamp, source field/ADF path, exact source span, value and extraction method.
- Old and new endpoint must be independently supported.
- Deployment to V2 **does not imply retirement of V1**.
- A claim that V1 was retired must cite explicit, authoritative proof applicable to the environment and effective time.

**Confluence document evidence**
- Confluence page ID and version, source link and (when permitted) quoted instruction with location.
- `role`: active runbook instruction, rollback-only, architecture/context, historical archive, or indeterminate.
- Permission-aware retrieval and page-body processing using `asUser()`; never render inaccessible search-hit identities or metrics.
- A read page is a candidate, not by itself a relevant or incompatible result.

**Human review / resolution event**
- User decision, note, reviewer, time and exact Jira/page versions.
- No automatic Confluence edit in the first MVP: open the targeted source page for manual editing.
- After a fix is made, re-fetch the page as the invoking user; verify a newer page version and the actual active instruction, not simply a changed title or page version.
- Incomplete edit, copied/moved instruction, access loss, partial API failure or unchanged V1 operational guidance **cannot** close the finding.

## Case design for the first complete demo

A new, separately versioned synthetic case (NOT a mutation of frozen DSBENCH-1 or -6):
1. Jira declares a V2 production rollout **and explicit V1 retirement** with effective timestamp/authoritative evidence.
2. An active normal-recovery Confluence runbook still prescribes V1.
3. A separate **rollback-only** reference is either explicitly approved as an exception or marked indeterminate until exception evidence is available. Do not assume rollback is safe without proof.
4. Engineer sees source-backed conflict evidence, approves it, edits the Confluence runbook, and reruns the check.
5. Closing the finding requires a verified current body/version and human acknowledgement. Test the negative case where the old normal-recovery instruction remains or source access is lost.

## Implementation boundaries and milestones

**Milestone I — Investigation panel with existing B1, before new search features**
- Display retrieved authorized source documents, Jira and Confluence evidence, and explicit `not assessed / needs review` statuses.
- Acknowledge limits: the current v2.9.0 retrieval report does **not** classify relevance or operational incompatibility, and gold annotations must never reach this end-user panel.
- The first UI may work with a deliberately chosen known pair; avoid simulating a verified source judgment not provided by the backend.

**Milestone II — Human qualification and durable finding state**
- Add minimal persistence for reviewer decisions and source version references; determine Forge storage/auth model before implementation.
- Require evidence sufficiency for a strong conflict label. No automated user-facing `SOURCE_CONFLICT` from text mismatch alone.

**Milestone III — Re-verification / manual fix**
- Source link opens Confluence for editing; capture version transition; re-fetch and re-evaluate active instructions with user confirmation.
- Include negative tests for unchanged instruction, moved content, permissions revoked, CQL failure and partial edits.

**Optional bounded spike — catalog to runbook**
- For DSBENCH-3, follow one documented guide title using a separate scoped CQL call, a fixed request budget, and asUser verification.
- Prove success in a second unseen service family before treating one-hop discovery as a core product feature.

## Independent technical controls before exposure

- B1.1 draft PR #1 must pass its fixed negative, quote, full-token and ADF-section tests **and** a new real-tenant before/after. It must not be merged as a solution to qualification.
- Negated deployment parsing (separate PR #3) must be reviewed; `Not deployed` cannot become `deployed`.
- Test DSBENCH-6 with a genuinely limited second user, ensuring the private document and its identity remain absent from public responses.
- Score new qualification fixtures annotated privately *before* evaluation: proposed contest-only thresholds are 3/4 supported positive incompatibilities, zero strong conclusions over six negative examples, and no false closure or access leaks in tested cases.
- Keep source corpus revision, annotation revision, commit SHA, Forge deployed version, user persona and exact request consumption separate in any evaluation export.

## Definition of done for Codegeist demo

A judge can see a real Forge Jira panel:
- explain a **grounded** Jira V1 retirement with citation,
- locate the operational runbook without a manually inserted direct Jira link,
- distinguish active guidance from rollback and uncertain context,
- request human confirmation,
- follow a manual Confluence correction, and
- observe recheck of the **updated** source and a justified outcome.

**Out of scope:** large-scale graph crawl, vector index, Rovo, Change Radar, opaque risk scoring, and automated bulk Confluence writes.
