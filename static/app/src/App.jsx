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
  const [b1Data, setB1Data] = useState(null);
  const [b1Busy, setB1Busy] = useState(false);
  const [b1Error, setB1Error] = useState('');
  const [benchData, setBenchData] = useState(null);
  const [benchBusy, setBenchBusy] = useState(false);
  const [benchError, setBenchError] = useState('');
  const isBenchmarkTicket = /^DSBENCH-[1-6]$/.test(issueKey);
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

  async function runB1() {
    if (!issueKey) return;
    setB1Busy(true);
    setB1Data(null);
    setB1Error('');
    try {
      const response = await invoke('scanB1', { issueKey });
      if (!response?.ok) throw new Error(response?.message || 'Could not run B1.');
      setB1Data(response.data);
    } catch (err) {
      setB1Error(err instanceof Error ? err.message : 'B1 diagnostic failed.');
    } finally {
      setB1Busy(false);
    }
  }

  async function runScopedBenchmark(variant) {
    if (!isBenchmarkTicket || benchBusy) return;
    setBenchBusy(true); setBenchError(''); setBenchData(null);
    try {
      const method = variant === 'B0' ? 'scanBenchmarkB0' : 'scanBenchmarkB1';
      const response = await invoke(method, { issueKey });
      if (!response?.ok) throw new Error(response?.message || 'Benchmark failed.');
      setBenchData(response.data);
    } catch (err) {
      setBenchError(err instanceof Error ? err.message : 'Benchmark failed.');
    } finally {
      setBenchBusy(false);
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
      <button className="secondary" disabled={!issueKey || b0Busy || b1Busy || busy} onClick={runB0}>{b0Busy ? 'Running B0…' : 'Run B0 discovery diagnostic'}</button>
      <button className="secondary" disabled={!issueKey || b0Busy || b1Busy || busy} onClick={runB1}>{b1Busy ? 'Running B1…' : 'Run B1 multi-signal retrieval'}</button>
      {isBenchmarkTicket && <div className="finding">
        <strong>Benchmark V1 · Controlled corpus</strong>
        <p className="note">Same DSBMK descendant corpus, 10 maximum body reads each. Old unscoped B0/B1 controls above remain unchanged. The mode is retrieval-only, not a relevance benchmark.</p>
        <button className="secondary" disabled={benchBusy || busy || b0Busy || b1Busy} onClick={() => runScopedBenchmark('B0')}>{benchBusy ? 'Running benchmark…' : 'Benchmark · scoped B0'}</button>
        <button className="secondary" disabled={benchBusy || busy || b0Busy || b1Busy} onClick={() => runScopedBenchmark('B1')}>{benchBusy ? 'Running benchmark…' : 'Benchmark · scoped B1'}</button>
      </div>}
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
    {b1Error && <div className="message danger">{b1Error}</div>}
    {b1Data && <section className="sourceCard">
      <div className="sourceHead"><strong>B1 · Multi-signal retrieval</strong><Status value={b1Data.status}/></div>
      <p><strong>Jira input:</strong> {b1Data.inputQuality} · <strong>Planned CQL queries:</strong> {b1Data.plannedSearches}</p>
      <p><strong>Readable documents:</strong> {b1Data.coverage.usableDocuments} · <strong>Elapsed:</strong> {Math.round(b1Data.elapsedMs ?? 0)} ms</p>
      <p><strong>Outcome:</strong> {b1Data.planStatus === 'INSUFFICIENT_SEARCH_SIGNALS' ? 'Insufficient search signals' : b1Data.result?.replaceAll('_', ' ')}</p>
      {b1Data.documents?.map((doc) => <div className="finding" key={doc.pageId}>
        <div className="sourceHead"><strong>{doc.title || 'Confluence page'}</strong><Status value="FETCHED_ONLY" /></div>
        <p className="note">Discovered through: {doc.sourceFamilies?.join(', ') || 'Not specified'}</p>
        {doc.url && <button className="secondary" onClick={() => router.open(doc.url)}>Open source in Confluence ↗</button>}
      </div>)}
      {b1Data.coverage.searchIncomplete && <p className="note">Search coverage is incomplete: more results, skipped queries or search failures may exist.</p>}
      {b1Data.coverage.readBudgetTruncated && <p className="note">Some discovered pages were not selected under the read budget.</p>}
      {b1Data.coverage.someReadsFailed && <p className="note">Some selected pages were inaccessible or had no usable body.</p>}
      <p className="note">{b1Data.note} This run is not yet an equal-budget B0/B1 relevance benchmark.</p>
    </section>}
    {benchError && <div className="message danger">{benchError}</div>}
    {benchData && <section className="sourceCard">
      <div className="sourceHead"><strong>{benchData.variant === 'B0' ? 'Controlled benchmark · B0' : 'Controlled benchmark · B1'}</strong><Status value={benchData.status}/></div>
      <p><strong>Corpus:</strong> DSBMK · Revision {benchData.benchmark.corpusRevision} · <strong>Read cap:</strong> {benchData.benchmark.readBudget} pages</p>
      <p><strong>CQL queries:</strong> {benchData.benchmark.plannedSearches} planned · {benchData.benchmark.searchesAttempted} attempted · {benchData.benchmark.searchesSucceeded} successful · {benchData.benchmark.searchesFailed} failed</p>
      <p><strong>Usable, authorized pages:</strong> {benchData.benchmark.usableDocuments} · <strong>End-to-end elapsed:</strong> {Math.round(benchData.benchmark.elapsedMs ?? 0)} ms</p>
      {benchData.benchmark.queryExecutions.map((query, index) => <p className="note" key={index}>CQL {index + 1}: {query.family} · {query.outcome} · {query.elapsedMs == null ? 'duration unavailable' : Math.round(query.elapsedMs) + ' ms'}</p>)}
      {benchData.documents?.map((doc) => <div className="finding" key={doc.pageId}>
        <div className="sourceHead"><strong>{doc.title || 'Confluence page'}</strong><Status value="FETCHED_ONLY"/></div>
        {doc.sourceFamilies && <p className="note">Retrieval routes: {doc.sourceFamilies.join(', ')}</p>}
        {doc.url && <button className="secondary" onClick={() => router.open(doc.url)}>Open in Confluence ↗</button>}
      </div>)}
      {benchData.planStatus === 'INSUFFICIENT_SEARCH_SIGNALS' && <p className="note">Input lacks discriminating search signals; no retrieval performed.</p>}
      <p className="note">{benchData.note} This diagnostic has a common read cap, not a common total API-call budget. Hidden and unread search hits are not shown.</p>
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
