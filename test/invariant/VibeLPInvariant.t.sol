// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "forge-std/Test.sol";
import "forge-std/StdInvariant.sol";
import "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import "../../contracts/amm/VibeLP.sol";

contract MockLPInvA is ERC20 {
    constructor() ERC20("Token A", "TKA") {}
}
contract MockLPInvB is ERC20 {
    constructor() ERC20("Token B", "TKB") {}
}

// ============ Handler ============

contract LPHandler is Test {
    VibeLP public lp;

    uint256 public ghost_totalMinted;
    uint256 public ghost_totalBurned;
    bool public firstMintDone;

    constructor(VibeLP _lp) {
        lp = _lp;
    }

    function mint(uint256 amount) public {
        if (!firstMintDone) {
            amount = bound(amount, 1001, 1e22);
        } else {
            amount = bound(amount, 1, 1e22);
        }
        address user = makeAddr(string(abi.encodePacked("user", ghost_totalMinted)));
        try lp.mint(user, amount) {
            ghost_totalMinted += amount;
            if (!firstMintDone) firstMintDone = true;
        } catch {}
    }

    function burn(uint256 amount) public {
        if (!firstMintDone) return;
        address user = makeAddr(string(abi.encodePacked("user", ghost_totalBurned)));
        uint256 bal = lp.balanceOf(user);
        if (bal == 0) return;
        amount = bound(amount, 1, bal);
        try lp.burn(user, amount) {
            ghost_totalBurned += amount;
        } catch {}
    }
}

// ============ Invariant Tests ============

contract VibeLPInvariantTest is StdInvariant, Test {
    VibeLP public lp;
    LPHandler public handler;

    function setUp() public {
        address token0 = address(new MockLPInvA());
        address token1 = address(new MockLPInvB());
        lp = new VibeLP(token0, token1, address(this));

        handler = new LPHandler(lp);
        // Handler calls mint/burn as owner since test contract is owner
        // Need to transfer ownership to handler
        lp.transferOwnership(address(handler));

        targetContract(address(handler));
    }

    /// @notice Total supply = minted - burned
    function invariant_totalSupplyConsistent() public view {
        assertEq(lp.totalSupply(), handler.ghost_totalMinted() - handler.ghost_totalBurned(), "SUPPLY: mismatch");
    }

    /// @notice Dead address always has MINIMUM_LIQUIDITY after first mint
    function invariant_minimumLiquidityLocked() public view {
        if (handler.firstMintDone()) {
            assertEq(lp.balanceOf(address(0xdead)), 1000, "MINIMUM: not locked");
        }
    }
}
