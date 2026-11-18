import test from 'node:test';
import assert from 'node:assert/strict';
import { profileJiraChange } from '../src/discovery/change-profiler.mjs';

function issue(description, extras = {}) {
  return {
    key: 'CLSD-6',
    fields: {
      summary: 'Payment Gateway endpoint migration',
      description,
      updated: '2026-11-18T09:00:00.000+0000',
      ...extras,
    },
  };
}

function signals(profile, family) {
  return profile.signals.filter((signal) => signal.family === family);
}

test('B1 Change Profiler extracts old and new endpoints independently with Jira provenance', () => {
  const change = profileJiraChange(issue([
    'Service: payment-gateway',
    'Environment: production',
    'Old endpoint: /api/v1/payments',
    'New endpoint: /api/v2/payments',
    'Deployment status: Deployed to production',
  ].join('\n')));
  assert.deepEqual(signals(change, 'endpoint').map((signal) => [signal.role, signal.normalizedValue]), [
    ['old', '/api/v1/payments'],
    ['new', '/api/v2/payments'],
  ]);
  assert.equal(signals(change, 'endpoint')[0].source.field, 'description');
  assert.equal(signals(change, 'endpoint')[0].source.path, 'description.line[2]');
  assert.equal(signals(change, 'endpoint')[0].source.quote, 'Old endpoint: /api/v1/payments');
  assert.equal(change.context.environment, 'production');
  assert.equal(change.context.deploymentState, 'deployed');
  assert.equal(change.dataQuality.level, 'sufficient');
  assert.equal(change.sourceUpdated, '2026-11-18T09:00:00.000+0000');
});

test('B1 extracts ADF with block anchors and embedded Confluence link marks', () => {
  const adf = {
    type: 'doc',
    version: 1,
    content: [
      { type: 'paragraph', content: [{ type: 'text', text: 'Old endpoint: /api/v1/payments' }] },
      {
        type: 'paragraph',
        content: [{
          type: 'text',
          text: 'Recovery runbook',
          marks: [{ type: 'link', attrs: { href: 'https://demo.atlassian.net/wiki/spaces/OPS/pages/1122' } }],
        }],
      },
      { type: 'paragraph', content: [{ type: 'text', text: 'New endpoint: /api/v2/payments' }] },
    ],
  };
  const result = profileJiraChange(issue(adf));
  assert.deepEqual(signals(result, 'endpoint').map((signal) => signal.role), ['old', 'new']);
  assert.equal(signals(result, 'endpoint')[0].source.path, 'description.content[0]');
  assert.equal(signals(result, 'explicit_link').length, 1);
  assert.equal(signals(result, 'explicit_link')[0].source.path, 'description.content[1].content[0]');
  assert.equal(signals(result, 'explicit_link')[0].source.quote, 'Recovery runbook');
});

test('B1 recognizes distinctive old host/path without requiring Service field', () => {
  const result = profileJiraChange(issue('Old host: legacy-payments.ops.example.com\nOld endpoint: /gateway/v1/settle'));
  assert.equal(signals(result, 'service_identity').length, 0);
  assert.equal(signals(result, 'domain')[0].normalizedValue, 'legacy-payments.ops.example.com');
  assert.equal(signals(result, 'domain')[0].role, 'old');
  assert.equal(signals(result, 'endpoint')[0].role, 'old');
  assert.equal(result.dataQuality.level, 'sufficient');
});

test('B1 does not invent an old endpoint when Jira declares only a new endpoint', () => {
  const result = profileJiraChange(issue('New endpoint: /api/v2/payments'));
  assert.equal(signals(result, 'endpoint').length, 1);
  assert.equal(signals(result, 'endpoint')[0].role, 'new');
  assert.equal(signals(result, 'endpoint').some((signal) => signal.role === 'old'), false);
});

test('B1 extracts Jira components but a component does not automatically prove an endpoint change', () => {
  const result = profileJiraChange(issue('Update gateway configuration', {
    components: [{ id: '11', name: 'Payments API' }, { id: '12', name: 'Gateway Runtime' }],
  }));
  assert.deepEqual(signals(result, 'component').map((signal) => signal.normalizedValue), [
    'payments api',
    'gateway runtime',
  ]);
  assert.equal(signals(result, 'endpoint').length, 0);
  assert.equal(result.dataQuality.level, 'partial');
});

test('B1 abstains on a ticket with no technical signals or only generic /health', () => {
  const blank = profileJiraChange(issue('Update API configuration'));
  assert.equal(blank.dataQuality.level, 'insufficient');
  assert.equal(blank.signals.length, 0);
  const generic = profileJiraChange(issue('New endpoint: /health'));
  assert.equal(generic.dataQuality.level, 'partial');
  assert.equal(signals(generic, 'endpoint')[0].generic, true);
});

test('B1 preserves uncertainty for conflicting environment declarations', () => {
  const result = profileJiraChange(issue('Environment: staging\nDeployment status: Deployed to production'));
  assert.equal(result.context.environment, 'unknown');
  assert.deepEqual(result.context.uncertainties, ['Conflicting environment declarations.']);
});

test('B1 rejects unsafe or unrelated URLs as Confluence direct links', () => {
  const result = profileJiraChange(issue([
    'https://other.example.com/wiki/pages/12345',
    'https://demo.atlassian.net.evil.test/wiki/pages/12345',
    'https://demo.atlassian.net/wiki/pages/viewpage.action?pageId=12345',
  ].join('\n')));
  assert.deepEqual(signals(result, 'explicit_link').map((signal) => signal.normalizedValue), [
    'https://demo.atlassian.net/wiki/pages/viewpage.action?pageId=12345',
  ]);
});

test('B1 normalizes explicit HTTPS endpoints while preserving raw values and source quotes', () => {
  const result = profileJiraChange(issue('Old endpoint: HTTPS://API.EXAMPLE.COM/api/v1/payments'));
  assert.equal(signals(result, 'endpoint')[0].normalizedValue, 'https://api.example.com/api/v1/payments');
  assert.equal(signals(result, 'endpoint')[0].rawValue, 'HTTPS://API.EXAMPLE.COM/api/v1/payments');
  assert.equal(signals(result, 'endpoint')[0].source.quote, 'Old endpoint: HTTPS://API.EXAMPLE.COM/api/v1/payments');
});
