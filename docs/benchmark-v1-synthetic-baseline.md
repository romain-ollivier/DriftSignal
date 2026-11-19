# Benchmark V1 — First synthetic B0/B1 baseline

**Recorded:** 2026-11-19  
**Source:** local PowerShell run supplied by the project owner after pulling commit `e6290e1`.  
**Commands:** `npm test`, `npm run build`, `npm run benchmark:synthetic`.  
**Status:** 84/84 tests passed; Vite build passed; synthetic benchmark completed.

## Dataset and method

- Six invented Jira cases `BMK-101`…`BMK-106`, 15 invented Confluence pages, two mock personas (`engineer`, `limited`), and 90 annotations frozen before model tuning.
- A naive substring search mock is substituted for real Confluence CQL. Permission checks are mocked. **This does not measure real production recall, relevance precision, authorization enforcement, latency, or API costs.**
- Numbers below are **retrieved / selected / usable among annotated relevant accessible pages**. The denominator excludes restricted pages for that persona.
- A value of 0 CQL calls can be a deliberate abstention or an extraction failure; interpret alongside ticket signals and gold labels.
- Neither B0 nor B1 retrieval performs contextual relevance classification or evaluates incompatibility. In particular, a rollback-only v1 reference remains relevant to discovery and is not automatically a drift.

## First baseline (synthetic, no real Atlassian calls)

| Case | Persona | B0 CQL / relevant retrieved-selected-usable | B1 CQL / relevant retrieved-selected-usable | Observation |
| --- | --- | --- | --- | --- |
| BMK-101 structured | engineer | 1 / 3-3-3 of 3 | 3 / 3-3-3 of 3 | Both variants find all annotated relevant pages |
| BMK-101 structured | limited | 1 / 3-3-3 of 3 | 3 / 3-3-3 of 3 | Same simulated accessible set |
| BMK-102 narrative | engineer | 0 / 0-0-0 of 2 | 0 / 0-0-0 of 2 | **Profiler miss**: old path and host appear in prose but not the required field-line format |
| BMK-102 narrative | limited | 0 / 0-0-0 of 2 | 0 / 0-0-0 of 2 | Same synthetic miss |
| BMK-103 indirect | engineer | 0 / 0-0-0 of 2 | 1 / 1-1-1 of 2 | B1 finds catalog context through a Jira component; does not traverse to referenced runbook |
| BMK-103 indirect | limited | 0 / 0-0-0 of 2 | 1 / 1-1-1 of 2 | Same synthetic gap |
| BMK-104 no signals | engineer | 0 / 0-0-0 of 0 | 0 / 0-0-0 of 0 | Correct abstention, not a search success |
| BMK-104 no signals | limited | 0 / 0-0-0 of 0 | 0 / 0-0-0 of 0 | Correct abstention |
| BMK-105 health/rollback | engineer | 1 / 2-2-2 of 2 | 1 / 2-2-2 of 2 | Only discovery tested; no proof of appropriate qualification |
| BMK-105 health/rollback | limited | 1 / 2-2-2 of 2 | 1 / 2-2-2 of 2 | Same |
| BMK-106 access | engineer | 1 / 4-4-4 of 4 | 4 / 4-4-4 of 4 | Authorized engineer sees all four relevant pages in mock |
| BMK-106 access | limited | 1 / 3-3-3 of 3 | 4 / 3-3-3 of 3 | Restricted page excluded from limited-persona gold and simulated results |

## Candidate improvements (do NOT change frozen baseline yet)

1. **Natural-language signal extraction:** benchmark a bounded deterministic regex expansion against an optional structured LLM extractor; compare provenance, unsupported guesses, latency, and improvement on BMK-102. The paths are literally present in Jira; there is no reason to infer missing endpoints.
2. **Indirect documentary reference:** the context page BMK-103 names the runbook in plain text, but has **no actual Confluence hyperlink**. Test a bounded follow-on title lookup separately from true hyperlink traversal. Do not claim that this frozen case validates link graph navigation; a future versioned case would need an explicit link.
3. **Real tenant validation:** measure CQL punctuation/tokenization, actual executed requests, first-page pagination/stop reasons, same-corpus access rights, and repeated run times. Record both successful and failed searches and reads. Do not publish real tenant page IDs or private gold labels.

## Suggested next decision gate

Before tuning either improvement, reproduce the first two miss families on the **real demonstration tenant** with pre-annotated gold, and compare B0 and B1 at the same persona, same 10-read budget, and recorded actual API costs. If an extractor gap survives, prototype extraction. If the runbook is identifiable only via the service catalog, distinguish a title-based follow-on search from a real link traversal before choosing the next experiment.

**Boundaries:** This report records a single synthetic run, not an independent holdout. All synthetic labels are public and may be inspected by contributors. Do not interpret these results as a validated Codegeist performance claim.
