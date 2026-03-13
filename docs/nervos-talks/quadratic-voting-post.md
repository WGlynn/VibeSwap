# Quadratic Voting: The Math That Kills Plutocracy

*Nervos Talks Post -- W. Glynn (Faraday1)*
*March 2026*

---

## TL;DR

One token, one vote is oligarchy with extra steps. If a whale holds 1M tokens and you hold 100, the whale has 10,000x your voting power -- the same ratio as medieval feudalism, just denominated in ERC-20s instead of land. Our `QuadraticVoting.sol` contract fixes this by making the cost of N votes equal to N-squared tokens. One vote costs 1 JUL. Two votes cost 4. Ten votes cost 100. A hundred votes cost 10,000. The whale can still vote more than you -- but the cost curve punishes concentration so steeply that the community's aggregate voice dominates. Combined with SoulboundIdentity for Sybil resistance, one verified identity equals one voter regardless of how many wallets they control. CKB's type scripts can enforce quadratic cost natively, and cell-based identity binding prevents the Sybil workaround that breaks every other QV implementation.

---

## The Plutocracy Problem

Here's a table that should make every DAO participant uncomfortable:

| Token Holder | Tokens | 1-Token-1-Vote Power | % of Total |
|---|---|---|---|
| Whale A | 1,000,000 | 1,000,000 votes | 90.83% |
| Whale B | 100,000 | 100,000 votes | 9.08% |
| 100 Community Members | 100 each (10,000 total) | 10,000 votes | 0.09% |

One hundred people are completely irrelevant in this governance system. The top two holders decide everything. The community members might as well not vote at all.

This is the default governance model for almost every DeFi protocol. Compound, Uniswap, Aave, MakerDAO -- all use token-weighted voting. All are plutocracies by construction.

The defense is usually: "But tokens are distributed!" They aren't. The top 10 wallets control 40-60% of most governance tokens. And even if they were perfectly distributed today, market dynamics reconcentrate them over time.

---

## How Quadratic Voting Works

The core mechanism is simple. Deceptively simple:

**Cost of N votes = N^2 tokens**

| Votes Cast | Cost (JUL) | Marginal Cost of Next Vote |
|---|---|---|
| 1 | 1 | 1 |
| 2 | 4 | 3 |
| 3 | 9 | 5 |
| 5 | 25 | 9 |
| 10 | 100 | 19 |
| 50 | 2,500 | 99 |
| 100 | 10,000 | 199 |
| 1,000 | 1,000,000 | 1,999 |

Now recalculate the plutocracy table:

| Token Holder | Tokens | QV Votes (max) | % of Total |
|---|---|---|---|
| Whale A | 1,000,000 | 1,000 votes | 83.3% ... wait |
| Whale B | 100,000 | 316 votes | ... |
| 100 Community Members | 100 each | 10 each (1,000 total) | ... |

Actually, let's calculate this properly.

- Whale A: sqrt(1,000,000) = 1,000 maximum votes
- Whale B: sqrt(100,000) = 316 maximum votes
- 100 community members: sqrt(100) = 10 each, 1,000 total

Total votes: 1,000 + 316 + 1,000 = 2,316

| Token Holder | QV Votes | % of Total |
|---|---|---|
| Whale A | 1,000 | 43.2% |
| Whale B | 316 | 13.6% |
| 100 Community Members | 1,000 | 43.2% |

The community went from 0.09% to 43.2% of voting power. The whale went from 90.83% to 43.2%. Same tokens, same distribution -- the cost function changed everything.

**Quadratic voting doesn't eliminate the influence of wealth. It taxes it.** The marginal cost of additional influence increases linearly, creating a natural brake on concentration.

---

## The Contract Implementation

### Creating Proposals

```
createProposal(description, ipfsHash)
  -> Requires: SoulboundIdentity verified
  -> Requires: ReputationOracle tier >= minProposerTier (default: 1)
  -> Requires: JUL balance >= proposalThreshold (default: 100 JUL)
  -> Creates: proposal with ACTIVE state, 3-day voting window
```

Three layers of access control for proposal creation:
1. **SoulboundIdentity**: You must be a verified unique human
2. **ReputationOracle**: You must have earned minimum reputation
3. **Token threshold**: You must hold at least 100 JUL (skin in the game)

### Casting Votes

This is where the quadratic math lives. From the contract:

```solidity
uint256 existingVotes = support ? position.votesFor : position.votesAgainst;
uint256 newTotal = existingVotes + numVotes;
uint256 incrementalCost = (newTotal * newTotal) - (existingVotes * existingVotes);
```

The incremental cost formula handles the case where a voter adds votes to an existing position. If you already have M votes and want to add K more:

```
Cost = (M + K)^2 - M^2 = 2MK + K^2
```

This means adding votes gets progressively more expensive even within a single proposal. Your first vote costs 1. If you already have 10 votes and want one more, it costs 21 (11^2 - 10^2).

Tokens are transferred from the voter to the contract via `safeTransferFrom`. They're locked until the proposal is finalized. This is real token locking, not just a delegation snapshot.

**Bidirectional voting**: Voters can cast votes both FOR and AGAINST the same proposal. Each direction has its own quadratic cost curve. This allows expressing nuanced positions -- "I somewhat support this but also have concerns" -- priced at the quadratic rate.

```
VoterPosition {
    votesFor: uint256,
    votesAgainst: uint256,
    tokensLocked: uint256,
    withdrawn: bool
}
```

### Finalization and Withdrawal

```
finalizeProposal(proposalId)
  -> Requires: voting period ended (block.timestamp >= endTime)
  -> If totalVotes >= quorumVotes AND forVotes > againstVotes: SUCCEEDED
  -> Otherwise: DEFEATED

withdrawTokens(proposalId)
  -> Requires: proposal finalized (DEFEATED/SUCCEEDED/EXECUTED/EXPIRED)
  -> Returns: all locked JUL tokens to voter
```

After finalization, ALL voters get their tokens back -- winners and losers alike. Quadratic voting taxes concentration through the cost curve, not through confiscation. The tokens are locked during voting to prevent double-spending across proposals, then fully returned.

---

## The Sybil Problem and SoulboundIdentity

Quadratic voting has a well-known vulnerability: **Sybil attacks**.

If one vote costs 1 JUL but 100 votes cost 10,000 JUL, a whale can split their tokens across 100 wallets and cast one vote from each -- paying 100 JUL instead of 10,000 for the same 100 votes.

This is why every QV implementation without Sybil resistance is broken. And why our contract integrates with `SoulboundIdentity` at every entry point:

```solidity
// In createProposal:
if (!soulboundIdentity.hasIdentity(msg.sender)) revert NoIdentity();

// In castVote:
if (!soulboundIdentity.hasIdentity(msg.sender)) revert NoIdentity();
```

SoulboundIdentity is a non-transferable credential that maps one verified identity to one address. You can have multiple wallets, but only one can have a SoulboundIdentity. Splitting tokens across wallets doesn't help because only the identity-bound wallet can vote.

Without this, quadratic voting is a meme. With it, it's the most equitable governance mechanism known to game theory.

---

## Why CKB Is the Right Substrate

### Quadratic Cost as Type Script

On Ethereum, quadratic cost is enforced by Solidity arithmetic inside a contract's `castVote` function. The math is correct, but the enforcement is procedural -- it's code that runs and checks conditions.

On CKB, quadratic cost can be enforced by the type script of the voting cell itself. When a vote cell is created, the type script verifies that the accompanying token input satisfies `tokens_consumed >= votes^2`. This isn't a "check" -- it's a structural requirement for the cell to exist.

The distinction matters: on Ethereum, a bug in the contract could bypass the cost check (wrong operator, integer overflow, delegatecall to malicious implementation). On CKB, the type script IS the cost function. If the type script is correct, every cell that exists has paid the quadratic cost. Existence implies validity.

### Identity Binding via Cell References

The Sybil check on Ethereum is a contract call: "Does this address have an identity?" The identity contract can be upgraded, paused, or compromised independently of the voting contract.

On CKB, identity binding works through cell references. A vote cell's type script can require that the transaction includes an identity cell as a cell dependency (CellDep). The identity cell's type script validates its own integrity. The two cells compose at the transaction level -- no external contract call, no separate trust assumption.

```
Transaction {
  inputs: [token_cells (JUL payment)]
  outputs: [vote_cell { votes: N, direction: FOR }]
  cell_deps: [identity_cell (proves unique personhood)]
}
```

The type script for vote_cell validates:
1. Token inputs >= N^2 (quadratic cost)
2. identity_cell in cell_deps is valid (Sybil resistance)
3. No other vote_cell from this identity exists for this proposal (one-identity-one-voter)

All three checks happen in a single transaction verification. No re-entrancy risk. No state inconsistency between contracts. Atomic by construction.

### Token Locking as Cell Ownership

On Ethereum, "locking" tokens means transferring them to the contract address. The contract's internal accounting tracks who owns what. If the contract has a bug, locked tokens can be lost.

On CKB, token locking means the token cells are consumed and new cells are produced with a lock script that enforces the voting contract's rules. The voter's tokens are represented as cells they still "own" in a meaningful sense -- the lock script just adds conditions (proposal must be finalized before these cells can be spent). No custodial risk. The tokens are locked by logic, not by location.

| QV Concept | Ethereum | CKB |
|---|---|---|
| Cost enforcement | Contract arithmetic | Type script (existence = validity) |
| Sybil resistance | External contract call | Cell dependency (atomic) |
| Token locking | Transfer to contract | Lock script condition |
| Vote position | Storage mapping | Independent cell |
| Withdrawal | Contract sends tokens back | Voter consumes their own cells |

---

## The Deeper Point: Preference Intensity

Quadratic voting isn't just a cost function. It's a mechanism for expressing **preference intensity**.

In 1-token-1-vote, there's no way to say "I care about this proposal a LOT." You either vote or you don't. One unit of voting power per token, full stop.

In QV, you can choose how many votes to cast. Casting more votes costs quadratically more tokens. This means voters self-sort: those who care intensely pay the premium, those who are indifferent save their tokens for proposals they care about more.

The result is a governance system that optimizes for aggregate welfare, not for aggregate capital. This is the formal result from Lalley and Weyl (2018): under mild conditions, quadratic voting maximizes utilitarian social welfare.

VibeSwap's implementation goes further by combining QV with:
- **SoulboundIdentity**: one identity, one voter (not one wallet, one voter)
- **ReputationOracle**: only reputable participants propose
- **Token threshold**: minimum skin in the game for proposers
- **Token return**: all tokens refunded after voting ends (no confiscation, just opportunity cost)

The philosophy is Cooperative Capitalism: markets allocate resources, but the cost function ensures no single actor dominates the allocation.

---

## Discussion

Some questions for the community:

1. **Is quadratic cost sufficient, or should the exponent be higher?** QV uses N^2. Some researchers propose N^3 or even exponential costs for stronger anti-plutocracy properties. What's the right balance between whale resistance and expressiveness?

2. **How should SoulboundIdentity work on CKB?** The Sybil resistance layer is critical. What's the most CKB-native approach to non-transferable identity -- a cell with a type script that prevents transfers? A reference to an off-chain verification (e.g., Worldcoin, Gitcoin Passport)?

3. **Should QV tokens be returned or burned?** Our implementation returns all tokens after finalization. An alternative: burn the quadratic premium (the difference between cost and sqrt) and return only the base. This creates a real cost to voting rather than just an opportunity cost. Which is better for governance quality?

4. **Can QV and conviction voting be combined?** Quadratic cost for vote weight + time-weighted conviction for activation threshold. The voter pays N^2 for N votes, and those votes accumulate conviction over time. Has anyone modeled this hybrid?

---

*"Fairness Above All."*
*-- P-000, VibeSwap Protocol*

*Contract: [QuadraticVoting.sol](https://github.com/wglynn/vibeswap/blob/master/contracts/mechanism/QuadraticVoting.sol)*
*Code: [github.com/wglynn/vibeswap](https://github.com/wglynn/vibeswap)*
