# commit-reveal-auction-cell-type-script

CKB type-script for the **CommitRevealAuction** mechanism: 10-second batched
auctions that dissolve MEV by separating commitment from execution. Role-
multiplexed binary covering four cells: **CommitCell**, **RevealCell**,
**BatchSettlementCell**, **SlashCell**.

REINTERPRET port of `contracts/core/CommitRevealAuction.sol`. Spec:
`contracts-ckb/specs/commit-reveal-auction.md`.

## What this is

The MEV-dissolution mechanism, in CKB-cell form. Per
[P·dissolve-attack-surface]: front-running is not deterred, it is structurally
impossible during the commit window because the only on-chain artifact is a
hash. Cell transitions enforce the property; no admin role exists.

## What this is NOT

- **Not audit-ready.** Cell-dep discrimination uses shape heuristics (length
  + version byte), not code-hash matching against the deployed Lawson /
  Pool binaries. Inline TODOs mark each gap.
- **Not blake2b-hookup-correct.** `blake2b_concat()` is a sentinel that
  returns a fixed-byte block; consequently every reveal will fail the
  binding check until the ckb-std blake2b syscall wrapper is plumbed in. v1
  is fail-closed, not fail-open, which is the safe direction during
  scaffold.
- **Not tip-anchor-correct.** `read_tip_height_proxy()` returns `u64::MAX/2`
  so timing checks degrade to "always past deadline." Production reads
  `load_header(Source::HeaderDep)` on a PoWAnchorCell per
  REORG_BEHAVIOR_DESIGN §4.
- **Not the Pool authority.** The PoolCell's own type-script
  (`pool-type-script`, not yet scaffolded) enforces x·y=k + TWAP + breakers.
  This crate cell-deps the PoolCell and reads reserves for the
  MAX_TRADE_SIZE check only.
- **Not multi-pool.** v1 enforces single-pool-per-batch. Multi-pool batching
  is a future iteration per spec § Open Questions.
- **Not priority-bid-enabled.** PoW priority bids deferred to v2; spec §
  Open Questions flags the no_std PoW port as a separate work item.
- **Not cross-chain-recipient-enabled.** xchain_recipient deferred to v2,
  coupled to MessagingHub composition.

## Role tag (type_script.args[0])

| tag  | role                  |
|------|-----------------------|
| 0x01 | CommitCell            |
| 0x02 | RevealCell            |
| 0x03 | BatchSettlementCell   |
| 0x04 | SlashCell             |

Tag followed by 32 bytes of own type-hash (sibling discrimination in
cell-dep scans). Total args = 33 bytes.

## Cell-data layouts

See module-level docstring in `src/main.rs`. Summary:

- CommitCell: 129 bytes (version, batch_id, pool_id, commit_hash,
  deposit_amount, collateral_amount, recipient, deadline)
- RevealCell: 253 bytes (+ commit_outpoint, order_data, secret)
- BatchSettlementCell: 109-byte header + variable matched_orders Vec
- SlashCell: 69 bytes (commit_outpoint + 3-way split)

## Invariants enforced

### CommitCell (creation)
1. Layout valid; version supported; commit_hash non-zero.
2. `deposit_amount >= MIN_COMMIT_BOND` (Lawson).
3. Timing: commit during commit window (v1: deadline non-zero only;
   tip-anchor TODO).

### RevealCell (creation)
4. Layout valid.
5. Referenced CommitCell present as tx input.
6. **Binding**: `blake2b(order_data_canonical_bytes || secret) ==
   commit.commit_hash`. (v1 sentinel; fail-closed.)
7. Deposit + collateral pass through unchanged.
8. Pool ID matches.
9. `amount_in <= reserve_in * MAX_TRADE_SIZE_BPS / 10000` (PoolCell
   cell-dep).
10. Timing: reveal during reveal window (v1 TODO: tip-anchor).

### BatchSettlementCell (creation)
11. Layout valid; matched_count fits in MAX_REVEALS_PER_BATCH.
12. All RevealCells with matching batch_id + pool_id collected from tx
    inputs; count matches `reveal_count`.
13. **Shuffle seed = XOR of all reveal secrets in canonical ordering**
    (ascending by commit_outpoint_tx || idx).
14. **Fisher-Yates ordering**: re-running the Fisher-Yates permutation
    over the canonically-ordered reveal index list, seeded by the computed
    seed, produces the matched_orders[] reveal_outpoint sequence.
15. Clearing price non-zero; per-order amount_out = amount_in *
    clearing_price / 1e18 AND amount_out >= min_amount_out.
16. Single pool per batch (all reveals share pool_id).

### SlashCell (creation)
17. Layout valid.
18. Referenced CommitCell present as tx input.
19. Timing: `tip > commit.deadline` (v1 proxy).
20. No RevealCell for this commit_outpoint in the same tx (mutual
    exclusion of reveal vs slash consumers).
21. `treasury == (deposit + collateral) * SLASH_RATE_BPS / 10000`.
22. `bounty <= SWEEPER_BOUNTY` (Lawson cap).
23. `treasury + committer + bounty == deposit + collateral`.

## Composition

- **Lawson constants** (cell-dep, mandatory): MIN_COMMIT_BOND,
  BATCH_PERIOD_BLOCKS, COMMIT_DURATION_BLOCKS, REVEAL_DURATION_BLOCKS,
  SLASH_RATE_BPS, MAX_TRADE_SIZE_BPS, SWEEPER_BOUNTY.
- **VibeAMM PoolCell** (cell-dep, mandatory for Reveal + BatchSettlement):
  reserve readout for MAX_TRADE_SIZE + clearing-price reference.
  BatchSettlement also composes same-tx with the PoolCell input + output
  (PoolCell.batch_settle path updates reserves and TWAP from the batch).
- **PoWAnchorCell** (cell-dep, TODO): authoritative tip-height for
  window/finality checks.
- **vibeswap-canonical-token** (same-tx I/O, indirect): the per-order
  trade-output cells routing tokens to recipients run their own
  conservation checks; the BatchSettlementCell coordinates but does not
  duplicate.

## The structurally hardest invariant

**Invariant 13: shuffle seed = XOR of secrets in canonical ordering.**

Canonical ordering by commit_outpoint is load-bearing. If the order is
adversary-influenced, an attacker who reveals last can choose their secret
to bias the XOR — recovering the partial MEV the mechanism is meant to
dissolve. Sorting by `(commit_outpoint_tx, commit_outpoint_idx)` makes the
order a function of facts fixed before any reveal exists.

This is what [P·structure-does-the-work] looks like at the byte level: the
canonical order isn't a convention enforced by code review, it's an
invariant verified by the type-script on every settlement. An "incorrect"
settlement that uses a non-canonical order fails the seed-XOR check —
detection-free dissolution of the reordering attack class
([P·class-dissolution-vs-case-defeat]).

## Status

**Spec scaffold, not audit-ready, not yet machine-verified.** Capsule not
wired on this dev box (same toolchain blockers as sibling crates — see
`contracts-ckb/tests/README.md`). Honest gaps:

- Blake2b is a sentinel ⇒ every reveal fails binding until plumbed.
- Tip-anchor is a proxy ⇒ timing checks pass trivially.
- Cell-dep discrimination is shape-based, not code-hash-based.
- PoW priority bids deferred.
- xchain_recipient deferred.

The invariant arithmetic and the Fisher-Yates re-derivation are honestly
implemented; the structural property (canonical-ordered XOR seed, hash-
binding refusal) is enforced. The composition bindings (this cell-dep IS
the Lawson registry) are shape-only.

## Error codes

See `src/error.rs`:

- 1-4: ckb-std passthrough
- 30-35: cell-shape invariants
- 40-41: missing cell-deps (Lawson, Pool)
- 50-53: CommitCell
- 60-65: RevealCell
- 70-76: BatchSettlementCell
- 80-83: SlashCell
- 100: capacity

## Build

```bash
cargo build --release \
  --target riscv64imac-unknown-none-elf \
  -p commit-reveal-auction-cell-type-script
```

## Tests

`tests/test_basic.rs` is a reviewable test-spec stub (gated by `#[cfg(any())]`)
following the workspace pattern. Runnable integration tests land in
`contracts-ckb/tests/src/commit_reveal_auction_cell_type_tests.rs` once
Capsule is wired.

## Cross-references

- Spec: `contracts-ckb/specs/commit-reveal-auction.md`
- AMM composition: `contracts-ckb/specs/vibe-amm.md` § "Batch settle"
- Reorg: `contracts-ckb/REORG_BEHAVIOR_DESIGN.md`
- Operations: `contracts-ckb/OPERATIONS.md`
- Siblings (composed with):
  - `lawson-constants-cell-type-script/` (threshold + cooldown + bond reads)
  - `vibe-amm-cell-type-script/` (AMM PoolCell — reserve readout + batch
    settle counterparty)
  - `vibeswap-canonical-token-type-script/` (per-order output conservation)
- Mechanism primitives: `[P·dissolve-attack-surface]`,
  `[P·structure-does-the-work]`, `[P·class-dissolution-vs-case-defeat]`,
  `[P·honesty-as-structural-load-bearing-property]`
