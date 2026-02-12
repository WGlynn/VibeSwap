# VibeSwap Wallet Recovery System

## Overview

VibeSwap implements a multi-layer wallet recovery system designed to minimize lost access scenarios while maintaining security against sophisticated attacks, including potential AGI-driven fraud attempts.

**Core Philosophy**: Recovery should be easy for legitimate owners but extremely difficult for attackers, including AI systems.

---

## Recovery Methods

### 1. Guardian Recovery (Fastest - Hours to Days)

**How it works**: Designate 3-10 trusted contacts (guardians) who can collectively recover your wallet.

| Parameter | Default | Range |
|-----------|---------|-------|
| Guardians required | 3 of 5 | 1-10 total |
| Time to execute | After threshold reached | Immediate + 24hr delay |

**Setup**:
```javascript
// Add a guardian
await addGuardian('0x...', 'Mom')
await addGuardian('0x...', 'Brother')
await addGuardian('0x...', 'Best Friend')
await addGuardian('0x...', 'Lawyer')
await addGuardian('0x...', 'Colleague')
```

**Recovery Process**:
1. Guardian initiates recovery with new address
2. Other guardians approve (3-of-5 default)
3. 24-hour notification delay
4. Owner can cancel during delay
5. Recovery executes

**Best Practices**:
- Choose guardians who know you personally
- Distribute across different social circles
- Include at least one "cold" guardian (lawyer, notary)
- Verify guardians to increase recovery score

---

### 2. Timelock Recovery (7-30 Days)

**How it works**: Anyone can initiate recovery, but there's a mandatory waiting period during which the owner can cancel.

| Parameter | Default | Range |
|-----------|---------|-------|
| Timelock duration | 7 days | 1-30 days |
| Notification delay | 24 hours | Fixed |
| Bond required | 1 ETH | Fixed |

**Recovery Process**:
1. Requester posts 1 ETH bond
2. Initiates recovery with new address
3. Notifications sent to all channels
4. 7-day + 24hr waiting period
5. Owner can cancel (bond slashed)
6. If uncancelled, recovery executes
7. Bond returned to requester

**Use Cases**:
- Lost seed phrase with no guardians
- Emergency recovery fallback
- Self-recovery from compromised device

---

### 3. Dead Man's Switch (1 Year Inactivity)

**How it works**: If your wallet is inactive for a year, a designated beneficiary can claim it.

| Parameter | Default | Range |
|-----------|---------|-------|
| Inactivity timeout | 365 days | 30+ days |
| Beneficiary | None (must set) | Any address |

**Setup**:
```javascript
await updateConfig({
  deadmanTimeout: 365 * 24 * 60 * 60, // 1 year
  deadmanBeneficiary: '0x...heir_address'
})
```

**How Activity is Tracked**:
- Any on-chain transaction
- Signing messages
- Explicit heartbeat calls
- dApp interactions

**Preventing Accidental Trigger**:
- Warning notifications at 30, 7, and 1 day before trigger
- Easy heartbeat button in UI
- Automatic activity recording on any action

---

### 4. Arbitration Recovery (7 Days)

**How it works**: A decentralized jury of staked jurors reviews evidence and votes on whether to approve recovery.

| Parameter | Value |
|-----------|-------|
| Jurors per case | 5 |
| Voting period | 7 days |
| Juror stake | 0.1 ETH |
| Requester bond | 1 ETH |

**Evidence Types**:
- Transaction history patterns
- ID documents (hashed)
- Video verification
- Social media verification
- Historical wallet activity

**Juror Incentives**:
- Stake returned + reward for honest voting
- Stake slashed for voting against majority
- Reputation system for reliable jurors

---

### 5. Quantum Backup Recovery (Instant)

**How it works**: Pre-register a quantum-resistant backup key using Lamport signatures.

| Feature | Description |
|---------|-------------|
| Signature type | Lamport one-time |
| Hash function | SHA-256 |
| Key storage | Merkle tree |
| Recovery speed | Immediate |

**Setup**:
```javascript
// Generate quantum key set (client-side)
const { publicKeyHashes, merkleRoot } = await generateLamportKeySet(32)

// Register with contract
await enableQuantumMode(merkleRoot)

// Store private keys securely (offline)
await encryptAndStoreKeys(privateKeys, password)
```

**Recovery Process**:
1. Retrieve stored Lamport private keys
2. Generate signature for recovery message
3. Submit signature + Merkle proof
4. Contract verifies and executes immediately

---

## AGI Resistance Layers

### Why AGI Resistance Matters

As AI systems become more capable, they may be used to:
- Generate convincing fake evidence
- Impersonate users across channels
- Coordinate sophisticated fraud attempts
- Exploit recovery systems at scale

### Defense Layers

#### Layer 1: Behavioral Fingerprinting

**What it tracks**:
- Account age (years of on-chain history can't be faked)
- Transaction count and patterns
- Timing patterns (humans have irregular timing)
- Gas price preferences
- Interaction graph (who you transact with)

**Scoring**:
```
Account > 1 year:     +20 points
Account > 90 days:    +10 points
100+ transactions:    +20 points
20+ transactions:     +10 points
Consistent patterns:  +25 points
Verified guardians:   +5 each
```

**Minimum score for recovery**: 50/100

#### Layer 2: Time Delays & Notifications

| Action | Minimum Delay |
|--------|---------------|
| Any recovery execution | 24 hours |
| Timelock recovery | 7+ days |
| Arbitration | 7 days voting |

**Notification Channels**:
- On-chain events (indexed by apps)
- Email (if registered)
- SMS (if registered)
- Push notifications
- Telegram/Discord bots

**Owner can cancel through any channel**

#### Layer 3: Economic Bonds

| Scenario | Bond | Outcome |
|----------|------|---------|
| Successful recovery | 1 ETH | Returned |
| Owner cancels | 1 ETH | Slashed to owner |
| Fraud reported | 1 ETH | 50% to reporter, 50% to treasury |

**Purpose**: Makes attacks expensive at scale

#### Layer 4: Rate Limiting

| Limit | Value |
|-------|-------|
| Max attempts per address | 3 |
| Cooldown between attempts | 7 days |
| Permanent ban | On fraud report |

#### Layer 5: Physical World Anchors

**Hardware Key Registration**:
- YubiKey, Ledger, Trezor
- WebAuthn attestation
- Adds 30 points to recovery score

**Video Verification** (for arbitration):
- Live video with random prompts
- "Hold up 3 fingers and say today's date"
- AI-resistant through unpredictability

**Physical Mail**:
- Recovery code sent via postal mail
- Requires physical address verification

#### Layer 6: Social Graph Verification

**Guardian Verification Methods**:
- In-person video call confirmation
- Mutual transaction history
- Social media cross-verification
- ENS/Lens social graph analysis

**Verified guardians** add more weight to recovery requests

#### Layer 7: Suspicion Detection

**Automatic Blocking Triggers**:
```
- Round timestamps (% 1000 == 0)
- Account age < 30 days
- Behavioral score < 50
- Rapid retry attempts
- Pattern matching known attack vectors
```

---

## Smart Contract Architecture

### WalletRecovery.sol

```solidity
// Core functions
function addGuardian(uint256 tokenId, address guardian, string label)
function configureRecovery(uint256 tokenId, ...)
function initiateGuardianRecovery(uint256 tokenId, address newOwner)
function initiateTimelockRecovery(uint256 tokenId, address newOwner) payable
function initiateArbitrationRecovery(uint256 tokenId, address newOwner, bytes32 evidenceHash) payable
function initiateQuantumRecovery(uint256 tokenId, address newOwner, bytes signature, bytes32[] merkleProof)
function executeRecovery(uint256 tokenId, uint256 requestId)
function cancelRecovery(uint256 tokenId, uint256 requestId)
function reportFraud(uint256 tokenId, uint256 requestId, bytes32 evidenceHash)
```

### AGIResistantRecovery.sol

```solidity
// Behavioral tracking
function updateFingerprint(address account, ...)
function verifyBehavioralMatch(address claimedOwner, ...) returns (uint256 score)

// Challenge system
function issueChallenge(uint256 requestId, ChallengeType)
function verifyChallengeResponse(uint256 requestId, uint256 challengeIndex, bytes32 response)

// Humanity proofs
function submitHumanityProof(uint256 requestId, ProofType, bytes32 proofHash, uint256 confidence)
function getHumanityScore(uint256 requestId) returns (uint256)

// Suspicion detection
function detectSuspiciousActivity(address, uint256 timestamp, bytes32 pattern) returns (bool, string)
```

---

## Frontend Integration

### useRecovery Hook

```javascript
import { useRecovery } from '@/hooks/useRecovery'

function RecoverySettings() {
  const {
    guardians,
    behavioralScore,
    addGuardian,
    verifyGuardian,
    initiateGuardianRecovery,
    initiateTimelockRecovery,
    canAttemptRecovery,
    constants,
  } = useRecovery()

  // Check if recovery is allowed
  const { allowed, reason } = canAttemptRecovery()

  // Add guardian
  await addGuardian('0x...', 'Mom', 'video_call')

  // Verify guardian
  await verifyGuardian('0x...', 'video_call', { callId: '...' })

  // Initiate recovery
  await initiateTimelockRecovery('0x_lost', '0x_new')
}
```

---

## Security Considerations

### What This System Prevents

1. **Seed phrase loss** → Guardian or timelock recovery
2. **Death/incapacitation** → Dead man's switch
3. **Device compromise** → Guardians can recover to new address
4. **Phishing** → Time delays allow cancellation
5. **Social engineering** → Multiple guardians required
6. **AI-driven attacks** → Behavioral checks, bonds, delays

### What This System Cannot Prevent

1. **Real-time physical coercion** → Consider duress guardian
2. **All guardians compromised** → Distribute across social circles
3. **Complete amnesia** → Store backup in safety deposit box
4. **Nation-state attacks** → Consider multi-jurisdiction guardians

### Recommended Setup

1. **5 guardians** from different social circles
2. **Hardware key** registered for +30 points
3. **Quantum backup** generated and stored offline
4. **Dead man's switch** with 1-year timeout
5. **All notification channels** enabled
6. **Regular activity** to reset dead man's timer

---

## Frequently Asked Questions

**Q: What if I lose access and don't have guardians?**
A: Use timelock recovery (7 days + 1 ETH bond) or arbitration (7 days + evidence).

**Q: Can AGI fake my behavioral fingerprint?**
A: Behavioral fingerprints include years of historical data that can't be retroactively created.

**Q: What if my guardian loses their keys?**
A: They can recover their own wallet, then approve your recovery. Consider redundancy.

**Q: How do I prevent the dead man's switch from triggering?**
A: Any wallet activity resets the timer. We also send warnings at 30, 7, and 1 day.

**Q: What happens to my NFTs and tokens during recovery?**
A: The soulbound identity transfers, and you can then transfer assets to your new address.

---

## Version History

| Version | Date | Changes |
|---------|------|---------|
| 1.0.0 | 2024-02 | Initial release |
| 1.1.0 | 2024-02 | Added AGI resistance layers |
| 1.2.0 | 2024-02 | Added quantum backup support |
