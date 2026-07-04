// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {IProofOfMindReputation} from "./interfaces/IProofOfMindReputation.sol";
import {IPoMExportHub} from "./interfaces/IPoMExportHub.sol";

/**
 * @title PoMReputationOracle — the Proof-of-Mind reputation read surface for other protocols
 * @notice A thin, trust-minimized consumer of the PoM export hub. Any protocol imports
 *         IProofOfMindReputation and reads a contributor's earned, math-derived standing to gate or
 *         weight by MIND instead of money — governance weight, allowlists, sybil-resistant airdrops,
 *         under-collateralized credit, whatever needs "who actually contributed" rather than "who
 *         holds the most tokens."
 *
 *         Design:
 *           - `hub` is immutable (no admin key, no upgrade surface). If the hub is redeployed, deploy
 *             a fresh oracle. The oracle adds no trust beyond the hub it points at.
 *           - `recordReputation` is permissionless and verifies the proof against the hub's LIVE
 *             standing, so the cache can only ever hold a value the finalized standing commits.
 *           - Reads (`reputationOf`, `hasReputationAtLeast`) are a verified lower bound as of the
 *             recorded nonce; gating on them is fail-safe (never over-grants). `verifyLive` gives an
 *             as-of-now check with a caller-supplied proof.
 *
 *         Example consumer (governance weight):
 *           require(oracle.hasReputationAtLeast(contributorId, MIN_MIND), "insufficient PoM standing");
 */
contract PoMReputationOracle is IProofOfMindReputation {
    IPoMExportHub public immutable exportHub;

    mapping(bytes32 => Reputation) internal _rep;

    constructor(address hub_) {
        require(hub_ != address(0), "hub=0");
        exportHub = IPoMExportHub(hub_);
    }

    /// @inheritdoc IProofOfMindReputation
    function recordReputation(bytes32 contributor, uint256 value, bytes32[] calldata proof) external {
        // Read the standing once and verify against it. finalize() cannot interleave within this
        // tx, so the nonce stamped here is exactly the standing the proof is checked against.
        IPoMExportHub.PomStanding memory s = exportHub.currentStanding();
        if (!exportHub.verifyContributionScore(contributor, value, proof)) revert InvalidReputationProof();

        // Cumulative PoM value is monotone non-decreasing across finalized standings (v1 pins the
        // reduction params), and a proof can only ever be produced against the current standing, so
        // this write only ever advances (or re-affirms) the recorded value; no stale-guard needed.
        _rep[contributor] = Reputation({value: value, asOfNonce: s.nonce});
        emit ReputationRecorded(contributor, value, s.nonce);
    }

    /// @inheritdoc IProofOfMindReputation
    function reputationOf(bytes32 contributor) external view returns (uint256 value, uint256 asOfNonce) {
        Reputation storage r = _rep[contributor];
        return (r.value, r.asOfNonce);
    }

    /// @inheritdoc IProofOfMindReputation
    function hasReputationAtLeast(bytes32 contributor, uint256 threshold) external view returns (bool) {
        return _rep[contributor].value >= threshold;
    }

    /// @inheritdoc IProofOfMindReputation
    function verifyLive(bytes32 contributor, uint256 value, bytes32[] calldata proof)
        external
        view
        returns (bool)
    {
        return exportHub.verifyContributionScore(contributor, value, proof);
    }

    /// @inheritdoc IProofOfMindReputation
    function hub() external view returns (address) {
        return address(exportHub);
    }
}
