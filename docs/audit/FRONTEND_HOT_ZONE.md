# Frontend Hot Zone Audit

**Date**: February 11, 2025
**Auditor**: JARVIS
**Total Frontend Files**: 78

---

## Executive Summary

**Current Attack Surface**: 19 files touch blockchain (24% of codebase)
**Target Attack Surface**: ~5 files (Hot Zone only)
**Risk Level**: HIGH - No Hot/Cold separation implemented

The frontend currently violates the Hot/Cold separation principle. Blockchain interactions are scattered across hooks, utils, and components instead of being isolated in a single `blockchain/` directory.

---

## Files That Touch Blockchain (HOT)

### Tier 1: Direct Contract Interaction (CRITICAL)

| File | Lines | Risk | What It Does |
|------|-------|------|--------------|
| `hooks/useContracts.jsx` | ~200 | CRITICAL | Creates contract instances, all contract calls |
| `hooks/useWallet.jsx` | ~150 | CRITICAL | Wallet connection, provider access |
| `hooks/useDeviceWallet.jsx` | ~180 | CRITICAL | WebAuthn signing, key management |
| `hooks/useBalances.jsx` | ~100 | HIGH | Reads token balances from chain |
| `abis/VibeAMM.json` | - | HIGH | AMM contract ABI |
| `abis/VibeSwapCore.json` | - | HIGH | Core contract ABI |

### Tier 2: Contract State Readers (HIGH)

| File | Lines | Risk | What It Does |
|------|-------|------|--------------|
| `hooks/useIdentity.js` | ~120 | HIGH | Identity contract reads |
| `hooks/useIncentives.jsx` | ~100 | HIGH | Incentive/reward reads |
| `hooks/useBatchState.jsx` | ~80 | HIGH | Batch auction state |
| `hooks/useRecovery.js` | ~90 | HIGH | Recovery state/functions |
| `hooks/useAnalytics.js` | ~70 | MEDIUM | On-chain analytics |

### Tier 3: Crypto Operations (MEDIUM)

| File | Lines | Risk | What It Does |
|------|-------|------|--------------|
| `hooks/useQuantumVault.js` | ~100 | MEDIUM | Vault interactions |
| `utils/quantumCrypto.js` | ~150 | MEDIUM | Signing, key derivation |
| `utils/finality.js` | ~60 | LOW | Block finality checks |
| `utils/sybilDetection.js` | ~80 | LOW | On-chain identity checks |

### Tier 4: Components with Direct Blockchain Access (VIOLATION)

| File | Lines | Risk | What It Does |
|------|-------|------|--------------|
| `components/RecoverySetup.jsx` | ~300 | HIGH | Direct signing in component |
| `components/BuySellPage.jsx` | ~400 | HIGH | Direct contract calls in component |
| `components/DocsPage.jsx` | ~200 | LOW | Ethers import (docs display) |

---

## Current Directory Structure

```
frontend/src/
├── App.jsx
├── main.jsx
├── index.css
├── abis/                    # 🔴 HOT - Contract ABIs
│   ├── VibeAMM.json
│   └── VibeSwapCore.json
├── components/              # ❌ MIXED - Should be COLD
│   ├── RecoverySetup.jsx    # 🔴 HOT violation
│   ├── BuySellPage.jsx      # 🔴 HOT violation
│   ├── DocsPage.jsx         # 🟡 Ethers import
│   └── ... (25+ more)
├── contexts/                # ❌ MIXED
│   └── ContributionsContext.jsx
├── hooks/                   # ❌ MIXED - Many are HOT
│   ├── useContracts.jsx     # 🔴 HOT
│   ├── useWallet.jsx        # 🔴 HOT
│   ├── useDeviceWallet.jsx  # 🔴 HOT
│   ├── useBalances.jsx      # 🔴 HOT
│   ├── useIdentity.js       # 🔴 HOT
│   ├── useIncentives.jsx    # 🔴 HOT
│   ├── useBatchState.jsx    # 🔴 HOT
│   └── ... (5+ more)
└── utils/                   # ❌ MIXED
    ├── quantumCrypto.js     # 🔴 HOT
    ├── finality.js          # 🟡 WARM
    ├── sybilDetection.js    # 🟡 WARM
    └── format.js            # 🟢 COLD
```

---

## Target Directory Structure (Hot/Cold Separation)

```
frontend/src/
├── blockchain/              # 🔴 HOT ZONE - All contract interaction
│   ├── abis/                # Contract ABIs
│   │   ├── VibeAMM.json
│   │   └── VibeSwapCore.json
│   ├── contracts/           # Contract type definitions
│   ├── gateway/             # SINGLE ENTRY POINT
│   │   └── index.ts         # The one door
│   ├── hooks/               # React hooks that wrap gateway
│   │   ├── useContracts.jsx
│   │   ├── useWallet.jsx
│   │   ├── useDeviceWallet.jsx
│   │   ├── useBalances.jsx
│   │   ├── useIdentity.js
│   │   ├── useIncentives.jsx
│   │   ├── useBatchState.jsx
│   │   ├── useRecovery.js
│   │   ├── useQuantumVault.js
│   │   └── useAnalytics.js
│   ├── utils/               # Crypto utilities
│   │   ├── quantumCrypto.js
│   │   ├── finality.js
│   │   └── sybilDetection.js
│   └── validation/          # Input validation BEFORE chain
│
├── ui/                      # 🟢 COLD ZONE - Pure UI, no web3
│   ├── components/          # Presentational only
│   └── utils/               # formatNumber, truncateAddress
│       └── format.js
│
├── app/                     # 🟡 WARM ZONE - Glue layer
│   ├── pages/               # Connect HOT hooks to COLD components
│   │   ├── SwapPage.jsx
│   │   ├── PoolPage.jsx
│   │   └── ...
│   └── providers/           # Context providers
```

---

## Migration Checklist

### Phase 1: Create Structure
- [ ] Create `blockchain/` directory
- [ ] Create `blockchain/gateway/index.ts`
- [ ] Create `ui/` directory
- [ ] Create `app/` directory

### Phase 2: Move Hot Files
- [ ] Move `abis/` → `blockchain/abis/`
- [ ] Move hot hooks → `blockchain/hooks/`
- [ ] Move crypto utils → `blockchain/utils/`

### Phase 3: Refactor Components
- [ ] Extract blockchain logic from `RecoverySetup.jsx`
- [ ] Extract blockchain logic from `BuySellPage.jsx`
- [ ] Remove ethers import from `DocsPage.jsx`

### Phase 4: Create Gateway
- [ ] Implement single entry point in `gateway/index.ts`
- [ ] Route all contract calls through gateway
- [ ] Add input validation layer

### Phase 5: Verify Isolation
- [ ] Run: `grep -r "from 'ethers'" ui/` → Should return nothing
- [ ] Run: `grep -r "from 'ethers'" app/` → Should return nothing
- [ ] Only `blockchain/` should import ethers

---

## Attack Surface Metrics

| Metric | Current | Target | Reduction |
|--------|---------|--------|-----------|
| Files touching blockchain | 19 | 5 | 74% |
| Components with direct access | 3 | 0 | 100% |
| Entry points to contracts | ~15 | 1 | 93% |
| Lines of hot code | ~2000 | ~800 | 60% |

---

## Priority Actions

1. **IMMEDIATE**: Create gateway file - single entry point
2. **HIGH**: Move hooks to `blockchain/hooks/`
3. **HIGH**: Refactor `RecoverySetup.jsx` and `BuySellPage.jsx`
4. **MEDIUM**: Restructure directories
5. **LOW**: Update imports across codebase

---

## Notes

This refactor is a **future task** after the Solidity audit. The current codebase functions but has an expanded attack surface. The Hot/Cold separation will:

1. Shrink audit surface from 19 files to ~5
2. Make security review tractable
3. Isolate all potential vulnerabilities to one directory
4. Enable pure unit testing of UI components

---

*"If it touches the chain, it lives in blockchain/. If it doesn't, it can't."*
