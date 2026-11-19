/**
 * SYNTHETIC ONLY — developer CLI.
 *
 * This uses a naive substring mock, NOT Atlassian's CQL tokenizer,
 * and simulated access rules, NOT real Atlassian authorization.
 * The synthetic gold labels are never passed to B0/B1.
 */
import { readFileSync } from 'node:fs';
import { runB0Diagnostic } from '../src/discovery/b0-diagnostic.mjs';
import { profileJiraChange } from '../src/discovery/change-profiler.mjs';
import { planDiscoveryQueries } from '../src/discovery/query-planner.mjs';
import { runB1Retrieval } from '../src/discovery/retrieval-b1.mjs';
import { evaluateDiscoveryStages } from '../src/benchmark/evaluate-stages.mjs';

const corpus = JSON.parse(readFileSync(
  new URL('../fixtures/benchmark-v1/corpus.synthetic.json', import.meta.url), 'utf8',
));

function mockGateway(scenario, persona) {
  const accessible = corpus.documents.filter((doc) => doc.accessibleTo.includes(persona));
  const find = (term) => accessible
    .filter((doc) => (doc.title + '\n' + doc.body).toLowerCase().includes(String(term).toLowerCase()));
  const read = async (id) => {
    const document = accessible.find((doc) => doc.pageId === String(id));
    if (!document) throw new Error('Access denied or unavailable.');
    return { id: document.pageId, title: document.title,
      body: { storage: { value: document.body } } };
  };
  return {
    readIssue: async () => scenario.issue,
    searchPages: async (token) => find(token).slice(0, 20)
      .map((doc) => ({ id: doc.pageId, title: doc.title })),
    searchConfluence: async (intent, { limit }) => {
      const matching = find(intent.searchText);
      return {
        siteId: corpus.siteId,
        results: matching.slice(0, limit).map((doc) => ({
          id: doc.pageId,
          title: doc.title,
        })),
        hasMore: matching.length > limit,
      };
    },
    readPage: async (id) => read(id),
    resolveDirectLink: async () => null,
  };
}

console.log('DriftSignal benchmark V1 — SYNTHETIC MOCK ONLY (not real CQL or real permissions)');
console.log('Gold: ' + corpus.scenarios.length + ' tickets, ' + corpus.documents.length +
  ' pages, 2 personas, pre-annotated before engine tuning.\n');
console.log('Case      Persona    Variant  CQL calls  Relevant retrieved/selected/usable  Limit or loss');
console.log('-'.repeat(108));
for (const scenario of corpus.scenarios) {
  for (const persona of corpus.personas) {
    for (const variant of ['B0', 'B1_RETRIEVAL']) {
      const gateway = mockGateway(scenario, persona);
      const report = variant === 'B0'
        ? await runB0Diagnostic(scenario.issue.key, gateway, { readBudget: 10 })
        : await runB1Retrieval(
          planDiscoveryQueries(profileJiraChange(scenario.issue), {
            maxCqlQueries: 4,
          }),
          gateway,
          { readBudget: 10, maxCqlCalls: 4, searchLimit: 20 },
        );
      const assessed = evaluateDiscoveryStages({ corpus, scenario, persona, report });
      const counts = [assessed.retrievedRelevant, assessed.selectedRelevant, assessed.usableRelevant]
        .join('/');
      const primaryLosses = [...new Set(assessed.rows
        .map((row) => row.lossOrStatus)
        .filter((status) => status !== 'NOT_YET_ASSESSED'))];
      const reason = primaryLosses.join(', ') ||
        assessed.stopReasons.filter((reason) => reason === 'NO_SEARCH_PERFORMED').join(', ') || '—';
      console.log([
        scenario.id.padEnd(9),
        persona.padEnd(10),
        variant.padEnd(8),
        String(assessed.actualCqlRequests).padEnd(10),
        (counts + ' / ' + assessed.expectedAccessibleRelevant).padEnd(36),
        reason,
      ].join(' '));
    }
  }
}
console.log('\nCounts refer only to *annotated relevant accessible* pages.');
console.log('Relevance and instruction incompatibility are NOT assessed by B0/B1 retrieval.');
console.log('Do not use simulated hit rates or timings as real Atlassian performance claims.');
