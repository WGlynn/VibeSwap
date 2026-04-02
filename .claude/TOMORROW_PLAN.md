# Tomorrow's Plan: Solidity Sprint
**Created**: February 10, 2025
**Goal**: Map Hot Zone → Compile → Pass Tests → Audit Money Paths

---

## Phase 0: MAP THE HOT ZONE (Frontend Attack Surface)

Before touching Solidity, document exactly which frontend files can touch contracts.

### Task
```bash
# Find every file that imports ethers, web3, or contract-related code
cd C:/Users/Will/vibeswap/frontend/src
grep -r "from 'ethers'" --include="*.js" --include="*.jsx" -l
grep -r "from 'ethers'" --include="*.ts" --include="*.tsx" -l
grep -r "useContract" --include="*.js" --include="*.jsx" -l
grep -r "\.connect\(" --include="*.js" --include="*.jsx" -l
```

### Output
Create `docs/audit/FRONTEND_HOT_ZONE.md` with:
- List of every file that touches blockchain
- Current attack surface size (file count, line count)
- Dependency graph (which components import hot hooks)
- Migration notes for Hot/Cold separation

### The Standard (from KNOWLEDGE_BASE.md)

```
blockchain/     → 🔴 HOT - Only place ethers exists
ui/             → 🟢 COLD - Pure UI, no web3
app/            → 🟡 WARM - Glue layer
```

**Rule**: If it touches the chain, it lives in blockchain/. If it doesn't, it can't.

---

## Phase 1: COMPILE (Fix Build Errors)

### Error 1: Forum.sol - Duplicate Identifier
```
Location: contracts/identity/Forum.sol:88
Problem: PostLocked declared as both event (line 79) and error (line 88)
Fix: Rename error to PostIsLocked() or ErrorPostLocked()
```

### Error 2: ClawbackResistance.t.sol - Missing Type
```
Location: test/security/ClawbackResistance.t.sol:336
Problem: CaseStatus not found or not unique
Fix: Import the enum or fix the reference
```

### Verification
```bash
~/.foundry/bin/forge build
```
Expected: `Compiler run successful`

---

## Phase 2: PASS TESTS

### Run Full Suite
```bash
~/.foundry/bin/forge test -vvv
```

### Triage Failures
- **Critical**: Any failure in core/, amm/, or messaging/
- **High**: Failures in incentives/ or governance/
- **Medium**: Failures in identity/ or compliance/

### Fix Priority
1. Fix tests that touch money flow
2. Fix tests that touch cross-chain
3. Fix everything else

---

## Phase 3: AUDIT MONEY PATHS

### Critical Contracts (Money Flows Here)

| Contract | Risk | What to Check |
|----------|------|---------------|
| `VibeAMM.sol` | CRITICAL | Swap logic, LP math, fee extraction |
| `CommitRevealAuction.sol` | CRITICAL | Deposit handling, settlement, refunds |
| `VibeSwapCore.sol` | CRITICAL | Orchestration, fund routing |
| `CrossChainRouter.sol` | CRITICAL | LayerZero message validation, fund bridging |
| `DAOTreasury.sol` | HIGH | Fund custody, withdrawal auth |
| `ILProtectionVault.sol` | HIGH | Insurance payouts |
| `ShapleyDistributor.sol` | HIGH | Reward distribution |

### Security Checklist Per Contract

```
[ ] Reentrancy
    - All external calls use nonReentrant or CEI pattern
    - No callbacks before state updates

[ ] Access Control
    - onlyOwner/onlyRole on sensitive functions
    - No unprotected admin functions

[ ] Integer Math
    - Using Solidity 0.8+ (built-in overflow protection)
    - Verify no unchecked blocks on critical math

[ ] Input Validation
    - All user inputs validated
    - Zero address checks
    - Amount > 0 checks

[ ] Flash Loan Resistance
    - EOA-only where needed
    - TWAP oracles (not spot)
    - Commit-reveal timing

[ ] Cross-Chain Security (for CrossChainRouter)
    - Trusted remote validation
    - Message replay protection
    - Proper endpoint verification
```

### Audit Process

For each critical contract:
1. Read top to bottom
2. Trace every external call
3. Check every state change
4. Verify every modifier
5. Document findings in `docs/audit/CONTRACT_NAME.md`

---

## Session Start Commands

```bash
# 1. Pull latest
cd C:/Users/Will/vibeswap && git pull origin master

# 2. Load context
# Read: .claude/KNOWLEDGE_BASE.md
# Read: .claude/SESSION_STATE.md

# 3. Fix and build
~/.foundry/bin/forge build

# 4. Run tests
~/.foundry/bin/forge test -vvv

# 5. Start audit
# Begin with VibeAMM.sol - the liquidity pool
```

---

## Success Criteria

- [ ] `forge build` passes with 0 errors
- [ ] `forge test` passes with 0 failures
- [ ] VibeAMM.sol audited and documented
- [ ] CommitRevealAuction.sol audited and documented
- [ ] CrossChainRouter.sol audited and documented
- [ ] No critical/high vulnerabilities found (or all fixed)

---

*The frontend can have bugs. The contracts cannot.*
*This is where the cave gets serious.*
