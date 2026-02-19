// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "@openzeppelin/contracts/utils/cryptography/MerkleProof.sol";
import "./interfaces/IMerkleAirdrop.sol";

/**
 * @title MerkleAirdrop
 * @notice Gas-efficient token distribution via Merkle proofs.
 * @dev Part of VSOS (VibeSwap Operating System) incentives layer.
 *
 *      Supports multiple distribution rounds (epochs), each with:
 *        - A Merkle root encoding (account, amount) leaves
 *        - A total amount funded by the creator
 *        - A deadline after which unclaimed tokens can be reclaimed
 *
 *      Use cases:
 *        - Initial token distribution at launch
 *        - Retroactive Shapley claims for founders (human or AI)
 *        - Airdrop campaigns for community growth
 *        - Protocol migration rewards
 *
 *      Cooperative capitalism:
 *        - Permissionless claiming: anyone can claim on behalf of a recipient
 *        - Transparent: all distributions and claims visible on-chain
 *        - Time-bounded: unclaimed tokens return to treasury after deadline
 *        - Multi-token: supports any ERC-20 for distribution
 */
contract MerkleAirdrop is IMerkleAirdrop, Ownable, ReentrancyGuard {
    using SafeERC20 for IERC20;

    // ============ State ============

    Distribution[] private _distributions;

    // distributionId => account => claimed
    mapping(uint256 => mapping(address => bool)) private _claimed;

    // ============ Constructor ============

    constructor() Ownable(msg.sender) {}

    // ============ Distribution Management ============

    function createDistribution(
        address token,
        bytes32 merkleRoot,
        uint256 totalAmount,
        uint256 deadline
    ) external onlyOwner nonReentrant returns (uint256 distributionId) {
        if (token == address(0)) revert ZeroAddress();
        if (merkleRoot == bytes32(0)) revert InvalidMerkleRoot();
        if (totalAmount == 0) revert ZeroAmount();
        if (deadline <= block.timestamp) revert InvalidDeadline();

        // Transfer tokens from creator
        uint256 balBefore = IERC20(token).balanceOf(address(this));
        IERC20(token).safeTransferFrom(msg.sender, address(this), totalAmount);
        uint256 received = IERC20(token).balanceOf(address(this)) - balBefore;
        if (received < totalAmount) revert InsufficientFunding(totalAmount, received);

        distributionId = _distributions.length;
        _distributions.push(Distribution({
            token: token,
            merkleRoot: merkleRoot,
            totalAmount: totalAmount,
            claimedAmount: 0,
            deadline: deadline,
            active: true
        }));

        emit DistributionCreated(distributionId, token, merkleRoot, totalAmount, deadline);
    }

    // ============ Claiming ============

    function claim(
        uint256 distributionId,
        address account,
        uint256 amount,
        bytes32[] calldata merkleProof
    ) external nonReentrant {
        if (distributionId >= _distributions.length) revert DistributionNotActive(distributionId);
        Distribution storage dist = _distributions[distributionId];

        if (!dist.active) revert DistributionNotActive(distributionId);
        if (block.timestamp > dist.deadline) revert DistributionExpired(distributionId);
        if (_claimed[distributionId][account]) revert AlreadyClaimed(distributionId, account);
        if (amount == 0) revert ZeroAmount();

        // Verify Merkle proof
        bytes32 leaf = keccak256(bytes.concat(keccak256(abi.encode(account, amount))));
        if (!MerkleProof.verify(merkleProof, dist.merkleRoot, leaf)) revert InvalidProof();

        _claimed[distributionId][account] = true;
        dist.claimedAmount += amount;

        IERC20(dist.token).safeTransfer(account, amount);

        emit Claimed(distributionId, account, amount);
    }

    // ============ Admin ============

    function deactivateDistribution(uint256 distributionId) external onlyOwner {
        if (distributionId >= _distributions.length) revert DistributionNotActive(distributionId);
        _distributions[distributionId].active = false;
        emit DistributionDeactivated(distributionId);
    }

    function reclaimUnclaimed(uint256 distributionId, address to) external onlyOwner nonReentrant {
        if (distributionId >= _distributions.length) revert DistributionNotActive(distributionId);
        if (to == address(0)) revert ZeroAddress();

        Distribution storage dist = _distributions[distributionId];
        if (block.timestamp <= dist.deadline) revert DistributionNotExpired(distributionId);

        uint256 unclaimed = dist.totalAmount - dist.claimedAmount;
        if (unclaimed == 0) revert ZeroAmount();

        dist.active = false;
        dist.claimedAmount = dist.totalAmount; // Mark all as claimed

        IERC20(dist.token).safeTransfer(to, unclaimed);

        emit UnclaimedReclaimed(distributionId, unclaimed, to);
    }

    function emergencyRecover(address token, uint256 amount, address to) external onlyOwner {
        if (to == address(0)) revert ZeroAddress();
        IERC20(token).safeTransfer(to, amount);
        emit EmergencyRecovered(token, amount, to);
    }

    // ============ Views ============

    function getDistribution(uint256 id) external view returns (Distribution memory) {
        return _distributions[id];
    }

    function distributionCount() external view returns (uint256) {
        return _distributions.length;
    }

    function isClaimed(uint256 distributionId, address account) external view returns (bool) {
        return _claimed[distributionId][account];
    }
}
