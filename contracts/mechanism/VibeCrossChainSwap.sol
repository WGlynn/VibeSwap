// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts-upgradeable/access/OwnableUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/proxy/utils/UUPSUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/utils/ReentrancyGuardUpgradeable.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

/**
 * @title VibeCrossChainSwap — Atomic Cross-Chain Swaps
 * @notice Hash Time-Locked Contracts (HTLC) for trustless cross-chain token swaps.
 *         No bridge required — atomic swap or full refund guaranteed.
 *
 * @dev Architecture:
 *      - Initiator locks tokens with hash lock and time lock
 *      - Counterparty locks tokens on other chain with same hash
 *      - Either party reveals preimage to claim, or timeout refunds
 *      - Integration with VibeBridge for hybrid routing
 */
contract VibeCrossChainSwap is OwnableUpgradeable, UUPSUpgradeable, ReentrancyGuardUpgradeable {
    using SafeERC20 for IERC20;

    // ============ Constants ============

    uint256 public constant MIN_LOCK_TIME = 1 hours;
    uint256 public constant MAX_LOCK_TIME = 48 hours;

    // ============ Types ============

    enum SwapState { PENDING, CLAIMED, REFUNDED, EXPIRED }

    struct AtomicSwap {
        bytes32 swapId;
        address initiator;
        address counterparty;
        address token;             // address(0) for ETH
        uint256 amount;
        bytes32 hashLock;          // hash of the secret preimage
        uint256 timelock;          // Expiration timestamp
        uint256 srcChainId;
        uint256 dstChainId;
        SwapState state;
        bytes32 preimage;          // Revealed on claim
    }

    // ============ State ============

    mapping(bytes32 => AtomicSwap) public swaps;
    uint256 public swapCount;

    /// @notice User's swaps
    mapping(address => bytes32[]) public userSwaps;

    /// @notice Fee (basis points)
    uint256 public feeBps;
    address public feeRecipient;

    /// @notice Stats
    uint256 public totalVolume;
    uint256 public totalSwapsCompleted;
    uint256 public totalSwapsRefunded;

    // ============ Events ============

    event SwapInitiated(bytes32 indexed swapId, address indexed initiator, address counterparty, uint256 amount, bytes32 hashLock);
    event SwapClaimed(bytes32 indexed swapId, address indexed claimer, bytes32 preimage);
    event SwapRefunded(bytes32 indexed swapId, address indexed initiator);

    // ============ Init ============

    function initialize(address _feeRecipient) external initializer {
        __Ownable_init(msg.sender);
        __UUPSUpgradeable_init();
        __ReentrancyGuard_init();
        feeRecipient = _feeRecipient;
        feeBps = 10; // 0.1%
    }

    function _authorizeUpgrade(address) internal override onlyOwner {}

    // ============ Swap Lifecycle ============

    /**
     * @notice Initiate an atomic swap (ETH)
     */
    function initiateETHSwap(
        address counterparty,
        bytes32 hashLock,
        uint256 lockDuration,
        uint256 dstChainId
    ) external payable nonReentrant returns (bytes32) {
        require(msg.value > 0, "Zero amount");
        require(counterparty != address(0), "Zero counterparty");
        require(lockDuration >= MIN_LOCK_TIME && lockDuration <= MAX_LOCK_TIME, "Invalid lock time");

        bytes32 swapId = keccak256(abi.encodePacked(
            msg.sender, counterparty, msg.value, hashLock, block.timestamp
        ));

        swaps[swapId] = AtomicSwap({
            swapId: swapId,
            initiator: msg.sender,
            counterparty: counterparty,
            token: address(0),
            amount: msg.value,
            hashLock: hashLock,
            timelock: block.timestamp + lockDuration,
            srcChainId: block.chainid,
            dstChainId: dstChainId,
            state: SwapState.PENDING,
            preimage: bytes32(0)
        });

        swapCount++;
        userSwaps[msg.sender].push(swapId);
        userSwaps[counterparty].push(swapId);

        emit SwapInitiated(swapId, msg.sender, counterparty, msg.value, hashLock);
        return swapId;
    }

    /**
     * @notice Initiate an atomic swap (ERC20)
     */
    function initiateTokenSwap(
        address counterparty,
        address token,
        uint256 amount,
        bytes32 hashLock,
        uint256 lockDuration,
        uint256 dstChainId
    ) external nonReentrant returns (bytes32) {
        require(amount > 0, "Zero amount");
        require(counterparty != address(0), "Zero counterparty");
        require(lockDuration >= MIN_LOCK_TIME && lockDuration <= MAX_LOCK_TIME, "Invalid lock time");

        IERC20(token).safeTransferFrom(msg.sender, address(this), amount);

        bytes32 swapId = keccak256(abi.encodePacked(
            msg.sender, counterparty, amount, hashLock, block.timestamp
        ));

        swaps[swapId] = AtomicSwap({
            swapId: swapId,
            initiator: msg.sender,
            counterparty: counterparty,
            token: token,
            amount: amount,
            hashLock: hashLock,
            timelock: block.timestamp + lockDuration,
            srcChainId: block.chainid,
            dstChainId: dstChainId,
            state: SwapState.PENDING,
            preimage: bytes32(0)
        });

        swapCount++;
        userSwaps[msg.sender].push(swapId);
        userSwaps[counterparty].push(swapId);

        emit SwapInitiated(swapId, msg.sender, counterparty, amount, hashLock);
        return swapId;
    }

    /**
     * @notice Claim a swap by revealing the preimage
     */
    function claim(bytes32 swapId, bytes32 preimage) external nonReentrant {
        AtomicSwap storage swap = swaps[swapId];
        require(swap.state == SwapState.PENDING, "Not pending");
        require(swap.counterparty == msg.sender, "Not counterparty");
        require(block.timestamp < swap.timelock, "Expired");
        require(keccak256(abi.encodePacked(preimage)) == swap.hashLock, "Invalid preimage");

        swap.state = SwapState.CLAIMED;
        swap.preimage = preimage;
        totalSwapsCompleted++;

        uint256 fee = (swap.amount * feeBps) / 10000;
        uint256 payout = swap.amount - fee;

        if (swap.token == address(0)) {
            (bool ok, ) = msg.sender.call{value: payout}("");
            require(ok, "Claim transfer failed");
            if (fee > 0) {
                (bool ok2, ) = feeRecipient.call{value: fee}("");
                require(ok2, "Fee transfer failed");
            }
        } else {
            IERC20(swap.token).safeTransfer(msg.sender, payout);
            if (fee > 0) {
                IERC20(swap.token).safeTransfer(feeRecipient, fee);
            }
        }

        totalVolume += swap.amount;
        emit SwapClaimed(swapId, msg.sender, preimage);
    }

    /**
     * @notice Refund after timelock expires
     */
    function refund(bytes32 swapId) external nonReentrant {
        AtomicSwap storage swap = swaps[swapId];
        require(swap.state == SwapState.PENDING, "Not pending");
        require(swap.initiator == msg.sender, "Not initiator");
        require(block.timestamp >= swap.timelock, "Not expired");

        swap.state = SwapState.REFUNDED;
        totalSwapsRefunded++;

        if (swap.token == address(0)) {
            (bool ok, ) = msg.sender.call{value: swap.amount}("");
            require(ok, "Refund failed");
        } else {
            IERC20(swap.token).safeTransfer(msg.sender, swap.amount);
        }

        emit SwapRefunded(swapId, msg.sender);
    }

    // ============ Admin ============

    function setFee(uint256 _feeBps) external onlyOwner {
        require(_feeBps <= 100, "Max 1%");
        feeBps = _feeBps;
    }

    // ============ View ============

    function getSwap(bytes32 swapId) external view returns (AtomicSwap memory) {
        return swaps[swapId];
    }

    function getUserSwaps(address user) external view returns (bytes32[] memory) {
        return userSwaps[user];
    }

    function getSwapState(bytes32 swapId) external view returns (SwapState) {
        AtomicSwap storage swap = swaps[swapId];
        if (swap.state == SwapState.PENDING && block.timestamp >= swap.timelock) {
            return SwapState.EXPIRED;
        }
        return swap.state;
    }

    receive() external payable {}
}
