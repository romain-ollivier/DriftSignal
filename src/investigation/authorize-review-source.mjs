import { validIssueKey, validPageId } from '../core.mjs';
import { isBenchmarkIssueKey, LIVE_BENCHMARK } from '../benchmark/live-scope.mjs';

/**
 * Fresh source authorization, independent of a stale browser discovery list.
 * All injected calls MUST be performed as the invoking Atlassian user.
 * The browser supplies only issueKey and pageId, never versions or actor.
 */
export async function authorizeReviewSource({
  issueKey, pageId, readIssue, readPage, readAncestors,
}) {
  if (!validIssueKey(issueKey) || !validPageId(pageId)) {
    throw new Error('Invalid Jira or Confluence source reference.');
  }
  if (issueKey.startsWith('DSBENCH-') && !isBenchmarkIssueKey(issueKey)) {
    throw new Error('Unregistered benchmark ticket.');
  }
  const issue = await readIssue(issueKey);
  if (issue?.key !== issueKey || typeof issue?.fields?.updated !== 'string') {
    throw new Error('Authenticated Jira version is unavailable.');
  }
  const page = await readPage(String(pageId));
  if (!page || String(page.id) !== String(pageId) ||
      !Number.isSafeInteger(page?.version?.number) || page.version.number <= 0 ||
      typeof page?.body?.storage?.value !== 'string' ||
      !page.body.storage.value.trim() ||
      page.status !== 'current') {
    throw new Error('Current readable Confluence page/version is required.');
  }

  if (isBenchmarkIssueKey(issueKey)) {
    // The benchmark context must NEVER be able to persist a record for an
    // otherwise accessible page outside the frozen DSBMK descendant corpus.
    // A moved corpus root retains the same ancestor ID, so ancestry alone
    // is insufficient. The page must still belong to the DSBMK space.
    if (String(page.spaceId ?? '') !== LIVE_BENCHMARK.confluenceSpaceId) {
      throw new Error('Document moved outside the benchmark Confluence space.');
    }
    if (String(pageId) === LIVE_BENCHMARK.corpusAncestorId) {
      throw new Error('Benchmark corpus root is not a candidate document.');
    }
    const ancestry = await readAncestors(String(pageId));
    if (!Array.isArray(ancestry?.results) || ancestry.results.length >= 100 ||
        ancestry?.next) {
      throw new Error('Complete authenticated Confluence ancestry is required.');
    }
    if (!ancestry.results.some(parent =>
      String(parent?.id) === LIVE_BENCHMARK.corpusAncestorId &&
      parent?.type === 'page')) {
      throw new Error('Document is outside the controlled benchmark corpus.');
    }
  }

  return {
    issueKey,
    pageId: String(pageId),
    jiraUpdated: issue.fields.updated,
    pageVersion: page.version.number,
  };
}
