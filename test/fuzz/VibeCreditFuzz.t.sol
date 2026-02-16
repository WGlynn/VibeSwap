// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "forge-std/Test.sol";
import "../../contracts/financial/VibeCredit.sol";
import "../../contracts/financial/interfaces/IVibeCredit.sol";
import "../../contracts/oracle/IReputationOracle.sol";
import "@openzeppelin/contracts/token/ERC20/ERC20.sol";

// ============ Mocks ============

contract MockCreditFToken is ERC20 {
    constructor(string memory name_, string memory symbol_) ERC20(name_, symbol_) {}
    function mint(address to, uint256 amount) external { _mint(to, amount); }
}

contract MockCreditFOracle is IReputationOracle {
    mapping(address => uint8) public tiers;
    function setTier(address user, uint8 tier) external { tiers[user] = tier; }
    function getTrustScore(address user) external view returns (uint256) { return uint256(tiers[user]) * 2500; }
    function getTrustTier(address user) external view returns (uint8) { return tiers[user]; }
    function isEligible(address user, uint8 requiredTier) external view returns (bool) { return tiers[user] >= requiredTier; }
}

// ============ Fuzz Tests ============

contract VibeCreditFuzzTest is Test {
    VibeCredit public credit;
    MockCreditFToken public token;
    MockCreditFToken public jul;
    MockCreditFOracle public oracle;

    address public delegator;
    address public borrower;

    uint16 constant RATE_BPS = 1000; // 10%
    uint40 constant DURATION = 360 days;

    function setUp() public {
        delegator = makeAddr("delegator");
        borrower = makeAddr("borrower");

        jul = new MockCreditFToken("JUL", "JUL");
        token = new MockCreditFToken("USDC", "USDC");
        oracle = new MockCreditFOracle();

        credit = new VibeCredit(address(jul), address(oracle));

        oracle.setTier(borrower, 3); // tier 3 = 75% LTV

        token.mint(delegator, 100_000_000 ether);
        token.mint(borrower, 100_000_000 ether);
        jul.mint(address(this), 10_000_000 ether);

        vm.prank(delegator);
        token.approve(address(credit), type(uint256).max);
        vm.prank(borrower);
        token.approve(address(credit), type(uint256).max);
        jul.approve(address(credit), type(uint256).max);
    }

    // ============ Helpers ============

    function _createLine(uint256 principal) internal returns (uint256) {
        vm.prank(delegator);
        return credit.createCreditLine(IVibeCredit.CreateCreditLineParams({
            borrower: borrower,
            token: address(token),
            amount: principal,
            interestRate: RATE_BPS,
            minTrustTier: 2,
            maturity: uint40(block.timestamp) + DURATION
        }));
    }

    // ============ Fuzz: credit limit = principal * LTV / 10000 ============

    function testFuzz_creditLimitMatchesLTV(uint256 principal) public {
        principal = bound(principal, 1 ether, 10_000_000 ether);

        uint256 id = _createLine(principal);

        uint256 limit = credit.creditLimit(id);
        // Tier 3 = 75% LTV = 7500 bps
        uint256 expected = (principal * 7500) / 10000;
        assertEq(limit, expected, "Credit limit must match tier LTV");
    }

    // ============ Fuzz: borrow up to limit succeeds ============

    function testFuzz_borrowUpToLimitSucceeds(uint256 principal, uint256 borrowFraction) public {
        principal = bound(principal, 10 ether, 1_000_000 ether);
        borrowFraction = bound(borrowFraction, 1, 7500); // up to 75% (tier 3 LTV)

        uint256 id = _createLine(principal);
        uint256 borrowAmount = (principal * borrowFraction) / 10000;
        if (borrowAmount == 0) return;

        uint256 balBefore = token.balanceOf(borrower);

        vm.prank(borrower);
        credit.borrow(id, borrowAmount);

        assertEq(token.balanceOf(borrower), balBefore + borrowAmount, "Borrower receives tokens");

        IVibeCredit.CreditLine memory cl = credit.getCreditLine(id);
        assertEq(cl.borrowed, borrowAmount, "Borrowed amount tracked");
    }

    // ============ Fuzz: borrow above limit reverts ============

    function testFuzz_borrowAboveLimitReverts(uint256 principal) public {
        principal = bound(principal, 10 ether, 1_000_000 ether);

        uint256 id = _createLine(principal);
        uint256 limit = credit.creditLimit(id);

        vm.prank(borrower);
        vm.expectRevert(IVibeCredit.ExceedsCreditLimit.selector);
        credit.borrow(id, limit + 1);
    }

    // ============ Fuzz: interest accrues linearly ============

    function testFuzz_interestAccruesLinearly(uint256 principal, uint256 elapsed) public {
        principal = bound(principal, 100 ether, 1_000_000 ether);
        elapsed = bound(elapsed, 1, 365 days);

        uint256 id = _createLine(principal);

        // Borrow half the limit
        uint256 borrowAmount = (principal * 3750) / 10000; // half of 75% limit
        vm.prank(borrower);
        credit.borrow(id, borrowAmount);

        vm.warp(block.timestamp + elapsed);

        uint256 interest = credit.accruedInterest(id);
        // interest = borrowed * rate * elapsed / (10000 * SECONDS_PER_YEAR)
        uint256 expected = (borrowAmount * RATE_BPS * elapsed) / (10000 * 31_557_600);

        assertEq(interest, expected, "Interest must accrue linearly");
    }

    // ============ Fuzz: full repay sets state to REPAID ============

    function testFuzz_fullRepayChangesState(uint256 principal) public {
        principal = bound(principal, 100 ether, 1_000_000 ether);

        uint256 id = _createLine(principal);
        uint256 borrowAmount = (principal * 5000) / 10000; // 50% of principal

        vm.prank(borrower);
        credit.borrow(id, borrowAmount);

        // Repay immediately (no interest)
        vm.prank(borrower);
        credit.repay(id, borrowAmount);

        IVibeCredit.CreditLine memory cl = credit.getCreditLine(id);
        assertEq(uint8(cl.state), uint8(IVibeCredit.CreditState.REPAID), "Must be REPAID");
        assertEq(cl.borrowed, 0, "Borrowed must be 0");
    }

    // ============ Fuzz: close without debt returns principal ============

    function testFuzz_closeReturnsFullPrincipal(uint256 principal) public {
        principal = bound(principal, 1 ether, 1_000_000 ether);

        uint256 id = _createLine(principal);

        uint256 balBefore = token.balanceOf(delegator);

        vm.prank(delegator);
        credit.closeCreditLine(id);

        assertEq(token.balanceOf(delegator), balBefore + principal, "Delegator gets full principal back");

        IVibeCredit.CreditLine memory cl = credit.getCreditLine(id);
        assertEq(uint8(cl.state), uint8(IVibeCredit.CreditState.CLOSED), "Must be CLOSED");
    }
}
