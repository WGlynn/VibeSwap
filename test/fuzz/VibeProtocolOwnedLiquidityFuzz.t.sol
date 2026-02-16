// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "forge-std/Test.sol";
import "../../contracts/framework/VibeProtocolOwnedLiquidity.sol";
import "../../contracts/framework/interfaces/IVibeProtocolOwnedLiquidity.sol";
import "@openzeppelin/contracts/token/ERC20/ERC20.sol";

// ============ Mocks ============

contract MockFuzzPOLToken is ERC20 {
    constructor(string memory name_, string memory symbol_) ERC20(name_, symbol_) {}
    function mint(address to, uint256 amount) external { _mint(to, amount); }
    function burn(address from, uint256 amount) external { _burn(from, amount); }
}

contract MockFuzzLP is ERC20 {
    constructor() ERC20("LP", "LP") {}
    function mint(address to, uint256 amount) external { _mint(to, amount); }
    function burn(address from, uint256 amount) external { _burn(from, amount); }
}

contract MockFuzzPOLAmm {
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
    mapping(bytes32 => MockFuzzLP) public lpTokens;

    function createPool(address t0, address t1, uint256 feeRate) external returns (bytes32 poolId) {
        (address token0, address token1) = t0 < t1 ? (t0, t1) : (t1, t0);
        poolId = keccak256(abi.encodePacked(token0, token1));
        lpTokens[poolId] = new MockFuzzLP();
        poolsMap[poolId] = Pool(token0, token1, 0, 0, 0, feeRate, true);
    }

    function seedPool(bytes32 poolId, uint256 r0, uint256 r1) external {
        poolsMap[poolId].reserve0 = r0;
        poolsMap[poolId].reserve1 = r1;
        poolsMap[poolId].totalLiquidity = r0;
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

        IERC20(pool.token0).transferFrom(msg.sender, address(this), amount0);
        IERC20(pool.token1).transferFrom(msg.sender, address(this), amount1);

        liquidity = amount0; // simplified
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
        require(pool.initialized && pool.totalLiquidity >= liquidity, "Invalid");

        amount0 = (liquidity * pool.reserve0) / pool.totalLiquidity;
        amount1 = (liquidity * pool.reserve1) / pool.totalLiquidity;
        require(amount0 >= amount0Min && amount1 >= amount1Min, "Slippage");

        lpTokens[poolId].transferFrom(msg.sender, address(this), liquidity);
        lpTokens[poolId].burn(address(this), liquidity);

        IERC20(pool.token0).transfer(msg.sender, amount0);
        IERC20(pool.token1).transfer(msg.sender, amount1);

        pool.reserve0 -= amount0;
        pool.reserve1 -= amount1;
        pool.totalLiquidity -= liquidity;
    }
}

// ============ Fuzz Tests ============

/**
 * @title VibeProtocolOwnedLiquidity Fuzz Tests
 * @notice Property-based testing for protocol-owned liquidity positions.
 *         Validates deploy/withdraw consistency, position tracking accuracy,
 *         and invariant preservation under random operations.
 */
contract VibeProtocolOwnedLiquidityFuzzTest is Test {
    VibeProtocolOwnedLiquidity public pol;
    MockFuzzPOLAmm public amm;
    MockFuzzPOLToken public tokenA;
    MockFuzzPOLToken public tokenB;
    MockFuzzPOLToken public revenueToken;
    address public treasury;
    bytes32 public poolId;

    uint256 constant MAX_AMOUNT = 100_000_000 ether;

    function setUp() public {
        treasury = makeAddr("treasury");

        tokenA = new MockFuzzPOLToken("Token A", "TKA");
        tokenB = new MockFuzzPOLToken("Token B", "TKB");
        revenueToken = new MockFuzzPOLToken("Revenue", "REV");

        amm = new MockFuzzPOLAmm();

        pol = new VibeProtocolOwnedLiquidity(
            address(amm),
            treasury,
            address(0),
            address(revenueToken)
        );

        poolId = amm.createPool(address(tokenA), address(tokenB), 30);

        // Fund generously (but don't pre-approve — contract handles its own approvals)
        tokenA.mint(address(amm), type(uint128).max);
        tokenB.mint(address(amm), type(uint128).max);
        tokenA.mint(address(pol), type(uint128).max);
        tokenB.mint(address(pol), type(uint128).max);
    }

    /// @notice Deploy always produces LP tokens proportional to input
    function testFuzz_deploy_producesLPTokens(uint256 amount) public {
        amount = bound(amount, 1, MAX_AMOUNT);

        IVibeProtocolOwnedLiquidity.DeployParams memory params = IVibeProtocolOwnedLiquidity.DeployParams({
            poolId: poolId,
            amount0: amount,
            amount1: amount,
            amount0Min: 0,
            amount1Min: 0
        });

        pol.deployLiquidity(params);

        IVibeProtocolOwnedLiquidity.Position memory pos = pol.getPosition(poolId);
        assertEq(pos.lpAmount, amount, "LP should equal amount0 (mock)");
        assertTrue(pos.active);
    }

    /// @notice Withdraw never returns more than was deposited (no value creation)
    function testFuzz_withdraw_neverExceedsDeposit(uint256 deployAmount, uint256 withdrawFraction) public {
        deployAmount = bound(deployAmount, 1 ether, MAX_AMOUNT);
        withdrawFraction = bound(withdrawFraction, 1, 10000); // 0.01% to 100%

        IVibeProtocolOwnedLiquidity.DeployParams memory params = IVibeProtocolOwnedLiquidity.DeployParams({
            poolId: poolId,
            amount0: deployAmount,
            amount1: deployAmount,
            amount0Min: 0,
            amount1Min: 0
        });
        pol.deployLiquidity(params);

        uint256 withdrawLP = (deployAmount * withdrawFraction) / 10000;
        if (withdrawLP == 0) withdrawLP = 1;

        // POL contract handles its own LP approvals via safeIncreaseAllowance
        uint256 treasuryABefore = tokenA.balanceOf(treasury);

        pol.withdrawLiquidity(poolId, withdrawLP, 0, 0);

        uint256 received = tokenA.balanceOf(treasury) - treasuryABefore;
        assertTrue(received <= deployAmount, "Cannot withdraw more than deposited");
    }

    /// @notice Position tracking stays consistent with random deploy/withdraw
    function testFuzz_positionTracking_consistent(uint256 deploy1, uint256 deploy2, uint256 withdrawAmount) public {
        deploy1 = bound(deploy1, 1 ether, MAX_AMOUNT / 2);
        deploy2 = bound(deploy2, 1 ether, MAX_AMOUNT / 2);

        IVibeProtocolOwnedLiquidity.DeployParams memory params = IVibeProtocolOwnedLiquidity.DeployParams({
            poolId: poolId,
            amount0: deploy1,
            amount1: deploy1,
            amount0Min: 0,
            amount1Min: 0
        });
        pol.deployLiquidity(params);

        params.amount0 = deploy2;
        params.amount1 = deploy2;
        pol.deployLiquidity(params);

        uint256 totalLP = deploy1 + deploy2;

        IVibeProtocolOwnedLiquidity.Position memory pos = pol.getPosition(poolId);
        assertEq(pos.lpAmount, totalLP, "Position LP should be sum of deploys");

        // Now withdraw a random portion
        withdrawAmount = bound(withdrawAmount, 1, totalLP);

        pol.withdrawLiquidity(poolId, withdrawAmount, 0, 0);

        pos = pol.getPosition(poolId);
        assertEq(pos.lpAmount, totalLP - withdrawAmount, "Position LP should reflect withdrawal");
    }

    /// @notice Position array length matches unique pool count
    function testFuzz_positionIds_matchCount(uint8 numPools) public {
        numPools = uint8(bound(numPools, 1, 10));

        for (uint256 i = 0; i < numPools; i++) {
            // Create unique token pairs
            MockFuzzPOLToken t0 = new MockFuzzPOLToken("T0", "T0");
            MockFuzzPOLToken t1 = new MockFuzzPOLToken("T1", "T1");

            bytes32 pid = amm.createPool(address(t0), address(t1), 30);

            t0.mint(address(pol), 1000 ether);
            t1.mint(address(pol), 1000 ether);

            IVibeProtocolOwnedLiquidity.DeployParams memory params = IVibeProtocolOwnedLiquidity.DeployParams({
                poolId: pid,
                amount0: 100 ether,
                amount1: 100 ether,
                amount0Min: 0,
                amount1Min: 0
            });
            pol.deployLiquidity(params);
        }

        bytes32[] memory ids = pol.getAllPositionIds();
        assertEq(ids.length, numPools, "Position count should match deploy count");
    }

    /// @notice Active position count is accurate after mixed operations
    function testFuzz_activeCount_accurate(uint256 deployAmount) public {
        deployAmount = bound(deployAmount, 1 ether, MAX_AMOUNT);

        IVibeProtocolOwnedLiquidity.DeployParams memory params = IVibeProtocolOwnedLiquidity.DeployParams({
            poolId: poolId,
            amount0: deployAmount,
            amount1: deployAmount,
            amount0Min: 0,
            amount1Min: 0
        });
        pol.deployLiquidity(params);
        assertEq(pol.getActivePositionCount(), 1);

        // Full withdraw → inactive
        pol.withdrawLiquidity(poolId, deployAmount, 0, 0);
        assertEq(pol.getActivePositionCount(), 0);

        // Re-deploy → active again
        pol.deployLiquidity(params);
        assertEq(pol.getActivePositionCount(), 1);
    }

    /// @notice Max positions limit enforced
    function testFuzz_maxPositions_enforced(uint8 max) public {
        max = uint8(bound(max, 1, 5));
        pol.setMaxPositions(max);

        for (uint256 i = 0; i < max; i++) {
            MockFuzzPOLToken t0 = new MockFuzzPOLToken("T0", "T0");
            MockFuzzPOLToken t1 = new MockFuzzPOLToken("T1", "T1");
            bytes32 pid = amm.createPool(address(t0), address(t1), 30);

            t0.mint(address(pol), 1000 ether);
            t1.mint(address(pol), 1000 ether);

            IVibeProtocolOwnedLiquidity.DeployParams memory params = IVibeProtocolOwnedLiquidity.DeployParams({
                poolId: pid,
                amount0: 100 ether,
                amount1: 100 ether,
                amount0Min: 0,
                amount1Min: 0
            });
            pol.deployLiquidity(params);
        }

        // One more should fail
        MockFuzzPOLToken extraT0 = new MockFuzzPOLToken("T0", "T0");
        MockFuzzPOLToken extraT1 = new MockFuzzPOLToken("T1", "T1");
        bytes32 extraPid = amm.createPool(address(extraT0), address(extraT1), 30);

        extraT0.mint(address(pol), 1000 ether);
        extraT1.mint(address(pol), 1000 ether);

        IVibeProtocolOwnedLiquidity.DeployParams memory extraParams = IVibeProtocolOwnedLiquidity.DeployParams({
            poolId: extraPid,
            amount0: 100 ether,
            amount1: 100 ether,
            amount0Min: 0,
            amount1Min: 0
        });

        vm.expectRevert(IVibeProtocolOwnedLiquidity.MaxPositionsReached.selector);
        pol.deployLiquidity(extraParams);
    }

    /// @notice LP token balance of POL always matches sum of active position lpAmounts
    function testFuzz_lpBalance_matchesPositions(uint256 amount1, uint256 amount2) public {
        amount1 = bound(amount1, 1 ether, MAX_AMOUNT / 2);
        amount2 = bound(amount2, 1 ether, MAX_AMOUNT / 2);

        IVibeProtocolOwnedLiquidity.DeployParams memory params = IVibeProtocolOwnedLiquidity.DeployParams({
            poolId: poolId,
            amount0: amount1,
            amount1: amount1,
            amount0Min: 0,
            amount1Min: 0
        });
        pol.deployLiquidity(params);

        params.amount0 = amount2;
        params.amount1 = amount2;
        pol.deployLiquidity(params);

        address lpToken = amm.getLPToken(poolId);
        uint256 actualBalance = IERC20(lpToken).balanceOf(address(pol));
        IVibeProtocolOwnedLiquidity.Position memory pos = pol.getPosition(poolId);

        assertEq(actualBalance, pos.lpAmount, "LP balance should match position lpAmount");
    }
}
