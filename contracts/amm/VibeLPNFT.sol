// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/token/ERC721/ERC721.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "../core/interfaces/IVibeAMM.sol";
import "./interfaces/IVibeLPNFT.sol";

/**
 * @title VibeLPNFT
 * @notice ERC-721 position manager for VibeAMM liquidity positions
 * @dev Wraps VibeAMM — holds VibeLP ERC-20 tokens in custody and issues
 *      ERC-721 NFTs as position receipts. Each NFT represents a unique LP
 *      position with metadata (pool, amounts, entry price, age).
 *
 *      Two-step withdrawal: decreaseLiquidity stores tokens owed,
 *      collect sends them. Prevents reentrancy.
 */
contract VibeLPNFT is ERC721, Ownable, ReentrancyGuard, IVibeLPNFT {
    using SafeERC20 for IERC20;

    // ============ State ============

    /// @notice VibeAMM instance (immutable — no changes to AMM needed)
    IVibeAMM public immutable vibeAMM;

    /// @notice Next token ID to mint (starts at 1)
    uint256 private _nextTokenId = 1;

    /// @notice Position data per token ID
    mapping(uint256 => Position) private _positions;

    /// @notice Token IDs owned by each address (for enumeration)
    mapping(address => uint256[]) private _ownedTokens;

    /// @notice Index of token ID in owner's _ownedTokens array (for O(1) removal)
    mapping(uint256 => uint256) private _ownedTokenIndex;

    /// @notice Tokens owed per position: tokenId => token address => amount
    mapping(uint256 => mapping(address => uint256)) private _tokensOwed;

    /// @notice Total positions ever minted (not decremented on burn)
    uint256 private _totalPositions;

    // ============ Modifiers ============

    modifier checkDeadline(uint256 deadline) {
        if (block.timestamp > deadline) revert DeadlineExpired();
        _;
    }

    modifier isAuthorizedForToken(uint256 tokenId) {
        address tokenOwner = _requireOwned(tokenId);
        _checkAuthorized(tokenOwner, msg.sender, tokenId);
        _;
    }

    // ============ Constructor ============

    constructor(
        address _vibeAMM
    ) ERC721("VibeSwap LP Position", "VSLP") Ownable(msg.sender) {
        require(_vibeAMM != address(0), "Invalid AMM");
        vibeAMM = IVibeAMM(_vibeAMM);
    }

    // ============ Core Functions ============

    /**
     * @notice Mint a new LP position NFT
     * @dev Pulls tokens from caller, adds liquidity to VibeAMM, mints NFT
     * @param params MintParams struct with pool, amounts, recipient, deadline
     * @return tokenId The minted NFT token ID
     * @return liquidity VibeLP tokens received (held in custody)
     * @return amount0 Actual token0 deposited
     * @return amount1 Actual token1 deposited
     */
    function mint(MintParams calldata params)
        external
        nonReentrant
        checkDeadline(params.deadline)
        returns (uint256 tokenId, uint256 liquidity, uint256 amount0, uint256 amount1)
    {
        if (params.recipient == address(0)) revert ZeroRecipient();

        IVibeAMM.Pool memory pool = vibeAMM.getPool(params.poolId);
        if (!pool.initialized) revert InvalidPool();

        // Pull tokens from caller
        IERC20(pool.token0).safeTransferFrom(msg.sender, address(this), params.amount0Desired);
        IERC20(pool.token1).safeTransferFrom(msg.sender, address(this), params.amount1Desired);

        // Approve AMM to pull tokens
        IERC20(pool.token0).approve(address(vibeAMM), params.amount0Desired);
        IERC20(pool.token1).approve(address(vibeAMM), params.amount1Desired);

        // Add liquidity — AMM pulls actual amounts, mints VibeLP to us
        (amount0, amount1, liquidity) = vibeAMM.addLiquidity(
            params.poolId,
            params.amount0Desired,
            params.amount1Desired,
            params.amount0Min,
            params.amount1Min
        );

        // Refund excess tokens to caller
        uint256 refund0 = params.amount0Desired - amount0;
        uint256 refund1 = params.amount1Desired - amount1;
        if (refund0 > 0) IERC20(pool.token0).safeTransfer(msg.sender, refund0);
        if (refund1 > 0) IERC20(pool.token1).safeTransfer(msg.sender, refund1);

        // Reset approvals (security: no dangling approvals)
        IERC20(pool.token0).approve(address(vibeAMM), 0);
        IERC20(pool.token1).approve(address(vibeAMM), 0);

        // Get entry price: TWAP preferred, fallback to spot
        uint256 entryPrice = vibeAMM.getTWAP(params.poolId, 600);
        if (entryPrice == 0) {
            entryPrice = vibeAMM.getSpotPrice(params.poolId);
        }

        // Mint NFT
        tokenId = _nextTokenId++;
        _safeMint(params.recipient, tokenId);

        // Store position
        _positions[tokenId] = Position({
            poolId: params.poolId,
            liquidity: liquidity,
            amount0Deposited: amount0,
            amount1Deposited: amount1,
            entryPrice: entryPrice,
            createdAt: uint64(block.timestamp),
            lastModifiedAt: uint64(block.timestamp)
        });

        _totalPositions++;

        emit PositionMinted(tokenId, params.poolId, params.recipient, liquidity, amount0, amount1);
    }

    /**
     * @notice Add liquidity to an existing position
     * @dev Weight-averages the entry price with the new deposit
     * @param params IncreaseLiquidityParams with tokenId, amounts, deadline
     * @return liquidity Additional VibeLP tokens received
     * @return amount0 Actual token0 added
     * @return amount1 Actual token1 added
     */
    function increaseLiquidity(IncreaseLiquidityParams calldata params)
        external
        nonReentrant
        checkDeadline(params.deadline)
        isAuthorizedForToken(params.tokenId)
        returns (uint256 liquidity, uint256 amount0, uint256 amount1)
    {
        Position storage position = _positions[params.tokenId];
        IVibeAMM.Pool memory pool = vibeAMM.getPool(position.poolId);

        // Pull tokens from caller
        IERC20(pool.token0).safeTransferFrom(msg.sender, address(this), params.amount0Desired);
        IERC20(pool.token1).safeTransferFrom(msg.sender, address(this), params.amount1Desired);

        // Approve AMM
        IERC20(pool.token0).approve(address(vibeAMM), params.amount0Desired);
        IERC20(pool.token1).approve(address(vibeAMM), params.amount1Desired);

        // Add liquidity
        (amount0, amount1, liquidity) = vibeAMM.addLiquidity(
            position.poolId,
            params.amount0Desired,
            params.amount1Desired,
            params.amount0Min,
            params.amount1Min
        );

        // Refund excess
        uint256 refund0 = params.amount0Desired - amount0;
        uint256 refund1 = params.amount1Desired - amount1;
        if (refund0 > 0) IERC20(pool.token0).safeTransfer(msg.sender, refund0);
        if (refund1 > 0) IERC20(pool.token1).safeTransfer(msg.sender, refund1);

        // Reset approvals
        IERC20(pool.token0).approve(address(vibeAMM), 0);
        IERC20(pool.token1).approve(address(vibeAMM), 0);

        // Weight-average entry price
        uint256 currentPrice = vibeAMM.getTWAP(position.poolId, 600);
        if (currentPrice == 0) {
            currentPrice = vibeAMM.getSpotPrice(position.poolId);
        }

        uint256 oldLiquidity = position.liquidity;
        position.entryPrice = (position.entryPrice * oldLiquidity + currentPrice * liquidity)
            / (oldLiquidity + liquidity);

        // Update position
        position.liquidity += liquidity;
        position.amount0Deposited += amount0;
        position.amount1Deposited += amount1;
        position.lastModifiedAt = uint64(block.timestamp);

        emit LiquidityIncreased(params.tokenId, liquidity, amount0, amount1);
    }

    /**
     * @notice Remove liquidity from a position (partial or full)
     * @dev Does NOT send tokens — stores in _tokensOwed. Call collect() to withdraw.
     * @param params DecreaseLiquidityParams with tokenId, amount, minimums, deadline
     * @return amount0 Token0 removed from pool
     * @return amount1 Token1 removed from pool
     */
    function decreaseLiquidity(DecreaseLiquidityParams calldata params)
        external
        nonReentrant
        checkDeadline(params.deadline)
        isAuthorizedForToken(params.tokenId)
        returns (uint256 amount0, uint256 amount1)
    {
        Position storage position = _positions[params.tokenId];
        if (params.liquidityAmount == 0) revert ZeroLiquidity();
        if (params.liquidityAmount > position.liquidity) revert ExceedsPositionLiquidity();

        // Approve AMM to burn our VibeLP tokens
        address lpToken = vibeAMM.getLPToken(position.poolId);
        IERC20(lpToken).approve(address(vibeAMM), params.liquidityAmount);

        // Remove liquidity — AMM burns VibeLP from us, sends tokens to us
        (amount0, amount1) = vibeAMM.removeLiquidity(
            position.poolId,
            params.liquidityAmount,
            params.amount0Min,
            params.amount1Min
        );

        // Adjust deposited amounts proportionally
        IVibeAMM.Pool memory pool = vibeAMM.getPool(position.poolId);
        uint256 proportional0 = (position.amount0Deposited * params.liquidityAmount) / position.liquidity;
        uint256 proportional1 = (position.amount1Deposited * params.liquidityAmount) / position.liquidity;
        position.amount0Deposited -= proportional0;
        position.amount1Deposited -= proportional1;

        // Update position
        position.liquidity -= params.liquidityAmount;
        position.lastModifiedAt = uint64(block.timestamp);

        // Store tokens owed (two-step withdrawal)
        _tokensOwed[params.tokenId][pool.token0] += amount0;
        _tokensOwed[params.tokenId][pool.token1] += amount1;

        emit LiquidityDecreased(params.tokenId, params.liquidityAmount, amount0, amount1);
    }

    /**
     * @notice Collect tokens owed from a previous decreaseLiquidity call
     * @param params CollectParams with tokenId and recipient
     * @return amount0 Token0 collected
     * @return amount1 Token1 collected
     */
    function collect(CollectParams calldata params)
        external
        nonReentrant
        isAuthorizedForToken(params.tokenId)
        returns (uint256 amount0, uint256 amount1)
    {
        address recipient = params.recipient == address(0) ? msg.sender : params.recipient;

        Position storage position = _positions[params.tokenId];
        IVibeAMM.Pool memory pool = vibeAMM.getPool(position.poolId);

        amount0 = _tokensOwed[params.tokenId][pool.token0];
        amount1 = _tokensOwed[params.tokenId][pool.token1];

        if (amount0 == 0 && amount1 == 0) revert NoTokensOwed();

        // Clear owed amounts before transfer (CEI)
        _tokensOwed[params.tokenId][pool.token0] = 0;
        _tokensOwed[params.tokenId][pool.token1] = 0;

        // Send tokens
        if (amount0 > 0) IERC20(pool.token0).safeTransfer(recipient, amount0);
        if (amount1 > 0) IERC20(pool.token1).safeTransfer(recipient, amount1);

        emit TokensCollected(params.tokenId, recipient, amount0, amount1);
    }

    /**
     * @notice Burn an empty position NFT
     * @dev Only works if liquidity == 0 and no tokens owed
     * @param tokenId The NFT to burn
     */
    function burn(uint256 tokenId)
        external
        isAuthorizedForToken(tokenId)
    {
        Position storage position = _positions[tokenId];
        if (position.liquidity != 0) revert PositionNotEmpty();

        IVibeAMM.Pool memory pool = vibeAMM.getPool(position.poolId);
        if (_tokensOwed[tokenId][pool.token0] != 0 || _tokensOwed[tokenId][pool.token1] != 0) {
            revert TokensStillOwed();
        }

        // Clean up storage
        delete _positions[tokenId];

        // Burn the NFT (triggers _update which handles _ownedTokens)
        _burn(tokenId);

        emit PositionBurned(tokenId);
    }

    // ============ View Functions ============

    /// @notice Get full position data for a token ID
    function getPosition(uint256 tokenId) external view returns (Position memory) {
        _requireOwned(tokenId);
        return _positions[tokenId];
    }

    /// @notice Get current value of a position (proportional share of reserves)
    function getPositionValue(uint256 tokenId)
        external
        view
        returns (uint256 amount0, uint256 amount1)
    {
        _requireOwned(tokenId);
        Position memory position = _positions[tokenId];
        IVibeAMM.Pool memory pool = vibeAMM.getPool(position.poolId);

        if (pool.totalLiquidity == 0) return (0, 0);

        amount0 = (position.liquidity * pool.reserve0) / pool.totalLiquidity;
        amount1 = (position.liquidity * pool.reserve1) / pool.totalLiquidity;
    }

    /// @notice Get estimated fees earned (current value minus deposited, clamped to 0)
    function getFeesEarned(uint256 tokenId)
        external
        view
        returns (uint256 fees0, uint256 fees1)
    {
        _requireOwned(tokenId);
        Position memory position = _positions[tokenId];
        IVibeAMM.Pool memory pool = vibeAMM.getPool(position.poolId);

        if (pool.totalLiquidity == 0) return (0, 0);

        uint256 currentValue0 = (position.liquidity * pool.reserve0) / pool.totalLiquidity;
        uint256 currentValue1 = (position.liquidity * pool.reserve1) / pool.totalLiquidity;

        fees0 = currentValue0 > position.amount0Deposited ? currentValue0 - position.amount0Deposited : 0;
        fees1 = currentValue1 > position.amount1Deposited ? currentValue1 - position.amount1Deposited : 0;
    }

    /// @notice Get all token IDs owned by an address
    function getPositionsByOwner(address owner) external view returns (uint256[] memory) {
        return _ownedTokens[owner];
    }

    /// @notice Get tokens owed for a position (from decreaseLiquidity)
    function getTokensOwed(uint256 tokenId)
        external
        view
        returns (uint256 amount0Owed, uint256 amount1Owed)
    {
        Position memory position = _positions[tokenId];
        IVibeAMM.Pool memory pool = vibeAMM.getPool(position.poolId);
        amount0Owed = _tokensOwed[tokenId][pool.token0];
        amount1Owed = _tokensOwed[tokenId][pool.token1];
    }

    /// @notice Total positions ever minted
    function totalPositions() external view returns (uint256) {
        return _totalPositions;
    }

    // ============ Internal Functions ============

    /**
     * @notice Override ERC721 _update to track _ownedTokens on transfers
     * @dev Called on mint, burn, and transfer
     */
    function _update(address to, uint256 tokenId, address auth)
        internal
        override
        returns (address)
    {
        address from = super._update(to, tokenId, auth);

        // Remove from previous owner's list (not a mint)
        if (from != address(0)) {
            _removeFromOwnedTokens(from, tokenId);
        }

        // Add to new owner's list (not a burn)
        if (to != address(0)) {
            _ownedTokenIndex[tokenId] = _ownedTokens[to].length;
            _ownedTokens[to].push(tokenId);
        }

        return from;
    }

    /**
     * @notice Remove a token ID from an owner's array (O(1) swap-and-pop)
     */
    function _removeFromOwnedTokens(address owner, uint256 tokenId) internal {
        uint256 idx = _ownedTokenIndex[tokenId];
        uint256 lastIdx = _ownedTokens[owner].length - 1;

        if (idx != lastIdx) {
            uint256 lastTokenId = _ownedTokens[owner][lastIdx];
            _ownedTokens[owner][idx] = lastTokenId;
            _ownedTokenIndex[lastTokenId] = idx;
        }

        _ownedTokens[owner].pop();
        delete _ownedTokenIndex[tokenId];
    }
}
