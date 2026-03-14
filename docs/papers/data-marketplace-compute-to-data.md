# Data Marketplace with Compute-to-Data Privacy Preservation

**Faraday1, JARVIS** | March 2026 | VibeSwap Research

---

## Abstract

We present the design and implementation of a decentralized data marketplace that combines Ocean Protocol's data-as-NFT paradigm with compute-to-data privacy preservation and Shapley-attributed revenue distribution. Users tokenize datasets, trained models, knowledge graphs, and API endpoints as on-chain data assets. Consumers purchase either direct access rights or submit algorithms that execute against the data without the raw data ever leaving the owner's control. Revenue is split deterministically: 90% to the data owner (`OWNER_SHARE_BPS = 9000`) and 10% to the protocol's Shapley redistribution pool (`PROTOCOL_SHARE_BPS = 1000`), creating a cooperative economic loop where data providers are compensated for contributions to collective intelligence. Failed compute jobs trigger automatic full refunds, reversing the revenue split to protect consumers. The architecture maps naturally onto Nervos CKB's cell model, where data cells with type scripts enforce compute-to-data access patterns and cell capacity serves as a natural pricing mechanism for data storage. The result is a marketplace where privacy is structural rather than contractual, where data has sovereign economic identity, and where the incentives of providers, consumers, and the protocol are aligned by construction.

---

## 1. Introduction

### 1.1 The Data Paradox

Data is the most valuable resource of the information age and simultaneously the most difficult to monetize without destroying it. The fundamental paradox: to demonstrate data's value, you must reveal it; but once revealed, the buyer has no reason to pay. Traditional data markets resolve this through legal contracts (NDAs, licensing agreements) that are expensive to enforce and trivial to violate. The data either leaks or stays locked away.

This is not a technology problem. It is a mechanism design problem.

### 1.2 Prior Art

**Ocean Protocol** (McConaghy et al., 2018) introduced the paradigm of data-as-NFT with compute-to-data execution. Data stays with the owner; algorithms travel to the data. The insight is correct, but Ocean's marketplace operates as a standalone protocol with its own token economics, creating adoption friction for existing DeFi ecosystems.

**OriginTrail** established knowledge assets as structured, verifiable knowledge graphs anchored to decentralized networks. The Decentralized Knowledge Asset (DKA) pattern treats knowledge as a first-class economic object with provenance and verifiability.

**Filecoin and Arweave** solve data *storage* but not data *access control*. You can store encrypted data permanently, but the marketplace dynamics of who can compute against it, under what terms, and with what revenue split are out of scope.

### 1.3 Our Contribution

VibeSwap's DataMarketplace synthesizes these approaches into a single contract that:

1. Tokenizes data assets internally (ERC-721-style ownership tracking without external NFT dependencies)
2. Implements compute-to-data as a first-class protocol primitive with on-chain job lifecycle management
3. Splits revenue through a deterministic 90/10 mechanism that feeds into Shapley redistribution
4. Provides automatic refunds for failed compute jobs, reversing the revenue split
5. Maps cleanly onto Nervos CKB's cell model for a privacy-native implementation

The marketplace is deployed as a UUPS-upgradeable contract with OpenZeppelin v5.0.1 security primitives, consistent with VibeSwap's broader contract architecture.

---

## 2. Data Asset Model

### 2.1 Asset Types

The marketplace supports four asset types, reflecting the full spectrum of data-as-value:

```solidity
enum AssetType { DATASET, MODEL, KNOWLEDGE_GRAPH, API_ENDPOINT }
```

| Type | Description | Example |
|---|---|---|
| `DATASET` | Raw or processed data collections | Price history, genomic sequences, sensor readings |
| `MODEL` | Trained machine learning models | Sentiment classifiers, price predictors, image generators |
| `KNOWLEDGE_GRAPH` | Structured relational knowledge | Supply chain provenance, academic citation networks |
| `API_ENDPOINT` | Live data feeds or computation services | Real-time oracle feeds, inference endpoints |

This taxonomy is not arbitrary. Each type has different privacy characteristics: datasets require the strongest compute-to-data isolation; models may allow inference without exposing weights; knowledge graphs permit subgraph queries; API endpoints are inherently interactive. The type field enables future type-specific access control policies without modifying the core marketplace contract.

### 2.2 Asset Structure

Each data asset is represented on-chain by the `DataAsset` struct:

```solidity
struct DataAsset {
    uint256 assetId;
    address owner;
    string metadataURI;       // IPFS URI for metadata
    bytes32 contentHash;      // Hash of actual data
    uint256 accessPrice;      // Price per access in VIBE
    uint256 computePrice;     // Price per compute job in VIBE
    uint256 totalAccesses;
    uint256 totalRevenue;
    AssetType assetType;
    bool active;
}
```

Two critical design decisions:

**Separation of metadata and content.** The `metadataURI` points to a publicly-readable IPFS document describing the dataset (schema, size, provenance, sample statistics). The `contentHash` is the keccak256 hash of the actual data content. This allows discovery without exposure: consumers can evaluate whether a dataset is relevant without accessing the data itself. The content hash provides verifiability -- consumers can confirm they received the correct data after purchase.

**Dual pricing.** Each asset has independent prices for access (`accessPrice`) and computation (`computePrice`). Access purchases grant the right to read the data directly. Compute purchases grant the right to submit an algorithm that executes against the data. The owner sets both prices independently, enabling a pricing strategy where direct access (higher trust required) costs more than compute access (privacy preserved).

### 2.3 Publishing

Asset publication is permissionless with minimal validation:

```solidity
function publishAsset(
    string calldata metadataURI,
    bytes32 contentHash,
    uint256 accessPrice,
    uint256 computePrice,
    AssetType assetType
) external nonReentrant returns (uint256)
```

The contract validates that `metadataURI` is non-empty and `contentHash` is non-zero. Asset IDs are assigned sequentially from `nextAssetId`, starting at 1. The publishing transaction is protected by `nonReentrant` to prevent reentrancy during asset registration.

The permissionless design is deliberate. Data quality is not enforced at the contract level -- it emerges from the marketplace dynamics of access counts, revenue, and reputation (observable from on-chain event history). A dataset with zero purchases and zero revenue is de facto low-quality, regardless of its metadata claims. This mirrors VibeSwap's broader philosophy: let markets determine value, not gatekeepers.

---

## 3. Access Control

### 3.1 Access Purchase

The `purchaseAccess` function grants on-chain access rights to a data asset:

```solidity
function purchaseAccess(uint256 assetId) external nonReentrant {
    DataAsset storage asset = _getActiveAsset(assetId);
    if (hasAccess[assetId][msg.sender]) revert AlreadyHasAccess();

    uint256 price = asset.accessPrice;
    if (price > 0) {
        vibeToken.safeTransferFrom(msg.sender, address(this), price);
        _splitRevenue(assetId, price);
    }

    hasAccess[assetId][msg.sender] = true;
    asset.totalAccesses++;

    emit AccessPurchased(assetId, msg.sender, price);
}
```

Key properties:

- **Idempotent**: `AlreadyHasAccess` prevents double-payment. Once access is granted, it is permanent for that address.
- **Free-tier compatible**: If `accessPrice == 0`, access is granted without token transfer. This supports open datasets that generate revenue through compute fees alone.
- **Atomic revenue split**: Payment and revenue distribution occur in the same transaction via `_splitRevenue`, preventing state inconsistency.

### 3.2 Access Mapping

Access rights are stored in a two-dimensional mapping:

```solidity
mapping(uint256 => mapping(address => bool)) public hasAccess;
```

This is a binary access model (has access or does not). Future upgrades may introduce tiered access levels (preview, full, commercial) without modifying the core mapping structure, since the UUPS proxy pattern allows storage-compatible upgrades.

---

## 4. Compute-to-Data Protocol

### 4.1 The Core Principle

Compute-to-data inverts the traditional data access model. Instead of downloading data and running algorithms locally, the consumer submits an algorithm that executes in the data owner's environment. The raw data never leaves the owner's control. Only the computation results are returned.

This is not merely a privacy feature. It is a mechanism design primitive that resolves the data paradox: the consumer extracts value from the data (computation results) without ever possessing the data itself. The data remains rivalrous -- it cannot be copied, resold, or leaked through the compute interface.

### 4.2 Job Lifecycle

A compute job progresses through four states:

```solidity
enum ComputeStatus { PENDING, RUNNING, COMPLETED, FAILED }
```

The lifecycle is:

```
Consumer submits job (PENDING)
    → Data owner begins execution (RUNNING)
    → Execution succeeds → owner posts result hash (COMPLETED)
    → Execution fails → owner marks failure, payment refunded (FAILED)
```

### 4.3 Job Submission

```solidity
function submitComputeJob(
    uint256 assetId,
    bytes32 algorithmHash
) external nonReentrant returns (bytes32)
```

The consumer specifies the target asset and the IPFS hash of their algorithm. Payment is transferred and split at submission time. The job ID is derived deterministically:

```solidity
bytes32 jobId = keccak256(
    abi.encodePacked(assetId, msg.sender, algorithmHash, _jobNonce++)
);
```

The nonce prevents collision when the same consumer submits the same algorithm against the same asset multiple times. Each job is unique regardless of input parameters.

The `ComputeJob` struct records the full context:

```solidity
struct ComputeJob {
    bytes32 jobId;
    uint256 assetId;
    address requester;
    bytes32 algorithmHash;    // IPFS hash of the algorithm to run
    bytes32 resultHash;       // IPFS hash of the result (set after completion)
    uint256 payment;
    ComputeStatus status;
    uint256 submittedAt;
    uint256 completedAt;
}
```

### 4.4 Job Completion

The data owner executes the algorithm against their data off-chain and posts the result hash on-chain:

```solidity
function completeComputeJob(
    bytes32 jobId,
    bytes32 resultHash
) external nonReentrant
```

Only the asset owner can complete the job (`NotJobProvider` error otherwise). The job must be in `PENDING` or `RUNNING` state. Upon completion, the `resultHash` is stored on-chain, providing a verifiable pointer to the computation output on IPFS.

### 4.5 Job Failure and Automatic Refund

When a compute job fails (algorithm incompatible with the data, execution error, timeout), the data owner calls `failComputeJob`:

```solidity
function failComputeJob(bytes32 jobId) external nonReentrant
```

This triggers a full refund mechanism that *reverses* the revenue split:

```solidity
if (job.payment > 0) {
    uint256 ownerCut = (job.payment * OWNER_SHARE_BPS) / BPS_DENOMINATOR;
    uint256 protocolCut = job.payment - ownerCut;

    ownerRevenue[job.assetId] -= ownerCut;
    protocolRevenue -= protocolCut;
    asset.totalRevenue -= job.payment;

    vibeToken.safeTransfer(job.requester, job.payment);
}
```

The refund is precise: the 90% owner share and 10% protocol share are deducted from their respective accumulators, and the full original payment is returned to the consumer. This ensures neither the data owner nor the protocol profits from failed computations.

This refund mechanism is critical for marketplace trust. Without it, a malicious data owner could publish an empty dataset at high compute prices, accept jobs, and immediately fail them -- keeping the revenue. With the refund, the incentive is aligned: owners only profit when they deliver results.

---

## 5. Revenue Economics

### 5.1 The Split

Revenue distribution is governed by two constants:

```solidity
uint256 public constant OWNER_SHARE_BPS = 9000;     // 90%
uint256 public constant PROTOCOL_SHARE_BPS = 1000;   // 10%
uint256 public constant BPS_DENOMINATOR = 10000;
```

The 90/10 split reflects VibeSwap's Cooperative Capitalism philosophy: the data provider -- who bore the cost of collecting, cleaning, and maintaining the data -- receives the supermajority of revenue. The protocol retains 10% for the Shapley redistribution pool, which funds public goods, infrastructure maintenance, and contributor rewards.

### 5.2 Revenue Split Implementation

```solidity
function _splitRevenue(uint256 assetId, uint256 amount) internal {
    uint256 ownerCut = (amount * OWNER_SHARE_BPS) / BPS_DENOMINATOR;
    uint256 protocolCut = amount - ownerCut;

    ownerRevenue[assetId] += ownerCut;
    protocolRevenue += protocolCut;
    _assets[assetId].totalRevenue += amount;
}
```

The `protocolCut` is computed as the remainder (`amount - ownerCut`) rather than a separate multiplication. This ensures that rounding errors benefit the protocol rather than creating dust that belongs to neither party. For a payment of 100 VIBE:

- `ownerCut = (100 * 9000) / 10000 = 90 VIBE`
- `protocolCut = 100 - 90 = 10 VIBE`
- `totalRevenue = 100 VIBE` (gross, for analytics)

### 5.3 Revenue Withdrawal

Data owners withdraw accumulated revenue per asset:

```solidity
function withdrawRevenue(uint256 assetId) external nonReentrant
```

The withdrawal pattern follows checks-effects-interactions: the `ownerRevenue` mapping is zeroed before the token transfer, preventing reentrancy attacks even without the `nonReentrant` modifier (which is applied as defense-in-depth).

Protocol revenue is withdrawn by the contract owner (governance):

```solidity
function withdrawProtocolRevenue(address to) external onlyOwner nonReentrant
```

The `onlyOwner` modifier ensures that protocol revenue can only be directed to governance-approved destinations, preventing unauthorized extraction.

### 5.4 Shapley Integration

The 10% protocol share flows into VibeSwap's Shapley redistribution pool. The ShapleyDistributor contract (documented in `docs/papers/shapley-value-distribution.md`) attributes value to contributors based on their marginal contribution to coalition outcomes. In the data marketplace context:

- A dataset that is frequently used as training data for models that generate revenue has high Shapley value
- A knowledge graph that is queried by multiple downstream applications has high Shapley value
- An API endpoint that serves as infrastructure for other marketplace assets has high Shapley value

The 10% protocol fee is not a tax. It is a contribution to the cooperative commons that is redistributed based on measured contribution. This is the distinction between extractive and cooperative economics: extractive protocols take a cut and keep it; cooperative protocols take a cut and redistribute it to those who created the most value.

---

## 6. Data Quality and Reputation

### 6.1 On-Chain Quality Signals

The contract does not enforce data quality directly. Instead, it exposes all the signals necessary for quality assessment through on-chain state and events:

| Signal | Source | Interpretation |
|---|---|---|
| `totalAccesses` | `DataAsset.totalAccesses` | Market-validated demand |
| `totalRevenue` | `DataAsset.totalRevenue` | Economic value generated |
| Compute success rate | `ComputeJobCompleted` vs `ComputeJobFailed` events | Reliability |
| Owner history | Event log across all owner's assets | Track record |
| Access price / compute price ratio | `DataAsset` fields | Owner's confidence in privacy |

### 6.2 Emergent Reputation

Reputation emerges from observable behavior rather than explicit scoring:

- An owner whose assets have high access counts and low failure rates has demonstrated reliability
- An owner who frequently calls `failComputeJob` has a reliability problem
- An owner whose assets are deactivated (`AssetDeactivated` events) shortly after publication may be testing or unreliable
- Compute job completion time (`completedAt - submittedAt`) indicates operational capacity

This data is fully on-chain and auditable. Third-party reputation aggregators can compute quality scores from event history without requiring additional trust assumptions.

### 6.3 Deactivation as Quality Signal

Asset owners can deactivate assets:

```solidity
function deactivateAsset(uint256 assetId) external
```

Deactivated assets cannot be purchased or computed against (`AssetNotActive` error). This is both a practical feature (sunset deprecated datasets) and a quality signal (owners proactively removing assets they can no longer maintain). The fact that deactivation is voluntary and irreversible-by-default (though the owner could reactivate through a contract upgrade) makes it a credible signal of data lifecycle management.

---

## 7. Security Model

### 7.1 Access Control

| Function | Access Control | Rationale |
|---|---|---|
| `publishAsset` | Any address | Permissionless publishing |
| `purchaseAccess` | Any address | Permissionless purchasing |
| `submitComputeJob` | Any address | Permissionless computation |
| `completeComputeJob` | Asset owner only | Only the data holder can produce results |
| `failComputeJob` | Asset owner only | Only the data holder can declare failure |
| `updatePrice` | Asset owner only | Sovereign pricing |
| `deactivateAsset` | Asset owner only | Sovereign lifecycle |
| `withdrawRevenue` | Asset owner only | Revenue belongs to owner |
| `withdrawProtocolRevenue` | Contract owner (governance) | Protocol treasury |
| `_authorizeUpgrade` | Contract owner (governance) | UUPS upgrade authority |

### 7.2 Reentrancy Protection

All state-modifying functions that involve token transfers are protected by `nonReentrant`:

- `publishAsset` -- prevents reentrancy during asset registration
- `purchaseAccess` -- prevents reentrancy during token transfer and revenue split
- `submitComputeJob` -- prevents reentrancy during payment and job creation
- `completeComputeJob` -- prevents reentrancy during status update
- `failComputeJob` -- prevents reentrancy during refund transfer
- `withdrawRevenue` -- prevents reentrancy during owner payout
- `withdrawProtocolRevenue` -- prevents reentrancy during protocol payout

### 7.3 Input Validation

The contract validates critical inputs at the publishing stage:

```solidity
if (bytes(metadataURI).length == 0) revert InvalidMetadataURI();
if (contentHash == bytes32(0)) revert InvalidContentHash();
```

Asset existence is validated through the zero-address check on `owner`:

```solidity
if (asset.owner == address(0)) revert AssetNotFound();
```

Active status is enforced by `_getActiveAsset`:

```solidity
if (!asset.active) revert AssetNotActive();
```

### 7.4 Token Safety

All token operations use OpenZeppelin's `SafeERC20`:

```solidity
using SafeERC20 for IERC20;
```

This protects against tokens that do not return a boolean on `transfer`/`transferFrom` (a common ERC-20 non-compliance issue). The `safeTransferFrom` and `safeTransfer` wrappers revert on failure regardless of the token's return behavior.

### 7.5 Upgradeability

The contract uses the UUPS proxy pattern with an empty `_authorizeUpgrade`:

```solidity
function _authorizeUpgrade(address newImplementation) internal override onlyOwner {}
```

The `onlyOwner` modifier restricts upgrades to governance. The constructor disables initializers on the implementation contract to prevent initialization hijacking:

```solidity
constructor() {
    _disableInitializers();
}
```

---

## 8. CKB Cell Model Mapping

### 8.1 Natural Substrate

Nervos CKB's cell model provides a more natural substrate for data marketplace semantics than the EVM's account model. The mapping is structural, not analogical.

### 8.2 Data Assets as Cells

Each data asset maps to a CKB cell:

| DataMarketplace (EVM) | CKB Cell Model |
|---|---|
| `DataAsset` struct in contract storage | Independent cell with data field |
| `metadataURI` + `contentHash` | Cell data (metadata + content hash) |
| `owner` address | Cell lock script (owner's public key hash) |
| `active` boolean | Cell existence (live cell = active, consumed = deactivated) |
| `accessPrice` + `computePrice` | Cell data fields (readable without consumption) |
| Asset type validation | Type script enforcing DataAsset schema |

The key advantage: on CKB, each data asset is a **sovereign cell** with its own lock script. The owner controls it directly through their private key, not through a contract's internal mapping. Deactivation is cell consumption. Ownership transfer is cell transfer. The marketplace contract becomes a type script that validates the rules, not a custodian that holds the state.

### 8.3 Compute-to-Data via Type Scripts

The compute-to-data pattern maps elegantly to CKB's type script verification:

```
1. Consumer creates a transaction that:
   a. References the data cell (without consuming it)
   b. Includes the algorithm hash in a witness field
   c. Pays the compute price to a new payment cell

2. The data cell's type script verifies:
   a. The payment cell has correct value and lock
   b. The algorithm hash is present in witnesses
   c. The data cell is NOT consumed (read-only reference)

3. Off-chain: data owner observes the payment transaction,
   executes the algorithm, posts the result hash as a new cell

4. The result cell's type script verifies:
   a. It references the original compute payment cell
   b. The result hash is non-zero
   c. The creator is the data cell's owner
```

The critical property: **the data cell is never consumed in a compute transaction.** It is referenced but not spent. This is CKB's equivalent of "read-only access" -- the cell's data is available to the type script for verification, but the cell itself persists unchanged. The data literally cannot leave the owner's control at the protocol level.

### 8.4 Cell Capacity as Storage Pricing

CKB's cell capacity requirement (1 CKB = 1 byte of state) provides a natural pricing mechanism for data storage that the EVM lacks:

- Publishing a data asset on CKB requires locking CKB proportional to the metadata size
- Larger metadata (richer descriptions, more detailed schemas) costs more capacity
- The owner bears the storage cost, creating an incentive for efficient metadata representation
- Deactivating an asset (consuming the cell) returns the locked capacity

This mirrors the economic model described in our CKB Economic Model paper (Glynn & JARVIS, 2026): storage has a real, ongoing opportunity cost. Data that is no longer valuable can be deactivated to reclaim capacity, and the market for cell capacity naturally prices data storage.

### 8.5 Access Rights as Cells

Access rights (`hasAccess` mapping in EVM) become cells on CKB:

```
Access Right Cell:
  lock: consumer's public key hash
  type: DataMarketplace access type script
  data: { assetId, grantedAt, accessLevel }
```

Each access right is an independent, transferable cell. The consumer owns it. They can prove access to any verifier by showing the cell exists. They could even transfer or trade access rights (secondary market for data access) -- a capability that the EVM mapping does not natively support.

### 8.6 Revenue Distribution

Revenue splitting on CKB uses the transaction model directly:

```
Compute Payment Transaction:
  Inputs:
    - Consumer's CKB cell (payment)
  Outputs:
    - Owner revenue cell: 90% of payment (lock: data owner)
    - Protocol revenue cell: 10% of payment (lock: Shapley pool)
    - Compute job cell (lock: data owner, for result posting)
```

The 90/10 split is enforced by the type script at the transaction level. There is no need for an internal `_splitRevenue` function -- the transaction outputs are the split. This is verifiable by anyone inspecting the transaction without trusting the contract's internal accounting.

---

## 9. Privacy Analysis

### 9.1 Compute-to-Data Guarantees

The compute-to-data model provides the following privacy guarantees:

**Data never leaves the owner's environment.** The algorithm travels to the data, not the data to the algorithm. The consumer receives only the computation output, which is a function of the data -- not the data itself.

**The output may leak information.** This is a fundamental limitation of any compute-to-data system. A carefully designed algorithm could extract the entire dataset through a series of targeted queries (e.g., binary search over attribute values). Mitigation strategies include:

- Owner review of algorithm code before execution
- Differential privacy noise added to outputs
- Rate limiting on compute jobs per consumer per asset
- Algorithm whitelisting (owner approves algorithm classes)

These mitigations are out-of-scope for the base marketplace contract but are natural extensions that the UUPS upgrade path supports.

**On-chain metadata is public.** The `metadataURI`, `contentHash`, pricing, access counts, and revenue are all public. This is by design: marketplace discovery requires public metadata. But consumers should be aware that metadata itself may reveal information about the data (e.g., a medical dataset's metadata reveals that medical data exists).

### 9.2 Comparison with Alternative Models

| Model | Data Privacy | Verifiability | Cost | Complexity |
|---|---|---|---|---|
| Download & trust | None | Low | Low | Low |
| Compute-to-data (this paper) | High | Medium | Medium | Medium |
| Fully homomorphic encryption (FHE) | Maximum | High | Very high | Very high |
| Secure multi-party computation (MPC) | Maximum | High | High | High |
| Trusted execution environment (TEE) | High | Medium | Medium | Medium |

Compute-to-data occupies the practical sweet spot: it provides strong privacy guarantees without the computational overhead of FHE/MPC or the hardware trust assumptions of TEE. It is the right choice for data marketplace applications where the threat model is "prevent bulk data exfiltration" rather than "prevent any information leakage."

---

## 10. Economic Properties

### 10.1 Incentive Compatibility

The marketplace aligns incentives across all participants:

**Data owners** are incentivized to:
- Publish high-quality data (higher access counts = higher revenue)
- Price competitively (too expensive = no buyers)
- Complete compute jobs reliably (failures trigger refunds and damage reputation)
- Maintain active assets (deactivated assets generate no revenue)

**Data consumers** are incentivized to:
- Pay for access/compute (only way to use the data)
- Submit well-formed algorithms (reduces failure rate and wasted fees)
- Rate assets accurately (on-chain behavior is the rating mechanism)

**The protocol** is incentivized to:
- Maintain marketplace integrity (10% revenue share depends on marketplace volume)
- Redistribute Shapley rewards fairly (attracts more data providers)
- Upgrade the contract to support new features (UUPS upgrade path)

### 10.2 Free-Rider Prevention

The access mapping prevents free-riding on access purchases (each address must purchase independently). The compute-to-data model prevents free-riding on compute jobs (each job requires payment). The content hash prevents unauthorized redistribution (the hash is public, but the data is not).

### 10.3 Network Effects

The marketplace exhibits positive network effects on both sides:

- More data assets attract more consumers (wider selection)
- More consumers attract more data providers (larger revenue opportunity)
- Higher revenue attracts more Shapley pool contributions (better redistribution)
- Better redistribution attracts more contributors (cooperative flywheel)

The 10% protocol fee funds this flywheel. It is the minimum viable tax for cooperative economics: low enough to not deter participation, high enough to fund meaningful redistribution.

---

## 11. Comparison with Existing Data Marketplaces

| Feature | Ocean Protocol | DataMarketplace (this paper) | AWS Data Exchange |
|---|---|---|---|
| Data ownership | NFT (ERC-721) | Internal tracking | Centralized |
| Compute-to-data | Yes | Yes | No |
| Revenue split | Configurable | Fixed 90/10 | Negotiated |
| Shapley redistribution | No | Yes (10% to pool) | No |
| Permissionless publishing | Yes | Yes | No (approval required) |
| Refund on failure | Varies | Automatic (full) | Contract-dependent |
| CKB cell model support | No | Designed for it | No |
| Token | OCEAN | VIBE | USD |
| Governance | Ocean DAO | VibeSwap governance | AWS |
| Upgrade mechanism | Proxy | UUPS | Centralized |

The key differentiators are: (1) Shapley redistribution of protocol fees, which creates a cooperative economic loop absent from other marketplaces; (2) automatic refund on compute failure, which aligns provider incentives with service quality; and (3) explicit CKB cell model mapping, which provides a path to privacy-native implementation.

---

## 12. Future Work

### 12.1 Subscription Access

The current model supports one-time access purchases. A natural extension is time-bounded subscription access, where `hasAccess` expires after a configurable duration. On CKB, this maps to a cell with a `since` timelock that auto-expires.

### 12.2 Data Composability

Datasets that combine multiple source datasets should attribute revenue to upstream providers. This is a direct application of Shapley values: compute the marginal contribution of each source dataset to the composite dataset's value, and distribute revenue proportionally.

### 12.3 Verifiable Computation

The current model trusts the data owner to execute algorithms faithfully. Zero-knowledge proofs of correct execution would remove this trust assumption: the owner proves that the result is the correct output of the specified algorithm on the specified data, without revealing the data.

### 12.4 Differential Privacy Integration

Adding calibrated noise to compute outputs would provide formal privacy guarantees (epsilon-differential privacy). This is complementary to the compute-to-data model: the data never leaves, AND the outputs are differentially private.

### 12.5 Cross-Chain Data Access

VibeSwap's CrossChainRouter (LayerZero V2 OApp) enables cross-chain data marketplace operations: a consumer on Arbitrum can submit a compute job against a dataset registered on Optimism. The revenue split occurs on the source chain; the result hash is relayed to the consumer's chain.

---

## 13. Conclusion

The DataMarketplace contract demonstrates that the data paradox -- needing to reveal data to demonstrate value while needing to protect data to preserve value -- is solvable through mechanism design. Compute-to-data provides the privacy primitive. The 90/10 revenue split with Shapley redistribution provides the economic primitive. On-chain quality signals provide the reputation primitive. And Nervos CKB's cell model provides the implementation substrate where these primitives are structural rather than contractual.

Data is not like money. You cannot spend data and have it leave your possession. You cannot copy money and have it in two places. Data is simultaneously non-rivalrous (copyable) and fragile (once leaked, privacy is irrecoverable). The compute-to-data model resolves this by making data access *functionally rivalrous*: you can extract value from the data only through controlled computation channels, and each computation has a price.

The marketplace does not solve all problems in data economics. It does not prevent information leakage through carefully designed queries. It does not provide formal privacy guarantees (that requires differential privacy or homomorphic encryption). It does not verify that compute results are correct (that requires zero-knowledge proofs). What it does provide is a practical, deployable, economically-sound marketplace where data providers are fairly compensated, privacy is preserved by default, and the protocol's incentives are aligned with its participants through Shapley redistribution.

Cooperative Capitalism applied to data: providers keep 90% because they did the work, the protocol keeps 10% because collective intelligence requires collective investment, and the marketplace thrives because the incentives are aligned by construction.

---

## 14. References

1. McConaghy, T. et al. (2018). "Ocean Protocol: A Decentralized Substrate for AI Data & Services." Ocean Protocol Foundation.
2. Shapley, L.S. (1953). "A Value for n-Person Games." *Contributions to the Theory of Games, Vol. II.*
3. Nervos Network. (2019). "Nervos CKB: A Common Knowledge Base for Crypto-Economy." Nervos RFC.
4. Glynn, W. & JARVIS. (2026). "CKB Economic Model for AI Knowledge Management." VibeSwap Research.
5. Glynn, W. & JARVIS. (2026). "Privacy Fortress: Cryptographic Knowledge Isolation for AI Agents." VibeSwap Research.
6. Glynn, W. & JARVIS. (2026). "Shapley Value Distribution in Decentralized Cooperative Systems." VibeSwap Research.
7. Glynn, W. & JARVIS. (2026). "Cooperative Capitalism: Mutualized Risk in Permissionless Markets." VibeSwap Research.
8. Dwork, C. (2006). "Differential Privacy." *ICALP 2006.*
9. Gentry, C. (2009). "Fully Homomorphic Encryption Using Ideal Lattices." *STOC 2009.*
10. OriginTrail. (2022). "Decentralized Knowledge Graph." OriginTrail Documentation.

---

*VibeSwap Research -- where data has sovereign economic identity and privacy is structural, not contractual.*
