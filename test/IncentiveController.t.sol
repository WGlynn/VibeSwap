// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "forge-std/Test.sol";
import "@openzeppelin/contracts/proxy/ERC1967/ERC1967Proxy.sol";
import "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import "../contracts/incentives/IncentiveController.sol";

// ============ Mocks ============

contract MockICToken is ERC20 {
    constructor() ERC20("MockToken", "MTK") {
        _mint(msg.sender, 1_000_000 ether);
    }
    function mint(address to, uint256 amount) external {
        _mint(to, amount);
    }
}

contract MockICVolatilityPool {
    uint256 public totalDeposited;

    function depositFees(bytes32, address, uint256 amount) external {
        totalDeposited += amount;
    }
}

contract MockICILProtectionVault {
    mapping(bytes32 => mapping(address => uint256)) public claimableAmounts;
    bool public positionRegistered;

    function registerPosition(bytes32, address, uint256, uint256, uint8) external {
        positionRegistered = true;
    }

    function claimProtection(bytes32 poolId, address lp) external returns (uint256) {
        uint256 amount = claimableAmounts[poolId][lp];
        claimableAmounts[poolId][lp] = 0;
        return amount;
    }

    function getClaimableAmount(bytes32 poolId, address lp) external view returns (uint256) {
        return claimableAmounts[poolId][lp];
    }

    function setClaimable(bytes32 poolId, address lp, uint256 amount) external {
        claimableAmounts[poolId][lp] = amount;
    }
}

contract MockICLoyaltyRewardsManager {
    bool public stakeRegistered;
    bool public unstakeRecorded;
    mapping(bytes32 => mapping(address => uint256)) public rewards;

    function registerStake(bytes32, address, uint256) external {
        stakeRegistered = true;
    }

    function recordUnstake(bytes32, address, uint256) external returns (uint256) {
        unstakeRecorded = true;
        return 0;
    }

    function claimRewards(bytes32 poolId, address lp) external returns (uint256) {
        uint256 amount = rewards[poolId][lp];
        rewards[poolId][lp] = 0;
        return amount;
    }

    function getPendingRewards(bytes32 poolId, address lp) external view returns (uint256) {
        return rewards[poolId][lp];
    }

    function setRewards(bytes32 poolId, address lp, uint256 amount) external {
        rewards[poolId][lp] = amount;
    }
}

contract MockICSlippageGuaranteeFund {
    mapping(bytes32 => uint256) public claimAmounts;

    function processClaim(bytes32 claimId) external returns (uint256) {
        uint256 amount = claimAmounts[claimId];
        claimAmounts[claimId] = 0;
        return amount;
    }

    function setClaimAmount(bytes32 claimId, uint256 amount) external {
        claimAmounts[claimId] = amount;
    }
}

contract MockICShapleyDistributor {
    bool public gameCreated;
    bool public valuesComputed;
    mapping(bytes32 => mapping(address => uint256)) public pendingRewards;

    function createGame(bytes32, uint256, address, IShapleyDistributor.Participant[] calldata) external {
        gameCreated = true;
    }

    function computeShapleyValues(bytes32) external {
        valuesComputed = true;
    }

    function claimReward(bytes32 gameId) external returns (uint256) {
        uint256 amount = pendingRewards[gameId][msg.sender];
        pendingRewards[gameId][msg.sender] = 0;
        return amount;
    }

    function getPendingReward(bytes32 gameId, address lp) external view returns (uint256) {
        return pendingRewards[gameId][lp];
    }

    function setReward(bytes32 gameId, address lp, uint256 amount) external {
        pendingRewards[gameId][lp] = amount;
    }
}

// ============ Tests ============

contract IncentiveControllerTest is Test {
    IncentiveController public controller;
    MockICToken public token;
    MockICVolatilityPool public volPool;
    MockICILProtectionVault public ilVault;
    MockICLoyaltyRewardsManager public loyaltyManager;
    MockICSlippageGuaranteeFund public slippageFund;
    MockICShapleyDistributor public shapley;
    address public owner;
    address public ammAddr;
    address public coreAddr;
    address public treasuryAddr;

    function setUp() public {
        owner = address(this);
        ammAddr = makeAddr("vibeAMM");
        coreAddr = makeAddr("vibeSwapCore");
        treasuryAddr = makeAddr("treasury");

        token = new MockICToken();
        volPool = new MockICVolatilityPool();
        ilVault = new MockICILProtectionVault();
        loyaltyManager = new MockICLoyaltyRewardsManager();
        slippageFund = new MockICSlippageGuaranteeFund();
        shapley = new MockICShapleyDistributor();

        IncentiveController impl = new IncentiveController();
        ERC1967Proxy proxy = new ERC1967Proxy(
            address(impl),
            abi.encodeWithSelector(
                IncentiveController.initialize.selector,
                owner,
                ammAddr,
                coreAddr,
                treasuryAddr
            )
        );
        controller = IncentiveController(payable(address(proxy)));

        // Set up sub-contracts
        controller.setVolatilityInsurancePool(address(volPool));
        controller.setILProtectionVault(address(ilVault));
        controller.setLoyaltyRewardsManager(address(loyaltyManager));
        controller.setSlippageGuaranteeFund(address(slippageFund));
        controller.setShapleyDistributor(address(shapley));
    }

    // ============ Initialization ============

    function test_initialize() public view {
        assertEq(controller.owner(), owner);
        assertEq(controller.vibeAMM(), ammAddr);
        assertEq(controller.vibeSwapCore(), coreAddr);
        assertEq(controller.treasury(), treasuryAddr);
        assertTrue(controller.authorizedCallers(ammAddr));
        assertTrue(controller.authorizedCallers(coreAddr));
    }

    function test_initialize_zeroAddress_reverts() public {
        IncentiveController impl = new IncentiveController();
        vm.expectRevert(IncentiveController.ZeroAddress.selector);
        new ERC1967Proxy(
            address(impl),
            abi.encodeWithSelector(IncentiveController.initialize.selector, owner, address(0), coreAddr, treasuryAddr)
        );
    }

    function test_defaultConfig() public view {
        IIncentiveController.IncentiveConfig memory config = controller.getPoolConfig(bytes32(0));
        assertEq(config.volatilityFeeRatioBps, 10000);
        assertEq(config.auctionToLPRatioBps, 10000);
        assertEq(config.ilProtectionCapBps, 8000);
        assertEq(config.slippageGuaranteeCapBps, 200);
        assertEq(config.loyaltyBoostMaxBps, 20000);
    }

    // ============ Fee Routing ============

    function test_routeVolatilityFee() public {
        bytes32 poolId = keccak256("pool1");

        // Fund AMM with tokens and approve controller
        token.transfer(ammAddr, 100 ether);
        vm.prank(ammAddr);
        token.approve(address(controller), 100 ether);

        vm.prank(ammAddr);
        controller.routeVolatilityFee(poolId, address(token), 10 ether);

        assertEq(volPool.totalDeposited(), 10 ether);
    }

    function test_routeVolatilityFee_zeroAmount() public {
        bytes32 poolId = keccak256("pool1");
        vm.prank(ammAddr);
        controller.routeVolatilityFee(poolId, address(token), 0);
        assertEq(volPool.totalDeposited(), 0);
    }

    function test_routeVolatilityFee_onlyAMM() public {
        bytes32 poolId = keccak256("pool1");
        vm.prank(makeAddr("rando"));
        vm.expectRevert(IncentiveController.Unauthorized.selector);
        controller.routeVolatilityFee(poolId, address(token), 10 ether);
    }

    // ============ Auction Proceeds ============

    function test_distributeAuctionProceeds() public {
        bytes32[] memory poolIds = new bytes32[](2);
        poolIds[0] = keccak256("pool1");
        poolIds[1] = keccak256("pool2");
        uint256[] memory amounts = new uint256[](2);
        amounts[0] = 5 ether;
        amounts[1] = 3 ether;

        vm.deal(coreAddr, 10 ether);
        vm.prank(coreAddr);
        controller.distributeAuctionProceeds{value: 8 ether}(1, poolIds, amounts);

        assertEq(controller.poolAuctionProceeds(poolIds[0]), 5 ether);
        assertEq(controller.poolAuctionProceeds(poolIds[1]), 3 ether);
    }

    function test_distributeAuctionProceeds_refundExcess() public {
        bytes32[] memory poolIds = new bytes32[](1);
        poolIds[0] = keccak256("pool1");
        uint256[] memory amounts = new uint256[](1);
        amounts[0] = 5 ether;

        uint256 balBefore = coreAddr.balance;
        vm.deal(coreAddr, 10 ether);
        vm.prank(coreAddr);
        controller.distributeAuctionProceeds{value: 10 ether}(1, poolIds, amounts);

        assertEq(coreAddr.balance, 5 ether);
    }

    function test_distributeAuctionProceeds_insufficientValue() public {
        bytes32[] memory poolIds = new bytes32[](1);
        poolIds[0] = keccak256("pool1");
        uint256[] memory amounts = new uint256[](1);
        amounts[0] = 5 ether;

        vm.deal(coreAddr, 1 ether);
        vm.prank(coreAddr);
        vm.expectRevert(IncentiveController.InvalidAmount.selector);
        controller.distributeAuctionProceeds{value: 1 ether}(1, poolIds, amounts);
    }

    function test_distributeAuctionProceeds_lengthMismatch() public {
        bytes32[] memory poolIds = new bytes32[](2);
        uint256[] memory amounts = new uint256[](1);

        vm.prank(coreAddr);
        vm.expectRevert(IncentiveController.InvalidConfig.selector);
        controller.distributeAuctionProceeds(1, poolIds, amounts);
    }

    function test_distributeAuctionProceeds_onlyCore() public {
        bytes32[] memory poolIds = new bytes32[](0);
        uint256[] memory amounts = new uint256[](0);

        vm.prank(makeAddr("rando"));
        vm.expectRevert(IncentiveController.Unauthorized.selector);
        controller.distributeAuctionProceeds(1, poolIds, amounts);
    }

    // ============ LP Lifecycle Hooks ============

    function test_onLiquidityAdded() public {
        bytes32 poolId = keccak256("pool1");
        address lp = makeAddr("lp");

        vm.prank(ammAddr);
        controller.onLiquidityAdded(poolId, lp, 100 ether, 2000e18);

        assertTrue(loyaltyManager.stakeRegistered());
    }

    function test_onLiquidityRemoved() public {
        bytes32 poolId = keccak256("pool1");
        address lp = makeAddr("lp");

        vm.prank(ammAddr);
        controller.onLiquidityAdded(poolId, lp, 100 ether, 2000e18);

        vm.prank(ammAddr);
        controller.onLiquidityRemoved(poolId, lp, 50 ether);

        assertTrue(loyaltyManager.unstakeRecorded());
    }

    function test_onLiquidityAdded_onlyAMM() public {
        vm.prank(makeAddr("rando"));
        vm.expectRevert(IncentiveController.Unauthorized.selector);
        controller.onLiquidityAdded(keccak256("pool1"), makeAddr("lp"), 100 ether, 2000e18);
    }

    // ============ Record Execution ============

    function test_recordExecution() public {
        bytes32 poolId = keccak256("pool1");
        address trader = makeAddr("trader");

        vm.prank(ammAddr);
        controller.recordExecution(poolId, trader, 10 ether, 9.5 ether, 9 ether);
    }

    function test_recordExecution_onlyAMM() public {
        vm.prank(makeAddr("rando"));
        vm.expectRevert(IncentiveController.Unauthorized.selector);
        controller.recordExecution(keccak256("pool1"), makeAddr("trader"), 10 ether, 9 ether, 9 ether);
    }

    // ============ Claims ============

    function test_claimILProtection() public {
        bytes32 poolId = keccak256("pool1");
        address lp = makeAddr("lp");

        ilVault.setClaimable(poolId, lp, 5 ether);

        vm.prank(lp);
        uint256 amount = controller.claimILProtection(poolId);
        assertEq(amount, 5 ether);
    }

    function test_claimILProtection_nothing() public {
        bytes32 poolId = keccak256("pool1");
        address lp = makeAddr("lp");

        vm.prank(lp);
        uint256 amount = controller.claimILProtection(poolId);
        assertEq(amount, 0);
    }

    function test_claimLoyaltyRewards() public {
        bytes32 poolId = keccak256("pool1");
        address lp = makeAddr("lp");

        loyaltyManager.setRewards(poolId, lp, 3 ether);

        vm.prank(lp);
        uint256 amount = controller.claimLoyaltyRewards(poolId);
        assertEq(amount, 3 ether);
    }

    function test_claimAuctionProceeds() public {
        bytes32 poolId = keccak256("pool1");
        bytes32[] memory poolIds = new bytes32[](1);
        poolIds[0] = poolId;
        uint256[] memory amounts = new uint256[](1);
        amounts[0] = 10 ether;

        vm.deal(coreAddr, 10 ether);
        vm.prank(coreAddr);
        controller.distributeAuctionProceeds{value: 10 ether}(1, poolIds, amounts);

        address lp = makeAddr("lp");
        vm.prank(lp);
        uint256 amount = controller.claimAuctionProceeds(poolId);
        assertEq(amount, 10 ether);
    }

    function test_claimAuctionProceeds_nothingToClaim() public {
        bytes32 poolId = keccak256("pool1");
        address lp = makeAddr("lp");

        vm.prank(lp);
        vm.expectRevert(IncentiveController.NothingToClaim.selector);
        controller.claimAuctionProceeds(poolId);
    }

    // ============ Shapley Distribution ============

    function test_setShapleyEnabled() public {
        bytes32 poolId = keccak256("pool1");
        controller.setShapleyEnabled(poolId, true);
        assertTrue(controller.isShapleyEnabled(poolId));
    }

    function test_createShapleyGame() public {
        bytes32 poolId = keccak256("pool1");
        controller.setShapleyEnabled(poolId, true);

        IShapleyDistributor.Participant[] memory participants = new IShapleyDistributor.Participant[](1);
        participants[0] = IShapleyDistributor.Participant({
            participant: makeAddr("lp1"),
            directContribution: 100 ether,
            timeInPool: 1 hours,
            scarcityScore: 5000,
            stabilityScore: 8000
        });

        // Transfer tokens to controller for game
        token.transfer(address(controller), 50 ether);

        vm.prank(owner);
        controller.createShapleyGame(1, poolId, 50 ether, address(token), participants);

        assertTrue(shapley.gameCreated());
        assertTrue(shapley.valuesComputed());
    }

    function test_createShapleyGame_notEnabled_noop() public {
        bytes32 poolId = keccak256("pool1");
        IShapleyDistributor.Participant[] memory participants = new IShapleyDistributor.Participant[](0);

        vm.prank(owner);
        controller.createShapleyGame(1, poolId, 50 ether, address(token), participants);
        assertFalse(shapley.gameCreated());
    }

    function test_claimShapleyReward() public {
        bytes32 poolId = keccak256("pool1");
        address lp = makeAddr("lp");
        bytes32 gameId = keccak256(abi.encodePacked(uint64(1), poolId));
        // The controller forwards the call to shapley, and msg.sender in shapley is the controller
        shapley.setReward(gameId, address(controller), 5 ether);

        vm.prank(lp);
        uint256 amount = controller.claimShapleyReward(1, poolId);
        assertEq(amount, 5 ether);
    }

    // ============ Admin ============

    function test_setPoolConfig() public {
        bytes32 poolId = keccak256("pool1");
        IIncentiveController.IncentiveConfig memory config = IIncentiveController.IncentiveConfig({
            volatilityFeeRatioBps: 5000,
            auctionToLPRatioBps: 8000,
            ilProtectionCapBps: 6000,
            slippageGuaranteeCapBps: 300,
            loyaltyBoostMaxBps: 15000
        });

        controller.setPoolConfig(poolId, config);

        IIncentiveController.IncentiveConfig memory stored = controller.getPoolConfig(poolId);
        assertEq(stored.volatilityFeeRatioBps, 5000);
        assertTrue(controller.hasPoolConfig(poolId));
    }

    function test_setDefaultConfig() public {
        IIncentiveController.IncentiveConfig memory config = IIncentiveController.IncentiveConfig({
            volatilityFeeRatioBps: 7000,
            auctionToLPRatioBps: 9000,
            ilProtectionCapBps: 7000,
            slippageGuaranteeCapBps: 150,
            loyaltyBoostMaxBps: 18000
        });

        controller.setDefaultConfig(config);

        IIncentiveController.IncentiveConfig memory stored = controller.getPoolConfig(keccak256("unset_pool"));
        assertEq(stored.volatilityFeeRatioBps, 7000);
    }

    function test_setAuthorizedCaller() public {
        address newCaller = makeAddr("newCaller");
        controller.setAuthorizedCaller(newCaller, true);
        assertTrue(controller.authorizedCallers(newCaller));

        controller.setAuthorizedCaller(newCaller, false);
        assertFalse(controller.authorizedCallers(newCaller));
    }

    // ============ View Functions ============

    function test_getPendingILClaim() public {
        bytes32 poolId = keccak256("pool1");
        address lp = makeAddr("lp");
        ilVault.setClaimable(poolId, lp, 7 ether);

        uint256 pending = controller.getPendingILClaim(poolId, lp);
        assertEq(pending, 7 ether);
    }

    function test_getPendingLoyaltyRewards() public {
        bytes32 poolId = keccak256("pool1");
        address lp = makeAddr("lp");
        loyaltyManager.setRewards(poolId, lp, 4 ether);

        uint256 pending = controller.getPendingLoyaltyRewards(poolId, lp);
        assertEq(pending, 4 ether);
    }

    function test_getPendingAuctionProceeds() public {
        bytes32 poolId = keccak256("pool1");
        bytes32[] memory poolIds = new bytes32[](1);
        poolIds[0] = poolId;
        uint256[] memory amounts = new uint256[](1);
        amounts[0] = 10 ether;

        vm.deal(coreAddr, 10 ether);
        vm.prank(coreAddr);
        controller.distributeAuctionProceeds{value: 10 ether}(1, poolIds, amounts);

        uint256 pending = controller.getPendingAuctionProceeds(poolId, makeAddr("lp"));
        assertEq(pending, 10 ether);
    }

    function test_getPoolIncentiveStats() public {
        bytes32 poolId = keccak256("pool1");
        bytes32[] memory poolIds = new bytes32[](1);
        poolIds[0] = poolId;
        uint256[] memory amounts = new uint256[](1);
        amounts[0] = 10 ether;

        vm.deal(coreAddr, 10 ether);
        vm.prank(coreAddr);
        controller.distributeAuctionProceeds{value: 10 ether}(1, poolIds, amounts);

        IIncentiveController.PoolIncentiveStats memory stats = controller.getPoolIncentiveStats(poolId);
        assertEq(stats.totalAuctionProceedsDistributed, 10 ether);
    }

    // ============ Receive ETH ============

    function test_receiveETH() public {
        vm.deal(address(this), 1 ether);
        (bool success,) = address(controller).call{value: 1 ether}("");
        assertTrue(success);
    }
}
