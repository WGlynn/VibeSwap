# Hot/Cold Trust Boundaries: Why Your DeFi Frontend Is the Real Attack Surface

*Nervos Talks Post -- W. Glynn (Faraday1)*
*March 2026*

---

## TL;DR

Between 2021 and 2025, DeFi lost over $7 billion to exploits. The industry responded with more smart contract audits. But the BadgerDAO exploit ($120M), the Curve DNS hijack, and the Ledger Connect Kit supply chain attack all had one thing in common: **the smart contracts were fine. The frontend was the point of failure.** We developed Hot/Cold Trust Boundary Architecture -- a strict separation where code that interacts with contracts ("hot") is isolated from code that does not ("cold"). The audit surface shrinks by 86%. And here is where CKB becomes relevant: the cell model's structural isolation is this exact principle at the protocol level. CKB does not just enable trust boundaries -- it *is* a trust boundary architecture.

---

## The Lobby Problem

The DeFi industry spent five years reinforcing the vault door while ignoring the lobby. A typical DeFi frontend faces DNS hijacking, malicious npm packages (800-1,500 transitive dependencies), supply chain attacks on build tools, XSS, and insider threats. Every one exploits the same structural weakness: **undifferentiated privilege**.

Look at a typical frontend:

```
src/
├── components/
│   ├── Header.jsx          # UI chrome
│   ├── SwapForm.jsx         # Calls contracts
│   ├── Footer.jsx           # Static text
│   ├── PriceChart.jsx       # Data visualization
│   └── TransactionModal.jsx # Calls contracts
├── hooks/
│   ├── useSwap.js           # Contract interaction
│   └── useTheme.js          # Visual preference
└── pages/
    ├── Swap.jsx             # Mixes UI + contracts
    └── Pool.jsx             # Mixes UI + contracts
```

`Footer.jsx` has the same import privileges as `SwapForm.jsx`. A compromised charting library has the same access to `ethers.js` as the swap logic.

The knowledge primitive:

> **The attack surface of a system is determined by how much code CAN interact with the critical resource, not how much code DOES. Minimize the CAN.**

For a 100-file frontend with 8 contract-interacting files, the attack surface ratio is 12.5x what it needs to be.

---

## The Architecture: Hot, Warm, Cold

Derived from wallet security principles (Glynn, 2018): the same separation that makes cold storage wallets secure can make frontend code secure.

```
┌─────────────────────────────────────────────────────────┐
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐  │
│  │  HOT ZONE    │  │  WARM ZONE   │  │  COLD ZONE   │  │
│  │  blockchain/ │  │  app/        │  │  ui/         │  │
│  │              │  │              │  │              │  │
│  │  - ABIs      │<─│  - Pages     │──>  - Components│  │
│  │  - Gateway   │  │  - Providers │  │  - Layouts   │  │
│  │  - Hooks     │  │              │  │  - Styles    │  │
│  │              │  │              │  │              │  │
│  │  CAN touch   │  │  Connects    │  │  CANNOT      │  │
│  │  contracts   │  │  hot to cold │  │  touch       │  │
│  └──────────────┘  └──────────────┘  │  contracts   │  │
│                                       └──────────────┘  │
│  Cold NEVER imports from Hot. Hot NEVER imports Cold.   │
└─────────────────────────────────────────────────────────┘
```

**Hot Zone** (`blockchain/`): All contract interaction code. The only zone permitted to import web3 libraries. Small, auditable, changes infrequently.

**Cold Zone** (`ui/`): Pure presentational code. Components receive data via props. A compromised cold zone component **cannot construct transactions** -- architecturally impossible.

**Warm Zone** (`app/`): The glue. Pages wire hot hooks to cold components.

The **Gateway** is a single file through which ALL contract interactions flow. To verify no unauthorized transactions exist: review one file. Not 106.

---

## Blast Radius Containment

A malicious npm package compromises a charting library in `PriceChart.jsx`.

**Without separation**: Malicious code imports `ethers.js`, constructs a `transfer()` call, drains funds. Nothing prevented lateral movement.

**With separation**: `PriceChart.jsx` lives in the cold zone. No import path to `ethers.js` (enforced by linter and CI). The malicious code can deface the UI or redirect to phishing -- but **cannot construct transactions**.

Enforcement is a single CI check:

```bash
grep -r "from.*blockchain" src/ui/ && echo "VIOLATION" && exit 1
grep -r "from.*ethers\|from.*web3\|from.*viem" src/ui/ && echo "VIOLATION" && exit 1
```

A compromised cold zone is an inconvenience. A compromised hot zone is a catastrophe. The architecture minimizes the catastrophe surface.

---

## VibeSwap: 106 Files, 86% Reduction

```
HOT ZONE  (blockchain/)    ~15 files   <- The audit surface
COLD ZONE (ui/)            ~70 files   <- Cannot touch contracts
WARM ZONE (app/)           ~20 files   <- Wiring only
```

```
Before: R = 106 / 15 = 7.1
After:  R = 15 / 15  = 1.0   (86% reduction)
```

The pattern generalizes:

| Domain | Critical Resource | Hot Zone | Cold Zone |
|--------|-------------------|----------|-----------|
| Wallets | Private keys | Signing device | Display, UI |
| DeFi frontends | Contract interaction | `blockchain/` | `ui/` |
| Backend services | Database credentials | Data access layer | Business logic |
| CI/CD pipelines | Deploy keys | Deploy scripts | Build scripts |

---

## Why CKB Is a Trust Boundary Architecture

CKB's cell model is structurally isomorphic to Hot/Cold trust boundaries.

### Cells as Architectural Isolation

On EVM, all contract state lives in shared storage -- any function can touch any slot. On CKB, each cell is independent with its own lock script (access control) and type script (transformation rules). The isolation is structural:

```
EVM: ┌──────────────────────────────┐
     │  Shared Storage              │
     │  slot[0] = balance           │  <- Any function can touch any slot
     │  slot[1] = admin flag        │
     └──────────────────────────────┘

CKB: ┌──────────┐  ┌──────────┐  ┌──────────┐
     │ Balance   │  │ Admin    │  │ Fee Rate │
     │ Cell      │  │ Cell     │  │ Cell     │
     │ lock: ... │  │ lock: ...│  │ lock: ...│
     └──────────┘  └──────────┘  └──────────┘
     Each cell has its own trust boundary.
```

### Lock Scripts as Import Rules

| Trust Boundary Concept | Frontend (Hot/Cold) | CKB (Cell Model) |
|------------------------|---------------------|-------------------|
| Isolation unit | Directory | Cell |
| Access control | ESLint rules | Lock script |
| Transformation rules | Gateway validation | Type script |
| Enforcement level | CI pipeline | Consensus |
| Violation result | Build failure | Transaction rejection |

Our import rules are enforced by CI. CKB's lock scripts are enforced by every full node. The CKB guarantee is categorically stronger.

### Timelocks Without Trust

On EVM: `require(block.timestamp >= unlockTime)` -- a conditional check that can be bypassed by bugs, reentrancy, or upgrades.

On CKB: the cell's `Since` constraint makes it structurally unconsumed before the timelock expires. No application logic to audit. The substrate enforces it.

### Safe Composability

On EVM, reentrancy attacks exploit shared-state composability. On CKB, cells from different trust domains compose safely because each cell's scripts are verified independently. Neither can influence the other's verification.

---

## Defense in Depth

Hot/Cold is Layer 2 in a five-layer defense stack:

```
LAYER 5: User Education
LAYER 4: Wallet-Level Protection (hardware wallets, simulation)
LAYER 3: Smart Contract Guards (circuit breakers, rate limits)
LAYER 2: HOT/COLD TRUST BOUNDARIES          <-- This
LAYER 1: Infrastructure Security (DNS, CSP, SRI, npm audit)
```

VibeSwap implements all five. The Hot/Cold boundary reduces the surface that Layers 3-5 must protect.

---

## Discussion

1. **CKB's cell model provides structural isolation.** Is this consciously designed as a trust boundary architecture, or is it an emergent property of the UTXO model?

2. **Lock scripts enforce access control at consensus level.** Could CKB's verification model extend to frontend security -- a type script verifying provenance of transaction-constructing modules?

3. **Composability tradeoffs.** EVM: powerful but dangerous (reentrancy). CKB: safe but potentially complex. Where does the community see the practical tradeoffs?

4. **State rent as a trust boundary.** CKB's state rent creates economic pressure on state occupation. Does this naturally reduce the attack surface of on-chain state?

5. **Has anyone applied similar architectural separation patterns to CKB dApps?** What tooling exists for enforcing cell-level trust boundaries?

---

*"Fairness Above All."*
*-- P-000, VibeSwap Protocol*

*Full paper: [hot-cold-trust-boundaries.md](https://github.com/wglynn/vibeswap/blob/master/docs/papers/hot-cold-trust-boundaries.md)*
*Code: [github.com/wglynn/vibeswap](https://github.com/wglynn/vibeswap)*
