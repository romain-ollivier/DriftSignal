import test from 'node:test';
import assert from 'node:assert/strict';
import { investigationScope } from '../src/investigation/scope.mjs';
import { toPublicInvestigation } from '../src/investigation/public-investigation.mjs';
import { authorizeInvestigationPage } from '../src/investigation/authorize-investigation-page.mjs';
import { profileJiraChange } from '../src/discovery/change-profiler.mjs';

test('Jira canonical identity controls scope and rejects unregistered benchmark issues', () => {
  const issue = key => ({ key, fields: {} });
  assert.equal(investigationScope('DSBENCH-6', issue('DSBENCH-6')), true);
  assert.equal(investigationScope('PAY-9', issue('PAY-9')), false);
  assert.throws(() => investigationScope('DSBENCH-7', issue('DSBENCH-7')), /Unregistered/);
  assert.throws(() => investigationScope('DSBENCH-6', issue('PAY-9')), /canonically/);
  assert.throws(() => investigationScope('PAY-9', issue('DSBENCH-6')), /canonically/);
  assert.throws(() => investigationScope('DSBENCH-6', {fields:{}}), /canonically/);
});

test('Jira-only Confluence URL and quote are redacted even though Jira itself was readable', () => {
  const secret='https://acme.atlassian.net/wiki/spaces/SEC/pages/888222/Private-Runbook';
  const profile={signals:[
    {family:'explicit_link',role:'unknown',normalizedValue:secret,rawValue:secret,
      source:{field:'description',path:'description.content[2]',quote:'Private source '+secret}},
    {family:'service_identity',role:'unknown',normalizedValue:'safe-service',rawValue:'safe-service',
      source:{field:'description',path:'description.line[1]',quote:'Service: safe-service'}},
  ],dataQuality:{level:'sufficient'},sourceUpdated:'2026-11-19T00:00:00Z'};
  const report={issueKey:'PAY-9',execution:{status:'COMPLETE_WITHIN_BUDGET'},
    coverage:{},requests:[],candidates:[]};
  const view=toPublicInvestigation({profile,plan:{status:'READY'},retrieval:report,scoped:false});
  const body=JSON.stringify(view);
  assert.equal(body.includes('888222'),false);
  assert.equal(body.includes('Private-Runbook'),false);
  assert.equal(body.includes('/wiki/spaces'),false);
  assert.equal(view.jiraEvidence[0].quote,null);
  assert.match(view.jiraEvidence[0].value,/link mentioned/i);
  assert.equal(view.jiraEvidence[1].value,'safe-service');
});

test('Authorized documents never link to unverified search-result URL or another page', () => {
  const candidates=[
    {pageId:'101',readStatus:'fetched',bodyStatus:'usable',
      title:'Authorized',url:'https://acme.atlassian.net/wiki/pages/viewpage.action?pageId=999',
      paths:[{kind:'cql',families:['service_identity']}]},
    {pageId:'102',readStatus:'fetched',bodyStatus:'usable',
      title:'Authorized 2',url:'https://acme.atlassian.net/wiki/pages/viewpage.action?pageId=102',
      paths:[{kind:'cql',families:['component']}]},
  ];
  const view=toPublicInvestigation({
    profile:{signals:[],dataQuality:{level:'insufficient'}},
    plan:{status:'READY'},
    retrieval:{issueKey:'PAY-9',execution:{status:'COMPLETE_WITHIN_BUDGET'},
      requests:[],coverage:{},candidates},
    authorizedPageEvidence:new Map([
      ['101',{pageTitle:'Actual current title',pageVersion:2,siteOrigin:'https://acme.atlassian.net'}],
      ['102',{pageTitle:'Current 2',pageVersion:3,siteOrigin:'https://acme.atlassian.net'}],
    ]),
    scoped:false,
  });
  assert.equal(view.documents[0].url,'https://acme.atlassian.net/wiki/pages/viewpage.action?pageId=101');
  assert.equal(view.documents[0].title,'Actual current title');
  assert.equal(view.documents[1].url,'https://acme.atlassian.net/wiki/pages/viewpage.action?pageId=102');
});


test('Mixed ADF endpoint quote never reproduces a linked private-page label', () => {
  const secretLabel='CONFIDENTIAL RUNBOOK LABEL X991';
  const linkedIssue={key:'PAY-9',fields:{summary:'Migration',description:{
    type:'doc',version:1,content:[{type:'paragraph',content:[
      {type:'text',text:'Old endpoint: /api/v1/payments. Related procedure: '},
      {type:'text',text:secretLabel,marks:[{type:'link',attrs:{href:
        'https://acme.atlassian.net/wiki/spaces/PRIVATE/pages/888222/hidden'}}]},
    ]}],
  }}};
  const profile=profileJiraChange(linkedIssue);
  assert.ok(profile.signals.some(s=>s.family==='endpoint'&&s.source.quote.includes(secretLabel)));
  const view=toPublicInvestigation({
    issue:linkedIssue,profile,plan:{status:'READY'},
    retrieval:{issueKey:'PAY-9',execution:{status:'COMPLETE_WITHIN_BUDGET'},
      requests:[],coverage:{},candidates:[]},scoped:false,
  });
  const publicJson=JSON.stringify(view);
  assert.equal(publicJson.includes(secretLabel),false);
  assert.equal(publicJson.includes('888222'),false);
  assert.equal(view.jiraEvidence.find(s=>s.family==='endpoint').quote,null);
});

test('Current asUser GET page identity and space gate publication for DSBENCH', async () => {
  const valid={id:'101',title:'Actual title',spaceId:'5013508',status:'current',type:'page'};
  const ancestors=async()=>({results:[{id:'5177345',type:'page'},{id:'999',type:'folder'}],next:null});
  const args={page:valid,pageId:'101',siteId:'https://acme.atlassian.net',scoped:true,readAncestors:ancestors};
  const result=await authorizeInvestigationPage(args);
  assert.equal(result.pageTitle,'Actual title');
  assert.equal(result.siteOrigin,'https://acme.atlassian.net');
  for (const overrides of [
    {page:{...valid,id:'102'}},
    {page:{...valid,spaceId:'777'}},
    {page:{...valid,status:'archived'}},
    {page:{...valid,status:undefined}},
    {readAncestors:async()=>({results:[{id:'5177345',type:'folder'}],next:null})},
    {readAncestors:async()=>({results:[{id:'5177345',type:'page'}],next:'/cursor'})},
    {siteId:'https://untrusted.invalid'},
  ]) {
    await assert.rejects(authorizeInvestigationPage({...args,...overrides}));
  }
  assert.equal((await authorizeInvestigationPage({...args,scoped:false,
    page:{...valid,spaceId:'other'}})).pageTitle,'Actual title');
});

test('Projection requires a verified GET map and never trusts a foreign tenant candidate URL',()=>{
  const candidate={pageId:'204',title:'Wrong search title',
    url:'https://foreign.atlassian.net/wiki/pages/viewpage.action?pageId=204',
    readStatus:'fetched',bodyStatus:'usable',paths:[]};
  const raw={issueKey:'PAY-9',execution:{status:'COMPLETE_WITHIN_BUDGET'},
    requests:[],coverage:{},candidates:[candidate]};
  const setup={profile:{signals:[],dataQuality:{level:'insufficient'}},
    plan:{status:'READY'},retrieval:raw,scoped:false};
  assert.equal(toPublicInvestigation(setup).documents.length,0);
  const v=toPublicInvestigation({...setup,
    authorizedPageEvidence:new Map([['204',{
      pageTitle:'Confirmed GET title',siteOrigin:'https://acme.atlassian.net',
      pageVersion:7,quote:'Current instructions',quoteType:'page_preview_only',
    }]])});
  assert.equal(v.documents[0].title,'Confirmed GET title');
  assert.equal(v.documents[0].url,'https://acme.atlassian.net/wiki/pages/viewpage.action?pageId=204');
  assert.equal(JSON.stringify(v).includes('foreign.atlassian.net'),false);
});
