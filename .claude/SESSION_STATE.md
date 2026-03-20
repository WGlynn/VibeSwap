# Session State (Diff-Based)

**Last Updated**: 2026-03-20 (Marathon session — 22 ships)
**Format**: Deltas from previous state. Read bottom-up for chronological order.

## 2026-03-20: The Marathon (22 ships)

### NEXT SESSION — DO THESE FIRST
1. Post ethresear.ch reply (cooldown should be lifted)
2. Fund deployer 0x095C...e8cc with 0.01 ETH on Base (March 26 EBT)
3. Call drip() → 233K VIBE to Shapley pool
4. Deploy identity layer (DeployIdentity.s.sol)
5. Redeploy shard-2 + ollama with latest code
6. Test /code command with a real task
7. Wire ShapleyVerifier into ShapleyDistributor (accept verified off-chain results)
8. TrustScoreVerifier + VoteVerifier (next settlement layer contracts)

### Settlement Layer Separation (NEW ARCHITECTURE)
- **Plan**: `C:\Users\Will\.claude\plans\crispy-dazzling-grove.md`
- Layer 1 (Settlement): ~40 contracts on-chain — token custody, pool reserves, finality
- Layer 2 (Verified Compute): heavy math off-chain with merkle proofs — 90% gas savings
- Layer 3 (Off-Chain): Jarvis shards, AI agents, community scoring
- **Built**: VerifiedCompute.sol (base), ShapleyVerifier.sol, BatchPriceVerifier.sol
- **Key**: `verifyShapleyAxioms()` and `verifyClearing()` are PURE — account model agnostic, ports to CKB
- Remaining: TrustScoreVerifier, VoteVerifier, VibeStateChain integration

### Self-Improvement Stack
- self-eval.js: Jarvis audits 10% of own responses for alignment violations
- Violations auto-correct prompt overlay via self-improve.js + memory.js
- Anti-sycophancy protocol in system prompt + recency rules
- Airspace monitor: probabilistic throttling of dominant users
- Owner noise signal: Will says "slop" → 30min suppression
- IR-002 Nebuchadnezzar Incident documented

### Dialogue-to-Code Pipeline
- dialogue-to-code.js: auto-detects insights → GitHub issues
- reward-batcher.js: weekly Shapley batches from tracker data
- /code command: shards write code, CRPC reviews diffs
- /code reply-to-message: reply to anyone's feedback with /code, they get credited
- TG commands: /mystatus, /contributions, /leaderboard, /batch_rewards

### Atomized Shapley
- UtilizationAccumulator.sol: 30K gas/batch utilization tracking
- MicroGameFactory.sol: permissionless Shapley game creation per epoch
- Paper: docs/papers/atomized-shapley.md

### Contract Dissolutions (Phase 3-4)
- settleBatch, createPool, pause/unpause, addVouchOnBehalf → dissolved
- setRequireEOA, setCommitCooldown, setMaxSwapPerHour, setClawbackRegistry → guardian
- BuybackEngine + FeeRouter: full audit docs on all remaining gates
- GovernanceGuard.sol: TimelockController + Shapley veto
- 10/14 interactions at Grade 3+

### Frontend Fixes
- Onboarding tour: fixed disappearing, increased visibility, prominent skip button
- Jarvis intro chat: solid card body instead of transparent float
- Wallet modal: nudged down to 18vh from top
- Device wallet: password fallback for machines without WebAuthn
- Mouse entropy password generator (6-word passphrases from mouse movement)
- iCloud theater removed → honest "Create Encrypted Backup"
- Vercel: vibeswap-app.vercel.app (auto-alias in vercel.json)

### Build Pipeline
- forge build: 28 seconds (no optimizer, no via_ir)
- CI: full optimization on GitHub Actions (7GB RAM)
- Chunked build script: scripts/build-chunks.sh
- optimizer+via_ir crashes solc on Windows (0xc0000005)

### Network Status
- Primary: ONLINE with all new modules
- BFT: ACTIVE, CRPC: ACTIVE
- Shard-2 + Ollama: may need redeploy
- Other shards: deployed with anti-sycophancy + airspace monitor

### Papers
- dissolving-the-owner.md
- atomized-shapley.md
- everybody-is-a-dev.md
- ethresear-reply-auction-formats.md (ready to post)

### Key Memories Saved
- feedback_no-projection.md — never project emotions on Will's behalf
- feedback_workaround-over-waiting.md — 2 failures → stop and pivot
- feedback_account-model-agnostic.md — pure verification, ports to CKB
- primitive_atomized-shapley.md — Shapley for every interaction

### Key Commits
- 6fc3543 Verkle Context Tree
- 2d06ced Phase 3 dissolutions
- dba7873 Dialogue-to-code
- 0a260df Airspace monitor
- f557a5b Anti-sycophancy protocol
- 9ca7507 Self-evaluation
- 9bafc3a Atomized Shapley contracts
- 81cd94b /code command
- 26a439e Dynamic BFT/CRPC activation
- 6b8216e Mouse entropy password generator
- 2968a26 Settlement layer (VerifiedCompute + ShapleyVerifier + BatchPriceVerifier)
