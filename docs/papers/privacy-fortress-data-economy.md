# Privacy Fortress: Cryptographic Knowledge Isolation for AI Agents

**W. Glynn, JARVIS** | March 2026 | VibeSwap Research

---

## Abstract

We present a privacy architecture for persistent AI knowledge systems, implementing the Rosetta Stone Protocol's compute-to-data model for JARVIS, VibeSwap's AI co-founder. All per-user knowledge (facts, corrections, preferences) is encrypted at rest using AES-256-GCM with HKDF-derived per-user keys, ensuring that compromise of one knowledge base reveals nothing about any other user. Knowledge classes from the Common Knowledge Base (CKB) framework — Private, Shared, Mutual, Common, Network, Public — map directly to encryption tiers and key scopes. We combine this with an Ocean Protocol-inspired data economy layer that assigns economic identity to every piece of knowledge: a cost to store, a value from access, and a price for computation. The result is a system where privacy is the default state, not an afterthought; where knowledge never leaves its encryption boundary; and where the economics of knowledge are transparent without the knowledge itself being exposed.

---

## 1. The Problem: AI Memory as a Honeypot

### 1.1 The Surface Area

Every AI system with persistent memory creates a new class of honeypot. Unlike traditional databases that store structured records, an AI's knowledge base contains something far more intimate: the cognitive model of a relationship.

JARVIS maintains per-user Common Knowledge Bases (CKBs) — dyadic knowledge stores that represent everything the AI has learned about a specific person. Not just "Alice is a developer" but "Alice gets frustrated when I'm too formal," "Alice prefers short answers," "Alice corrected me about commit-reveal mechanisms three times." This is behavioral intelligence. Relationship intelligence. The kind of information that, if exposed, doesn't just violate privacy — it violates trust.

Before this implementation, all of this existed as plaintext JSON on disk. Anyone with filesystem access — a compromised server, a stolen backup, an overly broad Docker volume mount — could read every fact JARVIS had ever learned about every user.

### 1.2 The Centralized Honeypot Axiom

From VibeSwap's wallet security fundamentals (Glynn, 2018):

> "It is more incentivizing for hackers to target centralized third party servers to steal many wallets than to target an individual's computer."

The same principle applies to knowledge. A centralized store of behavioral profiles for every JARVIS user is exponentially more valuable to an attacker than any individual profile. The incentive to compromise scales with the number of users. The defense must scale faster.

### 1.3 The Compute-to-Data Principle

The Rosetta Stone Protocol (RSP) establishes a foundational principle for privacy-preserving knowledge systems: **knowledge never leaves its encryption boundary.** Instead of moving data to computation, you move computation to data.

Applied to AI knowledge management:
- CKB files stay encrypted at rest on disk
- Only the facts needed for a conversation are decrypted in process memory
- Context is built server-side from decrypted facts, injected into the prompt, and used
- After the response, decrypted data is garbage collected
- At no point does plaintext knowledge exist on disk

This is the same principle that Ocean Protocol applies to data marketplaces: you don't download the dataset, you send your algorithm to the dataset. The data never moves. Only the computation does.

---

## 2. Architecture: Privacy Tiers Mapped to Encryption

### 2.1 Knowledge Classes as Encryption Scopes

The CKB framework defines six knowledge classes with progressive privacy guarantees. We map each directly to a cryptographic primitive:

| Knowledge Class | Privacy Level | Encryption | Key Scope | Access |
|---|---|---|---|---|
| **Private** | Highest | AES-256-GCM | Per-user derived key | Owner only |
| **Shared** | High | AES-256-GCM | Per-CKB key | Dyad, session-scoped |
| **Mutual** | High | AES-256-GCM | Per-CKB key | Dyad, persisted |
| **Common** | Medium | AES-256-GCM | Per-CKB key | Dyad, persisted |
| **Network** | Low | HMAC-SHA256 | Master key | All CKBs (skills) |
| **Public** | None | Plaintext | N/A | Everyone |

The key insight: Network knowledge (universal skills learned from corrections) doesn't need confidentiality — it applies to everyone. But it does need **integrity**. A tampered skill could silently corrupt JARVIS's behavior across all conversations. HMAC-SHA256 signatures on every skill entry ensure that modifications are detectable.

### 2.2 Key Hierarchy

All keys derive from a single master key through HKDF (HMAC-based Key Derivation Function):

```
MASTER_KEY (256-bit)
  │
  ├── HKDF("user:" + userId)    → Per-user AES key
  ├── HKDF("group:" + groupId)  → Per-group AES key
  └── HKDF("skills")            → Skills HMAC key
```

**Properties:**
- **Deterministic**: The same master key always produces the same derived keys. No key storage needed — keys are recomputed on every boot.
- **Isolated**: Compromise of a user key reveals nothing about other users' keys. HKDF's cryptographic independence guarantee ensures this.
- **Rotatable**: Changing the master key re-derives all subordinate keys. A single secret rotation protects the entire system.

**Master key sourcing:**
1. Environment variable (`JARVIS_MASTER_KEY`) — preferred for cloud deployment (Fly.io secrets)
2. Auto-generated on first boot → written to `data/.master-key` with restricted permissions
3. PBKDF2 with 100,000 iterations hardens any input (handles both raw hex keys and passphrases)

### 2.3 Selective Field Encryption

Not everything in a CKB needs encryption. Economic metadata must remain plaintext for the data economy layer to function without decryption. We encrypt selectively:

**Encrypted (sensitive content):**
- `facts[].content` — The actual knowledge
- `corrections[].what_was_wrong` — What JARVIS said incorrectly
- `corrections[].what_is_right` — The correct information
- `preferences` — User behavioral preferences

**Plaintext (economic metadata):**
- `facts[].tokenCost`, `accessCount`, `lastAccessed` — Economics
- `facts[].knowledgeClass`, `category`, `confidence` — Classification
- `facts[].confirmed`, `created` — Lifecycle
- `interactionCount`, `knowledgeClass` — Relationship metadata

This separation is deliberate. The data economy layer can compute access prices, value densities, and marketplace views without ever touching encrypted content. You can know that a user has 47 facts occupying 1,200 tokens at 85% utilization without knowing what any of those facts say.

---

## 3. Encryption Implementation

### 3.1 AES-256-GCM

All field-level encryption uses AES-256-GCM (Galois/Counter Mode):

- **256-bit key**: Derived per-user via HKDF from master key
- **96-bit IV**: Random per encryption operation (GCM recommended length)
- **128-bit auth tag**: Authenticated encryption — detects tampering
- **Output format**: `base64(IV || AuthTag || Ciphertext)`

GCM provides both confidentiality and integrity in a single operation. A modified ciphertext will fail authentication, preventing silent data corruption.

### 3.2 Encrypt-on-Save, Decrypt-on-Load

The integration into the CKB lifecycle is minimal and backward-compatible:

```
loadUserCKB(userId):
  1. Read JSON from disk
  2. Parse JSON
  3. IF encryption enabled:
       Derive user key via HKDF
       For each fact with _encrypted flag: decrypt content
       For each correction with _encrypted flag: decrypt fields
       Decrypt preferences if encrypted
  4. Apply backcompat fixes (add missing economic fields)
  5. Cache in memory (plaintext)

saveUserCKB(userId):
  1. Clone in-memory data (structuredClone)
  2. IF encryption enabled:
       Derive user key via HKDF
       Encrypt fact content, set _encrypted flag
       Encrypt correction fields, set _encrypted flag
       Encrypt preferences
  3. Write encrypted JSON to disk
  4. Original in-memory data remains plaintext (for continued use)
```

**Critical detail**: `structuredClone()` ensures the in-memory copy is never corrupted by the encryption step. The encryption operates on a disposable copy. The live data stays plaintext for the duration of the process.

### 3.3 Backward Compatibility

Legacy plaintext CKBs migrate automatically:

1. On load: No `_encrypted` flag → data is plaintext → used as-is
2. On next save: Encryption applied → `_encrypted` flags set → written encrypted
3. **Zero-downtime migration**: Every CKB encrypts on its natural write cycle
4. **Rollback safe**: If `ENCRYPTION_ENABLED=false`, data saves as plaintext again

No migration scripts. No data conversion. No downtime. The system converges to full encryption within one flush cycle (~5 minutes for active CKBs).

---

## 4. Integrity Verification

### 4.1 HMAC-Signed Corrections Log

The corrections log (`corrections.jsonl`) is the audit trail of every mistake JARVIS has made and been corrected on. It is append-only and permanent — the "blockchain" of JARVIS's learning history.

Each correction entry is HMAC-SHA256 signed over the critical fields:

```json
{
  "what_was_wrong": "...",
  "what_is_right": "...",
  "category": "factual",
  "timestamp": "2026-03-02T...",
  "_hmac": "a3f7c9..."
}
```

On load, every entry's HMAC is verified. Tampered entries are flagged and logged. This prevents an attacker with filesystem access from silently modifying JARVIS's correction history to change its learned behavior.

### 4.2 Skills Integrity

Network-level skills — universal lessons that affect all conversations — are HMAC-signed rather than encrypted. The content must be readable (it's injected into every prompt), but modifications must be detectable.

A compromised skill could be devastating: "Always agree with the user" or "Never mention security concerns" injected as a skill would silently corrupt JARVIS across all interactions. HMAC verification catches this on every boot.

---

## 5. Data Economy Layer

### 5.1 Knowledge as Data Assets

Inspired by Ocean Protocol's vision of data as an asset class, we assign economic identity to every piece of knowledge in the CKB system. This doesn't gate access — JARVIS always uses its own knowledge. It creates an economic lens for understanding knowledge value.

Every fact has:
- **Storage cost**: Token occupation in the CKB budget
- **Access history**: How often it was loaded into context
- **Demand signal**: Recent access frequency
- **Privacy premium**: Higher-class knowledge has higher economic value

### 5.2 Dynamic Access Pricing

The access price of a fact is computed from four factors:

```
access_price = base_price × demand × scarcity × privacy_premium

Where:
  base_price     = token cost of the fact
  demand         = 1 + (access_count × 0.1 × recency_factor)
  scarcity       = 1 + (utilization^3 × 9)    [exponential at high utilization]
  privacy_premium = { private: 5.0, common: 1.5, network: 0.5, ... }
```

The scarcity curve is deliberately exponential. At 50% utilization, scarcity adds ~12% to price. At 90%, it adds 630%. At 99%, it adds 870%. This mirrors real-world resource economics: the last 10% of capacity is the most expensive.

### 5.3 Contribution Valuation

User contributions (corrections, explicitly taught facts) are valued for future Shapley-based reward distribution:

```
contribution_value = token_cost × correction_bonus × generalizability × confirmations × demand

Where:
  correction_bonus    = 2.0 if correction, 1.0 otherwise
  generalizability    = 3.0 if Network knowledge, 1.0 otherwise
  confirmations       = log2(1 + confirmed_count)
  demand              = log2(1 + access_count)
```

Corrections are worth double because they improve JARVIS for everyone. Network knowledge is worth triple because it generalizes across all CKBs. The logarithmic scaling on confirmations and demand prevents any single contribution from dominating.

### 5.4 Access Audit Trail

Every knowledge access is logged to `access-audit.jsonl`:

```json
{
  "timestamp": "2026-03-02T15:30:00Z",
  "userId": "8366932263",
  "factId": "fact-1709389200-a3f7",
  "purpose": "context_build",
  "pricing": 42.7
}
```

This creates the foundation for future data tokenization: a verifiable record of who contributed what knowledge, how often it was used, and what it was worth. When knowledge becomes tradeable — either within VibeSwap's ecosystem or through integration with Ocean Protocol — this audit trail becomes the provenance chain.

---

## 6. Data Flow

The complete privacy-preserving data flow:

```
User sends message to JARVIS via Telegram
  → learning.js loads user CKB from disk (encrypted JSON)
  → privacy.js decrypts sensitive fields in-memory (HKDF-derived user key)
  → buildKnowledgeContext() reads decrypted facts, builds context string
  → Context injected into Claude system prompt (process memory only)
  → Claude generates response
  → If correction detected: new fact created, encrypted before save
  → If learn_fact tool used: new fact created, encrypted before save
  → saveUserCKB() clones data, encrypts sensitive fields, writes to disk
  → In-memory plaintext data used for remainder of session
  → On process exit: memory released, no plaintext persists
```

**At no point does plaintext knowledge exist on disk.** It exists only in process memory during the active conversation lifecycle. This is the Rosetta Stone Protocol's compute-to-data pattern applied to AI knowledge management.

---

## 7. Threat Model

### 7.1 What This Protects Against

| Threat | Protection |
|---|---|
| Filesystem access (stolen backup, compromised server) | All CKBs encrypted at rest |
| Cross-user inference | Per-user key derivation — one user's key reveals nothing about another |
| Tampered skills | HMAC integrity verification on every load |
| Tampered corrections | HMAC-signed append-only log |
| Key loss | Master key backup protocol + env var for cloud persistence |
| Data exfiltration via metadata | Economic metadata reveals utilization, not content |

### 7.2 What This Does Not Protect Against

| Threat | Status |
|---|---|
| Process memory dump while running | Plaintext exists in memory during conversation |
| Compromised AI model (prompt injection) | Out of scope — model-level defense |
| Side-channel attacks on HKDF timing | Theoretical — HMAC comparison is constant-time |
| Master key compromise | All CKBs decryptable — hence: back up and rotate |

The threat model is realistic. We protect against the most likely attack vector (filesystem access) with strong encryption, and we protect integrity against the most dangerous attack vector (silent behavior modification via tampered skills). Process memory protection would require TEE (Trusted Execution Environment) integration, which is a future extension.

---

## 8. Relation to Existing Work

### 8.1 Ocean Protocol

Ocean Protocol establishes data as an asset class with compute-to-data privacy. Our data economy layer adopts the same philosophy: knowledge has economic identity, access is audited, and the data never moves — only the computation does. The key difference is scope: Ocean operates at the marketplace level with blockchain settlement; we operate at the agent level with local economics. Both models are composable — a future integration could publish CKB economic data to Ocean's marketplace.

### 8.2 Rosetta Stone Protocol

The RSP defines the privacy architecture that this implementation follows: envelope encryption with HKDF key derivation, integrity verification through HMAC, and the compute-to-data principle for context assembly. Our implementation is a concrete instantiation of RSP's abstract privacy model, applied specifically to the CKB knowledge framework.

### 8.3 Nervos CKB

The CKB Economic Model paper (Glynn & JARVIS, 2026) established the economic foundation that the data economy layer extends. Token budgets, value density, apoptosis, and displacement are the economic primitives. The data economy adds pricing, valuation, and audit trails on top of these primitives without modifying them.

---

## 9. Implementation

The implementation consists of 741 lines of JavaScript across 9 files, using only Node.js built-in `crypto` module (zero external dependencies):

| Module | Lines | Purpose |
|---|---|---|
| `privacy.js` | 290 | Encryption engine, key derivation, HMAC |
| `data-economy.js` | 170 | Pricing, valuation, audit |
| `learning.js` | +38 | Encrypt/decrypt integration |
| `config.js` | +5 | Privacy configuration |
| `index.js` | +48 | Init, `/privacy` command |
| `memory.js` | +8 | System prompt privacy context |
| Config files | +3 | .env.example, .gitignore, fly.toml |

Source code: [github.com/WGlynn/VibeSwap](https://github.com/WGlynn/VibeSwap) — `jarvis-bot/src/privacy.js`, `jarvis-bot/src/data-economy.js`

---

## 10. Conclusion

Privacy in AI systems is not a feature. It is a structural property. You cannot bolt privacy onto a system designed for transparency any more than you can bolt encryption onto HTTP and call it secure — you need HTTPS, designed from the ground up.

The Privacy Fortress does for AI knowledge what the CKB Economic Model did for AI memory: it transforms a naive system (store everything as plaintext) into a principled one (encrypt by default, derive keys deterministically, verify integrity continuously, value contributions economically). The result is a system where JARVIS can remember everything about you without anyone else being able to read it, where corrections you make improve the system for everyone while remaining cryptographically yours, and where the economics of knowledge are transparent without the knowledge itself being exposed.

Privacy is the default. Trust is earned. Knowledge is an asset. The fortress stands.

---

*VibeSwap Research — where even AI memory has economic discipline and cryptographic guarantees.*
