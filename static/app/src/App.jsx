import React, { useEffect, useState } from 'react';
import { invoke, view, router } from '@forge/bridge';

const MESSAGES = {
  SOURCE_CONFLICT: ['Documentation discrepancy', 'At least one runbook conflicts with the change declared in Jira.', 'danger'],
  IN_SYNC: ['No explicit conflicts found', 'Matching runbook endpoints were found among inspected documents.', 'success'],
  NO_RELATED_DOCS: ['No linked runbook found', 'Confluence search did not return a page with the same explicit Service ID.', 'neutral'],
  REVIEW_REQUIRED: ['Review required', 'Some relevant documents contain ambiguous or missing endpoint information.', 'warning'],
  NEEDS_STRUCTURED_CHANGE: ['Ticket format incomplete', 'Add “Service: ...” and “New endpoint: /...” to the Jira description.', 'warning'],
  INVALID_SERVICE_TOKEN: ['Unsupported service ID', 'Use a descriptive Service ID with at least four alphanumeric characters.', 'warning'],
};

const Status = ({ value }) => {
  const tone = value === 'SOURCE_CONFLICT' ? 'danger' : value === 'IN_SYNC' ? 'success' : value === 'REVIEW_REQUIRED' ? 'warning' : 'neutral';
  return <span className={`tag ${tone}`}>{value.replaceAll('_', ' ')}</span>;
};

export default function App() {
  const [issueKey, setIssueKey] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [data, setData] = useState(null);
  const [contextLoading, setContextLoading] = useState(true);

  useEffect(() => {
    let active = true;
    view.getContext()
      .then((context) => {
        if (!active) return;
        setIssueKey(context?.extension?.issue?.key ?? '');
      })
      .catch(() => {})
      .finally(() => { if (active) setContextLoading(false); });
    return () => { active = false; };
  }, []);

  async function scan() {
    if (!issueKey) return;
    setBusy(true); setError(''); setData(null);
    try {
      const response = await invoke('scan', { issueKey });
      if (!response?.ok) throw new Error(response?.message || 'Could not run the scan.');
      setData(response.data);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Scan failed.');
    } finally { setBusy(false); }
  }

  return <main className="shell">
    <header className="topline"><div className="brand"><span className="logo">◈</span><span>DriftSignal</span></div><span className="prototype">TECHNICAL POC · V0.1</span></header>
    <section className="hero">
      <div className="eyebrow">OPERATIONAL DOCUMENTATION INTELLIGENCE</div>
      <h1>Detect documentation drift.<br/><em>Before it becomes an incident.</em></h1>
      <p>Compare a declared Jira API change with Confluence runbooks and review the underlying evidence.</p>
    </section>
    <section className="scanCard">
      <div className="label">JIRA CHANGE</div>
      <div className="scanRow">
        <div className="issue">{contextLoading ? 'Loading Jira context…' : (issueKey || 'Open DriftSignal from a Jira issue')}</div>
        <button disabled={!issueKey || busy} onClick={scan}>{busy ? 'Scanning…' : 'Scan documentation →'}</button>
      </div>
      {!issueKey && !contextLoading && <p className="note">Open a Jira issue and select Apps → DriftSignal. This Confluence screen is informational.</p>}
    </section>
    {error && <div className="message danger">{error}</div>}
    {!data && !error && <section className="placeholder"><span className="pulse">◎</span><h2>Ready to check for drift</h2><p>Run the scan to compare the issue against indexed Confluence pages.</p></section>}
    {data && <>
      <section className={`summary ${MESSAGES[data.outcome]?.[2] || 'neutral'}`}>
        <div className="eyebrow">SCAN RESULT · {data.issueKey}</div>
        <h2>{MESSAGES[data.outcome]?.[0] || data.outcome}</h2>
        <p>{MESSAGES[data.outcome]?.[1]}</p>
        <div className="stats"><span><b>{data.inspected}</b> pages inspected</span><span><b>{data.related}</b> service matches</span><span><b>{data.findings?.filter(f => f.status === 'SOURCE_CONFLICT').length ?? 0}</b> discrepancies</span></div>
      </section>
      {data.change?.structured && <section className="sourceCard">
        <div className="sourceHead"><strong>Jira source</strong><Status value="DECLARED_CHANGE" /></div>
        <p>{data.issueTitle}</p>
        <div className="mono">Service: {data.change.serviceId}</div>
        <div className="mono">{data.change.endpointEvidence}</div>
      </section>}
      {(data.findings || []).map(f => <section className="finding" key={f.pageId}>
        <div className="sourceHead"><strong>{f.title}</strong><Status value={f.status}/></div>
        <div className="detail"><span>Runbook</span><code>{f.documentationEvidence ?? 'No unambiguous endpoint declaration'}</code></div>
        <div className="detail"><span>Jira change</span><code>{f.jiraEvidence}</code></div>
        {f.reason && <p className="explainer">{f.reason}</p>}
        {f.url && <button className="secondary" onClick={() => router.open(f.url)}>Open evidence in Confluence ↗</button>}
        {!f.url && <span className="note">Confluence page ID: {f.pageId}</span>}
      </section>)}
      <footer className="disclaimer">{data.note} Only explicit Service / Endpoint lines are supported in this proof of concept. No pages are modified.</footer>
    </>}
  </main>;
}
