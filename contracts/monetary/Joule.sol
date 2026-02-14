// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "./interfaces/IJoule.sol";

/**
 * @title Joule (JUL) — Trinomial Stability Token
 * @notice ERC-20 mineable token with three stability mechanisms in ONE asset:
 *
 *   1. PROPORTIONAL PoW MINING (Ergon model)
 *      - SHA-256 proof-of-work (Bitcoin ASIC compatible)
 *      - Reward proportional to difficulty: reward = difficulty * scale * mooresLawFactor
 *      - Price gravitates to electricity cost per hash (ε₀)
 *      - Anti-merge-mining: challenge includes address(this)
 *
 *   2. ELASTIC SUPPLY REBASE (AMPL model)
 *      - O(1) global rebase scalar (Core Tenet)
 *      - externalBalance = internalBalance * rebaseScalar / 1e18
 *      - ±5% equilibrium band (no rebase within band)
 *      - Lag factor = 10 (smooth 10% of deviation per rebase)
 *
 *   3. PI CONTROLLER (RAI model)
 *      - Adjusts the rebase TARGET price (not a fixed peg)
 *      - Dual oracle: electricity cost + CPI purchasing power
 *      - Leaky integrator: 120-day half-life
 *      - Makes the target float to find natural equilibrium
 *
 * @dev Inherits from scratch ERC-20 (not OZ) to support rebase scalar.
 *      Uses Solidity's built-in sha256() for Bitcoin-compatible PoW.
 *
 *      The name "Joule" is the SI unit of energy — fitting for electricity-backed money.
 */
contract Joule is Ownable, ReentrancyGuard, IJoule {
    // ============ ERC-20 Storage (Custom for Rebase) ============

    string private constant _name = "Joule";
    string private constant _symbol = "JUL";
    uint8 private constant _decimals = 18;

    /// @notice Internal balances (pre-rebase). External = internal * scalar / 1e18
    mapping(address => uint256) private _internalBalances;

    /// @notice Allowances (denominated in external/rebased amounts)
    mapping(address => mapping(address => uint256)) private _allowances;

    /// @notice Total internal supply (pre-rebase)
    uint256 private _totalInternalSupply;

    // ============ Mining State ============

    /// @notice Current mining epoch
    Epoch public epoch;

    /// @notice Epoch counter
    uint64 public override currentEpochNumber;

    /// @notice Total blocks mined across all epochs
    uint256 public override totalBlocksMined;

    /// @notice Used proofs (replay prevention)
    mapping(bytes32 => bool) public usedProofs;

    /// @notice Timestamp of contract deployment (for Moore's Law calculation)
    uint256 public immutable deployTimestamp;

    // ============ Mining Constants ============

    /// @notice Blocks per epoch (difficulty adjustment interval) — ~1 day at 10min/block
    uint64 public constant BLOCKS_PER_EPOCH = 144;

    /// @notice Target block time in seconds (10 minutes, like Bitcoin)
    uint256 public constant TARGET_BLOCK_TIME = 600;

    /// @notice Initial difficulty (2^16 = 65536 leading zero bits equivalent)
    uint128 public constant INITIAL_DIFFICULTY = 1 << 16;

    /// @notice Reward scale factor — base reward per unit difficulty
    /// @dev 1e18 = 1 JUL per unit of (difficulty / INITIAL_DIFFICULTY)
    uint256 public constant REWARD_SCALE = 1e18;

    /// @notice Maximum difficulty adjustment ratio (4x up or down per epoch)
    uint256 public constant MAX_ADJUSTMENT_RATIO = 4;

    /// @notice Moore's Law decay per day (18 decimals)
    /// @dev ≈ 0.999051575 — represents ~30% efficiency gain per year
    /// @dev ln(0.7) / 365 ≈ -0.000977, so daily multiplier ≈ e^{-0.000977} ≈ 0.999024
    /// @dev Using 0.999051575 for ~25% annual decay (conservative Moore's Law estimate)
    uint256 public constant MOORE_DECAY_PER_DAY = 999051575000000000; // 0.999051575e18

    /// @notice Precision for fixed-point math
    uint256 private constant PRECISION = 1e18;

    // ============ Rebase State ============

    /// @notice Global rebase scalar — THE core tenet
    /// @dev externalBalance = internalBalance * rebaseScalar / PRECISION
    RebaseState public rebaseState;

    /// @notice Rebase lag factor (smooth 1/lag of deviation per rebase)
    uint256 public constant REBASE_LAG = 10;

    /// @notice Equilibrium band — no rebase within ±5% of target
    uint256 public constant EQUILIBRIUM_BAND_BPS = 500; // 5% = 500 bps

    /// @notice Minimum time between rebases (1 day)
    uint256 public constant REBASE_COOLDOWN = 1 days;

    // ============ PI Controller State ============

    PIState public piState;

    /// @notice Proportional gain (Kp) — 7.5e-8 scaled to 18 decimals
    /// @dev Kp = 75000000000 (7.5e10, representing 7.5e-8 * 1e18)
    int256 public constant KP = 75000000000; // 7.5e-8 * 1e18

    /// @notice Integral gain (Ki) — 2.4e-14 scaled to 18 decimals
    /// @dev Ki = 24000000 (2.4e7, representing 2.4e-14 * 1e18 * 1e3 for per-hour)
    int256 public constant KI = 24000000;

    /// @notice Leaky integrator decay per second (120-day half-life)
    /// @dev α ≈ 0.9999997112 per second → α^(120*86400) ≈ 0.5
    int256 public constant INTEGRATOR_DECAY = 999999711200000000; // 0.9999997112e18

    // ============ Oracle State ============

    /// @notice Electricity price oracle (Chainlink-compatible)
    address public electricityOracle;

    /// @notice CPI purchasing power oracle (Chainlink-compatible)
    address public cpiOracle;

    /// @notice Market price oracle for JUL
    address public marketOracle;

    /// @notice Initial target price (2019 CPI purchasing power of $1 USD)
    uint256 public constant INITIAL_TARGET = 1e18; // 1.0 in 18 decimals

    // ============ Constructor ============

    constructor(address _governance) Ownable(_governance) {
        if (_governance == address(0)) revert ZeroAddress();

        deployTimestamp = block.timestamp;

        // Initialize mining epoch
        epoch = Epoch({
            difficulty: INITIAL_DIFFICULTY,
            startBlock: uint64(block.number),
            blocksMined: 0,
            startTimestamp: block.timestamp
        });

        // Initialize rebase scalar to 1.0
        rebaseState = RebaseState({
            rebaseScalar: PRECISION,
            lastRebaseTime: block.timestamp,
            totalRebases: 0
        });

        // Initialize PI controller
        piState = PIState({
            integral: 0,
            lastError: 0,
            redemptionPrice: INITIAL_TARGET,
            lastUpdateTime: block.timestamp
        });
    }

    // ============ ERC-20 Implementation (Rebase-Aware) ============

    function name() external pure returns (string memory) { return _name; }
    function symbol() external pure returns (string memory) { return _symbol; }
    function decimals() external pure returns (uint8) { return _decimals; }

    /// @notice Total supply in external (rebased) terms
    function totalSupply() external view returns (uint256) {
        return _toExternal(_totalInternalSupply);
    }

    /// @notice External (rebased) balance
    function balanceOf(address account) external view returns (uint256) {
        return _toExternal(_internalBalances[account]);
    }

    /// @notice Alias for balanceOf — explicit rebased balance
    function scaledBalanceOf(address account) external view override returns (uint256) {
        return _toExternal(_internalBalances[account]);
    }

    /// @notice Internal (pre-rebase) balance
    function internalBalanceOf(address account) external view override returns (uint256) {
        return _internalBalances[account];
    }

    function allowance(address owner_, address spender) external view returns (uint256) {
        return _allowances[owner_][spender];
    }

    function approve(address spender, uint256 amount) external returns (bool) {
        _allowances[msg.sender][spender] = amount;
        emit Approval(msg.sender, spender, amount);
        return true;
    }

    function transfer(address to, uint256 amount) external returns (bool) {
        _transfer(msg.sender, to, amount);
        return true;
    }

    function transferFrom(address from, address to, uint256 amount) external returns (bool) {
        uint256 currentAllowance = _allowances[from][msg.sender];
        if (currentAllowance != type(uint256).max) {
            require(currentAllowance >= amount, "ERC20: insufficient allowance");
            unchecked { _allowances[from][msg.sender] = currentAllowance - amount; }
        }
        _transfer(from, to, amount);
        return true;
    }

    /// @dev Transfer in external amounts, converted to internal
    function _transfer(address from, address to, uint256 externalAmount) internal {
        require(from != address(0), "ERC20: transfer from zero");
        require(to != address(0), "ERC20: transfer to zero");

        uint256 internalAmount = _toInternal(externalAmount);
        require(_internalBalances[from] >= internalAmount, "ERC20: insufficient balance");

        unchecked { _internalBalances[from] -= internalAmount; }
        _internalBalances[to] += internalAmount;

        emit Transfer(from, to, externalAmount);
    }

    function _mint(address to, uint256 internalAmount) internal {
        _totalInternalSupply += internalAmount;
        _internalBalances[to] += internalAmount;
        emit Transfer(address(0), to, _toExternal(internalAmount));
    }

    /// @dev Convert internal amount to external (rebased)
    function _toExternal(uint256 internalAmount) internal view returns (uint256) {
        return (internalAmount * rebaseState.rebaseScalar) / PRECISION;
    }

    /// @dev Convert external amount to internal (pre-rebase)
    function _toInternal(uint256 externalAmount) internal view returns (uint256) {
        return (externalAmount * PRECISION) / rebaseState.rebaseScalar;
    }

    // ============ ERC-20 Events ============

    event Transfer(address indexed from, address indexed to, uint256 value);
    event Approval(address indexed owner, address indexed spender, uint256 value);

    // ============ Mining Functions ============

    /// @inheritdoc IJoule
    function mine(bytes32 nonce) external override nonReentrant returns (uint256 reward) {
        // Generate challenge (includes address(this) for anti-merge-mining)
        bytes32 challenge = _generateChallenge();

        // Compute SHA-256 hash (built-in, not SHA256Verifier which has assembly return bug)
        bytes32 hash = sha256(abi.encodePacked(challenge, nonce));

        // Verify difficulty
        uint256 hashValue = uint256(hash);
        if (hashValue >= type(uint256).max / epoch.difficulty) {
            revert InsufficientDifficulty();
        }

        // Replay prevention
        bytes32 proofHash = keccak256(abi.encodePacked(challenge, nonce));
        if (usedProofs[proofHash]) revert ProofAlreadyUsed();
        usedProofs[proofHash] = true;

        // Calculate proportional reward
        reward = getCurrentReward();

        // Mint to miner (internal amount — pre-rebase)
        uint256 internalReward = _toInternal(reward);
        _mint(msg.sender, internalReward);

        // Update epoch
        epoch.blocksMined++;
        totalBlocksMined++;

        emit BlockMined(msg.sender, reward, epoch.difficulty, totalBlocksMined);

        // Check if epoch should end
        if (epoch.blocksMined >= BLOCKS_PER_EPOCH) {
            _adjustDifficulty();
        }
    }

    /// @inheritdoc IJoule
    function getCurrentChallenge() public view override returns (bytes32) {
        return _generateChallenge();
    }

    /// @inheritdoc IJoule
    function getCurrentReward() public view override returns (uint256) {
        uint256 mooresFactor = getMooresLawFactor();

        // Proportional reward: scales with difficulty
        // reward = difficulty * REWARD_SCALE * mooresFactor / (INITIAL_DIFFICULTY * PRECISION)
        return (uint256(epoch.difficulty) * REWARD_SCALE * mooresFactor) /
               (uint256(INITIAL_DIFFICULTY) * PRECISION);
    }

    /// @inheritdoc IJoule
    function getCurrentEpoch() external view override returns (Epoch memory) {
        return epoch;
    }

    /// @inheritdoc IJoule
    function getMooresLawFactor() public view override returns (uint256) {
        uint256 daysSinceDeploy = (block.timestamp - deployTimestamp) / 1 days;
        if (daysSinceDeploy == 0) return PRECISION;

        // Compute MOORE_DECAY_PER_DAY ^ daysSinceDeploy via exponentiation by squaring
        return _pow(MOORE_DECAY_PER_DAY, daysSinceDeploy);
    }

    // ============ Rebase Functions ============

    /// @inheritdoc IJoule
    function rebase() external override nonReentrant returns (int256 supplyDelta) {
        if (block.timestamp < rebaseState.lastRebaseTime + REBASE_COOLDOWN) {
            revert RebaseTooSoon();
        }

        // Update PI controller first (adjusts target)
        _updatePIController();

        // Get market price from oracle
        uint256 marketPrice = _getMarketPrice();
        uint256 target = piState.redemptionPrice;

        // Check if within equilibrium band
        uint256 deviationBps;
        if (marketPrice > target) {
            deviationBps = ((marketPrice - target) * 10000) / target;
        } else {
            deviationBps = ((target - marketPrice) * 10000) / target;
        }

        if (deviationBps <= EQUILIBRIUM_BAND_BPS) {
            // Within ±5% band — no rebase needed
            rebaseState.lastRebaseTime = block.timestamp;
            rebaseState.totalRebases++;
            emit Rebase(rebaseState.totalRebases, 0, rebaseState.rebaseScalar, _toExternal(_totalInternalSupply));
            return 0;
        }

        // Calculate supply delta: totalSupply * (price - target) / target / lag
        uint256 currentExternal = _toExternal(_totalInternalSupply);
        if (marketPrice > target) {
            // Positive rebase (expansion)
            uint256 deviation = marketPrice - target;
            uint256 absDelta = (currentExternal * deviation) / target / REBASE_LAG;
            supplyDelta = int256(absDelta);
        } else {
            // Negative rebase (contraction)
            uint256 deviation = target - marketPrice;
            uint256 absDelta = (currentExternal * deviation) / target / REBASE_LAG;
            supplyDelta = -int256(absDelta);
        }

        // Apply rebase by adjusting the global scalar
        if (supplyDelta > 0) {
            // Expansion: increase scalar
            uint256 scalarDelta = (rebaseState.rebaseScalar * uint256(supplyDelta)) / currentExternal;
            rebaseState.rebaseScalar += scalarDelta;
        } else if (supplyDelta < 0) {
            // Contraction: decrease scalar
            uint256 scalarDelta = (rebaseState.rebaseScalar * uint256(-supplyDelta)) / currentExternal;
            rebaseState.rebaseScalar -= scalarDelta;
        }

        rebaseState.lastRebaseTime = block.timestamp;
        rebaseState.totalRebases++;

        emit Rebase(
            rebaseState.totalRebases,
            supplyDelta,
            rebaseState.rebaseScalar,
            _toExternal(_totalInternalSupply)
        );
    }

    /// @inheritdoc IJoule
    function getRebaseScalar() external view override returns (uint256) {
        return rebaseState.rebaseScalar;
    }

    // ============ PI Controller Functions ============

    /// @inheritdoc IJoule
    function getPIState() external view override returns (PIState memory) {
        return piState;
    }

    /// @inheritdoc IJoule
    function getRebaseTarget() external view override returns (uint256) {
        return piState.redemptionPrice;
    }

    // ============ Oracle Functions ============

    /// @inheritdoc IJoule
    function setElectricityOracle(address oracle) external override onlyOwner {
        if (oracle == address(0)) revert ZeroAddress();
        electricityOracle = oracle;
        emit OracleUpdated(OracleType.ELECTRICITY, oracle);
    }

    /// @inheritdoc IJoule
    function setCPIOracle(address oracle) external override onlyOwner {
        if (oracle == address(0)) revert ZeroAddress();
        cpiOracle = oracle;
        emit OracleUpdated(OracleType.CPI, oracle);
    }

    /// @notice Set the market price oracle for JUL
    function setMarketOracle(address oracle) external onlyOwner {
        if (oracle == address(0)) revert ZeroAddress();
        marketOracle = oracle;
    }

    /// @inheritdoc IJoule
    function getMarketPrice() external view override returns (uint256) {
        return _getMarketPrice();
    }

    // ============ Internal: Mining ============

    function _generateChallenge() internal view returns (bytes32) {
        return keccak256(abi.encodePacked(
            address(this),      // Anti-merge-mining: unique to this contract
            currentEpochNumber,
            epoch.blocksMined,
            block.chainid
        ));
    }

    function _adjustDifficulty() internal {
        uint128 oldDifficulty = epoch.difficulty;

        // Actual time for this epoch
        uint256 elapsed = block.timestamp - epoch.startTimestamp;
        uint256 expectedTime = BLOCKS_PER_EPOCH * TARGET_BLOCK_TIME;

        // New difficulty = old * expected / actual (clamped to 4x)
        uint128 newDifficulty;
        if (elapsed == 0) {
            // All blocks mined instantly — max increase
            newDifficulty = oldDifficulty * uint128(MAX_ADJUSTMENT_RATIO);
        } else if (elapsed < expectedTime) {
            // Blocks too fast — increase difficulty
            uint256 ratio = (expectedTime * PRECISION) / elapsed;
            if (ratio > MAX_ADJUSTMENT_RATIO * PRECISION) {
                ratio = MAX_ADJUSTMENT_RATIO * PRECISION;
            }
            newDifficulty = uint128((uint256(oldDifficulty) * ratio) / PRECISION);
        } else {
            // Blocks too slow — decrease difficulty
            uint256 ratio = (elapsed * PRECISION) / expectedTime;
            if (ratio > MAX_ADJUSTMENT_RATIO * PRECISION) {
                ratio = MAX_ADJUSTMENT_RATIO * PRECISION;
            }
            newDifficulty = uint128((uint256(oldDifficulty) * PRECISION) / ratio);
        }

        // Minimum difficulty of 1
        if (newDifficulty == 0) newDifficulty = 1;

        currentEpochNumber++;
        epoch = Epoch({
            difficulty: newDifficulty,
            startBlock: uint64(block.number),
            blocksMined: 0,
            startTimestamp: block.timestamp
        });

        emit DifficultyAdjusted(oldDifficulty, newDifficulty, currentEpochNumber);
    }

    // ============ Internal: PI Controller ============

    function _updatePIController() internal {
        uint256 marketPrice = _getMarketPrice();
        uint256 target = piState.redemptionPrice;

        // error = (target - marketPrice) / target (signed, 18 decimals)
        int256 error;
        if (marketPrice >= target) {
            error = -int256(((marketPrice - target) * PRECISION) / target);
        } else {
            error = int256(((target - marketPrice) * PRECISION) / target);
        }

        // Time elapsed since last update
        uint256 dt = block.timestamp - piState.lastUpdateTime;

        // Leaky integrator: integral = decay^dt * old_integral + error
        int256 decayFactor = int256(_pow(uint256(INTEGRATOR_DECAY), dt));
        int256 newIntegral = (piState.integral * decayFactor) / int256(PRECISION) + error;

        // Redemption rate = Kp * error + Ki * integral
        int256 redemptionRate = (KP * error + KI * newIntegral) / int256(PRECISION);

        // Update redemption price: target *= (1 + rate * dt / PRECISION)
        int256 priceDelta = (int256(target) * redemptionRate * int256(dt)) / int256(PRECISION * 3600);
        uint256 newTarget;
        if (priceDelta >= 0) {
            newTarget = target + uint256(priceDelta);
        } else {
            uint256 absDelta = uint256(-priceDelta);
            newTarget = target > absDelta ? target - absDelta : 1; // Floor at 1 wei
        }

        piState.integral = newIntegral;
        piState.lastError = error;
        piState.redemptionPrice = newTarget;
        piState.lastUpdateTime = block.timestamp;

        emit PIUpdate(error, newIntegral, redemptionRate, newTarget);
    }

    // ============ Internal: Oracle ============

    function _getMarketPrice() internal view returns (uint256) {
        // If market oracle set, use it
        if (marketOracle != address(0)) {
            return _readOracle(marketOracle);
        }
        // Fallback: use electricity oracle as proxy
        if (electricityOracle != address(0)) {
            return _readOracle(electricityOracle);
        }
        // No oracle — return target (neutral, no rebase)
        return piState.redemptionPrice;
    }

    function _readOracle(address oracle) internal view returns (uint256) {
        // Chainlink AggregatorV3Interface compatible
        // Returns: (roundId, answer, startedAt, updatedAt, answeredInRound)
        (, int256 answer,, uint256 updatedAt,) = IChainlinkOracle(oracle).latestRoundData();
        if (block.timestamp - updatedAt > 1 days) revert OracleStale();
        require(answer > 0, "Oracle: negative price");

        // Chainlink uses 8 decimals, we use 18
        return uint256(answer) * 1e10;
    }

    // ============ Internal: Math ============

    /// @notice Exponentiation by squaring for fixed-point (18 decimals)
    /// @param base Base value (18 decimals)
    /// @param exp Integer exponent
    /// @return result base^exp in 18 decimals
    function _pow(uint256 base, uint256 exp) internal pure returns (uint256 result) {
        result = PRECISION; // 1.0
        while (exp > 0) {
            if (exp % 2 == 1) {
                result = (result * base) / PRECISION;
            }
            base = (base * base) / PRECISION;
            exp /= 2;
        }
    }
}

// ============ Minimal Chainlink Interface ============

interface IChainlinkOracle {
    function latestRoundData() external view returns (
        uint80 roundId,
        int256 answer,
        uint256 startedAt,
        uint256 updatedAt,
        uint80 answeredInRound
    );
}
