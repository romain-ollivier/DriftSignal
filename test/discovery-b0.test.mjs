import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runB0Diagnostic } from '../src/discovery/b0-diagnostic.mjs';

const sourceIssue = JSON.parse(readFileSync(new URL('../fixtures/jira-issue.json', import.meta.url)));
const sourcePage = JSON.parse(readFileSync(new URL('../fixtures/confluence-page.json', import.meta.url)));

function fixturePage(id, title, body) {
  return {
    id: String(id),
    title,
    body: { storage: { value: body } },
  };
}

// Deliberately query-sensitive: unlike M1's original mock, the query controls
// which pages are returned. This is still a MOCK, not a live CQL integration test.
function fixtureGateway({ issue = sourceIssue, pages = [sourcePage], failPageId = null, failSearch = false } = {}) {
  const searched = [];
  return {
    searched,
    readIssue: async () => issue,
    searchPages: async (token) => {
      searched.push(token);
      if (failSearch) throw new Error('Search service unavailable');
      return pages
        .filter((page) => (page.title + ' ' + page.body.storage.value).toLowerCase().includes(token))
        .map(({ id, title }) => ({ id: String(id), title }));
    },
    readPage: async (id) => {
      if (String(id) === String(failPageId)) throw new Error('403: no access');
      const page = pages.find((candidate) => String(candidate.id) === String(id));
      if (!page) throw new Error('404');
      return page;
    },
  };
}

test('B0 records the real query argument and retrieved/read stages', async () => {
  const gateway = fixtureGateway();
  const result = await runB0Diagnostic('PAY-101', gateway);
  assert.deepEqual(gateway.searched, ['payment']);
  assert.deepEqual(result.query, { strategy: 'm1_service_token', term: 'payment' });
  assert.equal(result.coverage.searchStatus, 'ok');
  assert.equal(result.coverage.uniqueHits, 1);
  assert.equal(result.coverage.selectedForRead, 1);
  assert.equal(result.coverage.fetchedPages, 1);
  assert.equal(result.trace[0].legacyComparison, 'SOURCE_CONFLICT');
  assert.equal(result.decision, 'LEGACY_RELATED_FOUND');
  assert.equal(result.coverage.firstSearchPageOnly, true);
});

test('B0 does not pretend to discover a page excluded by its query', async () => {
  const invisibleToQuery = fixturePage('2002', 'Inventory Notes', '<p>Service: payment-gateway</p><p>Endpoint: /api/v1/payments</p>');
  // A search for "payment" would match this page's body. Use a different
  // token to demonstrate the fixture gateway actually filters hits.
  const gateway = fixtureGateway({ pages: [invisibleToQuery] });
  assert.deepEqual(await gateway.searchPages('no-such-term'), []);
  const report = await runB0Diagnostic('PAY-101', fixtureGateway({
    pages: [fixturePage('2003', 'Unrelated', '<p>Service: inventory-api</p>')],
  }));
  assert.equal(report.coverage.returnedHits, 0);
  assert.equal(report.trace.length, 0);
  assert.equal(report.decision, 'NO_LEGACY_RELATED_FOUND');
});

test('B0 preserves earlier authorized evidence after a later page failure', async () => {
  const second = fixturePage('2004', 'Payment Recovery Private', '<p>Service: payment-gateway</p><p>Endpoint: /api/v1/payments</p>');
  const gateway = fixtureGateway({ pages: [sourcePage, second], failPageId: second.id });
  const report = await runB0Diagnostic('PAY-101', gateway);
  assert.equal(report.execution.status, 'PARTIAL');
  assert.equal(report.coverage.fetchedPages, 1);
  assert.equal(report.coverage.failedReads, 1);
  assert.equal(report.trace[0].legacyComparison, 'SOURCE_CONFLICT');
  assert.equal(report.trace[1].fetchStatus, 'failed');
  assert.equal('pageId' in report.trace[1], false);
  assert.equal('title' in report.trace[1], false);
});

test('B0 shows pre-read exclusions caused by its budget', async () => {
  const pages = [
    sourcePage,
    fixturePage('2005', 'Payments Ops', '<p>Service: payment-gateway</p><p>Endpoint: /api/v1/payments</p>'),
  ];
  const report = await runB0Diagnostic('PAY-101', fixtureGateway({ pages }), { readBudget: 1 });
  assert.equal(report.coverage.uniqueHits, 2);
  assert.equal(report.coverage.selectedForRead, 1);
  assert.equal(report.coverage.readBudgetTruncated, true);
  assert.equal(report.trace[1].selectedForRead, false);
  assert.equal(report.trace[1].legacyComparison, 'NOT_EVALUATED');
});

test('B0 abstains on an unstructured Jira description', async () => {
  const issue = { ...sourceIssue, fields: { ...sourceIssue.fields, description: 'Update API configuration' } };
  const gateway = fixtureGateway({ issue });
  const result = await runB0Diagnostic('PAY-101', gateway);
  assert.equal(result.decision, 'INSUFFICIENT_INPUT');
  assert.deepEqual(gateway.searched, []);
  assert.equal(result.coverage.searchStatus, 'not_started');
});

test('B0 reports search failure without leaking response bodies', async () => {
  const report = await runB0Diagnostic('PAY-101', fixtureGateway({ failSearch: true }));
  assert.equal(report.execution.status, 'FAILED');
  assert.deepEqual(report.execution.errors, [{ stage: 'search', code: 'SEARCH_FAILED' }]);
  assert.equal(report.trace.length, 0);
  assert.equal(report.coverage.queryErrors, 1);
});

test('B0 validates the read budget', async () => {
  await assert.rejects(
    () => runB0Diagnostic('PAY-101', fixtureGateway(), { readBudget: 0 }),
    /readBudget/,
  );
});
