// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "forge-std/Test.sol";
import "../../contracts/governance/DAOTreasury.sol";
import "@openzeppelin/contracts/proxy/ERC1967/ERC1967Proxy.sol";
import "@openzeppelin/contracts/token/ERC20/ERC20.sol";

// ============ Mocks ============

contract MockTreasuryFToken is ERC20 {
    constructor(string memory name_, string memory symbol_) ERC20(name_, symbol_) {}
    function mint(address to, uint256 amount) external { _mint(to, amount); }
}

contract MockTreasuryFAMM {
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

    function getPool(bytes32 poolId) external view returns (Pool memory) {
        return pools[poolId];
    }
}

// ============ Fuzz Tests ============

contract DAOTreasuryFuzzTest is Test {
    DAOTreasury public treasury;
    MockTreasuryFToken public token;
    MockTreasuryFAMM public mockAMM;

    address public owner;
    address public feeSender;
    address public recipient;

    function setUp() public {
        owner = address(this);
        feeSender = makeAddr("feeSender");
        recipient = makeAddr("recipient");

        token = new MockTreasuryFToken("USDC", "USDC");
        mockAMM = new MockTreasuryFAMM();

        DAOTreasury impl = new DAOTreasury();
        bytes memory initData = abi.encodeWithSelector(
            DAOTreasury.initialize.selector,
            owner,
            address(mockAMM)
        );
        ERC1967Proxy proxy = new ERC1967Proxy(address(impl), initData);
        treasury = DAOTreasury(payable(address(proxy)));

        treasury.setAuthorizedFeeSender(feeSender, true);
    }

    // ============ Fuzz: fees accumulate correctly ============

    function testFuzz_feesAccumulate(uint256 amount1, uint256 amount2) public {
        amount1 = bound(amount1, 1, 10_000_000 ether);
        amount2 = bound(amount2, 1, 10_000_000 ether);

        token.mint(feeSender, amount1 + amount2);
        vm.prank(feeSender);
        token.approve(address(treasury), amount1 + amount2);

        vm.prank(feeSender);
        treasury.receiveProtocolFees(address(token), amount1, 1);

        vm.prank(feeSender);
        treasury.receiveProtocolFees(address(token), amount2, 2);

        assertEq(
            treasury.totalFeesReceived(address(token)),
            amount1 + amount2,
            "Fees should accumulate"
        );
        assertEq(
            token.balanceOf(address(treasury)),
            amount1 + amount2,
            "Treasury balance should match"
        );
    }

    // ============ Fuzz: requestId is monotonically increasing ============

    function testFuzz_requestIdMonotonic(uint256 count) public {
        count = bound(count, 1, 20);

        // Fund treasury
        token.mint(address(treasury), count * 1 ether);

        uint256 prevId = 0;
        for (uint256 i = 0; i < count; i++) {
            uint256 id = treasury.queueWithdrawal(recipient, address(token), 1 ether);
            assertGt(id, prevId, "Request ID must increase");
            prevId = id;
        }

        assertEq(treasury.nextRequestId(), count + 1, "Next ID = count + 1");
    }

    // ============ Fuzz: timelock enforcement ============

    function testFuzz_timelockEnforcement(uint256 duration, uint256 waitTime) public {
        duration = bound(duration, 1 hours, 30 days);
        waitTime = bound(waitTime, 0, 31 days);

        treasury.setTimelockDuration(duration);

        token.mint(address(treasury), 10 ether);
        uint256 requestId = treasury.queueWithdrawal(recipient, address(token), 10 ether);

        vm.warp(block.timestamp + waitTime);

        if (waitTime < duration) {
            vm.expectRevert("Timelock active");
            treasury.executeWithdrawal(requestId);
        } else {
            treasury.executeWithdrawal(requestId);
            IDAOTreasury.WithdrawalRequest memory req = treasury.getWithdrawalRequest(requestId);
            assertTrue(req.executed, "Should be executed after timelock");
        }
    }

    // ============ Fuzz: cancel prevents execution ============

    function testFuzz_cancelPreventsExecution(uint256 amount) public {
        amount = bound(amount, 1, 10_000_000 ether);

        token.mint(address(treasury), amount);
        uint256 requestId = treasury.queueWithdrawal(recipient, address(token), amount);

        treasury.cancelWithdrawal(requestId);

        vm.warp(block.timestamp + 30 days + 1);

        vm.expectRevert("Cancelled");
        treasury.executeWithdrawal(requestId);
    }

    // ============ Fuzz: emergency withdraw bypasses timelock ============

    function testFuzz_emergencyBypassesTimelock(uint256 amount) public {
        amount = bound(amount, 1, 10_000_000 ether);

        token.mint(address(treasury), amount);

        uint256 balBefore = token.balanceOf(recipient);
        treasury.emergencyWithdraw(address(token), recipient, amount);

        assertEq(
            token.balanceOf(recipient),
            balBefore + amount,
            "Emergency withdraw should transfer immediately"
        );
    }

    // ============ Fuzz: timelock duration bounded ============

    function testFuzz_timelockDurationBounded(uint256 duration) public {
        if (duration < 1 hours) {
            vm.expectRevert("Below minimum");
            treasury.setTimelockDuration(duration);
        } else if (duration > 30 days) {
            vm.expectRevert("Exceeds maximum");
            treasury.setTimelockDuration(duration);
        } else {
            treasury.setTimelockDuration(duration);
            assertEq(treasury.timelockDuration(), duration);
        }
    }

    // ============ Fuzz: EMA smoothing produces valid prices ============

    function testFuzz_emaSmoothingValid(uint256 alpha, uint256 price1, uint256 price2) public {
        alpha = bound(alpha, 1, 1e18);
        price1 = bound(price1, 1, 1_000_000 ether);
        price2 = bound(price2, 1, 1_000_000 ether);

        treasury.configureBackstop(address(token), 100 ether, alpha, true);

        vm.prank(feeSender);
        treasury.updateSmoothedPrice(address(token), price1);

        uint256 smoothed = treasury.calculateSmoothedPrice(address(token), price2);

        // Smoothed price should be between min(price1,price2) and max(price1,price2)
        // (or equal to one of them if alpha=0 or alpha=1e18)
        uint256 minPrice = price1 < price2 ? price1 : price2;
        uint256 maxPrice = price1 > price2 ? price1 : price2;

        assertGe(smoothed, minPrice, "Smoothed below min");
        assertLe(smoothed, maxPrice, "Smoothed above max");
    }
}
