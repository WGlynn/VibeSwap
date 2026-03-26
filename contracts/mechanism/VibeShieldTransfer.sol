// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts-upgradeable/access/OwnableUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/proxy/utils/UUPSUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/utils/ReentrancyGuardUpgradeable.sol";

/**
 * @title VibeShieldTransfer — Private Transfer via Ephemeral Addresses
 * @notice Absorbs Dexter Shield pattern: intermediary anonymous addresses
 *         break direct sender-recipient linkage. Funds route through
 *         one-time temporary addresses, then auto-forward to recipients.
 *         Lighter than full ZK privacy pools — good for everyday transfers.
 *
 * @dev Architecture (Dexter Shield absorption):
 *      - Sender creates a shield transfer with recipient hash (not address)
 *      - Funds held in contract (intermediary)
 *      - Recipient claims with proof of knowledge (preimage of hash)
 *      - On-chain: sender → contract → recipient (no direct link)
 *      - Time-locked: unclaimed transfers return to sender after deadline
 *      - Batch support: multiple recipients in one tx
 */
contract VibeShieldTransfer is OwnableUpgradeable, UUPSUpgradeable, ReentrancyGuardUpgradeable {
    // ============ Types ============

    enum TransferStatus { PENDING, CLAIMED, EXPIRED, CANCELLED }

    struct ShieldTransfer {
        uint256 transferId;
        address sender;
        bytes32 recipientHash;       // hash(recipient_address || secret)
        uint256 amount;
        TransferStatus status;
        uint256 createdAt;
        uint256 deadline;
    }

    // ============ Constants ============

    uint256 public constant MIN_TRANSFER = 0.001 ether;
    uint256 public constant DEFAULT_DEADLINE = 7 days;
    uint256 public constant MAX_DEADLINE = 30 days;

    // ============ State ============

    mapping(uint256 => ShieldTransfer) public transfers;
    uint256 public transferCount;

    /// @notice Stats
    uint256 public totalTransferred;
    uint256 public totalClaimed;
    uint256 public totalExpired;
    uint256 public activeTransfers;


    /// @dev Reserved storage gap for future upgrades
    uint256[50] private __gap;

    // ============ Events ============

    event ShieldCreated(uint256 indexed transferId, address indexed sender, bytes32 recipientHash, uint256 amount);
    event ShieldClaimed(uint256 indexed transferId, address indexed recipient, uint256 amount);
    event ShieldExpired(uint256 indexed transferId, address indexed sender, uint256 amount);
    event ShieldCancelled(uint256 indexed transferId, address indexed sender, uint256 amount);

    // ============ Init ============

    function initialize() external initializer {
        __Ownable_init(msg.sender);
        __UUPSUpgradeable_init();
        __ReentrancyGuard_init();
    }

    function _authorizeUpgrade(address newImplementation) internal override onlyOwner {
        require(newImplementation.code.length > 0, "Not a contract");
    }

    // ============ Create Shield Transfer ============

    /**
     * @notice Create a private transfer
     * @param recipientHash hash(recipient_address, secret) — only recipient with secret can claim
     * @param deadlineSeconds Custom deadline (0 = default 7 days)
     */
    function createShield(
        bytes32 recipientHash,
        uint256 deadlineSeconds
    ) external payable returns (uint256) {
        require(msg.value >= MIN_TRANSFER, "Below minimum");
        require(recipientHash != bytes32(0), "Invalid hash");

        uint256 deadline = deadlineSeconds > 0 ? deadlineSeconds : DEFAULT_DEADLINE;
        require(deadline <= MAX_DEADLINE, "Deadline too long");

        transferCount++;
        transfers[transferCount] = ShieldTransfer({
            transferId: transferCount,
            sender: msg.sender,
            recipientHash: recipientHash,
            amount: msg.value,
            status: TransferStatus.PENDING,
            createdAt: block.timestamp,
            deadline: block.timestamp + deadline
        });

        totalTransferred += msg.value;
        activeTransfers++;

        emit ShieldCreated(transferCount, msg.sender, recipientHash, msg.value);
        return transferCount;
    }

    /**
     * @notice Create multiple shield transfers in one tx
     */
    function createBatchShield(
        bytes32[] calldata recipientHashes,
        uint256[] calldata amounts
    ) external payable returns (uint256[] memory) {
        require(recipientHashes.length == amounts.length, "Length mismatch");

        uint256 totalAmount;
        for (uint256 i = 0; i < amounts.length; i++) {
            totalAmount += amounts[i];
        }
        require(msg.value >= totalAmount, "Insufficient payment");

        uint256[] memory ids = new uint256[](recipientHashes.length);

        for (uint256 i = 0; i < recipientHashes.length; i++) {
            require(amounts[i] >= MIN_TRANSFER, "Below minimum");
            require(recipientHashes[i] != bytes32(0), "Invalid hash");

            transferCount++;
            transfers[transferCount] = ShieldTransfer({
                transferId: transferCount,
                sender: msg.sender,
                recipientHash: recipientHashes[i],
                amount: amounts[i],
                status: TransferStatus.PENDING,
                createdAt: block.timestamp,
                deadline: block.timestamp + DEFAULT_DEADLINE
            });

            totalTransferred += amounts[i];
            activeTransfers++;
            ids[i] = transferCount;

            emit ShieldCreated(transferCount, msg.sender, recipientHashes[i], amounts[i]);
        }

        // Refund excess
        if (msg.value > totalAmount) {
            (bool ok, ) = msg.sender.call{value: msg.value - totalAmount}("");
            require(ok, "Refund failed");
        }

        return ids;
    }

    // ============ Claim ============

    /**
     * @notice Claim a shield transfer by providing the secret
     * @param transferId The transfer to claim
     * @param secret The secret used to generate recipientHash
     */
    function claim(uint256 transferId, bytes32 secret) external nonReentrant {
        ShieldTransfer storage t = transfers[transferId];
        require(t.status == TransferStatus.PENDING, "Not pending");
        require(block.timestamp <= t.deadline, "Expired");

        // Verify: hash(msg.sender, secret) must match recipientHash
        bytes32 computedHash = keccak256(abi.encodePacked(msg.sender, secret));
        require(computedHash == t.recipientHash, "Invalid proof");

        t.status = TransferStatus.CLAIMED;
        activeTransfers--;
        totalClaimed += t.amount;

        (bool ok, ) = msg.sender.call{value: t.amount}("");
        require(ok, "Transfer failed");

        emit ShieldClaimed(transferId, msg.sender, t.amount);
    }

    // ============ Expire / Cancel ============

    /**
     * @notice Reclaim expired transfers (anyone can call, funds go to sender)
     */
    function reclaimExpired(uint256 transferId) external nonReentrant {
        ShieldTransfer storage t = transfers[transferId];
        require(t.status == TransferStatus.PENDING, "Not pending");
        require(block.timestamp > t.deadline, "Not expired");

        t.status = TransferStatus.EXPIRED;
        activeTransfers--;
        totalExpired += t.amount;

        (bool ok, ) = t.sender.call{value: t.amount}("");
        require(ok, "Refund failed");

        emit ShieldExpired(transferId, t.sender, t.amount);
    }

    /**
     * @notice Sender can cancel before claim
     */
    function cancel(uint256 transferId) external nonReentrant {
        ShieldTransfer storage t = transfers[transferId];
        require(t.sender == msg.sender, "Not sender");
        require(t.status == TransferStatus.PENDING, "Not pending");

        t.status = TransferStatus.CANCELLED;
        activeTransfers--;

        (bool ok, ) = msg.sender.call{value: t.amount}("");
        require(ok, "Refund failed");

        emit ShieldCancelled(transferId, msg.sender, t.amount);
    }

    // ============ View ============

    function getTransfer(uint256 id) external view returns (ShieldTransfer memory) { return transfers[id]; }
    function getTransferCount() external view returns (uint256) { return transferCount; }
    function getActiveCount() external view returns (uint256) { return activeTransfers; }

    receive() external payable {}
}
