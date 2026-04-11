# CogProof — Product Writeup

## One-Liner
**Behavioral reputation infrastructure for Bitcoin-native agent economies.**

## The Problem

Crypto has an accountability gap:
- Wallets are anonymous — no way to know if a counterparty is trustworthy
- Reputation doesn't exist on-chain — you can scam in one protocol and start fresh in another
- Recruiters/reviewers have no signal about what someone actually *did* — just what they *claim*
- CogCoin agents mine sentences but there's no mechanism to prevent plagiarism, sybil attacks, or gaming

Current "reputation" in crypto = how much money you have. That's not reputation. That's just wealth.

## The Solution

**CogProof turns protocol actions into verifiable credentials.**

Every time you participate honestly in a protocol, you earn a credential. Every time you game the system, you get flagged. Your behavioral history becomes a portable, verifiable, on-chain reputation — anchored to Bitcoin.

Not identity (no KYC). **Behavioral reputation.**

## How It Works

### The Lifecycle

```
1. COMMIT    → Agent commits hash(work || secret) on-chain
                No one can see what you submitted
                Credential issued: "Batch Participant"

2. REVEAL    → Agent reveals work + secret after window closes
                Hash must match commit or you're slashed
                Credential issued: "Honest Reveal" or "Failed Reveal" ❌

3. SETTLE    → XOR all secrets → Fisher-Yates shuffle → fair ordering
                No one could predict or influence their position
                Credential issued: "Fair Execution Participant"

4. ANALYZE   → Trust analyzer checks for fraud patterns
                Sybil clusters, plagiarism, collusion, selective reveal
                Trust score computed: 0-100 → FLAGGED/SUSPICIOUS/CAUTIOUS/NORMAL/TRUSTED

5. REWARD    → Shapley value distribution with Lawson floor
                Each participant gets their marginal contribution
                No one gets zeroed out (λ = minimum guarantee)
                Credential issued: "High Contributor" if top 20%

6. ANCHOR    → Everything written to Bitcoin via OP_RETURN
                80 bytes per transaction, using CogCoin's existing ops
                Full state reconstructable from chain alone
```

### The Credential Types

| Credential | Earned When | Signal | Weight |
|-----------|-------------|--------|--------|
| Batch Participant | Submit a commit | Positive | +1 |
| Honest Reveal | Reveal matches commit hash | Positive | +2 |
| Fair Execution | Included in shuffled execution | Positive | +2 |
| High Contributor | Shapley value top 20% | Positive | +5 |
| Consistent Contributor | Positive Shapley across 10+ batches | Positive | +10 |
| Compression Miner | Valid lossless compression PoW | Positive | +3 |
| High Density Miner | Compression density > 0.8 | Positive | +5 |
| Reputation Burn | Burned COG to endorse someone | Positive | +4 |
| Failed Reveal | Committed but didn't reveal | **Negative** | **-3** |

### Reputation Tiers

| Tier | Score Range | Meaning |
|------|------------|---------|
| FLAGGED | 0-19 | Confirmed bad behavior, restrict |
| SUSPICIOUS | 20-39 | Multiple red flags, monitor |
| CAUTIOUS | 40-59 | Some concerns, limited trust |
| NORMAL | 60-79 | Standard participant |
| TRUSTED | 80-100 | Proven honest actor |

### Trust Analyzer — Fraud Detection

| Detector | What It Catches | How |
|----------|----------------|-----|
| Selective Reveal | Gaming commit-reveal by only revealing when favorable | Reveal rate < 40% of commits |
| Sybil Cluster | Multiple wallets controlled by same person | Commits within 2s window + similar outputs |
| Compression Plagiarism | Copying another agent's work | Jaccard similarity > 70% on outputs |
| Reputation Churn | Burn/revoke cycles to manipulate rep | 5+ revocation cycles |
| Collusion Ring | Coordinated groups always in same batches | 90%+ co-occurrence correlation |
| Velocity Spike | Dormant account suddenly active | 3x normal activity rate |

### Shapley Distribution

Fair reward splitting based on game theory:
- **Marginal contribution**: What does the coalition gain by adding you?
- **Computed across all orderings**: Not order-dependent, mathematically fair
- **Lawson floor (λ)**: Minimum guarantee — "Fairness Above All"
  - `keccak256("FAIRNESS_ABOVE_ALL:W.GLYNN:2026")`
  - Default: 5% — no participant gets less than 5% of the pool
- **DAG structure**: Models contribution dependencies (A built on B's work → B gets credit)
- **Logarithmic scaling**: `log2(1 + value)` — prevents burst dominance

### Bitcoin-Native (OP_RETURN)

Everything fits in CogCoin's 80-byte OP_RETURN format:

| CogProof Action | CogCoin Op | Byte Budget |
|----------------|-----------|-------------|
| Commit (escrow) | COG_LOCK (0x03) | 80 bytes |
| Reveal (claim) | COG_CLAIM (0x04) | 80 bytes |
| Mine submission | MINE (0x01) | 80 bytes |
| Credential write | DATA_UPDATE (0x0A) | 80 bytes |
| Reputation burn | REP_COMMIT (0x0C) | 80 bytes |
| Reputation revoke | REP_REVOKE (0x0D) | 80 bytes |
| Shapley anchor | DATA_UPDATE (0x0A) | 80 bytes |

No new consensus. No sidechains. No external APIs. Bitcoin + indexer = full state.

---

## Architecture

```
┌─────────────────────────────────────────────────┐
│               Bitcoin Network                    │
│            (OP_RETURN transactions)              │
├─────────────────────────────────────────────────┤
│               CogCoin Protocol                   │
│    20 tx types │ Coglex encoding │ PoL mining    │
│    Domains/DID │ Reputation-by-burn              │
├─────────────────────────────────────────────────┤
│               CogProof Layer                     │
│                                                  │
│  ┌──────────┐ ┌──────────┐ ┌──────────┐        │
│  │ Commit-  │ │Credential│ │ Shapley  │        │
│  │ Reveal   │→│ Registry │→│ DAG      │        │
│  │ Engine   │ │ (W3C VC) │ │ (Lawson) │        │
│  └────┬─────┘ └────┬─────┘ └────┬─────┘        │
│       │             │             │              │
│  ┌────▼─────┐ ┌────▼─────┐ ┌────▼─────┐        │
│  │ Trust    │ │Compression│ │ Bitcoin  │        │
│  │ Analyzer │ │ Mining    │ │ OP_RETURN│        │
│  │ (fraud)  │ │ (PoW)     │ │ (anchor) │        │
│  └──────────┘ └──────────┘ └──────────┘        │
│                                                  │
├─────────────────────────────────────────────────┤
│          REST API — Express (port 3001)          │
├─────────────────────────────────────────────────┤
│          Frontend (React)                        │
└─────────────────────────────────────────────────┘
```

---

## Team

| Member | Role |
|--------|------|
| Will Glynn | Protocol design, backend, mechanism design |
| Soham Joshi | Credential system design, frontend |
| Bianca | Statistical analysis, proof validation |
| Amelia | TBD |
| TBD | TBD |

---

## Repo Structure

```
cogproof/
├── README.md
├── package.json
├── docs/
│   ├── PRODUCT_WRITEUP.md          ← this file
│   └── FRONTEND_SPEC.md            ← frontend specification
├── src/
│   ├── api/
│   │   └── server.js               ← Express REST API (port 3001)
│   ├── bitcoin/
│   │   └── op-return.js            ← OP_RETURN tx builder + indexer
│   ├── commit-reveal/
│   │   └── commit-reveal.js        ← Fair ordering engine
│   ├── compression-mining/
│   │   ├── compressor.js           ← Symbolic compression engine
│   │   └── mine.js                 ← Mining + verification
│   ├── credentials/
│   │   └── credential-registry.js  ← W3C VC behavioral credentials
│   ├── shapley-dag/
│   │   └── shapley.js              ← Shapley distribution + Lawson floor
│   └── trust/
│       └── behavior-analyzer.js    ← Fraud detection + trust scoring
```

## Running

```bash
cd cogproof
npm install
npm start          # API on port 3001

# Individual module demos
npm run mine              # Compression mining
npm run commit-reveal     # Commit-reveal fair ordering
npm run shapley           # Shapley DAG distribution
npm run credentials       # Credential registry
npm run trust             # Trust analyzer
```

## Philosophy

> "Your actions in protocols become verifiable credentials."

CogProof is cooperative capitalism applied to reputation. The system doesn't punish — it *reveals*. Honest behavior naturally accumulates trust. Dishonest behavior naturally surfaces. The mechanism does the work, not moderators, not committees, not KYC gatekeepers.

The Lawson constant guarantees dignity: no matter how small your contribution, you're never zeroed out. Fairness is physics, not policy.
