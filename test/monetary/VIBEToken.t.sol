// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "forge-std/Test.sol";
import "../../contracts/monetary/VIBEToken.sol";
import "@openzeppelin/contracts/proxy/ERC1967/ERC1967Proxy.sol";

/**
 * @title VIBEToken Tests — 21M Hard Cap, Zero Pre-mine
 * @notice Tests the governance token that can only be earned, never pre-mined.
 */
contract VIBETokenTest is Test {
    VIBEToken public vibe;
    address owner = makeAddr("owner");
    address minter = makeAddr("minter");
    address user1 = makeAddr("user1");
    address user2 = makeAddr("user2");

    function setUp() public {
        VIBEToken impl = new VIBEToken();
        bytes memory data = abi.encodeWithSelector(VIBEToken.initialize.selector, owner);
        ERC1967Proxy proxy = new ERC1967Proxy(address(impl), data);
        vibe = VIBEToken(address(proxy));

        vm.prank(owner);
        vibe.setMinter(minter, true);
    }

    // ============ Initialization ============

    function test_zeroInitialSupply() public view {
        assertEq(vibe.totalSupply(), 0, "Must start at zero - no pre-mine");
        assertEq(vibe.totalMinted(), 0);
    }

    function test_maxSupply() public view {
        assertEq(vibe.MAX_SUPPLY(), 21_000_000e18);
    }

    function test_nameAndSymbol() public view {
        assertEq(vibe.name(), "VIBE");
        assertEq(vibe.symbol(), "VIBE");
    }

    // ============ Minting ============

    function test_authorizedMinterCanMint() public {
        vm.prank(minter);
        vibe.mint(user1, 1000e18);

        assertEq(vibe.balanceOf(user1), 1000e18);
        assertEq(vibe.totalMinted(), 1000e18);
        assertEq(vibe.totalSupply(), 1000e18);
    }

    function test_unauthorizedCannotMint() public {
        vm.prank(user1);
        vm.expectRevert(VIBEToken.Unauthorized.selector);
        vibe.mint(user1, 1000e18);
    }

    function test_ownerCannotMintDirectly() public {
        vm.prank(owner);
        vm.expectRevert(VIBEToken.Unauthorized.selector);
        vibe.mint(user1, 1000e18);
    }

    function test_cannotExceedMaxSupply() public {
        // Mint near max
        vm.prank(minter);
        vibe.mint(user1, 21_000_000e18 - 1);

        // Try to mint 2 more (would exceed)
        vm.prank(minter);
        vm.expectRevert(VIBEToken.ExceedsMaxSupply.selector);
        vibe.mint(user1, 2);
    }

    function test_canMintExactlyMaxSupply() public {
        vm.prank(minter);
        vibe.mint(user1, 21_000_000e18);

        assertEq(vibe.totalMinted(), 21_000_000e18);
        assertEq(vibe.mintableSupply(), 0);
    }

    function test_cannotMintToZeroAddress() public {
        vm.prank(minter);
        vm.expectRevert(VIBEToken.ZeroAddress.selector);
        vibe.mint(address(0), 100e18);
    }

    function test_cannotMintZeroAmount() public {
        vm.prank(minter);
        vm.expectRevert(VIBEToken.ZeroAmount.selector);
        vibe.mint(user1, 0);
    }

    // ============ Burning ============

    function test_burn() public {
        vm.prank(minter);
        vibe.mint(user1, 1000e18);

        vm.prank(user1);
        vibe.burn(400e18);

        assertEq(vibe.balanceOf(user1), 600e18);
        assertEq(vibe.totalBurned(), 400e18);
        assertEq(vibe.totalMinted(), 1000e18); // Unchanged
        assertEq(vibe.circulatingSupply(), 600e18);
    }

    function test_burnDoesNotCreateMintableRoom() public {
        vm.prank(minter);
        vibe.mint(user1, 21_000_000e18);

        vm.prank(user1);
        vibe.burn(1_000_000e18);

        // Even after burning, mintableSupply stays 0
        assertEq(vibe.mintableSupply(), 0, "Burns must not create re-mint room");
    }

    function test_cannotBurnZero() public {
        vm.prank(user1);
        vm.expectRevert(VIBEToken.ZeroAmount.selector);
        vibe.burn(0);
    }

    // ============ Minter Management ============

    function test_setMinter() public {
        address newMinter = makeAddr("newMinter");

        vm.prank(owner);
        vibe.setMinter(newMinter, true);
        assertTrue(vibe.minters(newMinter));

        vm.prank(owner);
        vibe.setMinter(newMinter, false);
        assertFalse(vibe.minters(newMinter));
    }

    function test_nonOwnerCannotSetMinter() public {
        vm.prank(user1);
        vm.expectRevert();
        vibe.setMinter(user1, true);
    }

    // ============ Views ============

    function test_mintableSupply() public {
        vm.prank(minter);
        vibe.mint(user1, 1_000_000e18);

        assertEq(vibe.mintableSupply(), 20_000_000e18);
    }

    function test_circulatingSupply() public {
        vm.prank(minter);
        vibe.mint(user1, 5_000_000e18);

        vm.prank(user1);
        vibe.burn(500_000e18);

        assertEq(vibe.circulatingSupply(), 4_500_000e18);
    }

    // ============ Governance (ERC20Votes) ============

    function test_delegateAndVotingPower() public {
        vm.prank(minter);
        vibe.mint(user1, 1000e18);

        // Self-delegate to activate votes
        vm.prank(user1);
        vibe.delegate(user1);

        assertEq(vibe.getVotes(user1), 1000e18);
    }

    function test_delegateToOther() public {
        vm.prank(minter);
        vibe.mint(user1, 1000e18);

        vm.prank(user1);
        vibe.delegate(user2);

        assertEq(vibe.getVotes(user2), 1000e18);
        assertEq(vibe.getVotes(user1), 0);
    }

    // ============ Fuzz ============

    function testFuzz_mintRespectsCap(uint256 amount1, uint256 amount2) public {
        amount1 = bound(amount1, 1, 21_000_000e18);
        amount2 = bound(amount2, 1, 21_000_000e18);

        vm.prank(minter);
        vibe.mint(user1, amount1);

        if (amount1 + amount2 > 21_000_000e18) {
            vm.prank(minter);
            vm.expectRevert(VIBEToken.ExceedsMaxSupply.selector);
            vibe.mint(user2, amount2);
        } else {
            vm.prank(minter);
            vibe.mint(user2, amount2);
            assertEq(vibe.totalMinted(), amount1 + amount2);
        }
    }
}
