import test from 'node:test';
import assert from 'node:assert/strict';
import { investigationScope } from '../src/investigation/scope.mjs';
import { toPublicInvestigation } from '../src/investigation/public-investigation.mjs';

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
    scoped:false,
  });
  assert.equal(view.documents[0].url,null);
  assert.equal(view.documents[1].url,'https://acme.atlassian.net/wiki/pages/viewpage.action?pageId=102');
});
