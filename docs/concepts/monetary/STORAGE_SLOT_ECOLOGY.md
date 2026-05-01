# Storage Slot Ecology

**Status**: Pedagogical deep-dive on UUPS upgrade-discipline for long-arc contract durability.
**Audience**: Smart-contract engineers. First-encounter with UUPS is OK.
**Related**: [Post-Upgrade Init Gate](../memory/primitive_post-upgrade-initialization-gate.md), [Mechanism Composition Algebra](./MECHANISM_COMPOSITION_ALGEBRA.md), [The Long Now of Contribution](./THE_LONG_NOW_OF_CONTRIBUTION.md).

---

## The problem

Your smart contract is upgradeable. You deploy v1. Six months later, you upgrade to v2 with new features. Six months after that, v3. Two years in, v7.

Each upgrade adds new state variables. Over years, the contract has accumulated layers of state. The concern: do v1, v2, v3 ... v7 all coexist correctly? Can a user who interacts with v1's state after v7 is deployed get what they expect?

This is storage-slot ecology. It's not a one-time problem; it's a long-arc discipline.

## Storage in Solidity, the 30-second version

Solidity contracts have a layout: each state variable occupies a storage "slot" (a 32-byte chunk). When you declare variables in order, they're placed in order.

```solidity
contract MyContract {
    uint256 public a;    // slot 0
    uint256 public b;    // slot 1
    address public c;    // slot 2
}
```

Reading `a`: read slot 0. Reading `b`: read slot 1. Simple.

Now, if you upgrade the contract by adding a new variable:

```solidity
contract MyContract_v2 {
    uint256 public a;    // slot 0
    uint256 public b;    // slot 1
    address public c;    // slot 2
    uint256 public d;    // slot 3 -- NEW
}
```

New state `d` is at slot 3. Existing state `a`, `b`, `c` are unchanged at slots 0, 1, 2.

But wait: what if you make a mistake?

```solidity
contract MyContract_v2_MISTAKE {
    uint256 public b;    // slot 0 -- WAS a!
    uint256 public a;    // slot 1 -- WAS b!
    address public c;    // slot 2
    uint256 public d;    // slot 3
}
```

Now slot 0 (which holds `a`'s value) is labeled `b`. Slot 1 (which holds `b`'s value) is labeled `a`. Every read is wrong.

**Concrete consequence**: user A had 1000 tokens stored at `a = 1000` (slot 0 = 1000). Post-upgrade, reading `b` returns 1000 and reading `a` returns whatever was in slot 1 (maybe 0 or whatever `b` was).

This is storage-slot corruption. It's catastrophic for a production contract.

## The __gap pattern

To prevent this, Solidity's OpenZeppelin upgradeable contracts use the `__gap` pattern:

```solidity
contract MyContract {
    uint256 public a;    // slot 0
    uint256 public b;    // slot 1
    address public c;    // slot 2

    uint256[47] private __gap;  // slots 3-49 reserved

    // Total: 50 slots used or reserved
}
```

`__gap` reserves 47 slots for future use. When you upgrade:

```solidity
contract MyContract_v2 {
    uint256 public a;    // slot 0
    uint256 public b;    // slot 1
    address public c;    // slot 2
    uint256 public newFeature;  // slot 3 -- added
    uint256[46] private __gap;  // slots 4-49, shrunk from 47
}
```

You move `newFeature` into one of the reserved slots. `__gap` shrinks to compensate. No existing state moves.

Critical: the total reserved space (3 actual + 47 gap = 50) stays fixed. You're just eating into the reserve.

## The VibeSwap discipline

VibeSwap contracts follow this discipline with specific rules:

### Rule 1 — Every upgradeable contract has a `__gap`

No exceptions. Every UUPS contract.

### Rule 2 — `__gap` sizing

Start at 50 slots for most contracts. Large contracts may reserve 100+.

### Rule 3 — `__gap` shrinks only, never grows

If you need a new variable, shrink `__gap` by 1. Never increase `__gap` (that would introduce gap after variables, mis-aligning storage).

### Rule 4 — NatSpec comment per change

When shrinking `__gap`, add a comment explaining what's being added:

```solidity
// C22-D1: Added newFeature field for post-upgrade support
uint256 public newFeature;

// __gap shrunk 50 -> 49 on 2026-04-22 (C22 cycle)
uint256[49] private __gap;
```

This creates an audit trail. Future auditors can verify the sequence of gap-shrinks matches the expected upgrade history.

### Rule 5 — reinitializer(N) for new state initialization

When adding state that needs initialization (not just declaration), use OpenZeppelin's `reinitializer(N)` modifier on an initialization function:

```solidity
function initializeV2() external reinitializer(2) {
    newFeature = 42;
}
```

The `reinitializer(2)` modifier ensures this function runs exactly once, after the upgrade, and not at contract deployment. Version 2 of the init chain.

### Rule 6 — Upgrade + init packaged atomically

Call `upgradeToAndCall` instead of `upgradeTo` + separate `initializeV2`. This bundles the upgrade and the init into one transaction — avoids the window where the contract is v2-code but v1-state (inconsistent).

Concrete risk of not doing this: if `upgradeTo` succeeds but before `initializeV2` fires, a user interacts with the contract. They see v2 logic but v1 state (newFeature = 0, not 42). Their transaction might fail or produce unexpected results.

## The audit finding that made us take this seriously

VibeSwap's RSI Cycle 22 (2026-04-17) identified a systemic medium-severity issue: 125 contracts in the repo had storage-layout issues or missing `__gap`. The fix was a batch update: `_disableInitializers()` in constructors + `__gap` in every upgradeable contract.

This was painful but necessary. One round, 125 contracts. Since then, new contracts follow the discipline by default; existing contracts were brought into compliance.

The discipline is not philosophical; it's the result of an actual bug-class getting audited and fixed.

## The NCI-specific example

`NakamotoConsensusInfinity.sol` has gone through multiple upgrades. Its `__gap` history:

- V1: `uint256[50] __gap` (50 slots reserved).
- V2 (C22): added `cellsServed` mapping → `__gap` 49 slots.
- V3 (C24): added `validatorList` array → `__gap` 48 slots.
- V4 (C29): added `slashPool` state → `__gap` 47 slots.
- V5 (C30): added `cellRegistry` reference → `__gap` 46 slots.

Each shrink is documented. The contract can trace its storage history back to V1. Any auditor can verify current layout matches all prior versions.

## Upgrade failure modes we've seen

### Failure 1 — Forgotten `__gap`

New contract shipped without `__gap`. Future upgrades are blocked. Must redeploy (not just upgrade), which loses state continuity.

Mitigation: `__gap` is now a code-review gate for every new upgradeable contract.

### Failure 2 — `__gap` sized incorrectly

New contract with `__gap[50]` but with 30 existing variables. Total 80 slots. First upgrade hits slot 80, which is outside the reserved range. Solidity compiler accepts but runtime behavior is unpredictable.

Mitigation: we verify total slot count at compile time (tooling catches mismatches).

### Failure 3 — `reinitializer` missed

V2 added new state but no `reinitializer` in the V2 init chain. Post-upgrade, the new state stays at default (0 or empty).

Symptom: new feature "doesn't work" post-upgrade. Seemingly mysterious.

Mitigation: checklist-driven upgrade process. Every upgrade review includes "does this need a reinitializer?".

### Failure 4 — Storage-slot alignment with mappings

Mappings occupy slot N for their metadata but the actual key-value pairs are stored at `hash(slot_N, key)`. If you change a mapping to a different type, the stored values can't be read with the new type.

Concrete: mapping<address, uint256> has values stored at hash(slotN, addr). If you change to mapping<address, Struct>, the old uint256 values are stored at hash(slotN, addr) but treated as Struct. The first 32 bytes of each Struct's "value" are actually the old uint256 interpretation. Whatever.

Mitigation: don't change mapping types in-place. Deploy a new mapping and migrate data.

## The pre-upgrade gate

For each upgrade, we run a pre-upgrade gate:

1. **Compile both old and new versions**.
2. **Generate storage layouts for both** (`forge inspect ContractName storageLayout`).
3. **Diff the layouts**. Verify:
   - No slots changed type.
   - New slots are appended (not prepended).
   - `__gap` shrunk appropriately.
4. **Test upgrade in forked mainnet** (using `forge` with `--fork-url`).
5. **Run all existing test suites against the upgraded version**.
6. **Verify reinitializer is correctly applied** (if needed).
7. **Ship** only if all 6 checks pass.

This is the Ship-Time Verification Surface applied to upgrades.

## Long-arc implications

Over years, storage layouts get complex. A contract that's gone through 10 upgrades has a rich history of gap-shrinks. The discipline of documenting each shrink pays off cumulatively:

- **Year 1**: 2-3 upgrades; tracking is easy, low overhead.
- **Year 3**: 10+ upgrades; tracking is important.
- **Year 5**: 20+ upgrades; tracking is critical; forgetting the history = upgrade bug.
- **Year 10**: many upgrades; the documentation IS the history; without it, future engineers can't safely modify.

This is why VibeSwap bothers with NatSpec on every gap-shrink. Long-arc insurance.

## Relationship to Cincinnatus Test

[Disintermediation Grades](./DISINTERMEDIATION_GRADES.md) Cincinnatus Test: "If Will disappeared tomorrow, does this still work?"

Applied to upgrades: if the upgrade-documentation is only in Will's head, future engineers must re-derive it (at risk of mistakes) or avoid upgrades (stagnation).

Documented discipline makes upgrades transferable. Future team can upgrade confidently; Cincinnatus Test passes.

## For students

Exercise: pick an existing UUPS contract. Read its source. Find:
- The `__gap` declaration.
- The history of gap-shrinks.
- Any reinitializers.
- The upgrade authority (owner? governance?).

Then: propose a new feature that would require new state. Write the minimal diff (new variable declaration, gap shrink, reinitializer, NatSpec).

This exercise applied to VibeSwap's NakamotoConsensusInfinity or VibeAMM is a realistic upgrade proposal workflow.

## The cultural takeaway

Upgrade discipline is not optional. It's a commitment to future engineers that the code remains modifiable without fear. Contracts deployed without this discipline become effectively-frozen (you can't upgrade them safely), which means the protocol can't evolve.

VibeSwap's commitment: every upgradeable contract carries its history. Future engineers can safely modify. The protocol remains evolvable over decades.

## One-line summary

*Storage slot ecology = disciplined UUPS upgrades with __gap reservation, shrink-on-add, reinitializer chains, and NatSpec history — every upgrade is documented so future engineers can modify safely; discipline pays off cumulatively over years of contract evolution.*
