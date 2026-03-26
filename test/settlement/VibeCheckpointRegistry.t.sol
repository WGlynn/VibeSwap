// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "forge-std/Test.sol";
import "../../contracts/settlement/VibeCheckpointRegistry.sol";
import "@openzeppelin/contracts/proxy/ERC1967/ERC1967Proxy.sol";

contract VibeCheckpointRegistryTest is Test {
    VibeCheckpointRegistry public registry;

    address public owner;
    address public alice;
    address public bob;
    address public carol;

    event CheckpointSubmitted(uint256 indexed id, uint256 blockNumber, bytes32 stateRoot);

    function setUp() public {
        owner = address(this);
        alice = makeAddr("alice");
        bob = makeAddr("bob");
        carol = makeAddr("carol");

        // Deploy with UUPS proxy
        VibeCheckpointRegistry impl = new VibeCheckpointRegistry();
        bytes memory initData = abi.encodeWithSelector(VibeCheckpointRegistry.initialize.selector);
        ERC1967Proxy proxy = new ERC1967Proxy(address(impl), initData);
        registry = VibeCheckpointRegistry(payable(address(proxy)));

        vm.deal(alice, 10 ether);
        vm.deal(bob, 10 ether);
    }

    // ============ Helpers ============

    function _submit(address who, uint256 blockNumber, bytes32 stateRoot, bytes32 receiptsRoot) internal {
        vm.prank(who);
        registry.submit(blockNumber, stateRoot, receiptsRoot);
    }

    function _defaultSubmit(address who) internal {
        _submit(who, 100, keccak256("state"), keccak256("receipts"));
    }

    // ============ Initialization ============

    function test_initialize_setsOwner() public view {
        assertEq(registry.owner(), owner);
    }

    function test_initialize_checkpointCountZero() public view {
        assertEq(registry.checkpointCount(), 0);
    }

    function test_initialize_cannotReinitialize() public {
        vm.expectRevert();
        registry.initialize();
    }

    // ============ Submitter Management ============

    function test_addSubmitter_onlyOwner() public {
        registry.addSubmitter(alice);
        assertTrue(registry.submitters(alice));
    }

    function test_addSubmitter_revert_nonOwner() public {
        vm.prank(alice);
        vm.expectRevert();
        registry.addSubmitter(bob);
    }

    function test_submitter_canSubmit() public {
        registry.addSubmitter(alice);
        _defaultSubmit(alice);
        assertEq(registry.checkpointCount(), 1);
    }

    function test_owner_canSubmitWithoutBeingSubmitter() public {
        // Owner is authorized even without being in submitters mapping
        assertFalse(registry.submitters(owner));
        _defaultSubmit(owner);
        assertEq(registry.checkpointCount(), 1);
    }

    function test_unauthorized_revert() public {
        // alice is not a submitter and not owner
        vm.prank(alice);
        vm.expectRevert("Not submitter");
        registry.submit(100, keccak256("state"), keccak256("receipts"));
    }

    // ============ Submit Checkpoint ============

    function test_submit_succeeds() public {
        uint256 blockNumber = 1000;
        bytes32 stateRoot = keccak256("state-root-1");
        bytes32 receiptsRoot = keccak256("receipts-root-1");

        vm.expectEmit(true, false, false, true);
        emit CheckpointSubmitted(1, blockNumber, stateRoot);

        _submit(owner, blockNumber, stateRoot, receiptsRoot);

        assertEq(registry.checkpointCount(), 1);

        VibeCheckpointRegistry.Checkpoint memory cp = registry.getCheckpoint(1);
        assertEq(cp.blockNumber, blockNumber);
        assertEq(cp.stateRoot, stateRoot);
        assertEq(cp.receiptsRoot, receiptsRoot);
        assertEq(cp.submitter, owner);
        assertEq(cp.timestamp, block.timestamp);
    }

    function test_submit_storesSubmitter() public {
        registry.addSubmitter(alice);
        _submit(alice, 200, keccak256("s"), keccak256("r"));

        VibeCheckpointRegistry.Checkpoint memory cp = registry.getCheckpoint(1);
        assertEq(cp.submitter, alice);
    }

    function test_submit_incrementsCount() public {
        _defaultSubmit(owner);
        assertEq(registry.checkpointCount(), 1);

        _defaultSubmit(owner);
        assertEq(registry.checkpointCount(), 2);
    }

    function test_submit_multipleCheckpoints_sequential() public {
        uint256 n = 5;
        for (uint256 i = 1; i <= n; i++) {
            _submit(owner, i * 100, keccak256(abi.encode(i)), keccak256(abi.encode(i + 1000)));
        }

        assertEq(registry.checkpointCount(), n);

        for (uint256 i = 1; i <= n; i++) {
            VibeCheckpointRegistry.Checkpoint memory cp = registry.getCheckpoint(i);
            assertEq(cp.blockNumber, i * 100);
        }
    }

    function test_submit_differentSubmitters() public {
        registry.addSubmitter(alice);
        registry.addSubmitter(bob);

        _submit(alice, 100, keccak256("s1"), keccak256("r1"));
        _submit(bob, 200, keccak256("s2"), keccak256("r2"));

        assertEq(registry.getCheckpoint(1).submitter, alice);
        assertEq(registry.getCheckpoint(2).submitter, bob);
    }

    function test_submit_zeroBlockNumber() public {
        // Zero block number is a valid input (no restriction in contract)
        _submit(owner, 0, keccak256("genesis"), keccak256("receipts"));
        assertEq(registry.getCheckpoint(1).blockNumber, 0);
    }

    function test_submit_zeroRoots() public {
        // Zero bytes32 roots are valid
        _submit(owner, 1, bytes32(0), bytes32(0));
        VibeCheckpointRegistry.Checkpoint memory cp = registry.getCheckpoint(1);
        assertEq(cp.stateRoot, bytes32(0));
        assertEq(cp.receiptsRoot, bytes32(0));
    }

    function test_submit_timestampRecorded() public {
        uint256 t = 1_700_000_000;
        vm.warp(t);

        _defaultSubmit(owner);

        assertEq(registry.getCheckpoint(1).timestamp, t);
    }

    function test_submit_differentTimestamps() public {
        vm.warp(1000);
        _submit(owner, 1, keccak256("s1"), keccak256("r1"));

        vm.warp(2000);
        _submit(owner, 2, keccak256("s2"), keccak256("r2"));

        assertEq(registry.getCheckpoint(1).timestamp, 1000);
        assertEq(registry.getCheckpoint(2).timestamp, 2000);
    }

    // ============ Submitter Access Control Edge Cases ============

    function test_addMultipleSubmitters() public {
        registry.addSubmitter(alice);
        registry.addSubmitter(bob);
        registry.addSubmitter(carol);

        assertTrue(registry.submitters(alice));
        assertTrue(registry.submitters(bob));
        assertTrue(registry.submitters(carol));
    }

    function test_addSubmitter_idempotent() public {
        registry.addSubmitter(alice);
        registry.addSubmitter(alice); // Adding twice is fine
        assertTrue(registry.submitters(alice));
    }

    // ============ View Functions ============

    function test_getCheckpoint_nonexistentReturnsDefaults() public view {
        VibeCheckpointRegistry.Checkpoint memory cp = registry.getCheckpoint(999);
        assertEq(cp.blockNumber, 0);
        assertEq(cp.stateRoot, bytes32(0));
        assertEq(cp.receiptsRoot, bytes32(0));
        assertEq(cp.submitter, address(0));
        assertEq(cp.timestamp, 0);
    }

    function test_getCheckpoint_idStartsAtOne() public {
        // Count starts at 0; first submit increments to 1
        _defaultSubmit(owner);
        VibeCheckpointRegistry.Checkpoint memory cp = registry.getCheckpoint(1);
        assertNotEq(cp.submitter, address(0)); // Populated
    }

    // ============ Fuzz Tests ============

    function testFuzz_submit_storesAllFields(uint256 blockNumber, bytes32 stateRoot, bytes32 receiptsRoot) public {
        _submit(owner, blockNumber, stateRoot, receiptsRoot);

        VibeCheckpointRegistry.Checkpoint memory cp = registry.getCheckpoint(1);
        assertEq(cp.blockNumber, blockNumber);
        assertEq(cp.stateRoot, stateRoot);
        assertEq(cp.receiptsRoot, receiptsRoot);
    }

    function testFuzz_submit_countAccumulates(uint8 n) public {
        vm.assume(n > 0 && n < 50);

        for (uint256 i = 0; i < n; i++) {
            _submit(owner, i, keccak256(abi.encode(i)), keccak256(abi.encode(i)));
        }

        assertEq(registry.checkpointCount(), n);
    }

    function testFuzz_submitter_submit(address submitter) public {
        vm.assume(submitter != address(0));
        vm.assume(submitter != owner);

        registry.addSubmitter(submitter);

        vm.prank(submitter);
        registry.submit(100, keccak256("s"), keccak256("r"));

        assertEq(registry.checkpointCount(), 1);
        assertEq(registry.getCheckpoint(1).submitter, submitter);
    }

    // ============ UUPS Upgrade ============

    function test_authorizeUpgrade_revert_nonOwner() public {
        vm.prank(alice);
        vm.expectRevert();
        registry.upgradeToAndCall(address(0xdead), "");
    }

    function test_authorizeUpgrade_revert_notContract() public {
        vm.expectRevert("Not a contract");
        registry.upgradeToAndCall(makeAddr("eoa"), "");
    }

    // ============ Receive ETH ============

    function test_receiveETH() public {
        (bool ok,) = address(registry).call{value: 1 ether}("");
        assertTrue(ok);
        assertEq(address(registry).balance, 1 ether);
    }
}
