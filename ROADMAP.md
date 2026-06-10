# VibeSwap Roadmap

> *Status as of 2026-06-09. Living document. Estimates are rough sizing, not commitments.*

The external-LLM critique surfaced the right question: **"which contracts ship at mainnet, and what's the timeline?"** This document is the answer.

VibeSwap is becoming a **chain, not a set of contracts**. The Solidity tree in `contracts/` is the mechanism spec and the audit reference; the CKB cells in `contracts-ckb/` are what runs in production. "Complete" means **the launch-scope cells are deployed on a sovereign CKB-fork mainnet, audited, with the canonical-burn-and-mint bridge live to one external chain.** This roadmap is the path from current state to that.

It's organized as seven phases. P0–P2 are sequential. P3–P5 parallelize once P1 closes. P6 is mainnet, gated on the rest.

## Summary

| Phase | Scope | Rough sizing | Gating output |
|---|---|---|---|
| **P0** | Scope lock | 1–2 weeks | Launch-scope manifest + frontmatter-injector fix + housekeeping |
| **P1** | CKB launch-scope cells production-ready | 8–12 weeks | All v1 cells passing on dev chain end-to-end, test parity with Solidity audit suite |
| **P2** | Public CKB testnet | 2–4 weeks | Chain spec published, ≥3 nodes (≥2 external operators), public RPC, bus factor > 1 |
| **P3** | CKB cell audit pass | 8–12 weeks calendar | Independent audit, all critical+high findings closed |
| **P4** | Frontend real-chain integration | 4–6 weeks (parallel) | Mock backend removed, swap settles against testnet, wallet flows hit cells |
| **P5** | Validator bonding + first bridge pair | 6–8 weeks (parallel) | Bonded validator network live on testnet, burn/mint working CKB ↔ one external chain |
| **P6** | Mainnet launch | Gated on P3 + P4 + P5 + license + go-live runbook | Mainnet chain spec, genesis distribution, liquidity bootstrapping plan executed |

Total: 24–40 weeks from P0 start to P6 mainnet, parallelism-dependent. **No promise — this is engineering sizing, not a marketing date.**

---

## P0 — Scope lock

**Goal**: pick what ships. The 34 contract module directories and ~30 CKB cell directories are the focus problem the critique called out. P0 ends that ambiguity.

### Deliverables

1. **Launch-scope manifest** — a file at `contracts-ckb/LAUNCH_SCOPE.md` enumerating every cell that ships at v1, in three buckets:
   - **Core** (mechanism + safety): commit-reveal-auction, shapley-distributor, circuit-breaker, constitutional-bounds, emergency-pause-boundary, governance-update-boundary, slash-boundary, deposit-boundary, primitive-cell-lock + primitive-cell-type.
   - **Cross-chain**: messaging-hub-canonical-token, messaging-hub-burn-receipt, messaging-hub-attestation, messaging-hub-validator-registry, cross-chain-in-boundary, cross-chain-out-boundary, bls-verify, nci-score.
   - **Out of v1 scope** (research surface, post-v1): datatoken, escrow-vault, lawson-constants, lineage-vault, proof-of-mind lock-script (if still under design).
   The file is the contract — anything not in Core or Cross-chain ships when it ships, not at launch.
2. **Solidity audit-scope manifest** — same exercise for the EVM tree. Names the Solidity contracts that are the reference for each CKB cell, marks the other 24 module dirs explicitly as research surface. Lives at `contracts/LAUNCH_REFERENCE.md`.
3. **Frontmatter-injector fix** — root-cause and patch the upstream process re-templating memory frontmatter with `originSessionId: <session>` injected into description fields. Logged in `~/.claude/cron-prompts/_primitives-pending.md` from the 2026-06-09 substrate-sync. Until this is fixed, every Edit on a memory file self-defeats.
4. **Root-level housekeeping**: relocate marketing-grade files at vibeswap root (`INVESTOR_SUMMARY.md`, `LinkedIn_Posts.md`, `MEDIUM_ARTICLE.md`, `NERVOS_PROPOSAL.md`, `PROPOSAL_JOURNEY.md`, `Video content& demos/`, `blog/`, `broadcast/`) into `docs/marketing/` or `docs/_archive/`. Repo root should look like an engineering project, not a media kit.
5. **License decision queued for Will** — currently "all rights reserved by default" with MIT-intended-for-libraries. Needs resolution before P6.

### Acceptance criteria

- A reader landing at the README can answer "which 18 cells ship at v1?" in under 30 seconds by clicking `LAUNCH_SCOPE.md`.
- The frontmatter-injector regression cannot recur — verify by re-running my YAML repair from 2026-06-09 and confirming it survives a commit.
- Root directory has no top-level marketing files. `tree -L 1` reads as code + docs + standard project files.

---

## P1 — CKB launch-scope cells production-ready

**Goal**: every cell in the Core + Cross-chain bucket is feature-complete, tested, and exercising on the dev chain end-to-end.

### Deliverables

1. **Cell completeness** — every launch-scope cell builds clean on the RISC-V target (`cargo build --release` in `contracts-ckb/`), all referenced types/locks resolve, no stub `unimplemented!()` paths remain.
2. **Test parity** — for every Solidity test class covering a launch-scope mechanism, a CKB-side equivalent exists (Rust integration test or scripted dev-chain transaction). Coverage parity target: ≥90% of mechanism invariants the Solidity audit verified.
3. **End-to-end dev-chain demonstrations** — at minimum:
   - 10-second batch auction completes commit → reveal → settle with priority bid, Fisher-Yates shuffle, uniform clearing price.
   - Shapley distributor pays out a multi-LP pool with verifiable axiom-set compliance.
   - Circuit breaker triggers and recovers per spec.
   - Cross-chain burn-receipt → attestation → mint-claim round-trips against a mock external chain.
4. **Cell-cell composition tests** — full flows that touch ≥3 cells in one transaction (e.g., auction → distributor → fee-router). The 1-cell-at-a-time green doesn't catch composition bugs.
5. **Cell-by-cell readiness scoreboard** — `contracts-ckb/READINESS.md` tracking each launch-scope cell's status: builds / tested / composed / docs.

### Acceptance criteria

- `contracts-ckb/READINESS.md` shows green across all four columns for every Core + Cross-chain cell.
- A scripted demo (`scripts/demo-full-flow.sh` or equivalent) runs a full batch auction + cross-chain burn against the dev chain in under 60 seconds.
- No `TODO` or `unimplemented!()` calls remain in launch-scope cell code paths.

### Critical path

P1 cannot start without P0's `LAUNCH_SCOPE.md`. P3 cannot start until P1 closes.

---

## P2 — Public CKB testnet

**Goal**: chain spec published; multiple nodes; external operators; the bus-factor warning from the critique addressed.

### Deliverables

1. **Public chain spec** — `vibeswap_ckb_testnet` spec file in `contracts-ckb/chain-spec/`, distinct from `vibeswap_ckb_dev`. Genesis is reproducible from spec + scripts.
2. **Node operator runbook** — `docs/developer/runbooks/RUN_TESTNET_NODE.md`. A reader with no prior context can spin up a node and sync the chain in under an hour.
3. **Public RPC endpoint** — at least one publicly-reachable RPC node (own infra or vetted provider). Status page if possible.
4. **Bus factor ≥ 2** — at least one external party (not the founder, not a paid contractor) has run a node successfully and reported back. The critique was right to flag bus factor — P2 must close it.
5. **Block explorer** — minimal explorer (block list, transaction list, cell-type-script registry). Off-the-shelf if available; minimal custom if not.

### Acceptance criteria

- A new visitor to the README can connect to the public testnet and submit a transaction within 30 minutes following only repo docs.
- Two distinct GitHub identities have synced a testnet node and submitted at least one successful transaction.

---

## P3 — CKB cell audit pass

**Goal**: independent audit on the launch-scope cells; all critical and high findings closed.

### Deliverables

1. **Audit firm engagement** — one or two firms with CKB/RISC-V cell experience. The existing 2026-04–2026-05 audits covered Solidity; the cell layer is different code and different attack surface.
2. **Audit scope** — explicitly limited to Core + Cross-chain launch-scope cells per `LAUNCH_SCOPE.md`. Out-of-scope cells are not paid for.
3. **Finding closure log** — each critical/high finding closed by a commit + a regression test. Lives at `docs/audits/<date>-ckb-launch-audit/`, same format as existing Solidity audit reports.
4. **Post-audit attestation** — a `READY_FOR_MAINNET.md` signed off by Will + audit firms, listing residual findings (medium/low) acknowledged and triaged.

### Acceptance criteria

- Zero open critical or high findings.
- All findings traceable to a closing commit or an explicit "won't fix — accepted risk" note.
- Audit report public in `docs/audits/`.

### Critical path

Gates P6 mainnet. Cannot parallelize with P6.

---

## P4 — Frontend real-chain integration

**Goal**: the demo at `frontend-jade-five-87.vercel.app` stops being a mock and starts settling real transactions against the public testnet.

Runs in parallel with P3 — frontend changes don't affect the audit critical path.

### Deliverables

1. **Backend swap** — remove the mock backend from `frontend/`, replace with CKB RPC client. Wallet flows hit the testnet, not in-memory mocks.
2. **Batch lifecycle UI** — visible commit/reveal/settlement phases with countdown. The mechanism is the differentiator; the UI must communicate it.
3. **Slippage + clearing price display** — uniform clearing price before settle, actual price after, delta visible.
4. **Wallet integrations** — at minimum WebAuthn device wallet (already partially shipped) + one external wallet (MetaMask via custom RPC adapter or a CKB-native wallet).
5. **Loading + error states** — every async path has a non-blank state. Empty unexpected-error pages are the single largest "feels broken" signal.

### Acceptance criteria

- A new visitor can connect a wallet, commit an order, reveal it, and see settlement on the public testnet without engineer assistance.
- Edge cases handled: stalled reveal phase, network disconnect mid-commit, slippage-exceeded reveal, batch with zero priority bids.

---

## P5 — Validator bonding + first bridge pair

**Goal**: bonded-validator messaging network live on testnet; canonical burn-and-mint working CKB ↔ one external chain.

Runs in parallel with P3 and P4.

### Deliverables

1. **Validator bonding contract live** — `messaging-hub-validator-registry` cell deployed on public testnet with real stake commitments from a starter validator set (3–7 validators).
2. **BLS attestation rotation** — validators rotating per spec, attestation aggregation verified end-to-end via `bls-verify` cell.
3. **External-chain integration** — one external chain selected (Ethereum Sepolia is the obvious P1 pick). Burn-receipt cell on CKB, mint-claim contract (Solidity) on the external chain, message verification both directions.
4. **Round-trip demonstration** — a token burned on CKB testnet mints on Sepolia within consensus latency. Reverse path the same.
5. **Failure-mode runbook** — what happens when validators are offline, when an attestation is forged, when an external chain reorgs. Lives at `docs/developer/runbooks/MESSAGING_FAILURE_MODES.md`.

### Acceptance criteria

- 100 successful round-trips with no message replay, no double-mint, no stuck funds.
- At least one simulated adversarial scenario passes (slashing fires correctly on a forged attestation, replay attempt rejected, etc.).

---

## P6 — Mainnet launch

Gated on P3 + P4 + P5 closing.

### Pre-launch checklist

- [ ] License decided and `LICENSE` file at repo root (P0 carry-forward).
- [ ] P3 audit closed, `READY_FOR_MAINNET.md` signed.
- [ ] P4 frontend connecting to mainnet RPC.
- [ ] P5 bonded validator set committed for mainnet (≥7 validators with real stake).
- [ ] Genesis distribution plan published. Initial LP set bootstrapped.
- [ ] Disaster-recovery runbook tested end-to-end on testnet within last 30 days.
- [ ] Bug bounty program live with public scope + payouts.

### Launch-day deliverables

1. **Mainnet chain spec** — `vibeswap_ckb_mainnet` in `contracts-ckb/chain-spec/`. Genesis hash published before block 1.
2. **Mainnet deployment record** — `deployments/mainnet/` populated. Cell type-script hashes, deploy block heights, deploy transactions. This is the directory the critique called out as empty.
3. **Public announcement** — Medium / Twitter / Telegram coordinated. Launch arc the technical artifacts, not the price.
4. **Founder-AFK robustness test** — Will is unavailable for a 24-hour window post-launch. The chain runs without intervention. If anything in the design requires the founder's hands, the design isn't ready.

### Acceptance criteria

- Mainnet block 1000 mined without intervention.
- First user-initiated batch auction settles correctly on mainnet.
- First cross-chain message round-trips on mainnet.
- The "is this worth using" answer the critique evaluator gave changes from "skip until deployments exist" to "go try it." Verifiable by re-running the critique.

---

## Out of v1 scope (post-mainnet)

These exist in the codebase, will not gate mainnet, and ship in their own waves:

- **Identity layer** — `contracts/identity/` smart-account + session-key + WebAuthn. Phase 1.5.
- **Insurance pools and IL protection** — `ILProtectionVault`, `LoyaltyRewards`, `VolatilityInsurancePool`. Phase 2.
- **DePIN / compute / RWA / naming** — entire research-surface cluster (`contracts/depin/`, `contracts/compute/`, `contracts/rwa/`, `contracts/naming/`, `contracts/psinet/`, `contracts/quantum/`, `contracts/intent-markets/`). These are exploration, not ship-gates. The right time is post-mainnet when each can earn its way in.
- **Additional bridge pairs** beyond the first chosen at P5. Wave 2.

The principle: **everything not on the critical path waits.** [P·full-leverage-only-moves] says partial-leverage moves burn. Shipping the chain with 18 launch-scope cells is total leverage; shipping it with all 26 currently-building cells (most of them research) is partial leverage diluted across surfaces.

---

## Cross-cutting concerns

These don't belong to one phase — they ride along through all of them.

### License

Top-level `LICENSE` file is the blocker. The current "all rights reserved by default" plus MIT-intended-for-libraries is contradictory and external contributors can't safely fork. Must resolve before P6. Will-decision.

### Bus factor

The critique flagged this explicitly. The mitigation isn't "hire more people," it's "ensure the system runs without the founder for a defined window." P2 includes a bus-factor ≥ 2 acceptance criterion; P6 includes a 24-hour founder-AFK test. If those fail, the launch isn't ready.

### Documentation discipline

`docs/INDEX.md` is the encyclopedia. New mechanism docs go there. Audit reports live in `docs/audits/`. Runbooks live in `docs/developer/runbooks/`. The marketing-doc-at-root pattern that P0 cleans up should not recur — there's a `docs/marketing/` for that.

### Foundry profile discipline

CLAUDE.md hardware constraint: 16GB RAM, max 3 concurrent forge processes, default profile = no via_ir. Tests always use `--match-path`. This stays in force through P1; CKB testing is Cargo + scripted dev-chain transactions, different constraint set.

---

## How this document gets updated

This file is write-through state, like SESSION_STATE.md. When a phase closes, it gets a `✓ closed YYYY-MM-DD <commit>` annotation; when sizing changes, the table at top updates; when a phase reveals a missing dependency, P0's housekeeping list grows.

The list of "what ships at v1" is the load-bearing question. Everything else can drift. That list cannot.

---

*Last update: 2026-06-09. Next review: after P0 closes.*
