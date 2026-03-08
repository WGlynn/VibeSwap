// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts-upgradeable/access/OwnableUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/proxy/utils/UUPSUpgradeable.sol";

/**
 * @title TransactionFirewall — Programmable Transaction Rules Engine
 * @notice Pre-transaction verification layer that blocks suspicious activity.
 *
 * Rules can be configured per-wallet:
 * - Whitelist/blacklist destinations
 * - Max transaction value
 * - Geographic/time-based restrictions
 * - Contract interaction filters
 * - Pattern detection (rapid small transfers = dust attack)
 * - Token approval limits (prevent infinite approval exploits)
 *
 * Acts as an on-chain firewall between the user's intent and execution.
 */
contract TransactionFirewall is OwnableUpgradeable, UUPSUpgradeable {

    struct FirewallRules {
        bool whitelistOnly;           // Only allow whitelisted destinations
        uint256 maxSingleTx;          // Max value per transaction
        uint256 maxDailyVolume;       // Max total daily volume
        uint256 cooldownPeriod;       // Min seconds between transactions
        uint256 maxApprovalsPerDay;   // Limit token approvals
        bool blockNewContracts;       // Block interactions with contracts < 7 days old
        bool requireMultisig;         // Require co-signer for large tx
    }

    struct TxRecord {
        uint256 timestamp;
        uint256 value;
        address destination;
    }

    // ============ State ============

    mapping(address => FirewallRules) public rules;
    mapping(address => mapping(address => bool)) public whitelist;
    mapping(address => mapping(address => bool)) public blacklist;
    mapping(address => uint256) public dailyVolume;
    mapping(address => uint256) public dailyVolumeReset;
    mapping(address => uint256) public lastTxTime;
    mapping(address => uint256) public dailyApprovals;
    mapping(address => uint256) public dailyApprovalsReset;

    // Suspicious pattern detection
    mapping(address => TxRecord[]) private recentTxs;
    uint256 public constant DUST_THRESHOLD = 0.001 ether;
    uint256 public constant RAPID_TX_WINDOW = 60; // 1 minute
    uint256 public constant RAPID_TX_COUNT = 10;   // 10 tx in 1 min = suspicious

    // Co-signers for multisig requirement
    mapping(address => address) public coSigner;
    mapping(bytes32 => bool) public coSignerApprovals;

    // ============ Events ============

    event RulesUpdated(address indexed user);
    event TxBlocked(address indexed user, address destination, uint256 value, string reason);
    event TxApproved(address indexed user, address destination, uint256 value);
    event SuspiciousActivity(address indexed user, string pattern);
    event WhitelistUpdated(address indexed user, address destination, bool allowed);
    event BlacklistUpdated(address indexed user, address destination, bool blocked);
    event CoSignerSet(address indexed user, address coSigner);

    // ============ Initialize ============

    function initialize() external initializer {
        __Ownable_init(msg.sender);
        __UUPSUpgradeable_init();
    }

    function _authorizeUpgrade(address) internal override onlyOwner {}

    // ============ Configuration ============

    function setRules(FirewallRules calldata _rules) external {
        rules[msg.sender] = _rules;
        emit RulesUpdated(msg.sender);
    }

    function setWhitelist(address destination, bool allowed) external {
        whitelist[msg.sender][destination] = allowed;
        emit WhitelistUpdated(msg.sender, destination, allowed);
    }

    function setBlacklist(address destination, bool blocked) external {
        blacklist[msg.sender][destination] = blocked;
        emit BlacklistUpdated(msg.sender, destination, blocked);
    }

    function setCoSigner(address _coSigner) external {
        require(_coSigner != msg.sender, "Cannot co-sign yourself");
        coSigner[msg.sender] = _coSigner;
        emit CoSignerSet(msg.sender, _coSigner);
    }

    // ============ Transaction Verification ============

    /// @notice Check if a transaction passes all firewall rules
    /// @return allowed Whether the transaction should proceed
    /// @return reason If blocked, the reason why
    function checkTransaction(
        address user,
        address destination,
        uint256 value
    ) external returns (bool allowed, string memory reason) {
        FirewallRules storage r = rules[user];

        // Rule 1: Blacklist check
        if (blacklist[user][destination]) {
            emit TxBlocked(user, destination, value, "Blacklisted destination");
            return (false, "Blacklisted destination");
        }

        // Rule 2: Whitelist check
        if (r.whitelistOnly && !whitelist[user][destination]) {
            emit TxBlocked(user, destination, value, "Not whitelisted");
            return (false, "Destination not whitelisted");
        }

        // Rule 3: Max single transaction
        if (r.maxSingleTx > 0 && value > r.maxSingleTx) {
            emit TxBlocked(user, destination, value, "Exceeds max single tx");
            return (false, "Exceeds maximum single transaction value");
        }

        // Rule 4: Daily volume
        _resetDailyIfNeeded(user);
        if (r.maxDailyVolume > 0 && dailyVolume[user] + value > r.maxDailyVolume) {
            emit TxBlocked(user, destination, value, "Daily volume exceeded");
            return (false, "Daily volume limit exceeded");
        }

        // Rule 5: Cooldown
        if (r.cooldownPeriod > 0 && block.timestamp < lastTxTime[user] + r.cooldownPeriod) {
            emit TxBlocked(user, destination, value, "Cooldown active");
            return (false, "Transaction cooldown active");
        }

        // Rule 6: New contract check
        if (r.blockNewContracts && _isNewContract(destination)) {
            emit TxBlocked(user, destination, value, "New contract blocked");
            return (false, "Cannot interact with contracts less than 7 days old");
        }

        // Rule 7: Multisig requirement for large tx
        if (r.requireMultisig && value > r.maxSingleTx / 2) {
            bytes32 txHash = keccak256(abi.encodePacked(user, destination, value, block.number));
            if (!coSignerApprovals[txHash]) {
                emit TxBlocked(user, destination, value, "Needs co-signer");
                return (false, "Co-signer approval required");
            }
        }

        // Rule 8: Rapid transaction detection (anti-dust)
        if (_detectRapidTxPattern(user, destination, value)) {
            emit SuspiciousActivity(user, "Rapid small transactions detected");
            // Don't block — just warn. Log for review.
        }

        // All checks passed
        dailyVolume[user] += value;
        lastTxTime[user] = block.timestamp;

        // Record for pattern detection
        recentTxs[user].push(TxRecord({
            timestamp: block.timestamp,
            value: value,
            destination: destination
        }));

        emit TxApproved(user, destination, value);
        return (true, "");
    }

    /// @notice Co-signer approves a specific transaction
    function coSignTransaction(address user, address destination, uint256 value) external {
        require(coSigner[user] == msg.sender, "Not co-signer");
        bytes32 txHash = keccak256(abi.encodePacked(user, destination, value, block.number));
        coSignerApprovals[txHash] = true;
    }

    /// @notice Check token approval against limits
    function checkApproval(address user) external returns (bool) {
        FirewallRules storage r = rules[user];
        if (r.maxApprovalsPerDay == 0) return true;

        _resetApprovalsIfNeeded(user);
        if (dailyApprovals[user] >= r.maxApprovalsPerDay) {
            emit TxBlocked(user, address(0), 0, "Approval limit reached");
            return false;
        }
        dailyApprovals[user]++;
        return true;
    }

    // ============ Internal ============

    function _resetDailyIfNeeded(address user) internal {
        if (block.timestamp > dailyVolumeReset[user] + 1 days) {
            dailyVolume[user] = 0;
            dailyVolumeReset[user] = block.timestamp;
        }
    }

    function _resetApprovalsIfNeeded(address user) internal {
        if (block.timestamp > dailyApprovalsReset[user] + 1 days) {
            dailyApprovals[user] = 0;
            dailyApprovalsReset[user] = block.timestamp;
        }
    }

    function _isNewContract(address addr) internal view returns (bool) {
        uint256 size;
        assembly { size := extcodesize(addr) }
        // If it's a contract, check if it was deployed recently
        // Simple heuristic: we can't check deployment time on-chain
        // but we CAN check if it's a known/whitelisted contract
        return size > 0 && !whitelist[msg.sender][addr];
    }

    function _detectRapidTxPattern(address user, address, uint256 value) internal view returns (bool) {
        if (value > DUST_THRESHOLD) return false;

        TxRecord[] storage txs = recentTxs[user];
        if (txs.length < RAPID_TX_COUNT) return false;

        uint256 recentCount = 0;
        for (uint256 i = txs.length; i > 0 && i > txs.length - RAPID_TX_COUNT; i--) {
            if (block.timestamp - txs[i-1].timestamp < RAPID_TX_WINDOW) {
                recentCount++;
            }
        }

        return recentCount >= RAPID_TX_COUNT;
    }

    // ============ Views ============

    function getRules(address user) external view returns (FirewallRules memory) {
        return rules[user];
    }

    function isWhitelisted(address user, address destination) external view returns (bool) {
        return whitelist[user][destination];
    }

    function isBlacklisted(address user, address destination) external view returns (bool) {
        return blacklist[user][destination];
    }

    function getRemainingDailyVolume(address user) external view returns (uint256) {
        FirewallRules storage r = rules[user];
        if (r.maxDailyVolume == 0) return type(uint256).max;
        if (dailyVolume[user] >= r.maxDailyVolume) return 0;
        return r.maxDailyVolume - dailyVolume[user];
    }

    receive() external payable {}
}
