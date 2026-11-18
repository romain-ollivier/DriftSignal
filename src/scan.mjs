import { adfToText, htmlToPlainText, parseChange, parseRunbook, compareClaims, searchToken, validIssueKey, validPageId } from './core.mjs';

/**
 * Orchestrator deliberately uses injected gateway operations so it can be tested
 * offline with fixtures and later extended with JSM Assets/Bitbucket.
 */
export async function scanDrift(issueKey, gateway) {
  if (!validIssueKey(issueKey)) throw new Error('Clé Jira invalide. Exemple : PAY-101.');
  const issue = await gateway.readIssue(issueKey);
  const changeText = typeof issue.fields?.description === 'string'
    ? issue.fields.description : adfToText(issue.fields?.description);
  const change = parseChange(changeText);

  const result = {
    issueKey: issue.key || issueKey,
    issueTitle: issue.fields?.summary ?? '',
    change,
    outcome: 'READY',
    inspected: 0,
    related: 0,
    findings: [],
    searchedFor: null,
    note: 'Le ticket Jira est une source déclarative ; aucun état de production n’est vérifié par ce POC.',
  };
  if (!change.structured) {
    result.outcome = 'NEEDS_STRUCTURED_CHANGE';
    return result;
  }
  const token = searchToken(change.serviceId);
  if (!token) {
    result.outcome = 'INVALID_SERVICE_TOKEN';
    return result;
  }
  result.searchedFor = token;
  const pages = await gateway.searchPages(token);
  // Search is fuzzy; restrict to <=15 results and verify exact Service ID from page body.
  const uniquePages = [...new Map(
    (Array.isArray(pages) ? pages : []).filter((p) => validPageId(p.id)).map((p) => [String(p.id), p]),
  ).values()].slice(0, 15);
  for (const candidate of uniquePages) {
    const page = await gateway.readPage(String(candidate.id));
    result.inspected += 1;
    const body = page?.body?.storage?.value ?? '';
    const runbook = parseRunbook(htmlToPlainText(body));
    const comparison = compareClaims(change, runbook);
    if (comparison.status === 'NOT_RELATED') continue;
    result.related += 1;
    result.findings.push({
      pageId: String(candidate.id),
      title: page.title || candidate.title || 'Untitled',
      url: candidate.url ?? null,
      status: comparison.status,
      reason: comparison.reason ?? null,
      oldEndpoint: runbook.endpoint,
      jiraEndpoint: change.endpoint,
      documentationEvidence: runbook.endpointEvidence,
      jiraEvidence: change.endpointEvidence,
      serviceEvidence: runbook.serviceEvidence,
    });
  }
  if (result.findings.some((f) => f.status === 'SOURCE_CONFLICT')) result.outcome = 'SOURCE_CONFLICT';
  else if (result.findings.some((f) => f.status === 'REVIEW_REQUIRED')) result.outcome = 'REVIEW_REQUIRED';
  else if (result.related === 0) result.outcome = 'NO_RELATED_DOCS';
  else result.outcome = 'IN_SYNC';
  return result;
}
