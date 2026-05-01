# VibeSwap × MIT: A Research Partnership

**William Glynn — MIT Bitcoin Expo, April 10–12, 2026**

---

## What We Bring

### 1. Novel Mechanism Design — Implemented and Tested

We didn't write papers about mechanisms. We built them, deployed them, and proved them on-chain.

**Commit-reveal batch auctions** that don't mitigate MEV — they dissolve it. Uniform clearing prices make sandwich attacks mathematically impossible. Formal proof and adversarial simulation (430 scenarios, 7 agent types, 0 exploitable orderings).

**Fractalized Shapley reward distribution** — the first on-chain implementation that models contribution as a DAG, not a flat list. Five Shapley axioms verified across 500 random games using exact-arithmetic reference. The Solidity integer implementation deviates by < 1 token from the Python `fractions.Fraction` reference across all games.

**Lawson Fairness Floor** — minimum guarantees in cooperative games with Sybil resistance. New primitive.

**Proof of Mind** — cognitive work as consensus security. New primitive.

These aren't in a paper. They're in 110,728 lines of audited Solidity with 9,090 tests.

### 2. A Live Case Study in Human-AI Co-Development

One human. One AI copilot. 57 days. 2,306 commits. 482,886 lines of code across four languages.

This is not a productivity anecdote. This is a **reproducible methodology** with formalized patterns:

- **Anti-Amnesia Protocol** — Write-ahead logging for AI sessions. Crash recovery across context window resets. The AI resumes exactly where it stopped, not from scratch.
- **Session State Chains** — Each session writes a block header (parent hash, HEAD, status, artifacts, next steps). Sessions form a hash-linked chain. Full state reconstruction without storing full state.
- **Mitosis Constant** — Formal model for when to spawn parallel AI agents (k=1.3, cap=5). Derived from empirical observation, not guesswork.
- **Shard Architecture** — Full-clone agents over swarm agents. Each gets complete context. Symmetry over specialization.
- **Verification Gates** — The AI never claims success without proof. Every assertion is backed by a test, a build, or a git hash.

These patterns produced 49 commits per active day sustained over 47 days. They are **transferable** — any research group could adopt them tomorrow.

### 3. Publishable Research — Already Written

| Output | Count | Status |
|---|---|---|
| ethresear.ch formal posts | 10 | Written, ready to submit |
| Nervos community research posts | 45 | Published |
| Internal research papers | 297 | Documented |
| Published documents (PDF/DOCX) | 139 | Complete |

Selected ethresear.ch topics:

- On-Chain Verification of Shapley Value Fairness Properties
- MEV Dissolution Through Uniform Clearing Price Batch Auctions — Formal Analysis
- Lawson Fairness Floor — Minimum Guarantees in Cooperative Games
- Weight Augmentation Without Weight Modification — Recursive System Improvement via Context
- Citation-Weighted Bonding Curves for Knowledge Asset Pricing
- Scarcity Scoring via the Glove Game — On-Chain Market Imbalance Detection

Major papers:

- **Economitra** — Complete economic model with formal proofs (the magnum opus)
- **Formal Fairness Proofs** — Shapley verification across 500 random games
- **Constitutional DAO Layer** — Governance as physics, not policy
- **Ergon Monetary Biology** — Monetary systems modeled as biological organisms

Every one of these is a potential co-authored publication with the right research partner.

---

## What You Bring

Compute. Peers. Credibility.

- **Compute** — Our compilation takes 10 minutes on consumer hardware. Our test suite has 9,090 tests. Our fuzz campaigns need parallelization. We hit the ceiling not at the design level but at the hardware level.
- **Research community** — The mechanism design work needs peer review from people who study cooperative game theory, auction design, and MEV formally. That's here.
- **Academic credibility** — These patterns deserve to be studied, not just used. A research partnership puts them where they can be examined, challenged, and improved.

---

## What a Partnership Looks Like

| We Contribute | MIT Contributes |
|---|---|
| Working codebase (376 contracts, 510 test files, full frontend + oracle) | Compute infrastructure |
| 10 ethresear.ch posts ready for co-authorship | Research supervision and peer review |
| AI co-development methodology (documented, reproducible) | Academic context and publication channels |
| Ongoing development velocity (49 commits/day, accelerating) | Student researchers who want real systems to study |
| Open problems in mechanism design, game theory, AI collaboration | The rigor to formalize them |

### Concrete Deliverables

1. **Joint publication on AI-augmented development patterns** — The anti-amnesia protocol, session state chains, and mitosis constant are novel contributions to software engineering methodology. No one has formalized these.

2. **Mechanism design paper on MEV dissolution** — The formal proof exists. It needs peer review and the weight of an institutional co-author to reach the right audience.

3. **Shapley fairness verification framework** — MIT-licensed, protocol-independent. Useful to any project doing on-chain reward distribution. A tool the community can use, with MIT's name on it.

4. **Case study: 2,306 commits in 57 days** — What happens when you give one builder and one AI a methodology and no resources? What happens when you give them resources? The before/after writes itself.

---

## The Numbers (Appendix)

```
57 calendar days  ·  47 active  ·  2,306 commits  ·  49/day avg  ·  386 peak day

Contracts:   376 files  ·  110,728 lines  ·  32 subsystems
Tests:       510 files  ·  196,325 lines  ·  9,090 tests (96% pass)
Frontend:    460 files  ·  161,977 lines
Oracle:       74 files  ·   13,856 lines
Total:     1,420 files  ·  482,886 lines

Net lines written: 1,058,613
Published docs: 139 (PDF/DOCX)
Research papers: 297

Weekly velocity:
  Wk 05:     6    Wk 10:   366
  Wk 06:    16    Wk 11:   852 ← peak
  Wk 07:   263    Wk 12:   195
  Wk 08:   226    Wk 13:   369
```

The repository is public: **github.com/wglynn/vibeswap**

Every number is verifiable with `git log`.

---

*We have what you study. You have what we need. Let's make something neither of us can make alone.*
