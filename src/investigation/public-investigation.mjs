import { htmlToPlainText } from '../core.mjs';
import { toPublicB1Retrieval } from '../discovery/public-retrieval-b1.mjs';

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

function publicJiraEvidence(profile) {
  return (profile?.signals ?? [])
    .filter(signal => EXPOSED_FAMILIES.has(signal.family))
    .slice(0, 25)
    .map(signal => {
      const value = String(signal.normalizedValue ?? '').slice(0, 150);
      const rawQuote = String(signal.source?.quote ?? '');
      // The legacy profiler can truncate long quotes. Do not claim the
      // resulting excerpt proves an endpoint if it omits the literal value.
      const quoteContainsValue = rawQuote.toLowerCase().includes(
        String(signal.rawValue ?? value).toLowerCase(),
      ) || rawQuote.toLowerCase().includes(value.toLowerCase());
      return {
        family: signal.family,
        role: signal.role ?? 'unknown',
        value,
        extraction: signal.extraction ?? 'explicit',
        field: signal.source?.field ?? null,
        path: signal.source?.path ?? null,
        quote: quoteContainsValue ? rawQuote.slice(0, 240) : null,
      };
    });
}

/**
 * Browser response built ONLY from read-authorized, usable B1 candidates.
 * The evidence map is populated after successful asUser reads.
 * Never provide raw candidate identities or bodies in the UI.
 */
export function toPublicInvestigation({ profile, plan, retrieval, authorizedPageEvidence, scoped }) {
  const safe = toPublicB1Retrieval(retrieval);
  const evidence = authorizedPageEvidence ?? new Map();
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
    coverage: safe.coverage,
    jiraEvidence: publicJiraEvidence(profile),
    documents: safe.documents.map(doc => ({
      ...doc,
      contentEvidence: evidence.get(doc.pageId) ?? {
        pageVersion: null, quote: null, quoteType: 'none',
      },
      reviewStatus: 'NOT_ASSESSED',
    })),
    note: 'These documents were found and read under the invoking Atlassian user. A quote is a source excerpt, not proof of relevance, incompatibility or endpoint retirement. No review decision is saved or page edited.',
  };
}
