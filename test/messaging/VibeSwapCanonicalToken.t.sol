// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "forge-std/Test.sol";
import "@openzeppelin/contracts/proxy/ERC1967/ERC1967Proxy.sol";

import "../../contracts/messaging/VibeSwapCanonicalToken.sol";
import {IVibeSwapCanonicalToken} from "../../contracts/messaging/interfaces/IVibeSwapCanonicalToken.sol";
import {IMessagingHub} from "../../contracts/messaging/interfaces/IMessagingHub.sol";

/// @notice Mock hub that records initiateBurn calls and returns sequential nonces.
contract MockMessagingHub {
    uint256 public nextNonce = 1;

    address public lastToken;
    address public lastSender;
    uint64  public lastDstChainId;
    address public lastRecipient;
    uint256 public lastAmount;

    function initiateBurn(
        address token,
        address sender,
        uint64 dstChainId,
        address recipient,
        uint256 amount
    ) external returns (uint256 nonce) {
        lastToken = token;
        lastSender = sender;
        lastDstChainId = dstChainId;
        lastRecipient = recipient;
        lastAmount = amount;
        return nextNonce++;
    }
}

contract VibeSwapCanonicalTokenTest is Test {
    VibeSwapCanonicalToken public token;
    MockMessagingHub public hub;

    address admin = makeAddr("admin");
    address user1 = makeAddr("user1");
    address user2 = makeAddr("user2");
    address mallory = makeAddr("mallory");

    uint64 constant DST_CHAIN = 8453; // Base, for example

    function setUp() public {
        hub = new MockMessagingHub();

        VibeSwapCanonicalToken impl = new VibeSwapCanonicalToken();
        bytes memory data = abi.encodeWithSelector(
            VibeSwapCanonicalToken.initialize.selector,
            "VibeSwap Test Token",
            "vTEST",
            admin,
            address(hub)
        );
        ERC1967Proxy proxy = new ERC1967Proxy(address(impl), data);
        token = VibeSwapCanonicalToken(address(proxy));

        vm.startPrank(admin);
        token.grantRole(token.GENESIS_MINTER_ROLE(), admin);
        token.setDestinationEnabled(DST_CHAIN, true);
        vm.stopPrank();
    }

    // ============ Roles & init ============

    function test_init_setsHubAndGrantsRole() public {
        assertEq(token.messagingHub(), address(hub));
        assertTrue(token.hasRole(token.MESSAGING_HUB_ROLE(), address(hub)));
        assertTrue(token.hasRole(token.DEFAULT_ADMIN_ROLE(), admin));
    }

    function test_setMessagingHub_revokesOldGrantsNew() public {
        address newHub = makeAddr("newHub");
        vm.prank(admin);
        token.setMessagingHub(newHub);

        assertEq(token.messagingHub(), newHub);
        assertFalse(token.hasRole(token.MESSAGING_HUB_ROLE(), address(hub)));
        assertTrue(token.hasRole(token.MESSAGING_HUB_ROLE(), newHub));
    }

    // ============ Genesis mint ============

    function test_genesisMint_succeedsForGenesisRole() public {
        vm.prank(admin);
        token.genesisMint(user1, 1_000 ether);
        assertEq(token.balanceOf(user1), 1_000 ether);
    }

    function test_genesisMint_revertsForNonRole() public {
        vm.prank(mallory);
        vm.expectRevert(IVibeSwapCanonicalToken.UnauthorizedMinter.selector);
        token.genesisMint(mallory, 1_000 ether);
    }

    // ============ Cross-chain mint ============

    function test_mint_onlyHubCanCall() public {
        vm.prank(mallory);
        vm.expectRevert(IVibeSwapCanonicalToken.UnauthorizedMinter.selector);
        token.mint(user1, 100 ether, 1, 42);
    }

    function test_mint_byHub_creditsRecipient() public {
        vm.prank(address(hub));
        token.mint(user1, 100 ether, 1, 42);
        assertEq(token.balanceOf(user1), 100 ether);
    }

    function test_mint_revertsOnZeroRecipient() public {
        vm.prank(address(hub));
        vm.expectRevert(IVibeSwapCanonicalToken.RecipientZero.selector);
        token.mint(address(0), 100 ether, 1, 42);
    }

    function test_mint_revertsOnZeroAmount() public {
        vm.prank(address(hub));
        vm.expectRevert(IVibeSwapCanonicalToken.AmountZero.selector);
        token.mint(user1, 0, 1, 42);
    }

    // ============ Burn ============

    function test_burn_burnsBalanceAndCallsHub() public {
        vm.prank(admin);
        token.genesisMint(user1, 1_000 ether);

        vm.prank(user1);
        uint256 nonce = token.burn(300 ether, DST_CHAIN, user2);

        assertEq(token.balanceOf(user1), 700 ether);
        assertEq(nonce, 1);
        assertEq(hub.lastToken(), address(token));
        assertEq(hub.lastSender(), user1);
        assertEq(hub.lastDstChainId(), DST_CHAIN);
        assertEq(hub.lastRecipient(), user2);
        assertEq(hub.lastAmount(), 300 ether);
    }

    function test_burn_revertsOnUnsupportedDestination() public {
        vm.prank(admin);
        token.genesisMint(user1, 1_000 ether);

        vm.prank(user1);
        vm.expectRevert(
            abi.encodeWithSelector(
                IVibeSwapCanonicalToken.UnsupportedDestination.selector,
                uint64(99999)
            )
        );
        token.burn(100 ether, 99999, user2);
    }

    function test_burn_revertsWhenHubUnset() public {
        vm.startPrank(admin);
        token.genesisMint(user1, 1_000 ether);
        token.setMessagingHub(address(0));
        vm.stopPrank();

        vm.prank(user1);
        vm.expectRevert(IVibeSwapCanonicalToken.MessagingHubUnset.selector);
        token.burn(100 ether, DST_CHAIN, user2);
    }

    function test_burn_revertsOnZeroAmount() public {
        vm.prank(user1);
        vm.expectRevert(IVibeSwapCanonicalToken.AmountZero.selector);
        token.burn(0, DST_CHAIN, user2);
    }

    function test_burn_revertsOnZeroRecipient() public {
        vm.prank(user1);
        vm.expectRevert(IVibeSwapCanonicalToken.RecipientZero.selector);
        token.burn(100 ether, DST_CHAIN, address(0));
    }

    // ============ Reissue ============

    function test_reissue_onlyHubCanCall() public {
        vm.prank(mallory);
        vm.expectRevert(IVibeSwapCanonicalToken.UnauthorizedMinter.selector);
        token.reissue(user1, 100 ether, 7);
    }

    function test_reissue_byHub_credits() public {
        vm.prank(address(hub));
        token.reissue(user1, 100 ether, 7);
        assertEq(token.balanceOf(user1), 100 ether);
    }

    // ============ Destination management ============

    function test_setDestinationEnabled_onlyManager() public {
        vm.prank(mallory);
        vm.expectRevert(); // AccessControl revert
        token.setDestinationEnabled(42, true);
    }

    function test_setDestinationEnabled_togglesState() public {
        assertFalse(token.isDestinationSupported(42));
        vm.prank(admin);
        token.setDestinationEnabled(42, true);
        assertTrue(token.isDestinationSupported(42));

        vm.prank(admin);
        token.setDestinationEnabled(42, false);
        assertFalse(token.isDestinationSupported(42));
    }
}
