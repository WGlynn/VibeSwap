// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "forge-std/Test.sol";
import "../../contracts/core/BuybackEngine.sol";
import "@openzeppelin/contracts/token/ERC20/ERC20.sol";

// ============ Mocks ============

contract MockBuybackToken is ERC20 {
    constructor(string memory name_, string memory symbol_) ERC20(name_, symbol_) {}
    function mint(address to, uint256 amount) external { _mint(to, amount); }
}

contract MockAMM {
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
        uint256 /* minAmountOut */,
        address recipient
    ) external returns (uint256 amountOut) {
        Pool storage pool = pools[poolId];
        bool isToken0 = tokenIn == pool.token0;
        uint256 reserveIn = isToken0 ? pool.reserve0 : pool.reserve1;
        uint256 reserveOut = isToken0 ? pool.reserve1 : pool.reserve0;

        uint256 amountInWithFee = amountIn * (10000 - pool.feeRate);
        amountOut = (amountInWithFee * reserveOut) / (reserveIn * 10000 + amountInWithFee);

        // Transfer tokenIn from sender
        IERC20(tokenIn).transferFrom(msg.sender, address(this), amountIn);

        // Transfer tokenOut to recipient
        address tokenOut = isToken0 ? pool.token1 : pool.token0;
        IERC20(tokenOut).transfer(recipient, amountOut);

        // Update reserves
        if (isToken0) {
            pool.reserve0 += amountIn;
            pool.reserve1 -= amountOut;
        } else {
            pool.reserve1 += amountIn;
            pool.reserve0 -= amountOut;
        }
    }
}

// ============ Unit Tests ============

contract BuybackEngineTest is Test {
    MockBuybackToken protocolToken;
    MockBuybackToken feeToken;
    MockAMM amm;
    BuybackEngine engine;

    address burnAddr = 0x000000000000000000000000000000000000dEaD;

    function setUp() public {
        protocolToken = new MockBuybackToken("Protocol", "PROT");
        feeToken = new MockBuybackToken("Fee Token", "FEE");
        amm = new MockAMM();

        engine = new BuybackEngine(
            address(amm),
            address(protocolToken),
            500, // 5% slippage
            60   // 60 second cooldown
        );

        // Set up pool: feeToken/protocolToken with 1:1 ratio
        bytes32 poolId = amm.getPoolId(address(feeToken), address(protocolToken));
        (address t0, address t1) = address(feeToken) < address(protocolToken)
            ? (address(feeToken), address(protocolToken))
            : (address(protocolToken), address(feeToken));
        amm.setPool(poolId, t0, t1, 100_000 ether, 100_000 ether, 30);

        // Fund AMM with protocol tokens for output
        protocolToken.mint(address(amm), 100_000 ether);
    }

    // ============ Constructor ============

    function test_constructor() public view {
        assertEq(engine.amm(), address(amm));
        assertEq(engine.protocolToken(), address(protocolToken));
        assertEq(engine.burnAddress(), burnAddr);
        assertEq(engine.slippageToleranceBps(), 500);
        assertEq(engine.cooldownPeriod(), 60);
        assertEq(engine.totalBurned(), 0);
        assertEq(engine.totalBuybacks(), 0);
    }

    function test_constructor_revertsZeroAMM() public {
        vm.expectRevert(IBuybackEngine.ZeroAddress.selector);
        new BuybackEngine(address(0), address(protocolToken), 500, 60);
    }

    function test_constructor_revertsZeroToken() public {
        vm.expectRevert(IBuybackEngine.ZeroAddress.selector);
        new BuybackEngine(address(amm), address(0), 500, 60);
    }

    function test_constructor_revertsHighSlippage() public {
        vm.expectRevert(abi.encodeWithSelector(IBuybackEngine.SlippageTooHigh.selector, 3000));
        new BuybackEngine(address(amm), address(protocolToken), 3000, 60);
    }

    // ============ executeBuyback ============

    function test_executeBuyback() public {
        uint256 amount = 1000 ether;
        feeToken.mint(address(engine), amount);

        uint256 burned = engine.executeBuyback(address(feeToken));

        assertGt(burned, 0);
        assertEq(engine.totalBuybacks(), 1);
        assertEq(engine.totalBurned(), burned);
        assertGt(protocolToken.balanceOf(burnAddr), 0);
        assertEq(feeToken.balanceOf(address(engine)), 0);
    }

    function test_executeBuyback_recordsHistory() public {
        feeToken.mint(address(engine), 500 ether);

        uint256 burned = engine.executeBuyback(address(feeToken));

        IBuybackEngine.BuybackRecord memory record = engine.getBuybackRecord(0);
        assertEq(record.tokenIn, address(feeToken));
        assertEq(record.amountIn, 500 ether);
        assertEq(record.amountBurned, burned);
        assertEq(record.timestamp, block.timestamp);
    }

    function test_executeBuyback_directBurn_protocolToken() public {
        protocolToken.mint(address(engine), 1000 ether);

        uint256 burned = engine.executeBuyback(address(protocolToken));

        assertEq(burned, 1000 ether);
        assertEq(engine.totalBurned(), 1000 ether);
        assertEq(protocolToken.balanceOf(burnAddr), 1000 ether);
    }

    function test_executeBuyback_revertsZeroAddress() public {
        vm.expectRevert(IBuybackEngine.ZeroAddress.selector);
        engine.executeBuyback(address(0));
    }

    function test_executeBuyback_revertsZeroBalance() public {
        vm.expectRevert(IBuybackEngine.ZeroAmount.selector);
        engine.executeBuyback(address(feeToken));
    }

    function test_executeBuyback_revertsBelowMinimum() public {
        engine.setMinBuybackAmount(address(feeToken), 100 ether);
        feeToken.mint(address(engine), 50 ether);

        vm.expectRevert(abi.encodeWithSelector(IBuybackEngine.BelowMinimum.selector, 50 ether, 100 ether));
        engine.executeBuyback(address(feeToken));
    }

    function test_executeBuyback_revertsCooldown() public {
        feeToken.mint(address(engine), 1000 ether);
        engine.executeBuyback(address(feeToken));

        feeToken.mint(address(engine), 1000 ether);
        vm.expectRevert(abi.encodeWithSelector(
            IBuybackEngine.CooldownActive.selector,
            block.timestamp + 60
        ));
        engine.executeBuyback(address(feeToken));
    }

    function test_executeBuyback_afterCooldown() public {
        feeToken.mint(address(engine), 1000 ether);
        engine.executeBuyback(address(feeToken));

        vm.warp(block.timestamp + 61);

        feeToken.mint(address(engine), 1000 ether);
        uint256 burned = engine.executeBuyback(address(feeToken));
        assertGt(burned, 0);
        assertEq(engine.totalBuybacks(), 2);
    }

    function test_executeBuyback_revertsNoPool() public {
        MockBuybackToken noPoolToken = new MockBuybackToken("No Pool", "NP");
        noPoolToken.mint(address(engine), 1000 ether);

        vm.expectRevert(abi.encodeWithSelector(IBuybackEngine.NoPoolForToken.selector, address(noPoolToken)));
        engine.executeBuyback(address(noPoolToken));
    }

    // ============ executeBuybackMultiple ============

    function test_executeBuybackMultiple() public {
        MockBuybackToken feeToken2 = new MockBuybackToken("Fee2", "FEE2");

        // Set up second pool
        bytes32 poolId2 = amm.getPoolId(address(feeToken2), address(protocolToken));
        (address t0, address t1) = address(feeToken2) < address(protocolToken)
            ? (address(feeToken2), address(protocolToken))
            : (address(protocolToken), address(feeToken2));
        amm.setPool(poolId2, t0, t1, 100_000 ether, 100_000 ether, 30);

        feeToken.mint(address(engine), 500 ether);
        feeToken2.mint(address(engine), 300 ether);

        address[] memory tokens = new address[](2);
        tokens[0] = address(feeToken);
        tokens[1] = address(feeToken2);

        uint256 totalBurned = engine.executeBuybackMultiple(tokens);
        assertGt(totalBurned, 0);
        assertEq(engine.totalBuybacks(), 2);
    }

    function test_executeBuybackMultiple_skipsEmptyBalance() public {
        feeToken.mint(address(engine), 500 ether);

        MockBuybackToken feeToken2 = new MockBuybackToken("Fee2", "FEE2");
        // feeToken2 has 0 balance — should be skipped

        address[] memory tokens = new address[](2);
        tokens[0] = address(feeToken);
        tokens[1] = address(feeToken2);

        uint256 totalBurned = engine.executeBuybackMultiple(tokens);
        assertGt(totalBurned, 0);
        assertEq(engine.totalBuybacks(), 1);
    }

    // ============ Configuration ============

    function test_setMinBuybackAmount() public {
        engine.setMinBuybackAmount(address(feeToken), 100 ether);
        assertEq(engine.minBuybackAmount(address(feeToken)), 100 ether);
    }

    function test_setSlippageTolerance() public {
        engine.setSlippageTolerance(1000);
        assertEq(engine.slippageToleranceBps(), 1000);
    }

    function test_setSlippageTolerance_revertsHigh() public {
        vm.expectRevert(abi.encodeWithSelector(IBuybackEngine.SlippageTooHigh.selector, 2500));
        engine.setSlippageTolerance(2500);
    }

    function test_setCooldown() public {
        engine.setCooldown(300);
        assertEq(engine.cooldownPeriod(), 300);
    }

    function test_setProtocolToken() public {
        MockBuybackToken newToken = new MockBuybackToken("New", "NEW");
        engine.setProtocolToken(address(newToken));
        assertEq(engine.protocolToken(), address(newToken));
    }

    function test_setProtocolToken_revertsZero() public {
        vm.expectRevert(IBuybackEngine.ZeroAddress.selector);
        engine.setProtocolToken(address(0));
    }

    function test_setBurnAddress() public {
        address newBurn = makeAddr("newBurn");
        engine.setBurnAddress(newBurn);
        assertEq(engine.burnAddress(), newBurn);
    }

    function test_emergencyRecover() public {
        feeToken.mint(address(engine), 1000 ether);
        address recipient = makeAddr("recipient");

        engine.emergencyRecover(address(feeToken), 1000 ether, recipient);
        assertEq(feeToken.balanceOf(recipient), 1000 ether);
    }

    function test_emergencyRecover_revertsZeroAddress() public {
        vm.expectRevert(IBuybackEngine.ZeroAddress.selector);
        engine.emergencyRecover(address(feeToken), 100 ether, address(0));
    }

    // ============ Access Control ============

    function test_onlyOwner_setMinBuybackAmount() public {
        vm.prank(makeAddr("random"));
        vm.expectRevert();
        engine.setMinBuybackAmount(address(feeToken), 100);
    }

    function test_onlyOwner_setSlippageTolerance() public {
        vm.prank(makeAddr("random"));
        vm.expectRevert();
        engine.setSlippageTolerance(100);
    }

    function test_onlyOwner_emergencyRecover() public {
        vm.prank(makeAddr("random"));
        vm.expectRevert();
        engine.emergencyRecover(address(feeToken), 100, makeAddr("to"));
    }

    // ============ Full Flow ============

    function test_fullFlow_feeRouterToBurn() public {
        // Simulate FeeRouter distributing to BuybackEngine
        feeToken.mint(address(engine), 10_000 ether);

        // Anyone calls buyback
        address keeper = makeAddr("keeper");
        vm.prank(keeper);
        uint256 burned = engine.executeBuyback(address(feeToken));

        assertGt(burned, 0);
        assertEq(feeToken.balanceOf(address(engine)), 0);
        assertGt(protocolToken.balanceOf(burnAddr), 0);
        assertEq(engine.totalBurned(), burned);
        assertEq(engine.totalBuybacks(), 1);
    }
}
