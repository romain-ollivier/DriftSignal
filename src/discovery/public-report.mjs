/**
 * Produce a minimum browser-facing projection of a B0 diagnostic.
 *
 * The detailed trace is reserved for controlled evaluation. In particular,
 * a Confluence search hit that was not successfully fetched must never
 * expose a page identity, title or aggregate count in the UI: access may
 * have been revoked between the search and the fetch.
 */
export function toPublicB0Report(report) {
  const documents = (report.trace ?? [])
    .filter((entry) => entry.fetchStatus === 'fetched')
    .map((entry) => ({
      pageId: entry.pageId,
      title: entry.title,
      url: entry.url,
      legacyComparison: entry.legacyComparison,
      jiraEvidence: entry.evidence?.jira ?? null,
      confluenceEvidence: entry.evidence?.confluence ?? null,
    }));

  const status = report.execution?.status ?? 'FAILED';
  return {
    variant: 'B0',
    issueKey: report.issueKey,
    queryTerm: report.query?.term ?? null,
    inputUsable: report.input?.hasStructuredChange === true,
    status,
    decision: report.decision,
    documents,
    coverage: {
      fetchedPages: documents.length,
      // Only counts drawn from successfully fetched pages appear in the UI.
      readBudgetTruncated: report.coverage?.readBudgetTruncated === true,
      firstSearchPageOnly: true,
      limitedSearch: true,
      failedOrSkippedReads: report.coverage?.failedReads > 0,
      searchFailed: report.coverage?.searchStatus === 'failed',
    },
    elapsedMs: report.elapsedMs ?? null,
    note: 'B0 is a single-token diagnostic. A discovered page or a legacy SOURCE_CONFLICT is not proof of operational drift. Search and read coverage are incomplete by design.',
  };
}
