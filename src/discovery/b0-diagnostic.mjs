import {
  adfToText,
  htmlToPlainText,
  parseChange,
  parseRunbook,
  compareClaims,
  searchToken,
  validIssueKey,
  validPageId,
} from '../core.mjs';

/**
 * B0 diagnostic: instrument the existing single-token M1 discovery behavior.
 *
 * This is NOT a validated relevance benchmark. "legacyComparison" represents
 * the M1 structured-service comparison, not an independent ground-truth label.
 * The returned trace is for a controlled evaluation harness only: do not expose
 * it directly to arbitrary browser users without an authorization-aware view.
 *
 * Gateway operations are injected so unit tests remain independent of Forge.
 * When wired through the M1 Forge gateway, searchPages executes real CQL.
 */
export async function runB0Diagnostic(issueKey, gateway, options = {}) {
  if (!validIssueKey(issueKey)) throw new Error('Invalid Jira issue key.');
  const now = options.now ?? (() => performance.now());
  const requestedBudget = options.readBudget ?? 15;
  if (!Number.isInteger(requestedBudget) || requestedBudget < 1 || requestedBudget > 15) {
    throw new Error('readBudget must be an integer from 1 to 15.');
  }

  const start = now();
  const issue = await gateway.readIssue(issueKey);
  const description = typeof issue.fields?.description === 'string'
    ? issue.fields.description
    : adfToText(issue.fields?.description);
  const change = parseChange(description);
  const token = change.structured ? searchToken(change.serviceId) : null;

  const report = {
    schemaVersion: '0.1',
    variant: 'B0',
    issueKey: issue.key ?? issueKey,
    query: token ? { strategy: 'm1_service_token', term: token } : null,
    input: { hasStructuredChange: change.structured, serviceId: change.serviceId },
    decision: !change.structured ? 'INSUFFICIENT_INPUT'
      : !token ? 'UNSUPPORTED_TOKEN' : 'NOT_EVALUATED',
    // Developer-only stage trace. A browser view must independently filter it.
    trace: [],
    coverage: {
      searchStatus: 'not_started',
      returnedHits: 0,
      uniqueHits: 0,
      selectedForRead: 0,
      fetchedPages: 0,
      parsedPages: 0,
      unusableBodies: 0,
      failedReads: 0,
      readBudget: requestedBudget,
      searchPageLimit: 20,
      firstSearchPageOnly: true,
      readBudgetTruncated: false,
      queryErrors: 0,
      limitations: ['M1 CQL search reads only its first response (up to 20 hits); pagination is not implemented.'],
    },
    execution: { status: 'COMPLETE_WITHIN_BUDGET', errors: [] },
    elapsedMs: 0,
  };

  if (!token) {
    report.elapsedMs = Math.max(0, now() - start);
    report.coverage.limitations.push('No search executed because structured input or service token was unavailable.');
    return report;
  }

  let found;
  try {
    found = await gateway.searchPages(token);
    report.coverage.searchStatus = 'ok';
  } catch {
    report.coverage.searchStatus = 'failed';
    report.coverage.queryErrors = 1;
    report.execution.status = 'FAILED';
    report.execution.errors.push({ stage: 'search', code: 'SEARCH_FAILED' });
    report.coverage.limitations.push('Confluence search failed; the result cannot be considered comprehensive.');
    report.elapsedMs = Math.max(0, now() - start);
    return report;
  }

  const hits = Array.isArray(found) ? found : [];
  report.coverage.returnedHits = hits.length;
  const deduplicated = new Map();
  for (let rawIndex = 0; rawIndex < hits.length; rawIndex++) {
    const hit = hits[rawIndex];
    if (!validPageId(hit?.id)) continue;
    const id = String(hit.id);
    if (deduplicated.has(id)) {
      deduplicated.get(id).rawSearchRanks.push(rawIndex + 1);
    } else {
      deduplicated.set(id, {
        pageId: id,
        title: hit.title ?? '',
        url: hit.url ?? null,
        rawSearchRanks: [rawIndex + 1],
      });
    }
  }
  const unique = [...deduplicated.values()];
  report.coverage.uniqueHits = unique.length;
  const selected = unique.slice(0, requestedBudget);
  report.coverage.selectedForRead = selected.length;
  report.coverage.readBudgetTruncated = unique.length > selected.length;
  if (report.coverage.readBudgetTruncated) {
    report.coverage.limitations.push('Some search hits were excluded by the read budget.');
  }
  if (hits.length >= 20) {
    report.coverage.limitations.push('The first CQL response reached the requested 20-hit cap; additional hits may exist.');
  }

  for (let index = 0; index < unique.length; index++) {
    const hit = unique[index];
    const mergedRank = index + 1;
    const willRead = index < requestedBudget;
    const rankTrace = {
      // Raw CQL ranks and merged ranks are separate to make de-dup effects visible.
      rawSearchRanks: [...hit.rawSearchRanks],
      mergedRank,
      searchRank: mergedRank, // compatibility with the original B0 trace
      selectionRank: willRead ? mergedRank : null,
      searchHit: true,
      selectedForRead: willRead,
    };
    if (!willRead) {
      report.trace.push({
        pageId: hit.pageId,
        ...rankTrace,
        fetchStatus: 'not_attempted',
        parseStatus: 'not_attempted',
        legacyComparison: 'NOT_EVALUATED',
      });
      continue;
    }

    let page;
    try {
      page = await gateway.readPage(hit.pageId);
    } catch {
      report.coverage.failedReads++;
      report.execution.status = 'PARTIAL';
      report.execution.errors.push({ stage: 'page_fetch', code: 'PAGE_READ_FAILED' });
      // A search hit that can no longer be read could be permission-revoked.
      // Never return its identity/title in a diagnostic trace or browser view.
      report.trace.push({
        ...rankTrace,
        fetchStatus: 'failed',
        parseStatus: 'not_attempted',
        legacyComparison: 'NOT_EVALUATED',
      });
      continue;
    }

    report.coverage.fetchedPages++;
    const body = page?.body?.storage?.value;
    // HTTP success does not imply that an analyzable document body was returned.
    const text = typeof body === 'string' ? htmlToPlainText(body) : '';
    if (!text.trim()) {
      report.coverage.unusableBodies++;
      report.execution.status = 'PARTIAL';
      report.execution.errors.push({ stage: 'page_parse', code: 'UNUSABLE_BODY' });
      report.trace.push({
        ...rankTrace,
        fetchStatus: 'fetched',
        parseStatus: 'unusable_body',
        legacyComparison: 'NOT_EVALUATED',
      });
      continue;
    }

    try {
      const runbook = parseRunbook(text);
      const comparison = compareClaims(change, runbook);
      report.coverage.parsedPages++;
      report.trace.push({
        pageId: hit.pageId,
        title: page?.title ?? hit.title,
        url: hit.url,
        ...rankTrace,
        fetchStatus: 'fetched',
        parseStatus: 'parsed',
        legacyComparison: comparison.status,
        // M1 evidence is unversioned and may lose section context.
        evidence: {
          jira: change.endpointEvidence,
          confluence: runbook.endpointEvidence,
        },
      });
    } catch {
      report.coverage.unusableBodies++;
      report.execution.status = 'PARTIAL';
      report.execution.errors.push({ stage: 'page_parse', code: 'PARSE_FAILED' });
      report.trace.push({
        ...rankTrace,
        fetchStatus: 'fetched',
        parseStatus: 'failed',
        legacyComparison: 'NOT_EVALUATED',
      });
    }
  }

  const hasLegacyRelated = report.trace.some((row) =>
    row.parseStatus === 'parsed' &&
    !['NOT_RELATED', 'NOT_EVALUATED'].includes(row.legacyComparison));
  report.decision = hasLegacyRelated
    ? 'LEGACY_RELATED_FOUND'
    : report.execution.status === 'PARTIAL' ? 'INDETERMINATE' : 'NO_LEGACY_RELATED_FOUND';
  if (report.coverage.failedReads || report.coverage.unusableBodies) {
    report.coverage.limitations.push('One or more page reads or parses were incomplete; relevant evidence may be missing.');
  }
  report.elapsedMs = Math.max(0, now() - start);
  return report;
}
