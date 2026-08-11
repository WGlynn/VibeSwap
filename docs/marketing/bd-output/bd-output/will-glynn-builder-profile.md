# Will Glynn

**Mechanism Designer · Protocol Engineer · Founder**

(774) 571-4257 · willglynn123@gmail.com · Cape Cod, MA
[GitHub](https://github.com/WGlynn/VibeSwap) · [Telegram](https://t.me/+3uHbNxyZH-tiOGY8) · [Live Demo](https://frontend-jade-five-87.vercel.app)

---

## The Build

**VibeSwap** — Omnichain DEX designed to eliminate MEV through commit-reveal batch auctions with Shapley-fair reward distribution. Zero protocol fees. Not publicly deployed — mid-pivot to a sovereign Nervos-CKB-fork chain (canonical burn-and-mint messaging, replacing an earlier LayerZero V2 design).

| What                          | Number   |
| ----------------------------- | -------- |
| Solidity files in `contracts/`| 438      |
| Foundry test files            | 591      |
| CKB cell-type-scripts         | 26 building |
| React components              | 349      |
| Commits                       | 1,845+   |
| Research papers               | 122      |
| Time to build                 | 3 months |
| Funding raised                | $0       |

**The repo is the resume**: [github.com/WGlynn/VibeSwap](https://github.com/WGlynn/VibeSwap)

---

## Original Contributions

**Augmented Governance** — Shapley axioms as on-chain constitutional invariants, designed so governance capture violates a math-enforced bound rather than a social norm. Explored in simulation; not yet demonstrated on a live network.

**P-001: No Extraction Ever** — Self-correcting fairness invariant. The same Shapley math that distributes rewards is designed to detect extraction so the system self-corrects rather than depending on a governance referee. Design intent — not yet demonstrated on a live network.

**Commit-Reveal Batch Auctions** — 8s commit → 2s reveal → Fisher-Yates shuffle via XORed secrets → uniform clearing price. A single clearing price per batch removes the "before/after" spread a sandwich attack needs, so the sandwich vector doesn't exist within a batch.

**x402 + SIWX Session Auth** — Implemented CAIP-122 wallet sessions for HTTP 402 payments same day as protocol announcement. 4,000x latency reduction.

**Three-Layer Oracle Stack** — On-chain TWAP + off-chain Kalman filter true price + regime detection. Configurable circuit breakers for price-deviation, volume, and withdrawal anomalies (thresholds set per-pool at configure-time).

---

## Stack

Solidity · Foundry · OpenZeppelin · UUPS Proxies · React · Vite · Tailwind · ethers.js v6 · Node.js · Express · WebSocket · Python · Rust · LayerZero V2 · Base · Nervos CKB · RISC-V · WebAuthn · ERC-4337

---

## Experience

### Founder & Protocol Engineer — VibeSwap

*2025 – Present*

Built a full-stack omnichain DEX from zero: 438 Solidity files across 34 module directories, 349 frontend components, a sovereign CKB-fork chain (26 cell-type-scripts building, dev chain mining blocks), multi-shard AI agent system, Python oracle, and 122 research papers. Designed commit-reveal batch auctions, Shapley reward distribution, augmented governance, and the cooperative capitalism economic model. Zero external funding. Not yet publicly deployed — see repo status.

### Startup Consultant — Blockchain Projects

*2019 – Present*

Gitcoin, Ampleforth, Etherisc, Smart Contract Audits, Sidepit Exchange, Nervos Network, Ergon. White papers, tokenomics design, market strategy, architecture review. Identify weaknesses in DeFi smart contract design and propose fault-tolerant solutions.

### Outreach & Growth — Nervos Network

*2020 – 2024*

Built partnerships with several top-50 projects by market cap. Arranged C-level meetings resulting in 20% spend of acquisition budget. Published white papers and educational content on Nervos' UTXO cell model architecture. Ran Boston-area networking events for 300+ crypto professionals. Provided strategic input on digital marketing and partnership programs supporting 3% Y/Y growth.

### Marketing & Sales Manager — Ergon

*2023 – Present*

Ran social media campaign directly resulting in 5x ROI by market cap. Content creation, webinars, white papers on Ergon's multi-asset blockchain architecture. Boston-area conferences, cross-functional product launches, sales collateral.

### Independent Researcher — Cryptoeconomics

*2016 – Present*

10 years of research across scalability, interoperability, security, and applied game theory for blockchains. Over 100 papers. Worked alongside dozens of research teams. Designed the first trustless bridge for peer-to-peer digital cash.

---

## Education

**M.S. Digital Currency** — University of Nicosia
**B.S. Business** — Southern New Hampshire University (2016–2020)

---

## Security & Testing

- 24/29 exploit findings dissolved in comprehensive security audit
- 181 UUPS contracts hardened with upgrade validation
- Zero-tolerance violation checker (14 categories, every commit)
- Fuzz testing: Shapley axioms, extraction detection, value conservation
- Flash loan protection, TWAP validation, circuit breakers, 50% slashing

---

## What I'm Looking For

Partners, grants, and capital to take a protocol that's already built — mechanism spec, reference contracts, and a mining CKB dev chain — the rest of the way to mainnet.

Most founders raise money to build. I built first. The code is public. Tests run per-module and pass. The mechanism design is done; deployment is the next chapter.

**[github.com/WGlynn/VibeSwap](https://github.com/WGlynn/VibeSwap)** — 1,845+ commits. $0 funding. Built in a cave.
