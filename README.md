# DriftSignal

**Keep operational documentation aligned with technical changes.**

DriftSignal is an Atlassian Forge application that detects differences between Jira technical changes and Confluence operational runbooks.

## Project status

- M1: Atlassian Integration - Completed
- Forge development deployment: v2.6.0
- Automated tests: 20 passing
- M2: Sources, Context & Traceability - In progress

## Architecture

- Atlassian Forge with Node.js 22 runtime
- React and Vite Custom UI in Jira
- Forge resolver with Jira and Confluence REST APIs
- Deterministic comparison: src/core.mjs
- Scan orchestration: src/scan.mjs
- HTTP handling: src/http.mjs
- Automated tests: Node.js test runner

## Current capabilities

1. Read a Jira issue and extract structured Service and Endpoint declarations.
2. Search and read Confluence runbooks.
3. Normalize ADF and Confluence Storage HTML.
4. Compare explicit endpoint declarations and show supporting evidence.
5. Open source documents directly from the Jira panel.

## Local development

Use Node.js 22 or 24 for Forge CLI compatibility.

```powershell
npm.cmd install
npm.cmd --prefix static/app install
npm.cmd test
npm.cmd run build
npm.cmd run demo
```

## Forge deployment

The existing application is already registered. Do not run forge register again.

```powershell
forge.cmd lint
forge.cmd deploy -e development
```

## Verified demonstration

- Jira: CLSD-6
- Confluence page: 4194305
- Service: payment-gateway
- Jira endpoint: /api/v2/payments
- Runbook endpoint: /api/v1/payments
- Result: SOURCE_CONFLICT
- Evidence link verified in Jira.

## Known limitations

- Source matching currently relies on limited Confluence text search.
- Only explicitly structured Service and Endpoint values are compared.
- No AI qualification or persistent investigation workflow yet.
- HTTP errors are tested with mocked responses.
- Multi-user permissions and second-site installation remain unverified.
- Different documented values do not prove actual production incompatibility.
- The application is read-only.

## Roadmap

- M1: Atlassian Integration - Complete
- M2: Sources, Context & Traceability
- M3: Evaluated AI Qualification
- M4: Investigation & Resolution
- M5: Change Radar & Product UX
- M6: Stabilization & Codegeist Submission

## Safety

Jira changes are treated as declarations, not verified production facts. Findings require evidence and may require human review.
