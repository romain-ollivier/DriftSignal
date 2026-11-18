import test from 'node:test';
import assert from 'node:assert/strict';
import { runB1Retrieval } from '../src/discovery/retrieval-b1.mjs';
import { toPublicB1Retrieval } from '../src/discovery/public-retrieval-b1.mjs';
import { profileJiraChange } from '../src/discovery/change-profiler.mjs';
import { planDiscoveryQueries } from '../src/discovery/query-planner.mjs';

function query(id, searchText, family = 'service_identity') {
  return {
    id,
    searchText,
    families: [family],
    origins: [{ signalId: 's-' + id, field: 'description', path: 'description.line[0]' }],
  };
}
function plan(queries, directLinks = []) {
  return { variant: 'B1', issueKey: 'CLSD-6', queries, directLinks };
}
function gateway(responses, pages = {}, options = {}) {
  const calls = { search: [], read: [], direct: [] };
  return {
    calls,
    async searchConfluence(intent, { limit }) {
      calls.search.push([intent.id, intent.searchText, limit]);
      const response = responses[intent.searchText];
      if (response instanceof Error) throw response;
      return typeof response === 'function' ? response(intent, limit) :
        response ?? { siteId: 'tenant-1', results: [] };
    },
    async readPage(id, siteId) {
      calls.read.push([id, siteId]);
      const response = pages[siteId + ':' + id];
      if (response instanceof Error) throw response;
      if (!response) throw new Error('404');
      return response;
    },
    async resolveDirectLink(url) {
      calls.direct.push(url);
      if (options.resolveError) throw options.resolveError;
      return options.links?.[url] ?? null;
    },
  };
}
const hit = (id, title = 'Service runbook') => ({ id: String(id), title });
const page = (id, text = '<p>Service: inventory</p>') =>
  ({ id: String(id), title: 'Verified ' + id, body: { storage: { value: text } } });

test('B1 discovers a differently named runbook via old endpoint even without service token', async () => {
  const issue = {
    key: 'CLSD-7',
    fields: {
      summary: 'Migrate payment service',
      description: 'Old endpoint: /settlement/v1/route\nNew endpoint: /settlement/v2/route',
    },
  };
  const planned = planDiscoveryQueries(profileJiraChange(issue));
  assert.equal(planned.queries[0].searchText, '/settlement/v1/route');
  const g = gateway({
    '/settlement/v1/route': { siteId: 'tenant-1', results: [hit('100', 'Orchid Recovery Instructions')] },
    '/settlement/v2/route': { siteId: 'tenant-1', results: [hit('200', 'Unrelated update notes')] },
  }, {
    'tenant-1:100': page('100', '<p>Use /settlement/v1/route on rollback.</p>'),
    'tenant-1:200': page('200'),
  });
  const result = await runB1Retrieval(planned, g, { readBudget: 1 });
  assert.equal(result.candidates.length, 2);
  assert.equal(result.coverage.selectedForRead, 1);
  assert.equal(result.coverage.usableBodies, 1);
  assert.equal(result.candidates.find((c) => c.pageId === '100').selectionRank, 1);
  assert.equal(result.decision, 'NOT_EVALUATED');
  assert.equal(g.calls.read.length, 1);
});

test('B1 merges duplicate pages across CQL queries while preserving raw query ranks', async () => {
  const p = plan([
    query('q1', 'old-path', 'endpoint_old'),
    query('q2', 'service-name', 'service_identity'),
  ]);
  const g = gateway({
    'old-path': { siteId: 'tenant-1', results: [hit('111'), hit('222')] },
    'service-name': { siteId: 'tenant-1', results: [hit('333'), hit('222')] },
  }, {
    'tenant-1:111': page('111'),
    'tenant-1:222': page('222'),
    'tenant-1:333': page('333'),
  });
  const r = await runB1Retrieval(p, g, { readBudget: 3 });
  assert.equal(r.coverage.rawHits, 4);
  assert.equal(r.coverage.uniqueCandidates, 3);
  const shared = r.candidates.find((candidate) => candidate.pageId === '222');
  assert.deepEqual(shared.paths.map((item) => [item.operationId, item.rawRank]), [['q1', 2], ['q2', 2]]);
  assert.deepEqual(g.calls.read.map(([id]) => id), ['111', '333', '222']);
  assert.equal(r.coverage.fetchedPages, 3);
});

test('B1 diversifies the read budget across technical signal families', async () => {
  const p = plan([query('q1', 'old', 'endpoint_old'), query('q2', 'component', 'component')]);
  const g = gateway({
    old: { siteId: 'tenant-1', results: [hit('101'), hit('102'), hit('103')] },
    component: { siteId: 'tenant-1', results: [hit('201'), hit('202')] },
  }, Object.fromEntries(['101','102','103','201','202'].map((id) => ['tenant-1:' + id, page(id)])));
  const r = await runB1Retrieval(p, g, { readBudget: 2 });
  assert.deepEqual(g.calls.read.map(([id]) => id), ['101', '201']);
  assert.equal(r.coverage.readBudgetTruncated, true);
});

test('B1 retains available results after one search error and reports PARTIAL', async () => {
  const g = gateway({
    bad: new Error('403'),
    good: { siteId: 'tenant-1', results: [hit('300')] },
  }, { 'tenant-1:300': page('300') });
  const r = await runB1Retrieval(plan([query('q1', 'bad'), query('q2', 'good')]), g);
  assert.equal(r.execution.status, 'PARTIAL');
  assert.equal(r.coverage.fetchedPages, 1);
  assert.equal(r.requests[0].outcome, 'failed');
  assert.equal(r.requests[1].outcome, 'ok');
  assert.equal(r.execution.errors[0].code, 'SEARCH_FAILED');
});

test('B1 differentiates a successful HTTP read from unusable body content', async () => {
  const g = gateway({ old: { siteId: 'tenant-1', results: [hit('400')] } }, {
    'tenant-1:400': page('400', ''),
  });
  const r = await runB1Retrieval(plan([query('q1', 'old')]), g);
  assert.equal(r.coverage.fetchedPages, 1);
  assert.equal(r.coverage.usableBodies, 0);
  assert.equal(r.coverage.unusableBodies, 1);
  assert.equal(r.candidates[0].bodyStatus, 'unusable');
  assert.equal(r.execution.status, 'PARTIAL');
});

test('B1 preserves coverage when pagination is available but not executed', async () => {
  const g = gateway({
    old: { siteId: 'tenant-1', results: [hit('500')], hasMore: true },
  }, { 'tenant-1:500': page('500') });
  const r = await runB1Retrieval(plan([query('q1', 'old')]), g);
  assert.equal(r.coverage.queriesWithMoreResults, 1);
  assert.ok(r.coverage.limitations.some((line) => line.includes('more pages')));
  assert.equal(g.calls.search.length, 1);
});

test('B1 enforces execution CQL and body-read budgets independently', async () => {
  const g = gateway({
    a: { siteId: 'tenant-1', results: [hit('600'), hit('601')] },
    b: { siteId: 'tenant-1', results: [hit('602')] },
  }, Object.fromEntries(['600', '601', '602'].map((id) => ['tenant-1:' + id, page(id)])));
  const r = await runB1Retrieval(plan([query('q1', 'a'), query('q2', 'b')]), g,
    { maxCqlCalls: 1, readBudget: 1 });
  assert.equal(g.calls.search.length, 1);
  assert.equal(g.calls.read.length, 1);
  assert.equal(r.coverage.queriesNotExecuted, 1);
  assert.equal(r.coverage.readBudgetTruncated, true);
});

test('B1 does not merge identical page IDs on different Confluence sites', async () => {
  const g = gateway({
    a: { siteId: 'tenant-1', results: [hit('700')] },
    b: { siteId: 'tenant-2', results: [hit('700')] },
  }, { 'tenant-1:700': page('700'), 'tenant-2:700': page('700') });
  const r = await runB1Retrieval(plan([query('q1', 'a'), query('q2', 'b')]), g);
  assert.equal(r.coverage.uniqueCandidates, 2);
  assert.equal(g.calls.read.length, 2);
});

test('B1 skips cross-tenant direct links and does not perform their page reads', async () => {
  const link = 'https://other.atlassian.net/wiki/pages/800';
  const g = gateway({}, {}, {
    links: { [link]: { siteId: 'tenant-other', pageId: '800', sameTenant: false } },
  });
  const r = await runB1Retrieval(plan([], [{ id: 'l1', url: link, origins: [] }]), g);
  assert.equal(r.coverage.directLinksNotResolved, 1);
  assert.equal(r.coverage.uniqueCandidates, 0);
  assert.equal(g.calls.read.length, 0);
});

test('B1 verified direct link is considered before CQL results, subject to as-user read', async () => {
  const link = 'https://demo.atlassian.net/wiki/pages/viewpage.action?pageId=900';
  const g = gateway({
    text: { siteId: 'tenant-1', results: [hit('901')] },
  }, {
    'tenant-1:900': page('900'),
    'tenant-1:901': page('901'),
  }, {
    links: { [link]: { siteId: 'tenant-1', pageId: '900', sameTenant: true } },
  });
  const r = await runB1Retrieval(plan([query('q1', 'text')], [{ id: 'l1', url: link, origins: [] }]),
    g, { readBudget: 1 });
  assert.deepEqual(g.calls.read.map(([id]) => id), ['900']);
  assert.equal(r.candidates[0].paths[0].kind, 'direct_link');
});

test('B1 does not classify a page as irrelevant when access is revoked during fetch', async () => {
  const g = gateway({ text: { siteId: 'tenant-1', results: [hit('950')] } }, {
    'tenant-1:950': new Error('403'),
  });
  const r = await runB1Retrieval(plan([query('q1', 'text')]), g);
  assert.equal(r.execution.status, 'PARTIAL');
  assert.equal(r.coverage.failedReads, 1);
  assert.equal(r.candidates[0].readStatus, 'failed');
  assert.equal(r.candidates[0].title, null);
  assert.equal(r.candidates[0].url, null);
  assert.equal(r.decision, 'NOT_EVALUATED');
});

test('B1 checks budgets and refuses malformed gateways', async () => {
  const g = gateway();
  await assert.rejects(() => runB1Retrieval(plan([]), g, { readBudget: 100 }), /readBudget/);
  await assert.rejects(() => runB1Retrieval(plan([]), g, { searchLimit: 0 }), /searchLimit/);
  await assert.rejects(() => runB1Retrieval(plan([]), {}), /Gateway/);
});


test('B1 public projection excludes unread and permission-revoked search hits', async () => {
  const g = gateway({
    text: { siteId: 'tenant-1', results: [
      hit('970', 'Authorized runbook'),
      hit('971', 'Restricted procedure'),
      hit('972', 'Unselected runbook'),
    ] },
  }, {
    'tenant-1:970': page('970'),
    'tenant-1:971': new Error('403'),
    'tenant-1:972': page('972'),
  });
  const internal = await runB1Retrieval(plan([query('q1', 'text')]), g, { readBudget: 2 });
  const external = toPublicB1Retrieval(internal);
  const json = JSON.stringify(external);
  assert.equal(external.documents.length, 1);
  assert.equal(external.documents[0].pageId, '970');
  assert.equal(json.includes('Restricted procedure'), false);
  assert.equal(json.includes('971'), false);
  assert.equal(json.includes('972'), false);
  assert.equal('candidates' in external, false);
  assert.equal('rawHits' in external.coverage, false);
  assert.equal(external.coverage.someReadsFailed, true);
  assert.equal(external.coverage.readBudgetTruncated, true);
});

test('B1 public retrieval report does not assert a relevance decision', async () => {
  const g = gateway({ text: { siteId: 'tenant-1', results: [hit('980')] } }, {
    'tenant-1:980': page('980'),
  });
  const external = toPublicB1Retrieval(await runB1Retrieval(plan([query('q1', 'text')]), g));
  assert.equal(external.result, 'DOCUMENTS_FETCHED');
  assert.ok(external.note.includes('not a relevance or drift assessment'));
});
