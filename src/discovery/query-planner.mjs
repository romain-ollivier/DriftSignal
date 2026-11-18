/**
 * B1 Discovery query planner.
 *
 * Produces a deterministic, bounded plan of search INTENTIONS, not raw CQL.
 * The Forge adapter must independently validate and escape the search strings,
 * enforce page-level access, and verify direct links belong to this tenant.
 * No plan metadata is evidence of a document's relevance.
 */
const DEFAULT_MAX_CQL = 4;
const DEFAULT_MAX_LINKS = 5;
const MAX_SEARCH_LENGTH = 128;
const GENERIC_PATHS = new Set(['/', '/health', '/healthz', '/status', '/ping', '/ready', '/readiness', '/metrics']);
const FAMILY_ORDER = [
  'endpoint_old', 'domain_old', 'service_identity', 'component',
  'endpoint_new', 'domain_new', 'endpoint_current', 'domain_current',
  'endpoint_unknown', 'domain_unknown',
];
const FAMILY_RANK = new Map(FAMILY_ORDER.map((name, index) => [name, index]));

function sourceRef(signal) {
  return {
    signalId: signal.id,
    family: signal.family,
    role: signal.role ?? 'unknown',
    field: signal.source?.field ?? null,
    path: signal.source?.path ?? null,
  };
}

function validSearchText(value, pattern) {
  const term = String(value ?? '').trim();
  if (term.length < 3 || term.length > MAX_SEARCH_LENGTH || !pattern.test(term)) return null;
  return term;
}

function lexicalIntents(signal) {
  const role = ['old', 'new', 'current'].includes(signal.role) ? signal.role : 'unknown';
  const value = String(signal.normalizedValue ?? '').trim();
  if (signal.family === 'service_identity') {
    const term = validSearchText(value, /^[a-z0-9][a-z0-9._:-]*$/i);
    return term ? [{ family: 'service_identity', term: term.toLowerCase(), mode: 'term' }] : [];
  }
  if (signal.family === 'component') {
    const term = validSearchText(value, /^[a-z0-9][a-z0-9._ -]*$/i);
    return term ? [{
      family: 'component',
      term: term.toLowerCase().replace(/\s+/g, ' '),
      mode: term.includes(' ') ? 'phrase' : 'term',
    }] : [];
  }
  if (signal.family === 'domain') {
    const term = validSearchText(value, /^[a-z0-9][a-z0-9.-]*$/i);
    return term ? [{ family: 'domain_' + role, term: term.toLowerCase(), mode: 'term' }] : [];
  }
  if (signal.family === 'endpoint') {
    if (signal.generic === true) return [];
    let path = value;
    let hostname = null;
    if (/^https?:\/\//i.test(path)) {
      try {
        const url = new URL(path);
        if (url.username || url.password || !['http:', 'https:'].includes(url.protocol)) return [];
        path = url.pathname;
        hostname = url.hostname;
      } catch { return []; }
    }
    // Avoid query strings that may contain credentials or user-specific data.
    path = path.split(/[?#]/, 1)[0];
    if (!path.startsWith('/') || GENERIC_PATHS.has(path.toLowerCase())) {
      return hostname && validSearchText(hostname, /^[a-z0-9.-]+$/i)
        ? [{ family: 'domain_' + role, term: hostname.toLowerCase(), mode: 'term' }] : [];
    }
    // Require a distinctive endpoint; /v1 is too generic by itself.
    const segments = path.split('/').filter(Boolean);
    const meaningful = segments.some((s) => s.length >= 4 && !/^(api|health|status|ready|readiness|metrics|v\d+)$/i.test(s));
    const term = meaningful ? validSearchText(path, /^\/[a-z0-9._~!$&'()*+,;=:@%/-]+$/i) : null;
    const intents = [];
    if (term) intents.push({ family: 'endpoint_' + role, term, mode: 'path' });
    if (hostname) {
      const hostTerm = validSearchText(hostname, /^[a-z0-9.-]+$/i);
      if (hostTerm) intents.push({ family: 'domain_' + role, term: hostTerm.toLowerCase(), mode: 'term' });
    }
    return intents;
  }
  return [];
}

function safeLink(url) {
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== 'https:' || parsed.username || parsed.password) return null;
    if (!parsed.hostname.endsWith('.atlassian.net') || parsed.hostname === '.atlassian.net') return null;
    if (!parsed.pathname.startsWith('/wiki/')) return null;
    // Do not infer that this points to our Atlassian tenant; gateway checks it.
    return parsed.href;
  } catch { return null; }
}

/**
 * @param {object} profile Output of profileJiraChange
 * @param {{maxCqlQueries?: number, maxDirectLinks?: number}} options
 */
export function planDiscoveryQueries(profile, options = {}) {
  if (!profile || !Array.isArray(profile.signals)) throw new TypeError('ChangeProfile with signals is required.');
  const maxCqlQueries = options.maxCqlQueries ?? DEFAULT_MAX_CQL;
  const maxDirectLinks = options.maxDirectLinks ?? DEFAULT_MAX_LINKS;
  if (!Number.isInteger(maxCqlQueries) || maxCqlQueries < 0 || maxCqlQueries > 20) {
    throw new RangeError('maxCqlQueries must be 0..20.');
  }
  if (!Number.isInteger(maxDirectLinks) || maxDirectLinks < 0 || maxDirectLinks > 20) {
    throw new RangeError('maxDirectLinks must be 0..20.');
  }

  const candidateQueries = new Map();
  const directLinkCandidates = new Map();
  const skipped = [];
  for (const signal of profile.signals) {
    if (!signal || typeof signal !== 'object') continue;
    if (signal.family === 'explicit_link') {
      const link = safeLink(signal.normalizedValue);
      if (!link) {
        skipped.push({ signalId: signal.id, reason: 'invalid_direct_link' });
        continue;
      }
      if (!directLinkCandidates.has(link)) directLinkCandidates.set(link, { url: link, origins: [] });
      directLinkCandidates.get(link).origins.push(sourceRef(signal));
      continue;
    }
    const derived = lexicalIntents(signal);
    if (!derived.length && ['endpoint', 'domain', 'service_identity', 'component'].includes(signal.family)) {
      skipped.push({ signalId: signal.id, reason: 'generic_or_unsupported_search_term' });
    }
    for (const intent of derived) {
      const key = intent.mode + ':' + intent.term.toLowerCase();
      if (!candidateQueries.has(key)) candidateQueries.set(key, {
        searchText: intent.term,
        mode: intent.mode,
        families: [],
        origins: [],
      });
      const query = candidateQueries.get(key);
      if (!query.families.includes(intent.family)) query.families.push(intent.family);
      // One remote CQL call may correspond to multiple source signals.
      const ref = sourceRef(signal);
      if (!query.origins.some((o) => o.signalId === ref.signalId)) query.origins.push(ref);
    }
  }

  const priorityOf = (query) => Math.min(...query.families.map((family) => FAMILY_RANK.get(family) ?? 999));
  const candidates = [...candidateQueries.values()].sort((a, b) =>
    priorityOf(a) - priorityOf(b) ||
    a.searchText.localeCompare(b.searchText, 'en') ||
    a.mode.localeCompare(b.mode, 'en'));
  const chosen = candidates.slice(0, maxCqlQueries);
  const directLinks = [...directLinkCandidates.values()]
    .sort((a, b) => a.url.localeCompare(b.url, 'en'))
    .slice(0, maxDirectLinks)
    .map((link, index) => ({
      id: 'l' + (index + 1),
      strategy: 'direct_link',
      url: link.url,
      origins: link.origins,
      requiresTenantAndPermissionCheck: true,
    }));
  const queries = chosen.map((query, index) => ({
    id: 'q' + (index + 1),
    strategy: 'confluence_cql',
    mode: query.mode,
    searchText: query.searchText,
    families: query.families,
    origins: query.origins,
    priority: index + 1,
    // Not a guarantee that CQL indexes punctuation as requested.
    indexingAssumption: query.mode === 'path' ? 'requires_live_punctuation_validation' : 'standard_text_index',
  }));
  const budgetSkipped = candidates.slice(maxCqlQueries).map((query) => ({
    families: query.families,
    origins: query.origins,
    reason: 'cql_query_budget',
  }));
  const truncatedDirectLinks = Math.max(0, directLinkCandidates.size - directLinks.length);

  return {
    schemaVersion: '1.0',
    variant: 'B1',
    issueKey: profile.issueKey ?? null,
    status: queries.length || directLinks.length ? 'READY' : 'INSUFFICIENT_SEARCH_SIGNALS',
    budget: { maxCqlQueries, maxDirectLinks, plannedCqlQueries: queries.length, plannedDirectLinks: directLinks.length },
    queries,
    directLinks,
    skipped: [...skipped, ...budgetSkipped],
    coverage: {
      cqlCandidatesBeforeBudget: candidates.length,
      deduplicatedCqlQueries: candidates.length,
      directLinksBeforeBudget: directLinkCandidates.size,
      omittedCqlQueries: budgetSkipped.length,
      omittedDirectLinks: truncatedDirectLinks,
      limitations: [
        'Plan only: no Atlassian API calls executed.',
        'Confluence CQL punctuation and phrase matching must be measured on the actual tenant.',
        'A direct link is a candidate only; the adapter must verify tenant and user access.',
      ],
    },
  };
}
