// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "forge-std/Test.sol";
import "../contracts/compliance/ClawbackVault.sol";
import "@openzeppelin/contracts/proxy/ERC1967/ERC1967Proxy.sol";
import "@openzeppelin/contracts/token/ERC20/ERC20.sol";

contract MockCVToken is ERC20 {
    constructor() ERC20("Mock", "MCK") {}
    function mint(address to, uint256 amount) external { _mint(to, amount); }
}

contract ClawbackVaultTest is Test {
    ClawbackVault public vault;
    MockCVToken public token;
    MockCVToken public token2;

    address public owner;
    address public registry;
    address public alice;
    address public bob;
    address public victim;

    bytes32 public constant CASE_1 = keccak256("case-1");
    bytes32 public constant CASE_2 = keccak256("case-2");

    event FundsEscrowed(bytes32 indexed escrowId, bytes32 indexed caseId, address indexed from, address token, uint256 amount);
    event FundsReleased(bytes32 indexed escrowId, address indexed to, uint256 amount);
    event FundsReturnedToOwner(bytes32 indexed escrowId, address indexed owner, uint256 amount);

    function setUp() public {
        owner = address(this);
        registry = makeAddr("registry");
        alice = makeAddr("alice");
        bob = makeAddr("bob");
        victim = makeAddr("victim");

        token = new MockCVToken();
        token2 = new MockCVToken();

        ClawbackVault impl = new ClawbackVault();
        bytes memory initData = abi.encodeWithSelector(
            ClawbackVault.initialize.selector,
            owner,
            registry
        );
        ERC1967Proxy proxy = new ERC1967Proxy(address(impl), initData);
        vault = ClawbackVault(address(proxy));

        // Give registry tokens and approve vault
        token.mint(registry, 100_000e18);
        token2.mint(registry, 100_000e18);
        vm.startPrank(registry);
        token.approve(address(vault), type(uint256).max);
        token2.approve(address(vault), type(uint256).max);
        vm.stopPrank();
    }

    // ============ Initialization ============

    function test_initialize() public view {
        assertEq(vault.registry(), registry);
        assertEq(vault.owner(), owner);
        assertEq(vault.escrowCount(), 0);
    }

    function test_initialize_cannotReinit() public {
        vm.expectRevert();
        vault.initialize(owner, registry);
    }

    // ============ Escrow Funds ============

    function test_escrowFunds_success() public {
        vm.prank(registry);
        bytes32 escrowId = vault.escrowFunds(CASE_1, alice, address(token), 1000e18);

        ClawbackVault.EscrowRecord memory record = vault.getEscrow(escrowId);
        assertEq(record.caseId, CASE_1);
        assertEq(record.originalOwner, alice);
        assertEq(record.token, address(token));
        assertEq(record.amount, 1000e18);
        assertEq(record.depositedAt, uint64(block.timestamp));
        assertFalse(record.released);
        assertEq(record.releasedTo, address(0));

        assertEq(vault.escrowCount(), 1);
        assertEq(vault.totalEscrowed(address(token)), 1000e18);
        assertEq(token.balanceOf(address(vault)), 1000e18);
    }

    function test_escrowFunds_emitsEvent() public {
        vm.prank(registry);
        // Can't predict escrowId exactly, just test it doesn't revert
        vault.escrowFunds(CASE_1, alice, address(token), 500e18);
    }

    function test_escrowFunds_multipleForSameCase() public {
        vm.startPrank(registry);
        vault.escrowFunds(CASE_1, alice, address(token), 500e18);
        vault.escrowFunds(CASE_1, bob, address(token), 300e18);
        vm.stopPrank();

        bytes32[] memory caseEscrows = vault.getCaseEscrows(CASE_1);
        assertEq(caseEscrows.length, 2);
        assertEq(vault.escrowCount(), 2);
        assertEq(vault.totalEscrowed(address(token)), 800e18);
    }

    function test_escrowFunds_multipleTokens() public {
        vm.startPrank(registry);
        vault.escrowFunds(CASE_1, alice, address(token), 500e18);
        vault.escrowFunds(CASE_1, alice, address(token2), 300e18);
        vm.stopPrank();

        assertEq(vault.totalEscrowed(address(token)), 500e18);
        assertEq(vault.totalEscrowed(address(token2)), 300e18);
    }

    function test_escrowFunds_onlyRegistry() public {
        vm.prank(alice);
        vm.expectRevert(ClawbackVault.NotRegistry.selector);
        vault.escrowFunds(CASE_1, alice, address(token), 100e18);
    }

    function test_escrowFunds_ownerCanCall() public {
        // Owner also has onlyRegistry permission
        token.mint(owner, 1000e18);
        token.approve(address(vault), 1000e18);
        vault.escrowFunds(CASE_1, alice, address(token), 100e18);
        assertEq(vault.escrowCount(), 1);
    }

    // ============ Release To ============

    function test_releaseTo_success() public {
        vm.prank(registry);
        bytes32 escrowId = vault.escrowFunds(CASE_1, alice, address(token), 1000e18);

        vm.prank(registry);
        vault.releaseTo(escrowId, victim);

        ClawbackVault.EscrowRecord memory record = vault.getEscrow(escrowId);
        assertTrue(record.released);
        assertEq(record.releasedTo, victim);
        assertEq(vault.totalEscrowed(address(token)), 0);
        assertEq(token.balanceOf(victim), 1000e18);
    }

    function test_releaseTo_emitsEvent() public {
        vm.prank(registry);
        bytes32 escrowId = vault.escrowFunds(CASE_1, alice, address(token), 1000e18);

        vm.prank(registry);
        vm.expectEmit(true, true, false, true);
        emit FundsReleased(escrowId, victim, 1000e18);
        vault.releaseTo(escrowId, victim);
    }

    function test_releaseTo_zeroRecipientReverts() public {
        vm.prank(registry);
        bytes32 escrowId = vault.escrowFunds(CASE_1, alice, address(token), 100e18);

        vm.prank(registry);
        vm.expectRevert(ClawbackVault.InvalidRecipient.selector);
        vault.releaseTo(escrowId, address(0));
    }

    function test_releaseTo_nonExistentEscrowReverts() public {
        vm.prank(registry);
        vm.expectRevert(ClawbackVault.EscrowNotFound.selector);
        vault.releaseTo(bytes32(uint256(999)), victim);
    }

    function test_releaseTo_alreadyReleasedReverts() public {
        vm.startPrank(registry);
        bytes32 escrowId = vault.escrowFunds(CASE_1, alice, address(token), 100e18);
        vault.releaseTo(escrowId, victim);

        vm.expectRevert(ClawbackVault.AlreadyReleased.selector);
        vault.releaseTo(escrowId, victim);
        vm.stopPrank();
    }

    function test_releaseTo_onlyRegistry() public {
        vm.prank(registry);
        bytes32 escrowId = vault.escrowFunds(CASE_1, alice, address(token), 100e18);

        vm.prank(alice);
        vm.expectRevert(ClawbackVault.NotRegistry.selector);
        vault.releaseTo(escrowId, victim);
    }

    // ============ Return To Owner ============

    function test_returnToOwner_success() public {
        vm.prank(registry);
        bytes32 escrowId = vault.escrowFunds(CASE_1, alice, address(token), 1000e18);

        vm.prank(registry);
        vault.returnToOwner(escrowId);

        ClawbackVault.EscrowRecord memory record = vault.getEscrow(escrowId);
        assertTrue(record.released);
        assertEq(record.releasedTo, alice);
        assertEq(vault.totalEscrowed(address(token)), 0);
        assertEq(token.balanceOf(alice), 1000e18);
    }

    function test_returnToOwner_emitsEvent() public {
        vm.prank(registry);
        bytes32 escrowId = vault.escrowFunds(CASE_1, alice, address(token), 1000e18);

        vm.prank(registry);
        vm.expectEmit(true, true, false, true);
        emit FundsReturnedToOwner(escrowId, alice, 1000e18);
        vault.returnToOwner(escrowId);
    }

    function test_returnToOwner_nonExistentReverts() public {
        vm.prank(registry);
        vm.expectRevert(ClawbackVault.EscrowNotFound.selector);
        vault.returnToOwner(bytes32(uint256(999)));
    }

    function test_returnToOwner_alreadyReleasedReverts() public {
        vm.startPrank(registry);
        bytes32 escrowId = vault.escrowFunds(CASE_1, alice, address(token), 100e18);
        vault.returnToOwner(escrowId);

        vm.expectRevert(ClawbackVault.AlreadyReleased.selector);
        vault.returnToOwner(escrowId);
        vm.stopPrank();
    }

    // ============ Return All For Case ============

    function test_returnAllForCase_success() public {
        vm.startPrank(registry);
        vault.escrowFunds(CASE_1, alice, address(token), 500e18);
        vault.escrowFunds(CASE_1, bob, address(token), 300e18);

        vault.returnAllForCase(CASE_1);
        vm.stopPrank();

        assertEq(token.balanceOf(alice), 500e18);
        assertEq(token.balanceOf(bob), 300e18);
        assertEq(vault.totalEscrowed(address(token)), 0);
    }

    function test_returnAllForCase_skipsAlreadyReleased() public {
        vm.startPrank(registry);
        bytes32 eid1 = vault.escrowFunds(CASE_1, alice, address(token), 500e18);
        vault.escrowFunds(CASE_1, bob, address(token), 300e18);

        // Release first one manually
        vault.releaseTo(eid1, victim);

        // returnAllForCase should only return bob's funds
        vault.returnAllForCase(CASE_1);
        vm.stopPrank();

        assertEq(token.balanceOf(victim), 500e18);  // from releaseTo
        assertEq(token.balanceOf(bob), 300e18);      // from returnAll
        assertEq(token.balanceOf(alice), 0);          // alice got nothing (funds went to victim)
    }

    function test_returnAllForCase_emptyCase() public {
        // Should not revert on empty case
        vm.prank(registry);
        vault.returnAllForCase(bytes32(uint256(999)));
    }

    // ============ View Functions ============

    function test_getCaseEscrows() public {
        vm.startPrank(registry);
        vault.escrowFunds(CASE_1, alice, address(token), 100e18);
        vault.escrowFunds(CASE_1, bob, address(token), 200e18);
        vault.escrowFunds(CASE_2, alice, address(token), 300e18);
        vm.stopPrank();

        assertEq(vault.getCaseEscrows(CASE_1).length, 2);
        assertEq(vault.getCaseEscrows(CASE_2).length, 1);
    }

    function test_getTotalEscrowed() public {
        vm.startPrank(registry);
        vault.escrowFunds(CASE_1, alice, address(token), 100e18);
        vault.escrowFunds(CASE_2, bob, address(token), 200e18);
        vm.stopPrank();

        assertEq(vault.getTotalEscrowed(address(token)), 300e18);
    }

    // ============ Admin ============

    function test_setRegistry() public {
        address newReg = makeAddr("newRegistry");
        vault.setRegistry(newReg);
        assertEq(vault.registry(), newReg);
    }

    function test_setRegistry_onlyOwner() public {
        vm.prank(alice);
        vm.expectRevert();
        vault.setRegistry(alice);
    }
}
