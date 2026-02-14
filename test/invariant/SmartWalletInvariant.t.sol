// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "forge-std/Test.sol";
import "forge-std/StdInvariant.sol";
import "../../contracts/account/VibeSmartWallet.sol";
import "../../contracts/account/VibeWalletFactory.sol";
import "../../contracts/account/interfaces/IVibeSmartWallet.sol";
import "@openzeppelin/contracts/utils/cryptography/MessageHashUtils.sol";

// ============ Mocks ============

contract MockSWInvTarget {
    uint256 public value;
    function setValue(uint256 _value) external { value = _value; }
}

contract MockSWInvEntryPoint {
    function simulateValidation(
        VibeSmartWallet wallet,
        IVibeSmartWallet.UserOperation calldata userOp,
        bytes32 userOpHash
    ) external returns (uint256) {
        return wallet.validateUserOp(userOp, userOpHash, 0);
    }
}

// ============ Handler ============

contract SmartWalletHandler is Test {
    VibeSmartWallet public wallet;
    MockSWInvTarget public target;
    MockSWInvEntryPoint public entryPoint;

    uint256 public ownerPK;
    address public owner;

    // Ghost variables
    uint256 public ghost_validations;
    uint256 public ghost_executions;
    uint256 public ghost_sessionKeysAdded;
    uint256 public ghost_sessionKeysRevoked;

    uint256 private _skCounter;

    constructor(
        VibeSmartWallet _wallet,
        MockSWInvTarget _target,
        MockSWInvEntryPoint _entryPoint,
        address _owner,
        uint256 _ownerPK
    ) {
        wallet = _wallet;
        target = _target;
        entryPoint = _entryPoint;
        owner = _owner;
        ownerPK = _ownerPK;
        _skCounter = 100;
    }

    function validateAndExecute(uint256 valueSeed) public {
        uint256 val = bound(valueSeed, 0, 1_000_000);
        uint256 nonce = wallet.getNonce();

        bytes memory callData = abi.encodeCall(
            VibeSmartWallet.execute,
            (address(target), 0, abi.encodeCall(MockSWInvTarget.setValue, (val)))
        );

        IVibeSmartWallet.UserOperation memory userOp = IVibeSmartWallet.UserOperation({
            sender: address(wallet), nonce: nonce, callData: callData,
            callGasLimit: 200_000, verificationGasLimit: 100_000,
            preVerificationGas: 21_000, maxFeePerGas: 20 gwei,
            maxPriorityFeePerGas: 2 gwei, signature: ""
        });

        bytes32 userOpHash = keccak256(abi.encode(userOp));
        bytes32 ethHash = MessageHashUtils.toEthSignedMessageHash(userOpHash);
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(ownerPK, ethHash);
        userOp.signature = abi.encodePacked(r, s, v);

        try entryPoint.simulateValidation(wallet, userOp, userOpHash) returns (uint256 result) {
            ghost_validations++;
            if (result == 0) {
                ghost_executions++;
            }
        } catch {}
    }

    function addSessionKey() public {
        uint256 pk = uint256(keccak256(abi.encodePacked("sk", ++_skCounter)));
        pk = bound(pk, 1, type(uint256).max - 1);
        address sk = vm.addr(pk);

        bytes4[] memory empty = new bytes4[](0);
        vm.prank(owner);
        try wallet.addSessionKey(sk, 0, uint40(block.timestamp + 1 days), 0, empty) {
            ghost_sessionKeysAdded++;
        } catch {}
    }

    function warpTime(uint256 seconds_) public {
        seconds_ = bound(seconds_, 0, 2 hours);
        vm.warp(block.timestamp + seconds_);
    }
}

// ============ Invariant Tests ============

contract SmartWalletInvariantTest is StdInvariant, Test {
    VibeSmartWallet public wallet;
    VibeWalletFactory public factory;
    MockSWInvTarget public target;
    MockSWInvEntryPoint public entryPoint;
    SmartWalletHandler public handler;

    uint256 public ownerPK;
    address public owner;

    function setUp() public {
        (owner, ownerPK) = makeAddrAndKey("owner");

        entryPoint = new MockSWInvEntryPoint();
        target = new MockSWInvTarget();

        factory = new VibeWalletFactory(address(entryPoint));
        address walletAddr = factory.createAccount(owner, bytes32(0));
        wallet = VibeSmartWallet(payable(walletAddr));

        vm.deal(address(wallet), 100 ether);

        handler = new SmartWalletHandler(wallet, target, entryPoint, owner, ownerPK);
        targetContract(address(handler));
    }

    // ============ Nonce Invariant ============

    /**
     * @notice Nonce always equals total successful validations.
     */
    function invariant_nonceMatchesValidations() public view {
        assertEq(
            wallet.getNonce(),
            handler.ghost_validations(),
            "Nonce must match validation count"
        );
    }

    // ============ Owner Invariant ============

    /**
     * @notice Owner never becomes zero (handler doesn't do recovery).
     */
    function invariant_ownerNeverZero() public view {
        assertTrue(wallet.owner() != address(0), "Owner must never be zero");
    }

    // ============ Initialization Invariant ============

    /**
     * @notice EntryPoint is always set.
     */
    function invariant_entryPointAlwaysSet() public view {
        assertTrue(wallet.entryPoint() != address(0), "EntryPoint must be set");
    }

    // ============ Call Summary ============

    function invariant_callSummary() public view {
        console.log("--- Smart Wallet Invariant Summary ---");
        console.log("Validations:", handler.ghost_validations());
        console.log("Executions:", handler.ghost_executions());
        console.log("Session keys added:", handler.ghost_sessionKeysAdded());
        console.log("Nonce:", wallet.getNonce());
    }
}
