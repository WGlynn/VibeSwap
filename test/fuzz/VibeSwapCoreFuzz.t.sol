// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "forge-std/Test.sol";
import "@openzeppelin/contracts/proxy/ERC1967/ERC1967Proxy.sol";
import "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import "../../contracts/core/VibeSwapCore.sol";
import "../../contracts/core/interfaces/ICommitRevealAuction.sol";
import "../../contracts/core/interfaces/IVibeAMM.sol";

// ============ Minimal Mocks (reuse pattern from unit tests) ============

contract FuzzMockERC20 is ERC20 {
    constructor() ERC20("Token", "TKN") {}
    function mint(address to, uint256 amount) external { _mint(to, amount); }
}

contract FuzzMockAuction {
    uint64 public currentBatchId = 1;
    uint256 public commitCount;

    function commitOrder(bytes32) external payable returns (bytes32) {
        commitCount++;
        return keccak256(abi.encodePacked("commit", commitCount));
    }

    function revealOrderCrossChain(bytes32, address, address, address, uint256, uint256, bytes32, uint256) external payable {}
    function advancePhase() external {}
    function settleBatch() external {}
    function getCurrentBatchId() external view returns (uint64) { return currentBatchId; }
    function getCurrentPhase() external pure returns (ICommitRevealAuction.BatchPhase) { return ICommitRevealAuction.BatchPhase.COMMIT; }
    function getTimeUntilPhaseChange() external pure returns (uint256) { return 5; }
    function getRevealedOrders(uint64) external pure returns (ICommitRevealAuction.RevealedOrder[] memory) {
        return new ICommitRevealAuction.RevealedOrder[](0);
    }
    function getExecutionOrder(uint64) external pure returns (uint256[] memory) { return new uint256[](0); }
    function getBatch(uint64) external pure returns (ICommitRevealAuction.Batch memory b) { return b; }
}

contract FuzzMockAMM {
    function createPool(address, address, uint256) external pure returns (bytes32) { return keccak256("pool"); }
    function getPoolId(address a, address b) external pure returns (bytes32) { return keccak256(abi.encodePacked(a, b)); }
    function getPool(bytes32) external pure returns (IVibeAMM.Pool memory p) { return p; }
    function quote(bytes32, address, uint256 a) external pure returns (uint256) { return a * 99 / 100; }
}

contract FuzzMockTreasury {
    function receiveAuctionProceeds(uint64) external payable {}
    receive() external payable {}
}

contract FuzzMockRouter {
    function sendCommit(uint32, bytes32, bytes calldata) external payable {}
    receive() external payable {}
}

// ============ Fuzz Tests ============

contract VibeSwapCoreFuzzTest is Test {
    VibeSwapCore public core;
    FuzzMockAuction public auction;
    FuzzMockAMM public amm;
    FuzzMockTreasury public treasury;
    FuzzMockRouter public router;
    FuzzMockERC20 public tokenA;
    FuzzMockERC20 public tokenB;

    address public owner;
    address public poster;

    function setUp() public {
        owner = makeAddr("owner");
        poster = makeAddr("poster");

        auction = new FuzzMockAuction();
        amm = new FuzzMockAMM();
        treasury = new FuzzMockTreasury();
        router = new FuzzMockRouter();
        tokenA = new FuzzMockERC20();
        tokenB = new FuzzMockERC20();

        VibeSwapCore impl = new VibeSwapCore();
        ERC1967Proxy proxy = new ERC1967Proxy(
            address(impl),
            abi.encodeWithSelector(
                VibeSwapCore.initialize.selector,
                owner, address(auction), address(amm), address(treasury), address(router)
            )
        );
        core = VibeSwapCore(payable(address(proxy)));

        vm.startPrank(owner);
        core.setSupportedToken(address(tokenA), true);
        core.setSupportedToken(address(tokenB), true);
        core.setCommitCooldown(0);
        core.setRequireEOA(false);
        vm.stopPrank();

        tokenA.mint(poster, type(uint128).max);
        vm.prank(poster);
        tokenA.approve(address(core), type(uint256).max);

        vm.warp(10_000); // Must be > max possible cooldown to avoid first-commit cooldown-at-zero
    }

    /// @notice Deposits always match token balance in contract
    function testFuzz_depositTrackingConsistent(uint256 amount) public {
        amount = bound(amount, 1, 100_000e18); // Within rate limit

        vm.prank(poster);
        core.commitSwap(address(tokenA), address(tokenB), amount, 0, keccak256("s"));

        assertEq(core.deposits(poster, address(tokenA)), amount);
        assertEq(tokenA.balanceOf(address(core)), amount);
    }

    /// @notice Multiple deposits accumulate correctly
    function testFuzz_depositsAccumulate(uint8 count) public {
        count = uint8(bound(count, 1, 10));
        uint256 amountPer = 5_000e18; // 5k each, max 50k within rate limit

        uint256 total = 0;
        for (uint256 i = 0; i < count; i++) {
            vm.prank(poster);
            core.commitSwap(address(tokenA), address(tokenB), amountPer, 0, keccak256(abi.encodePacked("s", i)));
            total += amountPer;
        }

        assertEq(core.deposits(poster, address(tokenA)), total);
        assertEq(tokenA.balanceOf(address(core)), total);
    }

    /// @notice Withdrawal drains deposit to zero
    function testFuzz_withdrawDrainsDeposit(uint256 amount) public {
        amount = bound(amount, 1, 100_000e18);

        vm.prank(poster);
        core.commitSwap(address(tokenA), address(tokenB), amount, 0, keccak256("s"));

        uint256 balBefore = tokenA.balanceOf(poster);
        vm.prank(poster);
        core.withdrawDeposit(address(tokenA));

        assertEq(core.deposits(poster, address(tokenA)), 0);
        assertEq(tokenA.balanceOf(poster), balBefore + amount);
    }

    /// @notice Rate limit boundary: exactly at limit succeeds, over limit fails
    function testFuzz_rateLimitBoundary(uint256 maxRate) public {
        maxRate = bound(maxRate, 1e18, 1_000_000e18);

        vm.prank(owner);
        core.setMaxSwapPerHour(maxRate);

        // Exactly at limit — should succeed
        vm.prank(poster);
        core.commitSwap(address(tokenA), address(tokenB), maxRate, 0, keccak256("s1"));

        // 1 wei over — should fail
        vm.prank(poster);
        vm.expectRevert(VibeSwapCore.RateLimitExceededError.selector);
        core.commitSwap(address(tokenA), address(tokenB), 1, 0, keccak256("s2"));
    }

    /// @notice Cooldown respects exact boundary
    function testFuzz_cooldownBoundary(uint256 cooldown) public {
        cooldown = bound(cooldown, 2, 3600);

        vm.prank(owner);
        core.setCommitCooldown(cooldown);

        vm.prank(poster);
        core.commitSwap(address(tokenA), address(tokenB), 1e18, 0, keccak256("s1"));

        // 1 second before cooldown expires — should fail
        // Check: block.timestamp < lastCommitTime + cooldown
        vm.warp(block.timestamp + cooldown - 1);
        vm.prank(poster);
        vm.expectRevert(VibeSwapCore.CommitCooldownActive.selector);
        core.commitSwap(address(tokenA), address(tokenB), 1e18, 0, keccak256("s2"));

        // Exactly at cooldown — check is NOT strictly less, so should succeed
        vm.warp(block.timestamp + 1);
        vm.prank(poster);
        core.commitSwap(address(tokenA), address(tokenB), 1e18, 0, keccak256("s3"));
    }

    /// @notice Blacklist is effective and reversible
    function testFuzz_blacklistToggle(uint8 toggleCount) public {
        toggleCount = uint8(bound(toggleCount, 1, 10));

        for (uint256 i = 0; i < toggleCount; i++) {
            bool shouldBlock = (i % 2 == 0);
            vm.prank(owner);
            core.setBlacklist(poster, shouldBlock);
            assertEq(core.blacklisted(poster), shouldBlock);
        }
    }

    /// @notice Commit owner is always recorded correctly
    function testFuzz_commitOwnerAlwaysRecorded(uint256 amount) public {
        amount = bound(amount, 1, 100_000e18);

        vm.prank(poster);
        bytes32 commitId = core.commitSwap(address(tokenA), address(tokenB), amount, 0, keccak256("s"));

        assertEq(core.commitOwners(commitId), poster);
    }
}
