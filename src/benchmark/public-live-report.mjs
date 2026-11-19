import { LIVE_BENCHMARK, benchmarkSearchTelemetry } from './live-scope.mjs';

/**
 * Browser-safe benchmark projection: only expose the documents which passed
 * an authorized asUser body read, plus REQUEST-level telemetry.
 *
 * Private gold labels, unfetched search hits, failed candidate identities,
 * hidden result counts and rankings stay outside the Jira panel.
 */
export function toPublicLiveBenchmark(publicReport, internalReport, options = {}) {
  if (!['B0', 'B1_RETRIEVAL'].includes(internalReport?.variant) ||
      publicReport?.variant !== internalReport.variant ||
      !Array.isArray(publicReport.documents)) {
    throw new TypeError('A public B0 or B1 retrieval projection is required.');
  }
  const telemetry = benchmarkSearchTelemetry(internalReport, options);
  const planned = internalReport.variant === 'B0'
    ? (internalReport.query ? 1 : 0)
    : (options.plannedSearches ?? telemetry.searchesAttempted);
  return {
    variant: internalReport.variant,
    issueKey: internalReport.issueKey,
    status: internalReport.execution.status,
    documents: publicReport.documents,
    inputQuality: options.inputQuality ?? null,
    planStatus: options.planStatus ?? null,
    benchmark: {
      mode: 'SCOPED',
      corpusSpace: LIVE_BENCHMARK.confluenceSpaceKey,
      corpusRevision: LIVE_BENCHMARK.corpusRevision,
      engineBaselineCommit: LIVE_BENCHMARK.engineBaselineCommit,
      readBudget: LIVE_BENCHMARK.readBudget,
      plannedSearches: planned,
      ...telemetry,
      elapsedMs: options.elapsedMs ?? internalReport.elapsedMs ?? null,
      // Never return the number/identity of unfetched, rejected or denied hits.
      usableDocuments: publicReport.documents.length,
    },
    note: 'Controlled DSBMK descendant-only search. Results are retrieved pages, not relevance or operational-drift decisions. No page-gold labels or untrusted search hit identities are exposed.',
  };
}
