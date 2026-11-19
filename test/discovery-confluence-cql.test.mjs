import test from 'node:test';
import assert from 'node:assert/strict';
import {
  cqlFromIntent,
  trustedConfluenceOrigin,
  normalizeCqlResponse,
  resolveDirectPage,
} from '../src/discovery/confluence-cql.mjs';

const intent = (searchText, mode = 'path') =>
  ({ strategy: 'confluence_cql', searchText, mode });

test('B1 Forge adapter produces bounded CQL for endpoint searches', () => {
  assert.equal(cqlFromIntent(intent('/api/v1/payments')),
    'type=page AND text ~ "/api/v1/payments"');
  assert.equal(cqlFromIntent(intent('payments api', 'phrase')),
    'type=page AND text ~ "payments api"');
});

test('B1 Forge adapter rejects CQL injection and unsupported intentions', () => {
  assert.throws(() => cqlFromIntent(intent('payment" OR type=blogpost')), /Unsupported/);
  assert.throws(() => cqlFromIntent(intent('payment\nAND type=blogpost')), /Unsupported/);
  assert.throws(() => cqlFromIntent({ ...intent('payment'), strategy: 'raw_cql' }), /Unsupported/);
  assert.throws(() => cqlFromIntent(intent('x'.repeat(129))), /Unsupported/);
});

test('B1 parses results and pagination of the Confluence REST CQL response', () => {
  const response = normalizeCqlResponse({
    _links: { base: 'https://demo.atlassian.net/wiki', next: '/wiki/rest/api/search?cursor=abc' },
    results: [
      { content: { id: '112', title: 'Runbook A' } },
      { content: { id: '113', title: 'Runbook B' } },
    ],
  }, 20);
  assert.equal(response.siteId, 'https://demo.atlassian.net');
  assert.deepEqual(response.results.map(({ id }) => id), ['112', '113']);
  assert.equal(response.results[0].url,
    'https://demo.atlassian.net/wiki/pages/viewpage.action?pageId=112');
  assert.equal(response.hasMore, true);
});

test('B1 records when Confluence paginated result limit is reached', () => {
  const response = normalizeCqlResponse({
    _links: { base: 'https://demo.atlassian.net/wiki' },
    start: 0,
    size: 1,
    totalSize: 5,
    results: [{ id: '500', title: 'Page' }],
  }, 20);
  assert.equal(response.hasMore, true);
});

test('B1 rejects untrusted origins and never trusts candidate result URLs', () => {
  assert.equal(trustedConfluenceOrigin('https://demo.atlassian.net.evil.com/wiki'), null);
  assert.equal(trustedConfluenceOrigin('http://demo.atlassian.net/wiki'), null);
  assert.throws(() => normalizeCqlResponse({
    _links: { base: 'https://demo.atlassian.net.evil.com/wiki' },
    results: [],
  }), /Invalid/);
  const result = normalizeCqlResponse({
    _links: { base: 'https://demo.atlassian.net/wiki' },
    results: [{ id: '123', title: 'Page', url: 'https://evil.example.com' }],
  });
  assert.equal(result.results[0].url.includes('evil.example.com'), false);
});

test('B1 extracts direct page IDs only from the verified same-tenant origin', () => {
  const origin = 'https://demo.atlassian.net';
  assert.deepEqual(
    resolveDirectPage('https://demo.atlassian.net/wiki/pages/viewpage.action?pageId=998', origin),
    { siteId: origin, pageId: '998', sameTenant: true },
  );
  assert.deepEqual(
    resolveDirectPage('https://demo.atlassian.net/wiki/spaces/OPS/pages/998/Recovery', origin),
    { siteId: origin, pageId: '998', sameTenant: true },
  );
  assert.equal(resolveDirectPage('https://other.atlassian.net/wiki/pages/998', origin), null);
  assert.equal(resolveDirectPage('https://demo.atlassian.net/wiki/spaces/OPS/blog/998', origin), null);
  assert.equal(resolveDirectPage('https://demo.atlassian.net/wiki/pages/viewpage.action?pageId=a', origin), null);
  assert.equal(resolveDirectPage('https://demo.atlassian.net.evil.net/wiki/pages/998', origin), null);
});
