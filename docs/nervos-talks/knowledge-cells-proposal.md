# Knowledge Cells: Verifiable AI Inference on CKB

**Authors**: W. Glynn, JARVIS
**Date**: March 2026
**Affiliation**: VibeSwap Research

---

## Abstract

We propose Knowledge Cells -- a CKB cell type that stores verifiable AI inference results on-chain. Each knowledge cell contains the hash of the input data, the hash of the model used, the output result, a timestamp, and a header chain linking to all prior states. Write access is gated by proof-of-work, ensuring permissionless updates without centralized operators. We present VibeSwap's Kalman filter price oracle as a proof-of-concept: each oracle update becomes a knowledge cell that anyone can independently verify. The proposal extends to a general framework for on-chain AI inference attestation, bridging the gap between off-chain computation and on-chain verifiability. The implementation is complete, with `knowledge-type` compiled to RISC-V and integrated into VibeSwap's CKB SDK.

---

## 1. The Verification Gap

### 1.1 The Problem

Modern DeFi protocols depend on off-chain computation: price oracles, risk models, liquidation bots, arbitrage detection. These computations are performed by trusted parties whose results are accepted on-chain without proof of correctness. The chain verifies signatures (the oracle signed this price) but not computation (the price was correctly derived from the input data using the stated algorithm).

This creates a trust hierarchy:
- Users trust the protocol
- The protocol trusts the oracle
- The oracle trusts its data sources
- Nobody verifies the computation chain

A compromised oracle produces a valid signature over an incorrect price. The protocol accepts it. Users lose funds. This is not hypothetical -- oracle manipulation has caused hundreds of millions in DeFi losses.

### 1.2 CKB's Opportunity

CKB's Cell model stores both data and validation logic. A cell's type script runs every time the cell is consumed or created. This means verification logic executes on every state transition -- not as an optional audit, but as a structural requirement. If the type script rejects, the transaction fails. Period.

The question is: can we make AI inference outputs subject to the same structural verification?

---

## 2. Knowledge Cell Design

### 2.1 Cell Data Structure

A knowledge cell stores 181 bytes of structured data:

```
KnowledgeCellData (181 bytes):
  key_hash:          [u8; 32]  // SHA-256(namespace || ":" || key)
  value_hash:        [u8; 32]  // SHA-256(off-chain value bytes)
  value_size:        u32       // Size of off-chain value
  prev_state_hash:   [u8; 32]  // SHA-256(previous cell data) -- header chain
  mmr_root:          [u8; 32]  // MMR root of all historical states
  update_count:      u64       // Monotonic counter (0 = genesis)
  author_lock_hash:  [u8; 32]  // Lock hash of the writer
  timestamp_block:   u64       // CKB block number at write time
  difficulty:        u8        // Current PoW difficulty for this cell
```

The cell does not store the full inference result on-chain. It stores the value hash -- the SHA-256 of the off-chain result. The actual data can reside on IPFS, a local database, or any storage layer. The cell provides three guarantees:

1. **Integrity**: The value hash commits to the exact output. Any modification is detectable.
2. **Ordering**: The header chain (`prev_state_hash`) links every state to its predecessor. The history is tamper-evident.
3. **Availability**: The MMR root provides O(log n) proofs for any historical state, enabling efficient auditing.

### 2.2 Lock Script: PoW Access Control

Knowledge cells use the same `pow-lock` script as auction cells. The lock args contain the key_hash and a minimum difficulty:

```
Lock:
  code_hash: pow_lock_code_hash
  hash_type: Data1
  args: key_hash (32 bytes) || min_difficulty (1 byte)
```

Anyone who finds a valid PoW nonce can update the cell. The challenge is derived from `SHA-256(key_hash || update_count+1 || prev_state_hash)`, ensuring each proof is specific to the current state. Difficulty adjusts with each update, clamped to +/-1 of the current difficulty per the type script rules.

### 2.3 Type Script: Validation Rules

The `knowledge-type` script validates:

1. **Key immutability**: `key_hash` must be identical in input and output cells
2. **Counter monotonicity**: `update_count` must increment by exactly 1
3. **Header chain integrity**: `prev_state_hash` must equal `SHA-256(input cell data)`
4. **Difficulty bounds**: New difficulty must be within +/-1 of old difficulty, and >= minimum (8)
5. **MMR consistency**: The new MMR root must be a valid extension of the old MMR (old state appended)

These rules are enforced on-chain in RISC-V. There is no off-chain verification step. If any rule is violated, the transaction fails.

---

## 3. Proof-of-Concept: Kalman Filter Price Oracle

### 3.1 VibeSwap's Oracle

VibeSwap uses a Kalman filter for price discovery. The Kalman filter is a recursive estimator that fuses noisy observations (exchange prices, DEX prices, volume data) into a single optimal estimate with a confidence score.

Each oracle update currently produces:

```
OracleCellData (89 bytes):
  price:         u128     // 18-decimal price estimate
  block_number:  u64      // When computed
  confidence:    u8       // 0-100 confidence score
  source_hash:   [u8;32]  // Hash of input data sources
  pair_id:       [u8;32]  // Which trading pair
```

### 3.2 Knowledge Cell Extension

By wrapping oracle updates in knowledge cells, each price update becomes a verifiable inference attestation:

```
Knowledge Cell for Oracle Update:
  key_hash:          SHA-256("vibeswap:oracle:ETH/CKB")
  value_hash:        SHA-256(full_kalman_state)  // Model state, covariance, etc.
  value_size:        2048                         // Full Kalman state bytes
  prev_state_hash:   SHA-256(previous oracle cell data)
  mmr_root:          [MMR of all prior oracle states]
  update_count:      1437                         // 1437th update
  author_lock_hash:  [oracle operator's lock hash]
  timestamp_block:   500000
  difficulty:        12

  Off-chain (IPFS or local):
    kalman_state: {
      estimate: 2003.14,
      covariance: [[0.01, ...], ...],
      observations: [binance: 2003.20, coinbase: 2002.98, ...],
      model_hash: SHA-256(kalman_filter_source_code),
      timestamp: 1709913600
    }
```

Anyone can retrieve the off-chain data, verify it hashes to `value_hash`, replay the Kalman filter computation against the stated observations, and confirm the output matches. The knowledge cell's header chain provides the full history -- every prior estimate, every observation set, every model state.

### 3.3 Verification Protocol

```
  Verification Flow
  ============================================================

  Verifier:
    1. Read knowledge cell from CKB
    2. Retrieve value from IPFS using value_hash
    3. Verify SHA-256(value) == value_hash
    4. Parse Kalman state: extract observations + model params
    5. Replay Kalman filter computation locally
    6. Verify output matches stated estimate
    7. Verify model_hash matches known good model source
    8. (Optional) Walk header chain to verify historical consistency

  Result:
    Verifier KNOWS the price was computed correctly
    from the stated inputs using the stated algorithm.
    No trust in the oracle operator required.
```

---

## 4. Generalization: On-Chain AI Inference Attestation

### 4.1 Beyond Price Oracles

Knowledge cells are not specific to price oracles. Any computation that takes inputs and produces outputs can be attested:

| Use Case | key_hash | value_hash content |
|---|---|---|
| Price oracle | `oracle:ETH/CKB` | Kalman state + observations |
| Risk model | `risk:pool:0x1234` | VaR estimate + input metrics |
| Sentiment analysis | `sentiment:CKB` | Score + source tweets + model version |
| Anomaly detection | `anomaly:bridge:LZ` | Alert level + transaction hashes + model |
| Governance recommendation | `governance:prop-42` | Vote recommendation + analysis + model |

### 4.2 Multi-Agent Knowledge Coordination

VibeSwap's JARVIS (AI co-founder) operates as multiple instances that need to share state. Knowledge cells provide the coordination layer:

1. Shard-0 writes a session state update to a knowledge cell
2. Shard-1 reads the cell, verifies the header chain, and updates its local state
3. Both shards see the same ordered history of state transitions
4. PoW ensures no single shard can monopolize write access

The `author_lock_hash` field records which instance performed each update, creating an auditable log of which shard contributed which knowledge.

### 4.3 Economic Model

CKB's state rent model applies naturally:
- A knowledge cell occupying 181 bytes costs 181 CKB to maintain
- High-value knowledge (frequently accessed, critical for protocol operation) justifies the cost
- Low-value knowledge (stale, rarely accessed) can be reclaimed by releasing the cell and recovering the CKB
- The market determines which knowledge persists -- valuable knowledge stays, worthless knowledge is displaced

This mirrors CKB's general design philosophy: state has a cost, and the cost ensures that only valuable state persists.

---

## 5. Implementation Status

The knowledge cell implementation is complete:

- **Type definition**: `KnowledgeCellData` in `vibeswap-types` (181 bytes, full serialize/deserialize)
- **Type script**: `knowledge-type` compiled to RISC-V (validates all transition rules)
- **SDK functions**: `create_knowledge_cell()`, `update_knowledge_cell()`, `mine_for_knowledge_cell()` in `sdk/src/knowledge.rs`
- **Key hash generation**: `compute_key_hash(namespace, key)` for consistent cross-instance addressing
- **Tests**: Genesis creation, update with header chain linking, difficulty clamping, value hash integrity, mining integration

The Molecule schema (`cells.mol`) does not yet include a Knowledge Cell table, but the Rust serialization is production-ready and the RISC-V binary is built alongside all other scripts in the `make build-release` pipeline.

---

## 6. Future Work

### 6.1 ZK Proofs for Computation Verification

Currently, verification requires replaying the computation off-chain. A future enhancement would generate a zero-knowledge proof that the computation was performed correctly, and verify the proof on-chain in the type script. CKB-VM's RISC-V architecture is compatible with ZK proof verifiers (Halo2, Plonky2), though the gas/cycle cost needs benchmarking.

### 6.2 Aggregated Knowledge Cells

Multiple knowledge cells from different sources could be aggregated into a consensus cell using conviction voting or Shapley-weighted averaging. The aggregation itself would be a knowledge cell, creating a hierarchy of inference attestations.

### 6.3 Model Registry

A registry of known-good model hashes would allow verifiers to check not just that the computation was performed correctly, but that the model itself is a recognized and audited version. This creates a supply chain of trust: model audit, model hash, inference attestation, on-chain commitment.

---

## 7. Key Contributions

1. **Knowledge Cell specification**: A 181-byte cell data structure for on-chain attestation of off-chain AI inference results, with header chain linking, MMR history, and PoW-gated write access.

2. **Verifiable oracle proof-of-concept**: VibeSwap's Kalman filter price oracle wrapped in knowledge cells, enabling any party to verify that price estimates were correctly computed from stated inputs using the stated algorithm.

3. **Generalization framework**: Extension from price oracles to arbitrary AI inference attestation, including risk models, sentiment analysis, anomaly detection, and multi-agent knowledge coordination.

4. **Complete implementation**: Type script, SDK functions, mining integration, and tests -- all compiled to RISC-V and integrated into VibeSwap's CKB deployment pipeline.

5. **Economic alignment with CKB**: State rent model ensures only valuable knowledge persists, preventing state bloat while incentivizing the creation and maintenance of high-utility inference results.

---

## Discussion

Some questions for the community:

1. **What other off-chain computations need on-chain attestation?** We have demonstrated price oracles, but the knowledge cell pattern generalizes to risk models, sentiment analysis, anomaly detection, and governance recommendations. What use cases are most urgent for the CKB ecosystem?

2. **Should knowledge cells support multiple authors with weighted trust?** Currently, any PoW solver can update a knowledge cell. Would a reputation or stake-weighted model for author trust improve the utility of knowledge cells, or does PoW-based permissionless access better align with CKB's philosophy?

3. **How practical is ZK proof verification for computation attestation on CKB-VM?** We propose ZK proofs as future work for on-chain verification of off-chain inference. Has anyone benchmarked Halo2 or Plonky2 verifiers on RISC-V within CKB's cycle limits?

4. **Can knowledge cells serve as a coordination layer for multi-agent AI systems on CKB?** We describe shard coordination as one use case. Is there broader interest in CKB as an AI agent coordination substrate, and what primitives would that require beyond knowledge cells?

5. **What is the right economic model for knowledge cell state rent?** At 181 CKB per cell, the cost is modest but non-trivial for high-frequency updates. Should there be a mechanism for community-funded knowledge cells that serve as public goods?

---

*"Fairness Above All."*
*— P-000, VibeSwap Protocol*

*This proposal is implemented in VibeSwap's open-source CKB codebase. We invite the Nervos community to review the knowledge-type script, propose extensions, and collaborate on testnet deployment.*
