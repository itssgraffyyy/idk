# Rule register
| Identifier | Version | Status | Source and behavior |
|---|---|---|---|
| policy_unverified | unverified-1 | Active safety gate | No verified AICTE policy loaded; unresolved, human review required |
| amount_shortfall | facts-v1 | Factual consistency | Compares declaration to institution-registered obligation; not an AICTE minimum |
| date_order / expired | facts-v1 | Factual checks | Declared ISO dates; not a claim about renewal/release law |
| duplicate_reference | facts-v1 | Review indicator | Accessible cases in same tenant; not proof of fraud |
| synthetic-1 | Test-only | Verified only within fictional tests | Fictional amount/exemption checks; scope cannot match AICTE |

Policy module supports version/effective-date selection, source and review-reference gates, whitelisted minimum/exemption operators, missing-data handling and unsupported-rule rejection. No UI can upload or activate executable rules. Production policy onboarding needs reviewed official source snapshots, applicability facts, effective dates, amendments and institutional proof.

Research lead: https://www.aicte.gov.in/sites/default/files/APH%20Final.pdf was surfaced for the 2024–2027 handbook, but returned 404 when opened on 26 October 2026. Search snippets are insufficient to activate financial rules. No amounts, exemptions, terms, penalty/release conditions have been promoted to live rules. Historical regulatory assumptions remain unconfirmed.

The synthetic exemption fixtures do not establish eligibility for any real exemption. Missing verified policy is an explicit Phase 2 acceptance gap.
