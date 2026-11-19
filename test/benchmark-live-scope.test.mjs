import test from 'node:test';
import assert from 'node:assert/strict';
import {
  LIVE_BENCHMARK, isBenchmarkIssueKey, scopedBenchmarkCql,
  benchmarkSearchTelemetry,
} from '../src/benchmark/live-scope.mjs';
import { toPublicLiveBenchmark } from '../src/benchmark/public-live-report.mjs';
import { toPublicB0Report } from '../src/discovery/public-report.mjs';
import { toPublicB1Retrieval } from '../src/discovery/public-retrieval-b1.mjs';
import { cqlFromIntent } from '../src/discovery/confluence-cql.mjs';

test('Live benchmark scope is fixed, not browser-controlled', () => {
  assert.equal(LIVE_BENCHMARK.corpusAncestorId, '5177345');
  assert.equal(LIVE_BENCHMARK.confluenceSpaceKey, 'DSBMK');
  assert.equal(LIVE_BENCHMARK.readBudget, 10);
  for (let i = 1; i <= 6; i++) {
    assert.equal(isBenchmarkIssueKey('DSBENCH-' + i), true);
  }
  assert.equal(isBenchmarkIssueKey('DSBENCH-7'), false);
  assert.equal(isBenchmarkIssueKey('CLSD-6'), false);
  assert.equal(isBenchmarkIssueKey('DSBENCH-1 OR 1=1'), false);
  assert.equal(isBenchmarkIssueKey('dsbench-1'), false);
});

test('Scope is applied INSIDE each Confluence search, not after ranking', () => {
  const cql = scopedBenchmarkCql('type=page AND text ~ "payment"');
  assert.equal(cql,
    'space = "DSBMK" AND ancestor = 5177345 AND type=page AND text ~ "payment"');
  assert.equal((cql.match(/text ~/g) ?? []).length, 1);
});

test('Scoped B1 uses the original validated query intent', () => {
  const base = cqlFromIntent({
    strategy: 'confluence_cql', mode: 'path', searchText: '/settlement/v1/route',
  });
  assert.equal(scopedBenchmarkCql(base),
    'space = "DSBMK" AND ancestor = 5177345 AND type=page AND text ~ "/settlement/v1/route"');
});

test('Refuse unvalidated or injected CQL in benchmark scope', () => {
  assert.throws(() => scopedBenchmarkCql('type=page OR space = "OTHER"'), /validated/);
  assert.throws(() => scopedBenchmarkCql('type=page AND text ~ "ok"'), /validated/);
  assert.throws(() => scopedBenchmarkCql('type=page AND text ~ "payment" OR type=blogpost'), /validated/);
  assert.throws(() => scopedBenchmarkCql('type=page AND text ~ "payment\\\""'), /validated/);
  assert.throws(() => scopedBenchmarkCql('type=page AND text ~ "payment"\nOR space = "OTHER"'), /validated/);
});

test('No executed CQL request when B0 has insufficient input', () => {
  const telemetry = benchmarkSearchTelemetry({
    variant: 'B0', coverage: { searchStatus: 'not_started' },
  });
  assert.equal(telemetry.searchesAttempted, 0);
  assert.deepEqual(telemetry.queryExecutions, []);
});

test('B0 reports attempted failed CQL independently of result content', () => {
  const telemetry = benchmarkSearchTelemetry({
    variant: 'B0', coverage: { searchStatus: 'failed' },
  }, { b0SearchElapsedMs: 87 });
  assert.equal(telemetry.searchesAttempted, 1);
  assert.equal(telemetry.searchesSucceeded, 0);
  assert.equal(telemetry.searchesFailed, 1);
  assert.equal(telemetry.queryExecutions[0].elapsedMs, 87);
});

test('B1 reports executed searches rather than planned intentions', () => {
  const telemetry = benchmarkSearchTelemetry({
    variant: 'B1_RETRIEVAL',
    requests: [
      { families: ['endpoint_old'], outcome: 'ok', rawHits: 100, elapsedMs: 13 },
      { families: ['service_identity'], outcome: 'failed', rawHits: 0, elapsedMs: 34 },
    ],
  });
  assert.equal(telemetry.searchesAttempted, 2);
  assert.equal(telemetry.searchesSucceeded, 1);
  assert.equal(telemetry.searchesFailed, 1);
  assert.equal(JSON.stringify(telemetry).includes('rawHits'), false);
  assert.equal(telemetry.queryExecutions[1].family, 'service_identity');
});

test('Public scoped B1 report never leaks titles and IDs of unread private search hits', () => {
  const internal = {
    variant: 'B1_RETRIEVAL',
    issueKey: 'DSBENCH-6',
    execution: { status: 'PARTIAL' },
    requests: [{ queryId: 'q1', families: ['endpoint_old'], outcome: 'ok', elapsedMs: 22 }],
    candidates: [
      { pageId: '10014', title: 'Restricted secret', url: 'https://test.atlassian.net/x/10014',
        readStatus: 'failed', bodyStatus: 'not_attempted', paths: [{ kind: 'cql', families: ['endpoint_old'] }] },
      { pageId: '10007', title: 'Public catalog', url: 'https://test.atlassian.net/x/10007',
        readStatus: 'fetched', bodyStatus: 'usable', paths: [{ kind: 'cql', families: ['service_identity'] }] },
    ],
    coverage: { cqlCallsAttempted: 1, failedReads: 1, readBudgetTruncated: false },
    elapsedMs: 150,
  };
  const publicResult = toPublicLiveBenchmark(toPublicB1Retrieval(internal), internal, {
    plannedSearches: 3, elapsedMs: 170,
  });
  assert.equal(publicResult.benchmark.plannedSearches, 3);
  assert.equal(publicResult.benchmark.searchesAttempted, 1);
  assert.equal(publicResult.benchmark.readBudget, 10);
  assert.equal(publicResult.documents.length, 1);
  assert.equal(publicResult.documents[0].pageId, '10007');
  const serialized = JSON.stringify(publicResult);
  assert.equal(serialized.includes('10014'), false);
  assert.equal(serialized.includes('Restricted secret'), false);
  assert.equal(serialized.includes('readBudgetTruncated'), false);
  assert.equal(serialized.includes('failedReads'), false);
});

test('Public scoped B0 report uses only successful as-user bodies, not raw search hits', () => {
  const internal = {
    variant: 'B0', issueKey: 'DSBENCH-1',
    query: { term: 'payment' },
    execution: { status: 'PARTIAL' },
    coverage: { searchStatus: 'ok', failedReads: 1 },
    trace: [
      { pageId: '900', fetchStatus: 'failed', parseStatus: 'not_attempted', title: 'Hidden title' },
      { pageId: '901', fetchStatus: 'fetched', parseStatus: 'parsed', title: 'Authorized page',
        url: 'https://test.atlassian.net/wiki/pages/901', legacyComparison: 'NOT_RELATED' },
    ],
    elapsedMs: 120,
  };
  const publicResult = toPublicLiveBenchmark(toPublicB0Report(internal), internal, {
    elapsedMs: 140, b0SearchElapsedMs: 30,
  });
  assert.equal(publicResult.documents.length, 1);
  assert.equal(publicResult.documents[0].pageId, '901');
  assert.equal(publicResult.benchmark.searchesAttempted, 1);
  assert.equal(JSON.stringify(publicResult).includes('Hidden title'), false);
  assert.equal(JSON.stringify(publicResult).includes('"900"'), false);
});

test('Projection rejects mismatched B0/B1 report variants', () => {
  assert.throws(() => toPublicLiveBenchmark(
    { variant: 'B0', documents: [] },
    { variant: 'B1_RETRIEVAL', execution: { status: 'PARTIAL' } },
  ), /public/);
});
