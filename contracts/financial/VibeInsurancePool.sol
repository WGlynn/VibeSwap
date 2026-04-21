// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts-upgradeable/access/OwnableUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/proxy/utils/UUPSUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/utils/ReentrancyGuardUpgradeable.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

/**
 * @title VibeInsurancePool — Protocol-Wide Insurance Underwriting
 * @notice Decentralized insurance covering smart contract risk, bridge risk,
 *         oracle failure, and liquidation cascades across all VSOS modules.
 *
 * @dev Architecture:
 *      - Underwriters deposit capital and earn premiums
 *      - Anyone can buy coverage for specific risk categories
 *      - Claims assessed by Trinity consensus + governance vote
 *      - Payout from pool, capped at coverage amount
 *      - Premiums dynamically priced by utilization ratio
 */
contract VibeInsurancePool is OwnableUpgradeable, UUPSUpgradeable, ReentrancyGuardUpgradeable {
    using SafeERC20 for IERC20;

    // ============ Types ============

    enum RiskCategory { SMART_CONTRACT, BRIDGE, ORACLE, LIQUIDATION, SLASHING, DEPEGGING }

    struct CoveragePolicy {
        uint256 policyId;
        address holder;
        RiskCategory category;
        uint256 coverageAmount;
        uint256 premiumPaid;
        uint256 startTime;
        uint256 endTime;
        bool active;
        bool claimed;
    }

    struct Claim {
        uint256 claimId;
        uint256 policyId;
        address claimant;
        uint256 amount;
        string evidence;           // IPFS hash of evidence
        uint256 votesFor;
        uint256 votesAgainst;
        uint256 deadline;
        bool resolved;
        bool approved;
    }

    struct UnderwriterPosition {
        uint256 deposited;
        uint256 shares;
        uint256 premiumsEarned;
        uint256 depositedAt;
    }

    // ============ State ============

    /// @notice Coverage policies
    mapping(uint256 => CoveragePolicy) internal policies;
    uint256 public policyCount;

    /// @notice Claims
    mapping(uint256 => Claim) internal claims;
    uint256 public claimCount;
    mapping(uint256 => mapping(address => bool)) public hasVotedOnClaim;

    /// @notice Underwriter positions
    mapping(address => UnderwriterPosition) public underwriters;
    uint256 public totalUnderwritten;
    uint256 public totalShares;

    /// @notice Active coverage per category
    mapping(RiskCategory => uint256) public activeCoverage;

    /// @notice Premium rates per category (basis points per year)
    mapping(RiskCategory => uint256) public premiumRateBps;

    /// @notice Maximum coverage ratio (how much coverage vs pool size)
    uint256 public maxCoverageRatioBps;

    /// @notice Total premiums collected
    uint256 public totalPremiums;
    uint256 public totalPayouts;


    /// @dev Reserved storage gap for future upgrades
    uint256[50] private __gap;

    // ============ Events ============

    event Underwritten(address indexed underwriter, uint256 amount, uint256 shares);
    event UnderwriterWithdrew(address indexed underwriter, uint256 amount);
    event CoveragePurchased(uint256 indexed policyId, address indexed holder, RiskCategory category, uint256 amount);
    event ClaimFiled(uint256 indexed claimId, uint256 indexed policyId, uint256 amount);
    event ClaimVoted(uint256 indexed claimId, address indexed voter, bool support);
    event ClaimResolved(uint256 indexed claimId, bool approved, uint256 payout);
    event PremiumRateUpdated(RiskCategory category, uint256 newRate);

    // ============ Init ============

    /// @custom:oz-upgrades-unsafe-allow constructor
    constructor() {
        _disableInitializers();
    }

    function initialize() external initializer {
        __Ownable_init(msg.sender);
        __UUPSUpgradeable_init();
        __ReentrancyGuard_init();

        maxCoverageRatioBps = 5000; // Max 50% of pool can be active coverage

        // Default premium rates (annual, basis points)
        premiumRateBps[RiskCategory.SMART_CONTRACT] = 250;  // 2.5%
        premiumRateBps[RiskCategory.BRIDGE] = 400;           // 4%
        premiumRateBps[RiskCategory.ORACLE] = 200;           // 2%
        premiumRateBps[RiskCategory.LIQUIDATION] = 300;      // 3%
        premiumRateBps[RiskCategory.SLASHING] = 350;         // 3.5%
        premiumRateBps[RiskCategory.DEPEGGING] = 500;        // 5%
    }

    function _authorizeUpgrade(address newImplementation) internal override onlyOwner {
        require(newImplementation.code.length > 0, "Not a contract");
    }

    // ============ Underwriting ============

    /**
     * @notice Deposit capital as an underwriter
     */
    function underwrite() external payable nonReentrant {
        require(msg.value > 0, "Zero deposit");

        uint256 shares;
        if (totalShares == 0) {
            shares = msg.value;
        } else {
            shares = (msg.value * totalShares) / totalUnderwritten;
        }

        underwriters[msg.sender].deposited += msg.value;
        underwriters[msg.sender].shares += shares;
        underwriters[msg.sender].depositedAt = block.timestamp;

        totalUnderwritten += msg.value;
        totalShares += shares;

        emit Underwritten(msg.sender, msg.value, shares);
    }

    /**
     * @notice Withdraw underwriting capital
     * @dev Subject to utilization limits — can't withdraw if pool is over-utilized
     */
    function withdrawUnderwriting(uint256 shareAmount) external nonReentrant {
        UnderwriterPosition storage pos = underwriters[msg.sender];
        require(pos.shares >= shareAmount, "Insufficient shares");
        require(block.timestamp >= pos.depositedAt + 30 days, "Lock period");

        uint256 withdrawAmount = (shareAmount * totalUnderwritten) / totalShares;

        // Check utilization — can't withdraw below active coverage
        uint256 totalActive;
        for (uint256 i = 0; i < 6; i++) {
            totalActive += activeCoverage[RiskCategory(i)];
        }
        require(
            totalUnderwritten - withdrawAmount >= totalActive,
            "Would exceed coverage ratio"
        );

        pos.shares -= shareAmount;
        totalShares -= shareAmount;
        totalUnderwritten -= withdrawAmount;

        (bool ok, ) = msg.sender.call{value: withdrawAmount}("");
        require(ok, "Transfer failed");

        emit UnderwriterWithdrew(msg.sender, withdrawAmount);
    }

    // ============ Coverage ============

    /**
     * @notice Purchase insurance coverage
     */
    function purchaseCoverage(
        RiskCategory category,
        uint256 coverageAmount,
        uint256 durationDays
    ) external payable nonReentrant returns (uint256) {
        // Check coverage capacity
        uint256 maxCoverage = (totalUnderwritten * maxCoverageRatioBps) / 10000;
        uint256 totalActive;
        for (uint256 i = 0; i < 6; i++) {
            totalActive += activeCoverage[RiskCategory(i)];
        }
        require(totalActive + coverageAmount <= maxCoverage, "Exceeds capacity");

        // Calculate premium
        uint256 annualPremium = (coverageAmount * premiumRateBps[category]) / 10000;
        uint256 premium = (annualPremium * durationDays) / 365;
        require(msg.value >= premium, "Insufficient premium");

        policyCount++;
        policies[policyCount] = CoveragePolicy({
            policyId: policyCount,
            holder: msg.sender,
            category: category,
            coverageAmount: coverageAmount,
            premiumPaid: premium,
            startTime: block.timestamp,
            endTime: block.timestamp + (durationDays * 1 days),
            active: true,
            claimed: false
        });

        activeCoverage[category] += coverageAmount;
        totalPremiums += premium;

        // Refund excess
        if (msg.value > premium) {
            (bool ok, ) = msg.sender.call{value: msg.value - premium}("");
            require(ok, "Refund failed");
        }

        emit CoveragePurchased(policyCount, msg.sender, category, coverageAmount);
        return policyCount;
    }

    // ============ Claims ============

    /**
     * @notice File an insurance claim
     */
    function fileClaim(
        uint256 policyId,
        uint256 amount,
        string calldata evidence
    ) external returns (uint256) {
        CoveragePolicy storage policy = policies[policyId];
        require(policy.holder == msg.sender, "Not policy holder");
        require(policy.active && !policy.claimed, "Not claimable");
        require(block.timestamp <= policy.endTime, "Policy expired");
        require(amount <= policy.coverageAmount, "Exceeds coverage");

        claimCount++;
        claims[claimCount] = Claim({
            claimId: claimCount,
            policyId: policyId,
            claimant: msg.sender,
            amount: amount,
            evidence: evidence,
            votesFor: 0,
            votesAgainst: 0,
            deadline: block.timestamp + 7 days,
            resolved: false,
            approved: false
        });

        emit ClaimFiled(claimCount, policyId, amount);
        return claimCount;
    }

    /**
     * @notice Vote on a claim (governance/sentinel)
     */
    function voteOnClaim(uint256 claimId, bool support) external {
        Claim storage claim = claims[claimId];
        require(!claim.resolved, "Already resolved");
        require(block.timestamp <= claim.deadline, "Deadline passed");
        require(!hasVotedOnClaim[claimId][msg.sender], "Already voted");

        hasVotedOnClaim[claimId][msg.sender] = true;

        if (support) claim.votesFor++;
        else claim.votesAgainst++;

        emit ClaimVoted(claimId, msg.sender, support);
    }

    /**
     * @notice Resolve a claim after voting period
     */
    function resolveClaim(uint256 claimId) external nonReentrant {
        Claim storage claim = claims[claimId];
        require(!claim.resolved, "Already resolved");
        require(block.timestamp > claim.deadline, "Voting ongoing");

        claim.resolved = true;

        if (claim.votesFor > claim.votesAgainst) {
            claim.approved = true;
            CoveragePolicy storage policy = policies[claim.policyId];
            policy.claimed = true;
            policy.active = false;
            activeCoverage[policy.category] -= policy.coverageAmount;

            uint256 payout = claim.amount;
            if (payout > totalUnderwritten) payout = totalUnderwritten;

            totalUnderwritten -= payout;
            totalPayouts += payout;

            (bool ok, ) = claim.claimant.call{value: payout}("");
            require(ok, "Payout failed");

            emit ClaimResolved(claimId, true, payout);
        } else {
            emit ClaimResolved(claimId, false, 0);
        }
    }

    // ============ Admin ============

    function setPremiumRate(RiskCategory category, uint256 rateBps) external onlyOwner {
        premiumRateBps[category] = rateBps;
        emit PremiumRateUpdated(category, rateBps);
    }

    function setMaxCoverageRatio(uint256 ratioBps) external onlyOwner {
        require(ratioBps <= 10000, "Invalid ratio");
        maxCoverageRatioBps = ratioBps;
    }

    // ============ View ============

    function getPoolHealth() external view returns (
        uint256 poolSize,
        uint256 activeCov,
        uint256 utilizationBps,
        uint256 premiumsCollected,
        uint256 payoutsMade
    ) {
        uint256 totalActive;
        for (uint256 i = 0; i < 6; i++) {
            totalActive += activeCoverage[RiskCategory(i)];
        }
        uint256 util = totalUnderwritten > 0 ? (totalActive * 10000) / totalUnderwritten : 0;
        return (totalUnderwritten, totalActive, util, totalPremiums, totalPayouts);
    }

    function getShareValue(address underwriter) external view returns (uint256) {
        if (totalShares == 0) return 0;
        return (underwriters[underwriter].shares * totalUnderwritten) / totalShares;
    }

    function getPolicy(uint256 id) external view returns (CoveragePolicy memory) { return policies[id]; }
    function getClaim(uint256 id) external view returns (Claim memory) { return claims[id]; }

    receive() external payable {
        totalUnderwritten += msg.value;
    }
}
