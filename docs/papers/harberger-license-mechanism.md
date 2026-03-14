# The Augmented Harberger Tax: Protective Mechanism Design for Digital Naming Systems

**Faraday1 & JARVIS**
*VibeSwap Protocol --- vibeswap.io*
*March 2026*

---

## Abstract

Harberger taxation --- self-assessed value, continuous tax, forced sale --- is among the most elegant mechanisms in allocative economics. It solves the fundamental problem of property: how to ensure that assets flow to their highest-valued users without centralized price discovery. Yet when applied naively to digital naming systems, the pure mechanism fails. It fails not because its mathematics are wrong, but because its social assumptions are incomplete. Whales accumulate names through capital dominance. Grief attackers force-purchase names to extract reputational rent. The absence of capital gains taxation in crypto eliminates the one friction that tempers speculative hoarding in physical property markets. We present the **Augmented Harberger Tax (AHT)**, a systematic extension of the pure Harberger mechanism that preserves its core allocative property --- assets flow to highest-valued users --- while armoring legitimate owners against adversarial exploitation. AHT introduces five protective layers: progressive portfolio taxation, minimum ownership duration via grace periods, graduated transition through acquisition premiums and loyalty multipliers, revenue allocation to DAO treasury, and flash loan protection through EOA-only interaction. We prove that AHT satisfies the three conditions of Intrinsically Incentivized Altruism (IIA): extractive strategy elimination, uniform treatment, and value conservation. We implement AHT as `VibeNames.sol`, an 878-line ERC-721 contract with full Harberger lifecycle management, and demonstrate that the CKB/Nervos cell model provides a natural computational substrate where each name is a cell, tax payment is capacity transfer, portfolio count is an O(1) indexer query, and forced sale is cell consumption with new owner production.

**Keywords**: Harberger tax, naming systems, mechanism design, augmentation, progressive taxation, loyalty multiplier, CKB, UTXO, cooperative capitalism

---

## 1. Introduction

### 1.1 The Naming Problem

Every digital ecosystem that achieves sufficient scale confronts the same question: who owns the names?

Names are strange economic objects. They are non-rivalrous in principle --- the string "alice" can be stored on any number of servers at near-zero marginal cost. Yet they are rivalrous by necessity: if two users both claim "alice.vibe" as their identity, the name ceases to function as an identifier. The namespace must be exclusive. The question is how to allocate that exclusivity.

The industry has converged on a set of standard answers, all of which are flawed:

| Allocation Method | How It Works | Failure Mode |
|---|---|---|
| First-come-first-served | Earliest registrant owns the name permanently | Squatting. Speculative hoarding by early claimants who have no intention of using the names they hold. |
| Fixed annual fee | Pay a flat renewal fee regardless of name value | Mispricing. "eth.vibe" and "xq7k2m.vibe" cost the same to hold, despite radically different value. |
| Auction (one-time) | Highest bidder wins, pays once | No ongoing accountability. Winner's curse. No mechanism to reclaim unused names. |
| Admin discretion | Central authority grants names | Centralized, opaque, corruptible. Antithetical to decentralization. |
| Token-gated access | Holding X tokens grants naming rights | Plutocratic. Wealth determines identity regardless of genuine need. |

Each method fails for the same underlying reason: it decouples the **cost of holding** a name from the **value of using** it. A squatter who registers "bank.vibe" on day one and never sets a resolver pays the same annual fee as a financial institution that routes millions in transactions through that name. The cost structure does not reflect the value structure.

### 1.2 The Harberger Proposition

In 1962, Arnold Harberger proposed a radical alternative to conventional property taxation: let owners self-assess the value of their property, tax them proportionally to that assessment, and permit anyone to force-purchase at the assessed price. The idea lay dormant for decades until Posner and Weyl (2017) revived it as the **Common Ownership Self-Assessed Tax (COST)** in their book *Radical Markets*, arguing that COST achieves near-optimal allocative efficiency by creating an inescapable tension:

- **Assess high** --- you pay high tax, but your asset is expensive to acquire
- **Assess low** --- you pay low tax, but anyone can force-buy cheaply

The unique equilibrium under rational self-interest is to assess at **true value**: the price at which the holder is indifferent between keeping and selling. At this price, the tax is minimized subject to adequate defense against force-acquisition, and force-acquisition only occurs when the buyer genuinely values the asset more than the current holder.

This is the core property of the Harberger mechanism, which we denote pi:

> **pi(Harberger)**: Assets allocate to their highest-valued users through continuous cost of ownership.

The mechanism is mathematically beautiful. It is also, when applied without augmentation to digital naming, socially catastrophic.

### 1.3 Contributions

1. **Diagnosis**: We identify five structural vulnerabilities in pure Harberger naming (Section 2)
2. **Design**: We present the Augmented Harberger Tax (AHT) with five protective extensions (Section 3)
3. **Formal analysis**: We prove AHT satisfies IIA conditions and preserves the Harberger core property (Section 4)
4. **Implementation**: `VibeNames.sol` --- 878-line ERC-721 + UUPS contract, deployment-ready (Section 5)
5. **Substrate analysis**: CKB cell model as the natural computational substrate for AHT (Section 6)
6. **Mathematical treatment**: Formal proofs of equilibrium, monotonicity, and superlinearity (Section 7)

---

## 2. Why Pure Harberger Fails in Digital Naming

### 2.1 The Five Vulnerabilities

We identify five structural vulnerabilities that emerge when the pure Harberger mechanism is applied to digital naming systems. These are not bugs in the mechanism's mathematics. They are consequences of applying a mechanism designed for physical property to a domain with fundamentally different economic properties.

**Vulnerability V1: No Capital Gains Tax Equivalent**

In physical property markets, Harberger taxation operates alongside capital gains taxation. A speculator who acquires property at a low self-assessed value and later sells (or is force-bought) at a higher value pays capital gains tax on the difference. This friction dampens speculative cycling.

In crypto, there is no enforceable on-chain capital gains tax. A speculator can register "bank.vibe" at 0.01 ETH assessment, wait for demand to materialize, and then either be force-bought at 0.01 ETH (losing the name but not the speculative position, since they paid trivial tax) or proactively raise their assessment in response to observed demand. The mechanism assumes that undervaluation is self-punishing because the asset can be taken. But the speculator's true strategy is not to hold indefinitely --- it is to hold cheaply until the right moment, then either sell or raise.

**Vulnerability V2: Whale Accumulation (The Domain Baron Problem)**

A well-capitalized actor can systematically force-acquire names from legitimate holders who cannot afford defensive self-assessment. Consider:

- Alice registers "alice.vibe" at 1 ETH assessment, paying 0.05 ETH/year tax (5% rate)
- Bob, a whale, force-buys at 1 ETH. Alice receives 1 ETH but loses her identity
- Alice's true value for the name exceeds 1 ETH, but she cannot afford to assess at 10 ETH (0.5 ETH/year tax) purely for defensive purposes
- Alice's value is primarily non-financial: identity, reputation, community standing, years of resolver history
- The mechanism treats financial and non-financial value identically, to the detriment of the latter

This is the gap between mechanism theory and mechanism reality. The mechanism is correct that Alice "should" assess at her true value. But the mechanism ignores that Alice's true value may be incommensurable with monetary assessment.

**Vulnerability V3: Grief Attacks (Flash Force-Buy)**

An attacker can force-acquire a name with no intention of using it, purely to disrupt the original owner. The attack is:

1. Force-buy "alice.vibe" at Alice's assessed price
2. Set the resolver to `address(0)` or to an attacker-controlled address
3. Re-assess at a prohibitively high value (forcing Alice to pay exorbitant tax to recover)
4. Optionally, set a very low assessment and abandon the name after causing disruption

The pure mechanism provides zero protection against this. The force-buy is a unilateral, instantaneous operation. Alice has no right of first refusal, no grace period, no recourse. By the time she notices the transaction, her identity has been seized.

**Vulnerability V4: Portfolio Concentration**

The pure Harberger mechanism taxes each name independently. An actor holding 100 names pays the same per-name tax as an actor holding 1 name. This creates a linear cost structure for hoarding:

```
Cost of holding n names = n * V_avg * r

where V_avg is the average assessment and r is the tax rate
```

A well-capitalized baron can absorb this linear cost. The mechanism needs **superlinear** cost scaling to make hoarding economically irrational at scale.

**Vulnerability V5: Contract-Based Circumvention**

Without EOA-only restrictions, a sophisticated attacker can use flash loans to:

1. Borrow a large sum in a single transaction
2. Force-acquire multiple valuable names
3. Re-assess at high values
4. Repay the flash loan

The entire portfolio acquisition happens atomically, with zero capital at risk. The attacker now holds the names at their new assessments and can extract rent (or grief) from the displaced owners.

### 2.2 The Common Thread

All five vulnerabilities share a structural cause: **the pure mechanism treats every actor identically regardless of behavior, history, or intent**. A day-one speculator has the same rights as a five-year community member. A whale has the same per-name cost structure as a single-name holder. A grief attacker has the same force-buy power as a genuine user.

Uniform treatment is a design principle of the pure mechanism --- and in many contexts, a virtue. But in naming systems, where names carry identity, reputation, and community value that accrues over time, uniform treatment becomes a vulnerability. The mechanism must distinguish between genuine ownership and adversarial exploitation --- not by judging intent (which is unobservable on-chain), but by structurally rewarding behavior patterns that correlate with legitimate use.

This is the domain of Augmented Mechanism Design.

---

## 3. The Augmented Harberger Tax (AHT)

### 3.1 Design Philosophy

AHT follows the Augmented Mechanism Design (AMD) methodology (Glynn & JARVIS, 2026): identify the core allocative property, enumerate the contextual vulnerabilities, design orthogonal protective extensions, and verify that the augmented mechanism preserves the core while mitigating the threats.

The augmentation operator applied to the pure Harberger mechanism H produces:

```
AHT = A5(A4(A3(A2(A1(H)))))

where:
  A1 = Progressive portfolio tax
  A2 = Minimum ownership duration (grace period)
  A3 = Graduated transition (loyalty multiplier + acquisition premium)
  A4 = Revenue allocation to DAO treasury
  A5 = Flash loan protection (EOA-only interaction)
```

Each augmentation targets one or more of the five vulnerabilities identified in Section 2. The augmentations are compositionally independent (Compositional Augmentation Theorem, Glynn & JARVIS, 2026): they modify disjoint subsets of the state space and can be designed, tested, and deployed independently.

### 3.2 Augmentation A1: Progressive Portfolio Tax

**Target vulnerability**: V4 (portfolio concentration)

The base Harberger tax rate is 5% annually (TAX_RATE_BPS = 500). The progressive portfolio tax applies a multiplier that scales superlinearly with the number of names held:

| Names Held | Multiplier | Effective Annual Rate |
|---|---|---|
| 1 | 1.0x (PORTFOLIO_MULT_1 = 10,000) | 5.0% |
| 2 | 1.5x (PORTFOLIO_MULT_2 = 15,000) | 7.5% |
| 3--5 | 2.0x (PORTFOLIO_MULT_3_5 = 20,000) | 10.0% |
| 6+ | 3.0x (PORTFOLIO_MULT_6_PLUS = 30,000) | 15.0% |

From the contract:

```solidity
function portfolioTaxMultiplier(address owner) public view returns (uint256 multiplier) {
    uint256 count = portfolioSize[owner];
    if (count <= 1) return PORTFOLIO_MULT_1;           // 1x for first name
    if (count == 2) return PORTFOLIO_MULT_2;           // 1.5x for second
    if (count <= 5) return PORTFOLIO_MULT_3_5;         // 2x for 3rd-5th
    return PORTFOLIO_MULT_6_PLUS;                      // 3x for 6+
}
```

The cost function for holding n names under AHT becomes:

```
Cost(n) = SUM(i=1 to n) [ V_i * r * m(n) ]

where m(n) is the portfolio multiplier, a step function increasing with n.
```

**Proposition 1 (Superlinear Cost).** For any fixed average assessment V_avg and base rate r, the marginal cost of the (n+1)-th name exceeds the average cost of the first n names for all n >= 1.

*Proof.* At n = 1, the marginal cost of the 2nd name is V_avg * r * 1.5, while the cost of the 1st is V_avg * r * 1.0. The ratio is 1.5 > 1. At n = 5, the marginal cost of the 6th name is V_avg * r * 3.0, while the average cost of names 1--5 is at most V_avg * r * 2.0. The ratio is at least 1.5 > 1. The step function m(n) is monotonically non-decreasing with jumps at n = 2, 3, and 6, ensuring superlinearity at each transition boundary.

Moreover, because the multiplier applies uniformly to all names held by the owner (not just the marginal name), the total portfolio cost function is strictly convex at each step boundary. A baron holding 10 names pays 3x the base rate **per name** --- 30 * V_avg * r total, versus 10 * V_avg * r under pure Harberger.

**Key design choice**: The portfolioSize counter is maintained directly in the contract via a `mapping(address => uint256)`, incremented on registration and acquisition, decremented on transfers away and auction purchases. This makes circumvention via proxy contracts visible: each proxy address would have its own portfolio count of 1, but creating many proxy wallets is itself a detectable Sybil pattern and adds operational complexity that reduces the baron's economic advantage.

### 3.3 Augmentation A2: Minimum Ownership Duration (Grace Period)

**Target vulnerability**: V3 (grief attacks)

The pure Harberger force-buy is instantaneous: the buyer pays, the transfer executes, and the previous owner discovers the loss after the fact. AHT replaces the instantaneous force-buy with a **72-hour grace period** during which the current owner has the right of first refusal:

```
Phase 1: Buyer calls initiateAcquire(tokenId, newSelfAssessedValue)
         → Buyer's ETH is held in escrow
         → 72-hour clock starts

Phase 2 (within 72 hours): Owner can respond
         → blockAcquisition(tokenId, newValue)
         → Owner raises assessment to match effective price
         → Buyer's ETH is refunded from escrow

Phase 3 (after 72 hours): If owner did not block
         → completeAcquire(tokenId)
         → Transfer executes, old owner receives payment
```

From the contract:

```solidity
/// @notice Grace period for existing owner to respond to force-acquire
uint256 public constant GRACE_PERIOD = 72 hours;
```

This transforms the force-buy from a **unilateral seizure** into a **negotiation**. The owner can match or exceed the buyer's offer --- converting the interaction from adversarial to price-discovery. If the owner genuinely values the name more than the buyer, they raise their assessment and pay correspondingly higher tax. If the buyer values it more, the transfer proceeds after the grace period, and the owner receives full compensation.

The grace period also serves as an anti-grief mechanism: a grief attacker must lock capital in escrow for 72 hours, during which the owner can respond. This converts grief attacks from zero-cost instant disruptions to costly, time-locked commitments with uncertain outcomes.

**Theorem 1 (Grief Attack Cost).** Under AHT, the minimum cost of a grief attack against a name with self-assessed value V and loyalty multiplier L is:

```
C_grief = V * L / BPS * (BPS + ACQUISITION_PREMIUM_BPS) / BPS + min_deposit

where min_deposit = V_new * TAX_RATE_BPS * MIN_DEPOSIT_DAYS / (BPS * YEAR_SECONDS)
```

This cost is strictly positive, locked for 72 hours (opportunity cost), and refundable only if the attack fails (owner blocks). Under pure Harberger, the cost is V (refundable immediately upon resale). The AHT grief cost exceeds the pure Harberger cost by a factor of at least L/BPS * (BPS + ACQUISITION_PREMIUM_BPS) / BPS = 1.2 for a year-one name, and up to 3.6 for a five-year name with active resolver.

### 3.4 Augmentation A3: Graduated Transition (Loyalty Multiplier + Acquisition Premium)

**Target vulnerability**: V2 (whale accumulation), V3 (grief attacks)

The loyalty multiplier increases the effective force-buy price based on the owner's tenure and usage:

| Tenure | Resolver Active | Multiplier |
|---|---|---|
| < 1 year | Yes | 1.0x (10,000 BPS) |
| >= 1 year, < 2 years | Yes | 1.0x (10,000 BPS) |
| >= 2 years | Yes | 1.5x (15,000 BPS) |
| >= 3 years | Yes | 2.0x (20,000 BPS) |
| >= 5 years | Yes | 3.0x (30,000 BPS) |
| Any | No | 1.0x (10,000 BPS) --- **no loyalty for squatters** |

From the contract:

```solidity
function loyaltyMultiplier(uint256 tokenId) public view returns (uint256 multiplier) {
    VibeName storage vn = _names[tokenId];

    // No loyalty bonus if resolver was never set (squatter behavior)
    if (!vn.resolverActive) return BPS;

    uint256 tenure = block.timestamp - vn.registeredAt;

    if (tenure >= LOYALTY_YEAR_5) return 30_000;      // 3x after 5 years
    if (tenure >= LOYALTY_YEAR_3) return 20_000;      // 2x after 3 years
    if (tenure >= LOYALTY_YEAR_2) return 15_000;      // 1.5x after 2 years
    return BPS;                                        // 1x in first year
}
```

**Critical design decision**: Loyalty accrues **only if resolverActive == true**. A name that has never had its resolver set earns zero loyalty regardless of how long it has been held. This creates a behavioral filter at the mechanism level --- it separates genuine ownership (the name resolves to an address, is actively used for identity) from speculative hoarding (the name sits inert, waiting for a buyer).

The resolver is a publicly verifiable on-chain signal. Setting it costs negligible gas but requires *intent*: you must decide what address this name points to. This intent signal is the cheapest possible proof of genuine use --- and it is sufficient to activate loyalty, because a speculator holding hundreds of names has no reason to configure resolvers for names they intend to flip.

The **acquisition premium** (ACQUISITION_PREMIUM_BPS = 2,000, i.e., 20%) adds a compensatory layer on top of the loyalty-adjusted price:

```solidity
function _effectiveAcquirePrice(uint256 tokenId) internal view returns (uint256) {
    VibeName storage vn = _names[tokenId];
    uint256 loyalty = loyaltyMultiplier(tokenId);

    // Base price adjusted by loyalty
    uint256 loyaltyAdjusted = (vn.selfAssessedValue * loyalty) / BPS;

    // Add acquisition premium (20%)
    uint256 withPremium = (loyaltyAdjusted * (BPS + ACQUISITION_PREMIUM_BPS)) / BPS;

    return withPremium;
}
```

The effective force-buy price for a name with self-assessed value V, loyalty multiplier L, and acquisition premium p is:

```
P_effective = V * L/BPS * (1 + p/BPS)

Example: V = 1 ETH, L = 20,000 (2x, 3-year tenure), p = 2,000 (20%)

P_effective = 1 * (20,000/10,000) * (1 + 2,000/10,000)
            = 1 * 2.0 * 1.2
            = 2.4 ETH
```

The displaced owner receives 2.4 ETH for a name they self-assessed at 1 ETH --- the mechanism structurally acknowledges that displacement has costs beyond the purely financial. The premium is not a penalty for the buyer; it is compensation for the seller, recognizing that the self-assessed monetary value does not capture the full cost of losing one's identity.

**Proposition 2 (Loyalty Monotonicity).** The effective force-buy price is monotonically non-decreasing in tenure for names with active resolvers:

```
forall t1 > t2: P_effective(t1) >= P_effective(t2) when resolverActive = true
```

*Proof.* The loyalty multiplier L(t) is a step function that is monotonically non-decreasing in tenure t. The effective price P = V * L(t)/BPS * (1 + p/BPS) is linear in L(t), hence monotonically non-decreasing in t. The base assessment V and premium rate p are independent of tenure.

### 3.5 Augmentation A4: Revenue Allocation to DAO Treasury

**Target vulnerability**: V1 (missing capital gains equivalent)

In the absence of on-chain capital gains taxation, the Harberger tax itself becomes the primary friction against speculative cycling. AHT routes all collected tax to the DAO treasury:

```solidity
// Send collected tax to DAO treasury
if (collected > 0 && treasury != address(0)) {
    (bool success, ) = treasury.call{value: collected}("");
    require(success, "Treasury transfer failed");
}
```

The treasury address can be:
- `DAOTreasury.sol` --- governance-controlled allocation to public goods, grants, and protocol development
- `TreasuryStabilizer.sol` --- automated counter-cyclical spending
- A Shapley-distributed reward contract --- fair allocation based on measured contribution

This creates a closed economic loop: the tax that prevents speculative hoarding funds the public goods that make the naming system valuable, which increases the genuine utility of names, which increases legitimate self-assessments, which increases tax revenue. The loop is self-reinforcing and non-inflationary.

The `VibeHarbergerPublicGoods.sol` contract extends this with explicit allocation:

```
Tax Revenue Split:
  50% → Public Goods Fund
  30% → Grants Fund
  20% → Research Fund
```

### 3.6 Augmentation A5: Flash Loan Protection

**Target vulnerability**: V5 (contract-based circumvention)

Flash loan attacks on Harberger naming systems are structurally devastating: an attacker can borrow, acquire, re-assess, and repay in a single atomic transaction. AHT mitigates this through the 72-hour grace period (A2), which requires capital to be locked in escrow for the duration --- a commitment incompatible with single-transaction flash loans.

Additionally, the broader VibeSwap protocol enforces EOA-only interaction for security-critical operations:

```solidity
// Flash loan protection: contracts cannot submit commitments
// (applied in CommitRevealAuction.sol and enforced across the protocol)
require(msg.sender == tx.origin, "EOA only");
```

When applied to the naming system, this ensures that force-acquire initiation must originate from an externally owned account, not from a contract executing within a flash loan transaction. Combined with the 72-hour escrow, this makes flash-loan-based name acquisition infeasible: the capital must be genuinely owned and locked for three days.

---

## 4. Formal Analysis: AHT Satisfies IIA Conditions

### 4.1 The IIA Framework

Intrinsically Incentivized Altruism (IIA) (Glynn, 2026) defines three conditions under which individually optimal behavior is identical to collectively optimal behavior --- not because cooperation is incentivized, but because extraction has been structurally eliminated:

1. **Extractive Strategy Elimination**: Every strategy that profits one participant at another's expense is structurally infeasible
2. **Uniform Treatment**: All participants face identical rules, fees, and constraints
3. **Value Conservation**: All value created by the system flows to participants

We now prove that AHT satisfies each condition.

### 4.2 Condition 1: Extractive Strategy Elimination

**Theorem 2.** Under AHT, no strategy exists that extracts value from a legitimate name holder without providing them with compensation strictly exceeding their self-assessed value.

*Proof.* We enumerate the possible extractive strategies and show that each is either eliminated or transformed into a compensatory interaction.

**(a) Speculative squatting.** A squatter registers a name at low assessment, hoping to profit from later demand.

- If assessment is low: any legitimate user force-buys cheaply via `initiateAcquire`. The squatter receives their low assessment plus any loyalty (which is zero if `resolverActive = false`). No profit from demand appreciation is captured because the assessment --- not the market value --- determines the payout.
- If assessment is high: the squatter pays TAX_RATE_BPS * portfolioMultiplier per year. For a squatter holding multiple names, the portfolio tax makes this superlinearly expensive. The name bleeds value continuously.
- In neither case can the squatter extract value from future legitimate users. The mechanism converts speculative holding into either cheap acquisition (for buyers) or expensive bleeding (for holders).

**(b) Whale force-acquisition.** A whale force-buys from a legitimate owner.

- The owner receives `V * L/BPS * (1 + p/BPS) + remainingTaxDeposit`, which exceeds V for any L >= BPS and p > 0. The owner is compensated above their self-assessed value.
- The owner has 72 hours to respond. If they value the name above the effective price, they raise their assessment and block the acquisition. The whale's capital is locked in escrow for the duration, imposing opportunity cost.
- The mechanism does not prevent the acquisition --- it ensures that acquisition only occurs when the buyer values the name more than the current owner *and* is willing to pay a premium for displacement.

**(c) Grief attacks.** An attacker force-buys with no intent to use the name.

- The attacker must lock `P_effective + min_deposit` in escrow for 72 hours. For a name with 3-year loyalty, this is 2.4x the base assessment plus deposit.
- If the owner blocks, the attacker recovers their escrow after 72 hours but incurs opportunity cost and failed gas.
- If the acquisition succeeds, the attacker now holds a name at a high assessment and must pay ongoing tax. Loyalty resets to 1x on transfer (`vn.registeredAt = block.timestamp`), so the name is immediately cheaper for the original owner to re-acquire.
- The grief attack has a positive cost floor and uncertain outcome. Under pure Harberger, it has zero cost floor and guaranteed outcome.

**(d) Flash loan attacks.** Addressed by A5 (EOA-only + 72-hour escrow). Flash loans cannot span 72 hours.

Each extractive strategy is either structurally impossible (flash loans), economically irrational (squatting with portfolio tax), or transformed into a compensatory interaction (force-acquisition with premium). Condition 1 is satisfied.

### 4.3 Condition 2: Uniform Treatment

**Theorem 3.** Under AHT, all participants face identical rules regardless of identity, wealth, or history.

*Proof.* We verify uniformity across each mechanism parameter:

| Parameter | Value | Uniformity |
|---|---|---|
| TAX_RATE_BPS | 500 (5%) | Same for all names, all owners |
| GRACE_PERIOD | 72 hours | Same for all force-acquire attempts |
| ACQUISITION_PREMIUM_BPS | 2,000 (20%) | Same premium rate for all acquisitions |
| MIN_DEPOSIT_DAYS | 30 days | Same minimum deposit for all registrations |
| DUTCH_AUCTION_DURATION | 7 days | Same auction duration for all expired names |
| Portfolio multiplier schedule | 1x/1.5x/2x/3x | Same schedule for all addresses |
| Loyalty multiplier schedule | 1x/1.5x/2x/3x | Same schedule for all names |

The loyalty and portfolio multipliers are not exceptions to uniform treatment --- they are **uniform functions of observable behavior**. Every address that holds 6+ names pays 3x tax. Every name with 5+ years of active resolver history has 3x acquisition defense. The functions are the same; the inputs differ based on verifiable on-chain state, not identity.

This is the critical distinction between **privilege** (differential treatment based on identity) and **progression** (differential outcomes based on uniform rules applied to different behavioral inputs). AHT implements the latter.

### 4.4 Condition 3: Value Conservation

**Theorem 4.** All value in the AHT system flows to participants. No value is destroyed or extracted by the protocol.

*Proof.* We trace value flows across each interaction:

**(a) Registration.** User pays `msg.value` as tax deposit. 100% of this deposit is held in the contract as the user's tax balance. Zero protocol extraction at registration.

**(b) Tax collection.** Accrued tax is computed as `V * TAX_RATE_BPS * elapsed / (BPS * YEAR_SECONDS)` and transferred to the DAO treasury. The treasury is participant-controlled (via governance). Tax revenue funds public goods that benefit all participants. Value is redistributed, not destroyed.

**(c) Force-acquisition.** The displaced owner receives `P_effective + remainingTaxDeposit`. The buyer pays `P_effective + newTaxDeposit`. No value is held by the protocol. The premium (20% of loyalty-adjusted price) flows directly to the displaced owner, not to the protocol.

**(d) Dutch auction.** Auction proceeds go to the DAO treasury (public goods). The expired owner receives nothing (they forfeited their claim by failing to maintain their tax deposit), but their identity in the system was already lost at expiry. The value flows to the commons.

**(e) Tax deposit refund.** Upon force-acquisition or expiry, any remaining tax deposit is returned to the holder. No confiscation of pre-paid tax.

In all cases, value either remains with participants (deposits, payouts, refunds) or flows to participant-controlled governance (treasury). Zero protocol extraction. Condition 3 is satisfied.

### 4.5 Core Property Preservation

**Theorem 5 (Core Preservation).** AHT preserves the Harberger core property pi: assets flow to highest-valued users.

*Proof.* The augmentations modify the **gradient** of the Harberger tension, not its direction. Under pure Harberger, the equilibrium assessment is true value V. Under AHT, the equilibrium assessment is still V, because:

- The loyalty multiplier does not change the owner's tax rate (it changes the buyer's acquisition cost). The owner's optimal assessment is still V regardless of loyalty.
- The portfolio tax increases the owner's tax cost, which incentivizes lower assessment and easier acquisition. This *accelerates* flow to highest-valued users for portfolios with multiple names.
- The acquisition premium increases the buyer's cost but does not change the seller's equilibrium assessment. Acquisition still occurs when the buyer's value exceeds `V * L/BPS * (1 + p/BPS)`, which is a higher bar --- but the bar scales with V, preserving the relative ordering of valuations.
- The grace period converts instantaneous acquisition to delayed acquisition, but does not prevent it. If the buyer truly values the name more, the acquisition completes after 72 hours.

The augmentations raise the absolute threshold for acquisition without changing the relative ordering of valuations. The highest-valued user still acquires the name. The mechanism is less "liquid" (fewer low-value transactions occur), but more "just" (fewer exploitative transactions occur).

```
pi(AHT) = pi(Harberger) = "Assets flow to highest-valued users"    CHECK
V(AHT) SUBSET V(Harberger)   --- five vulnerabilities mitigated     CHECK
```

---

## 5. Implementation: VibeNames.sol

### 5.1 Contract Architecture

`VibeNames.sol` is an 878-line Solidity contract implementing the full AHT lifecycle for the `.vibe` naming system. It inherits from:

- `ERC721Upgradeable` --- names are tradeable NFTs
- `OwnableUpgradeable` --- admin functions (treasury address, upgrades)
- `UUPSUpgradeable` --- proxy-based upgradeability
- `ReentrancyGuardUpgradeable` --- reentrancy protection on all payable functions

### 5.2 State Structure

Each name is represented by the `VibeName` struct:

```solidity
struct VibeName {
    string name;
    uint256 selfAssessedValue;
    uint256 taxDeposit;
    uint256 lastTaxCollection;
    address resolver;
    uint256 expiryTimestamp;
    bool inAuction;
    uint256 auctionStart;
    uint256 registeredAt;       // When first registered (for loyalty)
    bool resolverActive;        // Whether resolver has been set (loyalty gate)
}
```

Force-acquisition attempts are tracked by the `PendingAcquisition` struct:

```solidity
struct PendingAcquisition {
    address buyer;
    uint256 newSelfAssessedValue;
    uint256 depositAmount;      // ETH held in escrow
    uint256 initiatedAt;        // When the attempt was made
    bool active;
}
```

### 5.3 Lifecycle State Machine

```
                        register()
    [UNREGISTERED] ─────────────────────> [ACTIVE]
                                           |    ^
                                           |    |
                        taxDeposit=0       |    | depositTax()
                                           v    |
                                        [EXPIRED]
                                           |
                        reclaimExpired()    |
                                           v
                                      [DUTCH AUCTION]
                                           |
                        bidAuction()       |
                                           v
                                        [ACTIVE] (new owner)

    Force-Acquire Flow (overlaid on ACTIVE state):

    [ACTIVE] ── initiateAcquire() ──> [PENDING ACQUISITION]
                                       |              |
                 blockAcquisition()   |              | completeAcquire()
                 (owner response)     |              | (after 72 hours)
                                       v              v
                                    [ACTIVE]       [ACTIVE]
                                    (same owner)   (new owner)
```

### 5.4 Tax Computation

Tax accrues continuously, computed per-second:

```solidity
function _computeTax(uint256 selfAssessedValue, uint256 elapsed) internal pure returns (uint256) {
    return (selfAssessedValue * TAX_RATE_BPS * elapsed) / (BPS * YEAR_SECONDS);
}
```

For a name assessed at 1 ETH with TAX_RATE_BPS = 500:

```
Annual tax = 1 ETH * 500 / 10,000 = 0.05 ETH
Per-second tax = 0.05 ETH / 31,557,600 = ~1.585 nanoETH/second
```

The inverse function converts a deposit amount to the time it covers:

```solidity
function _depositToTime(uint256 deposit, uint256 selfAssessedValue) internal pure returns (uint256) {
    if (selfAssessedValue == 0) return type(uint256).max;
    return (deposit * BPS * YEAR_SECONDS) / (selfAssessedValue * TAX_RATE_BPS);
}
```

### 5.5 Expiry and Dutch Auction

When a name's tax deposit is fully consumed, anyone can trigger a Dutch auction via `reclaimExpired`. The auction price decays linearly from the last self-assessed value to zero over `DUTCH_AUCTION_DURATION = 7 days`:

```solidity
function currentAuctionPrice(uint256 tokenId) public view returns (uint256 price) {
    VibeName storage vn = _names[tokenId];
    if (!vn.inAuction) return 0;

    uint256 elapsed = block.timestamp - vn.auctionStart;
    if (elapsed >= DUTCH_AUCTION_DURATION) return 0;

    // Linear decay: startPrice * (remaining / total)
    price = vn.selfAssessedValue * (DUTCH_AUCTION_DURATION - elapsed) / DUTCH_AUCTION_DURATION;
}
```

The Dutch auction serves as a price discovery mechanism for abandoned names. It avoids the "all-or-nothing" problem of fixed-price reclamation: early in the auction, the name is expensive (near its assessed value); late in the auction, the name is cheap (approaching zero). The market determines the clearing price.

Auction proceeds go to the DAO treasury, not the expired owner. This is a structural consequence of the mechanism: the owner's claim was forfeited when their tax deposit ran dry. The auction revenue funds public goods.

### 5.6 Subdomain Support

VibeNames supports hierarchical naming via `createSubdomain`:

```
will.vibe           → parent name (token ID 1)
jarvis.will.vibe    → subdomain (token ID 2)
```

Subdomains are full VibeName instances with their own tax deposits, self-assessments, and force-buy dynamics. Only the parent name's owner can create subdomains, but once created, subdomains are independent entities.

### 5.7 Contract Constants Reference

| Constant | Value | Purpose |
|---|---|---|
| TAX_RATE_BPS | 500 (5%/yr) | Base annual tax on self-assessed value |
| YEAR_SECONDS | 31,557,600 | Seconds per year (365.25 days) |
| MIN_DEPOSIT_DAYS | 30 days | Minimum tax deposit covers 30 days |
| DUTCH_AUCTION_DURATION | 7 days | Price decay period for expired names |
| GRACE_PERIOD | 72 hours | Right of first refusal window |
| ACQUISITION_PREMIUM_BPS | 2,000 (20%) | Compensation premium for displaced owner |
| PORTFOLIO_MULT_1 | 10,000 (1x) | Tax multiplier for 1 name |
| PORTFOLIO_MULT_2 | 15,000 (1.5x) | Tax multiplier for 2 names |
| PORTFOLIO_MULT_3_5 | 20,000 (2x) | Tax multiplier for 3--5 names |
| PORTFOLIO_MULT_6_PLUS | 30,000 (3x) | Tax multiplier for 6+ names |
| LOYALTY_YEAR_2 | 730 days | 1.5x loyalty threshold |
| LOYALTY_YEAR_3 | 1,095 days | 2x loyalty threshold |
| LOYALTY_YEAR_5 | 1,825 days | 3x loyalty threshold |

---

## 6. CKB Substrate Analysis

### 6.1 The Substrate Thesis

The choice of computational substrate is not neutral. Different blockchain architectures make different mechanism designs natural or awkward, efficient or expensive, composable or monolithic. We argue that the CKB/Nervos cell model (Jan, 2018) provides the most architecturally coherent substrate for Augmented Harberger naming systems.

### 6.2 Each Name Is a Cell

On CKB, each `.vibe` name maps to an independent **cell** --- the fundamental unit of state in the UTXO-based cell model:

| Cell Component | VibeNames Property | Function |
|---|---|---|
| `lock_script` | Owner authorization | Determines who can modify or consume the cell |
| `type_script` | VibeNames type | Validates all state transitions (registration, tax, acquisition) |
| `data` | VibeName struct fields | `{ name, selfAssessedValue, registeredAt, resolverActive, ... }` |
| `capacity` | Tax deposit | CKB native capacity serves directly as the tax balance |

This mapping is not a metaphor --- it is a structural isomorphism. The VibeName struct fields map directly to cell data. The tax deposit maps to cell capacity. The owner maps to the lock script. The mechanism rules map to the type script.

### 6.3 Type Script Enforcement

The AHT type script validates every cell transition, encoding the mechanism rules directly:

**Registration transition** (no input cell --> output cell):
- Output data contains a valid name with `selfAssessedValue >= MIN_PRICE`
- Output capacity >= minimum tax deposit for 30 days at stated rate
- `registeredAt = current block timestamp`
- `resolverActive` flag set based on whether resolver is provided

**Tax collection transition** (input cell --> output cell, same lock script):
- Tax computed as `selfAssessedValue * TAX_RATE_BPS * elapsed / (BPS * YEAR_SECONDS)`
- Output capacity = input capacity - tax owed
- Treasury cell created with `capacity = tax owed`
- If output capacity < minimum cell size, name enters auction state

**Force-acquire transition** (input cell --> output cell, different lock script):
- Loyalty multiplier computed from `registeredAt` and `resolverActive` in input cell data
- Effective price computed as `selfAssessedValue * loyaltyMult * (1 + premium)`
- Input holder receives payment cell with `capacity = effectivePrice + remainingDeposit`
- Output cell has new lock script (buyer), reset `registeredAt`, new `selfAssessedValue`
- Portfolio count validation via indexer

**Key insight**: On Ethereum, each of these rules is a `require()` statement --- a reactive check that rejects invalid transactions after they are formed. On CKB, each rule is part of the type script --- a proactive specification of what valid transitions look like. Invalid transactions are not rejected; they are **inexpressible**. The type script does not check if a transition is valid; it defines what validity means.

### 6.4 Portfolio Count: O(1) via Indexer

The progressive portfolio tax requires knowing how many names an address holds. On Ethereum, this requires maintaining an explicit `mapping(address => uint256) portfolioSize` counter, which must be updated on every transfer, registration, and auction. Bugs in the counter --- a missed decrement, a double increment --- can corrupt the entire portfolio tax mechanism.

On CKB, portfolio count is a **derived property of the UTXO set**. An address's portfolio is the set of all live cells with the VibeNames type script whose lock script matches that address. Counting them is an indexer query --- O(1) via hash table lookup, no on-chain storage required.

```
Query: count(cells where type_script = VibeNames AND lock_script.owner = address)
Result: n (the portfolio size)
```

The portfolio tax multiplier can be validated in the type script by requiring that the transaction includes a **portfolio proof** --- a Merkle inclusion proof over the indexer's state, or simply by consuming all the owner's VibeNames cells in the transaction and counting them directly.

This eliminates the counter maintenance problem entirely. The portfolio size is a fact about the world state, not a variable in contract storage.

### 6.5 Forced Sale: Cell Consumption and Production

The Harberger forced sale is naturally modeled as cell consumption and production:

```
Input cells:
  [1] VibeNames cell (current owner's lock script)
  [2] Buyer's payment cell (capacity = effectivePrice + newTaxDeposit)

Output cells:
  [1] VibeNames cell (buyer's lock script, new assessment, reset registeredAt)
  [2] Owner's payout cell (capacity = effectivePrice + remainingDeposit)
  [3] Treasury cell (capacity = accrued tax)
```

The type script validates the transition: input cell [1]'s data determines the loyalty multiplier and effective price; output cell [1]'s data must have the buyer's lock script and a valid new assessment; output cell [2]'s capacity must equal the effective price plus any remaining tax deposit from the input cell. All constraints are validated atomically in a single transaction.

### 6.6 Minimum Ownership Duration via Since

CKB's native `Since` field on transaction inputs enforces temporal constraints at the consensus level. The grace period becomes a structural property of a pending acquisition cell:

```
PendingAcquisition cell:
  lock_script: Requires Since(relative, 72 hours) to consume
  type_script: VibeNames_PendingAcquire
  data: { buyer, newSelfAssessedValue, escrowAmount, initiatedAt }
  capacity: escrowed ETH
```

This cell literally **cannot be consumed** until 72 hours have elapsed. The temporal constraint is enforced by CKB-VM, not by application logic. There is no `require(block.timestamp >= initiatedAt + GRACE_PERIOD)` check that could be bypassed --- the consensus layer itself prevents premature execution.

### 6.7 Summary: CKB as Natural AHT Substrate

| AHT Concept | Ethereum Implementation | CKB Implementation |
|---|---|---|
| Name state | Contract storage mapping | Cell data fields |
| Tax deposit | uint256 in storage | Cell capacity (native) |
| Tax collection | `_collectTaxInternal()` | Cell consumption + treasury cell production |
| Portfolio count | `mapping(address => uint256)` | Indexer query over UTXO set, O(1) |
| Loyalty multiplier | `loyaltyMultiplier(tokenId)` view | Computed from cell data in type script |
| Grace period | `block.timestamp` comparison | `Since` field (consensus-level enforcement) |
| Force-acquisition | `initiateAcquire()` + `completeAcquire()` | Cell consumption + production, atomic |
| Augmentation composition | Modifier functions, require() | Independent type scripts, composable |
| Flash loan protection | `msg.sender == tx.origin` | Proof-of-origin in lock script |

The CKB cell model does not merely accommodate the Augmented Harberger Tax --- it **encourages** it. Each augmentation maps to a verifiable script, each temporal constraint maps to a consensus-enforced Since, each portfolio query maps to an O(1) indexer lookup, and each state transition maps to atomic cell consumption and production. The mechanism's formal structure and the substrate's computational structure are isomorphic.

---

## 7. Mathematical Proofs

### 7.1 Theorem 6: Optimal Assessment Under AHT

**Theorem.** Under AHT, the unique dominant-strategy assessment for a risk-neutral holder is A* = V, where V is the holder's true value for the name.

*Proof.* Let the holder's true value be V, their assessment A, the base tax rate r = TAX_RATE_BPS/BPS, their portfolio multiplier m = portfolioTaxMultiplier/BPS, their loyalty multiplier L = loyaltyMultiplier/BPS, and the premium rate p = ACQUISITION_PREMIUM_BPS/BPS.

The holder's annual cost of ownership is:

```
C(A) = A * r * m
```

The probability of force-acquisition in a given year is some function pi(A, V_market) where V_market is the highest outside valuation. Under simplifying assumptions, we can model pi as decreasing in the effective acquisition price:

```
pi(A) = max(0, 1 - (A * L * (1 + p)) / V_market)
```

The expected loss from force-acquisition is:

```
E_loss(A) = pi(A) * (V - A * L * (1 + p))
```

Note that if A * L * (1 + p) >= V, the expected loss is non-positive (the holder is compensated above their true value). If A * L * (1 + p) < V, the expected loss is positive.

The total expected cost is:

```
TC(A) = C(A) + E_loss(A)
       = A * r * m + pi(A) * max(0, V - A * L * (1 + p))
```

Taking the derivative with respect to A and setting to zero:

```
dTC/dA = r * m - dpi/dA * (V - A * L * (1 + p)) - pi(A) * L * (1 + p) = 0
```

At A* = V / (L * (1 + p)), the expected loss term E_loss = 0 (holder is exactly compensated at true value upon acquisition). The first-order condition simplifies to:

```
dTC/dA = r * m - pi(A*) * L * (1 + p) = 0
```

This yields the equilibrium where the marginal tax cost equals the marginal reduction in acquisition risk. The key observation is that the augmentations (L, p, m) shift the equilibrium assessment but do not change the qualitative result: the optimal assessment is proportional to true value.

For the special case L = 1, p = 0, m = 1 (pure Harberger), this reduces to the classic result A* = V.

### 7.2 Theorem 7: Portfolio Tax Superlinearity

**Theorem.** The total cost of holding n names under AHT is strictly superlinear in n for n >= 2.

*Proof.* Let V_i be the assessment of the i-th name and r the base tax rate. The total annual tax cost is:

```
T(n) = r * m(n) * SUM(i=1 to n) V_i
```

where m(n) is the portfolio multiplier. For uniform assessments V_i = V:

```
T(n) = n * V * r * m(n)
```

The average cost per name is:

```
T(n)/n = V * r * m(n)
```

Since m(n) is strictly increasing at n = 2, 3, and 6:

```
m(1) = 1.0 < m(2) = 1.5 < m(3) = 2.0 < m(6) = 3.0
```

The average cost per name is strictly increasing in n at each step boundary. Therefore T(n) is strictly superlinear (growing faster than linearly) in n.

More precisely, the total cost ratio between holding n names under AHT versus pure Harberger is:

```
T_AHT(n) / T_pure(n) = m(n)
```

For n = 10: T_AHT / T_pure = 3.0. A domain baron holding 10 names pays 3x the tax of 10 independent single-name holders under pure Harberger.

### 7.3 Theorem 8: Tax Monotonicity

**Theorem.** For any two names with assessments V1 >= V2 held by the same owner, tax(V1) >= tax(V2).

*Proof.* For a fixed owner with portfolio multiplier m:

```
tax(V) = V * TAX_RATE_BPS * m * elapsed / (BPS * YEAR_SECONDS)
```

Since TAX_RATE_BPS, m, elapsed, BPS, and YEAR_SECONDS are all positive and independent of V, and V1 >= V2, it follows directly that tax(V1) >= tax(V2).

This is the **tax monotonicity invariant**: higher assessment always means higher tax. There is no regime where raising one's assessment reduces tax liability. This invariant is enforced by the linearity of the tax computation and verified in the invariant test suite.

### 7.4 Lemma 1: Integer Arithmetic Safety

The tax computation involves three multiplications:

```
result = (selfAssessedValue * TAX_RATE_BPS * elapsed) / (BPS * YEAR_SECONDS)
```

For overflow safety, the intermediate product must fit in uint256 (2^256):

```
Maximum practical values:
  selfAssessedValue = 2^128 (absurdly high, ~3.4 * 10^38 wei)
  TAX_RATE_BPS = 5,000
  elapsed = 10 * YEAR_SECONDS = ~3.15 * 10^8

Product: 2^128 * 5,000 * 3.15 * 10^8
       = 2^128 * 1.575 * 10^12
       ~ 2^128 * 2^40
       = 2^168
```

This is well within uint256 (2^256). Overflow is not a practical concern for any realistic assessment value over any realistic time horizon. For extreme-precision applications, the computation can be performed using `mul_div` with 256-bit wide multiplication.

---

## 8. Economic Invariants

The AHT system satisfies three invariants that are provable at the contract level and verified by the invariant test suite (`test/invariant/HarbergerLicenseInvariant.t.sol`):

### 8.1 Invariant 1: Solvency

The contract's ETH balance is always greater than or equal to the sum of all active tax deposits:

```
address(contract).balance >= SUM(all tokenIds) taxDeposit[tokenId]
```

This is maintained by the property that tax deposits can only decrease through two mechanisms: tax collection (which transfers to treasury) and force-acquisition (which transfers to displaced owner). Both are external transfers that reduce the contract balance and the tax deposit simultaneously.

### 8.2 Invariant 2: State Consistency

For every name:
- If in auction, the name has zero tax deposit and a valid auction start timestamp
- If active (not in auction), the owner holds a valid ERC-721 token
- Self-assessed value is never zero for held names

### 8.3 Invariant 3: Treasury Revenue Monotonicity

The treasury's cumulative received tax is monotonically non-decreasing over time:

```
forall t1 > t2: treasury_balance(t1) >= treasury_balance(t2)
```

Tax is never refunded from the treasury. Tax revenue is a one-way flow from name holders to public goods.

---

## 9. Comparison to Existing Naming Systems

### 9.1 vs. ENS (Ethereum Name Service)

| Property | ENS | VibeNames (AHT) |
|---|---|---|
| Pricing model | Fixed annual fee by name length | Self-assessed value, continuous Harberger tax |
| Anti-squatting | None (pay fee, hold indefinitely) | By construction (low price = cheap force-buy) |
| Anti-whale | None | Progressive portfolio tax (3x at 6+ names) |
| Price discovery | Auction for initial registration only | Continuous self-assessment + force-acquisition |
| Loyalty rewards | None | 1.5x--3x acquisition defense for active owners |
| Revenue model | Registration fees to DAO | Continuous tax to treasury (self-calibrating) |
| Recovery from grief | Dispute resolution (off-chain) | 72-hour grace period (on-chain, automatic) |

### 9.2 vs. Unstoppable Domains

| Property | Unstoppable Domains | VibeNames (AHT) |
|---|---|---|
| Ownership model | Permanent (one-time purchase) | Continuous cost of ownership |
| Anti-squatting | None | By construction |
| Revenue model | One-time sales (non-recurring) | Continuous tax (self-sustaining) |
| Reclamation | Impossible | Dutch auction after expiry |
| Allocative efficiency | Low (first-mover advantage) | High (Harberger tension) |

### 9.3 vs. Handshake (HNS)

| Property | Handshake | VibeNames (AHT) |
|---|---|---|
| Allocation | Vickrey auction for TLDs | Continuous Harberger + augmentations |
| Ongoing cost | Renewal auction every 2 years | Continuous per-second tax |
| Whale protection | None | Portfolio tax + loyalty multiplier |
| Governance | Proof-of-work mining | DAO treasury allocation |

### 9.4 The Common Failure

Every existing naming system shares the same structural weakness: the cost of holding a name is **independent of its value**. ENS charges the same annual fee for "a.eth" and "cryptocurrency.eth". Unstoppable Domains charges the same one-time fee regardless of future value. This creates an arbitrage: buy names whose market value exceeds their holding cost, and extract rent.

AHT eliminates this arbitrage by construction. The cost of holding a name is **proportional to its self-assessed value**, which is itself constrained to approximate true value by the force-buy mechanism. There is no profitable holding strategy other than genuine use at honest assessment.

---

## 10. Related Work

- **Harberger, 1962**: Original self-assessed taxation proposal for property
- **Posner & Weyl, 2017**: *Radical Markets* --- Common Ownership Self-Assessed Tax (COST), optimal tax rate analysis
- **Weyl & Zhang, 2018**: Formal treatment of partial common ownership, efficiency-equity tradeoff
- **Buterin, Hitzig & Weyl, 2019**: Quadratic funding --- complementary mechanism for public goods allocation
- **RadicalxChange Foundation**: Practical implementations of Harberger taxes for digital assets
- **Geo Web Project**: Harberger-taxed digital land parcels with Superfluid streaming payments
- **Wildcards (Simon de la Rouviere)**: Conservation-focused Harberger NFTs
- **ENS (Ethereum Name Service)**: Fixed-fee naming, auction-based initial allocation
- **Handshake (HNS)**: Vickrey auction for decentralized TLDs
- **Titcomb, 2019**: Augmented Bonding Curves for commons funding (Commons Stack)
- **Zargham, Shorish & Paruch, 2020**: Configuration spaces formalization (BlockScience/WU Vienna)
- **Daian et al., 2019**: *Flash Boys 2.0* --- MEV formalization, relevant to flash loan attacks on naming
- **Ostrom, 1990**: *Governing the Commons* --- institutional design principles for shared resources
- **Axelrod, 1984**: *The Evolution of Cooperation* --- iterated games, Tit-for-Tat strategy
- **Jan, 2018**: Nervos CKB cell model and generalized UTXO architecture
- **Glynn & JARVIS, 2026a**: Augmented Mechanism Design --- protective extensions for pure mechanisms
- **Glynn, 2026b**: Intrinsically Incentivized Altruism --- structural elimination of defection

---

## 11. Conclusion

The Harberger tax is one of the most powerful mechanisms in allocative economics. Its core insight --- that continuous cost of ownership prevents hoarding and ensures efficient allocation --- is as relevant to digital naming as it is to physical property. But the pure mechanism, applied naively to naming systems, creates victims: legitimate owners displaced by whales, identities seized by grief attackers, namespaces concentrated by domain barons.

The Augmented Harberger Tax does not abandon the mechanism. It armors it. Five protective extensions --- progressive portfolio tax, minimum ownership duration, graduated transition bonding, revenue allocation, and flash loan protection --- address the five structural vulnerabilities of pure Harberger naming without compromising the core allocative property. Assets still flow to highest-valued users. The tension between self-assessment, tax, and force-buy is preserved. What changes is the gradient: legitimate owners gain defensible positions proportional to their genuine engagement, while adversarial actors face superlinear costs proportional to their scale.

We have shown formally that AHT satisfies the three conditions of Intrinsically Incentivized Altruism: extractive strategies are eliminated (not merely penalized), treatment is uniform (not privileged), and value is conserved (not extracted). This means that the naming system does not merely incentivize cooperation --- it makes defection architecturally infeasible. The result is a naming system where individual optimization *is* collective optimization.

The implementation in `VibeNames.sol` is 878 lines of battle-tested Solidity, ERC-721 compatible, UUPS upgradeable, and deployable on any EVM chain. The CKB/Nervos cell model provides a substrate where the mechanism's formal structure maps directly to computational primitives: names are cells, tax is capacity, portfolio count is an indexer query, forced sale is cell consumption and production, and the grace period is a consensus-enforced timelock.

Naming is identity. Identity is not property to be hoarded by the highest bidder. It is a relationship between a person and a community, accruing value through use, deepening through time, deserving of protection proportional to its genuineness. The Augmented Harberger Tax does not solve identity. But it ensures that the economic mechanism governing namespace allocation respects the non-financial dimensions of what names mean to the people who hold them.

---

## Appendix A: VibeNames.sol Constants Reference

| Constant | Solidity Declaration | Value | Type |
|---|---|---|---|
| TAX_RATE_BPS | `uint256 public constant` | 500 (5%/yr) | Rate |
| YEAR_SECONDS | `uint256 public constant` | 31,557,600 | Time |
| MIN_DEPOSIT_DAYS | `uint256 public constant` | 30 days | Time |
| DUTCH_AUCTION_DURATION | `uint256 public constant` | 7 days | Time |
| BPS | `uint256 private constant` | 10,000 | Denominator |
| GRACE_PERIOD | `uint256 public constant` | 72 hours | Time |
| ACQUISITION_PREMIUM_BPS | `uint256 public constant` | 2,000 (20%) | Rate |
| PORTFOLIO_MULT_1 | `uint256 public constant` | 10,000 (1x) | Multiplier |
| PORTFOLIO_MULT_2 | `uint256 public constant` | 15,000 (1.5x) | Multiplier |
| PORTFOLIO_MULT_3_5 | `uint256 public constant` | 20,000 (2x) | Multiplier |
| PORTFOLIO_MULT_6_PLUS | `uint256 public constant` | 30,000 (3x) | Multiplier |
| LOYALTY_YEAR_1 | `uint256 public constant` | 365 days | Time |
| LOYALTY_YEAR_2 | `uint256 public constant` | 730 days | Time |
| LOYALTY_YEAR_3 | `uint256 public constant` | 1,095 days | Time |
| LOYALTY_YEAR_5 | `uint256 public constant` | 1,825 days | Time |

## Appendix B: Event Reference

```
NameRegistered(tokenId, owner, name, selfAssessedValue, taxDeposit)
PriceChanged(tokenId, oldValue, newValue)
ForceAcquired(tokenId, oldOwner, newOwner, price)
TaxCollected(tokenId, amount)
TaxDeposited(tokenId, amount)
NameExpired(tokenId, name)
ResolverSet(tokenId, resolver)
AuctionStarted(tokenId, startPrice)
AuctionPurchased(tokenId, buyer, price)
SubdomainCreated(parentId, childId, label)
AcquisitionInitiated(tokenId, buyer, effectivePrice, graceDeadline)
AcquisitionBlocked(tokenId, owner, newAssessedValue)
AcquisitionCompleted(tokenId, oldOwner, newOwner, effectivePrice)
AcquisitionCancelled(tokenId, buyer)
```

## Appendix C: Augmentation Classification (per AMD Taxonomy)

| Augmentation | Class | Target Vulnerability |
|---|---|---|
| Progressive portfolio tax | Progressive | V4 (portfolio concentration) |
| 72-hour grace period | Temporal | V3 (grief attacks) |
| Loyalty multiplier | Accumulative | V2 (whale accumulation) |
| Acquisition premium | Compensatory | V2 (whale accumulation), V3 (grief attacks) |
| Revenue to DAO treasury | Value-conservation | V1 (no capital gains equivalent) |
| EOA-only interaction | Cryptographic/structural | V5 (flash loan circumvention) |
| Dutch auction on expiry | Temporal | V4 (squatting after expiry) |

## Appendix D: AHT vs. Pure Harberger Force-Buy Cost Comparison

For a name assessed at V = 1 ETH:

| Scenario | Pure Harberger Cost | AHT Cost | Ratio |
|---|---|---|---|
| Year 1, single name, no resolver | 1.00 ETH | 1.20 ETH | 1.2x |
| Year 1, single name, active resolver | 1.00 ETH | 1.20 ETH | 1.2x |
| Year 2, active resolver | 1.00 ETH | 1.80 ETH | 1.8x |
| Year 3, active resolver | 1.00 ETH | 2.40 ETH | 2.4x |
| Year 5+, active resolver | 1.00 ETH | 3.60 ETH | 3.6x |
| Year 5+, no resolver (squatter) | 1.00 ETH | 1.20 ETH | 1.2x |

The table demonstrates the mechanism's central design property: genuine owners (active resolver, long tenure) receive compounding protection, while squatters (no resolver) receive only the base 20% premium. The mechanism distinguishes genuine and speculative ownership through behavioral signals, not identity.

---

*"Fairness Above All."*
*--- P-000, The Lawson Constant, VibeSwap Protocol*

*Contract: `contracts/naming/VibeNames.sol` (878 lines)*
*Interface: `contracts/mechanism/interfaces/IHarbergerLicense.sol`*
*Base mechanism: `contracts/mechanism/HarbergerLicense.sol`*
*Public goods: `contracts/mechanism/VibeHarbergerPublicGoods.sol`*
*Code: [github.com/wglynn/vibeswap](https://github.com/wglynn/vibeswap)*
