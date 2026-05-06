# DePIN Subsystem — Architecture Overview

**Status**: shipped
**Subsystem**: `contracts/depin/`
**Companions**: [`AMM_OVERVIEW.md`](./AMM_OVERVIEW.md), [`CONSENSUS_OVERVIEW.md`](./CONSENSUS_OVERVIEW.md), [`COGPROOF_INTEGRATION.md`](./COGPROOF_INTEGRATION.md)

---

## What this subsystem does

Decentralized Physical Infrastructure Network (DePIN) substrate for VibeSwap. Four contracts, each closing a different category of off-chain-physical-asset → on-chain-economy bridge:

- **VibeDeviceNetwork** — IoT device registry + coordination (RFID, cameras, sensors, robots, phones, AI compute, gateways).
- **VibeInfoFi** — Common Knowledge Base (CKB) primitives, knowledge markets, Shapley attribution.
- **VibeMedicalVault** — privacy-preserving health-data sharing with patient sovereignty.
- **VibePrivateCompute** — zero-knowledge + homomorphic compute over encrypted data.

The unifying property: each contract takes a class of off-chain physical or informational asset and gives it on-chain identity, economic agency, and verifiable participation in protocol incentives — without surrendering the asset's privacy or sovereignty constraints.

## File map

```
contracts/depin/
├── VibeDeviceNetwork.sol      ← IoT registry + heartbeat + Shapley-weighted rewards
├── VibeInfoFi.sol             ← knowledge primitives + contribution DAG + Shapley attribution
├── VibeMedicalVault.sol       ← patient-controlled encrypted records + consent + ZK eligibility
└── VibePrivateCompute.sol     ← TEE-executed computation + ZK proofs + homomorphic aggregation
```

## Per-contract role

### VibeDeviceNetwork — physical-device economy

Registers IoT devices to the protocol with:

- Hardware attestation (TEE / Secure Element) bound to device identity.
- Device-type taxonomy: RFID, CAMERA, SENSOR, ROBOT, PHONE, AI_COMPUTE, GATEWAY, MEDICAL, VEHICLE.
- Stake requirement to participate (slashable on misbehavior).
- Heartbeat timeout for liveness — silent devices lose reputation.
- Shapley-weighted reward distribution for data contributions.
- Firmware verification via on-chain hash registry (catches tampered firmware).
- Fleet-management primitives for enterprise operators (one operator, many devices).

The economic shape: a physical device participating in VibeSwap has stake at risk, an attested identity, and Shapley-weighted earnings proportional to its contribution. Sybil-spawned phantom devices have marginal contribution = 0 by the [Shapley null-player axiom](../research/papers/airgap-problem-onepager.md), so spawning more devices doesn't extract more — it just adds more stake at zero yield.

### VibeInfoFi — knowledge as a first-class asset

The ORIGINAL information-finance architecture, not a derivative bond-market wrapper. Treats information as intrinsically valuable, non-fungible, composable:

- **Knowledge Primitives**: atomic units of verified insight, hashed and timestamped.
- **Contribution DAG**: tracks who contributed which primitive, who built on which prior, when.
- **Shapley Attribution**: fair value distribution across contributors when downstream insights compose upstream primitives.
- **Knowledge Markets**: price discovery for information value through commit-reveal auctions on access.
- **Temporal Anchoring**: knowledge claims bound to time of contribution — prevents retroactive credit-stealing.
- **Composability**: primitives compose into higher-order insights without losing attribution.

The thesis: information is *not* a fungible commodity to be financialized via securitization. It's a fundamental asset class deserving its own primitives. Pricing emerges from market discovery, attribution from Shapley axioms, composition from the DAG structure. Derivative InfoFi proposals that bond-wrap information violate the asset's structural shape.

### VibeMedicalVault — patient sovereignty over health data

HIPAA-grade architecture where patients own their medical records and researchers access aggregate insights:

- **Patient-controlled encrypted records**: storage layer is opaque to anyone without patient consent.
- **Granular consent management**: per-provider, per-study, per-datatype permissions. A patient can grant access to one study's eligibility check without exposing the full record.
- **ZK-verified eligibility**: prove "age > 18", "no prior cardiac event", or "BMI in range" without revealing the underlying value.
- **Homomorphic aggregation**: clinical trials run statistical operations over encrypted records without ever decrypting them.
- **Audit trail**: every access logged with who / what / when / why. Patients can audit their own data.
- **Emergency access**: time-limited break-glass access by attested first-responder identity, with post-hoc justification required.
- **GDPR right-to-delete**: re-encryption key rotation makes prior data permanently unreadable, satisfying the deletion requirement without modifying immutable storage.

The structural property: data sovereignty is enforced cryptographically, not contractually. A researcher cannot exfiltrate raw data even with database access; the keys are patient-held.

### VibePrivateCompute — compute on data without seeing it

The TEE + ZK + HE hybrid compute layer:

- **Data owners** register encrypted datasets to the network with allowed-computation policies.
- **Compute requesters** submit computation requests against registered datasets.
- **TEE nodes** execute the computation inside secure enclaves; the data is never decrypted outside the enclave.
- **ZK proofs** attest that the computation was the requested one, executed correctly, on the registered data.
- **Homomorphic encryption** handles statistical aggregations (sums, means, distributions) without decryption.

Use cases: medical records analysis without exposing patient data, financial analytics without revealing positions, AI model training on private datasets, supply-chain verification without revealing suppliers.

## Composition with the broader stack

Each DePIN contract uses primitives from elsewhere in VibeSwap:

| DePIN contract | Uses | For |
|----------------|------|-----|
| VibeDeviceNetwork | `ShapleyDistributor` | reward attribution |
| VibeDeviceNetwork | `BehavioralReputation` (CogProof) | device reputation tier |
| VibeInfoFi | `ShapleyDistributor` | contribution attribution |
| VibeInfoFi | `CommitRevealAuction` | knowledge-market pricing |
| VibeMedicalVault | ZK verifier (external) | eligibility proofs |
| VibePrivateCompute | TEE attestation registry | enclave verification |

The pattern: DePIN contracts define the *substrate-bridge logic* (device → on-chain identity, knowledge → primitive, record → encrypted blob). Underlying economic and verification primitives come from the rest of VibeSwap.

## Configurability

| Variable | Default | Notes |
|----------|---------|-------|
| `deviceStake` | configurable | minimum stake per device registration |
| `heartbeatTimeout` | configurable | seconds before a silent device loses liveness reputation |
| consent expiration windows | per-grant | patients set in `VibeMedicalVault` |
| TEE attestation registry | settable | `VibePrivateCompute` admin-curated allowlist |

All four contracts are UUPS upgradeable with `_authorizeUpgrade(onlyOwner)`. Heartbeat / stake / window parameters live in storage; consent parameters live per-grant.

## Why these four and not more

The DePIN substrate covers four distinct classes:

1. **Physical device participation** (VibeDeviceNetwork) — closes the on-chain-identity gap for IoT.
2. **Information as an asset class** (VibeInfoFi) — closes the attribution gap for knowledge contributions.
3. **Privacy-preserving health data** (VibeMedicalVault) — closes the sovereignty gap for sensitive personal data.
4. **Verifiable private computation** (VibePrivateCompute) — closes the compute-without-disclosure gap.

Each closes a different airgap between physical/informational reality and on-chain economy. Adding a fifth contract requires identifying a fifth class of unclosed gap; the current four span the design space the seed papers anchor.

## Related

- [`AIRGAP_PROBLEM_ONEPAGER`](../research/papers/airgap-problem-onepager.md) — substrate-level framing.
- [`COGPROOF_INTEGRATION`](./COGPROOF_INTEGRATION.md) — reputation-tier integration.
- `contracts/incentives/ShapleyDistributor.sol` — fairness primitive.
- `contracts/identity/ContributionAttestor.sol` — sibling: contribution attribution at the identity layer.
