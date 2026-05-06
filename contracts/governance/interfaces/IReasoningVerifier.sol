// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/**
 * @title IReasoningVerifier
 * @notice Interface for on-chain reasoning verification — verifies that a set of
 *         atomic assertions (a "BECAUSE chain") is internally consistent and that
 *         each atom holds against actual chain state.
 *
 *         Spec: docs/research/papers/on-chain-reasoning-verification.md
 *         Origin: GH discussion #18, 2026-05-06
 *
 *         Two distinct checks:
 *           - verifyConsistency: do the atoms form a satisfiable set?
 *             Witness-based: prover (off-chain) finds a satisfying assignment;
 *             verifier (on-chain) substitutes the witness and confirms each
 *             atom evaluates true. Cost is O(n) in atom count.
 *           - verifyTruth: does each atom hold against actual chain state?
 *             Verifier reads varKeys from a state oracle, evaluates each atom.
 *
 *         A reasoning chain is valid only if BOTH checks pass. Witness validates
 *         the *internal* shape of the claim; oracle validates that the claim is
 *         *grounded*. Without both: coherent fiction OR broken assertion.
 *
 *         Tractable fragment (assertion grammar):
 *           - atoms: var <op> const  |  var <op> var  |  bool_var
 *           - ops: EQ, NEQ, LEQ, LT, GEQ, GT, BOOL_TRUE, BOOL_FALSE
 *           - composition: conjunction only (AND of atoms)
 *           - forbidden: disjunction, negation of compound, quantifiers, recursion
 *
 *         Anything outside the fragment uses the bonded-permissionless-contest
 *         tier (see IReasoningContest).
 */
interface IReasoningVerifier {
    // ============ Enums ============

    enum Op {
        EQ,         // var == const | var == var
        NEQ,        // var != const | var != var
        LEQ,        // var <= const | var <= var
        LT,         // var <  const | var <  var
        GEQ,        // var >= const | var >= var
        GT,         // var >  const | var >  var
        BOOL_TRUE,  // bool_var is true
        BOOL_FALSE  // bool_var is false
    }

    // ============ Structs ============

    /// @notice One atomic assertion in a reasoning chain.
    /// @dev For BOOL_TRUE / BOOL_FALSE, only lhsVarKey is meaningful.
    ///      For binary comparison ops, isRhsVar selects between rhsVarKey and rhsConst.
    struct Atom {
        bytes32 lhsVarKey;
        Op op;
        bool isRhsVar;
        bytes32 rhsVarKey;
        int256 rhsConst;
    }

    /// @notice Witness assignment: (varKey, value) pairs covering every variable
    ///         referenced by any atom in the chain.
    /// @dev varKeys[i] corresponds to varValues[i]. For boolean vars, value is
    ///      0 (false) or 1 (true); other values revert.
    struct Witness {
        bytes32[] varKeys;
        int256[] varValues;
    }

    // ============ Events ============

    event ConsistencyVerified(bytes32 indexed chainHash, uint256 atomCount);
    event TruthVerified(bytes32 indexed chainHash, address indexed oracle, uint256 atomCount);
    event WitnessRejected(bytes32 indexed chainHash, uint256 failingAtomIndex, string reason);

    // ============ Errors ============

    error EmptyChain();
    error WitnessVarMissing(bytes32 varKey);
    error WitnessLengthMismatch();
    error InvalidBoolValue(bytes32 varKey, int256 value);
    error AtomFailed(uint256 atomIndex);
    error UnsupportedOp(Op op);
    error ConstOnLhs();
    error OracleNotSet();

    // ============ Verification ============

    /// @notice Verify that `atoms` are jointly satisfiable by exhibition of `witness`.
    /// @dev Substitutes each varKey in each atom with the corresponding witness value
    ///      and confirms the atom evaluates true. Reverts on any failing atom.
    ///      Pure function — does not read chain state.
    /// @return chainHash keccak256 commitment to the atom array (for emit/audit linking)
    function verifyConsistency(
        Atom[] calldata atoms,
        Witness calldata witness
    ) external view returns (bytes32 chainHash);

    /// @notice Verify that `atoms` hold against actual chain state read from `oracle`.
    /// @dev For each atom, reads lhsVarKey (and rhsVarKey if applicable) from the
    ///      oracle and evaluates the op. Reverts on any failing atom.
    /// @return chainHash keccak256 commitment to the atom array
    function verifyTruth(
        Atom[] calldata atoms,
        IStateOracle oracle
    ) external view returns (bytes32 chainHash);

    /// @notice Convenience: verify both consistency (via witness) AND truth (via oracle).
    ///         A complete reasoning-chain validation.
    function verifyChain(
        Atom[] calldata atoms,
        Witness calldata witness,
        IStateOracle oracle
    ) external view returns (bytes32 chainHash);

    // ============ Hashing ============

    /// @notice Canonical hash of an atom chain (used for commitment/reveal flows).
    /// @dev Order-sensitive: hash(A,B) != hash(B,A). Reasoning chains commit to a
    ///      specific ordering; reordering is a separate proposal.
    function hashChain(Atom[] calldata atoms) external pure returns (bytes32);
}

/**
 * @title IStateOracle
 * @notice Abstracted read-only view of chain state, keyed by bytes32 variable identifiers.
 *
 *         Implementations may proxy to:
 *           - storage slots (raw EVM state read)
 *           - a registry of (contract, selector) tuples
 *           - off-chain attested state (for cross-chain assertions)
 *
 *         varKey namespace is implementation-defined but should be canonicalized
 *         per the EIP for assertion grammars. See spec §"Standardization path".
 */
interface IStateOracle {
    /// @notice Read an integer-valued variable.
    /// @dev Booleans returned as 0 or 1.
    function readInt(bytes32 varKey) external view returns (int256);

    /// @notice Whether this oracle can resolve `varKey`.
    function hasVar(bytes32 varKey) external view returns (bool);
}
