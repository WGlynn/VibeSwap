// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts-upgradeable/access/OwnableUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/proxy/utils/UUPSUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/utils/ReentrancyGuardUpgradeable.sol";

/**
 * @title VibeInsurancePool — Protocol-Level Deposit Insurance
 * @notice FDIC-like insurance for DeFi deposits. Every deposit contributes
 *         a small premium to the insurance pool. If a protocol failure causes
 *         fund loss, affected users file claims and get reimbursed.
 *
 * Insurance tiers:
 *   BASIC:    Covers 80% of deposits up to 10 ETH   (premium: 0.1%)
 *   STANDARD: Covers 90% of deposits up to 50 ETH   (premium: 0.3%)
 *   PREMIUM:  Covers 100% of deposits up to 100 ETH (premium: 0.5%)
 *
 * Funding sources:
 * 1. Deposit premiums (automatic)
 * 2. Protocol revenue share (5% of swap fees)
 * 3. Treasury backstop (emergency injection)
 *
 * Claim process:
 * 1. User files claim with evidence
 * 2. 3 auditors must verify the loss
 * 3. If approved, payout within 24 hours
 * 4. If disputed, goes to DecentralizedTribunal
 */
contract VibeInsurancePool is OwnableUpgradeable, UUPSUpgradeable, ReentrancyGuardUpgradeable {

    enum Tier { NONE, BASIC, STANDARD, PREMIUM }
    enum ClaimStatus { PENDING, REVIEWING, APPROVED, DENIED, PAID, DISPUTED }

    struct Policy {
        Tier tier;
        uint256 coveredAmount;
        uint256 maxCoverage;
        uint256 coveragePercent;     // 80, 90, or 100
        uint256 premiumPaid;
        uint256 activeSince;
        uint256 expiresAt;
    }

    struct Claim {
        address claimant;
        uint256 policyId;
        uint256 lossAmount;
        string evidence;             // IPFS hash of evidence
        ClaimStatus status;
        uint256 filedAt;
        uint256 approvalCount;
        uint256 denialCount;
        uint256 payoutAmount;
    }

    // ============ Config ============

    uint256 public constant BASIC_PREMIUM_BPS = 10;      // 0.1%
    uint256 public constant STANDARD_PREMIUM_BPS = 30;   // 0.3%
    uint256 public constant PREMIUM_PREMIUM_BPS = 50;    // 0.5%

    uint256 public constant BASIC_MAX = 10 ether;
    uint256 public constant STANDARD_MAX = 50 ether;
    uint256 public constant PREMIUM_MAX = 100 ether;

    uint256 public constant BASIC_COVERAGE = 80;
    uint256 public constant STANDARD_COVERAGE = 90;
    uint256 public constant PREMIUM_COVERAGE = 100;

    uint256 public constant POLICY_DURATION = 365 days;
    uint256 public constant AUDITOR_THRESHOLD = 3;

    // ============ State ============

    uint256 public poolBalance;
    uint256 public totalPremiums;
    uint256 public totalPayouts;
    uint256 public activePolicies;

    mapping(address => Policy) public policies;
    mapping(uint256 => Claim) public claims;
    uint256 public claimCount;

    mapping(address => bool) public auditors;
    mapping(uint256 => mapping(address => bool)) public auditorVotes;
    mapping(uint256 => mapping(address => bool)) public auditorDenials;

    // ============ Events ============

    event PolicyCreated(address indexed user, Tier tier, uint256 coveredAmount, uint256 premium);
    event PolicyRenewed(address indexed user, uint256 newExpiry);
    event ClaimFiled(uint256 indexed claimId, address claimant, uint256 lossAmount);
    event ClaimReviewed(uint256 indexed claimId, address auditor, bool approved);
    event ClaimApproved(uint256 indexed claimId, uint256 payoutAmount);
    event ClaimDenied(uint256 indexed claimId);
    event ClaimPaid(uint256 indexed claimId, uint256 amount);
    event PoolFunded(uint256 amount, string source);

    // ============ Initialize ============

    function initialize() external initializer {
        __Ownable_init(msg.sender);
        __UUPSUpgradeable_init();
        __ReentrancyGuard_init();
    }

    function _authorizeUpgrade(address newImplementation) internal override onlyOwner {
        require(newImplementation.code.length > 0, "Not a contract");
    }

    // ============ Policy Management ============

    /// @notice Purchase insurance coverage
    function purchasePolicy(Tier tier) external payable {
        require(tier != Tier.NONE, "Invalid tier");
        require(policies[msg.sender].expiresAt < block.timestamp, "Policy active");

        uint256 premiumBps;
        uint256 maxCoverage;
        uint256 coveragePct;

        if (tier == Tier.BASIC) {
            premiumBps = BASIC_PREMIUM_BPS;
            maxCoverage = BASIC_MAX;
            coveragePct = BASIC_COVERAGE;
        } else if (tier == Tier.STANDARD) {
            premiumBps = STANDARD_PREMIUM_BPS;
            maxCoverage = STANDARD_MAX;
            coveragePct = STANDARD_COVERAGE;
        } else {
            premiumBps = PREMIUM_PREMIUM_BPS;
            maxCoverage = PREMIUM_MAX;
            coveragePct = PREMIUM_COVERAGE;
        }

        uint256 premium = (msg.value * premiumBps) / 10000;
        uint256 covered = msg.value - premium;
        require(covered <= maxCoverage, "Exceeds max coverage");

        poolBalance += premium;
        totalPremiums += premium;
        activePolicies++;

        policies[msg.sender] = Policy({
            tier: tier,
            coveredAmount: covered,
            maxCoverage: maxCoverage,
            coveragePercent: coveragePct,
            premiumPaid: premium,
            activeSince: block.timestamp,
            expiresAt: block.timestamp + POLICY_DURATION
        });

        emit PolicyCreated(msg.sender, tier, covered, premium);
    }

    // ============ Claims ============

    /// @notice File an insurance claim
    function fileClaim(uint256 lossAmount, string calldata evidence) external {
        Policy storage p = policies[msg.sender];
        require(p.expiresAt >= block.timestamp, "Policy expired");
        require(lossAmount > 0, "Zero loss");

        uint256 id = claimCount++;
        uint256 maxPayout = (p.coveredAmount * p.coveragePercent) / 100;
        uint256 payout = lossAmount > maxPayout ? maxPayout : lossAmount;

        claims[id] = Claim({
            claimant: msg.sender,
            policyId: 0,
            lossAmount: lossAmount,
            evidence: evidence,
            status: ClaimStatus.PENDING,
            filedAt: block.timestamp,
            approvalCount: 0,
            denialCount: 0,
            payoutAmount: payout
        });

        emit ClaimFiled(id, msg.sender, lossAmount);
    }

    /// @notice Auditor reviews a claim
    function reviewClaim(uint256 claimId, bool approve) external {
        require(auditors[msg.sender], "Not auditor");
        Claim storage c = claims[claimId];
        require(c.status == ClaimStatus.PENDING || c.status == ClaimStatus.REVIEWING, "Not reviewable");
        require(!auditorVotes[claimId][msg.sender] && !auditorDenials[claimId][msg.sender], "Already voted");

        c.status = ClaimStatus.REVIEWING;

        if (approve) {
            auditorVotes[claimId][msg.sender] = true;
            c.approvalCount++;
            emit ClaimReviewed(claimId, msg.sender, true);

            if (c.approvalCount >= AUDITOR_THRESHOLD) {
                c.status = ClaimStatus.APPROVED;
                emit ClaimApproved(claimId, c.payoutAmount);
            }
        } else {
            auditorDenials[claimId][msg.sender] = true;
            c.denialCount++;
            emit ClaimReviewed(claimId, msg.sender, false);

            if (c.denialCount >= AUDITOR_THRESHOLD) {
                c.status = ClaimStatus.DENIED;
                emit ClaimDenied(claimId);
            }
        }
    }

    /// @notice Execute approved claim payout
    function executePayout(uint256 claimId) external nonReentrant {
        Claim storage c = claims[claimId];
        require(c.status == ClaimStatus.APPROVED, "Not approved");
        require(poolBalance >= c.payoutAmount, "Pool insufficient");

        c.status = ClaimStatus.PAID;
        poolBalance -= c.payoutAmount;
        totalPayouts += c.payoutAmount;

        (bool ok, ) = c.claimant.call{value: c.payoutAmount}("");
        require(ok, "Payout failed");

        emit ClaimPaid(claimId, c.payoutAmount);
    }

    // ============ Pool Funding ============

    /// @notice Fund the insurance pool (from protocol revenue)
    function fundPool(string calldata source) external payable {
        poolBalance += msg.value;
        emit PoolFunded(msg.value, source);
    }

    // ============ Auditor Management ============

    function addAuditor(address auditor) external onlyOwner {
        auditors[auditor] = true;
    }

    function removeAuditor(address auditor) external onlyOwner {
        auditors[auditor] = false;
    }

    // ============ Views ============

    function getPolicy(address user) external view returns (Policy memory) {
        return policies[user];
    }

    function getClaim(uint256 id) external view returns (Claim memory) {
        return claims[id];
    }

    function isPolicyActive(address user) external view returns (bool) {
        return policies[user].expiresAt >= block.timestamp;
    }

    function getPoolHealth() external view returns (uint256 balance, uint256 premiums, uint256 payouts, uint256 ratio) {
        return (poolBalance, totalPremiums, totalPayouts,
                totalPremiums > 0 ? (poolBalance * 10000) / totalPremiums : 10000);
    }

    receive() external payable {
        poolBalance += msg.value;
    }
}
