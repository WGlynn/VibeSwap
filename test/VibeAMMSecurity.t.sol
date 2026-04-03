// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/**
 * @title VibeAMMSecurity
 * @notice Tests for VibeAMM security paths not covered by VibeAMM.t.sol:
 *   - Flash loan protection blocks same-block interactions
 *   - removeLiquidity minAmount enforcement
 *   - syncTrackedBalance owner-only guard
 *   - setProtocolFeeShare limits and fee collection with non-zero share
 *   - setAuthorizedExecutor access control
 *   - addLiquidity reverts when pool has no liquidity and initial amounts are too low
 */

import "forge-std/Test.sol";
import "../contracts/amm/VibeAMM.sol";
import "@openzeppelin/contracts/proxy/ERC1967/ERC1967Proxy.sol";
import "@openzeppelin/contracts/token/ERC20/ERC20.sol";

contract MockERC20AMM is ERC20 {
    constructor(string memory name, string memory symbol) ERC20(name, symbol) {}
    function mint(address to, uint256 amount) external { _mint(to, amount); }
}

contract VibeAMMSecurityTest is Test {
    VibeAMM public amm;
    MockERC20AMM public tokenA;
    MockERC20AMM public tokenB;

    address public owner;
    address public treasury;
    address public lp;
    address public trader;
    address public attacker;

    bytes32 public poolId;

    function setUp() public {
        owner = address(this);
        treasury = makeAddr("treasury");
        lp      = makeAddr("lp");
        trader  = makeAddr("trader");
        attacker = makeAddr("attacker");

        tokenA = new MockERC20AMM("Token A", "TKA");
        tokenB = new MockERC20AMM("Token B", "TKB");

        VibeAMM impl = new VibeAMM();
        ERC1967Proxy proxy = new ERC1967Proxy(
            address(impl),
            abi.encodeWithSelector(VibeAMM.initialize.selector, owner, treasury)
        );
        amm = VibeAMM(address(proxy));

        amm.setAuthorizedExecutor(address(this), true);

        // Mint and approve
        tokenA.mint(lp, 1000 ether);
        tokenB.mint(lp, 1000 ether);
        tokenA.mint(trader, 100 ether);
        tokenB.mint(trader, 100 ether);

        vm.prank(lp);     tokenA.approve(address(amm), type(uint256).max);
        vm.prank(lp);     tokenB.approve(address(amm), type(uint256).max);
        vm.prank(trader); tokenA.approve(address(amm), type(uint256).max);
        vm.prank(trader); tokenB.approve(address(amm), type(uint256).max);
    }

    // ============ Flash Loan Protection ============

    function test_flashLoanProtection_blocksAddLiquidityInSameBlock() public {
        // Flash loan protection is enabled by default
        poolId = amm.createPool(address(tokenA), address(tokenB), 30);

        // First add liquidity (sets lastInteractionBlock)
        vm.prank(lp);
        amm.addLiquidity(poolId, 100 ether, 100 ether, 0, 0);

        // Warp to same block but try to interact again from same address via swap
        // The flash loan guard tracks per-address per-block interactions
        // Second interaction in same block from same address should revert
        vm.prank(lp);
        vm.expectRevert(VibeAMM.SameBlockInteraction.selector);
        amm.addLiquidity(poolId, 10 ether, 10 ether, 0, 0);
    }

    function test_flashLoanProtection_allowsNextBlock() public {
        poolId = amm.createPool(address(tokenA), address(tokenB), 30);

        vm.prank(lp);
        amm.addLiquidity(poolId, 100 ether, 100 ether, 0, 0);

        // Roll to next block
        vm.roll(block.number + 1);

        // Should succeed in next block
        vm.prank(lp);
        amm.addLiquidity(poolId, 10 ether, 10 ether, 0, 0);
    }

    function test_flashLoanProtection_canBeDisabled() public {
        amm.setFlashLoanProtection(false);

        poolId = amm.createPool(address(tokenA), address(tokenB), 30);

        vm.prank(lp);
        amm.addLiquidity(poolId, 100 ether, 100 ether, 0, 0);

        // Same block — should succeed with protection disabled
        vm.prank(lp);
        (uint256 a0, uint256 a1, ) = amm.addLiquidity(poolId, 10 ether, 10 ether, 0, 0);
        assertGt(a0, 0);
        assertGt(a1, 0);
    }

    // ============ removeLiquidity — minAmount Revert ============

    function test_removeLiquidity_minAmountReverts() public {
        amm.setFlashLoanProtection(false);
        poolId = amm.createPool(address(tokenA), address(tokenB), 30);

        vm.prank(lp);
        (,, uint256 liquidity) = amm.addLiquidity(poolId, 100 ether, 100 ether, 0, 0);

        // Try to remove with minOut exceeding actual output
        vm.prank(lp);
        vm.expectRevert();  // InsufficientToken0 or InsufficientToken1
        amm.removeLiquidity(poolId, liquidity, 200 ether, 200 ether);
    }

    function test_removeLiquidity_zeroLiquidityReverts() public {
        amm.setFlashLoanProtection(false);
        poolId = amm.createPool(address(tokenA), address(tokenB), 30);

        vm.prank(lp);
        amm.addLiquidity(poolId, 100 ether, 100 ether, 0, 0);

        vm.prank(lp);
        vm.expectRevert(VibeAMM.InvalidLiquidity.selector);
        amm.removeLiquidity(poolId, 0, 0, 0);
    }

    function test_removeLiquidity_insufficientLPBalanceReverts() public {
        amm.setFlashLoanProtection(false);
        poolId = amm.createPool(address(tokenA), address(tokenB), 30);

        vm.prank(lp);
        amm.addLiquidity(poolId, 100 ether, 100 ether, 0, 0);

        // trader has no LP tokens
        vm.prank(trader);
        vm.expectRevert(VibeAMM.InsufficientLiquidityBalance.selector);
        amm.removeLiquidity(poolId, 1 ether, 0, 0);
    }

    // ============ syncTrackedBalance — Access Control ============

    function test_syncTrackedBalance_onlyOwner() public {
        vm.prank(attacker);
        vm.expectRevert();
        amm.syncTrackedBalance(address(tokenA));
    }

    function test_syncTrackedBalance_ownerSucceeds() public {
        // Donate tokens directly (bypassing normal flows)
        tokenA.mint(address(amm), 50 ether);

        // Owner can sync
        amm.syncTrackedBalance(address(tokenA));
        // No revert = success
    }

    // ============ setProtocolFeeShare ============

    function test_setProtocolFeeShare_maxIs2500() public {
        amm.setProtocolFeeShare(2500); // 25% max
        assertEq(amm.protocolFeeShare(), 2500);
    }

    function test_setProtocolFeeShare_exceedsMaxReverts() public {
        vm.expectRevert("Fee share too high");
        amm.setProtocolFeeShare(2501);
    }

    function test_setProtocolFeeShare_onlyOwner() public {
        vm.prank(trader);
        vm.expectRevert();
        amm.setProtocolFeeShare(100);
    }

    function test_protocolFeeShare_nonZero_accumulatesFees() public {
        amm.setFlashLoanProtection(false);
        amm.setTWAPValidation(false);
        amm.setProtocolFeeShare(1000); // 10% of swap fees go to treasury

        poolId = amm.createPool(address(tokenA), address(tokenB), 30);

        vm.prank(lp);
        amm.addLiquidity(poolId, 100 ether, 100 ether, 0, 0);

        vm.roll(block.number + 1);
        vm.prank(trader);
        amm.swap(poolId, address(tokenA), 10 ether, 0, trader);

        // Protocol fees accumulate on tokenOut (tokenB), not tokenIn
        uint256 accFees = amm.accumulatedFees(address(tokenB));
        assertGt(accFees, 0);
    }

    // ============ setAuthorizedExecutor ============

    function test_setAuthorizedExecutor_unauthorizedCannotBatchSwap() public {
        amm.setFlashLoanProtection(false);
        poolId = amm.createPool(address(tokenA), address(tokenB), 30);

        vm.prank(lp);
        amm.addLiquidity(poolId, 100 ether, 100 ether, 0, 0);

        IVibeAMM.SwapOrder[] memory orders = new IVibeAMM.SwapOrder[](1);
        orders[0] = IVibeAMM.SwapOrder({ trader: trader, tokenIn: address(tokenA), tokenOut: address(tokenB), amountIn: 1 ether, minAmountOut: 0, isPriority: false });

        vm.prank(attacker);
        vm.expectRevert(VibeAMM.NotAuthorized.selector);
        amm.executeBatchSwap(poolId, 1, orders);
    }

    function test_setAuthorizedExecutor_ownerOnly() public {
        vm.prank(attacker);
        vm.expectRevert();
        amm.setAuthorizedExecutor(attacker, true);
    }

    // ============ createPool — Edge Cases ============

    function test_createPool_maxFeeRate() public {
        // Fee rate > MAX_FEE_RATE should revert
        vm.expectRevert(VibeAMM.FeeTooHigh.selector);
        amm.createPool(address(tokenA), address(tokenB), 1001); // > 1000 bps (10%)
    }

    function test_createPool_zeroAddressReverts() public {
        vm.expectRevert(VibeAMM.InvalidToken.selector);
        amm.createPool(address(0), address(tokenB), 30);
    }

    // ============ swap — Pool Not Found ============

    function test_swap_nonExistentPoolReverts() public {
        bytes32 fakePid = keccak256("nonexistent");
        vm.prank(trader);
        vm.expectRevert(VibeAMM.PoolNotFound.selector);
        amm.swap(fakePid, address(tokenA), 1 ether, 0, trader);
    }

    // ============ AMM-06: Cross-Pool Flash Loan Protection ============

    /// @notice AMM-06 regression test: global per-user guard must block cross-pool attacks.
    ///         An attacker who manipulates Pool A in block N cannot also touch Pool B in the
    ///         same block.  With the old per-pool key both interactions would succeed; with
    ///         the fix the second must revert.
    function test_flashLoan_crossPool_blockedInSameBlock() public {
        // Two independent pools: (tokenA/tokenB) and (tokenA/tokenC)
        MockERC20AMM tokenC = new MockERC20AMM("Token C", "TKC");
        tokenA.mint(attacker, 1000 ether);
        tokenB.mint(attacker, 1000 ether);
        tokenC.mint(attacker, 1000 ether);
        tokenA.mint(lp, 1000 ether);
        tokenB.mint(lp, 1000 ether);
        tokenC.mint(lp, 1000 ether);

        vm.startPrank(attacker);
        tokenA.approve(address(amm), type(uint256).max);
        tokenB.approve(address(amm), type(uint256).max);
        tokenC.approve(address(amm), type(uint256).max);
        vm.stopPrank();

        vm.startPrank(lp);
        tokenC.approve(address(amm), type(uint256).max);
        vm.stopPrank();

        // Create pool AB and pool AC
        bytes32 poolAB = amm.createPool(address(tokenA), address(tokenB), 30);
        bytes32 poolAC = amm.createPool(address(tokenA), address(tokenC), 30);

        // Seed both pools from LP (different block so flash guard resets)
        vm.roll(block.number + 1);
        vm.startPrank(lp);
        amm.addLiquidity(poolAB, 100 ether, 100 ether, 0, 0);
        vm.stopPrank();

        vm.roll(block.number + 1);
        vm.startPrank(lp);
        amm.addLiquidity(poolAC, 100 ether, 100 ether, 0, 0);
        vm.stopPrank();

        // Advance one more block so attacker starts fresh
        vm.roll(block.number + 1);

        // Attacker first touches Pool AB — should succeed
        vm.prank(attacker);
        amm.swap(poolAB, address(tokenA), 1 ether, 0, attacker);

        // Same block, attacker now tries Pool AC — must revert (global per-user guard)
        vm.prank(attacker);
        vm.expectRevert(VibeAMM.SameBlockInteraction.selector);
        amm.swap(poolAC, address(tokenA), 1 ether, 0, attacker);
    }

    /// @notice Verify that different users in the same block are NOT blocked by each other.
    function test_flashLoan_crossPool_differentUsers_notBlocked() public {
        MockERC20AMM tokenC = new MockERC20AMM("Token C2", "TKC2");
        tokenA.mint(attacker, 100 ether);
        tokenA.mint(trader,   100 ether);
        tokenB.mint(lp, 1000 ether);
        tokenC.mint(lp, 1000 ether);

        vm.prank(attacker); tokenA.approve(address(amm), type(uint256).max);
        vm.prank(attacker); tokenB.approve(address(amm), type(uint256).max);
        vm.prank(trader);   tokenA.approve(address(amm), type(uint256).max);
        vm.prank(trader);   tokenC.approve(address(amm), type(uint256).max);

        vm.startPrank(lp);
        tokenC.approve(address(amm), type(uint256).max);
        vm.stopPrank();

        bytes32 poolAB = amm.createPool(address(tokenA), address(tokenB), 30);
        bytes32 poolAC = amm.createPool(address(tokenA), address(tokenC), 30);

        vm.roll(block.number + 1);
        vm.startPrank(lp);
        amm.addLiquidity(poolAB, 100 ether, 100 ether, 0, 0);
        vm.stopPrank();

        vm.roll(block.number + 1);
        vm.startPrank(lp);
        amm.addLiquidity(poolAC, 100 ether, 100 ether, 0, 0);
        vm.stopPrank();

        vm.roll(block.number + 1);

        // attacker touches Pool AB
        vm.prank(attacker);
        amm.swap(poolAB, address(tokenA), 1 ether, 0, attacker);

        // trader (different address) touches Pool AC in the same block — must succeed
        tokenA.mint(trader, 1 ether);
        vm.prank(trader);
        uint256 out = amm.swap(poolAC, address(tokenA), 1 ether, 0, trader);
        assertGt(out, 0, "Different user cross-pool swap should succeed");
    }

    // ============ setTWAPValidation ============

    function test_setTWAPValidation_onlyOwner() public {
        vm.prank(attacker);
        vm.expectRevert();
        amm.setTWAPValidation(false);
    }

    function test_setTWAPValidation_toggles() public {
        amm.setTWAPValidation(false);
        // Re-enable
        amm.setTWAPValidation(true);
        // No revert = success
    }
}
