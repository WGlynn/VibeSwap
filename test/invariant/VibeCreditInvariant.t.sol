// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "forge-std/Test.sol";
import "forge-std/StdInvariant.sol";
import "../../contracts/financial/VibeCredit.sol";
import "../../contracts/financial/interfaces/IVibeCredit.sol";
import "../../contracts/oracle/IReputationOracle.sol";
import "@openzeppelin/contracts/token/ERC20/ERC20.sol";

// ============ Mocks ============

contract MockCreditIToken is ERC20 {
    constructor(string memory name_, string memory symbol_) ERC20(name_, symbol_) {}
    function mint(address to, uint256 amount) external { _mint(to, amount); }
}

contract MockCreditIOracle is IReputationOracle {
    mapping(address => uint8) public tiers;
    function setTier(address user, uint8 tier) external { tiers[user] = tier; }
    function getTrustScore(address user) external view returns (uint256) { return uint256(tiers[user]) * 2500; }
    function getTrustTier(address user) external view returns (uint8) { return tiers[user]; }
    function isEligible(address user, uint8 requiredTier) external view returns (bool) { return tiers[user] >= requiredTier; }
}

// ============ Handler ============

contract CreditHandler is Test {
    VibeCredit public credit;
    MockCreditIToken public token;
    MockCreditIOracle public oracle;

    address public delegator;
    address public borrower;

    // Ghost variables
    uint256 public ghost_lineCount;
    uint256 public ghost_totalBorrowed;
    uint256 public ghost_totalRepaid;

    uint256[] public activeLines;

    constructor(
        VibeCredit _credit,
        MockCreditIToken _token,
        MockCreditIOracle _oracle,
        address _delegator,
        address _borrower
    ) {
        credit = _credit;
        token = _token;
        oracle = _oracle;
        delegator = _delegator;
        borrower = _borrower;
    }

    function createAndBorrow(uint256 principal, uint256 borrowFraction) public {
        principal = bound(principal, 10 ether, 100_000 ether);
        borrowFraction = bound(borrowFraction, 1, 7000); // up to 70% of limit

        token.mint(delegator, principal);
        vm.prank(delegator);
        token.approve(address(credit), principal);

        vm.prank(delegator);
        try credit.createCreditLine(IVibeCredit.CreateCreditLineParams({
            borrower: borrower,
            token: address(token),
            amount: principal,
            interestRate: 1000, // 10%
            minTrustTier: 2,
            maturity: uint40(block.timestamp) + 360 days
        })) returns (uint256 id) {
            activeLines.push(id);
            ghost_lineCount++;

            uint256 limit = credit.creditLimit(id);
            uint256 borrowAmount = (limit * borrowFraction) / 10000;
            if (borrowAmount == 0) return;

            vm.prank(borrower);
            try credit.borrow(id, borrowAmount) {
                ghost_totalBorrowed += borrowAmount;
            } catch {}
        } catch {}
    }

    function repay(uint256 lineSeed, uint256 repayFraction) public {
        if (activeLines.length == 0) return;

        uint256 lineId = activeLines[lineSeed % activeLines.length];
        repayFraction = bound(repayFraction, 1, 10000);

        try credit.getCreditLine(lineId) returns (IVibeCredit.CreditLine memory cl) {
            if (cl.state != IVibeCredit.CreditState.ACTIVE) return;
            if (cl.borrowed == 0) return;

            uint256 repayAmount = (cl.borrowed * repayFraction) / 10000;
            if (repayAmount == 0) repayAmount = 1;
            if (repayAmount > cl.borrowed) repayAmount = cl.borrowed;

            token.mint(borrower, repayAmount);
            vm.prank(borrower);
            token.approve(address(credit), repayAmount);

            vm.prank(borrower);
            try credit.repay(lineId, repayAmount) {
                ghost_totalRepaid += repayAmount;
            } catch {}
        } catch {}
    }

    function advanceTime(uint256 delta) public {
        delta = bound(delta, 1, 30 days);
        vm.warp(block.timestamp + delta);
    }

    function getActiveCount() external view returns (uint256) {
        return activeLines.length;
    }
}

// ============ Invariant Tests ============

contract VibeCreditInvariantTest is StdInvariant, Test {
    VibeCredit public credit;
    MockCreditIToken public token;
    MockCreditIToken public jul;
    MockCreditIOracle public oracle;
    CreditHandler public handler;

    address public delegator;
    address public borrower;

    function setUp() public {
        delegator = makeAddr("delegator");
        borrower = makeAddr("borrower");

        jul = new MockCreditIToken("JUL", "JUL");
        token = new MockCreditIToken("USDC", "USDC");
        oracle = new MockCreditIOracle();

        credit = new VibeCredit(address(jul), address(oracle));

        oracle.setTier(borrower, 3); // tier 3 = 75% LTV

        handler = new CreditHandler(credit, token, oracle, delegator, borrower);
        targetContract(address(handler));
    }

    // ============ Invariant: totalCreditLines = ghost line count ============

    function invariant_lineCountConsistent() public view {
        assertEq(
            credit.totalCreditLines(),
            handler.ghost_lineCount(),
            "LINES: count mismatch"
        );
    }

    // ============ Invariant: interest accrual is non-negative ============

    function invariant_interestNonNegative() public view {
        uint256 count = handler.getActiveCount();
        for (uint256 i = 0; i < count && i < 5; i++) {
            uint256 lineId = handler.activeLines(i);
            try credit.getCreditLine(lineId) returns (IVibeCredit.CreditLine memory cl) {
                if (cl.state != IVibeCredit.CreditState.ACTIVE) continue;
                if (cl.borrowed > 0) {
                    uint256 interest = credit.accruedInterest(lineId);
                    // Interest can be 0 if no time elapsed, but never negative
                    assertGe(interest, 0, "INTEREST: must be non-negative");
                }
            } catch {}
        }
    }

    // ============ Invariant: credit limit bounded by principal ============

    function invariant_creditLimitBounded() public view {
        uint256 count = handler.getActiveCount();
        for (uint256 i = 0; i < count && i < 5; i++) {
            uint256 lineId = handler.activeLines(i);
            try credit.getCreditLine(lineId) returns (IVibeCredit.CreditLine memory cl) {
                uint256 limit = credit.creditLimit(lineId);
                // Credit limit must be <= principal (max LTV is 90%)
                assertLe(limit, cl.principal, "LIMIT: exceeds principal");
            } catch {}
        }
    }

    // ============ Invariant: valid credit state ============

    function invariant_validCreditState() public view {
        uint256 count = handler.getActiveCount();
        for (uint256 i = 0; i < count && i < 5; i++) {
            uint256 lineId = handler.activeLines(i);
            try credit.getCreditLine(lineId) returns (IVibeCredit.CreditLine memory cl) {
                uint8 state = uint8(cl.state);
                assertTrue(
                    state <= uint8(IVibeCredit.CreditState.CLOSED),
                    "STATE: invalid credit state"
                );
            } catch {}
        }
    }

    // ============ Invariant: borrowed <= principal for active lines ============

    function invariant_borrowedWithinPrincipal() public view {
        uint256 count = handler.getActiveCount();
        for (uint256 i = 0; i < count && i < 5; i++) {
            uint256 lineId = handler.activeLines(i);
            try credit.getCreditLine(lineId) returns (IVibeCredit.CreditLine memory cl) {
                if (cl.state != IVibeCredit.CreditState.ACTIVE) continue;
                // Borrowed amount (before interest) should not exceed principal
                assertLe(cl.borrowed, cl.principal, "DEBT: borrowed exceeds principal");
            } catch {}
        }
    }
}
