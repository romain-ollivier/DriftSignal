import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { evaluateDiscoveryStages } from '../src/benchmark/evaluate-stages.mjs';

const corpus = JSON.parse(readFileSync(
  new URL('../fixtures/benchmark-v1/corpus.synthetic.json', import.meta.url), 'utf8',
));
const scenario = (id) => corpus.scenarios.find((value) => value.id === id);

function b1(candidates = [], overrides = {}) {
  return {
    variant: 'B1_RETRIEVAL',
    issueKey: 'BMK-101',
    candidates,
    requests: [{ queryId: 'q1', outcome: 'ok' }],
    coverage: {
      cqlCallsAttempted: 1,
      directLinksAttempted: 0,
      failedReads: 0,
      unusableBodies: 0,
      readBudgetTruncated: false,
    },
    execution: { status: 'COMPLETE_WITHIN_BUDGET' },
    ...overrides,
  };
}

test('Benchmark V1 has 6 cases, 15 pages, 2 personas and 90 explicit gold annotations', () => {
  assert.equal(corpus.type, 'fully_synthetic');
  assert.equal(corpus.documents.length, 15);
  assert.equal(corpus.scenarios.length, 6);
  assert.deepEqual(corpus.personas, ['engineer', 'limited']);
  assert.equal(corpus.scenarios.reduce((sum, s) => sum + s.annotations.length, 0), 90);
  for (const entry of corpus.scenarios) {
    const report = evaluateDiscoveryStages({ corpus, scenario: entry, persona: 'engineer', report: b1() });
    assert.equal(report.visibility, 'DEVELOPER_ONLY_GOLD_ANNOTATIONS');
    assert.equal(report.expectedAccessibleRelevant,
      entry.annotations.filter((annotation) => annotation.relevance === 'relevant').length);
  }
});

test('Benchmark separates search miss from selection miss and unassessed relevance', () => {
  const report = evaluateDiscoveryStages({
    corpus, scenario: scenario('BMK-101'), persona: 'engineer',
    report: b1([
      { pageId: '10001', selectionRank: null, readStatus: 'not_attempted', bodyStatus: 'not_attempted' },
      { pageId: '10002', selectionRank: 1, readStatus: 'fetched', bodyStatus: 'usable' },
    ], { coverage: { cqlCallsAttempted: 1, readBudgetTruncated: true } }),
  });
  const byId = Object.fromEntries(report.rows.map((row) => [row.pageId, row]));
  assert.equal(byId['10001'].lossOrStatus, 'READ_BUDGET_OR_RANKING');
  assert.equal(byId['10002'].lossOrStatus, 'NOT_YET_ASSESSED');
  assert.equal(byId['10003'].lossOrStatus, 'NOT_IN_OBSERVED_HITS');
  assert.equal(report.usableRelevant, 1);
  assert.equal(report.relevanceAssessedRelevant, 0);
  assert.ok(report.stopReasons.includes('READ_BUDGET_TRUNCATED'));
  assert.equal(report.totalRequests, null);
});

test('Rollback-only document is relevant but has NO incompatible instruction', () => {
  const gold = scenario('BMK-101').annotations.find((annotation) => annotation.pageId === '10002');
  assert.equal(gold.relevance, 'relevant');
  assert.equal(gold.role, 'procedure_to_review');
  assert.equal(gold.incompatibleInstruction, 'no');
});

test('BMK-102 does not infer endpoint retirement from traffic migration wording', () => {
  assert.equal(corpus.corpusRevision, '1.2');
  const gold = scenario('BMK-102').annotations.find((annotation) => annotation.pageId === '10006');
  assert.equal(gold.relevance, 'relevant');
  assert.equal(gold.role, 'procedure_to_review');
  assert.equal(gold.incompatibleInstruction, 'unknown');
});

test('A deployed V2 does not by itself prove that V1 is retired or incompatible', () => {
  const expected = [
    ['BMK-101', '10001'],
    ['BMK-106', '10006'],
    ['BMK-106', '10014'],
  ];
  for (const [scenarioId, pageId] of expected) {
    const gold = scenario(scenarioId).annotations.find((entry) => entry.pageId === pageId);
    assert.equal(gold.relevance, 'relevant', scenarioId + ':' + pageId);
    assert.equal(gold.role, 'procedure_to_review', scenarioId + ':' + pageId);
    assert.equal(gold.incompatibleInstruction, 'unknown', scenarioId + ':' + pageId);
  }
});

test('Gold revision 1.2 changes incompatibility labels only and records an audit trail', () => {
  const changes = corpus.annotationChangeLog.filter((change) => change.revision === '1.2');
  assert.equal(changes.length, 3);
  for (const change of changes) {
    assert.equal(change.field, 'incompatibleInstruction');
    assert.equal(change.from, 'yes');
    assert.equal(change.to, 'unknown');
    assert.ok(change.reason.includes('v1') || change.reason.includes('V1'));
    const matching = scenario(change.scenario).annotations.find((entry) => entry.pageId === change.pageId);
    assert.equal(matching.incompatibleInstruction, 'unknown');
  }
});

test('A relevance rejection is distinguished from an instruction incompatibility', () => {
  const report = evaluateDiscoveryStages({
    corpus, scenario: scenario('BMK-101'), persona: 'engineer',
    report: b1([{ pageId: '10002', selectionRank: 1, readStatus: 'fetched', bodyStatus: 'usable' }]),
    relevanceDecisions: { '10002': 'not_relevant' },
  });
  const row = report.rows.find((entry) => entry.pageId === '10002');
  assert.equal(row.lossOrStatus, 'RELEVANCE_REJECTED');
  assert.equal(row.expectedIncompatibility, 'no');
  assert.equal(report.relevanceAssessedRelevant, 1);
});

test('Limited persona does not receive restricted expected page identities', () => {
  const report = evaluateDiscoveryStages({
    corpus, scenario: scenario('BMK-106'), persona: 'limited',
    report: b1(),
  });
  assert.equal(report.restrictedRelevantOmitted, 1);
  assert.equal(report.rows.some((row) => row.pageId === '10014'), false);
  assert.equal(JSON.stringify(report).includes('Settlement Emergency Failover Procedure'), false);
});

test('A failed read without page identity is not falsely classified as a search miss', () => {
  const report = evaluateDiscoveryStages({
    corpus, scenario: scenario('BMK-101'), persona: 'engineer',
    report: b1([], { coverage: { cqlCallsAttempted: 1, failedReads: 1 }, execution: { status: 'PARTIAL' } }),
  });
  assert.ok(report.rows.every((row) => row.lossOrStatus === 'NOT_OBSERVED_OR_READ_FAILURE_UNATTRIBUTABLE'));
  assert.ok(report.stopReasons.includes('READ_ERRORS'));
});

test('A search failure keeps missing results indeterminate', () => {
  const report = evaluateDiscoveryStages({
    corpus, scenario: scenario('BMK-101'), persona: 'engineer',
    report: b1([], { requests: [{ queryId: 'q1', outcome: 'failed' }], execution: { status: 'PARTIAL' } }),
  });
  assert.ok(report.rows.every((row) => row.lossOrStatus === 'NOT_OBSERVED_SEARCH_PARTIAL'));
});

test('Unstructured input with no discriminating signals permits abstention', () => {
  const report = evaluateDiscoveryStages({
    corpus, scenario: scenario('BMK-104'), persona: 'engineer',
    report: b1([], { requests: [], coverage: { cqlCallsAttempted: 0, directLinksAttempted: 0 } }),
  });
  assert.equal(report.expectedAccessibleRelevant, 0);
  assert.deepEqual(report.rows, []);
  assert.ok(report.stopReasons.includes('NO_SEARCH_PERFORMED'));
});

test('Legacy B0 classification does not count as independent relevance assessment', () => {
  const report = evaluateDiscoveryStages({
    corpus, scenario: scenario('BMK-101'), persona: 'engineer',
    report: {
      variant: 'B0',
      trace: [{
        pageId: '10001', selectedForRead: true,
        fetchStatus: 'fetched', parseStatus: 'parsed', legacyComparison: 'SOURCE_CONFLICT',
      }],
      coverage: { searchStatus: 'ok', failedReads: 0 },
      execution: { status: 'COMPLETE_WITHIN_BUDGET' },
    },
  });
  const row = report.rows.find((item) => item.pageId === '10001');
  assert.equal(row.usableBody, true);
  assert.equal(row.retainedAsRelevant, null);
  assert.equal(report.relevanceAssessedRelevant, 0);
  assert.ok(report.stopReasons.includes('B0_FIRST_CQL_PAGE_ONLY'));
});

test('Evaluator rejects incomplete or contradictory gold annotations', () => {
  const original = scenario('BMK-101');
  const missing = { ...original, annotations: original.annotations.slice(1) };
  assert.throws(() => evaluateDiscoveryStages({
    corpus, scenario: missing, persona: 'engineer', report: b1(),
  }), /Every page/);
  const contradictory = structuredClone(original);
  contradictory.annotations[0].relevance = 'not_relevant';
  contradictory.annotations[0].role = 'context';
  assert.throws(() => evaluateDiscoveryStages({
    corpus, scenario: contradictory, persona: 'engineer', report: b1(),
  }), /disagree/);
});
