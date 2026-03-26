// ============================================================
// PROTOCOL CONSTANTS — On-Chain Parameter Mirror
// ============================================================
//
// These values MUST match the on-chain constants in the smart contracts.
// If any contract constant changes, update this file and redeploy the frontend.
//
// Source of truth:
//   - CommitRevealAuction.sol  → COMMIT_DURATION, REVEAL_DURATION, BATCH_DURATION, SLASH_RATE_BPS
//   - IntelligenceExchange.sol → PROTOCOL_FEE_BPS (0), CITATION_SHARE_BPS (3000)
//   - VibeAMM.sol              → swap fee to LPs (100%)
//   - CKB vibeswap-types       → CKB_DEFAULT_FEE_BPS, CKB_DEFAULT_SLASH_BPS
//
// ============================================================

// ============ Batch Auction Timing (seconds) ============
export const COMMIT_DURATION = 8   // CommitRevealAuction.sol: COMMIT_DURATION
export const REVEAL_DURATION = 2   // CommitRevealAuction.sol: REVEAL_DURATION
export const SETTLE_DURATION = 1   // Settlement phase (client-side UX, not on-chain)
export const BATCH_DURATION = COMMIT_DURATION + REVEAL_DURATION // 10s on-chain

// ============ Fee & Slashing (basis points, 1 BPS = 0.01%) ============
export const BPS_DENOMINATOR = 10000
export const SLASH_RATE_BPS = 5000          // 50% — CommitRevealAuction.sol
export const PROTOCOL_FEE_BPS = 0           // 0%  — IntelligenceExchange.sol (P-001: no extraction)
export const CITATION_SHARE_BPS = 3000      // 30% — IntelligenceExchange.sol
export const DEFAULT_SWAP_FEE_BPS = 5       // 0.05% — CKB default pool fee

// ============ Convenience ============
export const SLASH_RATE_PERCENT = (SLASH_RATE_BPS / BPS_DENOMINATOR) * 100 // 50
