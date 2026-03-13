# AGI-Resistant Wallet Recovery: What Happens When the Attacker Is Smarter Than You?

*Nervos Talks Post -- W. Glynn (Faraday1)*
*March 2026*

---

## TL;DR

Every wallet recovery mechanism in crypto today -- social recovery, MPC, custodial backup, seed phrases -- was designed against human attackers. We built the first recovery system explicitly threat-modeled against AGI: an adversary with arbitrary computation, superhuman social engineering, and infinite patience. Five independent recovery layers, each hardened against a different AGI attack vector. CKB's cell model turns out to be the ideal substrate because each layer maps to an independent cell with its own lock script. Layer independence becomes structural, not contractual.

---

## The Problem Nobody Wants to Talk About

Here is the uncomfortable question: **what happens to wallet recovery when the attacker can deepfake your mother's voice, generate forged legal documents in seconds, and sustain a social engineering campaign against your five guardians simultaneously for months?**

Social recovery (Argent-style) assumes your guardians can distinguish real requests from fake ones. MPC threshold schemes assume the key-share holders are not all compromised. Custodial recovery assumes the custodian's KYC process cannot be fooled by synthetic documents. Seed phrase backup assumes nobody finds your piece of paper.

None of these hold against AGI.

We know because we built VibeSwap's identity system (60 contracts, 1,612+ commits, $0 funding) and kept asking: "What breaks this if the attacker is not a human hacker, but an intelligence with no computational ceiling?"

Everything broke. So we rebuilt it from scratch.

---

## The Five Layers

Our `WalletRecovery.sol` (775 lines) and `AGIResistantRecovery.sol` (525 lines) implement five independent recovery methods. Each exploits a different domain that AGI cannot dominate:

### Layer 1: Guardian Recovery (Social Domain)

Pre-designate 1-10 trusted humans. A configurable threshold (e.g., 3-of-5) must approve recovery.

**Why AGI struggles here:** The defense is not the threshold math -- it is that guardians are *real people with real relationships*. When "Mom" gets a recovery request, she calls her child. That phone call is outside the digital attack surface. An AGI would need to simultaneously social-engineer multiple independent humans who personally know the wallet owner, while also suppressing the owner's notifications across all channels for 24 hours.

Constants from contract:
- `MIN_GUARDIANS = 1`, `MAX_GUARDIANS = 10`
- Each guardian has a human-readable label ("Mom", "Lawyer", etc.)
- 24-hour notification delay before execution

### Layer 2: Timelock Recovery (Temporal Domain)

Anyone can initiate recovery by posting a 1 ETH bond. The recovery cannot execute for 1-30 days (configurable) plus a mandatory 24-hour notification delay.

**Why AGI struggles here:** Computation cannot accelerate physical time. An AGI can initiate recovery in milliseconds, but it cannot make 8 days pass faster. The owner receives multi-channel notifications (on-chain events trigger email, SMS, push, Telegram alerts) and has the entire timelock period to cancel and claim the attacker's bond.

Constants:
- `RECOVERY_BOND = 1 ether`
- `MIN_TIMELOCK = 1 day`, `MAX_TIMELOCK = 30 days`
- `NOTIFICATION_DELAY = 24 hours`
- `MAX_RECOVERY_ATTEMPTS = 3`, `ATTEMPT_COOLDOWN = 7 days`

**The economics are punishing.** Three failed attempts = 3 ETH burned, 21 days wasted, permanent lockout. The bond is slashed to the owner (if they cancel) or split between reporter and treasury (if a guardian reports fraud).

### Layer 3: Dead Man's Switch (Physical Domain)

Configure a timeout (minimum 30 days, default 1 year) and a beneficiary. If the owner makes no on-chain transaction for the full timeout period, the beneficiary can claim recovery.

**Why AGI struggles here:** This is the inverse attack -- to exploit the dead man's switch, the AGI must *prevent* the owner from making any transaction for 30-365 days. That requires physical-world control over the owner (effectively imprisonment). Any single transaction resets the timer. This is a computationally irreducible defense.

Constants:
- `MIN_DEADMAN = 30 days`
- Activity tracked by `SoulboundIdentity` contract on every interaction

### Layer 4: Arbitration Recovery (Judicial Domain)

Submit evidence (IPFS-hosted identity documents, transaction history, etc.) and a stake. A panel of 5 randomly selected jurors reviews the case and votes. Simple majority decides. 7-day review period.

**Why AGI struggles here:** Jurors are economically staked humans (0.1 ETH each) selected pseudo-randomly from a pool. The AGI would need to either Sybil-attack the juror pool (expensive -- must control >50% of staked jurors) or generate synthetic evidence convincing enough to fool 3 of 5 adversarial human evaluators. The system supports live video verification challenges where jurors ask unprompted questions.

Constants:
- `JURORS_PER_CASE = 5`
- `JUROR_STAKE = 0.1 ether`
- `ARBITRATION_PERIOD = 7 days`

### Layer 5: Quantum Backup (Cryptographic Domain)

Pre-generate a Lamport signature key pair offline. Store the Merkle root on-chain. Recovery is immediate upon presenting a valid Lamport signature with Merkle proof.

**Why AGI struggles here:** Lamport signatures are hash-based -- security reduces to hash preimage resistance, not discrete log or factoring. Shor's algorithm (quantum) does not help. The private key is generated on an air-gapped machine and stored physically (steel plate, safe deposit box). To exploit this, an AGI must physically steal the backup AND break keccak256.

```solidity
bytes32 message = keccak256(abi.encodePacked(tokenId, newOwner, "RECOVER"));
bytes32 quantumRoot = configs[tokenId].quantumBackupHash;
bytes32 sigHash = keccak256(signature);
bytes32 leaf = keccak256(abi.encodePacked(sigHash, message));
// Verify merkle proof against stored root
```

---

## Cross-Cutting Defenses

Every recovery path must also pass through these gauntlets:

**Behavioral Fingerprinting.** The `AGIResistantRecovery` contract tracks on-chain behavior over time: first-seen timestamp, transaction count, timing patterns, interaction graph, gas price habits, total value transferred. Recovery requesters must score at least 50/100 on a behavioral match. An AGI cannot fabricate years of consistent on-chain history retroactively.

**Suspicious Activity Detection.** Automated heuristics catch AGI-characteristic patterns: machine-precision timestamps, accounts younger than 30 days, insufficient transaction history (<10 txs), rapid retry patterns. Flagged requests are blocked before they start.

**Humanity Proof System.** Eight proof types, each with weighted confidence scores:

| Proof Type | Weight | Why AGI-Resistant |
|-----------|--------|-------------------|
| Hardware Key (YubiKey/Ledger) | 30 | Physical possession required |
| Notarized Document | 40 | In-person verification by legal notary |
| Video Verification | 35 | Live video, random prompts, adversarial evaluators |
| Physical Mail Code | 25 | Postal delivery to physical address |
| Biometric Hash | 20 | On-device biometric (never stored raw) |
| Social Vouching (3+ humans) | 25 | Physical co-location required |
| Proof of Location | 15 | Physical presence verification |
| Historical Knowledge | 30 | Questions only original owner knows |

---

## Why Layer Independence Matters

The critical insight: **compromising one layer does not help with any other layer.** They operate in orthogonal domains.

If you deepfake past all guardians -- the timelock still runs. If you suppress notifications for the timelock period -- the jurors still vote independently. If you Sybil the juror pool -- you still cannot fake the Lamport key. If you steal the Lamport backup -- you still need to pass behavioral verification.

For a full compromise, an AGI must simultaneously:
1. Social-engineer a threshold of guardians
2. Suppress all notification channels for days
3. Physically isolate the owner for months
4. Control a majority of staked jurors
5. Steal a physical backup from a vault

The probability of this conjunction is the product of five independent probabilities, each in a different domain. Defense-in-depth across orthogonal attack surfaces.

---

## Why CKB Is the Right Substrate

This is why we are posting on Nervos Talks and not just an Ethereum forum.

On EVM, all five recovery layers live in one contract's storage. Guardian data, timelock state, deadman timestamps, arbitration cases, quantum roots -- all coupled in the same contract. Upgrading one layer risks all others. Layer independence is a *convention* we enforce through careful engineering.

**On CKB, layer independence is structural.**

| Recovery Layer | CKB Cell | Lock Script |
|---------------|----------|-------------|
| Guardian Registry | Guardian Cell | Owner signature to modify |
| Pending Recovery | Recovery Cell | Since (consensus-enforced timelock) |
| Activity Tracker | Activity Cell | Owner OR beneficiary (after timeout) |
| Arbitration Case | Evidence + Vote Cells | 3/5 juror co-signatures |
| Quantum Backup | Quantum Root Cell | Lamport signature verification in type script |

Three specific advantages:

**1. Timelocks as lock scripts, not conditionals.** On EVM: `require(block.timestamp >= unlockTime)` inside a function. On CKB: the `Since` field is a consensus-level temporal constraint. The timelock is enforced *before the transaction is valid*. No contract logic can bypass it because validation happens at a layer below contract execution.

**2. Atomic cross-layer verification.** A CKB transaction can consume cells from the guardian registry, the activity tracker, and the notification delay cell simultaneously -- each verified independently by its own type script. No delegatecall, no proxy patterns, no re-entrancy risk from cross-contract calls.

**3. Indexer-powered behavioral fingerprinting.** CKB's indexer can query all cells associated with a lock script hash in O(1). Transaction count, interaction graph, timing patterns -- all derivable from indexed cell data without iterating Solidity storage mappings.

The cell model does not just accommodate the five-layer architecture. It *is* the five-layer architecture. Each cell is independently verifiable, independently upgradeable, and independently secure.

---

## The AGI Adversary Is Not Hypothetical

We are not building for a theoretical future. As of March 2026, we have:

- LLMs that can generate convincing impersonation text across multiple communication channels
- Voice synthesis that can clone a voice from a 3-second sample
- Video deepfakes that pass casual visual inspection
- AI agents that can autonomously navigate web interfaces, fill out forms, and submit transactions
- Automated social engineering tools that can sustain multi-week campaigns

The gap between "current AI capability" and "break existing wallet recovery" is narrowing. Social recovery was designed when the hardest part of impersonation was matching someone's writing style. Today, that is trivial.

We are not claiming our system is invulnerable. We are claiming it is the first system where each defense layer is explicitly designed around what AGI *cannot* do rather than what it *can*.

---

## What We Would Like to Build on CKB

1. **Reference implementation of 5-layer recovery as independent CKB cells.** The Solidity contracts are live. We want to port them to CKB type scripts where layer independence is structural.

2. **Behavioral fingerprinting using CKB indexer.** On-chain behavior analysis without contract storage iteration. The indexer makes this natural.

3. **Since-based temporal defenses.** Notification delays and timelock recovery using CKB's native `Since` temporal constraints rather than Solidity timestamp checks.

4. **Lamport signature verification as a CKB lock script.** Post-quantum recovery as a first-class citizen in the CKB scripting model.

---

## Discussion

Questions for the Nervos community:

1. **Has anyone implemented Lamport signature verification as a CKB lock script?** We have the Merkle proof verification in Solidity. Porting to RISC-V for CKB should be straightforward but we would like to know if prior art exists.

2. **What is the most efficient way to implement behavioral fingerprinting on CKB?** Our EVM approach uses storage mappings updated by trusted verifiers. On CKB, should fingerprint data live in cell data fields with a type script that validates updates?

3. **How should juror selection randomness work on CKB?** We use `block.prevrandao` on EVM (with plans for Chainlink VRF on mainnet). What is the CKB-native approach to verifiable randomness?

4. **Are there CKB-native recovery patterns** that exploit the cell model in ways that have no EVM equivalent? The Since timelock is one. What else?

The formal paper is in our repo: `docs/papers/agi-resistant-recovery.md`

---

*"Your keys, your bitcoin. Not your keys, not your bitcoin. And if an AGI wants your keys, it had better be prepared to physically knock on your door."*

*"Fairness Above All."*
*-- P-000, VibeSwap Protocol*

*Full paper: [agi-resistant-recovery.md](https://github.com/wglynn/vibeswap/blob/master/docs/papers/agi-resistant-recovery.md)*
*Code: [github.com/wglynn/vibeswap](https://github.com/wglynn/vibeswap)*
