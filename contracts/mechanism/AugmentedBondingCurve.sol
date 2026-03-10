// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "@openzeppelin/contracts/utils/math/Math.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

/**
 * @title AugmentedBondingCurve
 * @author W. Glynn (Faraday1) & JARVIS -- vibeswap.org
 * @notice Power-function bonding curve with dual pools (Reserve + Funding),
 *         entry/exit tributes, and conservation invariant V(R,S) = S^κ / R.
 * @dev Based on Zargham, Shorish, Paruch — "From Curved Bonding to Configuration Spaces"
 *      (ICBC 2020) and Abbey Titcomb / Commons Stack.
 *
 *      The system enforces a 2-manifold configuration space:
 *        X_C = {(R, S, P, F) | V(R,S) = V₀, P = κR/S}
 *      Price is DERIVED from state, never stored independently.
 *
 *      Four formal mechanisms:
 *        1. bondToMint   — deposit reserve, mint supply (entry tribute → F)
 *        2. burnToWithdraw — burn supply, withdraw reserve (exit tribute → F)
 *        3. allocateWithRebond — funding pool → reserve + mint to recipient
 *        4. deposit — external revenue → funding pool (no curve effect)
 *
 *      P-000: Fairness Above All — exit tributes fund the commons, not extractors.
 */
contract AugmentedBondingCurve is Ownable, ReentrancyGuard {
    using SafeERC20 for IERC20;

    // ============ Constants ============

    uint256 public constant PRECISION = 1e18;
    uint256 public constant BPS = 10000;
    uint256 public constant MAX_KAPPA = 10;
    uint256 public constant MIN_KAPPA = 2;
    uint256 public constant MAX_TRIBUTE_BPS = 5000; // 50%

    /// @notice Lawson Constant — attribution that travels with forks
    bytes32 public constant LAWSON_CONSTANT = keccak256("FAIRNESS_ABOVE_ALL:W.GLYNN:2026");

    // ============ State ============

    /// @notice Reserve token (e.g., DAI, USDC)
    IERC20 public reserveToken;

    /// @notice Community token minted/burned by the curve
    IERC20 public communityToken;

    /// @notice Address that can mint/burn the community token
    address public tokenController;

    /// @notice Reserve pool — bonded to curve, backs token value
    uint256 public reserve;

    /// @notice Funding pool — floating reserve for commons allocation
    uint256 public fundingPool;

    /// @notice Curve exponent κ (kappa) — polynomial degree, scaled by PRECISION
    /// @dev κ = 6 means kappa = 6e18. Must be >= 2 and <= 10.
    uint256 public kappa;

    /// @notice Invariant constant V₀ = S^κ / R (set at initialization)
    uint256 public invariantV0;

    /// @notice Entry tribute in basis points (% of deposit → funding pool)
    uint16 public entryTributeBps;

    /// @notice Exit tribute in basis points (% of withdrawal → funding pool)
    uint16 public exitTributeBps;

    /// @notice Whether the curve is in open phase (post-hatch)
    bool public isOpen;

    /// @notice Address authorized to call allocateWithRebond (governance)
    mapping(address => bool) public allocators;

    /// @notice HatchManager contract (can initialize the curve)
    address public hatchManager;

    // ============ Events ============

    event BondedToMint(address indexed buyer, uint256 depositAmount, uint256 tokensMinted, uint256 entryTribute);
    event BurnedToWithdraw(address indexed seller, uint256 tokensBurned, uint256 reserveReturned, uint256 exitTribute);
    event AllocatedWithRebond(address indexed recipient, uint256 fundingAmount, uint256 tokensMinted);
    event ExternalDeposit(address indexed depositor, uint256 amount);
    event CurveOpened(uint256 reserve, uint256 supply, uint256 spotPrice);
    event TributesUpdated(uint16 entryBps, uint16 exitBps);

    // ============ Errors ============

    error NotOpen();
    error AlreadyOpen();
    error ZeroAmount();
    error InsufficientFunding();
    error InvalidKappa();
    error SlippageExceeded();
    error NotAllocator();
    error NotHatchManager();
    error InvariantViolated();

    // ============ Modifiers ============

    modifier onlyOpen() {
        if (!isOpen) revert NotOpen();
        _;
    }

    modifier onlyAllocator() {
        if (!allocators[msg.sender]) revert NotAllocator();
        _;
    }

    // ============ Constructor ============

    constructor(
        address _reserveToken,
        address _communityToken,
        address _tokenController,
        uint256 _kappa,
        uint16 _entryTributeBps,
        uint16 _exitTributeBps
    ) Ownable(msg.sender) {
        require(_reserveToken != address(0), "Zero reserve token");
        require(_communityToken != address(0), "Zero community token");
        require(_tokenController != address(0), "Zero controller");
        if (_kappa < MIN_KAPPA || _kappa > MAX_KAPPA) revert InvalidKappa();
        require(_entryTributeBps <= MAX_TRIBUTE_BPS, "Entry tribute too high");
        require(_exitTributeBps <= MAX_TRIBUTE_BPS, "Exit tribute too high");

        reserveToken = IERC20(_reserveToken);
        communityToken = IERC20(_communityToken);
        tokenController = _tokenController;
        kappa = _kappa;
        entryTributeBps = _entryTributeBps;
        exitTributeBps = _exitTributeBps;
    }

    // ============ Initialization (called by HatchManager) ============

    /**
     * @notice Initialize the curve after hatch phase completes
     * @param _reserve Initial reserve (R₀ = d₀ × (1-θ))
     * @param _fundingPool Initial funding pool (F₀ = d₀ × θ)
     * @param _supply Initial token supply (S₀ = d₀ / p₀)
     */
    function openCurve(
        uint256 _reserve,
        uint256 _fundingPool,
        uint256 _supply
    ) external {
        if (msg.sender != hatchManager && msg.sender != owner()) revert NotHatchManager();
        if (isOpen) revert AlreadyOpen();
        require(_reserve > 0 && _supply > 0, "Zero init");

        reserve = _reserve;
        fundingPool = _fundingPool;

        // Compute invariant: V₀ = S^κ / R
        invariantV0 = _pow(_supply, kappa) / _reserve;
        require(invariantV0 > 0, "V0 must be positive");

        isOpen = true;

        uint256 openPrice = _spotPrice(_reserve, _supply);
        emit CurveOpened(_reserve, _supply, openPrice);
    }

    // ============ Mechanism 1: Bond-to-Mint ============

    /**
     * @notice Deposit reserve tokens to mint community tokens
     * @param depositAmount Amount of reserve tokens to deposit
     * @param minTokensOut Minimum tokens to receive (slippage protection)
     * @return tokensMinted Number of community tokens minted
     */
    function bondToMint(
        uint256 depositAmount,
        uint256 minTokensOut
    ) external nonReentrant onlyOpen returns (uint256 tokensMinted) {
        if (depositAmount == 0) revert ZeroAmount();

        // Entry tribute: portion goes to funding pool
        uint256 tribute = (depositAmount * entryTributeBps) / BPS;
        uint256 netDeposit = depositAmount - tribute;

        // Current supply
        uint256 currentSupply = communityToken.totalSupply();

        // New reserve after deposit
        uint256 newReserve = reserve + netDeposit;

        // New supply from invariant: S⁺ = (V₀ × R⁺)^(1/κ)
        uint256 newSupply = _powInverse(Math.mulDiv(invariantV0, newReserve, 1), kappa, currentSupply);

        tokensMinted = newSupply - currentSupply;
        if (tokensMinted < minTokensOut) revert SlippageExceeded();

        // Transfer reserve from buyer
        reserveToken.safeTransferFrom(msg.sender, address(this), depositAmount);

        // Update state
        reserve = newReserve;
        fundingPool += tribute;

        // Mint tokens to buyer
        _mintTokens(msg.sender, tokensMinted);

        // Verify invariant
        _checkInvariant(newReserve, newSupply);

        emit BondedToMint(msg.sender, depositAmount, tokensMinted, tribute);
    }

    // ============ Mechanism 2: Burn-to-Withdraw ============

    /**
     * @notice Burn community tokens to withdraw reserve tokens
     * @param burnAmount Number of community tokens to burn
     * @param minReserveOut Minimum reserve tokens to receive (slippage protection)
     * @return reserveReturned Amount of reserve tokens returned (after exit tribute)
     */
    function burnToWithdraw(
        uint256 burnAmount,
        uint256 minReserveOut
    ) external nonReentrant onlyOpen returns (uint256 reserveReturned) {
        if (burnAmount == 0) revert ZeroAmount();

        uint256 currentSupply = communityToken.totalSupply();
        require(burnAmount <= currentSupply, "Burn exceeds supply");

        uint256 newSupply = currentSupply - burnAmount;
        require(newSupply > 0, "Cannot burn entire supply");

        // New reserve from invariant: R⁺ = S⁺^κ / V₀
        uint256 newReserve = _pow(newSupply, kappa) / invariantV0;

        uint256 grossReserveOut = reserve - newReserve;

        // Exit tribute: portion goes to funding pool (sandwich attack defense)
        uint256 tribute = (grossReserveOut * exitTributeBps) / BPS;
        reserveReturned = grossReserveOut - tribute;

        if (reserveReturned < minReserveOut) revert SlippageExceeded();

        // Burn tokens from seller
        _burnTokens(msg.sender, burnAmount);

        // Update state
        reserve = newReserve;
        fundingPool += tribute;

        // Transfer reserve to seller
        reserveToken.safeTransfer(msg.sender, reserveReturned);

        // Verify invariant
        _checkInvariant(newReserve, newSupply);

        emit BurnedToWithdraw(msg.sender, burnAmount, reserveReturned, tribute);
    }

    // ============ Mechanism 3: Allocate-with-Rebond ============

    /**
     * @notice Allocate from funding pool to reserve, minting tokens to recipient
     * @dev Only callable by authorized allocators (governance contracts)
     *      This is a special case of bond-to-mint where the bonded tokens
     *      come from Funding Pool and minted tokens go to a community-chosen address.
     * @param amount Reserve tokens to move from funding pool to reserve
     * @param recipient Address to receive newly minted tokens
     * @return tokensMinted Number of community tokens minted to recipient
     */
    function allocateWithRebond(
        uint256 amount,
        address recipient
    ) external nonReentrant onlyOpen onlyAllocator returns (uint256 tokensMinted) {
        if (amount == 0) revert ZeroAmount();
        if (amount > fundingPool) revert InsufficientFunding();
        require(recipient != address(0), "Zero recipient");

        uint256 currentSupply = communityToken.totalSupply();
        uint256 newReserve = reserve + amount;

        // New supply from invariant
        uint256 newSupply = _powInverse(Math.mulDiv(invariantV0, newReserve, 1), kappa, currentSupply);
        tokensMinted = newSupply - currentSupply;

        // Move funds from funding pool to reserve
        fundingPool -= amount;
        reserve = newReserve;

        // Mint tokens to recipient
        _mintTokens(recipient, tokensMinted);

        // Verify invariant
        _checkInvariant(newReserve, newSupply);

        emit AllocatedWithRebond(recipient, amount, tokensMinted);
    }

    // ============ Mechanism 4: External Deposit ============

    /**
     * @notice Deposit external revenue to funding pool (no curve effect)
     * @dev F⁺ = F + r, all other state unchanged
     * @param amount Reserve tokens to deposit
     */
    function deposit(uint256 amount) external nonReentrant {
        if (amount == 0) revert ZeroAmount();

        reserveToken.safeTransferFrom(msg.sender, address(this), amount);
        fundingPool += amount;

        emit ExternalDeposit(msg.sender, amount);
    }

    // ============ View Functions ============

    /**
     * @notice Get current spot price P = κR/S
     */
    function spotPrice() external view returns (uint256) {
        uint256 supply = communityToken.totalSupply();
        if (supply == 0) return 0;
        return _spotPrice(reserve, supply);
    }

    /**
     * @notice Quote how many tokens would be minted for a given deposit
     */
    function quoteBondToMint(uint256 depositAmount) external view returns (uint256 tokensMinted, uint256 tribute) {
        tribute = (depositAmount * entryTributeBps) / BPS;
        uint256 netDeposit = depositAmount - tribute;
        uint256 newReserve = reserve + netDeposit;
        uint256 currentSupply = communityToken.totalSupply();
        uint256 newSupply = _powInverse(Math.mulDiv(invariantV0, newReserve, 1), kappa, currentSupply);
        tokensMinted = newSupply > currentSupply ? newSupply - currentSupply : 0;
    }

    /**
     * @notice Quote how much reserve would be returned for burning tokens
     */
    function quoteBurnToWithdraw(uint256 burnAmount) external view returns (uint256 reserveOut, uint256 tribute) {
        uint256 currentSupply = communityToken.totalSupply();
        if (burnAmount >= currentSupply) return (0, 0);
        uint256 newSupply = currentSupply - burnAmount;
        uint256 newReserve = _pow(newSupply, kappa) / invariantV0;
        uint256 grossOut = reserve > newReserve ? reserve - newReserve : 0;
        tribute = (grossOut * exitTributeBps) / BPS;
        reserveOut = grossOut - tribute;
    }

    /**
     * @notice Get the conservation invariant value (should be constant)
     */
    function currentInvariant() external view returns (uint256) {
        uint256 supply = communityToken.totalSupply();
        if (supply == 0 || reserve == 0) return 0;
        return _pow(supply, kappa) / reserve;
    }

    /**
     * @notice Get full curve state
     */
    function getCurveState() external view returns (
        uint256 _reserve,
        uint256 _fundingPool,
        uint256 _supply,
        uint256 price,
        uint256 _invariant,
        bool _isOpen
    ) {
        uint256 supply = communityToken.totalSupply();
        _reserve = reserve;
        _fundingPool = fundingPool;
        _supply = supply;
        price = supply > 0 ? _spotPrice(reserve, supply) : 0;
        _invariant = invariantV0;
        _isOpen = isOpen;
    }

    // ============ Admin ============

    function setAllocator(address allocator, bool status) external onlyOwner {
        allocators[allocator] = status;
    }

    function setHatchManager(address _hatchManager) external onlyOwner {
        hatchManager = _hatchManager;
    }

    function setTributes(uint16 _entryBps, uint16 _exitBps) external onlyOwner {
        require(_entryBps <= MAX_TRIBUTE_BPS, "Entry too high");
        require(_exitBps <= MAX_TRIBUTE_BPS, "Exit too high");
        entryTributeBps = _entryBps;
        exitTributeBps = _exitBps;
        emit TributesUpdated(_entryBps, _exitBps);
    }

    // ============ Internal Math ============

    /**
     * @notice Compute spot price: P = κ × R / S
     */
    function _spotPrice(uint256 R, uint256 S) internal view returns (uint256) {
        return (kappa * R * PRECISION) / S;
    }

    /**
     * @notice Integer power: base^exp (PRECISION-scaled)
     * @dev Uses Math.mulDiv for overflow-safe 512-bit intermediate results.
     *      Works for κ ≤ 10 with any uint256 base.
     */
    function _pow(uint256 base, uint256 exp) internal pure returns (uint256 result) {
        result = PRECISION;
        uint256 b = base;
        for (uint256 i = 0; i < exp; i++) {
            result = Math.mulDiv(result, b, PRECISION);
        }
    }

    /**
     * @notice Find x such that _pow(x, n) ≈ target, using hint as starting point
     * @dev Newton's method starting from hint (typically current supply).
     *      Converges in 5-10 iterations when hint is close to answer.
     *      x' = ((n-1) × x + target × PRECISION / _pow(x, n-1)) / n
     * @param target The value that _pow(result, n) should equal
     * @param n The exponent (kappa)
     * @param hint Starting guess (e.g., current supply)
     */
    function _powInverse(uint256 target, uint256 n, uint256 hint) internal pure returns (uint256) {
        if (target == 0) return 0;
        if (n == 1) return target;
        if (hint == 0) hint = PRECISION; // fallback minimum guess

        uint256 guess = hint;

        for (uint256 i = 0; i < 60; i++) {
            uint256 powNm1 = _pow(guess, n - 1);
            if (powNm1 == 0) {
                guess = guess / 2;
                if (guess == 0) guess = PRECISION;
                continue;
            }

            // quotient = target × PRECISION / _pow(guess, n-1)
            uint256 quotient = Math.mulDiv(target, PRECISION, powNm1);
            uint256 newGuess = ((n - 1) * guess + quotient) / n;

            if (newGuess == 0) break;

            uint256 diff = newGuess > guess ? newGuess - guess : guess - newGuess;
            if (diff <= 1) break;

            guess = newGuess;
        }

        return guess;
    }

    /**
     * @notice Verify the conservation invariant V(R,S) = V₀
     * @dev Allows small rounding tolerance (0.01%) due to integer math
     */
    function _checkInvariant(uint256 R, uint256 S) internal view {
        if (S == 0 || R == 0) return;
        uint256 currentV = _pow(S, kappa) / R;

        // Allow 0.01% tolerance for rounding
        uint256 tolerance = invariantV0 / 10000;
        if (tolerance == 0) tolerance = 1;

        if (currentV > invariantV0 + tolerance || currentV + tolerance < invariantV0) {
            revert InvariantViolated();
        }
    }

    /**
     * @notice Mint community tokens (calls token controller)
     * @dev Token controller must implement mint(address, uint256)
     */
    function _mintTokens(address to, uint256 amount) internal {
        (bool success, ) = tokenController.call(
            abi.encodeWithSignature("mint(address,uint256)", to, amount)
        );
        require(success, "Mint failed");
    }

    /**
     * @notice Burn community tokens (calls token controller)
     * @dev Token controller must implement burnFrom(address, uint256)
     */
    function _burnTokens(address from, uint256 amount) internal {
        (bool success, ) = tokenController.call(
            abi.encodeWithSignature("burnFrom(address,uint256)", from, amount)
        );
        require(success, "Burn failed");
    }
}
