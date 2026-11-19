/**
 * Human review state machine, dependency-free and side-effect-free.
 * This module DOES NOT read/write Jira, Confluence or Forge storage.
 * Only the server-side authenticated layer may create source snapshots and
 * issue transitions. Do not pass arbitrary browser attestation directly.
 */
const STATES = new Set([
  'REVIEW_REQUIRED', 'NEEDS_EVIDENCE', 'DISMISSED_BY_REVIEWER',
  'CONFIRMED_BY_REVIEWER',
]);
const CHOICES = new Set(['NEEDS_EVIDENCE', 'DISMISSED_BY_REVIEWER', 'CONFIRMED_BY_REVIEWER']);
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
  // This first MVP records human opinion only; it cannot close a finding.
  const text = requiredString(reason, 'Reviewer rationale', 600);
  if (decision === 'CONFIRMED_BY_REVIEWER' && text.length < 12) {
    throw new Error('A confirmation requires substantive reviewer rationale.');
  }
  return append(record, decision, actor, text, isoTimestamp(now, 'review timestamp'));
}

