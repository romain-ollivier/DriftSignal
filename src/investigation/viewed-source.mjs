/**
 * A displayed-source snapshot is a browser-supplied PRECONDITION, not an
 * authorization claim. The server must first re-read both sources asUser and
 * compare the actual canonical Jira / Confluence versions before any write.
 */
export function assertViewedSource(current, viewed) {
  if (!viewed || typeof viewed !== 'object' || !current ||
      typeof viewed.issueKey !== 'string' ||
      typeof viewed.pageId !== 'string' ||
      !Number.isSafeInteger(viewed.pageVersion) ||
      viewed.pageVersion < 1 ||
      typeof viewed.jiraUpdated !== 'string' ||
      !viewed.jiraUpdated.trim()) {
    throw new Error('Displayed source version is missing; run investigation again.');
  }
  if (viewed.issueKey !== current.issueKey ||
      viewed.pageId !== String(current.pageId) ||
      viewed.pageVersion !== current.pageVersion ||
      viewed.jiraUpdated !== current.jiraUpdated) {
    throw new Error('Viewed Jira/Confluence source is stale; re-investigate before writing a decision.');
  }
}
