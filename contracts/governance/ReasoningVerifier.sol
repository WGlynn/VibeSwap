// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {IReasoningVerifier, IStateOracle} from "./interfaces/IReasoningVerifier.sol";

/**
 * @title ReasoningVerifier
 * @notice Reference implementation of the Tier 2 witness-based consistency check
 *         and Tier 2 oracle-based truth check, per
 *         docs/research/papers/on-chain-reasoning-verification.md.
 *
 *         Stateless / pure with respect to its own storage — verifications are
 *         performed against the calldata atom array, the calldata witness, and
 *         (for truth) the supplied IStateOracle. Multiple consumer contracts
 *         can share a single deployed verifier.
 *
 *         Tractable fragment: atoms over named state vars, conjunction only,
 *         no quantifiers / disjunction / recursion. See IReasoningVerifier
 *         natspec for grammar definition.
 */
contract ReasoningVerifier is IReasoningVerifier {
    // ============ Verification ============

    /// @inheritdoc IReasoningVerifier
    function verifyConsistency(
        Atom[] calldata atoms,
        Witness calldata witness
    ) external view returns (bytes32 chainHash) {
        if (atoms.length == 0) revert EmptyChain();
        if (witness.varKeys.length != witness.varValues.length) revert WitnessLengthMismatch();

        for (uint256 i = 0; i < atoms.length; i++) {
            Atom calldata a = atoms[i];
            int256 lhs = _readWitness(a.lhsVarKey, witness);
            int256 rhs = a.isRhsVar ? _readWitness(a.rhsVarKey, witness) : a.rhsConst;
            if (!_evalAtom(a, lhs, rhs)) revert AtomFailed(i);
        }

        chainHash = _hashChain(atoms);
    }

    /// @inheritdoc IReasoningVerifier
    function verifyTruth(
        Atom[] calldata atoms,
        IStateOracle oracle
    ) external view returns (bytes32 chainHash) {
        if (atoms.length == 0) revert EmptyChain();
        if (address(oracle) == address(0)) revert OracleNotSet();

        for (uint256 i = 0; i < atoms.length; i++) {
            Atom calldata a = atoms[i];
            int256 lhs = oracle.readInt(a.lhsVarKey);
            int256 rhs = a.isRhsVar ? oracle.readInt(a.rhsVarKey) : a.rhsConst;
            if (!_evalAtom(a, lhs, rhs)) revert AtomFailed(i);
        }

        chainHash = _hashChain(atoms);
    }

    /// @inheritdoc IReasoningVerifier
    function verifyChain(
        Atom[] calldata atoms,
        Witness calldata witness,
        IStateOracle oracle
    ) external view returns (bytes32 chainHash) {
        // Consistency first (cheap; pure-on-calldata)
        if (atoms.length == 0) revert EmptyChain();
        if (witness.varKeys.length != witness.varValues.length) revert WitnessLengthMismatch();
        if (address(oracle) == address(0)) revert OracleNotSet();

        for (uint256 i = 0; i < atoms.length; i++) {
            Atom calldata a = atoms[i];
            int256 lhsW = _readWitness(a.lhsVarKey, witness);
            int256 rhsW = a.isRhsVar ? _readWitness(a.rhsVarKey, witness) : a.rhsConst;
            if (!_evalAtom(a, lhsW, rhsW)) revert AtomFailed(i);

            // Truth: same atom against actual state
            int256 lhsT = oracle.readInt(a.lhsVarKey);
            int256 rhsT = a.isRhsVar ? oracle.readInt(a.rhsVarKey) : a.rhsConst;
            if (!_evalAtom(a, lhsT, rhsT)) revert AtomFailed(i);
        }

        chainHash = _hashChain(atoms);
    }

    // ============ Hashing ============

    /// @inheritdoc IReasoningVerifier
    function hashChain(Atom[] calldata atoms) external pure returns (bytes32) {
        return _hashChain(atoms);
    }

    function _hashChain(Atom[] calldata atoms) internal pure returns (bytes32 h) {
        // Order-sensitive concatenation hash. Reasoning chains commit to a
        // specific atom ordering; reordering is a separate proposal.
        h = keccak256(abi.encode(atoms));
    }

    // ============ Internal evaluation ============

    function _evalAtom(Atom calldata a, int256 lhs, int256 rhs) internal pure returns (bool) {
        Op op = a.op;
        if (op == Op.EQ)        return lhs == rhs;
        if (op == Op.NEQ)       return lhs != rhs;
        if (op == Op.LEQ)       return lhs <= rhs;
        if (op == Op.LT)        return lhs <  rhs;
        if (op == Op.GEQ)       return lhs >= rhs;
        if (op == Op.GT)        return lhs >  rhs;
        if (op == Op.BOOL_TRUE) {
            // For bool ops, lhs is the bool var value (0 or 1); rhs is ignored.
            if (lhs != 0 && lhs != 1) revert InvalidBoolValue(a.lhsVarKey, lhs);
            return lhs == 1;
        }
        if (op == Op.BOOL_FALSE) {
            if (lhs != 0 && lhs != 1) revert InvalidBoolValue(a.lhsVarKey, lhs);
            return lhs == 0;
        }
        revert UnsupportedOp(op);
    }

    function _readWitness(bytes32 varKey, Witness calldata w) internal pure returns (int256) {
        // Linear scan; witness sets are small (size ~= number of distinct vars
        // in the chain). For larger chains, consumers should pre-sort and
        // adopt binary search at the cost of a sort step off-chain.
        for (uint256 i = 0; i < w.varKeys.length; i++) {
            if (w.varKeys[i] == varKey) return w.varValues[i];
        }
        revert WitnessVarMissing(varKey);
    }
}
