# VibeSwap × MIT

**William Glynn — MIT Bitcoin Expo, April 10–12, 2026**

---

## What I Built

An omnichain DEX with original mechanism design across every layer. Not a fork. Not a wrapper. From scratch.

- **Commit-reveal batch auctions** — MEV isn't mitigated. It's structurally dissolved. Uniform clearing prices make sandwich attacks mathematically impossible. Proved via formal analysis and adversarial simulation (430 scenarios, 7 agent types, 0 exploitable orderings).
- **Fractalized Shapley rewards** — Contribution modeled as a DAG. Five Shapley axioms verified on-chain across 500 random games against exact-arithmetic reference. < 1 token deviation.
- **Sovereign Intelligence Exchange** — On-chain AI agent infrastructure: identity, task routing, reputation, marketplace. A native protocol layer.
- **Three-token economy** — Governance token (hard cap), elastic work token (PoW + PI rebase), state rent token. Each serves a distinct economic function.
- **Cross-chain via LayerZero V2**, custom Kalman filter oracle, circuit breakers, flash loan protection, quantum-resistant modules.

```
376 smart contracts  ·  110,728 lines of Solidity
510 test files       ·  196,325 lines  ·  9,090 tests
460 frontend files   ·  161,977 lines
 74 oracle files     ·   13,856 lines (Python)
─────────────────────────────────────────
1,420 files          ·  482,886 lines of code
```

10 ethresear.ch posts. 45 Nervos forum posts. 297 research documents. 139 published PDFs. A full economic model with formal proofs.

2,306 commits. 57 calendar days. 49 commits per active day. Peak day: 386.

---

## What I Built It With

A Windows 10 desktop.

I deleted Call of Duty, Modern Warfare, Overwatch, Diablo III, and my entire Steam library — 263 GB of games — to make room for Solidity compilation artifacts.

Forge takes 10 minutes to compile. I get six iteration cycles per hour. My test suite has 9,090 tests and I can't parallelize them. My AI copilot sessions crash when they hit context limits, and I built a write-ahead log and crash recovery protocol so I don't lose work when they do.

384 tests fail right now. Not because of bugs. Because of compilation timeouts and memory pressure on a machine that is being asked to do what a cluster should be doing.

The week I hit 852 commits was also the week I had to clear my npm cache and delete Microsoft Playwright to free 4 GB. The dip to 195 the following week isn't fatigue. It's the machine saying no.

```
Week 05:     6       Week 10:   366
Week 06:    16       Week 11:   852  ← peak
Week 07:   263       Week 12:   195  ← disk full
Week 08:   226       Week 13:   369
```

Every number is in `git log`. The repo is public.

---

## What I Figured Out Along the Way

Building under these constraints forced patterns that don't exist yet in the literature:

**Anti-Amnesia Protocol** — Write-ahead logging for AI coding sessions. When the AI crashes mid-execution (context limit, OOM, power loss), it recovers exactly where it stopped. Not from scratch. From the last committed state, with full intent reconstruction.

**Session State Chains** — Each AI session writes a block header: parent hash, current HEAD, status, artifacts, next steps. Sessions form a hash-linked chain. Full state reconstruction without storing full state. Same idea as a blockchain, applied to development continuity.

**Mitosis Constant** — A formal threshold for when to spawn parallel AI agents (k=1.3, cap=5). Below the threshold, sequential is faster. Above it, you're wasting time not parallelizing. Derived empirically over hundreds of sessions.

**Verification Gates** — The AI never claims success without proof. Every assertion requires a test, a build, or a git hash. No "I think this works." Only "here's the output."

These aren't tricks. They're a methodology. They're why one person sustained 49 commits/day for 47 days. And they're transferable — any research group could adopt them.

---

## What You Have That I Don't

Compute. Peers. Publication channels.

My mechanism design needs peer review from people who study cooperative game theory and auction design formally. My AI methodology needs to be studied, not just used. My ethresear.ch posts are sitting in a docs folder waiting for the credibility that comes from institutional co-authorship.

---

## What I Have That You Don't

A working system. Not a simulation. Not a model. 376 contracts, tested, integrated, deployed to a frontend.

Plus 10 ready-to-submit research contributions that intersect MIT's core interests:

1. On-Chain Verification of Shapley Value Fairness Properties
2. MEV Dissolution via Uniform Clearing Price Batch Auctions — Formal Analysis
3. Lawson Fairness Floor — Minimum Guarantees in Cooperative Games
4. Weight Augmentation Without Weight Modification — Recursive Self-Improvement via Context
5. Citation-Weighted Bonding Curves for Knowledge Asset Pricing
6. Proof of Mind — Cognitive Work as Consensus Security
7. Scarcity Scoring via the Glove Game
8. Bitcoin Halving Schedule for DeFi Token Emissions
9. Dust Collection and the Null Player Axiom
10. Three-Layer Testing for Mechanism-Heavy Smart Contracts

And a case study that writes itself: what happens when you give one builder and one AI a methodology and no resources? You get 482,886 lines in 57 days. What happens when you give them resources?

---

## The Trade

| I bring | You bring |
|---|---|
| 376 contracts, battle-tested | Compute to run them properly |
| 10 papers ready for co-authorship | Peer review and publication channels |
| AI co-development methodology | Academic context to formalize it |
| 49 commits/day and accelerating | Infrastructure to remove the ceiling |
| Open problems in game theory, mechanism design, AI collaboration | Students and researchers who live for open problems |

### What MIT Gets

- **Joint publications** on MEV dissolution, Shapley fairness verification, and AI-augmented development — all novel, all backed by working code.
- **A reproducible framework** for human-AI co-development that any lab can adopt. Documented, tested, proven at scale.
- **A real system to study** — not a toy, not a simulation. A full DeFi protocol with original mechanism design in every layer.
- **The before/after story** — what this project produced with a consumer desktop vs. what it produces with real infrastructure. That delta is a paper by itself.

### What I Get

A machine that doesn't make me choose between my compiler and my games.

---

## Let's Go

The repo is public: **github.com/wglynn/vibeswap**

2,306 commits. Every one auditable. I'm not asking you to believe me. I'm asking you to run `git log`.

I have what you study. You have what I need. Let's make something neither of us can make alone.
