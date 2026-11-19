import test from 'node:test';
import assert from 'node:assert/strict';
import { createPrivateReviewJournal, reviewKeyPrefix } from '../src/investigation/review-journal.mjs';
import { authorizeReviewSource } from '../src/investigation/authorize-review-source.mjs';

const source = { issueKey:'DSBENCH-6', pageId:'5013806',pageVersion:2,jiraUpdated:'2026-11-19T08:00:00Z' };
const accountId='atlassian-account-accepted';
const now='2026-11-19T08:01:00Z';

function inMemoryStorage() {
  const values=new Map();
  let collisions=0;
  const storage={
    async list(prefix, limit){
      const rows=[...values.entries()].filter(([key])=>key.startsWith(prefix))
        .map(([key,value])=>({key,value}));
      if(rows.length>limit)throw new Error('Review history exceeds limit');
      return rows;
    },
    async putNew(key,value){
      if(values.has(key)){ collisions++; throw new Error('ALREADY_EXISTS'); }
      values.set(key,structuredClone(value));
    },
  };
  return {storage,values,get collisions(){return collisions;}};
}
function opinion(review, overrides={}){
  return { actorId:accountId,source,expectedRevision:review.revision,
    decision:'NEEDS_EVIDENCE',reason:'Jira does not explicitly retire V1.',now,...overrides };
}
test('Private journal creates one immutable initial review per user/issue/page',async()=>{
  const mem=inMemoryStorage();const reviews=createPrivateReviewJournal(mem.storage);
  assert.equal(await reviews.read({actorId:accountId,source}),null);
  const first=await reviews.begin({actorId:accountId,source,now});
  assert.equal(first.revision,1);
  assert.equal(first.state,'REVIEW_REQUIRED');
  assert.equal(first.stale,false);
  assert.equal(mem.values.size,1);
  const key=[...mem.values.keys()][0];
  assert.ok(key.includes('DSBENCH-6:5013806:r000001'));
  assert.equal(key.includes(accountId),false,'No raw accountId in KVS key');
  await assert.rejects(reviews.begin({actorId:accountId,source,now}),/already exists/);
});
test('User, issue and page scopes never mix private review histories',async()=>{
  const journal=createPrivateReviewJournal(inMemoryStorage().storage);
  await journal.begin({actorId:accountId,source,now});
  assert.equal(await journal.read({actorId:'someone-else',source}),null);
  assert.equal(await journal.read({actorId:accountId,source:{...source,pageId:'5013890'}}),null);
  assert.equal(await journal.read({actorId:accountId,source:{...source,issueKey:'DSBENCH-5'}}),null);
  assert.notEqual(reviewKeyPrefix({accountId,issueKey:source.issueKey,pageId:source.pageId}),
    reviewKeyPrefix({accountId:'someone-else',issueKey:source.issueKey,pageId:source.pageId}));
});
test('Human decisions are durable, source bound and append-only',async()=>{
  const mem=inMemoryStorage();const journal=createPrivateReviewJournal(mem.storage);
  const r1=await journal.begin({actorId:accountId,source,now});
  const r2=await journal.decide(opinion(r1));
  assert.equal(r2.state,'NEEDS_EVIDENCE');
  assert.equal(r2.revision,2);
  assert.equal(mem.values.size,2);
  assert.equal(mem.values.get([...mem.values.keys()].find(key=>key.endsWith('r000001'))).state,'REVIEW_REQUIRED');
  const loaded=await journal.read({actorId:accountId,source});
  assert.equal(loaded.revision,2);
  assert.deepEqual(loaded.history.map(x=>x.state),['REVIEW_REQUIRED','NEEDS_EVIDENCE']);
  await assert.rejects(journal.decide(opinion(r1)),/Stale review revision/);
});
test('Two competing decisions never silently overwrite one another',async()=>{
  const mem=inMemoryStorage();const journal=createPrivateReviewJournal(mem.storage);
  const first=await journal.begin({actorId:accountId,source,now});
  const settled=await Promise.allSettled([
    journal.decide(opinion(first,{reason:'No V1 retirement evidence.'})),
    journal.decide(opinion(first,{decision:'DISMISSED_BY_REVIEWER',reason:'This is a rollback-only procedure.'})),
  ]);
  assert.equal(settled.filter(x=>x.status==='fulfilled').length,1);
  assert.equal(settled.filter(x=>x.status==='rejected').length,1);
  assert.equal(mem.values.size,2);
  assert.equal((await journal.read({actorId:accountId,source})).revision,2);
  assert.equal(mem.collisions,1);
});
test('A source version change makes a historical record view-only',async()=>{
  const journal=createPrivateReviewJournal(inMemoryStorage().storage);
  await journal.begin({actorId:accountId,source,now});
  for(const stale of [
    {...source,pageVersion:3},
    {...source,jiraUpdated:'2026-11-19T09:00:00Z'},
  ]){
    const entry=await journal.read({actorId:accountId,source:stale});
    assert.equal(entry.stale,true);
    assert.equal(entry.canDecide,false);
    await assert.rejects(journal.decide({
      actorId:accountId,source:stale,expectedRevision:1,
      decision:'NEEDS_EVIDENCE',reason:'Needs more information.',now,
    }),/Source has changed/);
  }
});
test('History corruption and missing revisions always fail closed',async()=>{
  const mem=inMemoryStorage();const journal=createPrivateReviewJournal(mem.storage);
  await journal.begin({actorId:accountId,source,now});
  const prefix=reviewKeyPrefix({accountId,issueKey:source.issueKey,pageId:source.pageId});
  mem.values.set(prefix+'r000003',{...mem.values.get(prefix+'r000001'),revision:3});
  await assert.rejects(journal.read({actorId:accountId,source}),/Missing, duplicate or out-of-order/);
});
function mockSources(overrides={}){
  const calls=[];
  const base={
    readIssue: async key=>{calls.push('jira');return{key,fields:{updated:source.jiraUpdated}};},
    readPage: async id=>{calls.push('page');return{
      id,version:{number:source.pageVersion},status:'current',
      body:{storage:{value:'<p>Normal recovery route</p>'}},
    };},
    readAncestors:async()=>{calls.push('ancestors');return{
      results:[{id:'5177345'},{id:'5013700'}],next:null,
    };},
  };
  return { calls,...base,...overrides};
}
test('Reauthorization reads Jira, page body and DSBMK ancestry as the caller',async()=>{
  const m=mockSources();
  const result=await authorizeReviewSource({issueKey:source.issueKey,pageId:source.pageId,...m});
  assert.deepEqual(result,source);
  assert.deepEqual(m.calls,['jira','page','ancestors']);
});
test('Reauthorization excludes off-corpus, incomplete ancestry and invalid benchmark cases',async()=>{
  for(const ancestry of [
    {results:[{id:'5555555'}],next:null},
    {results:[{id:'5177345'}],next:'/wiki/api/v2/pages/5013806/ancestors?cursor=more'},
    {results:null,next:null},
  ]) {
    const m=mockSources({readAncestors:async()=>ancestry});
    await assert.rejects(authorizeReviewSource({
      issueKey:source.issueKey,pageId:source.pageId,...m,
    }),/corpus|ancestry/);
  }
  const m=mockSources();
  await assert.rejects(authorizeReviewSource({
    issueKey:'DSBENCH-7',pageId:source.pageId,...m,
  }),/Unregistered benchmark/);
  assert.deepEqual(m.calls,[],'Invalid benchmark case is rejected before any API call');
});
test('Missing page rights, stale page version or unreadable body prevent review before storage',async()=>{
  const variants=[
    async()=>{throw new Error('403 forbidden');},
    async id=>({id,version:{number:2},body:{storage:{value:''}}}),
    async id=>({id,version:{number:0},body:{storage:{value:'visible'}}}),
    async id=>({id,version:{number:2},status:'trashed',body:{storage:{value:'visible'}}}),
  ];
  for(const readPage of variants){
    const m=mockSources({readPage});
    await assert.rejects(authorizeReviewSource({
      issueKey:source.issueKey,pageId:source.pageId,...m,
    }));
  }
});
test('Ordinary Jira issue does not require benchmark ancestors but requires user page read',async()=>{
  const m=mockSources();
  const result=await authorizeReviewSource({
    issueKey:'PAY-55',pageId:source.pageId,...m,
  });
  assert.equal(result.issueKey,'PAY-55');
  assert.deepEqual(m.calls,['jira','page']);
});
