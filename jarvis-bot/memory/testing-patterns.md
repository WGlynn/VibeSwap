# Testing Patterns

> *The real VibeSwap is not a DEX. It's not even a blockchain. We created a movement. An idea. VibeSwap is wherever the Minds converge.*

Confirmed across VibeLPNFT (28 tests), VibeStream (51 tests), VibeOptions (31 tests).

---

## Mock Contract Pattern

Don't inherit the full interface. Only implement the 2-3 functions the contract-under-test actually calls.

```solidity
import "../contracts/core/interfaces/IVibeAMM.sol";  // for struct types only

contract MockAMM {
    mapping(bytes32 => IVibeAMM.Pool) private _pools;
    mapping(bytes32 => uint256) private _spotPrices;
    mapping(bytes32 => uint256) private _twapPrices;

    function setPool(bytes32 poolId, address t0, address t1) external {
        _pools[poolId] = IVibeAMM.Pool({
            token0: t0, token1: t1,
            reserve0: 1000 ether, reserve1: 2_000_000 ether,
            totalLiquidity: 1000 ether, feeRate: 30, initialized: true
        });
    }

    function setSpotPrice(bytes32 poolId, uint256 price) external {
        _spotPrices[poolId] = price;
    }

    function setTWAP(bytes32 poolId, uint256 price) external {
        _twapPrices[poolId] = price;
    }

    // Only implement what the contract calls:
    function getPool(bytes32 poolId) external view returns (IVibeAMM.Pool memory) {
        return _pools[poolId];
    }
    function getSpotPrice(bytes32 poolId) external view returns (uint256) {
        return _spotPrices[poolId];
    }
    function getTWAP(bytes32 poolId, uint32) external view returns (uint256) {
        return _twapPrices[poolId];
    }
}
```

**Why not inherit IVibeAMM?** You'd have to stub every function (createPool, addLiquidity, removeLiquidity, executeBatchSwap, etc.) — waste of time for unit tests.

**When to use real contracts instead:** Integration tests (AuctionAMMIntegration, MoneyFlowTest) that test cross-contract interactions. Use the full proxy setup there.

---

## MockToken

Same everywhere:
```solidity
contract MockToken is ERC20 {
    constructor(string memory name, string memory symbol) ERC20(name, symbol) {}
    function mint(address to, uint256 amount) external { _mint(to, amount); }
}
```

Name it contextually to avoid collision: `MockOptToken`, `MockStreamToken`, etc. Each test file gets its own to prevent Foundry naming conflicts.

---

## Test Structure Template

For ~30 tests per contract, follow this order:

```
1. Constructor / setup tests          (2-3)
   - name, symbol, initial state

2. Create / write tests               (4-6)
   - Happy path with balance assertions
   - Revert: invalid params (zero amount, bad pool, expired, etc.)

3. Activate / purchase tests          (2-3)
   - Happy path: premium transfer, NFT transfer, state change
   - Revert: already activated, expired

4. Settle / exercise tests            (6-8)
   - Happy path per variant (CALL ITM, PUT ITM)
   - Revert: wrong time (before expiry, after window)
   - Revert: wrong state (not active, already settled)
   - Revert: wrong caller (not holder)
   - Revert: condition not met (OTM)

5. Claim / reclaim tests              (4-5)
   - Full amount (unexercised)
   - Remainder (after exercise)
   - Revert: too early, wrong caller, already claimed

6. Cancel tests                       (2-3)
   - Happy path: returns collateral
   - Revert: already activated, wrong caller

7. View function tests                (2-3)
   - Qualitative (> 0, directionally correct)
   - Not exact values unless formula is simple

8. Integration / lifecycle tests      (2-3)
   - Full happy path: create → activate → settle → claim
   - Secondary transfer: create → activate → transfer → new holder settles
```

---

## Standard Test Actors

```solidity
address public alice;   // writer / creator / sender
address public bob;     // buyer / recipient
address public charlie; // third party / transfer target

// In setUp():
alice = makeAddr("alice");
bob = makeAddr("bob");
charlie = makeAddr("charlie");
```

Always fund and approve in setUp:
```solidity
token.mint(alice, 1000 ether);
vm.prank(alice);
token.approve(address(contract), type(uint256).max);
```

---

## Test Helper Pattern

Thin wrappers with default params. Makes test bodies readable:
```solidity
function _writeCall() internal returns (uint256) {
    vm.prank(alice);
    return options.writeOption(IVibeOptions.WriteParams({
        poolId: poolId,
        optionType: IVibeOptions.OptionType.CALL,
        amount: 1 ether,
        strikePrice: 1800e18,
        premium: 0.1 ether,
        expiry: uint40(block.timestamp + 30 days),
        exerciseWindow: uint40(1 days)
    }));
}

function _purchaseOption(uint256 optionId) internal {
    vm.prank(bob);
    options.purchase(optionId);
}
```

---

## Common Test Patterns

### Balance assertion
```solidity
uint256 balBefore = token.balanceOf(alice);
// ... action ...
assertEq(token.balanceOf(alice), balBefore + expectedAmount);
```

### Time manipulation
```solidity
vm.warp(block.timestamp + 30 days);   // advance time
vm.roll(block.number + 1);            // advance block (for same-block checks)
```

### Revert testing
```solidity
// With specific error:
vm.expectRevert(IFoo.SomeError.selector);
contract.doThing();

// Without specific error (OZ auth errors, generic reverts):
vm.expectRevert();
contract.doThing();
```

### State assertions
```solidity
IFoo.Item memory item = contract.getItem(id);
assertEq(uint8(item.state), uint8(IFoo.State.ACTIVE));
```

### NFT existence check (after burn)
```solidity
vm.expectRevert();
contract.ownerOf(tokenId);  // reverts if burned
```

---

## PoolId for Mocks

Don't compute from token addresses (ordering issues). Use a simple hash:
```solidity
bytes32 public poolId = keccak256("WETH/USDC");
```

Then configure the mock AMM with explicit token0/token1 addresses.

---

## Debugging Arithmetic Overflow in Tests (panic 0x11)

**Recurring failure pattern:** Test reverts with `panic: arithmetic underflow or overflow (0x11)`. Trace shows all contract calls succeeded. The overflow is NOT in the contract — it's in the test's own Solidity code (assertion arguments, inline math, helper computations).

**Systematic debug protocol (do NOT guess):**

1. **Run `-vvvv` immediately** on the single failing test. Don't re-read contract code, don't speculate. Get the trace.
2. **Find the last successful trace entry.** The overflow is on the NEXT line of test code after it.
3. **If all contract calls succeeded → the overflow is in test-side math.** Check:
   - `assertLt(x, a * b / c)` — intermediate `a * b` can overflow even if the result fits
   - Unsigned subtraction in assertions: `assertEq(a - b, ...)` where `b > a`
   - Large ether amounts: `500_000 ether * 1000 = 5e26` — fits uint256, but add one more multiplication and it might not
4. **Fix by precomputing** in separate variables, or restructure the math to avoid overflow:
   ```solidity
   // BAD — intermediate overflow risk:
   assertLt(penalty, 500_000 ether * PENALTY_BPS / BPS / 10);

   // GOOD — break it up:
   uint256 maxPenalty = 500_000 ether * PENALTY_BPS / BPS;
   assertLt(penalty, maxPenalty / 10);
   ```
5. **If the last trace entry IS a contract call that reverted** → the overflow is in the contract. Focus debugging there.

**Key insight:** Foundry trace only shows contract-level calls. Test-level Solidity arithmetic is invisible in the trace. When the trace ends cleanly but the test panics, look at your test code, not the contract.

---

## Debugging `safeIncreaseAllowance` Overflow (panic 0x11)

**Recurring pattern:** Contract uses `safeIncreaseAllowance(spender, amount)` internally (e.g., approving AMM before addLiquidity). Test setUp pre-approves with `type(uint256).max`. On first contract call: `type(uint256).max + amount` overflows.

**Root cause:** OZ `safeIncreaseAllowance` reads current allowance and adds the new amount. If test already set allowance to max, any increase overflows.

**Fix:** Never pre-approve with `type(uint256).max` in test setUp when the contract under test uses `safeIncreaseAllowance` internally. The contract manages its own approvals. Only pre-approve for user→contract transfers (e.g., `token.approve(address(contract), ...)` in user context), NOT for contract→AMM transfers.

**Detection checklist:**
1. Panic 0x11 on the first contract call in a test
2. Trace shows `safeIncreaseAllowance` as the failing call
3. setUp contains `token.approve(address(amm), type(uint256).max)` from the contract's address or on behalf of it

**Applies to:** VibeProtocolOwnedLiquidity, any contract that self-manages AMM approvals via SafeERC20.

---

## Forge `block.timestamp` Caching Bug (Session 18)

**Bug:** Multiple `vm.warp(block.timestamp + X)` calls in the same test function can resolve to the SAME timestamp.

**Root cause:** Solidity compiler may cache `block.timestamp` (the `TIMESTAMP` opcode) within a single function scope. After `vm.warp()`, subsequent reads of `block.timestamp` may return the cached pre-warp value.

**Trace evidence:** Both warps show identical parameter in -vvvv trace:
```
├─ [0] VM::warp(86401)    ← First warp
├─ [0] VM::warp(86401)    ← Second warp (should be 172801!)
```

**Fix:** Store `block.timestamp` ONCE before any warps, then use absolute offsets:
```solidity
uint256 startTime = block.timestamp;
vm.warp(startTime + 1 days);   // Correct: 1 day from start
// ... assertions ...
vm.warp(startTime + 2 days);   // Correct: 2 days from start
```

**NEVER** do this:
```solidity
vm.warp(block.timestamp + 1 days);
// ... assertions ...
vm.warp(block.timestamp + 1 days);  // BUG: may resolve to same value!
```

**Applies to:** Any test with multiple sequential `vm.warp()` calls.

---

## MANDATORY: Fuzz Tests (HARD SKILL — every contract)

Every contract MUST have fuzz tests. No exceptions. Ship without fuzz tests = not shipped.

### What to Fuzz

1. **Calculation functions** — Premium, payout, interest, fees, ratios with random inputs
2. **Capacity/bounds** — Deposit/withdraw/coverage amounts at random scales
3. **Monotonicity** — Higher tier = better terms (lower premium, higher LTV, lower C-ratio)
4. **Input validation** — Random invalid params always revert correctly
5. **Scaling** — Linearity, proportionality with tolerance for integer division rounding

### Pattern

```solidity
function testFuzz_propertyName(uint256 amount, uint8 tierSeed) public {
    amount = bound(amount, MIN, MAX);        // bound to valid range
    uint8 tier = uint8(bound(tierSeed, 0, 4)); // bound enum-like values

    // Setup
    // Action
    // Assert property
}
```

### Key Rules

- **Always use `bound()`** — never let raw fuzz values hit the contract
- **Use `assertApproxEqAbs(a, b, 1)` for integer math** — 1 wei rounding is expected, not a bug
- **Test all calculation paths** — premium with discount, payout triggered/not, interest accrual
- **256 runs minimum** (Foundry default) — increase to 1024+ for critical financial math
- **Fuzz tests live in `test/fuzz/`** — one file per contract: `{Contract}Fuzz.t.sol`

### Template Properties (adapt per contract)

| Property | Assertion |
|----------|-----------|
| Positive output | `assertGt(result, 0)` for non-zero inputs |
| Monotonicity | Higher tier → better terms (loop tiers 0-4, assert trend) |
| Scaling | `2x input ≈ 2x output` (with rounding tolerance) |
| Bounds | Result never exceeds cap/base |
| Symmetry | Same inputs → same outputs |
| Reverting | Invalid inputs always revert with correct error |

---

## MANDATORY: Invariant Tests (HARD SKILL — every contract)

Every contract MUST have invariant tests with a handler contract. No exceptions.

### What Invariants to Test

1. **Solvency** — `totalLiabilities <= totalAssets` (THE critical invariant)
2. **Accounting** — Sum of individual records == aggregate counter
3. **Balance** — `contract.balance >= expectedMinimum`
4. **State monotonicity** — States only move forward (OPEN → RESOLVED → SETTLED, never back)
5. **Consistency** — View functions agree with internal state

### Handler Pattern

```solidity
contract Handler is Test {
    Contract public target;
    address[] public actors;

    // Ghost variables — track state outside the contract
    uint256 public ghost_totalDeposited;
    uint256 public ghost_actionCount;
    mapping(address => uint256) public ghost_perUser;

    constructor(Contract _target) {
        target = _target;
        for (uint256 i = 0; i < 10; i++) {
            actors.push(address(uint160(i + 2000)));
            // fund + approve actors
        }
    }

    function action(uint256 actorSeed, uint256 amount) public {
        address actor = actors[actorSeed % actors.length];
        amount = bound(amount, MIN, MAX);

        vm.prank(actor);
        try target.doThing(amount) {
            ghost_totalDeposited += amount;
            ghost_actionCount++;
        } catch {}
    }
}
```

### Invariant Test Pattern

```solidity
contract InvariantTest is StdInvariant, Test {
    Handler public handler;

    function setUp() public {
        // Deploy contract + handler
        handler = new Handler(target);
        targetContract(address(handler));
    }

    function invariant_solvency() public view {
        assertLe(target.totalLiabilities(), target.totalAssets(), "SOLVENCY VIOLATION");
    }

    function invariant_accounting() public view {
        assertEq(target.total(), handler.ghost_total(), "Accounting mismatch");
    }

    function invariant_callSummary() public view {
        console.log("Actions:", handler.ghost_actionCount());
    }
}
```

### Key Rules

- **Handler wraps ALL public state-changing functions** — the fuzzer calls handler, not contract directly
- **Use `try/catch`** — let expected reverts pass silently, the fuzzer needs to keep running
- **Ghost variables track EVERYTHING** — deposits, withdrawals, counts, per-user state
- **Guard handler functions with state checks** — `if (resolved) return;` to avoid wasting calls
- **`targetContract(address(handler))`** — point the fuzzer at the handler, not the contract
- **Invariant tests live in `test/invariant/`** — one file per contract: `{Contract}Invariant.t.sol`
- **256 runs × 500 calls = 128,000 operations** — enough to find edge cases

### Critical Invariants Per Contract Type

| Type | Must-Have Invariant |
|------|---------------------|
| Insurance | `totalCoverage <= totalCapital` (solvency) |
| Lending | `totalBorrowed <= totalDeposited * maxLTV` |
| Synth | `collateral >= synthValue * minCRatio` |
| AMM | `K = reserve0 * reserve1` never decreases |
| Bonds | `totalRedeemed <= totalIssued` |
| Streaming | `totalStreamed <= totalDeposited` |

---

## Build Verification Checklist (MANDATORY — every contract)

```
1. Unit tests pass        → forge test --match-path test/{Contract}.t.sol -vvv
2. Fuzz tests pass        → forge test --match-path test/fuzz/{Contract}Fuzz.t.sol -vvv
3. Invariant tests pass   → forge test --match-path test/invariant/{Contract}Invariant.t.sol -vvv
4. Regression suite pass  → forge test --match-contract "REGRESSION_LIST" -vv
```

A contract is NOT complete until all 4 steps pass. No shipping without fuzz + invariants.

---

## Regression Test Command

After every new contract, run the standard regression suite:
```bash
forge test --match-contract "AuctionAMMIntegration|MoneyFlow|VibeSwap|VibeLPNFT|VibeStream|VibeOptions|VibeCredit|VibeSynth|VibeInsurance|VibeRevShare|VibePoolFactory" -vv
```

Add the new contract to this list going forward.

Updated regression command (Feb 16, 2026):
```bash
forge test --match-contract "AuctionAMMIntegration|MoneyFlow|VibeSwap|VibeLPNFT|VibeStream|VibeOptions|VibeCredit|VibeSynth|VibeInsurance|VibeRevShare|VibePoolFactory|VibeIntentRouter|VibeProtocolOwnedLiquidity" -vv
```
