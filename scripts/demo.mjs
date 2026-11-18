/** Offline end-to-end demonstrator with mocked Atlassian API responses. */
import { readFileSync } from 'node:fs';
import { scanDrift } from '../src/scan.mjs';
const issue = JSON.parse(readFileSync(new URL('../fixtures/jira-issue.json', import.meta.url)));
const page = JSON.parse(readFileSync(new URL('../fixtures/confluence-page.json', import.meta.url)));
const gateway = {
  async readIssue() { return issue; },
  async searchPages() { return [{ id: page.id, title: page.title }]; },
  async readPage() { return page; },
};
const result = await scanDrift('PAY-101', gateway);
console.log(JSON.stringify({ issueKey: result.issueKey, outcome: result.outcome, inspected: result.inspected, findings: result.findings }, null, 2));
