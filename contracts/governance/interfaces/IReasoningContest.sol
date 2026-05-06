// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {IReasoningVerifier} from "./IReasoningVerifier.sol";

/**
 * @title IReasoningContest
 * @notice Bonded permissionless contest for reasoning chains that fall outside
 *         the tractable fragment (Tier 3 of the on-chain reasoning verification
 *         architecture).
 *
 *         Spec: docs/research/papers/on-chain-reasoning-verification.md §"Tier 3"
 *
 *         Pattern: applies the Bonded Permissionless Contest primitive (cycle C47,
 *         see docs/concepts/primitives/bonded-permissionless-contest.md) to
 *         REASONING rather than VALUE FLOW. Same three properties carry over:
 *           - skin-in-the-game gates noise (bond floor)
 *           - deadline forces engagement (challenge window)
 *           - default-on-expiry encodes burden of proof (claim finalizes if unchallenged)
 *
 *         Lifecycle:
 *           1. submitClaim(chainHash, action) — agent posts bond, "no contradiction"
 *              claim, transaction executes optimistically
 *           2. challenge window opens (challengeWindow seconds)
 *           3a. challengeContradiction(chainHash, atomA, atomB, derivation) —
 *               anyone may post fraud proof: two atoms in the chain plus a
 *               derivation showing they jointly entail false. Verifier checks
 *               the derivation. If valid: bond slashes to challenger, action
 *               reverts.
 *           3b. window expires without challenge: action finalizes, bond returns.
 *
 *         Distinct from IReasoningVerifier: that interface handles the
 *         tractable-fragment witness check (cheap, on-chain, default path).
 *         This interface handles assertions that need full first-order logic
 *         (quantifiers, disjunction, counterfactuals) — escalation path.
 */
interface IReasoningContest {
    // ============ Enums ============

    enum ClaimStatus {
        UNSET,
        PENDING,        // submitted, in challenge window
        CHALLENGED,     // fraud proof posted, awaiting verifier ruling
        FINALIZED,      // window expired or challenge dismissed
        REVERTED        // valid fraud proof confirmed, action voided
    }

    enum InferenceRule {
        MODUS_PONENS,           // A, A→B ⊢ B
        MODUS_TOLLENS,          // ¬B, A→B ⊢ ¬A
        AND_ELIM_LEFT,          // A∧B ⊢ A
        AND_ELIM_RIGHT,         // A∧B ⊢ B
        CONTRADICTION_DIRECT,   // A, ¬A ⊢ ⊥
        CONTRADICTION_NUMERIC,  // x≤c, x>c ⊢ ⊥
        CONTRADICTION_BOOL      // bool_var=true, bool_var=false ⊢ ⊥
    }

    // ============ Structs ============

    /// @notice A single step in a fraud-proof derivation.
    struct DerivationStep {
        InferenceRule rule;
        uint256[] premiseIndices;   // indices into the atom chain (or prior steps)
        IReasoningVerifier.Atom conclusion;
    }

    struct Claim {
        bytes32 chainHash;          // commitment to the atom array
        bytes32 actionHash;         // hash of the action this reasoning justifies
        address claimant;
        uint256 bond;
        address bondToken;
        uint64 submittedAt;
        uint64 deadline;
        ClaimStatus status;
        address challenger;         // set if status >= CHALLENGED
    }

    // ============ Events ============

    event ClaimSubmitted(
        bytes32 indexed chainHash,
        bytes32 indexed actionHash,
        address indexed claimant,
        uint256 bond,
        uint64 deadline
    );
    event ClaimFinalized(bytes32 indexed chainHash, address indexed claimant);
    event ContradictionChallenged(
        bytes32 indexed chainHash,
        address indexed challenger,
        uint256 atomAIndex,
        uint256 atomBIndex,
        uint256 derivationLength
    );
    event ChallengeUpheld(bytes32 indexed chainHash, address indexed challenger, uint256 reward);
    event ChallengeDismissed(bytes32 indexed chainHash, address indexed challenger);

    // ============ Errors ============

    error ClaimNotPending();
    error ClaimWindowExpired();
    error ClaimWindowNotExpired();
    error InvalidDerivation(uint256 stepIndex);
    error DerivationDoesNotConclude();
    error UnknownInferenceRule(InferenceRule rule);
    error PremiseOutOfRange(uint256 index);
    error BondTransferFailed();
    error AlreadyChallenged();
    error NotClaimant();

    // ============ Submit ============

    /// @notice Submit a reasoning claim with bond. Action executes optimistically;
    ///         bond is slashed if a valid contradiction proof is posted within window.
    /// @param atoms the assertion chain
    /// @param actionHash hash of the action this chain justifies
    /// @return chainHash canonical commitment to the atoms
    function submitClaim(
        IReasoningVerifier.Atom[] calldata atoms,
        bytes32 actionHash
    ) external returns (bytes32 chainHash);

    // ============ Challenge ============

    /// @notice Post a fraud proof that two atoms in the chain jointly entail false.
    /// @dev The derivation is a sequence of inference rule applications starting
    ///      from atomA and atomB, terminating at a contradiction (CONTRADICTION_*).
    ///      Verifier walks the derivation; if every step is valid and the final
    ///      step is a contradiction rule, the challenge is upheld.
    function challengeContradiction(
        bytes32 chainHash,
        uint256 atomAIndex,
        uint256 atomBIndex,
        DerivationStep[] calldata derivation
    ) external;

    /// @notice Permissionless: window expired without challenge, finalize.
    function finalizeUnchallenged(bytes32 chainHash) external;

    // ============ View ============

    function getClaim(bytes32 chainHash) external view returns (Claim memory);
    function challengeWindow() external view returns (uint64);
    function bondAmount() external view returns (uint256);
    function bondToken() external view returns (address);
    function isFinalized(bytes32 chainHash) external view returns (bool);

    // ============ Admin ============

    function setBondParams(address token, uint256 amount) external;
    function setChallengeWindow(uint64 windowSeconds) external;
}
