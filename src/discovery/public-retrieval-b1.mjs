/**
 * Explicitly limited browser-facing projection of B1 retrieval.
 *
 * Raw candidate paths, query hits, failed page identifiers and all search
 * counts remain in the controlled benchmark report. Never send the raw
 * runB1Retrieval result to Forge Custom UI.
 */
export function toPublicB1Retrieval(report) {
  const documents = (report.candidates ?? [])
    .filter((candidate) =>
      candidate.readStatus === 'fetched' &&
      candidate.bodyStatus === 'usable')
    .map((candidate) => ({
      pageId: candidate.pageId,
      title: candidate.title,
      url: candidate.url,
      // Only explain the broad origin families for pages authorized by readPage.
      sourceFamilies: [...new Set((candidate.paths ?? [])
        .flatMap((path) => path.kind === 'direct_link'
          ? ['direct_link']
          : (path.families ?? [])))],
    }));

  return {
    variant: 'B1_RETRIEVAL',
    issueKey: report.issueKey,
    status: report.execution?.status ?? 'FAILED',
    result: documents.length ? 'DOCUMENTS_FETCHED' : 'NO_DOCUMENTS_FETCHED',
    documents,
    coverage: {
      usableDocuments: documents.length,
      partial: report.execution?.status !== 'COMPLETE_WITHIN_BUDGET',
      searchIncomplete: (report.coverage?.queriesWithMoreResults ?? 0) > 0 ||
        (report.coverage?.queriesNotExecuted ?? 0) > 0 ||
        (report.requests ?? []).some((request) => request.outcome === 'failed'),
      readBudgetTruncated: report.coverage?.readBudgetTruncated === true,
      someReadsFailed: (report.coverage?.failedReads ?? 0) > 0 ||
        (report.coverage?.unusableBodies ?? 0) > 0,
    },
    elapsedMs: report.elapsedMs ?? null,
    note: 'B1 retrieval is not a relevance or drift assessment. Only pages successfully read with usable bodies are displayed.',
  };
}
