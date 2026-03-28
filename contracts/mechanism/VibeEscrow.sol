// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts-upgradeable/access/OwnableUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/proxy/utils/UUPSUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/utils/ReentrancyGuardUpgradeable.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

/**
 * @title VibeEscrow — Generalized Escrow Service
 * @notice Trustless escrow for P2P trades, freelance payments,
 *         milestone-based funding, and dispute resolution.
 */
contract VibeEscrow is OwnableUpgradeable, UUPSUpgradeable, ReentrancyGuardUpgradeable {
    using SafeERC20 for IERC20;

    // ============ Types ============

    enum EscrowStatus { CREATED, FUNDED, RELEASED, DISPUTED, RESOLVED, REFUNDED, EXPIRED }

    struct Escrow {
        uint256 escrowId;
        address depositor;
        address beneficiary;
        address arbiter;          // Dispute resolver (can be DAO)
        address token;            // address(0) = ETH
        uint256 amount;
        string description;
        uint256 createdAt;
        uint256 expiresAt;
        EscrowStatus status;
        uint256 milestoneCount;
        uint256 milestonesCompleted;
    }

    struct Milestone {
        string description;
        uint256 amount;
        bool completed;
        bool approved;
    }

    // ============ State ============

    mapping(uint256 => Escrow) internal escrows;
    uint256 public escrowCount;

    /// @notice Milestones: escrowId => index => milestone
    mapping(uint256 => mapping(uint256 => Milestone)) internal milestones;

    /// @notice Platform fee (basis points)
    uint256 public feeBps;
    address public feeRecipient;

    uint256 public totalEscrowVolume;
    uint256 public activeEscrowCount;


    /// @dev Reserved storage gap for future upgrades
    uint256[50] private __gap;

    // ============ Events ============

    event EscrowCreated(uint256 indexed escrowId, address indexed depositor, address indexed beneficiary, uint256 amount);
    event EscrowFunded(uint256 indexed escrowId, uint256 amount);
    event MilestoneCompleted(uint256 indexed escrowId, uint256 milestoneIndex);
    event MilestoneApproved(uint256 indexed escrowId, uint256 milestoneIndex, uint256 amount);
    event EscrowReleased(uint256 indexed escrowId, uint256 amount);
    event EscrowDisputed(uint256 indexed escrowId, address disputant);
    event EscrowResolved(uint256 indexed escrowId, uint256 depositorShare, uint256 beneficiaryShare);
    event EscrowRefunded(uint256 indexed escrowId, uint256 amount);

    // ============ Init ============

    function initialize(address _feeRecipient) external initializer {
        __Ownable_init(msg.sender);
        __UUPSUpgradeable_init();
        __ReentrancyGuard_init();
        feeRecipient = _feeRecipient;
        feeBps = 100; // 1%
    }

    function _authorizeUpgrade(address newImplementation) internal override onlyOwner {
        require(newImplementation.code.length > 0, "Not a contract");
    }

    // ============ Escrow Lifecycle ============

    function createEscrow(
        address beneficiary,
        address arbiter,
        address token,
        uint256 amount,
        string calldata description,
        uint256 duration,
        string[] calldata milestoneDescs,
        uint256[] calldata milestoneAmounts
    ) external payable nonReentrant returns (uint256) {
        require(beneficiary != address(0), "Zero beneficiary");
        if (milestoneDescs.length > 0) {
            require(milestoneDescs.length == milestoneAmounts.length, "Mismatch");
            uint256 total;
            for (uint256 i = 0; i < milestoneAmounts.length; i++) total += milestoneAmounts[i];
            require(total == amount, "Milestones must sum to amount");
        }

        escrowCount++;
        Escrow storage esc = escrows[escrowCount];
        esc.escrowId = escrowCount;
        esc.depositor = msg.sender;
        esc.beneficiary = beneficiary;
        esc.arbiter = arbiter;
        esc.token = token;
        esc.amount = amount;
        esc.description = description;
        esc.createdAt = block.timestamp;
        esc.expiresAt = duration > 0 ? block.timestamp + duration : type(uint256).max;
        esc.milestoneCount = milestoneDescs.length;

        // Setup milestones
        for (uint256 i = 0; i < milestoneDescs.length; i++) {
            milestones[escrowCount][i] = Milestone({
                description: milestoneDescs[i],
                amount: milestoneAmounts[i],
                completed: false,
                approved: false
            });
        }

        // Fund escrow
        if (token == address(0)) {
            require(msg.value >= amount, "Insufficient ETH");
            esc.status = EscrowStatus.FUNDED;
        } else {
            IERC20(token).safeTransferFrom(msg.sender, address(this), amount);
            esc.status = EscrowStatus.FUNDED;
        }

        activeEscrowCount++;
        totalEscrowVolume += amount;

        emit EscrowCreated(escrowCount, msg.sender, beneficiary, amount);
        emit EscrowFunded(escrowCount, amount);
        return escrowCount;
    }

    function completeMilestone(uint256 escrowId, uint256 index) external {
        require(escrows[escrowId].beneficiary == msg.sender, "Not beneficiary");
        milestones[escrowId][index].completed = true;
        emit MilestoneCompleted(escrowId, index);
    }

    function approveMilestone(uint256 escrowId, uint256 index) external nonReentrant {
        Escrow storage esc = escrows[escrowId];
        require(esc.depositor == msg.sender, "Not depositor");
        require(milestones[escrowId][index].completed, "Not completed");
        require(!milestones[escrowId][index].approved, "Already approved");

        milestones[escrowId][index].approved = true;
        esc.milestonesCompleted++;

        uint256 payout = milestones[escrowId][index].amount;
        uint256 fee = (payout * feeBps) / 10000;
        uint256 net = payout - fee;

        _transfer(esc.token, esc.beneficiary, net);
        if (fee > 0) _transfer(esc.token, feeRecipient, fee);

        emit MilestoneApproved(escrowId, index, payout);

        if (esc.milestonesCompleted == esc.milestoneCount) {
            esc.status = EscrowStatus.RELEASED;
            activeEscrowCount--;
        }
    }

    function releaseAll(uint256 escrowId) external nonReentrant {
        Escrow storage esc = escrows[escrowId];
        require(esc.depositor == msg.sender, "Not depositor");
        require(esc.status == EscrowStatus.FUNDED, "Not funded");

        esc.status = EscrowStatus.RELEASED;
        activeEscrowCount--;

        uint256 fee = (esc.amount * feeBps) / 10000;
        uint256 net = esc.amount - fee;

        _transfer(esc.token, esc.beneficiary, net);
        if (fee > 0) _transfer(esc.token, feeRecipient, fee);

        emit EscrowReleased(escrowId, esc.amount);
    }

    function dispute(uint256 escrowId) external {
        Escrow storage esc = escrows[escrowId];
        require(msg.sender == esc.depositor || msg.sender == esc.beneficiary, "Not party");
        require(esc.status == EscrowStatus.FUNDED, "Not funded");

        esc.status = EscrowStatus.DISPUTED;
        emit EscrowDisputed(escrowId, msg.sender);
    }

    function resolveDispute(uint256 escrowId, uint256 depositorBps) external nonReentrant {
        Escrow storage esc = escrows[escrowId];
        require(msg.sender == esc.arbiter, "Not arbiter");
        require(esc.status == EscrowStatus.DISPUTED, "Not disputed");
        require(depositorBps <= 10000, "Invalid split");

        esc.status = EscrowStatus.RESOLVED;
        activeEscrowCount--;

        uint256 depositorShare = (esc.amount * depositorBps) / 10000;
        uint256 beneficiaryShare = esc.amount - depositorShare;

        if (depositorShare > 0) _transfer(esc.token, esc.depositor, depositorShare);
        if (beneficiaryShare > 0) _transfer(esc.token, esc.beneficiary, beneficiaryShare);

        emit EscrowResolved(escrowId, depositorShare, beneficiaryShare);
    }

    function refundExpired(uint256 escrowId) external nonReentrant {
        Escrow storage esc = escrows[escrowId];
        require(block.timestamp > esc.expiresAt, "Not expired");
        require(esc.status == EscrowStatus.FUNDED, "Not funded");

        esc.status = EscrowStatus.REFUNDED;
        activeEscrowCount--;

        _transfer(esc.token, esc.depositor, esc.amount);
        emit EscrowRefunded(escrowId, esc.amount);
    }

    // ============ Internal ============

    function _transfer(address token, address to, uint256 amount) internal {
        if (token == address(0)) {
            (bool ok, ) = to.call{value: amount}("");
            require(ok, "Transfer failed");
        } else {
            IERC20(token).safeTransfer(to, amount);
        }
    }

    // ============ View ============

    function getEscrowCount() external view returns (uint256) { return escrowCount; }
    function getActiveCount() external view returns (uint256) { return activeEscrowCount; }
    function getEscrow(uint256 id) external view returns (Escrow memory) { return escrows[id]; }
    function getMilestone(uint256 id, uint256 idx) external view returns (Milestone memory) { return milestones[id][idx]; }

    receive() external payable {}
}
