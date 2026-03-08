// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts-upgradeable/access/OwnableUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/proxy/utils/UUPSUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/utils/ReentrancyGuardUpgradeable.sol";

/**
 * @title VibeFeeDistributor — Protocol Fee Revenue Sharing
 * @notice Collects all protocol fees and distributes them to stakers
 *         proportionally every epoch (1 week).
 *
 * Distribution:
 * - 60% → Stakers (pro-rata by staked amount)
 * - 20% → Treasury (DAO controlled)
 * - 10% → Insurance pool (risk buffer)
 * - 10% → Development fund (ongoing dev)
 *
 * Inspired by Curve's fee distributor — battle-tested model.
 */
contract VibeFeeDistributor is OwnableUpgradeable, UUPSUpgradeable, ReentrancyGuardUpgradeable {

    struct EpochData {
        uint256 totalFees;
        uint256 totalStaked;
        uint256 startTime;
        bool finalized;
    }

    // ============ State ============

    mapping(uint256 => EpochData) public epochs;
    uint256 public currentEpoch;
    mapping(address => uint256) public stakedBalance;
    mapping(address => uint256) public lastClaimedEpoch;
    uint256 public totalStaked;

    address public treasury;
    address public insurancePool;
    address public devFund;

    uint256 public constant EPOCH_DURATION = 7 days;
    uint256 public constant STAKER_SHARE = 6000;     // 60%
    uint256 public constant TREASURY_SHARE = 2000;    // 20%
    uint256 public constant INSURANCE_SHARE = 1000;   // 10%
    uint256 public constant DEV_SHARE = 1000;         // 10%

    uint256 public totalDistributed;

    // ============ Events ============

    event FeesReceived(uint256 amount, uint256 epoch);
    event EpochFinalized(uint256 epoch, uint256 stakerFees, uint256 treasuryFees);
    event Staked(address indexed user, uint256 amount);
    event Unstaked(address indexed user, uint256 amount);
    event FeesClaimed(address indexed user, uint256 amount, uint256 fromEpoch, uint256 toEpoch);

    // ============ Initialize ============

    function initialize(address _treasury, address _insurance, address _dev) external initializer {
        __Ownable_init(msg.sender);
        __UUPSUpgradeable_init();
        __ReentrancyGuard_init();

        treasury = _treasury;
        insurancePool = _insurance;
        devFund = _dev;

        epochs[0].startTime = block.timestamp;
    }

    function _authorizeUpgrade(address) internal override onlyOwner {}

    // ============ Fee Collection ============

    /// @notice Receive protocol fees (called by various protocol contracts)
    function depositFees() external payable {
        require(msg.value > 0, "Zero fees");
        _checkEpochRollover();
        epochs[currentEpoch].totalFees += msg.value;
        emit FeesReceived(msg.value, currentEpoch);
    }

    function _checkEpochRollover() internal {
        EpochData storage current = epochs[currentEpoch];
        if (block.timestamp >= current.startTime + EPOCH_DURATION) {
            _finalizeEpoch();
            currentEpoch++;
            epochs[currentEpoch].startTime = block.timestamp;
            epochs[currentEpoch].totalStaked = totalStaked;
        }
    }

    function _finalizeEpoch() internal {
        EpochData storage e = epochs[currentEpoch];
        if (e.finalized || e.totalFees == 0) return;

        e.finalized = true;
        e.totalStaked = totalStaked;

        uint256 treasuryAmount = (e.totalFees * TREASURY_SHARE) / 10000;
        uint256 insuranceAmount = (e.totalFees * INSURANCE_SHARE) / 10000;
        uint256 devAmount = (e.totalFees * DEV_SHARE) / 10000;

        if (treasury != address(0) && treasuryAmount > 0) {
            (bool ok1, ) = treasury.call{value: treasuryAmount}("");
            require(ok1, "Treasury transfer failed");
        }
        if (insurancePool != address(0) && insuranceAmount > 0) {
            (bool ok2, ) = insurancePool.call{value: insuranceAmount}("");
            require(ok2, "Insurance transfer failed");
        }
        if (devFund != address(0) && devAmount > 0) {
            (bool ok3, ) = devFund.call{value: devAmount}("");
            require(ok3, "Dev transfer failed");
        }

        uint256 stakerFees = e.totalFees - treasuryAmount - insuranceAmount - devAmount;
        emit EpochFinalized(currentEpoch, stakerFees, treasuryAmount);
    }

    // ============ Staking ============

    function stake() external payable {
        require(msg.value > 0, "Zero stake");
        _checkEpochRollover();

        stakedBalance[msg.sender] += msg.value;
        totalStaked += msg.value;

        if (lastClaimedEpoch[msg.sender] == 0 && currentEpoch > 0) {
            lastClaimedEpoch[msg.sender] = currentEpoch;
        }

        emit Staked(msg.sender, msg.value);
    }

    function unstake(uint256 amount) external nonReentrant {
        require(stakedBalance[msg.sender] >= amount, "Insufficient stake");
        _checkEpochRollover();

        stakedBalance[msg.sender] -= amount;
        totalStaked -= amount;

        (bool ok, ) = msg.sender.call{value: amount}("");
        require(ok, "Unstake failed");

        emit Unstaked(msg.sender, amount);
    }

    // ============ Claims ============

    function claimFees() external nonReentrant {
        _checkEpochRollover();

        uint256 start = lastClaimedEpoch[msg.sender];
        uint256 end = currentEpoch;
        uint256 totalOwed = 0;

        for (uint256 i = start; i < end; i++) {
            EpochData storage e = epochs[i];
            if (!e.finalized || e.totalStaked == 0) continue;

            uint256 stakerPool = (e.totalFees * STAKER_SHARE) / 10000;
            uint256 userShare = (stakerPool * stakedBalance[msg.sender]) / e.totalStaked;
            totalOwed += userShare;
        }

        require(totalOwed > 0, "Nothing to claim");
        lastClaimedEpoch[msg.sender] = end;
        totalDistributed += totalOwed;

        (bool ok, ) = msg.sender.call{value: totalOwed}("");
        require(ok, "Claim failed");

        emit FeesClaimed(msg.sender, totalOwed, start, end);
    }

    // ============ Admin ============

    function setAddresses(address _treasury, address _insurance, address _dev) external onlyOwner {
        treasury = _treasury;
        insurancePool = _insurance;
        devFund = _dev;
    }

    // ============ Views ============

    function getEpoch(uint256 id) external view returns (EpochData memory) { return epochs[id]; }

    function getPendingFees(address user) external view returns (uint256) {
        uint256 start = lastClaimedEpoch[user];
        uint256 total = 0;
        for (uint256 i = start; i < currentEpoch; i++) {
            EpochData storage e = epochs[i];
            if (!e.finalized || e.totalStaked == 0) continue;
            uint256 stakerPool = (e.totalFees * STAKER_SHARE) / 10000;
            total += (stakerPool * stakedBalance[user]) / e.totalStaked;
        }
        return total;
    }

    receive() external payable {
        _checkEpochRollover();
        epochs[currentEpoch].totalFees += msg.value;
    }
}
