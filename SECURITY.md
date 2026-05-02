# Security Policy

VibeSwap is a financial protocol. We take security seriously and welcome responsible disclosure of vulnerabilities. This document is the canonical entry point for reporting.

> *No extraction ever. If the system is unfair, amend the code.*

---

## Reporting a Vulnerability

**Please do not file public GitHub issues for security vulnerabilities.** Public reports leak the bug to attackers before maintainers can patch.

Use one of the following private channels:

1. **GitHub private security advisory** (preferred): open a draft advisory at <https://github.com/wglynn/vibeswap/security/advisories/new>. Only repository maintainers can see it. We can collaborate on the fix in the same thread.
2. **Email**: send an encrypted or plain-text report to **security@vibeswap.io** with subject line beginning `[SECURITY]`. Include a PGP key in your first message if you want a key exchange before sending sensitive details.

We aim to acknowledge receipt within **48 hours** and to provide an initial triage assessment within **5 business days**.

When reporting, please include — as much as you can:

- Affected component(s) — contract path, frontend route, oracle module, etc.
- Affected commit hash or tag
- A clear description of the vulnerability and its impact
- Reproduction steps or a minimal proof-of-concept (Foundry test, script, transaction trace)
- Your assessment of severity and exploitability
- Any suggested mitigations
- How you would like to be credited (or whether you prefer to remain anonymous)

---

## Scope

### In scope

- Smart contracts under `contracts/` deployed (or intended for deployment) to mainnet, testnet, or staging
- Deployment scripts under `script/` that affect production deployments
- The Python oracle (`oracle/`) where it produces values consumed on-chain
- Cross-chain messaging code paths under `contracts/messaging/` (LayerZero V2 OApps)
- Any cryptographic primitive in `contracts/libraries/` (commit-reveal, deterministic shuffle, Shapley distribution, batch math, TWAP)
- Frontend (`frontend/`) issues that result in user funds at risk, key/seed exposure, signed-message confusion, or persistent XSS

### Out of scope

- Theoretical mechanism-design critique without a concrete on-chain or off-chain attack — this belongs as a research issue / discussion, not a security report
- Test contracts, mock contracts, fixtures, archived material under `docs/_archive/`, scratch under `.session-chain/`, and anything inside `cache/`, `out/`, `out-*/`, `node_modules/`
- Spam / rate-limit / volumetric DoS against the marketing site or hosted demos
- Vulnerabilities in third-party dependencies that have not yet been pulled into a release tag (please report upstream first; CC us if it affects us)
- Issues requiring physical access to a user's device or full compromise of the user's machine
- Social-engineering attacks against contributors

If you're unsure whether something is in scope, **report it**. We would rather triage and decline than miss a real bug.

---

## Severity & Bounty Terms

Severity is assessed on a 4-tier scale aligned with the [Immunefi vulnerability classification](https://immunefi.com/severity-classification/):

| Severity | Definition (smart contracts) |
|---|---|
| **Critical** | Direct theft of user funds, permanent freezing of funds, protocol insolvency, governance takeover |
| **High** | Theft / freezing of unclaimed yield or rewards, temporary freezing of funds (>1h), griefing that imposes meaningful cost on third parties |
| **Medium** | Smart contract fails under non-malicious unexpected conditions, theft of gas, bypass of operational safeguards |
| **Low** | Functional bugs without direct fund impact, minor griefing |

**Bounty status (as of this writing): pre-launch.** The protocol has not yet deployed to mainnet, so there is no live bounty pool. Once live, a formal bounty program will be published and linked here.

VibeSwap's design intent is to maintain a **white-hat economy** — a Lindy-scaled bounty pool funded from the same insurance / treasury pipelines that protect users. The architecture for this is being drafted in [`docs/_meta/protocols/`](docs/_meta/protocols/) and [`docs/audits/`](docs/audits/). When the program goes live this section will be updated with concrete numbers.

In the meantime, for reporters who find issues during the pre-launch phase: we will work with you on appropriate recognition (hall-of-fame, public credit, retroactive bounty when the program launches) — please mention your preferences in your report.

---

## Disclosure Timeline

We follow a **coordinated disclosure** model with a default 90-day window:

1. **Day 0** — report received, acknowledgement sent within 48 hours
2. **Day 0–5** — initial triage and severity assessment
3. **Day 5–60** — patch development, testing, internal review, audit (if material)
4. **Day 60–90** — staged rollout, upgrade, monitoring
5. **Day 90** — public disclosure (CVE / advisory), researcher credited (if desired)

Critical vulnerabilities affecting deployed funds may be expedited; we may also request a longer embargo when the fix requires coordinated migration across chains. We will always discuss timeline changes with the reporter.

If you do not hear back within 5 business days, please re-send via the second channel above (GitHub advisory or email). Acknowledgement delays are a problem to fix on our end, not a signal to publish early.

---

## Hall of Fame

Researchers who have responsibly disclosed issues:

*(empty — be the first.)*

We will list name (or handle), affected version, severity, and one-line summary, with the reporter's consent.

---

## Related Material

- [`docs/audits/`](docs/audits/) — audit reports, money-path audits, dissolution audits, security posture
- [`docs/_meta/protocols/ANTI_AMNESIA_PROTOCOL.md`](docs/_meta/protocols/ANTI_AMNESIA_PROTOCOL.md) — internal protocol governing how disclosed issues are tracked across sessions and never lost
- [`docs/_meta/protocols/ANTI_HALLUCINATION_PROTOCOL.md`](docs/_meta/protocols/ANTI_HALLUCINATION_PROTOCOL.md) — verification discipline applied to security claims
- [`SECURITY_AUDIT.md`](SECURITY_AUDIT.md) — historical bug-fix log (pre-formal-audit). Will be migrated under `docs/audits/` over time.
- [`docs/architecture/`](docs/architecture/) — system design context for understanding scope of a vulnerability

---

## Versioning

This document is versioned with the repository. The canonical copy is whatever is at `master` of <https://github.com/wglynn/vibeswap>. Forks and mirrors should be considered out of date.
