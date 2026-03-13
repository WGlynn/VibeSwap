# Testing as Proof of Correctness: The Unit-Fuzz-Invariant Triad for Smart Contracts

*Nervos Talks Post — W. Glynn (Faraday1)*
*March 2026*

---

## TL;DR

Smart contract bugs have caused billions in losses. The DAO ($60M), Wormhole ($320M), Euler ($197M) — all from insufficient testing. Most protocols rely on unit tests alone, which only verify what the developer *thought of*. We present the **Unit-Fuzz-Invariant Triad**: three complementary methodologies that together provide near-complete assurance. Unit tests verify intended behavior. Fuzz tests discover *unintended* behavior with random inputs. Invariant tests verify properties that must *always* hold. Applied to VibeSwap's 60-contract codebase: 3,000+ tests, zero failures, bugs caught that any single methodology would have missed. CKB's type script model adds a fourth layer: the type script itself is a permanent, on-chain invariant enforcer that makes entire categories of bugs unexpressible.

---

## Why Unit Tests Are Necessary But Not Sufficient

Unit tests verify the developer's mental model:

```solidity
function test_addLiquidity_mintsCorrectLPTokens() public {
    uint256 lpBefore = lp.balanceOf(alice);
    vm.prank(alice);
    amm.addLiquidity(poolId, 100 ether, 100 ether);
    assertGt(lp.balanceOf(alice), lpBefore);
}
```

**The problem**: if the mental model is wrong, the test passes and the bug ships. A developer who doesn't think about overflow writes a passing unit test for a function that overflows on large inputs. The test confirms the wrong model.

Our unit test template per contract:
1. Constructor / setup tests (2-3)
2. Create / write with happy path + reverts (4-6)
3. State transitions — activate, purchase, settle (6-8)
4. Claim / reclaim with timing checks (4-5)
5. View function tests (2-3)
6. Full lifecycle integration (2-3)

~25-35 tests per contract. Reliable, reproducible, and **completely insufficient** for security.

---

## Fuzz Testing: What You Didn't Think Of

Fuzz tests feed random inputs to functions and check that invariants hold:

```solidity
function testFuzz_bondToMint_preservesInvariant(uint256 deposit) public {
    deposit = bound(deposit, MIN_DEPOSIT, MAX_DEPOSIT);
    uint256 v0Before = curve.getInvariant();

    curve.bondToMint(deposit);

    uint256 v0After = curve.getInvariant();
    assertApproxEqRel(v0Before, v0After, 1e14); // 0.01% tolerance
}
```

With Foundry running 10,000+ random inputs per fuzz test, this catches:
- **Overflow/underflow** at extreme values
- **Rounding errors** that compound over operations
- **Edge cases** the developer never considered
- **Ordering dependencies** (different sequences produce different results)

Real example: fuzz testing discovered that our bonding curve's Newton's method diverged for supplies near zero — a case our unit tests never hit because we always started with reasonable initial supply. The fix: supply hints that seed Newton with the previous supply, reducing iterations from 80 to 3-5.

---

## Invariant Testing: What Must Always Be True

Invariant tests define properties and let the fuzzer try to break them through arbitrary sequences of operations:

```solidity
function invariant_totalSupplyMatchesMintedMinusBurned() public {
    assertEq(
        token.totalSupply(),
        handler.totalMinted() - handler.totalBurned()
    );
}

function invariant_reserveNeverNegative() public {
    assertGe(curve.reserve(), 0);
}

function invariant_conservationInvariantHolds() public {
    assertApproxEqRel(
        curve.getInvariant(),
        INITIAL_INVARIANT,
        TOLERANCE
    );
}
```

The fuzzer generates random sequences of bond, burn, allocate, and deposit operations — thousands of them — and after each sequence checks that every invariant still holds. This catches **state-dependent bugs** that only manifest after specific operation sequences.

Real example: invariant testing revealed that our IL Protection contract could reach a state where `claimable > pool_balance` if claims happened in a specific order — a bug invisible to individual operation tests.

---

## The Triad in Numbers

| Metric | VibeSwap Results |
|---|---|
| Contracts tested | 60 |
| Unit tests | ~1,500 |
| Fuzz tests | ~1,000 |
| Invariant tests | ~500 |
| Total tests | 3,000+ |
| Test files | 181 |
| Fuzz runs | 10,000+ per test |
| Invariant operations | 1,000,000+ |
| Failures at last count | 0 |

---

## CKB's Fourth Layer: Type Scripts as On-Chain Invariants

This is where CKB adds something fundamentally new to the testing conversation.

### The Ethereum Model: Test, Then Hope

On Ethereum:
1. Write contract with `require()` checks
2. Test that `require()` catches bad inputs
3. Deploy to mainnet
4. Hope you didn't miss a code path

If there's a code path that bypasses a `require()`, the invariant breaks. Your tests can't catch what you didn't test. The gap between "tested code paths" and "all possible code paths" is where exploits live.

### The CKB Model: Enforce, Then Verify

On CKB, type scripts define what valid state transitions look like. Everything else is impossible:

```
Input Cell:  { data: [state_A], type_script: validator }
Output Cell: { data: [state_B], type_script: validator }

validator checks: is (state_A → state_B) a valid transition?
If no → transaction rejected at the VM level
```

The type script IS the invariant. It's not a test you run offline — it's an on-chain enforcer that runs on every transaction. There is no code path that bypasses it because the code path doesn't exist in the transaction model.

### Example: Conservation Invariant

On Ethereum, you test that `V₀` is preserved:
```solidity
function test_bondToMint_preservesV0() public { ... }
function testFuzz_bondToMint_preservesV0(uint256 x) public { ... }
function invariant_V0_preserved() public { ... }
```

Three layers of testing. Still not formal verification. Still possible to miss a code path.

On CKB, the type script **is** the `V₀` check:
```
bonding_curve_type_script:
  input.data.S^k / input.capacity == output.data.S^k / output.capacity
  || REJECT
```

No code path can modify the bonding curve cell without the type script validating conservation. The invariant is **structural**, not behavioral.

### The Testing Hierarchy on CKB

```
Layer 1: Unit tests        → Does each script function work?
Layer 2: Fuzz tests         → Do random inputs break scripts?
Layer 3: Invariant tests    → Do operation sequences break properties?
Layer 4: Type scripts       → Are invariants enforced on-chain? (CKB ONLY)
```

Layer 4 doesn't replace Layers 1-3 — you still need to verify the type script itself is correct. But once verified, the type script provides a guarantee that no amount of off-chain testing can match: **the invariant is enforced by the blockchain itself, on every transaction, forever.**

---

## The Self-Improvement Protocol

Testing isn't a one-time activity. We developed an iterative protocol that compounds testing competency:

1. **Every bug found by fuzz/invariant testing** → extract the pattern → add to methodology document
2. **Every new contract** → apply all known patterns from previous contracts
3. **Every session** → review fuzz failure logs for new edge case categories
4. **Cross-module learning** → a bug pattern in the AMM informs testing of the bonding curve

This creates a ratchet: testing quality only increases. The methodology document grows. New contracts start with all accumulated knowledge. Failure modes discovered in Module A are immediately tested for in Module B.

---

## Open Questions for Discussion

1. **Type script testing tooling for CKB**: What's the current state of fuzz testing for CKB type scripts? Can Foundry-like randomized testing be applied to RISC-V scripts?

2. **Formal verification on CKB-VM**: CKB's RISC-V base means existing formal verification toolchains apply. Has anyone formally verified a type script? What would the workflow look like?

3. **Cross-cell invariant testing**: When multiple cells compose (bonding curve + funding pool + governance), how do you test invariants that span cell boundaries?

4. **The coverage gap**: Even with the triad, there's a gap between "tested paths" and "all paths." Does CKB's type script model genuinely close this gap, or just push it to a different level?

5. **Community testing standards**: Should the CKB ecosystem establish minimum testing requirements (unit + fuzz + invariant) for contracts deployed to mainnet? What would enforcement look like?

---

## Further Reading

- **Full paper**: [testing-as-proof-of-correctness.md](https://github.com/wglynn/vibeswap/blob/master/docs/papers/testing-as-proof-of-correctness.md)
- **Related**: [Augmented Mechanism Design](https://github.com/wglynn/vibeswap/blob/master/docs/papers/augmented-mechanism-design.md)
- **Code**: [github.com/wglynn/vibeswap](https://github.com/wglynn/vibeswap) (3,000+ tests, 181 test files)

---

*"Fairness Above All."*
*— P-000, VibeSwap Protocol*
