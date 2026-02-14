// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/**
 * @title IVibeInsurance
 * @notice Interface for parametric insurance + prediction market primitive —
 *         ERC-721 policies as tradeable Arrow-Debreu securities.
 *
 *         Part of VSOS (VibeSwap Operating System) Financial Primitives.
 *
 *         Dual-framing design: every insurance policy IS a prediction market position.
 *           - buyPolicy()  = buy YES shares (pay premium, get coverage if event fires)
 *           - underwrite() = sell NO shares (earn premium, lose capital if event fires)
 *
 *         Parametric triggers solve the 3 classic insurance market failures:
 *           1. Adverse selection → triggers are universal (price feeds), not individual
 *           2. Moral hazard → payouts depend on oracle data, not user behavior
 *           3. Information asymmetry → all pool reserves + terms on-chain, auditable
 *
 *         Co-op capitalist: reputation-gated premium discounts, mutualized risk pools,
 *         JUL keeper tips, transparent on-chain solvency.
 */
interface IVibeInsurance {
    // ============ Enums ============

    /// @notice What kind of parametric trigger
    enum TriggerType {
        PRICE_DROP,       // Asset price drops > X% in window
        PRICE_SPIKE,      // Asset price rises > X% in window
        DEPEG,            // Stablecoin deviates > X% from peg
        VOLATILITY,       // Volatility exceeds threshold
        CUSTOM            // Generic oracle-resolved trigger
    }

    enum MarketState {
        OPEN,             // Accepting underwriting + policy purchases
        RESOLVED,         // Trigger checked, claims/withdrawals active
        SETTLED           // Grace period over, market finalized
    }

    enum PolicyState {
        ACTIVE,           // Coverage live
        CLAIMED,          // Payout collected
        EXPIRED           // Market resolved without trigger (no payout)
    }

    // ============ Structs ============

    /// @notice Insurance market definition (a specific risk being covered)
    struct InsuranceMarket {
        string description;             // human-readable trigger description
        TriggerType triggerType;        // what kind of risk
        bytes32 triggerData;            // encoded: asset, threshold, direction
        uint40 windowStart;             // coverage window start
        uint40 windowEnd;               // coverage window end
        uint16 premiumBps;              // base premium rate per coverage unit
        MarketState state;
        bool triggered;                 // did the event fire
        uint256 totalCapital;           // underwriter deposits
        uint256 totalCoverage;          // sum of active policy coverage
        uint256 totalPremiums;          // sum of premiums collected
        uint256 totalClaimed;           // sum of payouts claimed
    }

    /// @notice Individual insurance policy — ERC-721
    struct Policy {
        // Slot 0 (22/32 bytes)
        address holder;             // 20 bytes — policyholder
        PolicyState state;          // 1 byte
        uint8 marketId;             // 1 byte — which market

        // Slot 1 (10/32 bytes)
        uint40 createdAt;           // 5 bytes
        uint40 expiry;              // 5 bytes (= market.windowEnd)

        // Slot 2 (32/32 bytes)
        uint256 coverage;           // max payout if triggered

        // Slot 3 (32/32 bytes)
        uint256 premiumPaid;        // actual premium paid
    }

    /// @notice Parameters for creating a new insurance market
    struct CreateMarketParams {
        string description;
        TriggerType triggerType;
        bytes32 triggerData;
        uint40 windowStart;
        uint40 windowEnd;
        uint16 premiumBps;
    }

    // ============ Events ============

    event MarketCreated(
        uint8 indexed marketId,
        string description,
        TriggerType triggerType,
        uint40 windowEnd,
        uint16 premiumBps
    );

    event CapitalDeposited(
        uint8 indexed marketId,
        address indexed underwriter,
        uint256 amount
    );

    event CapitalWithdrawn(
        uint8 indexed marketId,
        address indexed underwriter,
        uint256 capital,
        uint256 premiumShare
    );

    event PolicyPurchased(
        uint256 indexed policyId,
        uint8 indexed marketId,
        address indexed holder,
        uint256 coverage,
        uint256 premium
    );

    event PayoutClaimed(
        uint256 indexed policyId,
        address indexed holder,
        uint256 amount
    );

    event MarketResolved(uint8 indexed marketId, bool triggered);
    event MarketSettled(uint8 indexed marketId);
    event JulRewardsDeposited(address indexed depositor, uint256 amount);
    event TriggerResolverUpdated(address indexed resolver, bool authorized);

    // ============ Errors ============

    error ZeroAddress();
    error ZeroAmount();
    error InvalidWindow();
    error InvalidPremiumRate();
    error MaxMarketsReached();
    error MarketNotOpen();
    error MarketNotResolved();
    error MarketAlreadyResolved();
    error InsufficientPoolCapacity();
    error NotPolicyHolder();
    error NotActivePolicy();
    error PolicyNotTriggered();
    error NothingToWithdraw();
    error NotAuthorizedResolver();
    error WindowNotExpired();
    error InvalidMarket();
    error SettlementNotReady();

    // ============ Admin Functions ============

    function createMarket(CreateMarketParams calldata params) external returns (uint8 marketId);
    function resolveMarket(uint8 marketId, bool triggered) external;
    function settleMarket(uint8 marketId) external;
    function setTriggerResolver(address resolver, bool authorized) external;
    function depositJulRewards(uint256 amount) external;

    // ============ Underwriter Functions ============

    function underwrite(uint8 marketId, uint256 amount) external;
    function withdrawCapital(uint8 marketId) external;

    // ============ Policyholder Functions ============

    function buyPolicy(uint8 marketId, uint256 coverage) external returns (uint256 policyId);
    function claimPayout(uint256 policyId) external;

    // ============ View Functions ============

    function getMarket(uint8 marketId) external view returns (InsuranceMarket memory);
    function getPolicy(uint256 policyId) external view returns (Policy memory);
    function effectivePremium(uint8 marketId, uint256 coverage, address user) external view returns (uint256);
    function policyPayout(uint256 policyId) external view returns (uint256);
    function underwriterPayout(uint8 marketId, address underwriter) external view returns (uint256);
    function underwriterPosition(uint8 marketId, address underwriter) external view returns (uint256);
    function availableCapacity(uint8 marketId) external view returns (uint256);
    function totalMarkets() external view returns (uint8);
    function totalPolicies() external view returns (uint256);
}
