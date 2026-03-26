// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "forge-std/Test.sol";
import "../../contracts/settlement/VibeStateChain.sol";
import "@openzeppelin/contracts/proxy/ERC1967/ERC1967Proxy.sol";

contract VibeStateChainTest is Test {
    VibeStateChain public chain;

    address public owner;
    address public alice;
    address public bob;
    address public carol;

    event BlockProposed(uint256 indexed blockNumber, address indexed proposer, bytes32 blockHash, bytes32 stateRoot);
    event BlockFinalized(uint256 indexed blockNumber, bytes32 blockHash, uint256 subblockCount);
    event SubblockProposed(uint256 indexed subblockId, uint256 indexed parentBlock, address indexed proposer, bytes32 stateRoot);
    event SubblockConfirmed(uint256 indexed subblockId, address confirmer);
    event CellCreated(uint256 indexed cellId, bytes32 typeHash, address indexed owner, uint256 capacity);
    event CellConsumed(uint256 indexed cellId, uint256 indexed inBlock);
    event ValidatorRegistered(address indexed validator, uint256 stake);
    event ValidatorSlashed(address indexed validator, uint256 amount, string reason);
    event ConsensusCheckpointed(uint256 indexed checkpointId, bytes32 indexed source, uint256 roundId, uint256 inBlock);
    event ChainGenesis(bytes32 genesisHash, uint256 timestamp);

    function setUp() public {
        owner = address(this);
        alice = makeAddr("alice");
        bob = makeAddr("bob");
        carol = makeAddr("carol");

        // Deploy with UUPS proxy
        VibeStateChain impl = new VibeStateChain();
        bytes memory initData = abi.encodeWithSelector(VibeStateChain.initialize.selector);
        ERC1967Proxy proxy = new ERC1967Proxy(address(impl), initData);
        chain = VibeStateChain(payable(address(proxy)));

        // Fund test actors
        vm.deal(alice, 100 ether);
        vm.deal(bob, 100 ether);
        vm.deal(carol, 100 ether);
    }

    // ============ Helpers ============

    function _registerValidator(address who) internal {
        vm.prank(who);
        chain.registerValidator{value: chain.MIN_STAKE()}();
    }

    function _proposeAndFinalizeBlock(address proposer, bytes32 stateRoot) internal {
        vm.prank(proposer);
        chain.proposeBlock(stateRoot, bytes32(0));

        uint256 newHeight = chain.chainHeight() + 1;
        vm.prank(proposer);
        chain.finalizeBlock(newHeight);
    }

    function _createCell(address who, bytes32 typeHash, bytes32 lockHash, bytes32 dataHash, uint256 value)
        internal
        returns (uint256)
    {
        vm.prank(who);
        return chain.createCell{value: value}(typeHash, lockHash, dataHash);
    }

    // ============ Initialization ============

    function test_initialize_setsOwner() public view {
        assertEq(chain.owner(), owner);
    }

    function test_initialize_genesisBlock() public view {
        VibeStateChain.Block memory genesis = chain.getBlock(0);
        assertEq(genesis.blockNumber, 0);
        assertTrue(genesis.finalized);
        assertEq(genesis.prevHash, bytes32(0));
        assertEq(genesis.difficulty, chain.INITIAL_DIFFICULTY());
    }

    function test_initialize_chainHeightZero() public view {
        assertEq(chain.getChainHeight(), 0);
    }

    function test_initialize_latestHashSet() public view {
        assertNotEq(chain.getLatestHash(), bytes32(0));
    }

    function test_initialize_cannotReinitialize() public {
        vm.expectRevert();
        chain.initialize();
    }

    // ============ Validator Registration ============

    function test_registerValidator_succeeds() public {
        vm.expectEmit(true, false, false, true);
        emit ValidatorRegistered(alice, chain.MIN_STAKE());

        _registerValidator(alice);

        VibeStateChain.Validator memory v = chain.getValidator(alice);
        assertTrue(v.active);
        assertEq(v.stake, chain.MIN_STAKE());
        assertEq(v.mindScore, 0);
        assertEq(v.blocksProposed, 0);
    }

    function test_registerValidator_updatesTotalStake() public {
        _registerValidator(alice);
        assertEq(chain.totalStake(), chain.MIN_STAKE());

        _registerValidator(bob);
        assertEq(chain.totalStake(), chain.MIN_STAKE() * 2);
    }

    function test_registerValidator_addsToValidatorSet() public {
        _registerValidator(alice);
        assertEq(chain.getValidatorCount(), 1);
        assertEq(chain.validatorSet(0), alice);
    }

    function test_registerValidator_revert_insufficientStake() public {
        vm.prank(alice);
        vm.expectRevert("Insufficient stake");
        chain.registerValidator{value: chain.MIN_STAKE() - 1}();
    }

    function test_registerValidator_revert_alreadyRegistered() public {
        _registerValidator(alice);

        vm.prank(alice);
        vm.expectRevert("Already registered");
        chain.registerValidator{value: chain.MIN_STAKE()}();
    }

    function test_addStake_succeeds() public {
        _registerValidator(alice);
        uint256 extra = 0.5 ether;

        vm.prank(alice);
        chain.addStake{value: extra}();

        VibeStateChain.Validator memory v = chain.getValidator(alice);
        assertEq(v.stake, chain.MIN_STAKE() + extra);
        assertEq(chain.totalStake(), chain.MIN_STAKE() + extra);
    }

    function test_addStake_revert_notValidator() public {
        vm.prank(alice);
        vm.expectRevert("Not validator");
        chain.addStake{value: 1 ether}();
    }

    function test_updateMindScore_onlyOwner() public {
        _registerValidator(alice);
        chain.updateMindScore(alice, 9000);
        assertEq(chain.getValidator(alice).mindScore, 9000);
    }

    function test_updateMindScore_revert_nonOwner() public {
        _registerValidator(alice);
        vm.prank(bob);
        vm.expectRevert();
        chain.updateMindScore(alice, 9000);
    }

    function test_updateMindScore_revert_notActive() public {
        vm.expectRevert("Not active");
        chain.updateMindScore(alice, 9000);
    }

    // ============ Block Proposal ============

    function test_proposeBlock_succeeds() public {
        _registerValidator(alice);
        bytes32 stateRoot = keccak256("state1");

        vm.prank(alice);
        vm.expectEmit(true, true, false, false);
        emit BlockProposed(1, alice, bytes32(0), stateRoot);
        chain.proposeBlock(stateRoot, bytes32(0));

        VibeStateChain.Block memory b = chain.getBlock(1);
        assertEq(b.blockNumber, 1);
        assertEq(b.stateRoot, stateRoot);
        assertEq(b.proposer, alice);
        assertFalse(b.finalized);
        assertEq(b.prevHash, chain.getLatestHash());
    }

    function test_proposeBlock_revert_notValidator() public {
        vm.prank(alice);
        vm.expectRevert("Not validator");
        chain.proposeBlock(keccak256("state"), bytes32(0));
    }

    function test_proposeBlock_revert_equivocation() public {
        _registerValidator(alice);
        vm.prank(alice);
        chain.proposeBlock(keccak256("state1"), bytes32(0));

        vm.prank(alice);
        vm.expectRevert("Already proposed for this height");
        chain.proposeBlock(keccak256("state2"), bytes32(0));
    }

    function test_proposeBlock_headerChainLinkage() public {
        _registerValidator(alice);
        bytes32 hash0 = chain.getLatestHash();

        vm.prank(alice);
        chain.proposeBlock(keccak256("state1"), bytes32(0));

        VibeStateChain.Block memory b = chain.getBlock(1);
        assertEq(b.prevHash, hash0);
    }

    // ============ Block Finalization ============

    function test_finalizeBlock_succeeds() public {
        _registerValidator(alice);
        vm.prank(alice);
        chain.proposeBlock(keccak256("state1"), bytes32(0));

        vm.expectEmit(true, false, false, false);
        emit BlockFinalized(1, bytes32(0), 0);

        vm.prank(alice);
        chain.finalizeBlock(1);

        VibeStateChain.Block memory b = chain.getBlock(1);
        assertTrue(b.finalized);
        assertEq(chain.getChainHeight(), 1);
        assertEq(chain.getLatestHash(), b.blockHash);
        assertEq(chain.getLatestStateRoot(), b.stateRoot);
    }

    function test_finalizeBlock_resetsSubIndex() public {
        _registerValidator(alice);
        _registerValidator(bob);

        // Propose a subblock to increment currentSubIndex
        vm.prank(alice);
        chain.proposeSubblock(keccak256("substate"), keccak256("txroot"), new uint256[](0), new uint256[](0));
        assertEq(chain.currentSubIndex(), 1);

        vm.prank(alice);
        chain.proposeBlock(keccak256("state1"), bytes32(0));
        vm.prank(alice);
        chain.finalizeBlock(1);

        assertEq(chain.currentSubIndex(), 0);
    }

    function test_finalizeBlock_incrementsProposerStats() public {
        _registerValidator(alice);
        vm.prank(alice);
        chain.proposeBlock(keccak256("state1"), bytes32(0));
        vm.prank(alice);
        chain.finalizeBlock(1);

        assertEq(chain.getValidator(alice).blocksProposed, 1);
    }

    function test_finalizeBlock_revert_notProposed() public {
        vm.expectRevert("Block not proposed");
        chain.finalizeBlock(99);
    }

    function test_finalizeBlock_revert_alreadyFinalized() public {
        _registerValidator(alice);
        vm.prank(alice);
        chain.proposeBlock(keccak256("state1"), bytes32(0));
        vm.prank(alice);
        chain.finalizeBlock(1);

        vm.expectRevert("Already finalized");
        chain.finalizeBlock(1);
    }

    function test_finalizeBlock_ownerCanFinalize() public {
        _registerValidator(alice);
        vm.prank(alice);
        chain.proposeBlock(keccak256("state1"), bytes32(0));

        // Owner (address(this)) is not a validator but can finalize
        chain.finalizeBlock(1);
        assertTrue(chain.getBlock(1).finalized);
    }

    function test_finalizeBlock_revert_unauthorizedNonValidator() public {
        _registerValidator(alice);
        vm.prank(alice);
        chain.proposeBlock(keccak256("state1"), bytes32(0));

        vm.prank(carol);
        vm.expectRevert("Not authorized");
        chain.finalizeBlock(1);
    }

    // ============ Subblock Proposal ============

    function test_proposeSubblock_succeeds() public {
        _registerValidator(alice);
        bytes32 stateRoot = keccak256("substate");
        bytes32 txRoot = keccak256("txroot");

        vm.expectEmit(true, true, true, false);
        emit SubblockProposed(1, 0, alice, stateRoot);

        vm.prank(alice);
        chain.proposeSubblock(stateRoot, txRoot, new uint256[](0), new uint256[](0));

        VibeStateChain.Subblock memory sb = chain.getSubblock(1);
        assertEq(sb.subblockId, 1);
        assertEq(sb.proposer, alice);
        assertEq(sb.stateRoot, stateRoot);
        assertEq(sb.txRoot, txRoot);
        assertEq(sb.parentBlockNumber, 0);
        assertEq(sb.subIndex, 0);
        assertFalse(sb.confirmed);
    }

    function test_proposeSubblock_incrementsSubIndex() public {
        _registerValidator(alice);

        vm.prank(alice);
        chain.proposeSubblock(keccak256("s1"), keccak256("t1"), new uint256[](0), new uint256[](0));
        assertEq(chain.currentSubIndex(), 1);

        vm.prank(alice);
        chain.proposeSubblock(keccak256("s2"), keccak256("t2"), new uint256[](0), new uint256[](0));
        assertEq(chain.currentSubIndex(), 2);
    }

    function test_proposeSubblock_updatesLatestStateRoot() public {
        _registerValidator(alice);
        bytes32 sr = keccak256("substate-root");

        vm.prank(alice);
        chain.proposeSubblock(sr, keccak256("tx"), new uint256[](0), new uint256[](0));

        assertEq(chain.getLatestStateRoot(), sr);
    }

    function test_proposeSubblock_revert_notValidator() public {
        vm.prank(alice);
        vm.expectRevert("Not validator");
        chain.proposeSubblock(keccak256("s"), keccak256("t"), new uint256[](0), new uint256[](0));
    }

    function test_proposeSubblock_revert_maxReached() public {
        _registerValidator(alice);

        for (uint256 i = 0; i < chain.MAX_SUBBLOCKS(); i++) {
            vm.prank(alice);
            chain.proposeSubblock(keccak256(abi.encode(i)), keccak256(abi.encode(i)), new uint256[](0), new uint256[](0));
        }

        vm.prank(alice);
        vm.expectRevert("Max subblocks reached");
        chain.proposeSubblock(keccak256("extra"), keccak256("extra"), new uint256[](0), new uint256[](0));
    }

    // ============ Subblock Confirmation ============

    function test_confirmSubblock_succeeds() public {
        _registerValidator(alice);
        _registerValidator(bob);

        vm.prank(alice);
        chain.proposeSubblock(keccak256("s"), keccak256("t"), new uint256[](0), new uint256[](0));

        vm.expectEmit(true, false, false, true);
        emit SubblockConfirmed(1, bob);

        vm.prank(bob);
        chain.confirmSubblock(1);

        assertTrue(chain.getSubblock(1).confirmed);
    }

    function test_confirmSubblock_revert_alreadyConfirmed() public {
        _registerValidator(alice);
        _registerValidator(bob);

        vm.prank(alice);
        chain.proposeSubblock(keccak256("s"), keccak256("t"), new uint256[](0), new uint256[](0));
        vm.prank(bob);
        chain.confirmSubblock(1);

        vm.prank(bob);
        vm.expectRevert("Already confirmed");
        chain.confirmSubblock(1);
    }

    function test_confirmSubblock_revert_selfConfirm() public {
        _registerValidator(alice);

        vm.prank(alice);
        chain.proposeSubblock(keccak256("s"), keccak256("t"), new uint256[](0), new uint256[](0));

        vm.prank(alice);
        vm.expectRevert("Cannot self-confirm");
        chain.confirmSubblock(1);
    }

    function test_confirmSubblock_revert_notValidator() public {
        _registerValidator(alice);

        vm.prank(alice);
        chain.proposeSubblock(keccak256("s"), keccak256("t"), new uint256[](0), new uint256[](0));

        vm.prank(carol);
        vm.expectRevert("Not validator");
        chain.confirmSubblock(1);
    }

    // ============ State Cell Management ============

    function test_createCell_succeeds() public {
        bytes32 typeHash = keccak256("type1");
        bytes32 lockHash = keccak256("lock1");
        bytes32 dataHash = keccak256("data1");

        vm.expectEmit(true, false, true, true);
        emit CellCreated(1, typeHash, alice, 1 ether);

        uint256 cellId = _createCell(alice, typeHash, lockHash, dataHash, 1 ether);

        assertEq(cellId, 1);
        assertEq(chain.cellCount(), 1);
        assertEq(chain.getLiveCellCount(), 1);

        VibeStateChain.StateCell memory cell = chain.getCell(1);
        assertEq(cell.cellId, 1);
        assertEq(cell.typeHash, typeHash);
        assertEq(cell.lockHash, lockHash);
        assertEq(cell.dataHash, dataHash);
        assertEq(cell.owner, alice);
        assertEq(cell.capacity, 1 ether);
        assertTrue(cell.live);
        assertEq(cell.consumedInBlock, 0);
    }

    function test_createCell_indexesByType() public {
        bytes32 typeHash = keccak256("mytype");

        _createCell(alice, typeHash, keccak256("lock1"), keccak256("data1"), 0);
        _createCell(bob, typeHash, keccak256("lock2"), keccak256("data2"), 0);

        uint256[] memory cellsOfType = chain.getCellsByType(typeHash);
        assertEq(cellsOfType.length, 2);
        assertEq(cellsOfType[0], 1);
        assertEq(cellsOfType[1], 2);
    }

    function test_createCell_indexesByOwner() public {
        _createCell(alice, keccak256("t"), keccak256("l"), keccak256("d1"), 0);
        _createCell(alice, keccak256("t"), keccak256("l"), keccak256("d2"), 0);

        uint256[] memory aliceCells = chain.getCellsByOwner(alice);
        assertEq(aliceCells.length, 2);
    }

    function test_consumeCell_succeeds() public {
        uint256 cellId = _createCell(alice, keccak256("t"), keccak256("l"), keccak256("d"), 1 ether);

        uint256 balBefore = alice.balance;

        vm.expectEmit(true, true, false, false);
        emit CellConsumed(cellId, 0);

        vm.prank(alice);
        chain.consumeCell(cellId);

        VibeStateChain.StateCell memory cell = chain.getCell(cellId);
        assertFalse(cell.live);
        assertEq(cell.consumedInBlock, 0);
        assertEq(chain.getLiveCellCount(), 0);

        // Capacity returned to owner
        assertEq(alice.balance, balBefore + 1 ether);
    }

    function test_consumeCell_revert_notOwner() public {
        uint256 cellId = _createCell(alice, keccak256("t"), keccak256("l"), keccak256("d"), 0);

        vm.prank(bob);
        vm.expectRevert("Not owner");
        chain.consumeCell(cellId);
    }

    function test_consumeCell_revert_notLive() public {
        uint256 cellId = _createCell(alice, keccak256("t"), keccak256("l"), keccak256("d"), 0);

        vm.prank(alice);
        chain.consumeCell(cellId);

        vm.prank(alice);
        vm.expectRevert("Cell not live");
        chain.consumeCell(cellId);
    }

    function test_transformCell_succeeds() public {
        bytes32 typeHash = keccak256("type1");
        uint256 inputId = _createCell(alice, typeHash, keccak256("lock"), keccak256("data1"), 1 ether);

        bytes32 newDataHash = keccak256("data2");
        vm.prank(alice);
        uint256 outputId = chain.transformCell{value: 0.5 ether}(inputId, newDataHash, bob);

        // Input consumed
        assertFalse(chain.getCell(inputId).live);

        // Output created
        VibeStateChain.StateCell memory output = chain.getCell(outputId);
        assertTrue(output.live);
        assertEq(output.typeHash, typeHash); // Same type script
        assertEq(output.dataHash, newDataHash);
        assertEq(output.owner, bob);
        assertEq(output.capacity, 1.5 ether); // input.capacity + msg.value
    }

    function test_transformCell_selfTransfer() public {
        uint256 inputId = _createCell(alice, keccak256("t"), keccak256("l"), keccak256("d"), 1 ether);

        vm.prank(alice);
        uint256 outputId = chain.transformCell(inputId, keccak256("new"), address(0)); // address(0) → self

        assertEq(chain.getCell(outputId).owner, alice);
    }

    function test_transformCell_revert_notOwner() public {
        uint256 inputId = _createCell(alice, keccak256("t"), keccak256("l"), keccak256("d"), 1 ether);

        vm.prank(bob);
        vm.expectRevert("Not owner");
        chain.transformCell(inputId, keccak256("new"), bob);
    }

    function test_transformCell_revert_notLive() public {
        uint256 inputId = _createCell(alice, keccak256("t"), keccak256("l"), keccak256("d"), 1 ether);

        vm.prank(alice);
        chain.consumeCell(inputId);

        vm.prank(alice);
        vm.expectRevert("Input not live");
        chain.transformCell(inputId, keccak256("new"), address(0));
    }

    function test_subblock_consumesCells() public {
        _registerValidator(alice);

        // Create a cell
        uint256 cellId = _createCell(alice, keccak256("t"), keccak256("l"), keccak256("d"), 0);
        assertEq(chain.getLiveCellCount(), 1);

        // Propose subblock that consumes it
        uint256[] memory consumed = new uint256[](1);
        consumed[0] = cellId;

        vm.prank(alice);
        chain.proposeSubblock(keccak256("s"), keccak256("t"), new uint256[](0), consumed);

        // Cell should be consumed
        assertFalse(chain.getCell(cellId).live);
        assertEq(chain.getLiveCellCount(), 0);
    }

    // ============ Consensus Checkpointing ============

    function test_checkpoint_succeeds() public {
        _registerValidator(alice);

        bytes32 source = keccak256("AgentConsensus");
        bytes32 decisionHash = keccak256("decision1");
        uint256 roundId = 42;

        vm.expectEmit(true, true, false, true);
        emit ConsensusCheckpointed(1, source, roundId, 0);

        vm.prank(alice);
        chain.checkpoint(source, decisionHash, roundId);

        assertEq(chain.checkpointCount(), 1);

        VibeStateChain.ConsensusCheckpoint memory cp = chain.getCheckpoint(1);
        assertEq(cp.source, source);
        assertEq(cp.decisionHash, decisionHash);
        assertEq(cp.roundId, roundId);
        assertEq(cp.recordedInBlock, 0);
    }

    function test_checkpoint_ownerCanCheckpoint() public {
        // Owner (not validator) can also checkpoint
        chain.checkpoint(keccak256("src"), keccak256("dec"), 1);
        assertEq(chain.checkpointCount(), 1);
    }

    function test_checkpoint_indexedByBlock() public {
        _registerValidator(alice);

        vm.prank(alice);
        chain.checkpoint(keccak256("s1"), keccak256("d1"), 1);
        vm.prank(alice);
        chain.checkpoint(keccak256("s2"), keccak256("d2"), 2);

        uint256[] memory blockCps = chain.getBlockCheckpoints(0);
        assertEq(blockCps.length, 2);
        assertEq(blockCps[0], 1);
        assertEq(blockCps[1], 2);
    }

    function test_checkpoint_revert_unauthorized() public {
        vm.prank(alice); // Not a validator or owner
        vm.expectRevert("Not authorized");
        chain.checkpoint(keccak256("s"), keccak256("d"), 1);
    }

    // ============ Equivocation / Slashing ============

    function test_reportEquivocation_slashesValidator() public {
        _registerValidator(alice);

        uint256 stake = chain.getValidator(alice).stake;
        uint256 expectedSlash = (stake * chain.EQUIVOCATION_SLASH()) / 10000;

        uint256 reporterBalBefore = address(this).balance;

        vm.expectEmit(true, false, false, true);
        emit ValidatorSlashed(alice, expectedSlash, "equivocation");

        chain.reportEquivocation(alice);

        VibeStateChain.Validator memory v = chain.getValidator(alice);
        assertEq(v.stake, stake - expectedSlash);
        assertEq(v.slashCount, 1);
        assertEq(chain.totalStake(), stake - expectedSlash);

        // Reporter receives slash reward
        assertEq(address(this).balance, reporterBalBefore + expectedSlash);
    }

    function test_reportEquivocation_revert_notActive() public {
        vm.expectRevert("Not active");
        chain.reportEquivocation(carol);
    }

    // ============ Multi-Block Chain ============

    function test_multiBlock_headerChain() public {
        _registerValidator(alice);

        bytes32 h0 = chain.getLatestHash();

        vm.prank(alice);
        chain.proposeBlock(keccak256("state1"), bytes32(0));
        vm.prank(alice);
        chain.finalizeBlock(1);

        bytes32 h1 = chain.getLatestHash();
        assertNotEq(h0, h1);

        vm.prank(alice);
        chain.proposeBlock(keccak256("state2"), bytes32(0));
        vm.prank(alice);
        chain.finalizeBlock(2);

        bytes32 h2 = chain.getLatestHash();
        assertNotEq(h1, h2);

        // Block 2 links to block 1
        assertEq(chain.getBlock(2).prevHash, h1);
        assertEq(chain.chainHeight(), 2);
    }

    function test_multiBlock_differentProposers() public {
        _registerValidator(alice);
        _registerValidator(bob);

        vm.prank(alice);
        chain.proposeBlock(keccak256("state1"), bytes32(0));
        vm.prank(alice);
        chain.finalizeBlock(1);

        vm.prank(bob);
        chain.proposeBlock(keccak256("state2"), bytes32(0));
        vm.prank(bob);
        chain.finalizeBlock(2);

        assertEq(chain.getValidator(alice).blocksProposed, 1);
        assertEq(chain.getValidator(bob).blocksProposed, 1);
    }

    // ============ View Functions ============

    function test_getBlock_defaultValues() public view {
        VibeStateChain.Block memory b = chain.getBlock(999);
        assertEq(b.blockNumber, 0);
        assertFalse(b.finalized);
    }

    function test_getSubblock_defaultValues() public view {
        VibeStateChain.Subblock memory sb = chain.getSubblock(999);
        assertEq(sb.subblockId, 0);
        assertEq(sb.proposer, address(0));
    }

    function test_getCell_defaultValues() public view {
        VibeStateChain.StateCell memory c = chain.getCell(999);
        assertEq(c.cellId, 0);
        assertFalse(c.live);
    }

    function test_getValidator_defaultValues() public view {
        VibeStateChain.Validator memory v = chain.getValidator(carol);
        assertFalse(v.active);
        assertEq(v.stake, 0);
    }

    function test_constants() public view {
        assertEq(chain.BLOCK_TIME(), 12);
        assertEq(chain.MAX_SUBBLOCKS(), 6);
        assertEq(chain.SUBBLOCK_TIME(), 2);
        assertEq(chain.EQUIVOCATION_SLASH(), 5000);
        assertEq(chain.INITIAL_DIFFICULTY(), 1000);
    }

    // ============ Fuzz Tests ============

    function testFuzz_createCell_capacityTracked(uint256 value) public {
        vm.assume(value <= 10 ether);
        vm.deal(alice, value);

        vm.prank(alice);
        uint256 cellId = chain.createCell{value: value}(keccak256("t"), keccak256("l"), keccak256("d"));

        assertEq(chain.getCell(cellId).capacity, value);
        assertEq(chain.getLiveCellCount(), 1);
    }

    function testFuzz_multipleValidators_stakeAccumulates(uint8 n) public {
        vm.assume(n > 0 && n < 10);

        for (uint256 i = 0; i < n; i++) {
            address v = makeAddr(string(abi.encode(i)));
            vm.deal(v, 1 ether);
            vm.prank(v);
            chain.registerValidator{value: chain.MIN_STAKE()}();
        }

        assertEq(chain.totalStake(), uint256(n) * chain.MIN_STAKE());
        assertEq(chain.getValidatorCount(), n);
    }

    // ============ UUPS Upgrade ============

    function test_authorizeUpgrade_revert_nonOwner() public {
        vm.prank(alice);
        vm.expectRevert();
        chain.upgradeToAndCall(address(0xdead), "");
    }

    function test_authorizeUpgrade_revert_notContract() public {
        vm.expectRevert("Not a contract");
        chain.upgradeToAndCall(makeAddr("eoa"), "");
    }

    // receive ETH for slash rewards
    receive() external payable {}
}
