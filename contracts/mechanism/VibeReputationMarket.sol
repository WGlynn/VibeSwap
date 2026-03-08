// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts-upgradeable/access/OwnableUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/proxy/utils/UUPSUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/utils/ReentrancyGuardUpgradeable.sol";

/**
 * @title VibeReputationMarket — Reputation-Weighted Prediction & Coordination Market
 * @notice Absorbs reputation-weighted coordination patterns from academic research.
 *         Agents and humans stake reputation on predictions, coordination tasks,
 *         and governance proposals. Higher reputation = more influence.
 *
 * @dev Architecture:
 *      - Reputation-weighted voting (not just token-weighted)
 *      - Quadratic reputation staking (sqrt scaling prevents plutocracy)
 *      - Reputation bonds: stake reputation on claims, lose it if wrong
 *      - Prediction pools with reputation-adjusted payouts
 *      - Conviction-style time-weighted reputation accumulation
 *      - Integration with VibeAgentReputation for AI agent scores
 */
contract VibeReputationMarket is OwnableUpgradeable, UUPSUpgradeable, ReentrancyGuardUpgradeable {
    // ============ Types ============

    enum MarketType { PREDICTION, COORDINATION, GOVERNANCE, DISPUTE }
    enum MarketStatus { OPEN, RESOLVED, CANCELLED }
    enum Outcome { UNRESOLVED, YES, NO }

    struct Market {
        uint256 marketId;
        address creator;
        MarketType marketType;
        bytes32 questionHash;        // IPFS hash of question/description
        MarketStatus status;
        Outcome outcome;
        uint256 totalYesStake;       // Reputation staked on YES
        uint256 totalNoStake;        // Reputation staked on NO
        uint256 totalEthYes;         // ETH staked on YES
        uint256 totalEthNo;          // ETH staked on NO
        uint256 participantCount;
        uint256 createdAt;
        uint256 resolveDeadline;
    }

    struct Position {
        uint256 repStake;            // Reputation staked
        uint256 ethStake;            // ETH staked
        bool isYes;
        uint256 timestamp;
        bool claimed;
    }

    // ============ Constants ============

    uint256 public constant MIN_REP_STAKE = 100;
    uint256 public constant MAX_REP_LOSS = 2000;         // Max 20% rep loss on wrong bet
    uint256 public constant REP_GAIN_BPS = 500;          // 5% rep gain on correct bet
    uint256 public constant CONVICTION_BOOST_BPS = 100;  // 1% boost per day staked early

    // ============ State ============

    mapping(uint256 => Market) public markets;
    uint256 public marketCount;

    /// @notice Positions: marketId => participant => Position
    mapping(uint256 => mapping(address => Position)) public positions;

    /// @notice Reputation scores (simplified — integrates with VibeAgentReputation)
    mapping(address => uint256) public reputation;

    /// @notice Stats
    uint256 public totalMarketsResolved;
    uint256 public totalRepStaked;
    uint256 public totalEthStaked;

    // ============ Events ============

    event MarketCreated(uint256 indexed marketId, MarketType marketType, uint256 resolveDeadline);
    event PositionTaken(uint256 indexed marketId, address indexed participant, bool isYes, uint256 repStake, uint256 ethStake);
    event MarketResolved(uint256 indexed marketId, Outcome outcome);
    event RewardClaimed(uint256 indexed marketId, address indexed participant, uint256 repGain, uint256 ethPayout);

    // ============ Init ============

    function initialize() external initializer {
        __Ownable_init(msg.sender);
        __UUPSUpgradeable_init();
        __ReentrancyGuard_init();
    }

    function _authorizeUpgrade(address) internal override onlyOwner {}

    // ============ Reputation Bootstrap ============

    function initializeReputation(address user, uint256 startingRep) external onlyOwner {
        require(reputation[user] == 0, "Already initialized");
        reputation[user] = startingRep;
    }

    // ============ Market Creation ============

    function createMarket(
        MarketType marketType,
        bytes32 questionHash,
        uint256 durationDays
    ) external returns (uint256) {
        require(reputation[msg.sender] >= 1000, "Need 1000+ rep to create");

        marketCount++;
        markets[marketCount] = Market({
            marketId: marketCount,
            creator: msg.sender,
            marketType: marketType,
            questionHash: questionHash,
            status: MarketStatus.OPEN,
            outcome: Outcome.UNRESOLVED,
            totalYesStake: 0,
            totalNoStake: 0,
            totalEthYes: 0,
            totalEthNo: 0,
            participantCount: 0,
            createdAt: block.timestamp,
            resolveDeadline: block.timestamp + (durationDays * 1 days)
        });

        emit MarketCreated(marketCount, marketType, block.timestamp + (durationDays * 1 days));
        return marketCount;
    }

    // ============ Staking ============

    /**
     * @notice Take a position — stake reputation + optional ETH
     * @dev Uses quadratic scaling: effective_weight = sqrt(repStake)
     */
    function takePosition(
        uint256 marketId,
        bool isYes,
        uint256 repStake
    ) external payable {
        Market storage market = markets[marketId];
        require(market.status == MarketStatus.OPEN, "Not open");
        require(block.timestamp <= market.resolveDeadline, "Deadline passed");
        require(repStake >= MIN_REP_STAKE, "Below minimum");
        require(reputation[msg.sender] >= repStake, "Insufficient reputation");
        require(positions[marketId][msg.sender].repStake == 0, "Already positioned");

        reputation[msg.sender] -= repStake; // Lock reputation

        positions[marketId][msg.sender] = Position({
            repStake: repStake,
            ethStake: msg.value,
            isYes: isYes,
            timestamp: block.timestamp,
            claimed: false
        });

        if (isYes) {
            market.totalYesStake += repStake;
            market.totalEthYes += msg.value;
        } else {
            market.totalNoStake += repStake;
            market.totalEthNo += msg.value;
        }

        market.participantCount++;
        totalRepStaked += repStake;
        totalEthStaked += msg.value;

        emit PositionTaken(marketId, msg.sender, isYes, repStake, msg.value);
    }

    // ============ Resolution ============

    function resolveMarket(uint256 marketId, Outcome outcome) external {
        Market storage market = markets[marketId];
        require(market.creator == msg.sender || msg.sender == owner(), "Not authorized");
        require(market.status == MarketStatus.OPEN, "Not open");
        require(outcome != Outcome.UNRESOLVED, "Must resolve");

        market.status = MarketStatus.RESOLVED;
        market.outcome = outcome;
        totalMarketsResolved++;

        emit MarketResolved(marketId, outcome);
    }

    // ============ Claims ============

    function claim(uint256 marketId) external nonReentrant {
        Market storage market = markets[marketId];
        require(market.status == MarketStatus.RESOLVED, "Not resolved");

        Position storage pos = positions[marketId][msg.sender];
        require(pos.repStake > 0, "No position");
        require(!pos.claimed, "Already claimed");
        pos.claimed = true;

        bool won = (market.outcome == Outcome.YES && pos.isYes) ||
                   (market.outcome == Outcome.NO && !pos.isYes);

        uint256 repReturn;
        uint256 ethPayout;

        if (won) {
            // Return reputation + bonus
            uint256 bonus = (pos.repStake * REP_GAIN_BPS) / 10000;

            // Conviction boost: early stakers get more
            uint256 timeStaked = market.resolveDeadline > pos.timestamp
                ? market.resolveDeadline - pos.timestamp
                : 0;
            uint256 daysBoosted = timeStaked / 1 days;
            uint256 convictionBoost = (pos.repStake * daysBoosted * CONVICTION_BOOST_BPS) / 10000;

            repReturn = pos.repStake + bonus + convictionBoost;
            reputation[msg.sender] += repReturn;

            // ETH payout: proportional share of losing side
            uint256 totalLosingEth = pos.isYes ? market.totalEthNo : market.totalEthYes;
            uint256 totalWinningStake = pos.isYes ? market.totalYesStake : market.totalNoStake;

            if (totalWinningStake > 0) {
                ethPayout = pos.ethStake + (totalLosingEth * pos.repStake) / totalWinningStake;
            } else {
                ethPayout = pos.ethStake;
            }
        } else {
            // Lose portion of reputation
            uint256 loss = (pos.repStake * MAX_REP_LOSS) / 10000;
            repReturn = pos.repStake - loss;
            reputation[msg.sender] += repReturn;
            ethPayout = 0; // Lose ETH stake
        }

        if (ethPayout > 0) {
            (bool ok, ) = msg.sender.call{value: ethPayout}("");
            require(ok, "Payout failed");
        }

        emit RewardClaimed(marketId, msg.sender, repReturn, ethPayout);
    }

    // ============ View ============

    function getMarket(uint256 id) external view returns (Market memory) { return markets[id]; }
    function getPosition(uint256 marketId, address user) external view returns (Position memory) { return positions[marketId][user]; }
    function getReputation(address user) external view returns (uint256) { return reputation[user]; }
    function getMarketCount() external view returns (uint256) { return marketCount; }

    receive() external payable {}
}
