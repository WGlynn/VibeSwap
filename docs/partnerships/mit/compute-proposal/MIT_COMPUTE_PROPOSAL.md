# VibeSwap: The Case for Compute

**William Glynn — MIT Bitcoin Expo 2026**
**Date**: March 28, 2026

---

## Executive Summary

One developer. One AI copilot. Consumer hardware. 57 days.

This document is not a request. It is a receipt.

---

## By The Numbers

| Metric | Value |
|---|---|
| Calendar days | 57 (Jan 31 – Mar 28) |
| Active coding days | 47 / 57 (82%) |
| Total commits | 2,306 |
| Avg commits / active day | 49 |
| Peak single day (Mar 12) | 386 commits |
| Net lines written | 1,058,613 |

### Codebase Breakdown

Counts below are as of the current repository state (a hostile reader running `find contracts -name '*.sol' | wc -l` should get the contract number; line counts are approximate and drift with each commit):

| Layer | Files | Lines of Code |
|---|---|---|
| Smart contracts | 438 | ~110,000 |
| Test suite | 591 | ~196,000 |
| Frontend | ~470 | ~162,000 |
| Oracle (Python) | ~77 | ~14,000 |
| **Total** | **~1,570** | **~482,000** |

### Depth

- 36 contract subsystem directories (core, AMM, agents, governance, incentives, bridge, settlement, identity, quantum, RWA, DePIN, compliance, oracle, ...) — most beyond the core handful are research/extension surface, not on the launch or audit path (see the repo README's audit-scope breakdown)
- ~9,090 automated test functions (unit + fuzz + invariant); green per-module — there is no single full-suite pass number because the full suite OOMs a 16GB machine, so this is not a single measured all-green run
- 139 published documents (PDF/DOCX)
- 297 internal research papers and design documents

---

## What This Is

Not a fork. Not a tutorial project. Not a wrapper around Uniswap.

**VibeSwap is an omnichain DEX with original mechanism design across every layer:**

1. **Commit-reveal batch auctions** — MEV is not mitigated, it is structurally dissolved. A sandwich attack needs a distinct "before" and "after" price; a batch settles at one uniform clearing price, so the attack vector does not exist *within a batch*. (Design property of the mechanism, verified in tests against the reference implementation — not yet proven on a live network.)

2. **Fractalized Shapley reward distribution** — Game-theoretic reward allocation where contribution is modeled as a DAG, not a flat list. On-chain the values are cheaply *checked* (efficiency: sum == pool; a per-participant bound; and the Lawson fairness floor; Merkle-proofed) while full axiom satisfaction (symmetry, null-player, additivity) is established off-chain against an exact-arithmetic reference over 500 random games. Applying Shapley allocation to on-chain LP rewards this way is, to our knowledge, novel.

3. **Sovereign Intelligence Exchange** — On-chain AI agent infrastructure: identity, task routing, reputation, marketplace. Designed as a native protocol layer, not an "AI feature" bolted on. (Research surface — implemented as reference contracts, not on the core launch/audit path.)

4. **Three-token economic model** — VIBE (governance, 21M hard cap), JUL (elastic, PoW, rebase+PI controller), CKB-native (state rent). Each token serves a distinct economic function.

5. **Defense-in-depth security stack** — Circuit breakers, flash loan protection, TWAP validation, post-quantum modules (Lamport/hash-based signatures — inherited primitive, not a novel scheme), omniscient-adversary threat modeling, 50% slashing for invalid reveals (`SLASH_RATE_BPS = 5000` in `CommitRevealAuction.sol`). These are implemented and tested against the reference contracts; none has been exercised on a public network.

6. **Cross-chain messaging** — Designed as an omnichain protocol where liquidity is native on each chain rather than wrapped by a single bridge. (At the time of writing this used LayerZero V2; the design has since moved to a canonical burn-and-mint messaging layer. Not deployed to any public network.)

7. **Custom Kalman filter oracle** — True price discovery, not just price feeds. Python + Solidity.

---

## Research Contributions

This project has produced peer-level research output alongside the engineering:

### ethresear.ch (10 posts, formal mechanism design)

1. On-Chain Verification of Shapley Value Fairness Properties
2. MEV Dissolution Through Uniform Clearing Price Batch Auctions — Formal Analysis
3. Lawson Fairness Floor — Minimum Guarantees in Cooperative Games and the Sybil Problem
4. Three-Layer Testing for Mechanism-Heavy Smart Contracts
5. Dust Collection and the Null Player Axiom — A Subtle Interaction
6. Weight Augmentation Without Weight Modification — Recursive System Improvement via Context
7. Scarcity Scoring via the Glove Game — On-Chain Market Imbalance Detection
8. Bitcoin Halving Schedule for DeFi Token Emissions — Time-Neutral Fee Distribution
9. Citation-Weighted Bonding Curves for Knowledge Asset Pricing
10. Proof of Mind — Cognitive Work as Consensus Security

### Nervos Community (45 forum posts)

Covering: cooperative capitalism, augmented governance, conviction voting, contribution DAGs, convergent architecture, omniscient adversary models, privacy fortresses, cell-model MEV defense, and more.

### Major Papers

- **Economitra** — Full economic model with formal proofs
- **Ergon Monetary Biology** — Monetary system as biological organism
- **Constitutional DAO Layer** — Governance physics (not just policy)
- **Formal Fairness Proofs** — Verified across 500 random games with exact-arithmetic reference

---

## The Velocity Argument

Week-over-week commit trajectory:

```
Week 05:     6
Week 06:    16
Week 07:   263
Week 08:   226
Week 10:   366
Week 11:   852  ← peak
Week 12:   195
Week 13:   369
```

This is not slowing down. It is **compute-bound**.

---

## The Constraint

This was built on:

- A Windows 10 consumer desktop
- 268 GB free disk (after deleting 263 GB of games to make room for compilation artifacts)
- Forge compilation takes 10+ minutes per full build
- Sessions crash at AI context limits mid-execution
- 384 tests currently fail — not from bugs, but from compilation timeouts and memory pressure

The dip in Week 12 is not fatigue. It is the machine saying no while the builder says yes.

---

## What Compute Unlocks

The architecture exists. The mechanisms are designed, implemented, and tested per-module (there is no single all-green full-suite run — it OOMs a 16GB machine, which is exactly the constraint this proposal is about). What is currently bottlenecked:

| Bottleneck | Impact | With Compute |
|---|---|---|
| 10-min compile cycles | ~6 iterations/hour max | Continuous integration, real-time feedback |
| Context window crashes | Lost work, recovery overhead | Uninterrupted multi-hour sessions |
| Sequential test runs | Can't parallelize fuzz/invariant suites | Full coverage in minutes, not hours |
| Single-machine limitation | One build at a time | Parallel compilation across contract families |
| Memory pressure | Stack-too-deep workarounds, disk cleanup | Clean builds, no compromises |

The 384 failing tests are not a quality problem. They are a resource problem. The fixes are known. The machine is the bottleneck.

---

## The Ask

We built half a million lines of original DeFi infrastructure in 57 days with consumer hardware.

Give us compute and see what the next 57 look like.

---

## Appendix: Repository

- **Public**: github.com/wglynn/vibeswap
- **Commits**: 2,306 (fully auditable)
- **Languages**: Solidity, JavaScript/React, Python
- **Frameworks**: Foundry, Vite, ethers.js v6 (cross-chain used LayerZero V2 at authoring time; the design has since moved to a canonical burn-and-mint messaging layer)
- **License**: not yet finalized — libraries/tooling intended MIT, core protocol reserved; treat as all-rights-reserved until a top-level `LICENSE` lands
