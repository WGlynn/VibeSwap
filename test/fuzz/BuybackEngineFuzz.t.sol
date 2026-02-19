// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "forge-std/Test.sol";
import "../../contracts/core/BuybackEngine.sol";
import "@openzeppelin/contracts/token/ERC20/ERC20.sol";

// ============ Mocks ============

contract MockBBFuzzToken is ERC20 {
    constructor(string memory name_, string memory symbol_) ERC20(name_, symbol_) {}
    function mint(address to, uint256 amount) external { _mint(to, amount); }
}

contract MockBBFuzzAMM {
    struct Pool {
        address token0;
        address token1;
        uint256 reserve0;
        uint256 reserve1;
        uint256 totalLiquidity;
        uint256 feeRate;
        bool initialized;
    }

    mapping(bytes32 => Pool) public pools;

    function setPool(bytes32 poolId, address t0, address t1, uint256 r0, uint256 r1, uint256 fee) external {
        pools[poolId] = Pool(t0, t1, r0, r1, 1000 ether, fee, true);
    }

    function getPool(bytes32 poolId) external view returns (Pool memory) {
        return pools[poolId];
    }

    function getPoolId(address tokenA, address tokenB) external pure returns (bytes32) {
        (address token0, address token1) = tokenA < tokenB ? (tokenA, tokenB) : (tokenB, tokenA);
        return keccak256(abi.encodePacked(token0, token1));
    }

    function swap(
        bytes32 poolId,
        address tokenIn,
        uint256 amountIn,
        uint256,
        address recipient
    ) external returns (uint256 amountOut) {
        Pool storage pool = pools[poolId];
        bool isToken0 = tokenIn == pool.token0;
        uint256 reserveIn = isToken0 ? pool.reserve0 : pool.reserve1;
        uint256 reserveOut = isToken0 ? pool.reserve1 : pool.reserve0;

        uint256 amountInWithFee = amountIn * (10000 - pool.feeRate);
        amountOut = (amountInWithFee * reserveOut) / (reserveIn * 10000 + amountInWithFee);

        IERC20(tokenIn).transferFrom(msg.sender, address(this), amountIn);
        address tokenOut = isToken0 ? pool.token1 : pool.token0;
        IERC20(tokenOut).transfer(recipient, amountOut);

        if (isToken0) { pool.reserve0 += amountIn; pool.reserve1 -= amountOut; }
        else { pool.reserve1 += amountIn; pool.reserve0 -= amountOut; }
    }
}

// ============ Fuzz Tests ============

contract BuybackEngineFuzzTest is Test {
    MockBBFuzzToken protocolToken;
    MockBBFuzzToken feeToken;
    MockBBFuzzAMM amm;
    BuybackEngine engine;

    address burnAddr = 0x000000000000000000000000000000000000dEaD;

    function setUp() public {
        protocolToken = new MockBBFuzzToken("Protocol", "PROT");
        feeToken = new MockBBFuzzToken("Fee", "FEE");
        amm = new MockBBFuzzAMM();

        engine = new BuybackEngine(address(amm), address(protocolToken), 500, 60);

        bytes32 poolId = amm.getPoolId(address(feeToken), address(protocolToken));
        (address t0, address t1) = address(feeToken) < address(protocolToken)
            ? (address(feeToken), address(protocolToken))
            : (address(protocolToken), address(feeToken));
        amm.setPool(poolId, t0, t1, 1_000_000 ether, 1_000_000 ether, 30);

        protocolToken.mint(address(amm), 1_000_000 ether);
    }

    // ============ Fuzz: buyback always burns positive amount ============

    function testFuzz_buybackBurnsTokens(uint256 amount) public {
        amount = bound(amount, 1 ether, 100_000 ether);

        feeToken.mint(address(engine), amount);

        uint256 burnBefore = protocolToken.balanceOf(burnAddr);
        engine.executeBuyback(address(feeToken));
        uint256 burnAfter = protocolToken.balanceOf(burnAddr);

        assertGt(burnAfter - burnBefore, 0);
        assertEq(feeToken.balanceOf(address(engine)), 0);
    }

    // ============ Fuzz: direct burn for protocol token ============

    function testFuzz_directBurn(uint256 amount) public {
        amount = bound(amount, 1, 100_000_000 ether);

        protocolToken.mint(address(engine), amount);
        uint256 burned = engine.executeBuyback(address(protocolToken));

        assertEq(burned, amount);
        assertEq(engine.totalBurned(), amount);
    }

    // ============ Fuzz: slippage tolerance bounds ============

    function testFuzz_slippageTolerance(uint256 bps) public {
        bps = bound(bps, 0, 2000);
        engine.setSlippageTolerance(bps);
        assertEq(engine.slippageToleranceBps(), bps);
    }

    function testFuzz_slippageToleranceReverts(uint256 bps) public {
        bps = bound(bps, 2001, type(uint256).max);
        vm.expectRevert(abi.encodeWithSelector(IBuybackEngine.SlippageTooHigh.selector, bps));
        engine.setSlippageTolerance(bps);
    }

    // ============ Fuzz: cooldown enforcement ============

    function testFuzz_cooldownEnforcement(uint256 cooldown, uint256 waitTime) public {
        cooldown = bound(cooldown, 1, 1 days);
        waitTime = bound(waitTime, 0, 2 days);

        engine.setCooldown(cooldown);

        feeToken.mint(address(engine), 100 ether);
        engine.executeBuyback(address(feeToken));

        vm.warp(block.timestamp + waitTime);

        feeToken.mint(address(engine), 100 ether);

        if (waitTime < cooldown) {
            vm.expectRevert();
            engine.executeBuyback(address(feeToken));
        } else {
            uint256 burned = engine.executeBuyback(address(feeToken));
            assertGt(burned, 0);
        }
    }

    // ============ Fuzz: minimum buyback enforcement ============

    function testFuzz_minimumBuyback(uint256 minAmount, uint256 actualAmount) public {
        minAmount = bound(minAmount, 1 ether, 1000 ether);
        actualAmount = bound(actualAmount, 0.01 ether, 2000 ether);

        engine.setMinBuybackAmount(address(feeToken), minAmount);
        feeToken.mint(address(engine), actualAmount);

        if (actualAmount < minAmount) {
            vm.expectRevert(abi.encodeWithSelector(
                IBuybackEngine.BelowMinimum.selector, actualAmount, minAmount
            ));
            engine.executeBuyback(address(feeToken));
        } else {
            uint256 burned = engine.executeBuyback(address(feeToken));
            assertGt(burned, 0);
        }
    }

    // ============ Fuzz: AMM output approximately correct ============

    function testFuzz_ammOutputReasonable(uint256 amount) public {
        amount = bound(amount, 1 ether, 50_000 ether);

        feeToken.mint(address(engine), amount);
        uint256 burned = engine.executeBuyback(address(feeToken));

        // With 0.3% fee and large reserves (1M/1M), output should be close to input
        // but always slightly less due to fee + price impact
        assertLe(burned, amount);
        // Should be at least 90% (5% slippage tolerance)
        assertGe(burned, (amount * 90) / 100);
    }

    // ============ Fuzz: total burned accumulates correctly ============

    function testFuzz_totalBurnedAccumulates(uint256 amt1, uint256 amt2) public {
        amt1 = bound(amt1, 1 ether, 10_000 ether);
        amt2 = bound(amt2, 1 ether, 10_000 ether);

        // First buyback
        feeToken.mint(address(engine), amt1);
        uint256 b1 = engine.executeBuyback(address(feeToken));

        // Wait for cooldown
        vm.warp(block.timestamp + 61);

        // Second buyback
        feeToken.mint(address(engine), amt2);
        uint256 b2 = engine.executeBuyback(address(feeToken));

        assertEq(engine.totalBurned(), b1 + b2);
        assertEq(engine.totalBuybacks(), 2);
    }
}
