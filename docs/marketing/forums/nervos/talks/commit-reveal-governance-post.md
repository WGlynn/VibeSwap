# Commit-Reveal Governance: Killing the Bandwagon Before It Starts

*Nervos Talks Post -- Faraday1*
*March 2026*

---

## TL;DR

DAO governance is broken. Not because voters are stupid, but because they can see each other's votes. Bandwagoning, strategic late-voting, and vote-buying all exploit the same vulnerability: **transparent ballots during open voting windows**. We took the same commit-reveal pattern that eliminates MEV in our trading auctions and extended it to governance on longer timescales. Voters commit hashed votes, then reveal after the window closes. Don't reveal? 50% of your deposit is slashed. The result: authentic preference revelation by construction. CKB's cell model and `Since` timelocks make this pattern structurally enforceable rather than conditionally checked.

---

## The Problem With Every DAO Vote You've Ever Participated In

Think about the last governance vote you cast. Did you:

1. Read the proposal carefully and vote based on conviction?
2. Check what the whales voted, then vote the same way?
3. Wait until the last moment to see which side was winning?
4. Not vote at all because the outcome seemed predetermined?

If you answered 2, 3, or 4 -- congratulations, you're a rational actor responding to incentives. The system is designed to produce exactly this behavior.

When votes are visible during the voting window, three pathologies emerge:

| Pathology | Mechanism | Result |
|---|---|---|
| **Bandwagoning** | Voters copy the leading side | Artificial supermajorities, minority preferences silenced |
| **Strategic timing** | Wait until last block, swing the vote | Informed voters dominate, casual voters disenfranchised |
| **Vote buying** | Verify on-chain that bribed voter complied | Direct corruption of governance outcomes |

These aren't edge cases. They're the default behavior of every transparent-ballot governance system in DeFi.

---

## The Commit-Reveal Fix

Our `CommitRevealGovernance.sol` contract applies the same pattern that eliminates MEV in our trading auctions -- but on governance timescales.

### Phase 1: Commit (Default: 2 Days)

Voters submit `keccak256(abi.encodePacked(voter, voteId, choice, secret))` along with an ETH deposit (minimum 0.001 ETH). The hash commits them to a specific choice (FOR, AGAINST, or ABSTAIN) without revealing it.

During this phase:
- Nobody can see how anyone else voted
- The on-chain data is a hash -- indistinguishable from noise
- Vote weight is snapshotted from the voter's JUL token balance at commit time
- One commit per voter per vote (enforced by `hasCommitted` mapping)
- SoulboundIdentity check prevents Sybil attacks -- one identity, one vote

```
commitVote(voteId, commitHash) payable
  -> Requires: SoulboundIdentity, deposit >= minDeposit, not already committed
  -> Snapshots: JUL balance as vote weight
  -> Stores: hash, deposit, weight
  -> Returns: unique commitId
```

### Phase 2: Reveal (Default: 1 Day)

After the commit window closes, voters reveal their choice and secret. The contract verifies the hash matches:

```
revealVote(voteId, commitId, choice, secret)
  -> Verifies: keccak256(voter, voteId, choice, secret) == stored hash
  -> Applies: weight to FOR/AGAINST/ABSTAIN tally
  -> Refunds: full deposit on valid reveal
```

Only now do votes become visible. But the commit window is closed -- no one can change their vote based on what they see.

### Phase 3: Slash the Silent

Here's where the teeth are. If you committed but didn't reveal, anyone can call `slashUnrevealed`:

```
slashUnrevealed(voteId, commitId)
  -> Requires: reveal phase over, commitment not revealed
  -> Slashes: 50% of deposit (configurable, default 5000 bps)
  -> Sends: slash to DAO treasury
  -> Refunds: remaining 50% to voter
```

This is directly mirrored from our `CommitRevealAuction.sol` trading mechanism. The 50% slash rate is the same. The rationale is the same: commitment without follow-through damages the system (in trading, it corrupts batch pricing; in governance, it corrupts quorum calculations).

### Phase 4: Tally and Execute

After reveals close, `tallyVotes` checks: did total revealed weight meet quorum (default: 1000 JUL weight)? Did FOR outweigh AGAINST? If yes, authorized resolvers can execute.

```
tallyVotes(voteId)
  -> passed = (totalWeight >= quorumWeight) && (forWeight > againstWeight)

executeVote(voteId)
  -> Requires: vote passed, caller is resolver or owner
  -> Marks: executed = true
```

---

## Why This Is Different From Snapshot + Timelock

You might think: "Snapshot already does off-chain voting, and most DAOs have timelocks." True. But:

**Snapshot votes are visible.** The entire premise of Snapshot is transparent, gasless voting. Every pathology listed above applies in full.

**Timelocks protect against execution, not against strategic voting.** A timelock between "vote passes" and "vote executes" gives people time to exit. It does nothing about bandwagoning during the vote itself.

**Commit-reveal protects the voting process itself.** The information asymmetry that enables manipulation is eliminated at the source -- during the commit phase, there IS no information to exploit.

| Feature | Snapshot | Governor + Timelock | CommitRevealGovernance |
|---|---|---|---|
| Vote privacy during voting | No | No | Yes |
| Anti-bandwagoning | No | No | Yes (by construction) |
| Anti-vote-buying | No | No | Yes (can't verify compliance) |
| Sybil resistance | Token-gated | Token-gated | SoulboundIdentity |
| Commitment enforcement | None | None | 50% deposit slash |
| On-chain settlement | No | Yes | Yes |

---

## The Contract Architecture

The full lifecycle managed by `CommitRevealGovernance.sol`:

**Structs** (from the interface):

```
GovernanceVote {
    proposer, description, ipfsHash,
    phase (COMMIT -> REVEAL -> TALLY -> EXECUTED),
    commitEnd, revealEnd,
    forWeight, againstWeight, abstainWeight,
    commitCount, revealCount, slashedDeposits,
    executed
}

VoteCommitment {
    commitHash, deposit, voter,
    revealed, choice, weight
}
```

**Access Control Layers**:
- **SoulboundIdentity**: Every voter must have a verified identity. No identity, no vote. Prevents Sybil attacks across multiple wallets.
- **ReputationOracle**: Only voters with minimum reputation tier can create proposals (default: tier 1). Prevents spam proposals.
- **Resolvers**: Authorized addresses that can execute passed votes. Separation of voting from execution.
- **Owner**: Can adjust parameters (deposit, slash rate, quorum, durations, proposer tier).

**Key Parameters** (defaults):
- Commit duration: 2 days
- Reveal duration: 1 day
- Minimum deposit: 0.001 ETH
- Slash rate: 50% (5000 bps)
- Quorum: 1000 JUL weight
- Proposer tier: 1

---

## Why CKB Is the Right Substrate

The commit-reveal governance pattern maps to CKB's cell model with structural elegance:

### Vote Commitments as Cells

Each vote commitment becomes an independent cell:
- **Data**: The commit hash, deposit amount, weight snapshot
- **Lock script**: Voter's address (only they can reveal)
- **Type script**: CommitRevealGovernance validation logic

The cell physically represents the commitment. It's not a storage slot in a monolithic contract -- it's an independent piece of state with its own access control.

### Since Timelocks for Phase Enforcement

CKB's `Since` field provides native temporal enforcement:

- Commit phase cell: lock script includes `Since` = commitEnd. Cannot be consumed (revealed) before the commit phase ends.
- Reveal phase cell: type script validates that reveal occurs before revealEnd. After revealEnd, the cell becomes slashable.

On Ethereum, phase enforcement is a `require(block.timestamp >= commitEnd)` -- a runtime check that can be called at any time and either passes or reverts. On CKB, the `Since` constraint is structural. The transaction is invalid at the consensus layer if the timelock hasn't expired. There's no "check" to pass or fail -- the constraint is part of the cell's identity.

### Slash as Cell Consumption

Slashing an unrevealed commitment on CKB means consuming the commitment cell and producing two output cells: one sending the slash amount to the treasury cell, one returning the remainder to the voter. The type script validates the 50% split. The entire slash operation is atomic and verifiable from the transaction structure alone.

| Governance Concept | Ethereum (EVM) | CKB (Cell Model) |
|---|---|---|
| Vote commitment | Storage slot in contract | Independent cell |
| Phase transition | `block.timestamp` check | `Since` timelock (structural) |
| Weight snapshot | `balanceOf()` at commit time | Cell data frozen at creation |
| Slash execution | State mutation + ETH transfer | Cell consumption + production |
| Sybil resistance | Contract call to SoulboundIdentity | Cell reference to identity cell |

---

## From 10-Second Auctions to 3-Day Governance

The same pattern, two timescales:

| Parameter | CommitRevealAuction (Trading) | CommitRevealGovernance |
|---|---|---|
| Commit window | 8 seconds | 2 days |
| Reveal window | 2 seconds | 1 day |
| Deposit | ETH (% of trade) | ETH (minimum 0.001) |
| Slash rate | 50% | 50% |
| Weight source | Order size | JUL balance snapshot |
| Settlement | Uniform clearing price | Majority tally |

The fact that the same mechanism works at both timescales is not a coincidence. It's because the underlying game theory is timescale-invariant. The commit-reveal pattern eliminates information asymmetry regardless of whether the window is 10 seconds or 10 days.

---

## Discussion

Some questions for the community:

1. **Should governance commit-reveal be mandatory or opt-in?** We default to mandatory (all votes use commit-reveal). Some argue that low-stakes votes don't need the friction of a deposit + reveal cycle. Where's the line?

2. **Is 50% the right slash rate?** Too low and voters commit carelessly without intending to reveal. Too high and marginal voters are deterred from participating. The 50% rate mirrors our trading auctions -- is that the right analogy?

3. **How do CKB Since timelocks compare to EVM timestamp checks for governance?** We argue Since is structurally superior because it's consensus-enforced rather than runtime-checked. Are there edge cases in CKB's Since implementation that governance designers should know about?

4. **Can commit-reveal governance work for continuous/streaming proposals?** Our current implementation uses discrete vote windows. Could a CKB implementation use rolling commitment periods where cells accumulate and reveal on a continuous basis?

---

*"Fairness Above All."*
*-- P-000, VibeSwap Protocol*

*Contract: [CommitRevealGovernance.sol](https://github.com/wglynn/vibeswap/blob/master/contracts/mechanism/CommitRevealGovernance.sol)*
*Code: [github.com/wglynn/vibeswap](https://github.com/wglynn/vibeswap)*
