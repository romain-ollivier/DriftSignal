import test from 'node:test';
import assert from 'node:assert/strict';
import { assertViewedSource } from '../src/investigation/viewed-source.mjs';
import { authorizeReviewSource } from '../src/investigation/authorize-review-source.mjs';

const viewed={
  issueKey:'DSBENCH-6',pageId:'5013806',
  jiraUpdated:'2026-11-19T08:00:00Z',pageVersion:1,
};
const allowed={
  readIssue:async key=>({key,fields:{updated:viewed.jiraUpdated}}),
  readPage:async id=>({id,spaceId:'5013508',status:'current',
    version:{number:2},body:{storage:{value:'<p>Instruction updated</p>'}}}),
  readAncestors:async()=>({results:[{id:'5177345',type:'page'}],next:null}),
};

test('Displayed source preconditions must include canonical Jira key and both versions',()=>{
  assert.doesNotThrow(()=>assertViewedSource(viewed,{...viewed}));
  for(const stale of [
    {...viewed,pageVersion:2},
    {...viewed,jiraUpdated:'2026-11-19T08:01:00Z'},
    {...viewed,pageId:'5013807'},
    {...viewed,issueKey:'DSBENCH-5'},
    {...viewed,pageVersion:null},
    {...viewed,jiraUpdated:null},
    null,
  ]){
    assert.throws(()=>assertViewedSource(viewed,stale),/source|Displayed|stale/);
  }
});

test('Displayed v1 cannot start or confirm a review that server sees as page v2',async()=>{
  const source=await authorizeReviewSource({
    issueKey:viewed.issueKey,pageId:viewed.pageId,...allowed,
  });
  assert.equal(source.pageVersion,2);
  assert.throws(()=>assertViewedSource(source,viewed),/stale/);
  // Even if the user is still authorized, the old UI cannot bind its
  // decision to the newer source until the engineer re-investigates.
});

test('Current page version alone does not override a changed Jira declaration',async()=>{
  const changedJira={
    ...allowed,
    readIssue:async key=>({key,fields:{updated:'2026-11-19T09:00:00Z'}}),
    readPage:async id=>({id,spaceId:'5013508',status:'current',
      version:{number:1},body:{storage:{value:'<p>Original</p>'}}}),
  };
  const source=await authorizeReviewSource({
    issueKey:viewed.issueKey,pageId:viewed.pageId,...changedJira,
  });
  assert.throws(()=>assertViewedSource(source,viewed),/stale/);
});

test('A user must re-investigate rather than submit a forged missing version',()=>{
  assert.throws(()=>assertViewedSource(viewed,{
    issueKey:viewed.issueKey,pageId:viewed.pageId,
    jiraUpdated:viewed.jiraUpdated,
  }),/Displayed/);
});
