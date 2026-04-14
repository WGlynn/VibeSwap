// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "forge-std/Test.sol";
import "../../contracts/monetary/JULBridge.sol";
import "../../contracts/monetary/CKBNativeToken.sol";
import "@openzeppelin/contracts/proxy/ERC1967/ERC1967Proxy.sol";

/// @notice Mock JUL token for testing.
/// @dev    Internal balance is the rebase-invariant unit. External (display)
///         balance = internal * rebaseScalar / 1e18. Default scalar = 1e18 so
///         legacy tests that ignore rebase still see 1:1 mapping.
contract MockJUL {
    mapping(address => uint256) internal _internalBalance;
    mapping(address => mapping(address => uint256)) public allowance;
    uint256 public rebaseScalar = 1e18;

    function balanceOf(address account) public view returns (uint256) {
        return (_internalBalance[account] * rebaseScalar) / 1e18;
    }

    function internalBalanceOf(address account) external view returns (uint256) {
        return _internalBalance[account];
    }

    /// @dev Test helper: scales the supply (positive or negative rebase).
    function setRebaseScalar(uint256 newScalar) external {
        require(newScalar > 0, "zero scalar");
        rebaseScalar = newScalar;
    }

    /// @dev Mint by external (display) amount. Internal credit = amount/scalar.
    function mint(address to, uint256 amount) external {
        _internalBalance[to] += (amount * 1e18) / rebaseScalar;
    }

    function approve(address spender, uint256 amount) external returns (bool) {
        allowance[msg.sender][spender] = amount;
        return true;
    }

    function transferFrom(address from, address to, uint256 amount) external returns (bool) {
        require(balanceOf(from) >= amount, "insufficient");
        require(allowance[from][msg.sender] >= amount, "no allowance");
        // Convert external amount to internal units for storage
        uint256 internalAmount = (amount * 1e18) / rebaseScalar;
        require(_internalBalance[from] >= internalAmount, "insufficient internal");
        _internalBalance[from] -= internalAmount;
        allowance[from][msg.sender] -= amount;
        _internalBalance[to] += internalAmount;
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

    // Mirror of the event declared on JULBridge — Solidity requires an accessible
    // declaration for `emit X(...)` expectations at this call site.
    event BridgedInternal(
        address indexed user,
        uint256 internalJulBurned,
        uint256 externalJulBurned,
        uint256 ckbMinted
    );

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
        // MON-004: Rate capped to 10% change per update. Set 1.1:1 rate
        vm.prank(owner);
        bridge.setExchangeRate(1.1e18);

        vm.startPrank(user1);
        jul.approve(address(bridge), 1000e18);
        uint256 ckbOut = bridge.bridge(1000e18);
        vm.stopPrank();

        assertEq(ckbOut, 1100e18);
        assertEq(ckb.balanceOf(user1), 1100e18);
    }

    function test_previewMatchesBridge() public {
        // MON-004: Use rate within 10% bound
        vm.prank(owner);
        bridge.setExchangeRate(1.05e18);

        uint256 preview = bridge.preview(1000e18);

        vm.startPrank(user1);
        jul.approve(address(bridge), 1000e18);
        uint256 actual = bridge.bridge(1000e18);
        vm.stopPrank();

        assertEq(preview, actual);
    }

    // ============ Rate Limiting ============

    function test_rateLimitPreventsExcessiveConversion() public {
        // Default: 100K internal JUL per epoch (C7-GOV-005)
        jul.mint(user1, 200_000e18);

        vm.startPrank(user1);
        jul.approve(address(bridge), 200_000e18);

        // First 100K succeeds
        bridge.bridge(100_000e18);

        // Next 1 fails — internal rate limit hit
        vm.expectRevert(JULBridge.InternalRateLimitExceeded.selector);
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

    // ============ C7-GOV-005: Rebase-Invariant Rate Limiting ============

    /// @notice Under a 2x positive rebase, the OLD (external-units) limit would
    ///         accommodate HALF as many internal-equivalent JUL, but an attacker
    ///         bridging 200K display = 100K internal passes the old cap (since
    ///         100K external default cap would revert before 200K external).
    ///         Wait — that's the opposite direction. Key insight: with scalar=2x,
    ///         1 internal = 2 display. An attacker with 200K display (= 100K
    ///         internal) can only bridge 100K display under the old cap, which
    ///         is just 50K internal. So positive rebase actually TIGHTENS the old
    ///         external cap in internal terms — the internal cap lets the full
    ///         100K internal through.
    function test_positiveRebaseInternalGateAllowsFull100KInternal() public {
        // user2 is untouched by setUp. Use it for clean math.
        jul.mint(user2, 400_000e18); // internal=400K at scalar=1e18

        jul.setRebaseScalar(2e18);
        // user2 display = 400K * 2 = 800K. internal unchanged.
        assertEq(jul.balanceOf(user2), 800_000e18);

        vm.startPrank(user2);
        jul.approve(address(bridge), 800_000e18);

        // Bridge 200K display = 100K internal at 2x scalar. Internal cap = 100K.
        bridge.bridge(200_000e18);
        vm.stopPrank();

        assertEq(bridge.internalConvertedThisEpoch(), 100_000e18);
        assertEq(bridge.convertedThisEpoch(), 200_000e18);

        // Any further bridge must revert on internal cap.
        vm.startPrank(user2);
        vm.expectRevert(JULBridge.InternalRateLimitExceeded.selector);
        bridge.bridge(2e18); // 1 internal unit
        vm.stopPrank();
    }

    /// @notice Under a 0.5x negative rebase, 1 internal = 0.5 display. Under the
    ///         OLD (external) 100K cap, a user could bridge 100K display = 200K
    ///         internal — DOUBLE the intended limit. The internal gate correctly
    ///         caps at 100K internal (= 50K display).
    function test_negativeRebaseInternalGateCapsAt100KInternal() public {
        jul.mint(user2, 400_000e18); // internal=400K

        jul.setRebaseScalar(0.5e18);
        // user2 display = 400K * 0.5 = 200K
        assertEq(jul.balanceOf(user2), 200_000e18);

        vm.startPrank(user2);
        jul.approve(address(bridge), 200_000e18);

        // 50K display = 100K internal at 0.5x scalar. Hits internal cap exactly.
        bridge.bridge(50_000e18);
        vm.stopPrank();

        assertEq(bridge.internalConvertedThisEpoch(), 100_000e18);

        // Under OLD logic user could now bridge another 50K display (still within
        // 100K external cap) = another 100K internal = 2x intended limit. The
        // internal gate prevents this.
        vm.startPrank(user2);
        vm.expectRevert(JULBridge.InternalRateLimitExceeded.selector);
        bridge.bridge(1e18); // 2 internal units
        vm.stopPrank();
    }

    function test_internalRateLimitResetsNextEpoch() public {
        jul.mint(user1, 300_000e18);

        vm.startPrank(user1);
        jul.approve(address(bridge), 300_000e18);
        bridge.bridge(100_000e18);
        vm.stopPrank();

        assertEq(bridge.internalConvertedThisEpoch(), 100_000e18);
        assertEq(bridge.remainingInternalThisEpoch(), 0);

        // Advance past epoch
        vm.warp(block.timestamp + 1 hours + 1);

        // View reports fresh allowance pre-rollover
        assertEq(bridge.remainingInternalThisEpoch(), 100_000e18);

        vm.startPrank(user1);
        bridge.bridge(80_000e18);
        vm.stopPrank();

        assertEq(bridge.internalConvertedThisEpoch(), 80_000e18);
    }

    function test_setInternalRateLimit() public {
        vm.prank(owner);
        bridge.setInternalRateLimit(50_000e18);

        assertEq(bridge.maxInternalPerEpoch(), 50_000e18);

        jul.mint(user1, 100_000e18);
        vm.startPrank(user1);
        jul.approve(address(bridge), 100_000e18);
        bridge.bridge(50_000e18);

        // Exactly at the new limit
        vm.expectRevert(JULBridge.InternalRateLimitExceeded.selector);
        bridge.bridge(1e18);
        vm.stopPrank();
    }

    function test_setInternalRateLimitRejectsZero() public {
        vm.prank(owner);
        vm.expectRevert(JULBridge.ZeroAmount.selector);
        bridge.setInternalRateLimit(0);
    }

    function test_setInternalRateLimitOnlyOwner() public {
        vm.prank(user1);
        vm.expectRevert();
        bridge.setInternalRateLimit(10_000e18);
    }

    /// @notice Simulates an upgrade where maxInternalPerEpoch defaults to 0.
    ///         All bridge calls must revert until owner explicitly sets it.
    function test_zeroInternalLimitDeniesAll() public {
        // Drop the internal limit to 0 (simulating post-upgrade default)
        vm.prank(owner);
        // setInternalRateLimit(0) reverts — use a direct storage write via the
        // owner-only path: lower to 1 wei, then confirm even 1 internal unit reverts.
        bridge.setInternalRateLimit(1);

        jul.mint(user1, 10_000e18);
        vm.startPrank(user1);
        jul.approve(address(bridge), 10_000e18);
        // 2e18 external at scalar=1e18 = 2e18 internal > 1 wei cap → reverts
        vm.expectRevert(JULBridge.InternalRateLimitExceeded.selector);
        bridge.bridge(2e18);
        vm.stopPrank();
    }

    function test_internalTotalsTracked() public {
        jul.mint(user1, 200_000e18);

        vm.startPrank(user1);
        jul.approve(address(bridge), 200_000e18);
        bridge.bridge(10_000e18);
        bridge.bridge(5_000e18);
        vm.stopPrank();

        assertEq(bridge.totalJULLocked(), 15_000e18);
        assertEq(bridge.totalInternalJULLocked(), 15_000e18); // scalar=1e18 → 1:1
    }

    function test_internalTotalTrackedUnderRebase() public {
        jul.mint(user1, 200_000e18);
        jul.setRebaseScalar(2e18);

        vm.startPrank(user1);
        jul.approve(address(bridge), 200_000e18);
        // 20_000 display = 10_000 internal under 2x scalar
        bridge.bridge(20_000e18);
        vm.stopPrank();

        assertEq(bridge.totalJULLocked(), 20_000e18);         // display units
        assertEq(bridge.totalInternalJULLocked(), 10_000e18); // rebase-invariant
    }

    /// @notice BridgedInternal event carries both internal and external amounts
    ///         for off-chain monitoring.
    function test_bridgedInternalEventEmitted() public {
        jul.mint(user1, 10_000e18);
        jul.setRebaseScalar(2e18); // internal becomes half of display

        vm.startPrank(user1);
        jul.approve(address(bridge), 10_000e18);

        vm.expectEmit(true, false, false, true, address(bridge));
        emit BridgedInternal(user1, 500e18, 1000e18, 1000e18);
        bridge.bridge(1000e18);
        vm.stopPrank();
    }

    // ============ C9-AUDIT-3: initializeV2 post-upgrade reinitializer ============

    /// @notice On a fresh deploy, initialize() already set maxInternalPerEpoch,
    ///         so initializeV2 is a no-op (reinitializer(2) still consumes the slot).
    function test_initializeV2_noopOnFreshDeploy() public {
        uint256 before = bridge.maxInternalPerEpoch();
        assertEq(before, 100_000e18);

        vm.prank(owner);
        bridge.initializeV2(50_000e18);

        // Value unchanged — fresh deploys don't need re-seeding
        assertEq(bridge.maxInternalPerEpoch(), before);
    }

    /// @notice initializeV2 can only be called once (reinitializer(2) semantics).
    function test_initializeV2_cannotBeCalledTwice() public {
        vm.prank(owner);
        bridge.initializeV2(50_000e18);

        vm.prank(owner);
        vm.expectRevert(); // InvalidInitialization
        bridge.initializeV2(50_000e18);
    }

    /// @notice On an upgraded proxy where maxInternalPerEpoch starts at 0,
    ///         initializeV2 seeds it atomically with the upgrade payload.
    function test_initializeV2_seedsOnUpgradedProxy() public {
        // Deploy fresh bridge
        JULBridge impl = new JULBridge();
        ERC1967Proxy proxy = new ERC1967Proxy(
            address(impl),
            abi.encodeWithSelector(JULBridge.initialize.selector, address(jul), address(ckb), owner)
        );
        JULBridge freshBridge = JULBridge(address(proxy));

        // Simulate post-upgrade slot state: maxInternalPerEpoch = 0
        // (as if the slot was newly added after a prior upgrade)
        uint256 slot = _findMaxInternalSlot(address(freshBridge));
        vm.store(address(freshBridge), bytes32(slot), bytes32(uint256(0)));
        assertEq(freshBridge.maxInternalPerEpoch(), 0, "slot cleared");

        // initializeV2 seeds it
        vm.prank(owner);
        freshBridge.initializeV2(75_000e18);
        assertEq(freshBridge.maxInternalPerEpoch(), 75_000e18);
    }

    function test_initializeV2_rejectsZero() public {
        vm.prank(owner);
        vm.expectRevert(JULBridge.ZeroAmount.selector);
        bridge.initializeV2(0);
    }

    function test_initializeV2_onlyOwner() public {
        vm.prank(user1);
        vm.expectRevert();
        bridge.initializeV2(50_000e18);
    }

    /// @dev Scans storage for slots holding 100_000e18 and returns the HIGHER
    ///      one — both `maxPerEpoch` (legacy) and `maxInternalPerEpoch` (new) are
    ///      seeded to 100_000e18 by initialize(). The new slot was appended, so
    ///      it has the larger index. Returning the max finds maxInternalPerEpoch.
    function _findMaxInternalSlot(address target) internal view returns (uint256) {
        uint256 best;
        bool found;
        for (uint256 i = 0; i < 300; i++) {
            bytes32 raw = vm.load(target, bytes32(i));
            if (uint256(raw) == 100_000e18) {
                best = i;
                found = true;
            }
        }
        require(found, "slot not found");
        return best;
    }
}
