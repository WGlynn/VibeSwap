// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "forge-std/Test.sol";
import "../../contracts/account/VibeSmartWallet.sol";
import "../../contracts/account/VibeWalletFactory.sol";
import "../../contracts/account/interfaces/IVibeSmartWallet.sol";
import "@openzeppelin/contracts/utils/cryptography/MessageHashUtils.sol";

// ============ Mocks ============

contract MockSWFuzzTarget {
    uint256 public value;
    function setValue(uint256 _value) external { value = _value; }
}

contract MockSWFuzzEntryPoint {
    function simulateValidation(
        VibeSmartWallet wallet,
        IVibeSmartWallet.UserOperation calldata userOp,
        bytes32 userOpHash
    ) external returns (uint256) {
        return wallet.validateUserOp(userOp, userOpHash, 0);
    }
}

// ============ Fuzz Tests ============

contract VibeSmartWalletFuzzTest is Test {
    VibeSmartWallet public wallet;
    VibeWalletFactory public factory;
    MockSWFuzzTarget public target;
    MockSWFuzzEntryPoint public entryPoint;

    uint256 public ownerPK;
    address public owner;

    function setUp() public {
        (owner, ownerPK) = makeAddrAndKey("owner");

        entryPoint = new MockSWFuzzEntryPoint();
        target = new MockSWFuzzTarget();

        factory = new VibeWalletFactory(address(entryPoint));
        address walletAddr = factory.createAccount(owner, bytes32(0));
        wallet = VibeSmartWallet(payable(walletAddr));

        vm.deal(address(wallet), 100 ether);
    }

    // ============ Nonce Properties ============

    function testFuzz_nonceIncrements(uint8 count) public {
        count = uint8(bound(count, 1, 20));

        for (uint8 i = 0; i < count; i++) {
            bytes memory callData = abi.encodeCall(
                VibeSmartWallet.execute,
                (address(target), 0, abi.encodeCall(MockSWFuzzTarget.setValue, (uint256(i))))
            );

            IVibeSmartWallet.UserOperation memory userOp = IVibeSmartWallet.UserOperation({
                sender: address(wallet), nonce: i, callData: callData,
                callGasLimit: 200_000, verificationGasLimit: 100_000,
                preVerificationGas: 21_000, maxFeePerGas: 20 gwei,
                maxPriorityFeePerGas: 2 gwei, signature: ""
            });

            bytes32 userOpHash = keccak256(abi.encode(userOp));
            userOp.signature = _signHash(ownerPK, userOpHash);

            entryPoint.simulateValidation(wallet, userOp, userOpHash);
        }

        assertEq(wallet.getNonce(), count);
    }

    // ============ Session Key Expiry Properties ============

    function testFuzz_sessionKeyExpiryRespected(uint40 validUntil) public {
        validUntil = uint40(bound(validUntil, uint40(block.timestamp + 1), type(uint40).max - 1));

        (address sk, uint256 skPK) = makeAddrAndKey("sk");
        bytes4[] memory empty = new bytes4[](0);

        vm.prank(owner);
        wallet.addSessionKey(sk, 0, validUntil, 0, empty);

        assertTrue(wallet.isSessionKeyActive(sk));

        vm.warp(validUntil + 1);
        assertFalse(wallet.isSessionKeyActive(sk));
    }

    // ============ Spending Limit Properties ============

    function testFuzz_spendingLimitEnforced(uint128 limit, uint256 sendAmount) public {
        limit = uint128(bound(limit, 1, type(uint128).max));
        sendAmount = bound(sendAmount, 0, 10 ether);

        (address sk, uint256 skPK) = makeAddrAndKey("sk");
        bytes4[] memory empty = new bytes4[](0);

        vm.prank(owner);
        wallet.addSessionKey(sk, 0, uint40(block.timestamp + 1 days), limit, empty);

        bytes memory callData = abi.encodeCall(
            VibeSmartWallet.execute,
            (address(target), sendAmount, "")
        );

        IVibeSmartWallet.UserOperation memory userOp = IVibeSmartWallet.UserOperation({
            sender: address(wallet), nonce: 0, callData: callData,
            callGasLimit: 200_000, verificationGasLimit: 100_000,
            preVerificationGas: 21_000, maxFeePerGas: 20 gwei,
            maxPriorityFeePerGas: 2 gwei, signature: ""
        });

        bytes32 userOpHash = keccak256(abi.encode(userOp));
        userOp.signature = _signHash(skPK, userOpHash);

        uint256 result = entryPoint.simulateValidation(wallet, userOp, userOpHash);

        if (sendAmount > limit) {
            assertEq(result, 1, "Should fail: spending limit exceeded");
        } else {
            assertEq(result, 0, "Should pass: within spending limit");
        }
    }

    // ============ Deterministic Address Properties ============

    function testFuzz_factoryAddressDeterministic(bytes32 salt) public view {
        address predicted = factory.getAddress(owner, salt);
        // Predicted address should be deterministic (same inputs = same output)
        address predicted2 = factory.getAddress(owner, salt);
        assertEq(predicted, predicted2);
    }

    function testFuzz_differentSaltDifferentAddress(bytes32 salt1, bytes32 salt2) public view {
        vm.assume(salt1 != salt2);
        address addr1 = factory.getAddress(owner, salt1);
        address addr2 = factory.getAddress(owner, salt2);
        assertTrue(addr1 != addr2);
    }

    // ============ Owner Validation Properties ============

    function testFuzz_onlyOwnerSignatureValid(uint256 randomPK) public {
        // secp256k1 curve order
        uint256 SECP256K1_ORDER = 115792089237316195423570985008687907852837564279074904382605163141518161494337;
        randomPK = bound(randomPK, 1, SECP256K1_ORDER - 1);
        // Ensure it's not the owner PK
        vm.assume(vm.addr(randomPK) != owner);

        bytes memory callData = abi.encodeCall(
            VibeSmartWallet.execute,
            (address(target), 0, abi.encodeCall(MockSWFuzzTarget.setValue, (42)))
        );

        IVibeSmartWallet.UserOperation memory userOp = IVibeSmartWallet.UserOperation({
            sender: address(wallet), nonce: 0, callData: callData,
            callGasLimit: 200_000, verificationGasLimit: 100_000,
            preVerificationGas: 21_000, maxFeePerGas: 20 gwei,
            maxPriorityFeePerGas: 2 gwei, signature: ""
        });

        bytes32 userOpHash = keccak256(abi.encode(userOp));
        userOp.signature = _signHash(randomPK, userOpHash);

        uint256 result = entryPoint.simulateValidation(wallet, userOp, userOpHash);
        assertEq(result, 1, "Random PK should fail validation");
    }

    // ============ Recovery Properties ============

    function testFuzz_recoveryTransfersOwnership(address newOwner) public {
        vm.assume(newOwner != address(0));

        vm.prank(owner);
        wallet.setRecoveryAddress(address(this));

        wallet.executeRecovery(newOwner);
        assertEq(wallet.owner(), newOwner);
    }

    // ============ Helpers ============

    function _signHash(uint256 pk, bytes32 hash) internal pure returns (bytes memory) {
        bytes32 ethHash = MessageHashUtils.toEthSignedMessageHash(hash);
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(pk, ethHash);
        return abi.encodePacked(r, s, v);
    }
}
