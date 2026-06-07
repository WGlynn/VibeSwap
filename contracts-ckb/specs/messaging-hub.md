# MessagingHub — CKB Cell Spec

**Spec layer**: `contracts/messaging/` (VibeSwapCanonicalToken, MessagingValidatorRegistry, MessagingPoM, SupplyAccountant, CrossChainRouter)
**Port classification**: REINTERPRET
**Status**: Spec draft. No implementation cells yet.
**Substrate**: VibeSwap-augmented Nervos CKB
**Spec doc on canonical burn-and-mint**: `vibeswap/docs/research/papers/post-layerzero-canonical-messaging.md`

---

## What this mechanism does

VibeSwap-canonical burn-and-mint cross-chain messaging that replaces LayerZero V2 after the 2026-04 KelpDAO/LZ DVN-RPC compromise. Instead of relying on third-party messaging infrastructure, VibeSwap deploys a canonical token contract with identical bytecode across all supported chains, gates mint authority to a bonded validator set that attests cross-chain burns via BLS12-381 threshold signatures, and accounts total supply via a SupplyAccountant that ensures no double-mint.

On the sovereign CKB-VibeSwap chain, the same architecture is reinterpreted into cells. A user burning canonical tokens on CKB-VibeSwap produces a BurnReceiptCell. Validators on remote chains observe the receipt and produce attestation messages that, when sufficient threshold is collected, allow a mint on the destination chain. Inbound: validators on remote chains attest to burns there, and the threshold-aggregated attestation allows a CKB-VibeSwap mint.

The structural property is that mint authority is mechanical, not custodial. No party can mint without a verifiable burn from another chain attested by the validator threshold. The substrate enforces this; there is no admin override.

## Cell architecture

The messaging mechanism is decomposed into cells that mirror the Solidity components.

**CanonicalTokenCell.** sUDT-shaped cell representing canonical-VibeSwap tokens (the cross-chain asset). Lock-script is the owner's. Type-script enforces conservation under normal transfers, mint-only-from-attested-claim, and burn-creates-receipt invariants.

**BurnReceiptCell.** Created when a user burns CanonicalTokenCells on CKB-VibeSwap, signaling intent to receive the corresponding amount on a destination chain. Holds the burned amount, the source nonce, the destination chain ID, the destination recipient, and the burn block height for replay-protection windowing.

**ValidatorRegistryCell.** Holds the bonded validator set with their BLS12-381 public keys, their bond amounts in CanonicalTokenCells, and their slashing status. Updated via governance-gated transitions for adds, removes, and bond changes. Read via cell-dep by attestation cells.

**ValidatorBondCell.** Per-validator bonded stake. Lock-script is the validator's, but spending requires the type-script to verify no slashing condition is active. The ValidatorRegistryCell aggregates over these for the active set.

**AttestationCell.** Holds a threshold-aggregated BLS signature over a remote-chain burn event. Created by anyone who collects sufficient validator signatures. Type-script verifies the BLS aggregation against the active validator set from ValidatorRegistryCell.

**MintClaimCell.** Created in conjunction with a valid AttestationCell. Authorizes the mint of a specific CanonicalTokenCell amount to a specific recipient. Consumed by the recipient (or any sweeper if claim-deadline configured) to produce the actual minted tokens.

**SupplyAccountantCell.** Tracks total supply across all chains. For each chain ID, holds the current supply on that chain as reported by attestation. Updated atomically with every mint and burn on CKB-VibeSwap and every successfully-attested cross-chain mint.

**ChainConfigCell.** Holds the enabled-inbound and enabled-outbound flags per chain ID. Governance-gated updates.

**MessagingPoMCell.** Proof-of-Mind attestation that validators run cognitive-work to verify message authenticity beyond their bonded stake. Each attestation references a MessagingPoMCell that the validator has produced via the PoM lock-script.

## Per-cell specifications

### CanonicalTokenCell

**Data layout** (cell-data):
- `version: u8`
- `amount: u128`

**Lock-script**: Owner's lock (Omnilock or secp256k1).

**Type-script invariants**:
- **Transfer**: standard sUDT conservation; sum of inputs equals sum of outputs
- **Mint** (from a MintClaimCell): the mint amount equals the MintClaimCell's amount, and the MintClaimCell is consumed in the same transaction
- **Burn** (producing a BurnReceiptCell): the burn amount equals the BurnReceiptCell's amount, and the BurnReceiptCell is produced in the same transaction
- **Genesis mint** (CKB-VibeSwap genesis chain only): special case, only valid at genesis-block via genesis-config witness

### BurnReceiptCell

**Data layout** (cell-data):
- `version: u8`
- `burn_id: [u8; 32]` (hash of source-chain-id, sender, nonce)
- `burner_lock_hash: [u8; 32]`
- `amount: u128`
- `destination_chain_id: u64`
- `destination_recipient: Vec<u8>` (chain-specific address bytes)
- `burn_block_height: u64`
- `source_chain_id: u64` (always our CKB-VibeSwap chain ID)

**Lock-script**: Permissionless. The receipt is public information; anyone can spend it as evidence in a destination-chain mint claim.

**Type-script invariants**:
- Created only in conjunction with a CanonicalTokenCell burn (matched in the same transaction)
- `amount` matches the burned amount
- `destination_chain_id` is in the ChainConfigCell's outbound-enabled set
- `burn_id` is fresh (not present in any other BurnReceiptCell consumed by the SupplyAccountantCell update)

### ValidatorRegistryCell

**Data layout** (cell-data):
- `version: u8`
- `epoch: u64`
- `validator_set: Vec<Validator>`
  - per validator: `bls_pubkey: [u8; 48]`, `lock_hash: [u8; 32]`, `bond_amount: u128`, `slashed: bool`
- `threshold_n: u16` (number of signatures required)
- `threshold_d: u16` (out of total)
- `total_bonded: u128`

**Lock-script**: Governance-gated; updates require multi-sig or DAO mutation attestation.

**Type-script invariants**:
- Epoch transitions are monotonic
- A new validator can only be added if their ValidatorBondCell with the corresponding `bond_amount` is consumed and locked
- Removed validators must have their bond either slashed (transferred to slashing pool) or unbonded (returned after unbonding period)
- `threshold_n / threshold_d` is within configured bounds (e.g., 2/3 minimum)

### ValidatorBondCell

**Data layout** (cell-data):
- `version: u8`
- `validator_lock_hash: [u8; 32]`
- `bls_pubkey: [u8; 48]`
- `bond_amount: u128`
- `bonded_epoch: u64`
- `unbonding_started_at: Option<u64>`
- `slashed: bool`

**Lock-script**: Validator's lock-hash. Spendable only if `unbonding_started_at` is set and the unbonding period has elapsed, and `slashed == false`.

**Type-script invariants**:
- `bond_amount` matches the ValidatorRegistryCell's record at `bonded_epoch`
- Unbonding cannot start while the validator is in the active set (the registry must have removed them first)
- Slashing requires evidence of misbehavior: either an AttestationCell that signed a known-false burn, or a fork/double-sign proof

### AttestationCell

**Data layout** (cell-data):
- `version: u8`
- `attestation_id: [u8; 32]` (hash of the attested message)
- `source_chain_id: u64`
- `source_burn_id: [u8; 32]`
- `amount: u128`
- `destination_recipient: [u8; 32]`
- `aggregated_signature: [u8; 96]` (BLS12-381)
- `signer_bitmap: [u8; ...]` (which validators contributed to the aggregation)
- `attested_at_epoch: u64`

**Lock-script**: Permissionless.

**Type-script invariants**:
- The `aggregated_signature` verifies against the BLS aggregation of the signer_bitmap's selected validators' public keys (read from ValidatorRegistryCell via cell-dep)
- The number of signers in `signer_bitmap` meets or exceeds `threshold_n` for the epoch
- `source_chain_id` is in ChainConfigCell's inbound-enabled set
- `attested_at_epoch` matches the ValidatorRegistryCell's epoch (no stale attestations across registry updates)
- The signed message is `(source_chain_id, source_burn_id, amount, destination_recipient, destination_chain_id == our_chain_id)`

### MintClaimCell

**Data layout** (cell-data):
- `version: u8`
- `attestation_id: [u8; 32]` (matches the AttestationCell that created this claim)
- `amount: u128`
- `recipient_lock_hash: [u8; 32]`
- `created_at_block: u64`
- `claim_deadline: u64` (optional)

**Lock-script**: Recipient's lock-hash.

**Type-script invariants**:
- Created in the same transaction as an AttestationCell with matching attestation_id
- `amount` and `recipient_lock_hash` match the attestation
- When consumed: triggers the mint of CanonicalTokenCell to the recipient
- If deadline passes without claim: sweepable to an unclaimed-pool

### SupplyAccountantCell

**Data layout** (cell-data):
- `version: u8`
- `total_supply_per_chain: Vec<(chain_id, u128)>`
- `last_updated_at_block: u64`

**Lock-script**: Permissionless. Type-script catches incorrect updates.

**Type-script invariants**:
- On a burn (CanonicalTokenCell burn + BurnReceiptCell creation): `total_supply_per_chain[our_chain_id]` decreases by the burn amount
- On a mint (AttestationCell + MintClaimCell consumption + CanonicalTokenCell creation): `total_supply_per_chain[our_chain_id]` increases by the mint amount and `total_supply_per_chain[source_chain_id]` decreases by the same amount (as per the source's burn)
- Sum-of-supplies invariant: sum across all chains == initial genesis supply (less any provably-slashed amounts)

### ChainConfigCell

**Data layout** (cell-data):
- `version: u8`
- `enabled_chains: Vec<ChainConfig>`
  - per chain: `chain_id: u64`, `enabled_inbound: bool`, `enabled_outbound: bool`, `canonical_token_address: Vec<u8>`

**Lock-script**: Governance-gated.

### MessagingPoMCell

**Data layout** (cell-data):
- Inherits from the existing PoM lock-script work in `contracts-ckb/proof-of-mind-lock-script/`
- Annotated with the messaging-attestation-specific work signal

**Lock-script**: PoM lock-script (already shipped).

## Transaction shapes

**Burn (outbound) transaction**: User-initiated.
- Inputs: user's CanonicalTokenCells (sufficient amount), capacity for BurnReceiptCell
- Outputs: BurnReceiptCell, updated SupplyAccountantCell, change cells
- Type-script verifies burn amount matches receipt, supply accountant updates correctly

**Validator attestation collection** (off-chain): Validators on CKB-VibeSwap observe burns on remote chains via their light clients, sign BLS attestations, and gossip them. This phase happens outside the chain; only the final aggregated attestation lands on-chain.

**Attestation submit transaction**: Permissionless.
- Inputs: capacity for AttestationCell and MintClaimCell
- Outputs: AttestationCell, MintClaimCell to the recipient
- Cell-deps: ValidatorRegistryCell, ChainConfigCell
- Type-script verifies BLS aggregation and threshold

**Mint claim transaction**: Recipient-initiated.
- Inputs: MintClaimCell, capacity
- Outputs: CanonicalTokenCell to recipient, updated SupplyAccountantCell
- Type-script verifies mint authorization via consumed claim

**Validator bond transaction**: Validator-initiated.
- Inputs: validator's CanonicalTokenCells (or other bonded asset), capacity
- Outputs: ValidatorBondCell, updated ValidatorRegistryCell
- Type-script verifies bond amount and registry update

**Validator slashing transaction**: Permissionless evidence-driven.
- Inputs: ValidatorBondCell, slashing-evidence witness (e.g., proof of attestation on a known-false burn)
- Outputs: slashed amount to slashing-pool cell, validator's reduced bond cell
- Type-script verifies the evidence and the slash amount per protocol rules

## Property preservation

**Canonical burn-and-mint preserved**: The structural property is "no mint without a corresponding burn elsewhere, attested by the validator threshold." The substrate enforces this via the AttestationCell type-script and the MintClaimCell linkage. No admin override exists.

**Threshold signature security**: BLS12-381 threshold aggregation provides cryptographic guarantees over the validator set. A minority of validators cannot produce a valid attestation. The type-script verifies this directly.

**No-double-mint**: SupplyAccountantCell tracks per-chain supply. The sum-of-supplies invariant is enforced on every transition. A burn on chain A and a mint on chain B preserve the global total. An attestation that doesn't match a known burn cannot reduce another chain's supply.

**Bonded validators with slashing**: Validators have skin in the game via ValidatorBondCell. Slashing is permissionless on evidence (anyone can produce a slash transaction with the evidence witness). This dissolves the trust assumption to "majority of bonded stake is honest, monitored adversarially by anyone."

**Replay protection**: BurnReceiptCells and AttestationCells have fresh IDs. The SupplyAccountantCell rejects replays that would double-count.

**Post-LayerZero positioning**: This entire mechanism replaces third-party messaging infrastructure with VibeSwap-internal, bonded, attested, supply-accounted. The 2026-04 KelpDAO/LZ DVN-RPC compromise pattern (DVN compromised via RPC oracle) does not apply because there is no DVN; attestation is BLS-aggregated bonded validator signatures verified on-chain.

## Upstream pulls

**From `ckb-system-scripts`**: Standard locks for user-side and validator-side authorization.

**From sUDT/xUDT**: CanonicalTokenCell as sUDT with custom mint/burn extensions.

**From Omnilock**: Multi-auth for users and validators.

**From `ckb-std`**: All syscalls, witness parsing, blake2b.

**From a BLS12-381 no_std Rust crate (TBD)**: BLS aggregation verification. Candidates: `blst` (Apache-2.0) or `ark-bls12-381` (MIT/Apache-2.0). Both need `no_std` audit for CKB-VM. This is the largest single dependency for this mechanism and the most uncertain pull-from-upstream decision.

**From `ckb-merkle-mountain-range`**: For attestation history commitment if we want efficient inclusion proofs of historical attestations.

**From existing PsiNet PoM lock-script** (already shipped at `contracts-ckb/proof-of-mind-lock-script/`): Extended to cover messaging-attestation work signals.

## Build new

**CanonicalTokenTypeScript**: Rust crate at `contracts-ckb/canonical-token-type-script/`. sUDT-derived with mint/burn extensions tied to attestation claims and burn receipts.

**BurnReceiptTypeScript**: Rust crate. Verifies that the receipt is produced in conjunction with a valid CanonicalTokenCell burn.

**ValidatorRegistryTypeScript**: Rust crate. Manages the bonded validator set, epoch transitions, threshold parameters.

**ValidatorBondTypeScript**: Rust crate. Standard bonding cell with slashing condition.

**AttestationTypeScript**: Rust crate. BLS verification, threshold check, message format verification.

**MintClaimTypeScript**: Rust crate. Authorizes mint based on consumed attestation.

**SupplyAccountantTypeScript**: Rust crate. Multi-chain supply tracking with sum-of-supplies invariant.

**ChainConfigTypeScript**: Rust crate. Governance-gated chain enablement.

**BLS verification library**: A `no_std` Rust crate wrapping the chosen BLS12-381 implementation for use across the AttestationTypeScript and related places.

## Open questions

- **BLS12-381 cycle budget in CKB-VM**: BLS aggregation verification is the most expensive operation in this mechanism. We need a spike: can `blst` or `ark-bls12-381` verify a 2/3-threshold-aggregated signature within CKB-VM cycle limits? If not, what are the options? Possibilities: native syscall (substrate augmentation, big change), validation in a separate zk-proof, or different signature scheme (Schnorr aggregation with MuSig2).

- **Validator gossip layer**: Validator signature collection happens off-chain. We need a gossip protocol or a designated coordinator pattern. CKB does not provide this directly; we'd run a separate libp2p network. This is L1-protocol-adjacent infrastructure that the spec needs to address.

- **Unbonding period length**: Validators that want to exit have to wait for an unbonding period before reclaiming bonded capacity. The right length balances slashing-evidence-window (we need time to surface misbehavior) against validator UX. The Solidity version has parameters; CKB inherits them.

- **Cross-chain message ordering**: Some applications require ordered delivery. The current spec is unordered per-chain. If ordering matters (e.g., for governance messages), we add per-source-chain nonces and verify monotonicity in the AttestationCell.

- **Inbound from non-CKB chains**: Attestations from EVM chains need to verify the attestation was about a real burn on the EVM chain. This requires the validators to run light clients of those chains. The Solidity version of the validator does this off-chain. The CKB version inherits the same dependency.

- **Fee model for attestation submission**: Anyone can submit the AttestationCell, but doing so costs CKB capacity. We need a fee/reimbursement mechanism so attestation submitters are compensated. Probably a small per-attestation fee deducted from the mint amount.

- **Genesis chain identity**: One of the chains is the genesis chain that seeded initial supply via genesisMint. If CKB-VibeSwap is the new genesis, the genesis-mint logic lives in the chain's genesis configuration. If an EVM chain remains the genesis (e.g., Ethereum), then CKB-VibeSwap can only ever mint via attested cross-chain burns, never directly. Decision is a governance/launch-strategy question.

## Cross-references

- Architectural statement: `vibeswap/docs/architecture/ckb-sovereign-vibeswap.md`
- Augmentation surface: `vibeswap/contracts-ckb/AUGMENTATION_SURFACE.md`
- Upstream survey: `vibeswap/contracts-ckb/UPSTREAM.md`
- Spec layer: `vibeswap/contracts/messaging/` (full directory)
- Canonical-messaging paper: `vibeswap/docs/research/papers/post-layerzero-canonical-messaging.md`
- Existing PoM CKB script: `vibeswap/contracts-ckb/proof-of-mind-lock-script/`
- Mechanism primitives: `[P·structure-does-the-work]`, `[P·honesty-as-structural-load-bearing-property]`, `[P·dissolve-attack-surface]`, `[F·post-layerzero-canonical-messaging]`
- Related specs: `commit-reveal-auction.md` (consumes cross-chain recipient mapping), `vibe-amm.md` (settlement target), `shapley-distributor.md` (fee event source)
