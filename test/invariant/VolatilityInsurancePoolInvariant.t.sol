// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "forge-std/Test.sol";
import "forge-std/StdInvariant.sol";
import "@openzeppelin/contracts/proxy/ERC1967/ERC1967Proxy.sol";
import "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import "../../contracts/incentives/VolatilityInsurancePool.sol";

// ============ Mocks ============

contract MockVIPIToken is ERC20 {
    constructor() ERC20("Mock", "MTK") { _mint(msg.sender, 1e24); }
    function mint(address to, uint256 amount) external { _mint(to, amount); }
}

contract MockVIPIOracle {
    function getVolatilityTier(bytes32) external pure returns (IVolatilityOracle.VolatilityTier) {
        return IVolatilityOracle.VolatilityTier.EXTREME;
    }
}

// ============ Handler ============

contract InsurancePoolHandler is Test {
    VolatilityInsurancePool public pool;
    MockVIPIToken public token;
    address public controller;
    bytes32 public poolId;

    // Ghost variables
    uint256 public ghost_totalDeposited;
    uint256 public ghost_coverageUpdates;

    constructor(VolatilityInsurancePool _pool, MockVIPIToken _token, address _controller) {
        pool = _pool;
        token = _token;
        controller = _controller;
        poolId = keccak256("pool1");
    }

    function deposit(uint256 amount) public {
        amount = bound(amount, 1, 10 ether);

        token.mint(controller, amount);
        vm.prank(controller);
        token.approve(address(pool), amount);
        vm.prank(controller);
        try pool.depositFees(poolId, address(token), amount) {
            ghost_totalDeposited += amount;
        } catch {}
    }

    function registerCoverage(uint256 seed, uint256 liquidity) public {
        liquidity = bound(liquidity, 1, 1000 ether);
        address lp = makeAddr(string(abi.encodePacked("lp", seed)));

        vm.prank(controller);
        try pool.registerCoverage(poolId, lp, liquidity) {
            ghost_coverageUpdates++;
        } catch {}
    }

    function advanceTime(uint256 delta) public {
        delta = bound(delta, 1 hours, 7 days);
        vm.warp(block.timestamp + delta);
    }
}

// ============ Invariant Tests ============

contract VolatilityInsurancePoolInvariantTest is StdInvariant, Test {
    VolatilityInsurancePool public pool;
    MockVIPIToken public token;
    InsurancePoolHandler public handler;
    address public controller;

    function setUp() public {
        controller = makeAddr("controller");
        token = new MockVIPIToken();
        MockVIPIOracle oracle = new MockVIPIOracle();

        VolatilityInsurancePool impl = new VolatilityInsurancePool();
        ERC1967Proxy proxy = new ERC1967Proxy(
            address(impl),
            abi.encodeWithSelector(VolatilityInsurancePool.initialize.selector, address(this), address(oracle), controller)
        );
        pool = VolatilityInsurancePool(address(proxy));

        vm.warp(25 hours);

        handler = new InsurancePoolHandler(pool, token, controller);
        targetContract(address(handler));
    }

    /// @notice Total deposited matches ghost tracking
    function invariant_depositsConsistent() public view {
        bytes32 poolId = keccak256("pool1");
        VolatilityInsurancePool.PoolInsurance memory ins = pool.getPoolInsurance(poolId, address(token));
        assertEq(ins.totalDeposited, handler.ghost_totalDeposited(), "DEPOSITS: ghost mismatch");
    }

    /// @notice Reserve balance never exceeds total deposited
    function invariant_reserveNeverExceedsDeposited() public view {
        bytes32 poolId = keccak256("pool1");
        VolatilityInsurancePool.PoolInsurance memory ins = pool.getPoolInsurance(poolId, address(token));
        assertLe(ins.reserveBalance, ins.totalDeposited, "RESERVE: exceeds deposited");
    }

    /// @notice Token balance equals reserve balance (no tokens lost)
    function invariant_tokenBalanceMatchesReserve() public view {
        bytes32 poolId = keccak256("pool1");
        VolatilityInsurancePool.PoolInsurance memory ins = pool.getPoolInsurance(poolId, address(token));
        assertEq(token.balanceOf(address(pool)), ins.reserveBalance, "TOKEN: balance mismatch");
    }

    /// @notice Max claim percent is always within BPS range
    function invariant_maxClaimBpsBounded() public view {
        assertLe(pool.maxClaimPercentBps(), 10000, "MAX_CLAIM: exceeds 100%");
    }
}
