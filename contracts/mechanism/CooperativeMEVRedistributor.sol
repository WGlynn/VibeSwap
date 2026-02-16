// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "./interfaces/ICooperativeMEVRedistributor.sol";

/**
 * @title CooperativeMEVRedistributor
 * @notice Redistributes MEV priority bid revenue to LPs and traders via Shapley-weighted splits.
 *         Cooperative capitalism: extractive MEV -> cooperative surplus.
 *         LPs get 60%, traders 30%, treasury 10%.
 */
contract CooperativeMEVRedistributor is ICooperativeMEVRedistributor, Ownable, ReentrancyGuard {

    // ============ Constants ============

    uint256 public constant PRECISION = 1e18;
    uint16 public constant LP_SHARE_BPS = 6000;      // 60%
    uint16 public constant TRADER_SHARE_BPS = 3000;   // 30%
    uint16 public constant TREASURY_SHARE_BPS = 1000;  // 10%

    // ============ State ============

    address public treasury;
    address public token; // payment token for MEV revenue

    mapping(uint64 => MEVDistribution) private _distributions;
    mapping(uint64 => mapping(address => LPReward)) private _lpRewards;
    mapping(uint64 => mapping(address => LPReward)) private _traderRefunds;
    mapping(address => bool) public authorizedCapturers;

    // ============ Constructor ============

    constructor(address _treasury, address _token) Ownable(msg.sender) {
        if (_treasury == address(0) || _token == address(0)) revert ZeroAddress();
        treasury = _treasury;
        token = _token;
    }

    // ============ Core ============

    function captureMEV(uint64 batchId, bytes32 poolId, uint256 revenue) external {
        if (!authorizedCapturers[msg.sender] && msg.sender != owner()) revert NotDistributed();
        if (revenue == 0) revert ZeroAmount();
        if (_distributions[batchId].totalPriorityRevenue > 0) revert AlreadyCaptured();

        // Pull revenue tokens from caller
        _transferFrom(token, msg.sender, address(this), revenue);

        // Compute splits
        uint256 lpShare = (revenue * LP_SHARE_BPS) / 10000;
        uint256 traderShare = (revenue * TRADER_SHARE_BPS) / 10000;
        uint256 treasuryShare = revenue - lpShare - traderShare;

        _distributions[batchId] = MEVDistribution({
            batchId: batchId,
            poolId: poolId,
            totalPriorityRevenue: revenue,
            lpShare: lpShare,
            traderShare: traderShare,
            treasuryShare: treasuryShare,
            distributed: false
        });

        // Send treasury share immediately
        if (treasuryShare > 0) {
            _transfer(token, treasury, treasuryShare);
        }

        emit MEVCaptured(batchId, poolId, revenue);
    }

    function distributeMEV(
        uint64 batchId,
        address[] calldata lps,
        uint256[] calldata lpWeights,
        address[] calldata traders,
        uint256[] calldata traderWeights
    ) external {
        if (msg.sender != owner() && !authorizedCapturers[msg.sender]) revert NotDistributed();

        MEVDistribution storage dist = _distributions[batchId];
        if (dist.totalPriorityRevenue == 0) revert ZeroAmount();
        if (dist.distributed) revert AlreadyDistributed();

        dist.distributed = true;

        // Distribute LP shares by weight
        if (lps.length > 0) {
            uint256 totalLPWeight;
            for (uint256 i; i < lpWeights.length; i++) {
                totalLPWeight += lpWeights[i];
            }
            if (totalLPWeight > 0) {
                for (uint256 i; i < lps.length; i++) {
                    uint256 reward = (dist.lpShare * lpWeights[i]) / totalLPWeight;
                    _lpRewards[batchId][lps[i]].amount += reward;
                }
            }
        }

        // Distribute trader shares by weight
        if (traders.length > 0) {
            uint256 totalTraderWeight;
            for (uint256 i; i < traderWeights.length; i++) {
                totalTraderWeight += traderWeights[i];
            }
            if (totalTraderWeight > 0) {
                for (uint256 i; i < traders.length; i++) {
                    uint256 refund = (dist.traderShare * traderWeights[i]) / totalTraderWeight;
                    _traderRefunds[batchId][traders[i]].amount += refund;
                }
            }
        }

        emit MEVDistributed(batchId, dist.lpShare, dist.traderShare, dist.treasuryShare);
    }

    function claimLPReward(uint64 batchId) external nonReentrant {
        MEVDistribution storage dist = _distributions[batchId];
        if (!dist.distributed) revert NotDistributed();

        LPReward storage reward = _lpRewards[batchId][msg.sender];
        if (reward.claimed) revert AlreadyClaimed();
        if (reward.amount == 0) revert NothingToClaim();

        reward.claimed = true;
        _transfer(token, msg.sender, reward.amount);

        emit LPRewardClaimed(batchId, msg.sender, reward.amount);
    }

    function claimTraderRefund(uint64 batchId) external nonReentrant {
        MEVDistribution storage dist = _distributions[batchId];
        if (!dist.distributed) revert NotDistributed();

        LPReward storage refund = _traderRefunds[batchId][msg.sender];
        if (refund.claimed) revert AlreadyClaimed();
        if (refund.amount == 0) revert NothingToClaim();

        refund.claimed = true;
        _transfer(token, msg.sender, refund.amount);

        emit TraderRefundClaimed(batchId, msg.sender, refund.amount);
    }

    // ============ Admin ============

    function addCapturer(address capturer) external onlyOwner {
        if (capturer == address(0)) revert ZeroAddress();
        authorizedCapturers[capturer] = true;
    }

    function removeCapturer(address capturer) external onlyOwner {
        authorizedCapturers[capturer] = false;
    }

    function setTreasury(address _treasury) external onlyOwner {
        if (_treasury == address(0)) revert ZeroAddress();
        treasury = _treasury;
    }

    // ============ Views ============

    function getDistribution(uint64 batchId) external view returns (MEVDistribution memory) {
        return _distributions[batchId];
    }

    function pendingLPReward(uint64 batchId, address lp) external view returns (uint256) {
        LPReward storage r = _lpRewards[batchId][lp];
        if (r.claimed) return 0;
        return r.amount;
    }

    function pendingTraderRefund(uint64 batchId, address trader) external view returns (uint256) {
        LPReward storage r = _traderRefunds[batchId][trader];
        if (r.claimed) return 0;
        return r.amount;
    }

    // ============ Internal ============

    function _transfer(address _token, address to, uint256 amount) internal {
        (bool success, bytes memory data) = _token.call(
            abi.encodeWithSignature("transfer(address,uint256)", to, amount)
        );
        require(success && (data.length == 0 || abi.decode(data, (bool))), "Transfer failed");
    }

    function _transferFrom(address _token, address from, address to, uint256 amount) internal {
        (bool success, bytes memory data) = _token.call(
            abi.encodeWithSignature("transferFrom(address,address,uint256)", from, to, amount)
        );
        require(success && (data.length == 0 || abi.decode(data, (bool))), "TransferFrom failed");
    }
}
