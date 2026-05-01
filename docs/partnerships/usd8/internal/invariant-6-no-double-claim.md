# Invariant #6 — No Double-Claim Across Cover Providers
## Composing the full layered defense

*USD8 Cover Pool architecture proposal · 2026-04-30 · revision 2*

---

## The full 6-invariant stack

The existing 5-invariant stack defends the *intra-USD8* attack surface. Invariant #6 adds the *inter-provider* attack surface. Composed:

| # | Invariant | What it defends |
|---|-----------|-----------------|
| 1 | VaR cap at pre-event snapshot | Caps payout at f(pre-event cover position). Hacker recovers at most the $X they had at risk — never net-profits from the exploit. |
| 2 | Pre-event snapshot semantics | Hacker cannot grow their cover position after causing the event. |
| 3 | Shapley pairwise-proportionality (5th axiom) | Anti-cumulative attack — attacker cannot grow share by attacking the substrate. |
| 4 | Forfeiture-as-gate | Pre-release dispute window: attack-claims voided and cover positions forfeited via on-chain forensic evidence. |
| 5 | Fibonacci-damped per-holder rate | No preferred timescale under which accumulation can hide. |
| 6 | **No double-claim across providers (NEW)** | Σ payouts across all cover providers ≤ actual loss. |

**Layered defense against hacker self-dip:** invariants 1, 2, 4 prevent the hacker from receiving payouts they shouldn't. Invariant #6 prevents *anyone* (legitimate victim or hacker) from collecting more than actual loss in aggregate across multiple cover providers. Different attack surfaces; composed, not overlapping.

---

## On identity (and why pseudonymity doesn't break this)

Addresses are pseudonymous. Transactions aren't. An exploit creates a public transaction graph: exploit contract → drain target → recipient addresses. During the invariant #4 dispute window, anyone — whitehats, oracles, automated forensic tools — can submit on-chain proof that a claimant address sits in the exploit graph. The contract voids the claim and forfeits the cover position.

**Bonded forensics** make this robust: the forensic proof submitter posts a bond; if the proof is wrong, the bond is forfeit. Asymmetric incentive — cheap for honest forensics, expensive for griefing. (This maps onto VibeSwap's Verified-Compute primitive.)

The defense doesn't require knowing *who* a claimant is. It requires knowing what their address *did* — which on-chain transaction graphs tell us.

---

## Invariant #6 — what it is and is not

**What it is:** the math constraint Σ payouts ≤ actual loss across all participating cover providers. Closes the gap between USD8 cover pool and any peer cover product paying out to the same claimant for the same event.

**What it is not:** a hacker-identification mechanism. Invariants 1–4 (above) are the hacker filter. Invariant #6 operates on legitimate cross-provider aggregate.

---

## Three-phase implementation

| Phase | Mechanism | When |
|-------|-----------|------|
| **1** | Bilateral on-chain subrogation. At payout, claimant's rights-of-claim against peer cover providers transfer to USD8 atomically. Peer provider verifies the rights-transfer before paying. | First peer-provider deal. Pragmatic; low coordination cost. |
| **2** | Shapley-distributed simultaneous payout. All consortium providers compute their Shapley share and pay atomically in one transaction. Total payout distributed by the efficiency axiom Σ φ = v(N). | Consortium of 3+ providers. **Architectural end state.** |
| **3** | Oracle-attested loss-event registry + Shapley-distributed payout. Loss verified by neutral oracle, total cap enforced cross-provider without requiring direct cooperation. | Permissionless coverage market. |

---

## Why Phase 2 is the architectural end state

Phase 1 (subrogation) **defends against** double-claims by detecting and rejecting them. The attack attempt still exists, it just gets caught.

Phase 2 (Shapley-distributed simultaneous payout) **dissolves** double-claims as a category. The payout is computed once across all participating providers and split atomically by Shapley axioms — there is no "second claim" to attempt. Defense is replaced by structural impossibility.

This is the standard VibeSwap mechanism-design grammar (Hobbesian Trap Dissolution). Phase 1 ships first because it has lower coordination cost; Phase 2 is what the architecture commits to as the end state.

---

## Why Shapley specifically

Cover providers form a cooperative game: each contributes marginal coverage capacity to the joint coalition. When a loss event triggers, the question "which provider pays how much?" is exactly the question Shapley axioms uniquely answer for cooperative games.

The five-axiom set (efficiency, symmetry, dummy, additivity, pairwise-proportionality) guarantees by construction:

- **Σ payouts = actual loss** — efficiency axiom; this *is* invariant #6, math-enforced
- **Symmetric providers pay symmetric shares** — fairness across peers
- **Pairwise-proportionality** — the on-chain anti-collusion axiom (USD8-specific 5th axiom)

Same Shapley infrastructure as USD8's intra-pool LP distribution, applied to the inter-provider coordination problem. One mechanism, two surfaces.

---

## Two-faced anti-extraction stack

The cover-pool architecture composes with the white-hat Lindy bounty as one anti-extraction stack with two faces:

- **Pre-event:** white-hat bounty rewards vulnerability discovery before exploitation.
- **Post-event:** forensics-during-dispute (invariant #4 + bonded forensics) rewards on-chain identification of attack-claims after a loss event.

Both faces draw from the same funding spine — cover-pool revenue allocates a fraction to each. The combined stack reduces extraction probability *before* AND *after* exploits, with funding aligned by construction.

---

## Open question for Phase 1

The first bilateral subrogation partner determines the contract pattern that propagates to Phases 2–3.

Suggested candidate: **Nexus Mutual** — mature on-chain claims registry, established subrogation precedent in DeFi, asset-class overlap with USD8 cover scope.

Alternative candidates available for discussion based on USD8's preferred risk-class focus.

---

## Indicative sequencing

- **2026 Q2** — Phase 1: bilateral contract draft with first peer cover provider
- **2026 Q3–Q4** — Phase 2: consortium architecture; Shapley-distributed payout contracts
- **2027+** — Phase 3: oracle-attested registry; permissionless integration
