/**
 * Developer-only stage-loss evaluator for pre-annotated benchmark data.
 *
 * The gold labels must NEVER be supplied to the discovery engine or returned
 * by a Forge resolver. This module must not be imported by browser-facing code.
 * Accessible gold differs per persona; restricted page identities are omitted
 * rather than reported as missing documents.
 */
export function evaluateDiscoveryStages({ corpus, scenario, persona, report, relevanceDecisions = null }) {
  if (!corpus?.documents || !scenario?.annotations || !report?.variant ||
      !corpus.personas?.includes(persona)) throw new TypeError('Valid corpus, scenario, persona and report required.');
  if (!['B0', 'B1_RETRIEVAL'].includes(report.variant)) {
    throw new Error('Unsupported retrieval variant.');
  }

  const docById = new Map(corpus.documents.map((doc) => [doc.pageId, doc]));
  const byId = new Map();
  for (const annotation of scenario.annotations) {
    if (!docById.has(annotation.pageId) || byId.has(annotation.pageId)) {
      throw new Error('Invalid or duplicate annotation.');
    }
    if (!['relevant', 'not_relevant'].includes(annotation.relevance) ||
        !['procedure_to_review', 'context', 'irrelevant'].includes(annotation.role) ||
        !['yes', 'no', 'unknown', 'not_applicable'].includes(annotation.incompatibleInstruction)) {
      throw new Error('Unknown gold annotation value.');
    }
    if ((annotation.relevance === 'not_relevant') !== (annotation.role === 'irrelevant')) {
      throw new Error('Relevance and role annotations disagree.');
    }
    byId.set(annotation.pageId, annotation);
  }
  if (byId.size !== corpus.documents.length) {
    throw new Error('Every page needs an explicit annotation per scenario.');
  }

  const traces = report.variant === 'B0' ? report.trace : report.candidates;
  if (!Array.isArray(traces)) throw new TypeError('Retrieval trace is required.');
  const observed = new Map(traces.filter((entry) => entry?.pageId).map((entry) => [entry.pageId, entry]));

  const searchHadErrors = report.variant === 'B0'
    ? report.coverage?.searchStatus === 'failed'
    : (report.requests ?? []).some((request) => request.outcome === 'failed');
  const hasUnattributableReadFailure = (report.coverage?.failedReads ?? 0) > 0;
  const noSearch = report.variant === 'B0'
    ? report.coverage?.searchStatus === 'not_started'
    : !((report.coverage?.cqlCallsAttempted ?? 0) + (report.coverage?.directLinksAttempted ?? 0));
  const rows = [];
  let restrictedRelevantCount = 0;

  for (const doc of corpus.documents) {
    const gold = byId.get(doc.pageId);
    if (gold.relevance !== 'relevant') continue;
    if (!doc.accessibleTo.includes(persona)) {
      restrictedRelevantCount++;
      continue;
    }
    const trace = observed.get(doc.pageId) ?? null;
    const retrieved = Boolean(trace);
    const selected = retrieved && (report.variant === 'B0'
      ? trace.selectedForRead === true
      : Number.isInteger(trace.selectionRank));
    const httpRead = selected && (report.variant === 'B0'
      ? trace.fetchStatus === 'fetched'
      : trace.readStatus === 'fetched');
    const usable = httpRead && (report.variant === 'B0'
      ? trace.parseStatus === 'parsed'
      : trace.bodyStatus === 'usable');

    // No post-read B1 relevance assessor yet. Legacy M1 comparison is NOT
    // a reliable, independent relevance judgment and is intentionally ignored.
    const verdict = usable && relevanceDecisions &&
      Object.prototype.hasOwnProperty.call(relevanceDecisions, doc.pageId)
      ? relevanceDecisions[doc.pageId] : null;
    if (verdict !== null && !['relevant', 'not_relevant'].includes(verdict)) {
      throw new Error('Unsupported relevance decision.');
    }
    let lossOrStatus;
    if (noSearch) lossOrStatus = 'NO_SEARCH_PERFORMED';
    else if (!retrieved && hasUnattributableReadFailure) lossOrStatus = 'NOT_OBSERVED_OR_READ_FAILURE_UNATTRIBUTABLE';
    else if (!retrieved && searchHadErrors) lossOrStatus = 'NOT_OBSERVED_SEARCH_PARTIAL';
    else if (!retrieved) lossOrStatus = 'NOT_IN_OBSERVED_HITS';
    else if (!selected) lossOrStatus = 'READ_BUDGET_OR_RANKING';
    else if (!httpRead) lossOrStatus = 'FETCH_FAILED_OR_UNATTRIBUTABLE';
    else if (!usable) lossOrStatus = 'UNUSABLE_CONTENT';
    else if (verdict === null) lossOrStatus = 'NOT_YET_ASSESSED';
    else lossOrStatus = verdict === 'relevant' ? 'RETAINED' : 'RELEVANCE_REJECTED';

    rows.push({
      pageId: doc.pageId,
      title: doc.title,
      role: gold.role,
      expectedIncompatibility: gold.incompatibleInstruction,
      retrieved,
      selected,
      httpRead,
      usableBody: usable,
      retainedAsRelevant: verdict === null ? null : verdict === 'relevant',
      lossOrStatus,
    });
  }

  const stopReasons = [];
  if (noSearch) stopReasons.push('NO_SEARCH_PERFORMED');
  if (searchHadErrors) stopReasons.push('SEARCH_ERRORS');
  if (hasUnattributableReadFailure) stopReasons.push('READ_ERRORS');
  if (report.coverage?.unusableBodies > 0) stopReasons.push('UNUSABLE_BODIES');
  if (report.coverage?.readBudgetTruncated) stopReasons.push('READ_BUDGET_TRUNCATED');
  if ((report.coverage?.queriesNotExecuted ?? 0) > 0) stopReasons.push('QUERY_BUDGET_TRUNCATED');
  if ((report.coverage?.queriesWithMoreResults ?? 0) > 0) stopReasons.push('SEARCH_HAS_MORE_RESULTS');
  if (report.variant === 'B0') stopReasons.push('B0_FIRST_CQL_PAGE_ONLY');

  return {
    schemaVersion: '1.0',
    visibility: 'DEVELOPER_ONLY_GOLD_ANNOTATIONS',
    scenarioId: scenario.id,
    persona,
    variant: report.variant,
    expectedAccessibleRelevant: rows.length,
    restrictedRelevantOmitted: restrictedRelevantCount,
    // These are stage hit counts, NOT evidence of downstream precision.
    retrievedRelevant: rows.filter((row) => row.retrieved).length,
    selectedRelevant: rows.filter((row) => row.selected).length,
    usableRelevant: rows.filter((row) => row.usableBody).length,
    relevanceAssessedRelevant: rows.filter((row) => row.retainedAsRelevant !== null).length,
    actualCqlRequests: report.variant === 'B0'
      ? (report.coverage?.searchStatus === 'not_started' ? 0 : 1)
      : report.coverage?.cqlCallsAttempted,
    // A complete total-request budget requires verified Jira/link/body request accounting.
    totalRequests: null,
    elapsedMs: report.elapsedMs ?? null,
    executionStatus: report.execution?.status ?? 'UNKNOWN',
    stopReasons,
    rows,
  };
}
