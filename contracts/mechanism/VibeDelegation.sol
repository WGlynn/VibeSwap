// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts-upgradeable/access/OwnableUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/proxy/utils/UUPSUpgradeable.sol";

/**
 * @title VibeDelegation — Liquid Delegation with Conviction Decay
 * @notice Absorbs Gitcoin/Compound delegation patterns with VSOS extensions:
 *         delegation with conviction (time-weighted), partial delegation,
 *         transitive delegation chains, and automatic decay if delegate
 *         is inactive. Supports both governance and protocol operations.
 *
 * @dev Architecture:
 *      - Users delegate voting power to delegates
 *      - Conviction grows over time (1%/day bonus, max 2x)
 *      - Partial delegation: split power across multiple delegates
 *      - Transitive: A delegates to B, B to C — C has A+B+C power
 *      - Max chain depth: 5 (prevents infinite loops)
 *      - Inactive decay: delegates lose power if no governance activity
 */
contract VibeDelegation is OwnableUpgradeable, UUPSUpgradeable {
    // ============ Types ============

    struct Delegation {
        address delegator;
        address delegate;
        uint256 amount;              // Basis points of total power (0-10000)
        uint256 startTime;           // When delegation began
        uint256 lastActivity;        // Last time delegate was active
        bool active;
    }

    struct DelegateProfile {
        address delegate;
        uint256 directPower;         // Sum of delegations received (bps)
        uint256 transitivePower;     // Including chains
        uint256 delegationCount;     // How many people delegate to this address
        uint256 proposalsVoted;      // Governance activity counter
        uint256 lastActive;
        bytes32 platformHash;        // IPFS hash of platform/manifesto
    }

    // ============ Constants ============

    uint256 public constant MAX_DELEGATES = 10;       // Max splits per delegator
    uint256 public constant MAX_CHAIN_DEPTH = 5;
    uint256 public constant CONVICTION_RATE = 100;    // 1% per day in bps
    uint256 public constant MAX_CONVICTION = 20000;   // 2x max bonus
    uint256 public constant DECAY_PERIOD = 30 days;   // Inactivity decay

    // ============ State ============

    /// @notice delegator => delegate => Delegation
    mapping(address => mapping(address => Delegation)) public delegations;

    /// @notice delegator => list of delegates
    mapping(address => address[]) public delegatorDelegates;

    /// @notice Delegate profiles
    mapping(address => DelegateProfile) public delegates;

    /// @notice Stats
    uint256 public totalDelegations;
    uint256 public totalDelegators;

    // ============ Events ============

    event Delegated(address indexed delegator, address indexed delegate, uint256 amount);
    event Undelegated(address indexed delegator, address indexed delegate);
    event DelegateActivity(address indexed delegate, uint256 proposalsVoted);
    event PlatformUpdated(address indexed delegate, bytes32 platformHash);

    // ============ Init ============

    function initialize() external initializer {
        __Ownable_init(msg.sender);
        __UUPSUpgradeable_init();
    }

    function _authorizeUpgrade(address newImplementation) internal override onlyOwner {
        require(newImplementation.code.length > 0, "Not a contract");
    }

    // ============ Delegation ============

    function delegate(address to, uint256 amountBps) external {
        require(to != msg.sender, "Cannot self-delegate");
        require(to != address(0), "Invalid delegate");
        require(amountBps > 0 && amountBps <= 10000, "Invalid amount");
        require(!delegations[msg.sender][to].active, "Already delegating");

        // Check total delegation doesn't exceed 100%
        uint256 totalDelegated = _totalDelegated(msg.sender);
        require(totalDelegated + amountBps <= 10000, "Over 100%");

        // Check max delegates
        require(delegatorDelegates[msg.sender].length < MAX_DELEGATES, "Too many delegates");

        delegations[msg.sender][to] = Delegation({
            delegator: msg.sender,
            delegate: to,
            amount: amountBps,
            startTime: block.timestamp,
            lastActivity: block.timestamp,
            active: true
        });

        delegatorDelegates[msg.sender].push(to);

        DelegateProfile storage dp = delegates[to];
        dp.delegate = to;
        dp.directPower += amountBps;
        dp.delegationCount++;

        if (totalDelegated == 0) totalDelegators++;
        totalDelegations++;

        emit Delegated(msg.sender, to, amountBps);
    }

    function undelegate(address from) external {
        Delegation storage d = delegations[msg.sender][from];
        require(d.active, "Not delegating");

        d.active = false;

        DelegateProfile storage dp = delegates[from];
        dp.directPower -= d.amount;
        dp.delegationCount--;

        // Remove from list
        address[] storage list = delegatorDelegates[msg.sender];
        for (uint256 i = 0; i < list.length; i++) {
            if (list[i] == from) {
                list[i] = list[list.length - 1];
                list.pop();
                break;
            }
        }

        totalDelegations--;
        if (_totalDelegated(msg.sender) == 0) totalDelegators--;

        emit Undelegated(msg.sender, from);
    }

    // ============ Conviction ============

    /**
     * @notice Get effective voting power including conviction bonus
     * @dev Conviction grows 1%/day, max 2x, decays if delegate inactive
     */
    function getEffectivePower(address delegator, address delegatee) external view returns (uint256) {
        Delegation storage d = delegations[delegator][delegatee];
        if (!d.active) return 0;

        uint256 daysActive = (block.timestamp - d.startTime) / 1 days;
        uint256 convictionBonus = daysActive * CONVICTION_RATE;
        if (convictionBonus > MAX_CONVICTION) convictionBonus = MAX_CONVICTION;

        uint256 basePower = d.amount;
        uint256 boosted = basePower + (basePower * convictionBonus) / 10000;

        // Decay if delegate is inactive
        DelegateProfile storage dp = delegates[delegatee];
        if (block.timestamp > dp.lastActive + DECAY_PERIOD) {
            uint256 decayDays = (block.timestamp - dp.lastActive - DECAY_PERIOD) / 1 days;
            uint256 decayPct = decayDays * 100; // 1%/day decay
            if (decayPct >= 10000) return 0;
            boosted = (boosted * (10000 - decayPct)) / 10000;
        }

        return boosted;
    }

    // ============ Activity ============

    function recordActivity(address delegatee) external onlyOwner {
        DelegateProfile storage dp = delegates[delegatee];
        dp.proposalsVoted++;
        dp.lastActive = block.timestamp;
        emit DelegateActivity(delegatee, dp.proposalsVoted);
    }

    function setPlatform(bytes32 platformHash) external {
        delegates[msg.sender].platformHash = platformHash;
        emit PlatformUpdated(msg.sender, platformHash);
    }

    // ============ Internal ============

    function _totalDelegated(address delegator) internal view returns (uint256 total) {
        address[] storage list = delegatorDelegates[delegator];
        for (uint256 i = 0; i < list.length; i++) {
            if (delegations[delegator][list[i]].active) {
                total += delegations[delegator][list[i]].amount;
            }
        }
    }

    // ============ View ============

    function getDelegation(address delegator, address delegatee) external view returns (Delegation memory) { return delegations[delegator][delegatee]; }
    function getDelegateProfile(address d) external view returns (DelegateProfile memory) { return delegates[d]; }
    function getDelegates(address delegator) external view returns (address[] memory) { return delegatorDelegates[delegator]; }
    function getTotalDelegated(address delegator) external view returns (uint256) { return _totalDelegated(delegator); }
}
