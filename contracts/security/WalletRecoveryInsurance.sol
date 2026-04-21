// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts-upgradeable/access/OwnableUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/proxy/utils/UUPSUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/utils/ReentrancyGuardUpgradeable.sol";

/**
 * @title WalletRecoveryInsurance — Fund Loss Prevention Insurance
 * @notice Insurance pool that guarantees users can recover funds even
 *         if their wallet provider fails (like Coinbase auto-updating
 *         and losing access).
 *
 * "Losing funds should be mathematically impossible."
 *
 * Coverage:
 * - Wallet provider failure (forced updates, key loss)
 * - Smart contract bugs (covered up to policy limit)
 * - Bridge failures (cross-chain recovery)
 * - Oracle manipulation (price feed attacks)
 *
 * Model:
 * - Users pay monthly premium (0.1-0.5% of covered amount)
 * - Claims require 2-of-3 adjudicator approval
 * - Max payout = min(loss, coverage limit, pool balance * 10%)
 * - Premiums fund the pool; excess invested in yield
 */
contract WalletRecoveryInsurance is OwnableUpgradeable, UUPSUpgradeable, ReentrancyGuardUpgradeable {

    enum ClaimStatus { PENDING, APPROVED, DENIED, PAID }

    struct Policy {
        address holder;
        uint256 coverageAmount;
        uint256 monthlyPremium;
        uint256 startDate;
        uint256 lastPremiumPaid;
        bool active;
    }

    struct Claim {
        address claimant;
        uint256 policyId;
        uint256 lossAmount;
        string evidence;           // IPFS hash of evidence
        ClaimStatus status;
        uint256 approvals;
        uint256 denials;
        uint256 payoutAmount;
        uint256 filedAt;
    }

    // ============ State ============

    mapping(uint256 => Policy) public policies;
    uint256 public policyCount;
    mapping(uint256 => Claim) public claims;
    uint256 public claimCount;

    mapping(address => bool) public adjudicators;
    mapping(uint256 => mapping(address => bool)) public adjudicatorVoted;

    uint256 public poolBalance;
    uint256 public totalPremiumsCollected;
    uint256 public totalClaimsPaid;
    uint256 public activePolicies;

    uint256 public constant PREMIUM_RATE_BPS = 50;      // 0.5% monthly
    uint256 public constant MAX_PAYOUT_POOL_PCT = 10;    // Max 10% of pool per claim
    uint256 public constant REQUIRED_APPROVALS = 2;
    uint256 public constant PREMIUM_PERIOD = 30 days;
    uint256 public constant GRACE_PERIOD = 7 days;


    /// @dev Reserved storage gap for future upgrades
    uint256[50] private __gap;

    // ============ Events ============

    event PolicyCreated(uint256 indexed id, address holder, uint256 coverage);
    event PremiumPaid(uint256 indexed policyId, uint256 amount);
    event ClaimFiled(uint256 indexed claimId, uint256 policyId, uint256 lossAmount);
    event ClaimVoted(uint256 indexed claimId, address adjudicator, bool approved);
    event ClaimPaid(uint256 indexed claimId, uint256 amount);
    event PolicyCancelled(uint256 indexed id);

    // ============ Initialize ============

    /// @custom:oz-upgrades-unsafe-allow constructor
    constructor() {
        _disableInitializers();
    }

    function initialize() external initializer {
        __Ownable_init(msg.sender);
        __UUPSUpgradeable_init();
        __ReentrancyGuard_init();
    }

    function _authorizeUpgrade(address newImplementation) internal override onlyOwner {
        require(newImplementation.code.length > 0, "Not a contract");
    }

    // ============ Policies ============

    function createPolicy(uint256 coverageAmount) external payable {
        require(coverageAmount > 0, "Zero coverage");

        uint256 premium = (coverageAmount * PREMIUM_RATE_BPS) / 10000;
        require(msg.value >= premium, "Insufficient premium");

        uint256 id = policyCount++;
        policies[id] = Policy({
            holder: msg.sender,
            coverageAmount: coverageAmount,
            monthlyPremium: premium,
            startDate: block.timestamp,
            lastPremiumPaid: block.timestamp,
            active: true
        });

        poolBalance += msg.value;
        totalPremiumsCollected += msg.value;
        activePolicies++;

        emit PolicyCreated(id, msg.sender, coverageAmount);
        emit PremiumPaid(id, msg.value);
    }

    function payPremium(uint256 policyId) external payable {
        Policy storage p = policies[policyId];
        require(p.holder == msg.sender, "Not holder");
        require(p.active, "Inactive");
        require(msg.value >= p.monthlyPremium, "Insufficient");

        p.lastPremiumPaid = block.timestamp;
        poolBalance += msg.value;
        totalPremiumsCollected += msg.value;

        emit PremiumPaid(policyId, msg.value);
    }

    function cancelPolicy(uint256 policyId) external {
        Policy storage p = policies[policyId];
        require(p.holder == msg.sender, "Not holder");
        p.active = false;
        activePolicies--;
        emit PolicyCancelled(policyId);
    }

    // ============ Claims ============

    function fileClaim(uint256 policyId, uint256 lossAmount, string calldata evidence) external {
        Policy storage p = policies[policyId];
        require(p.holder == msg.sender, "Not holder");
        require(p.active, "Inactive");
        require(
            block.timestamp <= p.lastPremiumPaid + PREMIUM_PERIOD + GRACE_PERIOD,
            "Premium overdue"
        );
        require(lossAmount > 0, "Zero loss");

        uint256 id = claimCount++;
        claims[id] = Claim({
            claimant: msg.sender,
            policyId: policyId,
            lossAmount: lossAmount,
            evidence: evidence,
            status: ClaimStatus.PENDING,
            approvals: 0,
            denials: 0,
            payoutAmount: 0,
            filedAt: block.timestamp
        });

        emit ClaimFiled(id, policyId, lossAmount);
    }

    function voteClaim(uint256 claimId, bool approve) external {
        require(adjudicators[msg.sender], "Not adjudicator");
        require(!adjudicatorVoted[claimId][msg.sender], "Already voted");

        Claim storage c = claims[claimId];
        require(c.status == ClaimStatus.PENDING, "Not pending");

        adjudicatorVoted[claimId][msg.sender] = true;
        emit ClaimVoted(claimId, msg.sender, approve);

        if (approve) {
            c.approvals++;
            if (c.approvals >= REQUIRED_APPROVALS) {
                _approveClaim(claimId);
            }
        } else {
            c.denials++;
            if (c.denials >= REQUIRED_APPROVALS) {
                c.status = ClaimStatus.DENIED;
            }
        }
    }

    function _approveClaim(uint256 claimId) internal {
        Claim storage c = claims[claimId];
        Policy storage p = policies[c.policyId];

        // Payout = min(loss, coverage, 10% of pool)
        uint256 maxFromPool = (poolBalance * MAX_PAYOUT_POOL_PCT) / 100;
        uint256 payout = c.lossAmount;
        if (payout > p.coverageAmount) payout = p.coverageAmount;
        if (payout > maxFromPool) payout = maxFromPool;

        c.status = ClaimStatus.APPROVED;
        c.payoutAmount = payout;
    }

    function executePayout(uint256 claimId) external nonReentrant {
        Claim storage c = claims[claimId];
        require(c.status == ClaimStatus.APPROVED, "Not approved");
        require(c.payoutAmount > 0, "Zero payout");
        require(c.payoutAmount <= poolBalance, "Pool insufficient");

        c.status = ClaimStatus.PAID;
        poolBalance -= c.payoutAmount;
        totalClaimsPaid += c.payoutAmount;

        (bool ok, ) = c.claimant.call{value: c.payoutAmount}("");
        require(ok, "Payout failed");

        emit ClaimPaid(claimId, c.payoutAmount);
    }

    // ============ Admin ============

    function addAdjudicator(address a) external onlyOwner { adjudicators[a] = true; }
    function removeAdjudicator(address a) external onlyOwner { adjudicators[a] = false; }

    function fundPool() external payable onlyOwner {
        poolBalance += msg.value;
    }

    // ============ Views ============

    function getPolicy(uint256 id) external view returns (Policy memory) { return policies[id]; }
    function getClaim(uint256 id) external view returns (Claim memory) { return claims[id]; }

    function isPolicyActive(uint256 id) external view returns (bool) {
        Policy storage p = policies[id];
        return p.active && block.timestamp <= p.lastPremiumPaid + PREMIUM_PERIOD + GRACE_PERIOD;
    }

    function getPoolHealth() external view returns (uint256 balance, uint256 policies_, uint256 ratio) {
        balance = poolBalance;
        policies_ = activePolicies;
        ratio = activePolicies > 0 ? poolBalance / activePolicies : 0;
    }

    receive() external payable {
        poolBalance += msg.value;
    }
}
