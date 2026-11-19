# Investigation MVP III — private human-review persistence

**Technical-review corrections (2026-11-19):** Writes now require a browser-provided displayed source tuple (`issueKey`, `jiraUpdated`, `pageId`, `pageVersion`) that must match the freshly asUser-read source. The tuple is only a precondition, never authority. After any reauthorization/write failure, private notes and every document-bearing panel (M1, B0/B1, benchmark, investigation) are cleared; in-flight responses from an older evidence epoch must not repopulate them. The fixed corpus DSBMK space ID `5013508` and root ancestry must both match; `read:content.metadata:confluence` is declared for the ancestors endpoint. KVS journal reads now use bounded strongly consistent per-revision `kvs.get`, not eventually consistent prefix queries; writes continue using `FAIL_IF_EXISTS`. The standalone state contract no longer exports any recheck or closure functions. A new cycle after a page edit is still deferred pending review, and no live two-persona validation has occurred.

**Status:** implemented on draft PR #6 only; stacked on PR #5 and PR #4. **Not merged, not deployed**, no user reviews persisted on the tenant yet. Historical Forge Development v2.9.0 benchmarks remain unchanged.

## Functional scope

The investigation panel displays an optional per-document *My private review* section, available only for Confluence candidates successfully read through the existing B1 read-only investigation. A reviewer can load, create, and record `NEEDS_EVIDENCE`, `DISMISSED_BY_REVIEWER` or `CONFIRMED_BY_REVIEWER`, with a written reason.

Three new resolvers: `getPrivateReview`, `beginPrivateReview`, `decidePrivateReview`. No resolver accepts a browser-supplied account ID, document version, Jira updated timestamp, `verifiedFix` boolean, automatic incompatibility verdict, or resolution outcome. No Confluence write APIs are called.

## Security boundary

1. Account identity is read from the **trusted Forge resolver context** (`context.accountId`), not Custom UI `getContext()`. Anonymous accounts are rejected.
2. **Before each KVS read or write**, the resolver makes `asUser()` Jira issue and Confluence page-body GET calls. Both must succeed. Page ID, nonempty source body, positive numeric Confluence version, explicit `current` page status, and Jira updated timestamp are verified server-side.
3. For `DSBENCH-1..6`, an `asUser()` Confluence page ancestry read must include the fixed `DSBMK` corpus parent (`5177345`). Incomplete/paginated ancestry fails closed. Unknown `DSBENCH-*` keys are rejected instead of falling back to unscoped discovery.
4. KVS keys are partitioned by a SHA-256 representation of the **authenticated Atlassian account ID**, Jira key, and page ID. KVS itself is installation scoped, not user permission aware. Each read is reauthorized before touching storage.
5. Each event revision uses a deterministic, immutable KVS key such as `r000002`, with `kvs.set(..., { keyPolicy: 'FAIL_IF_EXISTS' })`. Competing decisions for the same revision target the same key and cannot overwrite silently. Every deterministic revision from 1–30 is read with strongly consistent `kvs.get`; a gap followed by a later revision fails closed; no default last-write-wins update.
6. Revisions and audit history are bounded to 30 per user/issue/page. Every read scans the fixed 30 direct keys to detect even non-adjacent holes; at r30 the UI receives `canDecide: false`. No raw Confluence body or search-hit identity is persisted in review events; only server-sourced references/versions and the author's rationale.
7. A changed Jira timestamp or Confluence page version makes the historical review view-only (`stale: true`), not automatically resolved. A lost access right prevents both read and write.

## Technical limitations and required review

- This is a **per-reviewer** private workflow, not a shared organization review queue. A reviewer with Confluence access cannot read another reviewer's KVS records via the client-side API.
- Forge KVS and Atlassian product APIs are **not part of a cross-system atomic transaction**. Changes between authorization and write remain possible. No final resolution endpoint is exposed, and every subsequent read rechecks current access and versions.
- Retention, erasure, export, and operational handling of maximum 30 revisions need a separate policy before real non-synthetic customers. The current draft is for controlled development only.
- Adding `storage:app` may require Forge installation upgrade/consent. Run `forge lint` and validate permissions with a real limited account before enabling the feature in a shared environment.
- A source document may be authorized and still be **irrelevant** or rollback-only; the human decision is an assertion by that reviewer, not independent verified compatibility.
- **No trusted full-body recheck and no `RESOLVED_VERIFIED` action yet**. Those remain separate work, blocked on a tested correction-evidence evaluator and human acknowledgement.

## Negative tests

Tests exercise reviewer isolation, source/version staleness, missing/invalid source bodies, access denial, off-corpus pages, incomplete ancestors, concurrent decisions, immutable event history, missing revisions, and private-source reference validation.

## Second counter-review: corrections after the 2026-11-19 findings

- The investigation emits a Confluence candidate only after matching the ID returned by the current asUser page GET. In the benchmark corpus, current DSBMK space and the complete typed ancestor chain are checked **again at GET time**, not just at CQL time. The extra ancestor API calls are tracked separately from frozen B1.
- Jira ADF blocks containing link marks or cards cannot publish mixed source quotations that include unverified Confluence page labels; the public title and source URL come only from the successful GET and the CQL-verified tenant origin.
- The initial read-only UI now runs a shared evidence-security epoch in the parent App. Any failed private reauthorization invalidates M1, B0/B1, scoped benchmark and investigation. Requests launched in older epochs cannot restore cached evidence.
- The investigation has a per-run generation check: an old private call cannot invalidate a newer investigation; invalidation resets the busy flag. Private components ignore replies after unmount.
- KVS journal reads now scan all 30 strongly consistent direct revision keys. A record at r4 after missing r2/r3 is a corruption error, not a valid r1; r30 remains readable but no new decision is offered.
- A page with missing status is refused; a corpus ancestor matching the root ID must also have type `page`. Intermediate `folder` ancestors remain permitted.
- The UI explicitly discloses that the reviewer note is persisted privately; it does **not** imply that a source has been fixed or verified.
- **CI validates backend policy and React compilation; React race-order replay with a mocked bridge remains a distinct manual/technical-review gate.** Source authorization loss is not instant push revocation; it takes effect on the next attempted asUser operation.

### Required isolated Forge staging matrix

1. A/B account separation: both see a common page; only A sees the restricted page; no ID, title, quote or hit-specific count may leak in B's JSON.
2. Open M1 + investigation simultaneously; revoke Confluence access in a disposable copy, then invoke a private reread. No old M1 result, title, quote, private note or late response may survive. Repeat for Jira access loss.
3. Resolve the two response orders: (a) old private failure after a newer investigation started and (b) failure during the current investigation; no spinner may remain stuck and stale results may not return.
4. Two tabs of A start at r1 and submit two different r2 decisions. Exactly one persists; an immediate reread in each tab returns the winner.
5. Display page v1 and change it to v2 before begin or decide. The server must reject the stale source tuple without writing to KVS.
6. Inject a journal with r1 and r4 only, and a full r30 history. The first fails closed; the second is read-only.
7. Verify root type, current page status, space move and complete ancestry with the real Confluence response format.

**Rollout remains blocked** on authenticated `forge lint`, new scope consent, real two-account testing, privacy/cleanup plan and a renewed security review. No PR has been merged or deployed.

## Validation sequence

1. Review/merge PR #4 (read-only investigation); separately review PR #5 (state contract), then review PR #6.
2. CI: backend tests, synthetic B0/B1 benchmark, React build; verify the `npm ci` lockfile generated using the pinned `@forge/kvs` version.
3. Run `forge lint` locally and deploy **only** into an isolated Forge test environment, not the frozen v2.9.0 Development baseline.
4. Test start/read/decision with an authorized Atlassian account. Reload across browser sessions; verify revision history and simultaneous writes.
5. Revoke Confluence page access or use a second limited user for DSBENCH-6. Confirm no private page identities, reviewer reasons, or KVS state leak.
6. Change Jira and Confluence versions; confirm stored history is read-only and cannot be reused to declare a corrected document.

## Official documentation used

- Forge KVS API: https://developer.atlassian.com/platform/forge/storage-reference/kvs-api/
- Forge KVS limits: https://developer.atlassian.com/platform/forge/limits-kvs-ce/
- Forge resolver account context: https://developer.atlassian.com/platform/forge/runtime-reference/forge-resolver/
- Confluence v2 page ancestors: https://developer.atlassian.com/cloud/confluence/rest/v2/api-group-ancestors/
