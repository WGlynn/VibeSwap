# Audits

> Security audit reports, money-path audits, exploit analyses.

## What lives here

Auditor-grade artifacts. Findings, exploit walkthroughs, money-path traces, security-posture summaries. Each report carries a date in the filename or front-matter; older audits remain for trail-of-evidence. For the *system design* being audited, cross-reference [`../architecture/`](../architecture/); for the formal proofs that some defenses rely on, [`../research/proofs/`](../research/proofs/).

## Highlights

| Document | What it covers |
|---|---|
| [SEVEN_AUDIT_PASSES.md](SEVEN_AUDIT_PASSES.md) | Seven-pass audit methodology and findings |
| [MONEY_PATH_AUDIT.md](MONEY_PATH_AUDIT.md) | End-to-end money-path trace |
| [FRONTEND_HOT_ZONE.md](FRONTEND_HOT_ZONE.md) | Frontend hot-zone audit |
| [dissolution-audit-2026-03-21.md](dissolution-audit-2026-03-21.md) | Dissolution-path audit, March 2026 |
| [2026-04-27-maintenance-synthesis.md](2026-04-27-maintenance-synthesis.md) | Maintenance synthesis — 4-PR roadmap from audit-agent triad |
| [2026-05-01-storage-layout-followup.md](2026-05-01-storage-layout-followup.md) | Storage-layout follow-up |
| [security-posture/protocol-wide-security-posture.md](security-posture/protocol-wide-security-posture.md) | Whole-protocol security-posture summary |
| [security-posture/exploit-analysis-2026-03-17.md](security-posture/exploit-analysis-2026-03-17.md) | Exploit analysis, March 2026 |
| [security-posture/emission-controller-security-audit.md](security-posture/emission-controller-security-audit.md) | Emission-controller-specific audit |

## Subfolders

- `security-posture/` — protocol-wide posture, exploit analyses, subsystem audits

## When NOT to look here

- Design documents being audited → [`../architecture/`](../architecture/)
- Formal proofs supporting a defense → [`../research/proofs/`](../research/proofs/)
- Per-mechanism security primitives (Clawback, Siren, Fibonacci scaling) → [`../concepts/security/`](../concepts/security/)
- Incident reports (post-deploy ops) → [`../_meta/incident-reports/`](../_meta/incident-reports/)

Top-level entry: [`../README.md`](../README.md). Encyclopedia: [`../INDEX.md`](../INDEX.md).
