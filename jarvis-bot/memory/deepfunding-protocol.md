# DeepFunding — Retroactive Rewards for Open Source

## Source
- **Website**: https://www.deepfunding.org/
- **GitHub**: https://github.com/deepfunding/
- **Twitter**: https://x.com/deep_funding
- **Telegram**: https://t.me/AgentAllocators/1

## What DeepFunding Is
Retroactive funding protocol for Ethereum open source repos. Uses AI models as engines and humans as decision-makers to allocate funds across the dependency graph.

**Mission**: "Scale high quality human judgement" — distribute rewards to open source repositories that Ethereum depends on.

## Core Mechanism (3 Components)

### 1. Dependency Graph
Data layer mapping all contributions within Ethereum ecosystem. Managed by **Open Source Observer** (https://www.opensource.observer/).

### 2. Model Submissions (Open Competition)
Participants submit "allocator models" that assign relative value weights between code contributions.

**Three difficulty levels:**
- **Level 1 (Fund the Farm)**: Weight 34 seed nodes targeting Ethereum
- **Level 2 (Farm to Forest)**: Determine fund allocation between seed nodes and their dependencies
- **Level 3 (Fund the Forest)**: Weight 5,000+ child nodes across 34 seed nodes

Weights must sum to 1.0. Hosted on **Pond** (https://cryptopond.xyz/).

### 3. Spot Checkers (Jury)
Human jurors conduct randomized pairwise comparisons: "Has A or B been more valuable to Ethereum's success?"

Managed by **Pairwise** (https://www.pairwise.vote/). Jury selection by nomination/invitation/application only.

## Rewards
- **$170k** → Open source repos (based on winning model weights)
- **$50k** → Winning models and shared infrastructure/datasets

## Key Partners
- **Open Source Observer**: Dependency graph data (Wizard)
- **Pairwise**: Jury spot-checking (Referee)
- **Pond**: Model submission hosting (Host)
- **Drips** (https://www.drips.network/): Token distribution (Sprinkler)
- **Ethereum Foundation**, Allo Capital, Pollen Labs, Voicedeck, Eval Science

## VibeSwap Integration Points

### Direct Mechanism Overlaps
- **Pairwise comparison** = ReputationOracle + PairwiseVerifier (our CRPC merge from PsiNet)
- **Retroactive funding** = RetroactiveFunding.sol (quadratic funding for projects)
- **Dependency graph** = ContributionDAG.sol (web of trust, vouch-based)
- **Model competition** = Could use PairwiseVerifier to evaluate model quality

### VSOS Absorption Pattern
1. **Existing primitive**: Dependency graph allocation
2. **Natural mapping**: ContributionDAG = dependency graph, RetroactiveFunding = reward distribution
3. **New capability**: AI-powered allocation models compete on VibeSwap, validated by PairwiseVerifier (CRPC), distributed by ShapleyDistributor

### Concrete Integrations
- DeepFunding's pairwise jury → our PairwiseVerifier contract (on-chain, commit-reveal)
- DeepFunding's dependency graph → ContributionDAG + ContextAnchor (Merkle-anchored)
- Model submissions → AI agents on AgentRegistry competing to allocate
- Distribution → ShapleyDistributor (Shapley-fair, not winner-take-all)
- Spot checking → ReputationOracle (trust scoring for jurors)

### Key Insight
DeepFunding uses OFF-CHAIN models + human spot checks. VibeSwap can make this ON-CHAIN:
- AI agents (AgentRegistry) submit allocation models
- PairwiseVerifier (CRPC) validates model quality
- ContributionDAG provides the dependency graph
- ShapleyDistributor distributes rewards fairly
- All commit-reveal, all MEV-resistant, all on-chain
