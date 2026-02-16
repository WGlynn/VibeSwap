// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

interface ICooperativeMEVRedistributor {

    // ============ Structs ============

    struct MEVDistribution {
        uint64 batchId;
        bytes32 poolId;
        uint256 totalPriorityRevenue;
        uint256 lpShare;
        uint256 traderShare;
        uint256 treasuryShare;
        bool distributed;
    }

    struct LPReward {
        uint256 amount;
        bool claimed;
    }

    // ============ Events ============

    event MEVCaptured(uint64 indexed batchId, bytes32 indexed poolId, uint256 totalRevenue);
    event MEVDistributed(uint64 indexed batchId, uint256 lpShare, uint256 traderShare, uint256 treasuryShare);
    event LPRewardClaimed(uint64 indexed batchId, address indexed lp, uint256 amount);
    event TraderRefundClaimed(uint64 indexed batchId, address indexed trader, uint256 amount);

    // ============ Errors ============

    error ZeroAmount();
    error ZeroAddress();
    error AlreadyCaptured();
    error AlreadyDistributed();
    error NotDistributed();
    error AlreadyClaimed();
    error NothingToClaim();
    error InvalidShares();
    error BatchNotSettled();

    // ============ Core ============

    function captureMEV(uint64 batchId, bytes32 poolId, uint256 revenue) external;
    function distributeMEV(uint64 batchId, address[] calldata lps, uint256[] calldata lpWeights, address[] calldata traders, uint256[] calldata traderWeights) external;
    function claimLPReward(uint64 batchId) external;
    function claimTraderRefund(uint64 batchId) external;

    // ============ Views ============

    function getDistribution(uint64 batchId) external view returns (MEVDistribution memory);
    function pendingLPReward(uint64 batchId, address lp) external view returns (uint256);
    function pendingTraderRefund(uint64 batchId, address trader) external view returns (uint256);
}
