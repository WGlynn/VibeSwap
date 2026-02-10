# Shared Session State

This file maintains continuity between Claude Code sessions across devices.

**Last Updated**: 2025-02-10 (Desktop - GitBash)
**Auto-sync**: Enabled - pull at start, push at end of each response

---

## Current Focus
- Frontend UI/UX improvements
- Wallet connection flow for both external (MetaMask) and device (WebAuthn) wallets
- Security-first design based on wallet security axioms
- Axiom alignment gaps: Savings Vault (separation of concerns), hardware wallet prompts, paper backup

## Active Tasks
- None currently in progress

## Recently Completed
1. Fixed wallet detection across all pages (combined external + device wallet state)
2. BridgePage layout fixes (overflow issues resolved)
3. BridgePage "Send" button (was showing "Get Started")
4. 0% protocol fees on bridge (only LayerZero gas)
5. Created `useBalances` hook for balance tracking
6. Deployed to Vercel: https://frontend-jade-five-87.vercel.app
7. Set up auto-sync between devices (pull first, push last - no conflicts)
8. Added Will's 2018 wallet security paper as project context
9. Created wallet security axioms in CLAUDE.md (mandatory design principles)
10. Built Savings Vault feature (separation of concerns axiom):
    - useVault.jsx hook with 30-day timelock, guardian requirements
    - VaultPage.jsx with deposit/withdraw UI
    - Hardware wallet recommendation when balance > $1000
    - Pending withdrawal management with cancel option

## Known Issues / TODO
- Large bundle size warning (2.8MB chunk) - consider code splitting
- Need to test balance updates after real blockchain transactions

## Session Handoff Notes
When starting a new session, tell Claude:
> "Read .claude/SESSION_STATE.md for context from the last session"

When ending a session, ask Claude:
> "Update .claude/SESSION_STATE.md with current state and push to both remotes"

---

## Technical Context

### Dual Wallet Pattern
All pages must support both wallet types:
```javascript
const { isConnected: isExternalConnected } = useWallet()
const { isConnected: isDeviceConnected } = useDeviceWallet()
const isConnected = isExternalConnected || isDeviceConnected
```

### Key Files
| File | Purpose |
|------|---------|
| `frontend/src/components/HeaderMinimal.jsx` | Main header, wallet button |
| `frontend/src/hooks/useDeviceWallet.jsx` | WebAuthn/passkey wallet |
| `frontend/src/hooks/useBalances.jsx` | Balance tracking (mock + real) |
| `frontend/src/components/BridgePage.jsx` | Send money (0% fees) |

### Git Setup
```bash
git push origin master   # Public repo
git push stealth master  # Private repo
# Always push to both!
```

### Dev Server
```bash
cd frontend && npm run dev  # Usually port 3000-3008
```

### Deploy
```bash
cd frontend && npx vercel --prod
```
