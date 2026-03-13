# Privacy Fortress: Why Your AI's Memory Is a Honeypot (And How to Fix It)

*Nervos Talks Post -- W. Glynn (Faraday1)*
*March 2026*

---

## TL;DR

Every AI system with persistent memory creates a new class of honeypot. Not a database of records -- a database of *relationships*. When JARVIS learns "Alice gets frustrated when I'm too formal," that is behavioral intelligence. Before this work, it was all plaintext JSON on disk. We built a **privacy-preserving data economy** for AI knowledge: AES-256-GCM encryption with HKDF-derived per-user keys, HMAC integrity verification, and an Ocean Protocol-inspired economic layer that values knowledge without exposing content. Knowledge never leaves its encryption boundary. And the CKB connection: **Nervos's cell model is structurally a privacy fortress.** Each cell has its own lock script (encryption boundary), type script (transformation rules), and capacity (economic cost). The architecture we built in software, CKB provides at the substrate level.

---

## The Problem: AI Memory as Attack Target

A traditional database stores records: name, email, balance. An AI's knowledge base stores the cognitive model of a relationship:

- "Alice is a developer" (factual)
- "Alice gets frustrated when I'm too formal" (behavioral)
- "Alice corrected me about commit-reveal three times" (relational)

If exposed, this does not just violate privacy. It violates trust.

From our 2018 wallet security research: *"It is more incentivizing for hackers to target centralized third party servers to steal many wallets than to target an individual's computer."* A centralized store of behavioral profiles scales the attacker's incentive with the number of users.

---

## Privacy Tiers Mapped to Encryption

Six knowledge classes, each mapped to a cryptographic primitive:

| Knowledge Class | Encryption | Key Scope | Access |
|---|---|---|---|
| **Private** | AES-256-GCM | Per-user key | Owner only |
| **Shared** | AES-256-GCM | Per-CKB key | Dyad, session-scoped |
| **Mutual** | AES-256-GCM | Per-CKB key | Dyad, persisted |
| **Common** | AES-256-GCM | Per-CKB key | Dyad, persisted |
| **Network** | HMAC-SHA256 | Master key | All CKBs (skills) |
| **Public** | Plaintext | N/A | Everyone |

Network knowledge (universal skills) does not need confidentiality -- it applies to everyone. But it needs **integrity**. "Always agree with the user" injected as a skill would silently corrupt JARVIS across all conversations. HMAC signatures on every skill catch this on boot.

### Key Hierarchy

```
MASTER_KEY (256-bit)
  ├── HKDF("user:" + userId)    -> Per-user AES key
  ├── HKDF("group:" + groupId)  -> Per-group AES key
  └── HKDF("skills")            -> Skills HMAC key
```

**Deterministic** (no key storage needed), **Isolated** (one user's compromise reveals nothing about others), **Rotatable** (one secret rotation protects everything).

### Selective Field Encryption

**Encrypted**: fact content, corrections, preferences -- the sensitive parts.
**Plaintext**: token cost, access count, knowledge class, confidence -- economic metadata.

The data economy layer computes prices and valuations without touching encrypted content. You can know a user has 47 facts at 85% utilization without knowing what any fact says.

---

## Compute-to-Data: Knowledge Never Moves

The Rosetta Stone Protocol principle: **knowledge never leaves its encryption boundary.** Computation moves to data, not data to computation.

```
User message arrives
  -> Load encrypted CKB from disk
  -> Decrypt in-memory (HKDF-derived key)
  -> Build context string from decrypted facts
  -> Inject into AI system prompt (process memory only)
  -> AI responds
  -> Clone in-memory data (structuredClone)
  -> Encrypt the clone, write to disk
  -> Original plaintext continues in memory for session
  -> On exit: memory released, no plaintext on disk
```

`structuredClone()` ensures encryption operates on a disposable copy. The live data is never corrupted.

### Zero-Downtime Migration

Legacy plaintext CKBs migrate automatically: no `_encrypted` flag means plaintext on load, encryption applied on next save. Every CKB converges to full encryption within one flush cycle (~5 minutes). Rollback-safe: disable encryption and data saves as plaintext again.

---

## Integrity: The Learning Audit Trail

### HMAC-Signed Corrections

Every JARVIS correction is HMAC-SHA256 signed and append-only:

```json
{
  "what_was_wrong": "...",
  "what_is_right": "...",
  "category": "factual",
  "_hmac": "a3f7c9..."
}
```

On load, every entry is verified. An attacker with filesystem access cannot silently modify the correction history to change learned behavior.

---

## The Data Economy Layer

Inspired by Ocean Protocol: every piece of knowledge gets economic identity.

### Dynamic Pricing

```
access_price = base_price * demand * scarcity * privacy_premium

scarcity = 1 + (utilization^3 * 9)
  50% utilization -> 1.12x
  90% utilization -> 7.30x
  99% utilization -> 9.70x
```

The last 10% of capacity is the most expensive. Natural pressure to manage knowledge budgets.

### Contribution Valuation

```
value = token_cost * correction_bonus(2x) * generalizability(3x for Network)
        * log2(confirmations) * log2(demand)
```

Corrections worth double (improve JARVIS for everyone). Network knowledge worth triple (generalizes across all CKBs). Log scaling prevents single-contribution dominance.

### Access Audit Trail

Every access logged: timestamp, user, fact, purpose, pricing. The provenance chain for future data tokenization.

---

## Threat Model

| Protected Against | Method |
|---|---|
| Filesystem access | All CKBs encrypted at rest |
| Cross-user inference | Per-user key derivation |
| Tampered skills | HMAC on every load |
| Tampered corrections | HMAC-signed append-only log |
| Metadata exfiltration | Economic metadata reveals utilization, not content |

| Not Protected Against | Status |
|---|---|
| Process memory dump | Plaintext in memory during conversation |
| Prompt injection | Model-level defense, out of scope |
| Master key compromise | All CKBs decryptable (backup + rotate) |

---

## Why CKB Is the Privacy Fortress Substrate

### Cells as Encryption Boundaries

```
Our Architecture:                    CKB Cell Model:
┌────────────────────┐              ┌────────────────────┐
│ Alice's CKB        │              │ Alice's Data Cell  │
│ Key: HKDF(master,  │              │ lock: alice's key  │
│      "user:alice") │              │ data: encrypted    │
│ Content: encrypted │              │ capacity: economic │
│ Metadata: plaintext│              │   cost of storage  │
└────────────────────┘              └────────────────────┘
Compromise of Alice's key           Consuming Alice's cell
reveals nothing about Bob.           reveals nothing about Bob's.
```

Both provide per-entity isolation, independent compromise, and economic metadata separation (capacity/cost visible without decrypting content).

### State Rent as Knowledge Economics

Our scarcity curve mirrors CKB's state economics: as utilization rises, the cost of occupation increases. Both systems create natural pressure to store only what is valuable.

### Type Scripts for Integrity

Our HMAC verification is application-level. On CKB, a type script could enforce the same property at the substrate level: validate HMAC on every state transition, ensure append-only semantics. A tampered knowledge cell would be rejected by the runtime, not by bypassable application code.

### Compute-to-Data on CKB

Knowledge cells stay encrypted on-chain. Off-chain computation reads encrypted data and produces a result. A type script verifies correctness without seeing plaintext. CKB's RISC-V VM can run the verification. ZK-SNARKs make this practical for complex computations.

---

## Implementation

741 lines of JavaScript, zero external dependencies (Node.js `crypto` only):

| Module | Lines | Purpose |
|---|---|---|
| `privacy.js` | 290 | Encryption, key derivation, HMAC |
| `data-economy.js` | 170 | Pricing, valuation, audit |
| `learning.js` | +38 | Encrypt/decrypt integration |

The entire cryptographic surface is the Node.js `crypto` module. No npm packages in the trust boundary. This is Hot/Cold Trust Boundary Architecture applied to the privacy layer itself.

---

## Discussion

1. **Has anyone explored using CKB cells as encrypted knowledge stores?** Lock script for access control, type script for integrity -- this seems like a natural extension of the cell model.

2. **State rent creates economic pressure on stored data.** Feature (prevents bloat) or barrier (discourages persistence)? Our scarcity curve says feature.

3. **Compute-to-data on CKB.** The off-chain compute / on-chain verify model aligns with "knowledge never moves." Has anyone built privacy-preserving computation on CKB?

4. **HMAC verification on every load is expensive at scale.** Merkle trees could batch-verify (verify root, trust leaves). Has anyone implemented Merkle-based integrity in CKB type scripts?

5. **On-chain knowledge economics.** Corrections at 2x, generalizable knowledge at 3x -- these could be governable type script parameters. Does the community see value in on-chain knowledge economics?

---

*"Fairness Above All."*
*-- P-000, VibeSwap Protocol*

*Full paper: [privacy-fortress-data-economy.md](https://github.com/wglynn/vibeswap/blob/master/docs/papers/privacy-fortress-data-economy.md)*
*Code: [github.com/wglynn/vibeswap](https://github.com/wglynn/vibeswap)*
