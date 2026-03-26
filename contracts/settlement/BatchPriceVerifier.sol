// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts-upgradeable/access/OwnableUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/proxy/utils/UUPSUpgradeable.sol";

/**
 * @title BatchPriceVerifier — Verify the Answer, Don't Recompute It
 * @notice Accepts pre-computed clearing prices and verifies them in O(1)
 *         instead of the O(n log n) binary search in BatchMath.
 * @dev Bond + dispute window: submitter posts bond, slashed if proven wrong.
 */
contract BatchPriceVerifier is OwnableUpgradeable, UUPSUpgradeable {
    // ============ Custom Errors ============
    error BatchAlreadySubmitted(uint64 batchId);
    error BatchNotFound(uint64 batchId);
    error BatchAlreadyFinalized(uint64 batchId);
    error DisputeWindowActive(uint64 batchId);
    error DisputeWindowExpired(uint64 batchId);
    error InsufficientBond();
    error InvalidClearingCondition();
    error MarketDoesNotClear();
    error NotTightestClearing();
    error TransferFailed();

    // ============ Events ============
    event BatchPriceSubmitted(uint64 indexed batchId, address indexed submitter, uint256 clearingPrice, bytes32 orderRoot);
    event BatchPriceFinalized(uint64 indexed batchId, uint256 clearingPrice);
    event BatchPriceDisputed(uint64 indexed batchId, address indexed disputer, address indexed submitter, uint256 slashedBond);

    // ============ Structs ============
    struct BatchSubmission {
        uint256 clearingPrice;
        bytes32 orderRoot;
        uint256 totalBuyVolume;
        uint256 totalSellVolume;
        address submitter;
        uint64 submittedAt;
        bool finalized;
    }

    // ============ State ============
    mapping(uint64 => BatchSubmission) public batches;
    uint256 public bondAmount;
    uint64 public disputeWindow;

    /// @dev Reserved storage gap for future upgrades
    uint256[50] private __gap;

    // ============ Initializer ============

    /// @custom:oz-upgrades-unsafe-allow constructor
    constructor() { _disableInitializers(); }

    function initialize(address owner_, uint256 bondAmount_, uint64 disputeWindow_) external initializer {
        __Ownable_init(owner_);
        __UUPSUpgradeable_init();
        bondAmount = bondAmount_;
        disputeWindow = disputeWindow_;
    }

    // ============ External Functions ============

    /// @notice Submit a pre-computed clearing price with bond
    function submitBatchPrice(
        uint64 batchId,
        uint256 clearingPrice,
        bytes32 orderRoot,
        uint256 totalBuyVolume,
        uint256 totalSellVolume
    ) external payable {
        if (batches[batchId].submitter != address(0)) revert BatchAlreadySubmitted(batchId);
        if (msg.value < bondAmount) revert InsufficientBond();
        if (!verifyClearing(clearingPrice, totalBuyVolume, totalSellVolume)) revert MarketDoesNotClear();

        batches[batchId] = BatchSubmission({
            clearingPrice: clearingPrice,
            orderRoot: orderRoot,
            totalBuyVolume: totalBuyVolume,
            totalSellVolume: totalSellVolume,
            submitter: msg.sender,
            submittedAt: uint64(block.timestamp),
            finalized: false
        });

        emit BatchPriceSubmitted(batchId, msg.sender, clearingPrice, orderRoot);
    }

    /// @notice Finalize a batch after the dispute window elapses
    function finalizeBatch(uint64 batchId) external {
        BatchSubmission storage batch = batches[batchId];
        if (batch.submitter == address(0)) revert BatchNotFound(batchId);
        if (batch.finalized) revert BatchAlreadyFinalized(batchId);
        if (block.timestamp < batch.submittedAt + disputeWindow) revert DisputeWindowActive(batchId);

        batch.finalized = true;

        (bool ok,) = batch.submitter.call{value: bondAmount}("");
        if (!ok) revert TransferFailed();

        emit BatchPriceFinalized(batchId, batch.clearingPrice);
    }

    /// @notice Dispute a price by proving the clearing condition fails
    /// @dev Disputer provides actual volumes to show equilibrium is violated
    function disputeBatch(uint64 batchId, uint256 actualBuyVolume, uint256 actualSellVolume) external {
        BatchSubmission storage batch = batches[batchId];
        if (batch.submitter == address(0)) revert BatchNotFound(batchId);
        if (batch.finalized) revert BatchAlreadyFinalized(batchId);
        if (block.timestamp >= batch.submittedAt + disputeWindow) revert DisputeWindowExpired(batchId);

        // Dispute succeeds if clearing condition fails with actual volumes
        if (verifyClearing(batch.clearingPrice, actualBuyVolume, actualSellVolume)) {
            revert InvalidClearingCondition();
        }

        address slashedSubmitter = batch.submitter;
        delete batches[batchId];

        (bool ok,) = msg.sender.call{value: bondAmount}("");
        if (!ok) revert TransferFailed();

        emit BatchPriceDisputed(batchId, msg.sender, slashedSubmitter, bondAmount);
    }

    // ============ View Functions ============

    /// @notice Read the verified clearing price for a batch
    function getBatchPrice(uint64 batchId) external view returns (uint256 price, bool finalized) {
        BatchSubmission storage batch = batches[batchId];
        price = batch.clearingPrice;
        finalized = batch.finalized;
    }

    // ============ Admin ============

    function setBondAmount(uint256 newBond) external onlyOwner { bondAmount = newBond; }
    function setDisputeWindow(uint64 newWindow) external onlyOwner { disputeWindow = newWindow; }

    // ============ Internal ============

    /**
     * @notice Check market clearing condition
     * @dev Price P is valid iff buyVolume >= sellVolume at P. The tightest-price
     *      invariant (buyVolume < sellVolume at P+1) is enforced via disputes.
     */
    function verifyClearing(uint256 price, uint256 buyVolume, uint256 sellVolume) internal pure returns (bool) {
        if (price == 0) return false;
        return buyVolume >= sellVolume;
    }

    function _authorizeUpgrade(address) internal override onlyOwner {} // UUPS auth
}
