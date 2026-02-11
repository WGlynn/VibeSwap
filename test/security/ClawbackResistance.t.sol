// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "forge-std/Test.sol";
import "../../contracts/compliance/ClawbackRegistry.sol";
import "../../contracts/compliance/FederatedConsensus.sol";
import "../../contracts/compliance/ClawbackVault.sol";
import "@openzeppelin/contracts/proxy/ERC1967/ERC1967Proxy.sol";
import "@openzeppelin/contracts/token/ERC20/ERC20.sol";

contract MockToken is ERC20 {
    constructor(string memory name, string memory symbol) ERC20(name, symbol) {}
    function mint(address to, uint256 amount) external { _mint(to, amount); }
}

/**
 * @title Clawback Sybil Resistance Tests
 * @notice Tests verifying the clawback system's resistance to gaming and manipulation
 * @dev The clawback mechanism creates a cascading deterrent:
 *      If wallet A is flagged and sent funds to wallet B, wallet B is tainted.
 *      Anyone interacting with tainted wallets risks cascading reversal.
 *      Result: Nobody will interact with bad wallets.
 *
 *      These tests verify:
 *      1. Federated consensus cannot be gamed by a single authority
 *      2. Taint propagation cascades correctly and respects depth limits
 *      3. Grace periods protect accused wallets from instant seizure
 *      4. Dismissed cases properly clear all tainted wallets
 *      5. Sybil attacks on the authority set are mitigated
 */
contract ClawbackResistanceTest is Test {
    ClawbackRegistry public registry;
    FederatedConsensus public consensus;
    ClawbackVault public vault;
    MockToken public token;

    address public owner;

    // Authorities (federated consensus)
    address public government;
    address public lawyer;
    address public court;
    address public sec;
    address public interpol;

    // Wallets
    address public hacker;
    address public victim;
    address public innocentBob;
    address public innocentCarol;
    address public innocentDave;
    address public innocentEve;

    function setUp() public {
        owner = address(this);
        government = makeAddr("government");
        lawyer = makeAddr("lawyer");
        court = makeAddr("court");
        sec = makeAddr("sec");
        interpol = makeAddr("interpol");

        hacker = makeAddr("hacker");
        victim = makeAddr("victim");
        innocentBob = makeAddr("innocentBob");
        innocentCarol = makeAddr("innocentCarol");
        innocentDave = makeAddr("innocentDave");
        innocentEve = makeAddr("innocentEve");

        token = new MockToken("USDC", "USDC");

        // Deploy FederatedConsensus
        FederatedConsensus consensusImpl = new FederatedConsensus();
        bytes memory consensusInit = abi.encodeWithSelector(
            FederatedConsensus.initialize.selector,
            owner,
            3,        // threshold: 3-of-5 authorities must agree
            7 days    // grace period
        );
        ERC1967Proxy consensusProxy = new ERC1967Proxy(address(consensusImpl), consensusInit);
        consensus = FederatedConsensus(payable(address(consensusProxy)));

        // Deploy ClawbackVault
        ClawbackVault vaultImpl = new ClawbackVault();
        bytes memory vaultInit = abi.encodeWithSelector(
            ClawbackVault.initialize.selector,
            owner,
            address(0) // registry set after deployment
        );
        ERC1967Proxy vaultProxy = new ERC1967Proxy(address(vaultImpl), vaultInit);
        vault = ClawbackVault(payable(address(vaultProxy)));

        // Deploy ClawbackRegistry
        ClawbackRegistry registryImpl = new ClawbackRegistry();
        bytes memory registryInit = abi.encodeWithSelector(
            ClawbackRegistry.initialize.selector,
            owner,
            address(consensus),
            5,        // maxCascadeDepth
            1e18      // minTaintAmount (1 token minimum)
        );
        ERC1967Proxy registryProxy = new ERC1967Proxy(address(registryImpl), registryInit);
        registry = ClawbackRegistry(payable(address(registryProxy)));

        // Wire up contracts
        consensus.setExecutor(address(registry));
        vault.setRegistry(address(registry));
        registry.setVault(address(vault));
        registry.setAuthorizedTracker(address(this), true);

        // Add 5 authorities
        consensus.addAuthority(government, FederatedConsensus.AuthorityRole.GOVERNMENT, "US");
        consensus.addAuthority(lawyer, FederatedConsensus.AuthorityRole.LEGAL, "US");
        consensus.addAuthority(court, FederatedConsensus.AuthorityRole.COURT, "US");
        consensus.addAuthority(sec, FederatedConsensus.AuthorityRole.REGULATOR, "US");
        consensus.addAuthority(interpol, FederatedConsensus.AuthorityRole.GOVERNMENT, "EU");

        // Fund wallets
        token.mint(hacker, 100_000e18);
        token.mint(victim, 50_000e18);
        token.mint(innocentBob, 10_000e18);
    }

    // ============ Federated Consensus Resistance Tests ============

    /**
     * @notice Single authority cannot unilaterally approve a clawback
     * @dev Even if one authority is compromised, they can't execute alone
     */
    function test_singleAuthorityCannotApprove() public {
        // Open case
        vm.prank(government);
        bytes32 caseId = registry.openCase(hacker, 50_000e18, address(token), "Stolen funds");

        // Submit for voting
        vm.prank(government);
        registry.submitForVoting(caseId);

        // Get proposal ID
        (, , , , , , , , , bytes32 proposalId, ) = registry.cases(caseId);

        // Single vote shouldn't approve (need 3-of-5)
        vm.prank(government);
        consensus.vote(proposalId, true);

        FederatedConsensus.Proposal memory proposal = consensus.getProposal(proposalId);
        assertEq(uint256(proposal.status), uint256(FederatedConsensus.ProposalStatus.PENDING));
        assertFalse(consensus.isExecutable(proposalId));
    }

    /**
     * @notice Two authorities still can't approve (need 3-of-5)
     */
    function test_twoAuthoritiesCannotApprove() public {
        vm.prank(government);
        bytes32 caseId = registry.openCase(hacker, 50_000e18, address(token), "Stolen funds");

        vm.prank(government);
        registry.submitForVoting(caseId);

        (, , , , , , , , , bytes32 proposalId, ) = registry.cases(caseId);

        vm.prank(government);
        consensus.vote(proposalId, true);
        vm.prank(lawyer);
        consensus.vote(proposalId, true);

        FederatedConsensus.Proposal memory proposal = consensus.getProposal(proposalId);
        assertEq(uint256(proposal.status), uint256(FederatedConsensus.ProposalStatus.PENDING));
    }

    /**
     * @notice Three authorities can approve (meets 3-of-5 threshold)
     */
    function test_threeAuthoritiesCanApprove() public {
        vm.prank(government);
        bytes32 caseId = registry.openCase(hacker, 50_000e18, address(token), "Stolen funds");

        vm.prank(government);
        registry.submitForVoting(caseId);

        (, , , , , , , , , bytes32 proposalId, ) = registry.cases(caseId);

        vm.prank(government);
        consensus.vote(proposalId, true);
        vm.prank(lawyer);
        consensus.vote(proposalId, true);
        vm.prank(court);
        consensus.vote(proposalId, true);

        FederatedConsensus.Proposal memory proposal = consensus.getProposal(proposalId);
        assertEq(uint256(proposal.status), uint256(FederatedConsensus.ProposalStatus.APPROVED));
    }

    /**
     * @notice Majority rejection kills the proposal
     * @dev If 3 out of 5 reject, proposal is dead
     */
    function test_majorityRejectionKillsProposal() public {
        vm.prank(government);
        bytes32 caseId = registry.openCase(hacker, 50_000e18, address(token), "Suspected theft");

        vm.prank(government);
        registry.submitForVoting(caseId);

        (, , , , , , , , , bytes32 proposalId, ) = registry.cases(caseId);

        // 3 rejections - mathematically impossible to reach threshold
        vm.prank(government);
        consensus.vote(proposalId, false);
        vm.prank(lawyer);
        consensus.vote(proposalId, false);
        vm.prank(court);
        consensus.vote(proposalId, false);

        FederatedConsensus.Proposal memory proposal = consensus.getProposal(proposalId);
        assertEq(uint256(proposal.status), uint256(FederatedConsensus.ProposalStatus.REJECTED));
    }

    /**
     * @notice Authority cannot vote twice on the same proposal
     * @dev Prevents amplification attack
     */
    function test_cannotVoteTwice() public {
        vm.prank(government);
        bytes32 caseId = registry.openCase(hacker, 50_000e18, address(token), "Theft");

        vm.prank(government);
        registry.submitForVoting(caseId);

        (, , , , , , , , , bytes32 proposalId, ) = registry.cases(caseId);

        vm.prank(government);
        consensus.vote(proposalId, true);

        vm.prank(government);
        vm.expectRevert(FederatedConsensus.AlreadyVoted.selector);
        consensus.vote(proposalId, true);
    }

    /**
     * @notice Non-authority cannot vote
     */
    function test_nonAuthorityCannotVote() public {
        vm.prank(government);
        bytes32 caseId = registry.openCase(hacker, 50_000e18, address(token), "Theft");

        vm.prank(government);
        registry.submitForVoting(caseId);

        (, , , , , , , , , bytes32 proposalId, ) = registry.cases(caseId);

        vm.prank(hacker);
        vm.expectRevert(FederatedConsensus.NotActiveAuthority.selector);
        consensus.vote(proposalId, true);
    }

    /**
     * @notice Removed authority cannot vote
     */
    function test_removedAuthorityCannotVote() public {
        vm.prank(government);
        bytes32 caseId = registry.openCase(hacker, 50_000e18, address(token), "Theft");

        vm.prank(government);
        registry.submitForVoting(caseId);

        (, , , , , , , , , bytes32 proposalId, ) = registry.cases(caseId);

        // Remove sec authority
        consensus.removeAuthority(sec);

        vm.prank(sec);
        vm.expectRevert(FederatedConsensus.NotActiveAuthority.selector);
        consensus.vote(proposalId, true);
    }

    // ============ Grace Period Resistance Tests ============

    /**
     * @notice Approved clawback cannot execute before grace period
     * @dev The accused wallet has time to respond/challenge
     */
    function test_cannotExecuteBeforeGracePeriod() public {
        vm.prank(government);
        bytes32 caseId = registry.openCase(hacker, 50_000e18, address(token), "Theft");

        vm.prank(government);
        registry.submitForVoting(caseId);

        (, , , , , , , , , bytes32 proposalId, ) = registry.cases(caseId);

        // Get 3 approvals
        vm.prank(government);
        consensus.vote(proposalId, true);
        vm.prank(lawyer);
        consensus.vote(proposalId, true);
        vm.prank(court);
        consensus.vote(proposalId, true);

        // Proposal is approved but NOT executable yet
        assertTrue(consensus.getProposal(proposalId).status == FederatedConsensus.ProposalStatus.APPROVED);
        assertFalse(consensus.isExecutable(proposalId));

        // Try to execute - should fail
        vm.expectRevert(ClawbackRegistry.ConsensusNotApproved.selector);
        registry.executeClawback(caseId);
    }

    /**
     * @notice Clawback CAN execute after grace period expires
     */
    function test_canExecuteAfterGracePeriod() public {
        vm.prank(government);
        bytes32 caseId = registry.openCase(hacker, 50_000e18, address(token), "Theft");

        vm.prank(government);
        registry.submitForVoting(caseId);

        (, , , , , , , , , bytes32 proposalId, ) = registry.cases(caseId);

        vm.prank(government);
        consensus.vote(proposalId, true);
        vm.prank(lawyer);
        consensus.vote(proposalId, true);
        vm.prank(court);
        consensus.vote(proposalId, true);

        // Fast forward past 7-day grace period
        vm.warp(block.timestamp + 7 days + 1);

        assertTrue(consensus.isExecutable(proposalId));

        // Should execute successfully
        registry.executeClawback(caseId);

        (, , , , ClawbackRegistry.CaseStatus status, , , , , , ) = registry.cases(caseId);
        assertEq(uint256(status), uint256(ClawbackRegistry.CaseStatus.RESOLVED));
    }

    // ============ Taint Propagation Tests ============

    /**
     * @notice Taint propagates from flagged wallet to recipients
     */
    function test_taintPropagation() public {
        // Flag hacker
        vm.prank(government);
        registry.openCase(hacker, 50_000e18, address(token), "Theft");

        // Simulate hacker sends to innocentBob
        registry.recordTransaction(hacker, innocentBob, 10_000e18, address(token));

        // Bob should now be tainted
        (ClawbackRegistry.TaintLevel level, bool isSafe, , uint256 depth) = registry.checkWallet(innocentBob);
        assertEq(uint256(level), uint256(ClawbackRegistry.TaintLevel.TAINTED));
        assertFalse(isSafe);
        assertEq(depth, 1);
    }

    /**
     * @notice Taint cascades through multiple hops
     * @dev hacker -> Bob -> Carol -> Dave (3 hops)
     */
    function test_cascadingTaintPropagation() public {
        vm.prank(government);
        registry.openCase(hacker, 50_000e18, address(token), "Theft");

        // Hacker -> Bob (depth 1)
        registry.recordTransaction(hacker, innocentBob, 10_000e18, address(token));

        // Bob -> Carol (depth 2)
        registry.recordTransaction(innocentBob, innocentCarol, 5_000e18, address(token));

        // Carol -> Dave (depth 3)
        registry.recordTransaction(innocentCarol, innocentDave, 2_500e18, address(token));

        // Verify cascade depths
        (, , , uint256 bobDepth) = registry.checkWallet(innocentBob);
        (, , , uint256 carolDepth) = registry.checkWallet(innocentCarol);
        (, , , uint256 daveDepth) = registry.checkWallet(innocentDave);

        assertEq(bobDepth, 1);
        assertEq(carolDepth, 2);
        assertEq(daveDepth, 3);
    }

    /**
     * @notice Taint propagation respects max cascade depth
     * @dev Prevents gas griefing through infinitely deep chains
     */
    function test_maxCascadeDepthEnforced() public {
        vm.prank(government);
        registry.openCase(hacker, 50_000e18, address(token), "Theft");

        // Build a chain up to max depth (5)
        address[] memory chain = new address[](6);
        chain[0] = hacker;
        for (uint256 i = 1; i < 6; i++) {
            chain[i] = makeAddr(string(abi.encodePacked("chain_", vm.toString(i))));
        }

        // Propagate through chain
        for (uint256 i = 0; i < 5; i++) {
            registry.recordTransaction(chain[i], chain[i + 1], 10_000e18, address(token));
        }

        // The 6th hop should revert (exceeds maxCascadeDepth of 5)
        address tooDeep = makeAddr("tooDeep");
        vm.expectRevert(ClawbackRegistry.MaxCascadeDepthReached.selector);
        registry.recordTransaction(chain[5], tooDeep, 10_000e18, address(token));
    }

    /**
     * @notice Dust amounts don't propagate taint (minTaintAmount filter)
     * @dev Prevents attackers from tainting entire network with tiny transfers
     */
    function test_dustAmountsDontPropagateTaint() public {
        vm.prank(government);
        registry.openCase(hacker, 50_000e18, address(token), "Theft");

        // Send dust amount (below 1e18 minimum)
        registry.recordTransaction(hacker, innocentBob, 0.5e18, address(token));

        // Bob should still be clean
        (ClawbackRegistry.TaintLevel level, bool isSafe, , ) = registry.checkWallet(innocentBob);
        assertEq(uint256(level), uint256(ClawbackRegistry.TaintLevel.CLEAN));
        assertTrue(isSafe);
    }

    /**
     * @notice Clean wallet sending to clean wallet is fine
     */
    function test_cleanWalletsNoTaint() public {
        registry.recordTransaction(innocentBob, innocentCarol, 5_000e18, address(token));

        (ClawbackRegistry.TaintLevel bobLevel, , , ) = registry.checkWallet(innocentBob);
        (ClawbackRegistry.TaintLevel carolLevel, , , ) = registry.checkWallet(innocentCarol);

        assertEq(uint256(bobLevel), uint256(ClawbackRegistry.TaintLevel.CLEAN));
        assertEq(uint256(carolLevel), uint256(ClawbackRegistry.TaintLevel.CLEAN));
    }

    // ============ Transaction Safety Check Tests ============

    /**
     * @notice Safety check warns about tainted wallets
     */
    function test_transactionSafetyCheck() public {
        vm.prank(government);
        registry.openCase(hacker, 50_000e18, address(token), "Theft");

        registry.recordTransaction(hacker, innocentBob, 10_000e18, address(token));

        // Checking tx from tainted Bob to clean Carol
        (bool safe, string memory riskLevel) = registry.checkTransactionSafety(innocentBob, innocentCarol);
        assertFalse(safe);
        assertEq(riskLevel, "RISK: Wallet has received tainted funds - cascading reversal possible");
    }

    /**
     * @notice Flagged wallet is blocked entirely
     */
    function test_flaggedWalletBlocked() public {
        vm.prank(government);
        registry.openCase(hacker, 50_000e18, address(token), "Theft");

        (bool safe, string memory riskLevel) = registry.checkTransactionSafety(hacker, innocentBob);
        assertFalse(safe);
        assertEq(riskLevel, "HIGH RISK: Wallet flagged by authorities");

        assertTrue(registry.isBlocked(hacker));
    }

    /**
     * @notice Clean-to-clean transactions show as safe
     */
    function test_cleanTransactionSafe() public {
        (bool safe, string memory riskLevel) = registry.checkTransactionSafety(innocentBob, innocentCarol);
        assertTrue(safe);
        assertEq(riskLevel, "CLEAN");
    }

    // ============ Case Dismissal Tests ============

    /**
     * @notice Dismissed case clears all tainted wallets in the chain
     * @dev Innocent wallets must be restored when a case is thrown out
     */
    function test_dismissalClearsAllTaintedWallets() public {
        vm.prank(government);
        bytes32 caseId = registry.openCase(hacker, 50_000e18, address(token), "Suspected theft");

        // Build taint chain
        registry.recordTransaction(hacker, innocentBob, 10_000e18, address(token));
        registry.recordTransaction(innocentBob, innocentCarol, 5_000e18, address(token));

        // Verify they're tainted
        (ClawbackRegistry.TaintLevel bobLevel, , , ) = registry.checkWallet(innocentBob);
        assertEq(uint256(bobLevel), uint256(ClawbackRegistry.TaintLevel.TAINTED));

        // Dismiss the case
        vm.prank(government);
        registry.dismissCase(caseId);

        // Everyone should be clean again
        (ClawbackRegistry.TaintLevel hackerLevel, , , ) = registry.checkWallet(hacker);
        (ClawbackRegistry.TaintLevel bobLevelAfter, , , ) = registry.checkWallet(innocentBob);
        (ClawbackRegistry.TaintLevel carolLevelAfter, , , ) = registry.checkWallet(innocentCarol);

        assertEq(uint256(hackerLevel), uint256(ClawbackRegistry.TaintLevel.CLEAN));
        assertEq(uint256(bobLevelAfter), uint256(ClawbackRegistry.TaintLevel.CLEAN));
        assertEq(uint256(carolLevelAfter), uint256(ClawbackRegistry.TaintLevel.CLEAN));
    }

    // ============ Sybil Attack Resistance Tests ============

    /**
     * @notice Cannot add duplicate authority to inflate vote count
     */
    function test_cannotAddDuplicateAuthority() public {
        vm.expectRevert(FederatedConsensus.AuthorityAlreadyExists.selector);
        consensus.addAuthority(government, FederatedConsensus.AuthorityRole.GOVERNMENT, "US");
    }

    /**
     * @notice Only owner can add authorities (prevents sybil authority injection)
     */
    function test_onlyOwnerCanAddAuthority() public {
        address sybilAttacker = makeAddr("sybilAttacker");

        vm.prank(sybilAttacker);
        vm.expectRevert();
        consensus.addAuthority(sybilAttacker, FederatedConsensus.AuthorityRole.GOVERNMENT, "XX");
    }

    /**
     * @notice Threshold cannot be set to 0 (prevents rubber-stamp approvals)
     */
    function test_thresholdCannotBeZero() public {
        vm.expectRevert(FederatedConsensus.InvalidThreshold.selector);
        consensus.setThreshold(0);
    }

    /**
     * @notice Threshold cannot exceed authority count
     */
    function test_thresholdCannotExceedAuthorityCount() public {
        vm.expectRevert(FederatedConsensus.InvalidThreshold.selector);
        consensus.setThreshold(10);
    }

    /**
     * @notice Proposals expire after timeout (prevents stale/forgotten proposals)
     */
    function test_proposalExpires() public {
        vm.prank(government);
        bytes32 caseId = registry.openCase(hacker, 50_000e18, address(token), "Theft");

        vm.prank(government);
        registry.submitForVoting(caseId);

        (, , , , , , , , , bytes32 proposalId, ) = registry.cases(caseId);

        // Warp past 30-day expiry
        vm.warp(block.timestamp + 31 days);

        // Vote should trigger expiry
        vm.prank(government);
        vm.expectRevert(FederatedConsensus.ProposalExpiredError.selector);
        consensus.vote(proposalId, true);
    }

    // ============ Unauthorized Tracker Resistance ============

    /**
     * @notice Only authorized trackers can record transactions
     * @dev Prevents attackers from manually tainting wallets
     */
    function test_unauthorizedCannotRecordTransaction() public {
        vm.prank(hacker);
        vm.expectRevert(ClawbackRegistry.NotAuthorizedTracker.selector);
        registry.recordTransaction(hacker, innocentBob, 10_000e18, address(token));
    }

    /**
     * @notice Only authorities can open cases
     */
    function test_unauthorizedCannotOpenCase() public {
        vm.prank(hacker);
        vm.expectRevert("Not authorized to open case");
        registry.openCase(victim, 50_000e18, address(token), "Fake case");
    }

    // ============ Taint Level Escalation Tests ============

    /**
     * @notice Taint level only escalates, never downgrades
     * @dev Prevents an authority from quietly clearing a flagged wallet
     */
    function test_taintLevelOnlyEscalates() public {
        vm.prank(government);
        bytes32 caseId1 = registry.openCase(hacker, 50_000e18, address(token), "Theft");

        // Hacker taints Bob
        registry.recordTransaction(hacker, innocentBob, 10_000e18, address(token));

        // Bob is TAINTED (level 2)
        (ClawbackRegistry.TaintLevel level1, , , ) = registry.checkWallet(innocentBob);
        assertEq(uint256(level1), uint256(ClawbackRegistry.TaintLevel.TAINTED));

        // Even if another clean wallet sends to Bob, the taint stays
        registry.recordTransaction(innocentCarol, innocentBob, 5_000e18, address(token));

        (ClawbackRegistry.TaintLevel level2, , , ) = registry.checkWallet(innocentBob);
        assertEq(uint256(level2), uint256(ClawbackRegistry.TaintLevel.TAINTED));
    }
}
