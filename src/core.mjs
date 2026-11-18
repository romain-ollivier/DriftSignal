/**
 * DriftSignal's deterministic comparison engine.
 * Pure JavaScript, intentionally independent of Forge: easy to unit-test.
 * V0.1 only supports a structured Service / Endpoint convention.
 */

export function adfToText(node) {
  if (!node || typeof node !== 'object') return '';
  if (Array.isArray(node)) return node.map(adfToText).join('');
  if (node.type === 'text') return String(node.text ?? '');
  if (node.type === 'hardBreak') return '\n';
  const body = adfToText(node.content ?? []);
  return ['paragraph', 'heading', 'listItem', 'bulletList', 'orderedList', 'tableRow'].includes(node.type)
    ? `${body}\n` : body;
}

const ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' };
export function htmlToPlainText(html) {
  if (typeof html !== 'string') return '';
  return html
    .replace(/<\s*(script|style)\b[^>]*>[\s\S]*?<\s*\/\s*\1\s*>/gi, ' ')
    .replace(/<\s*(?:p|div|li|h[1-6]|tr|td|th)\b[^>]*>/gi, '\n')
    .replace(/<\s*br\b[^>]*\/?>/gi, '\n')
    .replace(/<\s*\/\s*(?:p|div|li|h[1-6]|tr|td|th)\s*>/gi, '\n')
    .replace(/<[^>]*>/g, ' ')
    .replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (all, entity) => {
      const key = entity.toLowerCase();
      if (key.startsWith('#')) {
        const cp = key[1] === 'x' ? parseInt(key.slice(2), 16) : parseInt(key.slice(1), 10);
        return Number.isInteger(cp) && cp >= 0 && cp <= 0x10ffff ? String.fromCodePoint(cp) : all;
      }
      return ENTITIES[key] ?? all;
    })
    .replace(/\r/g, '')
    .replace(/[ \t]+/g, ' ');
}

function findLines(text, regex) {
  return String(text ?? '')
    .split(/\n/)
    .map((raw) => ({ line: raw.trim(), match: raw.trim().match(regex) }))
    .filter(({ match }) => Boolean(match))
    .map(({ line, match }) => ({ value: match[1].trim(), evidence: line }));
}

function canonicalizeService(value) {
  return String(value ?? '').trim().toLowerCase();
}

const SERVICE_RE = /^service(?:\s+id)?\s*:\s*([a-z0-9][a-z0-9._:-]{2,63})\b/i;
// Explicit anchored labels avoid extracting endpoints appearing in random prose.
const ENDPOINT_RE = /^(?:(?:new|current|target|deployed)\s+)?endpoint\s*:\s*(\/[a-z0-9._~!$&'()*+,;=:@%\/-]+)/i;
const NEW_ENDPOINT_RE = /^(?:new|target)\s+endpoint\s*:\s*(\/[a-z0-9._~!$&'()*+,;=:@%\/-]+)/i;

export function parseChange(text) {
  const service = findLines(text, SERVICE_RE);
  const preferred = findLines(text, NEW_ENDPOINT_RE);
  const endpoints = preferred.length ? preferred : findLines(text, ENDPOINT_RE);
  return {
    serviceId: service.length === 1 ? canonicalizeService(service[0].value) : null,
    serviceEvidence: service.length === 1 ? service[0].evidence : null,
    endpoint: endpoints.length === 1 ? endpoints[0].value : null,
    endpointEvidence: endpoints.length === 1 ? endpoints[0].evidence : null,
    structured: service.length === 1 && endpoints.length === 1,
    ambiguity: service.length !== 1 || endpoints.length !== 1
      ? 'Le ticket doit contenir exactement une ligne « Service: ... » et une valeur « New endpoint: /... ».'
      : null,
  };
}

export function parseRunbook(text) {
  const service = findLines(text, SERVICE_RE);
  const endpoint = findLines(text, ENDPOINT_RE);
  return {
    serviceId: service.length === 1 ? canonicalizeService(service[0].value) : null,
    serviceEvidence: service.length === 1 ? service[0].evidence : null,
    endpoint: endpoint.length === 1 ? endpoint[0].value : null,
    endpointEvidence: endpoint.length === 1 ? endpoint[0].evidence : null,
    ambiguous: service.length !== 1 || endpoint.length !== 1,
  };
}

export function compareClaims(change, runbook) {
  if (!change?.structured) return { status: 'UNSUPPORTED_CHANGE' };
  if (change.serviceId !== runbook?.serviceId) return { status: 'NOT_RELATED' };
  if (runbook.ambiguous) return { status: 'REVIEW_REQUIRED', reason: 'Le runbook contient zéro ou plusieurs lignes Service/Endpoint.' };
  if (change.endpoint === runbook.endpoint) return { status: 'IN_SYNC' };
  return {
    status: 'SOURCE_CONFLICT',
    reason: 'Les sources indiquent des endpoints différents pour le même service.',
    previous: runbook.endpoint,
    proposed: change.endpoint,
  };
}

/** CQL query uses a *single sanitized search token*; exact linkage is checked later. */
export function searchToken(serviceId) {
  const tokens = String(serviceId ?? '').toLowerCase().split(/[^a-z0-9]+/).filter((x) => x.length >= 4);
  const token = tokens.sort((a, b) => b.length - a.length)[0] ?? '';
  return /^[a-z0-9]{4,48}$/.test(token) ? token : null;
}

export function validIssueKey(value) {
  return typeof value === 'string' && /^[A-Z][A-Z0-9_]*-[1-9][0-9]*$/.test(value);
}

export function validPageId(value) {
  return /^[1-9][0-9]*$/.test(String(value ?? ''));
}

