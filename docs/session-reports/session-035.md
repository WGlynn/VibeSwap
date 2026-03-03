# Session 35 Report — Phase 2 Base Mainnet: Pools + Tokenomics Live

**Date**: 2026-03-03
**Operator**: Jarvis (Claude Opus 4.6)
**Duration**: ~1 hour
**Mode**: Interactive (Will approving each broadcast)

---

## Summary

Deployed Phase 2 (Pools + Tokenomics) to Base mainnet. Created 2 new liquidity pools (cbBTC/USDC, ETH/cbBTC), deployed 7 tokenomics contracts, configured gauges, started VIBE emissions, and verified all 11 contracts on Basescan. Discovered that Phase 1 AMM/BuybackEngine implementations are missing newer functions — flagged for proxy upgrade in next session.

## Completed Work

### 1. Pre-Flight Verification (Phase 0)
- `forge build --skip test` — compiled successfully (lint warnings only)
- Deployer balance: 0.0149 ETH on Base (sufficient)
- Confirmed Phase 1 contract ownership: VibeSwapCore, VibeAMM, DAOTreasury all owned by deployer (`0xaE0Fc55d...`)

### 2. Base Token Address Fix + Pool Creation (Phase 1)
**Problem**: `SetupMVP.s.sol` had `address(0)` for WBTC on Base — no pools could be created for BTC pairs.

**Fix**: Added cbBTC (Coinbase Wrapped BTC) address `0xcbB7C0000aB88B473b1f5aFd9ef808440eed33Bf` for Base chain ID 8453. USDT remains `address(0)` (no canonical USDT on Base).

**Pools Created**:
| Pool | Pool ID | Status |
|------|---------|--------|
| ETH/USDC | `0xf4f8ea...f615` | Already existed (Phase 1) |
| cbBTC/USDC | `0xbd0fb0...d7f7` | **NEW** |
| ETH/cbBTC | `0x75f28a...4722` | **NEW** |

Gas cost: ~0.000034 ETH

### 3. Tokenomics Deployment (Phase 2) — 7 Contracts

**UUPS Proxies (4)**:
| Contract | Proxy Address | Implementation |
|----------|---------------|----------------|
| VIBEToken | `0x56C35BA2c026F7a4ADBe48d55b44652f959279ae` | `0xCaacb2d8...` |
| ShapleyDistributor | `0x290bC683F242761D513078451154F6BbE1EE18B1` | `0xbd0975...` |
| PriorityRegistry | `0xe713535b1a622B4323f44DF3cb9baD477D26407E` | `0x7Af2F2...` |
| EmissionController | `0xCdB73048A67F0dE31777E6966Cd92FAaCDb0Fc55` | `0x26E4B0...` |

**Standalone (3)**:
| Contract | Address |
|----------|---------|
| Joule | `0x6A9233A5a1beF0F10de0778BB9EbeD8f736b320d` |
| LiquidityGauge | `0x8C04F776d5D626031d8AEf018bF1DB0799049341` |
| SingleStaking | `0xcD4fCe4dF678F808AF297CB9Cfee7140862646Be` |

**Post-Deploy Wiring** (all automatic in script):
- VIBEToken: EmissionController authorized as minter
- ShapleyDistributor: EmissionController + VibeSwapCore authorized as creators
- ShapleyDistributor: PriorityRegistry linked for pioneer bonus
- SingleStaking: Ownership transferred to EmissionController
- EmissionController: Owner authorized as drainer

Gas cost: ~0.000244 ETH

### 4. Post-Deploy Configuration (Phase 3)

**SetupGauges**: Created ETH/USDC gauge at 100% weight. Gas: ~0.0000046 ETH.

**StartEmissions**: First `drip()` call executed. Results:
- Era: 0
- Rate: ~0.333 VIBE/second (332,880,110 gwei/sec)
- First mint: ~43.27 VIBE
- Split: 50% Shapley pool / 35% LiquidityGauge / 15% SingleStaking
- Remaining supply: ~20,999,957 of 21,000,000 VIBE cap

Gas: ~0.0000053 ETH.

**Skipped**: `BuybackEngine.setProtocolToken(VIBE)` — function not in deployed implementation.

### 5. Basescan Verification (Phase 4)

All 11 contracts verified:
- 4 UUPS implementations (VIBEToken, ShapleyDistributor, PriorityRegistry, EmissionController)
- 4 ERC1967Proxy contracts
- 3 standalone contracts (Joule, LiquidityGauge, SingleStaking)

### 6. Compilation Speed Optimization

Added `fast` profile to `foundry.toml` — disables `via_ir` for 2-5x faster dev builds:
```toml
[profile.fast]
via_ir = false  # Everything else same as default
```
Usage: `FOUNDRY_PROFILE=fast forge build` or `FOUNDRY_PROFILE=fast forge test`

Also discovered `forge build --skip test` skips 181 test files for deploy-only compilation.

## Files Modified

| File | Change |
|------|--------|
| `script/SetupMVP.s.sol` | Added cbBTC address for Base, removed protection config calls (not in deployed impl) |
| `foundry.toml` | Added `[profile.fast]` for faster dev compilation |
| `.claude/SESSION_STATE.md` | Updated with Phase 2 deployment state |
| `.env` | Added tokenomics addresses + Base token addresses (gitignored) |

## Decisions Made

1. **cbBTC over WBTC**: Used Coinbase Wrapped BTC (`0xcbB7C0000...`) as it's the canonical BTC wrapper on Base
2. **Skip USDT**: No canonical USDT on Base — 3 pools instead of 5
3. **Skip protection config**: `setPoolProtectionConfig`, `growOracleCardinality`, `growVWAPCardinality` not in deployed AMM implementation — deferred to AMM proxy upgrade
4. **Skip BuybackEngine wiring**: `setProtocolToken` not in deployed implementation — deferred to BuybackEngine redeploy
5. **ETH/USDC gauge 100%**: Single gauge gets all weight until more pools have liquidity

## Discovery: Phase 1 Implementation Gap

The deployed AMM implementation (`0xe39346c...`) is missing 3 functions that exist in the current source code:
- `setPoolProtectionConfig(bytes32, ProtectionConfig)`
- `growOracleCardinality(bytes32, uint16)`
- `growVWAPCardinality(bytes32, uint16)`

Similarly, BuybackEngine (`0xC53b6F...`) is missing:
- `setProtocolToken(address)`

**Root cause**: These functions were added to source after Phase 1 deployment (Feb 21).
**Resolution**: AMM needs UUPS proxy upgrade; BuybackEngine needs redeployment.

## Test Results

- `forge build --skip test`: PASS (lint warnings only, no compilation errors)
- All deployment dry runs: PASS before broadcast
- All on-chain verifications: PASS (11/11 contracts verified)

## Metrics

| Metric | Value |
|--------|-------|
| Contracts deployed | 11 (7 new + 4 proxies) |
| Contracts verified | 11/11 |
| Pools created | 2 new (3 total) |
| Total gas spent | ~0.000288 ETH |
| Deployer balance remaining | ~0.0146 ETH |
| VIBE minted (first drip) | ~43.27 VIBE |
| Emission rate | ~0.333 VIBE/sec |
| Background tasks | 16 (all resolved) |

## Logic Primitives Extracted

1. **Selector-check-before-call**: When calling functions on deployed contracts, verify the function selector exists in the on-chain bytecode before assuming the source code matches the deployed version. Use `cast code <addr> | grep -o <selector>`.

2. **Parallel verification with rate limiting**: Basescan enforces 3 calls/sec. Stagger parallel verification submissions with `sleep` delays to avoid rate limit rejections.

3. **Fast profile for iteration**: Separating `via_ir` (deploy-quality) from development builds gives 2-5x faster iteration cycles without sacrificing deploy optimization.

## Next Session Priorities

1. **AMM proxy upgrade** — Deploy new implementation with protection config + oracle cardinality functions
2. **BuybackEngine redeploy** — New deployment with `setProtocolToken`, wire to VIBE
3. **Add liquidity** — Bootstrap ETH/USDC, cbBTC/USDC, ETH/cbBTC pools
4. **Keeper bot** — Automate `EmissionController.drip()` calls
5. **Additional gauges** — Create gauges for cbBTC/USDC and ETH/cbBTC pools with weight distribution

---

*"The cave selects for those who see past what is to what could be."*

**Total Base Mainnet Contracts**: 18 (10 Phase 1 + 7 Phase 2 tokenomics + 1 LiquidityGauge wiring)
**Total VIBE Supply Cap**: 21,000,000
**Emissions**: LIVE
