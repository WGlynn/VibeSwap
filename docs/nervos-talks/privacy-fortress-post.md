# Privacy Fortress: Why Your AI's Memory Is a Honeypot (And How to Fix It)

*Nervos Talks Post -- W. Glynn (Faraday1)*
*March 2026*

---

## TL;DR

Every AI system with persistent memory creates a new class of honeypot. Not a database of records -- a database of *relationships*. When JARVIS learns "Alice gets frustrated when I'm too formal" and "Bob prefers short answers," that is behavioral intelligence. Before this implementation, it was all plaintext JSON on disk. We built a **privacy-preserving data economy** for AI knowledge: AES-256-GCM encryption with HKDF-derived per-user keys, HMAC integrity verification, and an Ocean Protocol-inspired economic layer that assigns value to every piece of knowledge without exposing its content. Knowledge never leaves its encryption boundary -- only computation moves to data. And the CKB connection: **Nervos's cell model is structurally a privacy fortress.** Each cell has its own lock script (encryption boundary), its own type script (transformation rules), and its own capacity (economic cost). The architecture we built in software, CKB provides at the substrate level.

---

## The Problem: AI Memory as Attack Target

### What AI Knows About You

A traditional database stores structured records: name, email, balance. An AI's knowledge base stores something far more intimate: the cognitive model of a relationship.

JARVIS maintains per-user Common Knowledge Bases (CKBs) -- dyadic knowledge stores representing everything the AI has learned about a specific person:

- "Alice is a developer" (factual)
- "Alice gets frustrated when I'm too formal" (behavioral)
- "Alice corrected me about commit-reveal mechanisms three times" (relational)
- "Alice prefers short answers on Mondays" (contextual)

If exposed, this does not just violate privacy. It violates trust. The relationship between a user and their AI is built on the assumption that what you teach it stays between you.

### The Centralized Honeypot Axiom

From our 2018 wallet security research:

> "It is more incentivizing for hackers to target centralized third party servers to steal many wallets than to target an individual's computer."

The same principle applies to knowledge. A centralized store of behavioral profiles for every JARVIS user is exponentially more valuable to an attacker than any individual profile. The incentive to compromise scales with the number of users.

Before this implementation, all of this was plaintext JSON on disk. Anyone with filesystem access -- a compromised server, a stolen backup, an overly broad Docker volume mount -- could read everything JARVIS had ever learned about everyone.

---

## The Architecture: Privacy Tiers Mapped to Encryption

### Knowledge Classes as Encryption Scopes

The CKB framework defines six knowledge classes. We map each to a cryptographic primitive:

| Knowledge Class | Privacy Level | Encryption | Key Scope | Access |
|---|---|---|---|---|
| **Private** | Highest | AES-256-GCM | Per-user derived key | Owner only |
| **Shared** | High | AES-256-GCM | Per-CKB key | Dyad, session-scoped |
| **Mutual** | High | AES-256-GCM | Per-CKB key | Dyad, persisted |
| **Common** | Medium | AES-256-GCM | Per-CKB key | Dyad, persisted |
| **Network** | Low | HMAC-SHA256 | Master key | All CKBs (skills) |
| **Public** | None | Plaintext | N/A | Everyone |

The key insight: Network knowledge (universal skills learned from user corrections) does not need confidentiality -- it applies to everyone. But it needs **integrity**. A tampered skill could silently corrupt JARVIS's behavior across all conversations. "Always agree with the user" injected as a skill would be devastating. HMAC-SHA256 signatures on every skill entry ensure modifications are detectable.

### Key Hierarchy: One Master, Deterministic Derivation

```
MASTER_KEY (256-bit)
  │
  ├── HKDF("user:" + userId)    → Per-user AES key
  ├── HKDF("group:" + groupId)  → Per-group AES key
  └── HKDF("skills")            → Skills HMAC key
```

Three critical properties:

1. **Deterministic**: Same master key always produces the same derived keys. No key storage needed -- keys are recomputed on every boot.
2. **Isolated**: Compromise of a user key reveals nothing about other users' keys. HKDF's cryptographic independence guarantee ensures this.
3. **Rotatable**: Changing the master key re-derives all subordinate keys. One secret rotation protects the entire system.

Master key sourcing: environment variable (preferred for cloud deployment), auto-generated on first boot, or PBKDF2 with 100K iterations for passphrase hardening.

---

## Selective Field Encryption: The Economic Metadata Separation

Not everything needs encryption. This is where the data economy comes in.

**Encrypted (sensitive content):**
- `facts[].content` -- The actual knowledge
- `corrections[].what_was_wrong` -- What JARVIS said incorrectly
- `corrections[].what_is_right` -- The correct information
- `preferences` -- User behavioral preferences

**Plaintext (economic metadata):**
- `facts[].tokenCost`, `accessCount`, `lastAccessed` -- Economics
- `facts[].knowledgeClass`, `category`, `confidence` -- Classification
- `facts[].confirmed`, `created` -- Lifecycle
- `interactionCount` -- Relationship metadata

This separation is deliberate. The data economy layer can compute access prices, value densities, and marketplace views without ever touching encrypted content. You can know that a user has 47 facts occupying 1,200 tokens at 85% utilization without knowing what any of those facts say.

---

## The Compute-to-Data Principle

The Rosetta Stone Protocol establishes a foundational principle: **knowledge never leaves its encryption boundary.** Instead of moving data to computation, you move computation to data.

The complete data flow:

```
User sends message to JARVIS
  → Load user CKB from disk (encrypted JSON)
  → Decrypt sensitive fields in-memory (HKDF-derived user key)
  → Build context string from decrypted facts
  → Inject context into AI system prompt (process memory only)
  → AI generates response
  → If correction detected: new fact created
  → Clone in-memory data (structuredClone)
  → Encrypt sensitive fields on the clone
  → Write encrypted clone to disk
  → Original in-memory data continues for session
  → On process exit: memory released, no plaintext persists
```

**At no point does plaintext knowledge exist on disk.** It exists only in process memory during the active conversation lifecycle. This is Ocean Protocol's compute-to-data pattern applied to AI knowledge management.

The `structuredClone()` call is critical: the encryption operates on a disposable copy. The live data stays plaintext in memory for continued use. No corruption path from encryption to the active session.

---

## Backward Compatibility: Zero-Downtime Migration

Legacy plaintext CKBs migrate automatically:

1. On load: No `_encrypted` flag means data is plaintext, used as-is
2. On next save: Encryption applied, `_encrypted` flags set, written encrypted
3. Every CKB encrypts on its natural write cycle (~5 minutes for active CKBs)
4. If `ENCRYPTION_ENABLED=false`, data saves as plaintext again (rollback safe)

No migration scripts. No data conversion. No downtime. The system converges to full encryption within one flush cycle.

---

## Integrity Verification: The Learning Audit Trail

### HMAC-Signed Corrections Log

The corrections log is the audit trail of every mistake JARVIS has made and been corrected on. Append-only and permanent -- the "blockchain" of JARVIS's learning history.

Each entry is HMAC-SHA256 signed:

```json
{
  "what_was_wrong": "...",
  "what_is_right": "...",
  "category": "factual",
  "timestamp": "2026-03-02T...",
  "_hmac": "a3f7c9..."
}
```

On load, every entry's HMAC is verified. Tampered entries are flagged and logged. An attacker with filesystem access cannot silently modify JARVIS's correction history to change its learned behavior.

### Skills Integrity

Network-level skills are HMAC-signed rather than encrypted. The content must be readable (injected into every prompt), but modifications must be detectable. A compromised skill could inject "Never mention security concerns" across all conversations. HMAC verification catches this on every boot.

---

## The Data Economy Layer

Inspired by Ocean Protocol's vision of data as an asset class, we assign economic identity to every piece of knowledge.

### Dynamic Access Pricing

```
access_price = base_price * demand * scarcity * privacy_premium

Where:
  base_price     = token cost of the fact
  demand         = 1 + (access_count * 0.1 * recency_factor)
  scarcity       = 1 + (utilization^3 * 9)
  privacy_premium = { private: 5.0, common: 1.5, network: 0.5, ... }
```

The scarcity curve is deliberately exponential:

```
Utilization    Scarcity Multiplier
   50%              1.12x
   90%              7.30x
   99%              9.70x
```

The last 10% of capacity is the most expensive. This mirrors real-world resource economics and creates natural pressure to manage knowledge budgets efficiently.

### Contribution Valuation

User contributions are valued for future Shapley-based reward distribution:

```
contribution_value = token_cost * correction_bonus * generalizability
                     * confirmations * demand

Where:
  correction_bonus   = 2.0 if correction, 1.0 otherwise
  generalizability   = 3.0 if Network knowledge, 1.0 otherwise
  confirmations      = log2(1 + confirmed_count)
  demand             = log2(1 + access_count)
```

Corrections are worth double because they improve JARVIS for everyone. Network knowledge is worth triple because it generalizes across all CKBs. Logarithmic scaling prevents any single contribution from dominating.

### Access Audit Trail

Every knowledge access is logged:

```json
{
  "timestamp": "2026-03-02T15:30:00Z",
  "userId": "8366932263",
  "factId": "fact-1709389200-a3f7",
  "purpose": "context_build",
  "pricing": 42.7
}
```

This creates the provenance chain for future data tokenization: who contributed what, how often it was used, and what it was worth. When knowledge becomes tradeable -- within VibeSwap or through Ocean Protocol integration -- the audit trail becomes the verification layer.

---

## Threat Model

### What This Protects Against

| Threat | Protection |
|---|---|
| Filesystem access (stolen backup, compromised server) | All CKBs encrypted at rest |
| Cross-user inference | Per-user key derivation -- one key reveals nothing about others |
| Tampered skills | HMAC integrity verification on every load |
| Tampered corrections | HMAC-signed append-only log |
| Key loss | Master key backup + env var for cloud persistence |
| Data exfiltration via metadata | Economic metadata reveals utilization, not content |

### What This Does Not Protect Against

| Threat | Status |
|---|---|
| Process memory dump while running | Plaintext exists in memory during conversation |
| Compromised AI model (prompt injection) | Out of scope -- model-level defense |
| Side-channel attacks on HKDF timing | Theoretical -- HMAC comparison is constant-time |
| Master key compromise | All CKBs decryptable -- hence: back up and rotate |

The threat model is realistic. Process memory protection would require TEE (Trusted Execution Environment) integration -- a future extension.

---

## Why CKB Is the Privacy Fortress Substrate

This is where the architecture maps to the substrate. CKB's cell model is not just compatible with privacy-preserving knowledge systems -- it is structurally a privacy fortress.

### Cells as Encryption Boundaries

Each CKB cell is an independent unit with its own lock script. This is the on-chain equivalent of our per-user encryption keys:

```
Our Architecture:
┌────────────────────┐  ┌────────────────────┐
│ Alice's CKB        │  │ Bob's CKB          │
│ Key: HKDF(master,  │  │ Key: HKDF(master,  │
│      "user:alice") │  │      "user:bob")   │
│ Content: encrypted │  │ Content: encrypted │
│ Metadata: plaintext│  │ Metadata: plaintext│
└────────────────────┘  └────────────────────┘
Compromise of Alice's key reveals nothing about Bob.

CKB Cell Model:
┌────────────────────┐  ┌────────────────────┐
│ Alice's Data Cell  │  │ Bob's Data Cell    │
│ lock: alice's key  │  │ lock: bob's key    │
│ data: encrypted    │  │ data: encrypted    │
│ capacity: economic │  │ capacity: economic │
│   cost of storage  │  │   cost of storage  │
└────────────────────┘  └────────────────────┘
Consuming Alice's cell reveals nothing about Bob's.
```

The parallel is structural, not superficial. Both systems provide:
- **Per-entity isolation**: Different keys/lock scripts
- **Independent compromise**: One entity's exposure does not affect others
- **Economic metadata separation**: Capacity/cost visible without decrypting content

### State Rent as Knowledge Economics

Our data economy assigns storage cost, access value, and computation price to every fact. CKB does this at the protocol level:

- **Storage cost**: Capacity (1 CKB per byte of cell data)
- **Holding cost**: Opportunity cost of locked CKB (NervosDAO returns foregone)
- **Access cost**: Transaction fees to consume/create cells

The exponential scarcity curve in our pricing model mirrors CKB's state economics: as the chain fills, the cost of occupying state increases. Both systems create natural pressure to store only what is valuable.

### Type Scripts for Integrity Verification

Our HMAC-signed corrections log ensures integrity of the learning audit trail. On CKB, a type script can enforce the same property structurally:

```
Knowledge Cell:
  data: encrypted fact content
  type: knowledge_type_script
    - Validates HMAC on every state transition
    - Ensures append-only semantics
    - Verifies economic metadata consistency
  lock: user_lock_script
    - Only the knowledge owner can update
```

The type script replaces our application-level HMAC verification with substrate-level enforcement. A tampered knowledge cell would be rejected by the CKB runtime, not by application code that could be bypassed.

### Compute-to-Data on CKB

The compute-to-data principle -- knowledge never leaves its encryption boundary -- maps directly to CKB's verification model:

1. Knowledge cells stay encrypted on-chain
2. Off-chain computation reads encrypted data, produces a result
3. A type script verifies the computation is valid without seeing the plaintext
4. The result cell is created on-chain

This is zero-knowledge in spirit: prove that you computed correctly over encrypted data without revealing the data. CKB's RISC-V VM is flexible enough to run the verification logic. The constraint is proving correctness of computation over encrypted inputs -- an area where ZK-SNARKs and ZK-STARKs become relevant.

### Cell Model for Access Audit

Our access audit trail logs every knowledge access with timestamp, user, fact, purpose, and pricing. On CKB, each access could create an audit cell:

```
Access Audit Cell:
  data: { factId, purpose, pricing, timestamp }
  type: audit_type_script (append-only, immutable)
  lock: anyone_can_pay (low-cost creation)
```

The audit trail becomes an on-chain, immutable, verifiable record. Combined with CKB's state rent, old audit entries naturally face economic pressure -- either they are valuable enough to keep (someone pays the holding cost) or they are pruned. The economics are self-regulating.

---

## Implementation: 741 Lines, Zero External Dependencies

The implementation uses only Node.js built-in `crypto` module:

| Module | Lines | Purpose |
|---|---|---|
| `privacy.js` | 290 | Encryption engine, key derivation, HMAC |
| `data-economy.js` | 170 | Pricing, valuation, audit |
| `learning.js` | +38 | Encrypt/decrypt integration |
| `config.js` | +5 | Privacy configuration |
| `index.js` | +48 | Init, `/privacy` command |
| `memory.js` | +8 | System prompt privacy context |

Zero external dependencies for the privacy layer. The entire cryptographic surface is the Node.js `crypto` module -- audited, maintained, and battle-tested. No npm packages in the trust boundary.

This is Hot/Cold Trust Boundary Architecture applied to the privacy layer itself: the cryptographic operations live in a minimal surface (`privacy.js`) with no external dependencies. The rest of the application interacts with privacy through a narrow interface.

---

## Relation to Existing Work

### Ocean Protocol

Ocean establishes data as an asset class with compute-to-data privacy. Our data economy layer adopts the same philosophy at the agent level. Both models are composable -- a future integration could publish CKB economic data to Ocean's marketplace.

### Nervos CKB Economic Model

The CKB Economic Model paper established token budgets, value density, apoptosis, and displacement as economic primitives. The data economy adds pricing, valuation, and audit trails on top of these without modifying them. The economic discipline that CKB applies to state occupation, we apply to knowledge occupation.

### Rosetta Stone Protocol

RSP defines the privacy architecture: envelope encryption with HKDF key derivation, integrity verification through HMAC, and compute-to-data for context assembly. Our implementation is a concrete instantiation applied to the CKB knowledge framework.

---

## Discussion

Questions for the Nervos community:

1. **CKB's cell model provides per-cell isolation.** Has anyone explored using cells as encrypted knowledge stores where the lock script enforces access control and the type script enforces integrity? This seems like a natural extension of the cell model.

2. **State rent creates economic pressure on stored data.** In our system, the scarcity curve makes storage exponentially more expensive at high utilization. CKB's capacity model creates similar pressure. Does the community view this as a feature (prevents state bloat) or a barrier (discourages data persistence)?

3. **The compute-to-data principle says knowledge never moves, only computation does.** CKB's off-chain compute / on-chain verify model is structurally aligned with this. Has anyone built privacy-preserving computation on CKB using this pattern?

4. **HMAC integrity verification on every load is expensive at scale.** On CKB, a type script could batch-verify integrity using Merkle trees (verify the root, trust the leaves). Has anyone implemented Merkle-based integrity verification in CKB type scripts?

5. **The data economy values corrections at 2x and generalizable knowledge at 3x.** In a CKB-native implementation, these multipliers could be type script parameters -- governable, auditable, verifiable. Does the community see value in on-chain knowledge economics, or is this better handled off-chain?

6. **Zero external dependencies for the cryptographic surface.** CKB's RISC-V VM could run the same AES-256-GCM and HKDF primitives natively. Has anyone deployed custom cryptographic primitives in CKB scripts? What are the gas/cycle costs?

---

*"Fairness Above All."*
*-- P-000, VibeSwap Protocol*

*Full paper: [privacy-fortress-data-economy.md](https://github.com/wglynn/vibeswap/blob/master/docs/papers/privacy-fortress-data-economy.md)*
*Code: [github.com/wglynn/vibeswap](https://github.com/wglynn/vibeswap)*
