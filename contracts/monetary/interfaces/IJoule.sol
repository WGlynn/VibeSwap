// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/**
 * @title IJoule
 * @notice Interface for Joule (JUL) — Trinomial Stability Token
 * @dev Single ERC-20 token with three stability mechanisms:
 *      1. Proportional PoW Mining (Ergon model) — anchors value to electricity cost
 *      2. Elastic Supply Rebase (AMPL model) — absorbs demand shocks via O(1) global scalar
 *      3. PI Controller (RAI model) — dampens oscillations by adjusting rebase target
 *
 *      All three mechanisms operate at different timescales on ONE token:
 *      - Mining: long-term (electricity cost anchor)
 *      - PI Controller: medium-term (trend dampening with memory)
 *      - Rebase: short-term (immediate demand shock absorption)
 */
interface IJoule {
    // ============ Enums ============

    /// @notice Oracle type for dual oracle system
    enum OracleType {
        ELECTRICITY,    // Ergon PoW electricity cost oracle
        CPI             // Chainlink CPI purchasing power oracle
    }

    // ============ Structs ============

    /// @notice Mining epoch data
    struct Epoch {
        uint128 difficulty;         // Current mining difficulty
        uint64 startBlock;          // Block number epoch started
        uint64 blocksMined;         // Blocks mined in this epoch
        uint256 startTimestamp;     // Timestamp epoch started
    }

    /// @notice PI controller state
    struct PIState {
        int256 integral;            // Accumulated integral term (leaky)
        int256 lastError;           // Last error signal
        uint256 redemptionPrice;    // Current target price (18 decimals)
        uint256 lastUpdateTime;     // Last PI update timestamp
    }

    /// @notice Rebase state
    struct RebaseState {
        uint256 rebaseScalar;       // Global scalar (18 decimals, starts at 1e18)
        uint256 lastRebaseTime;     // Last rebase timestamp
        uint256 totalRebases;       // Number of rebases executed
    }

    // ============ Events ============

    // Mining events
    event BlockMined(address indexed miner, uint256 reward, uint128 difficulty, uint256 blockNumber);
    event DifficultyAdjusted(uint128 oldDifficulty, uint128 newDifficulty, uint64 epoch);
    event MooresLawApplied(uint256 decayFactor, uint256 timestamp);

    // Rebase events
    event Rebase(uint256 indexed epoch, int256 supplyDelta, uint256 newScalar, uint256 totalSupply);

    // PI Controller events
    event PIUpdate(int256 error, int256 integral, int256 redemptionRate, uint256 newTarget);

    // Oracle events
    event OracleUpdated(OracleType oracleType, address indexed oracle);
    event PriceFeedUpdated(uint256 marketPrice, uint256 electricityPrice, uint256 cpiPrice);

    // ============ Errors ============

    error InvalidProof();
    error InsufficientDifficulty();
    error ProofAlreadyUsed();
    error RebaseTooSoon();
    error OracleStale();
    error OracleNotSet();
    error ZeroAddress();
    error NotGovernance();

    // ============ Mining Functions ============

    /// @notice Submit a proof-of-work to mine new Joule tokens
    /// @param nonce The nonce that produces a valid hash
    /// @return reward Amount of JUL minted
    function mine(bytes32 nonce) external returns (uint256 reward);

    /// @notice Get the current mining challenge
    /// @return challenge The hash miners must solve against
    function getCurrentChallenge() external view returns (bytes32 challenge);

    /// @notice Get the current mining reward (proportional to difficulty, adjusted by Moore's Law)
    /// @return reward Current reward in JUL (18 decimals)
    function getCurrentReward() external view returns (uint256 reward);

    /// @notice Get current epoch data
    /// @return epoch The current mining epoch
    function getCurrentEpoch() external view returns (Epoch memory epoch);

    // ============ Rebase Functions ============

    /// @notice Execute a rebase (callable by anyone, rate-limited)
    /// @return supplyDelta The change in total supply (can be negative)
    function rebase() external returns (int256 supplyDelta);

    /// @notice Get the current rebase scalar
    /// @return scalar The global rebase scalar (18 decimals)
    function getRebaseScalar() external view returns (uint256 scalar);

    /// @notice Get external (rebased) balance for an account
    /// @param account The address to query
    /// @return balance The external balance after applying rebase scalar
    function scaledBalanceOf(address account) external view returns (uint256 balance);

    /// @notice Get the internal (pre-rebase) balance for an account
    /// @param account The address to query
    /// @return balance The internal balance before rebase scalar
    function internalBalanceOf(address account) external view returns (uint256 balance);

    // ============ PI Controller Functions ============

    /// @notice Get the current PI controller state
    /// @return state The PI controller state
    function getPIState() external view returns (PIState memory state);

    /// @notice Get the current rebase target (set by PI controller)
    /// @return target The target price in 18 decimals
    function getRebaseTarget() external view returns (uint256 target);

    // ============ Oracle Functions ============

    /// @notice Set the electricity price oracle
    /// @param oracle Address of the price feed
    function setElectricityOracle(address oracle) external;

    /// @notice Set the CPI oracle
    /// @param oracle Address of the CPI price feed
    function setCPIOracle(address oracle) external;

    /// @notice Get the current market price from oracle
    /// @return price Market price in 18 decimals
    function getMarketPrice() external view returns (uint256 price);

    // ============ View Functions ============

    /// @notice Get the Moore's Law decay factor at current time
    /// @return factor The decay multiplier (18 decimals)
    function getMooresLawFactor() external view returns (uint256 factor);

    /// @notice Get total mined blocks across all epochs
    /// @return count Total blocks mined
    function totalBlocksMined() external view returns (uint256 count);

    /// @notice Get current epoch number
    /// @return epoch The epoch number
    function currentEpochNumber() external view returns (uint64 epoch);
}
