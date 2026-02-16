// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "forge-std/Test.sol";
import "../../contracts/amm/VibeAMM.sol";
import "../../contracts/amm/VibeLP.sol";
import "../../contracts/amm/VibeLPNFT.sol";
import "../../contracts/amm/interfaces/IVibeLPNFT.sol";
import "@openzeppelin/contracts/proxy/ERC1967/ERC1967Proxy.sol";
import "@openzeppelin/contracts/token/ERC20/ERC20.sol";

// ============ Mock Token ============

contract MockLPNFTFToken is ERC20 {
    constructor(string memory name, string memory symbol) ERC20(name, symbol) {}
    function mint(address to, uint256 amount) external { _mint(to, amount); }
}

// ============ Fuzz Tests ============

contract VibeLPNFTFuzzTest is Test {
    VibeAMM public amm;
    VibeLPNFT public nft;
    MockLPNFTFToken public tokenA;
    MockLPNFTFToken public tokenB;

    address public owner;
    address public treasury;
    bytes32 public poolId;

    function setUp() public {
        owner = address(this);
        treasury = makeAddr("treasury");

        MockLPNFTFToken t0 = new MockLPNFTFToken("Token A", "TKA");
        MockLPNFTFToken t1 = new MockLPNFTFToken("Token B", "TKB");
        if (address(t0) < address(t1)) {
            tokenA = t0;
            tokenB = t1;
        } else {
            tokenA = t1;
            tokenB = t0;
        }

        VibeAMM impl = new VibeAMM();
        bytes memory initData = abi.encodeWithSelector(
            VibeAMM.initialize.selector, owner, treasury
        );
        ERC1967Proxy proxy = new ERC1967Proxy(address(impl), initData);
        amm = VibeAMM(address(proxy));
        amm.setAuthorizedExecutor(address(this), true);
        amm.setFlashLoanProtection(false);
        amm.setTWAPValidation(false);

        nft = new VibeLPNFT(address(amm));

        poolId = amm.createPool(address(tokenA), address(tokenB), 30);

        // Seed initial liquidity
        tokenA.mint(address(this), 1000 ether);
        tokenB.mint(address(this), 1000 ether);
        tokenA.approve(address(amm), type(uint256).max);
        tokenB.approve(address(amm), type(uint256).max);
        amm.addLiquidity(poolId, 1000 ether, 1000 ether, 0, 0);
    }

    // ============ Helpers ============

    function _setupUser(address user, uint256 amount) internal {
        tokenA.mint(user, amount);
        tokenB.mint(user, amount);
        vm.startPrank(user);
        tokenA.approve(address(nft), type(uint256).max);
        tokenB.approve(address(nft), type(uint256).max);
        vm.stopPrank();
    }

    // ============ Fuzz: mint always increments token ID ============

    function testFuzz_mintIncrementsTokenId(uint256 amount) public {
        amount = bound(amount, 0.01 ether, 100 ether);

        address user = makeAddr("fuzzUser");
        _setupUser(user, amount * 2);

        vm.prank(user);
        (uint256 tokenId1,,,) = nft.mint(IVibeLPNFT.MintParams({
            poolId: poolId,
            amount0Desired: amount,
            amount1Desired: amount,
            amount0Min: 0,
            amount1Min: 0,
            recipient: user,
            deadline: block.timestamp + 1 hours
        }));

        assertEq(tokenId1, 1, "First token ID should be 1");
        assertEq(nft.ownerOf(tokenId1), user);
        assertEq(nft.totalPositions(), 1);
    }

    // ============ Fuzz: liquidity proportional to deposit ============

    function testFuzz_liquidityProportionalToDeposit(uint256 amount) public {
        amount = bound(amount, 0.01 ether, 500 ether);

        address user = makeAddr("fuzzUser");
        _setupUser(user, amount * 2);

        vm.prank(user);
        (, uint256 liquidity, uint256 actual0, uint256 actual1) = nft.mint(IVibeLPNFT.MintParams({
            poolId: poolId,
            amount0Desired: amount,
            amount1Desired: amount,
            amount0Min: 0,
            amount1Min: 0,
            recipient: user,
            deadline: block.timestamp + 1 hours
        }));

        assertGt(liquidity, 0, "Liquidity must be positive");
        assertGt(actual0, 0, "Actual0 must be positive");
        assertGt(actual1, 0, "Actual1 must be positive");
        assertLe(actual0, amount, "Actual0 must not exceed desired");
        assertLe(actual1, amount, "Actual1 must not exceed desired");
    }

    // ============ Fuzz: decrease + collect returns tokens ============

    function testFuzz_decreaseAndCollectReturnsTokens(uint256 amount, uint256 fraction) public {
        amount = bound(amount, 1 ether, 100 ether);
        fraction = bound(fraction, 1, 10000);

        address user = makeAddr("fuzzUser");
        _setupUser(user, amount * 2);

        vm.prank(user);
        (uint256 tokenId, uint256 liquidity,,) = nft.mint(IVibeLPNFT.MintParams({
            poolId: poolId,
            amount0Desired: amount,
            amount1Desired: amount,
            amount0Min: 0,
            amount1Min: 0,
            recipient: user,
            deadline: block.timestamp + 1 hours
        }));

        uint256 decreaseAmount = (liquidity * fraction) / 10000;
        if (decreaseAmount == 0) decreaseAmount = 1;
        if (decreaseAmount > liquidity) decreaseAmount = liquidity;

        uint256 balA_before = tokenA.balanceOf(user);
        uint256 balB_before = tokenB.balanceOf(user);

        // Decrease liquidity
        vm.prank(user);
        nft.decreaseLiquidity(IVibeLPNFT.DecreaseLiquidityParams({
            tokenId: tokenId,
            liquidityAmount: decreaseAmount,
            amount0Min: 0,
            amount1Min: 0,
            deadline: block.timestamp + 1 hours
        }));

        // Collect
        vm.prank(user);
        (uint256 collected0, uint256 collected1) = nft.collect(IVibeLPNFT.CollectParams({
            tokenId: tokenId,
            recipient: user
        }));

        assertGt(collected0 + collected1, 0, "Must collect something");
        assertEq(tokenA.balanceOf(user), balA_before + collected0);
        assertEq(tokenB.balanceOf(user), balB_before + collected1);
    }

    // ============ Fuzz: increase liquidity grows position ============

    function testFuzz_increaseLiquidityGrowsPosition(uint256 amount1, uint256 amount2) public {
        amount1 = bound(amount1, 1 ether, 50 ether);
        amount2 = bound(amount2, 0.1 ether, 50 ether);

        address user = makeAddr("fuzzUser");
        _setupUser(user, (amount1 + amount2) * 2);

        vm.prank(user);
        (uint256 tokenId, uint256 liq1,,) = nft.mint(IVibeLPNFT.MintParams({
            poolId: poolId,
            amount0Desired: amount1,
            amount1Desired: amount1,
            amount0Min: 0,
            amount1Min: 0,
            recipient: user,
            deadline: block.timestamp + 1 hours
        }));

        vm.prank(user);
        (uint256 addedLiq,,) = nft.increaseLiquidity(IVibeLPNFT.IncreaseLiquidityParams({
            tokenId: tokenId,
            amount0Desired: amount2,
            amount1Desired: amount2,
            amount0Min: 0,
            amount1Min: 0,
            deadline: block.timestamp + 1 hours
        }));

        IVibeLPNFT.Position memory pos = nft.getPosition(tokenId);
        assertEq(pos.liquidity, liq1 + addedLiq, "Liquidity must equal sum");
    }

    // ============ Fuzz: full decrease + collect + burn lifecycle ============

    function testFuzz_fullLifecycle(uint256 amount) public {
        amount = bound(amount, 1 ether, 100 ether);

        address user = makeAddr("fuzzUser");
        _setupUser(user, amount * 2);

        // Mint
        vm.prank(user);
        (uint256 tokenId, uint256 liquidity,,) = nft.mint(IVibeLPNFT.MintParams({
            poolId: poolId,
            amount0Desired: amount,
            amount1Desired: amount,
            amount0Min: 0,
            amount1Min: 0,
            recipient: user,
            deadline: block.timestamp + 1 hours
        }));

        // Decrease all
        vm.prank(user);
        nft.decreaseLiquidity(IVibeLPNFT.DecreaseLiquidityParams({
            tokenId: tokenId,
            liquidityAmount: liquidity,
            amount0Min: 0,
            amount1Min: 0,
            deadline: block.timestamp + 1 hours
        }));

        // Collect
        vm.prank(user);
        nft.collect(IVibeLPNFT.CollectParams({
            tokenId: tokenId,
            recipient: user
        }));

        // Burn should succeed
        vm.prank(user);
        nft.burn(tokenId);

        // Token should not exist
        vm.expectRevert();
        nft.ownerOf(tokenId);
    }

    // ============ Fuzz: position value proportional to share ============

    function testFuzz_positionValueProportional(uint256 amount) public {
        amount = bound(amount, 1 ether, 500 ether);

        address user = makeAddr("fuzzUser");
        _setupUser(user, amount * 2);

        vm.prank(user);
        (uint256 tokenId, uint256 liquidity,,) = nft.mint(IVibeLPNFT.MintParams({
            poolId: poolId,
            amount0Desired: amount,
            amount1Desired: amount,
            amount0Min: 0,
            amount1Min: 0,
            recipient: user,
            deadline: block.timestamp + 1 hours
        }));

        (uint256 val0, uint256 val1) = nft.getPositionValue(tokenId);
        IVibeAMM.Pool memory pool = amm.getPool(poolId);

        // Position value should be proportional: val0/reserve0 ≈ liquidity/totalLiquidity
        uint256 expectedVal0 = (liquidity * pool.reserve0) / pool.totalLiquidity;
        uint256 expectedVal1 = (liquidity * pool.reserve1) / pool.totalLiquidity;

        assertEq(val0, expectedVal0, "Value0 must match proportion");
        assertEq(val1, expectedVal1, "Value1 must match proportion");
    }
}
