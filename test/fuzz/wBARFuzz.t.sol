// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "forge-std/Test.sol";
import "../../contracts/core/wBAR.sol";
import "../../contracts/core/CommitRevealAuction.sol";
import "@openzeppelin/contracts/proxy/ERC1967/ERC1967Proxy.sol";
import "@openzeppelin/contracts/token/ERC20/ERC20.sol";

// ============ Mocks ============

contract MockWBARToken is ERC20 {
    constructor(string memory name_, string memory symbol_) ERC20(name_, symbol_) {}
    function mint(address to, uint256 amount) external { _mint(to, amount); }
}

// ============ Fuzz Tests ============

contract wBARFuzzTest is Test {
    wBAR public wbarToken;
    CommitRevealAuction public auction;
    MockWBARToken public tokenIn;
    MockWBARToken public tokenOut;

    address public coreAddr; // acts as vibeSwapCore (owner)
    address public alice;
    address public bob;

    function setUp() public {
        coreAddr = address(this);
        alice = makeAddr("alice");
        bob = makeAddr("bob");

        tokenIn = new MockWBARToken("In", "IN");
        tokenOut = new MockWBARToken("Out", "OUT");

        // Deploy auction (needed for constructor)
        CommitRevealAuction auctionImpl = new CommitRevealAuction();
        bytes memory auctionInit = abi.encodeWithSelector(
            CommitRevealAuction.initialize.selector,
            coreAddr,
            makeAddr("treasury"),
            address(0)
        );
        ERC1967Proxy auctionProxy = new ERC1967Proxy(address(auctionImpl), auctionInit);
        auction = CommitRevealAuction(payable(address(auctionProxy)));

        // Deploy wBAR (owner = coreAddr = address(this))
        wbarToken = new wBAR(address(auction), coreAddr);
    }

    // ============ Fuzz: mint creates correct balance ============

    function testFuzz_mintCreatesCorrectBalance(uint256 amount) public {
        amount = bound(amount, 1, 1_000_000 ether);

        bytes32 commitId = keccak256(abi.encode("commit", amount));

        wbarToken.mint(commitId, 1, alice, address(tokenIn), address(tokenOut), amount, 0);

        assertEq(wbarToken.balanceOf(alice), amount, "Balance must match minted amount");
        assertEq(wbarToken.totalSupply(), amount, "Total supply must match");
    }

    // ============ Fuzz: double mint same commitId reverts ============

    function testFuzz_doubleMintReverts(uint256 amount1, uint256 amount2) public {
        amount1 = bound(amount1, 1, 1_000_000 ether);
        amount2 = bound(amount2, 1, 1_000_000 ether);

        bytes32 commitId = keccak256("same");

        wbarToken.mint(commitId, 1, alice, address(tokenIn), address(tokenOut), amount1, 0);

        vm.expectRevert("Already minted");
        wbarToken.mint(commitId, 1, bob, address(tokenIn), address(tokenOut), amount2, 0);
    }

    // ============ Fuzz: settle records correct amountOut ============

    function testFuzz_settleRecordsAmountOut(uint256 amountIn, uint256 amountOut) public {
        amountIn = bound(amountIn, 1, 1_000_000 ether);
        amountOut = bound(amountOut, 0, 1_000_000 ether);

        bytes32 commitId = keccak256(abi.encode("settle", amountIn));

        wbarToken.mint(commitId, 1, alice, address(tokenIn), address(tokenOut), amountIn, 0);
        wbarToken.settle(commitId, amountOut);

        IwBAR.Position memory pos = wbarToken.getPosition(commitId);
        assertTrue(pos.settled, "Position must be settled");
        assertEq(pos.amountOut, amountOut, "AmountOut must match");
    }

    // ============ Fuzz: standard transfer always reverts ============

    function testFuzz_standardTransferReverts(uint256 amount) public {
        amount = bound(amount, 1, 1_000_000 ether);

        bytes32 commitId = keccak256(abi.encode("transfer", amount));
        wbarToken.mint(commitId, 1, alice, address(tokenIn), address(tokenOut), amount, 0);

        vm.prank(alice);
        vm.expectRevert(IwBAR.TransferRestricted.selector);
        wbarToken.transfer(bob, amount);
    }

    // ============ Fuzz: redeem burns tokens correctly ============

    function testFuzz_redeemBurnsTokens(uint256 amountIn, uint256 amountOut) public {
        amountIn = bound(amountIn, 1, 1_000_000 ether);
        amountOut = bound(amountOut, 1, 1_000_000 ether);

        bytes32 commitId = keccak256(abi.encode("redeem", amountIn));

        wbarToken.mint(commitId, 1, alice, address(tokenIn), address(tokenOut), amountIn, 0);
        wbarToken.settle(commitId, amountOut);

        // Fund wBAR with output tokens for redemption
        tokenOut.mint(address(wbarToken), amountOut);

        uint256 supplyBefore = wbarToken.totalSupply();

        vm.prank(alice);
        wbarToken.redeem(commitId);

        assertEq(wbarToken.balanceOf(alice), 0, "Balance must be 0 after redeem");
        assertEq(wbarToken.totalSupply(), supplyBefore - amountIn, "Supply must decrease");

        IwBAR.Position memory pos = wbarToken.getPosition(commitId);
        assertTrue(pos.redeemed, "Position must be marked redeemed");
    }

    // ============ Fuzz: position holder tracked correctly ============

    function testFuzz_positionHolderTracked(uint256 numPositions) public {
        numPositions = bound(numPositions, 1, 20);

        for (uint256 i = 0; i < numPositions; i++) {
            bytes32 commitId = keccak256(abi.encode("pos", i));
            wbarToken.mint(commitId, 1, alice, address(tokenIn), address(tokenOut), 1 ether, 0);
        }

        bytes32[] memory held = wbarToken.getHeldPositions(alice);
        assertEq(held.length, numPositions, "Held positions count must match");

        for (uint256 i = 0; i < numPositions; i++) {
            bytes32 commitId = keccak256(abi.encode("pos", i));
            assertEq(wbarToken.holderOf(commitId), alice, "Holder must be alice");
        }
    }
}
