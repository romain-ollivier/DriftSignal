import { validPageId } from '../core.mjs';
import { LIVE_BENCHMARK } from '../benchmark/live-scope.mjs';
import { trustedConfluenceOrigin } from '../discovery/confluence-cql.mjs';

/**
 * Investigation-only validation after the asUser page GET. B1's frozen
 * retrieval algorithm and historical benchmark are intentionally untouched.
 * A CQL hit was in scope at search time, but may be moved before read.
 */
export async function authorizeInvestigationPage({
  page, pageId, siteId, scoped, readAncestors,
}) {
  const origin = trustedConfluenceOrigin(siteId);
  if (!origin || !validPageId(pageId) ||
      String(page?.id ?? '') !== String(pageId) ||
      page.status !== 'current' ||
      (page.type != null && page.type !== 'page')) {
    throw new Error('Confluence page ID, current status or origin could not be verified.');
  }
  if (scoped) {
    if (String(page.spaceId ?? '') !== LIVE_BENCHMARK.confluenceSpaceId ||
        String(pageId) === LIVE_BENCHMARK.corpusAncestorId) {
      throw new Error('Confluence page moved outside controlled corpus.');
    }
    const ancestry = await readAncestors(String(pageId));
    if (!Array.isArray(ancestry?.results) || ancestry.results.length >= 100 ||
        ancestry.next) {
      throw new Error('Incomplete current Confluence ancestry.');
    }
    if (!ancestry.results.some(ancestor =>
      String(ancestor?.id) === LIVE_BENCHMARK.corpusAncestorId &&
      ancestor?.type === 'page')) {
      throw new Error('Controlled Confluence page root not verified.');
    }
  }
  return {
    pageTitle: typeof page.title === 'string' ? page.title : null,
    siteOrigin: origin,
  };
}
