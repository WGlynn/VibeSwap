// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/**
 * @title IOracleAggregationCRA
 * @notice Commit-reveal batch aggregator for price oracles.
 *
 *         Issuers commit `hash(price || nonce)` during commit phase, reveal
 *         `(price, nonce)` during reveal phase. Settlement computes the median
 *         of revealed prices and publishes to TruePriceOracle. Mirrors the
 *         Commit-Reveal Batch Auction (CRA) primitive — fourth invocation.
 *
 *         FAT-AUDIT-2 / Gap 2 of the ETM Alignment Audit. Replaces TPO's
 *         policy-level 5% deviation gate with structural commit-reveal
 *         opacity: no issuer can observe others' commits before submitting,
 *         so collusion-by-quote-matching is structurally prevented rather
 *         than threshold-gated.
 *
 *         Paper: Augmented Mechanism Design §6.1 Temporal Augmentation
 *         (commit window) + §6.5 Compensatory Augmentation (slash redistribution).
 */
interface IOracleAggregationCRA {
    // ============ Types ============

    enum BatchPhase {
        COMMIT,    // accepting commits
        REVEAL,    // accepting reveals
        SETTLED    // median published, batch closed
    }

    struct BatchInfo {
        uint256 batchId;
        uint256 commitDeadline;
        uint256 revealDeadline;
        BatchPhase phase;
        uint256 commitCount;
        uint256 revealCount;
        uint256 medianPrice;       // 0 until SETTLED
    }

    // ============ Events ============

    event PriceCommitted(uint256 indexed batchId, address indexed issuer, bytes32 commitHash);
    event PriceRevealed(uint256 indexed batchId, address indexed issuer, uint256 price);
    event BatchSettled(uint256 indexed batchId, uint256 medianPrice, uint256 revealCount);
    event IssuerSlashed(uint256 indexed batchId, address indexed issuer, uint256 amount, string reason);

    // ============ Phase 1 — Commit ============

    /// @notice Submit a hash of `(price, nonce)` for the current batch.
    function commitPrice(bytes32 commitHash) external;

    // ============ Phase 2 — Reveal ============

    /// @notice Reveal a previously-committed price by providing the price + nonce.
    function revealPrice(uint256 batchId, uint256 price, bytes32 nonce) external;

    // ============ Phase 3 — Settle ============

    /// @notice Permissionless settlement: compute median of revealed prices, publish to TPO.
    function settleBatch(uint256 batchId) external returns (uint256 medianPrice);

    // ============ Slashing ============

    /// @notice Permissionless slash of an issuer who committed but never revealed.
    function slashNonRevealer(uint256 batchId, address issuer) external;

    // ============ Views ============

    function getBatch(uint256 batchId) external view returns (BatchInfo memory);

    function getCurrentBatchId() external view returns (uint256);
}
