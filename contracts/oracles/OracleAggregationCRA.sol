// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts-upgradeable/access/OwnableUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/proxy/utils/UUPSUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/utils/ReentrancyGuardUpgradeable.sol";
import "./interfaces/IOracleAggregationCRA.sol";
import "./interfaces/IIssuerReputationRegistry.sol";

/// @dev Minimal view surface of IssuerReputationRegistry used by OracleAggregationCRA.
///      `signerToIssuer` is a public mapping (auto-getter) not declared in
///      IIssuerReputationRegistry; this interface augments the call surface without
///      touching the registry contract itself.
interface IIssuerRegistryView is IIssuerReputationRegistry {
    function signerToIssuer(address signer) external view returns (bytes32);
}

/**
 * @title OracleAggregationCRA
 * @notice Commit-reveal batch aggregator for price oracles.
 *         See {IOracleAggregationCRA} for the public interface contract.
 *
 *         FAT-AUDIT-2 / ETM Alignment Gap 2 implementation. Replaces TPO's
 *         policy-level 5% deviation gate with structural commit-reveal
 *         opacity over a batch of registered issuers.
 *
 *         Skeleton — admin + state + phase timing only. commit/reveal/settle
 *         logic ships in subsequent commits per commit-cadence-restore feedback.
 *
 * @dev    UUPS-upgradeable. Storage layout: 50-slot __gap reserved.
 */
contract OracleAggregationCRA is
    IOracleAggregationCRA,
    OwnableUpgradeable,
    UUPSUpgradeable,
    ReentrancyGuardUpgradeable
{
    // ============ Constants ============

    /// @notice Commit phase length. Paper §6.1 — temporal augmentation window.
    uint256 public constant COMMIT_PHASE_DURATION = 30 seconds;

    /// @notice Reveal phase length. Mirrors SOR challenge response window.
    uint256 public constant REVEAL_PHASE_DURATION = 10 seconds;

    /// @notice Minimum number of reveals to compute a valid median.
    uint256 public constant MIN_REVEALS_FOR_SETTLEMENT = 3;

    /// @notice Slash applied to issuers who commit but fail to reveal.
    /// @dev Paper §5.3 CRBA SLASH_RATE = 50%, §6.5 Compensatory Augmentation.
    uint256 public constant NON_REVEAL_SLASH_BPS = 5000;

    // ============ State ============

    /// @notice Batches indexed by batchId. Slot per cycle.
    mapping(uint256 => BatchData) internal _batches;

    /// @notice Current open batchId.
    uint256 public currentBatchId;

    /// @notice IssuerReputationRegistry address — source of issuer stake + reputation.
    address public issuerRegistry;

    /// @notice TruePriceOracle address — settlement publishes here.
    address public truePriceOracle;

    /// @notice Per-batch / per-issuer commit hash. 0 = no commit.
    mapping(uint256 => mapping(address => bytes32)) internal _commits;

    /// @notice Per-batch / per-issuer revealed price (after reveal). 0 = no reveal.
    mapping(uint256 => mapping(address => uint256)) internal _reveals;

    /// @notice Per-batch list of revealed prices for median computation.
    mapping(uint256 => uint256[]) internal _revealedPrices;

    /// @notice Per-batch list of committers (for non-reveal slash enumeration).
    mapping(uint256 => address[]) internal _committers;

    /// @notice Slash pool from non-revealers. Sweepable to treasury.
    uint256 public slashPool;

    // ============ Internal Structs ============

    struct BatchData {
        uint256 commitDeadline;
        uint256 revealDeadline;
        BatchPhase phase;
        uint256 medianPrice;
    }

    // ============ Storage Gap ============

    /// @dev Reserved storage gap for future upgrades.
    uint256[50] private __gap;

    // ============ Init ============

    /// @custom:oz-upgrades-unsafe-allow constructor
    constructor() {
        _disableInitializers();
    }

    function initialize(address _issuerRegistry, address _truePriceOracle) external initializer {
        __Ownable_init(msg.sender);
        __UUPSUpgradeable_init();
        __ReentrancyGuard_init();
        require(_issuerRegistry != address(0), "Invalid registry");
        require(_truePriceOracle != address(0), "Invalid TPO");
        issuerRegistry = _issuerRegistry;
        truePriceOracle = _truePriceOracle;
        // First batch starts immediately
        _openNewBatch();
    }

    function _authorizeUpgrade(address newImplementation) internal override onlyOwner {
        require(newImplementation.code.length > 0, "Not a contract");
    }

    // ============ Phase Transition ============

    function _openNewBatch() internal returns (uint256 batchId) {
        currentBatchId += 1;
        batchId = currentBatchId;
        _batches[batchId] = BatchData({
            commitDeadline: block.timestamp + COMMIT_PHASE_DURATION,
            revealDeadline: block.timestamp + COMMIT_PHASE_DURATION + REVEAL_PHASE_DURATION,
            phase: BatchPhase.COMMIT,
            medianPrice: 0
        });
    }

    // ============ Stub: commit/reveal/settle/slash ============
    // Implementations land in subsequent commits per cadence-restore rule.

    function commitPrice(bytes32 commitHash) external nonReentrant {
        require(commitHash != bytes32(0), "Zero hash");
        require(_isAuthorizedIssuer(msg.sender), "Not registered issuer");

        // Auto-advance: if current batch's commit window elapsed, open a new batch.
        BatchData storage current = _batches[currentBatchId];
        if (block.timestamp > current.commitDeadline) {
            _openNewBatch();
            current = _batches[currentBatchId];
        }
        require(current.phase == BatchPhase.COMMIT, "Not in commit phase");
        require(_commits[currentBatchId][msg.sender] == bytes32(0), "Already committed");

        _commits[currentBatchId][msg.sender] = commitHash;
        _committers[currentBatchId].push(msg.sender);

        emit PriceCommitted(currentBatchId, msg.sender, commitHash);
    }

    /// @dev Issuer authorization gate. When `issuerRegistry` is set, verifies that
    ///      `issuer` is an ACTIVE, non-slashed issuer with reputation >= minReputation
    ///      via IssuerReputationRegistry.verifyIssuer. Pre-wiring (issuerRegistry == 0)
    ///      remains permissive for test environments and staged deployments.
    function _isAuthorizedIssuer(address issuer) internal view returns (bool) {
        if (issuerRegistry == address(0)) {
            // Pre-wiring: no registry set — permissive (test / pre-init environments).
            return true;
        }
        IIssuerRegistryView reg = IIssuerRegistryView(issuerRegistry);
        bytes32 issuerKey = reg.signerToIssuer(issuer);
        if (issuerKey == bytes32(0)) return false;
        return reg.verifyIssuer(issuerKey, issuer);
    }

    function revealPrice(uint256 batchId, uint256 price, bytes32 nonce) external nonReentrant {
        require(price > 0, "Zero price");
        BatchData storage b = _batches[batchId];
        require(b.commitDeadline != 0, "Unknown batch");
        require(block.timestamp > b.commitDeadline, "Still in commit phase");
        require(block.timestamp <= b.revealDeadline, "Reveal phase ended");

        // Auto-advance: COMMIT -> REVEAL on first reveal that lands in window.
        if (b.phase == BatchPhase.COMMIT) {
            b.phase = BatchPhase.REVEAL;
        }
        require(b.phase == BatchPhase.REVEAL, "Not in reveal phase");

        bytes32 expected = _commits[batchId][msg.sender];
        require(expected != bytes32(0), "No commit found");
        require(_reveals[batchId][msg.sender] == 0, "Already revealed");

        bytes32 actual = keccak256(abi.encodePacked(price, nonce));
        require(actual == expected, "Hash mismatch");

        _reveals[batchId][msg.sender] = price;
        _revealedPrices[batchId].push(price);

        emit PriceRevealed(batchId, msg.sender, price);
    }

    function settleBatch(uint256 batchId) external nonReentrant returns (uint256 medianPrice) {
        BatchData storage b = _batches[batchId];
        require(b.commitDeadline != 0, "Unknown batch");
        require(block.timestamp > b.revealDeadline, "Reveal not yet ended");
        require(b.phase != BatchPhase.SETTLED, "Already settled");

        uint256 n = _revealedPrices[batchId].length;
        require(n >= MIN_REVEALS_FOR_SETTLEMENT, "Insufficient reveals");

        // Copy to memory and sort (insertion sort — N is small, typically <20)
        uint256[] memory prices = new uint256[](n);
        for (uint256 i = 0; i < n; i++) {
            prices[i] = _revealedPrices[batchId][i];
        }
        for (uint256 i = 1; i < n; i++) {
            uint256 key = prices[i];
            uint256 j = i;
            while (j > 0 && prices[j - 1] > key) {
                prices[j] = prices[j - 1];
                j--;
            }
            prices[j] = key;
        }

        // Median: middle for odd N, average of two middles for even N
        if (n % 2 == 1) {
            medianPrice = prices[n / 2];
        } else {
            medianPrice = (prices[n / 2 - 1] + prices[n / 2]) / 2;
        }

        b.medianPrice = medianPrice;
        b.phase = BatchPhase.SETTLED;

        emit BatchSettled(batchId, medianPrice, n);
    }

    function slashNonRevealer(uint256 batchId, address issuer) external nonReentrant {
        BatchData storage b = _batches[batchId];
        require(b.commitDeadline != 0, "Unknown batch");
        require(block.timestamp > b.revealDeadline, "Reveal not yet ended");
        require(_commits[batchId][issuer] != bytes32(0), "Issuer did not commit");
        require(_reveals[batchId][issuer] == 0, "Issuer revealed - not slashable");

        // V1: clear commit (prevents double-slash), record violation, emit.
        // V1.5 will route to IssuerReputationRegistry.slash(issuer, NON_REVEAL_SLASH_BPS)
        // for real stake reduction. Slash-pool accounting reserved.
        _commits[batchId][issuer] = bytes32(0);

        emit IssuerSlashed(batchId, issuer, 0, "non-reveal");
    }

    // ============ Views ============

    function getBatch(uint256 batchId) external view returns (BatchInfo memory) {
        BatchData storage b = _batches[batchId];
        return BatchInfo({
            batchId: batchId,
            commitDeadline: b.commitDeadline,
            revealDeadline: b.revealDeadline,
            phase: b.phase,
            commitCount: _committers[batchId].length,
            revealCount: _revealedPrices[batchId].length,
            medianPrice: b.medianPrice
        });
    }

    function getCurrentBatchId() external view returns (uint256) {
        return currentBatchId;
    }

    // ============ Admin ============

    event IssuerRegistryUpdated(address indexed previous, address indexed current);
    event TruePriceOracleUpdated(address indexed previous, address indexed current);
    event SlashPoolSwept(address indexed treasury, uint256 amount);

    function setIssuerRegistry(address _registry) external onlyOwner {
        require(_registry != address(0), "Invalid registry");
        address prev = issuerRegistry;
        issuerRegistry = _registry;
        emit IssuerRegistryUpdated(prev, _registry);
    }

    function setTruePriceOracle(address _tpo) external onlyOwner {
        require(_tpo != address(0), "Invalid TPO");
        address prev = truePriceOracle;
        truePriceOracle = _tpo;
        emit TruePriceOracleUpdated(prev, _tpo);
    }

    function sweepSlashPoolToTreasury(address treasury) external onlyOwner nonReentrant {
        require(treasury != address(0), "Zero treasury");
        uint256 amount = slashPool;
        if (amount == 0) return;
        slashPool = 0;
        (bool ok, ) = treasury.call{value: amount}("");
        require(ok, "Sweep failed");
        emit SlashPoolSwept(treasury, amount);
    }
}
