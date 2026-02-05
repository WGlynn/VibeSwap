# Privacy Coin Support for VibeSwap

*Exploring atomic swaps with Monero, Zcash (shielded), and Dash using VibeSwap's design principles.*

---

## TL;DR

**The problem:** Privacy coins can't participate in VibeSwap's single-atomic-settlement model because cross-chain swaps require bilateral coordination.

**The solution:** Batch matching (for MEV resistance) + pairwise atomic swaps (for trustlessness) + bonded market makers (to mitigate counterparty risk).

**The guarantee:** Your funds are never at risk. Worst case = timeout refund + compensation from slashed bond. Best case = trustless cross-chain swap at a fair price.

**Why pairwise:** Every alternative (trusted bridges, federations, wrapped tokens) requires trusting someone with your funds. Pairwise is the only trustless option with current cryptography.

**The philosophy:** Manipulation is noise. Fair price discovery is signal. Batch auctions remove the noise—even for privacy coins.

---

## The Opportunity

Privacy coin holders are underserved. Most DEXs won't touch them, and the few that do offer poor UX or require trust. If VibeSwap can offer trustless, MEV-resistant swaps for privacy coins, that's a moat.

**Target pairs:**
- CKB ↔ Monero (XMR)
- CKB ↔ Zcash shielded (ZEC)
- CKB ↔ Dash (DASH)
- RGB++ assets ↔ Privacy coins

---

## The Challenge

Privacy coins don't play nice with traditional atomic swaps:

| Coin | Scripting | HTLC Support | Difficulty |
|------|-----------|--------------|------------|
| Dash | Basic | Yes | Medium |
| Zcash (transparent) | Yes | Yes | Medium |
| Zcash (shielded) | Limited | Complex | Hard |
| Monero | None | No | Hardest |

**Monero** is the hardest because it has no scripting at all. You can't do hash time-locked contracts natively.

**Shielded Zcash** adds zk-SNARK complexity on top of coordination challenges.

---

## Design Principles (Same as Core VibeSwap)

1. **No trust required** - Atomic or nothing
2. **MEV resistant** - Batch matching, not continuous
3. **L1 verification, L2 coordination** - CKB verifies, coordinator orchestrates
4. **Fairness** - No front-running, uniform execution
5. **User sovereignty** - Funds stay in user control until swap completes

---

## Architecture: Batch Matching + Atomic Settlement

Traditional atomic swaps are pairwise (Alice ↔ Bob). VibeSwap batches. Here's how we bridge that gap:

```
┌─────────────────────────────────────────────────────────────┐
│                    COMMIT PHASE                              │
│                                                              │
│  XMR sellers commit: "I'll sell X XMR for Y CKB"            │
│  CKB sellers commit: "I'll sell Y CKB for X XMR"            │
│                                                              │
│  Orders hidden, no one knows market direction                │
└─────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────┐
│                    BATCH MATCHING                            │
│                                                              │
│  L2 coordinator matches orders at uniform clearing price     │
│  Pairs users: Alice (selling XMR) ↔ Bob (buying XMR)        │
│  Multiple pairs matched simultaneously                       │
└─────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────┐
│                 ATOMIC SWAP EXECUTION                        │
│                                                              │
│  Each matched pair executes atomic swap protocol             │
│  CKB side: Lock in commitment cell                          │
│  XMR side: Adaptor signature protocol                       │
│  Either both succeed or both refund                         │
└─────────────────────────────────────────────────────────────┘
```

**Key insight:** We batch the *matching* for MEV resistance, then execute *atomic swaps* for trustless settlement. Best of both worlds.

---

## Monero Swaps: Adaptor Signatures

Monero can't do HTLCs, but it can do **adaptor signatures**. Here's the intuition:

**Traditional HTLC:**
- Alice locks funds with hash(secret)
- Bob locks funds with same hash
- Alice reveals secret to claim Bob's funds
- Bob uses revealed secret to claim Alice's funds

**Adaptor signatures (Monero):**
- Alice and Bob create partial signatures
- The signatures are mathematically linked
- Completing one signature reveals information needed to complete the other
- No on-chain hash required

**Protocol sketch for CKB ↔ XMR:**

```
1. SETUP
   - Alice (has XMR, wants CKB) and Bob (has CKB, wants XMR) are matched
   - They generate linked keypairs for the swap
   - Both sides create "adaptor" partial signatures

2. LOCK PHASE
   - Bob locks CKB in a commitment cell on CKB
     - Unlockable by: Alice's adaptor signature completion OR Bob after timeout
   - Alice locks XMR in a swap address on Monero
     - Spendable by: Bob's adaptor signature completion OR Alice after timeout

3. EXECUTION
   - Alice completes her adaptor signature to claim Bob's CKB
   - This reveals the secret needed for Bob to complete his signature
   - Bob uses the revealed secret to claim Alice's XMR

4. OUTCOME
   - Success: Alice has CKB, Bob has XMR
   - Timeout: Both reclaim their original funds
```

**CKB's role:** Verify the adaptor signature math. The Lock Script checks that Alice's signature completion is valid. The secret revelation is cryptographic, not hash-based.

### Intuitive Explanation: Why Adaptor Signatures Work

**HTLCs (how Bitcoin/Dash do it):**
- Alice picks a secret, shares hash(secret)
- Both sides lock funds: "unlock with secret OR refund after timeout"
- Alice reveals secret to claim one side
- Bob sees the revealed secret, uses it to claim the other side
- The hash preimage is the atomic link

**Problem:** Monero has no scripting. You can't say "unlock with secret." There's no conditional logic on-chain.

**Adaptor signatures solve this differently:**
- Instead of a hash secret, the secret is *embedded in the signature itself*
- Alice and Bob create "partial" signatures that are mathematically linked
- When Alice completes her signature to claim Bob's CKB, the act of completing it *automatically reveals* what Bob needs to complete his signature and claim Alice's XMR
- It's like two puzzle pieces—solving one exposes the solution to the other

**Why can't Alice cheat?**

Alice CAN get the full secret and claim Bob's CKB. But the act of claiming reveals the secret to Bob.

Her options:
1. Claim Bob's CKB → Bob sees the completed signature → Bob claims her XMR (swap happens)
2. Don't claim → timeout → both refund (swap doesn't happen)

There's no option where Alice takes Bob's CKB and keeps her XMR. The math doesn't allow it.

**Why can't Alice double-spend the XMR?**

The XMR isn't in Alice's wallet during the swap. It's locked in a swap address that can only be spent:
1. By Bob (using the secret Alice reveals when she claims)
2. By Alice after timeout (refund path)

Both sides give up control first. Then the atomic reveal happens.

**The elegance:** Bridges add complexity because they're solving for convenience at the cost of trust. Adaptor signatures solve for trustlessness at the cost of coordination. The crypto industry chose convenience—that's why we have $2B+ in bridge hacks. VibeSwap bets that people will accept coordination friction for actual trustlessness.

---

## Shielded Zcash: ZK Coordination

Shielded Zcash transactions use zk-SNARKs. The sender proves "I have the right to spend these notes" without revealing which notes.

**Challenge:** How do you atomically link a shielded ZEC transaction to a CKB transaction?

**Approach: Commit-reveal with ZK proofs**

```
1. COMMIT PHASE
   - Alice commits to selling shielded ZEC
   - She provides a ZK proof: "I control notes worth X ZEC"
   - The proof doesn't reveal which notes (privacy preserved)

2. LOCK PHASE
   - Alice creates a shielded transaction sending to a swap address
   - The transaction is encrypted but verifiably valid
   - Bob locks CKB on the CKB side

3. REVEAL PHASE
   - Alice reveals the viewing key for the swap address
   - Bob verifies the ZEC is there
   - Atomic swap completes via adaptor signatures

4. PRIVACY PRESERVED
   - Alice's source notes never revealed
   - Bob receives to his own shielded address
   - Only the swap amount is visible during coordination
```

**CKB's role:** Verify ZK proofs that the Zcash side is valid. CKB-VM can run SNARK verifiers (with cycle cost considerations).

---

## Dash: Simpler Case

Dash has basic scripting and supports HTLCs. It also has PrivateSend (CoinJoin mixing) for privacy.

**Approach:** Standard HTLC atomic swaps with optional PrivateSend pre-mixing.

```
1. PRE-SWAP (optional)
   - User mixes DASH through PrivateSend for privacy

2. ATOMIC SWAP
   - Standard HTLC between DASH and CKB
   - hash(secret) locks on both chains
   - Timeout refunds if incomplete

3. POST-SWAP (optional)
   - Recipient mixes received DASH for forward privacy
```

**CKB's role:** Standard hash verification in Lock Script. Same as Bitcoin-style atomic swaps.

---

## Integration with VibeSwap Batching

Here's how privacy coin swaps fit into the batch auction model:

**Commit phase:**
- Users commit orders: "sell X XMR for CKB at limit price Y"
- Orders are hidden (hash commitment)
- Privacy coin holders provide ZK proofs of funds (without revealing source)

**Reveal phase:**
- Orders revealed
- L2 coordinator matches at uniform clearing price
- Users paired for atomic swaps

**Settlement phase:**
- Instead of one atomic settlement tx, we have multiple atomic swap protocols running in parallel
- Each matched pair executes independently
- CKB commitment cells track swap state
- Timeouts ensure funds are never stuck

**Key difference from core VibeSwap:**
- Core VibeSwap: One atomic tx settles all orders
- Privacy coin swaps: Batch matching, but pairwise atomic settlement

The batch matching still provides MEV resistance. The pairwise settlement is necessary because we're crossing chain boundaries.

**Honest tradeoff:**
- Core VibeSwap guarantee: Everyone succeeds or everyone refunds (atomic)
- Privacy coin guarantee: Your swap succeeds or you refund + get compensated (pairwise + bonded MM)

The second is weaker but still trustless. You never lose funds—worst case is time delay plus compensation.

**Auto-retry on failure:**
If a matched MM fails to complete:
1. User's funds refund after timeout
2. MM's bond is slashed → user compensated
3. User's order is automatically re-queued for next batch
4. Coordinator deprioritizes failed MM (reputation hit)

This minimizes friction from counterparty failures.

---

## CKB Script Design for Atomic Swaps

**Lock Script: SwapLock**

```rust
// Unlockable by:
// 1. Counterparty completing adaptor signature (swap success)
// 2. Owner after timeout (swap failed/abandoned)

fn main() -> i8 {
    let swap_data = load_cell_data();

    match unlock_type {
        UnlockType::Complete => {
            // Verify adaptor signature completion
            // This proves counterparty revealed their secret
            verify_adaptor_signature(&swap_data)
        }
        UnlockType::Timeout => {
            // Verify timeout elapsed via header_deps
            // Return funds to original owner
            verify_timeout(&swap_data)
        }
    }
}
```

**Type Script: SwapType**

```rust
// Validates swap state transitions

fn main() -> i8 {
    // Verify swap parameters are valid
    // Check that both sides of swap are properly linked
    // Ensure timeout is reasonable
    // Verify counterparty info is correct
    verify_swap_integrity()
}
```

---

## Why Pairwise? The Alternatives Don't Work

Pairwise atomic swaps introduce counterparty liveness risk—if your counterparty disappears mid-swap, you wait for timeout. This is weaker than core VibeSwap's guarantee where atomic settlement means everyone succeeds or everyone refunds together.

So why not do something else?

**Alternative 1: Pooled liquidity with trusted bridge**
- How it works: Lock XMR with a custodian, get wrapped-XMR on CKB, trade in the batch
- Problem: **Requires trust.** The custodian can rug. This defeats the entire point.

**Alternative 2: Threshold signature federation**
- How it works: N-of-M signers custody the privacy coin side
- Problem: **Still trust.** You're trusting the federation won't collude.

**Alternative 3: ZK-proof of reserves**
- How it works: Prove you have XMR without revealing which outputs, then participate in batch
- Problem: **Doesn't solve settlement.** You still need someone to send the XMR after batch clears. Who?

**Alternative 4: Atomic batch with homomorphic encryption**
- How it works: Theoretically, encrypt all cross-chain components and reveal simultaneously
- Problem: **Doesn't exist.** The cryptography for this across heterogeneous chains isn't mature.

**The uncomfortable truth:** Cross-chain atomicity without trust requires bilateral coordination. There's no way around it with current cryptography. The best we can do is:
1. Accept pairwise as necessary
2. Mitigate the counterparty risk aggressively

### Intuitive Explanation

Why can't cross-chain swaps use VibeSwap's normal atomic settlement?

On CKB, one transaction consumes inputs and creates outputs atomically—the whole tx either commits or doesn't. You can put both sides of a swap in that single transaction.

But when Alice's XMR is on Monero and Bob's CKB is on CKB, there's no such thing as a transaction that spans both chains. Each chain only knows about itself. Those are two separate transactions on two separate chains, and neither chain can enforce what happens on the other.

**This is why bilateral coordination is required.** Alice and Bob have to take turns. And since they're taking turns, there's risk that someone stops mid-way.

### Why Not Just Use a Bridge?

"Lock your XMR with a custodian, get wrapped-XMR on CKB, trade that in the batch."

We reject this because the custodian is a trusted third party. They can rug. You're trusting them not to—that's not trustless, that's just traditional finance with extra steps.

Also: wrapped tokens are IOUs, not the real asset. Privacy coin holders want the real thing.

---

## Mitigating Counterparty Risk: Bonded Market Makers

If pairwise is unavoidable, we make counterparty failure expensive and rare.

### The Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                  BONDED MARKET MAKERS                        │
│                                                              │
│  Professional counterparties who:                           │
│  - Post CKB collateral (e.g., 150% of max swap size)        │
│  - Commit to completing swaps they're matched with          │
│  - Get slashed if they fail to complete                     │
│  - Earn fees for providing reliable counterparty service    │
└─────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────┐
│                    HOW IT WORKS                              │
│                                                              │
│  1. Market maker deposits bond on CKB                       │
│  2. They're matched with retail users in batch              │
│  3. If they complete the swap: earn fee, keep bond          │
│  4. If they fail to complete: bond gets slashed             │
│     - Slashed funds go to affected user as compensation     │
│  5. Reputation score tracks completion rate                 │
└─────────────────────────────────────────────────────────────┘
```

### Slashing Conditions

| Failure Mode | Consequence |
|--------------|-------------|
| MM fails to lock funds after match | Bond slashed, user refunded + compensated |
| MM locks but abandons mid-swap | Bond slashed after timeout, user refunds + compensated |
| MM completes swap normally | Bond intact, MM earns fee |
| User fails to complete | No slash (user has no bond), MM refunds after timeout |

### Graduated Slashing: Fail Fast Incentive

Not all failures are equal. An MM who aborts early wastes less of the user's time than one who ghosts.

| Failure Mode | Penalty | User Experience |
|--------------|---------|-----------------|
| Early active abort (MM signals "can't complete") | Smallest slash | Funds back fast |
| Late active abort | Medium slash | Funds back after some delay |
| Full timeout / ghost | Maximum slash | Funds back after full timeout |

**The logic:**
- Active abort is always better than ghosting (for MM)
- Early abort is always better than late abort (for MM)
- User always gets compensated, more if MM wasted more time

This creates a "fail fast" incentive. MMs who know they can't complete are rewarded for aborting quickly rather than dragging it out. The penalty could scale logarithmically with time elapsed.

**MM's optimal strategy:**
1. Complete the swap (best: earn fee, keep bond)
2. If you can't, abort early and actively (smallest slash)
3. Never ghost (maximum slash)

### Why This Works

**Economic alignment:** MMs have skin in the game. Abandoning a swap costs more than completing it.

**Reputation compounding:** High completion rate = more matches = more fees. Reputation is an asset worth protecting.

**User protection:** Even if MM fails, user gets their funds back (timeout refund) PLUS compensation from slashed bond.

**Still trustless:** The bond and slashing are enforced by CKB smart contracts. No one can stop the slash if conditions are met.

### Intuitive Explanation: Why Bonded MMs Work

**The problem:** Pairwise swaps mean you need a counterparty. If your counterparty disappears mid-swap, you wait for timeout. That's annoying.

**The solution:** Make counterparty failure expensive.

Bonded market makers post collateral before they can participate. If they fail to complete a swap, they get slashed—and the slashed funds go to the affected user.

**Alice's worst case (MM disappears):**
1. She waits for timeout
2. Her XMR refunds back to her (she never lost it)
3. She gets compensation from the slashed bond

She's not just made whole—she actually profits from the failure. The only thing she lost was time.

**MM's worst case (they abandon a swap):**
- Loses bond (given to Alice)
- Gets reputation hit (fewer future matches = less fee income)
- Made less money than if they'd just completed the swap

**The incentive alignment:** Completing swaps is more profitable than abandoning them. Dishonesty is expensive.

This is the same security model as proof-of-stake. We don't trust MMs to be honest—we make dishonesty cost more than honesty.

### Who Becomes a Market Maker?

- Existing OTC desks wanting to expand to DEX
- Arbitrageurs who profit from cross-chain price differences
- Privacy coin holders who want yield on their holdings
- Professional trading firms

The fees for reliable cross-chain swaps are attractive. The bond requirement filters out uncommitted participants.

---

## Trust Assumptions (Updated)

| Component | Trust Required | Why |
|-----------|---------------|-----|
| L2 Coordinator | Liveness only | Can't steal (atomic), can only delay |
| CKB | Consensus | Verifies all swap math |
| Privacy chain | Consensus | Each chain verifies its side |
| Adaptor signatures | Cryptographic | Math guarantees atomicity |
| Market Makers | **Economic** | Bonded, slashable—failure is expensive |

**Key insight:** We've converted trust from "hope they're honest" to "they'd lose money being dishonest." This is the same security model as proof-of-stake.

**Worst case for users:**
- Swap fails → get funds back via timeout
- MM was slashed → receive compensation
- No permanent loss, just time delay

**No trusted third party for funds.** Either the swap completes atomically, or both sides refund. The bond system just makes completion much more likely.

---

## Future Consideration: L3 Persistent Order Book

Current design is L1 (CKB settlement) + L2 (stateless batch coordinator). A natural extension:

- **L1 (CKB):** Settlement, verification
- **L2 (Stateless):** Batch matching, commit-reveal
- **L3 (Stateful):** Persistent order book, feeds L2, re-commits unfilled

```
User → L3 (stores order) → L2 (batches) → L1 (settles)
         ↑                       |
         └── unfilled orders ←───┘
```

**Benefits:**

1. **Persistence:** "Set and forget" limit orders without adding complexity to L2.

2. **Reliability:** L3 handles commit/reveal on user's behalf. User's internet drops mid-batch? L3 still reveals. Solves the "what if I go offline" problem—user expresses intent, L3 executes reliably.

3. **Simplicity:** L2 stays stateless and auditable. L3 handles the messy state management.

4. **Competition:** L3 could be multiple competing front-ends (wallets, UIs, bots). Users choose their preferred interface.

**The insight:** L3 isn't just for convenience—it's for reliability. Fast batch cycles + unreliable user connections = unfair slashing without a delegated reveal mechanism.

**Status:** Documenting for later evaluation. Current priority is proving the core L1/L2 model.

---

## Open Questions

1. **ZK verifier cycles:** Can CKB-VM efficiently verify Zcash SNARKs? Need to benchmark cycle costs.

2. **Monero view keys:** For swap coordination, some privacy is temporarily reduced. How much is acceptable?

3. **Timeout coordination:** Different chains have different block times. How do we set safe timeouts?

4. ~~**Liquidity fragmentation:** Pairwise swaps need counterparties. Low liquidity = slow matching.~~
   **Addressed:** Bonded market makers provide reliable counterparty liquidity. They're incentivized by fees and protected by bonds.

5. **Regulatory:** Privacy coins are hot. What jurisdictions can we operate in?

6. **Bond sizing:** What's the optimal bond-to-swap-size ratio? Too low = MMs can profit from abandonment. Too high = capital inefficient.

---

## Roadmap

**Phase 1: Dash support**
- Simplest privacy coin (has HTLCs)
- Prove out the batch-match + atomic-settle architecture
- Build coordinator infrastructure

**Phase 2: Monero support**
- Implement adaptor signature protocol
- More complex but huge demand
- Partner with existing XMR atomic swap projects (Farcaster, etc.)

**Phase 3: Shielded Zcash**
- Hardest technically
- Biggest privacy guarantees
- May require custom ZK circuits

---

## Why This Matters

Privacy is a feature, not a bug. People have legitimate reasons to want financial privacy:
- Protecting business operations from competitors
- Personal safety (not broadcasting wealth)
- Political dissidents
- Basic human dignity

VibeSwap's philosophy: fair, MEV-resistant trading for everyone. "Everyone" includes privacy coin holders. If we can serve them without compromising on trustlessness, that's aligned with the mission.

**The bonded MM approach is philosophically consistent:**
- We don't introduce trust—we convert it to economic incentive
- We don't weaken guarantees—we honestly frame what's possible
- We don't exclude users—we find ways to serve them safely

This is the same approach CKB takes with its economic model: align incentives so that honest behavior is profitable and dishonest behavior is expensive.

**On price truth:**

A manipulated price isn't a "true" price—it's distorted by front-running, information asymmetry, exploiter advantage. Manipulation is noise.

A price from a fair mechanism—no one can cheat, orders count equally, supply meets demand without interference—is closer to truth because it reflects genuine market sentiment.

MEV-resistant batch auctions don't just produce fairer prices. They produce more *accurate* prices. Remove the noise, get closer to signal. This applies to privacy coin swaps just as much as any other trading pair.

---

*This is exploratory. Technical validation needed, especially for Monero adaptor signatures and Zcash ZK verification on CKB-VM. The bonded MM architecture needs economic modeling to determine optimal bond ratios and fee structures.*
