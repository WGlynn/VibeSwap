// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "forge-std/Test.sol";
import "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import "../../contracts/amm/VibeLP.sol";

contract MockLPFuzzA is ERC20 {
    constructor() ERC20("Token A", "TKA") {}
}

contract MockLPFuzzB is ERC20 {
    constructor() ERC20("Token B", "TKB") {}
}

contract VibeLPFuzzTest is Test {
    VibeLP public lp;
    address public token0;
    address public token1;

    function setUp() public {
        token0 = address(new MockLPFuzzA());
        token1 = address(new MockLPFuzzB());
        lp = new VibeLP(token0, token1, address(this));
    }

    /// @notice First mint always locks MINIMUM_LIQUIDITY
    function testFuzz_firstMintLocksMinimum(uint256 amount) public {
        amount = bound(amount, 1001, 1e24);

        lp.mint(makeAddr("user"), amount);

        assertTrue(lp.minimumLiquidityLocked());
        assertEq(lp.balanceOf(address(0xdead)), 1000);
        assertEq(lp.totalSupply(), amount);
    }

    /// @notice Subsequent mints give exact amount (no minimum lock)
    function testFuzz_subsequentMintExact(uint256 firstAmount, uint256 secondAmount) public {
        firstAmount = bound(firstAmount, 1001, 1e24);
        secondAmount = bound(secondAmount, 1, 1e24);

        address user = makeAddr("user");
        lp.mint(user, firstAmount);
        uint256 balAfterFirst = lp.balanceOf(user);

        lp.mint(user, secondAmount);
        assertEq(lp.balanceOf(user), balAfterFirst + secondAmount);
    }

    /// @notice Burn never exceeds balance
    function testFuzz_burnReducesBalance(uint256 mintAmount, uint256 burnAmount) public {
        mintAmount = bound(mintAmount, 1001, 1e24);
        address user = makeAddr("user");
        lp.mint(user, mintAmount);
        uint256 userBal = lp.balanceOf(user);

        burnAmount = bound(burnAmount, 1, userBal);
        lp.burn(user, burnAmount);

        assertEq(lp.balanceOf(user), userBal - burnAmount);
    }

    /// @notice Total supply is consistent after mints and burns
    function testFuzz_totalSupplyConsistent(uint256 mintAmt, uint256 burnAmt) public {
        mintAmt = bound(mintAmt, 1001, 1e24);
        address user = makeAddr("user");
        lp.mint(user, mintAmt);

        uint256 userBal = lp.balanceOf(user);
        burnAmt = bound(burnAmt, 0, userBal);
        if (burnAmt > 0) lp.burn(user, burnAmt);

        assertEq(lp.totalSupply(), lp.balanceOf(address(0xdead)) + lp.balanceOf(user));
    }
}
