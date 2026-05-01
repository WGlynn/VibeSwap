# Cross-Chain Attestation

> *A user on Arbitrum submits a contribution. The protocol needs to score and reward them — but the similarity keeper runs on Optimism, and the reward distribution happens on Ethereum mainnet. How does the attestation flow across chains without losing integrity?*

This doc specifies how VibeSwap's attestation system works across chains. VibeSwap is omnichain (LayerZero V2). Contributions can originate anywhere. Attestations must traverse chain boundaries while preserving the schema, signatures, and slashing guarantees from [`ATTESTATION_CLAIM_SCHEMA.md`](../identity/ATTESTATION_CLAIM_SCHEMA.md).

## The cross-chain challenge

On a single chain, an attestation is straightforward: user signs, contract verifies, state updates. The signature scope is the contract address + chain ID (via EIP-712 domain separator). All parties see the same state.

Cross-chain introduces hard problems:

1. **Signature scope**: signature valid on chain A might not be valid on chain B without domain-separator adjustments.
2. **State consistency**: an attestation committed on chain A takes time to propagate to chain B.
3. **Slashing coordination**: if the attestor misbehaves on chain B, slashing their bond on chain A requires cross-chain messaging.
4. **Order-of-operations**: an attestation might be submitted on A and read on B in non-deterministic order.

LayerZero V2 provides cross-chain messaging. This doc builds the attestation protocol on top.

## Architecture

```
┌─────────────────────────────┐
│       Chain A (origin)       │
│                              │
│  User submits attestation    │
│  Local AttestationClaim stored │
│  Event emitted              │
└──────────────┬──────────────┘
               │  LayerZero message
               ▼
┌─────────────────────────────┐
│  Chain B (relay/verify)      │
│                              │
│  Message arrives            │
│  Verification of signature  │
│    via chain-A domain       │
│  Mirror state update        │
└──────────────┬──────────────┘
               │  read by
               ▼
┌─────────────────────────────┐
│  Chain C (consumer)          │
│                              │
│  Shapley / reward logic     │
│  consumes attestation       │
└─────────────────────────────┘
```

Three chain roles:

- **Origin**: where the user submits. Attestation is authoritative here.
- **Relay/verify**: intermediate chains that hold mirrored state for efficient reads.
- **Consumer**: chains where downstream logic (Shapley, reward distribution) reads the attestation.

Sometimes all three are the same chain; sometimes distinct.

## Signature scope: cross-chain domain separator

EIP-712 domain separator typically binds to chain ID + contract address. Cross-chain needs adjustment:

```solidity
bytes32 constant CROSS_CHAIN_DOMAIN_SEPARATOR = keccak256(
    abi.encode(
        keccak256("EIP712Domain(string name,string version,bytes32 originChainId,address originContract)"),
        keccak256("VibeSwap"),
        keccak256("1"),
        bytes32(block.chainid),     // originChainId at attestation time
        address(this)                // originContract
    )
);
```

The originChainId is committed in the signature scope. When chain B verifies, it uses the SAME originChainId (chain A's). Signature is valid across chains.

This allows attestations submitted on chain A to be verified on chain B without signature invalidation — but only if the signer intended cross-chain scope. The user explicitly signs over the origin chain ID.

## Message flow

### Step 1: Origin-chain submission

User calls `submitAttestation` on chain A. Contract:
1. Verifies signature locally.
2. Records AttestationClaim in chain A storage.
3. Emits `AttestationCommitted` event.
4. If cross-chain relay requested, emits LayerZero message.

```solidity
function submitAttestation(AttestationClaim calldata claim, bool propagate) external {
    // 1. Verify locally
    require(verifyClaim(claim), "invalid claim");
    
    // 2. Record locally
    claims[claim.claimId] = claim;
    emit AttestationCommitted(claim.claimId, claim.attestor, msg.sender);
    
    // 3. Optionally propagate
    if (propagate) {
        _propagateToChains(claim);
    }
}
```

### Step 2: LayerZero transmission

```solidity
function _propagateToChains(AttestationClaim calldata claim) internal {
    bytes memory message = abi.encode(claim);
    for (uint256 i = 0; i < relayChainIds.length; i++) {
        uint32 dstEid = relayChainIds[i];
        _lzSend(dstEid, message, options, fee, refundAddr);
    }
}
```

LayerZero delivers the message to the destination chains.

### Step 3: Destination-chain reception

```solidity
function _lzReceive(
    Origin calldata origin,
    bytes32 guid,
    bytes calldata message,
    address executor,
    bytes calldata extraData
) internal override {
    AttestationClaim memory claim = abi.decode(message, (AttestationClaim));
    require(verifyClaimWithDomain(claim, origin.srcEid), "invalid claim");
    require(!claims[claim.claimId].set, "already mirrored");
    claims[claim.claimId] = claim;
    emit AttestationMirrored(claim.claimId, origin.srcEid);
}
```

The destination chain verifies against the ORIGIN chain's domain separator, not its own. Signature scope is preserved.

### Step 4: Consumer-chain read

```solidity
function getShapleyInputs(address contributor, uint256 period) public view {
    AttestationClaim[] memory attestations = getAttestations(contributor, period);
    // Use attestations in Shapley computation
}
```

Same lookup pattern as single-chain. The consumer chain may need to wait for LayerZero delivery before attestation is available.

## Timing considerations

LayerZero delivery typically takes 1-5 minutes (DVN + Executor processing). For:

- **Shapley distribution**: runs on fixed schedule (e.g., daily). 1-5 minute delay is irrelevant.
- **Circuit breaker resume attestation**: time-sensitive. If trip is on chain A and resume is decided on chain B, the propagation delay matters. Mitigation: resume logic runs on origin chain A, consumed by other chains.
- **Similarity scoring**: the keeper submits to a central chain; other chains pull via LZ.

Design principle: **decisions happen on the origin chain; other chains mirror for read convenience.**

## Slashing across chains

If an attestor misbehaves:

1. **Evidence surfaces on any chain** (where the misbehaving attestation was consumed).
2. **Slashing decision**: either automated (deterministic check) or governance vote.
3. **Slashing execution on origin chain** (where the bond is held).
4. **Slashing event propagated** to other chains via LayerZero.

The BOND is a single-chain resource (where it was staked). Other chains read the bond's status but don't modify it. Concentrating slashing on the origin chain simplifies accounting.

## Attack: cross-chain replay

Attack: submit the same attestation on multiple chains, trying to double-count credit.

Defense: claim ID includes `originChainId` in its hash. Submitting on chain A generates `claimIdA`; submitting on chain B generates `claimIdB`. Different IDs, tracked independently. Consumer logic dedupes by claim content, not just ID.

Additional defense: when mirroring, the destination chain checks `claims[claim.claimId].set == false` before accepting. Prevents same-ID double-mirroring.

## Attack: message spoofing

Attack: malicious chain sends fake LayerZero messages claiming attestations that weren't made.

Defense: LayerZero V2 DVNs (Decentralized Verifier Networks) verify message origin. A contract can require multiple DVN confirmations before accepting a message.

Configuration: `requiredDVNs = [VibeSwapTrustedDVN, LayerZeroLabsDVN]` for high-stakes messages.

## Attack: chain-split state

Attack: chain A goes through a reorg, invalidating an attestation that was already mirrored to chain B.

Defense: LayerZero waits for configurable block-confirmations before considering a source-chain event final. For VibeSwap's attestations: 20 confirmations on Ethereum, 12 on Arbitrum, 1 on fast chains.

If a chain-split occurs after finality, the affected attestation is considered "rolled back" — but this is a catastrophic-level event requiring governance intervention.

## Storage considerations

Mirroring all attestations to all chains would be expensive. Strategies:

### Strategy A: Full mirror

Every attestation propagates to every chain. Max redundancy, max storage cost.

Use case: small number of attestations, all chains need all data.

### Strategy B: Selective mirror

Attestation mirrors only to chains that need it (e.g., user's home chain + chains where rewards distribute).

Use case: most VibeSwap scenarios. Reduces storage cost.

### Strategy C: Lazy pull

Attestation lives on origin only. Other chains pull via LayerZero query on demand.

Use case: rare-reference attestations. Highest latency but lowest storage.

Default: Strategy B. Critical attestations (e.g., high-value contributions) may use Strategy A; speculative exploration attestations use Strategy C.

## Omnichain ContributionAttestor design

A user interacts with ContributionAttestor on their home chain. Under the hood, the contract handles propagation.

```solidity
contract OmnichainContributionAttestor is OApp {
    mapping(bytes32 => AttestationClaim) public claims;
    mapping(bytes32 => uint32[]) public mirroredOn;
    
    uint32[] public defaultMirrorChains;
    
    function submit(bytes calldata claimData, uint32[] calldata extraMirrorChains) external payable {
        AttestationClaim memory claim = decode(claimData);
        require(verifyClaim(claim), "invalid");
        claims[claim.claimId] = claim;
        
        uint32[] memory targets = mergeChains(defaultMirrorChains, extraMirrorChains);
        _propagate(claim, targets);
    }
}
```

Users pay LayerZero fees for propagation. Default mirror chains are governance-set.

## Student exercises

1. **Compute the gas cost of a cross-chain attestation.** Origin-chain submission + LayerZero message + destination-chain mirror. Use typical gas prices.

2. **Design the Strategy B selector.** Given an attestation's type + value, how do you decide which chains to mirror to? Write pseudocode.

3. **Chain-split recovery protocol.** Walk through the steps of handling a chain reorg that invalidates mirrored attestations.

4. **Signature verification across chain IDs.** Verify an EIP-712 signature where the originChainId is Ethereum but the verifying contract is on Arbitrum. Spec the verification function.

5. **DVN configuration.** For high-stakes attestations (e.g., resume claims), what DVN config balances security + availability?

## Integration with Gap #2 + Gap #3

### Gap #2 (SimilarityOracle)

The similarity keeper can run on any chain. Its scores are attestations per the schema. Scores for cross-chain contributions use the protocol above.

Special case: the similarity function itself is committed on one chain (via commit-reveal). Other chains reference it via message. This is a ONE-TIME setup; scores thereafter don't require extra cross-chain traffic for the function commitment.

### Gap #3 (Attested Resume)

Circuit breakers are per-chain. A breaker trip on chain A requires resume attestations from that chain's certified attestors. Cross-chain resume is rare.

But: if circuit breakers are LINKED (trip on A causes pause on B), resume attestations might need to cover multiple chains. Design this carefully.

## Future work — concrete code cycles

### Queued for post-launch

- **OmnichainContributionAttestor** — migrate existing ContributionAttestor to OApp-based omnichain. Substantial work: ~300 LOC + LayerZero config + testing.

- **Cross-chain Shapley** — downstream consumer of cross-chain attestations. Aggregates across chains. See [`CROSS_DOMAIN_SHAPLEY.md`](../shapley/CROSS_DOMAIN_SHAPLEY.md) for related.

- **Chain-split recovery tools** — governance tools for handling reorg-affected attestations.

### Queued for research

- **Cross-chain similarity computation** — if contributions on different chains should be compared for novelty, similarity must span chains. Expensive but potentially necessary.

## Relationship to other primitives

- **Attestation Claim Schema** (see [`ATTESTATION_CLAIM_SCHEMA.md`](../identity/ATTESTATION_CLAIM_SCHEMA.md)) — schema extended with cross-chain fields.
- **Commit-Reveal For Oracles** — function commitment propagates.
- **Attested Resume** — per-chain circuit breakers; resume attestations are per-chain.
- **LayerZero V2** — the underlying cross-chain messaging.

## How this doc feeds the Code↔Text Inspiration Loop

This doc specifies a substantial future code cycle (OmnichainContributionAttestor) and the supporting infrastructure. Shipping that cycle updates this doc with observed performance + any deviations.

## One-line summary

*Cross-Chain Attestation extends VibeSwap's attestation schema across LayerZero V2. Origin-chain authoritative + selective mirroring to consumer chains. Cross-chain domain separator preserves signature scope. Slashing concentrated on origin chain. Three mirror strategies (full, selective, lazy) chosen per attestation value. Defenses against replay, spoofing, and chain-split.*
