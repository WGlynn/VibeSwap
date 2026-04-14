// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts-upgradeable/token/ERC20/ERC20Upgradeable.sol";
import "@openzeppelin/contracts-upgradeable/token/ERC20/extensions/ERC20VotesUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/token/ERC20/extensions/ERC20PermitUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/access/OwnableUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/proxy/utils/UUPSUpgradeable.sol";

/**
 * @title CKBNativeToken — State Rent Token (PoS Dimension)
 * @notice The third token of the VibeSwap 3-token model:
 *
 *   VIBE = Proof of Mind (60%) — governance, 21M cap, Shapley-distributed
 *   JUL  = Proof of Work (10%) — SHA-256 mining, elastic supply
 *   CKB-native = Proof of Stake (30%) — state rent, DAO shelter, secondary issuance
 *
 * @dev Nervos CKB economic model applied to CKA (Cell Knowledge Architecture):
 *
 *   STATE RENT: 1 CKB-native = 1 byte of CKA cell state.
 *   Creating a cell locks tokens proportional to cell.capacity.
 *   Locked tokens can't enter DAO → secondary issuance dilutes you.
 *   Cell not worth the rent → destroy it, reclaim tokens, stake in DAO.
 *   State cleans itself through economic pressure.
 *
 *   NO HARD CAP — circulating cap model:
 *   circulatingSupply = totalSupply - totalOccupied
 *   Tokens locked in cells reduce circulating supply.
 *
 *   ENTERS CIRCULATION via JUL burn (JULBridge.sol).
 *   No independent PoW — JUL miners mine JUL, burn JUL to get CKB-native.
 *   Secondary issuance adds new supply on a fixed annual schedule.
 *
 *   "1 token = 1 byte. State rent is not a tax — it's physics." — Will
 */
contract CKBNativeToken is
    ERC20Upgradeable,
    ERC20VotesUpgradeable,
    ERC20PermitUpgradeable,
    OwnableUpgradeable,
    UUPSUpgradeable
{
    // ============ State ============

    /// @notice Authorized minters (JULBridge, SecondaryIssuanceController)
    mapping(address => bool) public minters;

    /// @notice Authorized lockers (StateRentVault)
    mapping(address => bool) public lockers;

    /// @notice Total tokens locked in CKA cells (not circulating)
    uint256 public totalOccupied;

    /// @notice Total ever minted (monotonic)
    uint256 public totalMinted;

    /// @notice Total ever burned
    uint256 public totalBurned;

    /// @notice MON-007: Per-address locked balance tracking
    mapping(address => uint256) public lockedBalance;

    /// @notice C7-GOV-001: Off-circulation registry — contracts holding CKB tokens
    ///         that should count toward off-circulation even though they received
    ///         via standard ERC20 transfer (NCI staking, VibeStable collateral, JCV credits).
    mapping(address => bool) public isOffCirculationHolder;

    /// @notice C7-GOV-001: Enumerable list of off-circulation holders.
    ///         Used by offCirculation() to aggregate balances.
    address[] public offCirculationHolders;

    /// @dev Reserved storage gap for future upgrades (reduced from 49 to 47 after
    ///      adding isOffCirculationHolder mapping + offCirculationHolders array)
    uint256[47] private __gap;

    // ============ Events ============

    event MinterUpdated(address indexed minter, bool authorized);
    event LockerUpdated(address indexed locker, bool authorized);
    event TokensLocked(address indexed owner, uint256 amount);
    event TokensUnlocked(address indexed owner, uint256 amount);
    event TokensBurned(address indexed burner, uint256 amount);
    event OffCirculationHolderSet(address indexed holder, bool enabled);

    // ============ Errors ============

    error Unauthorized();
    error ZeroAddress();
    error ZeroAmount();
    error InsufficientLockedBalance();

    // ============ Initializer ============

    /// @custom:oz-upgrades-unsafe-allow constructor
    constructor() {
        _disableInitializers();
    }

    function initialize(address _owner) external initializer {
        __ERC20_init("CKB Native", "CKBn");
        __ERC20Votes_init();
        __ERC20Permit_init("CKB Native");
        __Ownable_init(_owner);
        __UUPSUpgradeable_init();
    }

    // ============ Minting ============

    /**
     * @notice Mint CKB-native tokens (only authorized minters)
     * @dev Called by JULBridge (burn-to-mint) and SecondaryIssuanceController
     */
    function mint(address to, uint256 amount) external {
        if (!minters[msg.sender]) revert Unauthorized();
        if (to == address(0)) revert ZeroAddress();
        if (amount == 0) revert ZeroAmount();

        totalMinted += amount;
        _mint(to, amount);
    }

    // ============ Burning ============

    /**
     * @notice Burn CKB-native from caller's balance
     */
    function burn(uint256 amount) external {
        if (amount == 0) revert ZeroAmount();
        totalBurned += amount;
        _burn(msg.sender, amount);
        emit TokensBurned(msg.sender, amount);
    }

    /**
     * @notice Burn CKB-native from a specific address (requires allowance)
     * @dev Used by JULBridge or other authorized contracts
     */
    function burnFrom(address from, uint256 amount) external {
        if (amount == 0) revert ZeroAmount();
        _spendAllowance(from, msg.sender, amount);
        totalBurned += amount;
        _burn(from, amount);
        emit TokensBurned(from, amount);
    }

    // ============ State Rent (Lock/Unlock) ============

    /**
     * @notice Lock tokens for CKA cell capacity (state rent)
     * @dev Only authorized lockers (StateRentVault) can call.
     *      MON-001: Uses allowance check — lockers cannot drain arbitrary addresses.
     *      The caller (locker contract) must be approved by the token owner.
     * @param from Token owner
     * @param amount Tokens to lock (1 token = 1 byte of cell capacity)
     */
    function lock(address from, uint256 amount) external {
        if (!lockers[msg.sender]) revert Unauthorized();
        if (amount == 0) revert ZeroAmount();

        // MON-001: Enforce allowance — locker must be approved by token owner
        _spendAllowance(from, msg.sender, amount);
        _transfer(from, address(this), amount);
        totalOccupied += amount;
        // MON-007: Track per-user locked balance
        lockedBalance[from] += amount;

        emit TokensLocked(from, amount);
    }

    /**
     * @notice Unlock tokens from CKA cell capacity (cell destroyed)
     * @dev Returns tokens to the cell owner when they destroy a cell.
     *      MON-007: Validates per-user locked balance to prevent cross-user unlock.
     * @param to Token recipient (cell owner)
     * @param amount Tokens to unlock
     */
    function unlock(address to, uint256 amount) external {
        if (!lockers[msg.sender]) revert Unauthorized();
        if (amount == 0) revert ZeroAmount();
        if (totalOccupied < amount) revert InsufficientLockedBalance();
        // MON-007: Validate per-user locked balance
        if (lockedBalance[to] < amount) revert InsufficientLockedBalance();

        totalOccupied -= amount;
        lockedBalance[to] -= amount;
        _transfer(address(this), to, amount);

        emit TokensUnlocked(to, amount);
    }

    // ============ Admin ============

    function setMinter(address minter, bool authorized) external onlyOwner {
        if (minter == address(0)) revert ZeroAddress();
        minters[minter] = authorized;
        emit MinterUpdated(minter, authorized);
    }

    function setLocker(address locker, bool authorized) external onlyOwner {
        if (locker == address(0)) revert ZeroAddress();
        lockers[locker] = authorized;
        emit LockerUpdated(locker, authorized);
    }

    /**
     * @notice C7-GOV-001: Register/unregister an off-circulation token holder.
     * @dev Used for contracts like NCI (staking), VibeStable (collateral), JCV
     *      (compute credits) that hold CKB tokens via standard ERC20 transfer.
     *      Their balance counts toward offCirculation() for issuance accounting.
     * @param holder Contract address holding off-circulation CKB tokens
     * @param enabled True to register, false to unregister
     */
    function setOffCirculationHolder(address holder, bool enabled) external onlyOwner {
        if (holder == address(0)) revert ZeroAddress();
        // C9-AUDIT-4: prevent double-counting — cell-locked tokens held on
        // address(this) already count via totalOccupied.
        require(holder != address(this), "Cannot register self");
        // C9-AUDIT-6: require real contract code. EOAs can move balance freely
        // (doesn't match the "locked in a staking/collateral contract"
        // semantics). Also rules out CREATE2-unverified pre-deploy addresses.
        // Deregistration path bypasses this check — the enabled == false branch
        // below runs before this require because we only enforce on enable.
        if (enabled) {
            require(holder.code.length > 0, "Not a contract");
        }

        if (enabled && !isOffCirculationHolder[holder]) {
            isOffCirculationHolder[holder] = true;
            offCirculationHolders.push(holder);
        } else if (!enabled && isOffCirculationHolder[holder]) {
            isOffCirculationHolder[holder] = false;
            // Swap-and-pop: find and remove from array (O(n), n is small)
            uint256 len = offCirculationHolders.length;
            for (uint256 i = 0; i < len; i++) {
                if (offCirculationHolders[i] == holder) {
                    offCirculationHolders[i] = offCirculationHolders[len - 1];
                    offCirculationHolders.pop();
                    break;
                }
            }
        }

        emit OffCirculationHolderSet(holder, enabled);
    }

    // ============ View Functions ============

    /// @notice Circulating supply = totalSupply - offCirculation
    /// @dev Off-circulation includes both cell-locked tokens (totalOccupied) and
    ///      tokens held by registered staking/collateral contracts (C7-GOV-001).
    function circulatingSupply() external view returns (uint256) {
        return totalSupply() - offCirculation();
    }

    /// @notice How much state is occupied (in tokens = bytes)
    function occupiedState() external view returns (uint256) {
        return totalOccupied;
    }

    /**
     * @notice C7-GOV-001: Total off-circulation CKB = cell-locked + registered holder balances.
     * @dev Aggregates totalOccupied (cell state rent) with balances of all registered
     *      off-circulation holders (NCI staking, VibeStable collateral, JCV credits).
     *      Used by SecondaryIssuanceController to compute accurate shard share.
     * @return Total CKB tokens out of circulation
     */
    function offCirculation() public view returns (uint256) {
        uint256 total = totalOccupied;
        uint256 len = offCirculationHolders.length;
        for (uint256 i = 0; i < len; i++) {
            total += balanceOf(offCirculationHolders[i]);
        }
        return total;
    }

    /// @notice Number of registered off-circulation holders
    function offCirculationHolderCount() external view returns (uint256) {
        return offCirculationHolders.length;
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

    function _authorizeUpgrade(address newImplementation) internal override onlyOwner {
        require(newImplementation.code.length > 0, "Not a contract");
    }
}
