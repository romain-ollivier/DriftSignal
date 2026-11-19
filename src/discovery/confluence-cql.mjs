import { validPageId } from '../core.mjs';

/**
 * Adapt B1 search intentions to one Confluence CQL request.
 *
 * CQL punctuation is not guaranteed to be indexed literally. The diagnostic
 * must measure this on the tenant; do not silently claim exact endpoint recall.
 */
export function cqlFromIntent(intent) {
  const term = intent?.searchText;
  if (intent?.strategy !== 'confluence_cql' ||
      !['term', 'phrase', 'path'].includes(intent.mode) ||
      typeof term !== 'string' ||
      term.length < 3 || term.length > 128 ||
      !/^[a-z0-9 _./:~!$&'()*+,;=@%-]+$/i.test(term)) {
    throw new Error('Unsupported B1 search intention.');
  }
  return 'type=page AND text ~ "' + term + '"';
}

export function trustedConfluenceOrigin(value) {
  try {
    const u = new URL(value);
    if (u.protocol !== 'https:' || u.username || u.password ||
        !u.hostname.endsWith('.atlassian.net') ||
        u.hostname === '.atlassian.net' || u.port) return null;
    return u.origin;
  } catch {
    return null;
  }
}

/**
 * Normalize the first page of the v1 Confluence search response.
 *
 * Never use a URL from the response directly as a fetch target. The origin is
 * for stable candidate identity and links only, once hostname-validated.
 */
export function normalizeCqlResponse(data, limit = 20) {
  const siteId = trustedConfluenceOrigin(data?._links?.base);
  if (!siteId || !Array.isArray(data?.results) ||
      !Number.isInteger(limit) || limit < 1 || limit > 50) {
    throw new Error('Invalid Confluence search response.');
  }
  const results = data.results.slice(0, limit).flatMap((entry) => {
    const id = String(entry?.content?.id ?? entry?.id ?? '');
    if (!validPageId(id)) return [];
    const title = entry?.content?.title ?? entry?.title ?? null;
    return [{
      id,
      title: typeof title === 'string' ? title : null,
      url: siteId + '/wiki/pages/viewpage.action?pageId=' + encodeURIComponent(id),
    }];
  });
  const hasMore = Boolean(data?._links?.next || data?.nextCursor) ||
    (Number.isFinite(data?.totalSize) && Number.isFinite(data?.start) &&
     Number.isFinite(data?.size) && data.start + data.size < data.totalSize) ||
    data.results.length > limit;

  return { siteId, results, hasMore };
}

/**
 * Strictly parse a direct Confluence page link ONLY if it belongs to the
 * origin verified by a live requestConfluence search response.
 * No network access follows the user-supplied URL.
 */
export function resolveDirectPage(url, verifiedOrigin) {
  const origin = trustedConfluenceOrigin(verifiedOrigin);
  if (!origin) return null;
  let candidate;
  try {
    candidate = new URL(url);
  } catch {
    return null;
  }
  if (candidate.origin !== origin || candidate.username || candidate.password) return null;
  const pathname = candidate.pathname;
  let id = null;
  if (pathname === '/wiki/pages/viewpage.action') {
    id = candidate.searchParams.get('pageId');
  } else {
    const match = pathname.match(/^\/wiki\/(?:spaces\/[^/]+\/)?pages\/([0-9]+)(?:\/[^/?#]*)?$/);
    id = match?.[1] ?? null;
  }
  if (!validPageId(id)) return null;
  return { siteId: origin, pageId: String(id), sameTenant: true };
}
