# CKB × CKB
## Why the Cell Model is Perfect for Common Knowledge

**Talk for Nervos Community**
**Speaker**: Will Glynn
**Draft**: v0.1

---

## The Coincidence That Isn't (1 min)

**CKB** = Common Knowledge Base (epistemology)
**CKB** = Common Knowledge Byte (Nervos blockchain)

Same acronym. Same concept. Different domains.

This isn't an accident. It's convergent design.

Both solve the same fundamental problem: **How do independent parties establish shared truth?**

---

## What is Common Knowledge? (2 min)

### The Formal Definition

Common knowledge isn't just "we both know X."

```
Common Knowledge of X:
├── Alice knows X
├── Bob knows X
├── Alice knows that Bob knows X
├── Bob knows that Alice knows X
├── Alice knows that Bob knows that Alice knows X
├── Bob knows that Alice knows that Bob knows X
└── ... (infinite recursion)
```

**Both know, and both know that both know, infinitely nested.**

### Why It Matters

Without common knowledge, coordination fails.

**Example**: Two generals problem
- General A: "Attack at dawn"
- General B: "Got it" (but did A receive this confirmation?)
- General A: "Confirmed" (but did B receive THIS confirmation?)
- ... infinite regress

**With common knowledge**: Both generals SEE the same beacon fire. No confirmation needed. The shared observation IS the coordination.

---

## The Blockchain as Common Knowledge Machine (2 min)

Blockchains solve the two generals problem.

```
┌─────────────────────────────────────────────────────────┐
│  BLOCK #1000                                            │
│  ─────────────────────────────────────────────────────  │
│  TX: Alice sends 10 CKB to Bob                          │
│                                                         │
│  After confirmation:                                    │
│  ├── Alice knows the transfer happened                  │
│  ├── Bob knows the transfer happened                    │
│  ├── Alice knows Bob knows (same chain)                 │
│  ├── Bob knows Alice knows (same chain)                 │
│  └── Everyone knows everyone knows (public ledger)      │
└─────────────────────────────────────────────────────────┘
```

**The blockchain IS the beacon fire.**

Shared observation. No confirmation loops. Common knowledge by construction.

---

## Why Cells Map to Knowledge (3 min)

### Knowledge Has Properties Like Cells

| Property | Knowledge | CKB Cell |
|----------|-----------|----------|
| **Exists independently** | Facts exist whether observed or not | Cells exist on-chain |
| **Has provenance** | Knowledge comes from somewhere | Cells have transaction history |
| **Can be transformed** | Learning creates new knowledge | Spending creates new cells |
| **Consumed on use** | Using knowledge changes it | Inputs consumed, outputs created |
| **Has ownership** | Some knowledge is private | Cells have lock scripts |
| **Has validity rules** | Knowledge can be true/false | Cells have type scripts |

### The UTXO Model as Epistemology

**Account model** = Central database of beliefs
```
BeliefDB:
  Alice.beliefs = ["sky is blue", "water is wet", ...]
  Bob.beliefs = ["sky is blue", "grass is green", ...]
```
Problems:
- Who maintains the database?
- How do we know it's not corrupted?
- Beliefs aren't discrete—they blur together

**Cell model** = Independent knowledge atoms
```
┌─────────────┐  ┌─────────────┐  ┌─────────────┐
│ Knowledge   │  │ Knowledge   │  │ Knowledge   │
│ Cell #1     │  │ Cell #2     │  │ Cell #3     │
│             │  │             │  │             │
│ "Sky is     │  │ "Because    │  │ "Therefore  │
│  blue"      │  │  light      │  │  sunsets    │
│             │  │  scatters"  │  │  are red"   │
│ provenance: │  │ provenance: │  │ provenance: │
│ observation │  │ physics     │  │ cell #1+#2  │
└─────────────┘  └─────────────┘  └─────────────┘
```
Each knowledge atom:
- Exists independently
- Has clear provenance
- Can be combined to derive new knowledge
- Maintains its own validity

---

## Lock Scripts as Epistemic Access (2 min)

**Who can KNOW something?**

### Public Knowledge
```
Lock Script: ANYONE_CAN_SPEND
─────────────────────────────
Data: "VibeSwap uses batch auctions"

Anyone can read. Anyone can reference.
Public documentation. Open source.
```

### Private Knowledge
```
Lock Script: OWNER_SIGNATURE_REQUIRED
─────────────────────────────────────
Data: "My seed phrase is..."

Only owner can access.
Private keys. Personal secrets.
```

### Shared Knowledge (Dyadic)
```
Lock Script: MULTISIG(Alice, Bob)
─────────────────────────────────
Data: "Our shared project plan"

Only Alice AND Bob can modify.
Common knowledge between two parties.
```

### Conditional Knowledge
```
Lock Script: IF time > X THEN ANYONE ELSE OWNER
───────────────────────────────────────────────
Data: "Embargoed research results"

Private until timestamp, then public.
Knowledge with temporal conditions.
```

---

## Type Scripts as Truth Validation (2 min)

**How do we know knowledge is VALID?**

### The Problem
Not all claims are true. Not all data is valid.

```
Claim: "I have 1000 BTC"
Reality: I have 0.001 BTC
```

### Type Scripts as Validators

```
Type Script: VERIFIED_BALANCE
─────────────────────────────
Validates:
├── Balance matches UTXO sum
├── No double-counting
├── Provenance chain intact
└── Cryptographic proofs valid

If validation fails → Cell cannot exist
```

**Invalid knowledge cannot be recorded.**

The chain only contains cells that passed validation. Common knowledge is guaranteed to be internally consistent.

---

## Provenance: The Chain of Knowing (2 min)

### Every Cell Has History

```
Genesis Cell: "Axiom: 1 + 1 = 2"
     │
     ▼ (used to derive)
Cell #2: "Theorem: 2 + 2 = 4"
     │
     ▼ (used to derive)
Cell #3: "Corollary: 4 + 4 = 8"
```

**Knowledge isn't created from nothing. It's derived from prior knowledge.**

### The CKB Provenance Chain

```
┌─────────────────────────────────────────────────────────┐
│  Cell: "VibeSwap batch #1000 cleared at $1.05"          │
│  ─────────────────────────────────────────────────────  │
│  Provenance:                                            │
│  ├── Input: Commit cells #1-#500                        │
│  ├── Input: Previous pool state                         │
│  ├── Validation: batch_settlement_type                  │
│  └── Witness: Aggregated signatures                     │
│                                                         │
│  Anyone can verify this knowledge is legitimate         │
│  by tracing the provenance chain.                       │
└─────────────────────────────────────────────────────────┘
```

**You don't trust the claim. You verify the derivation.**

---

## Common Knowledge Primitives on CKB (3 min)

### Primitive 1: Announcement
```
Create cell with public lock.
Now everyone knows X, and knows everyone knows X.
```

### Primitive 2: Commitment
```
Create cell with hash of X.
Everyone knows a commitment exists.
Reveal later proves you knew X at commitment time.
```

### Primitive 3: Agreement
```
Multisig cell requires N parties to sign.
Cell exists → all parties agreed.
Agreement is common knowledge.
```

### Primitive 4: Conditional Knowledge
```
Cell with timelock or condition.
Knowledge becomes common when condition met.
Scheduled revelation.
```

### Primitive 5: Knowledge Derivation
```
Spend cells A + B → create cell C.
C's existence proves derivation from A and B.
Logical inference on-chain.
```

### VibeSwap Uses All Five

| Primitive | VibeSwap Use |
|-----------|--------------|
| Announcement | Pool state updates |
| Commitment | Order commits (hidden until reveal) |
| Agreement | Batch settlement (all reveals processed) |
| Conditional | Reveal phase timing |
| Derivation | Clearing price from order aggregation |

---

## The Deep Connection (2 min)

### Epistemology
```
Common Knowledge =
  Shared beliefs that are:
  ├── Known to all parties
  ├── Known to be known
  ├── Verifiably derived
  └── Internally consistent
```

### CKB (Nervos)
```
Common Knowledge Byte =
  Shared state that is:
  ├── Visible to all nodes
  ├── Consensus on visibility
  ├── Verifiably derived (type scripts)
  └── Internally consistent (validation)
```

**Same structure. Same guarantees. Different substrate.**

Epistemology studies how humans establish shared truth.
CKB implements how machines establish shared truth.

**The cell model doesn't just store data. It implements epistemology.**

---

## Why This Matters for VibeSwap (1 min)

**Traditional DEX knowledge problem**:
- Did my order execute? (trust the indexer)
- At what price? (trust the UI)
- Was it fair? (trust the protocol)

**VibeSwap on CKB**:
- Order execution = cell transformation (verifiable)
- Price = derived from commit cells (provable)
- Fairness = type script validation (guaranteed)

**No trust required. Common knowledge by construction.**

---

## Call to Action (1 min)

1. **Think in knowledge primitives** — What are you making common?
2. **Use cells as truth atoms** — Discrete, verifiable, composable
3. **Design for provenance** — Every claim should be traceable

**The cell model isn't just a data structure. It's an epistemological framework.**

CKB × CKB: Where blockchain meets philosophy.

---

## Q&A

Contact: [your contact]
GitHub: [repo link]

---

## Appendix: The JarvisxWill CKB

Our human-AI collaboration uses the same principles:

```
~/.claude/JarvisxWill_CKB.md
─────────────────────────────
Common Knowledge Base for human-AI collaboration:
├── Cave Philosophy (shared context)
├── Hot/Cold Separation (agreed architecture)
├── Wallet Security Axioms (shared constraints)
└── Session Protocols (agreed procedures)

This file IS our common knowledge.
Both parties read it.
Both parties know the other reads it.
Coordination without confirmation loops.
```

**The same pattern that makes CKB work for blockchains makes CKBs work for collaboration.**

---

*Common knowledge is the foundation of coordination.*
*Cells are the atoms of common knowledge.*
*CKB × CKB: Same solution, different scales.*
