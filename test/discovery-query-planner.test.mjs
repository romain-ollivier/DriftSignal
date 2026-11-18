import test from 'node:test';
import assert from 'node:assert/strict';
import { planDiscoveryQueries } from '../src/discovery/query-planner.mjs';
import { profileJiraChange } from '../src/discovery/change-profiler.mjs';

function sig(id, family, value, role = 'unknown', extra = {}) {
  return { id, family, normalizedValue: value, role, source: { field: 'description', path: 'line[0]' }, ...extra };
}
function profile(...signals) { return { issueKey: 'CLSD-6', signals }; }

test('B1 prioritizes old endpoint and host while preserving service and new endpoint under four-query budget', () => {
  const p = profile(
    sig('s1', 'service_identity', 'payment-gateway'),
    sig('s2', 'endpoint', '/api/v2/payments', 'new'),
    sig('s3', 'domain', 'legacy-payments.example.com', 'old'),
    sig('s4', 'endpoint', '/api/v1/payments', 'old'),
  );
  const r = planDiscoveryQueries(p);
  assert.equal(r.status, 'READY');
  assert.equal(r.budget.plannedCqlQueries, 4);
  assert.deepEqual(r.queries.map((q) => q.searchText), [
    '/api/v1/payments', 'legacy-payments.example.com', 'payment-gateway', '/api/v2/payments',
  ]);
  assert.equal(r.queries[0].indexingAssumption, 'requires_live_punctuation_validation');
});

test('B1 can plan from an old host and path without a structured Service field', () => {
  const r = planDiscoveryQueries(profile(
    sig('s1', 'domain', 'old.example.com', 'old'),
    sig('s2', 'endpoint', '/gateway/v1/settle', 'old'),
  ));
  assert.deepEqual(r.queries.map((q) => q.searchText), ['/gateway/v1/settle', 'old.example.com']);
});

test('B1 deduplicates identical searches and preserves all Jira origins', () => {
  const r = planDiscoveryQueries(profile(
    sig('s1', 'service_identity', 'payment-gateway'),
    sig('s2', 'service_identity', 'payment-gateway'),
    sig('s3', 'component', 'payment-gateway'),
  ));
  assert.equal(r.queries.length, 1);
  assert.equal(r.queries[0].searchText, 'payment-gateway');
  assert.deepEqual(r.queries[0].origins.map((origin) => origin.signalId), ['s1', 's2', 's3']);
  assert.deepEqual(r.queries[0].families, ['service_identity', 'component']);
});

test('B1 does not search on /health alone and explicitly abstains', () => {
  const r = planDiscoveryQueries(profile(sig('s1', 'endpoint', '/health', 'new', { generic: true })));
  assert.equal(r.status, 'INSUFFICIENT_SEARCH_SIGNALS');
  assert.equal(r.queries.length, 0);
  assert.equal(r.skipped[0].reason, 'generic_or_unsupported_search_term');
});

test('B1 keeps direct links separate from CQL and marks tenant/permission checks as required', () => {
  const r = planDiscoveryQueries(profile(
    sig('s1', 'explicit_link', 'https://abc.atlassian.net/wiki/pages/viewpage.action?pageId=123'),
    sig('s2', 'service_identity', 'payment-gateway'),
  ), { maxCqlQueries: 0 });
  assert.equal(r.queries.length, 0);
  assert.equal(r.directLinks.length, 1);
  assert.equal(r.directLinks[0].requiresTenantAndPermissionCheck, true);
});

test('B1 rejects spoofed hostnames and non-Confluence URLs', () => {
  const r = planDiscoveryQueries(profile(
    sig('s1', 'explicit_link', 'https://abc.atlassian.net.evil.com/wiki/pages/1'),
    sig('s2', 'explicit_link', 'http://abc.atlassian.net/wiki/pages/2'),
    sig('s3', 'explicit_link', 'https://abc.atlassian.net/login'),
  ));
  assert.equal(r.directLinks.length, 0);
  assert.equal(r.skipped.length, 3);
});

test('B1 avoids copying endpoint URL query params into the CQL search plan', () => {
  const r = planDiscoveryQueries(profile(
    sig('s1', 'endpoint', 'https://api.example.com/api/v1/payments?token=secret', 'old'),
  ));
  assert.deepEqual(r.queries.map((q) => q.searchText), ['/api/v1/payments', 'api.example.com']);
  assert.equal(JSON.stringify(r).includes('secret'), false);
});

test('B1 query execution order is deterministic with shuffled input signals', () => {
  const a = sig('s1', 'endpoint', '/api/v2/payments', 'new');
  const b = sig('s2', 'endpoint', '/api/v1/payments', 'old');
  const c = sig('s3', 'component', 'Payments API');
  const order = (r) => r.queries.map((q) => [q.searchText, q.mode, q.priority]);
  assert.deepEqual(order(planDiscoveryQueries(profile(a, b, c))), order(planDiscoveryQueries(profile(c, a, b))));
});

test('B1 records queries omitted by the specified CQL budget', () => {
  const r = planDiscoveryQueries(profile(
    sig('s1', 'endpoint', '/api/v1/payments', 'old'),
    sig('s2', 'service_identity', 'payment-gateway'),
    sig('s3', 'component', 'Payments API'),
    sig('s4', 'endpoint', '/api/v2/payments', 'new'),
  ), { maxCqlQueries: 2 });
  assert.equal(r.queries.length, 2);
  assert.equal(r.coverage.omittedCqlQueries, 2);
  assert.equal(r.skipped.filter((item) => item.reason === 'cql_query_budget').length, 2);
});

test('B1 rejects invalid budgets before planning requests', () => {
  assert.throws(() => planDiscoveryQueries(profile(), { maxCqlQueries: -1 }), /maxCqlQueries/);
  assert.throws(() => planDiscoveryQueries(profile(), { maxDirectLinks: 100 }), /maxDirectLinks/);
});

test('B1 integrates with the Jira Change Profiler for a payment-gateway migration', () => {
  const jiraIssue = {
    key: 'CLSD-6',
    fields: {
      summary: 'Migrate payment gateway endpoint to v2',
      description: [
        'Service: payment-gateway',
        'Environment: production',
        'Old endpoint: /api/v1/payments',
        'New endpoint: /api/v2/payments',
        'Deployment status: Deployed to production',
      ].join('\n'),
    },
  };
  const p = profileJiraChange(jiraIssue);
  const r = planDiscoveryQueries(p);
  assert.equal(p.context.environment, 'production');
  assert.deepEqual(r.queries.map((q) => q.searchText), [
    '/api/v1/payments', 'payment-gateway', '/api/v2/payments',
  ]);
  assert.ok(r.queries.every((q) => q.origins.length >= 1));
});

test('B1 deduplicates repeated direct links and retains both sources', () => {
  const url = 'https://abc.atlassian.net/wiki/pages/viewpage.action?pageId=123';
  const r = planDiscoveryQueries(profile(
    sig('s1', 'explicit_link', url),
    sig('s2', 'explicit_link', url),
  ));
  assert.equal(r.directLinks.length, 1);
  assert.deepEqual(r.directLinks[0].origins.map((origin) => origin.signalId), ['s1', 's2']);
});

test('B1 component names with spaces remain phrase search intentions', () => {
  const r = planDiscoveryQueries(profile(sig('s1', 'component', 'Payments API')));
  assert.equal(r.queries.length, 1);
  assert.equal(r.queries[0].mode, 'phrase');
  assert.equal(r.queries[0].searchText, 'payments api');
});
