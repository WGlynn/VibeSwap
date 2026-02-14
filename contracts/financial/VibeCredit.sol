// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/token/ERC721/ERC721.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "./interfaces/IVibeCredit.sol";
import "../oracle/IReputationOracle.sol";

/**
 * @title VibeCredit
 * @notice P2P reputation-gated credit delegation — ERC-721 NFTs representing
 *         transferable lending positions with undercollateralised borrowing.
 * @dev Part of VSOS (VibeSwap Operating System) Financial Primitives.
 *
 *      Delegators deposit tokens and mint a credit line NFT. Borrowers draw funds
 *      up to a limit determined by their ReputationOracle trust tier (0-4).
 *      Interest accrues per-second on outstanding debt.
 *
 *      Liquidation triggers: trust tier drop, debt > credit limit, maturity + grace.
 *      Liquidators earn JUL keeper tips for maintaining system health.
 *
 *      NFT transfer = sell lending position. New owner inherits collateral + interest claims.
 *
 *      Lifecycle: create → borrow → repay → reclaim/close
 *      Or:        create → borrow → [default] → liquidate → reclaim
 */
contract VibeCredit is ERC721, Ownable, ReentrancyGuard, IVibeCredit {
    using SafeERC20 for IERC20;

    // ============ Constants ============

    uint256 private constant BPS = 10_000;
    uint256 private constant SECONDS_PER_YEAR = 31_557_600;
    uint256 private constant GRACE_PERIOD = 7 days;
    uint256 private constant JUL_BONUS_BPS = 500; // +5% LTV bonus for JUL-denominated lines
    uint256 private constant KEEPER_TIP = 10 ether; // JUL tip per liquidation

    // ============ LTV Table ============

    // Tier → LTV in BPS: 0=0%, 1=25%, 2=50%, 3=75%, 4=90%
    uint256 private constant LTV_TIER_0 = 0;
    uint256 private constant LTV_TIER_1 = 2500;
    uint256 private constant LTV_TIER_2 = 5000;
    uint256 private constant LTV_TIER_3 = 7500;
    uint256 private constant LTV_TIER_4 = 9000;

    // ============ State ============

    IERC20 public immutable julToken;
    IReputationOracle public immutable reputationOracle;

    uint256 private _nextCreditLineId = 1;
    uint256 private _totalCreditLines;
    uint256 public julRewardPool;

    mapping(uint256 => CreditLine) private _creditLines;
    mapping(address => uint256) private _borrowerDefaults;

    // ============ Constructor ============

    constructor(
        address _julToken,
        address _reputationOracle
    ) ERC721("VibeSwap Credit Line", "VCRED") Ownable(msg.sender) {
        if (_julToken == address(0)) revert ZeroAddress();
        if (_reputationOracle == address(0)) revert ZeroAddress();
        julToken = IERC20(_julToken);
        reputationOracle = IReputationOracle(_reputationOracle);
    }

    // ============ Delegator Functions ============

    /**
     * @notice Create a credit line — deposit tokens, mint NFT to delegator
     * @param params CreateCreditLineParams with borrower, token, amount, rate, tier, maturity
     * @return creditLineId The minted credit line NFT token ID
     */
    function createCreditLine(CreateCreditLineParams calldata params)
        external
        nonReentrant
        returns (uint256 creditLineId)
    {
        if (params.borrower == address(0)) revert ZeroAddress();
        if (params.token == address(0)) revert ZeroAddress();
        if (params.amount == 0) revert ZeroAmount();
        if (params.maturity <= uint40(block.timestamp)) revert InvalidMaturity();
        if (params.minTrustTier > 4) revert InvalidTier();

        creditLineId = _nextCreditLineId++;
        _totalCreditLines++;

        _creditLines[creditLineId] = CreditLine({
            delegator: msg.sender,
            state: CreditState.ACTIVE,
            minTrustTier: params.minTrustTier,
            borrower: params.borrower,
            createdAt: uint40(block.timestamp),
            maturity: params.maturity,
            token: params.token,
            lastAccrual: uint40(block.timestamp),
            interestRate: params.interestRate,
            principal: params.amount,
            borrowed: 0,
            tokensHeld: params.amount
        });

        IERC20(params.token).safeTransferFrom(msg.sender, address(this), params.amount);

        _mint(msg.sender, creditLineId);

        emit CreditLineCreated(
            creditLineId,
            msg.sender,
            params.borrower,
            params.token,
            params.amount,
            params.interestRate,
            params.minTrustTier,
            params.maturity
        );
    }

    /**
     * @notice Reclaim remaining tokens after credit line is REPAID or DEFAULTED
     * @param creditLineId The credit line NFT ID
     */
    function reclaimCollateral(uint256 creditLineId) external nonReentrant {
        CreditLine storage cl = _creditLines[creditLineId];
        if (cl.delegator != msg.sender) revert NotDelegator();
        if (cl.state != CreditState.REPAID && cl.state != CreditState.DEFAULTED) {
            revert NotRepaidOrDefaulted();
        }

        uint256 amount = cl.tokensHeld;
        if (amount == 0) revert ZeroAmount();

        cl.tokensHeld = 0;
        cl.state = CreditState.CLOSED;

        IERC20(cl.token).safeTransfer(msg.sender, amount);

        emit CollateralReclaimed(creditLineId, msg.sender, amount);
    }

    /**
     * @notice Close an expired credit line with no outstanding debt
     * @param creditLineId The credit line NFT ID
     */
    function closeCreditLine(uint256 creditLineId) external nonReentrant {
        CreditLine storage cl = _creditLines[creditLineId];
        if (cl.delegator != msg.sender) revert NotDelegator();
        if (cl.state != CreditState.ACTIVE) revert NotActiveState();
        if (cl.borrowed > 0) revert HasOutstandingDebt();

        uint256 amount = cl.tokensHeld;
        cl.tokensHeld = 0;
        cl.state = CreditState.CLOSED;

        if (amount > 0) {
            IERC20(cl.token).safeTransfer(msg.sender, amount);
        }

        emit CreditLineClosed(creditLineId, msg.sender);
    }

    // ============ Borrower Functions ============

    /**
     * @notice Draw tokens from a credit line up to the credit limit
     * @param creditLineId The credit line NFT ID
     * @param amount Tokens to borrow
     */
    function borrow(uint256 creditLineId, uint256 amount) external nonReentrant {
        CreditLine storage cl = _creditLines[creditLineId];
        if (cl.state != CreditState.ACTIVE) revert NotActiveState();
        if (cl.borrower != msg.sender) revert NotBorrower();
        if (amount == 0) revert ZeroAmount();
        if (uint40(block.timestamp) > cl.maturity) revert PastMaturity();

        // Check reputation
        uint8 currentTier = reputationOracle.getTrustTier(msg.sender);
        if (currentTier < cl.minTrustTier) revert InsufficientReputation();

        // Accrue interest before changing state
        _accrueInterest(creditLineId);

        // Check credit limit
        uint256 limit = _creditLimit(creditLineId, currentTier);
        if (cl.borrowed + amount > limit) revert ExceedsCreditLimit();

        cl.borrowed += amount;
        cl.tokensHeld -= amount;

        IERC20(cl.token).safeTransfer(msg.sender, amount);

        emit Borrowed(creditLineId, msg.sender, amount);
    }

    /**
     * @notice Repay outstanding debt — interest paid first, then principal
     * @param creditLineId The credit line NFT ID
     * @param amount Tokens to repay
     */
    function repay(uint256 creditLineId, uint256 amount) external nonReentrant {
        CreditLine storage cl = _creditLines[creditLineId];
        if (cl.state != CreditState.ACTIVE) revert NotActiveState();
        if (amount == 0) revert ZeroAmount();

        // Accrue interest before repayment
        _accrueInterest(creditLineId);

        if (cl.borrowed == 0) revert NothingToRepay();

        // Cap repayment to outstanding debt
        if (amount > cl.borrowed) {
            amount = cl.borrowed;
        }

        cl.borrowed -= amount;
        cl.tokensHeld += amount;

        IERC20(cl.token).safeTransferFrom(msg.sender, address(this), amount);

        uint256 remainingDebt = cl.borrowed;
        emit Repaid(creditLineId, msg.sender, amount, remainingDebt);

        // Full repayment → REPAID
        if (remainingDebt == 0) {
            cl.state = CreditState.REPAID;
            emit CreditLineRepaid(creditLineId);
        }
    }

    // ============ Keeper Functions ============

    /**
     * @notice Liquidate a defaulting credit line — earn JUL keeper tip
     * @param creditLineId The credit line NFT ID
     */
    function liquidate(uint256 creditLineId) external nonReentrant {
        if (!isLiquidatable(creditLineId)) revert NotLiquidatable();

        CreditLine storage cl = _creditLines[creditLineId];

        // Accrue final interest
        _accrueInterest(creditLineId);

        uint256 remainingTokens = cl.tokensHeld;
        uint256 badDebt = cl.borrowed > remainingTokens
            ? cl.borrowed - remainingTokens
            : 0;

        cl.state = CreditState.DEFAULTED;
        _borrowerDefaults[cl.borrower]++;

        emit CreditLineLiquidated(
            creditLineId,
            msg.sender,
            cl.borrower,
            remainingTokens,
            badDebt
        );

        // Pay JUL keeper tip
        if (julRewardPool >= KEEPER_TIP) {
            julRewardPool -= KEEPER_TIP;
            julToken.safeTransfer(msg.sender, KEEPER_TIP);
        }
    }

    // ============ Admin Functions ============

    /**
     * @notice Deposit JUL into the keeper reward pool
     * @param amount JUL tokens to deposit
     */
    function depositJulRewards(uint256 amount) external nonReentrant {
        if (amount == 0) revert ZeroAmount();
        julRewardPool += amount;
        julToken.safeTransferFrom(msg.sender, address(this), amount);
        emit JulRewardsDeposited(msg.sender, amount);
    }

    // ============ View Functions ============

    /**
     * @notice Get full credit line data
     */
    function getCreditLine(uint256 creditLineId) external view returns (CreditLine memory) {
        return _creditLines[creditLineId];
    }

    /**
     * @notice Current credit limit based on borrower's live trust tier
     */
    function creditLimit(uint256 creditLineId) external view returns (uint256) {
        CreditLine storage cl = _creditLines[creditLineId];
        uint8 currentTier = reputationOracle.getTrustTier(cl.borrower);
        return _creditLimit(creditLineId, currentTier);
    }

    /**
     * @notice Total outstanding debt including unaccrued interest
     */
    function totalDebt(uint256 creditLineId) external view returns (uint256) {
        CreditLine storage cl = _creditLines[creditLineId];
        return cl.borrowed + _pendingInterest(creditLineId);
    }

    /**
     * @notice Unaccrued interest since last interaction
     */
    function accruedInterest(uint256 creditLineId) external view returns (uint256) {
        return _pendingInterest(creditLineId);
    }

    /**
     * @notice Check if a credit line can be liquidated
     */
    function isLiquidatable(uint256 creditLineId) public view returns (bool) {
        CreditLine storage cl = _creditLines[creditLineId];
        if (cl.state != CreditState.ACTIVE) return false;
        if (cl.borrowed == 0) return false;

        uint256 currentDebt = cl.borrowed + _pendingInterest(creditLineId);

        // Condition 1: trust tier dropped below minimum
        uint8 currentTier = reputationOracle.getTrustTier(cl.borrower);
        if (currentTier < cl.minTrustTier) return true;

        // Condition 2: debt exceeds credit limit
        uint256 limit = _creditLimit(creditLineId, currentTier);
        if (currentDebt > limit) return true;

        // Condition 3: past maturity + grace period with outstanding debt
        if (block.timestamp > uint256(cl.maturity) + GRACE_PERIOD) return true;

        return false;
    }

    /**
     * @notice Number of times a borrower has been liquidated
     */
    function borrowerDefaults(address borrower) external view returns (uint256) {
        return _borrowerDefaults[borrower];
    }

    /**
     * @notice LTV in BPS for a given trust tier
     */
    function ltvForTier(uint8 tier) external pure returns (uint256) {
        return _ltvForTier(tier);
    }

    /**
     * @notice Total credit lines ever created
     */
    function totalCreditLines() external view returns (uint256) {
        return _totalCreditLines;
    }

    // ============ Internal ============

    /**
     * @notice Accrue per-second interest on outstanding debt
     */
    function _accrueInterest(uint256 creditLineId) internal {
        CreditLine storage cl = _creditLines[creditLineId];
        if (cl.borrowed == 0 || cl.lastAccrual >= uint40(block.timestamp)) {
            cl.lastAccrual = uint40(block.timestamp);
            return;
        }

        uint256 elapsed = uint256(uint40(block.timestamp)) - uint256(cl.lastAccrual);
        uint256 interest = (cl.borrowed * uint256(cl.interestRate) * elapsed)
            / (BPS * SECONDS_PER_YEAR);

        if (interest > 0) {
            cl.borrowed += interest;
            emit InterestAccrued(creditLineId, interest, cl.borrowed);
        }

        cl.lastAccrual = uint40(block.timestamp);
    }

    /**
     * @notice Compute pending interest without modifying state (for views)
     */
    function _pendingInterest(uint256 creditLineId) internal view returns (uint256) {
        CreditLine storage cl = _creditLines[creditLineId];
        if (cl.borrowed == 0 || cl.lastAccrual >= uint40(block.timestamp)) return 0;

        uint256 elapsed = uint256(uint40(block.timestamp)) - uint256(cl.lastAccrual);
        return (cl.borrowed * uint256(cl.interestRate) * elapsed)
            / (BPS * SECONDS_PER_YEAR);
    }

    /**
     * @notice Internal credit limit calculation with JUL bonus
     */
    function _creditLimit(uint256 creditLineId, uint8 tier) internal view returns (uint256) {
        CreditLine storage cl = _creditLines[creditLineId];
        uint256 ltv = _ltvForTier(tier);

        // JUL-denominated lines get bonus LTV
        if (cl.token == address(julToken)) {
            ltv += JUL_BONUS_BPS;
            if (ltv > BPS) ltv = BPS; // cap at 100%
        }

        return (cl.principal * ltv) / BPS;
    }

    /**
     * @notice Pure LTV lookup by tier
     */
    function _ltvForTier(uint8 tier) internal pure returns (uint256) {
        if (tier == 0) return LTV_TIER_0;
        if (tier == 1) return LTV_TIER_1;
        if (tier == 2) return LTV_TIER_2;
        if (tier == 3) return LTV_TIER_3;
        if (tier == 4) return LTV_TIER_4;
        return LTV_TIER_0;
    }

    // ============ ERC721 Overrides ============

    /**
     * @notice Update delegator on transfer — new owner inherits lending position
     */
    function _update(address to, uint256 tokenId, address auth)
        internal
        override
        returns (address)
    {
        address from = super._update(to, tokenId, auth);

        // Update delegator on transfer (not mint or burn)
        if (from != address(0) && to != address(0)) {
            _creditLines[tokenId].delegator = to;
        }

        return from;
    }
}
