// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "forge-std/Test.sol";
import "../../contracts/mechanism/VibeCrossChainSwap.sol";
import "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import "@openzeppelin/contracts/proxy/ERC1967/ERC1967Proxy.sol";

// ============ Mocks ============

contract MockERC20 is ERC20 {
    constructor(string memory name_, string memory symbol_) ERC20(name_, symbol_) {}
    function mint(address to, uint256 amount) external { _mint(to, amount); }
}

// ============ VibeCrossChainSwap Tests ============

contract VibeCrossChainSwapTest is Test {
    VibeCrossChainSwap public swap;
    MockERC20 public token;

    address public owner;
    address public alice;
    address public bob;
    address public feeRecipient;

    bytes32 constant SECRET = keccak256("supersecret");
    bytes32 constant HASH_LOCK = keccak256(abi.encodePacked(keccak256("supersecret")));

    uint256 constant LOCK_DURATION = 2 hours;
    uint256 constant DST_CHAIN = 137;

    // ============ Events ============

    event SwapInitiated(bytes32 indexed swapId, address indexed initiator, address counterparty, uint256 amount, bytes32 hashLock);
    event SwapClaimed(bytes32 indexed swapId, address indexed claimer, bytes32 preimage);
    event SwapRefunded(bytes32 indexed swapId, address indexed initiator);

    // ============ Setup ============

    function setUp() public {
        owner = address(this);
        alice = makeAddr("alice");
        bob = makeAddr("bob");
        feeRecipient = makeAddr("feeRecipient");

        VibeCrossChainSwap impl = new VibeCrossChainSwap();
        bytes memory initData = abi.encodeWithSelector(
            VibeCrossChainSwap.initialize.selector,
            feeRecipient
        );
        ERC1967Proxy proxy = new ERC1967Proxy(address(impl), initData);
        swap = VibeCrossChainSwap(payable(address(proxy)));

        token = new MockERC20("USD Coin", "USDC");

        // Fund alice
        vm.deal(alice, 100 ether);
        token.mint(alice, 1_000_000e6);

        vm.prank(alice);
        token.approve(address(swap), type(uint256).max);
    }

    // ============ Initialization ============

    function test_initialize_setsOwnerAndFeeRecipient() public view {
        assertEq(swap.owner(), owner);
        assertEq(swap.feeRecipient(), feeRecipient);
        assertEq(swap.feeBps(), 0);
    }

    // ============ ETH Swap Initiation ============

    function test_initiateETHSwap_storesSwapAndEmitsEvent() public {
        uint256 amount = 1 ether;

        vm.prank(alice);
        vm.expectEmit(false, true, true, false);
        emit SwapInitiated(bytes32(0), alice, bob, amount, HASH_LOCK);
        bytes32 swapId = swap.initiateETHSwap{value: amount}(
            bob, HASH_LOCK, LOCK_DURATION, DST_CHAIN
        );

        VibeCrossChainSwap.AtomicSwap memory s = swap.getSwap(swapId);
        assertEq(s.initiator, alice);
        assertEq(s.counterparty, bob);
        assertEq(s.token, address(0));
        assertEq(s.amount, amount);
        assertEq(s.hashLock, HASH_LOCK);
        assertEq(s.dstChainId, DST_CHAIN);
        assertEq(uint8(s.state), uint8(VibeCrossChainSwap.SwapState.PENDING));
    }

    function test_initiateETHSwap_revertsOnZeroValue() public {
        vm.prank(alice);
        vm.expectRevert("Zero amount");
        swap.initiateETHSwap{value: 0}(bob, HASH_LOCK, LOCK_DURATION, DST_CHAIN);
    }

    function test_initiateETHSwap_revertsOnZeroCounterparty() public {
        vm.prank(alice);
        vm.expectRevert("Zero counterparty");
        swap.initiateETHSwap{value: 1 ether}(address(0), HASH_LOCK, LOCK_DURATION, DST_CHAIN);
    }

    function test_initiateETHSwap_revertsOnLockTooShort() public {
        vm.prank(alice);
        vm.expectRevert("Invalid lock time");
        swap.initiateETHSwap{value: 1 ether}(bob, HASH_LOCK, 30 minutes, DST_CHAIN);
    }

    function test_initiateETHSwap_revertsOnLockTooLong() public {
        vm.prank(alice);
        vm.expectRevert("Invalid lock time");
        swap.initiateETHSwap{value: 1 ether}(bob, HASH_LOCK, 49 hours, DST_CHAIN);
    }

    function test_initiateETHSwap_tracksUserSwaps() public {
        vm.prank(alice);
        bytes32 swapId = swap.initiateETHSwap{value: 1 ether}(bob, HASH_LOCK, LOCK_DURATION, DST_CHAIN);

        bytes32[] memory aliceSwaps = swap.getUserSwaps(alice);
        bytes32[] memory bobSwaps = swap.getUserSwaps(bob);
        assertEq(aliceSwaps.length, 1);
        assertEq(aliceSwaps[0], swapId);
        assertEq(bobSwaps.length, 1);
        assertEq(bobSwaps[0], swapId);
    }

    // ============ Token Swap Initiation ============

    function test_initiateTokenSwap_storesSwapAndTransfersTokens() public {
        uint256 amount = 500e6;

        vm.prank(alice);
        bytes32 swapId = swap.initiateTokenSwap(
            bob, address(token), amount, HASH_LOCK, LOCK_DURATION, DST_CHAIN
        );

        VibeCrossChainSwap.AtomicSwap memory s = swap.getSwap(swapId);
        assertEq(s.token, address(token));
        assertEq(s.amount, amount);
        assertEq(token.balanceOf(address(swap)), amount);
    }

    function test_initiateTokenSwap_revertsOnZeroAmount() public {
        vm.prank(alice);
        vm.expectRevert("Zero amount");
        swap.initiateTokenSwap(bob, address(token), 0, HASH_LOCK, LOCK_DURATION, DST_CHAIN);
    }

    // ============ Claim — ETH ============

    function test_claim_ETH_successTransfersFunds() public {
        uint256 amount = 1 ether;

        vm.prank(alice);
        bytes32 swapId = swap.initiateETHSwap{value: amount}(bob, HASH_LOCK, LOCK_DURATION, DST_CHAIN);

        uint256 bobBefore = bob.balance;

        vm.prank(bob);
        vm.expectEmit(true, true, false, true);
        emit SwapClaimed(swapId, bob, SECRET);
        swap.claim(swapId, SECRET);

        assertEq(bob.balance, bobBefore + amount);
        assertEq(uint8(swap.getSwap(swapId).state), uint8(VibeCrossChainSwap.SwapState.CLAIMED));
        assertEq(swap.totalSwapsCompleted(), 1);
        assertEq(swap.totalVolume(), amount);
    }

    function test_claim_ETH_withFee_splitsFunds() public {
        // Set 1% fee
        swap.setFee(100);

        uint256 amount = 1 ether;
        vm.prank(alice);
        bytes32 swapId = swap.initiateETHSwap{value: amount}(bob, HASH_LOCK, LOCK_DURATION, DST_CHAIN);

        uint256 bobBefore = bob.balance;
        uint256 feeBefore = feeRecipient.balance;

        vm.prank(bob);
        swap.claim(swapId, SECRET);

        assertEq(bob.balance, bobBefore + 0.99 ether);
        assertEq(feeRecipient.balance, feeBefore + 0.01 ether);
    }

    function test_claim_revertsOnInvalidPreimage() public {
        vm.prank(alice);
        bytes32 swapId = swap.initiateETHSwap{value: 1 ether}(bob, HASH_LOCK, LOCK_DURATION, DST_CHAIN);

        vm.prank(bob);
        vm.expectRevert("Invalid preimage");
        swap.claim(swapId, keccak256("wrongsecret"));
    }

    function test_claim_revertsIfNotCounterparty() public {
        vm.prank(alice);
        bytes32 swapId = swap.initiateETHSwap{value: 1 ether}(bob, HASH_LOCK, LOCK_DURATION, DST_CHAIN);

        address eve = makeAddr("eve");
        vm.prank(eve);
        vm.expectRevert("Not counterparty");
        swap.claim(swapId, SECRET);
    }

    function test_claim_revertsAfterExpiry() public {
        vm.prank(alice);
        bytes32 swapId = swap.initiateETHSwap{value: 1 ether}(bob, HASH_LOCK, LOCK_DURATION, DST_CHAIN);

        vm.warp(block.timestamp + LOCK_DURATION + 1);

        vm.prank(bob);
        vm.expectRevert("Expired");
        swap.claim(swapId, SECRET);
    }

    function test_claim_revertsIfAlreadyClaimed() public {
        vm.prank(alice);
        bytes32 swapId = swap.initiateETHSwap{value: 1 ether}(bob, HASH_LOCK, LOCK_DURATION, DST_CHAIN);

        vm.prank(bob);
        swap.claim(swapId, SECRET);

        vm.prank(bob);
        vm.expectRevert("Not pending");
        swap.claim(swapId, SECRET);
    }

    // ============ Claim — Token ============

    function test_claim_token_successTransfersTokens() public {
        uint256 amount = 500e6;
        vm.prank(alice);
        bytes32 swapId = swap.initiateTokenSwap(
            bob, address(token), amount, HASH_LOCK, LOCK_DURATION, DST_CHAIN
        );

        uint256 bobBefore = token.balanceOf(bob);

        vm.prank(bob);
        swap.claim(swapId, SECRET);

        assertEq(token.balanceOf(bob), bobBefore + amount);
        assertEq(uint8(swap.getSwap(swapId).state), uint8(VibeCrossChainSwap.SwapState.CLAIMED));
    }

    // ============ Refund / Timeout Flow ============

    function test_refund_ETH_afterTimelockExpiry() public {
        uint256 amount = 1 ether;
        vm.prank(alice);
        bytes32 swapId = swap.initiateETHSwap{value: amount}(bob, HASH_LOCK, LOCK_DURATION, DST_CHAIN);

        vm.warp(block.timestamp + LOCK_DURATION);

        uint256 aliceBefore = alice.balance;

        vm.prank(alice);
        vm.expectEmit(true, true, false, false);
        emit SwapRefunded(swapId, alice);
        swap.refund(swapId);

        assertEq(alice.balance, aliceBefore + amount);
        assertEq(uint8(swap.getSwap(swapId).state), uint8(VibeCrossChainSwap.SwapState.REFUNDED));
        assertEq(swap.totalSwapsRefunded(), 1);
    }

    function test_refund_token_afterTimelockExpiry() public {
        uint256 amount = 500e6;
        vm.prank(alice);
        bytes32 swapId = swap.initiateTokenSwap(
            bob, address(token), amount, HASH_LOCK, LOCK_DURATION, DST_CHAIN
        );

        vm.warp(block.timestamp + LOCK_DURATION);

        uint256 aliceBefore = token.balanceOf(alice);

        vm.prank(alice);
        swap.refund(swapId);

        assertEq(token.balanceOf(alice), aliceBefore + amount);
    }

    function test_refund_revertsBeforeExpiry() public {
        vm.prank(alice);
        bytes32 swapId = swap.initiateETHSwap{value: 1 ether}(bob, HASH_LOCK, LOCK_DURATION, DST_CHAIN);

        vm.prank(alice);
        vm.expectRevert("Not expired");
        swap.refund(swapId);
    }

    function test_refund_revertsIfNotInitiator() public {
        vm.prank(alice);
        bytes32 swapId = swap.initiateETHSwap{value: 1 ether}(bob, HASH_LOCK, LOCK_DURATION, DST_CHAIN);

        vm.warp(block.timestamp + LOCK_DURATION);

        vm.prank(bob);
        vm.expectRevert("Not initiator");
        swap.refund(swapId);
    }

    function test_refund_revertsIfAlreadyRefunded() public {
        vm.prank(alice);
        bytes32 swapId = swap.initiateETHSwap{value: 1 ether}(bob, HASH_LOCK, LOCK_DURATION, DST_CHAIN);

        vm.warp(block.timestamp + LOCK_DURATION);
        vm.prank(alice);
        swap.refund(swapId);

        vm.prank(alice);
        vm.expectRevert("Not pending");
        swap.refund(swapId);
    }

    // ============ getSwapState — Expired Detection ============

    function test_getSwapState_returnsExpiredAfterTimelock() public {
        vm.prank(alice);
        bytes32 swapId = swap.initiateETHSwap{value: 1 ether}(bob, HASH_LOCK, LOCK_DURATION, DST_CHAIN);

        // Before expiry: PENDING
        assertEq(uint8(swap.getSwapState(swapId)), uint8(VibeCrossChainSwap.SwapState.PENDING));

        vm.warp(block.timestamp + LOCK_DURATION);

        // At/after timelock: EXPIRED (virtual — state still PENDING in storage)
        assertEq(uint8(swap.getSwapState(swapId)), uint8(VibeCrossChainSwap.SwapState.EXPIRED));
    }

    // ============ Admin ============

    function test_setFee_updatesFeeBps() public {
        swap.setFee(50);
        assertEq(swap.feeBps(), 50);
    }

    function test_setFee_revertsAboveMaximum() public {
        vm.expectRevert("Max 1%");
        swap.setFee(101);
    }

    function test_setFee_revertsIfNotOwner() public {
        vm.prank(alice);
        vm.expectRevert();
        swap.setFee(10);
    }

    // ============ Fuzz: lock duration boundaries ============

    function testFuzz_initiateETHSwap_lockDuration(uint256 duration) public {
        duration = bound(duration, swap.MIN_LOCK_TIME(), swap.MAX_LOCK_TIME());

        vm.prank(alice);
        bytes32 swapId = swap.initiateETHSwap{value: 1 ether}(bob, HASH_LOCK, duration, DST_CHAIN);

        VibeCrossChainSwap.AtomicSwap memory s = swap.getSwap(swapId);
        assertEq(s.timelock, block.timestamp + duration);
    }

    function testFuzz_claim_onlyCorrectPreimageSucceeds(bytes32 secret) public {
        bytes32 hashLock = keccak256(abi.encodePacked(secret));

        vm.prank(alice);
        bytes32 swapId = swap.initiateETHSwap{value: 1 ether}(bob, hashLock, LOCK_DURATION, DST_CHAIN);

        vm.prank(bob);
        swap.claim(swapId, secret);

        assertEq(uint8(swap.getSwap(swapId).state), uint8(VibeCrossChainSwap.SwapState.CLAIMED));
    }
}
