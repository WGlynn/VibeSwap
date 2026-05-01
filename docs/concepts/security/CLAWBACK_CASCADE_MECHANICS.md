# Clawback Cascade — Mechanics

**Status**: Live in `contracts/compliance/ClawbackRegistry.sol` + `ClawbackVault.sol`.
**Audience**: First-encounter OK. Walked taint propagation scenario.

---

## A story that motivates the design

2021: someone hacks a DEX for $100M. They withdraw funds to their own wallet.

Standard response: exchanges freeze the attacker's addresses. Hack-linked wallets blacklisted.

Problem: the attacker moves funds through:
- CEX deposit + CEX withdrawal (laundered through exchange).
- Decentralized mixer.
- Multiple pass-through wallets.
- AMM swaps for other tokens.

Each hop makes address-based freezing harder. By the end, "dirty money" is commingled with "clean money" in hundreds of wallets.

Traditional response: freeze these too. Now many legitimate users have frozen assets because a tiny fraction passed through attacker's funds. Fair? No. Effective? Barely.

This is the limit of address-based blacklisting. There must be a better way.

## The Clawback Cascade approach

Instead of blacklisting addresses, propagate TAINT along the transaction graph.

If $100M is tainted at address X, and $1M of it flowed through address Y (alongside $9M of Y's clean funds), then Y is 10% tainted.

If Y sends $1M to Z, Z is 10% tainted on the $1M = $100K tainted.

Taint propagates topologically. Proportionally. Every node in the graph carries a partial taint fraction.

And — crucially — anyone receiving taint has a contest window to dispute.

## Walk through taint propagation

**Day 0**: Attacker's address A has 100 units of stolen funds.

**Day 1**: A transfers 10 units to B. B was legitimate before; now B has 10 tainted.

Clawback registry records: B is 100% tainted on those 10 units.

**Day 2**: B has 90 units of clean funds + 10 tainted = 100 total. B transfers 50 units to C.

Proportional split: 50 × (10/100) = 5 tainted units to C. B keeps 45 clean + 5 tainted = 50.

**Day 3**: C has 5 tainted + some clean funds (let's say 95 clean) = 100 total. C transfers 10 to D.

D gets 10 × (5/100) = 0.5 tainted. C keeps 95 clean + 4.5 tainted = 99.5.

**Day 4**: The propagation continues through many hops. Each transaction carries proportional taint based on the sending account's taint fraction.

## The contest window

Every address receiving taint gets a contest window (default 7 days). During the window:

- The address holder can dispute the taint attribution.
- Dispute requires evidence the receipt was in good faith.
- Adjudicated by tribunal.
- Resolved disputes either clear the taint or confirm clawback.
- Unresolved disputes at window-end default to clawback.

**Concrete contest example**:

D (above) receives 0.5 tainted units. D says: "I bought 10 units from C on Uniswap. I didn't know C was laundering. I'm a legitimate buyer."

D files a contest within the 7-day window. Tribunal reviews:
- C was indeed passing through Uniswap.
- D's purchase at the DEX was genuine arbitrage, not coordinated.

Tribunal verdict: good faith upheld. D's 0.5 tainted units are cleared.

**Non-contested example**:

Another recipient E received 20 tainted units. Never contests (or their contest is rejected). After 7 days, clawback executes — E's 20 units revert to the recovery destination.

## Why this defeats address-based attacks

Address-based freezing is defeated by Sybil rotation. Attacker moves funds through 100 different addresses; each has to be frozen individually; by the time the 100th is frozen, funds are in address 1000.

Topological propagation follows the GRAPH automatically. Moving through intermediaries doesn't escape the taint — each intermediary has proportional taint with contest rights.

Attacker can't outpace the propagation. The propagation is mathematical; it happens simultaneously across the entire graph reachable from the tainted source.

## The propagation algorithm

Given tainted source T, tainted amount V, and transaction history H:

```
function propagateTaint(T, V, H):
    taintedAccounts = {T: V}
    queue = [T]
    while queue is non-empty:
        current = queue.pop()
        current_tainted = taintedAccounts[current]
        current_balance = getBalance(current)
        
        for each transaction TX in H where TX.from == current:
            # Proportional taint transfer
            portion = (current_tainted × TX.amount) / current_balance
            taintedAccounts[TX.to] += portion
            queue.append(TX.to)
    return taintedAccounts
```

Key properties:
- **Proportional**: not all-or-nothing. 10% tainted send distributes 10% taint.
- **Transitive**: taint propagates through multiple hops.
- **Conservation**: total tainted across reachable addresses = original V (within floating-point tolerance).
- **Topological**: doesn't depend on address identity, only transaction graph.

## Contest window choice

7-day window (default) balances:

- Short enough: recovery happens in reasonable time.
- Long enough: legitimate holders have time to respond.

Shorter (3 days): too quick; some holders in different timezones/busy weeks can't respond.
Longer (30 days): too slow; recovery delayed past usefulness.

7 days is empirical. Subject to governance tuning.

## The clawback execution

When a window expires with taint uncontested:

1. `ClawbackVault.executeClaw(address, amount)` called.
2. Vault transfers tainted amount from address balance to recovery destination (usually governance-controlled recovery fund).
3. Transfer fires `ClawedBack(from, to, amount)` event.
4. Downstream addresses that derived their taint from this one have their taint-attribution updated.

**Permissionless execution**: anyone can call `executeClaw` after window-end. Prevents malicious admin from blocking clawback on favored addresses.

## Why proportional, not all-or-nothing

Address-based: whole address frozen. Y loses 100 units because 10 were tainted. Disproportionate.

Proportional: Y loses 10 tainted units. Y keeps 90 clean. Proportionate.

Benefits:
- **Fungibility preserved**: clean funds stay with owner.
- **Clawback resistance against legitimate owners**: you can't be entirely blacklisted because a tiny fraction of your funds was once tainted.
- **Fair for intermediaries**: AMMs etc. can receive tainted swap input without entire pool getting blacklisted.

## Edge cases walked

### Edge Case 1 — Cycles in the transaction graph

Can funds circulate A → B → C → A?

Yes. When the loop closes, A already has a taint amount from the original tainting. Re-tainted portion added, with attribution tracking preventing double-count.

### Edge Case 2 — Mixed-origin liquidity pools

A liquidity pool receives tainted swap input. LP's share of pool is now partially tainted proportional to pool's total tainted fraction.

This is real for DeFi integrations. Clawback Cascade handles correctly — applies taint fraction to LP's share, does NOT taint entire pool. Other LPs unaffected unless they themselves had tainted interaction.

### Edge Case 3 — Flash-loan through tainted source

Flash loan borrowing from tainted source and repaying in same transaction: funds never really settle. No new taint propagates (inflow matched by equal outflow instantly).

### Edge Case 4 — Cross-chain

Currently limited to same-chain. Bridged funds break the graph (new chain has different tracking).

Planned: LayerZero integration + cross-chain registry replication. Future cycle.

### Edge Case 5 — Off-chain recipients

Tainted funds sold through CEX end at exchange's hot wallet (on-chain). Downstream off-chain flows outside Clawback Cascade's scope.

Mitigation: coordinate with exchanges to report downstream. Partial.

## Who flags taint

Detection is permissionless:

```solidity
function flagTaint(
    address source,
    uint256 amount,
    bytes32 evidenceHash,
    uint256 incidentId
) external
```

Requires:
- `evidenceHash` committing to off-chain evidence bundle (court order, stolen-funds proof, sanctions reference).
- `incidentId` linking to a tribunal case or governance proposal.
- Stake bond (default 1 ETH) to prevent spam.

Frivolous flags lose bond. Real flags get bond back upon tribunal confirmation.

## Who adjudicates

Tribunal jury or governance, depending on scope:

- Routine taint (clearly stolen, matches on-chain attack patterns) → tribunal jury.
- Complex or ambiguous (legal gray area) → governance proposal.

Adjudication produces binding outcome.

## Interaction with Siren Protocol

[Siren Protocol](./SIREN_PROTOCOL.md) deters attacks. Clawback Cascade recovers when deterrence fails.

Sequence:
1. Attacker engages with protocol → Siren raises signal-score → attacker pays rent.
2. If Siren-rent insufficient to deter, attacker proceeds and succeeds.
3. Post-attack, detection-community flags tainted source.
4. Clawback Cascade propagates taint through attacker's flow.
5. Funds recovered, proportional to how much of flow is on-chain + within contest window.

Together: defense-in-depth. First deter; then recover.

## The cognitive parallel, deeper

In cognition, "tainted information" (misinformation, bias, compromised source) propagates through the belief graph. The mind's response is a TOPOLOGICAL re-evaluation: update everything downstream of the compromised source.

The temporal window parallels cognitive epistemic latency: we don't instantly update every downstream belief — we wait (days to weeks) for context to clarify, allow good-faith re-interpretation, then decisively update.

VibeSwap's 7-day clawback window implements this cognitive pattern.

## Governance role

Clawback is powerful. Governance controls:

- Contest window duration.
- Recovery destination.
- Stake bond for flagging.
- Tribunal jury selection criteria.
- Meta-overrides at governance level.

These prevent Clawback Cascade from being weaponized. Multiple checks prevent any single actor from weaponizing the mechanism.

## For students

Exercise: trace taint propagation through a specific transaction graph.

Setup:
- A has 100 tainted units.
- A → B: 50 units.
- B → C: 30 units.
- B → D: 20 units.
- C → E: 20 units.

Compute taint at each node. What percentages? What dollar amounts?

Apply contest reasoning: which recipients have strongest case for contesting?

## One-line summary

*Clawback Cascade propagates taint TOPOLOGICALLY through transaction graph with proportional attribution (10% taint sent = 10% of receive becomes tainted) and 7-day contest windows. Walked propagation (A→B→C→D with specific amounts). Recovers stolen/tainted funds without freezing fungibility. Permissionless detection + adjudicated resolution. Pairs with Siren Protocol: Siren deters, Clawback recovers. Cognitive epistemic-latency update pattern on-chain.*
