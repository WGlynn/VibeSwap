// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/token/ERC721/ERC721.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "./interfaces/IVibeSynth.sol";
import "../oracle/IReputationOracle.sol";

/**
 * @title VibeSynth
 * @notice ERC-721 synthetic asset positions — collateralized exposure to any
 *         asset (BTC, gold, TSLA) priced via oracle infrastructure.
 * @dev Part of VSOS (VibeSwap Operating System) Financial Primitives.
 *
 *      Minters deposit collateral and mint synthetic units representing exposure
 *      to oracle-priced assets. Minimum collateral ratio is reputation-gated:
 *      higher ReputationOracle trust tier = lower C-ratio requirement.
 *
 *      Co-op capitalist design:
 *        - Reputation gates replace overcollateralization barriers
 *        - Liquidation penalties flow to protocol (mutualized), not bots
 *        - JUL keeper tips incentivize system maintenance
 *        - JUL collateral bonus rewards protocol-native currency
 *        - Transferable NFTs democratize asset access
 *
 *      Lifecycle: open → mint → [trade position] → burn → close
 *      Or:        open → mint → [undercollateralized] → liquidate
 */
contract VibeSynth is ERC721, Ownable, ReentrancyGuard, IVibeSynth {
    using SafeERC20 for IERC20;

    // ============ Constants ============

    uint256 private constant BPS = 10_000;
    uint256 private constant PRECISION = 1e18;
    uint256 private constant KEEPER_TIP = 10 ether;
    uint256 private constant JUL_BONUS_BPS = 500;   // +5% C-ratio reduction for JUL collateral
    uint256 private constant MAX_SYNTH_ASSETS = 255;

    // Reputation tier → C-ratio reduction in BPS
    uint256 private constant TIER_0_REDUCTION = 0;
    uint256 private constant TIER_1_REDUCTION = 500;
    uint256 private constant TIER_2_REDUCTION = 1000;
    uint256 private constant TIER_3_REDUCTION = 1500;
    uint256 private constant TIER_4_REDUCTION = 2000;

    // ============ State ============

    IERC20 public immutable julToken;
    IERC20 public immutable collateralToken;
    IReputationOracle public immutable reputationOracle;

    uint256 private _nextPositionId = 1;
    uint256 private _totalPositions;
    uint8 private _totalSynthAssets;
    uint256 public julRewardPool;
    uint256 public protocolRevenue;

    mapping(uint8 => SynthAsset) private _synthAssets;
    mapping(uint256 => SynthPosition) private _positions;
    mapping(address => bool) public authorizedPriceSetters;

    /// @notice Maximum allowed price change per update in BPS (2000 = 20%). Owner bypasses this.
    uint16 public maxPriceJumpBps = 2000;

    // ============ Constructor ============

    constructor(
        address _julToken,
        address _reputationOracle,
        address _collateralToken
    ) ERC721("VibeSwap Synthetic Position", "VSYNTH") Ownable(msg.sender) {
        if (_julToken == address(0)) revert ZeroAddress();
        if (_reputationOracle == address(0)) revert ZeroAddress();
        if (_collateralToken == address(0)) revert ZeroAddress();
        julToken = IERC20(_julToken);
        reputationOracle = IReputationOracle(_reputationOracle);
        collateralToken = IERC20(_collateralToken);
    }

    // ============ Admin Functions ============

    /**
     * @notice Register a new synthetic asset (e.g., vBTC, vGOLD, vTSLA)
     * @param params Registration parameters including name, symbol, price, ratios
     * @return synthAssetId The assigned asset ID (0-254)
     */
    function registerSynthAsset(RegisterSynthParams calldata params)
        external
        onlyOwner
        returns (uint8 synthAssetId)
    {
        if (_totalSynthAssets >= MAX_SYNTH_ASSETS) revert MaxSynthAssetsReached();
        if (params.initialPrice == 0) revert InvalidPrice();
        if (params.minCRatioBps <= uint16(BPS)) revert InvalidCRatio();
        if (params.liquidationCRatioBps >= params.minCRatioBps) revert InvalidLiquidationParams();
        if (params.liquidationCRatioBps <= uint16(BPS)) revert InvalidLiquidationParams();

        synthAssetId = _totalSynthAssets++;

        _synthAssets[synthAssetId] = SynthAsset({
            name: params.name,
            symbol: params.symbol,
            currentPrice: params.initialPrice,
            totalMinted: 0,
            minCRatioBps: params.minCRatioBps,
            liquidationCRatioBps: params.liquidationCRatioBps,
            liquidationPenaltyBps: params.liquidationPenaltyBps,
            lastPriceUpdate: uint40(block.timestamp),
            active: true
        });

        emit SynthAssetRegistered(
            synthAssetId,
            params.name,
            params.symbol,
            params.minCRatioBps,
            params.liquidationCRatioBps
        );
    }

    /**
     * @notice Deactivate a synth asset — stops new minting, existing positions unaffected
     */
    function deactivateSynthAsset(uint8 synthAssetId) external onlyOwner {
        if (synthAssetId >= _totalSynthAssets) revert InvalidSynthAsset();
        _synthAssets[synthAssetId].active = false;
        emit SynthAssetDeactivated(synthAssetId);
    }

    /**
     * @notice Update the oracle price for a synthetic asset
     * @param synthAssetId The asset to update
     * @param newPrice New price in collateral units (1e18 precision)
     */
    function updatePrice(uint8 synthAssetId, uint256 newPrice) external {
        if (!authorizedPriceSetters[msg.sender] && msg.sender != owner()) {
            revert NotAuthorizedPriceSetter();
        }
        if (synthAssetId >= _totalSynthAssets) revert InvalidSynthAsset();
        if (newPrice == 0) revert InvalidPrice();

        SynthAsset storage asset = _synthAssets[synthAssetId];
        uint256 oldPrice = asset.currentPrice;

        // Price jump validation — owner bypasses for emergencies
        if (msg.sender != owner() && maxPriceJumpBps > 0 && oldPrice > 0) {
            uint256 delta = newPrice > oldPrice ? newPrice - oldPrice : oldPrice - newPrice;
            uint256 maxDelta = (oldPrice * maxPriceJumpBps) / BPS;
            if (delta > maxDelta) revert PriceJumpExceeded();
        }

        asset.currentPrice = newPrice;
        asset.lastPriceUpdate = uint40(block.timestamp);

        emit PriceUpdated(synthAssetId, oldPrice, newPrice);
    }

    /**
     * @notice Authorize or revoke a price setter address
     */
    function setPriceSetter(address setter, bool authorized) external onlyOwner {
        if (setter == address(0)) revert ZeroAddress();
        authorizedPriceSetters[setter] = authorized;
        emit PriceSetterUpdated(setter, authorized);
    }

    /**
     * @notice Set maximum allowed price jump per update (BPS)
     * @param bps New limit (0 = disabled, max 5000 = 50%)
     */
    function setMaxPriceJump(uint16 bps) external onlyOwner {
        if (bps > 5000) revert InvalidJumpLimit();
        uint16 old = maxPriceJumpBps;
        maxPriceJumpBps = bps;
        emit MaxPriceJumpUpdated(old, bps);
    }

    /**
     * @notice Deposit JUL into the keeper reward pool
     */
    function depositJulRewards(uint256 amount) external nonReentrant {
        if (amount == 0) revert ZeroAmount();
        julRewardPool += amount;
        julToken.safeTransferFrom(msg.sender, address(this), amount);
        emit JulRewardsDeposited(msg.sender, amount);
    }

    /**
     * @notice Withdraw accumulated protocol revenue from liquidations
     */
    function withdrawProtocolRevenue(uint256 amount) external onlyOwner nonReentrant {
        if (amount == 0 || amount > protocolRevenue) revert ZeroAmount();
        protocolRevenue -= amount;
        collateralToken.safeTransfer(msg.sender, amount);
    }

    // ============ User Functions ============

    /**
     * @notice Open a synthetic position — deposit collateral, mint ERC-721
     * @param synthAssetId Which synth asset to get exposure to
     * @param collateralAmount Collateral to deposit
     * @return positionId The minted position NFT token ID
     */
    function openPosition(uint8 synthAssetId, uint256 collateralAmount)
        external
        nonReentrant
        returns (uint256 positionId)
    {
        if (synthAssetId >= _totalSynthAssets) revert InvalidSynthAsset();
        if (!_synthAssets[synthAssetId].active) revert SynthAssetNotActive();
        if (collateralAmount == 0) revert ZeroAmount();

        positionId = _nextPositionId++;
        _totalPositions++;

        _positions[positionId] = SynthPosition({
            minter: msg.sender,
            state: PositionState.ACTIVE,
            synthAssetId: synthAssetId,
            createdAt: uint40(block.timestamp),
            lastUpdate: uint40(block.timestamp),
            collateralAmount: collateralAmount,
            mintedAmount: 0
        });

        collateralToken.safeTransferFrom(msg.sender, address(this), collateralAmount);
        _mint(msg.sender, positionId);

        emit PositionOpened(positionId, msg.sender, synthAssetId, collateralAmount);
    }

    /**
     * @notice Mint synthetic units against a position (increases debt)
     * @param positionId The position NFT ID
     * @param synthAmount Synth units to mint
     */
    function mintSynth(uint256 positionId, uint256 synthAmount) external nonReentrant {
        SynthPosition storage pos = _positions[positionId];
        if (pos.state != PositionState.ACTIVE) revert NotActivePosition();
        if (pos.minter != msg.sender) revert NotPositionOwner();
        if (synthAmount == 0) revert ZeroAmount();

        SynthAsset storage asset = _synthAssets[pos.synthAssetId];
        if (!asset.active) revert SynthAssetNotActive();

        uint256 newMinted = pos.mintedAmount + synthAmount;
        uint256 debtValue = (newMinted * asset.currentPrice) / PRECISION;

        // Check C-ratio after mint
        uint256 minCRatio = _effectiveMinCRatio(pos.synthAssetId, msg.sender);
        uint256 requiredCollateral = (debtValue * minCRatio) / BPS;
        if (pos.collateralAmount < requiredCollateral) revert BelowMinCRatio();

        pos.mintedAmount = newMinted;
        pos.lastUpdate = uint40(block.timestamp);
        asset.totalMinted += synthAmount;

        emit SynthMinted(positionId, synthAmount, newMinted);
    }

    /**
     * @notice Burn synthetic units to reduce position debt
     * @param positionId The position NFT ID
     * @param synthAmount Synth units to burn
     */
    function burnSynth(uint256 positionId, uint256 synthAmount) external nonReentrant {
        SynthPosition storage pos = _positions[positionId];
        if (pos.state != PositionState.ACTIVE) revert NotActivePosition();
        if (synthAmount == 0) revert ZeroAmount();
        if (synthAmount > pos.mintedAmount) revert ExceedsMintedAmount();

        pos.mintedAmount -= synthAmount;
        pos.lastUpdate = uint40(block.timestamp);
        _synthAssets[pos.synthAssetId].totalMinted -= synthAmount;

        emit SynthBurned(positionId, synthAmount, pos.mintedAmount);
    }

    /**
     * @notice Add collateral to improve C-ratio
     * @param positionId The position NFT ID
     * @param amount Collateral to add
     */
    function addCollateral(uint256 positionId, uint256 amount) external nonReentrant {
        SynthPosition storage pos = _positions[positionId];
        if (pos.state != PositionState.ACTIVE) revert NotActivePosition();
        if (amount == 0) revert ZeroAmount();

        pos.collateralAmount += amount;
        pos.lastUpdate = uint40(block.timestamp);

        collateralToken.safeTransferFrom(msg.sender, address(this), amount);

        emit CollateralAdded(positionId, amount, pos.collateralAmount);
    }

    /**
     * @notice Withdraw excess collateral (must remain above min C-ratio)
     * @param positionId The position NFT ID
     * @param amount Collateral to withdraw
     */
    function withdrawCollateral(uint256 positionId, uint256 amount) external nonReentrant {
        SynthPosition storage pos = _positions[positionId];
        if (pos.state != PositionState.ACTIVE) revert NotActivePosition();
        if (pos.minter != msg.sender) revert NotPositionOwner();
        if (amount == 0) revert ZeroAmount();

        uint256 newCollateral = pos.collateralAmount - amount;

        // If there's outstanding debt, check C-ratio
        if (pos.mintedAmount > 0) {
            SynthAsset storage asset = _synthAssets[pos.synthAssetId];
            uint256 debtValue = (pos.mintedAmount * asset.currentPrice) / PRECISION;
            uint256 minCRatio = _effectiveMinCRatio(pos.synthAssetId, msg.sender);
            uint256 requiredCollateral = (debtValue * minCRatio) / BPS;
            if (newCollateral < requiredCollateral) revert BelowMinCRatio();
        }

        pos.collateralAmount = newCollateral;
        pos.lastUpdate = uint40(block.timestamp);

        collateralToken.safeTransfer(msg.sender, amount);

        emit CollateralWithdrawn(positionId, amount, newCollateral);
    }

    /**
     * @notice Close a position — must have zero debt. Returns all collateral.
     * @param positionId The position NFT ID
     */
    function closePosition(uint256 positionId) external nonReentrant {
        SynthPosition storage pos = _positions[positionId];
        if (pos.state != PositionState.ACTIVE) revert NotActivePosition();
        if (pos.minter != msg.sender) revert NotPositionOwner();
        if (pos.mintedAmount > 0) revert HasOutstandingDebt();

        uint256 collateralReturned = pos.collateralAmount;
        pos.collateralAmount = 0;
        pos.state = PositionState.CLOSED;

        if (collateralReturned > 0) {
            collateralToken.safeTransfer(msg.sender, collateralReturned);
        }

        emit PositionClosed(positionId, msg.sender, collateralReturned);
    }

    // ============ Keeper Functions ============

    /**
     * @notice Liquidate an undercollateralized position — earn JUL keeper tip
     * @param positionId The position NFT ID
     */
    function liquidate(uint256 positionId) external nonReentrant {
        if (!isLiquidatable(positionId)) revert NotLiquidatable();

        SynthPosition storage pos = _positions[positionId];
        SynthAsset storage asset = _synthAssets[pos.synthAssetId];

        uint256 debtValue = (pos.mintedAmount * asset.currentPrice) / PRECISION;
        uint256 penalty = (debtValue * asset.liquidationPenaltyBps) / BPS;
        uint256 totalSeized = debtValue + penalty;

        uint256 collateralReturned;
        uint256 seized;

        if (pos.collateralAmount > totalSeized) {
            collateralReturned = pos.collateralAmount - totalSeized;
            seized = totalSeized;
        } else {
            seized = pos.collateralAmount;
        }

        // Update state
        asset.totalMinted -= pos.mintedAmount;
        pos.state = PositionState.LIQUIDATED;
        pos.mintedAmount = 0;
        pos.collateralAmount = 0;
        protocolRevenue += seized;

        // Return excess collateral to minter
        if (collateralReturned > 0) {
            collateralToken.safeTransfer(pos.minter, collateralReturned);
        }

        emit PositionLiquidated(
            positionId,
            msg.sender,
            pos.minter,
            debtValue,
            penalty,
            collateralReturned
        );

        // JUL keeper tip
        if (julRewardPool >= KEEPER_TIP) {
            julRewardPool -= KEEPER_TIP;
            julToken.safeTransfer(msg.sender, KEEPER_TIP);
        }
    }

    // ============ View Functions ============

    function getPosition(uint256 positionId) external view returns (SynthPosition memory) {
        return _positions[positionId];
    }

    function getSynthAsset(uint8 synthAssetId) external view returns (SynthAsset memory) {
        return _synthAssets[synthAssetId];
    }

    /**
     * @notice Current collateral ratio in BPS (e.g., 15000 = 150%)
     * @dev Returns type(uint256).max if no debt (infinite C-ratio)
     */
    function collateralRatio(uint256 positionId) public view returns (uint256) {
        SynthPosition storage pos = _positions[positionId];
        if (pos.mintedAmount == 0) return type(uint256).max;

        SynthAsset storage asset = _synthAssets[pos.synthAssetId];
        uint256 debtValue = (pos.mintedAmount * asset.currentPrice) / PRECISION;
        if (debtValue == 0) return type(uint256).max;

        return (pos.collateralAmount * BPS) / debtValue;
    }

    /**
     * @notice Check if a position can be liquidated
     */
    function isLiquidatable(uint256 positionId) public view returns (bool) {
        SynthPosition storage pos = _positions[positionId];
        if (pos.state != PositionState.ACTIVE) return false;
        if (pos.mintedAmount == 0) return false;

        uint256 cRatio = collateralRatio(positionId);
        uint256 liquidationThreshold = uint256(_synthAssets[pos.synthAssetId].liquidationCRatioBps);

        return cRatio < liquidationThreshold;
    }

    /**
     * @notice Effective minimum C-ratio for a user on a synth asset
     *         (base - reputation reduction - JUL bonus)
     */
    function effectiveMinCRatio(uint8 synthAssetId, address user) external view returns (uint256) {
        return _effectiveMinCRatio(synthAssetId, user);
    }

    function totalPositions() external view returns (uint256) {
        return _totalPositions;
    }

    function totalSynthAssets() external view returns (uint8) {
        return _totalSynthAssets;
    }

    // ============ Internal ============

    /**
     * @notice Calculate effective min C-ratio: base - reputation reduction - JUL bonus
     * @dev Floor is the synth asset's liquidation C-ratio (never go below liquidation threshold)
     */
    function _effectiveMinCRatio(uint8 synthAssetId, address user) internal view returns (uint256) {
        SynthAsset storage asset = _synthAssets[synthAssetId];
        uint256 minCR = uint256(asset.minCRatioBps);

        // Reputation reduction
        uint8 tier = reputationOracle.getTrustTier(user);
        uint256 reduction = _tierReduction(tier);

        // JUL collateral bonus
        if (address(collateralToken) == address(julToken)) {
            reduction += JUL_BONUS_BPS;
        }

        // Apply reduction, floor at liquidation C-ratio
        if (reduction >= minCR) {
            return uint256(asset.liquidationCRatioBps);
        }
        uint256 effective = minCR - reduction;
        if (effective < uint256(asset.liquidationCRatioBps)) {
            return uint256(asset.liquidationCRatioBps);
        }
        return effective;
    }

    /**
     * @notice Reputation tier → C-ratio reduction in BPS
     */
    function _tierReduction(uint8 tier) internal pure returns (uint256) {
        if (tier == 0) return TIER_0_REDUCTION;
        if (tier == 1) return TIER_1_REDUCTION;
        if (tier == 2) return TIER_2_REDUCTION;
        if (tier == 3) return TIER_3_REDUCTION;
        if (tier == 4) return TIER_4_REDUCTION;
        return TIER_0_REDUCTION;
    }

    // ============ ERC721 Overrides ============

    /**
     * @notice Update minter on transfer — new owner inherits position
     */
    function _update(address to, uint256 tokenId, address auth)
        internal
        override
        returns (address)
    {
        address from = super._update(to, tokenId, auth);

        // Update minter on transfer (not mint or burn)
        if (from != address(0) && to != address(0)) {
            _positions[tokenId].minter = to;
        }

        return from;
    }
}
