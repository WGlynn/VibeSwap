// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/token/ERC20/extensions/ERC4626.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "./interfaces/IStrategyVault.sol";

/**
 * @title StrategyVault
 * @notice ERC-4626 automated yield vault with pluggable strategies.
 * @dev Part of VSOS (VibeSwap Operating System) DeFi/DeFAI layer.
 *
 *      Users deposit an asset → vault deploys it into a strategy →
 *      strategy earns yield → users withdraw more than they deposited.
 *
 *      Strategies are pluggable via IStrategy interface. Any contract
 *      implementing IStrategy can be proposed, timelocked, and activated.
 *
 *      Cooperative capitalism mechanics:
 *        - Performance fees flow through FeeRouter (cooperative distribution)
 *        - Strategy changes require timelock (community can react)
 *        - Emergency shutdown protects depositors
 *        - Deposit cap prevents excessive concentration
 *        - All accounting is transparent on-chain
 *
 *      Composability: strategies can compose with any VSOS primitive —
 *      LP provision (VibeAMM), covered calls (VibeOptions), bond laddering
 *      (VibeBonds), lending (VibeCredit), insurance underwriting (VibeInsurance).
 */
contract StrategyVault is ERC4626, Ownable, ReentrancyGuard, IStrategyVault {
    using SafeERC20 for IERC20;

    // ============ Constants ============

    uint256 private constant BPS = 10_000;
    uint256 private constant MAX_PERFORMANCE_FEE = 3000; // 30%
    uint256 private constant MAX_MANAGEMENT_FEE = 500;   // 5%
    uint256 private constant DEFAULT_TIMELOCK = 2 days;
    uint256 private constant SECONDS_PER_YEAR = 365.25 days;

    // ============ State ============

    address private _strategy;
    address private _proposedStrategy;
    uint256 private _strategyActivationTime;

    uint256 private _depositCap;
    uint256 private _performanceFeeBps;
    uint256 private _managementFeeBps;
    address private _feeRecipient;
    uint256 private _lastHarvestTime;
    bool private _emergencyShutdown;
    uint256 private _strategyTimelock;

    // ============ Constructor ============

    constructor(
        IERC20 asset_,
        string memory name_,
        string memory symbol_,
        address feeRecipient_,
        uint256 depositCap_
    )
        ERC4626(asset_)
        ERC20(name_, symbol_)
        Ownable(msg.sender)
    {
        if (feeRecipient_ == address(0)) revert ZeroAddress();

        _feeRecipient = feeRecipient_;
        _depositCap = depositCap_;
        _performanceFeeBps = 1000; // 10% default
        _managementFeeBps = 200;   // 2% default
        _strategyTimelock = DEFAULT_TIMELOCK;
        _lastHarvestTime = block.timestamp;
    }

    // ============ ERC-4626 Overrides ============

    function totalAssets() public view override returns (uint256) {
        uint256 idle = IERC20(asset()).balanceOf(address(this));
        uint256 deployed = _strategy != address(0)
            ? IStrategy(_strategy).totalAssets()
            : 0;
        return idle + deployed;
    }

    function maxDeposit(address) public view override returns (uint256) {
        if (_emergencyShutdown) return 0;
        if (_depositCap == 0) return type(uint256).max; // no cap
        uint256 currentAssets = totalAssets();
        if (currentAssets >= _depositCap) return 0;
        return _depositCap - currentAssets;
    }

    function maxMint(address receiver) public view override returns (uint256) {
        uint256 maxDep = maxDeposit(receiver);
        if (maxDep == type(uint256).max) return type(uint256).max;
        return convertToShares(maxDep);
    }

    function _deposit(
        address caller,
        address receiver,
        uint256 assets,
        uint256 shares
    ) internal override nonReentrant {
        if (_emergencyShutdown) revert EmergencyActive();
        if (_depositCap > 0 && totalAssets() + assets > _depositCap) {
            revert DepositCapExceeded();
        }
        super._deposit(caller, receiver, assets, shares);

        // Auto-deploy to strategy if one is active
        _deployToStrategy();
    }

    function _withdraw(
        address caller,
        address receiver,
        address owner_,
        uint256 assets,
        uint256 shares
    ) internal override nonReentrant {
        // Pull from strategy if vault doesn't have enough idle
        uint256 idle = IERC20(asset()).balanceOf(address(this));
        if (idle < assets && _strategy != address(0)) {
            uint256 needed = assets - idle;
            IStrategy(_strategy).withdraw(needed);
        }

        super._withdraw(caller, receiver, owner_, assets, shares);
    }

    // ============ Strategy Management ============

    function proposeStrategy(address newStrategy) external onlyOwner {
        if (newStrategy == address(0)) revert ZeroAddress();
        if (IStrategy(newStrategy).asset() != asset()) revert StrategyAssetMismatch();

        _proposedStrategy = newStrategy;
        _strategyActivationTime = block.timestamp + _strategyTimelock;

        emit StrategyProposed(newStrategy, _strategyActivationTime);
    }

    function activateStrategy() external onlyOwner {
        if (_proposedStrategy == address(0)) revert NoProposedStrategy();
        if (block.timestamp < _strategyActivationTime) revert TimelockNotElapsed();

        address oldStrategy = _strategy;

        // Withdraw everything from old strategy
        if (oldStrategy != address(0)) {
            IStrategy(oldStrategy).emergencyWithdraw();
        }

        _strategy = _proposedStrategy;
        _proposedStrategy = address(0);
        _strategyActivationTime = 0;

        // Deploy idle assets to new strategy
        _deployToStrategy();

        if (oldStrategy != address(0)) {
            emit StrategyMigrated(oldStrategy, _strategy);
        } else {
            emit StrategyActivated(_strategy);
        }
    }

    // ============ Harvest ============

    function harvest() external nonReentrant returns (uint256 profit) {
        if (_strategy == address(0)) revert NoStrategy();

        uint256 beforeBal = IERC20(asset()).balanceOf(address(this));
        profit = IStrategy(_strategy).harvest();
        uint256 afterBal = IERC20(asset()).balanceOf(address(this));

        // Actual profit received
        uint256 received = afterBal - beforeBal;
        if (received == 0) revert NothingToHarvest();

        // Performance fee on profit
        uint256 perfFee = (received * _performanceFeeBps) / BPS;

        // Management fee (accrued since last harvest, on total assets)
        uint256 elapsed = block.timestamp - _lastHarvestTime;
        uint256 mgmtFee = (totalAssets() * _managementFeeBps * elapsed) / (BPS * SECONDS_PER_YEAR);

        uint256 totalFee = perfFee + mgmtFee;
        if (totalFee > received) {
            totalFee = received; // fees can't exceed profit
        }

        // Transfer fees to recipient
        if (totalFee > 0) {
            IERC20(asset()).safeTransfer(_feeRecipient, totalFee);
        }

        _lastHarvestTime = block.timestamp;

        // Re-deploy remaining to strategy
        _deployToStrategy();

        emit Harvested(received, perfFee, mgmtFee > received - perfFee ? received - perfFee : mgmtFee);
        return received - totalFee;
    }

    // ============ Admin ============

    function setDepositCap(uint256 cap) external onlyOwner {
        _depositCap = cap;
        emit DepositCapUpdated(cap);
    }

    function setFees(uint256 performanceBps, uint256 managementBps) external onlyOwner {
        if (performanceBps > MAX_PERFORMANCE_FEE) revert ExcessiveFee();
        if (managementBps > MAX_MANAGEMENT_FEE) revert ExcessiveFee();

        _performanceFeeBps = performanceBps;
        _managementFeeBps = managementBps;

        emit FeesUpdated(performanceBps, managementBps);
    }

    function setFeeRecipient(address recipient) external onlyOwner {
        if (recipient == address(0)) revert ZeroAddress();
        _feeRecipient = recipient;
        emit FeeRecipientUpdated(recipient);
    }

    function setEmergencyShutdown(bool active) external onlyOwner {
        _emergencyShutdown = active;

        if (active && _strategy != address(0)) {
            // Pull all assets back from strategy
            IStrategy(_strategy).emergencyWithdraw();
        }

        emit EmergencyShutdown(active);
    }

    function setStrategyTimelock(uint256 timelock) external onlyOwner {
        _strategyTimelock = timelock;
    }

    // ============ Views ============

    function strategy() external view returns (address) { return _strategy; }
    function proposedStrategy() external view returns (address) { return _proposedStrategy; }
    function strategyActivationTime() external view returns (uint256) { return _strategyActivationTime; }
    function depositCap() external view returns (uint256) { return _depositCap; }
    function performanceFeeBps() external view returns (uint256) { return _performanceFeeBps; }
    function managementFeeBps() external view returns (uint256) { return _managementFeeBps; }
    function feeRecipient() external view returns (address) { return _feeRecipient; }
    function lastHarvestTime() external view returns (uint256) { return _lastHarvestTime; }
    function emergencyShutdownActive() external view returns (bool) { return _emergencyShutdown; }
    function strategyTimelock() external view returns (uint256) { return _strategyTimelock; }

    // ============ Internal ============

    function _deployToStrategy() internal {
        if (_strategy == address(0)) return;

        uint256 idle = IERC20(asset()).balanceOf(address(this));
        if (idle == 0) return;

        IERC20(asset()).safeTransfer(_strategy, idle);
        IStrategy(_strategy).deposit(idle);
    }
}
