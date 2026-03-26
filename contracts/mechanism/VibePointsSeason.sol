// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts-upgradeable/access/OwnableUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/proxy/utils/UUPSUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/utils/ReentrancyGuardUpgradeable.sol";

/**
 * @title VibePointsSeason — Seasonal Leaderboard & Cross-System Points Aggregator
 * @notice The grind layer. Users accumulate points through protocol actions,
 *         compete on leaderboards within time-bounded seasons, and earn
 *         multipliers from their reputation across the VSOS ecosystem.
 *
 * What users want: one number going up, a leaderboard, and reasons to come back daily.
 *
 * Architecture:
 *   1. ACTION POINTS: Each protocol action (swap, LP, bridge, stake, referral,
 *      daily check-in) awards base points at defined rates
 *   2. MULTIPLIER STACK: Multipliers from VibeCode reputation, LP loyalty tier,
 *      SoulboundIdentity level, and activity streak — all compound
 *   3. SEASONAL LEADERBOARDS: Time-bounded seasons with tracked top-N rankings,
 *      season-end reward pools, and fresh starts for competitive grind
 *   4. DAILY CHECK-IN: Free daily points for returning users (consistency > intensity)
 *
 * Integration:
 *   - Awards through VibePointsEngine (this contract is an authorized source)
 *   - Reads multipliers from VibeCode, LoyaltyRewardsManager, SoulboundIdentity
 *   - Authorized callers: VibeSwapCore, CrossChainRouter, IncentiveController, etc.
 *
 * @dev UUPS upgradeable. Leaderboard uses insertion-sort on award to maintain
 *      top-N in O(N) per award (N=100 max, so cheap enough for on-chain).
 */
contract VibePointsSeason is OwnableUpgradeable, UUPSUpgradeable, ReentrancyGuardUpgradeable {

    // ============ Action Types ============

    enum Action {
        SWAP,           // Execute a swap
        LP_DEPOSIT,     // Add liquidity
        LP_WITHDRAW,    // Remove liquidity (reduced points)
        BRIDGE,         // Cross-chain transfer
        STAKE,          // Stake tokens
        UNSTAKE,        // Unstake tokens
        REFERRAL,       // Refer a new user
        DAILY_CHECKIN,  // Daily check-in (free points)
        GOVERNANCE,     // Vote on proposal
        CONTRIBUTION,   // Code/community contribution
        BUG_REPORT      // Valid bug report
    }

    // ============ Structs ============

    struct Season {
        uint256 seasonId;
        string name;
        uint256 startTime;
        uint256 endTime;
        uint256 rewardPool;          // Total rewards for season (in VIBE or points)
        uint256 totalPoints;         // Total points awarded this season
        uint256 participantCount;    // Unique participants
        bool finalized;              // Rewards distributed
    }

    struct SeasonUser {
        uint256 points;              // Points earned this season
        uint256 rank;                // Current rank (0 = unranked)
        uint256 actions;             // Total actions this season
        uint256 lastCheckIn;         // Last daily check-in timestamp
        uint256 checkInStreak;       // Consecutive daily check-ins
        bool participated;           // Has earned any points this season
    }

    struct LeaderboardEntry {
        address user;
        uint256 points;
    }

    struct ActionConfig {
        uint256 basePoints;          // Base points per action
        uint256 volumeScale;         // Points per dollar of volume (18 decimals, 0 = flat rate)
        bool active;                 // Whether this action type is enabled
    }

    struct MultiplierSources {
        address vibeCode;            // VibeCode reputation (0-10000 score → 1.0x-2.0x)
        address loyaltyRewards;      // LoyaltyRewardsManager (tier 0-3 → 1.0x-2.0x)
        address soulboundIdentity;   // SoulboundIdentity (level 1-10 → 1.0x-1.5x)
        address pointsEngine;       // VibePointsEngine (award target, streak source)
    }

    // ============ Constants ============

    uint256 public constant BPS = 10000;
    uint256 public constant WAD = 1e18;

    uint256 public constant MAX_LEADERBOARD_SIZE = 100;
    uint256 public constant DAILY_CHECKIN_POINTS = 50;
    uint256 public constant CHECKIN_STREAK_BONUS_PER_DAY = 10;  // +10 points per streak day
    uint256 public constant MAX_CHECKIN_STREAK_BONUS = 200;      // Cap at +200 (20 day streak)
    uint256 public constant CHECKIN_COOLDOWN = 20 hours;         // Generous window for timezone drift

    // ============ State: Seasons ============

    mapping(uint256 => Season) public seasons;
    uint256 public currentSeasonId;
    uint256 public seasonCount;

    // Season-specific user data: seasonId => user => SeasonUser
    mapping(uint256 => mapping(address => SeasonUser)) public seasonUsers;

    // Season leaderboards: seasonId => sorted entries (top N)
    mapping(uint256 => LeaderboardEntry[]) private _leaderboards;

    // ============ State: Action Config ============

    mapping(Action => ActionConfig) public actionConfigs;

    // ============ State: External Contracts ============

    MultiplierSources public multiplierSources;

    // ============ State: Authorization ============

    mapping(address => bool) public authorizedCallers;

    // ============ State: Global Stats ============

    uint256 public totalPointsAllTime;
    uint256 public totalActionsAllTime;
    mapping(address => uint256) public userPointsAllTime;
    mapping(address => uint256) public userActionsAllTime;


    /// @dev Reserved storage gap for future upgrades
    uint256[50] private __gap;

    // ============ Events ============

    event SeasonStarted(uint256 indexed seasonId, string name, uint256 startTime, uint256 endTime);
    event SeasonEnded(uint256 indexed seasonId, uint256 totalPoints, uint256 participants);
    event PointsEarned(
        uint256 indexed seasonId,
        address indexed user,
        Action action,
        uint256 basePoints,
        uint256 multiplier,
        uint256 totalPoints
    );
    event DailyCheckIn(address indexed user, uint256 indexed seasonId, uint256 streak, uint256 points);
    event LeaderboardUpdated(uint256 indexed seasonId, address indexed user, uint256 rank, uint256 points);
    event ActionConfigUpdated(Action action, uint256 basePoints, uint256 volumeScale);
    event MultiplierSourcesUpdated();

    // ============ Errors ============

    error SeasonNotActive();
    error SeasonAlreadyActive();
    error CheckInTooSoon();
    error Unauthorized();
    error InvalidSeason();
    error SeasonNotEnded();

    // ============ Initialize ============

    /// @custom:oz-upgrades-unsafe-allow constructor
    constructor() {
        _disableInitializers();
    }

    function initialize(
        address _vibeCode,
        address _loyaltyRewards,
        address _soulboundIdentity,
        address _pointsEngine
    ) external initializer {
        __Ownable_init(msg.sender);
        __UUPSUpgradeable_init();
        __ReentrancyGuard_init();

        multiplierSources = MultiplierSources({
            vibeCode: _vibeCode,
            loyaltyRewards: _loyaltyRewards,
            soulboundIdentity: _soulboundIdentity,
            pointsEngine: _pointsEngine
        });

        // Default action point rates
        actionConfigs[Action.SWAP]          = ActionConfig({ basePoints: 10,   volumeScale: WAD,      active: true });
        actionConfigs[Action.LP_DEPOSIT]    = ActionConfig({ basePoints: 50,   volumeScale: 3 * WAD,  active: true });
        actionConfigs[Action.LP_WITHDRAW]   = ActionConfig({ basePoints: 5,    volumeScale: 0,        active: true });
        actionConfigs[Action.BRIDGE]        = ActionConfig({ basePoints: 25,   volumeScale: 2 * WAD,  active: true });
        actionConfigs[Action.STAKE]         = ActionConfig({ basePoints: 20,   volumeScale: 2 * WAD,  active: true });
        actionConfigs[Action.UNSTAKE]       = ActionConfig({ basePoints: 2,    volumeScale: 0,        active: true });
        actionConfigs[Action.REFERRAL]      = ActionConfig({ basePoints: 100,  volumeScale: 0,        active: true });
        actionConfigs[Action.DAILY_CHECKIN] = ActionConfig({ basePoints: DAILY_CHECKIN_POINTS, volumeScale: 0, active: true });
        actionConfigs[Action.GOVERNANCE]    = ActionConfig({ basePoints: 30,   volumeScale: 0,        active: true });
        actionConfigs[Action.CONTRIBUTION]  = ActionConfig({ basePoints: 200,  volumeScale: 0,        active: true });
        actionConfigs[Action.BUG_REPORT]    = ActionConfig({ basePoints: 1000, volumeScale: 0,        active: true });
    }

    function _authorizeUpgrade(address newImplementation) internal override onlyOwner {
        require(newImplementation.code.length > 0, "Not a contract");
    }

    // ============ Season Management ============

    /// @notice Start a new season
    /// @param name Human-readable season name (e.g., "Season 1: Genesis")
    /// @param duration Duration in seconds
    function startSeason(string calldata name, uint256 duration) external onlyOwner {
        // End current season if active
        if (currentSeasonId > 0 && !seasons[currentSeasonId].finalized) {
            _endSeason(currentSeasonId);
        }

        seasonCount++;
        uint256 id = seasonCount;
        currentSeasonId = id;

        seasons[id] = Season({
            seasonId: id,
            name: name,
            startTime: block.timestamp,
            endTime: block.timestamp + duration,
            rewardPool: 0,
            totalPoints: 0,
            participantCount: 0,
            finalized: false
        });

        emit SeasonStarted(id, name, block.timestamp, block.timestamp + duration);
    }

    /// @notice End the current season
    function endSeason() external onlyOwner {
        if (currentSeasonId == 0) revert InvalidSeason();
        if (seasons[currentSeasonId].finalized) revert SeasonNotActive();
        _endSeason(currentSeasonId);
    }

    /// @notice Fund the current season's reward pool
    function fundSeason(uint256 amount) external onlyOwner {
        seasons[currentSeasonId].rewardPool += amount;
    }

    function _endSeason(uint256 seasonId) internal {
        Season storage s = seasons[seasonId];
        s.finalized = true;
        s.endTime = block.timestamp;
        emit SeasonEnded(seasonId, s.totalPoints, s.participantCount);
    }

    // ============ Core: Record Action & Award Points ============

    /// @notice Record a user action and award points
    /// @param user The user performing the action
    /// @param action The type of action
    /// @param volume Dollar volume of the action (18 decimals, 0 for flat-rate actions)
    function recordAction(address user, Action action, uint256 volume) external nonReentrant {
        if (!authorizedCallers[msg.sender] && msg.sender != owner()) revert Unauthorized();
        if (action == Action.DAILY_CHECKIN) revert Unauthorized(); // Use dailyCheckIn() instead

        _awardPoints(user, action, volume);
    }

    /// @notice Daily check-in — anyone can call for themselves
    function dailyCheckIn() external nonReentrant {
        uint256 sid = currentSeasonId;
        if (sid == 0 || seasons[sid].finalized) revert SeasonNotActive();

        SeasonUser storage su = seasonUsers[sid][msg.sender];

        // Enforce cooldown
        if (su.lastCheckIn > 0 && block.timestamp < su.lastCheckIn + CHECKIN_COOLDOWN) {
            revert CheckInTooSoon();
        }

        // Update check-in streak
        if (su.lastCheckIn > 0) {
            uint256 elapsed = block.timestamp - su.lastCheckIn;
            if (elapsed <= 48 hours) {
                // Within 48h = streak continues
                su.checkInStreak++;
            } else {
                // Streak broken
                su.checkInStreak = 1;
            }
        } else {
            su.checkInStreak = 1;
        }

        su.lastCheckIn = block.timestamp;

        // Calculate check-in points (base + streak bonus)
        uint256 streakBonus = su.checkInStreak * CHECKIN_STREAK_BONUS_PER_DAY;
        if (streakBonus > MAX_CHECKIN_STREAK_BONUS) streakBonus = MAX_CHECKIN_STREAK_BONUS;
        uint256 basePoints = DAILY_CHECKIN_POINTS + streakBonus;

        // Award with multipliers
        _awardPointsInternal(msg.sender, Action.DAILY_CHECKIN, basePoints);

        emit DailyCheckIn(msg.sender, sid, su.checkInStreak, basePoints);
    }

    // ============ Internal: Point Calculation ============

    function _awardPoints(address user, Action action, uint256 volume) internal {
        ActionConfig storage cfg = actionConfigs[action];
        if (!cfg.active) return;

        // Calculate base points: flat rate + volume-scaled
        uint256 basePoints = cfg.basePoints;
        if (cfg.volumeScale > 0 && volume > 0) {
            // volumeScale is points per dollar (WAD scale)
            // volume is in 18 decimals (1e18 = $1)
            basePoints += (volume * cfg.volumeScale) / WAD / WAD;
        }

        if (basePoints == 0) return;

        _awardPointsInternal(user, action, basePoints);
    }

    function _awardPointsInternal(address user, Action action, uint256 basePoints) internal {
        uint256 sid = currentSeasonId;
        if (sid == 0 || seasons[sid].finalized) revert SeasonNotActive();

        // Get cross-system multiplier
        uint256 multiplier = _getCompoundMultiplier(user);

        // Apply multiplier (BPS: 10000 = 1.0x)
        uint256 totalPoints = (basePoints * multiplier) / BPS;
        if (totalPoints == 0) totalPoints = basePoints; // Floor: at least base points

        // Update season data
        SeasonUser storage su = seasonUsers[sid][user];
        if (!su.participated) {
            su.participated = true;
            seasons[sid].participantCount++;
        }
        su.points += totalPoints;
        su.actions++;
        seasons[sid].totalPoints += totalPoints;

        // Update all-time stats
        totalPointsAllTime += totalPoints;
        totalActionsAllTime++;
        userPointsAllTime[user] += totalPoints;
        userActionsAllTime[user]++;

        // Update leaderboard
        _updateLeaderboard(sid, user, su.points);

        // Forward to VibePointsEngine if configured
        _forwardToEngine(user, totalPoints, action);

        emit PointsEarned(sid, user, action, basePoints, multiplier, totalPoints);
    }

    // ============ Cross-System Multipliers ============

    /// @notice Get compound multiplier from all external sources
    /// @dev Each source returns a multiplier in BPS (10000 = 1.0x)
    ///      Compound: (m1 * m2 * m3) / (BPS^2) — multiplicative stacking
    function _getCompoundMultiplier(address user) internal view returns (uint256) {
        uint256 mult = BPS; // Start at 1.0x

        // 1. VibeCode reputation: score 0-10000 → multiplier 1.0x-2.0x
        mult = (mult * _getVibeCodeMultiplier(user)) / BPS;

        // 2. LP loyalty tier: tier 0-3 → multiplier 1.0x-2.0x
        mult = (mult * _getLoyaltyMultiplier(user)) / BPS;

        // 3. SoulboundIdentity level: level 1-10 → multiplier 1.0x-1.5x
        mult = (mult * _getIdentityMultiplier(user)) / BPS;

        return mult;
    }

    function _getVibeCodeMultiplier(address user) internal view returns (uint256) {
        if (multiplierSources.vibeCode == address(0)) return BPS;
        (bool ok, bytes memory data) = multiplierSources.vibeCode.staticcall(
            abi.encodeWithSignature("getReputationScore(address)", user)
        );
        if (!ok || data.length < 32) return BPS;
        uint256 score = abi.decode(data, (uint256));
        // score 0-10000 → 1.0x-2.0x (linear interpolation)
        return BPS + score;
    }

    function _getLoyaltyMultiplier(address user) internal view returns (uint256) {
        if (multiplierSources.loyaltyRewards == address(0)) return BPS;
        // Try getting the user's loyalty tier via their active pool
        // For simplicity, we use a direct call pattern
        (bool ok, bytes memory data) = multiplierSources.loyaltyRewards.staticcall(
            abi.encodeWithSignature("getUserHighestMultiplier(address)", user)
        );
        if (!ok || data.length < 32) return BPS;
        uint256 mult = abi.decode(data, (uint256));
        return mult > 0 ? mult : BPS;
    }

    function _getIdentityMultiplier(address user) internal view returns (uint256) {
        if (multiplierSources.soulboundIdentity == address(0)) return BPS;
        (bool ok, bytes memory data) = multiplierSources.soulboundIdentity.staticcall(
            abi.encodeWithSignature("hasIdentity(address)", user)
        );
        if (!ok || data.length < 32 || !abi.decode(data, (bool))) return BPS;

        (bool ok2, bytes memory data2) = multiplierSources.soulboundIdentity.staticcall(
            abi.encodeWithSignature("addressToTokenId(address)", user)
        );
        if (!ok2 || data2.length < 32) return BPS;
        uint256 tokenId = abi.decode(data2, (uint256));
        if (tokenId == 0) return BPS;

        (bool ok3, bytes memory data3) = multiplierSources.soulboundIdentity.staticcall(
            abi.encodeWithSignature("identities(uint256)", tokenId)
        );
        if (!ok3 || data3.length < 64) return BPS;
        // Second field is level
        (, uint256 level,,,,,,) = abi.decode(
            data3, (string, uint256, uint256, int256, uint256, uint256, uint256, uint256)
        );
        // Level 1-10 → 1.0x-1.5x (500 BPS per level, capped at 5000 bonus)
        uint256 bonus = level * 500;
        if (bonus > 5000) bonus = 5000;
        return BPS + bonus;
    }

    // ============ Forward to VibePointsEngine ============

    function _forwardToEngine(address user, uint256 points, Action action) internal {
        if (multiplierSources.pointsEngine == address(0)) return;

        // Build reason string from action type
        string memory reason = _actionName(action);

        (bool ok,) = multiplierSources.pointsEngine.call(
            abi.encodeWithSignature("awardPoints(address,uint256,string)", user, points, reason)
        );
        // Silently fail if engine not configured as source — non-critical
        if (!ok) {} // solhint-disable-line no-empty-blocks
    }

    function _actionName(Action a) internal pure returns (string memory) {
        if (a == Action.SWAP) return "swap";
        if (a == Action.LP_DEPOSIT) return "lp_deposit";
        if (a == Action.LP_WITHDRAW) return "lp_withdraw";
        if (a == Action.BRIDGE) return "bridge";
        if (a == Action.STAKE) return "stake";
        if (a == Action.UNSTAKE) return "unstake";
        if (a == Action.REFERRAL) return "referral";
        if (a == Action.DAILY_CHECKIN) return "daily_checkin";
        if (a == Action.GOVERNANCE) return "governance";
        if (a == Action.CONTRIBUTION) return "contribution";
        return "bug_report";
    }

    // ============ Leaderboard ============

    function _updateLeaderboard(uint256 seasonId, address user, uint256 newPoints) internal {
        LeaderboardEntry[] storage board = _leaderboards[seasonId];

        // Check if user is already on the leaderboard
        bool found = false;
        uint256 userIdx;
        for (uint256 i = 0; i < board.length; i++) {
            if (board[i].user == user) {
                board[i].points = newPoints;
                found = true;
                userIdx = i;
                break;
            }
        }

        if (!found) {
            // Not on board yet — check if qualifies
            if (board.length < MAX_LEADERBOARD_SIZE) {
                board.push(LeaderboardEntry({ user: user, points: newPoints }));
                userIdx = board.length - 1;
                found = true;
            } else if (newPoints > board[board.length - 1].points) {
                // Replace last entry
                board[board.length - 1] = LeaderboardEntry({ user: user, points: newPoints });
                userIdx = board.length - 1;
                found = true;
            }
        }

        if (!found) return;

        // Bubble up to maintain sorted order (descending)
        while (userIdx > 0 && board[userIdx].points > board[userIdx - 1].points) {
            // Swap
            LeaderboardEntry memory temp = board[userIdx - 1];
            board[userIdx - 1] = board[userIdx];
            board[userIdx] = temp;
            userIdx--;
        }

        // Update rank in user's season data
        seasonUsers[seasonId][user].rank = userIdx + 1;

        // Update ranks for displaced users
        for (uint256 i = userIdx + 1; i < board.length; i++) {
            seasonUsers[seasonId][board[i].user].rank = i + 1;
        }

        emit LeaderboardUpdated(seasonId, user, userIdx + 1, newPoints);
    }

    // ============ Admin ============

    function setActionConfig(Action action, uint256 basePoints, uint256 volumeScale, bool active) external onlyOwner {
        actionConfigs[action] = ActionConfig({
            basePoints: basePoints,
            volumeScale: volumeScale,
            active: active
        });
        emit ActionConfigUpdated(action, basePoints, volumeScale);
    }

    function setMultiplierSources(
        address _vibeCode,
        address _loyaltyRewards,
        address _soulboundIdentity,
        address _pointsEngine
    ) external onlyOwner {
        multiplierSources = MultiplierSources({
            vibeCode: _vibeCode,
            loyaltyRewards: _loyaltyRewards,
            soulboundIdentity: _soulboundIdentity,
            pointsEngine: _pointsEngine
        });
        emit MultiplierSourcesUpdated();
    }

    function setAuthorizedCaller(address caller, bool authorized) external onlyOwner {
        authorizedCallers[caller] = authorized;
    }

    // ============ View Functions ============

    /// @notice Get the current season info
    function getCurrentSeason() external view returns (Season memory) {
        return seasons[currentSeasonId];
    }

    /// @notice Get a user's season-specific data
    function getUserSeason(uint256 seasonId, address user) external view returns (SeasonUser memory) {
        return seasonUsers[seasonId][user];
    }

    /// @notice Get the full leaderboard for a season
    function getLeaderboard(uint256 seasonId) external view returns (LeaderboardEntry[] memory) {
        return _leaderboards[seasonId];
    }

    /// @notice Get top N entries from the leaderboard
    function getTopN(uint256 seasonId, uint256 n) external view returns (LeaderboardEntry[] memory result) {
        LeaderboardEntry[] storage board = _leaderboards[seasonId];
        uint256 count = n > board.length ? board.length : n;
        result = new LeaderboardEntry[](count);
        for (uint256 i = 0; i < count; i++) {
            result[i] = board[i];
        }
    }

    /// @notice Get a user's rank in a season (0 = not ranked)
    function getUserRank(uint256 seasonId, address user) external view returns (uint256) {
        return seasonUsers[seasonId][user].rank;
    }

    /// @notice Get a user's all-time stats
    function getUserAllTime(address user) external view returns (uint256 points, uint256 actions) {
        return (userPointsAllTime[user], userActionsAllTime[user]);
    }

    /// @notice Get the compound multiplier for a user (for frontend display)
    function getMultiplier(address user) external view returns (uint256) {
        return _getCompoundMultiplier(user);
    }

    /// @notice Check if a season is currently active
    function isSeasonActive() external view returns (bool) {
        if (currentSeasonId == 0) return false;
        Season storage s = seasons[currentSeasonId];
        return !s.finalized && block.timestamp <= s.endTime;
    }

    /// @notice Check if user can check in today
    function canCheckIn(address user) external view returns (bool) {
        if (currentSeasonId == 0 || seasons[currentSeasonId].finalized) return false;
        SeasonUser storage su = seasonUsers[currentSeasonId][user];
        if (su.lastCheckIn == 0) return true;
        return block.timestamp >= su.lastCheckIn + CHECKIN_COOLDOWN;
    }

    /// @notice Get season count
    function getSeasonCount() external view returns (uint256) {
        return seasonCount;
    }

    // ============ Receive ============

    receive() external payable {}
}
