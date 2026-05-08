// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "forge-std/Test.sol";
import "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import "@openzeppelin/contracts/proxy/ERC1967/ERC1967Proxy.sol";

import "../../contracts/messaging/MessagingValidatorRegistry.sol";
import {IMessagingValidatorRegistry} from "../../contracts/messaging/interfaces/IMessagingValidatorRegistry.sol";

/// @notice Minimal ERC20 used for the messaging-bond token in tests.
contract MockBondToken is ERC20 {
    constructor() ERC20("Bond", "BOND") {}
    function mint(address to, uint256 amount) external { _mint(to, amount); }
}

contract MessagingValidatorRegistryTest is Test {
    MessagingValidatorRegistry public registry;
    MockBondToken public bond;

    address owner = makeAddr("owner");
    address pom   = makeAddr("proofOfMisbehavior");

    address op1 = makeAddr("op1");
    address op2 = makeAddr("op2");
    address op3 = makeAddr("op3");

    bytes pk1;
    bytes pk2;
    bytes pk3;

    uint96 constant BOND = 50 ether;

    function setUp() public {
        bond = new MockBondToken();

        MessagingValidatorRegistry impl = new MessagingValidatorRegistry();
        bytes memory data = abi.encodeWithSelector(
            MessagingValidatorRegistry.initialize.selector,
            address(bond),
            pom,
            owner
        );
        ERC1967Proxy proxy = new ERC1967Proxy(address(impl), data);
        registry = MessagingValidatorRegistry(address(proxy));

        // 48-byte BLS12-381 G1 compressed pubkey shape.
        pk1 = _pubkey(0xAA);
        pk2 = _pubkey(0xBB);
        pk3 = _pubkey(0xCC);

        // Fund operators with bond tokens.
        bond.mint(op1, 1_000 ether);
        bond.mint(op2, 1_000 ether);
        bond.mint(op3, 1_000 ether);
    }

    // ============ Helpers ============

    function _pubkey(uint8 fill) internal pure returns (bytes memory) {
        bytes memory pk = new bytes(48);
        for (uint256 i = 0; i < 48; i++) pk[i] = bytes1(fill);
        return pk;
    }

    function _register(address op, bytes memory pk, uint96 amount) internal returns (uint32) {
        vm.startPrank(op);
        bond.approve(address(registry), amount);
        uint32 idx = registry.register(pk, op, amount);
        vm.stopPrank();
        return idx;
    }

    // ============ Registration ============

    function test_register_succeeds() public {
        uint32 idx = _register(op1, pk1, BOND);
        assertGt(idx, 0);

        IMessagingValidatorRegistry.Validator memory v = registry.getValidator(idx);
        assertEq(v.operator, op1);
        assertEq(v.bondAmount, BOND);
        assertEq(uint256(v.activatedAt), block.timestamp + registry.activationDelay());
        assertEq(v.exitInitiatedAt, 0);
        assertFalse(v.slashed);
    }

    function test_register_revertsOnBondBelowFloor() public {
        vm.startPrank(op1);
        bond.approve(address(registry), 1 ether);
        vm.expectRevert(
            abi.encodeWithSelector(
                IMessagingValidatorRegistry.BondBelowFloor.selector,
                uint96(1 ether),
                registry.bondFloor()
            )
        );
        registry.register(pk1, op1, 1 ether);
        vm.stopPrank();
    }

    function test_register_revertsOnInvalidPubkeyLength() public {
        bytes memory shortPk = new bytes(32);
        vm.startPrank(op1);
        bond.approve(address(registry), BOND);
        vm.expectRevert(IMessagingValidatorRegistry.InvalidPubkey.selector);
        registry.register(shortPk, op1, BOND);
        vm.stopPrank();
    }

    function test_register_revertsOnDuplicatePubkey() public {
        _register(op1, pk1, BOND);

        vm.startPrank(op2);
        bond.approve(address(registry), BOND);
        vm.expectRevert();
        registry.register(pk1, op2, BOND);
        vm.stopPrank();
    }

    function test_register_revertsOnDuplicateOperator() public {
        _register(op1, pk1, BOND);

        vm.startPrank(op1);
        bond.approve(address(registry), BOND);
        vm.expectRevert();
        registry.register(pk2, op1, BOND);
        vm.stopPrank();
    }

    // ============ Activation ============

    function test_activation_delaysEntryToActiveSet() public {
        uint32 idx = _register(op1, pk1, BOND);
        assertFalse(registry.isActive(idx), "should not be active before delay");

        // Rotate before delay — should not pick up the validator yet.
        registry.rotateSet();
        assertFalse(registry.isActive(idx));

        vm.warp(block.timestamp + registry.activationDelay() + 1);
        registry.rotateSet();
        assertTrue(registry.isActive(idx), "should be active after delay + rotation");
    }

    // ============ Top-up ============

    function test_topUpBond_addsToValidator() public {
        uint32 idx = _register(op1, pk1, BOND);

        vm.startPrank(op1);
        bond.approve(address(registry), 10 ether);
        registry.topUpBond(idx, 10 ether);
        vm.stopPrank();

        assertEq(registry.getValidator(idx).bondAmount, BOND + 10 ether);
    }

    // ============ Exit ============

    function test_initiateExit_removesFromActiveSet() public {
        uint32 idx = _register(op1, pk1, BOND);
        vm.warp(block.timestamp + registry.activationDelay() + 1);
        registry.rotateSet();
        assertTrue(registry.isActive(idx));

        vm.prank(op1);
        registry.initiateExit(idx);

        assertFalse(registry.isActive(idx));
        assertGt(registry.getValidator(idx).exitInitiatedAt, 0);
    }

    function test_initiateExit_revertsOnUnauthorized() public {
        uint32 idx = _register(op1, pk1, BOND);
        vm.warp(block.timestamp + registry.activationDelay() + 1);

        vm.prank(op2);
        vm.expectRevert(IMessagingValidatorRegistry.UnauthorizedSlasher.selector);
        registry.initiateExit(idx);
    }

    function test_finalizeExit_revertsBeforeUnbondingComplete() public {
        uint32 idx = _register(op1, pk1, BOND);
        vm.warp(block.timestamp + registry.activationDelay() + 1);
        vm.prank(op1);
        registry.initiateExit(idx);

        vm.expectRevert();
        registry.finalizeExit(idx);
    }

    function test_finalizeExit_returnsBondAfterUnbonding() public {
        uint32 idx = _register(op1, pk1, BOND);
        vm.warp(block.timestamp + registry.activationDelay() + 1);

        uint256 balBefore = bond.balanceOf(op1);

        vm.prank(op1);
        registry.initiateExit(idx);

        vm.warp(block.timestamp + registry.unbondingDelay() + 1);
        registry.finalizeExit(idx);

        assertEq(bond.balanceOf(op1), balBefore + BOND);
        assertEq(registry.getValidator(idx).bondAmount, 0);
    }

    // ============ Slashing ============

    function test_slash_onlyPoMCanSlash() public {
        uint32 idx = _register(op1, pk1, BOND);

        vm.expectRevert(IMessagingValidatorRegistry.UnauthorizedSlasher.selector);
        registry.slash(idx, bytes32("forged"), 5 ether);

        vm.prank(pom);
        uint96 slashed = registry.slash(idx, bytes32("forged"), 5 ether);
        assertEq(slashed, 5 ether);
        assertEq(registry.getValidator(idx).bondAmount, BOND - 5 ether);
    }

    function test_slash_belowFloorForcesExit() public {
        uint32 idx = _register(op1, pk1, BOND);
        vm.warp(block.timestamp + registry.activationDelay() + 1);
        registry.rotateSet();
        assertTrue(registry.isActive(idx));

        // Slash all but a tiny dust amount — drops well under the bond floor.
        vm.prank(pom);
        registry.slash(idx, bytes32("forged"), BOND - 1);

        IMessagingValidatorRegistry.Validator memory v = registry.getValidator(idx);
        assertTrue(v.slashed);
        assertGt(v.exitInitiatedAt, 0);
        assertFalse(registry.isActive(idx));
    }

    function test_slash_capsAtBondAmount() public {
        uint32 idx = _register(op1, pk1, BOND);

        vm.prank(pom);
        uint96 slashed = registry.slash(idx, bytes32("liveness"), 1_000 ether);
        assertEq(slashed, BOND, "slash should cap at bond amount");
        assertEq(registry.getValidator(idx).bondAmount, 0);
    }

    // ============ Set rotation ============

    function test_rotateSet_createsSnapshotAndIncrementsEpoch() public {
        _register(op1, pk1, BOND);
        _register(op2, pk2, BOND);
        vm.warp(block.timestamp + registry.activationDelay() + 1);

        uint64 oldEpoch = registry.currentEpoch();
        uint64 newEpoch = registry.rotateSet();
        assertEq(newEpoch, oldEpoch + 1);

        IMessagingValidatorRegistry.SetSnapshot memory snap = registry.setSnapshot(newEpoch);
        assertEq(snap.size, 2);
        assertGt(uint256(snap.aggregatePubkeyHash), 0);
        assertGt(uint256(snap.merkleRoot), 0);
    }

    // ============ Self-audit fixes (H-1, M-1, M-2) ============

    function test_rotateSet_rateLimitsRepeatRotations() public {
        _register(op1, pk1, BOND);
        vm.warp(block.timestamp + registry.activationDelay() + 1);

        registry.rotateSet(); // first rotation always allowed

        // Immediate second call reverts.
        vm.expectRevert();
        registry.rotateSet();

        // After interval elapses, succeeds.
        vm.warp(block.timestamp + registry.rotationIntervalSeconds() + 1);
        registry.rotateSet();
        assertEq(registry.currentEpoch(), 2);
    }

    function test_topUpBond_rejectedOnExitingValidator() public {
        uint32 idx = _register(op1, pk1, BOND);
        vm.warp(block.timestamp + registry.activationDelay() + 1);

        vm.prank(op1);
        registry.initiateExit(idx);

        vm.startPrank(op1);
        bond.approve(address(registry), 5 ether);
        vm.expectRevert(
            abi.encodeWithSelector(IMessagingValidatorRegistry.ValidatorExiting.selector, idx)
        );
        registry.topUpBond(idx, 5 ether);
        vm.stopPrank();
    }

    function test_slash_returnsZeroOnAlreadyZeroBond() public {
        uint32 idx = _register(op1, pk1, BOND);

        // Slash everything first.
        vm.prank(pom);
        registry.slash(idx, bytes32("forged"), BOND);
        assertEq(registry.getValidator(idx).bondAmount, 0);

        // Second slash on the now-empty validator: returns 0, no state mutation.
        uint64 exitBefore = registry.getValidator(idx).exitInitiatedAt;
        vm.prank(pom);
        uint96 slashed = registry.slash(idx, bytes32("liveness"), 1 ether);

        assertEq(slashed, 0, "slash on zero-bond returns zero");
        assertEq(registry.getValidator(idx).exitInitiatedAt, exitBefore, "should not re-touch exit timestamp");
    }

    function test_thresholdForEpoch_isCeilTwoThirdsPlusOne() public {
        // Register 6 validators; threshold should be ⌈2*6/3⌉+1 = 5
        address op4 = makeAddr("op4"); bond.mint(op4, 100 ether);
        address op5 = makeAddr("op5"); bond.mint(op5, 100 ether);
        address op6 = makeAddr("op6"); bond.mint(op6, 100 ether);

        _register(op1, pk1, BOND);
        _register(op2, pk2, BOND);
        _register(op3, pk3, BOND);
        _register(op4, _pubkey(0xDD), BOND);
        _register(op5, _pubkey(0xEE), BOND);
        _register(op6, _pubkey(0xFF), BOND);

        vm.warp(block.timestamp + registry.activationDelay() + 1);
        uint64 ep = registry.rotateSet();

        IMessagingValidatorRegistry.SetSnapshot memory snap = registry.setSnapshot(ep);
        assertEq(snap.size, 6);
        assertEq(registry.thresholdForEpoch(ep), 5);
    }
}
