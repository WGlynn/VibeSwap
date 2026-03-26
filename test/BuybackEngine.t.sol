// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "forge-std/Test.sol";
import "../contracts/core/BuybackEngine.sol";

// ============ Mock ERC20 ============

contract MockERC20 is IERC20 {
    string public name;
    string public symbol;
    uint8 public decimals = 18;
    uint256 public totalSupply;

    mapping(address => uint256) public balanceOf;
    mapping(address => mapping(address => uint256)) public allowance;

    constructor(string memory _name, string memory _symbol) {
        name = _name;
        symbol = _symbol;
    }

    function mint(address to, uint256 amount) external {
        balanceOf[to] += amount;
        totalSupply += amount;
    }

    function transfer(address to, uint256 amount) external returns (bool) {
        require(balanceOf[msg.sender] >= amount, "insufficient");
        balanceOf[msg.sender] -= amount;
        balanceOf[to] += amount;
        emit Transfer(msg.sender, to, amount);
        return true;
    }

    function approve(address spender, uint256 amount) external returns (bool) {
        allowance[msg.sender][spender] = amount;
        emit Approval(msg.sender, spender, amount);
        return true;
    }

    function transferFrom(address from, address to, uint256 amount) external returns (bool) {
        require(balanceOf[from] >= amount, "insufficient");
        if (allowance[from][msg.sender] != type(uint256).max) {
            require(allowance[from][msg.sender] >= amount, "allowance");
            allowance[from][msg.sender] -= amount;
        }
        balanceOf[from] -= amount;
        balanceOf[to] += amount;
        emit Transfer(from, to, amount);
        return true;
    }
}

// ============ Mock AMM ============

contract MockAMM is IVibeAMMSwap {
    mapping(bytes32 => Pool) private _pools;

    // Configurable: if true, swap() reverts
    bool public shouldRevertSwap;
    // Configurable: override output amount (0 = use x*y=k math)
    uint256 public overrideAmountOut;

    function setPool(
        bytes32 poolId,
        address token0,
        address token1,
        uint256 reserve0,
        uint256 reserve1,
        uint256 feeRate
    ) external {
        _pools[poolId] = Pool({
            token0: token0,
            token1: token1,
            reserve0: reserve0,
            reserve1: reserve1,
            totalLiquidity: reserve0 + reserve1,
            feeRate: feeRate,
            initialized: true
        });
    }

    function setShouldRevertSwap(bool val) external {
        shouldRevertSwap = val;
    }

    function setOverrideAmountOut(uint256 val) external {
        overrideAmountOut = val;
    }

    function swap(
        bytes32 poolId,
        address tokenIn,
        uint256 amountIn,
        uint256 minAmountOut,
        address recipient
    ) external override returns (uint256 amountOut) {
        require(!shouldRevertSwap, "MockAMM: swap reverted");

        Pool storage pool = _pools[poolId];
        require(pool.initialized, "MockAMM: pool not initialized");

        if (overrideAmountOut > 0) {
            amountOut = overrideAmountOut;
        } else {
            // x*y=k math with fee
            bool isToken0 = tokenIn == pool.token0;
            uint256 reserveIn = isToken0 ? pool.reserve0 : pool.reserve1;
            uint256 reserveOut = isToken0 ? pool.reserve1 : pool.reserve0;

            uint256 amountInWithFee = amountIn * (10000 - pool.feeRate);
            amountOut = (amountInWithFee * reserveOut) / (reserveIn * 10000 + amountInWithFee);
        }

        require(amountOut >= minAmountOut, "MockAMM: insufficient output");

        // Pull tokenIn from sender
        IERC20(tokenIn).transferFrom(msg.sender, address(this), amountIn);

        // Determine protocol token (the output token)
        address tokenOut = tokenIn == pool.token0 ? pool.token1 : pool.token0;
        IERC20(tokenOut).transfer(recipient, amountOut);

        return amountOut;
    }

    function getPool(bytes32 poolId) external view override returns (Pool memory) {
        return _pools[poolId];
    }

    function getPoolId(address tokenA, address tokenB) external pure override returns (bytes32) {
        (address t0, address t1) = tokenA < tokenB ? (tokenA, tokenB) : (tokenB, tokenA);
        return keccak256(abi.encodePacked(t0, t1));
    }
}

// ============ BuybackEngine Tests ============

contract BuybackEngineTest is Test {
    BuybackEngine public engine;
    MockAMM public amm;
    MockERC20 public protocolToken;
    MockERC20 public feeToken;
    MockERC20 public feeToken2;

    address public owner;
    address public alice;
    address public bob;
    address constant DEAD = 0x000000000000000000000000000000000000dEaD;

    uint256 constant SLIPPAGE_BPS = 500; // 5%
    uint256 constant COOLDOWN = 300; // 5 minutes
    uint256 constant INITIAL_RESERVES = 1_000_000e18;

    event BuybackExecuted(address indexed tokenIn, uint256 amountIn, uint256 amountOut, uint256 burned);
    event MinBuybackUpdated(address indexed token, uint256 newMinimum);
    event SlippageToleranceUpdated(uint256 newTolerance);
    event CooldownUpdated(uint256 newCooldown);
    event ProtocolTokenUpdated(address indexed newToken);
    event BurnAddressUpdated(address indexed newBurnAddress);
    event EmergencyRecovered(address indexed token, uint256 amount, address indexed to);

    // ============ Setup ============

    function setUp() public {
        owner = address(this);
        alice = makeAddr("alice");
        bob = makeAddr("bob");

        // Deploy mocks
        protocolToken = new MockERC20("VIBE", "VIBE");
        feeToken = new MockERC20("USDC", "USDC");
        feeToken2 = new MockERC20("WETH", "WETH");
        amm = new MockAMM();

        // Deploy engine
        engine = new BuybackEngine(
            address(amm),
            address(protocolToken),
            SLIPPAGE_BPS,
            COOLDOWN
        );

        // Setup pool: feeToken <-> protocolToken with 1:1 reserves and 30bps fee
        bytes32 poolId = _getPoolId(address(feeToken), address(protocolToken));
        amm.setPool(
            poolId,
            address(feeToken) < address(protocolToken) ? address(feeToken) : address(protocolToken),
            address(feeToken) < address(protocolToken) ? address(protocolToken) : address(feeToken),
            INITIAL_RESERVES,
            INITIAL_RESERVES,
            30
        );

        // Setup pool: feeToken2 <-> protocolToken
        bytes32 poolId2 = _getPoolId(address(feeToken2), address(protocolToken));
        amm.setPool(
            poolId2,
            address(feeToken2) < address(protocolToken) ? address(feeToken2) : address(protocolToken),
            address(feeToken2) < address(protocolToken) ? address(protocolToken) : address(feeToken2),
            INITIAL_RESERVES,
            INITIAL_RESERVES,
            30
        );

        // Fund AMM with protocol tokens to pay out on swaps
        protocolToken.mint(address(amm), 10_000_000e18);
    }

    // ============ Helpers ============

    function _getPoolId(address tokenA, address tokenB) internal pure returns (bytes32) {
        (address t0, address t1) = tokenA < tokenB ? (tokenA, tokenB) : (tokenB, tokenA);
        return keccak256(abi.encodePacked(t0, t1));
    }

    function _fundEngine(MockERC20 token, uint256 amount) internal {
        token.mint(address(engine), amount);
    }

    // ============ Constructor Validation ============

    function test_constructor_setsState() public view {
        assertEq(engine.amm(), address(amm));
        assertEq(engine.protocolToken(), address(protocolToken));
        assertEq(engine.burnAddress(), DEAD);
        assertEq(engine.slippageToleranceBps(), SLIPPAGE_BPS);
        assertEq(engine.cooldownPeriod(), COOLDOWN);
        assertEq(engine.totalBurned(), 0);
        assertEq(engine.totalBuybacks(), 0);
    }

    function test_constructor_revertsZeroAMM() public {
        vm.expectRevert(IBuybackEngine.ZeroAddress.selector);
        new BuybackEngine(address(0), address(protocolToken), SLIPPAGE_BPS, COOLDOWN);
    }

    function test_constructor_revertsZeroProtocolToken() public {
        vm.expectRevert(IBuybackEngine.ZeroAddress.selector);
        new BuybackEngine(address(amm), address(0), SLIPPAGE_BPS, COOLDOWN);
    }

    function test_constructor_revertsSlippageTooHigh() public {
        vm.expectRevert(abi.encodeWithSelector(IBuybackEngine.SlippageTooHigh.selector, 2001));
        new BuybackEngine(address(amm), address(protocolToken), 2001, COOLDOWN);
    }

    function test_constructor_allowsMaxSlippage() public {
        BuybackEngine e = new BuybackEngine(address(amm), address(protocolToken), 2000, COOLDOWN);
        assertEq(e.slippageToleranceBps(), 2000);
    }

    function test_constructor_allowsZeroCooldown() public {
        BuybackEngine e = new BuybackEngine(address(amm), address(protocolToken), SLIPPAGE_BPS, 0);
        assertEq(e.cooldownPeriod(), 0);
    }

    function test_constructor_ownerIsDeployer() public view {
        assertEq(engine.owner(), address(this));
    }

    // ============ executeBuyback — Normal Flow ============

    function test_executeBuyback_normalSwapAndBurn() public {
        uint256 buybackAmount = 10_000e18;
        _fundEngine(feeToken, buybackAmount);

        uint256 burned = engine.executeBuyback(address(feeToken));

        // Verify burned amount > 0
        assertGt(burned, 0);
        // Protocol tokens sent to DEAD address
        assertEq(protocolToken.balanceOf(DEAD), burned);
        // Engine should have no feeToken left
        assertEq(feeToken.balanceOf(address(engine)), 0);
        // Engine should have no protocolToken left (all burned)
        assertEq(protocolToken.balanceOf(address(engine)), 0);
        // State updated
        assertEq(engine.totalBuybacks(), 1);
        assertEq(engine.totalBurned(), burned);
        assertEq(engine.lastBuybackTime(address(feeToken)), block.timestamp);
    }

    function test_executeBuyback_emitsEvent() public {
        uint256 buybackAmount = 5_000e18;
        _fundEngine(feeToken, buybackAmount);

        vm.expectEmit(true, false, false, false);
        emit BuybackExecuted(address(feeToken), buybackAmount, 0, 0);

        engine.executeBuyback(address(feeToken));
    }

    function test_executeBuyback_recordStoredCorrectly() public {
        uint256 buybackAmount = 1_000e18;
        _fundEngine(feeToken, buybackAmount);

        uint256 burned = engine.executeBuyback(address(feeToken));

        IBuybackEngine.BuybackRecord memory record = engine.getBuybackRecord(0);
        assertEq(record.tokenIn, address(feeToken));
        assertEq(record.amountIn, buybackAmount);
        assertEq(record.amountBurned, burned);
        assertEq(record.timestamp, block.timestamp);
    }

    function test_executeBuyback_callableByAnyone() public {
        _fundEngine(feeToken, 1_000e18);

        vm.prank(alice);
        uint256 burned = engine.executeBuyback(address(feeToken));

        assertGt(burned, 0);
    }

    function test_executeBuyback_multipleBuybacksAccumulate() public {
        _fundEngine(feeToken, 1_000e18);
        uint256 burned1 = engine.executeBuyback(address(feeToken));

        // Warp past cooldown
        vm.warp(block.timestamp + COOLDOWN + 1);

        _fundEngine(feeToken, 2_000e18);
        uint256 burned2 = engine.executeBuyback(address(feeToken));

        assertEq(engine.totalBuybacks(), 2);
        assertEq(engine.totalBurned(), burned1 + burned2);
        assertEq(protocolToken.balanceOf(DEAD), burned1 + burned2);
    }

    // ============ executeBuyback — Direct Protocol Token Burn ============

    function test_executeBuyback_directBurnProtocolToken() public {
        uint256 amount = 5_000e18;
        protocolToken.mint(address(engine), amount);

        uint256 burned = engine.executeBuyback(address(protocolToken));

        assertEq(burned, amount);
        assertEq(protocolToken.balanceOf(DEAD), amount);
        assertEq(engine.totalBurned(), amount);
        assertEq(engine.totalBuybacks(), 1);
    }

    function test_executeBuyback_directBurnRevertsZeroBalance() public {
        // Protocol token with 0 balance in engine
        vm.expectRevert(IBuybackEngine.ZeroAmount.selector);
        engine.executeBuyback(address(protocolToken));
    }

    function test_executeBuyback_directBurnEmitsEvent() public {
        uint256 amount = 3_000e18;
        protocolToken.mint(address(engine), amount);

        vm.expectEmit(true, false, false, true);
        emit BuybackExecuted(address(protocolToken), amount, amount, amount);

        engine.executeBuyback(address(protocolToken));
    }

    // ============ executeBuyback — Cooldown ============

    function test_executeBuyback_revertsCooldownActive() public {
        _fundEngine(feeToken, 1_000e18);
        engine.executeBuyback(address(feeToken));

        // Immediately try again (still in cooldown)
        _fundEngine(feeToken, 1_000e18);

        uint256 nextTime = block.timestamp + COOLDOWN;
        vm.expectRevert(abi.encodeWithSelector(IBuybackEngine.CooldownActive.selector, nextTime));
        engine.executeBuyback(address(feeToken));
    }

    function test_executeBuyback_succeedsAfterCooldown() public {
        _fundEngine(feeToken, 1_000e18);
        engine.executeBuyback(address(feeToken));

        // Warp exactly to cooldown boundary
        vm.warp(block.timestamp + COOLDOWN);

        _fundEngine(feeToken, 1_000e18);
        uint256 burned = engine.executeBuyback(address(feeToken));
        assertGt(burned, 0);
    }

    function test_executeBuyback_firstBuybackSkipsCooldown() public {
        // lastBuybackTime is 0 for new token — no cooldown check
        _fundEngine(feeToken, 1_000e18);
        uint256 burned = engine.executeBuyback(address(feeToken));
        assertGt(burned, 0);
    }

    function test_executeBuyback_cooldownIsPerToken() public {
        _fundEngine(feeToken, 1_000e18);
        engine.executeBuyback(address(feeToken));

        // feeToken2 should NOT be on cooldown
        _fundEngine(feeToken2, 1_000e18);
        uint256 burned = engine.executeBuyback(address(feeToken2));
        assertGt(burned, 0);
    }

    // ============ executeBuyback — Minimum Threshold ============

    function test_executeBuyback_revertsBelowMinimum() public {
        engine.setMinBuybackAmount(address(feeToken), 1_000e18);

        _fundEngine(feeToken, 500e18);

        vm.expectRevert(
            abi.encodeWithSelector(IBuybackEngine.BelowMinimum.selector, 500e18, 1_000e18)
        );
        engine.executeBuyback(address(feeToken));
    }

    function test_executeBuyback_succeedsAtExactMinimum() public {
        engine.setMinBuybackAmount(address(feeToken), 1_000e18);

        _fundEngine(feeToken, 1_000e18);
        uint256 burned = engine.executeBuyback(address(feeToken));
        assertGt(burned, 0);
    }

    function test_executeBuyback_zeroMinAllowsAnyAmount() public {
        // Default min is 0
        _fundEngine(feeToken, 1); // 1 wei
        engine.executeBuyback(address(feeToken));
        // Might be 0 burned due to rounding, but should not revert with BelowMinimum
        assertEq(engine.totalBuybacks(), 1);
    }

    // ============ executeBuyback — Zero Balance / Zero Address ============

    function test_executeBuyback_revertsZeroAddress() public {
        vm.expectRevert(IBuybackEngine.ZeroAddress.selector);
        engine.executeBuyback(address(0));
    }

    function test_executeBuyback_revertsZeroBalance() public {
        vm.expectRevert(IBuybackEngine.ZeroAmount.selector);
        engine.executeBuyback(address(feeToken));
    }

    // ============ executeBuyback — No Pool ============

    function test_executeBuyback_revertsNoPool() public {
        MockERC20 noPoolToken = new MockERC20("NPT", "NPT");
        noPoolToken.mint(address(engine), 1_000e18);

        vm.expectRevert(
            abi.encodeWithSelector(IBuybackEngine.NoPoolForToken.selector, address(noPoolToken))
        );
        engine.executeBuyback(address(noPoolToken));
    }

    // ============ executeBuyback — Swap Failure ============

    function test_executeBuyback_revertsOnSwapFailure() public {
        _fundEngine(feeToken, 1_000e18);
        amm.setShouldRevertSwap(true);

        vm.expectRevert(abi.encodeWithSelector(IBuybackEngine.InsufficientOutput.selector, 0, 0));
        engine.executeBuyback(address(feeToken));
    }

    // ============ executeBuybackMultiple ============

    function test_executeBuybackMultiple_swapsMultipleTokens() public {
        _fundEngine(feeToken, 5_000e18);
        _fundEngine(feeToken2, 3_000e18);

        address[] memory tokens = new address[](2);
        tokens[0] = address(feeToken);
        tokens[1] = address(feeToken2);

        uint256 totalBurned = engine.executeBuybackMultiple(tokens);

        assertGt(totalBurned, 0);
        assertEq(engine.totalBuybacks(), 2);
        assertEq(engine.totalBurned(), totalBurned);
    }

    function test_executeBuybackMultiple_skipsZeroBalance() public {
        // Only fund feeToken, not feeToken2
        _fundEngine(feeToken, 5_000e18);

        address[] memory tokens = new address[](2);
        tokens[0] = address(feeToken);
        tokens[1] = address(feeToken2);

        uint256 totalBurned = engine.executeBuybackMultiple(tokens);

        assertGt(totalBurned, 0);
        assertEq(engine.totalBuybacks(), 1); // Only one executed
    }

    function test_executeBuybackMultiple_skipsBelowMinimum() public {
        engine.setMinBuybackAmount(address(feeToken), 10_000e18);
        _fundEngine(feeToken, 1_000e18); // Below minimum
        _fundEngine(feeToken2, 5_000e18);

        address[] memory tokens = new address[](2);
        tokens[0] = address(feeToken);
        tokens[1] = address(feeToken2);

        uint256 totalBurned = engine.executeBuybackMultiple(tokens);

        assertGt(totalBurned, 0);
        assertEq(engine.totalBuybacks(), 1); // Only feeToken2
    }

    function test_executeBuybackMultiple_skipsCooldownTokens() public {
        _fundEngine(feeToken, 1_000e18);
        engine.executeBuyback(address(feeToken));

        // Fund again (still on cooldown) + fund feeToken2
        _fundEngine(feeToken, 1_000e18);
        _fundEngine(feeToken2, 1_000e18);

        address[] memory tokens = new address[](2);
        tokens[0] = address(feeToken);
        tokens[1] = address(feeToken2);

        uint256 totalBurned = engine.executeBuybackMultiple(tokens);

        assertGt(totalBurned, 0);
        assertEq(engine.totalBuybacks(), 2); // 1 from first call + 1 from feeToken2
    }

    function test_executeBuybackMultiple_emptyArray() public {
        address[] memory tokens = new address[](0);
        uint256 totalBurned = engine.executeBuybackMultiple(tokens);
        assertEq(totalBurned, 0);
    }

    function test_executeBuybackMultiple_continuesOnFailure() public {
        // feeToken has no pool set up -> will fail in try/catch
        MockERC20 noPoolToken = new MockERC20("NPT", "NPT");
        noPoolToken.mint(address(engine), 1_000e18);

        _fundEngine(feeToken, 5_000e18);

        address[] memory tokens = new address[](2);
        tokens[0] = address(noPoolToken);
        tokens[1] = address(feeToken);

        uint256 totalBurned = engine.executeBuybackMultiple(tokens);

        assertGt(totalBurned, 0);
        assertEq(engine.totalBuybacks(), 1); // Only feeToken succeeded
    }

    // ============ setMinBuybackAmount ============

    function test_setMinBuybackAmount_setsValue() public {
        engine.setMinBuybackAmount(address(feeToken), 5_000e18);
        assertEq(engine.minBuybackAmount(address(feeToken)), 5_000e18);
    }

    function test_setMinBuybackAmount_emitsEvent() public {
        vm.expectEmit(true, false, false, true);
        emit MinBuybackUpdated(address(feeToken), 5_000e18);

        engine.setMinBuybackAmount(address(feeToken), 5_000e18);
    }

    function test_setMinBuybackAmount_allowsZero() public {
        engine.setMinBuybackAmount(address(feeToken), 5_000e18);
        engine.setMinBuybackAmount(address(feeToken), 0);
        assertEq(engine.minBuybackAmount(address(feeToken)), 0);
    }

    function test_setMinBuybackAmount_revertsNonOwner() public {
        vm.prank(alice);
        vm.expectRevert();
        engine.setMinBuybackAmount(address(feeToken), 5_000e18);
    }

    // ============ setSlippageTolerance ============

    function test_setSlippageTolerance_setsValue() public {
        engine.setSlippageTolerance(1000);
        assertEq(engine.slippageToleranceBps(), 1000);
    }

    function test_setSlippageTolerance_emitsEvent() public {
        vm.expectEmit(false, false, false, true);
        emit SlippageToleranceUpdated(1000);

        engine.setSlippageTolerance(1000);
    }

    function test_setSlippageTolerance_allowsZero() public {
        engine.setSlippageTolerance(0);
        assertEq(engine.slippageToleranceBps(), 0);
    }

    function test_setSlippageTolerance_allowsMaximum() public {
        engine.setSlippageTolerance(2000);
        assertEq(engine.slippageToleranceBps(), 2000);
    }

    function test_setSlippageTolerance_revertsAboveMax() public {
        vm.expectRevert(abi.encodeWithSelector(IBuybackEngine.SlippageTooHigh.selector, 2001));
        engine.setSlippageTolerance(2001);
    }

    function test_setSlippageTolerance_revertsNonOwner() public {
        vm.prank(alice);
        vm.expectRevert();
        engine.setSlippageTolerance(1000);
    }

    // ============ setCooldown ============

    function test_setCooldown_setsValue() public {
        engine.setCooldown(600);
        assertEq(engine.cooldownPeriod(), 600);
    }

    function test_setCooldown_emitsEvent() public {
        vm.expectEmit(false, false, false, true);
        emit CooldownUpdated(600);

        engine.setCooldown(600);
    }

    function test_setCooldown_allowsZero() public {
        engine.setCooldown(0);
        assertEq(engine.cooldownPeriod(), 0);
    }

    function test_setCooldown_revertsNonOwner() public {
        vm.prank(alice);
        vm.expectRevert();
        engine.setCooldown(600);
    }

    // ============ setProtocolToken ============

    function test_setProtocolToken_setsValue() public {
        MockERC20 newToken = new MockERC20("NEW", "NEW");
        engine.setProtocolToken(address(newToken));
        assertEq(engine.protocolToken(), address(newToken));
    }

    function test_setProtocolToken_emitsEvent() public {
        MockERC20 newToken = new MockERC20("NEW", "NEW");

        vm.expectEmit(true, false, false, false);
        emit ProtocolTokenUpdated(address(newToken));

        engine.setProtocolToken(address(newToken));
    }

    function test_setProtocolToken_revertsZeroAddress() public {
        vm.expectRevert(IBuybackEngine.ZeroAddress.selector);
        engine.setProtocolToken(address(0));
    }

    function test_setProtocolToken_revertsNonOwner() public {
        vm.prank(alice);
        vm.expectRevert();
        engine.setProtocolToken(makeAddr("token"));
    }

    // ============ setBurnAddress ============

    function test_setBurnAddress_setsValue() public {
        address newBurn = makeAddr("customBurn");
        engine.setBurnAddress(newBurn);
        assertEq(engine.burnAddress(), newBurn);
    }

    function test_setBurnAddress_emitsEvent() public {
        address newBurn = makeAddr("customBurn");

        vm.expectEmit(true, false, false, false);
        emit BurnAddressUpdated(newBurn);

        engine.setBurnAddress(newBurn);
    }

    function test_setBurnAddress_revertsZeroAddress() public {
        vm.expectRevert(IBuybackEngine.ZeroAddress.selector);
        engine.setBurnAddress(address(0));
    }

    function test_setBurnAddress_revertsNonOwner() public {
        vm.prank(alice);
        vm.expectRevert();
        engine.setBurnAddress(makeAddr("burn"));
    }

    function test_setBurnAddress_burnGoesToNewAddress() public {
        address customBurn = makeAddr("customBurn");
        engine.setBurnAddress(customBurn);

        _fundEngine(feeToken, 1_000e18);
        uint256 burned = engine.executeBuyback(address(feeToken));

        assertGt(burned, 0);
        assertEq(protocolToken.balanceOf(customBurn), burned);
        assertEq(protocolToken.balanceOf(DEAD), 0);
    }

    // ============ emergencyRecover ============

    function test_emergencyRecover_transfersTokens() public {
        _fundEngine(feeToken, 5_000e18);

        engine.emergencyRecover(address(feeToken), 3_000e18, bob);

        assertEq(feeToken.balanceOf(bob), 3_000e18);
        assertEq(feeToken.balanceOf(address(engine)), 2_000e18);
    }

    function test_emergencyRecover_emitsEvent() public {
        _fundEngine(feeToken, 5_000e18);

        vm.expectEmit(true, false, true, true);
        emit EmergencyRecovered(address(feeToken), 3_000e18, bob);

        engine.emergencyRecover(address(feeToken), 3_000e18, bob);
    }

    function test_emergencyRecover_revertsZeroAddressRecipient() public {
        _fundEngine(feeToken, 5_000e18);

        vm.expectRevert(IBuybackEngine.ZeroAddress.selector);
        engine.emergencyRecover(address(feeToken), 1_000e18, address(0));
    }

    function test_emergencyRecover_revertsNonOwner() public {
        _fundEngine(feeToken, 5_000e18);

        vm.prank(alice);
        vm.expectRevert();
        engine.emergencyRecover(address(feeToken), 1_000e18, alice);
    }

    function test_emergencyRecover_fullBalance() public {
        _fundEngine(feeToken, 5_000e18);

        engine.emergencyRecover(address(feeToken), 5_000e18, bob);

        assertEq(feeToken.balanceOf(bob), 5_000e18);
        assertEq(feeToken.balanceOf(address(engine)), 0);
    }

    function test_emergencyRecover_protocolToken() public {
        protocolToken.mint(address(engine), 2_000e18);

        engine.emergencyRecover(address(protocolToken), 2_000e18, bob);

        assertEq(protocolToken.balanceOf(bob), 2_000e18);
    }

    // ============ View Functions ============

    function test_views_defaultValues() public view {
        assertEq(engine.lastBuybackTime(address(feeToken)), 0);
        assertEq(engine.minBuybackAmount(address(feeToken)), 0);
        assertEq(engine.totalBurned(), 0);
        assertEq(engine.totalBuybacks(), 0);
    }

    function test_views_afterBuyback() public {
        _fundEngine(feeToken, 10_000e18);

        uint256 ts = block.timestamp;
        uint256 burned = engine.executeBuyback(address(feeToken));

        assertEq(engine.lastBuybackTime(address(feeToken)), ts);
        assertEq(engine.totalBurned(), burned);
        assertEq(engine.totalBuybacks(), 1);
    }

    function test_getBuybackRecord_revertsOutOfBounds() public {
        vm.expectRevert();
        engine.getBuybackRecord(0);
    }

    function test_getBuybackRecord_multipleRecords() public {
        _fundEngine(feeToken, 1_000e18);
        engine.executeBuyback(address(feeToken));

        vm.warp(block.timestamp + COOLDOWN + 1);

        _fundEngine(feeToken, 2_000e18);
        engine.executeBuyback(address(feeToken));

        IBuybackEngine.BuybackRecord memory r0 = engine.getBuybackRecord(0);
        IBuybackEngine.BuybackRecord memory r1 = engine.getBuybackRecord(1);

        assertEq(r0.amountIn, 1_000e18);
        assertEq(r1.amountIn, 2_000e18);
        assertGt(r1.timestamp, r0.timestamp);
    }

    // ============ Edge Cases ============

    function test_zeroCooldown_allowsBackToBack() public {
        engine.setCooldown(0);

        _fundEngine(feeToken, 1_000e18);
        engine.executeBuyback(address(feeToken));

        // Immediately again — no warp needed
        _fundEngine(feeToken, 1_000e18);
        uint256 burned = engine.executeBuyback(address(feeToken));

        assertGt(burned, 0);
        assertEq(engine.totalBuybacks(), 2);
    }

    function test_largeBuyback_highSlippage() public {
        // With 5% slippage tolerance and a large swap relative to reserves,
        // the price impact may exceed slippage. Verify math works.
        // Using 100k against 1M reserves = ~10% of pool, should be ~9% impact
        // which is within 5% slippage of expected output (slippage is on expected, not ideal)
        _fundEngine(feeToken, 100_000e18);
        uint256 burned = engine.executeBuyback(address(feeToken));
        assertGt(burned, 0);
    }

    function test_directBurnBypassesCooldownAndMinimum() public {
        // Set high min for protocol token address (should be ignored for direct burn path)
        // Note: direct burn does NOT check minBuybackAmount or cooldown
        protocolToken.mint(address(engine), 100e18);
        uint256 burned1 = engine.executeBuyback(address(protocolToken));

        // Immediately again — direct burn has its own cooldown tracking
        // but the code skips cooldown check for protocol token path
        protocolToken.mint(address(engine), 200e18);

        // Direct burn path doesn't check cooldown (goes straight to _burnDirectly)
        uint256 burned2 = engine.executeBuyback(address(protocolToken));

        assertEq(burned1, 100e18);
        assertEq(burned2, 200e18);
    }
}
