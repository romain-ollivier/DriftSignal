import { createHash } from 'node:crypto';
import { createReview, applyReviewDecision } from './review-state.mjs';

/**
 * Forge KVS review journal. Each revision uses a unique, deterministic key
 * and must be written with FAIL_IF_EXISTS. Concurrent updates for the same
 * revision compete on one key; neither silently overwrites the other.
 * This module is storage-agnostic for negative/security tests.
 *
 * The caller MUST authenticate accountId from trusted Forge resolver context,
 * and re-check Jira and Confluence permissions asUser before every operation.
 */
const MAX_EVENTS = 30;
const KEY_RE = /^[A-Z][A-Z0-9_]*-\d+$/;
const PAGE_RE = /^\d{1,32}$/;

function requireActorAndSource(actorId, issueKey, pageId) {
  if (typeof actorId !== 'string' || actorId.length < 2 || actorId.length > 200 ||
      !KEY_RE.test(issueKey) || !PAGE_RE.test(String(pageId))) {
    throw new Error('Invalid authenticated review identity or source reference.');
  }
}
export function reviewKeyPrefix({ accountId, issueKey, pageId }) {
  requireActorAndSource(accountId, issueKey, pageId);
  const actorFingerprint = createHash('sha256').update(accountId).digest('hex');
  return 'review:v1:' + actorFingerprint + ':' + issueKey + ':' + pageId + ':';
}
function keyForRevision(prefix, revision) {
  if (!Number.isSafeInteger(revision) || revision < 1 || revision > MAX_EVENTS) {
    throw new Error('Review event history limit exceeded.');
  }
  return prefix + 'r' + String(revision).padStart(6, '0');
}
function assertRecord(source, actorId, current) {
  if (!current || typeof current !== 'object' ||
      current.actorId !== actorId || current.issueKey !== source.issueKey ||
      current.pageId !== String(source.pageId)) {
    throw new Error('Persisted reviewer/source identity mismatch.');
  }
}
async function readJournal(storage, prefix, actorId, issueKey, pageId) {
  // KVS query() is eventually consistent. Only direct get() on each known
  // deterministic key offers a strictly consistent read of a committed rN.
  // Bound the scan to 30 events; never return r1 while committed r2 exists.
  let latest = null;
  let missingRevision = false;
  for (let revision = 1; revision <= MAX_EVENTS; revision++) {
    // Strongly consistent direct gets across ALL bounded revision slots.
    // A journal containing r1 and r4 must not return r1 as current.
    const value = await storage.get(keyForRevision(prefix, revision));
    if (value === undefined) {
      missingRevision = true;
      continue;
    }
    if (missingRevision) {
      throw new Error('Missing review revision; journal integrity could not be verified.');
    }
    assertRecord({ issueKey, pageId }, actorId, value);
    if (value.revision !== revision || !Array.isArray(value.history) ||
        value.history.length !== revision ||
        value.history[revision - 1]?.sequence !== revision ||
        value.history[revision - 1]?.state !== value.state) {
      throw new Error('Persisted review revision/history mismatch.');
    }
    latest = value;
  }
  return latest;
}

function project(record, source) {
  if (!record) return null;
  const stale = record.jiraUpdated !== source.jiraUpdated ||
    record.pageVersion !== source.pageVersion;
  // PRIVATE to the authenticated current actor only, after fresh asUser checks.
  return { ...record, stale, canDecide: !stale && record.revision < MAX_EVENTS };
}
export function createPrivateReviewJournal(storage) {
  if(typeof storage?.get!=='function'||typeof storage?.putNew!=='function'){
    throw new Error('A strictly consistent key get and create-only storage adapter are required.');
  }
  return {
    async read({ actorId, source }) {
      const prefix = reviewKeyPrefix({ accountId:actorId, issueKey:source.issueKey, pageId:source.pageId });
      const record=await readJournal(storage,prefix,actorId,source.issueKey,String(source.pageId));
      return project(record,source);
    },
    async begin({ actorId, source, now }) {
      const prefix=reviewKeyPrefix({accountId:actorId,issueKey:source.issueKey,pageId:source.pageId});
      const current=await readJournal(storage,prefix,actorId,source.issueKey,String(source.pageId));
      if(current)throw new Error('Review already exists. Reload its current state.');
      const record=createReview({source,actorId,now});
      // Deterministic key + FAIL_IF_EXISTS protects concurrent first writers.
      await storage.putNew(keyForRevision(prefix,1),record);
      return project(record,source);
    },
    async decide({ actorId, source, expectedRevision, decision, reason, now }) {
      const prefix=reviewKeyPrefix({accountId:actorId,issueKey:source.issueKey,pageId:source.pageId});
      const current=await readJournal(storage,prefix,actorId,source.issueKey,String(source.pageId));
      if(!current)throw new Error('Start a review before recording a decision.');
      const updated=applyReviewDecision(current,{
        actorId,source,expectedRevision,decision,reason,now,
      });
      // Never use KVS default last-write-wins here.
      await storage.putNew(keyForRevision(prefix,updated.revision),updated);
      return project(updated,source);
    },
  };
}
