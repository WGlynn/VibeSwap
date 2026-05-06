// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "forge-std/Test.sol";

import {ReasoningVerifier} from "../../contracts/governance/ReasoningVerifier.sol";
import {ReasonedVault} from "../../contracts/governance/examples/ReasonedVault.sol";
import {IReasoningVerifier, IStateOracle} from "../../contracts/governance/interfaces/IReasoningVerifier.sol";

/// @notice Minimal in-memory oracle that the test wires up directly.
contract InlineOracle is IStateOracle {
    mapping(bytes32 => int256) internal _v;
    mapping(bytes32 => bool) internal _set;
    function set(bytes32 k, int256 val) external { _v[k] = val; _set[k] = true; }
    function readInt(bytes32 k) external view returns (int256) { require(_set[k], "unset"); return _v[k]; }
    function hasVar(bytes32 k) external view returns (bool) { return _set[k]; }
}

contract ReasonedVaultTest is Test {
    ReasoningVerifier internal verifier;
    InlineOracle internal oracle;
    ReasonedVault internal vault;

    address internal alice = address(0xA11CE);

    function setUp() public {
        verifier = new ReasoningVerifier();
        oracle   = new InlineOracle();
        vault    = new ReasonedVault(verifier, oracle);

        vm.deal(alice, 10 ether);
        vm.prank(alice);
        vault.deposit{value: 5 ether}();
    }

    function _atom(
        bytes32 lhs,
        IReasoningVerifier.Op op,
        bool isRhsVar,
        bytes32 rhsVar,
        int256 rhsConst
    ) internal pure returns (IReasoningVerifier.Atom memory) {
        return IReasoningVerifier.Atom({
            lhsVarKey: lhs, op: op, isRhsVar: isRhsVar, rhsVarKey: rhsVar, rhsConst: rhsConst
        });
    }

    function _validChain() internal view returns (IReasoningVerifier.Atom[] memory atoms) {
        atoms = new IReasoningVerifier.Atom[](3);
        atoms[0] = _atom(vault.K_AMOUNT(),  IReasoningVerifier.Op.LEQ, true, vault.K_MAX(), 0);       // amount <= max
        atoms[1] = _atom(vault.K_BALANCE(), IReasoningVerifier.Op.GEQ, true, vault.K_AMOUNT(), 0);    // balance >= amount
        atoms[2] = _atom(vault.K_NOT_FROZEN(), IReasoningVerifier.Op.BOOL_TRUE, false, bytes32(0), 0); // notFrozen
    }

    function _witnessFor(uint256 amount, uint256 balance) internal view returns (IReasoningVerifier.Witness memory w) {
        w.varKeys   = new bytes32[](4);
        w.varValues = new int256[](4);
        w.varKeys[0] = vault.K_AMOUNT();    w.varValues[0] = int256(amount);
        w.varKeys[1] = vault.K_BALANCE();   w.varValues[1] = int256(balance);
        w.varKeys[2] = vault.K_MAX();       w.varValues[2] = int256(vault.maxWithdrawPerTx());
        w.varKeys[3] = vault.K_NOT_FROZEN(); w.varValues[3] = 1;
    }

    function _seedOracle(uint256 amount, uint256 balance) internal {
        oracle.set(vault.K_AMOUNT(),    int256(amount));
        oracle.set(vault.K_BALANCE(),   int256(balance));
        oracle.set(vault.K_MAX(),       int256(vault.maxWithdrawPerTx()));
        oracle.set(vault.K_NOT_FROZEN(), 1);
    }

    // ============ Happy path ============

    function test_validReasoning_withdrawalSucceeds() public {
        uint256 amount  = 1 ether;
        uint256 balance = 5 ether;
        _seedOracle(amount, balance);

        IReasoningVerifier.Atom[] memory atoms = _validChain();
        IReasoningVerifier.Witness memory w   = _witnessFor(amount, balance);

        uint256 before = alice.balance;
        vm.prank(alice);
        vault.withdrawWithReasoning(amount, atoms, w);
        assertEq(alice.balance, before + amount);
        assertEq(vault.balanceOf(alice), 4 ether);
    }

    // ============ Witness binding ============

    function test_witnessAmountMismatch_reverts() public {
        // Witness asserts amount=2 but actual call passes amount=1
        uint256 callAmount    = 1 ether;
        uint256 witnessAmount = 2 ether;
        _seedOracle(callAmount, 5 ether);

        IReasoningVerifier.Atom[] memory atoms = _validChain();
        IReasoningVerifier.Witness memory w = _witnessFor(witnessAmount, 5 ether);

        vm.prank(alice);
        vm.expectRevert(ReasonedVault.ChainMismatch.selector);
        vault.withdrawWithReasoning(callAmount, atoms, w);
    }

    function test_witnessMissingAmountKey_reverts() public {
        uint256 amount  = 1 ether;
        _seedOracle(amount, 5 ether);

        IReasoningVerifier.Atom[] memory atoms = _validChain();
        // Witness without K_AMOUNT entry — should revert ChainMismatch on binding step
        IReasoningVerifier.Witness memory w;
        w.varKeys   = new bytes32[](3);
        w.varValues = new int256[](3);
        w.varKeys[0] = vault.K_BALANCE();   w.varValues[0] = 5 ether;
        w.varKeys[1] = vault.K_MAX();       w.varValues[1] = int256(vault.maxWithdrawPerTx());
        w.varKeys[2] = vault.K_NOT_FROZEN(); w.varValues[2] = 1;

        vm.prank(alice);
        vm.expectRevert(ReasonedVault.ChainMismatch.selector);
        vault.withdrawWithReasoning(amount, atoms, w);
    }

    // ============ Reasoning that doesn't match state ============

    function test_witnessConsistentButStateContradicts_reverts() public {
        // Witness claims balance=10 but actual oracle balance is 0.
        uint256 amount = 1 ether;
        oracle.set(vault.K_AMOUNT(),    int256(amount));
        oracle.set(vault.K_BALANCE(),   int256(0));   // diverges from witness
        oracle.set(vault.K_MAX(),       int256(vault.maxWithdrawPerTx()));
        oracle.set(vault.K_NOT_FROZEN(), 1);

        IReasoningVerifier.Atom[] memory atoms = _validChain();
        IReasoningVerifier.Witness memory w = _witnessFor(amount, 10 ether);

        vm.prank(alice);
        // verifyChain interleaves witness and truth checks; the truth check
        // for atom 1 (balance >= amount) fails because state has balance=0.
        vm.expectRevert(abi.encodeWithSelector(IReasoningVerifier.AtomFailed.selector, uint256(1)));
        vault.withdrawWithReasoning(amount, atoms, w);
    }

    // ============ Frozen vault ============

    function test_frozenVault_reverts() public {
        uint256 amount = 1 ether;
        _seedOracle(amount, 5 ether);

        // Freeze the vault — note this changes the oracle binding too in a
        // real deployment, but in this test the oracle still says notFrozen=1.
        // The witness will pass, then the runtime guard kicks in.
        vault.setFrozen(true);

        IReasoningVerifier.Atom[] memory atoms = _validChain();
        IReasoningVerifier.Witness memory w = _witnessFor(amount, 5 ether);

        vm.prank(alice);
        vm.expectRevert(ReasonedVault.VaultFrozen.selector);
        vault.withdrawWithReasoning(amount, atoms, w);
    }

    // ============ Deposit (no reasoning required) ============

    function test_deposit_noReasoningNeeded() public {
        vm.deal(alice, 1 ether);
        vm.prank(alice);
        vault.deposit{value: 0.5 ether}();
        assertEq(vault.balanceOf(alice), 5.5 ether);
    }
}
