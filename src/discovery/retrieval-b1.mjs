import { validPageId } from '../core.mjs';

/**
 * B1 retrieval and candidate fusion, independent of Forge.
 *
 * Gateway contract:
 * - searchConfluence(intent, { limit }) => { siteId, results: [{id,title,url}],
 *   hasMore?: boolean } (exactly one search response per intent)
 * - readPage(pageId, siteId) => Confluence v2 page object
 * - resolveDirectLink?(url) => {siteId, pageId, sameTenant: true}
 *   The adapter MUST verify the current Atlassian tenant before returning
 *   sameTenant=true. The readPage request MUST be made as the current user.
 *
 * IMPORTANT: This return value is INTERNAL benchmark data, including identities
 * of search hits that were not read. Never return it directly from a Forge
 * resolver to Custom UI; produce a permission-aware projection separately.
 *
 * This stage performs retrieval, not document relevance classification.
 */
function checkBound(value, name, max) {
  if (!Number.isInteger(value) || value < 0 || value > max) {
    throw new RangeError(name + ' must be an integer from 0 to ' + max + '.');
  }
}

function isSearchResult(value) {
  return value && typeof value === 'object' && validPageId(value.id);
}

function failure(stage, code, id = null) {
  return id ? { stage, code, operationId: id } : { stage, code };
}

function usablePageBody(page) {
  return typeof page?.body?.storage?.value === 'string' &&
    page.body.storage.value.trim().length > 0;
}

/**
 * Keep all routes to a candidate and choose candidates round-robin across
 * primary query families, rather than letting a broad first query use every
 * body-read slot. The first matching direct link is considered first.
 */
function selectForRead(candidates, queries, readBudget) {
  const ordered = [];
  const selected = new Set();
  const push = (candidate) => {
    if (candidate && !selected.has(candidate.key)) {
      selected.add(candidate.key);
      ordered.push(candidate);
    }
  };

  for (const candidate of candidates) {
    if (candidate.paths.some((path) => path.kind === 'direct_link')) push(candidate);
  }

  const familyOrder = [...new Set(queries.map((q) => q.families[0] ?? 'unknown'))];
  const queues = new Map(familyOrder.map((family) => [family, []]));
  for (const candidate of candidates) {
    for (const family of familyOrder) {
      if (candidate.paths.some((path) => path.kind === 'cql' && path.families.includes(family))) {
        queues.get(family).push(candidate);
      }
    }
  }
  for (const queue of queues.values()) {
    queue.sort((a, b) => {
      const rankOf = (c) => Math.min(...c.paths.filter((path) => path.kind === 'cql').map((path) => path.rawRank));
      return rankOf(a) - rankOf(b) || a.key.localeCompare(b.key, 'en');
    });
  }

  let remaining = true;
  while (remaining) {
    remaining = false;
    for (const family of familyOrder) {
      const queue = queues.get(family);
      if (!queue.length) continue;
      remaining = true;
      push(queue.shift());
    }
  }
  // Fallback for candidates from a query whose family metadata is absent.
  for (const candidate of candidates) push(candidate);
  const selection = ordered.slice(0, readBudget);
  selection.forEach((candidate, i) => { candidate.selectionRank = i + 1; });
  return selection;
}

export async function runB1Retrieval(plan, gateway, options = {}) {
  if (!plan || !Array.isArray(plan.queries) || !Array.isArray(plan.directLinks)) {
    throw new TypeError('A B1 discovery query plan is required.');
  }
  if (typeof gateway?.searchConfluence !== 'function' || typeof gateway.readPage !== 'function') {
    throw new TypeError('Gateway searchConfluence and readPage functions are required.');
  }
  const readBudget = options.readBudget ?? 10;
  const searchLimit = options.searchLimit ?? 20;
  const maxCqlCalls = options.maxCqlCalls ?? 4;
  checkBound(readBudget, 'readBudget', 15);
  checkBound(searchLimit, 'searchLimit', 50);
  if (searchLimit === 0) throw new RangeError('searchLimit must be greater than zero.');
  checkBound(maxCqlCalls, 'maxCqlCalls', 20);

  const now = options.now ?? (() => performance.now());
  const start = now();
  const report = {
    schemaVersion: '1.0',
    variant: 'B1_RETRIEVAL',
    issueKey: plan.issueKey,
    decision: 'NOT_EVALUATED',
    // This stage is deliberately NOT a drift/relevance classifier.
    execution: { status: 'COMPLETE_WITHIN_BUDGET', errors: [] },
    requests: [],
    candidates: [],
    coverage: {
      cqlCallsAttempted: 0,
      directLinksAttempted: 0,
      rawHits: 0,
      uniqueCandidates: 0,
      selectedForRead: 0,
      fetchedPages: 0,
      usableBodies: 0,
      failedReads: 0,
      unusableBodies: 0,
      queriesWithMoreResults: 0,
      queriesNotExecuted: Math.max(0, plan.queries.length - maxCqlCalls),
      directLinksNotResolved: 0,
      readBudgetTruncated: false,
      limitations: [
        'Only the first CQL response per intent is read; pagination is deferred.',
        'Content relevance is not evaluated at the retrieval stage.',
      ],
    },
    elapsedMs: 0,
  };
  const candidates = new Map();
  const add = (siteId, id, title, url, path) => {
    if (typeof siteId !== 'string' || !siteId.trim() || !validPageId(id)) return;
    const key = siteId + ':' + String(id);
    if (!candidates.has(key)) {
      candidates.set(key, {
        key,
        siteId,
        pageId: String(id),
        title: title ?? null,
        url: url ?? null,
        paths: [],
        selectionRank: null,
        readStatus: 'not_attempted',
        bodyStatus: 'not_attempted',
      });
    }
    const candidate = candidates.get(key);
    candidate.paths.push(path);
  };

  const queries = plan.queries.slice(0, maxCqlCalls);
  for (const intent of queries) {
    const started = now();
    report.coverage.cqlCallsAttempted++;
    try {
      const response = await gateway.searchConfluence(intent, { limit: searchLimit });
      if (!response || !Array.isArray(response.results) || typeof response.siteId !== 'string') {
        throw new Error('Malformed search response.');
      }
      const results = response.results.slice(0, searchLimit);
      const hasMore = response.hasMore === true || response.results.length > searchLimit;
      report.coverage.rawHits += results.length;
      if (hasMore) report.coverage.queriesWithMoreResults++;
      report.requests.push({
        queryId: intent.id,
        families: intent.families,
        outcome: 'ok',
        rawHits: results.length,
        hasMore,
        elapsedMs: Math.max(0, now() - started),
      });
      for (const [index, hit] of results.entries()) {
        if (!isSearchResult(hit)) continue;
        add(response.siteId, hit.id, hit.title, hit.url, {
          kind: 'cql',
          operationId: intent.id,
          rawRank: index + 1,
          families: [...(intent.families ?? [])],
          origins: intent.origins ?? [],
        });
      }
    } catch {
      report.execution.status = 'PARTIAL';
      report.execution.errors.push(failure('cql', 'SEARCH_FAILED', intent.id));
      report.requests.push({
        queryId: intent.id,
        families: intent.families,
        outcome: 'failed',
        rawHits: 0,
        hasMore: null,
        elapsedMs: Math.max(0, now() - started),
      });
    }
  }


  // CQL responses establish the authoritative tenant origin before links are resolved.
  // Candidate selection still prioritizes verified direct links over search hits.
  for (const link of plan.directLinks) {
    if (typeof gateway.resolveDirectLink !== 'function') {
      report.coverage.directLinksNotResolved++;
      continue;
    }
    report.coverage.directLinksAttempted++;
    try {
      const resolved = await gateway.resolveDirectLink(link.url);
      if (resolved?.sameTenant !== true || !validPageId(resolved.pageId)) {
        report.coverage.directLinksNotResolved++;
        continue;
      }
      add(resolved.siteId, resolved.pageId, null, link.url, {
        kind: 'direct_link',
        operationId: link.id,
        origins: link.origins,
      });
    } catch {
      report.coverage.directLinksNotResolved++;
      report.execution.status = 'PARTIAL';
      report.execution.errors.push(failure('direct_link', 'DIRECT_LINK_RESOLVE_FAILED', link.id));
    }
  }

  const all = [...candidates.values()];
  report.coverage.uniqueCandidates = all.length;
  const selected = selectForRead(all, queries, readBudget);
  report.coverage.selectedForRead = selected.length;
  report.coverage.readBudgetTruncated = all.length > selected.length;
  for (const candidate of selected) {
    try {
      const page = await gateway.readPage(candidate.pageId, candidate.siteId);
      candidate.readStatus = 'fetched';
      report.coverage.fetchedPages++;
      if (usablePageBody(page)) {
        report.coverage.usableBodies++;
        candidate.bodyStatus = 'usable';
        // Body intentionally excluded from the retrieval report; evaluation
        // can be a separate, explicitly authorized read/parse stage.
      } else {
        candidate.bodyStatus = 'unusable';
        report.coverage.unusableBodies++;
        report.execution.status = 'PARTIAL';
        report.execution.errors.push(failure('page_body', 'UNUSABLE_BODY'));
      }
      candidate.title = page?.title ?? candidate.title;
    } catch {
      candidate.readStatus = 'failed';
      report.coverage.failedReads++;
      report.execution.status = 'PARTIAL';
      report.execution.errors.push(failure('page_fetch', 'PAGE_READ_FAILED'));
      // Remove the identity of a candidate that failed its permission-checked
      // body read. Internal source hit data must not escape to the UI.
      candidate.title = null;
      candidate.url = null;
    }
  }
  report.candidates = all.map((candidate, index) => ({
    ...candidate,
    mergeRank: index + 1,
  }));
  if (report.coverage.queriesWithMoreResults) report.coverage.limitations.push('Some CQL queries have more pages available.');
  if (report.coverage.queriesNotExecuted) report.coverage.limitations.push('Some planned CQL queries exceeded the execution budget.');
  if (report.coverage.readBudgetTruncated) report.coverage.limitations.push('Some discovered pages exceeded the read budget.');
  if (report.coverage.failedReads || report.coverage.unusableBodies) report.coverage.limitations.push('Some selected pages could not be read or had no usable body.');
  if (queries.length > 0 && report.requests.every((r) => r.outcome === 'failed') &&
      report.coverage.directLinksAttempted === 0) {
    report.execution.status = 'FAILED';
  }
  report.elapsedMs = Math.max(0, now() - start);
  return report;
}
