import ResolverModule from '@forge/resolver';
import api, { route } from '@forge/api';
import { scanDrift } from './scan.mjs';
import { requireOk } from './http.mjs';
import { validPageId } from './core.mjs';
import { runB0Diagnostic } from './discovery/b0-diagnostic.mjs';
import { toPublicB0Report } from './discovery/public-report.mjs';

const Resolver = ResolverModule.default ?? ResolverModule;
const resolver = new Resolver();


const gateway = {
  async readIssue(key) {
    const response = await api.asUser().requestJira(
      route`/rest/api/3/issue/${key}?fields=summary,description,status`,
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

export const handler = resolver.getDefinitions();

