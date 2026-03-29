# DeepFunding Absorption Research Note

**Date**: 2026-03-29
**Source**: https://github.com/deepfunding/
**Relevance**: Direct overlap with FractalShapley, ContributionDAG, Augmented Governance

---

## What DeepFunding Is

"Scaling high-quality human judgement." A mechanism for allocating funding to open-source software dependencies using AI ensemble scoring calibrated by human pairwise comparisons.

Created by Vitalik Buterin's team. Targets Ethereum's dependency ecosystem.

---

## Repos Cloned (in `research/`)

| Repo | Contents | Size |
|------|----------|------|
| `deepfunding-scoring` | Core scoring algorithm (`scoring.py`), Lord of the Rings + Ethereum philosophy examples | 4 files |
| `deepfunding-dependency-graph` | 31 seed repos → 5,024 deps → 14,927 edges, 7K packages, 2,046 maintainers | 15K+ edges |
| `deepfunding-oss-evals` | 882 human pairwise comparisons (train.csv) — jurors comparing repo value | Training data |
| `deepfunding-jury-evaluation` | Jury evaluation web app (JavaScript) | UI reference |

---

## Technical Analysis of `scoring.py`

### The Algorithm

1. Multiple scorers (GPT, Claude, DeepSeek, human) each propose a **credit distribution** across contributors
2. All distributions converted to **log-space** (logits = log(credit))
3. Human jurors provide **pairwise comparisons**: "A contributed X times more than B"
4. Scipy optimizer finds **weighted combination** of scorer distributions that minimizes squared error against juror comparisons:

```python
cost = sum((logits[b] - logits[a] - c)² for a, b, c in juror_samples)
```

Where `(a, b, c)` = "item b has `e^c` times more value than item a"

5. Optimal weights constrained: sum to 1, each in [0,1]
6. Result: the AI ensemble weighting that best matches human judgment

### Multi-Layer Extension (`example2.py`)

- Three-layer graph: Root → Dependencies → Dependencies-of-Dependencies
- **Originality dimension**: Each node has a "self" credit (original contribution) vs "dependencies" credit (repackaging prior work)
- Uses DFS-ordered edge weights, normalized per parent
- Visualization via NetworkX radial layout

### Key Design Choice: Log-Space

All scoring happens in log-space. This means:
- Ratios become differences: `log(a/b) = log(a) - log(b)`
- Cross-multiplication (our approach) and log-subtraction (their approach) are mathematically equivalent for ratio comparison
- Log-space avoids numerical underflow for very small credit allocations
- Our `PairwiseFairness.sol` cross-multiplication approach is better for integer arithmetic on-chain; their log-space is better for floating-point optimization off-chain

---

## Dependency Graph Data

### Seed Nodes (31 Ethereum Infrastructure Projects)

**Consensus Clients**: Prysm, Lighthouse, Teku, Nimbus, Lodestar, Grandine
**Execution Clients**: Geth, Nethermind, Besu, Erigon, Reth
**Dev Tools**: Foundry, Hardhat, Solidity, OpenZeppelin, ethers.js, viem, web3.py, Vyper, Remix, and more

### Edge Structure

```json
{
  "relation": "GOLANG",
  "weight": 0.1,
  "source": "prysmaticlabs/prysm",    // dependent
  "target": "multiformats/go-multihash" // dependency
}
```

**Critical design**: Edge weights out of a source must sum to **less than 1**. The remainder = self-credit (originality). This is exactly our Cave Theorem in practice — foundational work retains credit that doesn't flow downstream.

### Data Available

- 112,280 git users
- 192,680 code commits
- 1,150,326 issue comments
- 124,535 issues opened
- Gitcoin + Optimism Retro Funding data
- Drips network funding data

---

## Mapping to VibeSwap Primitives

| DeepFunding | VibeSwap | Gap/Opportunity |
|-------------|----------|-----------------|
| Edge-weight credit DAG | FractalShapley ContributionDAG | Our DAG is in Solidity; theirs is off-chain Python. Complementary. |
| `weight remainder = self-credit` | Cave Theorem (marginal contribution) | Identical principle, different formalism. Theirs is additive remainder; ours is Shapley marginal. |
| Log-space cost minimization | PairwiseFairness cross-multiplication | Equivalent for ratios. Log-space for off-chain; cross-mult for on-chain. |
| AI ensemble + human jury | Augmented Governance (Physics > Constitution > DAO) | Their jury calibrates AI. Our Augmented Governance has physics as top layer. Merge: physics → AI ensemble → human jury → DAO. |
| Originality dimension | Time Neutrality axiom | They measure "what % is original vs repackaged." We measure "does time affect reward." Both fight temporal/positional rent. |
| 882 pairwise comparisons (train.csv) | No equivalent dataset | **We should generate pairwise comparison data for VibeSwap's own dependency graph.** |
| SBOM-based dependency parsing | No equivalent | **We should parse our own npm/pip/cargo deps to build a VibeSwap contribution graph.** |

---

## Absorption Plan

### Phase 1: Study (This Session)
- [x] Clone all 4 repos
- [x] Analyze scoring.py algorithm
- [x] Map to existing primitives
- [x] Write this research note

### Phase 2: Integration (Next Sessions)
- [ ] Test DeepFunding scoring on FractalShapley test cases
- [ ] Compare log-space vs cross-multiplication accuracy on edge cases
- [ ] Build VibeSwap's own dependency graph using SBOM parsing
- [ ] Add originality dimension to ContributionDAG spec
- [ ] Generate pairwise comparison dataset for VibeSwap contributors

### Phase 3: Synthesis (Pre-MIT)
- [ ] Write "DeepFunding meets Shapley" section for Economítra V2
- [ ] Build live demo showing credit flowing through VibeSwap's actual dep graph
- [ ] Hackathon entry: real-time credit allocation visualization

---

## Key Insight

DeepFunding solves the **input problem** (how to get accurate credit estimates) via human+AI ensemble calibration. VibeSwap solves the **fairness problem** (how to guarantee the allocation satisfies axioms) via Shapley values + on-chain verification.

Combined: human judgment calibrates the weights, Shapley axioms guarantee the allocation is fair, on-chain verification makes it trustless.

This is the full stack. Nobody else has it.

---

## References

- https://github.com/deepfunding/scoring
- https://github.com/deepfunding/dependency-graph
- https://github.com/deepfunding/oss-evals
- https://github.com/deepfunding/jury-evaluation
- VibeSwap Five Axioms paper: `docs/five-axioms-paper.md`
- FractalShapley primitive: `memory/primitive_fractalized-shapley-games.md`
