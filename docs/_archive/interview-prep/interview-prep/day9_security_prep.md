# Day 9: Smart Contract Security Interview Prep

> For each vulnerability: what it is, example exploit, mitigation, and where you implemented the mitigation in VibeSwap.

---

## Top 10 Smart Contract Vulnerabilities

---

### 1. Reentrancy

**What It Is:**
An external call hands control to an untrusted contract, which calls back into the calling contract before state updates are finalized. The attacker re-enters the function with stale state (e.g., balance not yet decremented) and drains funds.

**Classic Example (The DAO, 2016):**
```solidity
// VULNERABLE
function withdraw() external {
    uint256 bal = balances[msg.sender];
    (bool ok,) = msg.sender.call{value: bal}(""); // External call BEFORE state update
    require(ok);
    balances[msg.sender] = 0; // Too late -- attacker re-entered during the call
}
```

The attacker's `receive()` function calls `withdraw()` again. `balances[msg.sender]` is still the original value because it hasn't been zeroed yet.

**Mitigations:**
1. **Checks-Effects-Interactions pattern**: Update state BEFORE making external calls
2. **Reentrancy guards**: Mutex lock that prevents re-entry
3. **Pull over push**: Let users withdraw rather than sending to them

**Cross-Function Reentrancy:** Attacker re-enters a DIFFERENT function that reads the same stale state. Reentrancy guard on each function individually doesn't help unless it's a global lock.

**Read-Only Reentrancy (newer vector):** Attacker re-enters a `view` function during a state-changing call. If a third contract reads the view function's return value as a price input, it gets a manipulated value. The reentrancy guard doesn't protect view functions.

**Where You Built This in VibeSwap:**
- **Every state-changing contract** inherits `ReentrancyGuardUpgradeable` from OpenZeppelin v5.0.1
- `VibeSwapCore.sol`: inherits `ReentrancyGuardUpgradeable`, uses `nonReentrant` on external state-changing functions
- `CommitRevealAuction.sol`: inherits `ReentrancyGuardUpgradeable` -- commit, reveal, and settle functions are all guarded
- `VibeAMM.sol`: inherits `ReentrancyGuardUpgradeable` -- swap, addLiquidity, removeLiquidity
- `DAOTreasury.sol`, `ShapleyDistributor.sol`, `ILProtectionVault.sol`, `CrossChainRouter.sol`: all use `ReentrancyGuardUpgradeable`
- Token transfers use `SafeERC20` (`using SafeERC20 for IERC20`) throughout, which handles non-standard return values and prevents some callback vectors
- **Checks-Effects-Interactions** is the enforced pattern: state is updated before any external token transfer

---

### 2. Integer Overflow/Underflow

**What It Is:**
Pre-0.8 Solidity: arithmetic wraps silently. `uint256(0) - 1 = 2^256 - 1`. Post-0.8: automatic revert on overflow/underflow unless `unchecked` is used.

**Example:**
```solidity
// Pre-0.8 vulnerability
uint256 balance = 0;
balance -= 1; // Wraps to type(uint256).max -- attacker has infinite tokens
```

**Mitigations:**
- Use Solidity 0.8+ (automatic checks)
- Use `unchecked` ONLY where overflow is provably impossible
- Use SafeMath for pre-0.8 contracts (legacy)

**Where You Built This in VibeSwap:**
- **Solidity 0.8.20** across all 360+ contracts -- automatic overflow/underflow protection
- `unchecked` blocks used sparingly and only where mathematically safe (e.g., loop counter increments in `DeterministicShuffle.sol`)
- `BatchMath.sol` (`contracts/libraries/BatchMath.sol`): Arithmetic on token amounts with explicit bounds checks before operations
- `PRECISION = 1e18` and `BPS_PRECISION = 10000` constants used in `ShapleyDistributor.sol`, `VibeAMM.sol`, and others to maintain precision without overflow risk in intermediate calculations

---

### 3. Access Control

**What It Is:**
Missing or incorrect authorization checks allow unauthorized users to call privileged functions (mint tokens, drain treasury, upgrade contracts, change parameters).

**Example:**
```solidity
// VULNERABLE: anyone can mint
function mint(address to, uint256 amount) external {
    _mint(to, amount);
}

// FIXED
function mint(address to, uint256 amount) external onlyOwner {
    _mint(to, amount);
}
```

**Common Variants:**
- Missing `onlyOwner` / role check
- Incorrect use of `tx.origin` instead of `msg.sender` for auth
- Default visibility (`public`) on functions that should be `internal`
- Uninitialized proxy: `initialize()` not called or callable by anyone

**Where You Built This in VibeSwap:**
- All admin contracts inherit `OwnableUpgradeable` from OpenZeppelin
- `VibeSwapCore.sol`: `_authorizeUpgrade()` uses `onlyOwner` -- no one else can upgrade the implementation
- `CommitRevealAuction.sol`: Pool creation, treasury address setting are `onlyOwner`
- `CircuitBreaker.sol`: Guardian system -- `mapping(address => bool) public guardians` allows multiple authorized emergency responders, but only owner can add/remove guardians
- `DAOTreasury.sol`: Timelock-controlled withdrawals (min 1 hour, default 2 days, max 30 days) -- even the owner can't instantly drain. `EMERGENCY_TIMELOCK = 6 hours` for urgent situations
- **Disintermediation Roadmap** documented in every core contract: Grade C (owner) -> Grade B (TimelockController + DAO) -> Grade A (permissionless where safe). Every `onlyOwner` function has a documented target grade
- `ShapleyDistributor.sol`: UUPS `_authorizeUpgrade()` gated by `onlyOwner`, with plan to transfer to governance

---

### 4. Front-Running / MEV

**What It Is:**
Miners/validators (or bots monitoring the mempool) see pending transactions and insert their own transactions before/after to extract value. Sandwich attacks bracket a victim's trade with a frontrun (buy) and backrun (sell) to profit from the price impact.

**Example (Sandwich Attack):**
1. Victim submits swap: buy 10 ETH worth of TOKEN
2. Bot sees it in mempool, frontruns: buys TOKEN (price goes up)
3. Victim's swap executes at higher price (worse rate)
4. Bot backruns: sells TOKEN at inflated price (profit)

**Mitigations:**
- Commit-reveal schemes (hide order details)
- Batch auctions (uniform clearing price eliminates the "before/after" vector)
- Private mempools (Flashbots Protect, MEV Blocker)
- Slippage protection (minimum output amount)

**Where You Built This in VibeSwap:**
- **This is VibeSwap's core innovation.** `CommitRevealAuction.sol` implements the full commit-reveal batch auction:
  - **Commit Phase (8s):** Users submit `hash(order || secret)` with a deposit. Order details are invisible.
  - **Reveal Phase (2s):** Users reveal their actual orders. Batch seals -- no new orders.
  - **Settlement:** Uniform clearing price for all orders. Fisher-Yates shuffle via `DeterministicShuffle.sol` using XORed user secrets + future block entropy as the seed. No participant controls execution order.
- **Why sandwich attacks die:** A sandwich needs a "before" and "after" price. In a batch auction there is only ONE price. The attack vector structurally does not exist.
- **Priority auctions:** Users can bid for early execution. Bids go to LPs (not validators), so MEV is redistributed cooperatively.
- `MAX_TRADE_SIZE_BPS = 1000` (10% of reserves): Caps single-trade price impact.
- `minAmountOut` parameter in `SwapParams`: Slippage protection as a fallback.

---

### 5. Oracle Manipulation

**What It Is:**
Protocols that read on-chain prices (from AMMs, oracles) can be attacked by manipulating those prices in the same transaction. Flash loans make this trivially cheap.

**Example:**
1. Flash loan 1M USDC
2. Swap into TOKEN on Uniswap (crashes TOKEN price on that pool)
3. Borrow against TOKEN on a lending protocol that reads Uniswap's spot price
4. Protocol thinks TOKEN is worthless, allows cheap liquidation
5. Repay flash loan, profit

**Mitigations:**
- TWAP (Time-Weighted Average Price) oracles instead of spot prices
- Multiple oracle sources with median
- Maximum deviation checks (spot vs. TWAP)
- Minimum observation windows
- Chainlink / Pyth as external price feeds

**Where You Built This in VibeSwap:**
- `TWAPOracle.sol` (`contracts/libraries/TWAPOracle.sol`): Ring buffer of 65535 `Observation` structs, calculates time-weighted average price over configurable windows (min 5 min, max 24h, default 10 min in VibeAMM)
- `VWAPOracle.sol` (`contracts/libraries/VWAPOracle.sol`): Volume-Weighted Average Price for additional manipulation resistance
- `VibeAMM.sol`: `MAX_PRICE_DEVIATION_BPS = 500` (5%) -- spot price must be within 5% of TWAP or the swap reverts
- `SecurityLib.checkPriceDeviation()`: Reusable price deviation check used by multiple contracts
- `TruePriceLib.sol` / `ITruePriceOracle.sol`: Integration point for the Python Kalman filter oracle that provides off-chain true price estimates
- `CircuitBreaker.sol`: `TRUE_PRICE_BREAKER` and `PRICE_BREAKER` can halt trading if price anomalies are detected
- **External oracle (Python):** Kalman filter price oracle runs off-chain, feeds validated prices on-chain for cross-validation

---

### 6. Flash Loan Attacks

**What It Is:**
Flash loans provide unlimited uncollateralized capital for the duration of one transaction. Attackers use this to amplify other exploits (oracle manipulation, governance attacks, liquidation manipulation) at zero capital cost.

**Attack Pattern:**
1. Borrow millions via flash loan
2. Manipulate state (price, governance vote, collateral ratio)
3. Exploit the manipulated state
4. Repay flash loan + fee
5. All in one atomic transaction

**Mitigations:**
- Same-block interaction detection (`tx.origin != msg.sender` heuristic)
- Multi-block delays for sensitive operations (governance, large withdrawals)
- TWAP-based pricing (can't be manipulated in one block)
- Minimum holding periods for governance tokens

**Where You Built This in VibeSwap:**
- `SecurityLib.sol` (`contracts/libraries/SecurityLib.sol`): `detectFlashLoan()` checks `tx.origin != msg.sender` as a heuristic. `requireNoFlashLoan()` reverts if detected.
- `VibeSwapCore.sol`: Flash loan detection on critical paths. `FlashLoanDetected` custom error.
- `CommitRevealAuction.sol`: `FlashLoanDetected` error -- commits require same-block detection
- `DAOTreasury.sol`: Timelock-controlled withdrawals (minimum 1 hour) -- flash loans can't bypass multi-block delays
- Commit-reveal itself is a structural defense: flash-loaned capital committed in block N can't be used to manipulate execution in block N because orders are invisible during the commit phase
- `CircuitBreaker.sol`: Volume breakers detect abnormal activity volumes that correlate with flash loan attacks

---

### 7. Delegatecall Vulnerabilities

**What It Is:**
`delegatecall` executes the target's code in the caller's storage context. If the target is untrusted or has mismatched storage layout, it can overwrite critical state variables (including the implementation address in a proxy).

**Example (Parity Wallet, 2017):**
An attacker called `delegatecall` to a library that had an unprotected `initialize()` function. This overwrote the `owner` variable in the wallet's storage, giving the attacker control.

**Mitigations:**
- Never `delegatecall` to untrusted addresses
- Strict storage layout matching in proxy patterns
- Disable `initialize()` on implementation contracts (call `_disableInitializers()` in constructor)
- Use OpenZeppelin's proxy libraries (battle-tested storage management)

**Where You Built This in VibeSwap:**
- All UUPS contracts use OpenZeppelin's `UUPSUpgradeable` which handles `delegatecall` correctly
- `_authorizeUpgrade()` restricts who can change the implementation address
- Storage layout is maintained across upgrades by only appending new state variables
- `Initializable` from OpenZeppelin prevents double-initialization: `initializer` modifier ensures `initialize()` can only be called once
- All implementation contracts should call `_disableInitializers()` in their constructor to prevent direct initialization of the implementation (not just the proxy)

---

### 8. Denial of Service (DoS)

**What It Is:**
An attacker makes a contract function permanently unusable. Common vectors: unbounded loops over user-controlled arrays, external calls that always revert (griefing), block gas limit exhaustion.

**Examples:**
- Push pattern: contract loops over all recipients to send ETH. One recipient is a contract that reverts in `receive()`. The entire distribution function reverts permanently.
- Unbounded array: Users push to an array. A function iterates the entire array. As it grows, the function exceeds the block gas limit.

**Mitigations:**
- Pull over push (let users claim, don't push to them)
- Bounded iterations (paginate, cap array sizes)
- Avoid external calls in loops
- Use mappings instead of arrays for O(1) operations

**Where You Built This in VibeSwap:**
- `CommitRevealAuction.sol`: Batch sizes are bounded. Settlement processes a fixed-size batch, not an unbounded array.
- `ShapleyDistributor.sol`: Reward claims are pull-based -- LPs claim their own rewards rather than the contract pushing to all LPs
- `DAOTreasury.sol`: Withdrawal is a two-step process (request + execute after timelock). The execution is per-request, not batch.
- `FeeRouter.sol` (`contracts/core/FeeRouter.sol`): Fee distribution to 4 recipients (treasury, insurance, revshare, buyback) is bounded at 4 external calls maximum, not user-controlled array size
- Mappings used throughout instead of arrays: `poolConfigs`, `deposits`, `pendingSwaps`, `pools`, `lpTokens` are all mappings
- `SecurityLib.RateLimit`: Per-user rate limiting (100K tokens/hour) prevents any single user from consuming excessive resources

---

### 9. tx.origin Authentication

**What It Is:**
`tx.origin` is the externally owned account (EOA) that initiated the transaction. Using it for authorization allows phishing attacks: the attacker tricks the victim into calling a malicious contract, which then calls the target contract. `msg.sender` is the malicious contract, but `tx.origin` is the victim.

**Example:**
```solidity
// VULNERABLE
function transferOwnership(address newOwner) external {
    require(tx.origin == owner); // Phishable!
    owner = newOwner;
}
```

Attacker creates a malicious contract. Victim calls it (e.g., via phishing link). Malicious contract calls `transferOwnership(attacker)`. `tx.origin == victim == owner`, so it passes.

**Mitigations:**
- Use `msg.sender` for authorization, not `tx.origin`
- `tx.origin` is only safe as a heuristic (e.g., detecting contract callers)
- Account abstraction (ERC-4337) makes `tx.origin` even less reliable since bundlers submit transactions on behalf of smart accounts

**Where You Built This in VibeSwap:**
- Authorization everywhere uses `msg.sender` via `OwnableUpgradeable` (`onlyOwner` checks `msg.sender`)
- `SecurityLib.detectFlashLoan()`: Uses `tx.origin != msg.sender` as a **detection heuristic** (not for auth) -- this is the correct use of `tx.origin`. It detects contract intermediaries, not authenticates users.
- `contracts/identity/SmartAccount.sol`: Account abstraction support -- recognizes that `tx.origin` is unreliable in an AA world

---

### 10. Timestamp Dependence

**What It Is:**
`block.timestamp` is set by the block proposer and can be manipulated within bounds (~15 seconds on Ethereum). Any logic that depends on precise timing can be gamed.

**Example:**
```solidity
// VULNERABLE: miner can pick timestamp to win
if (block.timestamp % 10 == 0) {
    payWinner(msg.sender);
}
```

**Mitigations:**
- Don't use `block.timestamp` for randomness
- Allow tolerance windows for time-sensitive operations
- Use block numbers for ordering guarantees (block numbers are strictly sequential)
- For time ranges, accept that ~15 second manipulation is possible

**Where You Built This in VibeSwap:**
- `CommitRevealAuction.sol`: Batch timing uses `BATCH_DURATION = 10 seconds`, `COMMIT_DURATION = 8`, `REVEAL_DURATION = 2`. These are coarse-grained enough that ~15s timestamp manipulation doesn't create an advantage. The batch boundary calculation works on `block.timestamp / BATCH_DURATION`, so minor manipulation shifts the entire batch window, not individual order advantage.
- `TWAPOracle.sol`: Observations are timestamped with `uint32(block.timestamp)`. TWAP over 10+ minutes is not meaningfully affected by ~15s manipulation.
- `DeterministicShuffle.generateSeedSecure()`: Uses `blockEntropy` from a FUTURE block (after reveal phase ends) combined with XORed secrets. Even if a validator manipulates the blockhash, they'd need to also control all user secrets.
- `DAOTreasury.sol`: Timelock durations (hours to days) are orders of magnitude larger than any timestamp manipulation window.

---

## Mock Audit Framework: Reviewing an Unknown Codebase in 1 Hour

### Phase 1: Orientation (10 minutes)

1. **Read the README / docs** -- understand what the protocol does
2. **Identify the money flow** -- where do tokens enter? Where do they exit? Who controls the gates?
3. **Map the trust boundaries** -- admin keys, oracles, external contracts, user inputs
4. **Check the tooling** -- Solidity version, compiler settings, dependencies (OpenZeppelin version, etc.)

### Phase 2: Architecture Scan (10 minutes)

1. **List all contracts** and their inheritance chains
2. **Identify proxy patterns** -- upgradeable? Who can upgrade? Timelock?
3. **Map external calls** -- which contracts call which? Where are the `call`, `delegatecall`, `transfer` sites?
4. **Check access control** -- who can call admin functions? Is there a multi-sig? Timelock?
5. **Find the entry points** -- which functions are `external` / `public`?

### Phase 3: Vulnerability Checklist (25 minutes)

Walk through each external function and check:

| Check | What to Look For |
|-------|-----------------|
| **Reentrancy** | External calls before state updates? Missing `nonReentrant`? Cross-function reentrancy? |
| **Access control** | Missing auth? `tx.origin` misuse? Unprotected `initialize()`? |
| **Input validation** | Unchecked array lengths? Zero-address checks? Amount bounds? |
| **Integer math** | Unchecked blocks around user-controlled values? Precision loss in division? Rounding direction? |
| **Oracle reliance** | Spot price used? TWAP window? Single oracle source? |
| **Flash loan vectors** | Can borrowed capital manipulate prices/governance within one tx? |
| **DoS** | Unbounded loops? External calls in loops? Array growth with no cap? |
| **Storage collisions** | Proxy storage layout correct? Gaps present? |
| **Token handling** | ERC-20 with fee-on-transfer? Rebasing tokens? Non-standard return values? SafeERC20 used? |
| **Frontrunning** | Slippage protection? Commit-reveal? Deadline parameter? |

### Phase 4: Critical Path Deep Dive (10 minutes)

Pick the HIGHEST VALUE function (usually: withdraw, swap, liquidate, claim) and trace it line by line:
1. What are all the preconditions?
2. What state changes?
3. What external calls are made?
4. Can any precondition be manipulated?
5. Is there a path where tokens get stuck?

### Phase 5: Report (5 minutes)

Structure findings by severity:
- **Critical**: Direct fund loss, privilege escalation
- **High**: Conditional fund loss, denial of service on core functions
- **Medium**: Value leak, griefing, incorrect accounting
- **Low**: Gas inefficiency, code quality, informational

**Your Interview Narrative:**
> "When I audit, I start with the money. I trace every path tokens can take -- deposit to withdrawal -- and check for state inconsistencies at every external call boundary. In VibeSwap, I built 370+ test files including dedicated security tests and fuzz testing with 256 runs to stress-test invariants. The architecture is defense-in-depth: reentrancy guards, circuit breakers, rate limiting, TWAP validation, flash loan detection, and the commit-reveal mechanism itself which structurally eliminates MEV."

---

## Bonus: Common Security Interview Questions

**Q: "What's the difference between a bug and a vulnerability?"**
A: A bug is incorrect behavior. A vulnerability is a bug that an adversary can exploit for profit. Security engineering assumes every bug will be found and asks: what's the worst case?

**Q: "How do you prioritize which functions to audit first?"**
A: Follow the money. Functions that move tokens (swap, withdraw, liquidate, claim) get audited first. Then functions that change state used by those functions (set oracle, change parameters). Then view functions that other protocols might rely on.

**Q: "What's your opinion on formal verification vs fuzzing?"**
A: Complementary, not competing. Formal verification proves properties hold for ALL inputs but is expensive and limited to specific properties. Fuzzing explores the input space randomly and finds edge cases you didn't think of. VibeSwap uses Foundry fuzz testing (256 runs) and invariant testing (256 runs, depth 500) -- the invariant tests define properties like "total LP tokens == sum of all minted - sum of all burned" and the fuzzer tries to break them. Formal verification would add a third layer but comes with diminishing returns for the engineering cost at this stage.

**Q: "Walk me through how you'd exploit a protocol."**
A: I think like an attacker: What's the most valuable outcome? (Usually: drain all funds.) What state do I need to be true? (Usually: the contract thinks I'm owed more than I deposited.) How do I make that state true? (Usually: reentrancy, oracle manipulation, or access control bypass.) Flash loans amplify any attack that works within a single transaction.

**Q: "What did you learn from building VibeSwap's security model?"**
A: That defense in depth is non-negotiable. Any single layer can fail. VibeSwap has reentrancy guards AND circuit breakers AND rate limiting AND TWAP validation AND flash loan detection AND commit-reveal AND slashing -- because each protects against a different attack vector, and no single mechanism is sufficient. The biggest lesson: MEV is not a bug to be patched but a structural problem that requires a structural solution (batch auctions with uniform clearing prices, not just slippage parameters).
