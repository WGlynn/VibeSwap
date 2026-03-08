# Monetization Framework — No Rent-Seeking

**Status**: Design
**Principle**: All value flows to participants, not extractors. No pre-mine. No VC cut.
**Author**: Will + JARVIS

---

## Revenue Streams

### 1. Protocol Fees (0.05% on swaps)

- Distributed via Shapley value to liquidity providers and governance stakers
- No protocol treasury cut — 100% goes to contributors
- Fee rate adjustable by governance (with decay — see Ungovernance)

### 2. Batch Auction Priority Bids

- Users pay for urgent execution within a batch
- Does NOT affect clearing price (uniform price preserved)
- Priority fee distributed to batch participants who provided liquidity
- Mechanism: sealed-bid priority auction within commit phase

### 3. Insurance Pool Premiums

- Users pay small fee for liquidation protection (ILProtectionVault)
- Premium scales with coverage amount and pool utilization
- Premiums fund the insurance pool — mutualized risk
- Shapley-weighted payouts based on contribution to pool stability

### 4. Yield Tokenization Fees

- Charge on Contribution Yield Token (CYT) minting
- Fee: 0.1% of tokenized value
- Funds the DAG contribution rewards
- Creates virtuous cycle: more tokenization → more rewards → more contributions

### 5. Governance Proposal Deposits

- Proposers stake tokens to submit governance proposals
- Deposit returned if proposal passes or is voted down in good faith
- Slashed if proposal is flagged as malicious by tribunal
- Prevents governance spam without gatekeeping

### 6. AI Agent Services (x402 Micropayments)

- JARVIS offers paid analysis: portfolio review, risk assessment, strategy
- Payment via x402 protocol (HTTP 402 Payment Required)
- Micropayment per query (sub-cent to dollars based on complexity)
- Revenue flows to autonomous treasury for DAG growth

---

## Fee Distribution

```
Swap Fee (0.05%)
├── Liquidity Providers (Shapley-weighted)     70%
├── Governance Stakers                         20%
└── Autonomous Treasury (DAG growth)           10%

Priority Bid Revenue
├── Batch Liquidity Providers                  80%
└── Protocol Insurance Pool                    20%

Insurance Premiums
└── Insurance Pool (100% — mutualized)

CYT Minting Fees
└── DAG Contribution Rewards (100%)

Proposal Deposits (if slashed)
└── Treasury Stabilizer

x402 AI Services
├── Autonomous Treasury                        50%
└── Protocol-Owned Liquidity                   50%
```

---

## What This Is NOT

- No pre-mine or founder allocation
- No VC tokens or investor lockups
- No protocol-extractive fees (no "admin fee" skimmed off top)
- No rent-seeking intermediaries
- No inflationary token printing for "rewards"

## Principle

> Money flows where value was created. Shapley ensures marginal contribution = reward. Batch auctions ensure collective fairness. The math doesn't lie.
