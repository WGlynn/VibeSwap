// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "forge-std/Test.sol";
import "../contracts/account/VibeSmartWallet.sol";
import "../contracts/account/VibeWalletFactory.sol";
import "../contracts/account/interfaces/IVibeSmartWallet.sol";

// ============ Mocks ============

contract MockSWTarget {
    uint256 public value;
    address public lastCaller;
    function setValue(uint256 _value) external { value = _value; lastCaller = msg.sender; }
    function getValue() external view returns (uint256) { return value; }
}

/// @notice Mock EntryPoint that calls validateUserOp + execute
contract MockEntryPoint {
    function simulateValidation(
        VibeSmartWallet wallet,
        IVibeSmartWallet.UserOperation calldata userOp,
        bytes32 userOpHash
    ) external returns (uint256) {
        return wallet.validateUserOp(userOp, userOpHash, 0);
    }

    function handleOp(
        VibeSmartWallet wallet,
        IVibeSmartWallet.UserOperation calldata userOp,
        bytes32 userOpHash
    ) external returns (bool) {
        uint256 validation = wallet.validateUserOp(userOp, userOpHash, 0);
        if (validation != 0) return false;

        // Execute the callData
        (bool success,) = address(wallet).call(userOp.callData);
        return success;
    }
}

// ============ Unit Tests ============

contract VibeSmartWalletTest is Test {
    VibeSmartWallet public wallet;
    VibeWalletFactory public factory;
    MockSWTarget public target;
    MockEntryPoint public entryPoint;

    uint256 public ownerPK;
    address public owner;
    uint256 public sessionPK;
    address public sessionKey;
    address public guardian;
    address public alice;

    function setUp() public {
        (owner, ownerPK) = makeAddrAndKey("owner");
        (sessionKey, sessionPK) = makeAddrAndKey("sessionKey");
        guardian = makeAddr("guardian");
        alice = makeAddr("alice");

        entryPoint = new MockEntryPoint();
        target = new MockSWTarget();

        factory = new VibeWalletFactory(address(entryPoint));
        address walletAddr = factory.createAccount(owner, bytes32(0));
        wallet = VibeSmartWallet(payable(walletAddr));

        // Fund wallet
        vm.deal(address(wallet), 10 ether);
    }

    // ============ Factory Tests ============

    function test_factory_createsWallet() public view {
        assertEq(wallet.owner(), owner);
        assertEq(wallet.entryPoint(), address(entryPoint));
    }

    function test_factory_deterministicAddress() public view {
        address predicted = factory.getAddress(owner, bytes32(0));
        assertEq(address(wallet), predicted);
    }

    function test_factory_returnsSameOnDuplicateCreate() public {
        address walletAddr = factory.createAccount(owner, bytes32(0));
        assertEq(walletAddr, address(wallet));
    }

    function test_factory_differentSaltDifferentAddress() public {
        address wallet2 = factory.createAccount(owner, bytes32(uint256(1)));
        assertTrue(wallet2 != address(wallet));
    }

    function test_factory_revertsZeroOwner() public {
        vm.expectRevert(VibeWalletFactory.ZeroAddress.selector);
        factory.createAccount(address(0), bytes32(0));
    }

    function test_factory_revertsZeroEntryPoint() public {
        vm.expectRevert(VibeWalletFactory.ZeroAddress.selector);
        new VibeWalletFactory(address(0));
    }

    // ============ Initialization Tests ============

    function test_init_revertsDouble() public {
        vm.expectRevert(IVibeSmartWallet.AlreadyInitialized.selector);
        wallet.initialize(owner, address(entryPoint));
    }

    function test_init_revertsZeroOwner() public {
        VibeSmartWallet w = new VibeSmartWallet();
        vm.expectRevert(IVibeSmartWallet.ZeroAddress.selector);
        w.initialize(address(0), address(entryPoint));
    }

    function test_init_revertsZeroEntryPoint() public {
        VibeSmartWallet w = new VibeSmartWallet();
        vm.expectRevert(IVibeSmartWallet.ZeroAddress.selector);
        w.initialize(owner, address(0));
    }

    // ============ Execute Tests ============

    function test_execute_ownerDirect() public {
        vm.prank(owner);
        wallet.execute(
            address(target),
            0,
            abi.encodeCall(MockSWTarget.setValue, (42))
        );

        assertEq(target.value(), 42);
        assertEq(target.lastCaller(), address(wallet));
    }

    function test_execute_revertsNotOwner() public {
        vm.prank(alice);
        vm.expectRevert(IVibeSmartWallet.NotOwnerOrEntryPoint.selector);
        wallet.execute(address(target), 0, abi.encodeCall(MockSWTarget.setValue, (42)));
    }

    function test_execute_entryPointCan() public {
        vm.prank(address(entryPoint));
        wallet.execute(
            address(target),
            0,
            abi.encodeCall(MockSWTarget.setValue, (99))
        );
        assertEq(target.value(), 99);
    }

    function test_execute_withValue() public {
        vm.prank(owner);
        wallet.execute(address(alice), 1 ether, "");
        assertEq(alice.balance, 1 ether);
    }

    // ============ BatchExecute Tests ============

    function test_executeBatch() public {
        MockSWTarget target2 = new MockSWTarget();

        address[] memory targets = new address[](2);
        targets[0] = address(target);
        targets[1] = address(target2);

        uint256[] memory values = new uint256[](2);
        values[0] = 0;
        values[1] = 0;

        bytes[] memory datas = new bytes[](2);
        datas[0] = abi.encodeCall(MockSWTarget.setValue, (10));
        datas[1] = abi.encodeCall(MockSWTarget.setValue, (20));

        vm.prank(owner);
        wallet.executeBatch(targets, values, datas);

        assertEq(target.value(), 10);
        assertEq(target2.value(), 20);
    }

    // ============ Session Key Tests ============

    function test_addSessionKey() public {
        bytes4[] memory selectors = new bytes4[](1);
        selectors[0] = MockSWTarget.setValue.selector;

        vm.prank(owner);
        wallet.addSessionKey(sessionKey, 0, uint40(block.timestamp + 1 days), 0, selectors);

        assertTrue(wallet.isSessionKeyActive(sessionKey));
        assertTrue(wallet.isAllowedSelector(sessionKey, MockSWTarget.setValue.selector));
        assertFalse(wallet.isAllowedSelector(sessionKey, MockSWTarget.getValue.selector));
    }

    function test_addSessionKey_noSelectorRestrictions() public {
        bytes4[] memory empty = new bytes4[](0);

        vm.prank(owner);
        wallet.addSessionKey(sessionKey, 0, uint40(block.timestamp + 1 days), 0, empty);

        assertTrue(wallet.isSessionKeyActive(sessionKey));
        // All selectors allowed when no restrictions
        assertTrue(wallet.isAllowedSelector(sessionKey, MockSWTarget.setValue.selector));
        assertTrue(wallet.isAllowedSelector(sessionKey, MockSWTarget.getValue.selector));
    }

    function test_addSessionKey_revertsNotOwner() public {
        bytes4[] memory empty = new bytes4[](0);

        vm.prank(alice);
        vm.expectRevert(IVibeSmartWallet.NotOwner.selector);
        wallet.addSessionKey(sessionKey, 0, uint40(block.timestamp + 1 days), 0, empty);
    }

    function test_addSessionKey_revertsDuplicate() public {
        bytes4[] memory empty = new bytes4[](0);

        vm.prank(owner);
        wallet.addSessionKey(sessionKey, 0, uint40(block.timestamp + 1 days), 0, empty);

        vm.prank(owner);
        vm.expectRevert(IVibeSmartWallet.SessionKeyAlreadyExists.selector);
        wallet.addSessionKey(sessionKey, 0, uint40(block.timestamp + 1 days), 0, empty);
    }

    function test_revokeSessionKey() public {
        bytes4[] memory empty = new bytes4[](0);

        vm.prank(owner);
        wallet.addSessionKey(sessionKey, 0, uint40(block.timestamp + 1 days), 0, empty);

        vm.prank(owner);
        wallet.revokeSessionKey(sessionKey);

        assertFalse(wallet.isSessionKeyActive(sessionKey));
    }

    function test_revokeSessionKey_revertsNotFound() public {
        vm.prank(owner);
        vm.expectRevert(IVibeSmartWallet.SessionKeyNotFound.selector);
        wallet.revokeSessionKey(sessionKey);
    }

    function test_sessionKeyExpiry() public {
        bytes4[] memory empty = new bytes4[](0);

        vm.prank(owner);
        wallet.addSessionKey(sessionKey, 0, uint40(block.timestamp + 1 hours), 0, empty);

        assertTrue(wallet.isSessionKeyActive(sessionKey));

        vm.warp(block.timestamp + 2 hours);
        assertFalse(wallet.isSessionKeyActive(sessionKey));
    }

    function test_sessionKeyValidAfter() public {
        bytes4[] memory empty = new bytes4[](0);

        uint40 startTime = uint40(block.timestamp + 1 hours);

        vm.prank(owner);
        wallet.addSessionKey(sessionKey, startTime, uint40(block.timestamp + 2 hours), 0, empty);

        assertFalse(wallet.isSessionKeyActive(sessionKey)); // not yet valid

        vm.warp(startTime);
        assertTrue(wallet.isSessionKeyActive(sessionKey)); // now valid
    }

    // ============ ValidateUserOp Tests ============

    function test_validateUserOp_ownerSignature() public {
        bytes memory callData = abi.encodeCall(
            VibeSmartWallet.execute,
            (address(target), 0, abi.encodeCall(MockSWTarget.setValue, (42)))
        );

        IVibeSmartWallet.UserOperation memory userOp = _buildUserOp(callData, 0);
        bytes32 userOpHash = keccak256(abi.encode(userOp));
        userOp.signature = _signHash(ownerPK, userOpHash);

        uint256 result = entryPoint.simulateValidation(wallet, userOp, userOpHash);
        assertEq(result, 0); // success
    }

    function test_validateUserOp_sessionKeySignature() public {
        // Add session key
        bytes4[] memory selectors = new bytes4[](1);
        selectors[0] = MockSWTarget.setValue.selector;

        vm.prank(owner);
        wallet.addSessionKey(sessionKey, 0, uint40(block.timestamp + 1 days), 0, selectors);

        // Build and sign UserOp with session key
        bytes memory callData = abi.encodeCall(
            VibeSmartWallet.execute,
            (address(target), 0, abi.encodeCall(MockSWTarget.setValue, (42)))
        );

        IVibeSmartWallet.UserOperation memory userOp = _buildUserOp(callData, 0);
        bytes32 userOpHash = keccak256(abi.encode(userOp));
        userOp.signature = _signHash(sessionPK, userOpHash);

        uint256 result = entryPoint.simulateValidation(wallet, userOp, userOpHash);
        assertEq(result, 0); // success
    }

    function test_validateUserOp_invalidSignature() public {
        bytes memory callData = abi.encodeCall(
            VibeSmartWallet.execute,
            (address(target), 0, abi.encodeCall(MockSWTarget.setValue, (42)))
        );

        IVibeSmartWallet.UserOperation memory userOp = _buildUserOp(callData, 0);
        bytes32 userOpHash = keccak256(abi.encode(userOp));

        // Sign with unknown key
        (, uint256 unknownPK) = makeAddrAndKey("unknown");
        userOp.signature = _signHash(unknownPK, userOpHash);

        uint256 result = entryPoint.simulateValidation(wallet, userOp, userOpHash);
        assertEq(result, 1); // failure
    }

    function test_validateUserOp_expiredSessionKey() public {
        bytes4[] memory empty = new bytes4[](0);

        vm.prank(owner);
        wallet.addSessionKey(sessionKey, 0, uint40(block.timestamp + 1 hours), 0, empty);

        // Warp past expiry
        vm.warp(block.timestamp + 2 hours);

        bytes memory callData = abi.encodeCall(
            VibeSmartWallet.execute,
            (address(target), 0, abi.encodeCall(MockSWTarget.setValue, (42)))
        );

        IVibeSmartWallet.UserOperation memory userOp = _buildUserOp(callData, 0);
        bytes32 userOpHash = keccak256(abi.encode(userOp));
        userOp.signature = _signHash(sessionPK, userOpHash);

        uint256 result = entryPoint.simulateValidation(wallet, userOp, userOpHash);
        assertEq(result, 1); // failure (expired)
    }

    function test_validateUserOp_selectorRestricted() public {
        // Only allow setValue
        bytes4[] memory selectors = new bytes4[](1);
        selectors[0] = MockSWTarget.setValue.selector;

        vm.prank(owner);
        wallet.addSessionKey(sessionKey, 0, uint40(block.timestamp + 1 days), 0, selectors);

        // Try to call getValue (not allowed)
        bytes memory callData = abi.encodeCall(
            VibeSmartWallet.execute,
            (address(target), 0, abi.encodeCall(MockSWTarget.getValue, ()))
        );

        IVibeSmartWallet.UserOperation memory userOp = _buildUserOp(callData, 0);
        bytes32 userOpHash = keccak256(abi.encode(userOp));
        userOp.signature = _signHash(sessionPK, userOpHash);

        uint256 result = entryPoint.simulateValidation(wallet, userOp, userOpHash);
        assertEq(result, 1); // failure (selector not allowed)
    }

    function test_validateUserOp_spendingLimit() public {
        bytes4[] memory empty = new bytes4[](0);

        vm.prank(owner);
        wallet.addSessionKey(sessionKey, 0, uint40(block.timestamp + 1 days), 1 ether, empty);

        // Try to send 2 ether (exceeds limit)
        bytes memory callData = abi.encodeCall(
            VibeSmartWallet.execute,
            (address(alice), 2 ether, "")
        );

        IVibeSmartWallet.UserOperation memory userOp = _buildUserOp(callData, 0);
        bytes32 userOpHash = keccak256(abi.encode(userOp));
        userOp.signature = _signHash(sessionPK, userOpHash);

        uint256 result = entryPoint.simulateValidation(wallet, userOp, userOpHash);
        assertEq(result, 1); // failure (spending limit)
    }

    function test_validateUserOp_nonceIncrement() public {
        assertEq(wallet.getNonce(), 0);

        bytes memory callData = abi.encodeCall(
            VibeSmartWallet.execute,
            (address(target), 0, abi.encodeCall(MockSWTarget.setValue, (1)))
        );

        IVibeSmartWallet.UserOperation memory userOp = _buildUserOp(callData, 0);
        bytes32 userOpHash = keccak256(abi.encode(userOp));
        userOp.signature = _signHash(ownerPK, userOpHash);

        entryPoint.simulateValidation(wallet, userOp, userOpHash);
        assertEq(wallet.getNonce(), 1);
    }

    function test_validateUserOp_revertsWrongNonce() public {
        bytes memory callData = abi.encodeCall(
            VibeSmartWallet.execute,
            (address(target), 0, abi.encodeCall(MockSWTarget.setValue, (1)))
        );

        IVibeSmartWallet.UserOperation memory userOp = _buildUserOp(callData, 999); // wrong nonce
        bytes32 userOpHash = keccak256(abi.encode(userOp));
        userOp.signature = _signHash(ownerPK, userOpHash);

        vm.expectRevert(IVibeSmartWallet.InvalidNonce.selector);
        entryPoint.simulateValidation(wallet, userOp, userOpHash);
    }

    function test_validateUserOp_revertsNotEntryPoint() public {
        bytes memory callData = abi.encodeCall(
            VibeSmartWallet.execute,
            (address(target), 0, abi.encodeCall(MockSWTarget.setValue, (1)))
        );

        IVibeSmartWallet.UserOperation memory userOp = _buildUserOp(callData, 0);
        bytes32 userOpHash = keccak256(abi.encode(userOp));
        userOp.signature = _signHash(ownerPK, userOpHash);

        vm.prank(alice);
        vm.expectRevert(IVibeSmartWallet.NotEntryPoint.selector);
        wallet.validateUserOp(userOp, userOpHash, 0);
    }

    // ============ Full Flow Tests (EntryPoint → Validate → Execute) ============

    function test_fullFlow_ownerViaEntryPoint() public {
        bytes memory callData = abi.encodeCall(
            VibeSmartWallet.execute,
            (address(target), 0, abi.encodeCall(MockSWTarget.setValue, (100)))
        );

        IVibeSmartWallet.UserOperation memory userOp = _buildUserOp(callData, 0);
        bytes32 userOpHash = keccak256(abi.encode(userOp));
        userOp.signature = _signHash(ownerPK, userOpHash);

        bool success = entryPoint.handleOp(wallet, userOp, userOpHash);
        assertTrue(success);
        assertEq(target.value(), 100);
    }

    function test_fullFlow_sessionKeyViaEntryPoint() public {
        // Setup session key
        bytes4[] memory selectors = new bytes4[](1);
        selectors[0] = MockSWTarget.setValue.selector;

        vm.prank(owner);
        wallet.addSessionKey(sessionKey, 0, uint40(block.timestamp + 1 days), 0, selectors);

        // Build UserOp signed by session key
        bytes memory callData = abi.encodeCall(
            VibeSmartWallet.execute,
            (address(target), 0, abi.encodeCall(MockSWTarget.setValue, (200)))
        );

        IVibeSmartWallet.UserOperation memory userOp = _buildUserOp(callData, 0);
        bytes32 userOpHash = keccak256(abi.encode(userOp));
        userOp.signature = _signHash(sessionPK, userOpHash);

        bool success = entryPoint.handleOp(wallet, userOp, userOpHash);
        assertTrue(success);
        assertEq(target.value(), 200);
    }

    // ============ Recovery Tests ============

    function test_setRecoveryAddress() public {
        vm.prank(owner);
        wallet.setRecoveryAddress(guardian);

        assertEq(wallet.recoveryAddress(), guardian);
    }

    function test_executeRecovery() public {
        address newOwner = makeAddr("newOwner");

        vm.prank(owner);
        wallet.setRecoveryAddress(guardian);

        vm.prank(guardian);
        wallet.executeRecovery(newOwner);

        assertEq(wallet.owner(), newOwner);
    }

    function test_executeRecovery_revertsNotRecovery() public {
        vm.prank(owner);
        wallet.setRecoveryAddress(guardian);

        vm.prank(alice);
        vm.expectRevert(IVibeSmartWallet.NotRecoveryAddress.selector);
        wallet.executeRecovery(alice);
    }

    function test_executeRecovery_revertsZeroOwner() public {
        vm.prank(owner);
        wallet.setRecoveryAddress(guardian);

        vm.prank(guardian);
        vm.expectRevert(IVibeSmartWallet.ZeroAddress.selector);
        wallet.executeRecovery(address(0));
    }

    // ============ Admin Tests ============

    function test_updateEntryPoint() public {
        address newEP = makeAddr("newEntryPoint");

        vm.prank(owner);
        wallet.updateEntryPoint(newEP);

        assertEq(wallet.entryPoint(), newEP);
    }

    function test_updateEntryPoint_revertsNotOwner() public {
        vm.prank(alice);
        vm.expectRevert(IVibeSmartWallet.NotOwner.selector);
        wallet.updateEntryPoint(makeAddr("newEP"));
    }

    function test_updateEntryPoint_revertsZero() public {
        vm.prank(owner);
        vm.expectRevert(IVibeSmartWallet.ZeroAddress.selector);
        wallet.updateEntryPoint(address(0));
    }

    // ============ Receive ETH ============

    function test_receiveEth() public {
        vm.deal(alice, 5 ether);
        vm.prank(alice);
        (bool success,) = address(wallet).call{value: 1 ether}("");
        assertTrue(success);
        assertEq(address(wallet).balance, 11 ether);
    }

    // ============ Helpers ============

    function _buildUserOp(bytes memory callData, uint256 nonce) internal view returns (IVibeSmartWallet.UserOperation memory) {
        return IVibeSmartWallet.UserOperation({
            sender: address(wallet),
            nonce: nonce,
            callData: callData,
            callGasLimit: 200_000,
            verificationGasLimit: 100_000,
            preVerificationGas: 21_000,
            maxFeePerGas: 20 gwei,
            maxPriorityFeePerGas: 2 gwei,
            signature: ""
        });
    }

    function _signHash(uint256 pk, bytes32 hash) internal pure returns (bytes memory) {
        bytes32 ethHash = MessageHashUtils.toEthSignedMessageHash(hash);
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(pk, ethHash);
        return abi.encodePacked(r, s, v);
    }
}
