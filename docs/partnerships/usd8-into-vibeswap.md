# USD8 Into VibeSwap — Integration Spec

**Date**: 2026-04-27
**Status**: Decision drafted, partnership-direction artifact
**Audience**: VibeSwap-internal first; Rick-facing-ready

---

## Frame

We've shipped six artifacts showing how VibeSwap primitives port outward into USD8 (Shapley fee routing, augmented mechanism design, Cover Pool fairness fixed-point, etc.). This doc reverses the direction: how does USD8 land *inside* VibeSwap?

The answer is one decision. Everything else cascades.

## Decision

**VibeSwap pays LP fees in USD8.**

That's the whole integration. One line in `ShapleyDistributor` changes the payout asset from native/native-stable to USD8. Every other USD8 integration point follows from this without a separate design battle.

## Why this is the right pick

Both protocols are Shapley-grounded. The substrate-match move — the "as above, so below" pick — is the integration where the same math runs on both sides of the boundary, and the resulting composition is fee-on-fee, not protocol-on-protocol.

Other candidates considered:

- **USD8 as treasury reserve only**: low blast radius, but invisible to traders and to the partnership story. Doesn't compose math.
- **USD8 as canonical cross-chain asset**: clean infrastructure story, but doesn't compose math either — it's plumbing, not mechanism.
- **JUL/USD8 as gravity pair declared top-down**: brittle. Pairs that emerge from incentives are stickier than pairs we declare canonical.

LP-fees-in-USD8 dominates because it produces the gravity pair, the treasury accumulation, *and* the cross-chain story as side effects, while also composing the Shapley games.

## What follows

### Free (no extra mechanism — pure side effects)

1. **Treasury accumulates USD8.** DAOTreasury's protocol cut from LP fees becomes USD8-denominated by side effect. No separate "diversify treasury into USD8" project.
2. **JUL/USD8 emerges as the gravity pair.** LPs receiving USD8 fees prefer USD8-quoted pools so they can compound without converting. Liquidity migrates organically; we don't declare anything.
3. **TreasuryStabilizer's anchor collapses to USD8.** If Treasury is USD8 and USD8 holds peg, Treasury holds value. The stabilizer's job becomes "watch one peg" instead of "manage a basket."

### Cheap (small downstream wiring)

4. **CrossChainRouter routes USD8 natively.** USD8 is multi-chain by design; LayerZero V2 OApp already runs in VibeSwap. Bridging into a VibeSwap pool reduces to "bridge USD8 in." No per-chain stablecoin plumbing.
5. **ILProtection pays out in USD8.** LPs earn fees in USD8 and receive IL hedge in USD8. One unit of account through the whole LP lifecycle.
6. **Insurance / circuit-breaker reserves held in USD8.** Same coherence — reserves payable in the currency LPs already hold.
7. **Priority auction bids in USD8.** Currently bids use native gas token, which makes "$5 priority" mean "0.002 of whatever." USD8-denominated bids are interpretable across chains and through time.

### The actual prize (deep composition)

8. **Shapley-on-Shapley.** VibeSwap's Shapley distributor pays an LP in USD8 → that USD8 sits in the LP's wallet → USD8's Cover Pool Shapley distributes fees on USD8 transactional flow → the LP earns a second Shapley layer passively. Two fairness-fixed-points compose into one stack. Same math, same currency, fees stack without coordination.
9. **Shared Brevis verification stack.** USD8's Shapley spec already proposes Brevis-verified scoring. VibeSwap's Shapley distributor routes through the same proof stack. One ZK substrate, two protocols using it, marginal cost of the second integration approaches zero.

## Direction of partnership

This doc commits VibeSwap to USD8 as canonical. It does *not* commit USD8 to VibeSwap. That asymmetry is intentional — VibeSwap names a stable layer; USD8 keeps its sovereignty and its own roadmap. The partnership story lands as: *VibeSwap's stable layer is USD8, and USD8 holders earn from VibeSwap's flow without doing anything.*

Pull, not push. Rick decides whether and when to publicly endorse the integration. Until then this is a unilateral VibeSwap design move that happens to compose with USD8's math.

## Open / out of scope

- **Peg-anchor liability.** If USD8 ever depegs, VibeSwap LPs holding USD8 fee balances absorb the drawdown. Bound this via existing circuit-breaker primitives — not by avoiding the integration. Spec the circuit-breaker rule before shipping.
- **Governance coordination.** No governance handshake required for the integration itself. Required if VibeSwap's TreasuryStabilizer ever takes an active role in defending USD8's peg (out of scope here).
- **Timing.** Decision is independent of USD8's launch sequencing. VibeSwap can ship the LP-fees-in-USD8 change whenever USD8 is live; the cascade follows on its own clock.
- **Migration.** Existing LP positions earned in pre-USD8 currency don't auto-convert. Migration mechanic is a separate spec — likely "fee accrual in legacy currency continues to vest, new fees from cutover block onward in USD8."

## Single-line summary

One decision (LP fees in USD8) cascades into eight further consequences without any of them being a separate design battle. That's the substrate-match signature: the right pick is the one where everything downstream comes for free.
