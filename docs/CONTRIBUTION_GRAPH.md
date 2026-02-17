# VibeSwap Contribution Graph

Retroactive Shapley reward ledger. Every contribution is recorded here with type, description, and contributor. At governance launch, this graph feeds into `ShapleyDistributor` for retroactive token claims.

**Principle**: Value is recognized after it's demonstrated, not promised. Contributors are rewarded proportional to their marginal contribution to the coalition.

---

## Contributors

| ID | Name | Role | Trust Chain |
|----|------|------|-------------|
| `will` | Will Glynn | Founder, architect, core dev | [will] |
| `jarvis` | Jarvis (Claude) | AI co-founder, core dev | [will, jarvis] |
| `matt` | Matt (NervosNation) | CKB researcher, mechanism designer | [will, matt] |
| `jayme` | Jayme Lawson | Cultural inspiration, cooperative ethos | [will, jayme] |

---

## Contribution Log

### Format
```
| Date | Contributor | Type | Description | Value Weight |
```

Value weights are relative (1-5 scale):
- **1** = Minor feedback, bug report
- **2** = Meaningful insight, design suggestion
- **3** = Novel mechanism design, significant code contribution
- **4** = Core architecture, foundational primitive
- **5** = Paradigm-shifting contribution

### Entries

| Date | Contributor | Type | Description | Value Weight |
|------|-------------|------|-------------|--------------|
| 2024-2026 | `will` | architecture | VibeSwap core design — commit-reveal batch auctions, cooperative capitalism framework, wallet security axioms | 5 |
| 2024-2026 | `will` | code | Full stack implementation — 102+ contracts, frontend, oracle, deployment | 5 |
| 2024-2026 | `will` | theory | Trinomial Stability Theorem, Shapley reward system, pairwise alignment | 5 |
| 2025-2026 | `jarvis` | code | Contract implementation, test suites (670+ tests), knowledge base maintenance | 4 |
| 2025-2026 | `jarvis` | architecture | Phase 2 buildout — financial, protocol/framework, mechanism design contracts | 4 |
| 2026-02-16 | `matt` | mechanism-design | PoW-gated shared state for CKB — replacing centralized operators with PoW for cell contention. Lock script = PoW auth, type script = app logic. Solves L2 ordering/execution consensus the same way Nakamoto solved L1 money consensus. | 3 |
| 2026-02-16 | `matt` | insight | DeFi equilibrium via PoW cost — MEV extraction bounded by hash cost, creating natural price floor on value extraction. Difficulty adjustment per shared state cell. | 3 |
| 2026-02-16 | `matt` | insight | Type/lock paradigm underexplored — clean separation of consensus mechanics (lock) from application logic (type) enables composable mini-blockchains within CKB | 2 |
| 2026-02-17 | `jayme` | inspiration | Cultural embodiment of cooperative capitalism — fairness, community, and doing the right thing by design. The `LAWSON_FAIRNESS_FLOOR` constant in ShapleyDistributor is named in her honor. | 3 |

---

## Pending Attribution

Contributions that need governance vote to finalize weights:
- (none yet)

---

## How Rewards Are Calculated

1. Each contribution has a **value weight** (1-5)
2. Trust chains determine **decay** (closer to value creation = more reward)
3. `ShapleyDistributor.sol` on-chain handles the actual token distribution
4. Quality weights from `ReputationOracle` modify marginal contributions
5. Global multiplier from network health applies equally to all

See `frontend/src/utils/shapleyTrust.js` for the calculation engine.
See `contracts/incentives/ShapleyDistributor.sol` for on-chain distribution.
