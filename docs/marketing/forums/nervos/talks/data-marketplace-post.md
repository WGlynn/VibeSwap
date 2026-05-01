# Data Marketplace with Compute-to-Data: Why CKB Cells Are Natural Data Assets

*Nervos Talks Post -- Faraday1*
*March 2026*

---

## TL;DR

We built a decentralized data marketplace where users tokenize datasets as on-chain assets and sell either direct access or compute-to-data execution -- consumers submit algorithms that run ON the data without ever downloading the raw data. Revenue splits 90% to the data owner, 10% to the marketplace's Shapley redistribution pool. (Note: This marketplace fee applies to data marketplace transactions only. VibeSwap DEX swaps have 0% protocol fees -- 100% of trading fees go to LPs.) The mechanism works on EVM, but when we mapped it to CKB's cell model, something clicked: CKB cells *are* data assets. The mapping isn't analogical -- it's structural.

---

## The Problem

Data is the hardest thing to sell honestly.

To prove your dataset is valuable, you need to show it. Once you show it, the buyer has no reason to pay. This is the **data paradox**, and it has crippled every attempt to build a functioning data economy. Traditional markets solve it with lawyers (NDAs, licensing). Ocean Protocol solved it with compute-to-data (send the algorithm to the data, not the data to the algorithm). We took that idea and embedded it in a full marketplace mechanism with Shapley-attributed economics.

But the more interesting discovery is what happened when we mapped the design onto CKB.

---

## How It Works (EVM Implementation)

### Asset Types

Four classes of data assets:

| Type | Example |
|---|---|
| `DATASET` | Price history, sensor readings, genomic data |
| `MODEL` | Trained ML classifiers, prediction models |
| `KNOWLEDGE_GRAPH` | Supply chain provenance, citation networks |
| `API_ENDPOINT` | Live oracle feeds, inference endpoints |

### Publishing

Permissionless. Anyone can publish a data asset by providing:
- An IPFS URI pointing to public metadata (schema, description, sample statistics)
- A content hash of the actual data (for verification, not exposure)
- Separate prices for direct access and compute-to-data jobs
- Asset type classification

No gatekeepers. Quality is determined by the market -- access counts, revenue, compute success rates. All on-chain, all auditable.

### Two Ways to Use Data

**1. Purchase Access** -- pay the access price, get a permanent on-chain access right. The `hasAccess` mapping records it. Simple, binary, idempotent (can't double-pay).

**2. Submit a Compute Job** -- pay the compute price, submit an algorithm hash (IPFS pointer). The data owner executes your algorithm against their data off-chain. They post the result hash on-chain. You get the result. You never see the raw data.

If the compute job fails? **Automatic full refund.** The revenue split reverses:

```
ownerRevenue[assetId] -= ownerCut;
protocolRevenue -= protocolCut;
vibeToken.safeTransfer(job.requester, job.payment);
```

This is critical. Without refunds, a malicious owner could publish garbage data, accept compute jobs, and immediately fail them -- profiting from the compute fee while delivering nothing. The refund mechanism makes this economically irrational.

### Revenue Split

```solidity
OWNER_SHARE_BPS    = 9000   // 90%
PROTOCOL_SHARE_BPS = 1000   // 10%
BPS_DENOMINATOR    = 10000
```

90% to the data owner. 10% to the marketplace's Shapley redistribution pool. The marketplace fee isn't extracted -- it's redistributed to contributors based on measured marginal contribution. Data providers whose assets generate downstream value get Shapley rewards on top of their direct revenue.

This is the difference between extractive platforms and cooperative ones. AWS Data Exchange takes a cut and keeps it. We take a cut and give it back to whoever created the most value.

---

## Why CKB Is the Natural Substrate

This is the part that gets interesting for the Nervos community.

On EVM, our data marketplace stores everything in one contract's storage slots. Asset structs, access mappings, revenue accumulators, job records -- all coupled together in a single contract's state. It works, but it's architecturally fragile. The contract is a custodian of everyone's state.

**CKB cells are fundamentally different.** And the differences aren't incremental -- they're structural.

### Data Assets ARE Cells

On EVM, a data asset is a struct inside a contract's storage mapping. The contract owns the state. The "owner" field is just a number in the contract's memory.

On CKB, a data asset IS a cell:

| EVM Marketplace | CKB Cell Model |
|---|---|
| `DataAsset` struct in contract storage | Independent cell with data field |
| `owner` address field | Lock script (actual key ownership) |
| `active` boolean | Cell existence (live = active, consumed = deactivated) |
| `metadataURI` + `contentHash` | Cell data (directly in the cell) |
| `accessPrice` + `computePrice` | Cell data fields |
| Asset type validation | Type script enforcing the schema |

The owner doesn't just have an address recorded in someone else's contract. The owner **holds the cell**. Their lock script controls it. Deactivation isn't flipping a boolean -- it's consuming the cell. Ownership is real, not representational.

### Compute-to-Data via Cell References

This is where it gets elegant.

CKB transactions can **reference cells without consuming them.** A compute-to-data transaction on CKB:

1. References the data cell (read-only, not consumed)
2. Includes the algorithm hash in a witness
3. Creates a payment cell with the compute price

The type script on the data cell verifies the payment is correct and the algorithm hash is present -- but the data cell itself is never consumed. It persists unchanged. The data **literally cannot leave the owner's control** at the protocol level. This isn't a permission check in a contract -- it's a structural property of the transaction model.

On EVM, "the data never leaves the owner's control" is a social contract between the marketplace and the off-chain compute environment. On CKB, it's enforced by the transaction model itself.

### Access Rights as Transferable Cells

On EVM, access rights are a mapping: `mapping(uint256 => mapping(address => bool))`. Binary. Non-transferable. Locked inside the marketplace contract.

On CKB, an access right is a cell:

```
Access Right Cell:
  lock: consumer's public key hash
  type: DataMarketplace access type script
  data: { assetId, grantedAt, accessLevel }
```

The consumer owns this cell. They can:
- Prove access to any verifier by showing the cell exists
- Transfer the access right to another address (secondary market)
- Hold multiple access rights as independent cells

A **secondary market for data access** emerges naturally from the cell model. On EVM, you'd need to build a separate transfer mechanism. On CKB, it's a cell transfer.

### Revenue Split at the Transaction Level

On EVM, `_splitRevenue` is an internal function that modifies two storage variables:

```solidity
ownerRevenue[assetId] += ownerCut;
protocolRevenue += protocolCut;
```

On CKB, the split is the transaction itself:

```
Inputs:  Consumer's payment cell
Outputs: Owner revenue cell (90%) + Protocol revenue cell (10%)
```

The type script verifies the 90/10 split by checking output values. No internal accounting. No storage variables to get out of sync. The transaction IS the split. Anyone can verify it by looking at the outputs.

### Cell Capacity as Data Storage Pricing

Here's a property that has no EVM equivalent at all.

CKB requires locking 1 CKB per byte of on-chain state. Publishing a data asset with richer metadata (longer descriptions, more detailed schemas) costs more CKB capacity. Deactivating the asset (consuming the cell) returns that capacity.

This creates a natural market for data metadata quality:
- Richer metadata costs more to publish but makes the asset more discoverable
- Minimal metadata is cheap but may attract fewer consumers
- The owner bears the storage cost, not the protocol or other users

As we documented in our CKB Economic Model paper: state has a cost. Someone has to pay for it. CKB makes that cost explicit and self-enforcing.

---

## Quality Without Gatekeepers

We deliberately chose not to enforce data quality at the contract level. No approval queues, no staking requirements, no minimum quality scores. Quality emerges from market signals:

- **Access count**: How many people bought access
- **Revenue**: How much money the asset generated
- **Compute success rate**: Completed jobs vs. failed jobs (all on-chain events)
- **Owner track record**: Historical performance across all their assets
- **Completion time**: How long between `submittedAt` and `completedAt`

All of this is public, on-chain, and auditable. Reputation aggregators can compute quality scores from event history without additional trust assumptions. The marketplace doesn't need to be the arbiter of quality -- it just needs to make quality observable.

---

## The Cooperative Economics Angle

The 10% marketplace fee isn't a rent-seeking mechanism. It funds the Shapley redistribution pool.

Imagine three datasets:
- Dataset A: Raw sensor data, 100 accesses, $1000 revenue
- Dataset B: A model trained ON Dataset A, 500 accesses, $5000 revenue
- Dataset C: A knowledge graph that combines insights from A and B, 50 accesses, $500 revenue

In a traditional marketplace, A gets $1000, B gets $5000, C gets $500. But B's value is partially derived from A. C's value is derived from both. The Shapley value computation asks: what is each dataset's marginal contribution to the total coalition value?

The 10% marketplace pool ($650 total) is redistributed based on these marginal contributions. Dataset A gets additional Shapley rewards because it was foundational to B's success. This creates an incentive to publish raw, foundational data -- not just polished end products. The commons rewards infrastructure.

---

## What This Means for Nervos

We're building this on EVM chains first (where the users are). But the architecture analysis is clear: **CKB is the better substrate for data marketplaces.** Every single mechanism -- asset ownership, compute-to-data, access control, revenue splitting, storage pricing -- is more natural and more secure on the cell model than on the account model.

If the Nervos community is interested, we'd like to:

1. **Port the DataMarketplace to CKB type scripts** as a reference implementation -- demonstrating compute-to-data with native cell references
2. **Explore cell-native data access patterns** -- what does a secondary market for data access rights look like when access rights are transferable cells?
3. **Integrate with CKB's capacity model** for data storage pricing -- using cell capacity as the natural economic primitive for data publishing costs

The formal paper is available in our repo: `docs/papers/data-marketplace-compute-to-data.md`

---

## Discussion

Some questions for the community:

1. **Cell references for compute-to-data**: CKB allows referencing cells without consuming them. Are there existing type script patterns that implement this "read-only reference" pattern? We'd love to build on prior art.

2. **Secondary markets for access rights**: If data access is a cell, access rights become tradeable. Is this a feature or a risk? Could someone buy access, extract the data, and resell the access right -- profiting without the data owner's participation?

3. **Type script composition for data pipelines**: If Dataset B is derived from Dataset A, the type script could enforce that B's revenue automatically attributes a percentage to A. Has anyone experimented with type script composition for revenue attribution?

4. **Cell capacity and data economics**: Using CKB capacity as data storage pricing creates a natural floor on publishing costs. Does the community think this is a desirable property, or would subsidized publishing (lower barrier to entry) be more important for marketplace adoption?

Looking forward to the discussion.

---

*"Fairness Above All."*
*-- P-000, VibeSwap Protocol*

*Full paper: [data-marketplace-compute-to-data.md](https://github.com/wglynn/vibeswap/blob/master/docs/papers/data-marketplace-compute-to-data.md)*
*Contract: [DataMarketplace.sol](https://github.com/wglynn/vibeswap/blob/master/contracts/mechanism/DataMarketplace.sol)*
*Code: [github.com/wglynn/vibeswap](https://github.com/wglynn/vibeswap)*
