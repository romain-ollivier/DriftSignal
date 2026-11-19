/**
 * Human review state machine, dependency-free and side-effect-free.
 * This module DOES NOT read/write Jira, Confluence or Forge storage.
 * Only the server-side authenticated layer may create source snapshots and
 * issue transitions. Do not pass arbitrary browser attestation directly.
 */
const STATES = new Set([
  'REVIEW_REQUIRED', 'NEEDS_EVIDENCE', 'DISMISSED_BY_REVIEWER',
  'CONFIRMED_BY_REVIEWER', 'RECHECK_REQUIRED', 'RECHECK_FAILED',
  'READY_FOR_RESOLUTION_REVIEW', 'RESOLVED_VERIFIED',
]);
const CHOICES = new Set(['NEEDS_EVIDENCE', 'DISMISSED_BY_REVIEWER', 'CONFIRMED_BY_REVIEWER']);
const RECHECK_RESULTS = new Set(['PAGE_ACCESS_LOST', 'PAGE_READ_FAILED', 'STILL_INCOMPATIBLE', 'NOT_PROVEN', 'CANDIDATE_FIXED']);
const KEY_RE = /^[A-Z][A-Z0-9_]*-\d+$/;
const ID_RE = /^\d{1,32}$/;
const MAX_HISTORY = 30;

function requiredString(value, label, max = 500) {
  if (typeof value !== 'string' || !value.trim() || value.length > max) {
    throw new Error(label + ' is required and must be at most ' + max + ' characters.');
  }
  return value.trim();
}
function isoTimestamp(value, label) {
  const t = requiredString(value, label, 64);
  if (!/^\d{4}-\d{2}-\d{2}T/.test(t) || Number.isNaN(Date.parse(t))) {
    throw new Error('Invalid ' + label + '.');
  }
  return t;
}
function sourceSnapshot(snapshot) {
  if (!snapshot || typeof snapshot !== 'object' ||
      !KEY_RE.test(snapshot.issueKey ?? '') || !ID_RE.test(String(snapshot.pageId ?? '')) ||
      !Number.isSafeInteger(snapshot.pageVersion) || snapshot.pageVersion < 1) {
    throw new Error('A server-verified issue, numeric page ID and positive page version are required.');
  }
  return {
    issueKey: snapshot.issueKey,
    pageId: String(snapshot.pageId),
    pageVersion: snapshot.pageVersion,
    jiraUpdated: isoTimestamp(snapshot.jiraUpdated, 'Jira source updated timestamp'),
  };
}
function safeActor(actor) {
  return requiredString(actor, 'Authenticated reviewer account', 200);
}
function append(record, status, actor, reason, at, extra = {}) {
  if (!STATES.has(status)) throw new Error('Unsupported review state.');
  if ((record.history ?? []).length >= MAX_HISTORY) {
    throw new Error('Review history cap reached; archive or rotate through an audited server workflow.');
  }
  const event = { sequence: record.revision + 1, state: status, actor, at, reason, ...extra };
  return {
    ...record,
    state: status, revision: record.revision + 1,
    history: [...record.history, event],
    updatedAt: at,
  };
}
function guardVersion(record, expectedRevision) {
  if (!Number.isSafeInteger(expectedRevision) || expectedRevision !== record.revision) {
    throw new Error('Stale review revision. Reload before applying a decision.');
  }
}
function assertSameSource(record, snapshot) {
  const current = sourceSnapshot(snapshot);
  if (current.issueKey !== record.issueKey || current.pageId !== record.pageId) {
    throw new Error('Review source identity changed.');
  }
  if (current.jiraUpdated !== record.jiraUpdated ||
      current.pageVersion !== record.pageVersion) {
    throw new Error('Source has changed; re-read and start a new review.');
  }
}
function assertReviewer(record, actorId) {
  const actor = safeActor(actorId);
  if (record.actorId !== actor) throw new Error('Review is private to its authenticated reviewer.');
  return actor;
}

/** Caller must have re-read both Jira and Confluence as the invoking user. */
export function createReview({ source, actorId, now }) {
  const snapshot = sourceSnapshot(source);
  const actor = safeActor(actorId);
  const at = isoTimestamp(now, 'review timestamp');
  return {
    schemaVersion: '1.0',
    ...snapshot,
    actorId: actor,
    state: 'REVIEW_REQUIRED',
    revision: 1,
    createdAt: at,
    updatedAt: at,
    history: [{ sequence: 1, state: 'REVIEW_REQUIRED', actor, at, reason: 'Review initiated on authorized source versions.' }],
  };
}

/**
 * Human verdict records opinion, not automatic incompatibility. A confirmed
 * case is NOT resolved and still needs an explicitly verified source update.
 */
export function applyReviewDecision(record, {
  expectedRevision, actorId, source, decision, reason, now,
}) {
  guardVersion(record, expectedRevision);
  const actor = assertReviewer(record, actorId);
  assertSameSource(record, source);
  if (!CHOICES.has(decision)) throw new Error('Unsupported human decision.');
  if (record.state === 'RESOLVED_VERIFIED') throw new Error('Cannot alter a closed finding.');
  const text = requiredString(reason, 'Reviewer rationale', 600);
  if (decision === 'CONFIRMED_BY_REVIEWER' && text.length < 12) {
    throw new Error('A confirmation requires substantive reviewer rationale.');
  }
  return append(record, decision, actor, text, isoTimestamp(now, 'review timestamp'));
}

/**
 * Only a trusted SERVER re-read may produce recheckResult.
 * No automatic closure, even when the source version changed.
 */
export function recordRecheck(record, {
  expectedRevision, actorId, jiraUpdated, pageVersion, recheckResult, reason, now,
}) {
  guardVersion(record, expectedRevision);
  const actor = assertReviewer(record, actorId);
  if (!['CONFIRMED_BY_REVIEWER','RECHECK_REQUIRED','RECHECK_FAILED','READY_FOR_RESOLUTION_REVIEW'].includes(record.state)) {
    throw new Error('Only a human-confirmed case can enter recheck.');
  }
  if (!RECHECK_RESULTS.has(recheckResult)) throw new Error('Unsupported recheck outcome.');
  const currentJira = jiraUpdated == null ? null : isoTimestamp(jiraUpdated, 'Jira source updated timestamp');
  const currentVersion = Number.isSafeInteger(pageVersion) && pageVersion > 0 ? pageVersion : null;
  const newerPage = currentVersion != null && currentVersion > record.pageVersion;
  const sameJira = currentJira != null && currentJira === record.jiraUpdated;
  let status = 'RECHECK_FAILED';
  if (recheckResult === 'STILL_INCOMPATIBLE' || recheckResult === 'NOT_PROVEN') status = 'RECHECK_REQUIRED';
  if (recheckResult === 'CANDIDATE_FIXED' && newerPage && sameJira) status = 'READY_FOR_RESOLUTION_REVIEW';
  const message = requiredString(reason, 'Recheck reason', 600);
  return append(record, status, actor, message, isoTimestamp(now, 'recheck timestamp'), {
    recheck: { outcome: recheckResult, sourceVersion: currentVersion, jiraUpdated: currentJira,
      newerPage, sameJira },
  });
}

/**
 * Final human acknowledgement. This state transition must only be called
 * after trusted server-side re-evaluation of a newer page and Jira source.
 * The browser alone can never certify verifiedFix=true.
 */
export function acknowledgeVerifiedResolution(record, {
  expectedRevision, actorId, verifiedFix, reason, now,
}) {
  guardVersion(record, expectedRevision);
  const actor = assertReviewer(record, actorId);
  if (record.state !== 'READY_FOR_RESOLUTION_REVIEW') {
    throw new Error('A finding cannot close without a successful current-source recheck.');
  }
  const previous = record.history.at(-1)?.recheck;
  if (verifiedFix !== true || previous?.outcome !== 'CANDIDATE_FIXED' ||
      previous?.newerPage !== true || previous?.sameJira !== true) {
    throw new Error('A trusted complete-fix verification is required.');
  }
  return append(record, 'RESOLVED_VERIFIED', actor,
    requiredString(reason, 'Resolution acknowledgement', 600),
    isoTimestamp(now, 'resolution timestamp'));
}
