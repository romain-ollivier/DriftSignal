import test from 'node:test';
import assert from 'node:assert/strict';
import { profileJiraChange } from '../src/discovery/change-profiler.mjs';
import { profileJiraChangeNarrative, publicNarrativeEvidence } from '../src/discovery/narrative-profiler.mjs';
import { planDiscoveryQueries } from '../src/discovery/query-planner.mjs';

function issue(description, key = 'DSBENCH-2') {
  return { key, fields: { summary: 'Traffic switch', description, components: [] } };
}
const settlement = 'We moved the settlement traffic last night. The old route /settlement/v1/route was on legacy-settle.example.internal. Please verify the recovery playbook.';

test('B1.1 extracts the DSBENCH-2 historical route and hostname with Jira provenance', () => {
  const original = profileJiraChange(issue(settlement));
  assert.equal(original.signals.filter(x => x.family === 'endpoint').length, 0);
  const candidate = profileJiraChangeNarrative(issue(settlement));
  const path = candidate.signals.find(x => x.family === 'endpoint');
  const host = candidate.signals.find(x => x.family === 'domain');
  assert.equal(path.normalizedValue, '/settlement/v1/route');
  assert.equal(path.role, 'old');
  assert.equal(path.extraction, 'narrative_pattern');
  assert.equal(path.source.field, 'description');
  assert.equal(path.source.path, 'description.line[0]');
  assert.match(path.source.quote, /The old route \/settlement\/v1\/route was on/);
  assert.equal(host.normalizedValue, 'legacy-settle.example.internal');
  assert.equal(host.role, 'old');
  assert.equal(candidate.context.deploymentState, 'unknown');
  assert.equal(candidate.dataQuality.level, 'sufficient');
});

test('Same existing B1 Query Planner gets an old-route intent without modifications', () => {
  const baseline = planDiscoveryQueries(profileJiraChange(issue(settlement)), { maxCqlQueries: 4, maxDirectLinks: 0 });
  const experiment = planDiscoveryQueries(profileJiraChangeNarrative(issue(settlement)), { maxCqlQueries: 4, maxDirectLinks: 0 });
  assert.equal(baseline.queries.length, 0);
  assert.equal(experiment.queries[0].searchText, '/settlement/v1/route');
  assert.deepEqual(experiment.queries[0].families, ['endpoint_old']);
  assert.ok(experiment.queries.some(q => q.searchText === 'legacy-settle.example.internal'));
});

test('The B1 original profile and its structured extraction remain unaffected', () => {
  const structured = issue('Service: payment-gateway\nOld endpoint: /api/v1/payments\nNew endpoint: /api/v2/payments');
  const baseline = profileJiraChange(structured);
  const experiment = profileJiraChangeNarrative(structured);
  assert.deepEqual(experiment.signals, baseline.signals);
  assert.equal(experiment.signals.some(s => s.extraction === 'narrative_pattern'), false);
});

test('B1.1 covers novel service families, not only the benchmark example', () => {
  for (const [value, expected] of [
    ['We changed ledger routing. Previous API endpoint /ledger/v1/export was on ledger-old.internal.', '/ledger/v1/export'],
    ['The legacy path /warehouse/v2/intake was on staging-api.internal.', '/warehouse/v2/intake'],
    ['Former route /catalogue/v1/lookup was on catalogue-legacy.internal.', '/catalogue/v1/lookup'],
  ]) {
    const profile = profileJiraChangeNarrative(issue(value, 'EXTRA-1'));
    assert.equal(profile.signals.find(s => s.family === 'endpoint')?.normalizedValue, expected);
  }
});

test('No narrative extraction for hypothetical, conditional or suggested changes', () => {
  const samples = [
    'If the old route /ledger/v1/export were retired, tell operations.',
    'For example, the old route /ledger/v1/export might change.',
    'We might use the old route /ledger/v1/export.',
    'Someone proposed the old endpoint /ledger/v1/export.',
    'Perhaps the previous route /warehouse/v2/intake would be useful.',
  ];
  for (const line of samples) assert.equal(
    profileJiraChangeNarrative(issue(line)).signals.some(s => s.extraction === 'narrative_pattern'), false,
    line,
  );
});

test('Do not treat a quoted runbook passage as a Jira change assertion', () => {
  const samples = [
    '> The old route /ledger/v1/export was on ledger-old.internal.',
    'The runbook says the old route /ledger/v1/export was on ledger-old.internal.',
    'Example: the old route /ledger/v1/export was on ledger-old.internal.',
    'Copied from a runbook: the old route /ledger/v1/export was on ledger-old.internal.',
  ];
  for (const line of samples) assert.equal(
    profileJiraChangeNarrative(issue(line)).signals.some(s => s.extraction === 'narrative_pattern'), false,
    line,
  );
});

test('Ignore generic, malformed, overly long and potentially unsafe paths', () => {
  for (const candidate of ['/health', '/status', '/ready', '/v1', '/api/v1', '/bad//segment', '/foo?v=secret', '/foo#fragment', '/ledger/v1/export?token=abc', '/ledger/v1/export#anchor', '/abcdefgh'.repeat(20)]) {
    const p = profileJiraChangeNarrative(issue('The old route ' + candidate + ' was on ledger-old.internal.'));
    assert.equal(p.signals.some(s => s.extraction === 'narrative_pattern'), false, candidate);
  }
});

test('Disallow speculative inference from traffic migration alone', () => {
  const profile = profileJiraChangeNarrative(issue(settlement));
  assert.equal(profile.context.deploymentState, 'unknown');
  assert.equal(profile.signals.some(s => s.family === 'deployment_state'), false);
  assert.equal(profile.signals.some(s => s.family === 'service_identity'), false);
  const projected = publicNarrativeEvidence(profile);
  assert.equal(projected.length, 2);
  assert.equal(projected.every(s => s.extraction === 'narrative_pattern' && s.jiraField === 'description'), true);
  assert.equal(JSON.stringify(projected).includes('incompatibleInstruction'), false);
});

test('ADF paragraph text is extracted with evidence path, but ADF codeblock is ignored', () => {
  const adf = { type: 'doc', version: 1, content: [
    { type: 'paragraph', content: [{ type: 'text', text: 'We migrated traffic. The old path /warehouse/v1/intake was on warehouse-old.internal.' }] },
    { type: 'codeBlock', content: [{ type: 'text', text: 'The old path /secret/v1/recover was on secret.internal.' }] },
  ] };
  const profile = profileJiraChangeNarrative(issue(adf));
  const paths = profile.signals.filter(s => s.family === 'endpoint' && s.extraction === 'narrative_pattern');
  assert.equal(paths.length, 1);
  assert.equal(paths[0].normalizedValue, '/warehouse/v1/intake');
  assert.match(paths[0].source.path, /description\.content\[0\]/);
});

test('Overlong narrative is skipped rather than generating unbounded extraction', () => {
  const profile = profileJiraChangeNarrative(issue('x'.repeat(2100) + ' the old route /ledger/v1/export'));
  assert.equal(profile.signals.filter(s => s.extraction === 'narrative_pattern').length, 0);
});


test('No old endpoint is inferred from negation, denial or an existence question', () => {
  const samples = [
    'There has never been an old route /freight/v1/parcels in this service.',
    'We do not have an old route /freight/v1/parcels in this service.',
    'Is there an old route /freight/v1/parcels that we should retire?',
    'We checked: the old route /freight/v1/parcels does not exist.',
    'No previous endpoint /freight/v1/parcels was deployed.',
  ];
  for (const statement of samples) {
    const key = 'NEG-1';
    assert.deepEqual(profileJiraChangeNarrative(issue(statement, key)), profileJiraChange(issue(statement, key)), statement);
  }
});

test('ADF Hypothetical examples heading applies to following paragraphs', () => {
  const adf = { type: 'doc', version: 1, content: [
    { type: 'heading', attrs: { level: 2 }, content: [{ type: 'text', text: 'Hypothetical examples' }] },
    { type: 'paragraph', content: [{ type: 'text', text: 'The old route /freight/v1/parcels was on freight-old.internal.' }] },
    { type: 'paragraph', content: [{ type: 'text', text: 'The legacy path /warehouse/v1/intake was on old-warehouse.internal.' }] },
  ] };
  assert.deepEqual(profileJiraChangeNarrative(issue(adf, 'ADF-1')), profileJiraChange(issue(adf, 'ADF-1')));
});

test('Evidence quote includes extracted value even beyond the 240th source character', () => {
  const prefix = 'Technical migration notes '.repeat(15);
  const description = prefix + 'The old route /freight/v1/parcels was on freight-old.internal.';
  assert.ok(description.indexOf('/freight/v1/parcels') > 240);
  const item = issue(description, 'LONG-1');
  item.fields.updated = '2026-11-19T12:00:00Z';
  const p = profileJiraChangeNarrative(item);
  assert.equal(p.signals.filter(s => s.extraction === 'narrative_pattern').length, 2);
  for (const signal of p.signals.filter(s => s.extraction === 'narrative_pattern')) {
    assert.ok(signal.source.quote.includes(signal.normalizedValue));
    assert.ok(signal.source.quote.length <= 240);
    assert.equal(description.slice(signal.source.startOffset, signal.source.endOffset), signal.normalizedValue);
    assert.equal(signal.source.sourceUpdated, item.fields.updated);
    assert.match(signal.source.sourceFingerprint, /^[a-f0-9]{64}$/);
  }
  assert.equal(publicNarrativeEvidence(p).every(e => e.sourceUpdated && e.sourceFingerprint), true);
});

test('Do not silently truncate endpoint templates into partial paths', () => {
  const samples = [
    'The old route /freight/v1/parcels/{parcelId} was on freight-old.internal.',
    'The old route /freight/v1/parcels/{parcelId}/retry was on freight-old.internal.',
    'The old route /freight/v1/parcels?token=secret was on freight-old.internal.',
    'The old route /freight/v1/parcels#anchor was on freight-old.internal.',
  ];
  for (const value of samples) {
    assert.equal(profileJiraChangeNarrative(issue(value)).signals.some(s => s.extraction === 'narrative_pattern'), false, value);
  }
});

test('No added narrative signal preserves the full original B1 profile', () => {
  for (const value of [
    'Something changed. Please check documentation.',
    'Service: payment-gateway\nOld endpoint: /api/v1/payments\nNew endpoint: /api/v2/payments',
    'Deployment status: Planned\nNew endpoint: /health',
    'The old route /freight/v1/parcels does not exist.',
  ]) {
    assert.deepEqual(profileJiraChangeNarrative(issue(value)), profileJiraChange(issue(value)), value);
  }
});

test('Record the risk that narrative signals evict existing CQL plans under four-call budget', () => {
  const mixed = issue([
    'Service: freight-core',
    'Old endpoint: /api/v1/freight',
    'New endpoint: /api/v2/freight',
    'Old hostname: old.freight.internal',
    'Current hostname: active.freight.internal',
    'We migrated traffic. The old route /freight/v1/parcels was on legacy.freight.internal.',
  ].join('\n'), 'MIXED-1');
  const base = planDiscoveryQueries(profileJiraChange(mixed), { maxCqlQueries: 4, maxDirectLinks: 0 });
  const experiment = planDiscoveryQueries(profileJiraChangeNarrative(mixed), { maxCqlQueries: 4, maxDirectLinks: 0 });
  assert.equal(base.queries.length, 4);
  assert.equal(experiment.queries.length, 4);
  assert.ok(experiment.queries.some(q => q.searchText === '/freight/v1/parcels'));
  const displaced = base.queries.map(q => q.searchText).filter(term =>
    !experiment.queries.some(q => q.searchText === term));
  assert.ok(displaced.length >= 1, 'Report B1 plan queries lost to B1.1 under the fixed limit');
  assert.ok(experiment.coverage.omittedCqlQueries >= 1);
});
