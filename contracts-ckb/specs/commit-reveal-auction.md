# CommitRevealAuction — CKB Cell Spec

**Spec layer**: `contracts/core/CommitRevealAuction.sol`
**Port classification**: REINTERPRET
**Status**: Spec draft. No implementation cells yet.
**Substrate**: VibeSwap-augmented Nervos CKB

---

## What this mechanism does

10-second batch auctions that dissolve MEV by separating commitment from execution. Users submit a hash of their order and a secret during an 8-second commit window. After commit closes, users have 2 seconds to reveal their order and secret. Settlement runs a Fisher-Yates shuffle over revealed orders, seeded by the XOR of all revealed secrets, and clears all orders at a uniform price. Non-revealers lose 50% of their deposit to the treasury.

The structural property is that no actor, validator or otherwise, can see the contents of a commit until the committer reveals. There is no useful information for a frontrunner to act on during the commit window, and the reveal window is too short for a frontrunner to construct a competing transaction with informational advantage. The 8 + 2 = 10 second cadence is calibrated to combined-human-bot attention-time per the ETM-alignment note in the Solidity spec.

The pivot question: does this structural property survive when the mechanism is reinterpreted from "Solidity contract called by EOAs" to "cell transitions on CKB"? Yes, and CKB makes the property cleaner because the commit and reveal are cell-state, not contract-state, and there is no global mutable storage that any party can race.

## Cell architecture

Four cell types compose the mechanism. Three of them are user-created. The fourth is created by a permissionless settlement transaction.

**CommitCell.** Created by a trader during the commit window. Contains the keccak256 hash of `(order_data || secret)`, the deposit, the collateral, the pool ID, and a deadline equal to `batch_start + COMMIT_DURATION + REVEAL_DURATION`. The lock-script is the trader's own (Omnilock or secp256k1). The type-script enforces the cell structure, the minimum deposit, the correct pool reference, and the batch ID range. Once created, the CommitCell is immutable until either a RevealCell consumes it or the slash transaction consumes it after the deadline.

**RevealCell.** Created by the trader during the reveal window. Spends the CommitCell. Carries the revealed order data and the secret. The type-script verifies `keccak256(order_data || secret) == commitcell.hash`, that the current block timestamp is within the reveal window for the referenced batch, and that the order data is well-formed (pool ID matches, sides are valid, amount is positive and within MAX_TRADE_SIZE_BPS of pool reserves). The deposit and collateral pass through from CommitCell to RevealCell unchanged.

**BatchSettlementCell.** Created by the settlement transaction that runs after the reveal window closes. Consumes all RevealCells for a given batch ID. Outputs a BatchSettlementCell containing the shuffle seed (XOR of all secrets), the uniform clearing price, the per-order match results, and the cross-chain recipient mapping. The type-script enforces that the shuffle seed is computed correctly from the consumed secrets, that the Fisher-Yates ordering uses that seed, that the uniform clearing price is computed correctly from the AMM pool state at settlement time, and that no RevealCell for this batch is excluded. Lock-script can be permissionless (anyone can settle, the type-script catches any incorrect settlement) which removes the trusted-settler role from the EVM version.

**SlashCell.** Created by a sweeper transaction that finds CommitCells past the reveal deadline that were not consumed by a RevealCell. Splits the CommitCell's deposit and collateral: 50% to the treasury (per SLASH_RATE_BPS) and 50% returned to the committer's recipient address. The type-script enforces the timing condition (current block timestamp > batch end) and the split ratio. Lock-script can be permissionless, with a small bounty for the sweeper paid from the treasury share.

## Per-cell specifications

### CommitCell

**Data layout** (cell-data):
- `version: u8` (currently 1)
- `batch_id: u64`
- `pool_id: [u8; 32]`
- `hash: [u8; 32]` (keccak256 of order_data || secret)
- `deposit_amount: u64` (CKB capacity beyond floor, in shannons)
- `collateral_amount: u64` (capacity reserved for slashing/refund)
- `recipient: [u8; 32]` (script-hash for refund destination)
- `xchain_recipient: Option<[u8; 32]>` (destination chain recipient if cross-chain)
- `deadline: u64` (block timestamp when reveal closes)

**Lock-script**: Omnilock with the trader's auth method. Standard.

**Type-script invariants** (verified at creation):
- `deposit_amount ≥ MIN_DEPOSIT` (translated to shannons at protocol level)
- `collateral_amount = floor(estimated_trade_value * COLLATERAL_BPS / 10000)`
- `pool_id` resolves to an existing PoolConfigCell via cell-dep
- `block.timestamp ∈ [batch_start, batch_start + COMMIT_DURATION]` for the referenced batch
- `batch_id == current_batch_id` (read from CurrentBatchCell via cell-dep)

**Type-script invariants** (verified at consumption by RevealCell):
- Exactly one output RevealCell references this CommitCell's outpoint
- The deposit and collateral pass through to the RevealCell unchanged

**Type-script invariants** (verified at consumption by SlashCell):
- `block.timestamp > deadline`
- Exactly one output SlashCell processes this commit
- Slash split is exactly 50/50

### RevealCell

**Data layout** (cell-data):
- `version: u8`
- `batch_id: u64`
- `commit_outpoint: OutPoint` (the consumed CommitCell)
- `order_data: OrderData` (pool, side, amount_in, min_amount_out, estimated_value)
- `secret: [u8; 32]` (the original commit secret)
- `priority_bid: Option<PriorityBid>` (PoW proof + bid amount, optional)
- `deposit_amount: u64` (passed through)
- `collateral_amount: u64` (passed through)
- `recipient: [u8; 32]` (passed through)
- `xchain_recipient: Option<[u8; 32]>` (passed through)

**Lock-script**: Same as CommitCell (Omnilock).

**Type-script invariants** (verified at creation):
- A CommitCell with the referenced outpoint is being consumed
- `keccak256(serialize(order_data) || secret) == commitcell.hash`
- `block.timestamp ∈ [batch_start + COMMIT_DURATION, batch_start + COMMIT_DURATION + REVEAL_DURATION]`
- `order_data.pool_id == commitcell.pool_id`
- `order_data.amount_in ≤ commitcell.estimated_value * ESTIMATE_TOLERANCE_X`
- `order_data.amount_in / pool.reserve ≤ MAX_TRADE_SIZE_BPS / 10000`
- If `priority_bid` is present: PoW proof verifies, proof hash not in used-pow-set, bid amount is paid into deposit
- Deposit and collateral are unchanged from CommitCell

**Type-script invariants** (verified at consumption by BatchSettlementCell):
- The RevealCell is included in the consumed set for its batch_id
- The settlement transaction's BatchSettlementCell output references this RevealCell's outpoint

### BatchSettlementCell

**Data layout** (cell-data):
- `version: u8`
- `batch_id: u64`
- `shuffle_seed: [u8; 32]` (XOR of all consumed secrets, in canonical ordering)
- `clearing_price: u128`
- `pool_id: [u8; 32]` (single pool per batch; multi-pool batching is a future iteration)
- `matched_orders: Vec<MatchedOrder>` (output amounts, recipients)
- `total_priority_bids: u64`

**Lock-script**: Permissionless. Anyone can construct the settlement transaction; the type-script catches any incorrect settlement.

**Type-script invariants** (verified at creation):
- All consumed cells with the matching `batch_id` are RevealCells (no missing reveals from the consumed set)
- `block.timestamp > batch_start + COMMIT_DURATION + REVEAL_DURATION`
- `shuffle_seed = XOR(reveal.secret for reveal in consumed_reveals, canonically-ordered)`
- The Fisher-Yates shuffle of the orders, seeded by `shuffle_seed`, produces the order ordering committed in `matched_orders`
- `clearing_price` is computed from the AMM pool state (via cell-dep on PoolCell) using the standard uniform-clearing-price formula
- Per-order output amounts in `matched_orders` are consistent with `clearing_price` and the order sides
- For each matched order, the recipient is `order.xchain_recipient` if cross-chain, else `order.recipient`
- The deposits and collateral are released: collateral returned to the recipient if the trade settled, retained as slashing if the trader's order failed an invariant (this maps to the EVM "estimate exceeded" case)

### SlashCell

**Data layout** (cell-data):
- `version: u8`
- `batch_id: u64`
- `commit_outpoint: OutPoint`
- `treasury_share: u64`
- `committer_share: u64`
- `sweeper_bounty: u64`

**Lock-script**: Permissionless.

**Type-script invariants**:
- A CommitCell with the referenced outpoint is being consumed
- `block.timestamp > commitcell.deadline`
- No RevealCell for this commit-outpoint exists in the consumed batch's BatchSettlementCell
- `treasury_share + committer_share + sweeper_bounty == commitcell.deposit + commitcell.collateral`
- `treasury_share == floor((deposit + collateral) * SLASH_RATE_BPS / 10000)`
- `sweeper_bounty` is bounded by a protocol constant (small fixed fee)
- `committer_share` goes back to `commitcell.recipient`
- `treasury_share` goes to the treasury cell

## Transaction shapes

**Commit transaction**: Trader → CommitCell. Inputs: trader's funded cell (CKB capacity for deposit + collateral). Outputs: CommitCell + change cell. Type-script verifies all CommitCell invariants. This is a plain transaction with no cell-dep beyond the CommitCell's type-script code-cell and the PoolConfigCell + CurrentBatchCell for invariant checks.

**Reveal transaction**: Trader → RevealCell. Inputs: the trader's CommitCell. Outputs: RevealCell. Type-script verifies the reveal-data, the hash match, the timing, and the order well-formedness. This is the trader proving they were the original committer (lock-script signature) and proving their order matches the commitment (type-script hash check).

**Settlement transaction**: Anyone → BatchSettlementCell + per-order output cells. Inputs: all RevealCells for the batch, the relevant PoolCell (the AMM pool gets updated), any priority-bid-PoW-tracking cells. Outputs: BatchSettlementCell + per-order trade-output cells routing tokens to recipients + updated PoolCell. Type-script enforces the entire settlement correctness. The lock is permissionless, so MEV-extractor attempts to settle in their favor fail the type-script.

**Slash transaction**: Anyone → SlashCell. Inputs: an expired CommitCell. Outputs: SlashCell + treasury output + committer-refund output + sweeper-bounty output. Type-script enforces timing, no-reveal, and split correctness.

## Property preservation

The structural property that needs to survive the port is "no actor sees commit contents before reveal, no settlement reordering benefits any party." Both hold on CKB by construction, more cleanly than on EVM.

**Commit privacy**: CommitCell data contains only the hash. The order data is held off-chain by the trader. There is no global mempool inspection that reveals more than the hash. The reveal is timed by block height, not by mempool ordering, so a frontrunner watching the mempool sees nothing actionable.

**Settlement determinism**: The shuffle seed is computed deterministically from the XOR of all revealed secrets. Once the reveal window closes, the seed is fixed. Anyone constructing a valid settlement transaction must use the same seed and produce the same ordering. There is no race condition on settlement because the type-script verifies the settlement is correct; an incorrect settlement transaction simply fails.

**Permissionless settlement**: The EVM version had an `authorizedSettlers` mapping to prevent malicious settlement. CKB does not need it. Any settlement that violates the type-script invariants fails. The first valid settlement transaction included in a block settles the batch. This removes the trusted-settler role entirely.

**No reentrancy**: Cells are consumed exactly once. There is no callback path that could re-enter the auction during settlement.

**ETM 10-second alignment preserved**: The COMMIT_DURATION and REVEAL_DURATION constants are translated to block-time intervals. This requires either tuning CKB block time to be predictable enough that 8 and 2 second windows are meaningful (see `AUGMENTATION_SURFACE.md` network parameters entry), or reinterpreting the windows as block-height ranges instead of timestamps. Both paths preserve the substrate-attention-time intent.

## Upstream pulls

**From `ckb-system-scripts`**: secp256k1_blake160_sighash_all for simple trader locks; dao primitives for treasury management patterns.

**From Omnilock**: Multi-auth support so traders with EVM-compatible addresses can use ECDSA, while traders with PoM attestations or other auth shapes can use exec-callout.

**From `ckb-std`**: All syscall wrappers, witness parsing, cell inspection, blake2b hashing. Type-scripts and lock-scripts are written as `ckb-std`-backed Rust crates.

**From sUDT**: If the order tokens are sUDT-shaped (which most VibeSwap tokens will be), the existing sUDT type-script enforces token conservation. CommitCell and RevealCell hold sUDT cells in their inputs, and the BatchSettlementCell outputs sUDT cells routed to recipients.

**From `ckb-merkle-mountain-range`**: If priority-bid PoW proofs need to reference batch-level commitments, MMR provides the inclusion-proof primitive.

## Build new

**CommitCellTypeScript**: Rust crate at `contracts-ckb/commit-cell-type-script/`. Implements the invariants listed above. Targets RISC-V 64.

**RevealCellTypeScript**: Rust crate at `contracts-ckb/reveal-cell-type-script/`. Implements the hash-match verification, timing window check, order well-formedness, and priority-bid PoW verification.

**BatchSettlementTypeScript**: Rust crate at `contracts-ckb/batch-settlement-type-script/`. The largest piece of new code. Implements Fisher-Yates shuffle, uniform-clearing-price computation, pool-state read via cell-dep, per-order output construction. Needs careful cycle-budget accounting because settlement transactions can have many input RevealCells.

**SlashCellTypeScript**: Rust crate at `contracts-ckb/slash-cell-type-script/`. Implements the timing and split invariants. Small and self-contained.

**CurrentBatchCell**: A protocol-state cell that advances on every batch boundary. Type-script enforces that batch transitions happen at the right intervals and that the state is monotonically increasing.

**PoolConfigCell**: The CKB equivalent of the EVM pool-config storage. Holds the immutable access-control configuration per pool. Created once per pool, never modified.

## Open questions

- **Cycle budget for settlement**: A batch with 100 reveals will produce a large settlement transaction. CKB-VM cycle limits may not accommodate the full Fisher-Yates shuffle plus per-order computation. Spike needed: estimate cycle cost per reveal in the settlement type-script and determine max-batch-size in practice.

- **Block-time vs block-height for windows**: NC-Max has variable block time. Tracking the 8 and 2 second windows as timestamps is fragile if blocks come in bursts. Block-height windows (e.g. 60 blocks for commit, 15 for reveal at the target rate) may be more robust but require deciding the block-rate target.

- **Cross-pool batching**: The Solidity version supports one settlement per pool per batch. The CKB version inherits this. Multi-pool batching in a single transaction is a future iteration that would require careful pool-state composition.

- **Priority-bid PoW**: The Solidity version uses ProofOfWorkLib to allow trader-side priority bidding. On CKB, the PoW proof verification needs a `no_std` Rust port. ckb-std does not currently ship this. Either we contribute upstream (preferred per discipline) or we build it as a separate dependency.

- **Cross-chain recipient handling**: The CommitCell carries an optional `xchain_recipient`. This couples CommitRevealAuction to the MessagingHub spec (see `messaging-hub.md` when written). The settlement transaction needs to mint cross-chain claim cells when `xchain_recipient` is set, instead of releasing local tokens.

## Cross-references

- Architectural statement: `vibeswap/docs/architecture/ckb-sovereign-vibeswap.md`
- Augmentation surface: `vibeswap/contracts-ckb/AUGMENTATION_SURFACE.md`
- Upstream survey: `vibeswap/contracts-ckb/UPSTREAM.md`
- Spec layer: `vibeswap/contracts/core/CommitRevealAuction.sol`
- Solidity helpers: `vibeswap/contracts/libraries/DeterministicShuffle.sol`, `vibeswap/contracts/libraries/ProofOfWorkLib.sol`
- Mechanism primitives: `[P·structure-does-the-work]`, `[P·dissolve-attack-surface]`, `[P·honesty-as-structural-load-bearing-property]`, `[P·substrate-port-pattern]`
- Related specs (pending): `vibe-amm.md`, `messaging-hub.md`, `shapley-distributor.md`
