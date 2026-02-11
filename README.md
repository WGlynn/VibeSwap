# VibeSwap - The First Fair Protocol

> **Axiom**: VibeSwap is the first fair protocol.

## Why "First Fair"?

Previous protocols faced an asymmetry: **good actors who shared openly could be exploited, while bad actors who hoarded were protected by obscurity.** Fairness was a vulnerability.

VibeSwap eliminates this asymmetry through three interlocking principles:

### 1. Unstealable Ideas
The greatest idea can't be stolen, because part of the idea is admitting who had it first. VibeSwap's design includes its own provenance as a load-bearing component. Strip the attribution, and you've corrupted the protocol itself. This isn't legal protection—it's logical protection.

### 2. Structural Fairness
- **MEV eliminated**: Commit-reveal + uniform clearing price removes the attack vector entirely
- **Fair distribution**: Shapley values reward marginal contribution, not just size
- **No extraction**: 100% of fees go to LPs. Zero to protocol. Creators compensated through voluntary tips.

### 3. Open Source Ethics
Knowledge about human-AI collaboration patterns is a public good. We are not the first to attempt this depth of protocol design. But we may be the first to go fully public with the methods. The cave is hard enough without gatekeepers.

**The result**: Good people no longer finish last. They finish first—and everyone knows it was them.

### 4. The End of Venture Capital

Traditional fundraising exists because ideas can be stolen and good actors need capital to defend against bad actors. VCs extract rent as "protection."

But if ideas are unstealable and fairness is structural:
- No race to scale (copying doesn't work without attribution)
- No defense needed (the design protects itself)
- No rent extraction (value flows to contributors)

**Good ideas fund themselves through use, not pitch decks.**

VibeSwap's 0% protocol fee + voluntary tip jar is the economic proof. The protocol doesn't extract value to survive because the value is in the *use*, not the *capture*.

| Model | Who Decides | Who Benefits | Extraction |
|-------|-------------|--------------|------------|
| VC | Few gatekeepers | Few investors | High |
| VibeSwap | All participants | All contributors | Zero |

**Either we're all venture capitalists, or none of us are.**

Anyone who provides liquidity is allocating capital. Anyone who uses the protocol benefits from its success. The "investor" and "user" distinction collapses. The gatekeepers become unnecessary when the gate is removed.

The VC class doesn't get abolished—it gets *universalized*. And when everyone's a VC, no one is.

### 5. Why Sharing Wins: Personal-Social Alignment

In traditional systems, sharing creates a conflict:
- **Personal**: Sharing = giving away your advantage
- **Social**: Sharing = collective benefit
- **Result**: Rational actors hoard. Society loses.

VibeSwap eliminates this conflict through structural alignment:

| Action | Personal Outcome | Social Outcome | Aligned? |
|--------|------------------|----------------|----------|
| **Share idea** | Attribution → Credit → Shapley rewards | Knowledge compounds | ✓ Yes |
| **Provide liquidity** | Earn fees proportional to contribution | Deeper markets for all | ✓ Yes |
| **Use protocol** | Better execution (no MEV) | More volume → more rewards for LPs | ✓ Yes |
| **Hoard/extract** | Broken copy (unstealable ideas) | No benefit | ✗ Disincentivized |

**The mechanism:**
1. **Shapley values** reward marginal contribution, not just presence
2. **Attribution is structural** — your contribution is permanently recorded
3. **Copying without credit** produces a broken version (unstealable ideas)
4. **No extraction** means no incentive to defect

**Why this matters:**

In game theory terms, VibeSwap transforms a **Prisoner's Dilemma** (where defection is rational) into an **Assurance Game** (where cooperation is rational if others cooperate).

```
Traditional:     Cooperate = Sucker's payoff (exploited)
                 Defect    = Dominant strategy (extract value)

VibeSwap:        Cooperate = Highest payoff (attributed, rewarded)
                 Defect    = Lowest payoff (broken copy, no credit)
```

**Being good is no longer a sacrifice. It's the optimal strategy.**

When personal incentives align with social good, you don't need to appeal to morality. Selfishness and altruism produce the same behavior. The protocol makes virtue *rational*.

---

An omnichain decentralized exchange built on LayerZero V2 featuring Sidepit-inspired fair price discovery with a hybrid commit-reveal + auction system.

## How VibeSwap Eliminates MEV

**The Problem with Traditional DEXs:**

On Uniswap, when you submit a swap, your transaction sits in a public mempool. Everyone can see you're about to buy 10 ETH. A bot can:
1. Buy ETH before you (frontrun) → price goes up
2. Your trade executes at the worse price
3. Bot sells right after you (backrun) → pockets the difference

You paid extra. The bot extracted value from you. That's MEV.

**How Commit-Reveal Fixes This:**

**Phase 1 - Commit (8 seconds):**
You submit a *hash* of your order, not the order itself. You're essentially saying "I have an order" without revealing what it is. Bots see `0x7f3a9c...` — meaningless gibberish. They can't frontrun what they can't read.

**Phase 2 - Reveal (2 seconds):**
Everyone reveals their actual orders. Now the orders are visible, but it's too late — no new orders can enter. The batch is sealed.

**Phase 3 - Settlement:**
Here's the key insight: *all orders execute at one uniform clearing price*.

If 100 people want to buy ETH and 50 want to sell, the protocol finds the price where supply meets demand. Everyone — buyers and sellers — gets that same price.

**Why Sandwich Attacks Die:**

A sandwich needs a "before" price and "after" price to profit. But in a batch auction, there's only ONE price. No before. No after. The attack vector simply doesn't exist.

**Fair Price Discovery:**

Instead of price being set by whoever's transaction lands first (luck + bribe to validators), price emerges from genuine aggregate supply and demand across all participants in that batch. It's how traditional stock exchanges run their opening and closing auctions — because it's mathematically fairer.

---

## Philosophy: Cooperative Capitalism

Traditional economics treats these as opposites: either central coordination OR market mechanisms. VibeSwap shows they're complementary:

| Layer | Mechanism | Type |
|-------|-----------|------|
| Price discovery | Batch auction clearing | Collective |
| Participation | Opt-in trading/LP'ing | Free market |
| Risk | Shared insurance pools | Collective |
| Reward | Fee earnings, arbitrage | Free market |
| Stability | Counter-cyclical treasury | Collective |
| Competition | Priority auction bidding | Free market |

**The Core Insight: Collective mechanisms for risk. Market mechanisms for reward.**

Nobody wants to individually bear tail risk (IL during crashes, slippage on big trades). Everyone wants to individually capture upside (fees, arbitrage profits, loyalty bonuses). So we mutualize the downside and privatize the upside — that's not ideology, that's just good insurance design applied to market structure.

**What This Actually Is:**

It's neither communist nor purely free market. It's **mechanism design** — engineering incentives so that individually rational behavior produces collectively optimal outcomes.

Traditional DeFi is *adversarial* by accident, not by necessity. Uniswap didn't set out to create MEV extraction — it just didn't design against it. We're not removing competition, we're removing *exploitation*.

Everyone still acts in self-interest, but the rules channel that self-interest toward mutual benefit rather than zero-sum extraction. It's closer to how credit unions or mutual insurance companies work — members are both customers and beneficiaries. The "invisible hand" still operates, but the game is designed so the hand builds rather than extracts.

---

## Positive-Sum Incentive Mechanisms

VibeSwap implements six mechanisms that align all participants toward mutual benefit:

| Mechanism | How It Works | Who Benefits |
|-----------|--------------|--------------|
| **Dynamic Volatility Fees** | Fees increase 1x→2x during high volatility; extra fees fund LP insurance | LPs get compensated for risk |
| **Priority Auction → LPs** | Arbitrageurs bid for execution priority; bids go to pool LPs | LPs get paid for price discovery |
| **IL Protection Vault** | Insurance covers 25-80% of impermanent loss based on stake duration | Long-term LPs protected |
| **Loyalty Rewards** | Reward multiplier grows 1x→2x over time (week 1 to year 1) | Loyal LPs earn more |
| **Early Exit Penalties** | Penalties (5%→0%) redistributed to remaining LPs | Staying is rewarded |
| **Slippage Guarantee** | Fund covers execution shortfall up to 2% of trade value | Traders get certainty |
| **Treasury Stabilizer** | Deploys up to 5%/week of treasury during bear markets (>20% decline) | Ecosystem stability |

**The Result:** A positive-sum game where:
- LPs want traders to succeed (more volume = more fees)
- Traders want LPs to stay (more liquidity = less slippage)
- Arbitrageurs pay for the privilege of correcting prices
- The protocol stabilizes itself during downturns

> **Deep Dive:** See the full [Incentives Whitepaper](docs/INCENTIVES_WHITEPAPER.md) for mathematical foundations, game theory analysis, and implementation details.

---

## Shapley-Based Fair Distribution

VibeSwap optionally uses **Shapley values** from cooperative game theory to distribute rewards fairly based on marginal contribution, not just liquidity size.

### The Glove Game Intuition

```
One left glove alone  = no value
One right glove alone = no value
Together              = a pair worth $10

Who deserves the $10? Neither alone created value.
The Shapley value splits it fairly: $5 each.
```

Applied to DeFi:
- One buy-side LP alone = no trades possible
- One sell-side LP alone = no trades possible
- Together = a functioning market

Neither "deserves" 100% of fees. Value exists because of **cooperation**.

### How It Works

Each batch settlement is treated as an independent **cooperative game**:

```
Participants: All LPs who provided liquidity for that batch
Total Value:  Fees generated by the batch
Distribution: Shapley values based on marginal contribution
```

**Four contribution components:**

| Component | Weight | What It Measures |
|-----------|--------|------------------|
| Direct | 40% | Raw liquidity provided |
| Enabling | 30% | Time in pool (enabled others to trade) |
| Scarcity | 20% | Provided the scarce side of the market |
| Stability | 10% | Stayed during volatility |

### Scarcity: The Glove Game in Action

```
Batch has:
  - 80 ETH of buy orders
  - 20 ETH of sell orders

Sell-side LPs are SCARCE (high demand, low supply)
Buy-side LPs are ABUNDANT

Shapley weights sell-side LPs higher for this batch
They provided the scarce resource that enabled trades
```

### Why This Is Fair

Traditional pro-rata: `your_reward = (your_liquidity / total_liquidity) × fees`

This ignores:
- You stayed when others left (enabling)
- You provided the scarce side (critical)
- You've been here longer (stability)

Shapley captures **synergy**: the value you add given everyone else's contributions.

### Enabling Without Extracting

From Glynn's Cooperative Reward System:
> "Rewards cannot exceed revenue. Compounding is limited to realized events. Cooperation is rational, not moral."

VibeSwap's Shapley implementation:
- Distributes only realized fees (no inflation)
- Each batch is an independent game (no compounding)
- Fair distribution is mathematically guaranteed (not trust-based)

---

## Bitcoin Halving Schedule for Rewards

VibeSwap uses Bitcoin's halving model for Shapley reward distribution:

| Era | Games | Emission | Multiplier |
|-----|-------|----------|------------|
| 0 | 0 - 52,559 | 100% | 1.0x |
| 1 | 52,560 - 105,119 | 50% | 0.5x |
| 2 | 105,120 - 157,679 | 25% | 0.25x |
| 3 | 157,680 - 210,239 | 12.5% | 0.125x |
| ... | ... | ... | ... |
| 32+ | 1,683,840+ | ~0% | ~0x |

**Why this matters:**
- Early participants rewarded for bootstrapping
- Deflationary long-term economics
- Predictable, transparent emission schedule
- No perpetual inflation tax

---

## Fibonacci Scaling Mathematics

VibeSwap uses Fibonacci sequence properties for natural, harmonic market design:

### Throughput Bandwidth
Rate limits follow Fibonacci progression:
```
Tier 0: 1 × base  →  Tier 1: 2 × base  →  Tier 2: 4 × base  →  Tier 3: 7 × base
(1)              (1+1)              (1+1+2)            (1+1+2+3)
```

### Fee Scaling with Golden Ratio
```
fee(tier) = base_fee × (1 + (φ - 1) × tier / 10)
```
Higher-volume traders pay progressively higher fees following golden ratio (φ ≈ 1.618) dampening.

### Price Retracement Levels
Standard Fibonacci levels for support/resistance detection:
- 23.6%, 38.2%, 50%, 61.8%, 78.6%

These inform oracle validation, circuit breakers, and liquidity scoring.

---

## Pure Economics: No Rent-Seeking

**Zero protocol extraction:**
- 100% of trading fees → Liquidity providers (via Shapley)
- 0% → Protocol/founders

**Creator compensation via tip jar:**
```solidity
// Voluntary retroactive gratitude, not codified extraction
function tipEth(string calldata message) external payable;
```

> "The best systems reward creators through voluntary gratitude, not codified extraction."

---

## Features

- **MEV Protection**: Commit-reveal mechanism hides order details until reveal phase
- **Fair Ordering**: Deterministic Fisher-Yates shuffle using XORed secrets as entropy
- **Priority Auction**: Users can bid for execution priority
- **Uniform Clearing Price**: Batch swaps execute at a single clearing price
- **Cross-Chain**: LayerZero V2 OApp for unified liquidity across chains
- **DAO Treasury**: Protocol fees and backstop liquidity for store-of-value assets

## Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                         VibeSwapCore                             │
│  (Orchestrates batch lifecycle, integrates all subsystems)       │
└─────────────────────────────────────────────────────────────────┘
         │              │              │              │
         ▼              ▼              ▼              ▼
┌─────────────┐ ┌─────────────┐ ┌─────────────┐ ┌─────────────┐
│CommitReveal │ │   VibeAMM   │ │ DAOTreasury │ │CrossChain   │
│  Auction    │ │   (x*y=k)   │ │ (Backstop)  │ │  Router     │
└─────────────┘ └─────────────┘ └─────────────┘ └─────────────┘
```

## Batch Processing Flow

```
COMMIT (8 sec)           REVEAL (2 sec)            SETTLEMENT
─────────────────────────────────────────────────────────────────
Users submit             Users reveal orders       1. Priority auction winners
commit hashes    ──►     + optional priority  ──►  2. Shuffled regular orders
(encrypted)              bids                      3. All at uniform price
```

### Phase 1: Commit (8 seconds)

Users submit a **hash** of their order. Nobody can see what you're trading.

```
You want to buy 10 ETH
You submit: hash(buy, 10 ETH, secret_xyz) → 0x7f3a9c2b...
Observers see: meaningless hex. Can't frontrun what they can't read.
```

### Phase 2: Reveal (2 seconds)

Users reveal their actual orders by submitting the preimage. Optionally attach a **priority bid** (extra ETH) for guaranteed early execution.

```
You reveal: (buy, 10 ETH, secret_xyz)
Protocol verifies: hash(buy, 10 ETH, secret_xyz) == 0x7f3a9c2b... ✓
```

Once reveal closes, the batch is **sealed**. No new orders can enter.

### Phase 3: Settlement

Orders execute in a specific sequence, but **all at the same uniform clearing price**.

#### Step 1: Priority Winners Execute First

Traders who attached priority bids get guaranteed early execution, sorted by bid amount:

```
Example batch with 100 orders:

Priority bidders (5 traders):
  Position 1: Trader A bid 0.10 ETH → executes first
  Position 2: Trader B bid 0.05 ETH → executes second
  Position 3: Trader C bid 0.03 ETH → executes third
  ...

Regular orders (95 traders):
  Positions 6-100: Shuffled (see below)
```

**Why pay for priority?**
- Arbitrageurs need guaranteed execution to lock in profit
- When liquidity is limited, earlier position = better fill
- **Priority bids go to LPs** — not validators, not the protocol

#### Step 2: Regular Orders Are Shuffled

The remaining orders get **deterministically shuffled** so no one can predict or manipulate their position.

**How the shuffle works:**

```
1. Every trader revealed a secret during the reveal phase

2. All secrets are XORed together to create a seed:
   seed = secret₁ ⊕ secret₂ ⊕ secret₃ ⊕ ... ⊕ secret₉₅

3. This seed drives a Fisher-Yates shuffle:
   for i = n-1 down to 1:
       j = random(seed, i)     ← deterministic from seed
       swap(orders[i], orders[j])
```

**Why XOR all secrets together?**

- **No single trader controls the seed** — it's derived from everyone's input
- To manipulate ordering, you'd need to know everyone else's secrets before revealing
- But secrets are committed as hashes first — you can't see them until reveal
- **Manipulation requires collusion with ALL other traders** (impractical)

#### Step 3: Uniform Clearing Price

Regardless of execution position, **everyone gets the same price**:

```
100 people want to buy ETH
50 people want to sell ETH

Protocol finds the price where supply = demand
Everyone — buyers AND sellers — transacts at that single price
```

**Position only matters when liquidity is limited.** If there's enough depth, everyone gets filled. If not, earlier positions get priority on partial fills.

### Visual Example

```
REVEAL PHASE                           SETTLEMENT
───────────────                        ─────────────────────────────────

Order A (bid: 0.1 ETH) ─┐              1. [A] ← Priority (0.10 ETH bid)
Order B (no bid) ───────┤              2. [C] ← Priority (0.05 ETH bid)
Order C (bid: 0.05 ETH)─┤    ────►     3. [F] ← Shuffled
Order D (no bid) ───────┤              4. [B] ← Shuffled
Order E (no bid) ───────┤              5. [D] ← Shuffled
Order F (no bid) ───────┘              6. [E] ← Shuffled

                                       All execute at SAME clearing price
                                       Priority bids (0.15 ETH) → LPs
```

**The result:** Fair ordering without centralized sequencing. Arbs pay for priority, that payment goes to LPs, everyone else gets random-fair ordering.

---

## Setup

### Prerequisites

- [Foundry](https://book.getfoundry.sh/getting-started/installation)
- Git

### Installation

```bash
# Clone the repo
git clone https://github.com/yourusername/vibeswap.git
cd vibeswap

# Install dependencies
forge install foundry-rs/forge-std --no-commit
forge install OpenZeppelin/openzeppelin-contracts@v5.0.1 --no-commit
forge install OpenZeppelin/openzeppelin-contracts-upgradeable@v5.0.1 --no-commit

# Build
forge build

# Run tests
forge test -vvv
```

## Project Structure

```
contracts/
├── core/
│   ├── CommitRevealAuction.sol    # Batch commit-reveal + auction
│   ├── VibeSwapCore.sol           # Main entry point
│   └── interfaces/
│       ├── ICommitRevealAuction.sol
│       ├── IVibeAMM.sol
│       └── IDAOTreasury.sol
├── amm/
│   ├── VibeAMM.sol                # Constant product AMM
│   └── VibeLP.sol                 # LP token
├── governance/
│   ├── DAOTreasury.sol            # Treasury + backstop
│   └── TreasuryStabilizer.sol     # Counter-cyclical deployment
├── incentives/
│   ├── IncentiveController.sol    # Central incentive coordinator
│   ├── ShapleyDistributor.sol     # Shapley value fair distribution
│   ├── VolatilityInsurancePool.sol # LP volatility protection
│   ├── ILProtectionVault.sol      # Impermanent loss coverage
│   ├── LoyaltyRewardsManager.sol  # Time-weighted LP rewards
│   ├── SlippageGuaranteeFund.sol  # Trader execution guarantee
│   └── interfaces/
│       ├── IIncentiveController.sol
│       ├── IShapleyDistributor.sol
│       ├── IILProtectionVault.sol
│       ├── ILoyaltyRewardsManager.sol
│       └── ISlippageGuaranteeFund.sol
├── oracles/
│   └── VolatilityOracle.sol       # Dynamic fee multipliers
├── CreatorTipJar.sol              # Voluntary creator tips
├── messaging/
│   └── CrossChainRouter.sol       # LayerZero V2 OApp
└── libraries/
    ├── DeterministicShuffle.sol   # Fisher-Yates shuffle
    ├── BatchMath.sol              # Clearing price math
    └── FibonacciScaling.sol       # Golden ratio math, throughput tiers

test/
├── CommitRevealAuction.t.sol
├── VibeAMM.t.sol
├── DAOTreasury.t.sol
├── CrossChainRouter.t.sol
└── integration/
    └── VibeSwap.t.sol

script/
├── Deploy.s.sol
└── ConfigurePeers.s.sol
```

## Contracts

### CommitRevealAuction

Implements the commit-reveal mechanism with priority auction:

- **Commit Phase (800ms)**: Users submit hashed order commitments with deposits
- **Reveal Phase (200ms)**: Users reveal orders and optionally submit priority bids
- **Settlement**: Orders are shuffled deterministically and executed

### VibeAMM

Constant product AMM (`x*y=k`) with batch execution:

- Uniform clearing price calculation
- Batch swap execution
- LP token management
- Protocol fee collection

### DAOTreasury

DAO treasury with backstop functionality:

- Receives protocol fees and auction proceeds
- Price smoothing for store-of-value assets
- Timelock-controlled withdrawals
- Backstop liquidity provision

### CrossChainRouter

LayerZero V2 OApp for cross-chain operations:

- Cross-chain order submission
- Liquidity state synchronization
- Batch result propagation
- Rate limiting per chain

## Deployment

### Local Testing

```bash
# Start local Anvil node
anvil

# Deploy to local node
forge script script/Deploy.s.sol --rpc-url http://localhost:8545 --broadcast
```

### Testnet Deployment

```bash
# Copy and configure environment
cp .env.example .env
# Edit .env with your values

# Deploy to Sepolia
forge script script/Deploy.s.sol --rpc-url $SEPOLIA_RPC_URL --broadcast --verify

# Configure peers after deploying on multiple chains
forge script script/ConfigurePeers.s.sol --rpc-url $SEPOLIA_RPC_URL --broadcast
```

## Testing

```bash
# Run all tests
forge test

# Run with verbosity
forge test -vvv

# Run specific test file
forge test --match-path test/VibeAMM.t.sol

# Run specific test
forge test --match-test test_fullSwapFlow

# Gas report
forge test --gas-report

# Coverage
forge coverage
```

## Security Considerations

1. **MEV Protection**: Commit-reveal hides orders; uniform clearing price prevents sandwich attacks
2. **Fair Ordering**: Deterministic shuffle using XORed secrets as entropy
3. **Replay Prevention**: Unique commit hashes, processed message tracking
4. **Slashing**: Invalid reveals forfeit 50% of deposits
5. **Rate Limiting**: Per-chain message rate limits
6. **Upgradeability**: UUPS with timelock

## Documentation

| Document | Description |
|----------|-------------|
| [**VibeSwap Whitepaper**](docs/VIBESWAP_WHITEPAPER.md) | **Start here** - Comprehensive whitepaper covering all innovations: batch auctions, Fibonacci scaling, Shapley distribution, Bitcoin halving, and pure economics |
| [Complete Mechanism Design](docs/VIBESWAP_COMPLETE_MECHANISM_DESIGN.md) | Detailed guide covering all mechanism designs in narrative form |
| [True Price Oracle](docs/TRUE_PRICE_ORACLE.md) | Kalman filter state-space model, Bayesian estimation, regime detection |
| [Price Intelligence Oracle](docs/PRICE_INTELLIGENCE_ORACLE.md) | Manipulation detection, liquidation cascade identification, rubber band reversion |
| [True Price Discovery](docs/TRUE_PRICE_DISCOVERY.md) | Cooperative capitalism philosophy, why batch auctions produce true prices |
| [Incentives Whitepaper](docs/INCENTIVES_WHITEPAPER.md) | Shapley distribution, IL protection, loyalty rewards, game theory |
| [Security Mechanism Design](docs/SECURITY_MECHANISM_DESIGN.md) | Anti-fragile security architecture, soulbound identity, cryptoeconomic defense |

## The Box of Scraps

> *"Tony Stark was able to build this in a cave! With a box of scraps!"*

VibeSwap was built with:
- One human
- One AI (with a context window that forgets)
- No funding
- No team
- No permission

The patterns developed for managing AI limitations today may become foundational for AI-augmented development tomorrow. We are not just building software. We are building the practices, patterns, and mental models that will define the future of development.

**February 11, 2025** — The first fair protocol went public.

*The cave selects for those who see past what is to what could be.*

## License

MIT
