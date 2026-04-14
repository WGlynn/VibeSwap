// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "forge-std/Test.sol";
import "../../contracts/monetary/CKBNativeToken.sol";
import "../../contracts/monetary/JULBridge.sol";
import "@openzeppelin/contracts/proxy/ERC1967/ERC1967Proxy.sol";

/// @notice Rebase-capable mock JUL matching what JULBridge and JCV expect.
contract MockRebasingJUL {
    mapping(address => uint256) internal _internalBalance;
    mapping(address => mapping(address => uint256)) public allowance;
    uint256 public rebaseScalar = 1e18;

    function balanceOf(address account) public view returns (uint256) {
        return (_internalBalance[account] * rebaseScalar) / 1e18;
    }

    function internalBalanceOf(address account) external view returns (uint256) {
        return _internalBalance[account];
    }

    function setRebaseScalar(uint256 s) external { rebaseScalar = s; }

    function mint(address to, uint256 externalAmount) external {
        _internalBalance[to] += (externalAmount * 1e18) / rebaseScalar;
    }

    function approve(address spender, uint256 amount) external returns (bool) {
        allowance[msg.sender][spender] = amount;
        return true;
    }

    function transferFrom(address from, address to, uint256 amount) external returns (bool) {
        require(balanceOf(from) >= amount, "insufficient");
        require(allowance[from][msg.sender] >= amount, "no allowance");
        uint256 internalAmount = (amount * 1e18) / rebaseScalar;
        require(_internalBalance[from] >= internalAmount, "insufficient internal");
        _internalBalance[from] -= internalAmount;
        allowance[from][msg.sender] -= amount;
        _internalBalance[to] += internalAmount;
        return true;
    }
}

/**
 * @title C8 Deploy Simulation
 * @notice Simulates the post-Cycle-8 production deploy sequence end-to-end:
 *
 *   1. Deploy C8-compliant implementations via ERC1967 proxies
 *   2. Wire cross-contract references
 *   3. Run post-upgrade admin steps:
 *      - Register off-circulation holders (C7-GOV-001)
 *      - Set JULBridge internal rate limit (C7-GOV-005)
 *   4. Assert post-deploy invariants
 *   5. Exercise bridge + register-holder end-to-end
 *   6. Cover the forgotten-admin-step footguns that brick the system
 *
 * Goal: catch deploy-ordering bugs before they hit mainnet. If someone forgets
 *       to call `setInternalRateLimit` after upgrading, this test makes that
 *       failure mode impossible to miss.
 */
contract C8DeploySimulationTest is Test {
    CKBNativeToken public ckb;
    JULBridge public bridge;
    MockRebasingJUL public jul;

    address owner = makeAddr("owner");
    address user = makeAddr("user");
    address nci = makeAddr("nciContract");
    address vibeStable = makeAddr("vibeStableContract");
    address jcv = makeAddr("jcvContract");

    uint256 constant INTERNAL_RATE_LIMIT = 100_000e18;

    function setUp() public {
        // C9-AUDIT-6: setOffCirculationHolder requires code.length > 0.
        // Etch a single STOP byte so our makeAddr() stand-ins pass the guard.
        vm.etch(nci, hex"00");
        vm.etch(vibeStable, hex"00");
        vm.etch(jcv, hex"00");
    }

    function _deployCkb() internal returns (CKBNativeToken) {
        CKBNativeToken impl = new CKBNativeToken();
        ERC1967Proxy proxy = new ERC1967Proxy(
            address(impl),
            abi.encodeWithSelector(CKBNativeToken.initialize.selector, owner)
        );
        return CKBNativeToken(address(proxy));
    }

    function _deployBridge(address _jul, address _ckb) internal returns (JULBridge) {
        JULBridge impl = new JULBridge();
        ERC1967Proxy proxy = new ERC1967Proxy(
            address(impl),
            abi.encodeWithSelector(JULBridge.initialize.selector, _jul, _ckb, owner)
        );
        return JULBridge(address(proxy));
    }

    // ============ Phase 1: fresh deploy ============

    /// @notice Models the happy path: deploy, wire, run admin init, then use.
    function test_freshDeployHappyPath() public {
        // Step 1: deploy contracts
        jul = new MockRebasingJUL();
        ckb = _deployCkb();
        bridge = _deployBridge(address(jul), address(ckb));

        // Step 2: wire — bridge is an authorized CKB minter
        vm.prank(owner);
        ckb.setMinter(address(bridge), true);

        // Step 3a: register off-circulation holders (post-upgrade admin)
        vm.startPrank(owner);
        ckb.setOffCirculationHolder(nci, true);
        ckb.setOffCirculationHolder(vibeStable, true);
        ckb.setOffCirculationHolder(jcv, true);
        vm.stopPrank();

        // Step 3b: JULBridge internal rate limit — note that `initialize` already
        // sets this to 100_000e18 for fresh deploys (not 0). The `setInternalRateLimit`
        // step is for PROXY UPGRADES where the new slot starts at 0.
        assertEq(bridge.maxInternalPerEpoch(), INTERNAL_RATE_LIMIT, "fresh deploy inits internal cap");

        // Step 4: assert post-deploy state
        assertEq(ckb.offCirculationHolderCount(), 3);
        assertTrue(ckb.isOffCirculationHolder(nci));
        assertTrue(ckb.isOffCirculationHolder(vibeStable));
        assertTrue(ckb.isOffCirculationHolder(jcv));
        assertEq(address(bridge.julToken()), address(jul));
        assertEq(address(bridge.ckbNativeToken()), address(ckb));

        // Step 5: end-to-end — user bridges JUL → CKB
        jul.mint(user, 10_000e18);
        vm.startPrank(user);
        jul.approve(address(bridge), 10_000e18);
        uint256 ckbOut = bridge.bridge(10_000e18);
        vm.stopPrank();

        assertEq(ckbOut, 10_000e18);
        assertEq(ckb.balanceOf(user), 10_000e18);

        // Step 6: user stakes CKB to NCI (simulated via transferFrom). The staked
        // amount appears in offCirculation() via the registry.
        uint256 stakeAmount = 4_000e18;
        vm.prank(user);
        ckb.transfer(nci, stakeAmount);

        assertEq(ckb.balanceOf(nci), stakeAmount);
        assertEq(ckb.offCirculation(), stakeAmount, "NCI balance appears in offCirculation");
        assertEq(ckb.circulatingSupply(), 10_000e18 - stakeAmount);
    }

    // ============ Phase 2: upgrade-path footgun simulation ============

    /// @notice Simulates an UPGRADE of a prior-deployed proxy where `maxInternalPerEpoch`
    ///         starts at 0 (the default for newly-added storage after upgrade).
    ///         The bridge must refuse all calls until the owner explicitly sets it.
    function test_upgradePathDenyByDefault() public {
        jul = new MockRebasingJUL();
        ckb = _deployCkb();
        bridge = _deployBridge(address(jul), address(ckb));

        // Simulate the upgrade-leaves-0 scenario: owner manually resets to 0
        // (fresh `initialize()` sets 100_000e18, but an upgrade doesn't re-run
        // `initialize`). We model the post-upgrade state by explicitly zeroing
        // via the setter — except the setter rejects 0, so we use vm.store.
        // Slot for maxInternalPerEpoch: after 9 prior uint256/bool slots (see layout).
        // Use a canary path instead: lower the cap to 1 wei and confirm behavior.

        vm.prank(owner);
        bridge.setInternalRateLimit(1); // simulates "cap is effectively 0 for real amounts"

        vm.prank(owner);
        ckb.setMinter(address(bridge), true);

        jul.mint(user, 10_000e18);
        vm.startPrank(user);
        jul.approve(address(bridge), 10_000e18);

        // Any realistic amount exceeds 1 wei cap → reverts
        vm.expectRevert(JULBridge.InternalRateLimitExceeded.selector);
        bridge.bridge(1_000e18);
        vm.stopPrank();

        // Owner fixes by calling setInternalRateLimit
        vm.prank(owner);
        bridge.setInternalRateLimit(INTERNAL_RATE_LIMIT);

        // Now bridge works
        vm.startPrank(user);
        bridge.bridge(1_000e18);
        vm.stopPrank();

        assertEq(ckb.balanceOf(user), 1_000e18, "bridge unblocked after admin init");
    }

    /// @notice Register-holders is idempotent: re-running the deploy script must not corrupt state.
    function test_registerHoldersIdempotent() public {
        ckb = _deployCkb();

        vm.startPrank(owner);
        ckb.setOffCirculationHolder(nci, true);
        ckb.setOffCirculationHolder(vibeStable, true);

        // Deploy script re-run — attempts to register same addresses
        ckb.setOffCirculationHolder(nci, true);
        ckb.setOffCirculationHolder(vibeStable, true);
        vm.stopPrank();

        // No duplicates in the array
        assertEq(ckb.offCirculationHolderCount(), 2);
        assertTrue(ckb.isOffCirculationHolder(nci));
        assertTrue(ckb.isOffCirculationHolder(vibeStable));
    }

    /// @notice Holder deregistration + re-registration round-trips cleanly.
    function test_registerDeregisterRoundTrip() public {
        ckb = _deployCkb();

        vm.startPrank(owner);
        ckb.setOffCirculationHolder(nci, true);
        ckb.setOffCirculationHolder(vibeStable, true);
        ckb.setOffCirculationHolder(jcv, true);
        assertEq(ckb.offCirculationHolderCount(), 3);

        // Remove middle entry
        ckb.setOffCirculationHolder(vibeStable, false);
        assertFalse(ckb.isOffCirculationHolder(vibeStable));
        assertEq(ckb.offCirculationHolderCount(), 2);

        // Re-add it — order may have changed (swap-and-pop) but count is right
        ckb.setOffCirculationHolder(vibeStable, true);
        assertTrue(ckb.isOffCirculationHolder(vibeStable));
        assertEq(ckb.offCirculationHolderCount(), 3);
        vm.stopPrank();
    }

    // ============ Phase 3: access control ============

    function test_nonOwnerCannotRegisterHolder() public {
        ckb = _deployCkb();

        vm.prank(user);
        vm.expectRevert();
        ckb.setOffCirculationHolder(nci, true);
    }

    function test_nonOwnerCannotSetInternalRateLimit() public {
        jul = new MockRebasingJUL();
        ckb = _deployCkb();
        bridge = _deployBridge(address(jul), address(ckb));

        vm.prank(user);
        vm.expectRevert();
        bridge.setInternalRateLimit(50_000e18);
    }

    // ============ Phase 4: offCirculation integration under rebase ============

    /// @notice offCirculation is CKB-denominated — it's not affected by JUL rebase.
    ///         But verify the bridge's internal-unit rate limit interacts correctly
    ///         with the CKB minting that feeds offCirculation via transfer-to-NCI.
    function test_bridgeStakeIntegrationUnderJulRebase() public {
        jul = new MockRebasingJUL();
        ckb = _deployCkb();
        bridge = _deployBridge(address(jul), address(ckb));

        vm.startPrank(owner);
        ckb.setMinter(address(bridge), true);
        ckb.setOffCirculationHolder(nci, true);
        vm.stopPrank();

        // Apply 2x rebase on JUL before any bridging. 1 internal = 2 display.
        jul.setRebaseScalar(2e18);

        jul.mint(user, 400_000e18); // internal = 200_000
        vm.startPrank(user);
        jul.approve(address(bridge), 400_000e18);

        // Bridge 200K display = 100K internal — exactly at the internal cap.
        uint256 ckbOut = bridge.bridge(200_000e18);
        vm.stopPrank();

        // User got CKB proportional to DISPLAY amount (exchange rate is on display,
        // not on internal — preserves the user's paid-in value semantics).
        assertEq(ckbOut, 200_000e18);
        assertEq(bridge.internalConvertedThisEpoch(), 100_000e18);

        // Staking 80K CKB to NCI appears in offCirculation
        vm.prank(user);
        ckb.transfer(nci, 80_000e18);
        assertEq(ckb.offCirculation(), 80_000e18);

        // Attempting another bridge in the same epoch reverts on internal cap
        jul.mint(user, 4e18); // 2 internal at 2x scalar
        vm.startPrank(user);
        jul.approve(address(bridge), 4e18);
        vm.expectRevert(JULBridge.InternalRateLimitExceeded.selector);
        bridge.bridge(2e18);
        vm.stopPrank();
    }

    // ============ Phase 5: full deploy-order invariants ============

    /// @notice Catch the class of bug where deploy order is wrong — e.g. bridge
    ///         deployed before CKB minter role is granted, or holders registered
    ///         on an uninitialized CKB.
    function test_deployOrderInvariants() public {
        jul = new MockRebasingJUL();
        ckb = _deployCkb();
        bridge = _deployBridge(address(jul), address(ckb));

        // Pre-wire: bridge is NOT yet a minter. bridge() should revert on CKB.mint
        jul.mint(user, 1_000e18);
        vm.startPrank(user);
        jul.approve(address(bridge), 1_000e18);
        vm.expectRevert(); // CKBNativeToken: not an authorized minter
        bridge.bridge(1_000e18);
        vm.stopPrank();

        // Fix: grant minter role
        vm.prank(owner);
        ckb.setMinter(address(bridge), true);

        // Now bridge succeeds
        vm.prank(user);
        bridge.bridge(1_000e18);
        assertEq(ckb.balanceOf(user), 1_000e18);
    }

    /// @notice After the full deploy is done, the critical system invariants hold:
    ///         totalSupply conserved across transfer, offCirculation reflects real holdings.
    function test_postDeployInvariants() public {
        jul = new MockRebasingJUL();
        ckb = _deployCkb();
        bridge = _deployBridge(address(jul), address(ckb));

        vm.startPrank(owner);
        ckb.setMinter(address(bridge), true);
        ckb.setOffCirculationHolder(nci, true);
        ckb.setOffCirculationHolder(vibeStable, true);
        vm.stopPrank();

        jul.mint(user, 50_000e18);
        vm.startPrank(user);
        jul.approve(address(bridge), 50_000e18);
        bridge.bridge(50_000e18);
        ckb.transfer(nci, 10_000e18);
        ckb.transfer(vibeStable, 5_000e18);
        vm.stopPrank();

        // Invariant 1: totalSupply = sum of balances (standard ERC20)
        uint256 sumBalances = ckb.balanceOf(user)
            + ckb.balanceOf(nci)
            + ckb.balanceOf(vibeStable);
        assertEq(ckb.totalSupply(), sumBalances);

        // Invariant 2: offCirculation = sum of registered holder balances (when
        // totalOccupied = 0 and no state-rent cells active).
        assertEq(ckb.offCirculation(), 15_000e18);

        // Invariant 3: circulatingSupply + offCirculation = totalSupply
        assertEq(ckb.circulatingSupply() + ckb.offCirculation(), ckb.totalSupply());
    }
}
