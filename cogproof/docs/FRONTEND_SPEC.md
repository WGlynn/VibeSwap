# CogProof — Frontend Specification

## For: Soham (Frontend Lead)
## Backend: `http://localhost:3001/api`
## Stack suggestion: React + Tailwind (or whatever you prefer)

---

## Overview

The frontend visualizes the CogProof lifecycle: commit → reveal → settle → credential → trust score. It should feel like a **live dashboard** showing real-time protocol activity, user reputations, and fraud detection.

---

## Pages / Views

### 1. Dashboard (Home)

**Purpose**: Overview of protocol health and activity.

**Data sources**:
```
GET /api/health                    → system status
GET /api/bitcoin/indexer           → chain state (commits, reveals, credentials)
GET /api/trust/report              → all user trust scores
```

**Display**:
- System status (uptime, version)
- Indexer state: total commits, reveals, unrevealed count, block height
- Trust report summary: pie chart of TRUSTED/NORMAL/CAUTIOUS/SUSPICIOUS/FLAGGED users
- Recent activity feed (batches created, credentials issued)

---

### 2. Batch Explorer

**Purpose**: Visualize the commit-reveal lifecycle of a single batch.

**Data sources**:
```
POST /api/batch/create             → { batchId, blockHash, phase }
POST /api/batch/:id/commit         → { batchId, minerId, commitHash }
POST /api/batch/:id/close-commit   → { batchId, commitCount }
POST /api/batch/:id/reveal         → { valid, batchId, minerId }
POST /api/batch/:id/settle         → { shuffleSeed, executionOrder, totalCommits, totalReveals, slashed }
GET  /api/batch/:id                → { id, phase, commits, reveals, executionOrder, shuffleSeed }
```

**Display**:
- Batch phase indicator: COMMIT → REVEAL → SETTLED (animated state machine)
- List of commits (anonymized hashes during commit phase)
- Reveals as they come in (show ✓ valid or ✗ slashed)
- Settlement result: shuffle seed + execution order visualization
- Slashed count (commits - reveals)

**Interactive demo mode**: 
- "Run Demo" button that calls `POST /api/demo/full-pipeline` and animates through all phases
- Step-by-step walkthrough showing WHY each phase prevents MEV

---

### 3. User Reputation Profile

**Purpose**: Show a user's behavioral history, credentials, and trust score.

**Data sources**:
```
GET /api/reputation/:userId        → { userId, score, tier, totalCredentials, positiveSignals, negativeSignals, credentials[] }
GET /api/trust/:userId             → { userId, trust, score, flags[], stats }
```

**Display**:
- Trust score gauge (0-100) with tier badge (TRUSTED/NORMAL/etc.)
- Credential tier badge: NEWCOMER → BRONZE → SILVER → GOLD → DIAMOND
- Stats: total actions, commits, reveals, reveal rate, burns, revocations, account age
- Credential history timeline (chronological list of earned credentials)
- Flags section (if any): severity badge + description + evidence
- Comparison: reputation score vs trust score (they measure different things)

**Color coding**:
| Tier | Color |
|------|-------|
| TRUSTED / DIAMOND | Green / Gold |
| NORMAL / GOLD | Blue |
| CAUTIOUS / SILVER | Yellow |
| SUSPICIOUS / BRONZE | Orange |
| FLAGGED / NEWCOMER | Red / Gray |

---

### 4. Shapley Distribution Visualizer

**Purpose**: Show fair reward distribution with DAG.

**Data source**:
```
POST /api/shapley/compute
Body: {
  "totalPool": 20000,
  "lawsonFloor": 0.05,
  "participants": [
    { "id": "will", "contributions": { "code_commits": 45, "protocol_design": 30 } },
    { "id": "soham", "contributions": { "credential_design": 35, "api_layer": 25 } },
    ...
  ],
  "dependencies": [
    { "from": "soham", "to": "will" },
    ...
  ]
}

Response: {
  "totalPool": 20000,
  "lawsonFloor": 0.05,
  "lawsonHash": "f10910e97912b369",
  "participants": [
    { "id": "will", "rawShare": 0.348, "adjustedShare": 0.332, "payout": 6640, ... },
    ...
  ],
  "dag": { "nodes": [...], "edges": [...] }
}
```

**Display**:
- DAG graph visualization (nodes = participants, edges = dependencies)
  - Node size proportional to Shapley value
  - Edge direction shows "depends on" relationship
- Bar chart: raw share vs Lawson-adjusted share per participant
- Highlight the Lawson floor line (λ = 5%)
- Payout table: participant → share % → $ amount
- Lawson constant display: `keccak256("FAIRNESS_ABOVE_ALL:W.GLYNN:2026")`
- Interactive: add/remove participants, adjust contributions, see distribution update live

---

### 5. Compression Mining Demo

**Purpose**: Show compression mining in action.

**Data source**:
```
POST /api/mine
Body: { "minerId": "demo_user", "corpus": "text to compress..." }
Response: { "commitHash", "originalBytes", "compressedBytes", "ratio", "density", "miningTimeMs" }
```

**Display**:
- Input: text area for corpus
- Output: side-by-side original vs compressed
- Stats: original bytes, compressed bytes, ratio %, density %, mining time
- Verification status: ✓ Lossless or ✗ Lossy
- Comparison visualization: how much smaller the compressed version is

---

### 6. Trust Analyzer Dashboard

**Purpose**: Show fraud detection in action.

**Data sources**:
```
GET /api/trust/report              → [{ userId, trust, score, flags, stats }, ...]
GET /api/trust/:userId             → detailed analysis for one user
POST /api/trust/batch              → analyze a batch for anomalies
```

**Display**:
- Leaderboard: all users sorted by trust score
- Flag feed: recent flags raised, color-coded by severity
  - INFO = gray, WARNING = yellow, HIGH = orange, CRITICAL = red
- Batch analysis panel: shows sybil detection, plagiarism checks, collusion rings
- Individual user drill-down: click a user → see their full flag history

---

### 7. Bitcoin OP_RETURN Explorer

**Purpose**: Show the Bitcoin-native transaction layer.

**Data sources**:
```
POST /api/bitcoin/commit           → { op, hex, size, decoded, indexed }
POST /api/bitcoin/reveal           → same
POST /api/bitcoin/mine             → same
POST /api/bitcoin/credential       → same
POST /api/bitcoin/reputation/burn  → same
GET  /api/bitcoin/indexer          → { blockHeight, commits, reveals, unrevealed, credentials, reputationEntries }
```

**Display**:
- Transaction builder: select type, fill params, see raw hex output
- Show the 80-byte constraint visually (progress bar: X/80 bytes used)
- Hex viewer: color-coded sections (magic=blue, op=green, payload=white)
- Indexer state: live view of reconstructed state
- "All operations use existing CogCoin ops — no protocol changes needed"

---

## API Reference — Quick Start

### One-Click Full Demo
```bash
curl -X POST http://localhost:3001/api/demo/full-pipeline
```

Returns a complete lifecycle: commit → reveal → settle → shapley → reputation for 3 simulated miners.

### Start the Backend
```bash
cd cogproof && npm install && npm start
# API running on http://localhost:3001
```

### Key Endpoints Summary

| Method | Endpoint | What It Does |
|--------|----------|-------------|
| `GET` | `/api/health` | System health |
| `POST` | `/api/batch/create` | New batch `{ blockHash? }` |
| `POST` | `/api/batch/:id/commit` | Commit `{ minerId, commitHash }` |
| `POST` | `/api/batch/:id/close-commit` | Close commit phase |
| `POST` | `/api/batch/:id/reveal` | Reveal `{ minerId, output, secret }` |
| `POST` | `/api/batch/:id/settle` | Settle `{ blockEntropy? }` |
| `GET` | `/api/batch/:id` | Batch summary |
| `POST` | `/api/event` | Record event `{ userId, eventType, batchId, metadata? }` |
| `POST` | `/api/credential` | Issue credential `{ userId, credentialType, batchId, metadata? }` |
| `GET` | `/api/reputation/:userId` | User reputation + credentials |
| `POST` | `/api/shapley/compute` | Shapley dist `{ totalPool, lawsonFloor?, participants, dependencies? }` |
| `POST` | `/api/mine` | Mine `{ minerId, corpus, blockHash? }` |
| `POST` | `/api/mine/verify` | Verify `{ reveal, originalCorpus }` |
| `GET` | `/api/trust/:userId` | Trust analysis |
| `POST` | `/api/trust/batch` | Batch anomaly check |
| `GET` | `/api/trust/report` | Full trust report |
| `POST` | `/api/bitcoin/commit` | Build OP_RETURN commit tx |
| `POST` | `/api/bitcoin/reveal` | Build OP_RETURN reveal tx |
| `POST` | `/api/bitcoin/mine` | Build OP_RETURN mine tx |
| `POST` | `/api/bitcoin/credential` | Build OP_RETURN credential tx |
| `POST` | `/api/bitcoin/reputation/burn` | Build OP_RETURN rep burn tx |
| `POST` | `/api/bitcoin/shapley-anchor` | Build OP_RETURN Shapley anchor tx |
| `GET` | `/api/bitcoin/indexer` | Indexer state |
| `POST` | `/api/demo/full-pipeline` | Full lifecycle demo |

### Event Types for `POST /api/event`

```
BATCH_PARTICIPANT, HONEST_REVEAL, FAIR_EXECUTION, FAILED_REVEAL,
HIGH_CONTRIBUTOR, CONSISTENT_CONTRIBUTOR, COMPRESSION_MINER,
HIGH_DENSITY_MINER, REPUTATION_BURN
```

---

## Design Notes for Frontend

1. **Dark theme recommended** — fits the Bitcoin/crypto aesthetic
2. **Real-time feel** — use polling or websockets to show live batch activity
3. **Animated state transitions** — commit phase → reveal phase → settled should feel like watching a process unfold
4. **The "wow factor" moment**: the Shapley DAG visualization where you can see dependencies and the Lawson floor guaranteeing nobody gets zeroed out
5. **Mobile-friendly** — judges might look at it on their phones
6. **The demo button is critical** — one click should walk through the entire lifecycle with commentary explaining what's happening and why it matters

---

## What Makes This Special (for the pitch)

1. **Bitcoin-native** — not another L2 or sidechain. Pure OP_RETURN, existing CogCoin ops
2. **Behavioral, not identity** — no KYC, just protocol-verified actions
3. **Fraud detection built-in** — not an afterthought, it's core
4. **Mathematically fair** — Shapley values, not vibes. Lawson floor, not mercy
5. **The meta play** — the hackathon's own 70%-to-all prize structure IS a Lawson floor. We're modeling their system with our math
