// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "forge-std/Test.sol";
import "../../contracts/monetary/JULBridge.sol";
import "../../contracts/monetary/CKBNativeToken.sol";
import "@openzeppelin/contracts/proxy/ERC1967/ERC1967Proxy.sol";

/// @notice Mock JUL token for testing (simplified — no rebase)
contract MockJUL {
    mapping(address => uint256) public balanceOf;
    mapping(address => mapping(address => uint256)) public allowance;

    function mint(address to, uint256 amount) external {
        balanceOf[to] += amount;
    }

    function approve(address spender, uint256 amount) external returns (bool) {
        allowance[msg.sender][spender] = amount;
        return true;
    }

    function transferFrom(address from, address to, uint256 amount) external returns (bool) {
        require(balanceOf[from] >= amount, "insufficient");
        require(allowance[from][msg.sender] >= amount, "no allowance");
        balanceOf[from] -= amount;
        allowance[from][msg.sender] -= amount;
        balanceOf[to] += amount;
        return true;
    }
}

contract JULBridgeTest is Test {
    JULBridge public bridge;
    CKBNativeToken public ckb;
    MockJUL public jul;

    address owner = makeAddr("owner");
    address user1 = makeAddr("user1");
    address user2 = makeAddr("user2");

    function setUp() public {
        // Deploy mock JUL
        jul = new MockJUL();

        // Deploy CKB-native
        CKBNativeToken ckbImpl = new CKBNativeToken();
        bytes memory ckbData = abi.encodeWithSelector(CKBNativeToken.initialize.selector, owner);
        ERC1967Proxy ckbProxy = new ERC1967Proxy(address(ckbImpl), ckbData);
        ckb = CKBNativeToken(address(ckbProxy));

        // Deploy bridge
        JULBridge bridgeImpl = new JULBridge();
        bytes memory bridgeData = abi.encodeWithSelector(
            JULBridge.initialize.selector,
            address(jul),
            address(ckb),
            owner
        );
        ERC1967Proxy bridgeProxy = new ERC1967Proxy(address(bridgeImpl), bridgeData);
        bridge = JULBridge(address(bridgeProxy));

        // Authorize bridge as CKB-native minter
        vm.prank(owner);
        ckb.setMinter(address(bridge), true);

        // Give user1 some JUL
        jul.mint(user1, 10_000e18);
    }

    // ============ Basic Bridge ============

    function test_bridgeConvertsJULtoCKB() public {
        vm.startPrank(user1);
        jul.approve(address(bridge), 1000e18);
        uint256 ckbOut = bridge.bridge(1000e18);
        vm.stopPrank();

        assertEq(ckbOut, 1000e18, "1:1 rate");
        assertEq(ckb.balanceOf(user1), 1000e18);
        assertEq(jul.balanceOf(address(bridge)), 1000e18, "JUL locked in bridge");
        assertEq(jul.balanceOf(user1), 9000e18);
    }

    function test_bridgeIsOneWay() public {
        // There is no reverse function — JUL is permanently locked
        // This is verified by the absence of any withdrawal/reverse function
        vm.startPrank(user1);
        jul.approve(address(bridge), 1000e18);
        bridge.bridge(1000e18);
        vm.stopPrank();

        // JUL is in the bridge contract with no way out
        assertEq(jul.balanceOf(address(bridge)), 1000e18);
    }

    function test_bridgeTracksTotals() public {
        vm.startPrank(user1);
        jul.approve(address(bridge), 2000e18);
        bridge.bridge(1000e18);
        bridge.bridge(500e18);
        vm.stopPrank();

        assertEq(bridge.totalJULLocked(), 1500e18);
        assertEq(bridge.totalCKBMinted(), 1500e18);
    }

    // ============ Exchange Rate ============

    function test_customExchangeRate() public {
        // Set 2:1 rate (2 CKB per JUL)
        vm.prank(owner);
        bridge.setExchangeRate(2e18);

        vm.startPrank(user1);
        jul.approve(address(bridge), 1000e18);
        uint256 ckbOut = bridge.bridge(1000e18);
        vm.stopPrank();

        assertEq(ckbOut, 2000e18);
        assertEq(ckb.balanceOf(user1), 2000e18);
    }

    function test_previewMatchesBridge() public {
        vm.prank(owner);
        bridge.setExchangeRate(1.5e18);

        uint256 preview = bridge.preview(1000e18);

        vm.startPrank(user1);
        jul.approve(address(bridge), 1000e18);
        uint256 actual = bridge.bridge(1000e18);
        vm.stopPrank();

        assertEq(preview, actual);
    }

    // ============ Rate Limiting ============

    function test_rateLimitPreventsExcessiveConversion() public {
        // Default: 100K per epoch
        jul.mint(user1, 200_000e18);

        vm.startPrank(user1);
        jul.approve(address(bridge), 200_000e18);

        // First 100K succeeds
        bridge.bridge(100_000e18);

        // Next 1 fails — rate limited
        vm.expectRevert(JULBridge.RateLimitExceeded.selector);
        bridge.bridge(1e18);
        vm.stopPrank();
    }

    function test_rateLimitResetsNextEpoch() public {
        jul.mint(user1, 200_000e18);

        vm.startPrank(user1);
        jul.approve(address(bridge), 200_000e18);
        bridge.bridge(100_000e18);
        vm.stopPrank();

        // Advance past epoch
        vm.warp(block.timestamp + 1 hours + 1);

        vm.startPrank(user1);
        bridge.bridge(50_000e18);
        vm.stopPrank();

        assertEq(ckb.balanceOf(user1), 150_000e18);
    }

    function test_remainingThisEpoch() public {
        assertEq(bridge.remainingThisEpoch(), 100_000e18);

        vm.startPrank(user1);
        jul.approve(address(bridge), 5_000e18);
        bridge.bridge(5_000e18);
        vm.stopPrank();

        assertEq(bridge.remainingThisEpoch(), 95_000e18);
    }

    // ============ Pause ============

    function test_pauseBlocksBridge() public {
        vm.prank(owner);
        bridge.setPaused(true);

        vm.startPrank(user1);
        jul.approve(address(bridge), 1000e18);
        vm.expectRevert(JULBridge.BridgeIsPaused.selector);
        bridge.bridge(1000e18);
        vm.stopPrank();
    }

    function test_unpauseAllowsBridge() public {
        vm.prank(owner);
        bridge.setPaused(true);

        vm.prank(owner);
        bridge.setPaused(false);

        vm.startPrank(user1);
        jul.approve(address(bridge), 1000e18);
        bridge.bridge(1000e18);
        vm.stopPrank();

        assertEq(ckb.balanceOf(user1), 1000e18);
    }

    // ============ Edge Cases ============

    function test_cannotBridgeZero() public {
        vm.prank(user1);
        vm.expectRevert(JULBridge.ZeroAmount.selector);
        bridge.bridge(0);
    }

    function test_cannotSetZeroExchangeRate() public {
        vm.prank(owner);
        vm.expectRevert(JULBridge.ZeroAmount.selector);
        bridge.setExchangeRate(0);
    }

    // ============ Fuzz ============

    function testFuzz_bridgeConservation(uint256 amount) public {
        amount = bound(amount, 1, 100_000e18);

        jul.mint(user1, amount);

        uint256 julBefore = jul.balanceOf(user1);

        vm.startPrank(user1);
        jul.approve(address(bridge), amount);
        uint256 ckbOut = bridge.bridge(amount);
        vm.stopPrank();

        // JUL decreased by exact amount
        assertEq(jul.balanceOf(user1), julBefore - amount);
        // CKB minted equals output
        assertEq(ckb.balanceOf(user1), ckbOut);
        // Bridge holds the JUL
        assertGe(jul.balanceOf(address(bridge)), amount);
    }
}
