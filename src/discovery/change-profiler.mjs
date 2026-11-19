/**
 * B1: source-aware, deterministic extraction of technical discovery signals.
 *
 * This module is intentionally independent of Forge and makes no Confluence
 * calls. Its output describes Jira declarations, not verified runtime state.
 */
const MAX_SIGNALS = 100;
const ENDPOINT_RE = /^(?:(old|previous|legacy|new|target|current|deployed)\s+)?(?:endpoint|api\s*(?:url|path)|base\s*url)\s*:\s*(\S+)/i;
const HOST_RE = /^(?:(old|previous|legacy|new|target|current)\s+)?(?:host|hostname|domain)\s*:\s*(\S+)/i;
const SERVICE_RE = /^service(?:\s+(?:id|name))?\s*:\s*([a-z0-9][a-z0-9._:-]{2,63})\s*$/i;
const ENV_RE = /^(?:environment|env)\s*:\s*(production|prod|staging|stage|development|dev|test|qa)\s*$/i;
const URL_RE = /https?:\/\/[^\s<>"']+/gi;
const BLOCK_TYPES = new Set(['paragraph', 'heading', 'codeBlock']);
const GENERIC_PATHS = new Set(['/', '/health', '/healthz', '/status', '/ping', '/ready', '/readiness', '/metrics']);

function cleanValue(text) {
  return String(text ?? '').trim().replace(/[),.;]+$/, '');
}

function normalizeRole(label) {
  const role = String(label ?? '').toLowerCase();
  if (['old', 'previous', 'legacy'].includes(role)) return 'old';
  if (['new', 'target'].includes(role)) return 'new';
  if (['current', 'deployed'].includes(role)) return 'current';
  return 'unknown';
}

function normalizeEnvironment(value) {
  const env = String(value ?? '').toLowerCase();
  if (env === 'prod') return 'production';
  if (env === 'stage') return 'staging';
  if (env === 'dev') return 'development';
  if (env === 'qa') return 'test';
  return ['production', 'staging', 'development', 'test'].includes(env) ? env : 'unknown';
}

function normalizeEndpoint(value) {
  const raw = cleanValue(value);
  if (!raw.startsWith('/') && !/^https?:\/\//i.test(raw)) return null;
  if (/^https?:\/\//i.test(raw)) {
    try {
      const url = new URL(raw);
      if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) return null;
      return url.origin.toLowerCase() + url.pathname + url.search;
    } catch {
      return null;
    }
  }
  return raw;
}

function normalizeHost(value) {
  const raw = cleanValue(value);
  try {
    const url = new URL(/^https?:\/\//i.test(raw) ? raw : 'https://' + raw);
    if (!url.hostname || url.username || url.password) return null;
    if (!/^[a-z0-9.-]+$/i.test(url.hostname)) return null;
    return url.hostname.toLowerCase();
  } catch {
    return null;
  }
}

function isConfluenceLink(value) {
  try {
    const parsed = new URL(value);
    return parsed.protocol === 'https:'
      && parsed.hostname.endsWith('.atlassian.net')
      && parsed.hostname !== '.atlassian.net'
      && parsed.pathname.startsWith('/wiki/');
  } catch {
    return false;
  }
}

function inlineText(node) {
  if (!node || typeof node !== 'object') return '';
  if (Array.isArray(node)) return node.map(inlineText).join('');
  if (node.type === 'text') return String(node.text ?? '');
  if (node.type === 'hardBreak') return '\n';
  return inlineText(node.content ?? []);
}

/**
 * Preserve the ADF block location while collecting text and link mark URLs.
 * The link mark path points to the actual text node, not a guessed line.
 */
function adfRecords(adf) {
  const lines = [];
  const linkMarks = [];
  function walk(node, path) {
    if (!node || typeof node !== 'object') return;
    if (Array.isArray(node)) {
      node.forEach((child, index) => walk(child, path + '[' + index + ']'));
      return;
    }
    if (node.type === 'text') {
      for (const mark of node.marks ?? []) {
        if (mark?.type === 'link' && typeof mark.attrs?.href === 'string') {
          linkMarks.push({
            url: mark.attrs.href,
            path,
            quote: String(node.text ?? '').slice(0, 180),
          });
        }
      }
    }
    if (BLOCK_TYPES.has(node.type)) {
      const block = inlineText(node);
      for (const line of block.split(/\r?\n/)) {
        if (line.trim()) lines.push({ text: line.trim(), path });
      }
    }
    walk(node.content ?? [], path + '.content');
  }
  walk(adf, 'description');
  return { lines, linkMarks };
}

export function profileJiraChange(issue) {
  if (!issue || typeof issue !== 'object') throw new TypeError('A Jira issue object is required.');
  const key = String(issue.key ?? '').trim();
  const fields = issue.fields ?? {};
  const signals = [];
  const seen = new Set();
  const uncertainties = [];

  function add(family, role, rawValue, normalizedValue, field, path, quote, extra = {}) {
    if (!normalizedValue || signals.length >= MAX_SIGNALS) return;
    const signature = [family, role, normalizedValue, field, path].join('|');
    if (seen.has(signature)) return;
    seen.add(signature);
    signals.push({
      id: 's' + (signals.length + 1),
      family,
      role,
      rawValue,
      normalizedValue,
      extraction: 'explicit',
      source: {
        product: 'jira',
        objectId: key,
        field,
        path,
        quote: String(quote ?? '').slice(0, 240),
      },
      ...extra,
    });
  }

  const records = [];
  if (typeof fields.summary === 'string' && fields.summary.trim()) {
    records.push({ text: fields.summary.trim(), field: 'summary', path: 'summary' });
  }

  const description = fields.description;
  let links = [];
  if (typeof description === 'string') {
    for (const [index, text] of description.split(/\r?\n/).entries()) {
      if (text.trim()) records.push({ text: text.trim(), field: 'description', path: 'description.line[' + index + ']' });
    }
  } else if (description && typeof description === 'object') {
    const extracted = adfRecords(description);
    records.push(...extracted.lines.map((entry) => ({ ...entry, field: 'description' })));
    links = extracted.linkMarks;
  }

  for (const [index, component] of (Array.isArray(fields.components) ? fields.components : []).entries()) {
    const raw = typeof component === 'string' ? component : component?.name;
    if (typeof raw !== 'string' || !raw.trim()) continue;
    const normalized = raw.trim().toLowerCase();
    add('component', 'unknown', raw.trim(), normalized, 'components', 'components[' + index + '].name', raw.trim());
  }

  const environmentDeclarations = [];
  const deploymentDeclarations = [];

  for (const record of records) {
    const line = record.text;
    const source = [record.field, record.path, line];
    const service = line.match(SERVICE_RE);
    if (service) add('service_identity', 'unknown', service[1], service[1].toLowerCase(), ...source);
    const endpoint = line.match(ENDPOINT_RE);
    if (endpoint) {
      const value = normalizeEndpoint(endpoint[2]);
      if (value) add('endpoint', normalizeRole(endpoint[1]), endpoint[2], value, ...source, {
        generic: GENERIC_PATHS.has(value.toLowerCase()),
      });
    }
    const host = line.match(HOST_RE);
    if (host) {
      const normalized = normalizeHost(host[2]);
      if (normalized) add('domain', normalizeRole(host[1]), host[2], normalized, ...source);
    }
    const env = line.match(ENV_RE);
    if (env) {
      const normalized = normalizeEnvironment(env[1]);
      environmentDeclarations.push(normalized);
      add('environment', 'unknown', env[1], normalized, ...source);
    }
    if (/^deployment\s+status\s*:/i.test(line)) {
      const value = line.replace(/^deployment\s+status\s*:\s*/i, '').trim();
      // A negated status is not an affirmative deployment fact. In
      // particular, "Not deployed" must never become "deployed".
      // Mixed or ambiguous negative statements remain unknown.
      const hasNegation = /\b(?:not|never|no|without)\b/i.test(value);
      const explicitlyNotDeployed = /\b(?:not|never)\s+(?:(?:yet|currently|ever)\s+)?deployed\b/i.test(value);
      const state = hasNegation
        ? (explicitlyNotDeployed ? 'not_deployed' : 'unknown')
        : /\brolled\s*back\b/i.test(value) ? 'rolled_back'
          : /\bdeployed\b/i.test(value) ? 'deployed'
            : /\b(in.progress|deploying)\b/i.test(value) ? 'in_progress'
              : /\b(planned|scheduled)\b/i.test(value) ? 'planned' : 'unknown';
      deploymentDeclarations.push(state);
      add('deployment_state', 'unknown', value, state, ...source);
      if (/\bproduction\b|\bprod\b/i.test(value)) environmentDeclarations.push('production');
      else if (/\bstaging\b|\bstage\b/i.test(value)) environmentDeclarations.push('staging');
    }
    for (const urlMatch of line.matchAll(URL_RE)) {
      const value = cleanValue(urlMatch[0]);
      if (isConfluenceLink(value)) {
        add('explicit_link', 'unknown', value, value, ...source);
      }
    }
  }

  for (const mark of links) {
    const url = cleanValue(mark.url);
    if (isConfluenceLink(url)) {
      add('explicit_link', 'unknown', url, url, 'description', mark.path, mark.quote || url);
    }
  }

  const environments = [...new Set(environmentDeclarations)];
  const deployments = [...new Set(deploymentDeclarations.filter((state) => state !== 'unknown'))];
  const environment = environments.length === 1 ? environments[0] : 'unknown';
  const deploymentState = deployments.length === 1 ? deployments[0] : 'unknown';
  if (environments.length > 1) uncertainties.push('Conflicting environment declarations.');
  if (deployments.length > 1) uncertainties.push('Conflicting deployment status declarations.');

  const distinctFamilies = new Set(signals
    .filter((signal) => !['environment', 'deployment_state'].includes(signal.family))
    .map((signal) => signal.family));
  const hasStrongTechnicalAnchor = signals.some((signal) =>
    signal.family === 'explicit_link' ||
    (signal.family === 'endpoint' && !signal.generic) ||
    signal.family === 'domain');
  const level = hasStrongTechnicalAnchor || distinctFamilies.size >= 2 ? 'sufficient'
    : distinctFamilies.size === 1 ? 'partial' : 'insufficient';

  return {
    schemaVersion: '1.0',
    issueKey: key,
    sourceUpdated: typeof fields.updated === 'string' ? fields.updated : null,
    signals,
    context: { environment, deploymentState, uncertainties },
    dataQuality: {
      level,
      missingFamilies: ['service_identity', 'endpoint', 'component', 'explicit_link']
        .filter((family) => !distinctFamilies.has(family)),
      explanation: level === 'insufficient'
        ? 'No distinctive technical discovery signals were extracted.'
        : level === 'partial'
          ? 'Only one limited technical signal family was extracted.'
          : 'At least one distinctive technical anchor or multiple signal families were extracted.',
    },
  };
}
