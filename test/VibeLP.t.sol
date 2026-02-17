// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "forge-std/Test.sol";
import "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import "../contracts/amm/VibeLP.sol";

contract MinimalContract {
    // Intentionally does NOT implement IERC20Metadata
}

contract MockLPToken0 is ERC20 {
    constructor() ERC20("Token A", "TKA") {}
}

contract MockLPToken1 is ERC20 {
    constructor() ERC20("Token B", "TKB") {}
}

contract VibeLPTest is Test {
    VibeLP public lp;
    address public token0;
    address public token1;
    address public ammOwner;
    address public user1;
    address public user2;

    function setUp() public {
        ammOwner = address(this);
        user1 = makeAddr("user1");
        user2 = makeAddr("user2");

        token0 = address(new MockLPToken0());
        token1 = address(new MockLPToken1());

        lp = new VibeLP(token0, token1, ammOwner);
    }

    // ============ Constructor ============

    function test_constructor() public view {
        assertEq(lp.token0(), token0);
        assertEq(lp.token1(), token1);
        assertEq(lp.owner(), ammOwner);
        assertEq(lp.MINIMUM_LIQUIDITY(), 1000);
        assertFalse(lp.minimumLiquidityLocked());
    }

    function test_constructor_nameAndSymbol() public view {
        // Should contain token symbols
        string memory name = lp.name();
        string memory symbol = lp.symbol();
        assertTrue(bytes(name).length > 0);
        assertTrue(bytes(symbol).length > 0);
    }

    function test_constructor_zeroToken0() public {
        // Reverts in ERC20 super constructor when _tokenSymbol calls IERC20Metadata on zero addr
        vm.expectRevert();
        new VibeLP(address(0), token1, ammOwner);
    }

    function test_constructor_zeroToken1() public {
        vm.expectRevert();
        new VibeLP(token0, address(0), ammOwner);
    }

    function test_constructor_identicalTokens() public {
        vm.expectRevert("Identical tokens");
        new VibeLP(token0, token0, ammOwner);
    }

    // ============ First Mint (Minimum Liquidity Lock) ============

    function test_firstMint_locksMinimumLiquidity() public {
        uint256 amount = 10_000;

        lp.mint(user1, amount);

        assertTrue(lp.minimumLiquidityLocked());
        // Dead address gets MINIMUM_LIQUIDITY
        assertEq(lp.balanceOf(address(0xdead)), 1000);
        // User gets amount - MINIMUM_LIQUIDITY
        assertEq(lp.balanceOf(user1), amount - 1000);
        // Total supply = amount
        assertEq(lp.totalSupply(), amount);
    }

    function test_firstMint_insufficientInitialLiquidity() public {
        vm.expectRevert("Insufficient initial liquidity");
        lp.mint(user1, 1000); // Exactly MINIMUM_LIQUIDITY, not enough
    }

    function test_firstMint_barelyAboveMinimum() public {
        lp.mint(user1, 1001);
        assertEq(lp.balanceOf(user1), 1);
        assertEq(lp.balanceOf(address(0xdead)), 1000);
    }

    // ============ Subsequent Mints ============

    function test_subsequentMint_noMinimumLock() public {
        lp.mint(user1, 10_000); // First mint

        lp.mint(user2, 5_000); // Second mint
        assertEq(lp.balanceOf(user2), 5_000);
    }

    function test_subsequentMint_smallAmount() public {
        lp.mint(user1, 10_000); // First mint

        lp.mint(user2, 1); // Second mint, even 1 wei works
        assertEq(lp.balanceOf(user2), 1);
    }

    // ============ Burn ============

    function test_burn() public {
        lp.mint(user1, 10_000);
        uint256 userBalance = lp.balanceOf(user1);

        lp.burn(user1, userBalance);
        assertEq(lp.balanceOf(user1), 0);
    }

    function test_burn_partial() public {
        lp.mint(user1, 10_000);

        lp.burn(user1, 1000);
        assertEq(lp.balanceOf(user1), 10_000 - 1000 - 1000); // Minus MINIMUM_LIQUIDITY and burned
    }

    function test_burn_onlyOwner() public {
        lp.mint(user1, 10_000);

        vm.prank(user1);
        vm.expectRevert();
        lp.burn(user1, 100);
    }

    // ============ Access Control ============

    function test_mint_onlyOwner() public {
        vm.prank(user1);
        vm.expectRevert();
        lp.mint(user1, 10_000);
    }

    // ============ ERC20 Standard ============

    function test_transfer() public {
        lp.mint(user1, 10_000);
        uint256 user1Bal = lp.balanceOf(user1);

        vm.prank(user1);
        lp.transfer(user2, 1000);

        assertEq(lp.balanceOf(user1), user1Bal - 1000);
        assertEq(lp.balanceOf(user2), 1000);
    }

    function test_approve_and_transferFrom() public {
        lp.mint(user1, 10_000);
        uint256 user1Bal = lp.balanceOf(user1);

        vm.prank(user1);
        lp.approve(user2, 500);

        vm.prank(user2);
        lp.transferFrom(user1, user2, 500);

        assertEq(lp.balanceOf(user1), user1Bal - 500);
        assertEq(lp.balanceOf(user2), 500);
    }

    // ============ Token Symbol Fallback ============

    function test_constructor_withNonERC20Tokens() public {
        // Deploy minimal contracts that don't implement IERC20Metadata
        // Solidity 0.8.20 try/catch requires code at target address
        MinimalContract fake0 = new MinimalContract();
        MinimalContract fake1 = new MinimalContract();

        VibeLP lpFake = new VibeLP(address(fake0), address(fake1), ammOwner);
        assertTrue(bytes(lpFake.name()).length > 0);
    }
}
