// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "forge-std/Test.sol";
import "@openzeppelin/contracts/proxy/ERC1967/ERC1967Proxy.sol";
import "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import "../../contracts/incentives/IncentiveController.sol";

contract MockICFToken is ERC20 {
    constructor() ERC20("Mock", "MTK") { _mint(msg.sender, 1e24); }
    function mint(address to, uint256 amount) external { _mint(to, amount); }
}

contract MockICFVolPool {
    function depositFees(bytes32, address, uint256) external {}
}

contract MockICFILVault {
    function registerPosition(bytes32, address, uint256, uint256, uint8) external {}
    function claimProtection(bytes32, address) external pure returns (uint256) { return 0; }
    function getClaimableAmount(bytes32, address) external pure returns (uint256) { return 0; }
}

contract MockICFLoyalty {
    function registerStake(bytes32, address, uint256) external {}
    function recordUnstake(bytes32, address, uint256) external returns (uint256) { return 0; }
    function claimRewards(bytes32, address) external pure returns (uint256) { return 0; }
    function getPendingRewards(bytes32, address) external pure returns (uint256) { return 0; }
}

contract IncentiveControllerFuzzTest is Test {
    IncentiveController public controller;
    MockICFToken public token;
    address public ammAddr;
    address public coreAddr;

    function setUp() public {
        ammAddr = makeAddr("amm");
        coreAddr = makeAddr("core");
        token = new MockICFToken();

        IncentiveController impl = new IncentiveController();
        ERC1967Proxy proxy = new ERC1967Proxy(
            address(impl),
            abi.encodeWithSelector(IncentiveController.initialize.selector, address(this), ammAddr, coreAddr, makeAddr("treasury"))
        );
        controller = IncentiveController(payable(address(proxy)));
        controller.setVolatilityInsurancePool(address(new MockICFVolPool()));
        controller.setILProtectionVault(address(new MockICFILVault()));
        controller.setLoyaltyRewardsManager(address(new MockICFLoyalty()));
    }

    /// @notice Auction proceeds accumulate correctly across multiple distributions
    function testFuzz_auctionProceedsAccumulate(uint256 amount1, uint256 amount2) public {
        amount1 = bound(amount1, 0, 100 ether);
        amount2 = bound(amount2, 0, 100 ether);

        bytes32 poolId = keccak256("pool1");
        bytes32[] memory poolIds = new bytes32[](1);
        poolIds[0] = poolId;
        uint256[] memory amounts = new uint256[](1);

        if (amount1 > 0) {
            amounts[0] = amount1;
            vm.deal(coreAddr, amount1);
            vm.prank(coreAddr);
            controller.distributeAuctionProceeds{value: amount1}(1, poolIds, amounts);
        }

        if (amount2 > 0) {
            amounts[0] = amount2;
            vm.deal(coreAddr, amount2);
            vm.prank(coreAddr);
            controller.distributeAuctionProceeds{value: amount2}(2, poolIds, amounts);
        }

        assertEq(controller.poolAuctionProceeds(poolId), amount1 + amount2);
    }

    /// @notice Volatility fee routing transfers correct amount
    function testFuzz_volatilityFeeRouted(uint256 amount) public {
        amount = bound(amount, 1, 100 ether);

        bytes32 poolId = keccak256("pool1");
        token.transfer(ammAddr, amount);
        vm.prank(ammAddr);
        token.approve(address(controller), amount);

        uint256 balBefore = token.balanceOf(ammAddr);
        vm.prank(ammAddr);
        controller.routeVolatilityFee(poolId, address(token), amount);

        assertEq(token.balanceOf(ammAddr), balBefore - amount);
    }

    /// @notice Pool config overrides default config
    function testFuzz_poolConfigOverridesDefault(uint256 volBps, uint256 auctionBps) public {
        volBps = bound(volBps, 0, 10000);
        auctionBps = bound(auctionBps, 0, 10000);

        bytes32 poolId = keccak256("pool1");
        IIncentiveController.IncentiveConfig memory config = IIncentiveController.IncentiveConfig({
            volatilityFeeRatioBps: volBps, auctionToLPRatioBps: auctionBps,
            ilProtectionCapBps: 5000, slippageGuaranteeCapBps: 100, loyaltyBoostMaxBps: 15000
        });
        controller.setPoolConfig(poolId, config);

        IIncentiveController.IncentiveConfig memory stored = controller.getPoolConfig(poolId);
        assertEq(stored.volatilityFeeRatioBps, volBps);
        assertEq(stored.auctionToLPRatioBps, auctionBps);
    }

    /// @notice Unauthorized callers always rejected
    function testFuzz_unauthorizedRejected(address caller) public {
        vm.assume(caller != ammAddr && caller != coreAddr && caller != address(this));

        bytes32 poolId = keccak256("pool1");

        vm.prank(caller);
        vm.expectRevert(IncentiveController.Unauthorized.selector);
        controller.routeVolatilityFee(poolId, address(token), 1 ether);

        vm.prank(caller);
        vm.expectRevert(IncentiveController.Unauthorized.selector);
        controller.onLiquidityAdded(poolId, caller, 1 ether, 1000e18);
    }

    /// @notice Excess ETH in distributeAuctionProceeds is refunded
    function testFuzz_excessRefunded(uint256 amount, uint256 excess) public {
        amount = bound(amount, 1, 50 ether);
        excess = bound(excess, 1, 50 ether);

        bytes32[] memory poolIds = new bytes32[](1);
        poolIds[0] = keccak256("pool1");
        uint256[] memory amounts = new uint256[](1);
        amounts[0] = amount;

        vm.deal(coreAddr, amount + excess);
        uint256 balBefore = coreAddr.balance;

        vm.prank(coreAddr);
        controller.distributeAuctionProceeds{value: amount + excess}(1, poolIds, amounts);

        assertEq(coreAddr.balance, balBefore - amount);
    }
}
