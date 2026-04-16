# Peer Challenge-Response Oracle

## Problem

Any protocol that consumes **self-reported economic inputs** is vulnerable to the operator lying. Classic examples: a node reports how many cells it served, a validator reports uptime, a bridge reports a TWAP price, a reward contract reads user-supplied fee multipliers. If the self-reported value feeds a reward or a state transition, the operator's incentive is to inflate.

Naive fixes all have failure modes:
- **Committee / council vote** — reintroduces plutocracy and rent.
- **External oracle (Chainlink etc.)** — adds a trust dependency and doesn't generalize to domain-specific claims (e.g., "is this meme canonical?").
- **ZK proofs** — expensive, requires the claim to be expressible as a circuit.

**The bug class**: any reward path or state transition whose input comes from a single self-interested party, with no structural cost to lying.

## Solution

Optimistic commit + Merkle-proof dispute window + bonded challenger.

1. **Commit**: operator submits `(claimed_value, merkle_root_over_evidence_bundle)`. Weight does **not** update yet.
2. **Challenge window** (e.g., 1 hour): anyone can post a challenge bond and name a specific leaf of the evidence bundle they believe the operator cannot prove.
3. **Response window** (e.g., 30 min): operator has this long to produce a valid Merkle proof for the challenged leaf.
   - Valid proof → challenger's bond forfeits to the operator. Report remains pending.
   - No response → challenger permissionlessly triggers a slash: operator loses N% of stake, slashed amount + bond paid to the challenger.
4. **Finalize**: if the challenge window closes with no active challenge, anyone permissionlessly finalizes the report and the claimed value updates weight.

Economic deterrent: lying costs stake; honest operators are self-selecting. No committee, no trusted third party, no ZK circuit.

**Important**: the Merkle proof only verifies that the committed leaf exists. For the game to be meaningful the protocol must also verify that the leaf's **content** is real (e.g., the cellId refers to an actual active cell in a canonical registry — see *Where it lives in VibeSwap* for the VibeSwap composition).

## Code sketch

```solidity
struct PendingReport {
    uint256 claim;
    bytes32 merkleRoot;
    uint256 commitAt;
    uint256 finalizeAt;
    address challenger;
    uint256 challengeIndex;
    uint256 challengerBond;
    uint256 challengeDeadline;
    bool resolved;
}

function commit(uint256 claim, bytes32 root) external {
    // operator-only; weight does NOT update here
    pendingReports[msg.sender] = PendingReport({
        claim: claim, merkleRoot: root,
        commitAt: block.timestamp,
        finalizeAt: block.timestamp + CHALLENGE_WINDOW,
        challenger: address(0), challengeIndex: 0,
        challengerBond: 0, challengeDeadline: 0, resolved: false
    });
}

function challenge(address op, uint256 leafIndex) external {
    PendingReport storage p = pendingReports[op];
    require(p.challenger == address(0), "already challenged");
    require(msg.sender != op, "no self-challenge");
    bondToken.safeTransferFrom(msg.sender, address(this), CHALLENGE_BOND);
    p.challenger = msg.sender;
    p.challengeIndex = leafIndex;
    p.challengerBond = CHALLENGE_BOND;
    p.challengeDeadline = block.timestamp + RESPONSE_WINDOW;
}

function respond(address op, bytes32 leafData, bytes32[] calldata proof) external {
    PendingReport storage p = pendingReports[op];
    require(msg.sender == op, "only operator may refute");
    bytes32 leaf = keccak256(abi.encode(p.challengeIndex, leafData));
    require(MerkleProof.verify(proof, p.merkleRoot, leaf), "bad proof");
    // Domain-specific: verify leaf content is real (not just committed)
    require(canonicalRegistry.isActive(leafData), "fabricated");
    // Bond forfeits to operator; challenge clears
    bondToken.safeTransfer(op, p.challengerBond);
    p.challenger = address(0);
}

function slash(address op) external {
    PendingReport storage p = pendingReports[op];
    require(p.challenger != address(0), "no active challenge");
    require(block.timestamp > p.challengeDeadline, "response window open");
    uint256 slashAmount = (stake[op] * SLASH_BPS) / 10_000;
    stake[op] -= slashAmount;
    bondToken.safeTransfer(p.challenger, slashAmount + p.challengerBond);
    p.resolved = true;
}
```

## Where it lives in VibeSwap

- `contracts/consensus/ShardOperatorRegistry.sol` — full implementation for cell-serving reports.
  - Commit `00194bbb` — initial peer challenge-response (Cycle 10.1).
  - Commit `49e7fa72` — hardening against self-challenge, deactivate-escape, gas-grief (Cycle 11 Batch A).
  - Commit `61e77e66` — cell-existence cross-ref to `StateRentVault` closes "commit to any preimage" gap (Cycle 11 Batch C).
- `contracts/consensus/StateRentVault.sol` — canonical registry the oracle cross-references.

The VibeSwap implementation composes *existence verification* (is the cellId real?) with *commitment verification* (is it in the committed bundle?). The base pattern in this document is the commitment layer; pairing it with a canonical registry closes the fabricated-content attack.

## Attribution

- Base pattern: optimistic rollup / Truebit-style computation games (Matter Labs, Optimism, Arbitrum research 2019-2021).
- VibeSwap composition (cells-served application): Will Glynn, 2026-04.
- Hardening: TRP + RSI Cycles 10.1 and 11. Attack surface documented in `memory/project_full-stack-rsi.md`.
- Audit validation: DeepSeek-V4lite (Round 2, 2026-04-16) — "The mechanism is sound in principle and a major improvement over a committee or token vote."

If you reuse this pattern, credit both the optimistic-rollup lineage and the VibeSwap composition that made it applicable beyond computation to self-reported economic inputs.
