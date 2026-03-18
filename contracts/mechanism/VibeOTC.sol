// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts-upgradeable/access/OwnableUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/proxy/utils/UUPSUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/utils/ReentrancyGuardUpgradeable.sol";

/**
 * @title VibeOTC — Over-The-Counter Trading Desk
 * @notice Large block trades with no slippage, no price impact.
 *         Escrow-based OTC trades for whales and institutions.
 *
 * Flow:
 * 1. Maker creates offer (I'll sell 100 ETH for 200,000 USDC)
 * 2. Taker accepts (both sides escrowed)
 * 3. Atomic settlement (both or nothing)
 *
 * No frontrunning. No slippage. No MEV. Pure bilateral trade.
 */
contract VibeOTC is OwnableUpgradeable, UUPSUpgradeable, ReentrancyGuardUpgradeable {

    enum DealStatus { OPEN, FILLED, CANCELLED, EXPIRED, DISPUTED }

    struct Deal {
        address maker;
        address taker;               // Address(0) = open to anyone
        address makerToken;          // Address(0) = ETH
        address takerToken;          // Address(0) = ETH
        uint256 makerAmount;
        uint256 takerAmount;
        DealStatus status;
        uint256 createdAt;
        uint256 expiresAt;
        bool makerDeposited;
        bool takerDeposited;
    }

    // ============ State ============

    mapping(uint256 => Deal) public deals;
    uint256 public dealCount;
    mapping(address => uint256[]) public userDeals;

    uint256 public constant PROTOCOL_FEE_BPS = 25; // 0.25%
    uint256 public protocolFees;
    uint256 public totalVolume;

    // ============ Events ============

    event DealCreated(uint256 indexed id, address maker, uint256 makerAmount, uint256 takerAmount);
    event DealFilled(uint256 indexed id, address taker);
    event DealCancelled(uint256 indexed id);
    event DealSettled(uint256 indexed id);

    // ============ Initialize ============

    function initialize() external initializer {
        __Ownable_init(msg.sender);
        __UUPSUpgradeable_init();
        __ReentrancyGuard_init();
    }

    function _authorizeUpgrade(address newImplementation) internal override onlyOwner {
        require(newImplementation.code.length > 0, "Not a contract");
    }

    // ============ Deal Creation ============

    /// @notice Create an OTC deal (maker deposits their side)
    function createDeal(
        address taker,                // Address(0) for open deal
        address takerToken,
        uint256 takerAmount,
        uint256 duration
    ) external payable {
        require(msg.value > 0, "Deposit required");
        require(takerAmount > 0, "Zero taker amount");
        require(duration >= 1 hours && duration <= 30 days, "Invalid duration");

        uint256 id = dealCount++;
        deals[id] = Deal({
            maker: msg.sender,
            taker: taker,
            makerToken: address(0),    // ETH
            takerToken: takerToken,
            makerAmount: msg.value,
            takerAmount: takerAmount,
            status: DealStatus.OPEN,
            createdAt: block.timestamp,
            expiresAt: block.timestamp + duration,
            makerDeposited: true,
            takerDeposited: false
        });

        userDeals[msg.sender].push(id);
        emit DealCreated(id, msg.sender, msg.value, takerAmount);
    }

    /// @notice Fill an OTC deal (taker deposits their side)
    function fillDeal(uint256 dealId) external payable nonReentrant {
        Deal storage d = deals[dealId];
        require(d.status == DealStatus.OPEN, "Not open");
        require(block.timestamp <= d.expiresAt, "Expired");
        require(d.taker == address(0) || d.taker == msg.sender, "Wrong taker");

        if (d.takerToken == address(0)) {
            // Taker side is ETH
            require(msg.value >= d.takerAmount, "Insufficient");
        } else {
            // Taker side is ERC20
            bytes memory data = abi.encodeWithSignature(
                "transferFrom(address,address,uint256)",
                msg.sender, address(this), d.takerAmount
            );
            (bool ok, ) = d.takerToken.call(data);
            require(ok, "Token deposit failed");
        }

        d.taker = msg.sender;
        d.takerDeposited = true;
        d.status = DealStatus.FILLED;
        userDeals[msg.sender].push(dealId);

        // Atomic settlement
        _settle(dealId);

        emit DealFilled(dealId, msg.sender);
    }

    function _settle(uint256 dealId) internal {
        Deal storage d = deals[dealId];
        require(d.makerDeposited && d.takerDeposited, "Not fully funded");

        uint256 makerFee = (d.makerAmount * PROTOCOL_FEE_BPS) / 10000;
        uint256 takerFee;
        if (d.takerToken == address(0)) {
            takerFee = (d.takerAmount * PROTOCOL_FEE_BPS) / 10000;
        }

        protocolFees += makerFee + takerFee;
        totalVolume += d.makerAmount;

        // Send maker's ETH to taker
        (bool ok1, ) = d.taker.call{value: d.makerAmount - makerFee}("");
        require(ok1, "Maker to taker failed");

        // Send taker's tokens/ETH to maker
        if (d.takerToken == address(0)) {
            (bool ok2, ) = d.maker.call{value: d.takerAmount - takerFee}("");
            require(ok2, "Taker to maker failed");
        } else {
            bytes memory data = abi.encodeWithSignature(
                "transfer(address,uint256)",
                d.maker, d.takerAmount
            );
            (bool ok2, ) = d.takerToken.call(data);
            require(ok2, "Token transfer failed");
        }

        emit DealSettled(dealId);
    }

    /// @notice Cancel an unfilled deal
    function cancelDeal(uint256 dealId) external nonReentrant {
        Deal storage d = deals[dealId];
        require(msg.sender == d.maker, "Not maker");
        require(d.status == DealStatus.OPEN, "Not open");

        d.status = DealStatus.CANCELLED;
        (bool ok, ) = d.maker.call{value: d.makerAmount}("");
        require(ok, "Refund failed");

        emit DealCancelled(dealId);
    }

    // ============ Views ============

    function getDeal(uint256 id) external view returns (Deal memory) { return deals[id]; }
    function getUserDeals(address user) external view returns (uint256[] memory) { return userDeals[user]; }

    function withdrawFees() external onlyOwner {
        uint256 amount = protocolFees;
        protocolFees = 0;
        (bool ok, ) = owner().call{value: amount}("");
        require(ok, "Withdraw failed");
    }

    receive() external payable {}
}
