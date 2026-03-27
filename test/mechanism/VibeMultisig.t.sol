// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "forge-std/Test.sol";
import "@openzeppelin/contracts/proxy/ERC1967/ERC1967Proxy.sol";
import "../../contracts/mechanism/VibeMultisig.sol";

/// @dev Simple receiver for multisig execution tests
contract MultiTarget {
    uint256 public value;
    uint256 public ethReceived;

    function setValue(uint256 _v) external { value = _v; }
    receive() external payable { ethReceived += msg.value; }
}

contract VibeMultisigTest is Test {
    VibeMultisig public msig;
    MultiTarget  public target;

    address public alice;
    address public bob;
    address public charlie;
    address public dave;   // non-owner

    event TransactionSubmitted(uint256 indexed txId, address indexed submitter, address to, uint256 value);
    event TransactionConfirmed(uint256 indexed txId, address indexed confirmer);
    event TransactionRevoked(uint256 indexed txId, address indexed revoker);
    event TransactionExecuted(uint256 indexed txId);
    event OwnerAdded(address indexed owner);
    event OwnerRemoved(address indexed owner);
    event RequirementChanged(uint256 required);

    function setUp() public {
        alice   = makeAddr("alice");
        bob     = makeAddr("bob");
        charlie = makeAddr("charlie");
        dave    = makeAddr("dave");

        vm.deal(alice, 100 ether);
        vm.deal(bob,   100 ether);

        address[] memory owners = new address[](3);
        owners[0] = alice;
        owners[1] = bob;
        owners[2] = charlie;

        VibeMultisig impl = new VibeMultisig();
        ERC1967Proxy proxy = new ERC1967Proxy(
            address(impl),
            abi.encodeWithSelector(VibeMultisig.initialize.selector, owners, 2)
        );
        msig = VibeMultisig(payable(address(proxy)));

        target = new MultiTarget();
        // Fund the multisig so ETH transfers are possible
        vm.deal(address(msig), 10 ether);
    }

    // ============ Initialization ============

    function test_initialization() public view {
        assertEq(msig.getOwnerCount(), 3);
        assertEq(msig.required(), 2);
        assertTrue(msig.isOwner(alice));
        assertTrue(msig.isOwner(bob));
        assertTrue(msig.isOwner(charlie));
        assertFalse(msig.isOwner(dave));
    }

    function test_init_revert_requiredZero() public {
        address[] memory owners = new address[](2);
        owners[0] = alice; owners[1] = bob;

        VibeMultisig impl2 = new VibeMultisig();
        vm.expectRevert("Invalid config");
        new ERC1967Proxy(
            address(impl2),
            abi.encodeWithSelector(VibeMultisig.initialize.selector, owners, 0)
        );
    }

    function test_init_revert_requiredExceedsOwners() public {
        address[] memory owners = new address[](2);
        owners[0] = alice; owners[1] = bob;

        VibeMultisig impl2 = new VibeMultisig();
        vm.expectRevert("Invalid config");
        new ERC1967Proxy(
            address(impl2),
            abi.encodeWithSelector(VibeMultisig.initialize.selector, owners, 3)
        );
    }

    function test_init_revert_zeroAddress() public {
        address[] memory owners = new address[](2);
        owners[0] = alice; owners[1] = address(0);

        VibeMultisig impl2 = new VibeMultisig();
        vm.expectRevert("Zero address");
        new ERC1967Proxy(
            address(impl2),
            abi.encodeWithSelector(VibeMultisig.initialize.selector, owners, 1)
        );
    }

    function test_init_revert_duplicateOwner() public {
        address[] memory owners = new address[](2);
        owners[0] = alice; owners[1] = alice;

        VibeMultisig impl2 = new VibeMultisig();
        vm.expectRevert("Duplicate");
        new ERC1967Proxy(
            address(impl2),
            abi.encodeWithSelector(VibeMultisig.initialize.selector, owners, 1)
        );
    }

    // ============ Submit Transaction ============

    function test_submitTransaction_basic() public {
        bytes memory data = abi.encodeWithSelector(MultiTarget.setValue.selector, 7);

        vm.prank(alice);
        vm.expectEmit(true, true, false, true);
        emit TransactionSubmitted(1, alice, address(target), 0);
        uint256 txId = msig.submitTransaction(address(target), 0, data);

        assertEq(txId, 1);
        assertEq(msig.getTransactionCount(), 1);

        // Note: bytes `data` field is included in the auto-generated getter at index 3
        (
            uint256 id,
            address to,
            uint256 value,
            ,
            uint256 confirmations,
            bool executed,

        ) = msig.transactions(txId);

        assertEq(id, 1);
        assertEq(to, address(target));
        assertEq(value, 0);
        assertEq(confirmations, 1);
        assertFalse(executed);
        assertTrue(msig.confirmed(txId, alice));
    }

    function test_submitTransaction_revert_notOwner() public {
        vm.prank(dave);
        vm.expectRevert("Not owner");
        msig.submitTransaction(address(target), 0, "");
    }

    function test_submitTransaction_autoExecute_oneOfOne() public {
        // Deploy a 1-of-1 multisig
        address[] memory owners = new address[](1);
        owners[0] = alice;

        VibeMultisig impl2 = new VibeMultisig();
        ERC1967Proxy proxy2 = new ERC1967Proxy(
            address(impl2),
            abi.encodeWithSelector(VibeMultisig.initialize.selector, owners, 1)
        );
        VibeMultisig solo = VibeMultisig(payable(address(proxy2)));
        vm.deal(address(solo), 1 ether);

        bytes memory data = abi.encodeWithSelector(MultiTarget.setValue.selector, 99);

        vm.prank(alice);
        solo.submitTransaction(address(target), 0, data);

        assertEq(target.value(), 99);

        (, , , , , bool executed, ) = solo.transactions(1);
        assertTrue(executed);
    }

    // ============ Confirm Transaction ============

    function test_confirmTransaction_executesAt2of3() public {
        bytes memory data = abi.encodeWithSelector(MultiTarget.setValue.selector, 42);

        vm.prank(alice);
        uint256 txId = msig.submitTransaction(address(target), 0, data);
        // Alice has already confirmed (submitTransaction auto-confirms)

        vm.prank(bob);
        vm.expectEmit(true, true, false, false);
        emit TransactionConfirmed(txId, bob);
        msig.confirmTransaction(txId);

        assertEq(target.value(), 42);

        (, , , , , bool executed, ) = msig.transactions(txId);
        assertTrue(executed);
        assertTrue(msig.isConfirmed(txId));
    }

    function test_confirmTransaction_emitsExecutedEvent() public {
        bytes memory data = abi.encodeWithSelector(MultiTarget.setValue.selector, 1);

        vm.prank(alice);
        uint256 txId = msig.submitTransaction(address(target), 0, data);

        vm.prank(bob);
        vm.expectEmit(true, false, false, false);
        emit TransactionExecuted(txId);
        msig.confirmTransaction(txId);
    }

    function test_confirmTransaction_revert_notOwner() public {
        vm.prank(alice);
        uint256 txId = msig.submitTransaction(address(target), 0, "");

        vm.prank(dave);
        vm.expectRevert("Not owner");
        msig.confirmTransaction(txId);
    }

    function test_confirmTransaction_revert_alreadyConfirmed() public {
        vm.prank(alice);
        uint256 txId = msig.submitTransaction(address(target), 0, "");

        vm.prank(alice);
        vm.expectRevert("Already confirmed");
        msig.confirmTransaction(txId);
    }

    function test_confirmTransaction_revert_alreadyExecuted() public {
        bytes memory data = abi.encodeWithSelector(MultiTarget.setValue.selector, 5);

        vm.prank(alice);
        uint256 txId = msig.submitTransaction(address(target), 0, data);
        vm.prank(bob);
        msig.confirmTransaction(txId); // executes

        vm.prank(charlie);
        vm.expectRevert("Already executed");
        msig.confirmTransaction(txId);
    }

    // ============ Revoke Confirmation ============

    function test_revokeConfirmation() public {
        vm.prank(alice);
        uint256 txId = msig.submitTransaction(address(target), 0, "");

        vm.prank(alice);
        vm.expectEmit(true, true, false, false);
        emit TransactionRevoked(txId, alice);
        msig.revokeConfirmation(txId);

        assertFalse(msig.confirmed(txId, alice));

        (, , , , uint256 confirmations, , ) = msig.transactions(txId);
        assertEq(confirmations, 0);
    }

    function test_revokeConfirmation_revert_notConfirmed() public {
        vm.prank(alice);
        uint256 txId = msig.submitTransaction(address(target), 0, "");

        vm.prank(bob);
        vm.expectRevert("Not confirmed");
        msig.revokeConfirmation(txId);
    }

    function test_revokeConfirmation_revert_alreadyExecuted() public {
        bytes memory data = abi.encodeWithSelector(MultiTarget.setValue.selector, 3);

        vm.prank(alice);
        uint256 txId = msig.submitTransaction(address(target), 0, data);
        vm.prank(bob);
        msig.confirmTransaction(txId); // executes

        vm.prank(alice);
        vm.expectRevert("Already executed");
        msig.revokeConfirmation(txId);
    }

    // ============ ETH Transfer ============

    function test_executeWithEthTransfer() public {
        uint256 initialBal = address(target).balance;

        vm.prank(alice);
        uint256 txId = msig.submitTransaction(address(target), 1 ether, "");
        vm.prank(bob);
        msig.confirmTransaction(txId); // executes with ETH

        assertEq(address(target).balance, initialBal + 1 ether);
        assertEq(target.ethReceived(), 1 ether);
    }

    // ============ View Helpers ============

    function test_getOwners() public view {
        address[] memory owners = msig.getOwners();
        assertEq(owners.length, 3);
    }

    function test_isConfirmed_false_beforeThreshold() public {
        vm.prank(alice);
        uint256 txId = msig.submitTransaction(address(target), 0, "");
        assertFalse(msig.isConfirmed(txId)); // only 1 of 2 required
    }

    function test_getTransactionCount_increments() public {
        assertEq(msig.getTransactionCount(), 0);

        vm.prank(alice);
        msig.submitTransaction(address(target), 0, "");
        assertEq(msig.getTransactionCount(), 1);

        vm.prank(alice);
        msig.submitTransaction(address(target), 0, "");
        assertEq(msig.getTransactionCount(), 2);
    }

    function test_receiveEther() public {
        vm.prank(alice);
        (bool ok,) = address(msig).call{value: 1 ether}("");
        assertTrue(ok);
    }

    // ============ Fuzz Tests ============

    function testFuzz_submitAndConfirm_multipleOwners(uint8 extra) public {
        extra = uint8(bound(extra, 0, 5));

        // Build a fresh (extra+2)-of-(extra+3) multisig
        address[] memory owners = new address[](uint256(extra) + 3);
        owners[0] = alice; owners[1] = bob; owners[2] = charlie;
        for (uint256 i = 0; i < extra; i++) {
            owners[3 + i] = makeAddr(string(abi.encodePacked("extra", i)));
        }

        VibeMultisig impl2 = new VibeMultisig();
        ERC1967Proxy proxy2 = new ERC1967Proxy(
            address(impl2),
            abi.encodeWithSelector(VibeMultisig.initialize.selector, owners, 2)
        );
        VibeMultisig ms2 = VibeMultisig(payable(address(proxy2)));

        bytes memory data = abi.encodeWithSelector(MultiTarget.setValue.selector, 77);

        vm.prank(alice);
        uint256 txId = ms2.submitTransaction(address(target), 0, data);

        assertFalse(ms2.isConfirmed(txId)); // 1-of-2 not yet

        vm.prank(bob);
        ms2.confirmTransaction(txId); // 2-of-2 => executes

        assertEq(target.value(), 77);
    }
}
