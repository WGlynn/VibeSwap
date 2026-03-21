// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts-upgradeable/access/OwnableUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/proxy/utils/UUPSUpgradeable.sol";
import "./VerifiedCompute.sol";

/**
 * @title VerifierCheckpointBridge — Settlement Meets State
 * @author Faraday1 & JARVIS — vibeswap.org
 * @notice Bridges finalized verifier results into the VibeStateChain as
 *         consensus checkpoints. When a ShapleyVerifier, TrustScoreVerifier,
 *         or VoteVerifier result is finalized, anyone can push that result
 *         into the state chain — creating an immutable record.
 *
 * @dev This contract is permissionless by design (Grade A DISSOLVED).
 *      It only bridges ALREADY FINALIZED results (verifiers enforce the
 *      dispute window). The bridge cannot create false checkpoints because
 *      it reads directly from the verifier's finalized state.
 *
 *      The math persists longer than the chain itself.
 */
/// @notice Minimal interface for VibeStateChain checkpointing
interface IVibeStateChain {
    function checkpoint(bytes32 source, bytes32 decisionHash, uint256 roundId) external;
}

contract VerifierCheckpointBridge is OwnableUpgradeable, UUPSUpgradeable {
    // ============ Types ============

    /// @notice Source identifiers for each verifier type
    bytes32 public constant SOURCE_SHAPLEY = keccak256("ShapleyVerifier");
    bytes32 public constant SOURCE_TRUST = keccak256("TrustScoreVerifier");
    bytes32 public constant SOURCE_VOTE = keccak256("VoteVerifier");
    bytes32 public constant SOURCE_BATCH_PRICE = keccak256("BatchPriceVerifier");

    // ============ Errors ============

    error VerifierNotRegistered(address verifier);
    error ResultNotFinalized(bytes32 computeId);
    error AlreadyCheckpointed(bytes32 computeId);
    error StateChainNotSet();

    // ============ Events ============

    event VerifierRegistered(address indexed verifier, bytes32 indexed source);
    event ResultCheckpointed(bytes32 indexed computeId, bytes32 indexed source, bytes32 resultHash);

    // ============ State ============

    IVibeStateChain public stateChain;

    /// @notice verifier address => source identifier
    mapping(address => bytes32) public verifierSource;

    /// @notice computeId => already checkpointed
    mapping(bytes32 => bool) public checkpointed;

    /// @notice Total results checkpointed
    uint256 public totalCheckpointed;

    // ============ Init ============

    /// @custom:oz-upgrades-unsafe-allow constructor
    constructor() { _disableInitializers(); }

    function initialize(address _stateChain) external initializer {
        __Ownable_init(msg.sender);
        __UUPSUpgradeable_init();
        stateChain = IVibeStateChain(_stateChain);
    }

    // ============ Registration (Owner — Target Grade B) ============

    function registerVerifier(address verifier, bytes32 source) external onlyOwner {
        verifierSource[verifier] = source;
        emit VerifierRegistered(verifier, source);
    }

    function setStateChain(address _stateChain) external onlyOwner {
        stateChain = IVibeStateChain(_stateChain);
    }

    // ============ Checkpointing (PERMISSIONLESS — Grade A DISSOLVED) ============

    /**
     * @notice Push a finalized verifier result into the VibeStateChain
     * @dev Anyone can call this. The verifier's dispute window has already
     *      elapsed, so the result is canonical. This function just reads
     *      the finalized state and records it as a consensus checkpoint.
     *
     * @param verifier Address of the verifier contract
     * @param computeId The compute/game/epoch/proposal ID
     */
    function checkpointResult(address verifier, bytes32 computeId) external {
        if (address(stateChain) == address(0)) revert StateChainNotSet();

        bytes32 source = verifierSource[verifier];
        if (source == bytes32(0)) revert VerifierNotRegistered(verifier);
        if (checkpointed[computeId]) revert AlreadyCheckpointed(computeId);

        // Read the finalized result from the verifier
        VerifiedCompute vc = VerifiedCompute(payable(verifier));
        VerifiedCompute.ComputeResult memory result = vc.getResult(computeId);

        // Must be finalized (dispute window elapsed, no successful dispute)
        if (result.status != VerifiedCompute.ResultStatus.Finalized) {
            revert ResultNotFinalized(computeId);
        }

        // Mark as checkpointed (idempotent — can't double-record)
        checkpointed[computeId] = true;
        totalCheckpointed++;

        // Push into the state chain
        stateChain.checkpoint(source, result.resultHash, totalCheckpointed);

        emit ResultCheckpointed(computeId, source, result.resultHash);
    }

    /**
     * @notice Batch checkpoint multiple results in one tx
     * @dev Gas-efficient for catching up on multiple finalized results
     */
    function checkpointBatch(
        address[] calldata verifiers,
        bytes32[] calldata computeIds
    ) external {
        require(verifiers.length == computeIds.length, "Length mismatch");
        if (address(stateChain) == address(0)) revert StateChainNotSet();

        for (uint256 i = 0; i < verifiers.length; i++) {
            bytes32 source = verifierSource[verifiers[i]];
            if (source == bytes32(0)) continue; // Skip unregistered

            if (checkpointed[computeIds[i]]) continue; // Skip already done

            VerifiedCompute vc = VerifiedCompute(payable(verifiers[i]));
            VerifiedCompute.ComputeResult memory result = vc.getResult(computeIds[i]);

            if (result.status != VerifiedCompute.ResultStatus.Finalized) continue;

            checkpointed[computeIds[i]] = true;
            totalCheckpointed++;

            stateChain.checkpoint(source, result.resultHash, totalCheckpointed);
            emit ResultCheckpointed(computeIds[i], source, result.resultHash);
        }
    }

    // ============ View ============

    function isCheckpointed(bytes32 computeId) external view returns (bool) {
        return checkpointed[computeId];
    }

    // ============ UUPS ============

    function _authorizeUpgrade(address newImplementation) internal override onlyOwner {
        require(newImplementation.code.length > 0, "Not a contract");
    }
}
