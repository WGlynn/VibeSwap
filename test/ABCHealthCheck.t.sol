// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "forge-std/Test.sol";
import "../contracts/mechanism/AugmentedBondingCurve.sol";
import "../contracts/mechanism/IABCHealthCheck.sol";
import "@openzeppelin/contracts/token/ERC20/ERC20.sol";

/// @dev Mock ERC20 for testing
contract MockToken is ERC20 {
    constructor(string memory name, string memory symbol) ERC20(name, symbol) {}
    function mint(address to, uint256 amount) external { _mint(to, amount); }
    function burnFrom(address from, uint256 amount) external { _burn(from, amount); }
}

contract ABCHealthCheckTest is Test {
    AugmentedBondingCurve public abc;
    MockToken public reserve;
    MockToken public community;

    address owner = address(this);
    uint256 constant INITIAL_RESERVE = 1000e18;
    uint256 constant INITIAL_SUPPLY = 10000e18;
    uint256 constant INITIAL_FUNDING = 100e18;

    function setUp() public {
        reserve = new MockToken("Reserve", "RSV");
        community = new MockToken("Community", "COM");

        abc = new AugmentedBondingCurve(
            address(reserve),
            address(community),
            address(community), // tokenController
            6,    // kappa
            200,  // 2% entry tribute
            500   // 5% exit tribute
        );

        // Mint initial tokens
        reserve.mint(address(abc), INITIAL_RESERVE);
        community.mint(address(this), INITIAL_SUPPLY);

        // Open curve
        abc.openCurve(INITIAL_RESERVE, INITIAL_FUNDING, INITIAL_SUPPLY);
    }

    function test_isHealthy_afterInit() public view {
        (bool healthy, uint256 driftBps) = abc.isHealthy();
        assertTrue(healthy, "Should be healthy after init");
        assertEq(driftBps, 0, "Should have zero drift after init");
    }

    function test_isHealthy_returnsFalseWhenNotOpen() public {
        // Deploy a new ABC without opening
        AugmentedBondingCurve abc2 = new AugmentedBondingCurve(
            address(reserve),
            address(community),
            address(community),
            6, 200, 500
        );
        (bool healthy, uint256 driftBps) = abc2.isHealthy();
        assertFalse(healthy, "Should not be healthy when not open");
        assertEq(driftBps, 10000, "Should return max drift when not open");
    }

    function test_MAX_DRIFT_BPS() public view {
        assertEq(abc.MAX_DRIFT_BPS(), 500, "MAX_DRIFT should be 5%");
    }

    function test_LAWSON_CONSTANT() public view {
        bytes32 expected = keccak256("FAIRNESS_ABOVE_ALL:W.GLYNN:2026");
        assertEq(abc.LAWSON_CONSTANT(), expected, "Lawson Constant mismatch");
    }

    function test_invariantPreservedAfterBond() public {
        uint256 depositAmount = 100e18;
        reserve.mint(address(this), depositAmount);
        reserve.approve(address(abc), depositAmount);

        abc.bondToMint(depositAmount, 0);

        (bool healthy, uint256 driftBps) = abc.isHealthy();
        assertTrue(healthy, "Should still be healthy after bond");
        assertLt(driftBps, 10, "Drift should be minimal after bond"); // < 0.1%
    }

    function test_spotPrice() public view {
        uint256 price = abc.spotPrice();
        assertGt(price, 0, "Spot price should be positive");
    }

    function test_getCurveState() public view {
        (uint256 r, uint256 f, uint256 s, uint256 p, uint256 inv, bool open) = abc.getCurveState();
        assertEq(r, INITIAL_RESERVE, "Reserve mismatch");
        assertEq(f, INITIAL_FUNDING, "Funding pool mismatch");
        assertEq(s, INITIAL_SUPPLY, "Supply mismatch");
        assertGt(p, 0, "Price should be positive");
        assertGt(inv, 0, "Invariant should be positive");
        assertTrue(open, "Should be open");
    }
}
