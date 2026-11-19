import test from 'node:test';
import assert from 'node:assert/strict';
import * as review from '../src/investigation/review-state.mjs';

const source = {
  issueKey:'DSBENCH-6', pageId:'5013806', pageVersion:3,
  jiraUpdated:'2026-11-19T05:00:00Z',
};
const actorId='atlassian-user-123';
const now='2026-11-19T05:01:00Z';
const initial=()=>review.createReview({source,actorId,now});
const decide=(record,overrides={})=>review.applyReviewDecision(record,{
  actorId,source,expectedRevision:record.revision,
  decision:'NEEDS_EVIDENCE',reason:'Retirement cannot be confirmed from Jira.',now,
  ...overrides,
});

test('New review is bound to the page/Jira version actually authorized',()=>{
  const r=initial();
  assert.equal(r.state,'REVIEW_REQUIRED');
  assert.equal(r.pageVersion,3);
  assert.equal(r.jiraUpdated,source.jiraUpdated);
  assert.equal(r.actorId,actorId);
  assert.equal(r.revision,1);
  assert.equal(r.history.length,1);
});
test('Required source identity and version cannot be omitted or forged',()=>{
  for(const bad of [
    {pageId:'not-numeric'},{pageVersion:0},{pageVersion:null},
    {jiraUpdated:null},{issueKey:'invalid'},
  ]){
    assert.throws(()=>review.createReview({
      source:{...source,...bad},actorId,now,
    }));
  }
});
test('Human opinions are review states, not verified machine conclusions',()=>{
  for(const decision of ['NEEDS_EVIDENCE','DISMISSED_BY_REVIEWER','CONFIRMED_BY_REVIEWER']){
    const r=decide(initial(),{
      decision,reason:'Reviewer assessed old route but operational applicability is uncertain.',
    });
    assert.equal(r.state,decision);
    assert.equal(r.revision,2);
    assert.equal(r.history.length,2);
    assert.equal(r.history[1].actor,actorId);
    assert.notEqual(r.state,'RESOLVED_VERIFIED');
  }
});
test('A confirmation needs substantive reviewer explanation',()=>{
  assert.throws(()=>decide(initial(),{
    decision:'CONFIRMED_BY_REVIEWER',reason:'yes',
  }),/substantive/);
});
test('Reject stale revisions, altered source versions, and another account',()=>{
  const record=initial();
  assert.throws(()=>decide(record,{expectedRevision:2}),/Stale/);
  assert.throws(()=>decide(record,{actorId:'another-user'}),/private/);
  assert.throws(()=>decide(record,{source:{...source,pageVersion:4}}),/Source has changed/);
  assert.throws(()=>decide(record,{source:{...source,jiraUpdated:'2026-11-19T06:00:00Z'}}),/Source has changed/);
  assert.throws(()=>decide(record,{source:{...source,pageId:'5013809'}}),/identity changed/);
});
test('No unsupported resolution or unverified recheck states are available',()=>{
  assert.equal('recordRecheck' in review,false);
  assert.equal('acknowledgeVerifiedResolution' in review,false);
  for(const decision of ['RESOLVED_VERIFIED','READY_FOR_RESOLUTION_REVIEW','CANDIDATE_FIXED']){
    assert.throws(()=>decide(initial(),{decision}),/Unsupported/);
  }
});
test('Audit is immutable, bounded, and cannot silently discard events',()=>{
  const first=initial();
  let current=first;
  for(let i=0;i<29;i++){
    current=decide(current,{reason:'More source evidence is needed.'});
  }
  assert.equal(current.history.length,30);
  assert.equal(first.history.length,1);
  assert.throws(()=>decide(current),/history cap/);
});
test('Malformed or oversized reviewer input is rejected',()=>{
  assert.throws(()=>decide(initial(),{reason:'x'.repeat(601)}),/600/);
  assert.throws(()=>decide(initial(),{decision:'NOT_A_DECISION'}),/Unsupported/);
});
