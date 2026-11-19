/**
 * Immutable, benchmark-only evaluation boundary.
 *
 * This changes the dataset searched, NOT the B0/B1 retrieval algorithms.
 * Do not apply this to ordinary DriftSignal scans or zero-config trials.
 */
export const LIVE_BENCHMARK = Object.freeze({
  projectKey: 'DSBENCH',
  confluenceSpaceKey: 'DSBMK',
  confluenceSpaceId: '5013508',
  corpusAncestorId: '5177345',
  corpusRevision: '1.1',
  engineBaselineCommit: '090e74f',
  readBudget: 10,
  maxCqlCalls: 4,
  searchLimit: 20,
});

const BENCHMARK_KEYS = new Set(Array.from({ length: 6 }, (_, i) => `DSBENCH-${i + 1}`));

export function isBenchmarkIssueKey(value) {
  return typeof value === 'string' && BENCHMARK_KEYS.has(value);
}

export function scopedBenchmarkCql(baseCql) {
  if (typeof baseCql !== 'string' ||
      !/^type=page AND text ~ "[^"\\\r\n]{3,128}"$/.test(baseCql)) {
    throw new Error('Expected a validated page-search CQL predicate.');
  }
  // Confluence CQL ancestor is a search condition: never trim hits AFTER
  // ranking/limiting, because that biases the read budget.
  return `space = "${LIVE_BENCHMARK.confluenceSpaceKey}" AND ancestor = ${LIVE_BENCHMARK.corpusAncestorId} AND ${baseCql}`;
}

export function benchmarkSearchTelemetry(report, { b0SearchElapsedMs = null } = {}) {
  const requests = report.variant === 'B0'
    ? (report.coverage?.searchStatus === 'not_started' ? [] : [{
        family: 'm1_service_token',
        outcome: report.coverage?.searchStatus === 'ok' ? 'ok' : 'failed',
        elapsedMs: b0SearchElapsedMs,
      }])
    : (report.requests ?? []).map((entry) => ({
        family: Array.isArray(entry.families) ? entry.families[0] ?? 'unknown' : 'unknown',
        outcome: entry.outcome === 'ok' ? 'ok' : 'failed',
        elapsedMs: entry.elapsedMs ?? null,
      }));
  return {
    searchesAttempted: requests.length,
    searchesSucceeded: requests.filter((entry) => entry.outcome === 'ok').length,
    searchesFailed: requests.filter((entry) => entry.outcome === 'failed').length,
    // Only outcomes/timings of attempts; not search hits, title/ranks or page IDs.
    queryExecutions: requests,
  };
}
