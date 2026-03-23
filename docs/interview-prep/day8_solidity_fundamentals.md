# Day 8: Solidity Fundamentals Review

> Study guide for Senior Smart Contract Engineer interviews.
> For each topic: concept, common question, your VibeSwap reference.

---

## 1. Gas Optimization Patterns

### 1.1 Storage vs Memory vs Calldata

**Concept:**
- `storage` reads/writes cost 2100 (cold) / 100 (warm) gas for SLOAD, 20000 (fresh) / 5000 (dirty) for SSTORE
- `memory` is cheap (~3 gas per word) but expands quadratically
- `calldata` is read-only, cheapest for external function inputs (no copy)

**Key Rules:**
- Cache storage reads in local variables when accessed multiple times
- Use `calldata` for external function array parameters you only read
- Use `memory` for structs you need to modify locally before a single SSTORE

**Common Interview Question:**
> "How would you optimize a function that reads the same storage slot 5 times?"

Cache it: `uint256 cached = myStorageVar;` then use `cached`. Saves 4 * 2100 = 8400 gas on cold reads.

**Your VibeSwap Reference:**
- `SecurityLib.sol` (`contracts/libraries/SecurityLib.sol`): `checkRateLimit()` takes a `RateLimit memory limit` parameter -- loads the rate limit struct from storage into memory once, performs all checks against the memory copy, then writes back only if state changed
- `TWAPOracle.sol` (`contracts/libraries/TWAPOracle.sol`): Uses a ring buffer `Observation[65535]` in storage but reads into memory structs for TWAP calculations, minimizing repeated SLOADs

---

### 1.2 Struct Packing

**Concept:**
- EVM storage slots are 32 bytes. Multiple variables smaller than 32 bytes can share a slot if declared adjacently
- Saves 20000 gas per avoided fresh SSTORE, 2100 per avoided cold SLOAD
- Order struct fields from largest to smallest, or group sub-32-byte fields together

**Packing Examples:**
```solidity
// BAD: 3 slots (96 bytes)
struct Bad {
    uint256 amount;    // slot 0 (32 bytes)
    bool active;       // slot 1 (1 byte, wastes 31)
    uint256 timestamp; // slot 2 (32 bytes)
}

// GOOD: 2 slots (64 bytes)
struct Good {
    uint256 amount;    // slot 0
    uint256 timestamp; // slot 1
    bool active;       // slot 1 (packed with timestamp? No -- bool after uint256 starts new slot)
}

// BEST: 2 slots
struct Best {
    uint256 amount;     // slot 0
    uint128 timestamp;  // slot 1 (16 bytes)
    bool active;        // slot 1 (packed, 1 byte)
}
```

**Common Interview Question:**
> "Look at this struct. How many storage slots does it use? How would you reduce it?"

Count bytes per field, group sub-32-byte fields adjacently. Remember: `address` = 20 bytes, `bool` = 1 byte, `uint8-uint128` = their byte sizes, `uint256/bytes32` = 32 bytes.

**Your VibeSwap Reference:**
- `TWAPOracle.Observation` packs `uint32 timestamp` + `uint224 priceCumulative` = 32 bytes exactly (one slot)
- `CircuitBreaker.BreakerConfig` packs `bool enabled` with threshold values
- `CommitRevealAuction.sol`: Protocol constants like `COMMIT_DURATION`, `REVEAL_DURATION`, `BATCH_DURATION` are `uint256 public constant` -- constants don't use storage slots at all (inlined at compile time)

---

### 1.3 Unchecked Blocks

**Concept:**
- Solidity 0.8+ adds automatic overflow/underflow checks (costs ~100-200 gas per arithmetic op)
- `unchecked { ... }` disables these checks where you can prove overflow is impossible
- Common safe uses: loop counter increments, differences you've already bounded

```solidity
// Loop optimization
for (uint256 i = 0; i < length;) {
    // ... work ...
    unchecked { ++i; } // i can't overflow if length < type(uint256).max
}

// Bounded subtraction
if (a > b) {
    unchecked { diff = a - b; } // Can't underflow because we checked a > b
}
```

**Common Interview Question:**
> "When is it safe to use unchecked? Give three examples."

1. Loop counter increment (bounded by array length)
2. Subtraction after a greater-than check
3. Timestamp differences (block.timestamp is uint256, won't wrap for billions of years)

**Your VibeSwap Reference:**
- `DeterministicShuffle.sol` (`contracts/libraries/DeterministicShuffle.sol`): Fisher-Yates shuffle loop iterates over array indices -- the counter `i` is bounded by `length` which is bounded by batch size
- `BatchMath.sol`: Arithmetic on token amounts where bounds are enforced by earlier checks (max trade size is 10% of reserves per `MAX_TRADE_SIZE_BPS = 1000`)

---

### 1.4 Custom Errors vs Require Strings

**Concept:**
- `require(condition, "String message")` stores the string in bytecode and costs more gas on revert (ABI-encodes the string)
- Custom errors (`error InsufficientDeposit()`) use 4-byte selectors only, saving deployment gas AND revert gas
- Custom errors can carry parameters: `error SlippageTooHigh(uint256 expected, uint256 actual)`

**Gas Savings:**
- Deployment: ~200 gas per character in string removed
- Runtime (on revert): ~50 gas saved per revert with custom error vs string

**Your VibeSwap Reference:**
- `CommitRevealAuction.sol`: Uses 20+ custom errors (`NotAuthorized()`, `InvalidPhase()`, `InsufficientDeposit()`, `FlashLoanDetected()`, `InvalidHash()`, etc.) -- zero string storage
- `CircuitBreaker.sol`: `GloballyPaused()`, `FunctionPaused(bytes4 selector)`, `BreakerTrippedError(bytes32 breakerType)` -- parameterized custom errors give the reverting context without string overhead
- Convention across the codebase: custom errors in a `// ============ Custom Errors (Gas Optimized) ============` section at the top of every contract

---

### 1.5 calldata vs memory for Function Parameters

**Concept:**
- External functions can use `calldata` for reference types (arrays, bytes, strings, structs)
- `calldata` avoids copying the data to memory; saves ~60 gas per word for arrays
- `memory` is required if you need to modify the parameter inside the function

**Rule of Thumb:**
- External function + read-only parameter = `calldata`
- External function + need to modify = `memory`
- Internal/private functions = `memory` (calldata not available from internal calls unless forwarded)

**Common Interview Question:**
> "Why can't you use calldata for parameters in internal functions?"

Internal functions can be called from other Solidity functions where the data lives in memory, not in the transaction calldata segment. The compiler can't guarantee the data is in calldata.

**Your VibeSwap Reference:**
- `CrossChainRouter.sol`: Message structs like `CrossChainCommit`, `CrossChainReveal` are used in external functions receiving LayerZero messages -- these would use calldata for the raw bytes, then decode into memory structs for processing

---

### 1.6 Additional Patterns Worth Mentioning

| Pattern | Gas Impact | VibeSwap Usage |
|---------|-----------|----------------|
| **Constants/Immutables** | Constants: 0 SLOAD (inlined). Immutables: set in constructor, read from bytecode (cheaper than storage) | `COMMIT_DURATION`, `REVEAL_DURATION`, `MIN_DEPOSIT`, `SLASH_RATE_BPS`, `LAWSON_CONSTANT` are all `constant` in CommitRevealAuction/VibeSwapCore |
| **Short-circuit evaluation** | `&&` and `\|\|` skip the second condition if first determines result | `SecurityLib.checkPriceDeviation()` returns early if `referencePrice == 0` |
| **Events over storage** | Events cost ~375 + 375/topic + 8/byte vs 20000 for fresh SSTORE | Used extensively for audit trails; `CircuitBreaker` emits `BreakerTripped`, `AnomalyDetected` rather than storing logs |
| **Mapping over array** | O(1) lookup vs O(n) iteration | `poolConfigs`, `deposits`, `pendingSwaps` are all mappings in VibeSwapCore |
| **Tight variable packing in function locals** | Stack variables are free (just stack ops) | `SwapParams` struct bundles 6 parameters to avoid stack-too-deep |

---

## 2. Proxy Patterns

### 2.1 Overview

All proxy patterns work via `delegatecall`: the proxy holds storage, the implementation holds logic. The proxy's fallback function `delegatecall`s every call to the implementation address.

**Critical Invariant:** Storage layout in the implementation MUST match the proxy's storage layout. New versions can only APPEND storage variables, never reorder or remove.

---

### 2.2 UUPS (Universal Upgradeable Proxy Standard) — EIP-1822

**How It Works:**
- Upgrade logic lives in the **implementation** contract (not the proxy)
- Implementation inherits `UUPSUpgradeable` which exposes `upgradeTo(newImpl)` and `upgradeToAndCall(newImpl, data)`
- The `_authorizeUpgrade()` function must be overridden with access control

**Pros:**
- Cheaper deployment: proxy is minimal (no admin logic)
- Cheaper runtime: no admin address check on every call
- Implementation can remove upgradeability entirely (by not including `upgradeTo` in a future version)

**Cons:**
- If you deploy an implementation without `UUPSUpgradeable`, the proxy is **permanently bricked** (no upgrade function exists)
- Developer must remember to include upgrade logic in every new implementation

**Storage Slot:**
- Implementation address stored at `keccak256("eip1967.proxy.implementation") - 1` = `0x360894a13ba1a3210667c828492db98dca3e2076cc3735a920a3ca505d382bbc`

**Common Interview Question:**
> "What happens if you deploy a UUPS proxy and the new implementation doesn't inherit UUPSUpgradeable?"

The proxy becomes permanently unupgradeable. The `upgradeTo` function was in the OLD implementation's code, which ran via delegatecall. The new implementation doesn't have it, so no one can call upgrade again. This is the primary risk of UUPS.

**Your VibeSwap Reference:**
- **VibeSwapCore** inherits `UUPSUpgradeable` from OpenZeppelin v5.0.1
- **ShapleyDistributor**, **ILProtectionVault**, **TreasuryStabilizer** all use UUPS pattern
- `_authorizeUpgrade()` is gated by `onlyOwner` currently (Grade C), with a documented roadmap to transfer ownership to a `TimelockController` (Grade B) then full DAO governance (Grade B+)
- `foundry.toml`: `optimizer = true`, `optimizer_runs = 200`, `via_ir = true` for production; `deploy` profile uses `optimizer_runs = 1` for smallest bytecode (relevant for proxy deployment costs)

---

### 2.3 Transparent Proxy — EIP-1967

**How It Works:**
- Upgrade logic lives in the **proxy** itself (not the implementation)
- Proxy checks `msg.sender == admin` on every call:
  - If admin: route to proxy's own upgrade/admin functions
  - If anyone else: delegatecall to implementation

**Pros:**
- Can't brick the proxy (upgrade logic never changes)
- Simpler mental model: proxy manages its own state

**Cons:**
- ~2100 gas overhead on EVERY call (SLOAD to check admin address)
- More expensive to deploy (proxy is fatter)
- Admin can never interact with the implementation directly (function selector clashes)

**Function Selector Clash:**
If admin calls a function that exists on both the proxy and implementation, the proxy's version wins. This is why the admin address is barred from calling implementation functions.

---

### 2.4 Beacon Proxy — EIP-1967 Extension

**How It Works:**
- Multiple proxies point to a single **Beacon** contract
- Beacon stores the implementation address
- Upgrading the Beacon upgrades ALL proxies simultaneously

**Pros:**
- Upgrade N proxies with 1 transaction
- Great for factory patterns (many instances of same logic)

**Cons:**
- Extra SLOAD per call (proxy reads beacon, beacon reads implementation)
- Single point of failure: compromised beacon = all proxies compromised

**Common Interview Question:**
> "When would you choose Beacon over UUPS?"

When you have many proxy instances (e.g., one per user vault, one per pool) that should all run the same logic. Factory pattern. Uniswap V3 pools are a good mental model, though they use minimal proxies.

**Your VibeSwap Reference:**
- Not used in current architecture, but relevant for `VibePoolFactory.sol` (`contracts/amm/VibePoolFactory.sol`) if pools were deployed as individual proxies rather than mapped within a single VibeAMM contract

---

### 2.5 Diamond Proxy — EIP-2535

**How It Works:**
- Single proxy delegates to MULTIPLE implementation contracts (called "facets")
- A `diamondCut()` function adds/replaces/removes facets
- Function selectors are mapped to facet addresses in the proxy's storage

**Pros:**
- Bypasses the 24KB contract size limit by splitting logic across facets
- Granular upgradeability: upgrade one facet without touching others
- Can share storage across facets

**Cons:**
- Complexity: storage management across facets is error-prone
- Diamond storage pattern or AppStorage pattern required
- Harder to audit and verify on Etherscan
- Gas overhead from selector routing

**Common Interview Question:**
> "How does Diamond avoid the 24KB size limit?"

Each facet is a separate contract under 24KB. The diamond proxy routes function calls to the correct facet by selector lookup. Total logic can exceed 24KB because it's spread across multiple deployment units.

**Your VibeSwap Reference:**
- Not used. VibeSwap chose UUPS + modular architecture (separate contracts for AMM, Auction, Router, etc. that call each other) over Diamond. The tradeoff: more inter-contract calls but simpler upgradeability and auditability per contract.

---

### 2.6 Proxy Comparison Table

| | UUPS | Transparent | Beacon | Diamond |
|---|---|---|---|---|
| **Upgrade logic location** | Implementation | Proxy | Beacon | Proxy (diamondCut) |
| **Gas per call** | Lowest | +2100 (admin check) | +4200 (2 SLOADs) | +gas (selector routing) |
| **Deploy cost** | Low (thin proxy) | Medium | Low per proxy | High (facet registry) |
| **Brick risk** | Yes (missing UUPS in impl) | No | No | Low |
| **Multi-instance upgrade** | 1 tx per proxy | 1 tx per proxy | 1 tx for all | 1 tx per facet |
| **Max size** | 24KB | 24KB | 24KB | Unlimited (multi-facet) |
| **VibeSwap uses** | Yes (all core) | No | No | No |

---

## 3. EVM Internals

### 3.1 Stack Machine Architecture

**Concept:**
- EVM is a stack-based virtual machine (not register-based)
- Stack max depth: 1024 items, each item is 256 bits (32 bytes)
- Most opcodes pop inputs from and push outputs to the stack
- "Stack too deep" error: Solidity can only access the top 16 stack items (DUP1-DUP16, SWAP1-SWAP16)

**Common Interview Question:**
> "Why does Solidity have a 'stack too deep' error?"

EVM only has DUP and SWAP opcodes for the top 16 stack positions. If a function has more than ~16 local variables/parameters, the compiler can't reach variables buried deeper. Solutions: use structs to bundle parameters, split into internal functions, use `via_ir` compilation pipeline.

**Your VibeSwap Reference:**
- `foundry.toml`: `via_ir = true` in default profile -- the IR pipeline can handle deeper stacks by spilling to memory
- `VibeAMM.SwapParams` and `VibeAMM.PoWSwapParams` structs explicitly bundle parameters to avoid stack-too-deep ("Parameters for basic swap to reduce stack depth" per the comment)

---

### 3.2 Key Opcodes to Know

| Opcode | Gas | What It Does |
|--------|-----|-------------|
| `SLOAD` | 2100 (cold) / 100 (warm) | Read storage slot |
| `SSTORE` | 20000 (fresh) / 5000 (dirty) / refund on zero | Write storage slot |
| `MLOAD` / `MSTORE` | 3 | Read/write memory |
| `CALLDATALOAD` | 3 | Read calldata |
| `DELEGATECALL` | 2600 (cold) | Call with caller's storage context |
| `CALL` | 2600 (cold) + value transfer costs | External call |
| `STATICCALL` | 2600 (cold) | Read-only external call (view functions) |
| `CREATE` | 32000 | Deploy contract |
| `CREATE2` | 32000 | Deploy at deterministic address |
| `SELFDESTRUCT` | 5000 | Deprecated in Dencun, do not use |
| `KECCAK256` | 30 + 6/word | Hash computation |
| `RETURNDATASIZE` | 2 | Size of last return data |

**EIP-2929 (Berlin):**
- First access to an address/slot in a transaction = "cold" (expensive)
- Subsequent accesses = "warm" (cheap)
- This is why caching storage reads matters

---

### 3.3 Storage Slot Layout

**Rules:**
- Slot 0, 1, 2... assigned sequentially to state variables in declaration order
- Variables < 32 bytes pack into the same slot if they fit (right-aligned)
- Mappings: `keccak256(key . slot)` where `.` is concatenation
- Dynamic arrays: length at `slot`, elements at `keccak256(slot) + index`
- Nested mappings: `keccak256(key2 . keccak256(key1 . slot))`

**Proxy Storage Safety:**
- Never reorder or remove state variables in upgradeable contracts
- Only append new variables at the end
- Use storage gaps: `uint256[50] private __gap;` to reserve slots for future variables

**Common Interview Question:**
> "Where is `mapping(address => uint256) balances` stored if it's the 3rd state variable?"

The mapping itself occupies slot 2 (but stores nothing there). The value for key `addr` is at `keccak256(abi.encode(addr, 2))`.

**Your VibeSwap Reference:**
- `VibeSwapCore.sol` manages upgrade safety through UUPS with OpenZeppelin's storage layout conventions
- Nested mappings like `mapping(address => mapping(address => uint256)) public deposits` in VibeSwapCore: slot for `deposits[user][token]` = `keccak256(token . keccak256(user . slot_of_deposits))`

---

### 3.4 ABI Encoding

**Types:**
- **Static types** (uint256, address, bool, bytes32): encoded in-place as 32-byte words
- **Dynamic types** (bytes, string, arrays): encoded as offset + length + data

**`abi.encode` vs `abi.encodePacked`:**
- `abi.encode`: pads everything to 32 bytes, includes offsets for dynamic types. Unambiguous. Use for cross-contract calls and hashing when collision resistance matters.
- `abi.encodePacked`: no padding, concatenates raw bytes. Shorter output but risk of hash collisions with adjacent dynamic types.

**Common Interview Question:**
> "Why is `abi.encodePacked` dangerous for hashing?"

Two different inputs can produce the same packed encoding: `abi.encodePacked("ab", "c") == abi.encodePacked("a", "bc")`. This enables hash collision attacks. Use `abi.encode` or add length separators.

**Your VibeSwap Reference:**
- `DeterministicShuffle.generateSeedSecure()`: Uses `abi.encodePacked(seed, blockEntropy, batchId, secrets.length)` -- safe here because the types are fixed-size (`bytes32`, `bytes32`, `uint64`, `uint256`) so no collision risk
- `CommitRevealAuction.sol`: Commit hashes use `keccak256(abi.encode(order, secret))` for the commit scheme -- `abi.encode` (not packed) ensures unambiguous decoding during reveal

---

### 3.5 Function Selectors

**Concept:**
- First 4 bytes of `keccak256("functionName(type1,type2)")` = the selector
- EVM uses this to route calls to the correct function
- `msg.sig` in Solidity returns the 4-byte selector of the current call

**Selector Collision:**
- Two functions with different names can have the same 4-byte selector (birthday problem, ~2^16 functions to get 50% collision chance)
- In practice, Solidity compiler checks for collisions within a single contract
- Proxy-level collisions between proxy admin functions and implementation functions are a real risk (Transparent proxy exists specifically to mitigate this)

**Common Interview Question:**
> "How would you find the function selector for `transfer(address,uint256)`?"

`bytes4(keccak256("transfer(address,uint256)"))` = `0xa9059cbb`. In Foundry: `cast sig "transfer(address,uint256)"`.

**Your VibeSwap Reference:**
- `CircuitBreaker.sol`: Uses `msg.sig` (which is `bytes4`) for per-function pause states: `mapping(bytes4 => bool) public functionPaused` -- each function can be individually paused by its selector
- Custom error selectors work the same way: `error FlashLoanDetected()` has a 4-byte selector that clients decode from revert data

---

## 4. Quick-Fire Review Checklist

Before the interview, run through these mentally:

- [ ] Can I explain storage layout for a contract with 3 uint256s, 2 addresses, and a mapping?
- [ ] Can I calculate the storage slot for a nested mapping value?
- [ ] Can I explain why UUPS proxy can be bricked and how to prevent it?
- [ ] Can I describe the gas difference between storage/memory/calldata with numbers?
- [ ] Can I draw the EVM stack for a simple ADD operation?
- [ ] Can I explain the ABI encoding of `foo(uint256, string, uint256[])`?
- [ ] Can I explain why VibeSwap chose UUPS over Transparent proxy?
- [ ] Can I describe three gas optimizations in VibeSwap's contracts with specific examples?

---

## 5. VibeSwap Architecture Talking Points

When asked "tell me about your project," hit these in 60 seconds:

1. **What**: Omnichain DEX, 360+ Solidity contracts, 370+ test files, Foundry + OZ v5.0.1
2. **Problem**: MEV extraction -- sandwich attacks, frontrunning steal value from traders
3. **Solution**: Commit-reveal batch auctions (8s commit, 2s reveal, uniform clearing price)
4. **Why it works**: No "before" and "after" price in a batch -- sandwich attack vector doesn't exist
5. **Architecture**: UUPS proxies, LayerZero V2 cross-chain, Shapley value reward distribution, circuit breakers, rate limiting, TWAP validation
6. **Security mindset**: Defense in depth -- flash loan guards, 50% slashing for invalid reveals, donation attack detection, per-function circuit breakers
7. **Tested**: Foundry unit + fuzz (256 runs) + invariant (256 runs, depth 500) + integration + security tests

**Foundry Config to Reference:**
- Optimizer: 200 runs (default), 1 run (deploy profile for smallest bytecode)
- `via_ir = true` for production, `false` for fast iteration (2-5x faster compile)
- Fuzz: 256 runs, 65536 max rejects
- Invariant: 256 runs, depth 500
- Multi-chain RPC endpoints: Mainnet, Sepolia, Arbitrum, Optimism, Base
