// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts-upgradeable/access/OwnableUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/proxy/utils/UUPSUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/utils/ReentrancyGuardUpgradeable.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

/**
 * @title VibeWrappedAssets
 * @notice VSOS wrapped asset factory — creates wrapped representations of
 *         cross-chain assets bridged via LayerZero or other messaging layers.
 *         Authorized minter contracts (bridges) mint on arrival and burn on departure.
 *         Tracks per-asset peg ratio (minted vs reported locked on source chain).
 *
 *         Part of the VSOS (VibeSwap Operating System) financial primitives.
 */
contract VibeWrappedAssets is OwnableUpgradeable, UUPSUpgradeable, ReentrancyGuardUpgradeable {
    using SafeERC20 for IERC20;

    // ============ Structs ============

    struct WrappedAsset {
        uint256 originalChainId;
        address originalAddress;
        string name;
        string symbol;
        uint256 totalMinted;
        uint256 lockedOnSource;
        bool active;
    }

    // ============ State ============

    /// @notice assetId => WrappedAsset metadata
    mapping(bytes32 => WrappedAsset) private _assets;

    /// @notice assetId => user => minted balance
    mapping(bytes32 => mapping(address => uint256)) private _balances;

    /// @notice authorized minter (bridge) addresses
    mapping(address => bool) private _minters;

    /// @notice all registered asset IDs for enumeration
    bytes32[] private _assetIds;

    // ============ Events ============

    event WrappedAssetCreated(
        bytes32 indexed assetId,
        uint256 originalChainId,
        address originalAddress,
        string name,
        string symbol
    );

    event WrappedAssetToggled(bytes32 indexed assetId, bool active);

    event Minted(
        bytes32 indexed assetId,
        address indexed to,
        uint256 amount,
        address indexed minter
    );

    event Burned(
        bytes32 indexed assetId,
        address indexed from,
        uint256 amount,
        address indexed minter
    );

    event MinterAdded(address indexed minter);
    event MinterRemoved(address indexed minter);
    event PegUpdated(bytes32 indexed assetId, uint256 lockedOnSource);

    // ============ Errors ============

    error AssetAlreadyExists(bytes32 assetId);
    error AssetNotFound(bytes32 assetId);
    error AssetNotActive(bytes32 assetId);
    error NotAuthorizedMinter(address caller);
    error ZeroAddress();
    error ZeroAmount();
    error InsufficientBalance(address account, uint256 available, uint256 requested);

    // ============ Modifiers ============

    modifier onlyMinter() {
        if (!_minters[msg.sender]) revert NotAuthorizedMinter(msg.sender);
        _;
    }

    // ============ Initializer ============

    /// @custom:oz-upgrades-unsafe-allow constructor
    constructor() {
        _disableInitializers();
    }

    function initialize(address owner_) external initializer {
        __Ownable_init(owner_);
        __UUPSUpgradeable_init();
        __ReentrancyGuard_init();
    }

    // ============ Admin: Asset Management ============

    /**
     * @notice Register a new wrapped asset representation.
     * @param originalChainId  Source chain ID where the real asset lives.
     * @param originalAddress  Token address on the source chain.
     * @param name_            Human-readable name for the wrapped token.
     * @param symbol_          Ticker symbol for the wrapped token.
     * @return assetId         Deterministic ID derived from chain + address.
     */
    function createWrappedAsset(
        uint256 originalChainId,
        address originalAddress,
        string calldata name_,
        string calldata symbol_
    ) external onlyOwner returns (bytes32 assetId) {
        if (originalAddress == address(0)) revert ZeroAddress();

        assetId = _deriveAssetId(originalChainId, originalAddress);
        if (_assets[assetId].originalAddress != address(0)) revert AssetAlreadyExists(assetId);

        _assets[assetId] = WrappedAsset({
            originalChainId: originalChainId,
            originalAddress: originalAddress,
            name: name_,
            symbol: symbol_,
            totalMinted: 0,
            lockedOnSource: 0,
            active: true
        });
        _assetIds.push(assetId);

        emit WrappedAssetCreated(assetId, originalChainId, originalAddress, name_, symbol_);
    }

    /// @notice Toggle an asset's active flag (pause/unpause minting).
    function toggleAsset(bytes32 assetId, bool active) external onlyOwner {
        if (_assets[assetId].originalAddress == address(0)) revert AssetNotFound(assetId);
        _assets[assetId].active = active;
        emit WrappedAssetToggled(assetId, active);
    }

    // ============ Admin: Minter Management ============

    function addMinter(address minter) external onlyOwner {
        if (minter == address(0)) revert ZeroAddress();
        _minters[minter] = true;
        emit MinterAdded(minter);
    }

    function removeMinter(address minter) external onlyOwner {
        _minters[minter] = false;
        emit MinterRemoved(minter);
    }

    // ============ Minter: Mint / Burn ============

    /**
     * @notice Mint wrapped tokens when assets arrive from the source chain.
     * @param assetId  The wrapped asset identifier.
     * @param to       Recipient of the minted tokens.
     * @param amount   Amount to mint.
     */
    function mint(bytes32 assetId, address to, uint256 amount) external onlyMinter nonReentrant {
        if (to == address(0)) revert ZeroAddress();
        if (amount == 0) revert ZeroAmount();
        WrappedAsset storage asset = _assets[assetId];
        if (asset.originalAddress == address(0)) revert AssetNotFound(assetId);
        if (!asset.active) revert AssetNotActive(assetId);

        asset.totalMinted += amount;
        _balances[assetId][to] += amount;

        emit Minted(assetId, to, amount, msg.sender);
    }

    /**
     * @notice Burn wrapped tokens when user bridges back to source chain.
     * @param assetId  The wrapped asset identifier.
     * @param from     Address whose wrapped tokens are burned.
     * @param amount   Amount to burn.
     */
    function burn(bytes32 assetId, address from, uint256 amount) external onlyMinter nonReentrant {
        if (amount == 0) revert ZeroAmount();
        WrappedAsset storage asset = _assets[assetId];
        if (asset.originalAddress == address(0)) revert AssetNotFound(assetId);

        uint256 bal = _balances[assetId][from];
        if (bal < amount) revert InsufficientBalance(from, bal, amount);

        _balances[assetId][from] = bal - amount;
        asset.totalMinted -= amount;

        emit Burned(assetId, from, amount, msg.sender);
    }

    // ============ Peg Tracking ============

    /**
     * @notice Update the reported amount locked on the source chain (oracle / bridge callback).
     *         Used to compute the backing ratio for transparency.
     */
    function updateLockedOnSource(bytes32 assetId, uint256 lockedAmount) external onlyMinter {
        if (_assets[assetId].originalAddress == address(0)) revert AssetNotFound(assetId);
        _assets[assetId].lockedOnSource = lockedAmount;
        emit PegUpdated(assetId, lockedAmount);
    }

    // ============ View Functions ============

    function getWrappedAsset(bytes32 assetId) external view returns (WrappedAsset memory) {
        return _assets[assetId];
    }

    function getMintedSupply(bytes32 assetId) external view returns (uint256) {
        return _assets[assetId].totalMinted;
    }

    function balanceOf(bytes32 assetId, address account) external view returns (uint256) {
        return _balances[assetId][account];
    }

    function isMinter(address account) external view returns (bool) {
        return _minters[account];
    }

    /**
     * @notice Backing ratio in basis points (10000 = fully backed).
     *         Returns 0 if nothing is minted (no peg to track).
     */
    function backingRatioBps(bytes32 assetId) external view returns (uint256) {
        uint256 minted = _assets[assetId].totalMinted;
        if (minted == 0) return 0;
        return (_assets[assetId].lockedOnSource * 10_000) / minted;
    }

    function assetCount() external view returns (uint256) {
        return _assetIds.length;
    }

    function assetIdAt(uint256 index) external view returns (bytes32) {
        return _assetIds[index];
    }

    // ============ Internal ============

    function _deriveAssetId(uint256 chainId, address token) internal pure returns (bytes32) {
        return keccak256(abi.encodePacked(chainId, token));
    }

    function _authorizeUpgrade(address newImplementation) internal override onlyOwner {}
}
