# Attestation Claim Schema

> *A claim without structure is just an opinion. A claim WITH structure — signer, subject, verdict, reasoning, bond — is auditable, challengeable, and economically binding.*

This doc specifies the canonical on-chain schema for attestation claims used across VibeSwap: contribution attestations (existing), resume attestations (Gap #3 C43), and future scoring-oracle attestations. One schema, one verification path, many use cases.

## Why a schema matters

VibeSwap has multiple places where "someone signs something and it's on-chain":

- ContributionAttestor: "I attest that this user contributed X."
- CircuitBreaker resume (Gap #3): "I attest that the anomaly has cleared."
- SimilarityOracle (Gap #2): "I attest that this similarity score is correct."
- Future: reputation attestations, fairness scores, market-quality signals.

Without a shared schema, each use case reinvents the wheel: different signature formats, different field names, different verification logic. Bugs proliferate.

With a shared schema, verification is a single path. Each use case extends with domain-specific fields. Auditing becomes tractable.

## The schema, stated

```solidity
struct AttestationClaim {
    bytes32 claimId;          // Unique ID (e.g., keccak256(concatenation))
    uint256 version;          // Schema version (1 initially)
    bytes32 claimType;        // keccak256("contribution"|"resume"|"similarity"|...)
    address attestor;         // Who's signing
    address subject;          // Who/what this claim is about
    uint256 timestamp;        // Block timestamp of submission
    bytes32 subjectHash;      // Hash of subject-specific content
    bytes32 evidenceHash;     // Hash of evidence (IPFS/Arweave CID)
    uint256 bondAmount;       // Staked tokens (if bonded)
    uint8 verdict;            // 0=NEGATIVE, 1=POSITIVE, 2=DEFERRED, 3=OBSERVE
    bytes domainData;         // Claim-type-specific data
    bytes signature;          // attestor's signature over the above
}
```

## Field breakdown

### claimId

Unique identifier for the claim. Typically:

```solidity
claimId = keccak256(abi.encode(claimType, attestor, subject, timestamp, subjectHash));
```

Uniqueness prevents double-counting. Deterministic construction means the same claim data produces the same ID — useful for deduplication.

### version

Schema version number. Starts at 1. Incremented if the schema changes. Older versions continue to validate under their original rules.

Migration between versions: a contract adds a new version field while keeping old-version support. Clients can use whichever version they understand.

### claimType

Hash identifying the claim category. Examples:

```solidity
keccak256("contribution")  // ContributionAttestor
keccak256("resume")        // CircuitBreaker resume (Gap #3)
keccak256("similarity")    // SimilarityOracle (Gap #2)
keccak256("fairness")      // Future fairness scorer
```

The claim type routes verification to the right handler.

### attestor, subject

Two addresses:
- `attestor`: who's making the claim.
- `subject`: who/what the claim is about. Might be an address (for user attestations) or a bytes32 (for non-address subjects).

For resume claims, subject is the tripped breaker's address.
For contribution claims, subject is the contributor.

### timestamp

Block timestamp when the claim was submitted. Used for:
- Ordering (oldest claim first).
- Expiration (some claim types have time-to-live).
- Audit trails (when was this claim made?).

### subjectHash

Hash of subject-specific content. Examples:
- For a contribution claim: keccak256 of the contribution text.
- For a resume claim: keccak256 of the breaker's trigger-event hash.
- For a similarity claim: keccak256 of (C, S) — contribution and state.

The subject hash is the anchor tying the claim to specific data.

### evidenceHash

Hash of an evidence document (IPFS/Arweave CID). Evidence can be:
- The full contribution text (not just its hash).
- The reasoning document for a resume verdict.
- Intermediate embeddings for a similarity claim.

Evidence is optional for some claim types; mandatory for others. Required-evidence claim types must have a non-zero evidenceHash.

### bondAmount

Tokens staked as bond. Zero for unbonded claims. Non-zero for bonded claims that face slashing risk.

Per claim type, there's a minimum bond:
- Contribution: 0 (unbonded for now)
- Resume: minimum 1000 tokens (bonded)
- Similarity: minimum 500 tokens (bonded)
- Fairness: minimum 2000 tokens (bonded, high-stakes)

### verdict

Three-state enum:
- `POSITIVE` (1): affirmative claim (contribution is valid, resume is allowed, similarity is X).
- `NEGATIVE` (0): negative claim (contribution is invalid, resume is blocked).
- `DEFERRED` (2): attestor can't determine; defer to others.
- `OBSERVE` (3): attestor is observing/noting but not making a verdict.

Three-state (not just true/false) because some claim types need "I don't know." A 2-of-3 quorum might use DEFERRED as equivalent to abstaining.

### domainData

Claim-type-specific structured data, ABI-encoded. Examples:

- Contribution claim: `(string description, bytes32 contentHash, uint256 value)`
- Resume claim: `(bytes32 triggerHash, bytes32 reasoningCID, string verdict)`
- Similarity claim: `(uint256 similarityScaled, uint256 stateHash)`

The domainData is opaque to the base schema; each claim type decodes it according to its own structure.

### signature

attestor's ECDSA (or equivalent) signature over the rest of the claim. Signature is computed as:

```solidity
messageHash = keccak256(abi.encode(
    claimId, version, claimType, attestor, subject,
    timestamp, subjectHash, evidenceHash, bondAmount,
    verdict, domainData
));
signature = sign(messageHash, attestorKey);
```

Signature verification follows EIP-712 (typed structured data hashing).

## Verification flow

```solidity
function verifyClaim(AttestationClaim calldata claim) public pure returns (bool) {
    // 1. Check schema version
    require(claim.version == CURRENT_VERSION, "version mismatch");

    // 2. Check claim type is whitelisted
    require(whitelistedClaimTypes[claim.claimType], "unknown claim type");

    // 3. Recompute claim ID
    bytes32 expectedId = computeClaimId(
        claim.claimType, claim.attestor, claim.subject,
        claim.timestamp, claim.subjectHash
    );
    require(claim.claimId == expectedId, "claim ID mismatch");

    // 4. Verify signature
    bytes32 messageHash = hashClaim(claim);
    address recoveredSigner = ECDSA.recover(messageHash, claim.signature);
    require(recoveredSigner == claim.attestor, "bad signature");

    // 5. Check bond (if required)
    if (requiredBond[claim.claimType] > 0) {
        require(claim.bondAmount >= requiredBond[claim.claimType], "insufficient bond");
    }

    // 6. Delegate to claim-type handler for domain-specific checks
    IClaimHandler handler = claimHandlers[claim.claimType];
    require(handler.verifyDomain(claim), "domain check failed");

    return true;
}
```

Fast verification. All state transitions go through this one path.

## Storing claims

```solidity
mapping(bytes32 => AttestationClaim) public claims;
mapping(bytes32 => mapping(address => bytes32[])) public claimsByAttestorSubject;
mapping(bytes32 => bytes32[]) public claimsByType;
```

Indexed lookups:
- `claims[claimId]` → full claim.
- `claimsByAttestorSubject[claimType][subject]` → list of claim IDs.
- `claimsByType[claimType]` → all claims of a type.

Additional indexes can be added without schema changes (e.g., claims-by-attestor, claims-by-time).

## Extending with new claim types

To add a new claim type:

1. Define `claimType = keccak256("mynewtype")`.
2. Register in whitelist: `whitelistedClaimTypes[claimType] = true` (governance vote).
3. Define `domainData` structure for this type.
4. Implement `IClaimHandler` interface:
   ```solidity
   interface IClaimHandler {
       function verifyDomain(AttestationClaim calldata) external view returns (bool);
       function slashingLogic(AttestationClaim calldata, bool wasWrong) external;
   }
   ```
5. Register handler: `claimHandlers[claimType] = address(myHandler)` (governance vote).

New claim types don't modify the base schema — they extend via domainData + handler.

## Claim lifecycle

1. **Draft**: attestor prepares the claim off-chain.
2. **Signature**: attestor signs with their key.
3. **Submission**: claim + bond submitted on-chain; verifyClaim runs.
4. **Active**: claim is accepted; accessible via lookups.
5. **(Optional) Challenge**: another party challenges the claim; disputed-claim state.
6. **(Optional) Resolution**: governance or attested-resolution protocol decides.
7. **Slashing or vindication**: bond returned or burned based on outcome.
8. **Expiration**: some claim types have time-to-live; expired claims marked inactive.

## Bond & slashing

Bond amount scales with claim type's stakes:

- Low-stakes (contribution): 0 or minimal (reputation only).
- Medium-stakes (similarity): 500 tokens.
- High-stakes (resume, fairness): 1000-2000 tokens.

Slashing conditions:
- Claim was demonstrably wrong (governance-decided or automated check).
- Claim violated schema invariants (rare, usually caught at verification).

Slash amounts:
- First violation: 10% of bond.
- Repeated: 25%, 50%, 100%.
- Egregious (e.g., coordinated with gaming): 100% + removal from attestor pool.

Burned tokens go to protocol treasury or a "security bounty" pool incentivizing challengers.

## Student exercises

1. **Design a claim type.** Suppose you want to add a "code-review-approval" claim type. Specify:
   - The `domainData` structure.
   - Verification logic.
   - Required bond.
   - Slashing conditions.

2. **Verify a claim by hand.** Given an AttestationClaim's fields, compute:
   - Expected claim ID.
   - Message hash for signature.

3. **Challenge a claim.** A claim has been submitted. You believe it's wrong. Write the challenge message (referencing claim ID + reasoning).

4. **Slashing edge case.** A similarity attestor's claim is 99% similar to what would be "correct" but 1% off. Should they be slashed? What does the schema say? What should the schema say?

5. **Schema migration.** You need to add a new field to the schema. Describe the migration path from v1 to v2.

## Security considerations

- **Replay attacks**: without nonce + chain ID, a signature could be replayed across chains. EIP-712 domain separator prevents this (includes chain ID + contract address).
- **Signature malleability**: use canonical signature form (e.g., OpenZeppelin's ECDSA.recover with S-value check).
- **Front-running**: attestors can be front-run if their submission is visible before inclusion. Mitigation: private mempool submissions for high-stakes claims.
- **Sybil attacks**: multiple accounts acting as one attestor. Mitigation: attestor certification (see [`SOULBOUND_IDENTITY.md`](./SOULBOUND_IDENTITY.md) if it exists, or certification-via-governance).
- **Bond drainage**: an attestor could exhaust their bond by rapid wrong attestations. Mitigation: rate-limit attestations per attestor; require fresh bond after slashing events.

## Integration with Gap #3 (Attested Resume)

Gap #3 C43 uses claim type `keccak256("resume")`:

- `subject`: address of the tripped CircuitBreaker.
- `subjectHash`: hash of the trigger event.
- `evidenceHash`: IPFS CID of reasoning document.
- `verdict`: POSITIVE (resume OK) / NEGATIVE (stay paused) / DEFERRED (need more info).
- `domainData`: `(uint256 cooldownEndTime, bytes32 breakerTriggerHash)`.

Required bond: 1000 tokens.
M-of-N quorum: 2 of 3 POSITIVE claims needed for resume.

## Integration with Gap #2 (SimilarityOracle)

Gap #2 C42 uses claim type `keccak256("similarity")`:

- `subject`: contribution address.
- `subjectHash`: keccak256 of (contribution text + state at arrival).
- `evidenceHash`: IPFS CID of embedding.
- `verdict`: always POSITIVE (similarity is a measurement, not a verdict).
- `domainData`: `(uint256 similarityScaled, bytes32 functionCommitment)`.

Required bond: 500 tokens.
Commitment reference ties this claim to a specific similarity function (see [`COMMIT_REVEAL_FOR_ORACLES.md`](./COMMIT_REVEAL_FOR_ORACLES.md)).

## Future work — concrete code cycles

### Queued as part of C42 + C43

- **AttestationClaim base struct** — shared across Gap #2 and #3. File: `contracts/identity/AttestationClaim.sol`.
- **verifyClaim function** — shared verification path. File: `contracts/identity/AttestationVerifier.sol`.
- **ContributionAttestor refactor** — migrate existing claims to new schema. File: `contracts/identity/ContributionAttestor.sol` (backwards-compat preserved via versioning).

### Queued for un-scheduled cycles

- **Code-review attestations** — apply schema to PR approvals.
- **Security audit attestations** — formalize auditor claims.
- **Reputation scores** — ongoing aggregation of claim outcomes.

### Primitive extraction

If 5+ claim types live under the schema, extract to `memory/primitive_attestation-schema.md` as a design-gate: new signing-based mechanisms use the schema rather than rolling their own.

## Relationship to other primitives

- **Attested Resume** (see [`ATTESTED_RESUME.md`](./ATTESTED_RESUME.md)) — Gap #3, uses `resume` claim type.
- **Similarity Keeper Design** (see [`SIMILARITY_KEEPER_DESIGN.md`](./SIMILARITY_KEEPER_DESIGN.md)) — Gap #2, uses `similarity` claim type.
- **Commit-Reveal for Oracles** (see [`COMMIT_REVEAL_FOR_ORACLES.md`](./COMMIT_REVEAL_FOR_ORACLES.md)) — similarity claims reference committed functions.
- **Contribution DAG Explainer** — uses existing contribution claim type, migrates to this schema.
- **Augmented Governance** — claim verification is math-enforced; claim semantics are governance-controlled.

## How this doc feeds the Code↔Text Inspiration Loop

This doc:
1. Specifies the shared schema for all VibeSwap attestations.
2. Walks integration with Gap #2 and Gap #3.
3. Queues refactor cycles for existing ContributionAttestor to use the schema.
4. Opens future-type directions (code-review, security-audit, reputation).

When Gap #2 and Gap #3 ship, this doc gets "shipped" sections with commit pointers for each claim type implementation.

## One-line summary

*Attestation Claim Schema is the canonical on-chain structure for VibeSwap signed claims: claimId, version, claimType, attestor, subject, timestamp, subjectHash, evidenceHash, bondAmount, verdict, domainData, signature. Used by ContributionAttestor (existing), resume claims (Gap #3 C43), similarity claims (Gap #2 C42), and future claim types. One schema, one verification path, domain-specific extension via domainData.*
