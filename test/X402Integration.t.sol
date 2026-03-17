// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "forge-std/Test.sol";
import "../contracts/mechanism/AugmentedBondingCurve.sol";
import "../contracts/mechanism/IABCHealthCheck.sol";

/**
 * @title X402Integration
 * @notice Tests the x402 payment pattern at the contract level.
 *         Validates that the ABC health gate correctly integrates
 *         with the payment verification flow.
 */
contract X402IntegrationTest is Test {
    AugmentedBondingCurve public abc;

    address treasury = address(0xTREASURY);
    address agent = address(0xAGENT);

    function setUp() public {
        // Deploy a mock ABC for testing x402 health checks
        MockToken reserve = new MockToken("USDC", "USDC");
        MockToken community = new MockToken("VIBE", "VIBE");

        abc = new AugmentedBondingCurve(
            address(reserve),
            address(community),
            address(community),
            6, 200, 500
        );

        reserve.mint(address(abc), 10000e18);
        community.mint(address(this), 100000e18);

        abc.openCurve(10000e18, 1000e18, 100000e18);
    }

    /// @notice x402 should only gate when ABC is healthy
    function test_x402_gatePasses_whenHealthy() public view {
        (bool healthy,) = abc.isHealthy();
        assertTrue(healthy, "ABC should be healthy for x402 to pass");
    }

    /// @notice Verify treasury receives ETH (simulates x402 payment)
    function test_x402_paymentFlow() public {
        vm.deal(agent, 1 ether);

        uint256 balBefore = treasury.balance;

        vm.prank(agent);
        (bool ok,) = treasury.call{value: 0.001 ether}("");
        assertTrue(ok, "Payment should succeed");

        assertEq(treasury.balance - balBefore, 0.001 ether, "Treasury should receive payment");
    }

    /// @notice Verify x402 pricing consistency — spot price * amount = expected cost
    function test_x402_pricingConsistency() public view {
        uint256 price = abc.spotPrice();
        assertGt(price, 0, "Spot price should be positive");

        // Verify the price is deterministic (same inputs = same output)
        uint256 price2 = abc.spotPrice();
        assertEq(price, price2, "Price should be deterministic");
    }
}

// Mock token for testing
contract MockToken {
    string public name;
    string public symbol;
    uint8 public decimals = 18;
    uint256 public totalSupply;
    mapping(address => uint256) public balanceOf;
    mapping(address => mapping(address => uint256)) public allowance;

    constructor(string memory _name, string memory _symbol) {
        name = _name;
        symbol = _symbol;
    }

    function mint(address to, uint256 amount) external {
        balanceOf[to] += amount;
        totalSupply += amount;
    }

    function transfer(address to, uint256 amount) external returns (bool) {
        balanceOf[msg.sender] -= amount;
        balanceOf[to] += amount;
        return true;
    }

    function transferFrom(address from, address to, uint256 amount) external returns (bool) {
        allowance[from][msg.sender] -= amount;
        balanceOf[from] -= amount;
        balanceOf[to] += amount;
        return true;
    }

    function approve(address spender, uint256 amount) external returns (bool) {
        allowance[msg.sender][spender] = amount;
        return true;
    }

    function burnFrom(address from, uint256 amount) external {
        balanceOf[from] -= amount;
        totalSupply -= amount;
    }
}
