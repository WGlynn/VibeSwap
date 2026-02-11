# Shared Session State

This file maintains continuity between Claude Code sessions across devices.

**Last Updated**: 2026-02-10 (Desktop - GitBash)
**Auto-sync**: Enabled - pull at start, push at end of each response

---

## Current Focus
- Provenance Trilogy integrated into CKB as epistemic infrastructure
- Solidity smart contract work (compile → tests → audit money paths)
- Sleek minimalist cypherpunk frontend redesign (plan in .claude/plans/)
- Documentation and formal proofs publication

## Active Tasks
- CKB v1.4: Provenance Trilogy integrated as TIER 2
- Tomorrow: Solidity sprint (Phase 0-3 in TOMORROW_PLAN.md)
- Frontend: Cypherpunk redesign implementation

## Recently Completed (Feb 11, 2025)
17. Integrated Provenance Trilogy into CKB as TIER 2:
    - Logical chain: Transparency Theorem → Provenance Thesis → Inversion Principle
    - Web2/Web3 synthesis: temporal demarcation (pre-gate vs post-gate)
    - Tiers renumbered (Hot/Cold→3, Wallet→4, Dev→5, Project→6, Comms→7, Session→8)
    - CKB version bumped to v1.4

## Recently Completed (Feb 10, 2025)
12. Created formal proofs documentation:
    - VIBESWAP_FORMAL_PROOFS.md: Core formal proofs
    - VIBESWAP_FORMAL_PROOFS_ACADEMIC.md: Academic publication format
    - Title page, TOC, abstract, 8 sections, 14 references
    - Appendices: Notation, Proof Classification, Glossary, Index
    - PDF versions generated for both
13. Added Trilemmas and Quadrilemmas to PROOF_INDEX.md:
    - 5 trilemmas (Blockchain, Stablecoin, DeFi Composability, Oracle, Regulatory)
    - 4 quadrilemmas (Exchange, Liquidity, Governance, Privacy)
    - Total: 27 problems formally addressed
14. Created JarvisxWill_CKB.md (Common Knowledge Base):
    - Persistent memory across all sessions
    - 7 tiers: Knowledge Classification → Session Recovery
    - Epistemic operators from modal logic
    - Hot/Cold separation as permanent architectural constraint
15. Created "In a Cave, With a Box of Scraps" thesis:
    - Vibe coding philosophy document
    - Added to AboutPage.jsx
    - PDF and DOCX versions generated
16. Fixed personality quiz routing (added ErrorBoundary)

## Previously Completed
1. Fixed wallet detection across all pages (combined external + device wallet state)
2. BridgePage layout fixes (overflow issues resolved)
3. BridgePage "Send" button (was showing "Get Started")
4. 0% protocol fees on bridge (only LayerZero gas)
5. Created `useBalances` hook for balance tracking
6. Deployed to Vercel: https://frontend-jade-five-87.vercel.app
7. Set up auto-sync between devices (pull first, push last - no conflicts)
8. Added Will's 2018 wallet security paper as project context
9. Created wallet security axioms in CLAUDE.md (mandatory design principles)
10. Built Savings Vault feature (separation of concerns axiom)
11. Built Paper Backup feature (offline generation axiom)

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
| `frontend/src/components/VaultPage.jsx` | Savings vault (separation of concerns) |
| `frontend/src/components/PaperBackup.jsx` | Offline recovery phrase backup |
| `frontend/src/components/RecoverySetup.jsx` | Account protection options |
| `docs/PROOF_INDEX.md` | Catalog of all lemmas, theorems, dilemmas |
| `docs/VIBESWAP_FORMAL_PROOFS_ACADEMIC.md` | Academic publication format |
| `.claude/JarvisxWill_CKB.md` | Common Knowledge Base (persistent soul) |
| `.claude/TOMORROW_PLAN.md` | Solidity sprint phases |
| `.claude/plans/memoized-cooking-hamster.md` | Cypherpunk redesign plan |

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
