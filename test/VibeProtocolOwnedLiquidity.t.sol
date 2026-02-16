// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "forge-std/Test.sol";
import "../contracts/framework/VibeProtocolOwnedLiquidity.sol";
import "../contracts/framework/interfaces/IVibeProtocolOwnedLiquidity.sol";
import "@openzeppelin/contracts/token/ERC20/ERC20.sol";

// ============ Mocks ============

contract MockPOLToken is ERC20 {
    constructor(string memory name_, string memory symbol_) ERC20(name_, symbol_) {}
    function mint(address to, uint256 amount) external { _mint(to, amount); }
    function burn(address from, uint256 amount) external { _burn(from, amount); }
}

contract MockLPToken is ERC20 {
    constructor() ERC20("LP Token", "LP") {}
    function mint(address to, uint256 amount) external { _mint(to, amount); }
    function burn(address from, uint256 amount) external { _burn(from, amount); }
}

/// @notice Mock AMM with LP tracking for POL tests
contract MockPOLAmm {
    struct Pool {
        address token0;
        address token1;
        uint256 reserve0;
        uint256 reserve1;
        uint256 totalLiquidity;
        uint256 feeRate;
        bool initialized;
    }

    mapping(bytes32 => Pool) public poolsMap;
    mapping(bytes32 => MockLPToken) public lpTokens;

    function createPool(address t0, address t1, uint256 feeRate) external returns (bytes32 poolId) {
        (address token0, address token1) = t0 < t1 ? (t0, t1) : (t1, t0);
        // Include feeRate in poolId to allow multiple pools for same token pair
        poolId = keccak256(abi.encodePacked(token0, token1, feeRate));
        lpTokens[poolId] = new MockLPToken();
        poolsMap[poolId] = Pool(token0, token1, 0, 0, 0, feeRate, true);
    }

    function seedPool(bytes32 poolId, uint256 r0, uint256 r1) external {
        poolsMap[poolId].reserve0 = r0;
        poolsMap[poolId].reserve1 = r1;
        poolsMap[poolId].totalLiquidity = r0; // simplified — use r0 as total liquidity
    }

    function getPool(bytes32 poolId) external view returns (Pool memory) {
        return poolsMap[poolId];
    }

    function getLPToken(bytes32 poolId) external view returns (address) {
        return address(lpTokens[poolId]);
    }

    function getPoolId(address tokenA, address tokenB) external pure returns (bytes32) {
        (address t0, address t1) = tokenA < tokenB ? (tokenA, tokenB) : (tokenB, tokenA);
        return keccak256(abi.encodePacked(t0, t1));
    }

    function addLiquidity(
        bytes32 poolId,
        uint256 amount0Desired,
        uint256 amount1Desired,
        uint256 amount0Min,
        uint256 amount1Min
    ) external returns (uint256 amount0, uint256 amount1, uint256 liquidity) {
        Pool storage pool = poolsMap[poolId];
        require(pool.initialized, "Pool not found");

        amount0 = amount0Desired;
        amount1 = amount1Desired;
        require(amount0 >= amount0Min && amount1 >= amount1Min, "Slippage");

        // Transfer tokens from caller
        IERC20(pool.token0).transferFrom(msg.sender, address(this), amount0);
        IERC20(pool.token1).transferFrom(msg.sender, address(this), amount1);

        // Mint LP tokens (simplified: liquidity = amount0)
        liquidity = amount0;
        lpTokens[poolId].mint(msg.sender, liquidity);

        pool.reserve0 += amount0;
        pool.reserve1 += amount1;
        pool.totalLiquidity += liquidity;
    }

    function removeLiquidity(
        bytes32 poolId,
        uint256 liquidity,
        uint256 amount0Min,
        uint256 amount1Min
    ) external returns (uint256 amount0, uint256 amount1) {
        Pool storage pool = poolsMap[poolId];
        require(pool.initialized, "Pool not found");
        require(pool.totalLiquidity >= liquidity, "Not enough liquidity");

        // Calculate proportional amounts
        amount0 = (liquidity * pool.reserve0) / pool.totalLiquidity;
        amount1 = (liquidity * pool.reserve1) / pool.totalLiquidity;
        require(amount0 >= amount0Min && amount1 >= amount1Min, "Slippage");

        // Burn LP tokens (transferFrom caller then burn)
        lpTokens[poolId].transferFrom(msg.sender, address(this), liquidity);
        lpTokens[poolId].burn(address(this), liquidity);

        // Return tokens
        IERC20(pool.token0).transfer(msg.sender, amount0);
        IERC20(pool.token1).transfer(msg.sender, amount1);

        pool.reserve0 -= amount0;
        pool.reserve1 -= amount1;
        pool.totalLiquidity -= liquidity;
    }
}

contract MockRevShare {
    uint256 public totalDeposited;

    function depositRevenue(uint256 amount) external {
        totalDeposited += amount;
    }
}

// ============ Unit Tests ============

/**
 * @title VibeProtocolOwnedLiquidity Unit Tests
 * @notice Tests for treasury-owned LP positions, fee collection,
 *         rebalancing, and emergency withdrawals.
 *         Part of VSOS mandatory verification layer.
 */
contract VibeProtocolOwnedLiquidityTest is Test {
    event LiquidityDeployed(bytes32 indexed poolId, uint256 amount0, uint256 amount1, uint256 lpAmount);
    event FeesCollected(bytes32 indexed poolId, uint256 amount0, uint256 amount1);

    VibeProtocolOwnedLiquidity public pol;
    MockPOLAmm public amm;
    MockRevShare public revShare;
    MockPOLToken public tokenA;
    MockPOLToken public tokenB;
    MockPOLToken public tokenC;
    MockPOLToken public revenueToken;

    address public treasury;
    address public alice;
    bytes32 public poolId;
    bytes32 public poolId2;

    uint256 constant FUND_AMOUNT = 1_000_000 ether;
    uint256 constant DEPLOY_AMOUNT = 10_000 ether;

    function setUp() public {
        treasury = makeAddr("treasury");
        alice = makeAddr("alice");

        tokenA = new MockPOLToken("Token A", "TKA");
        tokenB = new MockPOLToken("Token B", "TKB");
        tokenC = new MockPOLToken("Token C", "TKC");
        revenueToken = new MockPOLToken("Revenue", "REV");

        amm = new MockPOLAmm();
        revShare = new MockRevShare();

        pol = new VibeProtocolOwnedLiquidity(
            address(amm),
            treasury,
            address(revShare),
            address(revenueToken)
        );

        // Create pools (same tokens, different fee rates → different poolIds)
        poolId = amm.createPool(address(tokenA), address(tokenB), 30);   // 0.3% fee
        poolId2 = amm.createPool(address(tokenA), address(tokenB), 100); // 1.0% fee

        // Fund AMM pools with tokens for removeLiquidity returns
        tokenA.mint(address(amm), FUND_AMOUNT);
        tokenB.mint(address(amm), FUND_AMOUNT);
        tokenC.mint(address(amm), FUND_AMOUNT);

        // Fund POL contract with tokens (simulating treasury transfer)
        tokenA.mint(address(pol), FUND_AMOUNT);
        tokenB.mint(address(pol), FUND_AMOUNT);
        tokenC.mint(address(pol), FUND_AMOUNT);

        // NOTE: No pre-approvals — the POL contract manages its own approvals
        // via safeIncreaseAllowance inside deployLiquidity/rebalance
    }

    // ============ Constructor Tests ============

    function test_constructor_ownerSet() public view {
        assertEq(pol.owner(), address(this));
    }

    function test_constructor_dependenciesWired() public view {
        assertEq(pol.vibeAMM(), address(amm));
        assertEq(pol.daoTreasury(), treasury);
        assertEq(pol.revShare(), address(revShare));
    }

    function test_constructor_maxPositionsDefault() public view {
        assertEq(pol.maxPositions(), 50);
    }

    // ============ deployLiquidity ============

    function test_deployLiquidity_success() public {
        IVibeProtocolOwnedLiquidity.DeployParams memory params = IVibeProtocolOwnedLiquidity.DeployParams({
            poolId: poolId,
            amount0: DEPLOY_AMOUNT,
            amount1: DEPLOY_AMOUNT,
            amount0Min: 0,
            amount1Min: 0
        });

        pol.deployLiquidity(params);

        IVibeProtocolOwnedLiquidity.Position memory pos = pol.getPosition(poolId);
        assertTrue(pos.active);
        assertEq(pos.lpAmount, DEPLOY_AMOUNT); // mock: liquidity = amount0
    }

    function test_deployLiquidity_lpTokensReceived() public {
        IVibeProtocolOwnedLiquidity.DeployParams memory params = IVibeProtocolOwnedLiquidity.DeployParams({
            poolId: poolId,
            amount0: DEPLOY_AMOUNT,
            amount1: DEPLOY_AMOUNT,
            amount0Min: 0,
            amount1Min: 0
        });

        pol.deployLiquidity(params);

        address lpToken = amm.getLPToken(poolId);
        assertEq(IERC20(lpToken).balanceOf(address(pol)), DEPLOY_AMOUNT);
    }

    function test_deployLiquidity_positionRecorded() public {
        IVibeProtocolOwnedLiquidity.DeployParams memory params = IVibeProtocolOwnedLiquidity.DeployParams({
            poolId: poolId,
            amount0: DEPLOY_AMOUNT,
            amount1: DEPLOY_AMOUNT,
            amount0Min: 0,
            amount1Min: 0
        });

        pol.deployLiquidity(params);

        bytes32[] memory ids = pol.getAllPositionIds();
        assertEq(ids.length, 1);
        assertEq(ids[0], poolId);
    }

    function test_deployLiquidity_emitsEvent() public {
        IVibeProtocolOwnedLiquidity.DeployParams memory params = IVibeProtocolOwnedLiquidity.DeployParams({
            poolId: poolId,
            amount0: DEPLOY_AMOUNT,
            amount1: DEPLOY_AMOUNT,
            amount0Min: 0,
            amount1Min: 0
        });

        vm.expectEmit(true, false, false, true);
        emit LiquidityDeployed(poolId, DEPLOY_AMOUNT, DEPLOY_AMOUNT, DEPLOY_AMOUNT);
        pol.deployLiquidity(params);
    }

    function test_deployLiquidity_onlyOwner() public {
        IVibeProtocolOwnedLiquidity.DeployParams memory params = IVibeProtocolOwnedLiquidity.DeployParams({
            poolId: poolId,
            amount0: DEPLOY_AMOUNT,
            amount1: DEPLOY_AMOUNT,
            amount0Min: 0,
            amount1Min: 0
        });

        vm.prank(alice);
        vm.expectRevert();
        pol.deployLiquidity(params);
    }

    function test_deployLiquidity_addToExisting() public {
        IVibeProtocolOwnedLiquidity.DeployParams memory params = IVibeProtocolOwnedLiquidity.DeployParams({
            poolId: poolId,
            amount0: DEPLOY_AMOUNT,
            amount1: DEPLOY_AMOUNT,
            amount0Min: 0,
            amount1Min: 0
        });

        pol.deployLiquidity(params);
        pol.deployLiquidity(params);

        IVibeProtocolOwnedLiquidity.Position memory pos = pol.getPosition(poolId);
        assertEq(pos.lpAmount, DEPLOY_AMOUNT * 2);

        // Should still be one position, not two
        bytes32[] memory ids = pol.getAllPositionIds();
        assertEq(ids.length, 1);
    }

    function test_deployLiquidity_zeroAmount_reverts() public {
        IVibeProtocolOwnedLiquidity.DeployParams memory params = IVibeProtocolOwnedLiquidity.DeployParams({
            poolId: poolId,
            amount0: 0,
            amount1: 0,
            amount0Min: 0,
            amount1Min: 0
        });

        vm.expectRevert(IVibeProtocolOwnedLiquidity.ZeroAmount.selector);
        pol.deployLiquidity(params);
    }

    // ============ withdrawLiquidity ============

    function _deployFirst() internal {
        IVibeProtocolOwnedLiquidity.DeployParams memory params = IVibeProtocolOwnedLiquidity.DeployParams({
            poolId: poolId,
            amount0: DEPLOY_AMOUNT,
            amount1: DEPLOY_AMOUNT,
            amount0Min: 0,
            amount1Min: 0
        });
        pol.deployLiquidity(params);
        // POL contract manages its own LP token approvals via safeIncreaseAllowance
    }

    function test_withdrawLiquidity_partial() public {
        _deployFirst();

        uint256 withdrawAmount = DEPLOY_AMOUNT / 2;
        pol.withdrawLiquidity(poolId, withdrawAmount, 0, 0);

        IVibeProtocolOwnedLiquidity.Position memory pos = pol.getPosition(poolId);
        assertEq(pos.lpAmount, DEPLOY_AMOUNT - withdrawAmount);
        assertTrue(pos.active);
    }

    function test_withdrawLiquidity_full_marksInactive() public {
        _deployFirst();

        pol.withdrawLiquidity(poolId, DEPLOY_AMOUNT, 0, 0);

        IVibeProtocolOwnedLiquidity.Position memory pos = pol.getPosition(poolId);
        assertEq(pos.lpAmount, 0);
        assertFalse(pos.active);
    }

    function test_withdrawLiquidity_tokensReturnedToTreasury() public {
        _deployFirst();

        uint256 treasuryABefore = tokenA.balanceOf(treasury);
        uint256 treasuryBBefore = tokenB.balanceOf(treasury);

        pol.withdrawLiquidity(poolId, DEPLOY_AMOUNT, 0, 0);

        assertGt(tokenA.balanceOf(treasury), treasuryABefore);
        assertGt(tokenB.balanceOf(treasury), treasuryBBefore);
    }

    function test_withdrawLiquidity_onlyOwner() public {
        _deployFirst();

        vm.prank(alice);
        vm.expectRevert();
        pol.withdrawLiquidity(poolId, DEPLOY_AMOUNT, 0, 0);
    }

    function test_withdrawLiquidity_positionNotFound_reverts() public {
        vm.expectRevert(IVibeProtocolOwnedLiquidity.PositionNotFound.selector);
        pol.withdrawLiquidity(bytes32("nonexistent"), 100, 0, 0);
    }

    function test_withdrawLiquidity_zeroAmount_reverts() public {
        _deployFirst();

        vm.expectRevert(IVibeProtocolOwnedLiquidity.ZeroAmount.selector);
        pol.withdrawLiquidity(poolId, 0, 0, 0);
    }

    function test_withdrawLiquidity_insufficientLP_reverts() public {
        _deployFirst();

        vm.expectRevert(IVibeProtocolOwnedLiquidity.InsufficientLPBalance.selector);
        pol.withdrawLiquidity(poolId, DEPLOY_AMOUNT + 1, 0, 0);
    }

    // ============ collectFees ============

    function test_collectFees_emitsEvent() public {
        _deployFirst();

        vm.expectEmit(true, false, false, true);
        emit FeesCollected(poolId, 0, 0);
        pol.collectFees(poolId);
    }

    function test_collectFees_anyoneCanTrigger() public {
        _deployFirst();

        vm.prank(alice);
        pol.collectFees(poolId); // should not revert
    }

    function test_collectFees_positionNotFound_reverts() public {
        vm.expectRevert(IVibeProtocolOwnedLiquidity.PositionNotFound.selector);
        pol.collectFees(bytes32("nonexistent"));
    }

    function test_collectFees_inactivePosition_reverts() public {
        _deployFirst();
        pol.withdrawLiquidity(poolId, DEPLOY_AMOUNT, 0, 0);

        vm.expectRevert(IVibeProtocolOwnedLiquidity.PositionNotActive.selector);
        pol.collectFees(poolId);
    }

    // ============ collectAllFees ============

    function test_collectAllFees_iteratesAllPositions() public {
        // Deploy to two pools
        _deployFirst();

        IVibeProtocolOwnedLiquidity.DeployParams memory params2 = IVibeProtocolOwnedLiquidity.DeployParams({
            poolId: poolId2,
            amount0: DEPLOY_AMOUNT,
            amount1: DEPLOY_AMOUNT,
            amount0Min: 0,
            amount1Min: 0
        });
        pol.deployLiquidity(params2);

        // collectAllFees should not revert
        pol.collectAllFees();
    }

    function test_collectAllFees_skipsInactive() public {
        _deployFirst();
        pol.withdrawLiquidity(poolId, DEPLOY_AMOUNT, 0, 0);

        // Should not revert even though the only position is inactive
        pol.collectAllFees();
    }

    // ============ rebalance ============

    function test_rebalance_success() public {
        _deployFirst();

        // Seed pool2 so it can accept liquidity
        amm.seedPool(poolId2, 1000 ether, 1000 ether);

        pol.rebalance(poolId, poolId2, DEPLOY_AMOUNT / 2);

        IVibeProtocolOwnedLiquidity.Position memory fromPos = pol.getPosition(poolId);
        IVibeProtocolOwnedLiquidity.Position memory toPos = pol.getPosition(poolId2);

        assertEq(fromPos.lpAmount, DEPLOY_AMOUNT / 2);
        assertTrue(toPos.active);
        assertGt(toPos.lpAmount, 0);
    }

    function test_rebalance_atomicMovement() public {
        _deployFirst();
        amm.seedPool(poolId2, 1000 ether, 1000 ether);

        uint256 totalPositionsBefore = pol.getActivePositionCount();
        pol.rebalance(poolId, poolId2, DEPLOY_AMOUNT);

        // From-pool should be inactive, to-pool should be active
        IVibeProtocolOwnedLiquidity.Position memory fromPos = pol.getPosition(poolId);
        assertFalse(fromPos.active);

        // Active count should remain same (1 deactivated, 1 activated)
        uint256 totalPositionsAfter = pol.getActivePositionCount();
        assertEq(totalPositionsAfter, totalPositionsBefore);
    }

    function test_rebalance_onlyOwner() public {
        _deployFirst();

        vm.prank(alice);
        vm.expectRevert();
        pol.rebalance(poolId, poolId2, 100);
    }

    // ============ emergencyWithdrawAll ============

    function test_emergencyWithdrawAll_success() public {
        _deployFirst();

        pol.emergencyWithdrawAll();

        IVibeProtocolOwnedLiquidity.Position memory pos = pol.getPosition(poolId);
        assertFalse(pos.active);
        assertEq(pos.lpAmount, 0);
    }

    function test_emergencyWithdrawAll_onlyOwner() public {
        _deployFirst();

        vm.prank(alice);
        vm.expectRevert();
        pol.emergencyWithdrawAll();
    }

    function test_emergencyWithdrawAll_noPositions_reverts() public {
        vm.expectRevert(IVibeProtocolOwnedLiquidity.NoActivePositions.selector);
        pol.emergencyWithdrawAll();
    }

    function test_emergencyWithdrawAll_sendsToTreasury() public {
        _deployFirst();

        uint256 treasuryABefore = tokenA.balanceOf(treasury);

        pol.emergencyWithdrawAll();

        assertGt(tokenA.balanceOf(treasury), treasuryABefore);
    }

    // ============ Views ============

    function test_view_getPosition() public {
        _deployFirst();

        IVibeProtocolOwnedLiquidity.Position memory pos = pol.getPosition(poolId);
        assertEq(pos.poolId, poolId);
        assertTrue(pos.active);
    }

    function test_view_getAllPositionIds() public {
        _deployFirst();

        IVibeProtocolOwnedLiquidity.DeployParams memory params2 = IVibeProtocolOwnedLiquidity.DeployParams({
            poolId: poolId2,
            amount0: DEPLOY_AMOUNT,
            amount1: DEPLOY_AMOUNT,
            amount0Min: 0,
            amount1Min: 0
        });
        pol.deployLiquidity(params2);

        bytes32[] memory ids = pol.getAllPositionIds();
        assertEq(ids.length, 2);
    }

    function test_view_getActivePositionCount() public {
        _deployFirst();
        assertEq(pol.getActivePositionCount(), 1);

        pol.withdrawLiquidity(poolId, DEPLOY_AMOUNT, 0, 0);
        assertEq(pol.getActivePositionCount(), 0);
    }

    function test_view_getTotalLPValue() public {
        _deployFirst();

        (uint256 amount0, uint256 amount1) = pol.getTotalLPValue(poolId);
        assertGt(amount0, 0);
        assertGt(amount1, 0);
    }

    // ============ Admin ============

    function test_admin_setMaxPositions() public {
        pol.setMaxPositions(10);
        assertEq(pol.maxPositions(), 10);
    }

    function test_admin_maxPositionsEnforced() public {
        pol.setMaxPositions(1);

        IVibeProtocolOwnedLiquidity.DeployParams memory params = IVibeProtocolOwnedLiquidity.DeployParams({
            poolId: poolId,
            amount0: DEPLOY_AMOUNT,
            amount1: DEPLOY_AMOUNT,
            amount0Min: 0,
            amount1Min: 0
        });
        pol.deployLiquidity(params);

        IVibeProtocolOwnedLiquidity.DeployParams memory params2 = IVibeProtocolOwnedLiquidity.DeployParams({
            poolId: poolId2,
            amount0: DEPLOY_AMOUNT,
            amount1: DEPLOY_AMOUNT,
            amount0Min: 0,
            amount1Min: 0
        });

        vm.expectRevert(IVibeProtocolOwnedLiquidity.MaxPositionsReached.selector);
        pol.deployLiquidity(params2);
    }

    function test_admin_recoverToken() public {
        MockPOLToken stray = new MockPOLToken("Stray", "STR");
        stray.mint(address(pol), 1000 ether);

        pol.recoverToken(address(stray), 1000 ether);
        assertEq(stray.balanceOf(treasury), 1000 ether);
    }
}
