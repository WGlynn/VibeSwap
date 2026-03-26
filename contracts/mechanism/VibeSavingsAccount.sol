// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts-upgradeable/access/OwnableUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/proxy/utils/UUPSUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/utils/ReentrancyGuardUpgradeable.sol";

/**
 * @title VibeSavingsAccount — High-Yield Savings with Tiered Interest
 * @notice On-chain savings accounts with automatic interest accrual.
 *         Higher balances earn higher APY, encouraging long-term holding.
 *
 * Tiers:
 * - Bronze  (< 1 ETH):   3% APY
 * - Silver  (1-10 ETH):   5% APY
 * - Gold    (10-100 ETH):  7% APY
 * - Diamond (100+ ETH):    10% APY
 *
 * Interest funded by protocol revenue + lending yield.
 */
contract VibeSavingsAccount is OwnableUpgradeable, UUPSUpgradeable, ReentrancyGuardUpgradeable {

    struct Account {
        uint256 balance;
        uint256 lastAccrual;
        uint256 totalEarned;
        bool autoCompound;
    }

    // ============ State ============

    mapping(address => Account) public accounts;
    uint256 public totalDeposits;
    uint256 public totalInterestPaid;
    uint256 public interestPool;

    // APY in basis points (300 = 3%)
    uint256 public constant BRONZE_APY = 300;
    uint256 public constant SILVER_APY = 500;
    uint256 public constant GOLD_APY = 700;
    uint256 public constant DIAMOND_APY = 1000;

    uint256 public constant BRONZE_THRESHOLD = 1 ether;
    uint256 public constant SILVER_THRESHOLD = 10 ether;
    uint256 public constant GOLD_THRESHOLD = 100 ether;


    /// @dev Reserved storage gap for future upgrades
    uint256[50] private __gap;

    // ============ Events ============

    event Deposited(address indexed user, uint256 amount, uint256 newBalance);
    event Withdrawn(address indexed user, uint256 amount);
    event InterestAccrued(address indexed user, uint256 interest, uint256 apy);
    event AutoCompoundToggled(address indexed user, bool enabled);
    event InterestPoolFunded(uint256 amount);

    // ============ Initialize ============

    function initialize() external initializer {
        __Ownable_init(msg.sender);
        __UUPSUpgradeable_init();
        __ReentrancyGuard_init();
    }

    function _authorizeUpgrade(address newImplementation) internal override onlyOwner {
        require(newImplementation.code.length > 0, "Not a contract");
    }

    // ============ Deposits & Withdrawals ============

    function deposit() external payable {
        require(msg.value > 0, "Zero deposit");

        Account storage a = accounts[msg.sender];
        _accrueInterest(msg.sender);

        a.balance += msg.value;
        totalDeposits += msg.value;

        emit Deposited(msg.sender, msg.value, a.balance);
    }

    function withdraw(uint256 amount) external nonReentrant {
        Account storage a = accounts[msg.sender];
        _accrueInterest(msg.sender);

        require(a.balance >= amount, "Insufficient balance");
        a.balance -= amount;
        totalDeposits -= amount;

        (bool ok, ) = msg.sender.call{value: amount}("");
        require(ok, "Withdraw failed");

        emit Withdrawn(msg.sender, amount);
    }

    // ============ Interest ============

    function _accrueInterest(address user) internal {
        Account storage a = accounts[user];
        if (a.balance == 0 || a.lastAccrual == 0) {
            a.lastAccrual = block.timestamp;
            return;
        }

        uint256 elapsed = block.timestamp - a.lastAccrual;
        if (elapsed == 0) return;

        uint256 apy = _getAPY(a.balance);
        uint256 interest = (a.balance * apy * elapsed) / (365 days * 10000);

        if (interest > 0 && interest <= interestPool) {
            interestPool -= interest;
            totalInterestPaid += interest;
            a.totalEarned += interest;

            if (a.autoCompound) {
                a.balance += interest;
                totalDeposits += interest;
            } else {
                (bool ok, ) = user.call{value: interest}("");
                if (!ok) {
                    // If transfer fails, compound instead
                    a.balance += interest;
                    totalDeposits += interest;
                }
            }

            emit InterestAccrued(user, interest, apy);
        }

        a.lastAccrual = block.timestamp;
    }

    function _getAPY(uint256 balance) internal pure returns (uint256) {
        if (balance >= GOLD_THRESHOLD) return DIAMOND_APY;
        if (balance >= SILVER_THRESHOLD) return GOLD_APY;
        if (balance >= BRONZE_THRESHOLD) return SILVER_APY;
        return BRONZE_APY;
    }

    // ============ Settings ============

    function toggleAutoCompound() external {
        Account storage a = accounts[msg.sender];
        _accrueInterest(msg.sender);
        a.autoCompound = !a.autoCompound;
        emit AutoCompoundToggled(msg.sender, a.autoCompound);
    }

    /// @notice Fund the interest pool (from protocol revenue)
    function fundInterestPool() external payable onlyOwner {
        interestPool += msg.value;
        emit InterestPoolFunded(msg.value);
    }

    // ============ Views ============

    function getAccount(address user) external view returns (Account memory) {
        return accounts[user];
    }

    function getTier(address user) external view returns (string memory) {
        uint256 bal = accounts[user].balance;
        if (bal >= GOLD_THRESHOLD) return "Diamond";
        if (bal >= SILVER_THRESHOLD) return "Gold";
        if (bal >= BRONZE_THRESHOLD) return "Silver";
        return "Bronze";
    }

    function getPendingInterest(address user) external view returns (uint256) {
        Account storage a = accounts[user];
        if (a.balance == 0 || a.lastAccrual == 0) return 0;
        uint256 elapsed = block.timestamp - a.lastAccrual;
        uint256 apy = _getAPY(a.balance);
        return (a.balance * apy * elapsed) / (365 days * 10000);
    }

    function getAPY(address user) external view returns (uint256) {
        return _getAPY(accounts[user].balance);
    }

    receive() external payable {}
}
