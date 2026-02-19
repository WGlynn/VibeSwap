// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/**
 * @title IMerkleAirdrop
 * @notice Gas-efficient token distribution via Merkle proofs.
 *         Part of VSOS (VibeSwap Operating System) incentives layer.
 */
interface IMerkleAirdrop {
    // ============ Structs ============

    struct Distribution {
        address token;
        bytes32 merkleRoot;
        uint256 totalAmount;
        uint256 claimedAmount;
        uint256 deadline;
        bool active;
    }

    // ============ Events ============

    event DistributionCreated(
        uint256 indexed distributionId,
        address indexed token,
        bytes32 merkleRoot,
        uint256 totalAmount,
        uint256 deadline
    );
    event Claimed(
        uint256 indexed distributionId,
        address indexed account,
        uint256 amount
    );
    event DistributionDeactivated(uint256 indexed distributionId);
    event UnclaimedReclaimed(uint256 indexed distributionId, uint256 amount, address indexed to);
    event EmergencyRecovered(address indexed token, uint256 amount, address indexed to);

    // ============ Errors ============

    error ZeroAddress();
    error ZeroAmount();
    error InvalidMerkleRoot();
    error InvalidDeadline();
    error DistributionNotActive(uint256 id);
    error DistributionExpired(uint256 id);
    error DistributionNotExpired(uint256 id);
    error AlreadyClaimed(uint256 id, address account);
    error InvalidProof();
    error InsufficientFunding(uint256 required, uint256 available);

    // ============ Views ============

    function getDistribution(uint256 id) external view returns (Distribution memory);
    function distributionCount() external view returns (uint256);
    function isClaimed(uint256 distributionId, address account) external view returns (bool);

    // ============ Actions ============

    function createDistribution(
        address token,
        bytes32 merkleRoot,
        uint256 totalAmount,
        uint256 deadline
    ) external returns (uint256 distributionId);

    function claim(
        uint256 distributionId,
        address account,
        uint256 amount,
        bytes32[] calldata merkleProof
    ) external;

    function deactivateDistribution(uint256 distributionId) external;
    function reclaimUnclaimed(uint256 distributionId, address to) external;
    function emergencyRecover(address token, uint256 amount, address to) external;
}
