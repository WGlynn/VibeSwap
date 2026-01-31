# VibeSwap Security Audit - Bug Fixes

## Critical Issues (Fixed)

### 1. Time Units Bug (CommitRevealAuction.sol)
**Severity:** Critical
**Location:** Lines 29-35
**Issue:** COMMIT_DURATION and REVEAL_DURATION were set to 800 and 200 respectively, which the comments claimed were milliseconds but Solidity uses seconds. This meant batches lasted 1000 seconds (16+ minutes) instead of 1 second.
**Fix:** Changed to 8 and 2 seconds respectively, which is more realistic for blockchain block times while maintaining short batch cycles.

### 2. Batch Swap Token Transfer Bug (VibeSwapCore.sol + VibeAMM.sol)
**Severity:** Critical
**Location:** _executeOrders() and _executeSwap()
**Issue:** VibeSwapCore only approved tokens to AMM but never transferred them. AMM's _executeSwap assumed tokens were already in the contract but never verified or received them.
**Fix:**
- VibeSwapCore now transfers tokens to AMM via `safeTransfer()` before calling `executeBatchSwap()`
- AMM now properly handles cases where swaps fail by returning tokens to trader

### 3. Cross-Chain Commit ID Mismatch (CrossChainRouter.sol)
**Severity:** Critical
**Location:** _handleCommit()
**Issue:** CommitId was calculated using destination chain's `block.timestamp`, not source chain's timestamp. This meant the commitId on destination wouldn't match the source, breaking cross-chain reveals.
**Fix:** Added `srcTimestamp` to CrossChainCommit struct and use it for consistent commitId calculation on both chains.

### 4. Cross-Chain Reveal ETH Handling (CrossChainRouter.sol)
**Severity:** Critical
**Location:** _handleReveal()
**Issue:** Priority bid ETH was sent on source chain but _handleReveal tried to forward `reveal.priorityBid` amount which the router doesn't have.
**Fix:** Now caps priority bid at available contract balance and uses try/catch to prevent failed reveals from blocking other messages.

### 5. Unrevealed Orders Not Slashable (CommitRevealAuction.sol)
**Severity:** High
**Location:** Missing function
**Issue:** Orders that committed but never revealed had no slashing mechanism. The `withdrawDeposit()` function only worked for REVEALED orders.
**Fix:** Added `slashUnrevealedCommitment()` function that can be called by anyone after batch settlement to slash deposits of non-revealers.

### 6. revealSwap Ownership Check Missing (VibeSwapCore.sol)
**Severity:** High
**Location:** revealSwap()
**Issue:** Anyone could reveal someone else's swap if they knew the commitId, potentially griefing users or front-running reveals.
**Fix:** Added `commitOwners` mapping and verification that only the original committer can reveal their swap.

### 7. Protocol Fees Double-Counted (VibeAMM.sol)
**Severity:** High
**Location:** _executeSwap()
**Issue:** Protocol fees were tracked on input tokens but never deducted from reserves. This caused accounting discrepancies.
**Fix:** Fees are now properly deducted from output amount, with LP fees staying in pool reserves and protocol fees tracked separately on output token.

## Medium Severity Issues (Fixed)

### 8. settleBatch Parameter Ignored (VibeSwapCore.sol)
**Issue:** The `batchId` parameter was ignored; function always settled currentBatchId.
**Fix:** Added validation that passed batchId matches currentBatchId.

### 9. Division by Zero (CrossChainRouter.sol)
**Location:** broadcastBatchResult() and syncLiquidity()
**Issue:** `msg.value / dstEids.length` would revert with division by zero if empty array passed.
**Fix:** Added `require(dstEids.length > 0, "No destinations")` check.

### 10. LP Token Balance Underflow (VibeAMM.sol)
**Location:** removeLiquidity()
**Issue:** `liquidityBalance[poolId][msg.sender] -= liquidity` could underflow if LP tokens were transferred to another address.
**Fix:** Now checks actual LP token balance via `IERC20.balanceOf()` and uses safe subtraction with floor at 0 for internal tracking.

### 11. Priority Order Tie-Breaking (CommitRevealAuction.sol)
**Issue:** Orders with equal priority bids had undefined ordering.
**Fix:** Added tiebreaker using order index (earlier reveals get priority).

### 12. Slash Can Block User (CommitRevealAuction.sol)
**Issue:** If treasury transfer failed, entire slashing reverted, blocking user's refund.
**Fix:** Treasury transfer failure now adds funds back to user refund instead of reverting.

### 13. No Minimum Timelock (DAOTreasury.sol)
**Issue:** Owner could set timelock to 0, defeating its purpose.
**Fix:** Added MIN_TIMELOCK constant (1 hour) and validation.

### 14. Missing Address Validation (VibeSwapCore.sol)
**Issue:** Initialize function didn't validate addresses weren't zero.
**Fix:** Added require checks for all contract addresses.

## Low Severity Issues (Fixed)

### 15. Hardcoded Time Values (VibeSwapCore.sol)
**Issue:** getCurrentBatch() had hardcoded 800/1000 values.
**Fix:** Now uses local constants matching auction contract.

## Remaining Recommendations

1. **Pool Creation Access Control:** Currently anyone can create pools. Consider restricting to owner or adding a creation fee.

2. **Cross-Chain ETH Bridging:** The current implementation doesn't properly bridge ETH for cross-chain commits/reveals. Consider using LayerZero's native token bridging or a separate deposit mechanism.

3. **Batch Swap Grouping:** Current implementation executes orders one at a time. For gas efficiency, orders should be grouped by pool for true batch execution.

4. **Rate Limiting Edge Cases:** Rate limit uses `block.timestamp / 1 hours` which could be manipulated by validators. Consider using block numbers.

5. **Emergency Pause:** Consider adding emergency pause to all contracts, not just VibeSwapCore.

## Testing Recommendations

1. Run full fuzzing tests on BatchMath library functions
2. Test cross-chain flows with actual LayerZero testnet deployment
3. Verify constant product invariant holds through batch swaps
4. Test with various fee-on-transfer and rebasing tokens
5. Simulate MEV attacks to verify commit-reveal provides protection

---

## Security Enhancements (Global Audit)

### Known DEX Vulnerabilities Addressed

Based on comprehensive research of historical DEX exploits (Harvest Finance, Balancer, Uniswap, Curve, etc.), the following security measures have been implemented:

### 1. Flash Loan Protection

**Files:** `SecurityLib.sol`, `VibeAMM.sol`, `VibeSwapCore.sol`

**Measures:**
- `tx.origin != msg.sender` detection for contract callers
- Same-block interaction tracking prevents multiple pool interactions
- EOA-only mode for commits (configurable)
- Rate limiting per user per hour

**Configuration:**
```solidity
// Enable/disable flash loan protection
VibeAMM.setFlashLoanProtection(true);
VibeSwapCore.setRequireEOA(true);
```

### 2. Price Manipulation Protection

**Files:** `TWAPOracle.sol`, `VibeAMM.sol`

**Measures:**
- Time-Weighted Average Price (TWAP) oracle per pool
- Price deviation checks against TWAP (max 5% default)
- Trade size limits (max 10% of reserves per trade)
- Circuit breaker trips on 50%+ price movement

**Configuration:**
```solidity
// Configure TWAP validation
VibeAMM.setTWAPValidation(true);
VibeAMM.setPoolMaxTradeSize(poolId, maxAmount);
VibeAMM.growOracleCardinality(poolId, 100); // More history
```

### 3. First Depositor Attack Protection

**Files:** `VibeAMM.sol`

**Issue:** Attackers can inflate share value by donating tokens before first deposit.

**Solution:**
- Increased MINIMUM_LIQUIDITY to 10,000 (from 1,000)
- Minimum liquidity burned to dead address on first deposit
- Requires sufficient initial liquidity (`liquidity > MINIMUM_LIQUIDITY`)

### 4. Donation Attack Protection

**Files:** `SecurityLib.sol`, `VibeAMM.sol`

**Issue:** Attackers donate tokens to manipulate share calculations.

**Solution:**
- Tracked balances vs actual balances comparison
- Max 1% discrepancy allowed before reverting
- Donation detection events for monitoring

### 5. Circuit Breakers

**Files:** `CircuitBreaker.sol`, `VibeAMM.sol`

**Breaker Types:**
- **VOLUME_BREAKER**: Trips on >$10M volume/hour
- **PRICE_BREAKER**: Trips on >50% price deviation
- **WITHDRAWAL_BREAKER**: Trips on >25% TVL withdrawal/hour

**Features:**
- Configurable thresholds and cooldowns
- Guardian system for manual triggers
- Per-function pause capability
- Automatic reset after cooldown

### 6. Rate Limiting

**Files:** `SecurityLib.sol`, `VibeSwapCore.sol`

**Measures:**
- Per-user hourly swap limits (default 1M tokens)
- Commit cooldown (1 second minimum)
- Blacklist for known exploit contracts

### 7. Access Control & Emergency

**Files:** `VibeSwapCore.sol`, `CircuitBreaker.sol`

**Features:**
- Guardian role for emergency pause
- Blacklist/whitelist for addresses
- Multi-level pause (global, per-function)
- Owner-only security configuration

### Security Configuration Summary

| Feature | Contract | Default | Configurable |
|---------|----------|---------|--------------|
| Flash Loan Protection | VibeAMM | Enabled | Yes |
| TWAP Validation | VibeAMM | Enabled | Yes |
| EOA Requirement | VibeSwapCore | Enabled | Yes |
| Rate Limit | VibeSwapCore | 1M/hour | Yes |
| Commit Cooldown | VibeSwapCore | 1 second | Yes |
| Volume Breaker | VibeAMM | $10M/hour | Yes |
| Price Breaker | VibeAMM | 50% deviation | Yes |
| Withdrawal Breaker | VibeAMM | 25% TVL/hour | Yes |

### New Security Libraries

1. **SecurityLib.sol** - General security utilities
   - Flash loan detection
   - Price deviation checks
   - Balance consistency checks
   - Slippage protection
   - Rate limiting helpers
   - Safe math (mulDiv)

2. **TWAPOracle.sol** - Price oracle
   - Ring buffer of 65,535 observations
   - Configurable TWAP periods (5min - 24hr)
   - Binary search for efficient lookups
   - Linear interpolation for precision

3. **CircuitBreaker.sol** - Emergency controls
   - Multiple breaker types
   - Configurable thresholds
   - Cooldown periods
   - Guardian management

### MVP Deployment Checklist

1. ✅ Deploy all contracts via `Deploy.s.sol`
2. ✅ Configure security settings (automatic)
3. ✅ Create pools via `SetupMVP.s.sol`
4. ✅ Seed initial liquidity
5. ✅ Set guardians for emergency response
6. ⬜ Configure LayerZero peers for cross-chain
7. ⬜ Run test swap flow
8. ⬜ Monitor events for anomalies

### Monitoring Recommendations

Watch for these events:
- `FlashLoanAttemptBlocked` - Potential attack
- `PriceManipulationDetected` - Price anomaly
- `DonationAttackDetected` - Balance manipulation
- `LargeTradeLimited` - Oversized trade blocked
- `BreakerTripped` - Circuit breaker activated
- `RateLimitExceeded` - User rate limited
- `AnomalyDetected` - General security event
