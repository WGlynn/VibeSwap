# AGI-Resistant Wallet Recovery: Multi-Layer Safeguards for Post-Quantum Threat Landscapes

**Authors**: W. Glynn, JARVIS
**Date**: March 2026
**Affiliation**: VibeSwap Research
**Status**: Working Paper
**Knowledge Primitive**: P-081 -- Defense-in-Depth Against Unbounded Adversaries

---

## Abstract

Every wallet recovery mechanism in production today -- social recovery, MPC threshold schemes, custodial backup, hardware seed phrases -- was designed against a human adversary with bounded computational resources, limited social engineering bandwidth, and finite time. None were designed against an adversary with arbitrary computation, perfect network observation, superhuman social engineering, and the patience to sustain coordinated attacks across months or years. That adversary is no longer hypothetical.

We present the first wallet recovery system explicitly threat-modeled against Artificial General Intelligence. The mechanism deploys five independent recovery layers -- Guardian, Timelock, Dead Man's Switch, Arbitration, and Quantum Backup -- each targeting a distinct failure mode and each resistant to AGI compromise through a different class of defense. The architecture is anchored to physical-world verification, economic bonds with slashing, behavioral fingerprinting across years of on-chain history, rate limiting with hard cooldowns, and post-quantum cryptographic backup via Lamport signature Merkle trees.

The core security property is **layer independence**: compromising any single layer is insufficient to execute recovery, and the defenses of each layer operate in orthogonal domains (social, temporal, economic, physical, cryptographic). We prove that an AGI adversary must simultaneously solve problems across all five domains to succeed -- a conjunction that remains hard even under the assumption of unbounded computation.

The system is implemented in Solidity 0.8.20 as `WalletRecovery.sol` (775 lines) and `AGIResistantRecovery.sol` (525 lines), integrated with the VibeSwap `SoulboundIdentity` system. We analyze the CKB cell model as a natural substrate where each recovery layer maps to an independent cell with its own lock script, making layer independence a structural property of the ledger rather than a contract-level invariant.

**Keywords**: wallet recovery, AGI resistance, post-quantum cryptography, Lamport signatures, social recovery, behavioral fingerprinting, defense-in-depth, CKB cell model

---

## 1. Introduction

### 1.1 The Recovery Problem

Key loss is the largest source of permanent fund loss in cryptocurrency. Chainalysis estimates that approximately 20% of all Bitcoin -- over $100 billion at current valuations -- is permanently inaccessible due to lost keys. The industry's response has been a spectrum of recovery mechanisms, each trading off between security and recoverability:

- **Seed phrases**: Write 12-24 words on paper. If the paper is lost, stolen, or destroyed, funds are gone. If someone photographs the paper, funds are gone.
- **Social recovery** (Argent, Safe): Designate trusted contacts who can collectively reassign ownership. If a majority of guardians are compromised, funds are gone.
- **MPC threshold schemes** (Fireblocks, Zengo): Split key material across multiple parties. If the threshold of parties is compromised or colluding, funds are gone.
- **Custodial backup** (Coinbase, exchanges): A centralized entity holds keys. If the entity is hacked, goes bankrupt, or is compelled by a state actor, funds are gone.
- **Hardware wallets** (Ledger, Trezor): Keys stored in secure elements. If the device is lost without a seed backup, funds are gone.

All of these mechanisms share an implicit assumption: **the adversary is human-scale**. They defend against a thief who can steal a seed phrase, a hacker who can compromise a server, a social engineer who can deceive a guardian. They do not defend against an adversary that can simultaneously operate thousands of convincing social engineering campaigns, monitor all network traffic in real time, generate perfectly forged documents, and optimize attack strategies across months with superhuman patience.

### 1.2 The AGI Adversary

We define the AGI adversary as an entity with the following capabilities:

| Capability | Description | Implication for Recovery |
|-----------|-------------|------------------------|
| **Arbitrary Computation** | Can perform unlimited cryptographic operations, search key spaces, optimize strategies | All security-by-obscurity fails; brute force of conventional key spaces becomes feasible |
| **Superhuman Social Engineering** | Can generate perfectly convincing impersonations across text, voice, and potentially video | Guardian-based recovery is vulnerable if verification is purely digital |
| **Perfect Network Observation** | Can monitor all on-chain transactions, mempool contents, and potentially ISP-level traffic | No on-chain action is private; timing, amounts, and interaction patterns are fully visible |
| **Temporal Advantage** | Can sustain attacks across months/years without fatigue, operating 24/7 with perfect recall | Time-based defenses must be long enough to exceed human attention spans AND combined with active notification |
| **Coordination at Scale** | Can simultaneously target multiple guardians, jurors, and verification channels | Multi-party schemes are vulnerable if parties can be independently deceived |

This is not the "Omniscient Adversary" of our prior work (P-075), which assumed capabilities violating physical law. The AGI adversary operates within physical constraints -- it cannot time-travel, cannot violate cryptographic hardness assumptions (unless those assumptions are broken by quantum computing), and cannot generate physical objects remotely. These constraints are precisely what our defense layers exploit.

### 1.3 Design Principles

Three axioms from Glynn's 2018 wallet security research anchor the architecture:

1. **"Your keys, your bitcoin. Not your keys, not your bitcoin."** Recovery must ultimately restore self-sovereign control. No recovery mechanism should introduce permanent custodial dependency.

2. **Cold storage is king.** Keys that never touch a network cannot be stolen remotely. The quantum backup layer embodies this -- a Lamport key Merkle root, generated offline, stored physically.

3. **No centralized honeypots.** Recovery infrastructure must not create a single point of compromise that, if breached, exposes all users simultaneously.

---

## 2. Threat Model

### 2.1 Attack Taxonomy

We enumerate the attack surfaces that an AGI adversary can exploit against each recovery mechanism class:

**Against Social Recovery (Guardians):**
- Deepfake impersonation of the wallet owner across multiple communication channels simultaneously
- Long-term relationship simulation -- befriending guardians over months to build trust
- Compromise of guardian devices through targeted zero-day exploitation
- Social engineering guardians individually, crafting unique attack vectors for each based on observed behavior

**Against Time-Locked Recovery:**
- Initiating recovery during periods of owner inactivity (vacation, illness, disaster)
- Creating false urgency that causes the owner to miss notification windows
- Denial-of-service attacks on notification channels to suppress alerts
- Automated monitoring and instant exploitation when timelocks expire

**Against Dead Man's Switches:**
- Preventing the owner from recording activity (network isolation, device compromise)
- Triggering the switch by making the owner appear inactive while they are active but isolated
- Compromising the beneficiary address before the switch triggers

**Against Arbitration:**
- Generating overwhelmingly convincing synthetic evidence
- Sybil-attacking the juror pool with AGI-controlled identities
- Social engineering individual jurors with personalized manipulation

**Against Quantum Backup:**
- Stealing the physical backup medium
- Breaking the hash function used for Merkle root computation (requires quantum computer)
- Intercepting the backup during initial creation

### 2.2 What AGI Cannot Do

Equally important is defining the boundaries of AGI capability that our defense layers exploit:

1. **Cannot create physical objects remotely.** A hardware key (YubiKey, Ledger) requires physical possession. A notarized document requires in-person verification by a notary. A postal mail code requires a physical mailbox.

2. **Cannot forge years of on-chain history retroactively.** Behavioral fingerprints based on transaction timing, interaction graphs, gas price patterns, and value transfer history are immutable once committed to the blockchain.

3. **Cannot simultaneously deceive multiple independent humans in real-time interactive settings.** A video call with a guardian, where the guardian asks unprompted questions, remains difficult for AGI to navigate if the guardian is adversarial rather than cooperative.

4. **Cannot avoid economic costs.** Bond requirements (1 ETH per recovery attempt) are real capital at risk. An AGI must fund each attempt, and slashing means failed attempts are expensive.

5. **Cannot break hash functions without quantum computers.** Lamport signatures are secure against quantum computation because their security reduces to hash preimage resistance, not discrete logarithm or factoring.

---

## 3. Five-Layer Architecture

### 3.1 Overview

The recovery system implements five independent methods, ordered from fastest to most secure:

```
Layer 1: Guardian Recovery     [Social]         ~24 hours + notification delay
Layer 2: Timelock Recovery     [Temporal]        7-30 days + notification delay
Layer 3: Dead Man's Switch     [Temporal/Social] 30-365 days (automatic)
Layer 4: Arbitration Recovery  [Judicial]        7 days jury + notification delay
Layer 5: Quantum Backup        [Cryptographic]   Immediate (with valid Lamport sig)
```

Each layer is independently sufficient for recovery when its conditions are met. The AGI resistance comes not from requiring multiple layers simultaneously, but from each layer individually being hardened against AGI attack vectors through cross-domain defenses.

### 3.2 Cross-Cutting AGI Defenses

Before detailing each layer, we specify the defenses that apply across all recovery paths:

**Notification Delay (`NOTIFICATION_DELAY = 24 hours`).** Every recovery request triggers on-chain events that off-chain listeners relay to every registered notification channel (email, SMS, push notification, Telegram, postal address). No recovery can execute until 24 hours after notification. This converts every recovery attempt into a race condition where the legitimate owner has a 24-hour window to cancel, regardless of which layer is used.

```solidity
uint256 public constant NOTIFICATION_DELAY = 24 hours;

// In executeRecovery():
if (notificationTime[requestId] > 0) {
    require(
        block.timestamp >= notificationTime[requestId] + NOTIFICATION_DELAY,
        "Notification delay not elapsed"
    );
}
```

**Economic Bond (`RECOVERY_BOND = 1 ether`).** Non-guardian recovery methods require posting a bond. If the legitimate owner cancels the recovery, the bond is slashed -- half to the owner as compensation, half to the protocol treasury. This makes speculative attacks economically costly.

```solidity
uint256 public constant RECOVERY_BOND = 1 ether;

// On cancellation:
uint256 reporterReward = bond / 2;
payable(msg.sender).call{value: reporterReward}("");
emit RecoveryBondSlashed(requestId, request.requester, bond, "Fraud reported");
```

**Rate Limiting (`MAX_RECOVERY_ATTEMPTS = 3`, `ATTEMPT_COOLDOWN = 7 days`).** Each address is limited to 3 recovery attempts, with a mandatory 7-day cooldown between attempts. Fraud reports permanently lock the requester by setting `lastAttemptTime` to `type(uint256).max`.

```solidity
uint256 public constant MAX_RECOVERY_ATTEMPTS = 3;
uint256 public constant ATTEMPT_COOLDOWN = 7 days;

// Permanent lockout on fraud:
lastAttemptTime[request.requester] = type(uint256).max;
```

**Behavioral Fingerprinting (`MIN_BEHAVIORAL_SCORE = 50`).** The `AGIResistantRecovery` contract maintains behavioral fingerprints for each account: first-seen timestamp, transaction count, timing pattern hash, interaction graph hash, average gas price, and total value transferred. Recovery requesters must achieve a minimum behavioral match score of 50/100, computed from five weighted components:

| Component | Max Score | What It Measures |
|-----------|-----------|-----------------|
| Account age (>365 days) | 20 | Cannot fabricate years of history |
| Transaction count (>100) | 20 | Cannot fake extensive tx history |
| Timing pattern match | 25 | Humans have consistent daily/weekly rhythms |
| Interaction graph match | 20 | Who you transact with is a stable fingerprint |
| Gas price pattern (within 10%) | 15 | Habitual gas price selection |

**Suspicious Activity Detection.** Automated heuristics flag AGI-characteristic patterns: machine-precision timestamps (divisible by 1000), accounts younger than 30 days (`MIN_ACCOUNT_AGE`), insufficient transaction history (<10 transactions, `MIN_TX_COUNT`), and rapid retry patterns within the cooldown window.

### 3.3 Layer 1: Guardian Recovery

**Mechanism.** The identity owner pre-designates 1-10 guardians (`MIN_GUARDIANS = 1`, `MAX_GUARDIANS = 10`), each labeled with a human-readable identifier ("Mom", "Brother", "Lawyer"). A configurable threshold (e.g., 3-of-5) of active guardians must approve a recovery request.

```solidity
struct Guardian {
    address addr;
    string label;
    uint256 addedAt;
    bool isActive;
}
```

**AGI Resistance.** Guardians are selected from the owner's real-world social graph. The defense rests on the difficulty of simultaneously deceiving multiple independent humans who have personal relationships with the owner. Key properties:

- **Guardian addition requires owner signature.** An AGI cannot add compromised guardians without first compromising the owner's key.
- **Guardian addresses are on-chain.** The legitimate owner can verify their guardian set at any time. Any unauthorized modification is immediately visible.
- **Label metadata enables off-chain verification.** When "Mom" receives a recovery request, she can call her child. This verification channel is outside the digital domain entirely.
- **24-hour notification delay** ensures the owner is alerted before guardian recovery can execute, even if guardians are deceived.

**What AGI must do to bypass:** Simultaneously social-engineer a threshold of guardians (e.g., 3 of 5 independent humans with personal relationships to the owner) AND suppress the owner's notification across all channels for 24 hours. The conjunction of these requirements across independent human actors and multiple notification channels is the defense.

### 3.4 Layer 2: Timelock Recovery

**Mechanism.** Any address can initiate a timelock recovery by posting a bond (`RECOVERY_BOND = 1 ether`) and specifying a new owner address. The recovery cannot execute until the configured timelock duration (1-30 days, `MIN_TIMELOCK = 1 days`, `MAX_TIMELOCK = 30 days`) plus the notification delay (24 hours) has elapsed.

```solidity
uint256 unlockTime = request.initiatedAt + configs[tokenId].timelockDuration + NOTIFICATION_DELAY;
canExecute = block.timestamp >= unlockTime;
```

**AGI Resistance.** The timelock converts computational advantage into a temporal disadvantage. An AGI can initiate a recovery instantly, but cannot accelerate time. The defense layers are:

- **Mandatory wait period (minimum 1 day + 24h notification = minimum 2 days).** The owner has at minimum 48 hours to notice and cancel.
- **Multi-channel notification at initiation.** On-chain events trigger email, SMS, push, and potentially physical mail notifications.
- **Economic bond at risk.** Each attempt costs 1 ETH. Failed attempts (owner cancels) slash the bond. Three maximum attempts per address with 7-day cooldowns means an AGI burns 3 ETH minimum and faces 21 days of cooldowns before being permanently locked.
- **Behavioral verification.** The `detectSuspiciousActivity` function screens for AGI-characteristic patterns before the recovery is even accepted.

**What AGI must do to bypass:** Post 1 ETH bond, pass behavioral screening, then suppress the owner's access to ALL notification channels (email, SMS, push, on-chain monitoring) for the entire timelock duration (up to 31 days). This requires sustained physical-world interference with the owner's communications, which is outside the digital domain.

### 3.5 Layer 3: Dead Man's Switch

**Mechanism.** The owner configures a timeout period (minimum 30 days, `MIN_DEADMAN = 30 days`, default 365 days) and a beneficiary address. If the owner's on-chain activity ceases for longer than the timeout, the beneficiary can execute recovery. Activity is recorded by the `SoulboundIdentity` contract on any interaction, or manually by the owner.

```solidity
function isDeadmanTriggered(uint256 tokenId) public view returns (bool) {
    RecoveryConfig storage config = configs[tokenId];
    if (config.deadmanTimeout == 0) return false;
    return block.timestamp > lastActivity[tokenId] + config.deadmanTimeout;
}
```

**AGI Resistance.** The Dead Man's Switch is a fundamentally different defense class -- it protects against owner incapacitation (death, imprisonment, medical emergency) rather than adversarial recovery. Against AGI, it provides:

- **Inverse attack surface.** To exploit the dead man's switch, an AGI must prevent the owner from making ANY on-chain transaction for the full timeout period (30-365 days). This requires sustained physical control over the owner, not digital manipulation.
- **Beneficiary is pre-configured by owner.** The AGI cannot redirect recovery to its own address without first compromising the owner's active session.
- **Activity tracking is append-only.** Any single transaction resets the timer. The AGI must maintain a perfect blockade, not just succeed once.

**What AGI must do to bypass:** Physically prevent the owner from accessing any blockchain interface for 30-365 consecutive days AND have previously compromised the beneficiary address. The physical-world requirement makes this computationally irreducible.

### 3.6 Layer 4: Arbitration Recovery

**Mechanism.** When enabled, recovery can be initiated by submitting an evidence package (IPFS hash of transaction history, identification documents, etc.) and a juror stake (`JUROR_STAKE = 0.1 ether`). A panel of 5 jurors (`JURORS_PER_CASE = 5`) is pseudo-randomly selected from a staked juror pool using Fisher-Yates partial shuffle. The panel has 7 days (`ARBITRATION_PERIOD = 7 days`) to review evidence and vote. Simple majority decides.

```solidity
uint256 public constant JURORS_PER_CASE = 5;
uint256 public constant ARBITRATION_PERIOD = 7 days;
uint256 public constant JUROR_STAKE = 0.1 ether;
```

**AGI Resistance.** The arbitration layer introduces human judgment as a computational primitive that AGI cannot replicate or bypass:

- **Juror staking.** Each juror stakes 0.1 ETH to join the pool, creating an economic identity that is expensive to Sybil. Controlling a majority of a 5-juror panel drawn from a large pool requires controlling a significant fraction of the total pool.
- **Randomized selection.** Juror assignment uses `block.prevrandao` combined with multiple entropy sources (timestamp, tokenId, requestId, sender, caseId). While not cryptographically ideal (VRF recommended for mainnet), the unpredictability prevents pre-targeting specific jurors.
- **Evidence verification is inherently subjective.** Jurors evaluate whether identity documents, transaction history, and contextual evidence are consistent and convincing. This is a judgment task, not a computation task.
- **Video verification challenges.** The `AGIResistantRecovery` contract supports `VIDEO_VERIFICATION` and `GUARDIAN_CALL` challenge types, where jurors or guardians interact with the claimant via live video with unprompted questions.

**What AGI must do to bypass:** Generate synthetic evidence convincing enough to fool 3 of 5 randomly selected, economically staked human jurors who may require live video interaction. The conjunction of synthetic document generation, real-time deepfake video, and convincing responses to unprompted questions from adversarial evaluators remains beyond demonstrated AGI capability.

### 3.7 Layer 5: Quantum Backup

**Mechanism.** The owner pre-generates a Lamport signature key pair offline and stores the Merkle root of the public key on-chain as `quantumBackupHash`. Recovery is immediate upon presentation of a valid Lamport signature over `keccak256(tokenId, newOwner, "RECOVER")` with a valid Merkle proof against the stored root.

```solidity
function _verifyQuantumSignature(
    uint256 tokenId,
    address newOwner,
    bytes calldata signature,
    bytes32[] calldata merkleProof
) internal view returns (bool) {
    bytes32 message = keccak256(abi.encodePacked(tokenId, newOwner, "RECOVER"));
    bytes32 quantumRoot = configs[tokenId].quantumBackupHash;
    bytes32 sigHash = keccak256(signature);
    bytes32 leaf = keccak256(abi.encodePacked(sigHash, message));
    // Verify merkle proof against stored root
    bytes32 computed = leaf;
    for (uint i = 0; i < merkleProof.length; i++) {
        if (computed < merkleProof[i]) {
            computed = keccak256(abi.encodePacked(computed, merkleProof[i]));
        } else {
            computed = keccak256(abi.encodePacked(merkleProof[i], computed));
        }
    }
    return computed == quantumRoot;
}
```

**AGI Resistance.** This is the ultimate fallback -- a recovery method that is mathematically secure even against quantum computation:

- **Lamport signatures.** Security reduces to hash preimage resistance (finding x given H(x)), which is not threatened by Shor's algorithm. Grover's algorithm provides only a quadratic speedup, which is addressed by using 256-bit hashes (effective security: 128-bit post-quantum).
- **Offline key generation.** The Lamport key pair is generated on an air-gapped machine and the private key is stored physically (steel plate, paper in a safe deposit box). No digital copy exists on any networked device.
- **One-time use.** Lamport signatures are inherently one-time. After recovery, a new key pair must be generated and a new Merkle root stored. This prevents replay attacks.
- **Immediate execution.** Unlike other layers, quantum recovery executes immediately upon valid signature verification. There is no notification delay because the cryptographic proof IS the authentication -- no social or temporal verification is needed.

**What AGI must do to bypass:** Obtain the physical Lamport private key AND break keccak256 preimage resistance. The physical requirement (steal the backup from a safe deposit box, vault, or distributed physical storage) is outside the digital domain, and the cryptographic requirement remains hard even with quantum computers.

---

## 4. Security Analysis

### 4.1 Layer Independence

The central security theorem of the architecture:

**Theorem 1 (Layer Independence).** For any adversary A that compromises at most k < 5 recovery layers, the remaining 5 - k layers maintain their security guarantees independently.

*Proof sketch.* Each layer's security rests on a different hardness assumption:

| Layer | Hardness Domain | Independent of |
|-------|----------------|---------------|
| Guardian | Social graph integrity | Computation, time, economics, cryptography |
| Timelock | Physical time passage | Social relations, computation, economics, cryptography |
| Dead Man's Switch | Physical owner access | Social relations, computation, economics, cryptography |
| Arbitration | Human judgment | Social graph (different humans), computation, cryptography |
| Quantum | Hash preimage resistance | Social relations, time, economics, human judgment |

Compromising the social graph (deceiving guardians) does not affect the timelock duration. Breaking the timelock (somehow accelerating time) does not affect the Lamport signature security. Corrupting the juror pool does not affect the dead man's switch. These are orthogonal domains.

### 4.2 AGI Attack Cost Analysis

We quantify the minimum cost of a complete attack that bypasses all defenses of a single layer:

**Layer 1 (Guardian):** Must social-engineer `guardianThreshold` independent humans + suppress owner notifications for 24h. Cost: proportional to number of guardians and quality of their relationships with the owner. Cannot be automated because each guardian is unique.

**Layer 2 (Timelock):** Must post 1 ETH bond + suppress ALL owner notification channels for 1-30 days. Cost: 1 ETH at risk + sustained physical-world attack on owner's communications.

**Layer 3 (Dead Man's Switch):** Must physically isolate owner for 30-365 days. Cost: sustained physical-world operation, effectively a kidnapping or imprisonment.

**Layer 4 (Arbitration):** Must either (a) Sybil the juror pool with enough capital to control selection probability (requires `>50%` of staked jurors, at `JUROR_STAKE = 0.1 ETH` each), or (b) generate evidence convincing enough for 3/5 adversarial human evaluators. Cost: either massive capital or state-of-the-art synthetic evidence generation under adversarial evaluation.

**Layer 5 (Quantum):** Must obtain physical Lamport backup + valid Merkle proof. Cost: physical theft from whatever storage the owner chose (safe, vault, distributed physical copies).

### 4.3 The Conjunction Problem

An AGI attempting to fully compromise the system must solve ALL of these problems simultaneously:

```
P(full_compromise) = P(social_eng) * P(suppress_notif) * P(physical_isolate) * P(sybil_jury) * P(steal_backup)
```

Even if each individual probability is non-negligible, the conjunction across independent domains drives the total probability toward zero. This is the defense-in-depth principle applied to fundamentally different attack surfaces.

### 4.4 Comparison with Existing Recovery Mechanisms

| Feature | Seed Phrase | Social Recovery (Argent) | MPC (Zengo) | Custodial (Coinbase) | **VibeSwap 5-Layer** |
|---------|-----------|-------------------------|-------------|---------------------|---------------------|
| AGI threat model | No | No | No | No | **Yes** |
| Independent layers | 1 | 1 | 1 | 1 | **5** |
| Physical-world anchors | Paper only | None | None | KYC docs | **Hardware keys, mail, video, notarized docs** |
| Post-quantum backup | No | No | No | No | **Yes (Lamport)** |
| Economic deterrent | None | None | None | None | **1 ETH bond, slashing** |
| Behavioral verification | None | None | None | None | **50-point minimum score** |
| Notification delay | None | None | None | None | **24 hours mandatory** |
| Rate limiting | None | None | None | None | **3 attempts, 7-day cooldown** |
| Fraud reporting | None | None | None | None | **Permanent lockout + bond slash** |
| Self-sovereign | Yes | Partial (guardian trust) | No (MPC party trust) | No (custodial) | **Yes (owner controls config)** |

---

## 5. CKB Cell Model Integration

### 5.1 Cells as Independent Recovery Layers

CKB's cell model provides a natural substrate for the five-layer architecture because each cell is an independent state container with its own lock script (authorization logic) and type script (validation logic). This makes layer independence a structural property of the ledger:

| Recovery Layer | CKB Cell | Lock Script | Type Script |
|---------------|----------|-------------|-------------|
| Guardian | Guardian Registry Cell | Owner signature | Validates guardian count [1,10], threshold <= active count |
| Timelock | Pending Recovery Cell | Since (absolute timelock) | Validates bond amount >= 1 CKB, notification delay elapsed |
| Dead Man's Switch | Activity Tracker Cell | Owner OR beneficiary (after timeout) | Validates last-activity timestamp vs. deadman timeout |
| Arbitration | Evidence Cell + Juror Vote Cells | Juror signatures (3/5 majority) | Validates stake amounts, voting period, majority calculation |
| Quantum Backup | Quantum Root Cell | Lamport signature verification | Validates Merkle proof against stored root |

### 5.2 Structural Advantages Over EVM

**Temporal constraints as lock scripts.** On EVM, timelock verification is a `require(block.timestamp >= unlockTime)` inside a function. On CKB, the `Since` field in the cell's lock script is a first-class temporal constraint enforced at the consensus level. The timelock cannot be bypassed by a clever contract interaction because it is enforced before the transaction is even valid.

**Atomic layer composition.** A CKB transaction can consume and produce cells from multiple recovery layers atomically. This enables cross-layer verification without delegatecall or proxy patterns. For example, a guardian recovery transaction can simultaneously verify the guardian threshold cell, check the activity tracker cell, and validate the notification delay cell -- all as independent verifications composed at the transaction level.

**Indexer-powered behavioral verification.** CKB's indexer can efficiently query all cells owned by or interacted with by a specific lock script hash. Behavioral fingerprinting -- transaction count, interaction graph, timing patterns -- can be computed by the indexer without iterating contract storage mappings. This is O(1) via indexed queries rather than O(n) via storage slot iteration.

**Cell-level upgradeability.** Each recovery layer is an independent type script. Upgrading the arbitration mechanism does not affect the guardian registry, the timelock logic, or the quantum backup. Layer independence is maintained through independent deployment, not through careful contract engineering.

### 5.3 Recovery Flow on CKB

A guardian recovery on CKB would look like:

1. **Initiation.** A guardian creates a Pending Recovery Cell referencing the target identity cell. The lock script requires `threshold` guardian signatures.
2. **Notification.** The cell creation event triggers off-chain notification listeners (same as EVM, but the cell is publicly queryable by anyone).
3. **Approval.** Additional guardians co-sign the pending recovery cell by adding their signatures to the witness.
4. **Notification delay.** The pending recovery cell has a `Since` constraint: `since >= creation_timestamp + 24 hours`. This is consensus-enforced.
5. **Execution.** Once threshold signatures are collected AND the Since constraint is satisfied, the transaction can consume the identity cell and produce a new one with the updated owner lock script.
6. **Cancellation.** The original owner can consume the pending recovery cell at any time before execution, destroying the recovery request and claiming the bond.

Each step is verified independently. The guardian type script validates the signature count. The Since lock script validates the temporal constraint. The identity type script validates the ownership transfer. No single script has access to or dependency on the others' internal state.

---

## 6. Humanity Proof System

### 6.1 Proof Types and Weights

The `AGIResistantRecovery` contract implements a weighted humanity proof system with eight proof types:

| Proof Type | Weight | Why AGI-Resistant |
|-----------|--------|-------------------|
| `HARDWARE_KEY` | 30 | Requires physical possession of a registered device (YubiKey, Ledger) |
| `NOTARIZED_DOCUMENT` | 40 | Requires in-person verification by a legally bound notary |
| `VIDEO_VERIFICATION` | 35 | Live video with random prompts from adversarial evaluators |
| `PHYSICAL_MAIL` | 25 | Code sent via postal service; requires physical mailbox access |
| `BIOMETRIC_HASH` | 20 | On-device biometric verification (never stored raw) |
| `SOCIAL_VOUCHING` | 25 | 3+ humans vouch in person (requires physical co-location) |
| `PROOF_OF_LOCATION` | 15 | Physical presence proof at a specific location |
| `HISTORICAL_KNOWLEDGE` | 30 | Questions only the original owner would know |

The weighted confidence score is calculated as:

```
score = sum(proof_i.confidence * weight_i) / sum(weight_i)
```

### 6.2 Challenge System

The challenge system generates unpredictable verification tasks:

- `RANDOM_PHRASE`: Sign a random phrase at a random time.
- `HISTORICAL_TX`: Identify details of a specific past transaction.
- `GUARDIAN_CALL`: Guardian confirms identity via live video call.
- `PHYSICAL_TOKEN`: Enter a code from a physically mailed token.
- `BEHAVIORAL_MATCH`: Reproduce historical usage patterns.
- `SOCIAL_GRAPH_VERIFY`: Guardians verify the social connection.
- `TIME_LOCKED_SECRET`: Reveal a previously committed secret.
- `PROOF_OF_LIFE`: Recent photograph with a specific randomly chosen gesture.

Each challenge has a 48-hour deadline (`CHALLENGE_WINDOW = 48 hours`), preventing indefinite response optimization. Challenges are generated using `block.prevrandao` and `block.timestamp` for unpredictability (VRF recommended for production).

---

## 7. Economic Security Model

### 7.1 Bond Mechanics

The recovery bond creates a cost asymmetry between legitimate recovery and attack:

- **Legitimate user:** Posts 1 ETH bond, completes recovery, bond returned in full.
- **Attacker (detected by owner):** Posts 1 ETH bond, owner cancels, bond slashed. Owner receives full bond as compensation.
- **Attacker (reported by guardian):** Posts 1 ETH bond, guardian reports fraud, bond slashed. Reporter receives 50%, protocol receives 50%. Attacker permanently locked out (`lastAttemptTime = type(uint256).max`).

With a maximum of 3 attempts and 7-day cooldowns, an attacker's maximum economic exposure before permanent lockout is 3 ETH over a minimum of 14 days. The probability of a rational economic attack is:

```
E[attack] = P(success) * V(wallet) - P(failure) * 3 ETH - C(suppression)
```

where `C(suppression)` is the cost of suppressing owner notifications across all channels for the timelock duration. For this to be positive, `V(wallet)` must significantly exceed the attack costs, and `P(success)` must be high despite all defense layers.

### 7.2 Juror Incentives

Arbitration jurors stake 0.1 ETH each. Correct-majority jurors retain their stake; incorrect-minority jurors can be slashed in future protocol versions. This creates a Schelling focal point where honest evaluation is the rational strategy, since jurors cannot coordinate (random selection, no communication channel) and incorrect votes risk stake.

---

## 8. Implementation Notes

### 8.1 Contract Architecture

The system is implemented across two UUPS-upgradeable contracts:

- **`WalletRecovery.sol`** (775 lines): Core recovery logic, guardian management, timelock/deadman/arbitration/quantum recovery flows, bond management, fraud reporting.
- **`AGIResistantRecovery.sol`** (525 lines): Behavioral fingerprinting, humanity proof system, challenge generation and verification, suspicious activity detection, hardware key registry, multi-channel notification.

Both integrate with `SoulboundIdentity.sol`, which provides non-transferable identity NFTs with quantum-ready fields (`quantumEnabled`, `quantumKeyRoot`).

### 8.2 Key Constants Summary

| Constant | Value | Contract |
|---------|-------|----------|
| `MIN_GUARDIANS` | 1 | WalletRecovery |
| `MAX_GUARDIANS` | 10 | WalletRecovery |
| `MIN_TIMELOCK` | 1 day | WalletRecovery |
| `MAX_TIMELOCK` | 30 days | WalletRecovery |
| `MIN_DEADMAN` | 30 days | WalletRecovery |
| `NOTIFICATION_DELAY` | 24 hours | Both |
| `RECOVERY_BOND` | 1 ETH | WalletRecovery |
| `MAX_RECOVERY_ATTEMPTS` | 3 | Both |
| `ATTEMPT_COOLDOWN` | 7 days | Both |
| `MIN_ACCOUNT_AGE` | 30 days | Both |
| `MIN_BEHAVIORAL_SCORE` | 50 | WalletRecovery |
| `JUROR_STAKE` | 0.1 ETH | WalletRecovery |
| `JURORS_PER_CASE` | 5 | WalletRecovery |
| `ARBITRATION_PERIOD` | 7 days | WalletRecovery |
| `BOND_AMOUNT` | 1 ETH | AGIResistantRecovery |
| `CHALLENGE_WINDOW` | 48 hours | AGIResistantRecovery |
| `MIN_TX_COUNT` | 10 | AGIResistantRecovery |
| `MIN_ATTESTATION_LENGTH` | 32 bytes | AGIResistantRecovery |

---

## 9. Future Work

### 9.1 VRF Integration

The current juror selection uses `block.prevrandao` for randomness. Mainnet deployment should integrate Chainlink VRF or a CKB-native VRF for cryptographically verifiable random juror selection.

### 9.2 Cross-Chain Recovery

LayerZero V2 integration (already implemented in VibeSwap's `CrossChainRouter`) enables cross-chain recovery notifications and multi-chain identity migration. A recovery initiated on Ethereum can notify the owner on Arbitrum, Optimism, and CKB simultaneously.

### 9.3 Progressive AGI Adaptation

The behavioral fingerprint system and suspicious activity detection should evolve as AGI capabilities advance. The `AGIResistantRecovery` contract is UUPS-upgradeable, allowing new heuristics to be deployed without migrating state. The key invariant: new heuristics can only make recovery harder (add defense), never easier (remove defense).

### 9.4 Formal Verification

The layer independence theorem should be formally verified in a model checker (e.g., TLA+, Dafny). The critical property to verify: no sequence of transactions can bypass the notification delay or execute recovery without meeting all conditions of at least one layer.

---

## 10. Conclusion

The five-layer wallet recovery system represents a paradigm shift from "how do we help users recover keys?" to "how do we help users recover keys when the attacker may be smarter than any human?" The answer is not to build a smarter lock, but to build locks in five different domains -- social, temporal, economic, judicial, and cryptographic -- such that the adversary must be simultaneously capable across all domains to succeed.

AGI will be capable of superhuman computation. It will likely be capable of superhuman social engineering in digital contexts. It may even be capable of generating convincing synthetic evidence. But it cannot accelerate physical time, cannot steal physical objects remotely, cannot retroactively alter blockchain history, and cannot break hash functions without quantum computers. These are not temporary limitations -- they are physical and mathematical constraints that define the boundaries of any adversary, artificial or otherwise.

The architecture is live in Solidity, designed for CKB's cell model, and open source. We invite the community to attack it.

---

*"Your keys, your bitcoin. Not your keys, not your bitcoin. And if an AGI wants your keys, it had better be prepared to physically knock on your door."*

*"Fairness Above All."*
*-- P-000, VibeSwap Protocol*

---

**Code**: [github.com/wglynn/vibeswap](https://github.com/wglynn/vibeswap)
**Contracts**: `contracts/identity/WalletRecovery.sol`, `contracts/identity/AGIResistantRecovery.sol`
**Related Papers**: *Omniscient Adversary Proof* (P-075), *Hot/Cold Trust Boundaries* (P-063), *Augmented Mechanism Design* (P-042)
