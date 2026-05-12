// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/**
 * @title IGovernanceProposalVerifier
 * @author Faraday1 & JARVIS — vibeswap.org
 * @notice Autonomous on-chain verifier that gates GovernanceGuard.execute() on
 *         Shapley-axiom preservation. Closes the Augmented Governance gap flagged
 *         by AA#2 audit 2026-05-12: prior to this primitive, the doc-claimed
 *         "Physics > Constitution > Governance" hierarchy was not structurally
 *         enforced. execute() had no fairness check, leaving the math layer
 *         protected only by a human veto multisig.
 *
 *         After this primitive lands, every proposal must clear two gates before
 *         executing: (a) the timelock-and-veto window (existing), and (b) an
 *         autonomous verifyProposal() call (this interface). Gate (b) is the
 *         structural enforcer of P-001 — it does not depend on any human
 *         signer being honest or available.
 *
 * @dev Implementations should refuse any proposal whose target+data would break
 *      a Physics-layer invariant. Concretely:
 *      - ShapleyDistributor.upgradeToAndCall(impl) where impl.axiomVersion()
 *        differs from the current axiom hash
 *      - Direct writes to fairness-floor parameters outside Constitutional bounds
 *      - Mutations of the v(N) total-pool conservation invariant
 *
 *      Implementations MUST be deterministic and free of external state reads
 *      that could be manipulated within the timelock window. View-only by design.
 */
interface IGovernanceProposalVerifier {
    /**
     * @notice Verify that a proposal preserves Shapley fairness invariants.
     * @param target The contract the proposal will call when executed
     * @param value Native token value sent with the call
     * @param data Calldata for the call
     * @return fair True iff the proposal preserves the axiom set
     * @return reason Human-readable reason when !fair (empty string when fair)
     */
    function verifyProposal(
        address target,
        uint256 value,
        bytes calldata data
    ) external view returns (bool fair, string memory reason);

    /**
     * @notice Identifier for the current axiom set. Used by downstream upgrade
     *         gates (e.g., ShapleyDistributor._authorizeUpgrade) to refuse
     *         implementation swaps that don't preserve the same axioms.
     * @return The keccak256 hash that uniquely identifies the axiom set
     */
    function axiomVersion() external view returns (bytes32);
}
