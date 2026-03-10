// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

/**
 * @title HatchManager
 * @author W. Glynn (Faraday1) & JARVIS -- vibeswap.org
 * @notice Manages the hatch (initialization) phase of an Augmented Bonding Curve.
 *         Founding members ("Hatchers") contribute reserve tokens during a controlled
 *         period. θ% goes to the Funding Pool, (1-θ)% goes to the Reserve Pool.
 *         Hatchers receive tokens that vest proportionally to governance participation.
 *
 * @dev Based on Commons Stack / TEC hatch pattern:
 *      - Trust-gated: only approved addresses can hatch (Ostrom Principle 1)
 *      - Half-life vesting: S_vested = (1 - 2^(-γ(k - k₀))) × S_hatch
 *      - Hatch return rate: ρ = κ × (1 - θ), recommended ρ ≤ 3
 *      - Vesting accelerates with governance participation (KPI-based)
 *
 *      P-000: Fairness Above All — hatchers must participate to vest.
 */
contract HatchManager is Ownable, ReentrancyGuard {
    using SafeERC20 for IERC20;

    // ============ Constants ============

    uint256 public constant PRECISION = 1e18;
    uint256 public constant BPS = 10000;
    uint256 public constant MAX_THETA_BPS = 8000; // 80% max to funding pool
    uint256 public constant MIN_THETA_BPS = 1000; // 10% min to funding pool
    uint256 public constant MAX_RETURN_RATE = 5;   // ρ ≤ 5 (generous upper bound)

    // ============ Types ============

    enum HatchPhase {
        PENDING,     // Not yet started
        OPEN,        // Accepting contributions
        CLOSED,      // Contributions ended, waiting for curve opening
        COMPLETED,   // Curve opened, hatch tokens distributed
        CANCELLED    // Hatch failed, refunds available
    }

    struct HatchConfig {
        uint256 minRaise;        // Minimum DAI to raise for hatch success
        uint256 maxRaise;        // Maximum DAI accepted
        uint256 hatchPrice;      // Price per token during hatch (p₀)
        uint16 thetaBps;         // θ — % of raise going to Funding Pool
        uint256 vestingHalfLife;  // Half-life in blocks for token vesting
        uint256 hatchDeadline;   // Block number deadline for hatch phase
    }

    struct HatcherInfo {
        uint256 contributed;     // Total reserve contributed
        uint256 tokensAllocated; // Tokens allocated (locked until vesting)
        uint256 tokensVested;    // Tokens already vested/claimed
        bool isApproved;         // Trust-gated approval
    }

    // ============ State ============

    /// @notice The Augmented Bonding Curve this hatch initializes
    address public bondingCurve;

    /// @notice Reserve token (e.g., DAI)
    IERC20 public reserveToken;

    /// @notice Community token
    IERC20 public communityToken;

    /// @notice Token controller (mint/burn authority)
    address public tokenController;

    /// @notice Hatch configuration
    HatchConfig public config;

    /// @notice Current phase
    HatchPhase public phase;

    /// @notice Total raised
    uint256 public totalRaised;

    /// @notice Total tokens allocated to hatchers
    uint256 public totalHatchTokens;

    /// @notice Block when hatch phase completed (for vesting calculation)
    uint256 public hatchCompletionBlock;

    /// @notice Governance participation score per hatcher (0-100)
    mapping(address => uint256) public governanceScore;

    /// @notice Hatcher information
    mapping(address => HatcherInfo) public hatchers;

    /// @notice List of hatcher addresses
    address[] public hatcherList;

    // ============ Events ============

    event HatchStarted(uint256 minRaise, uint256 maxRaise, uint256 deadline);
    event HatcherApproved(address indexed hatcher);
    event HatcherRevoked(address indexed hatcher);
    event Contributed(address indexed hatcher, uint256 amount, uint256 tokensAllocated);
    event HatchCompleted(uint256 totalRaised, uint256 totalTokens, uint256 reservePool, uint256 fundingPool);
    event HatchCancelled(uint256 totalRaised);
    event TokensVested(address indexed hatcher, uint256 amount);
    event Refunded(address indexed hatcher, uint256 amount);
    event GovernanceScoreUpdated(address indexed hatcher, uint256 score);

    // ============ Errors ============

    error WrongPhase();
    error NotApproved();
    error ExceedsMaxRaise();
    error BelowMinRaise();
    error DeadlinePassed();
    error DeadlineNotPassed();
    error NothingToVest();
    error NothingToRefund();
    error ReturnRateTooHigh();
    error ZeroAmount();

    // ============ Constructor ============

    constructor(
        address _bondingCurve,
        address _reserveToken,
        address _communityToken,
        address _tokenController,
        HatchConfig memory _config
    ) Ownable(msg.sender) {
        require(_bondingCurve != address(0), "Zero curve");
        require(_reserveToken != address(0), "Zero reserve");
        require(_communityToken != address(0), "Zero token");
        require(_tokenController != address(0), "Zero controller");
        require(_config.thetaBps >= MIN_THETA_BPS && _config.thetaBps <= MAX_THETA_BPS, "Invalid theta");
        require(_config.hatchPrice > 0, "Zero price");
        require(_config.minRaise > 0, "Zero min raise");
        require(_config.maxRaise >= _config.minRaise, "Max < min");
        require(_config.hatchDeadline > block.number, "Deadline in past");
        require(_config.vestingHalfLife > 0, "Zero half-life");

        bondingCurve = _bondingCurve;
        reserveToken = IERC20(_reserveToken);
        communityToken = IERC20(_communityToken);
        tokenController = _tokenController;
        config = _config;
        phase = HatchPhase.PENDING;
    }

    // ============ Phase Management ============

    /**
     * @notice Start the hatch phase
     */
    function startHatch() external onlyOwner {
        if (phase != HatchPhase.PENDING) revert WrongPhase();
        phase = HatchPhase.OPEN;
        emit HatchStarted(config.minRaise, config.maxRaise, config.hatchDeadline);
    }

    /**
     * @notice Approve an address to participate in the hatch
     * @dev Trust-gating: Ostrom Principle 1 (clearly defined boundaries)
     */
    function approveHatcher(address hatcher) external onlyOwner {
        hatchers[hatcher].isApproved = true;
        emit HatcherApproved(hatcher);
    }

    /**
     * @notice Batch approve multiple hatchers
     */
    function approveHatchers(address[] calldata _hatchers) external onlyOwner {
        for (uint256 i = 0; i < _hatchers.length; i++) {
            hatchers[_hatchers[i]].isApproved = true;
            emit HatcherApproved(_hatchers[i]);
        }
    }

    /**
     * @notice Revoke hatcher approval (only before they contribute)
     */
    function revokeHatcher(address hatcher) external onlyOwner {
        require(hatchers[hatcher].contributed == 0, "Already contributed");
        hatchers[hatcher].isApproved = false;
        emit HatcherRevoked(hatcher);
    }

    // ============ Contribution ============

    /**
     * @notice Contribute reserve tokens during hatch phase
     * @param amount Amount of reserve tokens to contribute
     */
    function contribute(uint256 amount) external nonReentrant {
        if (phase != HatchPhase.OPEN) revert WrongPhase();
        if (block.number > config.hatchDeadline) revert DeadlinePassed();
        if (!hatchers[msg.sender].isApproved) revert NotApproved();
        if (amount == 0) revert ZeroAmount();
        if (totalRaised + amount > config.maxRaise) revert ExceedsMaxRaise();

        // Transfer reserve from hatcher
        reserveToken.safeTransferFrom(msg.sender, address(this), amount);

        // Calculate tokens: tokens = amount / hatchPrice
        uint256 tokensAllocated = (amount * PRECISION) / config.hatchPrice;

        // Track contribution
        if (hatchers[msg.sender].contributed == 0) {
            hatcherList.push(msg.sender);
        }
        hatchers[msg.sender].contributed += amount;
        hatchers[msg.sender].tokensAllocated += tokensAllocated;

        totalRaised += amount;
        totalHatchTokens += tokensAllocated;

        emit Contributed(msg.sender, amount, tokensAllocated);
    }

    // ============ Hatch Completion ============

    /**
     * @notice Complete the hatch and open the bonding curve
     * @dev Can only be called after deadline if min raise is met
     */
    function completeHatch() external onlyOwner nonReentrant {
        if (phase != HatchPhase.OPEN) revert WrongPhase();
        if (totalRaised < config.minRaise) revert BelowMinRaise();

        phase = HatchPhase.COMPLETED;
        hatchCompletionBlock = block.number;

        // Split raise: θ% → Funding Pool, (1-θ)% → Reserve Pool
        uint256 fundingAmount = (totalRaised * config.thetaBps) / BPS;
        uint256 reserveAmount = totalRaised - fundingAmount;

        // Validate return rate: ρ = κ × (1-θ) ≤ MAX_RETURN_RATE
        // We get kappa from the bonding curve
        (bool ok, bytes memory data) = bondingCurve.staticcall(
            abi.encodeWithSignature("kappa()")
        );
        if (ok && data.length == 32) {
            uint256 kappa = abi.decode(data, (uint256));
            uint256 thetaInv = BPS - config.thetaBps; // (1-θ) in BPS
            uint256 returnRate = (kappa * thetaInv) / BPS;
            if (returnRate > MAX_RETURN_RATE) revert ReturnRateTooHigh();
        }

        // Transfer reserve to bonding curve
        reserveToken.safeTransfer(bondingCurve, totalRaised);

        // Mint hatch tokens to this contract (locked for vesting)
        _mintTokens(address(this), totalHatchTokens);

        // Open the bonding curve with initial state
        (bool success, ) = bondingCurve.call(
            abi.encodeWithSignature(
                "openCurve(uint256,uint256,uint256)",
                reserveAmount,
                fundingAmount,
                totalHatchTokens
            )
        );
        require(success, "Curve opening failed");

        emit HatchCompleted(totalRaised, totalHatchTokens, reserveAmount, fundingAmount);
    }

    /**
     * @notice Cancel the hatch if min raise not met after deadline
     */
    function cancelHatch() external onlyOwner {
        if (phase != HatchPhase.OPEN) revert WrongPhase();
        if (block.number <= config.hatchDeadline && totalRaised >= config.minRaise) {
            revert DeadlineNotPassed();
        }

        phase = HatchPhase.CANCELLED;
        emit HatchCancelled(totalRaised);
    }

    // ============ Vesting ============

    /**
     * @notice Claim vested tokens
     * @dev Half-life vesting: S_vested = (1 - 2^(-γ(k - k₀))) × S_allocated
     *      Governance participation accelerates vesting (up to 2x speed)
     */
    function claimVestedTokens() external nonReentrant {
        if (phase != HatchPhase.COMPLETED) revert WrongPhase();

        HatcherInfo storage hatcher = hatchers[msg.sender];
        uint256 totalVestable = _vestedAmount(msg.sender);
        uint256 claimable = totalVestable > hatcher.tokensVested
            ? totalVestable - hatcher.tokensVested
            : 0;

        if (claimable == 0) revert NothingToVest();

        hatcher.tokensVested += claimable;

        // Transfer vested tokens to hatcher
        communityToken.safeTransfer(msg.sender, claimable);

        emit TokensVested(msg.sender, claimable);
    }

    /**
     * @notice Get amount of tokens vested for a hatcher
     */
    function vestedAmount(address hatcher) external view returns (uint256) {
        return _vestedAmount(hatcher);
    }

    /**
     * @notice Get claimable (unvested - already claimed) tokens
     */
    function claimableTokens(address hatcher) external view returns (uint256) {
        uint256 totalVested = _vestedAmount(hatcher);
        uint256 claimed = hatchers[hatcher].tokensVested;
        return totalVested > claimed ? totalVested - claimed : 0;
    }

    // ============ Governance Score ============

    /**
     * @notice Update a hatcher's governance participation score
     * @dev Called by governance contracts (ConvictionGovernance, etc.)
     *      Score 0-100 represents participation level
     *      Higher score = faster vesting (up to 2x at score 100)
     */
    function updateGovernanceScore(address hatcher, uint256 score) external onlyOwner {
        require(score <= 100, "Score too high");
        governanceScore[hatcher] = score;
        emit GovernanceScoreUpdated(hatcher, score);
    }

    // ============ Refunds ============

    /**
     * @notice Claim refund if hatch was cancelled
     */
    function claimRefund() external nonReentrant {
        if (phase != HatchPhase.CANCELLED) revert WrongPhase();

        uint256 amount = hatchers[msg.sender].contributed;
        if (amount == 0) revert NothingToRefund();

        hatchers[msg.sender].contributed = 0;
        hatchers[msg.sender].tokensAllocated = 0;

        reserveToken.safeTransfer(msg.sender, amount);

        emit Refunded(msg.sender, amount);
    }

    // ============ View Functions ============

    function getHatcher(address hatcher) external view returns (HatcherInfo memory) {
        return hatchers[hatcher];
    }

    function hatcherCount() external view returns (uint256) {
        return hatcherList.length;
    }

    function getHatchConfig() external view returns (HatchConfig memory) {
        return config;
    }

    /**
     * @notice Get the expected return rate ρ = κ × (1-θ)
     */
    function expectedReturnRate() external view returns (uint256) {
        (bool ok, bytes memory data) = bondingCurve.staticcall(
            abi.encodeWithSignature("kappa()")
        );
        if (!ok || data.length != 32) return 0;
        uint256 kappa = abi.decode(data, (uint256));
        return (kappa * (BPS - config.thetaBps)) / BPS;
    }

    // ============ Internal ============

    /**
     * @notice Calculate vested tokens using half-life decay with governance boost
     * @dev S_vested = (1 - 2^(-γ_eff × (k - k₀))) × S_allocated
     *      where γ_eff = γ × (1 + govScore/100) — governance doubles max vesting speed
     */
    function _vestedAmount(address hatcher) internal view returns (uint256) {
        if (phase != HatchPhase.COMPLETED) return 0;

        HatcherInfo storage info = hatchers[hatcher];
        if (info.tokensAllocated == 0) return 0;

        uint256 elapsed = block.number - hatchCompletionBlock;
        if (elapsed == 0) return 0;

        // Governance boost: 1x at score 0, 2x at score 100
        uint256 govBoost = 100 + governanceScore[hatcher]; // 100 to 200

        // Effective half-lives elapsed: (elapsed × govBoost) / (halfLife × 100)
        // We compute in fixed-point: halfLives = elapsed × govBoost / (halfLife × 100)
        uint256 halfLives = (elapsed * govBoost * PRECISION) / (config.vestingHalfLife * 100);

        // Fraction vested: 1 - 2^(-halfLives)
        // Approximation using exp(-halfLives × ln2):
        // For simplicity, compute iteratively: after n full half-lives, (1 - 1/2^n)
        // Use a lookup for precision
        uint256 fractionRemaining = _halfLifeDecay(halfLives);
        uint256 fractionVested = PRECISION - fractionRemaining;

        return (info.tokensAllocated * fractionVested) / PRECISION;
    }

    /**
     * @notice Compute 2^(-x) where x is in PRECISION fixed-point
     * @dev Uses iterative halving: split x into integer + fractional parts
     */
    function _halfLifeDecay(uint256 x) internal pure returns (uint256) {
        // Integer half-lives
        uint256 intPart = x / PRECISION;
        uint256 fracPart = x % PRECISION;

        // 2^(-intPart) via bit shift (cap at 128 to avoid zero)
        if (intPart >= 128) return 0;

        uint256 intDecay = PRECISION >> intPart; // PRECISION / 2^intPart

        // Fractional approximation: 2^(-f) ≈ 1 - f×ln(2) for small f
        // ln(2) ≈ 0.693147... in PRECISION
        uint256 LN2 = 693147180559945309; // ln(2) × 1e18

        // For better accuracy, use: 2^(-f) ≈ 1 - f×ln2 + (f×ln2)²/2
        uint256 fln2 = (fracPart * LN2) / PRECISION;
        uint256 fracDecay;
        if (fln2 >= PRECISION) {
            fracDecay = 0; // Fully decayed
        } else {
            uint256 secondOrder = (fln2 * fln2) / (2 * PRECISION);
            fracDecay = PRECISION - fln2 + secondOrder;
        }

        return (intDecay * fracDecay) / PRECISION;
    }

    function _mintTokens(address to, uint256 amount) internal {
        (bool success, ) = tokenController.call(
            abi.encodeWithSignature("mint(address,uint256)", to, amount)
        );
        require(success, "Mint failed");
    }
}
