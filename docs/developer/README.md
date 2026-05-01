# Developer

> Build, test, deploy, integrate — runbooks and methodology.

## What lives here

Practical, executable documentation: how to install, what contracts exist, how to run the test suite, how to deploy, how to recover from disaster. If you have a keyboard and an intent to ship, start here. For *why* the system is built this way, see [`../architecture/`](../architecture/) and [`../research/`](../research/).

## Highlights

| Document | What it covers |
|---|---|
| [INSTALLATION.md](INSTALLATION.md) | Local setup — toolchain, dependencies, profile selection |
| [CONTRACTS_CATALOGUE.md](CONTRACTS_CATALOGUE.md) | Complete catalogue of deployed contracts and their roles |
| [runbooks/DEPLOYMENT_RUNBOOK.md](runbooks/DEPLOYMENT_RUNBOOK.md) | Step-by-step deploy procedure |
| [runbooks/DISASTER_RECOVERY.md](runbooks/DISASTER_RECOVERY.md) | Disaster-recovery playbook |
| [testing-methodology/testing-methodology.md](testing-methodology/testing-methodology.md) | Test strategy: targeted forge runs, fuzz, security, integration |

## Subfolders

- `runbooks/` — operational procedures (deploy, disaster recovery)
- `testing-methodology/` — test methodology and discipline (with HTML/DOCX exports)

## When NOT to look here

- Architectural rationale / why a mechanism exists → [`../architecture/`](../architecture/)
- Proofs of correctness or fairness → [`../research/proofs/`](../research/proofs/)
- Audit findings or exploit reports → [`../audits/`](../audits/)
- Frontend aesthetic / UX rules → see project root [`CLAUDE.md`](../../CLAUDE.md)

Top-level entry: [`../README.md`](../README.md). Encyclopedia: [`../INDEX.md`](../INDEX.md).

### Foundry quick reference

```bash
forge build                                          # default profile, no via_ir
forge test --match-path test/SomeTest.t.sol -vvv     # ALWAYS targeted
FOUNDRY_PROFILE=full forge build                     # via_ir for deploy validation
```

Default = no via_ir (fast). Profiles `full` / `ci` / `deploy` use separate `out-*` directories to avoid cache corruption between parallel agents.
