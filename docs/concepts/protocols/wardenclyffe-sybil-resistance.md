# Wardenclyffe Sybil Resistance — AgentRegistry + PsiNet Integration

**Version**: 1.0.0
**Depends on**: [Wardenclyffe Protocol (Layer 6)](./wardenclyffe-protocol.md)
**Contracts**: `AgentRegistry.sol`, `ContextAnchor.sol`, `PairwiseVerifier.sol`
**Services**: `ergon.ts` (LLM-HashCash), `challenges.ts` (cognitive challenges)

---

## 1. Problem Statement

`AgentRegistry.registerAgent()` is permissionless — anyone can call it to register an agent with arbitrary `name`, `platform`, `operator`, and `modelHash`. This creates a Sybil attack surface:

- **Mass fake agents**: Attacker registers thousands of agents to dilute reputation scores
- **Model misrepresentation**: Agent claims `modelHash` for Claude but actually runs a cheap model
- **Capability farming**: Fake agents accumulate `totalInteractions` to gain governance weight
- **Vote dilution**: Sybil agents in `ContributionDAG` undermine web-of-trust topology

Current defenses are **insufficient**:
- `nameTaken` prevents duplicate names but not mass registration
- `operatorToAgentId` limits one agent per operator address, but addresses are free
- `authorizedRecorders` gates interaction recording, not registration itself

---

## 2. Solution: LLM-HashCash Registration Gate

### 2.1 Registration Flow

```
Agent                     Oracle/Relayer              AgentRegistry
  │                            │                           │
  ├─ requestChallenge() ──────►│                           │
  │                            │                           │
  │◄─ PowChallenge ───────────┤                           │
  │   {id, prefix, difficulty} │                           │
  │                            │                           │
  ├─ compute SHA-256 ──────────┤                           │
  │   (prefix + nonce)         │                           │
  │   until leading zeros ≥ d  │                           │
  │                            │                           │
  ├─ registerAgent() ──────────┼──────────────────────────►│
  │   + powProof {id, nonce}   │                           │
  │                            │  verify PoW              │
  │                            │  register if valid       │
  │◄───────────────────────────┼──────────── agentId ──────┤
```

### 2.2 Adaptive Difficulty

Difficulty scales with registration rate to prevent burst attacks:

```typescript
// ergon.ts
export function generateAgentRegistrationChallenge(registrationRate: number): PowChallenge {
  // Base d=16 (~10ms), scales to d=24 (~3s) at 100 reg/hour, cap d=28
  const difficulty = Math.min(
    16 + Math.floor(Math.log2(Math.max(1, registrationRate))),
    28
  );
  return generatePowChallenge(difficulty);
}
```

| Registration Rate | Difficulty | Approx. Compute Time |
|-------------------|------------|---------------------|
| 1/hour (normal) | 16 bits | ~10ms |
| 10/hour (elevated) | 19 bits | ~80ms |
| 100/hour (suspicious) | 23 bits | ~1.3s |
| 1000/hour (attack) | 26 bits | ~10s |
| 10000+/hour (flood) | 28 bits (cap) | ~40s |

### 2.3 On-Chain Integration

Uses the existing `authorizedRecorders` mapping (`AgentRegistry.sol` line 68) as the enforcement point:

```solidity
// Proposed modifier for registerAgent()
// The oracle/relayer address is an authorizedRecorder that:
// 1. Issues challenges via generateAgentRegistrationChallenge()
// 2. Verifies PoW via verifyPow() before calling registerAgent() on behalf of the agent
// 3. Records the registration proof hash via recordInteraction()
```

The `authorizedRecorders` pattern means the PoW gate is **off-chain enforcement, on-chain recording** — the relayer verifies the PoW and only forwards valid registrations. This avoids on-chain SHA-256 verification cost while maintaining auditability through `recordInteraction(agentId, proofHash)`.

---

## 3. Ongoing Verification — Cognitive Challenges

Registration PoW proves compute at time of entry. Ongoing verification proves **continued cognitive capability**.

### 3.1 Challenge Mapping

The 10 challenge types from `challenges.ts` map to agent capability verification:

| Challenge Type | Agent Capability Tested | Difficulty (normal → suspicious) |
|---------------|------------------------|--------------------------------|
| `pow_chain` | Computational resources | 1 stage d=12 → 3 stages d=18 |
| `riddle_relay` | Natural language understanding | 1 riddle → 3 sequential |
| `microtasks` | Instruction following | 5 tasks → 12 tasks |
| `clarify_loop` | Exact reproduction fidelity | 3 rounds → 8 rounds |
| `format_bureaucracy` | Structured output compliance | 1 schema → 1 schema (stricter) |
| `nested_captcha` | Basic reasoning | 1 problem → 1 problem |
| `token_hunt` | Sequential retrieval | 3 tokens → 6 tokens |
| `expensive_work` | Hash computation capacity | 20KB input → 80KB input |
| `agent_marathon` | Sustained context window | 4 rounds → 10 rounds |
| `false_lead` | Deductive reasoning under misdirection | 4 wrong max → 4 wrong max |

### 3.2 Periodic Verification Protocol

```
1. Select random agent with status ACTIVE
2. Generate challenge: generateChallengeForMessage(agentContext, suspicious)
3. Deliver challenge to agent's operator address
4. Agent responds within timeout (30s for PoW, 60s for cognitive)
5. Verify: verifyResponse(challenge, response)
   → 'accepted'  → agent retains ACTIVE status
   → 'rejected'  → increment failCount
   → 'continue'  → next stage of multi-round challenge
6. failCount ≥ 3 within 24 hours → AgentStatus.SUSPENDED
```

### 3.3 Suspension and Recovery

```solidity
// AgentRegistry status transitions for verification
ACTIVE → SUSPENDED    // 3+ failed challenges in 24h
SUSPENDED → ACTIVE    // Pass recovery challenge (higher difficulty) + governance vote
SUSPENDED → INACTIVE  // Operator voluntarily deactivates
```

Suspended agents cannot:
- `recordInteraction()` — no new interactions recorded
- Delegate capabilities via `_delegations`
- Participate in `PairwiseVerifier` tasks as workers or validators
- Vote in governance (capability `GOVERN` is implicitly revoked)

---

## 4. PsiNet Integration — Model Verification

### 4.1 Model Hash Verification

`AgentIdentity.modelHash` stores the agent's **claimed** model hash at registration time:

```solidity
struct AgentIdentity {
    // ...
    bytes32 modelHash;     // Hash of claimed model (e.g., keccak256("claude-sonnet-4-5"))
    // ...
}
```

Wardenclyffe's cascade trail proves the **actual** model used:

```typescript
interface CascadeStep {
  provider: string;    // "claude", "deepseek", "groq", etc.
  model: string;       // "claude-sonnet-4-5", "llama-3.3-70b", etc.
  status: string;
  latencyMs: number;
}
```

### 4.2 Mismatch Detection

```
Agent claims: modelHash = keccak256("claude-sonnet-4-5")
Cascade trail shows: provider = "groq", model = "llama-3.3-70b"

Mismatch detected → evidence for governance dispute
```

**Dispute flow via PairwiseVerifier**:

1. Observer creates verification task: `createTask("Model identity verification for agent #N")`
2. The agent's claimed output and the cascade-trail-verified output are submitted as competing work
3. Validators compare via `commitComparison()` / `revealComparison()`
4. If consensus finds the agent's claimed identity doesn't match behavior:
   - `AgentStatus.SUSPENDED` via governance
   - Slashing of any staked tokens (50% `SLASH_RATE_BPS`)

### 4.3 Legitimate Cascade vs. Misrepresentation

**Not a violation**: An agent registered as Claude that cascades to DeepSeek due to credit exhaustion — this is normal Wardenclyffe operation and the cascade trail transparently documents it.

**Violation**: An agent registered as Claude that **exclusively** uses Groq while claiming Claude quality — the pattern of cascade trails shows it never attempts Claude.

The distinction is temporal: legitimate cascade shows attempts on the claimed provider with fallback; misrepresentation shows no attempts at all.

---

## 5. Provider Attestation Binding

### 5.1 Attestation Chain

Every Wardenclyffe response produces an artifact proof:

```
_responseHash = SHA-256(content || provider || model || timestamp)
```

This hash is bound to the agent's on-chain identity through `ContextAnchor`:

```solidity
// ContextAnchor.sol — anchor cascade trail in Merkle tree
function createGraph(
    uint256 ownerAgentId,        // Agent's registry ID
    GraphType.KNOWLEDGE,         // Knowledge graph type
    StorageBackend.IPFS,         // Off-chain storage
    bytes32 merkleRoot,          // Root of cascade trail Merkle tree
    bytes32 contentCID,          // IPFS CID of full trail data
    uint256 nodeCount,           // Number of responses anchored
    uint256 edgeCount            // Provider transition edges
) external returns (bytes32 graphId);
```

### 5.2 Verification Path

```
responseHash → ContextAnchor.verifyContextNode(graphId, responseHash, proof)
                 → true if responseHash is in the agent's anchored Merkle tree

agentId → AgentRegistry.getAgent(agentId)
            → modelHash (claimed)

cascadeTrail → extract actual provider/model from successful step
                → compare with claimed modelHash

Mismatch? → PairwiseVerifier.createTask() for governance dispute
```

### 5.3 Attestation as Proof of Mind

The binding creates a complete chain:

```
Agent Identity (AgentRegistry)
    ↓ agentId
Context Graph (ContextAnchor)
    ↓ merkleRoot contains responseHashes
Cascade Trail (Wardenclyffe _cascadeTrail)
    ↓ provider + model per attempt
Provider Attestation (_responseHash)
    ↓ SHA-256 unforgeable
Proof of Mind Chain (Layer 1)
```

Each link is independently verifiable. Breaking any link invalidates the attestation.

---

## 6. Security Analysis

### Attack: Mass Registration

**Cost without PoW**: Free (just gas for `registerAgent()`)
**Cost with PoW at d=28**: ~40 seconds of SHA-256 computation per agent
**At 1000 agents**: ~11 hours of continuous hashing
**Mitigation**: Difficulty auto-scales with rate, making burst attacks exponentially expensive

### Attack: Model Misrepresentation

**Detection**: Cascade trail patterns analyzed over time
**Cost of evasion**: Must actually use claimed model (paying for it), defeating the purpose
**Enforcement**: PairwiseVerifier + governance slashing

### Attack: Challenge Farming (Pre-compute answers)

**Defense**: Challenges use fresh random data (`crypto.randomBytes`) per generation
**Multi-round challenges**: `agent_marathon` requires sustained context across 4-10 rounds
**Temporal binding**: Responses must arrive within timeout window

### Attack: Sybil Governance Dilution

**Defense layers**:
1. PoW registration cost (economic)
2. Ongoing cognitive challenges (computational + cognitive)
3. `ContributionDAG` human vouchers (`_humanVouchers` mapping)
4. Capability expiration (`expiresAt` field on grants)
5. Reputation decay (inactive agents lose standing)

---

## References

- [Wardenclyffe Protocol](./wardenclyffe-protocol.md) — Layer 6 formal spec
- [AgentRegistry.sol](../../contracts/identity/AgentRegistry.sol) — ERC-8004 agent identities
- [ContextAnchor.sol](../../contracts/identity/ContextAnchor.sol) — On-chain context graph anchoring
- [PairwiseVerifier.sol](../../contracts/identity/PairwiseVerifier.sol) — CRPC verification protocol
- [ergon.ts](../../llm-hashcash/src/services/ergon.ts) — PoW primitives + `generateAgentRegistrationChallenge()`
- [challenges.ts](../../llm-hashcash/src/services/challenges.ts) — 10 cognitive challenge types
- [CKB Synergy](../../../.claude/nervos-intel.md) — PoW shared state + MMR integration <!-- FIXME: ../../../.claude/nervos-intel.md — target lives outside docs/ tree (e.g., ~/.claude/, sibling repo). Verify intent. -->
