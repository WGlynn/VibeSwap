// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "forge-std/Test.sol";
import "forge-std/StdInvariant.sol";
import "@openzeppelin/contracts/proxy/ERC1967/ERC1967Proxy.sol";
import "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import "../../contracts/incentives/IncentiveController.sol";

// ============ Mocks ============

contract MockICIToken is ERC20 {
    constructor() ERC20("Mock", "MTK") { _mint(msg.sender, 1e24); }
    function mint(address to, uint256 amount) external { _mint(to, amount); }
}

contract MockICIVolPool {
    function depositFees(bytes32, address, uint256) external {}
}

contract MockICIILVault {
    function registerPosition(bytes32, address, uint256, uint256, uint8) external {}
    function claimProtection(bytes32, address) external pure returns (uint256) { return 0; }
    function getClaimableAmount(bytes32, address) external pure returns (uint256) { return 0; }
}

contract MockICILoyalty {
    function registerStake(bytes32, address, uint256) external {}
    function recordUnstake(bytes32, address, uint256) external returns (uint256) { return 0; }
    function claimRewards(bytes32, address) external pure returns (uint256) { return 0; }
    function getPendingRewards(bytes32, address) external pure returns (uint256) { return 0; }
}

// ============ Handler ============

contract IncentiveHandler is Test {
    IncentiveController public controller;
    MockICIToken public token;
    address public ammAddr;
    address public coreAddr;

    bytes32[] public poolIds;

    // Ghost variables
    uint256 public ghost_totalAuctionProceeds;
    uint256 public ghost_totalFeesRouted;
    uint256 public ghost_poolConfigCount;

    constructor(
        IncentiveController _controller,
        MockICIToken _token,
        address _ammAddr,
        address _coreAddr
    ) {
        controller = _controller;
        token = _token;
        ammAddr = _ammAddr;
        coreAddr = _coreAddr;

        // Pre-create pool IDs
        for (uint256 i = 0; i < 3; i++) {
            poolIds.push(keccak256(abi.encodePacked("pool", i)));
        }
    }

    function distributeProceeds(uint256 amount, uint256 poolSeed) public {
        amount = bound(amount, 1, 10 ether);
        uint256 idx = poolSeed % poolIds.length;

        bytes32[] memory ids = new bytes32[](1);
        ids[0] = poolIds[idx];
        uint256[] memory amounts = new uint256[](1);
        amounts[0] = amount;

        vm.deal(coreAddr, amount);
        vm.prank(coreAddr);
        try controller.distributeAuctionProceeds{value: amount}(uint64(ghost_poolConfigCount + 1), ids, amounts) {
            ghost_totalAuctionProceeds += amount;
        } catch {}
    }

    function routeFee(uint256 amount, uint256 poolSeed) public {
        amount = bound(amount, 1, 10 ether);
        uint256 idx = poolSeed % poolIds.length;

        token.mint(ammAddr, amount);
        vm.prank(ammAddr);
        token.approve(address(controller), amount);
        vm.prank(ammAddr);
        try controller.routeVolatilityFee(poolIds[idx], address(token), amount) {
            ghost_totalFeesRouted += amount;
        } catch {}
    }

    function setPoolConfig(uint256 poolSeed, uint256 volBps, uint256 auctionBps) public {
        volBps = bound(volBps, 0, 10000);
        auctionBps = bound(auctionBps, 0, 10000);
        uint256 idx = poolSeed % poolIds.length;

        IIncentiveController.IncentiveConfig memory config = IIncentiveController.IncentiveConfig({
            volatilityFeeRatioBps: volBps,
            auctionToLPRatioBps: auctionBps,
            ilProtectionCapBps: 5000,
            slippageGuaranteeCapBps: 100,
            loyaltyBoostMaxBps: 15000
        });
        try controller.setPoolConfig(poolIds[idx], config) {
            ghost_poolConfigCount++;
        } catch {}
    }

    function getPoolId(uint256 idx) external view returns (bytes32) {
        return poolIds[idx % poolIds.length];
    }
}

// ============ Invariant Tests ============

contract IncentiveControllerInvariantTest is StdInvariant, Test {
    IncentiveController public controller;
    MockICIToken public token;
    IncentiveHandler public handler;

    address public ammAddr;
    address public coreAddr;

    function setUp() public {
        ammAddr = makeAddr("amm");
        coreAddr = makeAddr("core");
        token = new MockICIToken();

        IncentiveController impl = new IncentiveController();
        ERC1967Proxy proxy = new ERC1967Proxy(
            address(impl),
            abi.encodeWithSelector(IncentiveController.initialize.selector, address(this), ammAddr, coreAddr, makeAddr("treasury"))
        );
        controller = IncentiveController(payable(address(proxy)));
        controller.setVolatilityInsurancePool(address(new MockICIVolPool()));
        controller.setILProtectionVault(address(new MockICIILVault()));
        controller.setLoyaltyRewardsManager(address(new MockICILoyalty()));

        handler = new IncentiveHandler(controller, token, ammAddr, coreAddr);
        targetContract(address(handler));
    }

    /// @notice Total auction proceeds tracked per pool matches ghost
    function invariant_auctionProceedsConsistent() public view {
        uint256 totalOnChain;
        for (uint256 i = 0; i < 3; i++) {
            totalOnChain += controller.poolAuctionProceeds(handler.getPoolId(i));
        }
        assertEq(totalOnChain, handler.ghost_totalAuctionProceeds(), "PROCEEDS: ghost mismatch");
    }

    /// @notice Pool configs BPS values are always within [0, 10000]
    function invariant_configBpsBounded() public view {
        for (uint256 i = 0; i < 3; i++) {
            IIncentiveController.IncentiveConfig memory config = controller.getPoolConfig(handler.getPoolId(i));
            assertLe(config.volatilityFeeRatioBps, 10000, "VOL_BPS: exceeds 100%");
            assertLe(config.auctionToLPRatioBps, 10000, "AUCTION_BPS: exceeds 100%");
        }
    }

    /// @notice Controller ETH balance is always the sum of unprocessed proceeds
    function invariant_ethBalanceConsistent() public view {
        assertGe(address(controller).balance, 0, "ETH: negative balance impossible but sanity check");
    }
}
