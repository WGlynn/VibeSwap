# VibeSwap Documentation

> *A coordination primitive, not a casino.*

Omnichain DEX on LayerZero V2 with commit-reveal batch auctions and uniform clearing prices. MEV-resistant by construction.

---

## Start here (audience-keyed)

| If you are a... | Begin at |
|---|---|
| **Developer** integrating VibeSwap | [`developer/`](developer/) — install, runbooks, contract catalogue, testing methodology |
| **Auditor** reviewing security | [`audits/`](audits/) and [`architecture/`](architecture/) — audit reports, system design |
| **Researcher** interested in mechanism design | [`research/`](research/) — papers, theorems, formal proofs, signature essays |
| **Partner** evaluating integration | [`partnerships/`](partnerships/) — USD8, Anthropic, Nervos, MIT, grants |
| **Press / podcast** preparing coverage | [`marketing/`](marketing/) — pitch decks, explainers, exec one-pagers |
| **Curious** about an individual concept | [`concepts/`](concepts/) and [`INDEX.md`](INDEX.md) — encyclopedia of every primitive |
| **Looking for a proposal / VIP** | [`governance/`](governance/) |

---

## Top-level structure

```
docs/
├── README.md                # this file
├── INDEX.md                 # encyclopedia of every primitive (canonical navigator)
│
├── architecture/            # system design — consensus, AMM, oracles, cross-chain, contracts
├── concepts/                # individual primitives & mechanism docs (the field encyclopedia leaves)
├── research/                # papers, theorems, formal proofs, manifestos, signature essays
├── developer/               # build, test, deploy, integrate — runbooks and methodology
├── audits/                  # security audit reports, money-path audits, exploit analyses
├── governance/              # VIPs, VSPs, proposals, regulatory, SEC engagement
├── partnerships/            # USD8, Anthropic, Nervos, MIT, grants, BD output
├── marketing/               # pitch decks, content pipelines, social, press, explainers
│
├── _meta/                   # repo-internal — protocols (AAP, RSI, TRP), session reports, KPIs
└── _archive/                # historical / scratch — correspondence, drafts, exploratory writing
```

The two leading-underscore directories sort to the bottom and signal "internal / non-canonical" to outside readers.

---

## What is VibeSwap?

**The problem with continuous trading**: front-running, sandwich attacks, information asymmetry. Manipulated prices aren't true prices — they're distorted by exploiter advantage. Manipulation is noise.

**The batch auction solution**: orders are collected, hidden via commit-reveal, then settled simultaneously at a uniform clearing price. No one can see your order and trade ahead. Everyone gets the same price.

**The result**: MEV-resistant batch auctions don't just produce *fairer* prices — they produce more *accurate* prices. The clearing price reflects genuine supply and demand, not who has the fastest bot. Remove the noise, get closer to signal.

VibeSwap isn't purely order-matching. The batch auction sits on top of an AMM (x*y=k):

1. Orders in a batch first try to match with each other (coincidence of wants).
2. Remaining orders trade against AMM liquidity.
3. Everything settles at the uniform clearing price.

Direct matching when counterparties exist (less slippage than AMM alone), AMM fallback when they don't (guaranteed execution), uniform fair price either way.

---

## Core mechanisms

- **10-second batch cycle** — 8s commit, 2s reveal, settlement
- **Commit-reveal**: `hash(order || secret)` with deposit during commit; reveal triggers Fisher-Yates shuffle using XORed secrets
- **Constant-product AMM** (x·y=k) with TWAP validation (max 5% deviation)
- **Shapley-game incentives** for liquidity providers and contributors (axiomatic-uniqueness fairness)
- **Augmented governance hierarchy**: Physics (math invariants) > Constitution > Governance — DAO bounded by math
- **Cross-chain settlement** via LayerZero V2 with commit-counter gates on withdrawal
- **Six-layer consensus stack** for closing the on-chain ↔ off-chain trust airgap

For depth on any of the above, see [`concepts/`](concepts/) or [`INDEX.md`](INDEX.md).

---

## Tech stack

- **Contracts**: Solidity 0.8.20, Foundry, OpenZeppelin v5.0.1 (UUPS upgradeable)
- **Frontend**: React 18, Vite 5, Tailwind, ethers.js v6
- **Oracle**: Python 3.9+, Kalman filter for true-price discovery
- **Cross-chain**: LayerZero V2 OApp protocol

---

## Quick links

- [Whitepapers](research/whitepapers/) · [Theorems](research/theorems/) · [Formal Proofs](research/proofs/)
- [Contract Catalogue](developer/CONTRACTS_CATALOGUE.md) · [Deployment Runbook](developer/runbooks/)
- [USD8 Partnership](partnerships/usd8/) · [Anthropic Submission](partnerships/anthropic/)
- [Pitch Deck](marketing/pitch/) · [Content Pipeline](marketing/medium/)

---

## Contributing

VibeSwap is built per the **Cooperative Capitalism** philosophy — mutualized risk, free-market competition, math-enforced fairness. Pull requests welcome on the public repo: https://github.com/wglynn/vibeswap

For substantial changes, open a discussion first. See [`developer/`](developer/) for setup and testing.
