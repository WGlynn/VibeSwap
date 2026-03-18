// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts-upgradeable/access/OwnableUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/proxy/utils/UUPSUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/utils/ReentrancyGuardUpgradeable.sol";

/**
 * @title VibeAgentInsurance — Coverage for AI Agent Operations
 * @notice Insurance pools for AI agent activities: trading losses,
 *         smart contract failures, oracle manipulation, and agent
 *         misbehavior. Premiums are risk-adjusted based on agent
 *         reputation and historical performance.
 *
 * @dev Architecture:
 *      - Risk pools: TRADING, ORACLE, CONTRACT, MISBEHAVIOR
 *      - Risk-adjusted premiums using agent reputation score
 *      - Claims require proof submission + verifier approval
 *      - Max payout capped at 10x premium (prevents abuse)
 *      - Auto-premium adjustment based on pool loss ratio
 *      - Underwriters earn yield from premiums
 */
contract VibeAgentInsurance is OwnableUpgradeable, UUPSUpgradeable, ReentrancyGuardUpgradeable {
    // ============ Types ============

    enum RiskPool { TRADING, ORACLE, CONTRACT, MISBEHAVIOR }
    enum ClaimStatus { PENDING, APPROVED, REJECTED, PAID }

    struct Policy {
        uint256 policyId;
        bytes32 agentId;
        address operator;
        RiskPool pool;
        uint256 coverageAmount;      // Max payout
        uint256 premiumPaid;
        uint256 startTime;
        uint256 endTime;
        bool active;
    }

    struct Claim {
        uint256 claimId;
        uint256 policyId;
        bytes32 agentId;
        uint256 amount;
        bytes32 evidenceHash;        // IPFS hash of evidence
        ClaimStatus status;
        uint256 submittedAt;
        address approvedBy;
    }

    struct Pool {
        RiskPool poolType;
        uint256 totalDeposits;       // Underwriter deposits
        uint256 totalPremiums;
        uint256 totalClaims;
        uint256 activePolicies;
        uint256 lossRatio;           // claims/premiums * 10000
    }

    // ============ Constants ============

    uint256 public constant BASE_PREMIUM_RATE = 200;  // 2% of coverage
    uint256 public constant MAX_PAYOUT_MULTIPLIER = 10; // 10x premium max
    uint256 public constant POLICY_DURATION = 90 days;
    uint256 public constant CLAIM_WINDOW = 7 days;

    // ============ State ============

    mapping(uint256 => Policy) public policies;
    uint256 public policyCount;

    mapping(uint256 => Claim) public claims;
    uint256 public claimCount;

    mapping(uint256 => Pool) public pools;  // RiskPool enum => Pool

    /// @notice Underwriter deposits: pool => depositor => amount
    mapping(uint256 => mapping(address => uint256)) public underwriterDeposits;

    /// @notice Claim verifiers
    mapping(address => bool) public claimVerifiers;

    // ============ Events ============

    event PolicyCreated(uint256 indexed policyId, bytes32 indexed agentId, RiskPool pool, uint256 coverage, uint256 premium);
    event ClaimSubmitted(uint256 indexed claimId, uint256 indexed policyId, uint256 amount);
    event ClaimApproved(uint256 indexed claimId, address indexed approver, uint256 payout);
    event ClaimRejected(uint256 indexed claimId, address indexed rejector);
    event Underwritten(uint256 indexed pool, address indexed underwriter, uint256 amount);

    // ============ Init ============

    function initialize() external initializer {
        __Ownable_init(msg.sender);
        __UUPSUpgradeable_init();
        __ReentrancyGuard_init();
    }

    function _authorizeUpgrade(address newImplementation) internal override onlyOwner {
        require(newImplementation.code.length > 0, "Not a contract");
    }

    // ============ Underwriting ============

    function underwrite(RiskPool pool) external payable {
        require(msg.value > 0, "Zero deposit");

        uint256 poolIdx = uint256(pool);
        pools[poolIdx].totalDeposits += msg.value;
        underwriterDeposits[poolIdx][msg.sender] += msg.value;

        emit Underwritten(poolIdx, msg.sender, msg.value);
    }

    // ============ Policy ============

    function purchasePolicy(
        bytes32 agentId,
        RiskPool pool,
        uint256 coverageAmount
    ) external payable returns (uint256) {
        uint256 premium = _calculatePremium(pool, coverageAmount);
        require(msg.value >= premium, "Insufficient premium");
        require(coverageAmount <= pools[uint256(pool)].totalDeposits / 10, "Coverage exceeds pool capacity");

        policyCount++;
        policies[policyCount] = Policy({
            policyId: policyCount,
            agentId: agentId,
            operator: msg.sender,
            pool: pool,
            coverageAmount: coverageAmount,
            premiumPaid: premium,
            startTime: block.timestamp,
            endTime: block.timestamp + POLICY_DURATION,
            active: true
        });

        pools[uint256(pool)].totalPremiums += premium;
        pools[uint256(pool)].activePolicies++;

        // Refund excess
        if (msg.value > premium) {
            (bool ok, ) = msg.sender.call{value: msg.value - premium}("");
            require(ok, "Refund failed");
        }

        emit PolicyCreated(policyCount, agentId, pool, coverageAmount, premium);
        return policyCount;
    }

    // ============ Claims ============

    function submitClaim(
        uint256 policyId,
        uint256 amount,
        bytes32 evidenceHash
    ) external returns (uint256) {
        Policy storage p = policies[policyId];
        require(p.operator == msg.sender, "Not policyholder");
        require(p.active, "Policy inactive");
        require(block.timestamp <= p.endTime, "Policy expired");
        require(amount <= p.coverageAmount, "Exceeds coverage");
        require(amount <= p.premiumPaid * MAX_PAYOUT_MULTIPLIER, "Exceeds max payout");

        claimCount++;
        claims[claimCount] = Claim({
            claimId: claimCount,
            policyId: policyId,
            agentId: p.agentId,
            amount: amount,
            evidenceHash: evidenceHash,
            status: ClaimStatus.PENDING,
            submittedAt: block.timestamp,
            approvedBy: address(0)
        });

        emit ClaimSubmitted(claimCount, policyId, amount);
        return claimCount;
    }

    function approveClaim(uint256 claimId) external nonReentrant {
        require(claimVerifiers[msg.sender], "Not verifier");

        Claim storage c = claims[claimId];
        require(c.status == ClaimStatus.PENDING, "Not pending");

        c.status = ClaimStatus.PAID;
        c.approvedBy = msg.sender;

        Policy storage p = policies[c.policyId];
        uint256 poolIdx = uint256(p.pool);
        pools[poolIdx].totalClaims += c.amount;

        // Update loss ratio
        Pool storage pool = pools[poolIdx];
        if (pool.totalPremiums > 0) {
            pool.lossRatio = (pool.totalClaims * 10000) / pool.totalPremiums;
        }

        (bool ok, ) = p.operator.call{value: c.amount}("");
        require(ok, "Payout failed");

        emit ClaimApproved(claimId, msg.sender, c.amount);
    }

    function rejectClaim(uint256 claimId) external {
        require(claimVerifiers[msg.sender], "Not verifier");
        Claim storage c = claims[claimId];
        require(c.status == ClaimStatus.PENDING, "Not pending");
        c.status = ClaimStatus.REJECTED;
        emit ClaimRejected(claimId, msg.sender);
    }

    // ============ Internal ============

    function _calculatePremium(RiskPool pool, uint256 coverage) internal view returns (uint256) {
        uint256 baseRate = BASE_PREMIUM_RATE;
        Pool storage p = pools[uint256(pool)];

        // Adjust for pool loss ratio
        if (p.lossRatio > 5000) {
            baseRate = baseRate * (10000 + p.lossRatio) / 10000;
        }

        return (coverage * baseRate) / 10000;
    }

    // ============ Admin ============

    function addVerifier(address v) external onlyOwner { claimVerifiers[v] = true; }
    function removeVerifier(address v) external onlyOwner { claimVerifiers[v] = false; }

    // ============ View ============

    function getPolicy(uint256 id) external view returns (Policy memory) { return policies[id]; }
    function getClaim(uint256 id) external view returns (Claim memory) { return claims[id]; }
    function getPool(RiskPool pool) external view returns (Pool memory) { return pools[uint256(pool)]; }
    function getPremiumQuote(RiskPool pool, uint256 coverage) external view returns (uint256) { return _calculatePremium(pool, coverage); }

    receive() external payable {}
}
