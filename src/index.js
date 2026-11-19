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
  async searchPages(token) {
    const cql = `type=page AND text ~ "${token}"`;
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
function createB1Gateway() {
  let verifiedOrigin = null;
  return {
    async searchConfluence(intent, { limit }) {
      const cql = cqlFromIntent(intent);
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

export const handler = resolver.getDefinitions();

