# Investigation MVP III — private human-review persistence

**Status:** implemented on draft PR #6 only; stacked on PR #5 and PR #4. **Not merged, not deployed**, no user reviews persisted on the tenant yet. Historical Forge Development v2.9.0 benchmarks remain unchanged.

## Functional scope

The investigation panel displays an optional per-document *My private review* section, available only for Confluence candidates successfully read through the existing B1 read-only investigation. A reviewer can load, create, and record `NEEDS_EVIDENCE`, `DISMISSED_BY_REVIEWER` or `CONFIRMED_BY_REVIEWER`, with a written reason.

Three new resolvers: `getPrivateReview`, `beginPrivateReview`, `decidePrivateReview`. No resolver accepts a browser-supplied account ID, document version, Jira updated timestamp, `verifiedFix` boolean, automatic incompatibility verdict, or resolution outcome. No Confluence write APIs are called.

## Security boundary

1. Account identity is read from the **trusted Forge resolver context** (`context.accountId`), not Custom UI `getContext()`. Anonymous accounts are rejected.
2. **Before each KVS read or write**, the resolver makes `asUser()` Jira issue and Confluence page-body GET calls. Both must succeed. Page ID, nonempty source body, positive numeric Confluence version, current page status when returned, and Jira updated timestamp are verified server-side.
3. For `DSBENCH-1..6`, an `asUser()` Confluence page ancestry read must include the fixed `DSBMK` corpus parent (`5177345`). Incomplete/paginated ancestry fails closed. Unknown `DSBENCH-*` keys are rejected instead of falling back to unscoped discovery.
4. KVS keys are partitioned by a SHA-256 representation of the **authenticated Atlassian account ID**, Jira key, and page ID. KVS itself is installation scoped, not user permission aware. Each read is reauthorized before touching storage.
5. Each event revision uses a deterministic, immutable KVS key such as `r000002`, with `kvs.set(..., { keyPolicy: 'FAIL_IF_EXISTS' })`. Competing decisions for the same revision target the same key and cannot overwrite silently. Any missing revision/partial query fails closed; no default last-write-wins update.
6. Revisions and audit history are bounded to 30 per user/issue/page and the KVS query refuses a continuation cursor. No raw Confluence body or search-hit identity is persisted in review events; only server-sourced references/versions and the author's rationale.
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
