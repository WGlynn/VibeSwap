// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts-upgradeable/access/OwnableUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/proxy/utils/UUPSUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/utils/ReentrancyGuardUpgradeable.sol";

/**
 * @title VibeP2PLending — Peer-to-Peer Lending with Reputation
 * @notice Direct lending between individuals — no pool intermediary.
 *         Interest rates set by market forces, not algorithm.
 *
 * Why P2P over pool-based:
 * - Lenders choose their borrowers (reputation-based)
 * - Custom terms (rate, duration, collateral ratio)
 * - Better rates for trusted borrowers
 * - No liquidity fragmentation across pools
 *
 * Real P2P banking. What it was supposed to be.
 */
contract VibeP2PLending is OwnableUpgradeable, UUPSUpgradeable, ReentrancyGuardUpgradeable {

    enum LoanStatus { PROPOSED, ACTIVE, REPAID, DEFAULTED, CANCELLED, LIQUIDATED }

    struct LoanTerms {
        uint256 principal;
        uint256 interestRate;        // Annual rate in basis points
        uint256 duration;            // In seconds
        uint256 collateralRatio;     // In basis points (15000 = 150%)
        uint256 collateralAmount;    // Actual collateral deposited
    }

    struct Loan {
        address borrower;
        address lender;
        LoanTerms terms;
        LoanStatus status;
        uint256 createdAt;
        uint256 fundedAt;
        uint256 dueAt;
        uint256 repaidAmount;
    }

    struct CreditScore {
        uint256 loansRepaid;
        uint256 loansDefaulted;
        uint256 totalBorrowed;
        uint256 totalRepaid;
        uint256 onTimeRepayments;
        uint256 score;               // 0-1000 (like FICO scaled down)
    }

    // ============ State ============

    mapping(uint256 => Loan) public loans;
    uint256 public loanCount;
    mapping(address => CreditScore) public creditScores;
    mapping(address => uint256[]) public borrowerLoans;
    mapping(address => uint256[]) public lenderLoans;

    uint256 public constant MIN_COLLATERAL_RATIO = 12000; // 120%
    uint256 public constant LIQUIDATION_THRESHOLD = 11000; // 110%
    uint256 public constant PROTOCOL_FEE_BPS = 50;        // 0.5%
    uint256 public protocolFees;


    /// @dev Reserved storage gap for future upgrades
    uint256[50] private __gap;

    // ============ Events ============

    event LoanProposed(uint256 indexed id, address borrower, uint256 principal, uint256 interestRate);
    event LoanFunded(uint256 indexed id, address lender);
    event LoanRepaid(uint256 indexed id, uint256 amount);
    event LoanDefaulted(uint256 indexed id);
    event LoanLiquidated(uint256 indexed id, address liquidator);
    event CreditScoreUpdated(address indexed user, uint256 newScore);

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

    // ============ Loan Lifecycle ============

    /// @notice Borrower proposes a loan with collateral
    function proposeLoan(
        uint256 principal,
        uint256 interestRate,
        uint256 duration,
        uint256 collateralRatio
    ) external payable {
        require(principal > 0, "Zero principal");
        require(duration >= 1 days, "Min 1 day");
        require(collateralRatio >= MIN_COLLATERAL_RATIO, "Collateral too low");
        require(msg.value >= (principal * collateralRatio) / 10000, "Insufficient collateral");

        uint256 id = loanCount++;
        loans[id] = Loan({
            borrower: msg.sender,
            lender: address(0),
            terms: LoanTerms({
                principal: principal,
                interestRate: interestRate,
                duration: duration,
                collateralRatio: collateralRatio,
                collateralAmount: msg.value
            }),
            status: LoanStatus.PROPOSED,
            createdAt: block.timestamp,
            fundedAt: 0,
            dueAt: 0,
            repaidAmount: 0
        });

        borrowerLoans[msg.sender].push(id);
        emit LoanProposed(id, msg.sender, principal, interestRate);
    }

    /// @notice Lender funds a proposed loan
    function fundLoan(uint256 loanId) external payable nonReentrant {
        Loan storage l = loans[loanId];
        require(l.status == LoanStatus.PROPOSED, "Not proposed");
        require(msg.value >= l.terms.principal, "Insufficient funding");
        require(msg.sender != l.borrower, "Cannot self-lend");

        l.lender = msg.sender;
        l.status = LoanStatus.ACTIVE;
        l.fundedAt = block.timestamp;
        l.dueAt = block.timestamp + l.terms.duration;

        lenderLoans[msg.sender].push(loanId);

        // Send principal to borrower
        (bool ok, ) = l.borrower.call{value: l.terms.principal}("");
        require(ok, "Fund transfer failed");

        emit LoanFunded(loanId, msg.sender);
    }

    /// @notice Borrower repays the loan (principal + interest)
    function repay(uint256 loanId) external payable nonReentrant {
        Loan storage l = loans[loanId];
        require(l.status == LoanStatus.ACTIVE, "Not active");
        require(msg.sender == l.borrower, "Not borrower");

        uint256 interest = _calculateInterest(l);
        uint256 totalDue = l.terms.principal + interest;
        uint256 fee = (interest * PROTOCOL_FEE_BPS) / 10000;

        require(msg.value >= totalDue, "Insufficient repayment");

        l.status = LoanStatus.REPAID;
        l.repaidAmount = totalDue;
        protocolFees += fee;

        // Update credit score
        CreditScore storage cs = creditScores[l.borrower];
        cs.loansRepaid++;
        cs.totalRepaid += totalDue;
        if (block.timestamp <= l.dueAt) cs.onTimeRepayments++;
        _updateScore(l.borrower);

        // Return collateral to borrower
        (bool ok1, ) = l.borrower.call{value: l.terms.collateralAmount}("");
        require(ok1, "Collateral return failed");

        // Pay lender
        (bool ok2, ) = l.lender.call{value: totalDue - fee}("");
        require(ok2, "Lender payment failed");

        emit LoanRepaid(loanId, totalDue);
    }

    /// @notice Mark loan as defaulted (after due date)
    function markDefault(uint256 loanId) external {
        Loan storage l = loans[loanId];
        require(l.status == LoanStatus.ACTIVE, "Not active");
        require(block.timestamp > l.dueAt, "Not past due");

        l.status = LoanStatus.DEFAULTED;

        // Forfeit collateral to lender
        (bool ok, ) = l.lender.call{value: l.terms.collateralAmount}("");
        require(ok, "Collateral transfer failed");

        // Update credit score
        creditScores[l.borrower].loansDefaulted++;
        _updateScore(l.borrower);

        emit LoanDefaulted(loanId);
    }

    /// @notice Liquidate undercollateralized loan
    function liquidate(uint256 loanId) external nonReentrant {
        Loan storage l = loans[loanId];
        require(l.status == LoanStatus.ACTIVE, "Not active");

        // Check if collateral ratio dropped below liquidation threshold
        // In production, this would use a price oracle
        // For now, only allow liquidation after default
        require(block.timestamp > l.dueAt, "Not liquidatable");

        l.status = LoanStatus.LIQUIDATED;

        // Liquidator gets 5% bonus from collateral
        uint256 liquidatorReward = (l.terms.collateralAmount * 500) / 10000;
        uint256 lenderAmount = l.terms.collateralAmount - liquidatorReward;

        (bool ok1, ) = msg.sender.call{value: liquidatorReward}("");
        require(ok1, "Liquidator reward failed");

        (bool ok2, ) = l.lender.call{value: lenderAmount}("");
        require(ok2, "Lender payment failed");

        creditScores[l.borrower].loansDefaulted++;
        _updateScore(l.borrower);

        emit LoanLiquidated(loanId, msg.sender);
    }

    function cancelLoan(uint256 loanId) external nonReentrant {
        Loan storage l = loans[loanId];
        require(msg.sender == l.borrower, "Not borrower");
        require(l.status == LoanStatus.PROPOSED, "Not proposed");

        l.status = LoanStatus.CANCELLED;
        (bool ok, ) = l.borrower.call{value: l.terms.collateralAmount}("");
        require(ok, "Refund failed");
    }

    // ============ Internal ============

    function _calculateInterest(Loan storage l) internal view returns (uint256) {
        uint256 duration = block.timestamp - l.fundedAt;
        return (l.terms.principal * l.terms.interestRate * duration) / (10000 * 365 days);
    }

    function _updateScore(address user) internal {
        CreditScore storage cs = creditScores[user];
        uint256 total = cs.loansRepaid + cs.loansDefaulted;
        if (total == 0) {
            cs.score = 500;
            return;
        }

        // Base score from repayment ratio (0-700)
        uint256 repayRatio = (cs.loansRepaid * 700) / total;

        // On-time bonus (0-200)
        uint256 onTimeRatio = cs.loansRepaid > 0
            ? (cs.onTimeRepayments * 200) / cs.loansRepaid
            : 0;

        // Volume bonus (0-100)
        uint256 volumeBonus = cs.totalRepaid > 100 ether ? 100 :
                              cs.totalRepaid > 10 ether ? 50 :
                              cs.totalRepaid > 1 ether ? 25 : 0;

        cs.score = repayRatio + onTimeRatio + volumeBonus;
        emit CreditScoreUpdated(user, cs.score);
    }

    // ============ Views ============

    function getLoan(uint256 id) external view returns (Loan memory) {
        return loans[id];
    }

    function getCreditScore(address user) external view returns (CreditScore memory) {
        return creditScores[user];
    }

    function getBorrowerLoans(address user) external view returns (uint256[] memory) {
        return borrowerLoans[user];
    }

    function getLenderLoans(address user) external view returns (uint256[] memory) {
        return lenderLoans[user];
    }

    function getAmountDue(uint256 loanId) external view returns (uint256) {
        Loan storage l = loans[loanId];
        if (l.status != LoanStatus.ACTIVE) return 0;
        return l.terms.principal + _calculateInterest(l);
    }

    receive() external payable {}
}
