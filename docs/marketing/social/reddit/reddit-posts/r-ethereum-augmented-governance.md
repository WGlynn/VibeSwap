# r/ethereum — "What if governance capture could be made mathematically hard?"

**Subreddit**: r/ethereum
**Flair**: Discussion / Research

---

**Title**: What if a 51% governance vote to extract funds could be automatically blocked by math?

**Body**:

Governance capture is the biggest unsolved problem in DeFi DAOs. Compound lost $25M to a single whale vote. Beanstalk lost $182M to a flash loan governance attack. Curve Wars turned governance into a bribery marketplace.

The standard fixes — timelocks, multisigs, optimistic governance — all delay extraction but don't prevent it.

We built something different: **Shapley value axioms encoded as on-chain invariants designed to autonomously veto governance proposals that violate fairness.**

(Status, up front: this is a reference implementation with tests, not a deployed system. Nothing here is on a public mainnet or testnet yet — the repo is mid-pivot to a sovereign chain. Read the below as "here's the mechanism and here's the simulation showing it holds," not "this is live and battle-tested.")

How it works:

- Five axioms from cooperative game theory are enforced at the contract level (efficiency, symmetry, null player, pairwise proportionality, time neutrality)
- Any governance proposal is checked against these axioms before execution
- If a proposal violates an axiom — like voting to enable protocol fee extraction when the protocol contributed zero liquidity (null player axiom) — the design intent is that it's blocked automatically at the execution boundary
- The autonomous verifier is fail-closed: `GovernanceGuard.execute()` reverts if the axiom-verifier is unset or refuses the proposal, so it doesn't depend on a human signer being honest or available. (There's still a human veto-guardian and an emergency-guardian path in the contract as a backstop during the timelock window — the goal is that the *math* layer needs no human, not that we've removed humans entirely.)

**The hierarchy**: Physics (Shapley invariants) > Constitution (fairness axioms) > Governance (DAO votes)

Governance votes freely on everything that doesn't violate fairness. Fee tiers, grants, parameters, upgrades — all fine. Extracting from LPs? Math says no.

We tested this with a Foundry simulation (`test/simulation/ExtractionDetection.t.sol`) — 9 tests including 2 fuzz tests at 256 runs each. In that simulation every modeled extraction attempt was detected, and the self-correction test restores fair allocation. That's a simulation result against the reference contracts, not a claim about adversarial behavior on a live network — the honest scope is "the mechanism holds under the cases and fuzzing we threw at it," not "provably unbreakable."

The approach is called "Augmented Governance" — same pattern as augmented mechanism design. Keep the core (democracy), add armor (math).

Paper + code: https://github.com/WGlynn/VibeSwap

Curious what this community thinks — what governance attacks could survive Shapley axiom enforcement?
