// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "forge-std/Test.sol";
import "@openzeppelin/contracts/proxy/ERC1967/ERC1967Proxy.sol";
import "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import "../../contracts/intent-markets/MemecoinLaunchAuction.sol";
import "../../contracts/intent-markets/CreatorLiquidityLock.sol";

// ============ Mocks ============

contract MockToken is ERC20 {
    constructor(string memory name, string memory symbol) ERC20(name, symbol) {
        _mint(msg.sender, 1_000_000e18);
    }
    function mint(address to, uint256 amount) external {
        _mint(to, amount);
    }
}

/// @dev Minimal mock for CommitRevealAuction — we only need it to not revert
contract MockCommitRevealAuction {
    fallback() external payable {}
    receive() external payable {}
}

/// @dev Minimal mock for VibeAMM
contract MockVibeAMM {
    function createPool(address, address, uint256) external pure returns (bytes32) {
        return keccak256("pool");
    }
    function addLiquidity(bytes32, uint256, uint256, uint256, uint256) external pure returns (uint256, uint256, uint256) {
        return (0, 0, 0);
    }
}

contract MemecoinLaunchAuctionTest is Test {
    MemecoinLaunchAuction public launchAuction;
    CreatorLiquidityLock public creatorLock;
    MockToken public memeToken;
    MockCommitRevealAuction public mockAuction;
    MockVibeAMM public mockAmm;

    address public creator = makeAddr("creator");
    address public buyer1 = makeAddr("buyer1");
    address public buyer2 = makeAddr("buyer2");
    address public buyer3 = makeAddr("buyer3");
    address public lpPool = makeAddr("lpPool");

    uint256 constant TOKENS_FOR_SALE = 100_000e18;
    uint256 constant CREATOR_DEPOSIT = 1 ether;
    uint64 constant LOCK_DURATION = 30 days;
    uint256 constant LAUNCH_COOLDOWN = 1 hours;
    uint256 constant MIN_CREATOR_DEPOSIT = 0.01 ether;

    function setUp() public {
        // Deploy CreatorLiquidityLock
        CreatorLiquidityLock lockImpl = new CreatorLiquidityLock();
        bytes memory lockInit = abi.encodeCall(
            CreatorLiquidityLock.initialize,
            (lpPool, 30 days, 365 days, MIN_CREATOR_DEPOSIT)
        );
        ERC1967Proxy lockProxy = new ERC1967Proxy(address(lockImpl), lockInit);
        creatorLock = CreatorLiquidityLock(payable(address(lockProxy)));

        // Deploy mocks
        mockAuction = new MockCommitRevealAuction();
        mockAmm = new MockVibeAMM();

        // Deploy MemecoinLaunchAuction
        MemecoinLaunchAuction impl = new MemecoinLaunchAuction();
        bytes memory initData = abi.encodeCall(
            MemecoinLaunchAuction.initialize,
            (
                address(mockAuction),
                address(creatorLock),
                address(mockAmm),
                address(0), // no reputation verifier
                address(0), // no sybil guard
                LAUNCH_COOLDOWN,
                MIN_CREATOR_DEPOSIT
            )
        );
        ERC1967Proxy proxy = new ERC1967Proxy(address(impl), initData);
        launchAuction = MemecoinLaunchAuction(payable(address(proxy)));

        // Authorize the launch auction as a slasher on the lock
        creatorLock.authorizeSlasher(address(launchAuction));

        // Mint tokens to creator
        memeToken = new MockToken("DOGE Intent", "DOGI");
        memeToken.mint(creator, TOKENS_FOR_SALE);

        // Fund participants
        vm.deal(creator, 10 ether);
        vm.deal(buyer1, 10 ether);
        vm.deal(buyer2, 10 ether);
        vm.deal(buyer3, 10 ether);
    }

    // ============ createLaunch ============

    function test_createLaunch_happyPath() public {
        bytes32 intentSignal = keccak256("doge-but-fair");

        vm.startPrank(creator);
        memeToken.approve(address(launchAuction), TOKENS_FOR_SALE);
        uint256 launchId = launchAuction.createLaunch{value: CREATOR_DEPOSIT}(
            address(memeToken),
            address(0), // ETH reserve
            intentSignal,
            TOKENS_FOR_SALE,
            CREATOR_DEPOSIT,
            LOCK_DURATION
        );
        vm.stopPrank();

        assertEq(launchId, 1);

        IMemecoinLaunchAuction.MemecoinLaunch memory launch = launchAuction.getLaunch(launchId);
        assertEq(launch.creator, creator);
        assertEq(launch.token, address(memeToken));
        assertEq(launch.intentSignal, intentSignal);
        assertEq(launch.totalTokensForSale, TOKENS_FOR_SALE);
        assertEq(uint8(launch.phase), uint8(IMemecoinLaunchAuction.LaunchPhase.COMMIT));
    }

    function test_duplicateIntent_reverts() public {
        bytes32 intentSignal = keccak256("unique-doge");

        vm.startPrank(creator);
        memeToken.approve(address(launchAuction), TOKENS_FOR_SALE * 2);
        launchAuction.createLaunch{value: CREATOR_DEPOSIT}(
            address(memeToken), address(0), intentSignal, TOKENS_FOR_SALE, CREATOR_DEPOSIT, LOCK_DURATION
        );

        // Second launch with same intent should revert
        vm.warp(block.timestamp + LAUNCH_COOLDOWN + 1); // past cooldown
        vm.expectRevert(IMemecoinLaunchAuction.DuplicateIntentSignal.selector);
        launchAuction.createLaunch{value: CREATOR_DEPOSIT}(
            address(memeToken), address(0), intentSignal, TOKENS_FOR_SALE, CREATOR_DEPOSIT, LOCK_DURATION
        );
        vm.stopPrank();
    }

    function test_creatorCooldown() public {
        bytes32 intent1 = keccak256("intent1");
        bytes32 intent2 = keccak256("intent2");

        vm.startPrank(creator);
        memeToken.approve(address(launchAuction), TOKENS_FOR_SALE * 2);
        launchAuction.createLaunch{value: CREATOR_DEPOSIT}(
            address(memeToken), address(0), intent1, TOKENS_FOR_SALE, CREATOR_DEPOSIT, LOCK_DURATION
        );

        // Second launch within cooldown reverts
        vm.expectRevert(IMemecoinLaunchAuction.CreatorCooldownActive.selector);
        launchAuction.createLaunch{value: CREATOR_DEPOSIT}(
            address(memeToken), address(0), intent2, TOKENS_FOR_SALE, CREATOR_DEPOSIT, LOCK_DURATION
        );
        vm.stopPrank();
    }

    // ============ Commit + Settle + Claim ============

    function test_uniformPrice_allBuyersSamePrice() public {
        bytes32 intentSignal = keccak256("fair-launch");

        // Creator creates launch
        vm.startPrank(creator);
        memeToken.approve(address(launchAuction), TOKENS_FOR_SALE);
        uint256 launchId = launchAuction.createLaunch{value: CREATOR_DEPOSIT}(
            address(memeToken), address(0), intentSignal, TOKENS_FOR_SALE, CREATOR_DEPOSIT, LOCK_DURATION
        );
        vm.stopPrank();

        // 3 buyers commit different amounts
        vm.prank(buyer1);
        launchAuction.commitToBuy{value: 1 ether}(launchId, keccak256("order1"), 1 ether);

        vm.prank(buyer2);
        launchAuction.commitToBuy{value: 2 ether}(launchId, keccak256("order2"), 2 ether);

        vm.prank(buyer3);
        launchAuction.commitToBuy{value: 3 ether}(launchId, keccak256("order3"), 3 ether);

        // Settle
        launchAuction.settleLaunch(launchId);

        IMemecoinLaunchAuction.MemecoinLaunch memory launch = launchAuction.getLaunch(launchId);
        assertEq(launch.totalCommitted, 6 ether);
        assertEq(uint8(launch.phase), uint8(IMemecoinLaunchAuction.LaunchPhase.SETTLED));

        // Uniform price = 6 ETH / 100,000 tokens = 6e16 wei per token (scaled by 1e18)
        uint256 expectedPrice = (6 ether * 1e18) / TOKENS_FOR_SALE;
        assertEq(launch.uniformPrice, expectedPrice);

        // All buyers claim tokens at the SAME price
        vm.prank(buyer1);
        uint256 tokens1 = launchAuction.claimTokens(launchId);

        vm.prank(buyer2);
        uint256 tokens2 = launchAuction.claimTokens(launchId);

        vm.prank(buyer3);
        uint256 tokens3 = launchAuction.claimTokens(launchId);

        // buyer2 deposited 2x buyer1, should get ~2x tokens (rounding tolerance)
        assertApproxEqAbs(tokens2, tokens1 * 2, 2);
        // buyer3 deposited 3x buyer1, should get ~3x tokens (rounding tolerance)
        assertApproxEqAbs(tokens3, tokens1 * 3, 2);
        // Total tokens distributed = total for sale (within rounding)
        assertApproxEqAbs(tokens1 + tokens2 + tokens3, TOKENS_FOR_SALE, 3);
    }

    function test_claimTokens_alreadyClaimed_reverts() public {
        bytes32 intentSignal = keccak256("claim-once");

        vm.startPrank(creator);
        memeToken.approve(address(launchAuction), TOKENS_FOR_SALE);
        uint256 launchId = launchAuction.createLaunch{value: CREATOR_DEPOSIT}(
            address(memeToken), address(0), intentSignal, TOKENS_FOR_SALE, CREATOR_DEPOSIT, LOCK_DURATION
        );
        vm.stopPrank();

        vm.prank(buyer1);
        launchAuction.commitToBuy{value: 1 ether}(launchId, keccak256("o1"), 1 ether);

        launchAuction.settleLaunch(launchId);

        vm.prank(buyer1);
        launchAuction.claimTokens(launchId);

        vm.prank(buyer1);
        vm.expectRevert(IMemecoinLaunchAuction.AlreadyClaimed.selector);
        launchAuction.claimTokens(launchId);
    }

    function test_zeroProtocolFee() public view {
        assertEq(launchAuction.PROTOCOL_FEE_BPS(), 0);
    }

    function test_settleLaunch_noParticipants_fails() public {
        bytes32 intentSignal = keccak256("lonely-launch");

        vm.startPrank(creator);
        memeToken.approve(address(launchAuction), TOKENS_FOR_SALE);
        uint256 launchId = launchAuction.createLaunch{value: CREATOR_DEPOSIT}(
            address(memeToken), address(0), intentSignal, TOKENS_FOR_SALE, CREATOR_DEPOSIT, LOCK_DURATION
        );
        vm.stopPrank();

        launchAuction.settleLaunch(launchId);

        IMemecoinLaunchAuction.MemecoinLaunch memory launch = launchAuction.getLaunch(launchId);
        assertEq(uint8(launch.phase), uint8(IMemecoinLaunchAuction.LaunchPhase.FAILED));
    }
}
