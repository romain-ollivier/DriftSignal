import React, { useEffect, useRef, useState } from 'react';
import { invoke, router } from '@forge/bridge';
import PrivateReviewControls from './PrivateReviewControls.jsx';

/**
 * MVP 1: read-only investigation; does not save decisions, classify drift,
 * or change Confluence. All returned documents were fetched as the user.
 */
export default function InvestigationPanel({ issueKey }) {
  const [report, setReport] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [focusedPage, setFocusedPage] = useState(null);
  const requestVersion = useRef(0);

  useEffect(() => {
    requestVersion.current += 1;
    setBusy(false);
    setReport(null);
    setFocusedPage(null);
    setError('');
  }, [issueKey]);

  async function investigate() {
    if (!issueKey || busy) return;
    const currentRequest = ++requestVersion.current;
    setBusy(true);
    setReport(null);
    setFocusedPage(null);
    setError('');
    try {
      const response = await invoke('startInvestigation', { issueKey });
      if (currentRequest !== requestVersion.current) return;
      if (!response?.ok) throw new Error(response?.message || 'Investigation failed.');
      setReport(response.data);
    } catch (reason) {
      if (currentRequest === requestVersion.current) {
        setError(reason instanceof Error ? reason.message : 'Investigation failed.');
      }
    } finally {
      if (currentRequest === requestVersion.current) setBusy(false);
    }
  }

  // Any failed fresh source verification invalidates the entire rendered
  // investigation, including the parent Confluence quote and document title.
  // A user must run a new asUser investigation before further decisions.
  function invalidateSourceEvidence() {
    requestVersion.current += 1;
    setReport(null);
    setFocusedPage(null);
    setError('Source access or version could not be verified. Run investigation again.');
  }

  return <section className="sourceCard investigation">
    <div className="sourceHead">
      <strong>Investigate documentation</strong>
      <span className="tag warning">READ-ONLY · PREVIEW</span>
    </div>
    <p>Explore the Jira technical declarations and the Confluence pages that B1 can read as you. Discovery is not proof of a contradiction.</p>
    <button onClick={investigate} disabled={!issueKey || busy}>
      {busy ? 'Gathering authorized evidence…' : 'Start investigation →'}
    </button>
    {error && <div className="message danger" role="alert">{error}</div>}
    {report && <>
      <div className="investigationMeta">
        <span>Engine: <b>B1</b></span>
        <span>Jira updated: <b>{report.jiraUpdated ?? 'not supplied'}</b></span>
        <span>Documents readable: <b>{report.documents.length}</b></span>
      </div>
      <p className="note">
        {report.scope === 'CONTROLLED_DSBMK_CORPUS'
          ? 'Controlled DSBMK descendant scope (benchmark issue); this is not an unscoped discovery claim.'
          : 'Standard search with the invoking user permissions.'}
      </p>
      {report.planStatus === 'INSUFFICIENT_SEARCH_SIGNALS' &&
        <p className="note">No discriminating Jira discovery signals were extracted. No search was initiated.</p>}
      <h3 className="investigationHeading">1. Jira declarations</h3>
      <p className="note">Jira is a declaration, not verified infrastructure state. A V2 deployment alone does not prove V1 retirement.</p>
      {report.jiraEvidence.length === 0
        ? <p className="note">No technical signal extracted from the Jira issue.</p>
        : report.jiraEvidence.map((signal, i) =>
          <div className="investigationSignal" key={i}>
            <span className="tag">{signal.family} · {signal.role}</span>
            <code>{signal.value}</code>
            <div className="note">Jira source: {signal.field} · {signal.path}</div>
            {signal.quote
              ? <blockquote className="investigationQuote">{signal.quote}</blockquote>
              : <p className="note">Source excerpt not available or does not contain the exact extracted value. Verify the Jira ticket.</p>}
          </div>)}

      <h3 className="investigationHeading">2. Confluence candidate documents</h3>
      {report.documents.length === 0 && <p className="note">No authorized readable documents returned. This does not establish absence of relevant documentation.</p>}
      <div className="investigationDocuments">
        {report.documents.map((doc) =>
          <div className="investigationDoc" key={doc.pageId}>
            <div className="sourceHead">
              <strong>{doc.title || 'Readable Confluence page'}</strong>
              <span className="tag">NOT ASSESSED</span>
            </div>
            <p className="note">Discovery routes: {doc.sourceFamilies?.join(', ') || 'unspecified'}</p>
            <div className="investigationActions">
              <button type="button" className="secondary"
                onClick={() => setFocusedPage(id => id === doc.pageId ? null : doc.pageId)}>
                {focusedPage === doc.pageId ? 'Hide source excerpt' : 'Inspect source excerpt'}
              </button>
              {doc.url && <button type="button" className="secondary"
                onClick={() => router.open(doc.url)}>Open in Confluence ↗</button>}
            </div>
            {focusedPage === doc.pageId && <div className="investigationDetail">
              <p className="note">Page version: {doc.contentEvidence?.pageVersion ?? 'not supplied'} · {doc.contentEvidence?.quoteType === 'literal_endpoint_mention' ? 'Literal endpoint mention' : 'Page preview only'}</p>
              {doc.contentEvidence?.quote
                ? <blockquote className="investigationQuote">{doc.contentEvidence.quote}</blockquote>
                : <p className="note">No readable source excerpt available. Open the page to verify its instructions.</p>}
              <p className="note">An endpoint mention may be historical, conditional, rollback-only or active. Human interpretation is required.</p>
              <PrivateReviewControls key={issueKey + ':' + doc.pageId}
                issueKey={report.issueKey} pageId={doc.pageId}
                jiraUpdated={report.jiraUpdated}
                pageVersion={doc.contentEvidence?.pageVersion ?? null}
                onAccessUnverified={invalidateSourceEvidence} />
            </div>}
          </div>)}
      </div>
      {(report.coverage?.partial || report.coverage?.searchIncomplete ||
        report.coverage?.readBudgetTruncated || report.coverage?.someReadsFailed) &&
        <p className="note">Coverage is partial or uncertain. Missing documents cannot be declared safe, irrelevant, or resolved.</p>}
      <div className="investigationBoundary">
        <strong>3. Human review · not enabled yet</strong>
        <p className="note">This milestone does not store review decisions or permit closure. Editing and verified recheck require versioned Jira/Confluence evidence and will be implemented separately.</p>
      </div>
      <p className="note">{report.note}</p>
    </>}
  </section>;
}
