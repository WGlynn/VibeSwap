// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/**
 * @title IAugmentedBondingCurve
 * @author Faraday1 & JARVIS -- vibeswap.org
 * @notice Interface for Augmented Bonding Curve with dual pools and conservation invariant
 */
interface IAugmentedBondingCurve {
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

    // ============ Core Mechanisms ============

    /// @notice Deposit reserve to mint community tokens (Mechanism 1: Bond-to-Mint)
    function bondToMint(uint256 depositAmount, uint256 minTokensOut) external returns (uint256 tokensMinted);

    /// @notice Burn community tokens to withdraw reserve (Mechanism 2: Burn-to-Withdraw)
    function burnToWithdraw(uint256 burnAmount, uint256 minReserveOut) external returns (uint256 reserveReturned);

    /// @notice Move funding pool to reserve, minting to recipient (Mechanism 3: Allocate-with-Rebond)
    function allocateWithRebond(uint256 amount, address recipient) external returns (uint256 tokensMinted);

    /// @notice Deposit external revenue to funding pool (Mechanism 4: Deposit)
    function deposit(uint256 amount) external;

    // ============ Views ============

    function spotPrice() external view returns (uint256);
    function quoteBondToMint(uint256 depositAmount) external view returns (uint256 tokensMinted, uint256 tribute);
    function quoteBurnToWithdraw(uint256 burnAmount) external view returns (uint256 reserveOut, uint256 tribute);
    function currentInvariant() external view returns (uint256);

    function getCurveState() external view returns (
        uint256 _reserve,
        uint256 _fundingPool,
        uint256 _supply,
        uint256 price,
        uint256 _invariant,
        bool _isOpen
    );

    // ============ State Getters ============

    function reserve() external view returns (uint256);
    function fundingPool() external view returns (uint256);
    function kappa() external view returns (uint256);
    function invariantV0() external view returns (uint256);
    function entryTributeBps() external view returns (uint16);
    function exitTributeBps() external view returns (uint16);
    function isOpen() external view returns (bool);

    // ============ Admin ============

    function openCurve(uint256 _reserve, uint256 _fundingPool, uint256 _supply) external;
    function setAllocator(address allocator, bool status) external;
    function setHatchManager(address _hatchManager) external;
    function setTributes(uint16 _entryBps, uint16 _exitBps) external;
}
