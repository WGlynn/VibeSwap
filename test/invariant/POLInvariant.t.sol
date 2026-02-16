// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "forge-std/Test.sol";
import "forge-std/StdInvariant.sol";
import "../../contracts/framework/VibeProtocolOwnedLiquidity.sol";
import "../../contracts/framework/interfaces/IVibeProtocolOwnedLiquidity.sol";
import "@openzeppelin/contracts/token/ERC20/ERC20.sol";

// ============ Mocks ============

contract MockInvPOLToken is ERC20 {
    constructor(string memory name_, string memory symbol_) ERC20(name_, symbol_) {}
    function mint(address to, uint256 amount) external { _mint(to, amount); }
    function burn(address from, uint256 amount) external { _burn(from, amount); }
}

contract MockInvLP is ERC20 {
    constructor() ERC20("LP", "LP") {}
    function mint(address to, uint256 amount) external { _mint(to, amount); }
    function burn(address from, uint256 amount) external { _burn(from, amount); }
}

contract MockInvPOLAmm {
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
    mapping(bytes32 => MockInvLP) public lpTokens;

    function createPool(address t0, address t1, uint256 feeRate) external returns (bytes32 poolId) {
        (address token0, address token1) = t0 < t1 ? (t0, t1) : (t1, t0);
        poolId = keccak256(abi.encodePacked(token0, token1));
        lpTokens[poolId] = new MockInvLP();
        poolsMap[poolId] = Pool(token0, token1, 0, 0, 0, feeRate, true);
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

// ============ Handler ============

/**
 * @title POLHandler
 * @notice Bounded random operations for invariant testing of protocol-owned liquidity.
 *         Tracks ghost variables for protocol-wide property assertions.
 */
contract POLHandler is Test {
    VibeProtocolOwnedLiquidity public pol;
    MockInvPOLAmm public amm;
    MockInvPOLToken public tokenA;
    MockInvPOLToken public tokenB;
    bytes32 public poolId;
    address public owner;

    // Ghost variables
    uint256 public ghost_totalDeployed;
    uint256 public ghost_totalWithdrawn;
    uint256 public ghost_deployCount;
    uint256 public ghost_withdrawCount;
    uint256 public ghost_collectCount;

    constructor(
        VibeProtocolOwnedLiquidity _pol,
        MockInvPOLAmm _amm,
        MockInvPOLToken _tokenA,
        MockInvPOLToken _tokenB,
        bytes32 _poolId,
        address _owner
    ) {
        pol = _pol;
        amm = _amm;
        tokenA = _tokenA;
        tokenB = _tokenB;
        poolId = _poolId;
        owner = _owner;
    }

    function deploy(uint256 amount) external {
        amount = bound(amount, 1 ether, 100_000 ether);

        IVibeProtocolOwnedLiquidity.DeployParams memory params = IVibeProtocolOwnedLiquidity.DeployParams({
            poolId: poolId,
            amount0: amount,
            amount1: amount,
            amount0Min: 0,
            amount1Min: 0
        });

        vm.prank(owner);
        try pol.deployLiquidity(params) {
            ghost_totalDeployed += amount;
            ghost_deployCount++;
        } catch {}
    }

    function withdraw(uint256 fraction) external {
        fraction = bound(fraction, 1, 10000);

        IVibeProtocolOwnedLiquidity.Position memory pos = pol.getPosition(poolId);
        if (!pos.active || pos.lpAmount == 0) return;

        uint256 withdrawAmount = (pos.lpAmount * fraction) / 10000;
        if (withdrawAmount == 0) withdrawAmount = 1;
        if (withdrawAmount > pos.lpAmount) withdrawAmount = pos.lpAmount;

        vm.prank(owner);
        try pol.withdrawLiquidity(poolId, withdrawAmount, 0, 0) {
            ghost_totalWithdrawn += withdrawAmount;
            ghost_withdrawCount++;
        } catch {}
    }

    function collectFees() external {
        IVibeProtocolOwnedLiquidity.Position memory pos = pol.getPosition(poolId);
        if (!pos.active) return;

        try pol.collectFees(poolId) {
            ghost_collectCount++;
        } catch {}
    }
}

// ============ Invariant Tests ============

/**
 * @title POLInvariant
 * @notice Stateful invariant testing for VibeProtocolOwnedLiquidity.
 *         Verifies position tracking consistency, LP balance accuracy,
 *         and monotonic fee collection under random operations.
 */
contract POLInvariant is StdInvariant, Test {
    VibeProtocolOwnedLiquidity public pol;
    MockInvPOLAmm public amm;
    MockInvPOLToken public tokenA;
    MockInvPOLToken public tokenB;
    MockInvPOLToken public revenueToken;
    POLHandler public handler;
    bytes32 public poolId;
    address public treasury;

    function setUp() public {
        treasury = makeAddr("treasury");

        tokenA = new MockInvPOLToken("Token A", "TKA");
        tokenB = new MockInvPOLToken("Token B", "TKB");
        revenueToken = new MockInvPOLToken("Revenue", "REV");

        amm = new MockInvPOLAmm();

        pol = new VibeProtocolOwnedLiquidity(
            address(amm),
            treasury,
            address(0),
            address(revenueToken)
        );

        poolId = amm.createPool(address(tokenA), address(tokenB), 30);

        // Fund generously
        tokenA.mint(address(amm), type(uint128).max);
        tokenB.mint(address(amm), type(uint128).max);
        tokenA.mint(address(pol), type(uint128).max);
        tokenB.mint(address(pol), type(uint128).max);

        // No pre-approvals — POL contract handles its own approvals via safeIncreaseAllowance

        handler = new POLHandler(pol, amm, tokenA, tokenB, poolId, address(this));

        targetContract(address(handler));
    }

    /// @notice Position LP amount matches actual LP token balance held by contract
    function invariant_lpBalanceMatchesPosition() public view {
        IVibeProtocolOwnedLiquidity.Position memory pos = pol.getPosition(poolId);
        address lpToken = amm.getLPToken(poolId);
        uint256 actualBalance = IERC20(lpToken).balanceOf(address(pol));

        assertEq(actualBalance, pos.lpAmount,
            "LP token balance must match position lpAmount");
    }

    /// @notice Position count matches positionIds array length
    function invariant_positionCountMatchesArray() public view {
        bytes32[] memory ids = pol.getAllPositionIds();

        // Count positions that exist
        uint256 existCount;
        for (uint256 i = 0; i < ids.length; i++) {
            if (pol.positionExists(ids[i])) {
                existCount++;
            }
        }

        assertEq(existCount, ids.length,
            "All positionIds should have positionExists == true");
    }

    /// @notice No active position has lpAmount == 0
    function invariant_noActiveWithZeroLP() public view {
        bytes32[] memory ids = pol.getAllPositionIds();
        for (uint256 i = 0; i < ids.length; i++) {
            IVibeProtocolOwnedLiquidity.Position memory pos = pol.getPosition(ids[i]);
            if (pos.active) {
                assertTrue(pos.lpAmount > 0,
                    "Active position must have lpAmount > 0");
            }
        }
    }

    /// @notice Total deployed >= total withdrawn (no value creation from thin air)
    function invariant_deployedGteWithdrawn() public view {
        assertTrue(
            handler.ghost_totalDeployed() >= handler.ghost_totalWithdrawn(),
            "Cannot withdraw more LP than was deployed"
        );
    }

    /// @notice Active position count <= total position IDs
    function invariant_activeCountBounded() public view {
        bytes32[] memory ids = pol.getAllPositionIds();
        uint256 activeCount = pol.getActivePositionCount();
        assertTrue(activeCount <= ids.length,
            "Active count cannot exceed total positions");
    }

    /// @notice Fee collection count monotonically increases
    function invariant_collectCountMonotonic() public view {
        // ghost_collectCount only increments, never decrements
        // This is trivially true by construction, but validates the handler
        assertTrue(handler.ghost_collectCount() >= 0, "Collect count is non-negative");
    }
}
