// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts-upgradeable/access/OwnableUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/proxy/utils/UUPSUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/utils/ReentrancyGuardUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/utils/PausableUpgradeable.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

/**
 * @title ForkRegistry
 * @notice Fractal Fork Network — forks are children, not enemies.
 *         Implements DAG-based fork registration with 50/50 fee routing
 *         and geometric decay for deep forks. Reconvergence allows forks
 *         to merge back into their parent when state hashes align.
 * @dev Part of the VibeSwap Operating System (VSOS).
 *      "A fractal black hole of information."
 */
contract ForkRegistry is
    OwnableUpgradeable,
    UUPSUpgradeable,
    ReentrancyGuardUpgradeable,
    PausableUpgradeable
{
    using SafeERC20 for IERC20;

    // ============ Constants ============

    /// @notice Fee share is always 50% (5000 bps)
    uint256 public constant FEE_SHARE_BPS = 5000;

    /// @notice Basis points precision
    uint256 public constant BPS_PRECISION = 10000;

    /// @notice Maximum fork depth to prevent gas exhaustion during fee routing
    uint8 public constant MAX_DEPTH = 16;

    /// @notice Reconvergence window — state hashes must match for 7 days
    uint256 public constant RECONVERGENCE_WINDOW = 7 days;

    // ============ Types ============

    struct Fork {
        bytes32 forkId;
        address forkAddress;        // The forked protocol's main contract
        address parentAddress;      // Parent protocol (root or another fork)
        bytes32 parentForkId;       // Parent's fork ID (bytes32(0) for root children)
        uint256 feeShareBps;        // Always 5000 (50%)
        uint256 registeredAt;
        bytes32 stateHash;          // Latest state commitment
        uint256 lastStateUpdate;
        uint256 totalFeesRouted;    // Total fees sent to parent (ETH)
        uint256 totalFeesReceived;  // Total fees received from children (ETH)
        bool active;
        uint8 depth;                // Distance from root (0 = direct child)
    }

    struct ReconvergenceRequest {
        bytes32 forkId;
        bytes32 matchedStateHash;
        uint256 initiatedAt;
        bool executed;
    }

    // ============ State ============

    /// @notice The root protocol address (VibeSwap)
    address public rootAddress;

    /// @notice Root protocol state hash
    bytes32 public rootStateHash;

    /// @notice Total number of registered forks
    uint256 public _forkCount;

    /// @notice Fork data by forkId
    mapping(bytes32 => Fork) public forks;

    /// @notice Lookup forkId by fork contract address
    mapping(address => bytes32) public forkIdByAddress;

    /// @notice Children of a given address (root or fork)
    mapping(address => bytes32[]) public childrenOf;

    /// @notice Reconvergence requests by forkId
    mapping(bytes32 => ReconvergenceRequest) public reconvergenceRequests;

    /// @notice Nonce for generating unique fork IDs
    uint256 private _nonce;


    /// @dev Reserved storage gap for future upgrades
    uint256[50] private __gap;

    // ============ Events ============

    event ForkRegistered(
        bytes32 indexed forkId,
        address indexed forkAddress,
        address indexed parentAddress,
        uint8 depth
    );

    event FeesRouted(
        bytes32 indexed forkId,
        address indexed parentAddress,
        uint256 amount
    );

    event FeesRoutedToken(
        bytes32 indexed forkId,
        address indexed parentAddress,
        address indexed token,
        uint256 amount
    );

    event StateHashUpdated(
        bytes32 indexed forkId,
        bytes32 oldHash,
        bytes32 newHash
    );

    event ReconvergenceInitiated(
        bytes32 indexed forkId,
        bytes32 stateHash,
        uint256 windowEndsAt
    );

    event Reconverged(
        bytes32 indexed forkId,
        address indexed parentAddress
    );

    event ForkDeactivated(bytes32 indexed forkId);

    event RootStateHashUpdated(bytes32 oldHash, bytes32 newHash);

    // ============ Errors ============

    error ForkNotActive();
    error NotForkOwner();
    error ParentNotRegistered();
    error AlreadyRegistered();
    error CannotForkSelf();
    error MaxDepthExceeded();
    error StateMismatch();
    error ReconvergenceWindowNotElapsed();
    error ReconvergenceAlreadyExecuted();
    error NoReconvergenceRequest();
    error ZeroAddress();
    error ZeroAmount();

    // ============ Initializer ============

    /// @custom:oz-upgrades-unsafe-allow constructor
    constructor() {
        _disableInitializers();
    }

    /**
     * @notice Initialize the ForkRegistry
     * @param _rootAddress The root protocol address (VibeSwap)
     * @param _owner Contract owner
     */
    function initialize(address _rootAddress, address _owner) external initializer {
        if (_rootAddress == address(0)) revert ZeroAddress();
        if (_owner == address(0)) revert ZeroAddress();

        __Ownable_init(_owner);
        __UUPSUpgradeable_init();
        __ReentrancyGuard_init();
        __Pausable_init();

        rootAddress = _rootAddress;
    }

    // ============ Fork Registration ============

    /**
     * @notice Register the caller as a fork of the given parent
     * @param parentAddress The parent protocol address (rootAddress or another fork)
     * @return forkId The unique identifier for this fork
     */
    function registerFork(address parentAddress) external whenNotPaused returns (bytes32) {
        if (parentAddress == address(0)) revert ZeroAddress();
        if (parentAddress == msg.sender) revert CannotForkSelf();
        if (forkIdByAddress[msg.sender] != bytes32(0)) revert AlreadyRegistered();

        // Determine depth and validate parent
        uint8 depth;
        bytes32 parentForkId;

        if (parentAddress == rootAddress) {
            depth = 0;
            parentForkId = bytes32(0);
        } else {
            parentForkId = forkIdByAddress[parentAddress];
            if (parentForkId == bytes32(0)) revert ParentNotRegistered();

            Fork storage parentFork = forks[parentForkId];
            if (!parentFork.active) revert ForkNotActive();

            depth = parentFork.depth + 1;
            if (depth > MAX_DEPTH) revert MaxDepthExceeded();
        }

        // Generate unique fork ID
        _nonce++;
        bytes32 forkId = keccak256(abi.encodePacked(msg.sender, parentAddress, block.timestamp, _nonce));

        // Store fork
        forks[forkId] = Fork({
            forkId: forkId,
            forkAddress: msg.sender,
            parentAddress: parentAddress,
            parentForkId: parentForkId,
            feeShareBps: FEE_SHARE_BPS,
            registeredAt: block.timestamp,
            stateHash: bytes32(0),
            lastStateUpdate: 0,
            totalFeesRouted: 0,
            totalFeesReceived: 0,
            active: true,
            depth: depth
        });

        forkIdByAddress[msg.sender] = forkId;
        childrenOf[parentAddress].push(forkId);
        _forkCount++;

        emit ForkRegistered(forkId, msg.sender, parentAddress, depth);

        return forkId;
    }

    // ============ Fee Routing ============

    /**
     * @notice Route ETH fees up the fork DAG. Sends 50% to immediate parent.
     *         The parent's share accumulates — they call routeFees themselves
     *         to propagate upward, creating geometric decay naturally.
     * @dev nonReentrant to prevent re-entrancy during ETH transfers.
     */
    function routeFees() external payable nonReentrant whenNotPaused {
        if (msg.value == 0) revert ZeroAmount();

        bytes32 forkId = forkIdByAddress[msg.sender];
        if (forkId == bytes32(0)) revert ParentNotRegistered();

        Fork storage fork = forks[forkId];
        if (!fork.active) revert ForkNotActive();

        uint256 parentShare = (msg.value * FEE_SHARE_BPS) / BPS_PRECISION;

        fork.totalFeesRouted += parentShare;

        // Credit parent if it's a fork
        bytes32 parentForkId = fork.parentForkId;
        if (parentForkId != bytes32(0)) {
            forks[parentForkId].totalFeesReceived += parentShare;
        }

        // Transfer to parent
        (bool success,) = fork.parentAddress.call{value: parentShare}("");
        require(success, "ETH transfer failed");

        // Refund the fork's 50% share back to the fork
        uint256 forkShare = msg.value - parentShare;
        if (forkShare > 0) {
            (bool refundSuccess,) = msg.sender.call{value: forkShare}("");
            require(refundSuccess, "Refund transfer failed");
        }

        emit FeesRouted(forkId, fork.parentAddress, parentShare);
    }

    /**
     * @notice Route ERC20 token fees up the fork DAG. 50/50 split.
     * @param token The ERC20 token address
     * @param amount The total amount to route
     */
    function routeFeesToken(address token, uint256 amount) external nonReentrant whenNotPaused {
        if (token == address(0)) revert ZeroAddress();
        if (amount == 0) revert ZeroAmount();

        bytes32 forkId = forkIdByAddress[msg.sender];
        if (forkId == bytes32(0)) revert ParentNotRegistered();

        Fork storage fork = forks[forkId];
        if (!fork.active) revert ForkNotActive();

        uint256 parentShare = (amount * FEE_SHARE_BPS) / BPS_PRECISION;
        uint256 forkShare = amount - parentShare;

        fork.totalFeesRouted += parentShare;

        // Credit parent if it's a fork
        bytes32 parentForkId = fork.parentForkId;
        if (parentForkId != bytes32(0)) {
            forks[parentForkId].totalFeesReceived += parentShare;
        }

        // Pull full amount from caller, send parent share to parent
        IERC20(token).safeTransferFrom(msg.sender, fork.parentAddress, parentShare);

        // Fork keeps its share (stays with caller, only parentShare is transferred)
        // If forkShare needs to go somewhere specific, the fork retains it
        // by only approving parentShare for transfer. But since we use transferFrom
        // for the full amount concept, we only transfer the parentShare.
        // The fork simply doesn't send the other 50%.

        emit FeesRoutedToken(forkId, fork.parentAddress, token, parentShare);
    }

    // ============ State Management ============

    /**
     * @notice Fork updates its state commitment hash
     * @param newHash The new state hash
     */
    function updateStateHash(bytes32 newHash) external whenNotPaused {
        bytes32 forkId = forkIdByAddress[msg.sender];
        if (forkId == bytes32(0)) revert ParentNotRegistered();

        Fork storage fork = forks[forkId];
        if (!fork.active) revert ForkNotActive();

        bytes32 oldHash = fork.stateHash;
        fork.stateHash = newHash;
        fork.lastStateUpdate = block.timestamp;

        emit StateHashUpdated(forkId, oldHash, newHash);
    }

    /**
     * @notice Owner updates the root protocol's state hash
     * @param newHash The new root state hash
     */
    function updateRootStateHash(bytes32 newHash) external onlyOwner {
        bytes32 oldHash = rootStateHash;
        rootStateHash = newHash;

        emit RootStateHashUpdated(oldHash, newHash);
    }

    // ============ Reconvergence ============

    /**
     * @notice Initiate reconvergence — fork's state hash must match parent's.
     *         After RECONVERGENCE_WINDOW (7 days), the merge can be executed.
     * @param forkId The fork requesting reconvergence
     */
    function reconverge(bytes32 forkId) external nonReentrant whenNotPaused {
        Fork storage fork = forks[forkId];
        if (!fork.active) revert ForkNotActive();
        if (fork.forkAddress != msg.sender) revert NotForkOwner();

        // Get parent's state hash
        bytes32 parentHash;
        if (fork.parentForkId == bytes32(0)) {
            // Parent is root
            parentHash = rootStateHash;
        } else {
            parentHash = forks[fork.parentForkId].stateHash;
        }

        if (fork.stateHash != parentHash || fork.stateHash == bytes32(0)) revert StateMismatch();

        ReconvergenceRequest storage req = reconvergenceRequests[forkId];

        // If there's an existing request with a different hash, restart the window
        if (req.matchedStateHash != fork.stateHash || req.initiatedAt == 0) {
            reconvergenceRequests[forkId] = ReconvergenceRequest({
                forkId: forkId,
                matchedStateHash: fork.stateHash,
                initiatedAt: block.timestamp,
                executed: false
            });

            emit ReconvergenceInitiated(forkId, fork.stateHash, block.timestamp + RECONVERGENCE_WINDOW);
            return;
        }

        // Check if the window has elapsed
        if (block.timestamp < req.initiatedAt + RECONVERGENCE_WINDOW) {
            revert ReconvergenceWindowNotElapsed();
        }
        if (req.executed) revert ReconvergenceAlreadyExecuted();

        // Verify state still matches
        if (fork.stateHash != parentHash) revert StateMismatch();

        // Execute reconvergence — deactivate the fork (merged into parent)
        req.executed = true;
        fork.active = false;

        emit Reconverged(forkId, fork.parentAddress);
    }

    // ============ Fork Lifecycle ============

    /**
     * @notice Fork owner deactivates their fork
     * @param forkId The fork to deactivate
     */
    function deactivateFork(bytes32 forkId) external {
        Fork storage fork = forks[forkId];
        if (fork.forkAddress != msg.sender) revert NotForkOwner();
        if (!fork.active) revert ForkNotActive();

        fork.active = false;

        emit ForkDeactivated(forkId);
    }

    // ============ View Functions ============

    /**
     * @notice Get all direct children fork IDs of a given address
     * @param root The parent address (root protocol or fork address)
     * @return Array of child fork IDs
     */
    function getForkTree(address root) external view returns (bytes32[] memory) {
        return childrenOf[root];
    }

    /**
     * @notice Get the depth of a fork in the DAG
     * @param forkId The fork ID
     * @return The depth (0 = direct child of root)
     */
    function getForkDepth(bytes32 forkId) external view returns (uint8) {
        return forks[forkId].depth;
    }

    /**
     * @notice Calculate the effective fee share that reaches the root from this fork.
     *         Geometric decay: depth 0 = 50%, depth 1 = 25%, depth 2 = 12.5%, etc.
     * @param forkId The fork ID
     * @return The effective fee share in bps that reaches root
     */
    function getFeeShare(bytes32 forkId) external view returns (uint256) {
        Fork storage fork = forks[forkId];
        if (fork.forkAddress == address(0)) return 0;

        // 50% ^ (depth + 1) expressed in bps
        // depth 0: 5000 bps (50%)
        // depth 1: 2500 bps (25%)
        // depth 2: 1250 bps (12.5%)
        uint256 share = BPS_PRECISION;
        for (uint8 i = 0; i <= fork.depth; i++) {
            share = (share * FEE_SHARE_BPS) / BPS_PRECISION;
        }
        return share;
    }

    /**
     * @notice Get full fork data
     * @param forkId The fork ID
     * @return The Fork struct
     */
    function getFork(bytes32 forkId) external view returns (Fork memory) {
        return forks[forkId];
    }

    /**
     * @notice Get the total number of registered forks
     * @return Total fork count
     */
    function forkCount() external view returns (uint256) {
        return _forkCount;
    }

    // ============ Admin ============

    /// @notice Pause the registry
    function pause() external onlyOwner {
        _pause();
    }

    /// @notice Unpause the registry
    function unpause() external onlyOwner {
        _unpause();
    }

    // ============ UUPS ============

    /// @dev Only owner can upgrade
    function _authorizeUpgrade(address newImplementation) internal override onlyOwner {
        require(newImplementation.code.length > 0, "Not a contract");
    }
}
