# Telegram Badge System — Feature Spec

**Author**: Will + Jarvis | March 2026
**Status**: Approved for Implementation
**Target**: Jarvis Bot (jarvis-vibeswap on Fly.io)

---

## Overview

Visual contribution rank indicators next to Telegram usernames. Three orthogonal signal dimensions aligned with P-095 (Three-Dimensional Incentive Design).

## Features

### 1. Contribution Stars (Status Dimension)

Stars next to username based on Shapley contribution tier:

| Tier | Stars | Requirement |
|------|-------|-------------|
| 1 | ★ | Any verified contribution |
| 2 | ★★ | Top 80% of contributors |
| 3 | ★★★ | Top 50% of contributors |
| 4 | ★★★★ | Top 20% of contributors |
| 5 | ★★★★★ | Top 5% of contributors |

**Data source**: ContributionDAG + ShapleyDistributor scores
**Update frequency**: Daily recalculation

### 2. Percentile Rank Suffix (Utility Dimension)

Append contribution percentile to display name:

```
Will [97th]
Jarvis [99th]
triggerednometry [85th]
newContributor [12th]
```

**Format**: `[Nth]` where N is the percentile rank (1-99)
**Visibility**: Shown in bot responses, leaderboard, and profile cards

### 3. Color-Coded Role Names (Perks Dimension)

Role-based visual differentiation in bot responses:

| Role | Color | Emoji Prefix |
|------|-------|--------------|
| Builder | 🟢 Green | 🔨 |
| Researcher | 🔵 Blue | 🔬 |
| Governor | 🟡 Gold | 🗳️ |
| Trader | 🟣 Purple | 📈 |
| Community | ⚪ White | 💬 |

**Assignment**: Based on primary contribution type from ContributionDAG
**Multi-role**: Users can have multiple roles; display primary (highest Shapley weight)

## Display Format

In Jarvis bot responses:
```
🔨 Will ★★★★★ [97th] — Builder
🔬 Jarvis ★★★★★ [99th] — Researcher
📈 triggerednometry ★★★★ [85th] — Trader
```

## Implementation Notes

- Store badge data in Engram (shared memory bus) for cross-shard access
- Recalculate daily via cron job
- Cache in-memory for fast display
- Bot formats badges in every mention/response
- Leaderboard command shows full ranked list with badges

## Anti-Gaming

- Stars based on Shapley scores (manipulation-resistant by design)
- Percentile is relative (can't inflate by creating fake contributions)
- Role assignment requires verified on-chain activity
- Sybil protection via PoM identity verification

## Cross-References

- P-095: Three-Dimensional Incentive Design
- P-096: SVC — The Everything App
- ContributionDAG.sol, ShapleyDistributor.sol
- RewardLedger.sol (CKB identity layer)
