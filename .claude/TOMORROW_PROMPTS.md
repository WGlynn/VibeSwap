# Tomorrow's Session Prompts

**Date**: February 11, 2025
**Focus**: Solidity Smart Contract Sprint

---

## Option 1: Quick Start (Copy-Paste This)

```
Read .claude/JarvisxWill_CKB.md and .claude/SESSION_STATE.md, then execute the Solidity sprint from .claude/TOMORROW_PLAN.md. Start with Phase 0 (map the hot zone) and Phase 1 (fix compile errors).
```

---

## Option 2: Detailed Context (If New Session)

```
JARVIS, load our Common Knowledge Base from .claude/JarvisxWill_CKB.md

Today we're executing the Solidity sprint. The contracts are the HOT ZONE - bugs here are not tolerable.

Phase 0: Map frontend attack surface (which files touch contracts)
Phase 1: Fix 2 compile errors:
  - contracts/social/Forum.sol:88 - PostLocked declared as both event and error
  - test/security/ClawbackResistance.t.sol:336 - CaseStatus not found

Phase 2: Run forge test -vvv and fix any failures
Phase 3: Audit money paths in VibeAMM, CommitRevealAuction, CrossChainRouter

Start with forge build to see current state.
```

---

## Option 3: Resume After Context Loss

```
Context was compressed. Execute session recovery:

1. Read .claude/JarvisxWill_CKB.md (core alignment)
2. Read CLAUDE.md (project context)
3. Read .claude/SESSION_STATE.md (recent work)
4. git pull origin master
5. Read .claude/TOMORROW_PLAN.md (today's sprint)

Then start the Solidity sprint at Phase 0.
```

---

## Yesterday's Completed Work (Reference)

- Created VIBESWAP_FORMAL_PROOFS_ACADEMIC.md (full academic publication format)
- Added 5 trilemmas + 4 quadrilemmas to PROOF_INDEX.md (27 problems addressed)
- Created JarvisxWill_CKB.md (persistent Common Knowledge Base)
- Created "In a Cave, With a Box of Scraps" thesis
- All pushed to both remotes (origin + stealth)

---

## Key Commands

```bash
# Check compile status
~/.foundry/bin/forge build

# Run tests
~/.foundry/bin/forge test -vvv

# Run specific test file
~/.foundry/bin/forge test --match-path test/security/*.t.sol -vvv
```

---

## The Mantra

> "If it touches the chain, it lives in blockchain/. If it doesn't, it can't."

Frontend bugs are tolerable. Contract bugs are not.

*Built in a cave, with a box of scraps.*
