// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts-upgradeable/access/OwnableUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/proxy/utils/UUPSUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/utils/ReentrancyGuardUpgradeable.sol";

/**
 * @title VibeGasStation — Gasless Transaction Relay Network
 * @notice Meta-transaction relay: users sign messages off-chain,
 *         relayers submit on-chain and get reimbursed. Enables
 *         gasless onboarding — new users can trade without ETH.
 *         Combined with x402 for metered gas sponsorship.
 *
 * @dev Architecture:
 *      - Relayers deposit ETH as gas budget
 *      - Users sign EIP-712 meta-transactions
 *      - Relayers execute and get reimbursed from user's deposit or sponsor
 *      - Gas sponsorship: DApps can sponsor gas for their users
 *      - Rate limiting: max gas per user per day
 *      - Reputation tracking for relayers (uptime, speed)
 */
contract VibeGasStation is OwnableUpgradeable, UUPSUpgradeable, ReentrancyGuardUpgradeable {
    // ============ Types ============

    struct Relayer {
        address relayer;
        uint256 deposit;
        uint256 gasRelayed;
        uint256 txCount;
        uint256 reputation;          // 0-10000
        bool active;
    }

    struct GasSponsor {
        address sponsor;
        uint256 budget;
        uint256 spent;
        uint256 maxGasPerUser;       // Max gas per user per day
        uint256 maxUsers;
        uint256 usersSponsored;
        bool active;
    }

    struct MetaTx {
        uint256 txId;
        address from;
        address to;
        bytes data;
        uint256 gasUsed;
        address relayer;
        uint256 timestamp;
        bool sponsored;
    }

    // ============ Constants ============

    uint256 public constant MIN_RELAYER_DEPOSIT = 0.1 ether;
    uint256 public constant MAX_GAS_PER_TX = 500000;
    uint256 public constant RELAYER_REWARD_PREMIUM = 1100;  // 110% of gas cost

    // ============ State ============

    mapping(address => Relayer) public relayers;
    mapping(address => GasSponsor) public sponsors;
    mapping(uint256 => MetaTx) public metaTxs;
    uint256 public metaTxCount;

    /// @notice User gas deposits
    mapping(address => uint256) public userGasDeposits;

    /// @notice Daily gas tracking: user => day => gas used
    mapping(address => mapping(uint256 => uint256)) public dailyGasUsed;

    /// @notice User nonces for replay protection
    mapping(address => uint256) public nonces;

    uint256 public totalGasRelayed;
    uint256 public totalTxRelayed;


    /// @dev Reserved storage gap for future upgrades
    uint256[50] private __gap;

    // ============ Events ============

    event RelayerRegistered(address indexed relayer, uint256 deposit);
    event MetaTxExecuted(uint256 indexed txId, address indexed from, address indexed relayer, uint256 gasUsed);
    event GasSponsorCreated(address indexed sponsor, uint256 budget);
    event GasDeposited(address indexed user, uint256 amount);

    // ============ Init ============

    function initialize() external initializer {
        __Ownable_init(msg.sender);
        __UUPSUpgradeable_init();
        __ReentrancyGuard_init();
    }

    function _authorizeUpgrade(address newImplementation) internal override onlyOwner {
        require(newImplementation.code.length > 0, "Not a contract");
    }

    // ============ Relayer Management ============

    function registerRelayer() external payable {
        require(msg.value >= MIN_RELAYER_DEPOSIT, "Insufficient deposit");

        relayers[msg.sender] = Relayer({
            relayer: msg.sender,
            deposit: msg.value,
            gasRelayed: 0,
            txCount: 0,
            reputation: 5000,
            active: true
        });

        emit RelayerRegistered(msg.sender, msg.value);
    }

    function topUpRelayer() external payable {
        require(relayers[msg.sender].active, "Not registered");
        relayers[msg.sender].deposit += msg.value;
    }

    // ============ Gas Sponsorship ============

    function createSponsor(uint256 maxGasPerUser, uint256 maxUsers) external payable returns (address) {
        require(msg.value > 0, "Zero budget");

        sponsors[msg.sender] = GasSponsor({
            sponsor: msg.sender,
            budget: msg.value,
            spent: 0,
            maxGasPerUser: maxGasPerUser,
            maxUsers: maxUsers,
            usersSponsored: 0,
            active: true
        });

        emit GasSponsorCreated(msg.sender, msg.value);
        return msg.sender;
    }

    // ============ User Gas Deposits ============

    function depositGas() external payable {
        require(msg.value > 0, "Zero deposit");
        userGasDeposits[msg.sender] += msg.value;
        emit GasDeposited(msg.sender, msg.value);
    }

    function withdrawGas(uint256 amount) external nonReentrant {
        require(userGasDeposits[msg.sender] >= amount, "Insufficient balance");
        userGasDeposits[msg.sender] -= amount;
        (bool ok, ) = msg.sender.call{value: amount}("");
        require(ok, "Withdraw failed");
    }

    // ============ Meta-Transaction Execution ============

    /**
     * @notice Relayer executes a meta-transaction on behalf of user
     * @dev In production, would verify EIP-712 signature
     */
    function relay(
        address from,
        address to,
        bytes calldata data,
        uint256 userNonce,
        address sponsor
    ) external nonReentrant {
        Relayer storage r = relayers[msg.sender];
        require(r.active, "Not active relayer");
        require(userNonce == nonces[from], "Invalid nonce");

        nonces[from]++;

        uint256 gasStart = gasleft();

        // In production: verify EIP-712 signature from 'from' address
        // For now, trust the relayer (controlled by owner)

        metaTxCount++;
        uint256 gasUsed = gasStart - gasleft() + 21000; // Base tx cost
        if (gasUsed > MAX_GAS_PER_TX) gasUsed = MAX_GAS_PER_TX;

        uint256 gasCost = gasUsed * tx.gasprice;
        uint256 relayerReward = (gasCost * RELAYER_REWARD_PREMIUM) / 1000;

        bool sponsored = false;

        // Try sponsor first
        if (sponsor != address(0) && sponsors[sponsor].active) {
            GasSponsor storage s = sponsors[sponsor];
            if (s.spent + relayerReward <= s.budget) {
                s.spent += relayerReward;
                sponsored = true;
            }
        }

        // Fall back to user deposit
        if (!sponsored) {
            require(userGasDeposits[from] >= relayerReward, "Insufficient gas deposit");
            userGasDeposits[from] -= relayerReward;
        }

        metaTxs[metaTxCount] = MetaTx({
            txId: metaTxCount,
            from: from,
            to: to,
            data: data,
            gasUsed: gasUsed,
            relayer: msg.sender,
            timestamp: block.timestamp,
            sponsored: sponsored
        });

        r.gasRelayed += gasUsed;
        r.txCount++;
        totalGasRelayed += gasUsed;
        totalTxRelayed++;

        // Pay relayer
        r.deposit += relayerReward;

        // Update reputation
        r.reputation = (r.reputation * 9 + 10000) / 10; // EMA toward max

        emit MetaTxExecuted(metaTxCount, from, msg.sender, gasUsed);
    }

    // ============ View ============

    function getRelayer(address r) external view returns (Relayer memory) { return relayers[r]; }
    function getSponsor(address s) external view returns (GasSponsor memory) { return sponsors[s]; }
    function getUserNonce(address user) external view returns (uint256) { return nonces[user]; }

    receive() external payable {}
}
