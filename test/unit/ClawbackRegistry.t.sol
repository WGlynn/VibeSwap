// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "forge-std/Test.sol";
import "../../contracts/compliance/ClawbackRegistry.sol";
import "../../contracts/compliance/FederatedConsensus.sol";
import "@openzeppelin/contracts/proxy/ERC1967/ERC1967Proxy.sol";
import "@openzeppelin/contracts/token/ERC20/ERC20.sol";

// ============ Mock FederatedConsensus ============

contract MockConsensus {
    mapping(address => bool) public activeAuthorities;
    mapping(bytes32 => bool) public executableProposals;
    mapping(bytes32 => bool) public executedProposals;
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
        bytes32 pid = keccak256(abi.encodePacked(proposalCount));
        return pid;
    }

    function setExecutable(bytes32 proposalId, bool executable) external {
        executableProposals[proposalId] = executable;
    }

    function isExecutable(bytes32 proposalId) external view returns (bool) {
        return executableProposals[proposalId];
    }

    function markExecuted(bytes32 proposalId) external {
        executedProposals[proposalId] = true;
    }
}

// ============ Mock Token ============

contract MockERC20 is ERC20 {
    constructor() ERC20("Mock", "MCK") {}
    function mint(address to, uint256 amount) external { _mint(to, amount); }
}

// ============ Tests ============

contract ClawbackRegistryTest is Test {
    ClawbackRegistry registry;
    MockConsensus consensus;
    MockERC20 token;

    address owner = makeAddr("owner");
    address authority = makeAddr("authority");
    address tracker = makeAddr("tracker");
    address badActor = makeAddr("badActor");
    address recipient = makeAddr("recipient");
    address vault = makeAddr("vault");

    function setUp() public {
        consensus = new MockConsensus();
        token = new MockERC20();

        // Deploy as proxy (UUPS)
        ClawbackRegistry impl = new ClawbackRegistry();
        bytes memory initData = abi.encodeWithSelector(
            ClawbackRegistry.initialize.selector,
            owner,
            address(consensus),
            5,       // maxCascadeDepth
            1 ether  // minTaintAmount
        );
        ERC1967Proxy proxy = new ERC1967Proxy(address(impl), initData);
        registry = ClawbackRegistry(address(proxy));

        // Setup authority
        consensus.setActiveAuthority(authority, true);

        // Setup tracker
        vm.prank(owner);
        registry.setAuthorizedTracker(tracker, true);

        // Setup vault
        vm.prank(owner);
        registry.setVault(vault);

        // Fund actors
        token.mint(badActor, 1000 ether);
        token.mint(recipient, 1000 ether);
    }

    // ============ Initialization ============

    function test_init_setsState() public view {
        assertEq(registry.maxCascadeDepth(), 5);
        assertEq(registry.minTaintAmount(), 1 ether);
        assertEq(address(registry.consensus()), address(consensus));
    }

    // ============ Open Case ============

    function test_openCase_asOwner() public {
        vm.prank(owner);
        bytes32 caseId = registry.openCase(badActor, 100 ether, address(token), "theft");

        assertNotEq(caseId, bytes32(0));
        assertEq(registry.caseCount(), 1);

        // Bad actor should be flagged
        (ClawbackRegistry.TaintLevel level, bool safe,,) = registry.checkWallet(badActor);
        assertEq(uint256(level), uint256(ClawbackRegistry.TaintLevel.FLAGGED));
        assertFalse(safe);
    }

    function test_openCase_asAuthority() public {
        vm.prank(authority);
        bytes32 caseId = registry.openCase(badActor, 100 ether, address(token), "fraud");

        assertNotEq(caseId, bytes32(0));
    }

    function test_openCase_revertsUnauthorized() public {
        vm.expectRevert("Not authorized to open case");
        vm.prank(recipient);
        registry.openCase(badActor, 100 ether, address(token), "random");
    }

    // ============ Taint Propagation ============

    function test_recordTransaction_propagatesTaint() public {
        // Flag bad actor
        vm.prank(owner);
        registry.openCase(badActor, 100 ether, address(token), "theft");

        // Record transaction from bad actor to recipient
        vm.prank(tracker);
        registry.recordTransaction(badActor, recipient, 50 ether, address(token));

        // Recipient should now be tainted
        (ClawbackRegistry.TaintLevel level, bool safe,, uint256 depth) = registry.checkWallet(recipient);
        assertEq(uint256(level), uint256(ClawbackRegistry.TaintLevel.TAINTED));
        assertFalse(safe);
        assertEq(depth, 1);
    }

    function test_recordTransaction_belowMinAmount_noPropagate() public {
        vm.prank(owner);
        registry.openCase(badActor, 100 ether, address(token), "theft");

        // Amount below minTaintAmount (1 ether)
        vm.prank(tracker);
        registry.recordTransaction(badActor, recipient, 0.5 ether, address(token));

        // Recipient should still be clean
        (ClawbackRegistry.TaintLevel level,,,) = registry.checkWallet(recipient);
        assertEq(uint256(level), uint256(ClawbackRegistry.TaintLevel.CLEAN));
    }

    function test_recordTransaction_cascadeDepth() public {
        vm.prank(owner);
        registry.openCase(badActor, 100 ether, address(token), "theft");

        // Chain: badActor → a1 → a2 → a3
        address a1 = makeAddr("a1");
        address a2 = makeAddr("a2");
        address a3 = makeAddr("a3");

        vm.prank(tracker);
        registry.recordTransaction(badActor, a1, 10 ether, address(token));

        vm.prank(tracker);
        registry.recordTransaction(a1, a2, 5 ether, address(token));

        vm.prank(tracker);
        registry.recordTransaction(a2, a3, 3 ether, address(token));

        // Check depths
        (,,, uint256 d1) = registry.checkWallet(a1);
        (,,, uint256 d2) = registry.checkWallet(a2);
        (,,, uint256 d3) = registry.checkWallet(a3);
        assertEq(d1, 1);
        assertEq(d2, 2);
        assertEq(d3, 3);
    }

    function test_recordTransaction_revertsMaxCascadeDepth() public {
        vm.prank(owner);
        registry.setMaxCascadeDepth(2);

        vm.prank(owner);
        registry.openCase(badActor, 100 ether, address(token), "theft");

        address a1 = makeAddr("a1");
        address a2 = makeAddr("a2");
        address a3 = makeAddr("a3");

        vm.prank(tracker);
        registry.recordTransaction(badActor, a1, 10 ether, address(token)); // depth 1

        vm.prank(tracker);
        registry.recordTransaction(a1, a2, 5 ether, address(token)); // depth 2

        vm.expectRevert(ClawbackRegistry.MaxCascadeDepthReached.selector);
        vm.prank(tracker);
        registry.recordTransaction(a2, a3, 3 ether, address(token)); // depth 3 > max(2)
    }

    function test_recordTransaction_revertsNotTracker() public {
        vm.expectRevert(ClawbackRegistry.NotAuthorizedTracker.selector);
        vm.prank(recipient);
        registry.recordTransaction(badActor, recipient, 10 ether, address(token));
    }

    // ============ checkWallet ============

    function test_checkWallet_clean() public view {
        (ClawbackRegistry.TaintLevel level, bool safe, bytes32 cid, uint256 depth) =
            registry.checkWallet(recipient);
        assertEq(uint256(level), 0); // CLEAN
        assertTrue(safe);
        assertEq(cid, bytes32(0));
        assertEq(depth, 0);
    }

    // ============ checkTransactionSafety ============

    function test_checkTransactionSafety_bothClean() public {
        (bool safe, string memory risk) = registry.checkTransactionSafety(recipient, makeAddr("other"));
        assertTrue(safe);
        assertEq(risk, "CLEAN");
    }

    function test_checkTransactionSafety_flaggedBlocked() public {
        vm.prank(owner);
        registry.openCase(badActor, 100 ether, address(token), "theft");

        (bool safe,) = registry.checkTransactionSafety(badActor, recipient);
        assertFalse(safe);
    }

    function test_checkTransactionSafety_taintedBlocked() public {
        vm.prank(owner);
        registry.openCase(badActor, 100 ether, address(token), "theft");

        vm.prank(tracker);
        registry.recordTransaction(badActor, recipient, 10 ether, address(token));

        (bool safe,) = registry.checkTransactionSafety(makeAddr("clean"), recipient);
        assertFalse(safe); // recipient is tainted
    }

    // ============ isBlocked ============

    function test_isBlocked_clean() public view {
        assertFalse(registry.isBlocked(recipient));
    }

    function test_isBlocked_flagged() public {
        vm.prank(owner);
        registry.openCase(badActor, 100 ether, address(token), "theft");

        assertTrue(registry.isBlocked(badActor));
    }

    // ============ Dismiss Case ============

    function test_dismissCase_clearsWallets() public {
        vm.prank(owner);
        bytes32 caseId = registry.openCase(badActor, 100 ether, address(token), "theft");

        vm.prank(tracker);
        registry.recordTransaction(badActor, recipient, 10 ether, address(token));

        // Dismiss the case
        vm.prank(owner);
        registry.dismissCase(caseId);

        // Both should be cleared
        (ClawbackRegistry.TaintLevel bl,,,) = registry.checkWallet(badActor);
        (ClawbackRegistry.TaintLevel rl,,,) = registry.checkWallet(recipient);
        assertEq(uint256(bl), uint256(ClawbackRegistry.TaintLevel.CLEAN));
        assertEq(uint256(rl), uint256(ClawbackRegistry.TaintLevel.CLEAN));
    }

    function test_dismissCase_revertsUnauthorized() public {
        vm.prank(owner);
        bytes32 caseId = registry.openCase(badActor, 100 ether, address(token), "theft");

        vm.expectRevert("Not authorized");
        vm.prank(recipient);
        registry.dismissCase(caseId);
    }

    function test_dismissCase_revertsNotFound() public {
        vm.expectRevert(ClawbackRegistry.CaseNotFound.selector);
        vm.prank(owner);
        registry.dismissCase(keccak256("fake"));
    }

    // ============ Admin ============

    function test_setMaxCascadeDepth() public {
        vm.prank(owner);
        registry.setMaxCascadeDepth(10);
        assertEq(registry.maxCascadeDepth(), 10);
    }

    function test_setMinTaintAmount() public {
        vm.prank(owner);
        registry.setMinTaintAmount(5 ether);
        assertEq(registry.minTaintAmount(), 5 ether);
    }

    function test_setVault() public {
        address newVault = makeAddr("newVault");
        vm.prank(owner);
        registry.setVault(newVault);
        assertEq(registry.vault(), newVault);
    }

    function test_setAuthorizedTracker() public {
        address newTracker = makeAddr("newTracker");
        vm.prank(owner);
        registry.setAuthorizedTracker(newTracker, true);
        assertTrue(registry.authorizedTrackers(newTracker));
    }

    // ============ getTaintChain ============

    function test_getTaintChain() public {
        vm.prank(owner);
        registry.openCase(badActor, 100 ether, address(token), "theft");

        vm.prank(tracker);
        registry.recordTransaction(badActor, recipient, 50 ether, address(token));

        ClawbackRegistry.TaintRecord[] memory chain = registry.getTaintChain(recipient);
        assertEq(chain.length, 1);
        assertEq(chain[0].from, badActor);
        assertEq(chain[0].to, recipient);
        assertEq(chain[0].amount, 50 ether);
    }

    // ============ getCaseWallets ============

    function test_getCaseWallets() public {
        vm.prank(owner);
        bytes32 caseId = registry.openCase(badActor, 100 ether, address(token), "theft");

        vm.prank(tracker);
        registry.recordTransaction(badActor, recipient, 10 ether, address(token));

        address[] memory wallets = registry.getCaseWallets(caseId);
        assertEq(wallets.length, 2); // badActor + recipient
        assertEq(wallets[0], badActor);
        assertEq(wallets[1], recipient);
    }

    // ============ propagateTaintManual ============

    function test_propagateTaintManual_asAuthority() public {
        vm.prank(owner);
        registry.openCase(badActor, 100 ether, address(token), "theft");

        vm.prank(authority);
        registry.propagateTaintManual(badActor, recipient, 50 ether, address(token));

        (ClawbackRegistry.TaintLevel level,,,) = registry.checkWallet(recipient);
        assertEq(uint256(level), uint256(ClawbackRegistry.TaintLevel.TAINTED));
    }

    function test_propagateTaintManual_revertsNotFlagged() public {
        vm.expectRevert(ClawbackRegistry.WalletNotFlagged.selector);
        vm.prank(authority);
        registry.propagateTaintManual(recipient, makeAddr("x"), 50 ether, address(token));
    }
}
