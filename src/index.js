import ResolverModule from '@forge/resolver';
import api, { route } from '@forge/api';
import { scanDrift } from './scan.mjs';
import { requireOk } from './http.mjs';
import { validPageId } from './core.mjs';
import { runB0Diagnostic } from './discovery/b0-diagnostic.mjs';
import { toPublicB0Report } from './discovery/public-report.mjs';
import { validIssueKey } from './core.mjs';
import { profileJiraChange } from './discovery/change-profiler.mjs';
import { planDiscoveryQueries } from './discovery/query-planner.mjs';
import { runB1Retrieval } from './discovery/retrieval-b1.mjs';
import { toPublicB1Retrieval } from './discovery/public-retrieval-b1.mjs';
import { cqlFromIntent, normalizeCqlResponse, resolveDirectPage } from './discovery/confluence-cql.mjs';
import { LIVE_BENCHMARK, isBenchmarkIssueKey, scopedBenchmarkCql } from './benchmark/live-scope.mjs';
import { toPublicLiveBenchmark } from './benchmark/public-live-report.mjs';
import { evidenceFromReadablePage, toPublicInvestigation } from './investigation/public-investigation.mjs';
import { authorizeReviewSource } from './investigation/authorize-review-source.mjs';
import { createPrivateReviewJournal } from './investigation/review-journal.mjs';
import { privateReviewStorage } from './investigation/forge-kvs-storage.mjs';

const Resolver = ResolverModule.default ?? ResolverModule;
const resolver = new Resolver();


const gateway = {
  async readIssue(key) {
    const response = await api.asUser().requestJira(
      route`/rest/api/3/issue/${key}?fields=summary,description,status,components,updated`,
      { headers: { Accept: 'application/json' } },
    );
    return requireOk(response, 'Jira');
  },
  async searchPages(token, options = {}) {
    const baseCql = `type=page AND text ~ "${token}"`;
    const cql = options.scoped === true ? scopedBenchmarkCql(baseCql) : baseCql;
    const response = await api.asUser().requestConfluence(
      route`/wiki/rest/api/search?cql=${cql}&limit=20`,
      { headers: { Accept: 'application/json' } },
    );
    const data = await requireOk(response, 'Confluence Search');
    let origin = '';
    try {
      const base = new URL(data?._links?.base);
      if (base.protocol === 'https:' && base.hostname.endsWith('.atlassian.net')) origin = base.origin;
    } catch { /* source links remain optional */ }
    return (data.results ?? []).map((item) => ({
      id: String(item.content?.id ?? item.id ?? ''),
      title: item.content?.title ?? item.title ?? '',
      url: origin && validPageId(item.content?.id ?? item.id)
        ? `${origin}/wiki/pages/viewpage.action?pageId=${encodeURIComponent(item.content?.id ?? item.id)}`
        : null,
    }));
  },
  async readPage(id) {
    const response = await api.asUser().requestConfluence(
      route`/wiki/api/v2/pages/${id}?body-format=storage`,
      { headers: { Accept: 'application/json' } },
    );
    return requireOk(response, 'Confluence Page');
  },
};

/**
 * Forge-only adapter: Confluence operations run as the invoking user.
 * Every resolver invocation creates its own verified-tenant scope.
 */
function createB1Gateway({ scoped = false } = {}) {
  let verifiedOrigin = null;
  return {
    async searchConfluence(intent, { limit }) {
      const baseCql = cqlFromIntent(intent);
      const cql = scoped ? scopedBenchmarkCql(baseCql) : baseCql;
      const response = await api.asUser().requestConfluence(
        route`/wiki/rest/api/search?cql=${cql}&limit=${limit}`,
        { headers: { Accept: 'application/json' } },
      );
      const parsed = normalizeCqlResponse(await requireOk(response, 'B1 Confluence Search'), limit);
      if (verifiedOrigin && verifiedOrigin !== parsed.siteId) {
        throw new Error('Confluence tenant changed during search.');
      }
      verifiedOrigin = parsed.siteId;
      return parsed;
    },
    async resolveDirectLink(url) {
      // If no CQL call established this tenant, decline the direct link.
      return resolveDirectPage(url, verifiedOrigin);
    },
    async readPage(id, siteId) {
      if (!verifiedOrigin || siteId !== verifiedOrigin || !validPageId(id)) {
        throw new Error('Unverified page origin.');
      }
      return gateway.readPage(id);
    },
  };
}
resolver.define('scan', async ({ payload }) => {
  try {
    return { ok: true, data: await scanDrift(payload?.issueKey, gateway) };
  } catch (error) {
    // Never return API tokens, error objects or document bodies to the browser.
    return { ok: false, message: error instanceof Error ? error.message : 'Unexpected error' };
  }
});

resolver.define('scanB0', async ({ payload }) => {
  try {
    const diagnostic = await runB0Diagnostic(payload?.issueKey, gateway);
    return { ok: true, data: toPublicB0Report(diagnostic) };
  } catch {
    // B0 diagnostics intentionally expose neither raw API errors nor
    // unfiltered search hits to the Custom UI.
    return { ok: false, message: 'B0 discovery diagnostic failed.' };
  }
});

resolver.define('scanB1', async ({ payload }) => {
  try {
    if (!validIssueKey(payload?.issueKey)) throw new Error('Invalid issue key.');
    const issue = await gateway.readIssue(payload.issueKey);
    const profile = profileJiraChange(issue);
    const plan = planDiscoveryQueries(profile, { maxCqlQueries: 4, maxDirectLinks: 5 });
    const retrieval = await runB1Retrieval(plan, createB1Gateway(), {
      maxCqlCalls: 4,
      readBudget: 10,
      searchLimit: 20,
    });
    return {
      ok: true,
      data: {
        ...toPublicB1Retrieval(retrieval),
        inputQuality: profile.dataQuality.level,
        planStatus: plan.status,
        plannedSearches: plan.queries.length,
      },
    };
  } catch {
    // Never expose raw search errors, candidate hits or document bodies.
    return { ok: false, message: 'B1 discovery diagnostic failed.' };
  }
});

// Read-only investigation path. The B1 engine, planner and retrieval module
// are unchanged; this is a distinct, user-authorized presentation of evidence.
// The frozen DSBENCH tickets remain server-scoped to the benchmark corpus.
resolver.define('startInvestigation', async ({ payload }) => {
  try {
    if (!validIssueKey(payload?.issueKey)) throw new Error('Invalid issue key.');
    const issue = await gateway.readIssue(payload.issueKey);
    const profile = profileJiraChange(issue);
    const scoped = isBenchmarkIssueKey(payload.issueKey);
    const plan = planDiscoveryQueries(profile, {
      maxCqlQueries: scoped ? LIVE_BENCHMARK.maxCqlCalls : 4,
      maxDirectLinks: scoped ? 0 : 5,
    });
    const authorizedPageEvidence = new Map();
    const readGateway = createB1Gateway({ scoped });
    const retrieval = await runB1Retrieval(plan, {
      ...readGateway,
      async readPage(pageId, siteId) {
        // Explicitly asUser and same verified site as the unchanged B1 gateway.
        const page = await readGateway.readPage(pageId, siteId);
        const excerpt = evidenceFromReadablePage(page, profile);
        if (excerpt) authorizedPageEvidence.set(String(pageId), excerpt);
        return page;
      },
    }, {
      maxCqlCalls: scoped ? LIVE_BENCHMARK.maxCqlCalls : 4,
      readBudget: scoped ? LIVE_BENCHMARK.readBudget : 10,
      searchLimit: scoped ? LIVE_BENCHMARK.searchLimit : 20,
    });
    return {
      ok: true,
      data: toPublicInvestigation({
        profile, plan, retrieval, authorizedPageEvidence, scoped,
      }),
    };
  } catch {
    // Never reveal unread or unauthorized page identities through errors.
    return { ok: false, message: 'Read-only investigation could not be completed.' };
  }
});

// Private, append-only human review. Actor is trusted resolver accountId.
// Source versions are freshly read asUser; the browser cannot attest them.
const reviewJournal = createPrivateReviewJournal(privateReviewStorage);

async function currentAuthorizedReviewSource(issueKey, pageId) {
  return authorizeReviewSource({
    issueKey, pageId,
    readIssue: key => gateway.readIssue(key),
    readPage: id => gateway.readPage(id),
    async readAncestors(id) {
      const response = await api.asUser().requestConfluence(
        route`/wiki/api/v2/pages/${id}/ancestors?limit=100`,
        { headers: { Accept: 'application/json' } },
      );
      const data = await requireOk(response, 'Confluence ancestors');
      return { results: data.results, next: data?._links?.next || data?.next || null };
    },
  });
}
function authenticatedReviewActor(context) {
  if (typeof context?.accountId !== 'string' || !context.accountId.trim() ||
      context.accountType === 'anonymous') {
    throw new Error('An authenticated Atlassian user is required.');
  }
  return context.accountId;
}
resolver.define('getPrivateReview', async ({ payload, context }) => {
  try {
    const actorId = authenticatedReviewActor(context);
    const source = await currentAuthorizedReviewSource(payload?.issueKey, payload?.pageId);
    const review = await reviewJournal.read({ actorId, source });
    return { ok: true, data: review };
  } catch {
    return { ok: false, message: 'Private review unavailable. Check current Jira/Confluence access.' };
  }
});
resolver.define('beginPrivateReview', async ({ payload, context }) => {
  try {
    const actorId = authenticatedReviewActor(context);
    const source = await currentAuthorizedReviewSource(payload?.issueKey, payload?.pageId);
    const review = await reviewJournal.begin({ actorId, source, now: new Date().toISOString() });
    return { ok: true, data: review };
  } catch {
    return { ok: false, message: 'Could not start private review. Check access or existing review.' };
  }
});
resolver.define('decidePrivateReview', async ({ payload, context }) => {
  try {
    const actorId = authenticatedReviewActor(context);
    const source = await currentAuthorizedReviewSource(payload?.issueKey, payload?.pageId);
    const review = await reviewJournal.decide({
      actorId, source, now: new Date().toISOString(),
      expectedRevision: payload?.expectedRevision,
      decision: payload?.decision, reason: payload?.reason,
    });
    return { ok: true, data: review };
  } catch {
    return { ok: false, message: 'Review not saved. Source may have changed, or another decision won. Reload.' };
  }
});

// Benchmark-only, explicit evaluation mode. Never alter the original M1, B0
// or B1 resolver semantics. Only six frozen DSBENCH synthetic issues qualify.
// The scope is fixed on the server (never derived from browser input).
resolver.define('scanBenchmarkB0', async ({ payload }) => {
  try {
    if (!isBenchmarkIssueKey(payload?.issueKey)) throw new Error('Not a benchmark case.');
    const runStarted = performance.now();
    let searchElapsedMs = null;
    const diagnostic = await runB0Diagnostic(payload.issueKey, {
      ...gateway,
      async searchPages(token) {
        const started = performance.now();
        try {
          return await gateway.searchPages(token, { scoped: true });
        } finally {
          searchElapsedMs = Math.max(0, performance.now() - started);
        }
      },
    }, { readBudget: LIVE_BENCHMARK.readBudget });
    return {
      ok: true,
      data: toPublicLiveBenchmark(toPublicB0Report(diagnostic), diagnostic, {
        b0SearchElapsedMs: searchElapsedMs,
        elapsedMs: Math.max(0, performance.now() - runStarted),
      }),
    };
  } catch {
    return { ok: false, message: 'Scoped B0 benchmark failed.' };
  }
});

resolver.define('scanBenchmarkB1', async ({ payload }) => {
  try {
    if (!isBenchmarkIssueKey(payload?.issueKey)) throw new Error('Not a benchmark case.');
    const runStarted = performance.now();
    const issue = await gateway.readIssue(payload.issueKey);
    const profile = profileJiraChange(issue);
    // For this synthetic corpus no Jira issue contains a Confluence link.
    // Disallow unverified links in benchmark-only scope until their ancestry
    // can be verified; otherwise a link could escape the fixed corpus.
    const plan = planDiscoveryQueries(profile, {
      maxCqlQueries: LIVE_BENCHMARK.maxCqlCalls,
      maxDirectLinks: 0,
    });
    const retrieval = await runB1Retrieval(plan, createB1Gateway({ scoped: true }), {
      maxCqlCalls: LIVE_BENCHMARK.maxCqlCalls,
      readBudget: LIVE_BENCHMARK.readBudget,
      searchLimit: LIVE_BENCHMARK.searchLimit,
    });
    return {
      ok: true,
      data: toPublicLiveBenchmark(toPublicB1Retrieval(retrieval), retrieval, {
        plannedSearches: plan.queries.length,
        inputQuality: profile.dataQuality.level,
        planStatus: plan.status,
        elapsedMs: Math.max(0, performance.now() - runStarted),
      }),
    };
  } catch {
    return { ok: false, message: 'Scoped B1 benchmark failed.' };
  }
});

export const handler = resolver.getDefinitions();

