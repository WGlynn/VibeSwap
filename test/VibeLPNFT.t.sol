// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "forge-std/Test.sol";
import "../contracts/amm/VibeAMM.sol";
import "../contracts/amm/VibeLP.sol";
import "../contracts/amm/VibeLPNFT.sol";
import "../contracts/amm/interfaces/IVibeLPNFT.sol";
import "@openzeppelin/contracts/proxy/ERC1967/ERC1967Proxy.sol";
import "@openzeppelin/contracts/token/ERC20/ERC20.sol";

contract MockToken is ERC20 {
    constructor(string memory name, string memory symbol) ERC20(name, symbol) {}

    function mint(address to, uint256 amount) external {
        _mint(to, amount);
    }
}

contract VibeLPNFTTest is Test {
    VibeAMM public amm;
    VibeLPNFT public nft;
    MockToken public tokenA;
    MockToken public tokenB;

    address public owner;
    address public treasury;
    address public alice;
    address public bob;

    bytes32 public poolId;

    function setUp() public {
        owner = address(this);
        treasury = makeAddr("treasury");
        alice = makeAddr("alice");
        bob = makeAddr("bob");

        // Deploy tokens (ensure consistent ordering: tokenA < tokenB)
        MockToken t0 = new MockToken("Token A", "TKA");
        MockToken t1 = new MockToken("Token B", "TKB");
        if (address(t0) < address(t1)) {
            tokenA = t0;
            tokenB = t1;
        } else {
            tokenA = t1;
            tokenB = t0;
        }

        // Deploy AMM (proxy)
        VibeAMM impl = new VibeAMM();
        bytes memory initData = abi.encodeWithSelector(
            VibeAMM.initialize.selector,
            owner,
            treasury
        );
        ERC1967Proxy proxy = new ERC1967Proxy(address(impl), initData);
        amm = VibeAMM(address(proxy));
        amm.setAuthorizedExecutor(address(this), true);

        // Disable protections for unit testing
        amm.setFlashLoanProtection(false);
        amm.setTWAPValidation(false);

        // Deploy VibeLPNFT
        nft = new VibeLPNFT(address(amm));

        // Create pool
        poolId = amm.createPool(address(tokenA), address(tokenB), 30);

        // Fund users
        tokenA.mint(alice, 10000 ether);
        tokenB.mint(alice, 10000 ether);
        tokenA.mint(bob, 10000 ether);
        tokenB.mint(bob, 10000 ether);

        // Approve VibeLPNFT (users approve the NFT contract, not AMM)
        vm.startPrank(alice);
        tokenA.approve(address(nft), type(uint256).max);
        tokenB.approve(address(nft), type(uint256).max);
        vm.stopPrank();

        vm.startPrank(bob);
        tokenA.approve(address(nft), type(uint256).max);
        tokenB.approve(address(nft), type(uint256).max);
        vm.stopPrank();

        // Seed pool with initial liquidity (directly via AMM, so oracle has history)
        tokenA.mint(address(this), 100 ether);
        tokenB.mint(address(this), 100 ether);
        tokenA.approve(address(amm), type(uint256).max);
        tokenB.approve(address(amm), type(uint256).max);
        amm.addLiquidity(poolId, 100 ether, 100 ether, 0, 0);
    }

    // ============ Helper ============

    function _mintPosition(address user, uint256 amount0, uint256 amount1)
        internal
        returns (uint256 tokenId, uint256 liquidity, uint256 actual0, uint256 actual1)
    {
        vm.prank(user);
        return nft.mint(IVibeLPNFT.MintParams({
            poolId: poolId,
            amount0Desired: amount0,
            amount1Desired: amount1,
            amount0Min: 0,
            amount1Min: 0,
            recipient: user,
            deadline: block.timestamp + 1 hours
        }));
    }

    // ============ Constructor Tests ============

    function test_constructor() public view {
        assertEq(nft.name(), "VibeSwap LP Position");
        assertEq(nft.symbol(), "VSLP");
        assertEq(address(nft.vibeAMM()), address(amm));
        assertEq(nft.totalPositions(), 0);
    }

    // ============ Mint Tests ============

    function test_mint_createsNFTAndPosition() public {
        (uint256 tokenId, uint256 liquidity, uint256 amount0, uint256 amount1) =
            _mintPosition(alice, 10 ether, 10 ether);

        assertEq(tokenId, 1);
        assertGt(liquidity, 0);
        assertEq(amount0, 10 ether);
        assertEq(amount1, 10 ether);
        assertEq(nft.ownerOf(tokenId), alice);
        assertEq(nft.totalPositions(), 1);

        IVibeLPNFT.Position memory pos = nft.getPosition(tokenId);
        assertEq(pos.poolId, poolId);
        assertEq(pos.liquidity, liquidity);
        assertEq(pos.amount0Deposited, amount0);
        assertEq(pos.amount1Deposited, amount1);
        assertGt(pos.entryPrice, 0);
        assertEq(pos.createdAt, block.timestamp);
    }

    function test_mint_refundsExcess() public {
        // Pool ratio is 1:1 (100:100). Providing asymmetric amounts should refund excess.
        uint256 balBefore = tokenB.balanceOf(alice);

        vm.prank(alice);
        nft.mint(IVibeLPNFT.MintParams({
            poolId: poolId,
            amount0Desired: 10 ether,
            amount1Desired: 20 ether, // excess — pool is 1:1
            amount0Min: 0,
            amount1Min: 0,
            recipient: alice,
            deadline: block.timestamp + 1 hours
        }));

        // Alice should get ~10 ether refunded for tokenB
        uint256 balAfter = tokenB.balanceOf(alice);
        assertApproxEqAbs(balBefore - balAfter, 10 ether, 0.01 ether);
    }

    function test_mint_multiplePositions() public {
        (uint256 id1,,,) = _mintPosition(alice, 5 ether, 5 ether);
        (uint256 id2,,,) = _mintPosition(alice, 3 ether, 3 ether);
        (uint256 id3,,,) = _mintPosition(bob, 7 ether, 7 ether);

        assertEq(id1, 1);
        assertEq(id2, 2);
        assertEq(id3, 3);
        assertEq(nft.totalPositions(), 3);

        uint256[] memory alicePositions = nft.getPositionsByOwner(alice);
        assertEq(alicePositions.length, 2);
        assertEq(alicePositions[0], 1);
        assertEq(alicePositions[1], 2);

        uint256[] memory bobPositions = nft.getPositionsByOwner(bob);
        assertEq(bobPositions.length, 1);
        assertEq(bobPositions[0], 3);
    }

    function test_mint_revertsExpiredDeadline() public {
        vm.prank(alice);
        vm.expectRevert(IVibeLPNFT.DeadlineExpired.selector);
        nft.mint(IVibeLPNFT.MintParams({
            poolId: poolId,
            amount0Desired: 10 ether,
            amount1Desired: 10 ether,
            amount0Min: 0,
            amount1Min: 0,
            recipient: alice,
            deadline: block.timestamp - 1
        }));
    }

    function test_mint_revertsInvalidPool() public {
        vm.prank(alice);
        vm.expectRevert(IVibeLPNFT.InvalidPool.selector);
        nft.mint(IVibeLPNFT.MintParams({
            poolId: bytes32(uint256(0xdead)),
            amount0Desired: 10 ether,
            amount1Desired: 10 ether,
            amount0Min: 0,
            amount1Min: 0,
            recipient: alice,
            deadline: block.timestamp + 1 hours
        }));
    }

    function test_mint_revertsZeroRecipient() public {
        vm.prank(alice);
        vm.expectRevert(IVibeLPNFT.ZeroRecipient.selector);
        nft.mint(IVibeLPNFT.MintParams({
            poolId: poolId,
            amount0Desired: 10 ether,
            amount1Desired: 10 ether,
            amount0Min: 0,
            amount1Min: 0,
            recipient: address(0),
            deadline: block.timestamp + 1 hours
        }));
    }

    // ============ IncreaseLiquidity Tests ============

    function test_increaseLiquidity() public {
        (uint256 tokenId, uint256 liq1,,) = _mintPosition(alice, 10 ether, 10 ether);

        vm.prank(alice);
        (uint256 addedLiq, uint256 amount0, uint256 amount1) = nft.increaseLiquidity(
            IVibeLPNFT.IncreaseLiquidityParams({
                tokenId: tokenId,
                amount0Desired: 5 ether,
                amount1Desired: 5 ether,
                amount0Min: 0,
                amount1Min: 0,
                deadline: block.timestamp + 1 hours
            })
        );

        assertGt(addedLiq, 0);
        IVibeLPNFT.Position memory pos = nft.getPosition(tokenId);
        assertEq(pos.liquidity, liq1 + addedLiq);
        assertEq(pos.amount0Deposited, 10 ether + amount0);
        assertEq(pos.amount1Deposited, 10 ether + amount1);
    }

    function test_increaseLiquidity_weightAveragesEntryPrice() public {
        (uint256 tokenId,,,) = _mintPosition(alice, 10 ether, 10 ether);
        IVibeLPNFT.Position memory posBefore = nft.getPosition(tokenId);
        uint256 priceBefore = posBefore.entryPrice;

        // Entry price should still be close to initial (pool hasn't moved much)
        vm.prank(alice);
        nft.increaseLiquidity(IVibeLPNFT.IncreaseLiquidityParams({
            tokenId: tokenId,
            amount0Desired: 5 ether,
            amount1Desired: 5 ether,
            amount0Min: 0,
            amount1Min: 0,
            deadline: block.timestamp + 1 hours
        }));

        IVibeLPNFT.Position memory posAfter = nft.getPosition(tokenId);
        // Price should be roughly the same (pool is still ~1:1)
        assertApproxEqRel(posAfter.entryPrice, priceBefore, 0.05e18); // within 5%
    }

    function test_increaseLiquidity_revertsNotOwner() public {
        (uint256 tokenId,,,) = _mintPosition(alice, 10 ether, 10 ether);

        vm.prank(bob);
        vm.expectRevert();
        nft.increaseLiquidity(IVibeLPNFT.IncreaseLiquidityParams({
            tokenId: tokenId,
            amount0Desired: 5 ether,
            amount1Desired: 5 ether,
            amount0Min: 0,
            amount1Min: 0,
            deadline: block.timestamp + 1 hours
        }));
    }

    // ============ DecreaseLiquidity Tests ============

    function test_decreaseLiquidity_partial() public {
        (uint256 tokenId, uint256 liquidity,,) = _mintPosition(alice, 10 ether, 10 ether);
        uint256 halfLiq = liquidity / 2;

        // Advance block to avoid noFlashLoan same-block check
        vm.roll(block.number + 1);

        vm.prank(alice);
        (uint256 amount0, uint256 amount1) = nft.decreaseLiquidity(
            IVibeLPNFT.DecreaseLiquidityParams({
                tokenId: tokenId,
                liquidityAmount: halfLiq,
                amount0Min: 0,
                amount1Min: 0,
                deadline: block.timestamp + 1 hours
            })
        );

        assertGt(amount0, 0);
        assertGt(amount1, 0);

        IVibeLPNFT.Position memory pos = nft.getPosition(tokenId);
        assertEq(pos.liquidity, liquidity - halfLiq);

        // Tokens should be owed, not yet sent
        (uint256 owed0, uint256 owed1) = nft.getTokensOwed(tokenId);
        assertEq(owed0, amount0);
        assertEq(owed1, amount1);
    }

    function test_decreaseLiquidity_full() public {
        (uint256 tokenId, uint256 liquidity,,) = _mintPosition(alice, 10 ether, 10 ether);

        vm.roll(block.number + 1);

        vm.prank(alice);
        nft.decreaseLiquidity(IVibeLPNFT.DecreaseLiquidityParams({
            tokenId: tokenId,
            liquidityAmount: liquidity,
            amount0Min: 0,
            amount1Min: 0,
            deadline: block.timestamp + 1 hours
        }));

        IVibeLPNFT.Position memory pos = nft.getPosition(tokenId);
        assertEq(pos.liquidity, 0);
    }

    function test_decreaseLiquidity_revertsExceedsBalance() public {
        (uint256 tokenId, uint256 liquidity,,) = _mintPosition(alice, 10 ether, 10 ether);

        vm.roll(block.number + 1);

        vm.prank(alice);
        vm.expectRevert(IVibeLPNFT.ExceedsPositionLiquidity.selector);
        nft.decreaseLiquidity(IVibeLPNFT.DecreaseLiquidityParams({
            tokenId: tokenId,
            liquidityAmount: liquidity + 1,
            amount0Min: 0,
            amount1Min: 0,
            deadline: block.timestamp + 1 hours
        }));
    }

    function test_decreaseLiquidity_revertsZeroLiquidity() public {
        (uint256 tokenId,,,) = _mintPosition(alice, 10 ether, 10 ether);

        vm.roll(block.number + 1);

        vm.prank(alice);
        vm.expectRevert(IVibeLPNFT.ZeroLiquidity.selector);
        nft.decreaseLiquidity(IVibeLPNFT.DecreaseLiquidityParams({
            tokenId: tokenId,
            liquidityAmount: 0,
            amount0Min: 0,
            amount1Min: 0,
            deadline: block.timestamp + 1 hours
        }));
    }

    // ============ Collect Tests ============

    function test_collect_sendsOwedTokens() public {
        (uint256 tokenId, uint256 liquidity,,) = _mintPosition(alice, 10 ether, 10 ether);

        vm.roll(block.number + 1);

        vm.prank(alice);
        nft.decreaseLiquidity(IVibeLPNFT.DecreaseLiquidityParams({
            tokenId: tokenId,
            liquidityAmount: liquidity,
            amount0Min: 0,
            amount1Min: 0,
            deadline: block.timestamp + 1 hours
        }));

        uint256 bal0Before = tokenA.balanceOf(alice);
        uint256 bal1Before = tokenB.balanceOf(alice);

        vm.prank(alice);
        (uint256 collected0, uint256 collected1) = nft.collect(
            IVibeLPNFT.CollectParams({tokenId: tokenId, recipient: alice})
        );

        assertGt(collected0, 0);
        assertGt(collected1, 0);
        assertEq(tokenA.balanceOf(alice), bal0Before + collected0);
        assertEq(tokenB.balanceOf(alice), bal1Before + collected1);

        // Owed should be 0 now
        (uint256 owed0, uint256 owed1) = nft.getTokensOwed(tokenId);
        assertEq(owed0, 0);
        assertEq(owed1, 0);
    }

    function test_collect_customRecipient() public {
        (uint256 tokenId, uint256 liquidity,,) = _mintPosition(alice, 10 ether, 10 ether);

        vm.roll(block.number + 1);

        vm.prank(alice);
        nft.decreaseLiquidity(IVibeLPNFT.DecreaseLiquidityParams({
            tokenId: tokenId,
            liquidityAmount: liquidity,
            amount0Min: 0,
            amount1Min: 0,
            deadline: block.timestamp + 1 hours
        }));

        address charlie = makeAddr("charlie");
        uint256 bal0Before = tokenA.balanceOf(charlie);

        vm.prank(alice);
        nft.collect(IVibeLPNFT.CollectParams({tokenId: tokenId, recipient: charlie}));

        assertGt(tokenA.balanceOf(charlie), bal0Before);
    }

    function test_collect_revertsNotOwner() public {
        (uint256 tokenId, uint256 liquidity,,) = _mintPosition(alice, 10 ether, 10 ether);

        vm.roll(block.number + 1);

        vm.prank(alice);
        nft.decreaseLiquidity(IVibeLPNFT.DecreaseLiquidityParams({
            tokenId: tokenId,
            liquidityAmount: liquidity,
            amount0Min: 0,
            amount1Min: 0,
            deadline: block.timestamp + 1 hours
        }));

        vm.prank(bob);
        vm.expectRevert();
        nft.collect(IVibeLPNFT.CollectParams({tokenId: tokenId, recipient: bob}));
    }

    // ============ Burn Tests ============

    function test_burn_destroysEmptyPosition() public {
        (uint256 tokenId, uint256 liquidity,,) = _mintPosition(alice, 10 ether, 10 ether);

        vm.roll(block.number + 1);

        vm.startPrank(alice);
        nft.decreaseLiquidity(IVibeLPNFT.DecreaseLiquidityParams({
            tokenId: tokenId,
            liquidityAmount: liquidity,
            amount0Min: 0,
            amount1Min: 0,
            deadline: block.timestamp + 1 hours
        }));
        nft.collect(IVibeLPNFT.CollectParams({tokenId: tokenId, recipient: alice}));
        nft.burn(tokenId);
        vm.stopPrank();

        // NFT should no longer exist
        vm.expectRevert();
        nft.ownerOf(tokenId);

        // Owner's positions list should be empty
        uint256[] memory positions = nft.getPositionsByOwner(alice);
        assertEq(positions.length, 0);
    }

    function test_burn_revertsIfLiquidityRemaining() public {
        (uint256 tokenId,,,) = _mintPosition(alice, 10 ether, 10 ether);

        vm.prank(alice);
        vm.expectRevert(IVibeLPNFT.PositionNotEmpty.selector);
        nft.burn(tokenId);
    }

    function test_burn_revertsIfTokensOwed() public {
        (uint256 tokenId, uint256 liquidity,,) = _mintPosition(alice, 10 ether, 10 ether);

        vm.roll(block.number + 1);

        vm.startPrank(alice);
        nft.decreaseLiquidity(IVibeLPNFT.DecreaseLiquidityParams({
            tokenId: tokenId,
            liquidityAmount: liquidity,
            amount0Min: 0,
            amount1Min: 0,
            deadline: block.timestamp + 1 hours
        }));

        // Don't collect — tokens still owed
        vm.expectRevert(IVibeLPNFT.TokensStillOwed.selector);
        nft.burn(tokenId);
        vm.stopPrank();
    }

    // ============ Transfer Tests ============

    function test_transfer_updatesOwnershipTracking() public {
        (uint256 tokenId,,,) = _mintPosition(alice, 10 ether, 10 ether);

        assertEq(nft.getPositionsByOwner(alice).length, 1);
        assertEq(nft.getPositionsByOwner(bob).length, 0);

        vm.prank(alice);
        nft.transferFrom(alice, bob, tokenId);

        assertEq(nft.ownerOf(tokenId), bob);
        assertEq(nft.getPositionsByOwner(alice).length, 0);
        assertEq(nft.getPositionsByOwner(bob).length, 1);
        assertEq(nft.getPositionsByOwner(bob)[0], tokenId);
    }

    function test_transfer_newOwnerControlsPosition() public {
        (uint256 tokenId, uint256 liquidity,,) = _mintPosition(alice, 10 ether, 10 ether);

        vm.prank(alice);
        nft.transferFrom(alice, bob, tokenId);

        // Bob can decrease liquidity
        vm.roll(block.number + 1);

        vm.prank(bob);
        nft.decreaseLiquidity(IVibeLPNFT.DecreaseLiquidityParams({
            tokenId: tokenId,
            liquidityAmount: liquidity,
            amount0Min: 0,
            amount1Min: 0,
            deadline: block.timestamp + 1 hours
        }));

        // Bob can collect
        vm.prank(bob);
        (uint256 collected0, uint256 collected1) = nft.collect(
            IVibeLPNFT.CollectParams({tokenId: tokenId, recipient: bob})
        );

        assertGt(collected0, 0);
        assertGt(collected1, 0);
    }

    // ============ View Function Tests ============

    function test_getPositionValue() public {
        (uint256 tokenId,,,) = _mintPosition(alice, 10 ether, 10 ether);

        (uint256 value0, uint256 value1) = nft.getPositionValue(tokenId);
        // Value should be close to deposited amounts (no swaps yet)
        assertApproxEqRel(value0, 10 ether, 0.01e18); // within 1%
        assertApproxEqRel(value1, 10 ether, 0.01e18);
    }

    function test_getFeesEarned_afterSwaps() public {
        (uint256 tokenId,,,) = _mintPosition(alice, 50 ether, 50 ether);

        // Perform some swaps to generate fees
        tokenA.mint(address(this), 10 ether);
        tokenA.approve(address(amm), 10 ether);
        vm.roll(block.number + 1);
        amm.swap(poolId, address(tokenA), 5 ether, 0, address(this));

        vm.roll(block.number + 1);
        tokenB.mint(address(this), 10 ether);
        tokenB.approve(address(amm), 10 ether);
        amm.swap(poolId, address(tokenB), 5 ether, 0, address(this));

        // Position should have earned some fees (at least in one token)
        (uint256 fees0, uint256 fees1) = nft.getFeesEarned(tokenId);
        // After buy+sell cycle, there should be net fees in at least one direction
        assertTrue(fees0 > 0 || fees1 > 0, "Should have earned fees");
    }

    function test_getPositionsByOwner() public {
        _mintPosition(alice, 5 ether, 5 ether);
        _mintPosition(alice, 3 ether, 3 ether);
        _mintPosition(bob, 7 ether, 7 ether);

        uint256[] memory alicePos = nft.getPositionsByOwner(alice);
        assertEq(alicePos.length, 2);

        uint256[] memory bobPos = nft.getPositionsByOwner(bob);
        assertEq(bobPos.length, 1);
    }

    // ============ Integration Tests ============

    function test_fullLifecycle() public {
        // Mint
        (uint256 tokenId, uint256 liq1,,) = _mintPosition(alice, 10 ether, 10 ether);
        assertGt(liq1, 0);

        // Increase
        vm.prank(alice);
        (uint256 liq2,,) = nft.increaseLiquidity(IVibeLPNFT.IncreaseLiquidityParams({
            tokenId: tokenId,
            amount0Desired: 5 ether,
            amount1Desired: 5 ether,
            amount0Min: 0,
            amount1Min: 0,
            deadline: block.timestamp + 1 hours
        }));
        uint256 totalLiq = liq1 + liq2;

        // Swaps happen (generate fees)
        tokenA.mint(address(this), 10 ether);
        tokenA.approve(address(amm), 10 ether);
        vm.roll(block.number + 1);
        amm.swap(poolId, address(tokenA), 3 ether, 0, address(this));

        // Decrease (partial)
        vm.roll(block.number + 1);
        vm.prank(alice);
        nft.decreaseLiquidity(IVibeLPNFT.DecreaseLiquidityParams({
            tokenId: tokenId,
            liquidityAmount: totalLiq / 2,
            amount0Min: 0,
            amount1Min: 0,
            deadline: block.timestamp + 1 hours
        }));

        // Collect
        vm.prank(alice);
        (uint256 c0, uint256 c1) = nft.collect(
            IVibeLPNFT.CollectParams({tokenId: tokenId, recipient: alice})
        );
        assertGt(c0, 0);
        assertGt(c1, 0);

        // Decrease remaining
        IVibeLPNFT.Position memory pos = nft.getPosition(tokenId);
        vm.roll(block.number + 1);
        vm.prank(alice);
        nft.decreaseLiquidity(IVibeLPNFT.DecreaseLiquidityParams({
            tokenId: tokenId,
            liquidityAmount: pos.liquidity,
            amount0Min: 0,
            amount1Min: 0,
            deadline: block.timestamp + 1 hours
        }));

        vm.prank(alice);
        nft.collect(IVibeLPNFT.CollectParams({tokenId: tokenId, recipient: alice}));

        // Burn
        vm.prank(alice);
        nft.burn(tokenId);

        vm.expectRevert();
        nft.ownerOf(tokenId);
    }

    function test_transferAndWithdraw() public {
        // Alice mints
        (uint256 tokenId, uint256 liquidity,,) = _mintPosition(alice, 10 ether, 10 ether);

        // Alice transfers NFT to Bob
        vm.prank(alice);
        nft.transferFrom(alice, bob, tokenId);
        assertEq(nft.ownerOf(tokenId), bob);

        // Bob decreases and collects
        vm.roll(block.number + 1);

        uint256 bobBal0Before = tokenA.balanceOf(bob);
        uint256 bobBal1Before = tokenB.balanceOf(bob);

        vm.startPrank(bob);
        nft.decreaseLiquidity(IVibeLPNFT.DecreaseLiquidityParams({
            tokenId: tokenId,
            liquidityAmount: liquidity,
            amount0Min: 0,
            amount1Min: 0,
            deadline: block.timestamp + 1 hours
        }));
        nft.collect(IVibeLPNFT.CollectParams({tokenId: tokenId, recipient: bob}));
        nft.burn(tokenId);
        vm.stopPrank();

        // Bob received the tokens
        assertGt(tokenA.balanceOf(bob), bobBal0Before);
        assertGt(tokenB.balanceOf(bob), bobBal1Before);

        // Alice got nothing extra (she transferred her position)
        assertEq(nft.getPositionsByOwner(alice).length, 0);
    }

    function test_multipleUsersMultiplePositions() public {
        // Create a second pool
        MockToken tokenC = new MockToken("Token C", "TKC");
        tokenC.mint(alice, 1000 ether);
        tokenC.mint(bob, 1000 ether);

        bytes32 poolId2 = amm.createPool(address(tokenA), address(tokenC), 30);

        // Seed second pool
        tokenA.mint(address(this), 50 ether);
        tokenC.mint(address(this), 50 ether);
        tokenA.approve(address(amm), type(uint256).max);
        tokenC.approve(address(amm), type(uint256).max);
        amm.addLiquidity(poolId2, 50 ether, 50 ether, 0, 0);

        // Approve NFT for tokenC
        vm.prank(alice);
        tokenC.approve(address(nft), type(uint256).max);
        vm.prank(bob);
        tokenC.approve(address(nft), type(uint256).max);

        // Alice: 2 positions in pool1, 1 in pool2
        _mintPosition(alice, 5 ether, 5 ether);

        vm.prank(alice);
        nft.mint(IVibeLPNFT.MintParams({
            poolId: poolId,
            amount0Desired: 3 ether,
            amount1Desired: 3 ether,
            amount0Min: 0,
            amount1Min: 0,
            recipient: alice,
            deadline: block.timestamp + 1 hours
        }));

        vm.prank(alice);
        nft.mint(IVibeLPNFT.MintParams({
            poolId: poolId2,
            amount0Desired: 4 ether,
            amount1Desired: 4 ether,
            amount0Min: 0,
            amount1Min: 0,
            recipient: alice,
            deadline: block.timestamp + 1 hours
        }));

        // Bob: 1 position in pool1
        _mintPosition(bob, 8 ether, 8 ether);

        assertEq(nft.getPositionsByOwner(alice).length, 3);
        assertEq(nft.getPositionsByOwner(bob).length, 1);
        assertEq(nft.totalPositions(), 4);

        // Verify each position has correct pool
        IVibeLPNFT.Position memory pos1 = nft.getPosition(1);
        IVibeLPNFT.Position memory pos3 = nft.getPosition(3);
        assertEq(pos1.poolId, poolId);
        assertEq(pos3.poolId, poolId2);
    }
}
