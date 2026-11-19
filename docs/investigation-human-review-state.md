# Investigation MVP II — Human review state contract (no storage or resolver yet)

**Status:** isolated pure-function implementation on stacked draft PR #5. After consultant review the scope is **human decisions only**: no recheck or closure transitions exist in this module. Not merged or deployed.

## Why this stage

The initial investigation UI retrieves and displays readable Confluence sources, but it does not persist reviewer decisions or verify fixes. Before introducing a write-capable storage layer we need a testable state model that enforces the key product principle: **a document revision, missing content, or permission loss cannot automatically close an investigation.**

## Evidence-bound progression

`REVIEW_REQUIRED` → one of:

- `NEEDS_EVIDENCE`: reviewer explains why the change or instruction lacks sufficient proof.
- `DISMISSED_BY_REVIEWER`: reviewer dismisses that **specific candidate**, not the whole Jira ticket.
- `CONFIRMED_BY_REVIEWER`: reviewer records a decision with a substantive explanation, explicitly attributed to the human. **Not a machine verified conflict.**

**Deferred by technical review:** All `recordRecheck`, `acknowledgeVerifiedResolution`, `READY_FOR_RESOLUTION_REVIEW` and `RESOLVED_VERIFIED` transitions have been removed from PR #5. They must be designed later around an explicitly fresh, authenticated server re-read at final acknowledgement. No resolver in PR #6 offers closure.

## Immutable review record

The pure functions in `src/investigation/review-state.mjs` capture:

- Jira issue key and server-verified `updated` timestamp.
- Confluence page ID and numeric version obtained after a successful `asUser()` body read.
- Server-derived reviewer Atlassian account ID.
- Current status, revision, creation/update timestamps, bounded audit history (max 30 events), reviewer rationale (max 600 characters).
- Recheck result, newly observed page version and Jira-version equality when available.

Updates require an expected review revision and exact original Jira/page snapshot; stale submissions fail closed. Records are immutable and cannot cross account IDs. These checks are **logical guards**, not a replacement for atomic storage transactions.

## Deferred real implementation

No write-capable Forge resolver is included yet. Before wiring this to storage:

1. **Technical review of PR #4** and test on the tenant, especially DSBENCH-6 with a second genuinely limited user.
2. Choose a Forge persistence adapter. Atlassian recommends `@forge/kvs` with `storage:app` for new implementations. KVS scopes data per app installation, **not automatically per Jira user's Confluence permissions**. Every read/write must re-check Jira and Confluence authorization as the user; private-review records need server-derived account scoping. See https://developer.atlassian.com/platform/forge/storage-reference/kvs/ .
3. Choose how to handle concurrent writes, key partitioning, retention/delete/export policy, and archival of the 30-event history cap. Avoid silently relying on last-write-wins; use an atomic check/transaction or single-writer strategy before multi-user use.
4. The server—not the Custom UI—must generate `source`, `actorId`, `now`, `verifiedFix`, and recheck outcomes. Reject any browser-submitted claim that a document was authorized, retired, edited or fixed.
5. Prefer per-user private review records for the first rollout. A shared team workflow needs explicit authorization and access-revocation semantics before exposing other reviewers' notes.
6. Recheck must examine the **entire authorized source body**, not just the selected 260-character quote; a moved active instruction or a permitted rollback exception must be identified separately. Do not implement `CANDIDATE_FIXED` until the full-body verification design is reviewed.
7. No automated Confluence edits. User opens the source document and makes manual corrections.

## Review gate / tests

The test suite covers human-only decisions, invalid source IDs/versions, lost page access, changing Jira versions, unchanged page versions, false closure, mismatched reviewer identity, stale revision, unsupported decisions and bounded audit history.

**Important:** these tests exercise only the pure transition policy. They are **not a real permissions test**, storage integrity test, or claim that the qualification engine can correctly verify contradictions.

## Relationship to other PRs

- PR #4: read-only investigation (base of this stacked PR).
- PR #1: B1.1 experimental narrative extraction, independent.
- PR #3: negated deployment status parser, independent.
- Historical Forge v2.9.0 benchmarks remain unchanged and cannot be relabeled as a new release.
