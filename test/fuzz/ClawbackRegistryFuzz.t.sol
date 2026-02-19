// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "forge-std/Test.sol";
import "../../contracts/compliance/ClawbackRegistry.sol";
import "@openzeppelin/contracts/proxy/ERC1967/ERC1967Proxy.sol";
import "@openzeppelin/contracts/token/ERC20/ERC20.sol";

// ============ Mock FederatedConsensus ============

contract MockConsensusFuzz {
    mapping(address => bool) public activeAuthorities;
    mapping(bytes32 => bool) public executableProposals;
    uint256 proposalCount;

    function setActiveAuthority(address addr, bool active) external {
        activeAuthorities[addr] = active;
    }

    function isActiveAuthority(address addr) external view returns (bool) {
        return activeAuthorities[addr];
    }

    function createProposal(bytes32, address, uint256, address, string calldata)
        external returns (bytes32) {
        proposalCount++;
        return keccak256(abi.encodePacked(proposalCount));
    }

    function setExecutable(bytes32 proposalId, bool executable) external {
        executableProposals[proposalId] = executable;
    }

    function isExecutable(bytes32 proposalId) external view returns (bool) {
        return executableProposals[proposalId];
    }

    function markExecuted(bytes32) external {}
}

// ============ Mock Token ============

contract MockERC20Fuzz is ERC20 {
    constructor() ERC20("Mock", "MCK") {}
    function mint(address to, uint256 amount) external { _mint(to, amount); }
}

// ============ Fuzz Tests ============

contract ClawbackRegistryFuzzTest is Test {
    ClawbackRegistry registry;
    MockConsensusFuzz consensus;
    MockERC20Fuzz token;

    address owner = makeAddr("owner");
    address authority = makeAddr("authority");
    address tracker = makeAddr("tracker");

    function setUp() public {
        consensus = new MockConsensusFuzz();
        token = new MockERC20Fuzz();

        ClawbackRegistry impl = new ClawbackRegistry();
        bytes memory initData = abi.encodeWithSelector(
            ClawbackRegistry.initialize.selector,
            owner,
            address(consensus),
            5,
            1 ether
        );
        ERC1967Proxy proxy = new ERC1967Proxy(address(impl), initData);
        registry = ClawbackRegistry(address(proxy));

        consensus.setActiveAuthority(authority, true);

        vm.prank(owner);
        registry.setAuthorizedTracker(tracker, true);

        vm.prank(owner);
        registry.setVault(makeAddr("vault"));
    }

    // ============ Fuzz: openCase always produces unique caseIds ============
    function testFuzz_openCase_uniqueIds(address wallet1, address wallet2) public {
        vm.assume(wallet1 != address(0) && wallet2 != address(0));
        vm.assume(wallet1 != wallet2);

        vm.prank(owner);
        bytes32 id1 = registry.openCase(wallet1, 100 ether, address(token), "case1");

        vm.warp(block.timestamp + 1);
        vm.prank(owner);
        bytes32 id2 = registry.openCase(wallet2, 100 ether, address(token), "case2");

        assertNotEq(id1, id2, "Case IDs should be unique");
        assertNotEq(id1, bytes32(0), "Case ID should not be zero");
    }

    // ============ Fuzz: flagged wallet is always blocked ============
    function testFuzz_flaggedWallet_isBlocked(address wallet) public {
        vm.assume(wallet != address(0));

        // Before flagging
        assertFalse(registry.isBlocked(wallet));

        vm.prank(owner);
        registry.openCase(wallet, 100 ether, address(token), "test");

        // After flagging
        assertTrue(registry.isBlocked(wallet), "Flagged wallet should be blocked");
    }

    // ============ Fuzz: taint depth never exceeds maxCascadeDepth ============
    function testFuzz_taintDepth_bounded(uint256 depth) public {
        depth = bound(depth, 1, 20);

        vm.prank(owner);
        registry.setMaxCascadeDepth(depth);

        vm.prank(owner);
        registry.openCase(makeAddr("bad"), 100 ether, address(token), "theft");

        address prev = makeAddr("bad");
        for (uint256 i = 1; i <= depth + 1; i++) {
            address next = address(uint160(0x1000 + i));
            vm.prank(tracker);
            if (i > depth) {
                vm.expectRevert(ClawbackRegistry.MaxCascadeDepthReached.selector);
            }
            registry.recordTransaction(prev, next, 10 ether, address(token));
            prev = next;
        }
    }

    // ============ Fuzz: amounts below minTaintAmount don't propagate ============
    function testFuzz_belowMinAmount_noPropagate(uint256 amount, uint256 minAmount) public {
        minAmount = bound(minAmount, 1, 100 ether);
        amount = bound(amount, 0, minAmount - 1);

        vm.prank(owner);
        registry.setMinTaintAmount(minAmount);

        address badActor = makeAddr("bad");
        address recipient = makeAddr("recv");

        vm.prank(owner);
        registry.openCase(badActor, 100 ether, address(token), "theft");

        vm.prank(tracker);
        registry.recordTransaction(badActor, recipient, amount, address(token));

        // Recipient should remain clean
        (ClawbackRegistry.TaintLevel level,,,) = registry.checkWallet(recipient);
        assertEq(uint256(level), 0, "Below min amount should not propagate taint");
    }

    // ============ Fuzz: amounts at or above minTaintAmount DO propagate ============
    function testFuzz_aboveMinAmount_propagates(uint256 amount, uint256 minAmount) public {
        minAmount = bound(minAmount, 1, 100 ether);
        amount = bound(amount, minAmount, 1000 ether);

        vm.prank(owner);
        registry.setMinTaintAmount(minAmount);

        address badActor = makeAddr("bad");
        address recipient = makeAddr("recv");

        vm.prank(owner);
        registry.openCase(badActor, 100 ether, address(token), "theft");

        vm.prank(tracker);
        registry.recordTransaction(badActor, recipient, amount, address(token));

        // Recipient should be tainted
        (ClawbackRegistry.TaintLevel level,,,) = registry.checkWallet(recipient);
        assertEq(uint256(level), uint256(ClawbackRegistry.TaintLevel.TAINTED), "Above min amount should propagate");
    }

    // ============ Fuzz: dismissCase clears all wallets in cascade ============
    function testFuzz_dismissCase_clearsAll(uint8 cascadeLen) public {
        cascadeLen = uint8(bound(cascadeLen, 1, 5));

        vm.prank(owner);
        registry.setMaxCascadeDepth(10);

        address badActor = makeAddr("bad");
        vm.prank(owner);
        bytes32 caseId = registry.openCase(badActor, 100 ether, address(token), "theft");

        address prev = badActor;
        address[] memory chain = new address[](cascadeLen);
        for (uint8 i = 0; i < cascadeLen; i++) {
            chain[i] = address(uint160(0x2000 + i));
            vm.prank(tracker);
            registry.recordTransaction(prev, chain[i], 10 ether, address(token));
            prev = chain[i];
        }

        // Dismiss
        vm.prank(owner);
        registry.dismissCase(caseId);

        // All should be clean
        (ClawbackRegistry.TaintLevel bl,,,) = registry.checkWallet(badActor);
        assertEq(uint256(bl), 0, "Origin should be clean after dismiss");
        for (uint8 i = 0; i < cascadeLen; i++) {
            (ClawbackRegistry.TaintLevel tl,,,) = registry.checkWallet(chain[i]);
            assertEq(uint256(tl), 0, "Cascade wallet should be clean after dismiss");
        }
    }

    // ============ Fuzz: taint level only escalates, never downgrades via propagation ============
    function testFuzz_taintLevel_onlyEscalates(uint256 amount1, uint256 amount2) public {
        amount1 = bound(amount1, 1 ether, 100 ether);
        amount2 = bound(amount2, 1 ether, 100 ether);

        address badActor = makeAddr("bad");
        address recipient = makeAddr("recv");

        vm.prank(owner);
        registry.openCase(badActor, 100 ether, address(token), "theft");

        // First propagation
        vm.prank(tracker);
        registry.recordTransaction(badActor, recipient, amount1, address(token));

        (ClawbackRegistry.TaintLevel level1,,,) = registry.checkWallet(recipient);

        // Second propagation to same wallet
        vm.prank(tracker);
        registry.recordTransaction(badActor, recipient, amount2, address(token));

        (ClawbackRegistry.TaintLevel level2,,,) = registry.checkWallet(recipient);

        assertGe(uint256(level2), uint256(level1), "Taint level should not decrease via propagation");
    }

    // ============ Fuzz: checkTransactionSafety is symmetric for clean wallets ============
    function testFuzz_transactionSafety_cleanIsSymmetric(address a, address b) public view {
        vm.assume(a != address(0) && b != address(0));

        (bool safeAB,) = registry.checkTransactionSafety(a, b);
        (bool safeBA,) = registry.checkTransactionSafety(b, a);

        // If both are clean (no cases opened), both directions should be safe
        assertTrue(safeAB, "Clean->Clean should be safe");
        assertTrue(safeBA, "Clean->Clean should be safe (reverse)");
    }

    // ============ Fuzz: caseCount always increments ============
    function testFuzz_caseCount_alwaysIncrements(uint8 numCases) public {
        numCases = uint8(bound(numCases, 1, 10));

        for (uint8 i = 0; i < numCases; i++) {
            uint256 countBefore = registry.caseCount();
            vm.prank(owner);
            registry.openCase(
                address(uint160(0x3000 + i)),
                100 ether,
                address(token),
                "case"
            );
            assertEq(registry.caseCount(), countBefore + 1, "Case count should increment");
        }
    }

    // ============ Fuzz: unauthorized addresses cannot open cases ============
    function testFuzz_openCase_revertsUnauthorized(address caller) public {
        vm.assume(caller != owner);
        vm.assume(!consensus.activeAuthorities(caller));

        vm.expectRevert("Not authorized to open case");
        vm.prank(caller);
        registry.openCase(makeAddr("target"), 100 ether, address(token), "test");
    }

    // ============ Fuzz: unauthorized addresses cannot record transactions ============
    function testFuzz_recordTransaction_revertsUnauthorized(address caller) public {
        vm.assume(caller != owner);
        vm.assume(caller != tracker);
        vm.assume(!registry.authorizedTrackers(caller));

        vm.expectRevert(ClawbackRegistry.NotAuthorizedTracker.selector);
        vm.prank(caller);
        registry.recordTransaction(makeAddr("a"), makeAddr("b"), 10 ether, address(token));
    }
}
