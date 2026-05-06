// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts-upgradeable/access/OwnableUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/proxy/utils/UUPSUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/utils/ReentrancyGuardUpgradeable.sol";
import "@openzeppelin/contracts/utils/cryptography/MerkleProof.sol";

/**
 * @title VerifiedCompute — Compute Off-Chain, Verify On-Chain
 * @author Faraday1 & JARVIS — vibeswap.org
 * @notice Abstract base for execution/settlement separation. Heavy computation
 *         happens off-chain; only results + Merkle proofs land here.
 *         Verification is always cheaper than computation.
 *
 * @dev Trust model: submitters are bonded (stake to submit, slashed if wrong).
 *      Results sit in a dispute window before finalization. Anyone can dispute
 *      during the window. After the window: result is canonical.
 *      P-000: Fairness Above All.
 */
abstract contract VerifiedCompute is
    OwnableUpgradeable,
    UUPSUpgradeable,
    ReentrancyGuardUpgradeable
{
    // ============ Types ============

    enum ResultStatus { None, Pending, Finalized, Disputed }

    struct ComputeResult {
        bytes32 resultHash;
        address submitter;
        uint256 timestamp;
        ResultStatus status;
    }

    // ============ Errors ============

    error NotBondedSubmitter();
    error InsufficientBond();
    error ResultAlreadyExists();
    error ResultNotPending();
    error DisputeWindowActive();
    error DisputeWindowExpired();
    error InvalidMerkleProof();
    error ResultNotFinalized();
    error ZeroAmount();

    // ============ Events ============

    event ResultSubmitted(bytes32 indexed computeId, bytes32 resultHash, address indexed submitter);
    event ResultFinalized(bytes32 indexed computeId, bytes32 resultHash);
    event ResultDisputed(bytes32 indexed computeId, address indexed disputer, address indexed submitter);
    event SubmitterSlashed(address indexed submitter, uint256 amount, address indexed disputer);
    event SubmitterBonded(address indexed submitter, uint256 amount);
    event SubmitterUnbonded(address indexed submitter, uint256 amount);
    event DisputeWindowUpdated(uint256 oldWindow, uint256 newWindow);
    event BondAmountUpdated(uint256 oldAmount, uint256 newAmount);

    // ============ State ============

    mapping(bytes32 => ComputeResult) public results;
    mapping(address => uint256) public bonds;
    mapping(address => bool) public submitters;
    uint256 public disputeWindow;
    uint256 public bondAmount;

    // ============ Constants ============

    uint256 public constant SLASH_RATE = 5000;   // 50% slash on invalid result
    uint256 public constant BASIS_POINTS = 10000;

    /// @dev Reserved storage gap for future upgrades
    uint256[50] private __gap;

    // ============ Constructor ============

    /// @custom:oz-upgrades-unsafe-allow constructor
    constructor() {
        _disableInitializers();
    }

    // ============ Init ============

    function __VerifiedCompute_init(uint256 _disputeWindow, uint256 _bondAmount) internal onlyInitializing {
        __Ownable_init(msg.sender);
        __UUPSUpgradeable_init();
        __ReentrancyGuard_init();
        disputeWindow = _disputeWindow > 0 ? _disputeWindow : 1 hours;
        bondAmount = _bondAmount;
    }

    function _authorizeUpgrade(address newImplementation) internal override onlyOwner {
        require(newImplementation.code.length > 0, "Not a contract");
    }

    // ============ Submitter Management ============

    function bond() external payable {
        if (msg.value < bondAmount) revert InsufficientBond();
        bonds[msg.sender] += msg.value;
        submitters[msg.sender] = true;
        emit SubmitterBonded(msg.sender, msg.value);
    }

    function unbond(uint256 amount) external nonReentrant {
        if (!submitters[msg.sender]) revert NotBondedSubmitter();
        if (amount == 0) revert ZeroAmount();
        if (bonds[msg.sender] < amount) revert InsufficientBond();
        bonds[msg.sender] -= amount;
        if (bonds[msg.sender] < bondAmount) submitters[msg.sender] = false;
        (bool ok, ) = msg.sender.call{value: amount}("");
        require(ok, "Transfer failed");
        emit SubmitterUnbonded(msg.sender, amount);
    }

    // ============ Result Submission ============

    function submitResult(bytes32 computeId, bytes32 resultHash, bytes32[] calldata merkleProof) external {
        if (!submitters[msg.sender]) revert NotBondedSubmitter();
        if (results[computeId].status != ResultStatus.None) revert ResultAlreadyExists();
        bytes32 expectedRoot = _getExpectedRoot(computeId);
        if (!_verifyMerkleProof(resultHash, merkleProof, expectedRoot)) revert InvalidMerkleProof();
        results[computeId] = ComputeResult({
            resultHash: resultHash, submitter: msg.sender,
            timestamp: block.timestamp, status: ResultStatus.Pending
        });
        emit ResultSubmitted(computeId, resultHash, msg.sender);
    }

    function finalizeResult(bytes32 computeId) external {
        ComputeResult storage r = results[computeId];
        if (r.status != ResultStatus.Pending) revert ResultNotPending();
        if (block.timestamp < r.timestamp + disputeWindow) revert DisputeWindowActive();
        r.status = ResultStatus.Finalized;
        emit ResultFinalized(computeId, r.resultHash);
    }

    /// @dev Subclasses override _validateDispute() to define what "wrong" means
    function disputeResult(
        bytes32 computeId,
        bytes calldata disputeEvidence
    ) external nonReentrant {
        ComputeResult storage r = results[computeId];
        if (r.status != ResultStatus.Pending) revert ResultNotPending();
        if (block.timestamp >= r.timestamp + disputeWindow) revert DisputeWindowExpired();

        require(_validateDispute(computeId, disputeEvidence), "Invalid dispute");
        address slashedSubmitter = r.submitter;
        uint256 slashAmount = (bonds[slashedSubmitter] * SLASH_RATE) / BASIS_POINTS;
        bonds[slashedSubmitter] -= slashAmount;
        if (bonds[slashedSubmitter] < bondAmount) submitters[slashedSubmitter] = false;
        r.status = ResultStatus.Disputed;
        (bool ok, ) = msg.sender.call{value: slashAmount}("");
        require(ok, "Slash reward failed");

        emit ResultDisputed(computeId, msg.sender, slashedSubmitter);
        emit SubmitterSlashed(slashedSubmitter, slashAmount, msg.sender);
    }

    // ============ Admin ============

    function setDisputeWindow(uint256 _seconds) external onlyOwner {
        emit DisputeWindowUpdated(disputeWindow, _seconds);
        disputeWindow = _seconds;
    }

    function setBondAmount(uint256 _amount) external onlyOwner {
        emit BondAmountUpdated(bondAmount, _amount);
        bondAmount = _amount;
    }

    // ============ Internal ============

    function _verifyMerkleProof(
        bytes32 leaf, bytes32[] calldata proof, bytes32 root
    ) internal pure returns (bool) {
        return MerkleProof.verifyCalldata(proof, root, leaf);
    }

    /// @dev Subclasses return the expected Merkle root for a given compute ID
    function _getExpectedRoot(bytes32 computeId) internal view virtual returns (bytes32);

    /// @dev Subclasses validate dispute evidence. Return true if dispute is valid.
    function _validateDispute(bytes32 computeId, bytes calldata evidence) internal virtual returns (bool);

    // ============ View ============

    function getResult(bytes32 computeId) external view returns (ComputeResult memory) {
        return results[computeId];
    }

    function isFinalized(bytes32 computeId) external view returns (bool) {
        return results[computeId].status == ResultStatus.Finalized;
    }

    function isPending(bytes32 computeId) external view returns (bool) {
        return results[computeId].status == ResultStatus.Pending;
    }

    receive() external payable {}
}
