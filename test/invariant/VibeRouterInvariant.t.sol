// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "forge-std/Test.sol";
import "forge-std/StdInvariant.sol";
import "../../contracts/amm/VibeRouter.sol";
import "@openzeppelin/contracts/proxy/ERC1967/ERC1967Proxy.sol";
import "@openzeppelin/contracts/token/ERC20/ERC20.sol";

// ============ Mock Contracts ============

contract MockERC20 is ERC20 {
    constructor(string memory name_, string memory symbol_) ERC20(name_, symbol_) {}

    function mint(address to, uint256 amount) external {
        _mint(to, amount);
    }
}

contract MockPool {
    uint256 public feeRate;

    constructor(uint256 _feeRate) {
        feeRate = _feeRate;
    }

    function swap(
        address tokenIn,
        address tokenOut,
        uint256 amountIn,
        uint256,
        address to
    ) external returns (uint256 amountOut) {
        amountOut = amountIn - (amountIn * feeRate / 10000);
        IERC20(tokenIn).transferFrom(msg.sender, address(this), amountIn);
        MockERC20(tokenOut).mint(to, amountOut);
        return amountOut;
    }

    function getAmountOut(address, address, uint256 amountIn) external view returns (uint256) {
        return amountIn - (amountIn * feeRate / 10000);
    }
}

// ============ Handler ============

/**
 * @title VibeRouter Handler for Invariant Testing
 * @notice Bounded random calls to router: register/remove pools, execute swaps
 */
contract VibeRouterHandler is Test {
    VibeRouter public router;
    MockERC20 public tokenA;
    MockERC20 public tokenB;
    address public owner;

    // Tracking state
    address[] public createdPools;
    uint256 public ghost_totalSwaps;
    uint256 public ghost_totalRegistered;
    uint256 public ghost_totalRemoved;
    uint256 public ghost_totalInputVolume;
    uint256 public ghost_totalOutputVolume;

    address[] public users;

    constructor(
        VibeRouter _router,
        MockERC20 _tokenA,
        MockERC20 _tokenB,
        address _owner
    ) {
        router = _router;
        tokenA = _tokenA;
        tokenB = _tokenB;
        owner = _owner;

        for (uint256 i = 0; i < 5; i++) {
            address u = address(uint160(2000 + i));
            users.push(u);
            tokenA.mint(u, 1_000_000 ether);
            vm.prank(u);
            tokenA.approve(address(router), type(uint256).max);
        }
    }

    function registerPool(uint256 feeSeed) public {
        uint256 fee = bound(feeSeed, 1, 100); // 0.01% - 1%
        MockPool pool = new MockPool(fee);
        createdPools.push(address(pool));

        vm.prank(owner);
        try router.registerPool(address(pool), 0) {
            ghost_totalRegistered++;
        } catch {}
    }

    function removePool(uint256 indexSeed) public {
        if (createdPools.length == 0) return;
        uint256 idx = indexSeed % createdPools.length;
        address pool = createdPools[idx];

        if (!router.isRegisteredPool(pool)) return;

        vm.prank(owner);
        try router.removePool(pool) {
            ghost_totalRemoved++;
        } catch {}
    }

    function executeSwap(uint256 userSeed, uint256 amountIn, uint256 poolIdx) public {
        if (createdPools.length == 0) return;
        amountIn = bound(amountIn, 0.01 ether, 10_000 ether);
        address user = users[userSeed % users.length];
        poolIdx = poolIdx % createdPools.length;

        address pool = createdPools[poolIdx];
        if (!router.isRegisteredPool(pool)) return;

        VibeRouter.Route[] memory routes = new VibeRouter.Route[](1);
        routes[0].path = new address[](2);
        routes[0].path[0] = address(tokenA);
        routes[0].path[1] = address(tokenB);
        routes[0].pools = new address[](1);
        routes[0].pools[0] = pool;
        routes[0].poolTypes = new uint256[](1);
        routes[0].poolTypes[0] = 0;

        uint256[] memory splits = new uint256[](1);
        splits[0] = 10000;

        VibeRouter.SwapParams memory params = VibeRouter.SwapParams({
            tokenIn: address(tokenA),
            tokenOut: address(tokenB),
            amountIn: amountIn,
            minAmountOut: 0,
            routes: routes,
            splitBps: splits,
            deadline: block.timestamp + 1 hours
        });

        vm.prank(user);
        try router.swap(params) returns (uint256 amountOut) {
            ghost_totalSwaps++;
            ghost_totalInputVolume += amountIn;
            ghost_totalOutputVolume += amountOut;
        } catch {}
    }
}

/**
 * @title VibeRouter Invariant Tests
 * @notice Tests protocol-wide invariants for VibeRouter under random operations
 */
contract VibeRouterInvariantTest is StdInvariant, Test {
    VibeRouter public router;
    MockERC20 public tokenA;
    MockERC20 public tokenB;
    VibeRouterHandler public handler;
    address public owner;

    function setUp() public {
        owner = address(this);

        tokenA = new MockERC20("Token A", "TKA");
        tokenB = new MockERC20("Token B", "TKB");

        VibeRouter impl = new VibeRouter();
        bytes memory initData = abi.encodeWithSelector(VibeRouter.initialize.selector, owner);
        ERC1967Proxy proxy = new ERC1967Proxy(address(impl), initData);
        router = VibeRouter(address(proxy));

        handler = new VibeRouterHandler(router, tokenA, tokenB, owner);
        targetContract(address(handler));
    }

    // ============ Invariants ============

    /**
     * @notice Invariant: router should never hold user tokens
     * @dev After every operation, the router's token balances should be zero.
     *      Tokens pass through the router but never stay there.
     */
    function invariant_routerHoldsNoTokens() public view {
        assertEq(
            tokenA.balanceOf(address(router)),
            0,
            "Router holds tokenA (token leak)"
        );
        assertEq(
            tokenB.balanceOf(address(router)),
            0,
            "Router holds tokenB (token leak)"
        );
    }

    /**
     * @notice Invariant: pool registration count matches registered - removed
     */
    function invariant_poolCountConsistency() public view {
        uint256 expectedCount = handler.ghost_totalRegistered() - handler.ghost_totalRemoved();
        assertEq(
            router.getRegisteredPoolCount(),
            expectedCount,
            "Pool count inconsistency: registered - removed != actual count"
        );
    }

    /**
     * @notice Invariant: output volume is always less than input volume (fees exist)
     * @dev Unless zero swaps occurred, total output must be strictly less than total input
     */
    function invariant_outputLessThanInput() public view {
        if (handler.ghost_totalSwaps() > 0) {
            assertLt(
                handler.ghost_totalOutputVolume(),
                handler.ghost_totalInputVolume(),
                "Output volume >= input volume (fee invariant violated)"
            );
        }
    }

    /**
     * @notice Invariant: isRegisteredPool is consistent with registeredPools array
     */
    function invariant_registrationConsistency() public view {
        uint256 count = router.getRegisteredPoolCount();
        for (uint256 i = 0; i < count; i++) {
            address pool = router.registeredPools(i);
            assertTrue(
                router.isRegisteredPool(pool),
                "Pool in array but not marked registered"
            );
        }
    }

    /**
     * @notice Call summary for debugging invariant failures
     */
    function invariant_callSummary() public view {
        console.log("--- VibeRouter Invariant Summary ---");
        console.log("Total swaps:", handler.ghost_totalSwaps());
        console.log("Pools registered:", handler.ghost_totalRegistered());
        console.log("Pools removed:", handler.ghost_totalRemoved());
        console.log("Input volume:", handler.ghost_totalInputVolume());
        console.log("Output volume:", handler.ghost_totalOutputVolume());
    }
}
