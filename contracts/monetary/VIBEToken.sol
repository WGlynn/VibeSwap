// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts-upgradeable/token/ERC20/ERC20Upgradeable.sol";
import "@openzeppelin/contracts-upgradeable/token/ERC20/extensions/ERC20VotesUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/token/ERC20/extensions/ERC20PermitUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/access/OwnableUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/proxy/utils/UUPSUpgradeable.sol";

/**
 * @title VIBEToken — Governance & Reward Token
 * @notice The VIBE token is the governance and contribution reward token of
 *         the VibeSwap Operating System (VSOS). It is minted exclusively
 *         through demonstrated contribution — never pre-mined, never airdropped.
 *
 * @dev Design Philosophy (Bitcoin-aligned):
 *
 *   MAX SUPPLY: 21,000,000 VIBE — hard cap, never increased.
 *
 *   ZERO INITIAL SUPPLY — All VIBE is earned through contribution:
 *     - ShapleyDistributor: TOKEN_EMISSION games with Bitcoin-style halving (32 eras)
 *     - LiquidityGauge: LP staking emissions (gauge-weighted)
 *     - SingleStaking: Governance staking rewards
 *
 *   EMISSION SCHEDULE (enforced by ShapleyDistributor):
 *     - Era 0: 100% emission multiplier
 *     - Era 1: 50% (first halving)
 *     - Era 2: 25% ... down to Era 31: ~0.00000005%
 *     - 52,560 games per era (~1 year at 1 game per 10 minutes)
 *     - After 32 halvings, new emissions effectively cease
 *
 *   PAIRWISE FAIRNESS:
 *     - Shapley values ensure reward_A / reward_B = weight_A / weight_B
 *     - Global reward allocation solved through local pairwise comparisons
 *     - PairwiseFairness library provides on-chain audit of proportionality
 *     - Any participant can verify fairness via verifyPairwiseFairness()
 *
 *   GOVERNANCE:
 *     - ERC20Votes delegation for on-chain voting (ConvictionGovernance, QuadraticVoting)
 *     - ERC20Permit for gasless approvals
 *     - Anti-spam staking in IdeaMarketplace (100 VIBE minimum)
 *
 *   TWO-TOKEN MODEL:
 *     - VIBE = governance + reward (Shapley-distributed, halving schedule)
 *     - JUL  = stable liquidity asset (PoW-mined, elastic rebase, no cap)
 *     - Composable: SingleStaking enables Stake JUL → earn VIBE and vice versa
 *
 * See: docs/TIME_NEUTRAL_TOKENOMICS.md for formal proofs
 */
contract VIBEToken is
    ERC20Upgradeable,
    ERC20VotesUpgradeable,
    ERC20PermitUpgradeable,
    OwnableUpgradeable,
    UUPSUpgradeable
{
    // ============ Constants ============

    /// @notice Maximum supply: 21 million VIBE (Bitcoin-aligned hard cap)
    uint256 public constant MAX_SUPPLY = 21_000_000e18;

    // ============ State ============

    /// @notice Authorized minters (ShapleyDistributor, LiquidityGauge, etc.)
    mapping(address => bool) public minters;

    /// @notice Total VIBE ever minted (monotonic, unaffected by burns)
    uint256 public totalMinted;

    /// @notice Total VIBE burned (for deflationary tracking)
    uint256 public totalBurned;

    // ============ Events ============

    event MinterUpdated(address indexed minter, bool authorized);
    event TokensBurned(address indexed burner, uint256 amount);

    // ============ Errors ============

    error Unauthorized();
    error ExceedsMaxSupply();
    error ZeroAddress();
    error ZeroAmount();

    // ============ Initializer ============

    /// @custom:oz-upgrades-unsafe-allow constructor
    constructor() {
        _disableInitializers();
    }

    function initialize(address _owner) external initializer {
        __ERC20_init("VIBE", "VIBE");
        __ERC20Votes_init();
        __ERC20Permit_init("VIBE");
        __Ownable_init(_owner);
        __UUPSUpgradeable_init();

        // Zero initial supply — all VIBE earned through contribution
        // No pre-mine. No founder allocation at deploy time.
        // Founders get retroactive Shapley claims with 3-factor validation.
    }

    // ============ Minting ============

    /**
     * @notice Mint VIBE to a recipient (only authorized minters)
     * @dev Called by ShapleyDistributor for TOKEN_EMISSION games,
     *      by LiquidityGauge for LP staking emissions, etc.
     *      Halving schedule is enforced by ShapleyDistributor, not here.
     *      This contract only enforces the absolute MAX_SUPPLY cap.
     * @param to Recipient address
     * @param amount Amount of VIBE to mint
     */
    function mint(address to, uint256 amount) external {
        if (!minters[msg.sender] && msg.sender != owner()) revert Unauthorized();
        if (to == address(0)) revert ZeroAddress();
        if (amount == 0) revert ZeroAmount();
        if (totalSupply() + amount > MAX_SUPPLY) revert ExceedsMaxSupply();

        totalMinted += amount;
        _mint(to, amount);
    }

    // ============ Burning ============

    /**
     * @notice Burn VIBE from caller's balance
     * @dev Anyone can burn their own tokens (deflationary mechanism).
     *      Burns reduce circulating supply but not MAX_SUPPLY cap.
     * @param amount Amount of VIBE to burn
     */
    function burn(uint256 amount) external {
        if (amount == 0) revert ZeroAmount();
        totalBurned += amount;
        _burn(msg.sender, amount);
        emit TokensBurned(msg.sender, amount);
    }

    // ============ Admin ============

    /**
     * @notice Authorize or revoke a minter
     * @dev Only ShapleyDistributor, LiquidityGauge, and governance-approved
     *      contracts should be authorized as minters.
     * @param minter Address to authorize/revoke
     * @param authorized True to authorize, false to revoke
     */
    function setMinter(address minter, bool authorized) external onlyOwner {
        if (minter == address(0)) revert ZeroAddress();
        minters[minter] = authorized;
        emit MinterUpdated(minter, authorized);
    }

    // ============ View Functions ============

    /// @notice Remaining VIBE that can ever be minted
    function mintableSupply() external view returns (uint256) {
        uint256 current = totalSupply();
        return current >= MAX_SUPPLY ? 0 : MAX_SUPPLY - current;
    }

    /// @notice Circulating supply (total minted minus burned)
    function circulatingSupply() external view returns (uint256) {
        return totalMinted - totalBurned;
    }

    // ============ Required Overrides ============

    function _update(
        address from,
        address to,
        uint256 value
    ) internal override(ERC20Upgradeable, ERC20VotesUpgradeable) {
        super._update(from, to, value);
    }

    function nonces(
        address owner_
    ) public view override(ERC20PermitUpgradeable, NoncesUpgradeable) returns (uint256) {
        return super.nonces(owner_);
    }

    // ============ UUPS ============

    function _authorizeUpgrade(address) internal override onlyOwner {}
}
