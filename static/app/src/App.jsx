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
  const [b0Data, setB0Data] = useState(null);
  const [b0Busy, setB0Busy] = useState(false);
  const [b0Error, setB0Error] = useState('');
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

  async function runB0() {
    if (!issueKey) return;
    setB0Busy(true);
    setB0Data(null);
    setB0Error('');
    try {
      const response = await invoke('scanB0', { issueKey });
      if (!response?.ok) throw new Error(response?.message || 'Could not run B0.');
      setB0Data(response.data);
    } catch (err) {
      setB0Error(err instanceof Error ? err.message : 'B0 diagnostic failed.');
    } finally {
      setB0Busy(false);
    }
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
      <p className="note">Discovery benchmark: compare the historical single-token Confluence search separately from the M1 scan.</p>
      <button className="secondary" disabled={!issueKey || b0Busy || busy} onClick={runB0}>{b0Busy ? 'Running B0…' : 'Run B0 discovery diagnostic'}</button>
      {!issueKey && !contextLoading && <p className="note">Open a Jira issue and select Apps → DriftSignal. This Confluence screen is informational.</p>}
    </section>
    {error && <div className="message danger">{error}</div>}
    {!data && !error && <section className="placeholder"><span className="pulse">◎</span><h2>Ready to check for drift</h2><p>Run the scan to compare the issue against indexed Confluence pages.</p></section>}
    {b0Error && <div className="message danger">{b0Error}</div>}
    {b0Data && <section className="sourceCard">
      <div className="sourceHead"><strong>B0 · Discovery diagnostic</strong><Status value={b0Data.status}/></div>
      <p><strong>Actual Confluence query term:</strong> <code>{b0Data.queryTerm || 'Not executed'}</code></p>
      <p><strong>Pages successfully read:</strong> {b0Data.coverage.fetchedPages} · <strong>Elapsed:</strong> {Math.round(b0Data.elapsedMs ?? 0)} ms</p>
      <p><strong>Result:</strong> {b0Data.decision?.replaceAll('_', ' ')}</p>
      {b0Data.documents?.map((doc) => <div className="finding" key={doc.pageId}>
        <div className="sourceHead"><strong>{doc.title}</strong><Status value={doc.legacyComparison}/></div>
        <div className="detail"><span>Jira evidence</span><code>{doc.jiraEvidence ?? 'No explicit endpoint evidence'}</code></div>
        <div className="detail"><span>Confluence evidence</span><code>{doc.confluenceEvidence ?? 'No explicit endpoint evidence'}</code></div>
        {doc.url && <button className="secondary" onClick={() => router.open(doc.url)}>Open source in Confluence ↗</button>}
      </div>)}
      {b0Data.coverage.readBudgetTruncated && <p className="note">Read budget reached: some search hits were not inspected.</p>}
      {b0Data.coverage.failedOrSkippedReads && <p className="note">Some source reads could not be completed. Results are partial.</p>}
      {b0Data.coverage.searchFailed && <p className="note">Confluence search failed. No coverage claim can be made.</p>}
      <p className="note">{b0Data.note}</p>
    </section>}
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
