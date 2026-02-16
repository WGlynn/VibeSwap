// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "forge-std/Test.sol";
import "forge-std/StdInvariant.sol";
import "../../contracts/financial/VibeOptions.sol";
import "../../contracts/financial/interfaces/IVibeOptions.sol";
import "../../contracts/core/interfaces/IVibeAMM.sol";
import "@openzeppelin/contracts/token/ERC20/ERC20.sol";

// ============ Mocks ============

contract MockOptIToken is ERC20 {
    constructor(string memory name, string memory symbol) ERC20(name, symbol) {}
    function mint(address to, uint256 amount) external { _mint(to, amount); }
}

contract MockOptIAMM {
    mapping(bytes32 => IVibeAMM.Pool) private _pools;
    mapping(bytes32 => uint256) private _spotPrices;
    mapping(bytes32 => uint256) private _twapPrices;

    function setPool(bytes32 poolId, address t0, address t1) external {
        _pools[poolId] = IVibeAMM.Pool({
            token0: t0, token1: t1,
            reserve0: 1000 ether, reserve1: 2_000_000 ether,
            totalLiquidity: 1000 ether, feeRate: 30, initialized: true
        });
    }
    function setSpotPrice(bytes32 poolId, uint256 price) external { _spotPrices[poolId] = price; }
    function setTWAP(bytes32 poolId, uint256 price) external { _twapPrices[poolId] = price; }
    function getPool(bytes32 poolId) external view returns (IVibeAMM.Pool memory) { return _pools[poolId]; }
    function getSpotPrice(bytes32 poolId) external view returns (uint256) { return _spotPrices[poolId]; }
    function getTWAP(bytes32 poolId, uint32) external view returns (uint256) { return _twapPrices[poolId]; }
    function getLPToken(bytes32) external pure returns (address) { return address(0); }
}

contract MockOptIOracle {
    function calculateRealizedVolatility(bytes32, uint32) external pure returns (uint256) { return 5000; }
}

// ============ Handler ============

contract OptionsHandler is Test {
    VibeOptions public options;
    MockOptIAMM public mockAmm;
    MockOptIToken public token0;
    MockOptIToken public token1;
    bytes32 public poolId;

    address public writer;
    address public buyer;

    uint256[] public activeOptionIds;

    // Ghost variables
    uint256 public ghost_totalCollateralDeposited;
    uint256 public ghost_totalCollateralReturned;
    uint256 public ghost_writeCount;
    uint256 public ghost_cancelCount;
    uint256 public ghost_exerciseCount;
    uint256 public ghost_reclaimCount;

    constructor(
        VibeOptions _options,
        MockOptIAMM _amm,
        MockOptIToken _token0,
        MockOptIToken _token1,
        bytes32 _poolId,
        address _writer,
        address _buyer
    ) {
        options = _options;
        mockAmm = _amm;
        token0 = _token0;
        token1 = _token1;
        poolId = _poolId;
        writer = _writer;
        buyer = _buyer;
    }

    function writeCall(uint256 amount) public {
        amount = bound(amount, 0.01 ether, 10 ether);

        token0.mint(writer, amount);
        vm.startPrank(writer);
        token0.approve(address(options), amount);

        try options.writeOption(IVibeOptions.WriteParams({
            poolId: poolId,
            optionType: IVibeOptions.OptionType.CALL,
            amount: amount,
            strikePrice: 2000e18,
            premium: 0,
            expiry: uint40(block.timestamp + 30 days),
            exerciseWindow: uint40(1 days)
        })) returns (uint256 optionId) {
            activeOptionIds.push(optionId);
            ghost_totalCollateralDeposited += amount;
            ghost_writeCount++;
        } catch {}
        vm.stopPrank();
    }

    function cancelOption(uint256 optionSeed) public {
        if (activeOptionIds.length == 0) return;

        uint256 optionId = activeOptionIds[optionSeed % activeOptionIds.length];

        try options.getOption(optionId) returns (IVibeOptions.Option memory opt) {
            if (opt.state != IVibeOptions.OptionState.WRITTEN) return;

            vm.prank(writer);
            try options.cancel(optionId) {
                ghost_totalCollateralReturned += opt.collateral;
                ghost_cancelCount++;
            } catch {}
        } catch {}
    }

    function advanceTime(uint256 delta) public {
        delta = bound(delta, 1, 7 days);
        vm.warp(block.timestamp + delta);
    }

    function getActiveCount() external view returns (uint256) {
        return activeOptionIds.length;
    }
}

// ============ Invariant Tests ============

contract VibeOptionsInvariantTest is StdInvariant, Test {
    VibeOptions public options;
    MockOptIAMM public mockAmm;
    MockOptIOracle public mockOracle;
    MockOptIToken public token0;
    MockOptIToken public token1;
    OptionsHandler public handler;

    bytes32 public poolId;
    address public writer;
    address public buyer;

    function setUp() public {
        writer = makeAddr("writer");
        buyer = makeAddr("buyer");

        token0 = new MockOptIToken("WETH", "WETH");
        token1 = new MockOptIToken("USDC", "USDC");

        mockAmm = new MockOptIAMM();
        mockOracle = new MockOptIOracle();

        poolId = keccak256("WETH/USDC");
        mockAmm.setPool(poolId, address(token0), address(token1));
        mockAmm.setSpotPrice(poolId, 2000e18);
        mockAmm.setTWAP(poolId, 2000e18);

        options = new VibeOptions(address(mockAmm), address(mockOracle));

        handler = new OptionsHandler(options, mockAmm, token0, token1, poolId, writer, buyer);
        targetContract(address(handler));
    }

    // ============ Invariant: collateral deposited >= returned ============

    function invariant_collateralSolvent() public view {
        assertGe(
            handler.ghost_totalCollateralDeposited(),
            handler.ghost_totalCollateralReturned(),
            "SOLVENCY: collateral returned exceeds deposited"
        );
    }

    // ============ Invariant: writes >= cancels + exercises + reclaims ============

    function invariant_lifecycleConsistent() public view {
        assertGe(
            handler.ghost_writeCount(),
            handler.ghost_cancelCount() + handler.ghost_exerciseCount() + handler.ghost_reclaimCount(),
            "LIFECYCLE: settlements exceed writes"
        );
    }

    // ============ Invariant: token0 balance covers active collateral ============

    function invariant_token0CoversCalls() public view {
        uint256 bal = token0.balanceOf(address(options));
        uint256 expectedMin = handler.ghost_totalCollateralDeposited() - handler.ghost_totalCollateralReturned();

        assertGe(bal, expectedMin, "BALANCE: token0 below expected collateral");
    }

    // ============ Invariant: totalOptions = cumulative writes ============

    function invariant_totalOptionsConsistent() public view {
        assertEq(
            options.totalOptions(),
            handler.ghost_writeCount(),
            "COUNT: totalOptions must equal write count"
        );
    }

    // ============ Invariant: all active options have valid state ============

    function invariant_activeOptionsValidState() public view {
        uint256 count = handler.getActiveCount();
        for (uint256 i = 0; i < count && i < 5; i++) {
            uint256 optionId = handler.activeOptionIds(i);
            try options.getOption(optionId) returns (IVibeOptions.Option memory opt) {
                uint8 state = uint8(opt.state);
                assertTrue(
                    state <= uint8(IVibeOptions.OptionState.CANCELED),
                    "STATE: invalid option state"
                );
            } catch {}
        }
    }
}
