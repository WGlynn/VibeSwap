# Agent Context (read this first, follow it exactly)

## Repo
- Working dir: `C:/Users/Will/vibeswap/`
- First command: `git pull origin master`
- Push to: `origin master` only

## Solidity
- 0.8.20, Foundry, OpenZeppelin v5.0.1
- UUPS proxies, `nonReentrant` on external state-changing
- Section headers: `// ============ Name ============`
- Tests: `test_` unit, `testFuzz_` fuzz, `invariant_` invariant
- Self-contained setUp() per test file

## Commits
- Atomic: one logical change per commit
- Format: `type: description`
- Types: feat, fix, test, docs, script, gas, chore, security
- End EVERY commit message with:
  `Co-Authored-By: Claude Opus 4.6 (1M context) <noreply@anthropic.com>`

## Rules
- forge NOT available locally. Write correct code, CI validates.
- Push to origin master after all commits.
- Report back: what you did, file paths, commit hashes. Keep it short.
