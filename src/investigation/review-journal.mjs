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
  const values = await storage.list(prefix, MAX_EVENTS + 1);
  if (!Array.isArray(values) || values.length > MAX_EVENTS) {
    throw new Error('Review history cannot be verified within its fixed budget.');
  }
  if (!values.length) return null;
  const entries = values.map((entry) => {
    if (!entry || typeof entry.key !== 'string' || !entry.key.startsWith(prefix)) {
      throw new Error('Review record is outside authorized keyspace.');
    }
    const suffix = entry.key.slice(prefix.length);
    if (!/^r\d{6}$/.test(suffix)) throw new Error('Malformed review revision.');
    const revision = Number(suffix.slice(1));
    if (revision !== entry.value?.revision) throw new Error('Revision/key mismatch.');
    assertRecord({ issueKey, pageId }, actorId, entry.value);
    return { revision, value: entry.value };
  }).sort((a,b) => a.revision-b.revision);
  for(let i=0;i<entries.length;i++){
    if(entries[i].revision!==i+1)throw new Error('Missing, duplicate or out-of-order review event.');
    if(entries[i].value.history?.length!==i+1)throw new Error('Invalid persisted audit history.');
  }
  return entries.at(-1).value;
}
function project(record, source) {
  if (!record) return null;
  const stale = record.jiraUpdated !== source.jiraUpdated ||
    record.pageVersion !== source.pageVersion;
  // PRIVATE to the authenticated current actor only, after fresh asUser checks.
  return { ...record, stale, canDecide: !stale && record.state !== 'RESOLVED_VERIFIED' };
}
export function createPrivateReviewJournal(storage) {
  if(typeof storage?.list!=='function'||typeof storage?.putNew!=='function'){
    throw new Error('A bounded read and create-only storage adapter is required.');
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
