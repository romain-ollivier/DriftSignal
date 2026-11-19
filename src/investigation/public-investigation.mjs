import { htmlToPlainText } from '../core.mjs';
import { toPublicB1Retrieval } from '../discovery/public-retrieval-b1.mjs';
import { linkedAdfBlocks } from './adf-source-guards.mjs';
import { trustedConfluenceOrigin } from '../discovery/confluence-cql.mjs';

const MAX_EXCERPT = 260;
const EXPOSED_FAMILIES = new Set([
  'service_identity', 'endpoint', 'domain', 'component',
  'environment', 'deployment_state', 'explicit_link',
]);

/** Short source slice from a readable Confluence page; never a conflict verdict. */
function excerptAround(line, needle) {
  if (!line) return null;
  const position = needle ? line.toLowerCase().indexOf(needle.toLowerCase()) : -1;
  if (line.length <= MAX_EXCERPT) return line;
  const start = position < 0 ? 0 : Math.max(0, position - 65);
  return line.slice(start, start + MAX_EXCERPT);
}

export function evidenceFromReadablePage(page, profile) {
  const body = page?.body?.storage?.value;
  if (typeof body !== 'string' || !body.trim()) return null;
  const lines = htmlToPlainText(body).split('\n')
    .map(value => value.trim()).filter(Boolean).slice(0, 250);
  const anchors = (profile?.signals ?? [])
    .filter(signal => signal.family === 'endpoint' && signal.generic !== true)
    .map(signal => String(signal.normalizedValue ?? '').trim())
    .filter(value => value.length >= 4 && value.length <= 128);
  let line = null;
  let match = null;
  for (const anchor of anchors) {
    line = lines.find(candidate => candidate.toLowerCase().includes(anchor.toLowerCase()));
    if (line) { match = anchor; break; }
  }
  if (!line) line = lines[0] ?? null;
  const n = page?.version?.number;
  return {
    pageVersion: Number.isSafeInteger(n) && n > 0 ? n : null,
    quote: excerptAround(line, match),
    quoteType: match ? 'literal_endpoint_mention' : line ? 'page_preview_only' : 'none',
  };
}


// Search-hit links are untrusted. Rebuild only a canonical page link whose
// page ID exactly matches the page already fetched as the invoking user.
function authorizedPageUrl(origin, pageId) {
  const trusted = trustedConfluenceOrigin(origin);
  if (!trusted || !/^[0-9]{1,32}$/.test(String(pageId))) return null;
  // The origin comes only from the successful asUser CQL gateway,
  // never the search-hit URL or a client-supplied page link.
  return trusted + '/wiki/pages/viewpage.action?pageId=' + encodeURIComponent(pageId);
}

// Jira text can mention a Confluence page that the user cannot open.
// Never convert those Jira-only links into supposedly verified page evidence.
function containsUnverifiedPageReference(value) {
  return /(?:https?:\/\/\S+\.atlassian\.net\/wiki\/|\bpageId\s*=|\/wiki\/(?:spaces|pages)\/)/i.test(String(value ?? ''));
}

function publicJiraEvidence(profile, issue) {
  const linkedBlocks = linkedAdfBlocks(issue);
  return (profile?.signals ?? [])
    .filter(signal => EXPOSED_FAMILIES.has(signal.family))
    .slice(0, 25)
    .map(signal => {
      // Until negated-deployment parsing is reviewed separately, always
      // show the literal Jira declaration, never a possibly wrong
      // normalized 'deployed' interpretation of 'Not deployed'.
      const value = String(signal.family === 'deployment_state'
        ? (signal.rawValue ?? '')
        : (signal.normalizedValue ?? '')).slice(0, 150);
      const rawQuote = String(signal.source?.quote ?? '');
      const mixedAdfLink = linkedBlocks.has(signal.source?.path);
      const linkMention = signal.family === 'explicit_link' ||
        containsUnverifiedPageReference(value) || containsUnverifiedPageReference(rawQuote);
      // The legacy profiler can truncate long quotes. Do not claim the
      // resulting excerpt proves an endpoint if it omits the literal value.
      const quoteContainsValue = rawQuote.toLowerCase().includes(
        String(signal.rawValue ?? value).toLowerCase(),
      ) || rawQuote.toLowerCase().includes(value.toLowerCase());
      return {
        family: signal.family,
        role: signal.role ?? 'unknown',
        value: linkMention ? 'Confluence link mentioned in Jira (target not verified)' : value,
        extraction: signal.extraction ?? 'explicit',
        field: signal.source?.field ?? null,
        path: signal.source?.path ?? null,
        quote: !linkMention && !mixedAdfLink && quoteContainsValue ? rawQuote.slice(0, 240) : null,
      };
    });
}

/**
 * Browser response built ONLY from read-authorized, usable B1 candidates.
 * The evidence map is populated after successful asUser reads.
 * Never provide raw candidate identities or bodies in the UI.
 */
export function toPublicInvestigation({ profile, issue, plan, retrieval, authorizedPageEvidence, scoped }) {
  const safe = toPublicB1Retrieval(retrieval);
  const evidence = authorizedPageEvidence ?? new Map();
  const readableDocs = safe.documents.filter(doc => evidence.has(doc.pageId));
  return {
    schemaVersion: '1.0',
    mode: 'READ_ONLY_INVESTIGATION',
    engine: 'B1',
    issueKey: safe.issueKey,
    jiraUpdated: profile?.sourceUpdated ?? null,
    inputQuality: profile?.dataQuality?.level ?? 'insufficient',
    planStatus: plan?.status ?? 'INSUFFICIENT_SEARCH_SIGNALS',
    scope: scoped ? 'CONTROLLED_DSBMK_CORPUS' : 'STANDARD_USER_SEARCH',
    status: safe.status,
    coverage: { ...safe.coverage, usableDocuments: readableDocs.length },
    jiraEvidence: publicJiraEvidence(profile, issue),
    documents: readableDocs.map(doc => {
      const verified = evidence.get(doc.pageId);
      return {
        ...doc,
        title: verified.pageTitle ?? null,
        url: authorizedPageUrl(verified.siteOrigin, doc.pageId),
        contentEvidence: {
          pageVersion: verified.pageVersion ?? null,
          quote: verified.quote ?? null,
          quoteType: verified.quoteType ?? 'none',
        },
        reviewStatus: 'NOT_ASSESSED',
      };
    }),
    note: 'These documents were found and read under the invoking Atlassian user. A quote is a source excerpt, not proof of relevance, incompatibility or endpoint retirement. No review decision is saved or page edited.',
  };
}
