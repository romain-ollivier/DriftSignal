import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createReview, applyReviewDecision, recordRecheck, acknowledgeVerifiedResolution,
} from '../src/investigation/review-state.mjs';

const source = {
  issueKey: 'DSBENCH-6', pageId: '5013806', pageVersion: 3,
  jiraUpdated: '2026-11-19T05:00:00Z',
};
const reviewer = 'atlassian-user-123';
const at = '2026-11-19T05:01:00Z';
function fresh() {
  return createReview({ source, actorId: reviewer, now: at });
}
function confirmed() {
  return applyReviewDecision(fresh(), {
    actorId: reviewer, expectedRevision: 1, source,
    decision: 'CONFIRMED_BY_REVIEWER',
    reason: 'Reviewer confirms this active route requires source verification.',
    now: '2026-11-19T05:02:00Z',
  });
}
function check(rec, opts={}) {
  return recordRecheck(rec, {
    actorId: reviewer, expectedRevision: rec.revision,
    jiraUpdated: source.jiraUpdated, pageVersion: 4,
    recheckResult: 'CANDIDATE_FIXED',
    reason: 'Server re-read indicated candidate instruction removed; human check still needed.',
    now: '2026-11-19T05:03:00Z', ...opts,
  });
}

test('Initial review is scoped to explicit authorized source versions', () => {
  const review = fresh();
  assert.equal(review.state,'REVIEW_REQUIRED');
  assert.equal(review.pageVersion,3);
  assert.equal(review.issueKey,'DSBENCH-6');
  assert.equal(review.actorId,reviewer);
  assert.equal(review.history.length,1);
  assert.throws(()=>createReview({ source:{...source, pageId:'not-numeric'}, actorId:reviewer, now:at }),/server-verified/);
  assert.throws(()=>createReview({ source:{...source, pageVersion:null}, actorId:reviewer, now:at }),/server-verified/);
  assert.throws(()=>createReview({ source:{...source, jiraUpdated:null}, actorId:reviewer, now:at }),/required/);
});

test('Human confirmation is not an automatic conflict nor a resolution', () => {
  const r=confirmed();
  assert.equal(r.state,'CONFIRMED_BY_REVIEWER');
  assert.equal(r.revision,2);
  assert.equal(r.history.length,2);
  assert.notEqual(r.state,'RESOLVED_VERIFIED');
  assert.equal(fresh().state,'REVIEW_REQUIRED');
  assert.throws(()=>applyReviewDecision(fresh(),{
    actorId:reviewer, expectedRevision:1, source, decision:'CONFIRMED_BY_REVIEWER',
    reason:'yes', now:at,
  }),/substantive/);
});

test('Evidence gaps and dismissals remain reviewer-labelled and non-final', () => {
  for (const decision of ['NEEDS_EVIDENCE','DISMISSED_BY_REVIEWER']) {
    const r=applyReviewDecision(fresh(),{
      actorId:reviewer, expectedRevision:1, source, decision,
      reason:'Documentation may only describe rollback.', now:at,
    });
    assert.equal(r.state,decision);
    assert.notEqual(r.state,'RESOLVED_VERIFIED');
    assert.throws(()=>recordRecheck(r,{
      actorId:reviewer, expectedRevision:r.revision,
      pageVersion:4, jiraUpdated:source.jiraUpdated,
      recheckResult:'CANDIDATE_FIXED', reason:'Source changed', now:at,
    }),/Only a human-confirmed/);
  }
});

test('Reject stale revision, cross-user edits and changed source snapshots', () => {
  const r=fresh();
  const payload={actorId:reviewer, expectedRevision:1, source,
    decision:'NEEDS_EVIDENCE',reason:'Retirement is not established.',now:at};
  assert.throws(()=>applyReviewDecision(r,{...payload,expectedRevision:0}),/Stale/);
  assert.throws(()=>applyReviewDecision(r,{...payload,actorId:'other-account'}),/private/);
  assert.throws(()=>applyReviewDecision(r,{...payload,source:{...source,pageVersion:4}}),/Source has changed/);
  assert.throws(()=>applyReviewDecision(r,{...payload,source:{...source,jiraUpdated:'2026-11-19T06:00:00Z'}}),/Source has changed/);
  assert.throws(()=>applyReviewDecision(r,{...payload,source:{...source,pageId:'5013899'}}),/identity changed/);
});

test('No closure if Confluence access is lost or a re-read fails', () => {
  for (const result of ['PAGE_ACCESS_LOST','PAGE_READ_FAILED']) {
    const rec=check(confirmed(),{
      pageVersion:null,jiraUpdated:null,recheckResult:result,
      reason:'The page could not be read as the reviewer.',
    });
    assert.equal(rec.state,'RECHECK_FAILED');
    assert.throws(()=>acknowledgeVerifiedResolution(rec,{
      actorId:reviewer,expectedRevision:rec.revision,
      verifiedFix:true,reason:'Done',now:at,
    }),/cannot close/);
  }
});

test('No closure if active v1 persists or the fix is unproven', () => {
  for(const state of ['STILL_INCOMPATIBLE','NOT_PROVEN']){
    const rec=check(confirmed(),{recheckResult:state,
      reason:'Original normal-operation instruction remains or is uncertain.'});
    assert.equal(rec.state,'RECHECK_REQUIRED');
    assert.throws(()=>acknowledgeVerifiedResolution(rec,{
      actorId:reviewer,expectedRevision:rec.revision,
      verifiedFix:true,reason:'Done',now:at,
    }),/cannot close/);
  }
});

test('A newer page version alone is not sufficient without unchanged Jira source and verified fix', () => {
  const c=confirmed();
  assert.equal(check(c,{jiraUpdated:'2026-11-19T06:00:00Z'}).state,'RECHECK_FAILED');
  assert.equal(check(c,{pageVersion:3}).state,'RECHECK_FAILED');
  assert.equal(check(c,{pageVersion:2}).state,'RECHECK_FAILED');
  assert.equal(check(c,{jiraUpdated:null}).state,'RECHECK_FAILED');
});

test('After a trusted candidate fix a human acknowledgement is STILL required for closure', () => {
  const ready=check(confirmed());
  assert.equal(ready.state,'READY_FOR_RESOLUTION_REVIEW');
  assert.equal(ready.history.at(-1).recheck.newerPage,true);
  assert.throws(()=>acknowledgeVerifiedResolution(ready,{
    actorId:reviewer,expectedRevision:ready.revision,
    verifiedFix:false,reason:'Not confirmed',now:at,
  }),/trusted complete-fix/);
  assert.throws(()=>acknowledgeVerifiedResolution(ready,{
    actorId:'another-user',expectedRevision:ready.revision,
    verifiedFix:true,reason:'Reviewed source',now:at,
  }),/private/);
  const closed=acknowledgeVerifiedResolution(ready,{
    actorId:reviewer,expectedRevision:ready.revision,
    verifiedFix:true,reason:'Reviewed current Confluence instructions.',now:'2026-11-19T05:04:00Z',
  });
  assert.equal(closed.state,'RESOLVED_VERIFIED');
  assert.equal(closed.revision,4);
  assert.equal(closed.history.length,4);
  assert.throws(()=>applyReviewDecision(closed,{
    actorId:reviewer,expectedRevision:closed.revision,source,
    decision:'NEEDS_EVIDENCE',reason:'Change of mind',now:at,
  }),/closed/);
});

test('Unknown decisions, untrusted rechecks and excessively long notes are rejected', () => {
  const record=fresh();
  assert.throws(()=>applyReviewDecision(record,{
    actorId:reviewer,expectedRevision:1,source,
    decision:'RESOLVED_VERIFIED',reason:'Mark resolved!',now:at,
  }),/Unsupported/);
  assert.throws(()=>recordRecheck(confirmed(),{
    actorId:reviewer,expectedRevision:2,pageVersion:4,
    jiraUpdated:source.jiraUpdated,recheckResult:'AUTOMATICALLY_RESOLVED',
    reason:'Auto',now:at,
  }),/Unsupported/);
  assert.throws(()=>applyReviewDecision(record,{
    actorId:reviewer,expectedRevision:1,source,
    decision:'NEEDS_EVIDENCE',reason:'x'.repeat(601),now:at,
  }),/600/);
});

test('Maximum history length is bounded; failures do not mutate existing records', () => {
  const first=confirmed();
  let current=first;
  for(let i=0;i<28;i++){
    current=recordRecheck(current,{
      actorId:reviewer,expectedRevision:current.revision,
      pageVersion:3,jiraUpdated:source.jiraUpdated,
      recheckResult:'STILL_INCOMPATIBLE',reason:'Same old instruction remains.',
      now:'2026-11-19T05:03:00Z',
    });
  }
  assert.equal(current.history.length,30);
  assert.throws(()=>recordRecheck(current,{
    actorId:reviewer,expectedRevision:current.revision,
    pageVersion:3,jiraUpdated:source.jiraUpdated,
    recheckResult:'NOT_PROVEN',reason:'Same source.',
    now:'2026-11-19T05:04:00Z',
  }),/history cap/);
  assert.equal(current.history.length,30);
  assert.equal(first.history.length,2);
});
