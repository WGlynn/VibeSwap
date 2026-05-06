// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "forge-std/Test.sol";
import "@openzeppelin/contracts/proxy/ERC1967/ERC1967Proxy.sol";
import "../../contracts/settlement/ShapleyVerifier.sol";
import "../../contracts/settlement/TrustScoreVerifier.sol";
import "../../contracts/settlement/VoteVerifier.sol";
import "../../contracts/reputation/BehavioralReputationVerifier.sol";

/**
 * @title VerifiedComputeFamilyInitSafety — W7 implementation-init lockdown
 * @notice The VerifiedCompute abstract base and its four concrete subclasses
 *         (ShapleyVerifier, TrustScoreVerifier, VoteVerifier,
 *         BehavioralReputationVerifier) were missing _disableInitializers()
 *         in their constructor hierarchy.
 *
 *         Attack vector: deploy a fresh impl, call initialize() directly,
 *         become the impl's owner, then call _authorizeUpgrade() to replace
 *         the impl with a malicious version — affecting any proxy that
 *         subsequently upgrades. Same class as Wormhole 2022 ($325M).
 *
 *         The fix: VerifiedCompute.constructor() calls _disableInitializers(),
 *         which runs at construction time for every concrete subclass and
 *         locks the impl's _initialized slot to type(uint64).max forever.
 *
 *         Tests: three checks per contract (impl locked, proxy initializes,
 *         proxy cannot re-initialize).
 */
contract VerifiedComputeFamilyInitSafetyTest is Test {
    // ============ ShapleyVerifier ============

    function test_W7_ShapleyVerifier_implCannotBeInitialized() public {
        ShapleyVerifier impl = new ShapleyVerifier();
        vm.expectRevert();
        impl.initialize(1 hours, 1 ether);
    }

    function test_W7_ShapleyVerifier_proxyStillInitializesNormally() public {
        ShapleyVerifier impl = new ShapleyVerifier();
        bytes memory initData = abi.encodeCall(
            ShapleyVerifier.initialize,
            (1 hours, 1 ether)
        );
        ERC1967Proxy proxy = new ERC1967Proxy(address(impl), initData);
        ShapleyVerifier sv = ShapleyVerifier(payable(address(proxy)));

        assertEq(sv.owner(), address(this));
        assertEq(sv.disputeWindow(), 1 hours);
        assertEq(sv.bondAmount(), 1 ether);
    }

    function test_W7_ShapleyVerifier_proxyCannotBeReInitialized() public {
        ShapleyVerifier impl = new ShapleyVerifier();
        bytes memory initData = abi.encodeCall(
            ShapleyVerifier.initialize,
            (1 hours, 1 ether)
        );
        ERC1967Proxy proxy = new ERC1967Proxy(address(impl), initData);
        ShapleyVerifier sv = ShapleyVerifier(payable(address(proxy)));

        vm.expectRevert();
        sv.initialize(2 hours, 2 ether);
    }

    // ============ TrustScoreVerifier ============

    function test_W7_TrustScoreVerifier_implCannotBeInitialized() public {
        TrustScoreVerifier impl = new TrustScoreVerifier();
        vm.expectRevert();
        impl.initialize(1 hours, 1 ether);
    }

    function test_W7_TrustScoreVerifier_proxyStillInitializesNormally() public {
        TrustScoreVerifier impl = new TrustScoreVerifier();
        bytes memory initData = abi.encodeCall(
            TrustScoreVerifier.initialize,
            (1 hours, 1 ether)
        );
        ERC1967Proxy proxy = new ERC1967Proxy(address(impl), initData);
        TrustScoreVerifier tv = TrustScoreVerifier(payable(address(proxy)));

        assertEq(tv.owner(), address(this));
        assertEq(tv.disputeWindow(), 1 hours);
        assertEq(tv.bondAmount(), 1 ether);
    }

    function test_W7_TrustScoreVerifier_proxyCannotBeReInitialized() public {
        TrustScoreVerifier impl = new TrustScoreVerifier();
        bytes memory initData = abi.encodeCall(
            TrustScoreVerifier.initialize,
            (1 hours, 1 ether)
        );
        ERC1967Proxy proxy = new ERC1967Proxy(address(impl), initData);
        TrustScoreVerifier tv = TrustScoreVerifier(payable(address(proxy)));

        vm.expectRevert();
        tv.initialize(2 hours, 2 ether);
    }

    // ============ VoteVerifier ============

    function test_W7_VoteVerifier_implCannotBeInitialized() public {
        VoteVerifier impl = new VoteVerifier();
        vm.expectRevert();
        impl.initialize(1 hours, 1 ether, 1000);
    }

    function test_W7_VoteVerifier_proxyStillInitializesNormally() public {
        VoteVerifier impl = new VoteVerifier();
        bytes memory initData = abi.encodeCall(
            VoteVerifier.initialize,
            (1 hours, 1 ether, 1000)
        );
        ERC1967Proxy proxy = new ERC1967Proxy(address(impl), initData);
        VoteVerifier vv = VoteVerifier(payable(address(proxy)));

        assertEq(vv.owner(), address(this));
        assertEq(vv.disputeWindow(), 1 hours);
        assertEq(vv.bondAmount(), 1 ether);
        assertEq(vv.defaultQuorumBps(), 1000);
    }

    function test_W7_VoteVerifier_proxyCannotBeReInitialized() public {
        VoteVerifier impl = new VoteVerifier();
        bytes memory initData = abi.encodeCall(
            VoteVerifier.initialize,
            (1 hours, 1 ether, 1000)
        );
        ERC1967Proxy proxy = new ERC1967Proxy(address(impl), initData);
        VoteVerifier vv = VoteVerifier(payable(address(proxy)));

        vm.expectRevert();
        vv.initialize(2 hours, 2 ether, 2000);
    }

    // ============ BehavioralReputationVerifier ============

    function test_W7_BehavioralReputationVerifier_implCannotBeInitialized() public {
        BehavioralReputationVerifier impl = new BehavioralReputationVerifier();
        vm.expectRevert();
        impl.initialize(1 hours, 1 ether, 100);
    }

    function test_W7_BehavioralReputationVerifier_proxyStillInitializesNormally() public {
        BehavioralReputationVerifier impl = new BehavioralReputationVerifier();
        bytes memory initData = abi.encodeCall(
            BehavioralReputationVerifier.initialize,
            (1 hours, 1 ether, 100)
        );
        ERC1967Proxy proxy = new ERC1967Proxy(address(impl), initData);
        BehavioralReputationVerifier brv = BehavioralReputationVerifier(payable(address(proxy)));

        assertEq(brv.owner(), address(this));
        assertEq(brv.disputeWindow(), 1 hours);
        assertEq(brv.bondAmount(), 1 ether);
        assertEq(brv.rateLimit(), 100);
        assertEq(brv.currentEpoch(), 1);
    }

    function test_W7_BehavioralReputationVerifier_proxyCannotBeReInitialized() public {
        BehavioralReputationVerifier impl = new BehavioralReputationVerifier();
        bytes memory initData = abi.encodeCall(
            BehavioralReputationVerifier.initialize,
            (1 hours, 1 ether, 100)
        );
        ERC1967Proxy proxy = new ERC1967Proxy(address(impl), initData);
        BehavioralReputationVerifier brv = BehavioralReputationVerifier(payable(address(proxy)));

        vm.expectRevert();
        brv.initialize(2 hours, 2 ether, 200);
    }
}
