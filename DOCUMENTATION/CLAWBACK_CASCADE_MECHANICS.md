# Clawback Cascade — Mechanics

**Status**: Live in `contracts/compliance/ClawbackRegistry.sol` + `contracts/compliance/ClawbackVault.sol`.
**Classification**: ETM MIRRORS ([audit](./ETM_ALIGNMENT_AUDIT.md) §5.2).
**Sibling doc**: [`CLAWBACK_CASCADE.md`](./CLAWBACK_CASCADE.md) exists as higher-level overview; this document focuses on mechanics — the topological-propagation algorithm, contest windows, and edge cases.
**Related**: [Siren Protocol](./SIREN_PROTOCOL.md), [Augmented Mechanism Design](./AUGMENTED_MECHANISM_DESIGN.md).

---

## The paradigm Clawback Cascade breaks

*"Blacklisted addresses lose their funds."*

Standard DeFi/compliance practice when funds are identified as tainted (stolen, sanctioned, or otherwise disallowed): freeze or blacklist the address. The assumption: taint is address-bound; once tainted, the address is a pariah.

Clawback Cascade rejects this. Taint is **transaction-graph-bound**, not address-bound. When funds from address A (tainted source) are sent to address B via trade, swap, or bridge, B now holds a tainted portion proportional to A's share. B has contest rights within a window; uncontested taint claws back. B's own downstream transactions propagate the taint topologically to C, D, E, each with their own contest window.

This matches how cognitive-economic taint actually propagates: if you learn a source you relied on was fraudulent, you re-evaluate everything you learned from that source and everything you taught others based on it. The re-evaluation follows the graph, not the label.

## The topological propagation algorithm

Given tainted source T, tainted amount V, and a transaction history H:

```
function propagateTaint(T, V, H):
    taintedAccounts = {T: V}
    queue = [T]
    while queue is non-empty:
        current = queue.pop()
        for each transaction TX in H where TX.from == current:
            portion = (current_tainted_amount × TX.amount) / total_outflow(current)
            taintedAccounts[TX.to] += portion
            queue.append(TX.to)
    return taintedAccounts
```

Key properties:
- **Proportional**. If address X has 10% tainted funds and sends 1000 to Y, Y becomes 100-tainted.
- **Transitive**. Taint propagates through multiple hops.
- **Conservation**. Total tainted across all reachable addresses equals the original V (within floating-point tolerance).
- **Topological**. Doesn't depend on address identity, only on transaction graph.

The on-chain implementation is index-based for efficiency — transactions are tracked in `ClawbackRegistry` by topological index; queries follow the index rather than re-walking every time.

## Contest windows

Every address receiving taint gets a contest window (default 7 days). During the window:

- Address holder can dispute the taint attribution.
- Dispute requires evidence the receipt was in good faith (e.g., arbitrage trade at market price, normal DEX swap).
- Disputes are adjudicated by tribunal (judicial branch of [ContributionAttestor](./CONTRIBUTION_ATTESTOR_EXPLAINER.md) or a dedicated dispute contract).
- Resolved disputes either clear the taint (good faith upheld) or confirm clawback (bad faith proven).
- Unresolved disputes at window-end default to clawback.

Window length trade-off:
- Shorter → faster recovery; risk of cutting off good-faith holders.
- Longer → thorough due process; recovery delayed past usefulness.

Current 7-day default is empirical; subject to governance tuning.

## The clawback execution

When a window expires with taint uncontested:

1. `ClawbackVault.executeClaw(address, amount)` is called.
2. The vault transfers the tainted amount from the address's balance to the recovery destination (usually a governance-controlled recovery fund).
3. The transfer fires `ClawedBack(from, to, amount)` event.
4. Downstream addresses that derived their taint from this one have their taint-attribution updated (their taint is now confirmed, not provisional).

Execution is permissionless — anyone can call `executeClaw` after window-end. Permissionless execution prevents a malicious admin from selectively blocking clawback on favored addresses.

## Why not address-based freezing

Address freezing has several failure modes Clawback Cascade avoids:

### Failure 1 — Fungibility violation

Address-freezing treats the entire address as tainted. But the address may hold mostly-clean funds with only a small tainted portion. Freezing the whole address punishes the clean majority for the tainted minority.

Clawback Cascade only claws back the proportional tainted amount. The clean portion stays with the holder.

### Failure 2 — Sybil rotation

An address-based system can be defeated by moving tainted funds through multiple intermediaries. Each address-freeze is a per-address action; the attacker moves faster than the freezes.

Clawback Cascade's topological propagation follows the graph automatically. Moving through intermediaries doesn't escape the taint — each intermediary has their taint portion with contest rights.

### Failure 3 — Governance capture

Address-freeze lists invite governance capture: who adds addresses? whose addresses? The authority to freeze is a powerful censorship primitive.

Clawback Cascade separates detection (anyone can flag a tainted source with evidence) from adjudication (tribunal process). No single authority controls who gets taint.

## Edge cases

### Edge case 1 — Cycles in the transaction graph

Can funds circulate through A → B → C → A? Yes, and the algorithm handles this. When the loop closes, address A already has a taint amount from the original tainting; the re-tainted portion is added (with attribution tracking to prevent double-counting the conservation).

### Edge case 2 — Mixed-origin liquidity pools

A liquidity pool receives tainted swap input. The LP's share of the pool is now partially tainted proportional to the pool's total tainted fraction.

This is a real concern for DeFi integrations. Clawback Cascade handles it correctly by applying the taint fraction to the LP's share; it does NOT taint the entire pool. Other LPs are not affected unless they themselves had interaction with the taint.

### Edge case 3 — Flash-loan through tainted source

A flash loan that borrows from a tainted source and repays within the same transaction: the funds never really settle. No new taint propagates in this case because the inflow is matched by an equal outflow instantly.

This depends on accurate transaction-graph indexing at the right granularity.

### Edge case 4 — Cross-chain

Currently limited to same-chain propagation. Bridged funds break the graph (new chain has different tracking).

Mitigations planned: LayerZero integration + cross-chain registry replication. Future cycle.

### Edge case 5 — Off-chain recipients

If tainted funds are sold through a centralized exchange, the propagation ends at the exchange's hot wallet (on-chain). Subsequent off-chain flows are outside Clawback Cascade's scope.

Mitigation: coordinate with exchanges to report downstream receipts. Partial — exchanges aren't obligated to participate.

## Who flags taint

Detection is permissionless — anyone can submit a claim:

```solidity
function flagTaint(
    address source,
    uint256 amount,
    bytes32 evidenceHash,
    uint256 incidentId
) external
```

Requires:
- `evidenceHash` committing to an off-chain evidence bundle (court order, stolen-funds proof, sanctions-list reference, etc.).
- `incidentId` linking to a tribunal case or governance proposal.
- Stake bond to prevent spam flagging (default 1 ETH; governance-tunable).

Frivolous flags lose the bond. Real flags get the bond back upon tribunal confirmation.

## Who adjudicates

Tribunal jury or governance, depending on scope:

- Routine taint (clearly stolen, matches on-chain attack patterns) → tribunal jury.
- Complex or ambiguous (legal gray area, jurisdictional questions) → governance proposal.

The adjudication produces a binding outcome. Tribunal verdicts override executive-branch provisional taint; governance overrides both.

## Interaction with Siren Protocol

[Siren Protocol](./SIREN_PROTOCOL.md) deters attacks; Clawback Cascade recovers proceeds when deterrence fails.

Sequence:
1. Attacker engages with protocol → Siren raises signal-score → attacker pays rent.
2. If Siren-rent is insufficient to deter, attacker proceeds and succeeds in extracting funds.
3. Post-attack, detection-community flags the tainted source.
4. Clawback Cascade propagates taint through the attacker's flow.
5. Funds recovered, proportional to how much of the flow is on-chain and within contest window.

Together, Siren + Clawback give defense-in-depth against value extraction: first deter, then recover.

## The cognitive-parallel, deeper

[ETM audit](./ETM_ALIGNMENT_AUDIT.md) §5.2 identified the cognitive parallel. Expanding:

In cognition, "tainted information" (misinformation, bias, compromised source) propagates through the belief graph. The mind's response is a topological re-evaluation: update everything downstream of the compromised source.

The temporal window parallels cognitive "epistemic latency": we don't instantly update every downstream belief — we wait (typically days to weeks) for context to clarify, allow good-faith re-interpretation, then decisively update.

VibeSwap's clawback window implements this cognitive pattern. Immediate clawback would be the cognitive equivalent of snap-updating all beliefs on any new information; permanent clawback without contest would be refusing to re-evaluate. The window is the cognitive-economic balance.

## Governance role

Clawback is powerful. Governance controls:
- Contest window duration.
- Recovery destination (where clawed-back funds go).
- Stake bond for flagging.
- Tribunal jury selection criteria.
- Meta-overrides when specific clawbacks are disputed at the governance level.

The governance role keeps Clawback Cascade from being a unilateral weapon. Multiple check-points prevent any single actor from weaponizing the mechanism.

## Open questions

1. **Optimal contest window length** — 7 days is intuitive but may be suboptimal. Need empirical data on contest-processing time.
2. **Proportional-vs-full clawback at high taint fractions** — if an address is 95% tainted, should the remaining 5% also be clawed as "practically wholly tainted"? Currently proportional; could become threshold-based.
3. **Cross-chain registry replication** — when bridged funds span LayerZero, how do registries coordinate? Active research.

## One-line summary

*Clawback Cascade propagates taint topologically through the transaction graph with proportional attribution and 7-day contest windows — recovers stolen/tainted funds without freezing fungibility, preserves good-faith holders, permissionless detection + adjudicated resolution. The cognitive-economic update dynamic on-chain.*
