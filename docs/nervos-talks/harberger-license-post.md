# Harberger Tax Licensing for Premium Features: From DeFi to CKB License Cells

*Nervos Talks Post --- Faraday1*
*March 2026*

---

## TL;DR

We built a Harberger tax system for **premium DeFi feature access** --- not domain names, not digital land, but protocol features themselves (priority execution, enhanced analytics, featured listings). Holders self-assess value, pay continuous tax, and anyone can force-buy at the assessed price. Tax flows to the treasury. No squatting, no admin pricing, no subscription models. The contract is live as `HarbergerLicense.sol` (343 lines of Solidity). But the real question is: what does this look like on CKB, where each license is a cell and the tax enforcement is a type script?

---

## The Problem: Who Gets Premium Features?

Every protocol with premium tiers faces the same allocation problem. Current solutions are all broken:

- **Subscriptions**: Admin sets a flat price. No price discovery. A $10/month feature might be worth $10,000 to a market maker and $0.50 to a casual user. One of them is getting a bad deal.
- **Token-gating**: Hold X tokens to access Y feature. Purely plutocratic. Wealth determines access regardless of utilization.
- **First-come-first-served**: Early claimants squat on features they never use. No recourse.
- **Admin discretion**: Centralized, opaque, the exact thing we are building decentralized systems to avoid.

The common failure: **none of these create continuous cost of ownership**. Once you have the feature, holding it is free (or flat-rate). This decouples *having* from *using*.

---

## The Mechanism: Harberger Taxes on Feature Access

Harberger taxation (Posner & Weyl, 2017) creates a simple but inescapable tension:

**You declare what the feature is worth to you. You pay continuous tax on that declaration. Anyone can buy it from you at the price you declared.**

- Declare too high? You bleed tax.
- Declare too low? Someone buys it out from under you cheaply.
- Declare truthfully? You pay fair tax and are compensated at fair value if displaced.

That tension --- the core Harberger property --- ensures **features flow to whoever values them most**, without any human making pricing decisions.

---

## What We Built: `HarbergerLicense.sol`

The contract manages the full lifecycle of Harberger-taxed feature licenses. Constants from the actual contract:

| Constant | Value | Purpose |
|---|---|---|
| `SECONDS_PER_YEAR` | `365 days` | Annualized tax denominator |
| `MAX_TAX_RATE_BPS` | `5000` (50%) | Tax rate ceiling per license |
| `minAssessedValue` | `0.01 ether` | Prevents dust claims |
| `gracePeriod` | `7 days` | Buffer before delinquent revocation |

### License Lifecycle

Each license is a state machine:

```
VACANT --> ACTIVE --> DELINQUENT --> VACANT
                         |
                    depositTax()
                         |
                      ACTIVE
```

**1. Create** (owner only): Define a feature name and tax rate (1-5000 bps).

**2. Claim** (anyone): Pick a vacant license, set your self-assessed value, deposit at least one grace period of tax.

**3. Use**: You hold the license, you access the feature, your tax balance drains continuously:

```
tax = assessedValue * taxRateBps * elapsed / (10000 * SECONDS_PER_YEAR)
```

**4. Force-buy** (anyone except current holder): Pay the assessed value to the current holder, plus a tax deposit for your new assessment. The old holder gets their declared price *plus* any unused tax balance refund. Clean, fair, immediate.

**5. Delinquency**: Tax balance hits zero. You have 7 days (`gracePeriod`) to top up. If you don't, anyone can revoke the license back to VACANT.

### The Anti-Squatting Property

This is why the mechanism works for features specifically:

A squatter who claims "priority execution slot #1" but does not use it faces a continuous drain. If they assess low to minimize tax, a real market maker force-buys for cheap. If they assess high to prevent force-buy, tax eats them alive. **There is no profitable squatting strategy.** The mechanism eliminates feature hoarding by construction.

---

## Tax Revenue: Sustainable Protocol Funding

All collected tax flows to the treasury address. This is non-inflationary, non-cyclical protocol revenue:

```
Example portfolio:
- 5 priority slots @ 10 ETH assessed, 2000 bps = 10 ETH/yr
- 10 featured listings @ 2 ETH, 1500 bps       = 3 ETH/yr
- 3 premium APIs @ 5 ETH, 1000 bps              = 1.5 ETH/yr
- 20 pool names @ 0.5 ETH, 500 bps              = 0.5 ETH/yr

Total: 15 ETH/year from 38 licenses, zero admin overhead
```

Tax collection is **permissionless** --- anyone can call `collectTax(licenseId)`. No dependency on holder cooperation. Keepers, MEV searchers, or simple cron jobs can trigger collection. The revenue model is self-sustaining.

---

## Now Here Is the CKB Part

Everything above works on EVM. But here is what got us thinking about CKB/Nervos as a substrate.

### License Cells

On CKB, each Harberger license maps to a single cell:

| Cell Component | License Property |
|---|---|
| `lock_script` | Current holder (who can modify the license) |
| `type_script` | HarbergerLicense validator (enforces all rules) |
| `data` | `featureName, assessedValue, taxRateBps, lastTaxPaid, state` |
| `capacity` | Tax balance (native CKBytes, no wrapping needed) |

This is not a forced mapping. It is *natural*. The cell model's explicit state ownership is exactly what Harberger licensing needs: each license is an independent, owned, verifiable unit of state.

### Type Script as Tax Enforcer

The HarbergerLicense type script validates every transition:

**Claiming a vacant cell:**
- Input cell has `state = VACANT`, empty lock
- Output cell has `state = ACTIVE`, buyer's lock, valid assessed value
- Output capacity >= minimum tax deposit
- Type script verifies: `assessed_value >= MIN_ASSESSED` and `capacity >= tax(assessed_value, rate, grace_period)`

**Force-buy (lock script changes):**
- Input cell: current holder's lock, their assessed value, their remaining capacity
- Output cell: buyer's lock, buyer's assessed value, buyer's tax deposit
- A **separate output cell** pays the old holder: `assessed_value + remaining_capacity`
- A **separate output cell** pays the treasury: accrued tax
- Type script validates all three outputs atomically

This is where CKB shines. On Ethereum, the force-buy logic is a sequence of state mutations and external calls within a single function, protected by `nonReentrant`. On CKB, it is a **single atomic transaction** with multiple output cells. The type script validates the entire transition as a unit. No reentrancy concern because there are no intermediate states --- the transaction either produces all correct outputs or it is rejected.

**Delinquency and revocation via Since:**

This is the part that has no EVM equivalent.

CKB's `Since` field enforces time constraints at the **consensus level**. A delinquent license cell cannot be consumed for revocation until `Since` = `delinquentSince + gracePeriod`. This is not a `require(block.timestamp >= ...)` check in application code --- it is a consensus-level constraint that validators enforce before any script even runs.

```
// Ethereum (application-level check):
if (block.timestamp < dSince + gracePeriod) revert GracePeriodNotExpired();

// CKB (consensus-level enforcement):
// Transaction with Since < delinquentSince + 7 days is INVALID
// Script never runs. Constraint is structural.
```

The grace period becomes a **physical property of the cell**, not a conditional check.

### Tax as Capacity: The Elegance

On EVM, the tax balance is a `uint256` in contract storage. It has no physical meaning --- it is a number that the contract tracks and decrements.

On CKB, the tax balance *is the cell's capacity*. CKBytes are the cell's storage rent payment to the network. A license cell's capacity beyond the minimum storage cost is its tax balance. As tax is collected (capacity transferred to a treasury cell), the cell literally shrinks toward its minimum viable size. When capacity hits the minimum, the license is structurally delinquent --- not because a flag was set, but because the cell cannot sustain itself.

This creates a beautiful alignment: **the protocol's tax mechanism and CKB's native storage economics reinforce each other.** Holding a license costs capacity. Capacity is the network's scarce resource. The Harberger mechanism and the CKB resource model are solving the same problem (efficient allocation of scarce resources) through the same mechanism (continuous cost of ownership).

### Composable Augmentations

Our Augmented Mechanism Design paper (posted previously on Nervos Talks) describes five augmentation classes for Harberger taxes: loyalty multipliers, portfolio tax, acquisition premiums, grace period rights of first refusal, and reputation shields.

On EVM, these are all additional `require()` checks and storage mappings crammed into one contract. Upgrading one risks all others.

On CKB, each augmentation is an **independent type script**:

- **Loyalty type script**: Reads `registeredAt` from cell data, computes tenure-based defense multiplier, validates that force-buy price includes the multiplier.
- **Portfolio type script**: Queries the UTXO set for cells with the same type script owned by the same lock script. O(1) via indexer. Validates superlinear tax.
- **Grace period lock script**: Makes the pending acquisition cell unconsuable for 72 hours. Structural, not conditional.

These compose at the transaction level. A force-buy transaction might consume the license cell (validated by the base type script), produce a pending acquisition cell (validated by the grace period lock script), and update a loyalty cell (validated by the loyalty type script). Each script validates its own domain. They compose without coupling.

---

## What This Means for Nervos

### The Immediate Opportunity

Harberger license cells could be a CKB-native primitive for any protocol that allocates scarce resources:

- **DEX features**: Priority execution, enhanced data, featured listings (our use case)
- **NFT marketplace**: Featured collection slots, homepage placement
- **Name services**: Already proven (our VibeNames uses augmented Harberger taxes)
- **API access**: Rate-limited endpoints with Harberger-allocated premium tiers
- **Governance**: Committee seats with continuous cost and force-replacement

The type script is reusable. Any protocol can deploy license cells with their own feature definitions and tax rates.

### What We Would Like to Build

If the Nervos community is interested:

1. **Reference implementation**: HarbergerLicense type script for CKB, with the full lifecycle (claim, assess, force-buy, delinquency, revocation) enforced at the cell level
2. **Augmentation composition demo**: Show how loyalty, portfolio tax, and grace period augmentations compose as independent scripts on CKB
3. **Tax-as-capacity proof of concept**: Demonstrate the alignment between Harberger tax balance and CKB cell capacity

We have the EVM implementation live and tested. The architecture maps cleanly to cells. The question is whether the Nervos ecosystem wants a reference Harberger primitive.

---

## Discussion Questions

1. **Are there other CKB-native protocols that could use Harberger licensing?** We see it as a general-purpose allocation primitive, not a VibeSwap-specific feature.

2. **How should the type script handle tax rate governance?** Our EVM contract lets the owner change tax rates (collecting at the old rate first). On CKB, should the tax rate be immutable in the type script, or should there be a governance cell that the type script references?

3. **Can Since constraints express more complex temporal augmentations?** The 7-day grace period is straightforward. What about graduated time locks (e.g., tenure-dependent grace periods that increase with holding duration)?

4. **What is the indexer performance profile for portfolio queries?** The portfolio tax augmentation depends on counting cells by type script and lock script. Is this fast enough for real-time validation in practice?

5. **Does the capacity-as-tax-balance alignment create economic edge cases?** When CKB storage rent and Harberger tax both draw from the same capacity pool, is there a scenario where network-level economics interfere with mechanism-level economics?

---

## The Bigger Picture

This post connects to our earlier Nervos Talks post on [Augmented Mechanism Design](augmented-mechanism-design-post.md). That post introduced the AMD pattern: take pure mechanisms, preserve their core property, armor them against adversarial exploitation. HarbergerLicense is the *pure base mechanism* for feature allocation. The augmentations (loyalty, portfolio tax, grace period, acquisition premium) are the armor.

CKB's cell model is the substrate where this composition is most natural. Not because CKB was designed for Harberger taxes --- but because CKB was designed for **explicit state ownership and composable verification**, which is exactly what augmented mechanisms require.

We are building on EVM because that is where users are today. But the architecture analysis is unambiguous: CKB is the better substrate for this class of mechanism. We would rather build the reference implementation on the right substrate than accumulate technical debt on the convenient one.

---

*"Fairness Above All."*
*--- P-000, VibeSwap Protocol*

*Contract: [`contracts/mechanism/HarbergerLicense.sol`](https://github.com/wglynn/vibeswap)*
*Formal paper: [`docs/papers/harberger-license-mechanism.md`](https://github.com/wglynn/vibeswap/blob/master/docs/papers/harberger-license-mechanism.md)*
*AMD paper: [`docs/papers/augmented-mechanism-design.md`](https://github.com/wglynn/vibeswap/blob/master/docs/papers/augmented-mechanism-design.md)*
*Code: [github.com/wglynn/vibeswap](https://github.com/wglynn/vibeswap)*
