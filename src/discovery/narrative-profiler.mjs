import { profileJiraChange } from './change-profiler.mjs';
import { createHash } from 'node:crypto';

/**
 * Experimental B1.1: recover explicitly stated historical routes from Jira
 * narrative. Never infer service identity, deployment status or incompatibility.
 * Existing B1 profiler/planner/retrieval remain unchanged.
 */
// Capture the COMPLETE path token. Do not silently truncate route templates,
// query strings or fragments into apparently verified paths.
const ANCHOR_RE = /\b(?:old|previous|legacy|former)\s+(?:api\s+)?(?:route|endpoint|path)\s+(\/[^\s<>"']+)/gi;
const GENERIC_PATHS = new Set(['/', '/health', '/healthz', '/status', '/ping', '/ready', '/readiness', '/metrics']);
const UNSUPPORTED_CONTEXT_RE = /\b(?:if|suppose|hypothetical|hypothetically|perhaps|example|examples|e\.g\.|for example|might|may|could|would|should|proposed|proposal|suggested|potential|possibly|never|no|not|without|doesn't|didn't|isn't|wasn't|weren't|cannot|can't)\b/i;
const QUOTED_DOC_RE = /\b(?:runbook|documentation|docs?|wiki|sample|example|quote|quoted)\s+(?:says|said|states|stated|reads|mentions|mentioned|contains|lists|shows)\b/i;
const EXAMPLE_SECTION_RE = /\b(?:hypothetical|examples?|samples?|templates?|proposed|future|speculative|draft)\b/i;
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
  const add = (value, field, path, heading = '') => {
    if (typeof value !== 'string') return;
    for (const [index, line] of value.split(/\r?\n/).entries()) {
      if (line.trim() && line.length <= MAX_RECORD_LENGTH && result.length < MAX_RECORDS) {
        result.push({
          text: line.trim(), field,
          path: path + '.line[' + index + ']',
          heading,
        });
      }
    }
  };
  add(fields.summary, 'summary', 'summary');
  if (typeof fields.description === 'string') {
    add(fields.description, 'description', 'description');
  } else {
    // Carry the nearest preceding ADF section heading through subsequent
    // sibling paragraphs (including list paragraphs). A "Hypothetical
    // examples" heading changes how following prose should be interpreted.
    function walk(node, path, sectionHeading = '') {
      if (!node || result.length >= MAX_RECORDS) return;
      if (Array.isArray(node)) {
        let currentHeading = sectionHeading;
        node.forEach((child, i) => {
          if (child?.type === 'heading') {
            currentHeading = inlineText(child);
          } else {
            walk(child, path + '[' + i + ']', currentHeading);
          }
        });
        return;
      }
      if (node.type === 'codeBlock' || node.type === 'blockquote') return;
      if (node.type === 'paragraph') {
        add(inlineText(node), 'description', path, sectionHeading);
        return;
      }
      walk(node.content, path + '.content', sectionHeading);
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
  return { sentence: value.slice(start, end).trim(), start, end };
}

function evidenceWindow(text, valueStart, valueEnd) {
  // Anchor the <=240 character quote around the exact extracted value.
  // Keeping a short prefix normally also includes "old route" / "was on".
  const width = 240;
  let from = Math.max(0, valueStart - 85);
  if (valueEnd > from + width) from = valueEnd - width;
  const to = Math.min(text.length, from + width);
  return text.slice(from, to);
}

function unsupportedSentence(sentence) {
  // Remove technical tokens BEFORE interpreting ordinary-language cues.
  // A hostname containing ".example." must never be deemed speculative.
  const wordsOnly = sentence
    .replace(/\/[^\s]+/g, ' ')
    .replace(/\b[a-z0-9-]+(?:\.[a-z0-9-]+)+\b/gi, ' ');
  return /[?]/.test(sentence)
    || UNSUPPORTED_CONTEXT_RE.test(wordsOnly)
    || QUOTED_DOC_RE.test(wordsOnly);
}

/**
 * Returns the existing B1 profile contract with evidence-backed
 * narrative_pattern signals appended, and no speculative inference.
 */
export function profileJiraChangeNarrative(issue) {
  const profile = profileJiraChange(issue);
  const signatures = new Set(profile.signals.map(s =>
    [s.family, s.role, s.normalizedValue].join('|')));
  let appended = 0;

  for (const record of jiraNarrativeRecords(issue)) {
    const { text, field, path, heading } = record;
    if (EXAMPLE_SECTION_RE.test(heading) ||
        /^(?:>|["'])/.test(text) || text.startsWith(String.fromCharCode(96)) ||
        /\b(?:copy|copied|pasted)\s+(?:from|of)\s+(?:a\s+)?(?:runbook|documentation)\b/i.test(text)) continue;

    for (const match of text.matchAll(ANCHOR_RE)) {
      if (profile.signals.length >= MAX_SIGNALS) break;
      const context = sentenceContext(text, match.index);
      if (unsupportedSentence(context.sentence)) continue;

      const rawPath = match[1];
      const endpoint = safePath(rawPath);
      if (!endpoint) continue;
      const rawPathStart = match.index + match[0].lastIndexOf(rawPath);
      const pathStart = rawPathStart;
      const pathEnd = rawPathStart + endpoint.length;
      const fingerprint = createHash('sha256').update(text).digest('hex');

      const append = (family, rawValue, value, start, end) => {
        const signature = [family, 'old', value].join('|');
        if (signatures.has(signature) || profile.signals.length >= MAX_SIGNALS) return;
        signatures.add(signature);
        appended += 1;
        profile.signals.push({
          id: 's' + (profile.signals.length + 1),
          family,
          role: 'old',
          rawValue,
          normalizedValue: value,
          extraction: 'narrative_pattern',
          source: {
            product: 'jira', objectId: profile.issueKey, field, path,
            quote: evidenceWindow(text, start, end),
            startOffset: start, endOffset: end,
            sourceUpdated: profile.sourceUpdated,
            sourceFingerprint: fingerprint,
          },
          ...(family === 'endpoint' ? { generic: false } : {}),
        });
      };
      append('endpoint', rawPath, endpoint, pathStart, pathEnd);

      const remainder = text.slice(match.index + match[0].length);
      const hostMatch = remainder.match(/^\s+(?:was|is)\s+(?:hosted\s+)?on\s+([^\s]+)/i);
      const rawHost = hostMatch?.[1];
      const host = rawHost ? safeHost(rawHost) : null;
      if (host) {
        const hostStart = match.index + match[0].length + hostMatch[0].lastIndexOf(rawHost);
        append('domain', rawHost, host, hostStart, hostStart + host.length);
      }
    }
  }

  // Exact B1 parity when no additional signal exists, including the wording
  // and ordering of dataQuality fields, source metadata and uncertainties.
  if (appended === 0) return profile;

  const families = new Set(profile.signals
    .filter(s => !['environment', 'deployment_state'].includes(s.family))
    .map(s => s.family));
  const strong = profile.signals.some(s => s.family === 'explicit_link' ||
    (s.family === 'endpoint' && !s.generic) || s.family === 'domain');
  const level = strong || families.size >= 2 ? 'sufficient'
    : families.size === 1 ? 'partial' : 'insufficient';
  profile.dataQuality.level = level;
  profile.dataQuality.missingFamilies = ['service_identity', 'endpoint', 'component', 'explicit_link']
    .filter(family => !families.has(family));
  profile.dataQuality.explanation = level === 'insufficient'
    ? 'No distinctive technical discovery signals were extracted.'
    : level === 'partial'
      ? 'Only one limited technical signal family was extracted.'
      : 'At least one distinctive technical anchor or multiple signal families were extracted.';
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
      startOffset: signal.source?.startOffset ?? null,
      endOffset: signal.source?.endOffset ?? null,
      sourceUpdated: signal.source?.sourceUpdated ?? null,
      sourceFingerprint: signal.source?.sourceFingerprint ?? null,
      quote: signal.source?.quote ?? '',
      extraction: signal.extraction,
    }));
}
