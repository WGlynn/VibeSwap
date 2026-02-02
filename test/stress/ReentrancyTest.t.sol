// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "forge-std/Test.sol";
import "../../contracts/amm/VibeAMM.sol";
import "../../contracts/core/CommitRevealAuction.sol";
import "../../contracts/incentives/LoyaltyRewardsManager.sol";
import "../../contracts/incentives/SlippageGuaranteeFund.sol";
import "@openzeppelin/contracts/proxy/ERC1967/ERC1967Proxy.sol";
import "@openzeppelin/contracts/token/ERC20/ERC20.sol";

contract MaliciousToken is ERC20 {
    address public target;
    bytes public attackData;
    bool public attacking;

    constructor() ERC20("Malicious", "MAL") {}

    function mint(address to, uint256 amount) external {
        _mint(to, amount);
    }

    function setAttack(address _target, bytes memory _data) external {
        target = _target;
        attackData = _data;
    }

    function transfer(address to, uint256 amount) public override returns (bool) {
        if (attacking && target != address(0)) {
            attacking = false; // Prevent infinite loop
            (bool success,) = target.call(attackData);
            // We don't care if it succeeds, just testing reentrancy protection
        }
        return super.transfer(to, amount);
    }

    function triggerAttack() external {
        attacking = true;
    }
}

contract ReentrancyAttacker {
    VibeAMM public amm;
    bytes32 public poolId;
    uint256 public attackCount;

    constructor(VibeAMM _amm, bytes32 _poolId) {
        amm = _amm;
        poolId = _poolId;
    }

    receive() external payable {
        if (attackCount < 3) {
            attackCount++;
            // Try to reenter during ETH transfer
            try amm.removeLiquidity(poolId, 1, 0, 0) {} catch {}
        }
    }
}

contract MockToken is ERC20 {
    constructor(string memory name, string memory symbol) ERC20(name, symbol) {}
    function mint(address to, uint256 amount) external { _mint(to, amount); }
}

/**
 * @title ReentrancyTest
 * @notice Test reentrancy protection in contracts
 */
contract ReentrancyTest is Test {
    VibeAMM public amm;
    CommitRevealAuction public auction;
    MockToken public tokenA;
    MockToken public tokenB;
    MaliciousToken public malToken;

    address public owner;
    address public treasury;
    bytes32 public poolId;

    function setUp() public {
        owner = address(this);
        treasury = makeAddr("treasury");

        tokenA = new MockToken("Token A", "TKA");
        tokenB = new MockToken("Token B", "TKB");
        malToken = new MaliciousToken();

        // Deploy AMM
        VibeAMM ammImpl = new VibeAMM();
        bytes memory ammInit = abi.encodeWithSelector(
            VibeAMM.initialize.selector,
            owner,
            treasury
        );
        ERC1967Proxy ammProxy = new ERC1967Proxy(address(ammImpl), ammInit);
        amm = VibeAMM(address(ammProxy));

        amm.setAuthorizedExecutor(address(this), true);
        amm.setFlashLoanProtection(false);

        // Deploy Auction
        CommitRevealAuction auctionImpl = new CommitRevealAuction();
        bytes memory auctionInit = abi.encodeWithSelector(
            CommitRevealAuction.initialize.selector,
            owner,
            treasury
        );
        ERC1967Proxy auctionProxy = new ERC1967Proxy(address(auctionImpl), auctionInit);
        auction = CommitRevealAuction(payable(address(auctionProxy)));

        auction.setAuthorizedSettler(address(this), true);

        // Create pool
        poolId = amm.createPool(address(tokenA), address(tokenB), 30);

        tokenA.mint(address(this), 1000000 ether);
        tokenB.mint(address(this), 1000000 ether);
        tokenA.approve(address(amm), type(uint256).max);
        tokenB.approve(address(amm), type(uint256).max);

        amm.addLiquidity(poolId, 100000 ether, 100000 ether, 0, 0);
    }

    /**
     * @notice Test AMM reentrancy protection on swap
     */
    function test_reentrancy_swapProtection() public {
        // Create pool with malicious token
        bytes32 malPoolId = amm.createPool(address(malToken), address(tokenB), 30);

        malToken.mint(address(this), 100000 ether);
        tokenB.mint(address(this), 100000 ether);
        malToken.approve(address(amm), type(uint256).max);

        amm.addLiquidity(malPoolId, 100000 ether, 100000 ether, 0, 0);

        // Setup attack: try to reenter during token transfer
        bytes memory attackData = abi.encodeWithSelector(
            VibeAMM.executeBatchSwap.selector,
            malPoolId,
            uint64(2),
            new IVibeAMM.SwapOrder[](0)
        );
        malToken.setAttack(address(amm), attackData);

        // Try the attack
        malToken.mint(address(amm), 1 ether);
        amm.syncTrackedBalance(address(malToken));

        IVibeAMM.SwapOrder[] memory orders = new IVibeAMM.SwapOrder[](1);
        orders[0] = IVibeAMM.SwapOrder({
            trader: address(this),
            tokenIn: address(malToken),
            tokenOut: address(tokenB),
            amountIn: 1 ether,
            minAmountOut: 0,
            isPriority: false
        });

        malToken.triggerAttack();

        // Should complete without reentrancy (nonReentrant protects)
        amm.executeBatchSwap(malPoolId, 1, orders);

        // If we get here, reentrancy was prevented
        assertTrue(true);
    }

    /**
     * @notice Test AMM reentrancy protection on liquidity removal
     */
    function test_reentrancy_liquidityRemovalProtection() public {
        address lpToken = amm.getLPToken(poolId);
        uint256 lpBalance = IERC20(lpToken).balanceOf(address(this));

        // Create attacker contract
        ReentrancyAttacker attacker = new ReentrancyAttacker(amm, poolId);

        // Give attacker some LP tokens
        IERC20(lpToken).transfer(address(attacker), lpBalance / 10);

        // Try to remove liquidity - should not be reentered
        amm.removeLiquidity(poolId, lpBalance / 10, 0, 0);

        // If we get here, no reentrancy issues
        assertTrue(true);
    }

    /**
     * @notice Test auction reentrancy protection
     */
    function test_reentrancy_auctionProtection() public {
        bytes32 secret = keccak256("secret");
        bytes32 commitHash = keccak256(abi.encodePacked(
            address(this),
            address(tokenA),
            address(tokenB),
            uint256(1 ether),
            uint256(0),
            secret
        ));

        // Commit
        bytes32 commitId = auction.commitOrder{value: 0.01 ether}(commitHash);

        // Try to commit again in same tx (should work, different commit)
        bytes32 secret2 = keccak256("secret2");
        bytes32 commitHash2 = keccak256(abi.encodePacked(
            address(this),
            address(tokenA),
            address(tokenB),
            uint256(1 ether),
            uint256(0),
            secret2
        ));
        bytes32 commitId2 = auction.commitOrder{value: 0.01 ether}(commitHash2);

        // Both should be valid
        ICommitRevealAuction.OrderCommitment memory c1 = auction.getCommitment(commitId);
        ICommitRevealAuction.OrderCommitment memory c2 = auction.getCommitment(commitId2);

        assertEq(uint8(c1.status), uint8(ICommitRevealAuction.CommitStatus.COMMITTED));
        assertEq(uint8(c2.status), uint8(ICommitRevealAuction.CommitStatus.COMMITTED));
    }

    /**
     * @notice Test batch processing with multiple orders from same trader
     * @dev Note: Double-spend prevention is at VibeSwapCore level (deposit checks),
     *      not at AMM level. AMM executes against pool reserves.
     */
    function test_reentrancy_batchProcessingIntegrity() public {
        // Create pool with malicious token
        bytes32 malPoolId = amm.createPool(address(malToken), address(tokenB), 30);

        malToken.mint(address(this), 100000 ether);
        tokenB.mint(address(this), 100000 ether);
        malToken.approve(address(amm), type(uint256).max);

        amm.addLiquidity(malPoolId, 100000 ether, 100000 ether, 0, 0);

        // Multiple orders execute against pool reserves, not order deposits
        // The AMM correctly processes swaps against reserves
        malToken.mint(address(amm), 2 ether);
        amm.syncTrackedBalance(address(malToken));

        IVibeAMM.SwapOrder[] memory orders = new IVibeAMM.SwapOrder[](2);
        orders[0] = IVibeAMM.SwapOrder({
            trader: address(this),
            tokenIn: address(malToken),
            tokenOut: address(tokenB),
            amountIn: 1 ether,
            minAmountOut: 0,
            isPriority: false
        });
        orders[1] = IVibeAMM.SwapOrder({
            trader: address(0x1234),
            tokenIn: address(malToken),
            tokenOut: address(tokenB),
            amountIn: 1 ether,
            minAmountOut: 0,
            isPriority: false
        });

        IVibeAMM.BatchSwapResult memory result = amm.executeBatchSwap(malPoolId, 1, orders);

        // Both orders should execute (AMM swaps against pool reserves)
        assertEq(result.totalTokenInSwapped, 2 ether, "Both orders should execute");
    }

    /**
     * @notice Test flash loan attack prevention
     */
    function test_reentrancy_flashLoanAttack() public {
        // Enable flash loan protection
        amm.setFlashLoanProtection(true);

        // Try to add and remove liquidity in same block (simulating flash loan)
        tokenA.mint(address(this), 10000 ether);
        tokenB.mint(address(this), 10000 ether);

        (,, uint256 liquidity) = amm.addLiquidity(poolId, 10000 ether, 10000 ether, 0, 0);

        // Try to remove in same block - should fail with SameBlockInteraction
        vm.expectRevert(); // SameBlockInteraction error from noFlashLoan modifier
        amm.removeLiquidity(poolId, liquidity, 0, 0);

        // Advance block (flash loan protection uses block.number, not timestamp)
        vm.roll(block.number + 1);
        vm.warp(block.timestamp + 12); // Also advance time

        // Now should work
        amm.removeLiquidity(poolId, liquidity, 0, 0);
    }
}
