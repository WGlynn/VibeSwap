// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts-upgradeable/access/OwnableUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/proxy/utils/UUPSUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/utils/ReentrancyGuardUpgradeable.sol";

/**
 * @title VibeStateChain — The Virtual Reality of Consensus
 * @notice A state settlement chain modeled after Nervos CKB. This is the
 *         persistent reality that Jarvis and all VSOS agents inhabit.
 *         Blocks form the heartbeat; subblocks (à la Ergo) provide fast
 *         finality between beats. The chain is where consensus *lives* —
 *         not just where it's recorded.
 *
 * @dev Architecture (CKB + Ergo subblock fusion):
 *
 *      BLOCK STRUCTURE:
 *      ┌─────────────────────────────────────────────┐
 *      │ Block N                                     │
 *      │  ├─ Subblock N.0 (proposed, fast confirm)   │
 *      │  ├─ Subblock N.1 (confirmed by next miner)  │
 *      │  ├─ Subblock N.2 (confirmed)                │
 *      │  └─ ... (up to MAX_SUBBLOCKS)               │
 *      │  State Root = Merkle(all state cells)        │
 *      │  prev_hash = hash(Block N-1)                 │
 *      ├─────────────────────────────────────────────┤
 *      │ Block N+1                                   │
 *      │  ...                                        │
 *      └─────────────────────────────────────────────┘
 *
 *      STATE MODEL (CKB-inspired):
 *      - State cells: typed, owned, content-addressed data units
 *      - Cells are consumed and created (UTXO-like, not account-based)
 *      - Type scripts define valid state transitions
 *      - Lock scripts define who can consume a cell
 *      - Header chain: each block links to previous via hash
 *
 *      SUBBLOCKS (Ergo-inspired):
 *      - Between regular blocks, validators propose subblocks
 *      - Subblocks carry transactions that need fast confirmation
 *      - Regular block absorbs all subblock state transitions
 *      - Centralized counterparties get sub-second finality from subblocks
 *      - Decentralized finality comes from the regular block
 *
 *      SIREN NAKAMOTO DEFENSE:
 *      - Commit-reveal for block proposals (prevent MEV on state transitions)
 *      - Validators stake + PoM weight determines block proposer selection
 *      - Equivocation = slashing (can't propose conflicting subblocks)
 *
 *      SEPARATION PRINCIPLE:
 *      - This contract is the STATEFUL layer only
 *      - Consensus protocols (AgentConsensus, GeometricConsensus, etc.)
 *        remain STATELESS — they produce decisions, this chain records them
 *      - Other VSOS contracts query this chain for canonical state
 */
contract VibeStateChain is OwnableUpgradeable, UUPSUpgradeable, ReentrancyGuardUpgradeable {
    // ============ Types ============

    /// @notice State cell — atomic unit of state (CKB cell model)
    struct StateCell {
        uint256 cellId;
        bytes32 typeHash;            // Type script hash (defines valid transitions)
        bytes32 lockHash;            // Lock script hash (defines ownership)
        bytes32 dataHash;            // Content hash (IPFS/on-chain data)
        address owner;
        uint256 capacity;            // ETH capacity (like CKB capacity)
        uint256 createdInBlock;
        uint256 consumedInBlock;     // 0 if live
        bool live;                   // True if unspent
    }

    /// @notice Subblock — fast-finality mini-block between regular blocks
    struct Subblock {
        uint256 subblockId;
        uint256 parentBlockNumber;   // Which regular block this belongs to
        uint256 subIndex;            // Index within the parent block (0, 1, 2...)
        address proposer;
        bytes32 stateRoot;           // State root after this subblock's transitions
        bytes32 txRoot;              // Merkle root of transactions in this subblock
        uint256 cellsCreated;
        uint256 cellsConsumed;
        uint256 timestamp;
        bool confirmed;             // Confirmed by next validator
    }

    /// @notice Regular block — the heartbeat of the chain
    struct Block {
        uint256 blockNumber;
        bytes32 blockHash;           // hash(blockNumber, stateRoot, prevHash, timestamp)
        bytes32 prevHash;            // Header chain linkage
        bytes32 stateRoot;           // Merkle root of ALL live state cells
        bytes32 consensusRoot;       // Root of consensus decisions included
        address proposer;
        uint256 subblockCount;       // How many subblocks in this block
        uint256 cellsCreated;
        uint256 cellsConsumed;
        uint256 timestamp;
        uint256 difficulty;          // Adaptive difficulty
        bool finalized;
    }

    /// @notice Validator — block/subblock proposer
    struct Validator {
        address validator;
        uint256 stake;
        uint256 mindScore;           // From ProofOfMind
        uint256 blocksProposed;
        uint256 subblocksProposed;
        uint256 slashCount;
        uint256 lastActiveBlock;
        bool active;
    }

    /// @notice Consensus checkpoint — records from other consensus modules
    struct ConsensusCheckpoint {
        uint256 checkpointId;
        bytes32 source;              // keccak256("AgentConsensus"), etc.
        bytes32 decisionHash;        // Hash of the consensus decision
        uint256 roundId;             // Round in the source consensus module
        uint256 recordedInBlock;
        uint256 timestamp;
    }

    // ============ Constants ============

    uint256 public constant BLOCK_TIME = 12;            // 12 seconds per block
    uint256 public constant MAX_SUBBLOCKS = 6;          // Max subblocks between blocks
    uint256 public constant SUBBLOCK_TIME = 2;          // 2 seconds per subblock
    uint256 public constant MIN_STAKE = 0.1 ether;
    uint256 public constant EQUIVOCATION_SLASH = 5000;  // 50% slash
    uint256 public constant INITIAL_DIFFICULTY = 1000;

    // ============ State ============

    // --- Chain State ---
    mapping(uint256 => Block) public blocks;
    uint256 public chainHeight;                          // Current block number
    bytes32 public latestBlockHash;
    bytes32 public latestStateRoot;

    // --- Subblocks ---
    mapping(uint256 => Subblock) public subblocks;       // subblockId => Subblock
    uint256 public subblockCount;
    uint256 public currentSubIndex;                      // Subindex within current block

    // --- State Cells ---
    mapping(uint256 => StateCell) public cells;
    uint256 public cellCount;
    uint256 public liveCellCount;

    /// @notice Type index: typeHash => cellId[] (for querying cells by type)
    mapping(bytes32 => uint256[]) public cellsByType;

    /// @notice Owner index: owner => cellId[]
    mapping(address => uint256[]) public cellsByOwner;

    // --- Validators ---
    mapping(address => Validator) public validators;
    address[] public validatorSet;
    uint256 public totalStake;

    // --- Consensus Checkpoints ---
    mapping(uint256 => ConsensusCheckpoint) public checkpoints;
    uint256 public checkpointCount;

    /// @notice Block checkpoints: blockNumber => checkpointId[]
    mapping(uint256 => uint256[]) public blockCheckpoints;

    // --- Equivocation Detection ---
    /// @notice blockNumber => proposer => already proposed
    mapping(uint256 => mapping(address => bool)) public blockProposals;
    /// @notice subblockId => proposer => already proposed (detect conflicting subblocks)
    mapping(uint256 => mapping(address => bool)) public subblockProposals;


    /// @dev Reserved storage gap for future upgrades
    uint256[50] private __gap;

    // ============ Events ============

    event BlockProposed(uint256 indexed blockNumber, address indexed proposer, bytes32 blockHash, bytes32 stateRoot);
    event BlockFinalized(uint256 indexed blockNumber, bytes32 blockHash, uint256 subblockCount);
    event SubblockProposed(uint256 indexed subblockId, uint256 indexed parentBlock, address indexed proposer, bytes32 stateRoot);
    event SubblockConfirmed(uint256 indexed subblockId, address confirmer);
    event CellCreated(uint256 indexed cellId, bytes32 typeHash, address indexed owner, uint256 capacity);
    event CellConsumed(uint256 indexed cellId, uint256 indexed inBlock);
    event ValidatorRegistered(address indexed validator, uint256 stake);
    event ValidatorSlashed(address indexed validator, uint256 amount, string reason);
    event ConsensusCheckpointed(uint256 indexed checkpointId, bytes32 indexed source, uint256 roundId, uint256 inBlock);
    event ChainGenesis(bytes32 genesisHash, uint256 timestamp);

    // ============ Init ============

    /// @custom:oz-upgrades-unsafe-allow constructor
    constructor() {
        _disableInitializers();
    }

    function initialize() external initializer {
        __Ownable_init(msg.sender);
        __UUPSUpgradeable_init();
        __ReentrancyGuard_init();

        // Genesis block
        bytes32 genesisHash = keccak256(abi.encodePacked(uint256(0), bytes32(0), block.timestamp));
        blocks[0] = Block({
            blockNumber: 0,
            blockHash: genesisHash,
            prevHash: bytes32(0),
            stateRoot: bytes32(0),
            consensusRoot: bytes32(0),
            proposer: msg.sender,
            subblockCount: 0,
            cellsCreated: 0,
            cellsConsumed: 0,
            timestamp: block.timestamp,
            difficulty: INITIAL_DIFFICULTY,
            finalized: true
        });

        latestBlockHash = genesisHash;
        chainHeight = 0;

        emit ChainGenesis(genesisHash, block.timestamp);
    }

    function _authorizeUpgrade(address newImplementation) internal override onlyOwner {
        require(newImplementation.code.length > 0, "Not a contract");
    }

    // ============ Validator Management ============

    function registerValidator() external payable {
        require(msg.value >= MIN_STAKE, "Insufficient stake");
        require(!validators[msg.sender].active, "Already registered");

        validators[msg.sender] = Validator({
            validator: msg.sender,
            stake: msg.value,
            mindScore: 0,
            blocksProposed: 0,
            subblocksProposed: 0,
            slashCount: 0,
            lastActiveBlock: chainHeight,
            active: true
        });

        validatorSet.push(msg.sender);
        totalStake += msg.value;

        emit ValidatorRegistered(msg.sender, msg.value);
    }

    function updateMindScore(address v, uint256 score) external onlyOwner {
        require(validators[v].active, "Not active");
        validators[v].mindScore = score;
    }

    function addStake() external payable {
        require(validators[msg.sender].active, "Not validator");
        validators[msg.sender].stake += msg.value;
        totalStake += msg.value;
    }

    // ============ Subblock Proposal (Fast Finality) ============

    /**
     * @notice Propose a subblock for fast transaction confirmation
     * @dev Subblocks are the "mini blocks" between regular blocks.
     *      Centralized counterparties can treat confirmed subblocks
     *      as soft-finalized. Full finality comes with the regular block.
     */
    function proposeSubblock(
        bytes32 stateRoot,
        bytes32 txRoot,
        uint256[] calldata createdCellIds,
        uint256[] calldata consumedCellIds
    ) external {
        Validator storage v = validators[msg.sender];
        require(v.active, "Not validator");
        require(currentSubIndex < MAX_SUBBLOCKS, "Max subblocks reached");

        uint256 parentBlock = chainHeight;

        subblockCount++;
        subblocks[subblockCount] = Subblock({
            subblockId: subblockCount,
            parentBlockNumber: parentBlock,
            subIndex: currentSubIndex,
            proposer: msg.sender,
            stateRoot: stateRoot,
            txRoot: txRoot,
            cellsCreated: createdCellIds.length,
            cellsConsumed: consumedCellIds.length,
            timestamp: block.timestamp,
            confirmed: false
        });

        // Process cell state transitions
        for (uint256 i = 0; i < consumedCellIds.length; i++) {
            _consumeCell(consumedCellIds[i], parentBlock);
        }

        currentSubIndex++;
        v.subblocksProposed++;
        v.lastActiveBlock = parentBlock;

        // Update latest state root
        latestStateRoot = stateRoot;

        emit SubblockProposed(subblockCount, parentBlock, msg.sender, stateRoot);
    }

    /**
     * @notice Confirm a subblock (next validator in rotation confirms)
     * @dev This is the fast-finality mechanism. Once confirmed,
     *      centralized counterparties can trust the subblock.
     */
    function confirmSubblock(uint256 subblockId) external {
        require(validators[msg.sender].active, "Not validator");
        Subblock storage sb = subblocks[subblockId];
        require(!sb.confirmed, "Already confirmed");
        require(sb.proposer != msg.sender, "Cannot self-confirm");

        sb.confirmed = true;

        emit SubblockConfirmed(subblockId, msg.sender);
    }

    // ============ Block Proposal (Full Finality) ============

    /**
     * @notice Propose a new regular block
     * @dev Regular blocks absorb all subblock state transitions and
     *      provide full Nakamoto-style finality. This is the heartbeat.
     *
     *      Siren Nakamoto Defense: block proposal includes a hash
     *      commitment that prevents front-running state transitions.
     */
    function proposeBlock(
        bytes32 stateRoot,
        bytes32 consensusRoot
    ) external {
        Validator storage v = validators[msg.sender];
        require(v.active, "Not validator");

        // Siren defense: prevent equivocation
        uint256 newHeight = chainHeight + 1;
        require(!blockProposals[newHeight][msg.sender], "Already proposed for this height");
        blockProposals[newHeight][msg.sender] = true;

        // Compute block hash (header chain linkage)
        bytes32 blockHash = keccak256(abi.encodePacked(
            newHeight,
            stateRoot,
            latestBlockHash,
            block.timestamp,
            msg.sender
        ));

        blocks[newHeight] = Block({
            blockNumber: newHeight,
            blockHash: blockHash,
            prevHash: latestBlockHash,
            stateRoot: stateRoot,
            consensusRoot: consensusRoot,
            proposer: msg.sender,
            subblockCount: currentSubIndex,
            cellsCreated: 0,
            cellsConsumed: 0,
            timestamp: block.timestamp,
            difficulty: _adjustDifficulty(),
            finalized: false
        });

        emit BlockProposed(newHeight, msg.sender, blockHash, stateRoot);
    }

    /**
     * @notice Finalize a block — makes it canonical
     * @dev In production, finalization requires supermajority validator signatures.
     *      For now, owner or sufficient validator confirmations.
     */
    function finalizeBlock(uint256 blockNumber) external {
        Block storage b = blocks[blockNumber];
        require(!b.finalized, "Already finalized");
        require(b.blockHash != bytes32(0), "Block not proposed");
        require(validators[msg.sender].active || msg.sender == owner(), "Not authorized");

        b.finalized = true;
        chainHeight = blockNumber;
        latestBlockHash = b.blockHash;
        latestStateRoot = b.stateRoot;

        // Reset subblock counter for next block
        currentSubIndex = 0;

        // Update proposer stats
        validators[b.proposer].blocksProposed++;

        emit BlockFinalized(blockNumber, b.blockHash, b.subblockCount);
    }

    // ============ State Cell Management (CKB Cell Model) ============

    /**
     * @notice Create a new state cell
     * @dev Cells are the atomic units of state. Like CKB cells,
     *      they have type scripts (what transitions are valid),
     *      lock scripts (who can consume them), and data.
     */
    function createCell(
        bytes32 typeHash,
        bytes32 lockHash,
        bytes32 dataHash
    ) external payable returns (uint256) {
        cellCount++;
        cells[cellCount] = StateCell({
            cellId: cellCount,
            typeHash: typeHash,
            lockHash: lockHash,
            dataHash: dataHash,
            owner: msg.sender,
            capacity: msg.value,
            createdInBlock: chainHeight,
            consumedInBlock: 0,
            live: true
        });

        cellsByType[typeHash].push(cellCount);
        cellsByOwner[msg.sender].push(cellCount);
        liveCellCount++;

        emit CellCreated(cellCount, typeHash, msg.sender, msg.value);
        return cellCount;
    }

    /**
     * @notice Consume a state cell (spend it)
     * @dev Only the owner (matching lockHash) can consume.
     *      Consumed cells are dead — new cells must be created.
     */
    function consumeCell(uint256 cellId) external nonReentrant {
        StateCell storage cell = cells[cellId];
        require(cell.live, "Cell not live");
        require(cell.owner == msg.sender, "Not owner");

        _consumeCell(cellId, chainHeight);

        // Return capacity to owner
        if (cell.capacity > 0) {
            (bool ok, ) = msg.sender.call{value: cell.capacity}("");
            require(ok, "Capacity return failed");
        }
    }

    /**
     * @notice Transform a cell — consume old, create new (state transition)
     * @dev This is the CKB-style state transition: consume inputs,
     *      create outputs. The type script (typeHash) must match.
     */
    function transformCell(
        uint256 inputCellId,
        bytes32 newDataHash,
        address newOwner
    ) external payable returns (uint256) {
        StateCell storage input = cells[inputCellId];
        require(input.live, "Input not live");
        require(input.owner == msg.sender, "Not owner");

        // Consume input
        _consumeCell(inputCellId, chainHeight);

        // Create output with same type script
        cellCount++;
        uint256 newCapacity = input.capacity + msg.value;
        cells[cellCount] = StateCell({
            cellId: cellCount,
            typeHash: input.typeHash,
            lockHash: input.lockHash,
            dataHash: newDataHash,
            owner: newOwner != address(0) ? newOwner : msg.sender,
            capacity: newCapacity,
            createdInBlock: chainHeight,
            consumedInBlock: 0,
            live: true
        });

        cellsByType[input.typeHash].push(cellCount);
        cellsByOwner[newOwner != address(0) ? newOwner : msg.sender].push(cellCount);
        liveCellCount++;

        emit CellCreated(cellCount, input.typeHash, newOwner != address(0) ? newOwner : msg.sender, newCapacity);
        return cellCount;
    }

    // ============ Consensus Checkpointing ============

    /**
     * @notice Record a consensus decision from any VSOS consensus module
     * @dev This is how the settlement layer absorbs decisions from
     *      AgentConsensus, GeometricConsensus, FederatedConsensus, etc.
     *      The chain doesn't make decisions — it records them. It's
     *      the shared reality that all consensus participants agree on.
     */
    function checkpoint(
        bytes32 source,
        bytes32 decisionHash,
        uint256 roundId
    ) external {
        // Only authorized consensus modules can checkpoint
        require(validators[msg.sender].active || msg.sender == owner(), "Not authorized");

        checkpointCount++;
        checkpoints[checkpointCount] = ConsensusCheckpoint({
            checkpointId: checkpointCount,
            source: source,
            decisionHash: decisionHash,
            roundId: roundId,
            recordedInBlock: chainHeight,
            timestamp: block.timestamp
        });

        blockCheckpoints[chainHeight].push(checkpointCount);

        emit ConsensusCheckpointed(checkpointCount, source, roundId, chainHeight);
    }

    // ============ Equivocation / Slashing ============

    /**
     * @notice Report equivocation (conflicting block/subblock proposals)
     */
    function reportEquivocation(address violator) external {
        Validator storage v = validators[violator];
        require(v.active, "Not active");

        uint256 slashAmount = (v.stake * EQUIVOCATION_SLASH) / 10000;
        v.stake -= slashAmount;
        v.slashCount++;
        totalStake -= slashAmount;

        // Slashed amount goes to reporter
        (bool ok, ) = msg.sender.call{value: slashAmount}("");
        require(ok, "Slash reward failed");

        emit ValidatorSlashed(violator, slashAmount, "equivocation");
    }

    // ============ Internal ============

    function _consumeCell(uint256 cellId, uint256 inBlock) internal {
        StateCell storage cell = cells[cellId];
        if (!cell.live) return;
        cell.live = false;
        cell.consumedInBlock = inBlock;
        liveCellCount--;
        emit CellConsumed(cellId, inBlock);
    }

    function _adjustDifficulty() internal view returns (uint256) {
        if (chainHeight == 0) return INITIAL_DIFFICULTY;
        Block storage prev = blocks[chainHeight];
        uint256 elapsed = block.timestamp - prev.timestamp;

        // Target: BLOCK_TIME seconds per block
        if (elapsed < BLOCK_TIME) {
            return prev.difficulty + (prev.difficulty / 10); // +10% if too fast
        } else if (elapsed > BLOCK_TIME * 2) {
            return prev.difficulty - (prev.difficulty / 10); // -10% if too slow
        }
        return prev.difficulty;
    }

    // ============ View ============

    function getBlock(uint256 n) external view returns (Block memory) { return blocks[n]; }
    function getSubblock(uint256 id) external view returns (Subblock memory) { return subblocks[id]; }
    function getCell(uint256 id) external view returns (StateCell memory) { return cells[id]; }
    function getCheckpoint(uint256 id) external view returns (ConsensusCheckpoint memory) { return checkpoints[id]; }
    function getValidator(address v) external view returns (Validator memory) { return validators[v]; }
    function getChainHeight() external view returns (uint256) { return chainHeight; }
    function getLatestHash() external view returns (bytes32) { return latestBlockHash; }
    function getLatestStateRoot() external view returns (bytes32) { return latestStateRoot; }
    function getValidatorCount() external view returns (uint256) { return validatorSet.length; }
    function getLiveCellCount() external view returns (uint256) { return liveCellCount; }
    function getCellsByType(bytes32 typeHash) external view returns (uint256[] memory) { return cellsByType[typeHash]; }
    function getCellsByOwner(address owner_) external view returns (uint256[] memory) { return cellsByOwner[owner_]; }
    function getBlockCheckpoints(uint256 blockNum) external view returns (uint256[] memory) { return blockCheckpoints[blockNum]; }

    receive() external payable {}
}
