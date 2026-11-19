import test from 'node:test';
import assert from 'node:assert/strict';
import { evidenceFromReadablePage, toPublicInvestigation } from '../src/investigation/public-investigation.mjs';
import { profileJiraChange } from '../src/discovery/change-profiler.mjs';

const issue = {
  key: 'DSBENCH-6',
  fields: {
    summary: 'Settlement migration',
    description: 'Service: settlement-gateway\nOld endpoint: /settlement/v1/route\nNew endpoint: /settlement/v2/route\nDeployment status: Deployed to production',
    updated: '2026-11-19T02:00:00Z',
  },
};
const profile = profileJiraChange(issue);

function retrieval(candidates) {
  return {
    variant: 'B1_RETRIEVAL', issueKey: 'DSBENCH-6',
    execution: { status: 'PARTIAL' },
    requests: [{ outcome: 'ok' }],
    candidates,
    coverage: {
      queriesWithMoreResults: 0, queriesNotExecuted: 0,
      readBudgetTruncated: false, failedReads: 1, unusableBodies: 0,
    },
    elapsedMs: 350,
  };
}

test('Authorized Confluence source excerpt is literal, bounded and versioned', () => {
  const page = {
    version: { number: 7 },
    body: { storage: { value:
      '<p>Service: settlement-gateway</p><p>Normal recovery uses /settlement/v1/route.</p>' } },
  };
  const source = evidenceFromReadablePage(page, profile);
  assert.equal(source.pageVersion, 7);
  assert.equal(source.quoteType, 'literal_endpoint_mention');
  assert.equal(source.quote, 'Normal recovery uses /settlement/v1/route.');
  assert.ok(source.quote.length <= 260);
  assert.equal(source.incompatible, undefined);
});

test('Without a matching endpoint, a preview is marked non-evaluative', () => {
  const page = { body: { storage: { value: '<h2>Service overview</h2><p>Overview only.</p>' } } };
  const source = evidenceFromReadablePage(page, profile);
  assert.equal(source.pageVersion, null);
  assert.equal(source.quoteType, 'page_preview_only');
  assert.equal(source.quote, 'Service overview');
});

test('No evidence from missing or empty body', () => {
  assert.equal(evidenceFromReadablePage({}, profile), null);
  assert.equal(evidenceFromReadablePage({ body: { storage: { value: '' } } }, profile), null);
});

test('Never leak failed, unread or unselected candidate IDs, URLs or titles', () => {
  const raw = retrieval([
    {
      pageId: '9990001', title: 'Restricted - SECRET OPERATIONS', url: 'https://x.atlassian.net/wiki/SECRET999',
      paths: [{ kind: 'cql', families: ['endpoint_old'] }], readStatus: 'failed', bodyStatus: 'not_attempted',
    },
    {
      pageId: '9990002', title: 'Unread hidden discovery', url: 'https://x.atlassian.net/wiki/UNREAD999',
      paths: [{ kind: 'cql', families: ['domain_old'] }], readStatus: 'not_attempted', bodyStatus: 'not_attempted',
    },
    {
      pageId: '9990003', title: 'Authorized source', url: 'https://x.atlassian.net/wiki/pages/viewpage.action?pageId=9990003',
      paths: [{ kind: 'cql', families: ['service_identity'] }], readStatus: 'fetched', bodyStatus: 'usable',
    },
  ]);
  const authorized = new Map([
    ['9990001', { quote: 'SECRET OPERATIONS', pageVersion: 3 }],
    ['9990003', { quote: 'Service: settlement-gateway', quoteType: 'page_preview_only', pageVersion: 2 }],
  ]);
  const result = toPublicInvestigation({
    profile, plan: { status: 'READY' }, retrieval: raw,
    authorizedPageEvidence: authorized, scoped: true,
  });
  assert.equal(result.documents.length, 1);
  assert.equal(result.documents[0].pageId, '9990003');
  assert.equal(result.documents[0].reviewStatus, 'NOT_ASSESSED');
  assert.equal(result.documents[0].contentEvidence.pageVersion, 2);
  assert.equal(result.scope, 'CONTROLLED_DSBMK_CORPUS');
  const serialized = JSON.stringify(result);
  for (const secret of ['9990001', '9990002', 'SECRET', 'UNREAD999', 'Restricted - SECRET', 'rawHits']) {
    assert.equal(serialized.includes(secret), false, secret);
  }
  assert.equal(serialized.includes('incompatibleInstruction'), false);
  assert.equal(serialized.includes('RESOLVED_VERIFIED'), false);
});

test('Jira source quotations without literal value do not masquerade as evidence', () => {
  const longQuote = {
    issueKey: 'X-1',
    sourceUpdated: '2026-11-19T02:00:00Z',
    signals: [
      { family: 'endpoint', role: 'old', rawValue: '/very-long/path/v1', normalizedValue: '/very-long/path/v1',
        source: { field: 'description', path: 'description.content[3]', quote: 'Old endpoint info truncated...' } },
    ],
    dataQuality: { level: 'sufficient' },
  };
  const response = toPublicInvestigation({
    profile: longQuote, plan: { status: 'READY' },
    retrieval: { ...retrieval([]), issueKey: 'X-1', execution: { status: 'COMPLETE_WITHIN_BUDGET' } },
    authorizedPageEvidence: new Map(), scoped: false,
  });
  assert.equal(response.jiraEvidence[0].quote, null);
  assert.equal(response.jiraEvidence[0].path, 'description.content[3]');
  assert.equal(response.jiraUpdated, '2026-11-19T02:00:00Z');
});

test('Literal Confluence excerpt does not parse HTML tags or scripts as evidence', () => {
  const page = {
    body: { storage: { value:
      '<script>hidden-secret()</script><p>Old endpoint: /settlement/v1/route</p><div>Other material</div>' } },
  };
  const excerpt = evidenceFromReadablePage(page, profile);
  assert.equal(excerpt.quote, 'Old endpoint: /settlement/v1/route');
  assert.equal(excerpt.quote.includes('hidden-secret'), false);
});


test('Read-only investigation shows the literal Not deployed statement, not the legacy mistaken deployed value', () => {
  const negated = profileJiraChange({
    key: 'CASE-1',
    fields: {
      summary: 'Future migration',
      description: 'Service: freight-core\nDeployment status: Not deployed',
    },
  });
  // Keep the test correct regardless of whether the isolated PR #3 fix
  // has been merged: this panel displays the literal Jira declaration.
  const view = toPublicInvestigation({
    profile: negated,
    plan: { status: 'READY' },
    retrieval: { ...retrieval([]), issueKey: 'CASE-1' },
    authorizedPageEvidence: new Map(), scoped: false,
  });
  const deployment = view.jiraEvidence.find(s => s.family === 'deployment_state');
  assert.equal(deployment.value, 'Not deployed');
  assert.equal(deployment.quote, 'Deployment status: Not deployed');
});
