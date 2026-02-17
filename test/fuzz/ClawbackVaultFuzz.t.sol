// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "forge-std/Test.sol";
import "../../contracts/compliance/ClawbackVault.sol";
import "@openzeppelin/contracts/proxy/ERC1967/ERC1967Proxy.sol";
import "@openzeppelin/contracts/token/ERC20/ERC20.sol";

contract MockCVFToken is ERC20 {
    constructor() ERC20("Mock", "MCK") {}
    function mint(address to, uint256 amount) external { _mint(to, amount); }
}

contract ClawbackVaultFuzzTest is Test {
    ClawbackVault public vault;
    MockCVFToken public token;

    address public registry;

    function setUp() public {
        registry = makeAddr("registry");

        token = new MockCVFToken();

        ClawbackVault impl = new ClawbackVault();
        bytes memory initData = abi.encodeWithSelector(ClawbackVault.initialize.selector, address(this), registry);
        ERC1967Proxy proxy = new ERC1967Proxy(address(impl), initData);
        vault = ClawbackVault(address(proxy));

        token.mint(registry, type(uint128).max);
        vm.prank(registry);
        token.approve(address(vault), type(uint256).max);
    }

    /// @notice Escrow + release always returns exact amount to recipient
    function testFuzz_escrowAndRelease(uint256 amount, address recipient) public {
        amount = bound(amount, 1, 1e30);
        vm.assume(recipient != address(0) && recipient != address(vault) && recipient != registry);

        vm.prank(registry);
        bytes32 eid = vault.escrowFunds(bytes32(uint256(1)), makeAddr("owner"), address(token), amount);

        uint256 balBefore = token.balanceOf(recipient);

        vm.prank(registry);
        vault.releaseTo(eid, recipient);

        assertEq(token.balanceOf(recipient) - balBefore, amount, "Recipient must receive exact amount");
        assertEq(vault.totalEscrowed(address(token)), 0, "Total escrowed must be zero after release");
    }

    /// @notice Escrow + returnToOwner always returns exact amount to original owner
    function testFuzz_escrowAndReturn(uint256 amount) public {
        amount = bound(amount, 1, 1e30);
        address originalOwner = makeAddr("origOwner");

        vm.prank(registry);
        bytes32 eid = vault.escrowFunds(bytes32(uint256(1)), originalOwner, address(token), amount);

        vm.prank(registry);
        vault.returnToOwner(eid);

        assertEq(token.balanceOf(originalOwner), amount, "Owner must receive exact amount");
    }

    /// @notice Multiple escrows accumulate totalEscrowed correctly
    function testFuzz_multipleEscrowsAccumulate(uint256[5] memory amounts) public {
        uint256 expectedTotal = 0;
        bytes32 caseId = bytes32(uint256(1));

        vm.startPrank(registry);
        for (uint256 i = 0; i < 5; i++) {
            amounts[i] = bound(amounts[i], 1, 1e25);
            expectedTotal += amounts[i];
            vault.escrowFunds(caseId, makeAddr(string(abi.encodePacked("owner", i))), address(token), amounts[i]);
        }
        vm.stopPrank();

        assertEq(vault.totalEscrowed(address(token)), expectedTotal, "Total must match sum");
        assertEq(vault.escrowCount(), 5, "Count must be 5");
    }

    /// @notice returnAllForCase returns all unreleased funds
    function testFuzz_returnAllReturnsUnreleased(uint256 amount1, uint256 amount2) public {
        amount1 = bound(amount1, 1, 1e25);
        amount2 = bound(amount2, 1, 1e25);

        address owner1 = makeAddr("owner1");
        address owner2 = makeAddr("owner2");
        bytes32 caseId = bytes32(uint256(1));

        vm.startPrank(registry);
        vault.escrowFunds(caseId, owner1, address(token), amount1);
        vault.escrowFunds(caseId, owner2, address(token), amount2);
        vault.returnAllForCase(caseId);
        vm.stopPrank();

        assertEq(token.balanceOf(owner1), amount1, "Owner1 must get funds back");
        assertEq(token.balanceOf(owner2), amount2, "Owner2 must get funds back");
        assertEq(vault.totalEscrowed(address(token)), 0, "Nothing escrowed after returnAll");
    }

    /// @notice Double release always reverts
    function testFuzz_doubleReleaseReverts(uint256 amount) public {
        amount = bound(amount, 1, 1e30);
        address recipient = makeAddr("recipient");

        vm.prank(registry);
        bytes32 eid = vault.escrowFunds(bytes32(uint256(1)), makeAddr("owner"), address(token), amount);

        vm.prank(registry);
        vault.releaseTo(eid, recipient);

        vm.prank(registry);
        vm.expectRevert(ClawbackVault.AlreadyReleased.selector);
        vault.releaseTo(eid, recipient);
    }

    /// @notice Escrow IDs are unique for different escrows
    function testFuzz_escrowIdsUnique(uint256 amount1, uint256 amount2) public {
        amount1 = bound(amount1, 1, 1e25);
        amount2 = bound(amount2, 1, 1e25);

        vm.startPrank(registry);
        bytes32 eid1 = vault.escrowFunds(bytes32(uint256(1)), makeAddr("o1"), address(token), amount1);
        bytes32 eid2 = vault.escrowFunds(bytes32(uint256(1)), makeAddr("o2"), address(token), amount2);
        vm.stopPrank();

        assertTrue(eid1 != eid2, "Escrow IDs must be unique");
    }
}
