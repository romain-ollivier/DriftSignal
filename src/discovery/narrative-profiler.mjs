import { profileJiraChange } from './change-profiler.mjs';

/**
 * Experimental B1.1: recover explicitly stated historical routes from Jira
 * narrative. Never infer service identity, deployment status or incompatibility.
 * Existing B1 profiler/planner/retrieval remain unchanged.
 */
const ANCHOR_RE = /\b(?:old|previous|legacy|former)\s+(?:api\s+)?(?:route|endpoint|path)\s+(\/[a-z0-9._~!$&'()*+,;=:@%/-]+)/gi;
const GENERIC_PATHS = new Set(['/', '/health', '/healthz', '/status', '/ping', '/ready', '/readiness', '/metrics']);
const EXCLUSION_RE = /\b(?:if|suppose|hypothetical|hypothetically|perhaps|example|e\.g\.|for example|might|may|could|would|should|proposed|proposal|suggested|potential|possibly)\b/i;
const QUOTED_DOC_RE = /\b(?:runbook|documentation|docs?|wiki|sample|example|quote|quoted)\s+(?:says|said|states|stated|reads|mentions|mentioned|contains|lists|shows)\b/i;
const MAX_RECORDS = 100;
const MAX_RECORD_LENGTH = 2000;
const MAX_SIGNALS = 100;

function inlineText(node) {
  if (!node || typeof node !== 'object') return '';
  if (Array.isArray(node)) return node.map(inlineText).join('');
  if (node.type === 'text') return String(node.text ?? '');
  if (node.type === 'hardBreak') return '\n';
  return inlineText(node.content ?? []);
}

function jiraNarrativeRecords(issue) {
  const fields = issue?.fields ?? {};
  const result = [];
  const add = (value, field, path) => {
    if (typeof value !== 'string') return;
    for (const [index, line] of value.split(/\r?\n/).entries()) {
      if (line.trim() && line.length <= MAX_RECORD_LENGTH && result.length < MAX_RECORDS) {
        result.push({ text: line.trim(), field, path: path + '.line[' + index + ']' });
      }
    }
  };
  add(fields.summary, 'summary', 'summary');
  if (typeof fields.description === 'string') {
    add(fields.description, 'description', 'description');
  } else {
    function walk(node, path) {
      if (!node || result.length >= MAX_RECORDS) return;
      if (Array.isArray(node)) {
        node.forEach((item, i) => walk(item, path + '[' + i + ']'));
        return;
      }
      if (node.type === 'codeBlock' || node.type === 'blockquote') return;
      if (node.type === 'paragraph' || node.type === 'heading') {
        add(inlineText(node), 'description', path);
        return;
      }
      walk(node.content, path + '.content');
    }
    walk(fields.description, 'description');
  }
  return result;
}

function safePath(raw) {
  if (typeof raw !== 'string' || raw.length < 5 || raw.length > 128) return null;
  const path = raw.replace(/[.,;:]+$/, '');
  if (!path.startsWith('/') || path.includes('//') || /[?#\\]/.test(path)) return null;
  if (!/^\/[a-z0-9._~!$&'()*+,;=:@%/-]+$/i.test(path)) return null;
  if (GENERIC_PATHS.has(path.toLowerCase())) return null;
  const parts = path.split('/').filter(Boolean);
  if (!parts.some(part => part.length >= 4 && !/^(api|health|status|ready|readiness|metrics|v\d+)$/i.test(part))) return null;
  return path;
}

function safeHost(raw) {
  if (typeof raw !== 'string') return null;
  const host = raw.toLowerCase().replace(/[.,;:]+$/, '');
  if (host.length < 4 || host.length > 128) return null;
  if (!/^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]*[a-z0-9])?)+$/i.test(host)) return null;
  return host;
}

function sentenceContext(value, offset) {
  const prior = value.slice(0, offset);
  const boundaries = [...prior.matchAll(/[.!?]\s+/g)];
  const start = boundaries.length
    ? boundaries[boundaries.length - 1].index + boundaries[boundaries.length - 1][0].length
    : 0;
  const remaining = value.slice(offset);
  const endOffset = remaining.search(/[!?]\s+|\.\s+/);
  const end = endOffset < 0 ? value.length : offset + endOffset + 1;
  return { sentence: value.slice(start, end).trim(), prefix: value.slice(start, offset) };
}

/**
 * Returns the existing B1 profile contract with evidence-backed
 * narrative_pattern signals appended, and no speculative inference.
 */
export function profileJiraChangeNarrative(issue) {
  const profile = profileJiraChange(issue);
  const signatures = new Set(profile.signals.map(s => [s.family, s.role, s.normalizedValue].join('|')));
  for (const record of jiraNarrativeRecords(issue)) {
    const { text, field, path } = record;
    if (/^(?:>|["'])/.test(text) || text.startsWith(String.fromCharCode(96)) ||
        /\b(?:copy|copied|pasted)\s+(?:from|of)\s+(?:a\s+)?(?:runbook|documentation)\b/i.test(text)) continue;
    for (const match of text.matchAll(ANCHOR_RE)) {
      if (profile.signals.length >= MAX_SIGNALS) break;
      const context = sentenceContext(text, match.index);
      if (EXCLUSION_RE.test(context.sentence) || QUOTED_DOC_RE.test(context.sentence)) continue;
      // Do not silently discard URL query/fragment data from a candidate:
      // the whole token is unsafe to treat as a validated endpoint signal.
      if (/[?#]/.test(text[match.index + match[0].length] ?? '')) continue;
      const endpoint = safePath(match[1]);
      if (!endpoint) continue;
      const quote = context.sentence.slice(0, 240);
      const append = (family, value) => {
        const sig = [family, 'old', value].join('|');
        if (signatures.has(sig) || profile.signals.length >= MAX_SIGNALS) return;
        signatures.add(sig);
        profile.signals.push({
          id: 's' + (profile.signals.length + 1),
          family,
          role: 'old',
          rawValue: value,
          normalizedValue: value,
          extraction: 'narrative_pattern',
          source: { product: 'jira', objectId: profile.issueKey, field, path, quote },
          ...(family === 'endpoint' ? { generic: false } : {}),
        });
      };
      append('endpoint', endpoint);
      const remainder = text.slice(match.index + match[0].length);
      const hostMatch = remainder.match(/^\s+(?:was|is)\s+(?:hosted\s+)?on\s+([a-z0-9][a-z0-9.-]{2,127})/i);
      const host = hostMatch ? safeHost(hostMatch[1]) : null;
      if (host) append('domain', host);
    }
  }

  const families = new Set(profile.signals
    .filter(s => !['environment', 'deployment_state'].includes(s.family))
    .map(s => s.family));
  const strong = profile.signals.some(s => s.family === 'explicit_link' ||
    (s.family === 'endpoint' && !s.generic) || s.family === 'domain');
  profile.dataQuality.level = strong || families.size >= 2 ? 'sufficient'
    : families.size === 1 ? 'partial' : 'insufficient';
  profile.dataQuality.missingFamilies = ['service_identity', 'endpoint', 'component', 'explicit_link']
    .filter(family => !families.has(family));
  profile.dataQuality.explanation = strong
    ? 'A source-backed technical anchor was extracted.'
    : profile.dataQuality.level === 'insufficient'
      ? 'No distinctive technical discovery signals were extracted.'
      : 'Only partial technical discovery signals were extracted.';
  return profile;
}

/** Jira-visible provenance only; no unread Confluence candidate identities. */
export function publicNarrativeEvidence(profile) {
  return (profile?.signals ?? [])
    .filter(signal => signal.extraction === 'narrative_pattern')
    .map(signal => ({
      family: signal.family,
      role: signal.role,
      value: signal.normalizedValue,
      jiraField: signal.source?.field ?? null,
      jiraPath: signal.source?.path ?? null,
      quote: signal.source?.quote ?? '',
      extraction: signal.extraction,
    }));
}
