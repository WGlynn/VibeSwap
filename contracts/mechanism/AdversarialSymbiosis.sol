// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "./interfaces/IAdversarialSymbiosis.sol";

/**
 * @title AdversarialSymbiosis
 * @notice Adversarial Symbiosis mechanism — attacks on the protocol generate value that
 *         strengthens it. Captured adversarial value (slashed deposits, failed flash loans,
 *         invalid reveals, etc.) is routed to strengthening targets rather than burned.
 *         The system becomes antifragile: more attacks = stronger protocol.
 *
 *         Part of the IT meta-pattern. Cooperative Capitalism: even adversaries contribute
 *         to collective welfare. Their captured value funds insurance, trader rewards,
 *         price discovery, and protocol reserves.
 */
contract AdversarialSymbiosis is IAdversarialSymbiosis, Ownable, ReentrancyGuard {

    // ============ Constants ============

    uint256 public constant PRECISION = 1e18;
    uint16 public constant BPS_DENOMINATOR = 10000;

    // ============ State ============

    address public treasury;
    address public token;

    // Target addresses for strengthening distribution
    address public insurancePool;
    address public traderRewardsPool;
    address public priceDiscoveryPool;
    address public protocolReserve;

    mapping(bytes32 => AdversarialEvent) private _events;
    mapping(uint64 => bytes32[]) private _batchEvents;
    mapping(AdversarialType => StrengtheningAllocation[]) private _allocations;
    mapping(address => uint256) private _adversaryTotals;
    mapping(address => bool) public authorizedRecorders;

    StrengtheningStats private _stats;

    // ============ Constructor ============

    constructor(address _treasury, address _token) Ownable(msg.sender) {
        if (_treasury == address(0) || _token == address(0)) revert ZeroAddress();
        treasury = _treasury;
        token = _token;

        // Treasury acts as default target until pool addresses are set
        insurancePool = _treasury;
        traderRewardsPool = _treasury;
        priceDiscoveryPool = _treasury;
        protocolReserve = _treasury;

        // Set default allocations for each adversarial type
        _setDefaultAllocations();
    }

    // ============ Core ============

    /// @inheritdoc IAdversarialSymbiosis
    function recordAdversarialEvent(
        uint64 batchId,
        address adversary,
        AdversarialType eventType,
        uint256 capturedValue
    ) external returns (bytes32 eventId) {
        if (!authorizedRecorders[msg.sender] && msg.sender != owner()) revert NotAuthorized();
        if (adversary == address(0)) revert ZeroAddress();
        if (capturedValue == 0) revert ZeroAmount();

        // Pull captured value tokens from caller
        _transferFrom(token, msg.sender, address(this), capturedValue);

        // Generate unique event ID
        eventId = keccak256(abi.encodePacked(batchId, adversary, eventType, block.timestamp));

        _events[eventId] = AdversarialEvent({
            eventId: eventId,
            batchId: batchId,
            adversary: adversary,
            eventType: eventType,
            capturedValue: capturedValue,
            timestamp: uint64(block.timestamp),
            distributed: false
        });

        _batchEvents[batchId].push(eventId);
        _adversaryTotals[adversary] += capturedValue;
        _stats.totalCaptured += capturedValue;
        _stats.eventCount++;

        emit AdversarialEventRecorded(eventId, batchId, adversary, eventType, capturedValue);
    }

    /// @inheritdoc IAdversarialSymbiosis
    function distributeStrengthening(bytes32 eventId) external nonReentrant {
        AdversarialEvent storage evt = _events[eventId];
        if (evt.eventId == bytes32(0)) revert EventNotFound();
        if (evt.distributed) revert AlreadyDistributed();

        evt.distributed = true;

        StrengtheningAllocation[] storage allocations = _allocations[evt.eventType];
        uint256 capturedValue = evt.capturedValue;
        uint256 totalDistributed;

        for (uint256 i; i < allocations.length; i++) {
            uint256 amount = (capturedValue * allocations[i].bps) / BPS_DENOMINATOR;

            // Last allocation gets remainder to avoid dust
            if (i == allocations.length - 1) {
                amount = capturedValue - totalDistributed;
            }

            address target = _resolveTarget(allocations[i].target);
            _transfer(token, target, amount);

            // Update per-target stats
            _updateTargetStats(allocations[i].target, amount);

            totalDistributed += amount;

            emit StrengtheningDistributed(eventId, allocations[i].target, amount);
        }

        _stats.totalDistributed += totalDistributed;
    }

    /// @inheritdoc IAdversarialSymbiosis
    function setAllocation(
        AdversarialType eventType,
        StrengtheningTarget[] calldata targets,
        uint16[] calldata bps
    ) external onlyOwner {
        if (targets.length != bps.length) revert ArrayLengthMismatch();
        if (targets.length == 0) revert InvalidAllocation();

        uint16 totalBps;
        for (uint256 i; i < bps.length; i++) {
            totalBps += bps[i];
        }
        if (totalBps != BPS_DENOMINATOR) revert InvalidAllocation();

        // Clear existing allocations
        delete _allocations[eventType];

        // Set new allocations
        for (uint256 i; i < targets.length; i++) {
            _allocations[eventType].push(StrengtheningAllocation({
                target: targets[i],
                bps: bps[i]
            }));
        }

        emit AllocationUpdated(eventType, targets, bps);
    }

    // ============ Admin ============

    function addRecorder(address recorder) external onlyOwner {
        if (recorder == address(0)) revert ZeroAddress();
        authorizedRecorders[recorder] = true;
    }

    function removeRecorder(address recorder) external onlyOwner {
        authorizedRecorders[recorder] = false;
    }

    function setTargetAddresses(
        address _insurancePool,
        address _traderRewardsPool,
        address _priceDiscoveryPool,
        address _protocolReserve
    ) external onlyOwner {
        if (
            _insurancePool == address(0) ||
            _traderRewardsPool == address(0) ||
            _priceDiscoveryPool == address(0) ||
            _protocolReserve == address(0)
        ) revert ZeroAddress();

        insurancePool = _insurancePool;
        traderRewardsPool = _traderRewardsPool;
        priceDiscoveryPool = _priceDiscoveryPool;
        protocolReserve = _protocolReserve;
    }

    function setTreasury(address _treasury) external onlyOwner {
        if (_treasury == address(0)) revert ZeroAddress();
        treasury = _treasury;
    }

    // ============ Views ============

    /// @inheritdoc IAdversarialSymbiosis
    function getAllocation(
        AdversarialType eventType
    ) external view returns (StrengtheningAllocation[] memory) {
        return _allocations[eventType];
    }

    /// @inheritdoc IAdversarialSymbiosis
    function getEvent(bytes32 eventId) external view returns (AdversarialEvent memory) {
        return _events[eventId];
    }

    /// @inheritdoc IAdversarialSymbiosis
    function getBatchEvents(uint64 batchId) external view returns (bytes32[] memory eventIds) {
        return _batchEvents[batchId];
    }

    /// @inheritdoc IAdversarialSymbiosis
    function getStats() external view returns (StrengtheningStats memory) {
        return _stats;
    }

    /// @inheritdoc IAdversarialSymbiosis
    function getAdversaryTotal(address adversary) external view returns (uint256) {
        return _adversaryTotals[adversary];
    }

    // ============ Internal ============

    /**
     * @notice Set default strengthening allocations for each adversarial event type.
     *         These encode the protocol's antifragile response: each attack type routes
     *         captured value to the subsystems it most directly threatened.
     */
    function _setDefaultAllocations() internal {
        // INVALID_REVEAL: 50% insurance, 30% trader rewards, 20% protocol reserve
        _allocations[AdversarialType.INVALID_REVEAL].push(
            StrengtheningAllocation(StrengtheningTarget.INSURANCE_POOL, 5000)
        );
        _allocations[AdversarialType.INVALID_REVEAL].push(
            StrengtheningAllocation(StrengtheningTarget.TRADER_REWARDS, 3000)
        );
        _allocations[AdversarialType.INVALID_REVEAL].push(
            StrengtheningAllocation(StrengtheningTarget.PROTOCOL_RESERVE, 2000)
        );

        // PRICE_MANIPULATION: 40% price discovery, 40% insurance, 20% protocol reserve
        _allocations[AdversarialType.PRICE_MANIPULATION].push(
            StrengtheningAllocation(StrengtheningTarget.PRICE_DISCOVERY, 4000)
        );
        _allocations[AdversarialType.PRICE_MANIPULATION].push(
            StrengtheningAllocation(StrengtheningTarget.INSURANCE_POOL, 4000)
        );
        _allocations[AdversarialType.PRICE_MANIPULATION].push(
            StrengtheningAllocation(StrengtheningTarget.PROTOCOL_RESERVE, 2000)
        );

        // FLASH_LOAN_ATTEMPT: 60% insurance, 40% protocol reserve
        _allocations[AdversarialType.FLASH_LOAN_ATTEMPT].push(
            StrengtheningAllocation(StrengtheningTarget.INSURANCE_POOL, 6000)
        );
        _allocations[AdversarialType.FLASH_LOAN_ATTEMPT].push(
            StrengtheningAllocation(StrengtheningTarget.PROTOCOL_RESERVE, 4000)
        );

        // SYBIL_DETECTED: 50% trader rewards, 30% insurance, 20% protocol reserve
        _allocations[AdversarialType.SYBIL_DETECTED].push(
            StrengtheningAllocation(StrengtheningTarget.TRADER_REWARDS, 5000)
        );
        _allocations[AdversarialType.SYBIL_DETECTED].push(
            StrengtheningAllocation(StrengtheningTarget.INSURANCE_POOL, 3000)
        );
        _allocations[AdversarialType.SYBIL_DETECTED].push(
            StrengtheningAllocation(StrengtheningTarget.PROTOCOL_RESERVE, 2000)
        );

        // COMMITMENT_BREACH: 40% insurance, 30% trader rewards, 30% protocol reserve
        _allocations[AdversarialType.COMMITMENT_BREACH].push(
            StrengtheningAllocation(StrengtheningTarget.INSURANCE_POOL, 4000)
        );
        _allocations[AdversarialType.COMMITMENT_BREACH].push(
            StrengtheningAllocation(StrengtheningTarget.TRADER_REWARDS, 3000)
        );
        _allocations[AdversarialType.COMMITMENT_BREACH].push(
            StrengtheningAllocation(StrengtheningTarget.PROTOCOL_RESERVE, 3000)
        );

        // GRIEFING: 50% protocol reserve, 30% insurance, 20% trader rewards
        _allocations[AdversarialType.GRIEFING].push(
            StrengtheningAllocation(StrengtheningTarget.PROTOCOL_RESERVE, 5000)
        );
        _allocations[AdversarialType.GRIEFING].push(
            StrengtheningAllocation(StrengtheningTarget.INSURANCE_POOL, 3000)
        );
        _allocations[AdversarialType.GRIEFING].push(
            StrengtheningAllocation(StrengtheningTarget.TRADER_REWARDS, 2000)
        );
    }

    /**
     * @notice Resolve a StrengtheningTarget enum to its configured pool address
     */
    function _resolveTarget(StrengtheningTarget target) internal view returns (address) {
        if (target == StrengtheningTarget.INSURANCE_POOL) return insurancePool;
        if (target == StrengtheningTarget.TRADER_REWARDS) return traderRewardsPool;
        if (target == StrengtheningTarget.PRICE_DISCOVERY) return priceDiscoveryPool;
        return protocolReserve; // PROTOCOL_RESERVE
    }

    /**
     * @notice Update per-target funding statistics
     */
    function _updateTargetStats(StrengtheningTarget target, uint256 amount) internal {
        if (target == StrengtheningTarget.INSURANCE_POOL) {
            _stats.insurancePoolFunded += amount;
        } else if (target == StrengtheningTarget.TRADER_REWARDS) {
            _stats.traderRewardsFunded += amount;
        } else if (target == StrengtheningTarget.PRICE_DISCOVERY) {
            _stats.priceDiscoveryFunded += amount;
        } else {
            _stats.protocolReserveFunded += amount;
        }
    }

    function _transfer(address _token, address to, uint256 amount) internal {
        (bool success, bytes memory data) = _token.call(
            abi.encodeWithSignature("transfer(address,uint256)", to, amount)
        );
        require(success && (data.length == 0 || abi.decode(data, (bool))), "Transfer failed");
    }

    function _transferFrom(address _token, address from, address to, uint256 amount) internal {
        (bool success, bytes memory data) = _token.call(
            abi.encodeWithSignature("transferFrom(address,address,uint256)", from, to, amount)
        );
        require(success && (data.length == 0 || abi.decode(data, (bool))), "TransferFrom failed");
    }
}
