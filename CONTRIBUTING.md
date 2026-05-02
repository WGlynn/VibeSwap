# Contributing to VibeSwap

Thanks for considering a contribution. This is a financial-protocol repository, so the bar for code review and testing discipline is high. The good news: most of the discipline is already encoded in tooling — Foundry, slither, the test suite, the docs structure. Follow the conventions below and your PR will move quickly.

> *Cooperative capitalism — mutualized risk, free market competition. Honesty is structural, not aspirational.*

---

## Before You Start

- **Read the docs first.** Audience-keyed entry points live in [`docs/README.md`](docs/README.md). For the encyclopedia view of every primitive, see [`docs/INDEX.md`](docs/INDEX.md).
- **Build & test setup**: [`docs/developer/INSTALLATION.md`](docs/developer/INSTALLATION.md) and [`docs/developer/README.md`](docs/developer/README.md).
- **Architecture**: [`docs/architecture/`](docs/architecture/) — read this before changing anything in `contracts/core/`, `contracts/amm/`, or `contracts/messaging/`.
- **Audits & open security work**: [`docs/audits/`](docs/audits/).
- **Security disclosure**: see [`SECURITY.md`](SECURITY.md) — do **not** file public issues for vulnerabilities.

If you're unsure whether a change is welcome, open a discussion or draft PR first. We'd rather talk than reject good work after you've written it.

---

## Workflow: Fork → Branch → PR

1. **Fork** the repository on GitHub.
2. **Clone** your fork and add upstream:
   ```bash
   git clone https://github.com/<your-handle>/vibeswap.git
   cd vibeswap
   git remote add upstream https://github.com/wglynn/vibeswap.git
   git submodule update --init --recursive
   ```
3. **Branch** off `master` with a descriptive name:
   ```bash
   git checkout -b feat/auction-priority-cap
   git checkout -b fix/router-eth-handling
   git checkout -b docs/contributing-guide
   ```
4. **Build & test** locally before opening a PR (see "Testing" below).
5. **Push** and open a pull request against `wglynn/vibeswap:master`.
6. Keep PRs **focused and small**. One concern per PR. If your change touches contracts, tests, frontend, and oracle, split it.
7. **Rebase, don't merge** when picking up upstream changes:
   ```bash
   git fetch upstream
   git rebase upstream/master
   ```

---

## Coding Conventions

### Solidity (`contracts/`)

- **Solidity version**: `0.8.20` (pinned via `pragma solidity 0.8.20;`). Do not use floating pragmas in core contracts.
- **OpenZeppelin v5.0.1** patterns. Use `Initializable` + `UUPSUpgradeable` for upgradeable contracts. Use `OwnableUpgradeable` and access-control mixins from OZ rather than rolling your own.
- **`nonReentrant`** on every state-changing external function that touches funds, calls into another contract, or could be reentered. Default-on; opt-out only with a comment justifying why.
- **CEI**: checks → effects → interactions. Always.
- **NatSpec** required on every external/public function: `@notice`, `@param`, `@return`. Internal/private may be lighter but should still describe non-obvious invariants.
- **Custom errors** preferred over `require(..., "string")` — gas-cheaper, more typed.
- **Section headers**: separate logical sections inside a contract with the project convention:
  ```solidity
  // ============ Storage ============
  // ============ Events ============
  // ============ Constructor / Initializer ============
  // ============ External Functions ============
  // ============ Internal Functions ============
  // ============ View Functions ============
  // ============ Upgrade Authorization ============
  ```
- **No magic numbers** — name them as `constant` or `immutable`.
- **SPDX header** on every file: `// SPDX-License-Identifier: MIT` (or whatever the file's existing header indicates; do not silently change it).
- **Storage layout discipline** for upgradeable contracts: never reorder existing storage variables, always append. See [`docs/audits/2026-05-01-storage-layout-followup.md`](docs/audits/2026-05-01-storage-layout-followup.md) for the standing audit.

### Frontend (`frontend/`)

- React 18, Vite 5, Tailwind CSS, ethers.js v6.
- **Functional components only.** No class components.
- **Custom hooks** for all stateful logic. The canonical wallet hook is `useWallet`; for device/passkey wallets it's `useDeviceWallet`. Use the dual-detection pattern: `isConnected = isExternalConnected || isDeviceConnected`.
- **Aesthetic is locked** to terminal-console / matrix-green. See `CLAUDE.md` and the canonical reference component `frontend/src/components/RosettaPage.jsx`. Do not introduce new color palettes.
- No raw hex colors — use Tailwind tokens / CSS variables.

### Python (`oracle/`)

- Python 3.9+.
- **`black`** formatter, **100-char lines**, **type hints** on all public functions.
- **`pytest`** for tests.
- Numerical code: prefer `numpy` / `scipy` for performance; document any custom numerical-stability tricks.

---

## Testing

VibeSwap runs on a Ryzen 5 1600 / 16 GB RAM dev box. **The test suite is large; running it unscoped will OOM the machine.** These rules are mandatory:

- **`forge test` without `--match-path` or `--match-contract` is forbidden.** Always scope. Example:
  ```bash
  forge test --match-path test/auction/CommitRevealAuction.t.sol -vvv
  forge test --match-contract VibeAMMTest -vvv
  ```
- **Default profile is `via_ir: false`** for fast iteration. Use `FOUNDRY_PROFILE=full` only for deploy validation, and only one such build at a time. CI uses its own profile (`out-ci/`).
- **Max 3 concurrent forge processes** across all your terminals/agents. More than that thrashes RAM.
- **Profiles use separate `out-*` dirs** to prevent cache corruption between concurrent runs.

### Test discipline by area

- **Anything in `contracts/core/`, `contracts/amm/`, `contracts/messaging/`, `contracts/libraries/`** — must have unit + fuzz + invariant tests. These are security-critical.
- **`contracts/governance/`, `contracts/incentives/`** — unit + fuzz minimum. Invariant where state machines warrant it.
- **Frontend** — component and hook tests via React Testing Library; e2e via Playwright if the route handles funds.
- **Oracle** — `pytest` with property-based tests via `hypothesis` for numerical invariants.

For the full testing methodology, see [`docs/developer/testing-methodology/`](docs/developer/testing-methodology/).

### Static analysis

```bash
slither . --config slither.config.json
```

Run before opening a PR if you've changed contracts. Address findings or document why a finding is a false positive.

---

## Commit Message Format

The repo uses a Conventional-Commits-adjacent format with project-specific cycle markers:

```
<type>(<area>): <subject>

<body — wrap at 72 chars, explain *why*>

<footer — issue refs, breaking changes>
```

**Types**: `feat`, `fix`, `docs`, `test`, `refactor`, `perf`, `chore`, `style`, `build`, `ci`.

**Areas** (examples — match the directory you're touching): `auction`, `amm`, `core`, `oracle`, `router`, `treasury`, `frontend`, `oracle-py`, `script`, `docs`.

**Cycle commits** (when shipping a numbered improvement cycle, e.g. RSI cycles): include the marker `C<N>`:
```
feat(auction): C47 — slash unrevealed commitments after settlement window
```

**Examples**:
```
feat(auction): add Fibonacci-scaled throughput limiter
fix(router): cap priority bid at contract balance to prevent failed reveals
docs(developer): expand testing-methodology with invariant-test patterns
test(amm): add fuzz harness for k-invariant under fee accrual
chore: bump foundry-rs/forge-std to v1.9.4
refactor(core): extract _executeOrders into separate library
```

**Anti-patterns**:
- ❌ `wip`, `update`, `fix bug`, `changes` — describe what changed
- ❌ Mixing unrelated changes in one commit
- ❌ Squashing across logical boundaries during PR cleanup

---

## Pull Request Checklist

Before requesting review:

- [ ] Branch is rebased on latest `upstream/master`
- [ ] Scoped tests pass: `forge test --match-path <your-test> -vvv`
- [ ] Slither (if contracts changed): no new findings, or findings documented
- [ ] NatSpec / docstrings updated for new or changed public APIs
- [ ] Storage layout unchanged for upgradeable contracts (or migration plan in PR description)
- [ ] Docs updated under `docs/` if the change is user-facing or affects integrators
- [ ] No secrets, RPC keys, or `.env` content in the diff
- [ ] Commit messages follow the format above

PR description should include:

1. **What** changed
2. **Why** it changed (motivation, linked issue, or RSI cycle ID)
3. **How** to verify (commands the reviewer can run)
4. **Risks / breaking changes** if any

---

## Code of Conduct

Be civil. Disagree with ideas, not people. Public review threads are searchable forever — write the comment you'd want quoted in a thesis. Harassment, doxing, and bad-faith engagement get you removed without ceremony.

If you experience or witness behavior that violates this, contact the maintainers privately via the channels in [`SECURITY.md`](SECURITY.md) (use a non-`[SECURITY]` subject line).

A formal Code of Conduct document may be added later; until then, this stub is the policy.

---

## License

Pending — see the License section of [`README.md`](README.md). Until a top-level `LICENSE` lands, contributors are asked to keep SPDX headers consistent with the file they're modifying. By submitting a PR you agree that your contribution may be relicensed under whatever final license the project adopts (with attribution preserved).

---

## Questions

Open a GitHub discussion or draft PR. The fastest way to get a clear answer is to make the question concrete enough that the answer can be a code patch.
