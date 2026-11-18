import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { adfToText, htmlToPlainText, parseChange, parseRunbook, compareClaims, searchToken, validIssueKey } from '../src/core.mjs';
import { scanDrift } from '../src/scan.mjs';

const issue = JSON.parse(readFileSync(new URL('../fixtures/jira-issue.json', import.meta.url)));
const page = JSON.parse(readFileSync(new URL('../fixtures/confluence-page.json', import.meta.url)));
const change = parseChange(adfToText(issue.fields.description));
const runbook = parseRunbook(htmlToPlainText(page.body.storage.value));
const mock = (pages=[page]) => ({
  readIssue: async () => issue,
  searchPages: async () => pages.map(p=>({id:p.id,title:p.title,url:'https://example.atlassian.net/wiki/pages/viewpage.action?pageId='+p.id})),
  readPage: async id => pages.find(p=>p.id===id),
});

test('ADF description retains line boundaries', () => {
  const text = adfToText(issue.fields.description);
  assert.match(text, /Service: payment-gateway\nNew endpoint: \/api\/v2\/payments/);
});
test('Confluence storage is converted into lines', () => {
  const parsed = parseRunbook(htmlToPlainText(page.body.storage.value)); assert.equal(parsed.serviceId, "payment-gateway"); assert.equal(parsed.endpoint, "/api/v1/payments");
});
test('Parses normalized claims from Jira and runbook', () => {
  assert.equal(change.serviceId, 'payment-gateway');
  assert.equal(change.endpoint, '/api/v2/payments');
  assert.equal(runbook.endpoint, '/api/v1/payments');
});
test('Detects exact service with conflicting endpoints', () => {
  assert.equal(compareClaims(change,runbook).status,'SOURCE_CONFLICT');
});
test('Does not create conflict if endpoints match', () => {
  assert.equal(compareClaims(change, {...runbook, endpoint: '/api/v2/payments'}).status,'IN_SYNC');
});
test('Does not link unrelated services', () => {
  assert.equal(compareClaims(change, {...runbook, serviceId:'inventory-api'}).status,'NOT_RELATED');
});
test('Marks multiple runbook endpoints as ambiguous', () => {
  const ambiguous = parseRunbook('Service: payment-gateway\nEndpoint: /api/v1/payments\nEndpoint: /api/v2/payments');
  assert.equal(compareClaims(change,ambiguous).status,'REVIEW_REQUIRED');
});
test('Requires a structured change (no guesses)', () => {
  assert.equal(parseChange('The endpoint was updated').structured,false);
});
test('Search term is sanitized', () => {
  assert.equal(searchToken('payment-gateway'),'payment');
  assert.equal(searchToken('!!!'),null);
});
test('Validates issue key', () => {
  assert.equal(validIssueKey('PAY-101'),true);
  assert.equal(validIssueKey('../../secret'),false);
});
test('Integration: orchestration detects a conflict with evidence', async () => {
  const result=await scanDrift('PAY-101',mock());
  assert.equal(result.outcome,'SOURCE_CONFLICT');
  assert.equal(result.inspected,1);
  assert.equal(result.related,1);
  assert.equal(result.findings[0].documentationEvidence,'Endpoint: /api/v1/payments');
  assert.equal(result.findings[0].jiraEvidence,'New endpoint: /api/v2/payments');
});
test('Integration: no related runbook is not a proven gap', async () => {
  const result=await scanDrift('PAY-101',mock([]));
  assert.equal(result.outcome,'NO_RELATED_DOCS');
  assert.equal(result.findings.length,0);
});
test('Integration: a matching runbook is in sync', async () => {
  const fixed={...page,body:{storage:{value:'<p>Service: payment-gateway</p><p>Endpoint: /api/v2/payments</p>'}}};
  const result=await scanDrift('PAY-101',mock([fixed]));
  assert.equal(result.outcome,'IN_SYNC');
});
test('Integration: ignores pages with unrelated service IDs', async () => {
  const unrelated={...page,body:{storage:{value:'<p>Service: other-service</p><p>Endpoint: /api/v1/payments</p>'}}};
  const result=await scanDrift('PAY-101',mock([unrelated]));
  assert.equal(result.outcome,'NO_RELATED_DOCS');
  assert.equal(result.related,0);
});

