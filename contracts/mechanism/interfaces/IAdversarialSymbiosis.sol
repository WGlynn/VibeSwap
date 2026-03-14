// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/**
 * @title IAdversarialSymbiosis
 * @notice Interface for the Adversarial Symbiosis mechanism — attacks strengthen the protocol.
 *         Part of the IT meta-pattern. Captured adversarial value is routed to system
 *         strengthening targets rather than burned or sent to treasury.
 *         The system becomes antifragile: more attacks = stronger protocol.
 */
interface IAdversarialSymbiosis {

    // ============ Enums ============

    enum AdversarialType {
        INVALID_REVEAL,         // Bad reveal in commit-reveal batch
        PRICE_MANIPULATION,     // Attempted TWAP/oracle manipulation
        FLASH_LOAN_ATTEMPT,     // Contract-based commit (EOA-only violation)
        SYBIL_DETECTED,         // Sybil pattern detected in batch
        COMMITMENT_BREACH,      // Broken temporal collateral commitment
        GRIEFING                // Intentional spam or delay attack
    }

    enum StrengtheningTarget {
        INSURANCE_POOL,         // IL protection for LPs
        TRADER_REWARDS,         // Bonus for honest traders in same batch
        PRICE_DISCOVERY,        // Fund prediction market liquidity
        PROTOCOL_RESERVE        // General protocol health reserve
    }

    // ============ Structs ============

    struct AdversarialEvent {
        bytes32 eventId;
        uint64 batchId;
        address adversary;
        AdversarialType eventType;
        uint256 capturedValue;
        uint64 timestamp;
        bool distributed;
    }

    struct StrengtheningAllocation {
        StrengtheningTarget target;
        uint16 bps;             // Basis points (out of 10000)
    }

    struct StrengtheningStats {
        uint256 totalCaptured;
        uint256 totalDistributed;
        uint256 eventCount;
        uint256 insurancePoolFunded;
        uint256 traderRewardsFunded;
        uint256 priceDiscoveryFunded;
        uint256 protocolReserveFunded;
    }

    // ============ Events ============

    event AdversarialEventRecorded(
        bytes32 indexed eventId,
        uint64 indexed batchId,
        address indexed adversary,
        AdversarialType eventType,
        uint256 capturedValue
    );

    event StrengtheningDistributed(
        bytes32 indexed eventId,
        StrengtheningTarget indexed target,
        uint256 amount
    );

    event AllocationUpdated(
        AdversarialType indexed eventType,
        StrengtheningTarget[] targets,
        uint16[] bps
    );

    // ============ Errors ============

    error ZeroAddress();
    error ZeroAmount();
    error InvalidAllocation();
    error AlreadyDistributed();
    error EventNotFound();
    error NotAuthorized();
    error ArrayLengthMismatch();

    // ============ Core ============

    /**
     * @notice Record an adversarial event and capture its value
     * @param batchId The batch where the adversarial action occurred
     * @param adversary The address that committed the adversarial action
     * @param eventType The type of adversarial action
     * @param capturedValue The value captured from the adversary (in payment token)
     * @return eventId Unique identifier for this event
     */
    function recordAdversarialEvent(
        uint64 batchId,
        address adversary,
        AdversarialType eventType,
        uint256 capturedValue
    ) external returns (bytes32 eventId);

    /**
     * @notice Distribute captured value from an adversarial event to strengthening targets
     * @param eventId The adversarial event to distribute from
     */
    function distributeStrengthening(bytes32 eventId) external;

    /**
     * @notice Set the strengthening allocation for a given adversarial type
     * @param eventType The type of adversarial action
     * @param targets Array of strengthening targets
     * @param bps Array of basis points for each target (must sum to 10000)
     */
    function setAllocation(
        AdversarialType eventType,
        StrengtheningTarget[] calldata targets,
        uint16[] calldata bps
    ) external;

    // ============ Views ============

    /**
     * @notice Get the strengthening allocation for a given adversarial type
     */
    function getAllocation(
        AdversarialType eventType
    ) external view returns (StrengtheningAllocation[] memory);

    /**
     * @notice Get details of an adversarial event
     */
    function getEvent(bytes32 eventId) external view returns (AdversarialEvent memory);

    /**
     * @notice Get all adversarial events for a batch
     */
    function getBatchEvents(uint64 batchId) external view returns (bytes32[] memory eventIds);

    /**
     * @notice Get cumulative strengthening statistics
     */
    function getStats() external view returns (StrengtheningStats memory);

    /**
     * @notice Get total value captured from a specific adversary
     */
    function getAdversaryTotal(address adversary) external view returns (uint256);
}
