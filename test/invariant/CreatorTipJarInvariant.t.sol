// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "forge-std/Test.sol";
import "forge-std/StdInvariant.sol";
import "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import "../../contracts/CreatorTipJar.sol";

contract MockCTJIToken is ERC20 {
    constructor() ERC20("Mock", "MTK") {}
    function mint(address to, uint256 amount) external { _mint(to, amount); }
}

// ============ Handler ============

contract TipJarHandler is Test {
    CreatorTipJar public jar;
    MockCTJIToken public token;

    uint256 public ghost_totalEthTipped;
    uint256 public ghost_totalTokenTipped;
    uint256 public ghost_ethWithdrawn;
    uint256 public ghost_tokenWithdrawn;

    constructor(CreatorTipJar _jar, MockCTJIToken _token) {
        jar = _jar;
        token = _token;
    }

    function tipEth(uint256 amount) public {
        amount = bound(amount, 1, 10 ether);
        address tipper = makeAddr(string(abi.encodePacked("tipper", ghost_totalEthTipped)));
        vm.deal(tipper, amount);
        vm.prank(tipper);
        try jar.tipEth{value: amount}("") {
            ghost_totalEthTipped += amount;
        } catch {}
    }

    function tipToken(uint256 amount) public {
        amount = bound(amount, 1, 1000e18);
        address tipper = makeAddr(string(abi.encodePacked("tokenTipper", ghost_totalTokenTipped)));
        token.mint(tipper, amount);
        vm.prank(tipper);
        token.approve(address(jar), amount);
        vm.prank(tipper);
        try jar.tipToken(address(token), amount, "") {
            ghost_totalTokenTipped += amount;
        } catch {}
    }

    function withdrawEth() public {
        uint256 bal = address(jar).balance;
        vm.prank(jar.creator());
        try jar.withdrawEth() {
            ghost_ethWithdrawn += bal;
        } catch {}
    }

    function withdrawToken() public {
        uint256 bal = token.balanceOf(address(jar));
        vm.prank(jar.creator());
        try jar.withdrawToken(address(token)) {
            ghost_tokenWithdrawn += bal;
        } catch {}
    }
}

// ============ Invariant Tests ============

contract CreatorTipJarInvariantTest is StdInvariant, Test {
    CreatorTipJar public jar;
    MockCTJIToken public token;
    TipJarHandler public handler;

    function setUp() public {
        address creator = makeAddr("creator");
        jar = new CreatorTipJar(creator);
        token = new MockCTJIToken();

        handler = new TipJarHandler(jar, token);
        targetContract(address(handler));
    }

    /// @notice ETH balance = total tipped - total withdrawn
    function invariant_ethBalanceConsistent() public view {
        assertEq(
            address(jar).balance,
            handler.ghost_totalEthTipped() - handler.ghost_ethWithdrawn(),
            "ETH: balance mismatch"
        );
    }

    /// @notice Token balance = total tipped - total withdrawn
    function invariant_tokenBalanceConsistent() public view {
        assertEq(
            token.balanceOf(address(jar)),
            handler.ghost_totalTokenTipped() - handler.ghost_tokenWithdrawn(),
            "TOKEN: balance mismatch"
        );
    }

    /// @notice totalEthTips counter matches ghost
    function invariant_totalEthTipsMatchesGhost() public view {
        assertEq(jar.totalEthTips(), handler.ghost_totalEthTipped(), "ETH_TIPS: ghost mismatch");
    }

    /// @notice totalTokenTips counter matches ghost
    function invariant_totalTokenTipsMatchesGhost() public view {
        assertEq(jar.totalTokenTips(address(token)), handler.ghost_totalTokenTipped(), "TOKEN_TIPS: ghost mismatch");
    }
}
