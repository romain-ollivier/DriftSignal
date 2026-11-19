import React, { useState } from 'react';
import { invoke } from '@forge/bridge';

const CHOICES = [
  { value: 'NEEDS_EVIDENCE', label: 'More evidence needed' },
  { value: 'DISMISSED_BY_REVIEWER', label: 'Dismiss this candidate' },
  { value: 'CONFIRMED_BY_REVIEWER', label: 'Confirm for investigation' },
];

/**
 * Private review actions only. No close/recheck/fix attestation is accepted
 * from the client. Backend re-reads Jira and Confluence asUser every time.
 */
export default function PrivateReviewControls({
  issueKey, pageId, pageVersion, jiraUpdated, onAccessUnverified,
}) {
  const [review, setReview] = useState(null);
  const [loaded, setLoaded] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [choice, setChoice] = useState('NEEDS_EVIDENCE');
  const [reason, setReason] = useState('');

  async function invokeReview(resolver, extra = {}) {
    if (busy) return;
    setBusy(true); setError('');
    try {
      const viewed = {
        issueKey, pageId, pageVersion, jiraUpdated,
      };
      // Only write operations need a displayed-source precondition. A read
      // reauthorizes both resources but may return a stale historical review.
      const isWrite = resolver === 'beginPrivateReview' || resolver === 'decidePrivateReview';
      const response = await invoke(resolver, {
        issueKey, pageId, ...(isWrite ? { viewed } : {}), ...extra,
      });
      if (!response?.ok) throw new Error(response?.message || 'Private review unavailable.');
      setReview(response.data ?? null);
      setLoaded(true);
      setReason('');
    } catch (cause) {
      // An authorization error, stale version or storage failure must not
      // leave reviewer notes or Confluence quotes visible in this open tab.
      setReview(null);
      setLoaded(false);
      setReason('');
      setError(cause instanceof Error ? cause.message : 'Private review unavailable.');
      onAccessUnverified?.();
    } finally {
      setBusy(false);
    }
  }

  if (!Number.isSafeInteger(pageVersion) || pageVersion < 1 || !jiraUpdated) {
    return <p className="note">Review unavailable: the Confluence page version was not returned.</p>;
  }
  return <div className="privateReview">
    <div className="sourceHead">
      <strong>My private review</strong>
      <span className="tag">HUMAN-ONLY</span>
    </div>
    <p className="note">Your review history is private to your Atlassian account. Every operation rechecks your current source access. No source edit or automatic closure is performed.</p>
    {!loaded && <button type="button" className="secondary" disabled={busy}
      onClick={() => invokeReview('getPrivateReview')}>
      {busy ? 'Checking access…' : 'Load my review'}
    </button>}
    {loaded && !review && <button type="button" className="secondary" disabled={busy}
      onClick={() => invokeReview('beginPrivateReview')}>
      {busy ? 'Creating…' : 'Start private review'}
    </button>}
    {review && <>
      <p className="note">State: <strong>{review.state.replaceAll('_', ' ')}</strong> · Revision {review.revision} · Source page v{review.pageVersion}</p>
      {review.stale && <p className="message danger">Jira or Confluence source changed. This historical review is read-only; re-investigate before any further decision.</p>}
      {review.history?.length > 0 && <details className="reviewHistory">
        <summary>Review history ({review.history.length} entries)</summary>
        <ol>{review.history.map(item => <li key={item.sequence}>
          <strong>{item.state.replaceAll('_',' ')}</strong> · {item.at}
          <p className="note">{item.reason}</p>
        </li>)}</ol>
      </details>}
      {review.canDecide && <>
        <label className="reviewLabel" htmlFor={'review-choice-' + pageId}>Your decision</label>
        <select id={'review-choice-' + pageId} value={choice}
          onChange={event => setChoice(event.target.value)} disabled={busy}>
          {CHOICES.map(item => <option value={item.value} key={item.value}>{item.label}</option>)}
        </select>
        <label className="reviewLabel" htmlFor={'review-note-' + pageId}>Reason (required)</label>
        <textarea id={'review-note-' + pageId} rows={3} value={reason} maxLength={600}
          disabled={busy} placeholder="Explain your judgment and what remains to verify."
          onChange={event => setReason(event.target.value)}/>
        <button type="button" className="secondary"
          disabled={busy || reason.trim().length < (choice === 'CONFIRMED_BY_REVIEWER' ? 12 : 1)}
          onClick={() => invokeReview('decidePrivateReview', {
            expectedRevision: review.revision, decision: choice, reason: reason.trim(),
          })}>{busy ? 'Saving…' : 'Save my decision'}</button>
      </>}
      {review.state === 'CONFIRMED_BY_REVIEWER' && <p className="note">
        This is a human assessment, not a verified compatibility result. Verified rechecks and resolution are not implemented yet.
      </p>}
      <button type="button" className="secondary" disabled={busy}
        onClick={() => invokeReview('getPrivateReview')}>Reload</button>
    </>}
    {error && <p className="message danger" role="alert">{error}</p>}
  </div>;
}
