// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "forge-std/Test.sol";
import "../../contracts/compliance/ClawbackRegistry.sol";
import "../../contracts/compliance/FederatedConsensus.sol";
import "../../contracts/compliance/ClawbackVault.sol";
import "@openzeppelin/contracts/proxy/ERC1967/ERC1967Proxy.sol";
import "@openzeppelin/contracts/token/ERC20/ERC20.sol";

// ============ Mock Token ============

contract MockToken is ERC20 {
    constructor() ERC20("Mock", "MCK") {}
    function mint(address to, uint256 amount) external { _mint(to, amount); }
}

// ============ Compliance Pipeline Integration Test ============
// Flow: FederatedConsensus authorities -> ClawbackRegistry cases -> ClawbackVault escrow

contract CompliancePipelineTest is Test {
    ClawbackRegistry registry;
    FederatedConsensus consensus;
    ClawbackVault vault;
    MockToken token;

    address owner = address(this);
    address authority1 = makeAddr("authority1");
    address authority2 = makeAddr("authority2");
    address authority3 = makeAddr("authority3");
    address tracker = makeAddr("tracker");
    address badActor = makeAddr("badActor");
    address recipient1 = makeAddr("recipient1");
    address recipient2 = makeAddr("recipient2");
    address victim = makeAddr("victim");

    function setUp() public {
        token = new MockToken();

        // 1. Deploy FederatedConsensus (UUPS proxy)
        FederatedConsensus consensusImpl = new FederatedConsensus();
        ERC1967Proxy consensusProxy = new ERC1967Proxy(
            address(consensusImpl),
            abi.encodeWithSelector(
                FederatedConsensus.initialize.selector,
                owner,
                2,       // approvalThreshold: 2 of 3 authorities needed
                1 days   // gracePeriod: 1 day after approval before execution
            )
        );
        consensus = FederatedConsensus(address(consensusProxy));

        // 2. Deploy ClawbackVault (UUPS proxy)
        ClawbackVault vaultImpl = new ClawbackVault();
        ERC1967Proxy vaultProxy = new ERC1967Proxy(
            address(vaultImpl),
            abi.encodeWithSelector(
                ClawbackVault.initialize.selector,
                owner,
                address(0) // registry set after registry is deployed
            )
        );
        vault = ClawbackVault(address(vaultProxy));

        // 3. Deploy ClawbackRegistry (UUPS proxy)
        ClawbackRegistry registryImpl = new ClawbackRegistry();
        ERC1967Proxy registryProxy = new ERC1967Proxy(
            address(registryImpl),
            abi.encodeWithSelector(
                ClawbackRegistry.initialize.selector,
                owner,
                address(consensus),
                5,       // maxCascadeDepth
                1 ether  // minTaintAmount
            )
        );
        registry = ClawbackRegistry(address(registryProxy));

        // Wire up
        vault.setRegistry(address(registry));
        registry.setVault(address(vault));
        registry.setAuthorizedTracker(tracker, true);

        // Add authorities to FederatedConsensus
        consensus.addAuthority(authority1, FederatedConsensus.AuthorityRole.GOVERNMENT, "US");
        consensus.addAuthority(authority2, FederatedConsensus.AuthorityRole.LEGAL, "US");
        consensus.addAuthority(authority3, FederatedConsensus.AuthorityRole.REGULATOR, "US");

        // Set registry as executor on consensus
        consensus.setExecutor(address(registry));

        // Fund actors
        token.mint(badActor, 1000 ether);
        token.mint(recipient1, 500 ether);
        token.mint(recipient2, 500 ether);
    }

    // ============ E2E: Open case -> taint propagation -> federated vote -> execute clawback ============
    function test_fullPipeline_caseToClawback() public {
        // Step 1: Authority opens case against bad actor
        vm.prank(authority1);
        bytes32 caseId = registry.openCase(badActor, 100 ether, address(token), "stolen funds");

        // Bad actor is now flagged
        assertTrue(registry.isBlocked(badActor), "Bad actor should be blocked");

        // Step 2: Record transactions showing taint propagation
        vm.prank(tracker);
        registry.recordTransaction(badActor, recipient1, 50 ether, address(token));

        vm.prank(tracker);
        registry.recordTransaction(badActor, recipient2, 30 ether, address(token));

        // Recipients are now tainted
        (ClawbackRegistry.TaintLevel r1Level,,,) = registry.checkWallet(recipient1);
        (ClawbackRegistry.TaintLevel r2Level,,,) = registry.checkWallet(recipient2);
        assertEq(uint256(r1Level), uint256(ClawbackRegistry.TaintLevel.TAINTED));
        assertEq(uint256(r2Level), uint256(ClawbackRegistry.TaintLevel.TAINTED));

        // Step 3: Submit case for federated vote
        vm.prank(authority1);
        registry.submitForVoting(caseId);

        // Step 4: Authorities vote
        // Get the consensus proposal ID from the case
        (,,,,,,,,,bytes32 proposalId,) = registry.cases(caseId);
        assertNotEq(proposalId, bytes32(0), "Proposal ID should be set");

        vm.prank(authority1);
        consensus.vote(proposalId, true);

        vm.prank(authority2);
        consensus.vote(proposalId, true);

        // 2 of 3 approved — meets threshold

        // Step 5: Wait for grace period
        vm.warp(block.timestamp + 1 days + 1);

        // Consensus should now be executable
        assertTrue(consensus.isExecutable(proposalId), "Proposal should be executable after grace period");

        // Step 6: Execute clawback
        registry.executeClawback(caseId);

        // Case should be resolved
        (,,,, ClawbackRegistry.CaseStatus status,,,,,,) = registry.cases(caseId);
        assertEq(uint256(status), uint256(ClawbackRegistry.CaseStatus.RESOLVED));
    }

    // ============ E2E: Case dismissed -> wallets cleared ============
    function test_dismissCase_clearsAllTaint() public {
        // Open case and propagate taint
        vm.prank(authority1);
        bytes32 caseId = registry.openCase(badActor, 100 ether, address(token), "suspected fraud");

        vm.prank(tracker);
        registry.recordTransaction(badActor, recipient1, 10 ether, address(token));

        // Verify taint
        assertTrue(registry.isBlocked(badActor));
        (ClawbackRegistry.TaintLevel r1Before,,,) = registry.checkWallet(recipient1);
        assertEq(uint256(r1Before), uint256(ClawbackRegistry.TaintLevel.TAINTED));

        // Dismiss the case (found innocent)
        vm.prank(authority1);
        registry.dismissCase(caseId);

        // Both should be clean now
        assertFalse(registry.isBlocked(badActor), "Bad actor cleared after dismiss");
        (ClawbackRegistry.TaintLevel r1After,,,) = registry.checkWallet(recipient1);
        assertEq(uint256(r1After), uint256(ClawbackRegistry.TaintLevel.CLEAN));
    }

    // ============ E2E: Cascading taint across multiple hops ============
    function test_cascadingTaint_multipleHops() public {
        vm.prank(authority1);
        registry.openCase(badActor, 100 ether, address(token), "theft");

        // Chain: badActor -> A -> B -> C
        address a = makeAddr("hopA");
        address b = makeAddr("hopB");
        address c = makeAddr("hopC");

        vm.prank(tracker);
        registry.recordTransaction(badActor, a, 10 ether, address(token));
        vm.prank(tracker);
        registry.recordTransaction(a, b, 5 ether, address(token));
        vm.prank(tracker);
        registry.recordTransaction(b, c, 3 ether, address(token));

        // All should be tainted at increasing depth
        (,,, uint256 dA) = registry.checkWallet(a);
        (,,, uint256 dB) = registry.checkWallet(b);
        (,,, uint256 dC) = registry.checkWallet(c);
        assertEq(dA, 1);
        assertEq(dB, 2);
        assertEq(dC, 3);

        // Transaction safety should block all
        (bool safe1,) = registry.checkTransactionSafety(a, makeAddr("clean"));
        (bool safe2,) = registry.checkTransactionSafety(b, makeAddr("clean"));
        assertFalse(safe1, "Tainted wallet should be unsafe");
        assertFalse(safe2, "Tainted wallet should be unsafe");
    }

    // ============ E2E: Insufficient votes -> cannot execute ============
    function test_insufficientVotes_cannotExecute() public {
        vm.prank(authority1);
        bytes32 caseId = registry.openCase(badActor, 100 ether, address(token), "alleged fraud");

        vm.prank(authority1);
        registry.submitForVoting(caseId);

        (,,,,,,,,,bytes32 proposalId,) = registry.cases(caseId);

        // Only 1 of 3 vote (need 2)
        vm.prank(authority1);
        consensus.vote(proposalId, true);

        vm.warp(block.timestamp + 1 days + 1);

        // Should not be executable
        assertFalse(consensus.isExecutable(proposalId), "1 of 3 should not meet threshold");
    }

    // ============ E2E: Grace period not elapsed -> cannot execute ============
    function test_graceNotElapsed_cannotExecute() public {
        vm.prank(authority1);
        bytes32 caseId = registry.openCase(badActor, 100 ether, address(token), "fraud");

        vm.prank(authority1);
        registry.submitForVoting(caseId);

        (,,,,,,,,,bytes32 proposalId,) = registry.cases(caseId);

        vm.prank(authority1);
        consensus.vote(proposalId, true);
        vm.prank(authority2);
        consensus.vote(proposalId, true);

        // Don't wait for grace period
        assertFalse(consensus.isExecutable(proposalId), "Should not be executable before grace period");
    }

    // ============ E2E: Taint chain tracking ============
    function test_taintChain_recorded() public {
        vm.prank(authority1);
        registry.openCase(badActor, 100 ether, address(token), "theft");

        vm.prank(tracker);
        registry.recordTransaction(badActor, recipient1, 50 ether, address(token));

        vm.prank(tracker);
        registry.recordTransaction(badActor, recipient1, 25 ether, address(token));

        ClawbackRegistry.TaintRecord[] memory chain = registry.getTaintChain(recipient1);
        assertEq(chain.length, 2, "Should have 2 taint records");
        assertEq(chain[0].amount, 50 ether);
        assertEq(chain[1].amount, 25 ether);
    }

    // ============ E2E: Case wallets tracked correctly ============
    function test_caseWallets_tracked() public {
        vm.prank(authority1);
        bytes32 caseId = registry.openCase(badActor, 100 ether, address(token), "theft");

        vm.prank(tracker);
        registry.recordTransaction(badActor, recipient1, 10 ether, address(token));
        vm.prank(tracker);
        registry.recordTransaction(badActor, recipient2, 10 ether, address(token));

        address[] memory wallets = registry.getCaseWallets(caseId);
        assertEq(wallets.length, 3, "Should have badActor + 2 recipients");
        assertEq(wallets[0], badActor);
    }

    // ============ E2E: Manual taint propagation by authority ============
    function test_manualTaintPropagation() public {
        vm.prank(authority1);
        registry.openCase(badActor, 100 ether, address(token), "theft");

        // Authority manually propagates for historical transaction
        vm.prank(authority1);
        registry.propagateTaintManual(badActor, recipient1, 40 ether, address(token));

        (ClawbackRegistry.TaintLevel level,,,) = registry.checkWallet(recipient1);
        assertEq(uint256(level), uint256(ClawbackRegistry.TaintLevel.TAINTED));
    }

    // ============ E2E: Unauthorized cannot interfere ============
    function test_unauthorized_cannotInterfere() public {
        address random = makeAddr("random");

        // Cannot open case
        vm.expectRevert("Not authorized to open case");
        vm.prank(random);
        registry.openCase(badActor, 100 ether, address(token), "test");

        // Cannot record transactions
        vm.expectRevert(ClawbackRegistry.NotAuthorizedTracker.selector);
        vm.prank(random);
        registry.recordTransaction(badActor, recipient1, 10 ether, address(token));
    }
}
