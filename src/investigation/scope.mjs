import { validIssueKey } from '../core.mjs';
import { isBenchmarkIssueKey, LIVE_BENCHMARK } from '../benchmark/live-scope.mjs';

/**
 * Decide the search scope from the Jira issue returned by an asUser read,
 * never from the client-controlled key alone. Aliases/mismatched projects
 * fail closed; no fallback to an unscoped scan for DSBENCH issue keys.
 */
export function investigationScope(requestedKey, issue) {
  const canonicalKey = issue?.key;
  if (!validIssueKey(requestedKey) || !validIssueKey(canonicalKey) ||
      requestedKey !== canonicalKey) {
    throw new Error('Jira issue identity was not canonically verified.');
  }
  const projectKey = canonicalKey.slice(0,canonicalKey.lastIndexOf('-'));
  if (projectKey === LIVE_BENCHMARK.projectKey) {
    if (!isBenchmarkIssueKey(canonicalKey)) {
      throw new Error('Unregistered controlled benchmark issue.');
    }
    return true;
  }
  return false;
}
