// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/token/ERC721/ERC721.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "./interfaces/IVibeInsurance.sol";
import "../oracle/IReputationOracle.sol";

/**
 * @title VibeInsurance
 * @notice Parametric insurance + prediction market primitive — ERC-721 policies
 *         as tradeable Arrow-Debreu securities with mutualized risk pools.
 * @dev Part of VSOS (VibeSwap Operating System) Financial Primitives.
 *
 *      Dual-framing: every insurance market is simultaneously a prediction market.
 *        - buyPolicy()  = buy YES shares (pay premium, profit if trigger fires)
 *        - underwrite() = sell NO shares (earn premiums, lose if trigger fires)
 *
 *      Parametric triggers solve the 3 classic insurance market failures:
 *        1. Adverse selection → universal triggers, not individual risk profiles
 *        2. Moral hazard → payouts from oracle data, behavior can't influence trigger
 *        3. Information asymmetry → on-chain reserves, terms, and trust scores
 *
 *      Co-op capitalist mechanics:
 *        - ReputationOracle trust tiers gate premium discounts (community reward)
 *        - JUL collateral bonus (protocol-native currency incentive)
 *        - Underwriter capital mutualized across the pool
 *        - Liquidation-free: payouts come from pool, no forced seizure
 *        - Transparent on-chain solvency (anyone can verify reserves)
 *
 *      Lifecycle: createMarket → underwrite → buyPolicy → resolveMarket →
 *                 claimPayout / withdrawCapital → settleMarket
 */
contract VibeInsurance is ERC721, Ownable, ReentrancyGuard, IVibeInsurance {
    using SafeERC20 for IERC20;

    // ============ Constants ============

    uint256 private constant BPS = 10_000;
    uint256 private constant MAX_MARKETS = 255;
    uint256 private constant SETTLEMENT_GRACE = 30 days;
    uint256 private constant KEEPER_TIP = 10 ether;
    uint256 private constant JUL_DISCOUNT_BPS = 500; // +5% premium discount for JUL collateral

    // Reputation tier → premium discount in BPS
    uint256 private constant TIER_0_DISCOUNT = 0;
    uint256 private constant TIER_1_DISCOUNT = 500;
    uint256 private constant TIER_2_DISCOUNT = 1000;
    uint256 private constant TIER_3_DISCOUNT = 1500;
    uint256 private constant TIER_4_DISCOUNT = 2000;

    // ============ State ============

    IERC20 public immutable julToken;
    IERC20 public immutable collateralToken;
    IReputationOracle public immutable reputationOracle;

    uint256 private _nextPolicyId = 1;
    uint256 private _totalPolicies;
    uint8 private _totalMarkets;
    uint256 public julRewardPool;

    mapping(uint8 => InsuranceMarket) private _markets;
    mapping(uint256 => Policy) private _policies;
    mapping(uint8 => mapping(address => uint256)) private _underwriterDeposits;
    mapping(uint8 => mapping(address => bool)) private _underwriterWithdrawn;
    mapping(uint8 => uint40) private _resolvedAt; // timestamp of resolution
    mapping(address => bool) public authorizedResolvers;

    // ============ Constructor ============

    constructor(
        address _julToken,
        address _reputationOracle,
        address _collateralToken
    ) ERC721("VibeSwap Insurance Policy", "VINS") Ownable(msg.sender) {
        if (_julToken == address(0)) revert ZeroAddress();
        if (_reputationOracle == address(0)) revert ZeroAddress();
        if (_collateralToken == address(0)) revert ZeroAddress();
        julToken = IERC20(_julToken);
        reputationOracle = IReputationOracle(_reputationOracle);
        collateralToken = IERC20(_collateralToken);
    }

    // ============ Admin Functions ============

    /**
     * @notice Create a new insurance market (parametric risk definition)
     * @param params Market parameters including trigger type, window, premium rate
     * @return marketId The assigned market ID (0-254)
     */
    function createMarket(CreateMarketParams calldata params)
        external
        onlyOwner
        returns (uint8 marketId)
    {
        if (_totalMarkets >= MAX_MARKETS) revert MaxMarketsReached();
        if (params.windowEnd <= params.windowStart) revert InvalidWindow();
        if (params.windowStart < uint40(block.timestamp)) revert InvalidWindow();
        if (params.premiumBps == 0 || params.premiumBps >= uint16(BPS)) revert InvalidPremiumRate();

        marketId = _totalMarkets++;

        _markets[marketId] = InsuranceMarket({
            description: params.description,
            triggerType: params.triggerType,
            triggerData: params.triggerData,
            windowStart: params.windowStart,
            windowEnd: params.windowEnd,
            premiumBps: params.premiumBps,
            state: MarketState.OPEN,
            triggered: false,
            totalCapital: 0,
            totalCoverage: 0,
            totalPremiums: 0,
            totalClaimed: 0
        });

        emit MarketCreated(
            marketId,
            params.description,
            params.triggerType,
            params.windowEnd,
            params.premiumBps
        );
    }

    /**
     * @notice Resolve a market after window expires — authorized resolver declares outcome
     * @param marketId The market to resolve
     * @param triggered Whether the parametric trigger fired
     */
    function resolveMarket(uint8 marketId, bool triggered) external {
        if (!authorizedResolvers[msg.sender] && msg.sender != owner()) {
            revert NotAuthorizedResolver();
        }
        if (marketId >= _totalMarkets) revert InvalidMarket();

        InsuranceMarket storage mkt = _markets[marketId];
        if (mkt.state != MarketState.OPEN) revert MarketAlreadyResolved();
        if (uint40(block.timestamp) < mkt.windowEnd) revert WindowNotExpired();

        mkt.state = MarketState.RESOLVED;
        mkt.triggered = triggered;
        _resolvedAt[marketId] = uint40(block.timestamp);

        emit MarketResolved(marketId, triggered);

        // Keeper tip for resolver
        if (julRewardPool >= KEEPER_TIP) {
            julRewardPool -= KEEPER_TIP;
            julToken.safeTransfer(msg.sender, KEEPER_TIP);
        }
    }

    /**
     * @notice Settle a market after the grace period — finalizes the market
     * @param marketId The market to settle
     */
    function settleMarket(uint8 marketId) external {
        if (marketId >= _totalMarkets) revert InvalidMarket();
        InsuranceMarket storage mkt = _markets[marketId];
        if (mkt.state != MarketState.RESOLVED) revert MarketNotResolved();
        if (block.timestamp < uint256(_resolvedAt[marketId]) + SETTLEMENT_GRACE) {
            revert SettlementNotReady();
        }

        mkt.state = MarketState.SETTLED;
        emit MarketSettled(marketId);
    }

    /**
     * @notice Authorize or revoke a trigger resolver
     */
    function setTriggerResolver(address resolver, bool authorized) external onlyOwner {
        if (resolver == address(0)) revert ZeroAddress();
        authorizedResolvers[resolver] = authorized;
        emit TriggerResolverUpdated(resolver, authorized);
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

    // ============ Underwriter Functions ============

    /**
     * @notice Deposit capital to back insurance policies (= sell NO shares)
     * @param marketId The market to underwrite
     * @param amount Collateral to deposit
     */
    function underwrite(uint8 marketId, uint256 amount) external nonReentrant {
        if (marketId >= _totalMarkets) revert InvalidMarket();
        if (amount == 0) revert ZeroAmount();

        InsuranceMarket storage mkt = _markets[marketId];
        if (mkt.state != MarketState.OPEN) revert MarketNotOpen();

        mkt.totalCapital += amount;
        _underwriterDeposits[marketId][msg.sender] += amount;

        collateralToken.safeTransferFrom(msg.sender, address(this), amount);

        emit CapitalDeposited(marketId, msg.sender, amount);
    }

    /**
     * @notice Withdraw capital + premium share after market resolution
     * @dev If triggered: get remaining capital pro-rata after claims
     *      If not triggered: get full capital + proportional premium share
     */
    function withdrawCapital(uint8 marketId) external nonReentrant {
        if (marketId >= _totalMarkets) revert InvalidMarket();

        InsuranceMarket storage mkt = _markets[marketId];
        if (mkt.state == MarketState.OPEN) revert MarketNotResolved();

        uint256 deposit = _underwriterDeposits[marketId][msg.sender];
        if (deposit == 0) revert NothingToWithdraw();
        if (_underwriterWithdrawn[marketId][msg.sender]) revert NothingToWithdraw();

        // If triggered, must wait for settlement grace period
        if (mkt.triggered && mkt.state != MarketState.SETTLED) revert SettlementNotReady();

        _underwriterWithdrawn[marketId][msg.sender] = true;

        uint256 payout = _calcUnderwriterPayout(marketId, deposit);

        if (payout > 0) {
            collateralToken.safeTransfer(msg.sender, payout);
        }

        uint256 premiumShare = payout > deposit ? payout - deposit : 0;
        emit CapitalWithdrawn(marketId, msg.sender, deposit, premiumShare);
    }

    // ============ Policyholder Functions ============

    /**
     * @notice Buy an insurance policy (= buy YES shares in prediction market)
     * @param marketId The market to buy coverage from
     * @param coverage The coverage amount (max payout if triggered)
     * @return policyId The minted policy NFT token ID
     */
    function buyPolicy(uint8 marketId, uint256 coverage)
        external
        nonReentrant
        returns (uint256 policyId)
    {
        if (marketId >= _totalMarkets) revert InvalidMarket();
        if (coverage == 0) revert ZeroAmount();

        InsuranceMarket storage mkt = _markets[marketId];
        if (mkt.state != MarketState.OPEN) revert MarketNotOpen();

        // Check pool capacity: totalCoverage <= totalCapital
        if (mkt.totalCoverage + coverage > mkt.totalCapital) revert InsufficientPoolCapacity();

        // Calculate reputation-discounted premium
        uint256 premium = _effectivePremium(marketId, coverage, msg.sender);

        policyId = _nextPolicyId++;
        _totalPolicies++;

        _policies[policyId] = Policy({
            holder: msg.sender,
            state: PolicyState.ACTIVE,
            marketId: marketId,
            createdAt: uint40(block.timestamp),
            expiry: mkt.windowEnd,
            coverage: coverage,
            premiumPaid: premium
        });

        mkt.totalCoverage += coverage;
        mkt.totalPremiums += premium;

        collateralToken.safeTransferFrom(msg.sender, address(this), premium);
        _mint(msg.sender, policyId);

        emit PolicyPurchased(policyId, marketId, msg.sender, coverage, premium);
    }

    /**
     * @notice Claim payout on a triggered policy
     * @param policyId The policy NFT ID
     */
    function claimPayout(uint256 policyId) external nonReentrant {
        Policy storage pol = _policies[policyId];
        if (pol.holder != msg.sender) revert NotPolicyHolder();
        if (pol.state != PolicyState.ACTIVE) revert NotActivePolicy();

        InsuranceMarket storage mkt = _markets[pol.marketId];
        if (mkt.state == MarketState.OPEN) revert MarketNotResolved();
        if (!mkt.triggered) revert PolicyNotTriggered();

        uint256 payout = _calcPolicyPayout(policyId);
        pol.state = PolicyState.CLAIMED;
        mkt.totalClaimed += payout;

        if (payout > 0) {
            collateralToken.safeTransfer(msg.sender, payout);
        }

        emit PayoutClaimed(policyId, msg.sender, payout);
    }

    // ============ View Functions ============

    function getMarket(uint8 marketId) external view returns (InsuranceMarket memory) {
        return _markets[marketId];
    }

    function getPolicy(uint256 policyId) external view returns (Policy memory) {
        return _policies[policyId];
    }

    /**
     * @notice Calculate reputation-discounted premium for a coverage amount
     */
    function effectivePremium(uint8 marketId, uint256 coverage, address user)
        external
        view
        returns (uint256)
    {
        return _effectivePremium(marketId, coverage, user);
    }

    /**
     * @notice Potential payout for a policy (if market triggered)
     */
    function policyPayout(uint256 policyId) external view returns (uint256) {
        return _calcPolicyPayout(policyId);
    }

    /**
     * @notice Potential payout for an underwriter (depends on resolution)
     */
    function underwriterPayout(uint8 marketId, address underwriter) external view returns (uint256) {
        uint256 deposit = _underwriterDeposits[marketId][underwriter];
        if (deposit == 0 || _underwriterWithdrawn[marketId][underwriter]) return 0;
        return _calcUnderwriterPayout(marketId, deposit);
    }

    function underwriterPosition(uint8 marketId, address underwriter) external view returns (uint256) {
        return _underwriterDeposits[marketId][underwriter];
    }

    function availableCapacity(uint8 marketId) external view returns (uint256) {
        InsuranceMarket storage mkt = _markets[marketId];
        if (mkt.totalCapital <= mkt.totalCoverage) return 0;
        return mkt.totalCapital - mkt.totalCoverage;
    }

    function totalMarkets() external view returns (uint8) {
        return _totalMarkets;
    }

    function totalPolicies() external view returns (uint256) {
        return _totalPolicies;
    }

    // ============ Internal ============

    /**
     * @notice Calculate payout for a single policy
     * @dev Pro-rata if pool insufficient (safety — shouldn't happen with capacity check)
     */
    function _calcPolicyPayout(uint256 policyId) internal view returns (uint256) {
        Policy storage pol = _policies[policyId];
        InsuranceMarket storage mkt = _markets[pol.marketId];

        if (!mkt.triggered) return 0;
        if (pol.state != PolicyState.ACTIVE) return 0;

        uint256 poolTotal = mkt.totalCapital + mkt.totalPremiums;
        if (mkt.totalCoverage <= poolTotal) {
            return pol.coverage;
        }
        // Pro-rata fallback
        return (pol.coverage * poolTotal) / mkt.totalCoverage;
    }

    /**
     * @notice Calculate underwriter withdrawal amount
     * @dev If triggered: pro-rata share of (pool - claims)
     *      If not triggered: original deposit + pro-rata premium share
     */
    function _calcUnderwriterPayout(uint8 marketId, uint256 deposit)
        internal
        view
        returns (uint256)
    {
        InsuranceMarket storage mkt = _markets[marketId];

        if (mkt.triggered) {
            // After trigger: whatever remains after claims
            uint256 poolTotal = mkt.totalCapital + mkt.totalPremiums;
            uint256 remaining = poolTotal > mkt.totalClaimed
                ? poolTotal - mkt.totalClaimed
                : 0;
            return (remaining * deposit) / mkt.totalCapital;
        } else {
            // No trigger: capital back + proportional premium share
            uint256 premiumShare = mkt.totalCapital > 0
                ? (mkt.totalPremiums * deposit) / mkt.totalCapital
                : 0;
            return deposit + premiumShare;
        }
    }

    /**
     * @notice Calculate premium with reputation discount + JUL bonus
     */
    function _effectivePremium(uint8 marketId, uint256 coverage, address user)
        internal
        view
        returns (uint256)
    {
        InsuranceMarket storage mkt = _markets[marketId];
        uint256 basePremium = (coverage * uint256(mkt.premiumBps)) / BPS;

        // Reputation discount
        uint8 tier = reputationOracle.getTrustTier(user);
        uint256 discountBps = _tierDiscount(tier);

        // JUL collateral bonus
        if (address(collateralToken) == address(julToken)) {
            discountBps += JUL_DISCOUNT_BPS;
        }

        // Cap discount at 50% (never free insurance)
        if (discountBps > 5000) discountBps = 5000;

        return basePremium - (basePremium * discountBps) / BPS;
    }

    /**
     * @notice Reputation tier → premium discount in BPS
     */
    function _tierDiscount(uint8 tier) internal pure returns (uint256) {
        if (tier == 0) return TIER_0_DISCOUNT;
        if (tier == 1) return TIER_1_DISCOUNT;
        if (tier == 2) return TIER_2_DISCOUNT;
        if (tier == 3) return TIER_3_DISCOUNT;
        if (tier == 4) return TIER_4_DISCOUNT;
        return TIER_0_DISCOUNT;
    }

    // ============ ERC721 Overrides ============

    /**
     * @notice Update holder on transfer — new owner can claim payouts
     */
    function _update(address to, uint256 tokenId, address auth)
        internal
        override
        returns (address)
    {
        address from = super._update(to, tokenId, auth);

        if (from != address(0) && to != address(0)) {
            _policies[tokenId].holder = to;
        }

        return from;
    }
}
