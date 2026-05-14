# Post-LayerZero Canonical Messaging — v0.1 Architecture Audit

**Auditor**: JARVIS overlay (in collaboration with Will Glynn)
**Date**: 2026-05-14
**Target**: `vibeswap/docs/research/papers/post-layerzero-canonical-messaging.md` (v0.1 draft, 2026-05-08)
**Method**: Apply audit-arsenal (AA#1 fork-loses-hardness, AA#2 claim-needs-structural-enforcer, AA#3 entity-context-cross-reference) + CCP + substrate-geometry-match + gate-stacking lenses. For each design choice, ask: load-bearing? necessary? structurally enforced? logically justifiable?

**Companion**: extends `post-layerzero-self-audit-v0.1.md` (2026-05-08, contract-level findings) to the spec level.

---

## ⚠ FIRST-PRINCIPLES MISS — Will-flagged 2026-05-14

**Audit failure I made**: I rubber-stamped the spec's `ERC20Upgradeable + AccessControlUpgradeable` choice for `VibeSwapCanonicalToken` because it's the OpenZeppelin default for Ethereum tokens. This is exactly the pattern-match-drift-on-novelty failure mode the audit was supposed to catch in the spec, applied to my own audit. The canonical-messaging-token use case is novel; ERC-20-upgradeable is familiar; familiar won. Bad.

Will-frame: "we require an engineer solution, not an Ethereum solution." Distinction:
- **Ethereum solution** = use OZ's `ERC20Upgradeable + AccessControlUpgradeable` because that's what Ethereum projects do
- **Engineer solution** = ask what properties the canonical-messaging-token needs, then build a contract that has those properties and ONLY those properties

### What the canonical-messaging token actually needs

1. Per-address balance tracking
2. Mint callable ONLY by MessagingHub (single, immutable authority)
3. Burn callable by user, atomic-routing to MessagingHub
4. Standard interface for DEX/wallet integration on each chain's native VM

### What `ERC20Upgradeable + AccessControl` adds that BREAKS the architectural goals

| Component | Problem |
|---|---|
| AccessControl role grant | Mint authority behind a role grant. Role-admin keys = governance state = off-chain trust assumption. If admin keys compromised, mint authority is stolen, and the bonded-validator-network can't slash a stolen key. This smuggles back in the off-chain-trust-failover-path that Appendix C was supposed to ELIMINATE. |
| UUPS upgradeable | "Canonical" means same-forever. If bytecode changes, "canonical across chains" loses meaning (chain A upgrades, chains B/C don't, set diverges). Adds a single-point-of-failure (upgrade-authority keys) and contradicts the canonical property. |
| approve / transferFrom | Source of every ERC-20 phishing exploit. Dead weight for a canonical-messaging token where security argument is "trust the math, not the approve-list." Creates a trust surface the architecture doesn't use. |

### "Identical bytecode across chains" is structurally impossible

§5.1 of the spec claims identical bytecode across chains, verified by on-chain hash check during validator onboarding. Heterogeneous VMs (EVM / SVM / CKB-VM) have different bytecode artifacts. A Solana validator cannot verify the same EVM bytecode hash. The actual property the spec needs is "semantically equivalent canonical-token implementation on each chain's native primitive," verified per-chain.

### Engineer's solution on EVM (~80 LOC instead of ~200 with all the OZ scaffolding)

```solidity
contract VibeSwapCanonicalToken {
    // Storage
    mapping(address => uint256) public balanceOf;
    uint256 public totalSupply;

    // Immutable identity — set once at construction, never changeable
    address public immutable messagingHub;
    string public name;          // set in constructor; embedded in bytecode-equivalent way via metadata
    string public symbol;
    uint8 public immutable decimals;

    // No proxy. No admin. No upgradeable storage. No approve / transferFrom.
    // No AccessControl. Mint authority is the constructor-immutable address.

    constructor(address _messagingHub, string memory _name, string memory _symbol, uint8 _decimals) {
        messagingHub = _messagingHub;
        name = _name;
        symbol = _symbol;
        decimals = _decimals;
    }

    function mint(address to, uint256 amount, uint256 sourceNonce) external {
        if (msg.sender != messagingHub) revert NotMessagingHub();
        balanceOf[to] += amount;
        totalSupply += amount;
        emit CanonicalMint(to, amount, sourceNonce);
        emit Transfer(address(0), to, amount);
    }

    function burn(uint256 amount, uint64 dstChainId, address recipient)
        external returns (uint256 nonce)
    {
        balanceOf[msg.sender] -= amount;
        totalSupply -= amount;
        nonce = IMessagingHub(messagingHub).initiateBurn(msg.sender, amount, dstChainId, recipient);
        emit CanonicalBurn(msg.sender, amount, dstChainId, recipient, nonce);
        emit Transfer(msg.sender, address(0), amount);
    }

    function transfer(address to, uint256 amount) external returns (bool) {
        balanceOf[msg.sender] -= amount;
        balanceOf[to] += amount;
        emit Transfer(msg.sender, to, amount);
        return true;
    }

    // No approve / transferFrom. If a specific DEX integration requires them,
    // add a minimal EIP-2612 permit-only layer in a separate adapter contract.
    // Don't expose the approve-list surface in the canonical contract itself.
}
```

Properties vs the spec's version:
- ✓ Immutable mint authority — no role grant, no admin path
- ✓ No proxy, no upgrade key, no UUPS storage corruption surface
- ✓ Deterministic address via CREATE2 with same salt across EVM chains — gives same address everywhere, which is the property §5.1 was trying to claim
- ✓ No approve / transferFrom — no phishing surface for the canonical token; integrations route through MessagingHub or via an explicit permit adapter
- ✓ Semantically equivalent on every chain's native primitive (Cell on CKB, SPL Token on Solana with mint authority pinned to MessagingHub program)

### Prior art the spec should engage with

- **xERC20 standard** — explicitly addresses cross-chain canonical tokens with rate-limited bridge mint authorities. The spec reinvents pieces of this without citing it.
- **Chainlink CCT (Cross-Chain Token)** — already in spec's Appendix B comparison as "✓ canonical issuer model." The spec should engage with CCT's design choices (which made what tradeoffs) rather than reproducing OpenZeppelin defaults.
- **Bridged USDC / Native USDC via CCTP** — Circle's mint authority model. Spec plans v2 CCTP integration but doesn't borrow the contract-design lessons for v1.

### Meta-failure: other places I rubber-stamped Ethereum defaults

The ERC-20-upgradeable miss revealed I may have over-trusted defaults elsewhere. Re-audit lens to apply: every spec design choice that uses an existing Ethereum/DeFi idiom should be interrogated against the substrate-geometry-match primitive.

| Spec choice | Default smell | First-principles question |
|---|---|---|
| UUPS proxy implied for messaging contracts | Yes | Are MessagingHub / SupplyAccountant / AttestationVerifier / MessagingValidatorRegistry / MessagingPoM all upgradeable? If so, what's the upgrade authority? Does the upgrade authority compromise the security model? |
| Per-(srcChain, dstChain) nonce monotonic | EVM account-model assumption | UTXO chains (CKB, Bitcoin) don't have per-pair nonces; they have outpoints. How does §6.2 port to CKB? Either spec is EVM-only for v1 or this needs a substrate-portable design. |
| Validator client implementation defaults to "Lighthouse/Teku-style" PoS client | Ethereum-consensus-client smell | Light-client / minimal-attestor design might be sufficient. Spec acknowledges this is open in Q1 but defaults the framing to Ethereum-style. |
| Insurance pool / ILProtection reuse | DeFi-standard reflex | Do we need an insurance pool at all, or does validator-bond slashing cover the shortfall directly? The pool may be solving a problem the bonding already solves. |
| BLS12-381 as the curve | Ethereum-native default | Defensible because §13.1 names the reason (EIP-2537), but the framing is "Ethereum precompile available" not "this curve has the right structural properties for cross-VM verification." |
| Aggregator + Shapley reward distribution | VibeSwap-internal idiom | Reasonable but could be over-engineered for v1. A simpler equal-split-among-signers (which is what most PoS protocols use) might be sufficient until empirical operation surfaces the need for Shapley.|

Each row deserves a substrate-geometry-match check before v0.2.

### What this changes in the audit

Most of the original audit holds. The fork-loses-hardness findings (AA#1), claim-needs-structural-enforcer findings (AA#2), and over-specification critiques remain valid. The first-principles miss is ADDITIVE — it identifies a class of failure (defaulting to Ethereum idioms without first-principles check) that runs across the spec and was missed in the initial pass.

The original audit recommendations stand. New recommendation added: **Substrate-Native Reconstruction Pass** — re-derive the contract design for each component from the substrate-geometry-match lens, not from "what OpenZeppelin provides."

### ⚠ Will-flagged 2026-05-14 follow-up — Self-validating vs available-code

Will-frame: "you're using code that's readily available instead of searching for a true self-validating solution."

The deeper miss: even my "engineer's solution" above still inherits the wrong shape. Removing AccessControl and UUPS is good but the contract still DELEGATES verification to a separate `messagingHub`. That's still trust-boundary-crossing. Self-validating means the contract validates itself without external trust assumptions.

Three structurally-distinct self-validating shapes for a canonical-messaging token:

**Option A — UTXO-shaped tokens with structural conservation.**

Each token unit is a discrete object with provenance baked in:
```
UTXO {
    amount: uint256,
    owner: address,
    sourceAttestationHash: bytes32,
    sourceChainId: uint64,
    sourceNonce: uint64,
}
mapping(bytes32 => UTXO) public utxos;  // keyed by utxoId = hash(attestation || nonce || index)
```

Spending: caller provides input UTXO ids + signatures; contract verifies, deletes inputs, creates outputs.
Conservation: enforced PER-SPEND-OPERATION (Σ outputs ≤ Σ inputs), not at the contract level.
Provenance: every unit traceable to its originating burn.
Mint authority: NONE. To mint, you submit a verified attestation that proves a corresponding burn on another chain. The attestation IS the mint receipt.

CKB-native (Cell model literally embodies this). EVM-simulatable via mapping. Solana would use Account-as-UTXO with each token unit as a discrete account.

This is the **same model as `[P·cell-knowledge-architecture]` (CKA) applied to tokens**. CKA is "UTXO model for knowledge." Canonical tokens are knowledge primitives in a different dimension. Same substrate-geometry-match argument applies — cross-chain conservation has a natural UTXO shape, ERC-20 forces it into account-balance shape that requires extra machinery (privileged minters, supply accountant, batch invariant check) to compensate.

**Option B — In-contract attestation verification.**

Token contract verifies BLS attestations inline on mint. No separate `MessagingHub`.
```
function mint(BLSAttestation memory att) external {
    if (!verifyBLS(att, validatorSetRoot)) revert InvalidAttestation();
    if (consumed[att.nonce]) revert AlreadyConsumed();
    consumed[att.nonce] = true;
    _credit(att.recipient, att.amount);
}
```

Trust topology collapses: one contract, one boundary, no role grants, no immutable-address-trust. The signature scheme IS the trust root.

Costs: token contract is larger (BLS verification logic embedded). Benefit: no contract-to-contract delegation; verification is local to the mint operation.

**Option C — Receipt-bound balances.**

Mid-way between A and standard ERC-20. Balance is a sum over receipts. Each receipt = (attestationHash, amount). Transfer creates new receipts (split parent receipt into two). Burn marks a receipt spent with destination metadata. Provenance is structural per-receipt; conservation is enforced at the receipt level.

### The substrate-geometry-match argument

The substrate is cross-chain conservation with on-chain economic security. Its natural geometric form is UTXO — every value object has its own identity, conservation is per-operation-checkable, provenance is structural.

ERC-20 is account-balance applied to a problem whose natural form is UTXO. To get conservation back into ERC-20 you have to bolt on:
- SupplyAccountant (separate contract tracking flows the token itself doesn't know about)
- Batch invariant check (re-deriving conservation from per-chain balances)
- Privileged mint authority (single point of trust)

All three are SCAFFOLDING to compensate for the substrate-geometry mismatch. Option A above gets conservation FOR FREE because UTXOs structurally enforce it.

This is the same argument as `[P·first-available-trap]` applied at the data-structure level. ERC-20 is the first-available token shape on EVM, so projects default to it. The architecture deserves a threat-model-first design that picks the right data structure for the security model.

### Meta-lesson: my audit itself needed substrate-geometry-match throughout

The original audit found AA#1 and AA#2 violations in the spec. The first-principles miss found ERC-20-as-default. Will's follow-up found that even my correction was still ERC-20-shaped because I was reaching for available code.

The pattern across all three layers: I patched what I noticed instead of re-deriving from substrate-geometry-match. The audit framework I was applying was:
- AA#1: did the fork preserve parent constraints?
- AA#2: is the claim structurally enforced?

What was missing:
- AA#0 (proposed): is the **shape** of this primitive substrate-geometry-matched to the problem, or is it the first-available data structure with bolt-on machinery compensating?

Future audits — including the v0.2 substrate-native reconstruction pass — should apply AA#0 to every architectural component:

| Spec component | Available-code shape | Substrate-native shape |
|---|---|---|
| VibeSwapCanonicalToken | ERC20Upgradeable | UTXO-style (Option A) |
| SupplyAccountant | Separate bookkeeping contract | Implicit in UTXO conservation |
| NonceRegistry | Per-pair monotonic counter | Per-UTXO consumption (no separate registry) |
| MessagingHub | Orchestrator contract | Maybe unnecessary if token verifies attestation inline (Option B) |
| MessagingValidatorRegistry | Forked SOR | Possibly the right shape if validators are the trust root |
| MessagingPoM | Slashing detector contracts | Possibly inline in the attestation verification (B) |

The Option-A or Option-B reconstruction reduces the new-contracts count from 6 to 2-3 and removes most of the scaffolding contracts that compensate for the account-balance-model mismatch.

### What's the right call?

For v0.1 → v0.2: it's worth doing a substrate-native reconstruction pass before committing more contracts. The spec right now has ~2250 LOC of new contracts. The reconstruction would either (a) confirm that ERC-20-style is the right shape after considering UTXO and inline-verification alternatives, or (b) find that 60% of those LOC are scaffolding for the wrong shape and the right shape is half the LOC with stronger structural guarantees.

Either way the spec gets better. The current spec's "v0.1 — pending decisions Q1-Q8" structure already invites this kind of revision; AA#0 substrate-geometry-match should be added as the first check.

---

## Summary

The spec is substantively well-grounded. The total-supply invariant (§4) is the load-bearing architectural property; almost everything else is in service of making that invariant checkable and slashing-enforceable. Most design choices are individually justifiable, several are over-specified for v0.1, and a few make claims that the spec does not yet structurally enforce (AA#2 findings below).

Counts:
- **LOAD-BEARING ✓**: 11 design choices that are necessary and structurally enforced. These are the spine.
- **CLAIM-WITHOUT-ENFORCER ⚠**: 6 places where the spec asserts a property that the mechanism described does not yet structurally guarantee. AA#2 hits.
- **FORK-LOSES-HARDNESS ⚠**: 3 places where forking a primitive drops a parent constraint without naming why. AA#1 hits.
- **OVER-SPECIFIED FOR v0.1**: 4 design decisions that are reasonable but premature; v0.1 doesn't need them and the wrong commit early limits v0.2 options.
- **UNDER-SPECIFIED**: 5 places where the spec gestures at a mechanism but doesn't pin down the structural detail that would make it checkable.
- **DEFENSIBLE-AS-IS**: every other claim either has a clear justification or is explicitly deferred.

The audit recommends keeping the spec at v0.1 scope but adding seven structural-enforcer clauses, naming three fork-derived constraints explicitly, and demoting four premature commitments to "open question / deferred." Then v0.2 can advance on a cleaner base.

---

## 1. Load-Bearing Claim Graph

Every architectural property the spec claims, ranked by how load-bearing it is. "Load-bearing" means: if this claim fails, the security model collapses. "Decorative" means: if this claim fails, the system still functions but loses an optimization.

| # | Claim | Layer | Load-bearing? | Where defended |
|---|---|---|---|---|
| 1 | Total-supply invariant holds across chains between events | Architecture | ✓ ESSENTIAL | §4 |
| 2 | Validators are economically bonded; slashing is on-chain | Verifier | ✓ ESSENTIAL | §7.1, §7.4 |
| 3 | BLS t-of-n threshold (t = ⌈2n/3⌉+1) | Verifier | ✓ ESSENTIAL | §7.2 |
| 4 | Per-(src,dst) nonce monotonic, consumed exactly once on destination | Messaging | ✓ ESSENTIAL | §6.2 |
| 5 | Batch invariant check at destination before mint commits | Messaging | ✓ ESSENTIAL | §4 |
| 6 | Identical-bytecode canonical token across chains | Token | ✓ LOAD-BEARING | §5.1 |
| 7 | Source chain ID baked into signed message | Messaging | ✓ LOAD-BEARING | §6.2 |
| 8 | Genesis chain (Ethereum) is the sole mint authority | Token | ✓ LOAD-BEARING | §5.2 |
| 9 | `recoverBurn` permissionless after liveness timeout | Liveness | ✓ LOAD-BEARING | §9 |
| 10 | k-confirmation policy + reorg-slashing | Reorg | ✓ LOAD-BEARING | §10 |
| 11 | Slashing routed through `ClawbackCascade` | Slashing | ✓ LOAD-BEARING | §7.4 |
| 12 | Aggregator rotation per nonce via DeterministicShuffle | Verifier | DECORATIVE | §7.3 |
| 13 | Aggregator window 60s + permissionless takeover | Verifier | LOAD-BEARING (censorship-resistance) | §7.3 |
| 14 | Shapley distribution of aggregator + signer rewards | Verifier | DECORATIVE for v1, LOAD-BEARING for honest-attestation alignment | §7.3 |
| 15 | Cross-chain commit-reveal binding to destination batch | Order | LOAD-BEARING (MEV) | §8.2 |
| 16 | Soft-finality threshold ($10k) above which hard finality required | Reorg | DECORATIVE (operational) | §10 |
| 17 | Insurance pool sized 5-10% of in-flight | Reorg | DECORATIVE (operational) | §13.2 |
| 18 | Three slashable offenses (forged / reorg / liveness) | Slashing | LOAD-BEARING (taxonomy completeness) | §7.4 |
| 19 | PoM whistleblower 10% reward | Slashing | DECORATIVE (incentive) | §7.4 |
| 20 | ZK light client upgrade path designed-in | Future | DECORATIVE for v1 | §14 |

**Decorative items can be moved to "Open question / operational"** without weakening the security model. Each decorative claim that lives in the spec body invites scrutiny on something that isn't load-bearing, distracting reviewers from the spine.

---

## 2. Per-Section Audit

### §1 Motivation

**Claim**: Off-chain infrastructure security is not equivalent to on-chain economic security. KelpDAO/LayerZero exploit is the existence proof.

**Audit**:
- ✓ Justified. The structural lesson is correct independent of the specific incident.
- ⚠ One minor over-claim: "47% of LayerZero OApp contracts ran the same 1-of-1 DVN configuration." This number should have a source citation. If it came from the post-KelpDAO post-mortem analysis, cite the source. Without a citation, an auditor would flag this as an unverified claim under `[F·critique-piece-factual-precision]`.
- **Recommendation**: add citation or soften to "a significant share" pending verification.

### §2 Design Goals

| Goal | Audit verdict |
|---|---|
| Canonical issuance | ✓ Coherent. Not a property until enforced by §5 identical-bytecode rule. |
| Total-supply invariant | ✓ Load-bearing. Defended by §4. |
| No migration burden | ⚠ Operational not architectural. Doesn't belong in design goals. |
| Per-batch latency ~25s | ⚠ Operational target, not a security property. Could miss target without breaking the model. Move to "performance budget." |
| On-chain economic security | ✓ Spine of the spec. |
| Liveness fallback | ✓ Load-bearing. Defended by §9. |
| Reuse, don't rebuild | ⚠ This is a meta-property, not a design goal. It's a property of the engineering approach, not the protocol. |

**Recommendation**: split design goals (security properties) from non-goals / engineering posture (latency, no-migration, reuse). Three security properties cleanly stated > seven mixed-concern goals.

### §3 Architecture Overview (three-layer diagram)

**Audit**:
- ✓ The three-layer decomposition is clean: Token / Messaging / Verifier. Each layer has a single responsibility.
- ⚠ AA#1 fork-loses-hardness: `MessagingValidatorRegistry` forks `ShardOperatorRegistry`. The diagram shows the fork but doesn't enumerate which constraints the parent enforces. The self-audit doc (post-layerzero-self-audit-v0.1.md) already caught H-2 (setAggregatePubkey lacks commit-finalize-challenge cycle) — that's exactly the kind of constraint the diagram should explicitly name as "preserved" or "v0.2 deferred."
- **Recommendation**: add a "Fork constraints inventory" table immediately after the diagram, listing every constraint the parent contract enforces and the disposition of each in the fork.

### §4 The Total-Supply Invariant

**Audit**:
- ✓ This is the architectural spine. The system's correctness reduces to maintaining one global invariant — that's the right shape.
- ✓ The per-chain accounting equation is precise:
  ```
  localSupply(c, T) + outboundBurned(c, T) = receivedFromGenesis(c, T) - sentToOthers(c, T)
  ```
- ⚠ AA#2 claim-needs-structural-enforcer: The spec says "if a batch ever violates this, the entire batch reverts." This requires the destination batch's invariant check to be on the same revert-frame as the mint. The spec doesn't show the call-stack. Two ways this can fail:
  - **Reentrancy**: mint emits an event, an observer mints into the same batch elsewhere, invariant check sees inconsistent state.
  - **Ordering**: invariant check runs BEFORE mint settles in storage, sees pre-mint state, passes, then mint commits invalidly.
- **Recommendation**: specify the exact transaction-ordering. Pseudocode for the destination batch settlement should show: (1) all attestations consumed → updates to inboundPending, (2) invariant check using POST-CONSUMPTION but PRE-MINT state, (3) batch mints execute, (4) post-batch invariant re-check (defense-in-depth gate-stacking). This is the structural enforcer for the claim.
- ⚠ The invariant is on-chain readable PER-CHAIN, but the cross-chain sum is not directly checkable from a single chain. The spec needs to be explicit: each chain checks ITS OWN equation; cross-chain consistency emerges from each chain individually checking its conservation law. A reader could otherwise believe a chain is doing a global sum, which would be impossible.

### §5 Token Layer

**§5.1 VibeSwapCanonicalToken**

**Audit**:
- ✓ Role-gated mint is standard OZ pattern. `onlyRole(MESSAGING_HUB_ROLE)`.
- ✓ User-callable burn is correct (anyone can burn their own tokens).
- ⚠ AA#2: "Deployed on every supported chain with identical bytecode (verifiable via on-chain hash check during validator onboarding)." The verification is mentioned but not specified. Where does the validator look up the canonical hash? Is there a CanonicalHashRegistry? If not, the "identical bytecode" property is asserted but not enforced.
- **Recommendation**: specify the CanonicalHashRegistry contract OR the on-genesis governance commit that pins the hash. The validator onboarding flow needs to be able to read the canonical hash from chain state, not from documentation.
- ⚠ Code sample includes `IMessagingHub(messagingHub).initiateBurn(...)` but doesn't show where `messagingHub` comes from. Storage variable? Immutable? UUPS upgrade hazard if it can be changed.
- **Recommendation**: declare `messagingHub` as `immutable` set in initializer. Changing the messaging hub mid-life would let an attacker contract drain mint authority.

**§5.2 Genesis Chain (Ethereum)**

**Audit**:
- ✓ Single-source-of-truth for total supply is correct.
- ⚠ "Other chains can only receive and send — never mint from nothing." This is a property claim. The structural enforcer is: non-genesis chains have NO role-grant for the genesis mint authority. The spec doesn't say so explicitly. A reader has to infer.
- ⚠ "Why Ethereum: liquidity primacy. ETH staking depth gives us a deep validator-bond market for v2 economic security." This conflates two reasons: (a) ETH is the liquidity primary, (b) ETH staking depth backs v2 validators. (b) is a v2-only consideration; for v1, ETH being genesis is a separable choice from where validators bond. Splitting them clarifies what's load-bearing now vs later.
- **Recommendation**: name the genesis-chain choice as a v1 commitment driven by liquidity primacy + ecosystem maturity. v2 validator bonding is a separate decision the spec can defer.

### §6 Messaging Layer

**§6.1 Burn-and-Mint Flow**

**Audit**:
- ✓ The 16-step flow is concrete and reviewable.
- ⚠ Step 7: "each validator signs (srcId, dstId, nonce, user, amt, recipient, sourceBlockHash) with BLS." The message-to-sign needs to include the `validatorSetEpoch` of the source chain — otherwise a validator can sign a message during epoch N that's submitted in epoch N+1 after they've been slashed/rotated. Spec needs to specify.
- ⚠ Step 12: "SupplyAccountant(D).inboundPending += amt → committed." The "→ committed" is hand-wavy. When does pending become committed? At the consume? At the mint? On the next batch? This ordering is load-bearing for the invariant check.
- ⚠ Step 15: "validator submits AttestationFinalized to MessagingHub(S)." Who submits this? Any validator? The aggregator? Compensated how? If no one is incentivized, the source-chain's `outboundBurned` row stays pending forever — soft DoS on storage.
- **Recommendation**: specify (a) message-to-sign includes validatorSetEpoch, (b) pending → committed transition timing, (c) AttestationFinalized incentivization (Shapley reward for the prover, or auto-finalized after time-window with caller).

**§6.2 Replay Protection**

**Audit**:
- ✓ Per-(srcChain, dstChain) nonce is the right shape.
- ⚠ AA#2: the spec says "consume(srcId, nonce) reverts if `nonce <= lastConsumed[srcId]` or if already in the consumed set." If nonces are strictly monotonic, the "already in consumed set" check is redundant — `lastConsumed[srcId]` advancing past nonce N means no smaller-or-equal nonce can be consumed. The redundant check is fine (defense in depth, gate-stacking-asymmetric-cost) but the spec should name this as intentional redundancy. Otherwise it reads as confusion about whether nonces are sparse or dense.
- ⚠ What about nonces processed OUT OF ORDER? If aggregator A submits nonce 5 before nonce 4 (because nonce 4's aggregator is slower), does consume(4) revert because last=5? Or do we tolerate gaps?
- **Recommendation**: clarify the ordering invariant. Either (a) nonces consumed in strict order, gaps revert; or (b) nonces tracked as a bitmap of consumed, no ordering constraint. Both work; pick one and structurally enforce it.

**§6.3 SupplyAccountant**

**Audit**:
- ✓ Three-map structure (localSupply, outboundBurned, inboundConsumed) is clean.
- ⚠ AA#1 fork-loses-hardness: the self-audit doc (C-1) already caught that `syncLocalSupply` had ambiguous auth. The spec should reference the self-audit findings explicitly so reviewers know they've been addressed.
- **Recommendation**: add a "Self-audit findings addressed" subsection or footnote.

### §7 Verifier Layer

**§7.1 MessagingValidatorRegistry**

**Audit**:
- ✓ The fork rationale is named: "shard-bonds and messaging-bonds carry different slashing risk profiles."
- ⚠ AA#1 fork-loses-hardness: parent's `cellsReport` commit-finalize-challenge cycle was dropped (per self-audit H-2). The spec doesn't list this drop. The reader of the spec would not know this constraint was relaxed.
- ⚠ Bond size, activation delay, unbonding delay parameters are stated but not derived. Per `[F·augmented-mechanism-design-paper]`: bond sizes / challenge windows / slash splits should be derived from the AMD paper, not asserted. Either cite the paper for the parameter derivation OR mark these as "v0.2 — pending AMD parameter derivation."
- ⚠ "Max set size: 128 active validators per chain (bounded for BLS aggregation efficiency)." 128 is plausible but not justified. What gas budget? At what threshold does verification cost become problematic? An auditor would want to see the cost analysis.
- **Recommendation**:
  1. Add "Fork constraints inventory" table — every parent constraint, with disposition (preserved / relaxed / deferred-to-v0.2 with reason).
  2. Move parameters (32 ETH bond, 7-day activation, 14-day unbonding, 128 max set) to a parameters appendix, with each parameter either citing the AMD paper or marked as "tentative, pending derivation."
  3. Add gas-cost analysis for n=128 BLS verification on Ethereum + L2s.

**§7.2 BLS Threshold Signatures**

**Audit**:
- ✓ t = ⌈2n/3⌉ + 1 is standard PoS finality threshold. Defensible.
- ✓ BLS12-381 is the right curve choice for Ethereum-native context (justified in §13.1).
- ⚠ "Pubkey aggregation: precomputed at validator-set rotation boundaries." This requires the validator set to rotate atomically — if rotation can produce intermediate states (some validators added, some not yet removed), the aggregate pubkey is wrong during the transition. The self-audit caught a rotation-related issue (H-1, rotateSet rate limiting). The spec should specify that rotation is atomic and what "atomic" means at the storage level.
- ⚠ "On-chain verification cost: ~110k gas on Ethereum." Plausible with EIP-2537 but worth stating where this comes from (benchmark? spec? eyeballed estimate?).

**§7.3 Aggregator Rotation**

**Audit**:
- ✓ Per-nonce rotation via DeterministicShuffle is a good substrate-match (no new randomness primitive).
- ✓ 60s aggregator window + permissionless takeover is the censorship-resistance defense.
- ⚠ AA#2 claim-needs-structural-enforcer: "Aggregator reward distributed via ShapleyDistributor (game-theoretic — incentives align with honest, prompt aggregation)." The Shapley-via-incentive-alignment claim needs the structural derivation. Per `[F·augmented-mechanism-design-paper]`, the AMD paper is the authority for this kind of claim — either cite the exact axiom/property or mark as deferred.
- ⚠ "Any other validator can submit and claim the aggregator reward" — when there are TWO submissions racing (chosen aggregator's late submission + a backup's takeover submission), which one wins? First-confirmed? What if both confirm? Spec needs to say.
- **Recommendation**: specify the race resolution (first-confirmed wins; second submission reverts on already-consumed nonce — clean, uses existing replay protection).

**§7.4 Slashing**

**Audit**:
- ✓ Three-offense taxonomy (forged / reorg / liveness) is well-chosen.
- ⚠ AA#2 claim-needs-structural-enforcer: "Forged attestation: 100% bond, distributed to insurance pool." 100% bond is asserted but not derived — what makes 100% the right number vs 50%, vs 200% (over-collateralization)? Either derive from the AMD paper or note as a v0.2 parameter.
- ⚠ "Reorged source signature: 50% bond" — same. Why 50%? The asymmetry (100% for forged vs 50% for reorged) has implicit ranking of severity but no derivation.
- ⚠ "Liveness failure: 5% bond, ejection if repeat" — the self-audit doc (C-2) caught that "ejection if repeat" was not enforced in the v0.1 implementation. Geometric decay never reaches ejection. The spec needs to explicitly state: "ejection at N=3 offenses" (or whatever the actual rule is) with the offense counter as a contract-level structural enforcer, not a percentage.
- ⚠ "Slashing proofs are permissionless: anyone can submit a PoM with bond-stake and earn 10% of the slashed amount on success." 10% is asserted, not derived. Same AMD paper question.
- **Recommendation**: move all slashing parameters (100% / 50% / 5% / 10% / 3-offense ejection) to a parameters appendix with derivation or "pending AMD" tag.

### §8 Latency Budget & Cross-Chain Order Shape

**Audit**:
- ✓ §8.1 latency table is clear.
- ⚠ §8.1 "Reorg risk covered by validator slashing" — this is a claim that needs an enforcer. The structural enforcer is the reorg-slashing offense type in §7.4. The spec implicitly relies on §7.4 here; explicit cross-reference would help.
- ✓ §8.2 cross-chain order shape is well-thought-through. Destination-batch pricing is correctly framed as feature not bug.
- ⚠ §8.2 "If the attestation arrives outside the target batch window, the order auto-cancels and refunds." Auto-cancel implies an active gate. WHO checks the window? The destination MessagingHub? On what trigger? If it's only checked when someone calls consume, a delayed attestation could still mint into the WRONG batch. Spec needs to specify the gate.
- **Recommendation**: specify the destination-batch-window gate as a structural check in `MessagingHub(D).receiveAttestation`. Pseudocode:
  ```
  if (currentBatchN > attestation.destBatchTarget + GRACE_WINDOW) {
      // refund path — emit RefundRequired event, source-chain recovers
      revert AttestationStale();
  }
  ```

### §9 Liveness Fallback

**Audit**:
- ✓ The 1-hour `recoverBurn` window is reasonable.
- ⚠ AA#2 claim-needs-structural-enforcer: "Triggers PoM-slashing cascade against all validators that didn't sign within window." This is the structural enforcer for "slashing makes liveness failure costly." But the spec doesn't show how `recoverBurn` knows WHICH validators didn't sign — there's no signature record to point at (because no attestation was submitted). The natural mechanism: validators that DID sign internal heartbeats / partial-attestations get a pass; everyone else is slashable. But the spec doesn't define a heartbeat mechanism.
- **Recommendation**: either (a) specify the validator heartbeat / liveness-evidence mechanism that recoverBurn references for slashing, OR (b) downgrade the slashing claim to "validators who failed to participate in the attestation round are observable via the BLS aggregation log; PoM detector compares aggregation against full set."
- ⚠ The CAS pattern for race condition is correct (consume on destination is atomic).
- ⚠ Re-issued on source: "VibeSwapCanonicalToken.mint(originalUser, amt, nonce)" — what about the supply invariant? When source re-mints, `localSupply(s, T)` increases. The original `outboundBurned(s, T) -= amt` clears the pending row. So `localSupply + outboundBurned = receivedFromGenesis - sentToOthers` still holds (because `sentToOthers` never incremented; the burn was unwound, not consumed elsewhere). Math works; spec could state this explicitly to make the invariant preservation obvious.

### §10 Soft-Finality and Reorg Handling

**Audit**:
- ✓ 1-conf default + 32-conf threshold tier is reasonable.
- ⚠ AA#2: "Validators that signed an attestation referencing a block subsequently orphaned lose 50% of bond. This is cryptographically detectable on-chain (the orphaned block hash vs canonical hash)." Detectability requires the destination chain to know the source chain's canonical block hash. How? Either:
  - Source chain provides hash via the same validator network (chicken-and-egg)
  - Destination chain has a light client of source
  - PoM submitter provides the orphan-evidence and contestation period
- **Recommendation**: specify the reorg-proof submission mechanism. The likely answer: "PoM submitter provides both the signed-attestation-block-hash AND a proof-of-orphan (e.g., a source-chain header chain showing the canonical hash differs). Source chain operator can contest within a challenge window." This is the structural enforcer for the claim.
- ⚠ "Insurance pool: shortfalls covered by VibeSwap's existing ILProtection / treasury reserves." This conflates two reserves. ILProtection is for impermanent loss on AMM pools, not messaging shortfalls. Treasury is general. Spec should be explicit: NEW insurance reserve OR explicit re-purposing of ILProtection.
- **Recommendation**: specify the messaging-specific insurance reserve. Either name it (`MessagingInsurance`) or specify the ILProtection re-purposing with the new rules.

### §11 Phased Rollout

**Audit**:
- ✓ Phased rollout (v1 own tokens → v2 USDC via CCTP → v3 lock-and-mint) is correct sequencing.
- ⚠ v1 scope: "JUL, VIBE, JCV, VibeStable." JCV is mentioned but the canonical-token primitive in §5 talks generically about "T". JCV-specific properties (compute vouchers?) might have different supply dynamics. Either specify JCV has the same supply semantics as JUL/VIBE/VibeStable or carve it out.
- ⚠ "Validator set: bootstrap with 16 validators (mix of VibeSwap-aligned operators + staking partners)." 16 < 128 max-set-size. The threshold t = ⌈2n/3⌉+1 at n=16 is t=12. Centralization risk acknowledged in §13.2 (Q4). Spec should make explicit that v1's curated set is a starting state, not the steady state, and link to Q4 in §13.

### §12 Reuse of Existing Primitives

**Audit**:
- ✓ The reuse table is the strongest section of the spec for showing engineering leverage.
- ⚠ NCI (Nash Commit Initiative) listed as "anti-collusion gate" with status "Optional layer on aggregator selection." Optional means not load-bearing. If it's truly optional, move out of the primitive table; if it's load-bearing for some threat scenario, name the scenario.
- ⚠ Total new LOC estimate (~2250 LOC). This is a reasonable estimate but spec should note: estimate excludes tests, governance migration scripts, and per-chain deployment tooling. Practical LOC including those is 2-3x.

### §13 Open Questions

**Audit**:
- ✓ Q1-Q8 properly enumerated, with resolved decisions clearly marked.
- ✓ §13.1 (resolved) and §13.2 (recommended) split is clean.
- ⚠ Q1 (validator client implementation) is "Open — resourcing decision." This is the largest unresolved item by engineering effort. Spec doesn't say what happens if both options (in-house vs fork) are too expensive. Risk should be acknowledged.
- ⚠ Q7 (insurance pool sizing) is "Recommended" but the 5-10% number isn't derived from anything in the AMD paper or referenced. Either derive or mark as "pending data, initial heuristic 5-10%."

### §14 Future Work — ZK Light Client Path

**Audit**:
- ✓ ZK upgrade path is a real design property of the spec (interface swap-ability).
- ⚠ "Slashing model collapses — invalid proofs cannot be generated, period." This is a strong claim. ZK proofs can have bugs (circuit bugs, soundness bugs, trusted-setup bugs). The slashing model SIMPLIFIES — it doesn't collapse. Honest framing: "Slashing for forged attestations becomes economically less central because the cryptographic gate handles most cases; slashing for circuit-bug exploitation and prover liveness still applies."

### Appendix A — Threat Model

**Audit**:
- ✓ Comprehensive coverage of the main threat classes.
- ⚠ Missing thread: **Initialization-front-running**. The genesis chain's `mintCanonical` action grants role to MessagingHub. If MessagingHub is upgradeable (UUPS), the upgrade-authority compromise is a single-point-of-failure not covered. Should be in threat model + defense (timelock + multisig + per `[P·augmented-governance]` hierarchy).
- ⚠ Missing: **Cross-chain validator-set divergence**. If validator set on chain A differs from chain B (slow rotation propagation), an attestation signed on A might not verify on B. Spec mentions rotation atomicity but doesn't cover cross-chain rotation sync.

### Appendix B — Comparison vs Alternatives

**Audit**:
- ✓ Useful for pitching.
- ⚠ The "47% ran 1-of-1" claim recurs here. Single source-citation handles all instances.
- ⚠ "Latency (typical): ~25s" vs Chainlink CCIP ~30-60s. Plausible, but readers will want to know what "typical" means. Source: §8.1 latency budget. Cross-reference.

### Appendix C — Why On-Chain Economic Security Beats Off-Chain Infrastructure

**Audit**:
- ✓ Strong conceptual framing.
- ✓ Connects to `[P·airgap-problem-blockchain-vs-reality]` and `[P·honesty-as-structural-load-bearing-property]` already in the corpus.
- This is the section to pull from for the partner-facing one-pager / pitch (likely already done as `airgap-problem-onepager.md`).

---

## 3. AA#2 Findings — Claims Without Structural Enforcers

Concentrated list of every place the spec asserts a property that the described mechanism does not (yet) structurally guarantee. Each is a v0.2 deliverable (specify the enforcer) or v0.1 doc-only fix (cross-reference to the existing enforcer).

| # | Claim | Where | Required structural enforcer |
|---|---|---|---|
| AA2-1 | Total-supply invariant violation reverts the batch | §4 | Specify transaction ordering in destination batch settlement |
| AA2-2 | Identical-bytecode token across chains | §5.1 | CanonicalHashRegistry contract OR genesis-governance commit |
| AA2-3 | "Other chains never mint from nothing" | §5.2 | Explicit role-assignment table: only Ethereum has genesis-mint role |
| AA2-4 | Aggregator reward distribution is incentive-aligned | §7.3 | AMD paper derivation or "pending AMD" tag |
| AA2-5 | Forged attestation = 100% bond | §7.4 | AMD paper derivation OR explicit "v0.2 parameter" tag |
| AA2-6 | "PoM slashing for validators that didn't sign within window" | §9 | Heartbeat / partial-attestation log mechanism |
| AA2-7 | Reorg detectable on-chain | §10 | Reorg-proof submission mechanism (PoM payload spec) |

Each is a concrete v0.2 fix.

---

## 4. AA#1 Findings — Fork-Loses-Hardness

Each fork from a parent primitive should name every constraint the parent enforced and disposition each one (preserved / relaxed-with-reason / deferred). The spec doesn't currently do this. AA#1 instances:

| # | Fork | Parent | Constraint dropped | Disposition |
|---|---|---|---|---|
| AA1-1 | MessagingValidatorRegistry from ShardOperatorRegistry | SOR | Commit-finalize-challenge cycle on setAggregatePubkey | DEFERRED to v0.2 (needs AttestationVerifier as resolver) — name in spec |
| AA1-2 | Same fork | SOR | cellsReport challenge resolver | DEFERRED — name in spec |
| AA1-3 | MessagingPoM from ProofOfMisbehavior | PoM | Governance-asserted slashing (vs cryptographic-evidence-only) | DEFERRED to v0.2 — name in spec |

**Recommendation**: add a "Fork Constraints Inventory" subsection to §7.1 listing each parent-constraint and disposition, so a reader of the spec doesn't have to discover dropped constraints by reading the parent contract.

---

## 5. Over-Specified for v0.1

Items the spec commits to that don't need to be committed yet, and which constrain v0.2 options:

| # | Item | Why over-specified | Recommendation |
|---|---|---|---|
| OS-1 | Validator count = 128 max, t = ⌈2n/3⌉+1 | Both numbers without empirical / cost-curve justification | Move to "tentative, pending operational data" |
| OS-2 | Aggregator window = 60s | Number is plausible but unjustified | Tag as "initial value, governance-tunable" |
| OS-3 | Soft-finality threshold = $10k | Arbitrary; depends on insurance reserve size | "Initial value, governance-tunable" |
| OS-4 | Insurance reserve = 5-10% of in-flight | Number isn't derived | Tag as "initial heuristic, post-launch empirical" |

None of these break v0.1; they just make v0.2 work harder if the numbers turn out wrong. Tagging them as tentative respects future revision.

---

## 6. Under-Specified

Items that need more detail before contracts can be written safely:

| # | Item | Where | Fix |
|---|---|---|---|
| US-1 | Pending → committed transition timing | §6.1 step 12 | Specify exact ordering |
| US-2 | AttestationFinalized submission incentive | §6.1 step 15 | Shapley reward or auto-finalize |
| US-3 | Nonce ordering (strict vs sparse) | §6.2 | Pick and enforce |
| US-4 | Aggregator-race resolution | §7.3 | First-confirmed-wins via existing replay |
| US-5 | Cross-chain validator-set rotation sync | (missing) | Add to §7.1 |

---

## 7. Decorative — Move Out of Core Spec

Items that are operational concerns, not security properties. They distract reviewers from the security spine.

- §2 design goals: "no migration burden," "per-batch latency ~25s," "reuse don't rebuild" — move to an "engineering posture" section
- §7.3 Shapley reward distribution — load-bearing for incentive alignment but optional for v1 mainnet bootstrap; can move to v1.5 phase
- §10 insurance pool sizing (5-10%) — operational
- §11 specific validator-count for bootstrap (16) — operational

---

## 8. Summary of Recommendations

| Priority | Action |
|---|---|
| **Now** | Add Fork Constraints Inventory subsection to §7.1 (AA#1 fix) |
| **Now** | Add 7 structural-enforcer clauses (AA#2 fixes table above) |
| **Now** | Specify destination-batch settlement ordering (§4 / §6.1) |
| **Now** | Specify CanonicalHashRegistry mechanism (§5.1) |
| **Soon** | Move 4 over-specified parameters to "tentative" tags |
| **Soon** | Add 5 under-specified clauses (US-1 through US-5) |
| **Soon** | Cite the AMD paper for every slashing parameter (§7.4) |
| **v0.2** | Add §15: Initialization & Genesis Choreography (covers role assignment, migration, governance bootstrap) |
| **v0.2** | Threat model: add init-front-running + cross-chain validator-set divergence |
| **v0.2** | Soften ZK section's "slashing collapses" claim |

---

## 9. Substrate-Geometry Match Check

Per `[P·substrate-geometry-match]`: does the messaging-layer mechanism match the substrate's natural geometry?

**Substrate**: cross-chain state coordination, asynchronous, eventually-consistent, with on-chain economic security as the load-bearing trust assumption.

**Mechanism**: burn-and-mint with BLS-threshold-signed attestations + total-supply invariant check at each batch.

**Match analysis**:
- ✓ Conservation-law shape (total supply invariant) matches the substrate's eventually-consistent property — local correctness via local invariant; global correctness emerges from per-chain local checks. Same shape as UTXO + parallel-transaction validation in blockchain consensus.
- ✓ BLS threshold + on-chain slashing matches the "on-chain economic security" substrate — security property is checkable from chain state.
- ⚠ Batch-aligned settlement matches VibeSwap's auction substrate (10s batches, commit-reveal). The cross-chain order shape (§8.2) preserves this. Good.
- ⚠ The aggregator role (per-nonce rotation) is FRACTAL with the auction's MEV protection (commit-reveal rotates exposure per-batch). Same substrate-geometry-match pattern. Good.

**Verdict**: substrate-geometry match passes. The mechanism is well-shaped for the substrate.

---

## 10. Augmented Mechanism Design Check

Per `[F·augmented-mechanism-design-paper]`: are fairness / safety properties structural (by construction) or discretionary (by policy)?

| Property | Structural or discretionary? |
|---|---|
| Total-supply invariant | Structural (math-enforced on-chain) ✓ |
| Slashing on forged attestation | Structural (cryptographic detection) ✓ |
| Slashing on liveness | Mixed — % is structural, ejection-after-N is structural-pending-implementation per self-audit C-2 |
| Aggregator censorship resistance | Structural (60s window + permissionless takeover) ✓ |
| Replay protection | Structural (nonce monotonic) ✓ |
| Insurance backstop | Discretionary (governance-tunable reserve) — operational |
| Slashing parameters (100% / 50% / 5% / 10%) | Discretionary in v0.1 — AMD paper derivation needed |

Most load-bearing properties are structural. The discretionary tail is concentrated in slashing parameters, which is the right tail to be discretionary (it's tunable economic policy, not a security gate). Aligns with the AMD principle: augment markets with math invariants; tune the gradient (parameters) discretionary.

---

## 11. Augmented Governance Check

Per `[P·augmented-governance]`: does the spec preserve the hierarchy Physics > Constitution > Governance?

- **Physics** (P-001 Shapley invariants, mathematical conservation laws): the total-supply invariant + BLS verification + nonce monotonicity. These cannot be overridden by 51% vote. ✓
- **Constitution** (fairness baseline): the slashing taxonomy (forged / reorg / liveness) defines what counts as honest. The constitution can be modified only via the genesis-chain governance with appropriate quorum. Spec doesn't explicitly say this, but the role-grants in §5.2 imply it.
- **Governance** (DAO-tunable within physics + constitution): slashing parameters, validator set size, aggregator window, insurance reserve. All correctly scoped to governance.

**Verdict**: hierarchy preserved. Governance cannot break the supply invariant (it's enforced on-chain by every batch check). The discretionary parameters are inside the governance scope, where they belong.

---

## 12. CCP Check — Cross-Context Protocol

Per `[P·cross-context-protocol]`: enumerate contexts whose state could invalidate the spec.

| Context | Invalidation risk | Defense |
|---|---|---|
| EIP-2537 (BLS precompile) status | If precompile is delayed or removed on Ethereum, BLS verification gas cost rises | Spec assumes EIP-2537; should mark dependency |
| LayerZero/CCTP changes | If CCTP changes its API mid-rollout, §11.v2 plan needs revision | Document v2 as "designed assuming CCTP API stable; revisit at v2 ship" |
| Ethereum staking dynamics | If validator-bond market liquidity shifts, 32 ETH bond floor may be wrong | Bond floor governance-tunable; OK |
| Solana fork-choice changes | If Solana finality semantics change, §13.1 two-tier policy needs update | Two-tier already governance-tunable; OK |
| VibeSwap auction batch cadence | If batch interval changes from 10s, cross-chain order timing assumptions break | Document the dependency in §8 |
| AMD paper status | Spec defers parameter derivation to AMD paper; if AMD paper revises a number, spec needs sync | Cite specific version of AMD paper for each parameter |
| KelpDAO post-mortem details | The 47% / $4.5B numbers depend on post-mortem accuracy | Single citation + soften if post-mortem revises |

None of these are blockers. All are dependencies the spec should declare so a future reader knows what to check before assuming the spec is still valid.

---

## 13. Sanity Check Matrix

For each major design choice: is the choice logically justifiable from first principles given the design goals?

| Choice | Justifiable from goals? | Alternative considered? | Why this one? |
|---|---|---|---|
| Burn-and-mint vs lock-and-mint | ✓ | Lock-and-mint deferred to v3 | No custody risk for own tokens; canonical issuer property |
| BLS threshold sig vs ECDSA multisig | ✓ | ECDSA possible but verification cost scales poorly past ~20 signers | n=128 scaling requires aggregate sig |
| 1-of-1 DVN → t-of-n bonded validators | ✓ | The whole spec's raison d'être | KelpDAO existence proof |
| Per-nonce aggregator rotation | ✓ | Stake-weighted leader rejected (centralization) | Uniform load, censorship-resistant |
| Ethereum as genesis chain | ✓ for v1 | Could use CKB or Solana | Liquidity primacy |
| Shapley distribution of rewards | ⚠ Justified by AMD paper but cite | Linear distribution | Axiom-fairness, anti-MLM |
| ZK upgrade path designed-in | ✓ | Could swap whole architecture later | Interface stability, incremental |
| 25s latency target | ⚠ Operational, not justifiable from goals | Could accept higher | UX competitive vs LZ/Wormhole |
| 32 ETH bond floor | ⚠ AMD paper derivation needed | Could be 16 ETH or 64 ETH | Defer to AMD |
| 5%/50%/100% slashing gradient | ⚠ Pending AMD derivation | Could be 10%/100%/200% | Defer to AMD |

The choices that need AMD-paper-backing are concentrated in the economic-parameter layer, which is exactly where AMD is supposed to do the work. The architectural choices (mechanism shape) are all justifiable from first principles.

---

## 14. Closing

**Overall verdict**: the spec's architectural spine is sound. The total-supply invariant is the right load-bearing claim, and the mechanism described — burn-and-mint + BLS-threshold attestations + per-batch invariant check + slashing-enforced honesty + permissionless liveness fallback — is a coherent realization of the on-chain-economic-security thesis. Substrate-geometry-match, AMD, and AugGov checks all pass.

**What needs work for v0.2**:
1. Add Fork Constraints Inventory (AA#1 fix)
2. Add 7 structural-enforcer clauses (AA#2 fixes)
3. Tag 4 over-specified parameters as tentative
4. Specify 5 under-specified mechanisms
5. Cite AMD paper for every slashing parameter
6. Add init-front-running + cross-chain set-divergence to threat model
7. Soften ZK section's "slashing collapses" claim

**What's already excellent**:
1. The three-layer decomposition (Token / Messaging / Verifier)
2. The conservation-law framing of the invariant
3. The reuse table demonstrating engineering leverage
4. The threat model coverage of the main classes
5. The honest framing of v0.1 vs v0.2 deferrals (the self-audit doc does this work for the contracts; the spec should mirror it)

The work is good. The v0.2 cut, with the recommendations applied, will be defensible against any audit-grade review including ones that apply the same structural-enforcer + fork-constraint lenses.

*Audit completed 2026-05-14 by JARVIS overlay (in collaboration with Will Glynn). Lenses applied: AA#1 fork-loses-hardness, AA#2 claim-needs-structural-enforcer, AA#3 entity-context-cross-reference, P·cross-context-protocol, P·substrate-geometry-match, F·augmented-mechanism-design-paper, P·augmented-governance, P·gate-stacking-asymmetric-cost.*
