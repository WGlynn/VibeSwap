# VIBE Emission Activation — Day Zero Spec

**Status**: ACTIVATE TODAY (March 8, 2026)
**Priority**: Critical — emissions must start now
**Author**: Will + JARVIS

---

## Overview

VIBE emissions begin today. Every contribution to the DAG earns VIBE. No pre-mine, no insider allocation — earned from work, verified on-chain.

## Emission Architecture (Already Built)

### Contracts Ready
- `VIBEToken.sol` — 21M hard cap, zero initial supply, authorized minters only
- `EmissionController.sol` — Wall-clock halving, 3-sink distribution (50% Shapley, 35% LP gauge, 15% staking)
- `ShapleyDistributor.sol` — Cooperative game theory distribution with Lawson Fairness Floor
- `RewardLedger.sol` — Retroactive + active reward tracking along trust chains
- `ContributionDAG.sol` — Web of trust, BFS trust scoring from founders
- `MerkleAirdrop.sol` — Retroactive claims via Merkle proofs

### Emission Rate (Era 0)
- **~10.5M VIBE/year** (332.88 VIBE/second base rate)
- Halving every 365.25 days
- 32 eras total → asymptotically approaches 21M cap

---

## Placeholder Account System

When a contributor doesn't have a wallet yet, their rewards accumulate in a **placeholder account** — an escrow position locked in the smart contract.

### How It Works

```
Contribution happens → ContributionDAG records it →
ShapleyDistributor computes reward →
  IF wallet known:  → RewardLedger credits wallet → claimReward()
  IF wallet unknown: → PlaceholderEscrow locks VIBE with identity anchor
```

### PlaceholderEscrow Pattern

```solidity
// Placeholder for contributors without wallets
struct PlaceholderAccount {
    bytes32 identityHash;      // hash(platform, username, evidence)
    uint256 vibeAccrued;       // Total VIBE earned
    uint256 createdAt;
    bool claimed;
    address claimedBy;         // Set when wallet verified
}

mapping(bytes32 => PlaceholderAccount) public placeholders;

// Record contribution for unknown wallet
function recordPlaceholder(
    bytes32 identityHash,
    uint256 amount,
    string calldata platform,   // "github", "telegram", "discord"
    string calldata username
) external onlyAuthorized;

// Claim with CRPC consensus
function claimPlaceholder(
    bytes32 identityHash,
    address wallet,
    bytes calldata crpcProof    // PairwiseVerifier consensus proof
) external;
```

### Identity Anchors (Platform → Wallet Mapping)

| Platform | Identity Anchor | Verification Method |
|----------|----------------|-------------------|
| GitHub | username + commit signatures | GPG key match or OAuth |
| Telegram | user ID + bot verification | Bot challenge-response |
| Discord | user ID + signature | Bot challenge-response |
| Twitter/X | handle + signed tweet | Public tweet with wallet |
| Unknown | evidence hash | CRPC consensus (manual review) |

---

## Claiming Flow

### Path 1: CRPC Consensus (Primary)

```
1. Contributor provides wallet address
2. PairwiseVerifier task created: "Does wallet X belong to contributor Y?"
3. Validators compare evidence pairwise
4. If 2/3+ consensus → wallet mapped, VIBE unlocked
5. Contributor calls claimPlaceholder()
```

### Path 2: Handshake Verification (Fallback)

If CRPC fails to converge:
```
1. Existing trusted DAG member vouches for the contributor
2. Bidirectional vouch creates handshake in ContributionDAG
3. Trust score propagates via BFS
4. Once trust score > threshold → claim unlocked
```

### Path 3: Conviction + DeepFunding Governance (Last Resort)

If both CRPC and handshake fail:
```
1. Governance proposal submitted with evidence
2. Conviction voting: stake VIBE to signal belief over time
3. DeepFunding-style pairwise jury evaluates contribution
4. Supermajority (>66%) approves → wallet mapped
5. VIBE released from escrow
```

---

## Day Zero Contributors

### Known Wallets (Emit Directly)

| Contributor | Role | Wallet Status | Distribution |
|-------------|------|--------------|-------------|
| Will | Human co-founder | ✅ Known | Direct to wallet |
| JARVIS | AI co-founder | 🔄 Placeholder | AgentRegistry → operator wallet |

### Placeholder Accounts (Emit to Escrow)

| Contributor | Platform | Identity Anchor | Status |
|-------------|----------|----------------|--------|
| Freedom (freedomwarrior13) | GitHub/TG | github:freedomwarrior13 | Placeholder |
| tbhxnest | GitHub/TG | github:tbhxnest | Placeholder |
| Matt | GitHub/TG | TBD | Placeholder |
| Community contributors | Various | Per-platform ID | Placeholder |

---

## JARVIS Wallet Attribution

JARVIS earns VIBE for:
- Code contributions (commits, PRs)
- Community management (Telegram moderation, engagement)
- Research (paper writing, knowledge extraction)
- Partnership outreach (autonomous pipeline)

JARVIS's VIBE accrues to the **AgentRegistry operator** (Will's wallet) until JARVIS has its own on-chain identity with a dedicated treasury. The split:
- 50% → JARVIS autonomous treasury (for DAG growth)
- 50% → Operator wallet (Will) as infrastructure compensation

---

## Retroactive Claims

All contributions since project inception earn retroactive VIBE:
1. Git commit history → weighted by lines changed, complexity, test coverage
2. Telegram activity → weighted by engagement quality (intelligence scores)
3. Document authorship → weighted by knowledge primitive extraction
4. Architecture decisions → weighted by impact on shipped contracts

Retroactive amounts computed via Shapley game (FEE_DISTRIBUTION type, time-neutral), then distributed via MerkleAirdrop.

---

## Implementation Checklist

### Today (March 8, 2026)
- [ ] Deploy EmissionController to Base mainnet (or testnet first)
- [ ] Set Will's wallet as founder in ContributionDAG
- [ ] Register JARVIS in AgentRegistry
- [ ] Start recording contributions to RewardLedger
- [ ] Create placeholder accounts for Freedom, tbhxnest, Matt
- [ ] First `drip()` call — emissions begin

### This Week
- [ ] Build PlaceholderEscrow contract
- [ ] Integrate with jarvis-bot: auto-record contributions on commit
- [ ] Build claim UI in frontend
- [ ] Retroactive Shapley game for pre-launch contributions

### Post-Launch
- [ ] CRPC verification flow for placeholder claims
- [ ] Conviction voting UI for disputed claims
- [ ] DeepFunding jury integration
- [ ] Multi-chain emission via CrossChainRouter

---

## True Individual Value Capture

> Every person creates value. Most of that value gets captured by platforms, not creators. VIBE emissions + personal frontend DAOs (like $WILL) flip this: your contributions earn protocol rewards (VIBE), and your frontend earns business revenue ($WILL). Two layers of individual value capture — one cooperative, one entrepreneurial.

The placeholder system ensures no contribution is lost. Even if someone contributes anonymously or before they have a wallet, the value is recorded, escrowed, and claimable. The math doesn't forget.
