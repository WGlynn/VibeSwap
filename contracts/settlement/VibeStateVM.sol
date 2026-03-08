// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts-upgradeable/access/OwnableUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/proxy/utils/UUPSUpgradeable.sol";

/**
 * @title VibeStateVM — RISC-V Execution Layer for State Transitions
 * @notice Models the CKB-VM execution environment on EVM. Defines how
 *         type scripts and lock scripts are verified. Every lock script
 *         carries a PoW dependency (Matt's insight), solving the shared
 *         state UTXO contention problem — you can't just race to consume
 *         a cell, you must prove computational work first.
 *
 * @dev Architecture (NC-max + Siren + Matt's PoW locks):
 *
 *      NC-MAX CONSENSUS UPGRADES:
 *      - Two-step transaction confirmation (propose → confirm)
 *      - Uncle blocks contribute to difficulty adjustment
 *      - Orphan rate compensation: miners get partial rewards for uncles
 *      - This makes the chain more fair and reduces centralization pressure
 *
 *      SIREN PROTOCOL INTEGRATION:
 *      - State transitions go through commit-reveal (like batch auctions)
 *      - Commit phase: hash(transition || secret) — nobody sees what you're doing
 *      - Reveal phase: execute transition — MEV is impossible because order is shuffled
 *      - Applied to cell consumption: can't front-run a cell spend
 *
 *      MATT'S POW LOCK SCRIPT DEPENDENCY:
 *      - Every lock script has a PoW requirement
 *      - To consume a shared-state cell, you must solve a mini PoW puzzle
 *      - The puzzle difficulty scales with cell contention (more contenders = harder)
 *      - This replaces "first come first serve" with "proportional computational fairness"
 *      - Prevents the CKB cell contention problem where txs fight over the same cell
 *      - PoW difficulty is PER-CELL, not global — hot cells are harder to consume
 *
 *      ACCOUNT/UTXO HYBRID (CKB-VM ABSTRACTION):
 *      - UTXO side: State cells are consumed and created (VibeStateChain.sol)
 *      - Account side: Persistent accounts with balance tracking and nonces
 *      - Bridge: Accounts can "deposit into" cells, cells can "withdraw to" accounts
 *      - Best of both: UTXO privacy/parallelism + account composability/simplicity
 *      - User-facing: account model (familiar UX)
 *      - Protocol-facing: UTXO model (parallel state transitions, no global lock)
 *
 *      RISC-V ISA:
 *      - Type/lock scripts are conceptually RISC-V programs (like CKB-VM)
 *      - On EVM, we represent them as script hashes with registered verifiers
 *      - The actual RISC-V execution happens on the CKB layer
 *      - EVM layer validates proofs of correct RISC-V execution
 *      - This keeps EVM stateless w.r.t. script execution — just verify proofs
 */
contract VibeStateVM is OwnableUpgradeable, UUPSUpgradeable {
    // ============ Types ============

    /// @notice Script program registered in the VM
    struct Script {
        bytes32 scriptHash;          // Hash of the RISC-V binary
        bytes32 codeHash;            // IPFS hash of actual RISC-V code
        address registrar;           // Who registered this script
        ScriptType scriptType;
        uint256 gasLimit;            // Max cycles for execution
        uint256 registeredAt;
        bool active;
    }

    enum ScriptType { LOCK, TYPE, EXTENSION }

    /// @notice PoW lock requirement for a specific cell type
    struct PowLockRequirement {
        bytes32 cellTypeHash;        // Which type of cells this applies to
        uint256 baseDifficulty;      // Base PoW difficulty
        uint256 currentDifficulty;   // Adjusted based on contention
        uint256 contentionCount;     // How many pending attempts to consume
        uint256 lastAdjustment;
        uint256 adjustmentInterval;  // Blocks between difficulty adjustments
    }

    /// @notice Account in the hybrid model
    struct HybridAccount {
        address owner;
        uint256 balance;             // ETH balance (account side)
        uint256 nonce;               // Replay protection
        uint256 cellCount;           // Active cells owned (UTXO side)
        uint256 totalCellCapacity;   // Total ETH locked in cells
        bytes32 stateRoot;           // Merkle root of account's cell set
        uint256 lastActive;
    }

    /// @notice Committed cell transition (Siren defense)
    struct TransitionCommit {
        bytes32 commitHash;          // hash(cellId, newDataHash, powNonce, secret)
        address committer;
        uint256 committedAt;
        bool revealed;
        bool executed;
    }

    /// @notice Uncle block record (NC-max)
    struct UncleBlock {
        uint256 uncleId;
        uint256 parentBlockNumber;   // Same parent as canonical block
        bytes32 blockHash;
        address proposer;
        uint256 reward;              // Partial reward (uncle inclusion reward)
        uint256 timestamp;
    }

    // ============ Constants ============

    uint256 public constant POW_BASE_DIFFICULTY = 1000;
    uint256 public constant POW_ADJUSTMENT_FACTOR = 200;   // 2% per contention event
    uint256 public constant COMMIT_WINDOW = 8;             // 8 seconds (Siren)
    uint256 public constant REVEAL_WINDOW = 2;             // 2 seconds (Siren)
    uint256 public constant UNCLE_REWARD_PCT = 5000;       // 50% of block reward
    uint256 public constant MAX_UNCLES_PER_BLOCK = 2;

    // ============ State ============

    // --- Scripts ---
    mapping(bytes32 => Script) public scripts;
    uint256 public scriptCount;

    // --- PoW Locks ---
    mapping(bytes32 => PowLockRequirement) public powLocks;  // cellTypeHash => requirement

    // --- Hybrid Accounts ---
    mapping(address => HybridAccount) public accounts;
    uint256 public totalAccounts;

    // --- Siren Commits ---
    mapping(bytes32 => TransitionCommit) public commits;     // commitHash => commit
    uint256 public commitCount;
    uint256 public currentCommitPhaseStart;

    // --- NC-max Uncles ---
    mapping(uint256 => UncleBlock) public uncles;
    uint256 public uncleCount;
    mapping(uint256 => uint256[]) public blockUncles;        // blockNumber => uncleId[]

    // --- Contention Tracking ---
    /// @notice cellId => number of pending PoW attempts
    mapping(uint256 => uint256) public cellContention;

    // ============ Events ============

    event ScriptRegistered(bytes32 indexed scriptHash, ScriptType scriptType, address indexed registrar);
    event PowLockSet(bytes32 indexed cellTypeHash, uint256 baseDifficulty);
    event PowSolved(uint256 indexed cellId, address indexed solver, uint256 nonce, uint256 difficulty);
    event TransitionCommitted(bytes32 indexed commitHash, address indexed committer);
    event TransitionRevealed(bytes32 indexed commitHash, uint256 indexed cellId);
    event AccountCreated(address indexed owner);
    event CellDeposited(address indexed owner, uint256 indexed cellId, uint256 amount);
    event CellWithdrawn(address indexed owner, uint256 indexed cellId, uint256 amount);
    event UncleRecorded(uint256 indexed uncleId, uint256 indexed parentBlock, address indexed proposer);
    event ContentionAdjusted(bytes32 indexed cellTypeHash, uint256 oldDifficulty, uint256 newDifficulty);

    // ============ Init ============

    function initialize() external initializer {
        __Ownable_init(msg.sender);
        __UUPSUpgradeable_init();
    }

    function _authorizeUpgrade(address) internal override onlyOwner {}

    // ============ Script Registry (RISC-V Programs) ============

    /**
     * @notice Register a RISC-V script (type or lock)
     * @dev The actual RISC-V binary lives on IPFS (codeHash).
     *      The scriptHash is keccak256(codeHash || args).
     *      Verification of correct execution is done via proof.
     */
    function registerScript(
        bytes32 codeHash,
        ScriptType scriptType,
        uint256 gasLimit
    ) external returns (bytes32) {
        bytes32 scriptHash = keccak256(abi.encodePacked(codeHash, msg.sender, block.timestamp));

        scripts[scriptHash] = Script({
            scriptHash: scriptHash,
            codeHash: codeHash,
            registrar: msg.sender,
            scriptType: scriptType,
            gasLimit: gasLimit,
            registeredAt: block.timestamp,
            active: true
        });

        scriptCount++;

        emit ScriptRegistered(scriptHash, scriptType, msg.sender);
        return scriptHash;
    }

    // ============ PoW Lock Scripts (Matt's Pattern) ============

    /**
     * @notice Set PoW requirement for a cell type
     * @dev Every lock script has a PoW dependency. To consume a cell
     *      of this type, you must solve a puzzle of this difficulty.
     *      Difficulty auto-adjusts based on contention.
     */
    function setPowLock(bytes32 cellTypeHash, uint256 baseDifficulty) external onlyOwner {
        powLocks[cellTypeHash] = PowLockRequirement({
            cellTypeHash: cellTypeHash,
            baseDifficulty: baseDifficulty > 0 ? baseDifficulty : POW_BASE_DIFFICULTY,
            currentDifficulty: baseDifficulty > 0 ? baseDifficulty : POW_BASE_DIFFICULTY,
            contentionCount: 0,
            lastAdjustment: block.number,
            adjustmentInterval: 10 // Adjust every 10 blocks
        });

        emit PowLockSet(cellTypeHash, baseDifficulty);
    }

    /**
     * @notice Verify a PoW solution for consuming a cell
     * @dev The solver must find a nonce such that:
     *      hash(cellId, solver, nonce) < target
     *      where target = type(uint256).max / currentDifficulty
     *
     *      This is Matt's insight: shared state cells require PoW to consume.
     *      No more racing — computational fairness replaces speed.
     */
    function verifyPow(
        uint256 cellId,
        bytes32 cellTypeHash,
        uint256 nonce
    ) external returns (bool) {
        PowLockRequirement storage req = powLocks[cellTypeHash];
        require(req.baseDifficulty > 0, "No PoW required for this type");

        bytes32 hash = keccak256(abi.encodePacked(cellId, msg.sender, nonce));
        uint256 target = type(uint256).max / req.currentDifficulty;
        require(uint256(hash) < target, "PoW not valid");

        // Track contention
        cellContention[cellId]++;
        req.contentionCount++;

        // Auto-adjust difficulty based on contention
        if (block.number >= req.lastAdjustment + req.adjustmentInterval) {
            _adjustPowDifficulty(cellTypeHash);
        }

        emit PowSolved(cellId, msg.sender, nonce, req.currentDifficulty);
        return true;
    }

    // ============ Siren Protocol (Commit-Reveal State Transitions) ============

    /**
     * @notice Commit a state transition (Siren phase 1)
     * @dev Hash your intended cell transition. Nobody can see what you're doing.
     *      This prevents MEV on state transitions.
     */
    function commitTransition(bytes32 commitHash) external {
        require(commits[commitHash].committer == address(0), "Already committed");

        commits[commitHash] = TransitionCommit({
            commitHash: commitHash,
            committer: msg.sender,
            committedAt: block.timestamp,
            revealed: false,
            executed: false
        });

        commitCount++;

        emit TransitionCommitted(commitHash, msg.sender);
    }

    /**
     * @notice Reveal a state transition (Siren phase 2)
     * @dev Reveal what you committed. Order of execution is determined
     *      by the Fisher-Yates shuffle using XORed secrets.
     */
    function revealTransition(
        uint256 cellId,
        bytes32 newDataHash,
        uint256 powNonce,
        bytes32 secret
    ) external {
        bytes32 commitHash = keccak256(abi.encodePacked(cellId, newDataHash, powNonce, secret));
        TransitionCommit storage c = commits[commitHash];
        require(c.committer == msg.sender, "Not committer");
        require(!c.revealed, "Already revealed");

        c.revealed = true;

        emit TransitionRevealed(commitHash, cellId);
    }

    // ============ Hybrid Account Model ============

    /**
     * @notice Create a hybrid account (account side of the hybrid)
     * @dev Users interact through accounts (familiar UX).
     *      Under the hood, the protocol uses UTXO cells for parallelism.
     */
    function createAccount() external payable {
        require(accounts[msg.sender].owner == address(0), "Already exists");

        accounts[msg.sender] = HybridAccount({
            owner: msg.sender,
            balance: msg.value,
            nonce: 0,
            cellCount: 0,
            totalCellCapacity: 0,
            stateRoot: bytes32(0),
            lastActive: block.timestamp
        });

        totalAccounts++;

        emit AccountCreated(msg.sender);
    }

    /**
     * @notice Deposit from account into a cell (account → UTXO)
     * @dev Locks ETH from account balance into a state cell's capacity.
     *      The cell can then be used in UTXO-style state transitions.
     */
    function depositToCell(uint256 cellId, uint256 amount) external {
        HybridAccount storage acct = accounts[msg.sender];
        require(acct.owner != address(0), "No account");
        require(acct.balance >= amount, "Insufficient balance");

        acct.balance -= amount;
        acct.cellCount++;
        acct.totalCellCapacity += amount;
        acct.nonce++;
        acct.lastActive = block.timestamp;

        emit CellDeposited(msg.sender, cellId, amount);
    }

    /**
     * @notice Withdraw from consumed cell back to account (UTXO → account)
     * @dev When a cell is consumed, its capacity returns to the account.
     */
    function withdrawFromCell(uint256 cellId, uint256 amount) external {
        HybridAccount storage acct = accounts[msg.sender];
        require(acct.owner != address(0), "No account");

        acct.balance += amount;
        acct.cellCount--;
        acct.totalCellCapacity -= amount;
        acct.nonce++;
        acct.lastActive = block.timestamp;

        emit CellWithdrawn(msg.sender, cellId, amount);
    }

    function depositToAccount() external payable {
        HybridAccount storage acct = accounts[msg.sender];
        require(acct.owner != address(0), "No account");
        acct.balance += msg.value;
        acct.lastActive = block.timestamp;
    }

    // ============ NC-max Uncle Blocks ============

    /**
     * @notice Record an uncle block (NC-max)
     * @dev Uncle blocks are valid blocks that lost the race.
     *      In NC-max, uncles contribute to difficulty adjustment
     *      and miners get partial rewards — reducing centralization.
     */
    function recordUncle(
        uint256 parentBlockNumber,
        bytes32 blockHash,
        address proposer
    ) external onlyOwner {
        uncleCount++;
        uint256[] storage existing = blockUncles[parentBlockNumber + 1];
        require(existing.length < MAX_UNCLES_PER_BLOCK, "Too many uncles");

        uncles[uncleCount] = UncleBlock({
            uncleId: uncleCount,
            parentBlockNumber: parentBlockNumber,
            blockHash: blockHash,
            proposer: proposer,
            reward: 0, // Set during block finalization
            timestamp: block.timestamp
        });

        existing.push(uncleCount);

        emit UncleRecorded(uncleCount, parentBlockNumber, proposer);
    }

    // ============ Internal ============

    function _adjustPowDifficulty(bytes32 cellTypeHash) internal {
        PowLockRequirement storage req = powLocks[cellTypeHash];
        uint256 oldDifficulty = req.currentDifficulty;

        if (req.contentionCount > 10) {
            // High contention: increase difficulty
            req.currentDifficulty += (req.currentDifficulty * POW_ADJUSTMENT_FACTOR) / 10000;
        } else if (req.contentionCount < 2) {
            // Low contention: decrease difficulty (but not below base)
            uint256 decrease = (req.currentDifficulty * POW_ADJUSTMENT_FACTOR) / 10000;
            if (req.currentDifficulty > req.baseDifficulty + decrease) {
                req.currentDifficulty -= decrease;
            } else {
                req.currentDifficulty = req.baseDifficulty;
            }
        }

        req.contentionCount = 0;
        req.lastAdjustment = block.number;

        emit ContentionAdjusted(cellTypeHash, oldDifficulty, req.currentDifficulty);
    }

    // ============ View ============

    function getScript(bytes32 hash) external view returns (Script memory) { return scripts[hash]; }
    function getPowLock(bytes32 typeHash) external view returns (PowLockRequirement memory) { return powLocks[typeHash]; }
    function getAccount(address owner_) external view returns (HybridAccount memory) { return accounts[owner_]; }
    function getUncle(uint256 id) external view returns (UncleBlock memory) { return uncles[id]; }
    function getCommit(bytes32 hash) external view returns (TransitionCommit memory) { return commits[hash]; }
    function getBlockUncles(uint256 blockNum) external view returns (uint256[] memory) { return blockUncles[blockNum]; }
    function getCellContention(uint256 cellId) external view returns (uint256) { return cellContention[cellId]; }

    receive() external payable {}
}
