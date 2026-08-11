# VibeSwap × MIT: A Research Partnership

**William Glynn — MIT Bitcoin Expo, April 10–12, 2026**

---

## What We Bring

### 1. Novel Mechanism Design — Implemented and Tested

We didn't just write papers about mechanisms. We built them as working reference implementations and stress-tested them in simulation. (Nothing is on a public network yet — the protocol is mid-pivot to a sovereign CKB-fork chain and `deployments/` is empty by design. See the repo README status.)

**Commit-reveal batch auctions** that aim to dissolve MEV rather than mitigate it. Within a batch, a single uniform clearing price removes the "before/after" price pair a sandwich attack needs. We back this with a written argument and adversarial simulation (~430 scenarios, 7 agent types — no exploitable ordering surfaced in the tested set, though the harness and exact scenario/agent counts are not yet pinned to a single on-disk artifact, and "tested set" is not a proof of universal impossibility).

**Fractalized Shapley reward distribution** — a reference implementation that models contribution as a DAG, not a flat list. Shapley is the allocation uniquely determined by four axioms together (efficiency, symmetry, null-player, additivity); our Solidity implementation is checked against an exact-arithmetic reference across random games, and the formal-spec test suite asserts the derived properties (conservation, non-negativity, upper bound, monotonicity, and the Lawson floor). The precise game count and the integer-vs-`fractions.Fraction` deviation bound are claims a reviewer should re-derive from the test harness rather than take on our word.

**Lawson Fairness Floor** — minimum guarantees in cooperative games with Sybil resistance. A design we are exploring; specced, not yet an audited contract.

**Proof of Mind** — cognitive work as consensus security. Contracts exist in `contracts/core/ProofOfMind.sol` and `contracts/pom/`; the consensus-security property is design intent, not a demonstrated live result.

These aren't only in a paper. They're in 438 Solidity contracts with 591 Foundry test files (unit + fuzz + invariant, run per-module — the full suite OOMs a 16GB machine, so there is no single all-green number).

### 2. A Live Case Study in Human-AI Co-Development

One human. One AI copilot. As of this pitch (April 2026): 57 days, 2,306 commits, 482,886 lines of code across four languages. (Development has continued since; a reader running `git log` today will see a higher count against a later HEAD.)

This is not a productivity anecdote. This is a **reproducible methodology** with formalized patterns:

- **Anti-Amnesia Protocol** — Write-ahead logging for AI sessions. Crash recovery across context window resets. The AI resumes exactly where it stopped, not from scratch.
- **Session State Chains** — Each session writes a block header (parent hash, HEAD, status, artifacts, next steps). Sessions form a hash-linked chain. Full state reconstruction without storing full state.
- **Mitosis Constant** — Formal model for when to spawn parallel AI agents (k=1.3, cap=5). Derived from empirical observation, not guesswork.
- **Shard Architecture** — Full-clone agents over swarm agents. Each gets complete context. Symmetry over specialization.
- **Verification Gates** — The discipline is that the AI does not claim success without proof: assertions are meant to be backed by a test, a build, or a git hash. This is an enforced working norm, not a formal guarantee against every lapse.

These patterns produced 49 commits per active day sustained over 47 days. They are **transferable** — any research group could adopt them tomorrow.

### 3. Publishable Research — Already Written

| Output | Count | Status |
|---|---|---|
| ethresear.ch formal posts | 10 | Written, ready to submit |
| Nervos community research posts | 45 | Published |
| Research papers in `docs/research/papers/` | ~122 | Documented |
| Broader internal docs / essays | several hundred | Drafted, varying maturity |

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

- **Compute** — Our compilation takes ~10 minutes on consumer hardware. Our test suite spans 591 Foundry files and cannot run as one pass on a 16GB machine — it OOMs, so we run per-module. Our fuzz campaigns need parallelization. We hit the ceiling not at the design level but at the hardware level.
- **Research community** — The mechanism design work needs peer review from people who study cooperative game theory, auction design, and MEV formally. That's here.
- **Academic credibility** — These patterns deserve to be studied, not just used. A research partnership puts them where they can be examined, challenged, and improved.

---

## What a Partnership Looks Like

| We Contribute | MIT Contributes |
|---|---|
| Working codebase (438 contracts, 591 test files, full frontend + oracle) | Compute infrastructure |
| 10 ethresear.ch posts ready for co-authorship | Research supervision and peer review |
| AI co-development methodology (documented, reproducible) | Academic context and publication channels |
| Ongoing development velocity (49 commits/day, accelerating) | Student researchers who want real systems to study |
| Open problems in mechanism design, game theory, AI collaboration | The rigor to formalize them |

### Concrete Deliverables

1. **Joint publication on AI-augmented development patterns** — The anti-amnesia protocol, session state chains, and mitosis constant adapt known ideas (write-ahead logging, hash-linked state, spawn heuristics) specifically to the AI-session context. We haven't found these formalized for that setting; establishing genuine novelty against prior art is exactly the kind of rigor a research co-author brings.

2. **Mechanism design paper on MEV dissolution** — A draft argument and adversarial simulation exist; the formal proof still wants the rigor of a game-theorist co-author. That review, plus the weight of an institutional co-author, is exactly what's needed to reach the right audience.

3. **Shapley fairness verification framework** — intended to be released under a permissive license (repo-wide license terms are still being finalized; tooling is intended as MIT), protocol-independent. Useful to any project doing on-chain reward distribution. A tool the community can use, with MIT's name on it.

4. **Case study: 2,306 commits in 57 days** — What happens when you give one builder and one AI a methodology and no resources? What happens when you give them resources? The before/after writes itself.

---

## The Numbers (Appendix)

```
57 calendar days  ·  47 active  ·  2,306 commits  ·  49/day avg  ·  386 peak day

Contracts:   438 files  ·  110,728 lines  ·  34 module dirs
Tests:       591 files  ·  196,325 lines  ·  run per-module (no single full-suite pass — OOMs 16GB)
Frontend:    460 files  ·  161,977 lines
Oracle:       74 files  ·   13,856 lines
Total:     1,420 files  ·  482,886 lines

Net lines written: 1,058,613
Rendered docs (PDF/DOCX): ~176 on disk
Research papers (docs/research/papers): ~122

Weekly velocity:
  Wk 05:     6    Wk 10:   366
  Wk 06:    16    Wk 11:   852 ← peak
  Wk 07:   263    Wk 12:   195
  Wk 08:   226    Wk 13:   369
```

The repository is public: **github.com/wglynn/vibeswap**

The file counts (438 contracts, 591 test files) are verifiable today with `find`; the commit/day figures above are a dated April-2026 snapshot and will read higher against current HEAD (`git log`). The mechanism claims are verifiable by reading the contracts and running the per-module tests. Note: none of this is on a public network yet — see the repo README status section for what is and isn't deployed.

---

*We have what you study. You have what we need. Let's make something neither of us can make alone.*
