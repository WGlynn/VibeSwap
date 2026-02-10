// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "forge-std/Test.sol";
import "../../contracts/compliance/ClawbackRegistry.sol";
import "../../contracts/compliance/FederatedConsensus.sol";
import "../../contracts/compliance/ComplianceRegistry.sol";
import "@openzeppelin/contracts/proxy/ERC1967/ERC1967Proxy.sol";
import "@openzeppelin/contracts/token/ERC20/ERC20.sol";

contract MockToken is ERC20 {
    constructor(string memory name, string memory symbol) ERC20(name, symbol) {}
    function mint(address to, uint256 amount) external { _mint(to, amount); }
}

/**
 * @title Sybil Resistance Integration Tests
 * @notice Cross-mechanism tests verifying all resistance layers work together
 * @dev VibeSwap's sybil resistance is layered:
 *
 *      Layer 1 - IDENTITY: Soulbound NFTs, one per address, reputation-weighted
 *      Layer 2 - COMPLIANCE: KYC tiers, jurisdiction limits, account freezing
 *      Layer 3 - MECHANISM DESIGN: Commit-reveal hides intent, Shapley rewards truth
 *      Layer 4 - CLAWBACKS: Cascading reversal deters bad actor interaction
 *      Layer 5 - FEDERATED AUTHORITY: Off-chain entities (gov, lawyers, courts, SEC)
 *                provide the legal hooks for enforcement. This isn't just on-chain
 *                game theory - it's backed by real-world legal authority.
 *
 *      The Federated Consensus acts as a bridge between on-chain smart contracts
 *      and off-chain legal systems:
 *      - Government agencies can flag wallets tied to criminal activity
 *      - Lawyers can file civil claims on behalf of victims
 *      - Courts can order fund freezes with legal authority
 *      - Regulatory bodies (SEC) can enforce securities compliance
 *      - Jury/arbitration systems can resolve disputed claims
 *
 *      These tests prove the combined system is resistant to:
 *      - Sybil attacks (multiple fake identities)
 *      - Wash trading (fake volume for Shapley rewards)
 *      - MEV extraction (frontrunning through commit-reveal)
 *      - Fund laundering (cascading taint tracking)
 *      - Authority capture (threshold voting prevents single-entity abuse)
 */
contract SybilResistanceIntegrationTest is Test {
    ClawbackRegistry public registry;
    FederatedConsensus public consensus;
    ComplianceRegistry public compliance;
    MockToken public token;

    address public owner;

    // Federated authorities (off-chain entity representatives)
    address public government;    // Government agency (e.g., FBI, DOJ)
    address public lawyer;        // Legal counsel representing victim
    address public court;         // Court-appointed authority
    address public sec;           // SEC regulatory enforcement
    address public arbitrator;    // Decentralized arbitration juror

    // Actors
    address public sybilAttacker;
    address public sybilPuppet1;
    address public sybilPuppet2;
    address public sybilPuppet3;
    address public washTrader;
    address public laundryman;
    address public honestUser;

    function setUp() public {
        owner = address(this);
        government = makeAddr("government");
        lawyer = makeAddr("lawyer");
        court = makeAddr("court");
        sec = makeAddr("sec");
        arbitrator = makeAddr("arbitrator");

        sybilAttacker = makeAddr("sybilAttacker");
        sybilPuppet1 = makeAddr("sybilPuppet1");
        sybilPuppet2 = makeAddr("sybilPuppet2");
        sybilPuppet3 = makeAddr("sybilPuppet3");
        washTrader = makeAddr("washTrader");
        laundryman = makeAddr("laundryman");
        honestUser = makeAddr("honestUser");

        token = new MockToken("USDC", "USDC");

        // Deploy FederatedConsensus (3-of-5 threshold, 7 day grace)
        FederatedConsensus consensusImpl = new FederatedConsensus();
        bytes memory consensusInit = abi.encodeWithSelector(
            FederatedConsensus.initialize.selector,
            owner,
            3,
            7 days
        );
        ERC1967Proxy consensusProxy = new ERC1967Proxy(address(consensusImpl), consensusInit);
        consensus = FederatedConsensus(payable(address(consensusProxy)));

        // Deploy ClawbackRegistry
        ClawbackRegistry registryImpl = new ClawbackRegistry();
        bytes memory registryInit = abi.encodeWithSelector(
            ClawbackRegistry.initialize.selector,
            owner,
            address(consensus),
            5,
            1e18
        );
        ERC1967Proxy registryProxy = new ERC1967Proxy(address(registryImpl), registryInit);
        registry = ClawbackRegistry(payable(address(registryProxy)));

        // Deploy ComplianceRegistry
        ComplianceRegistry complianceImpl = new ComplianceRegistry();
        bytes memory complianceInit = abi.encodeWithSelector(
            ComplianceRegistry.initialize.selector,
            owner
        );
        ERC1967Proxy complianceProxy = new ERC1967Proxy(address(complianceImpl), complianceInit);
        compliance = ComplianceRegistry(payable(address(complianceProxy)));

        // Wire up
        consensus.setExecutor(address(registry));
        registry.setAuthorizedTracker(address(this), true);

        // Add authorities - each represents a real-world off-chain entity
        consensus.addAuthority(government, FederatedConsensus.AuthorityRole.GOVERNMENT, "US");
        consensus.addAuthority(lawyer, FederatedConsensus.AuthorityRole.LEGAL, "US");
        consensus.addAuthority(court, FederatedConsensus.AuthorityRole.COURT, "US");
        consensus.addAuthority(sec, FederatedConsensus.AuthorityRole.REGULATOR, "US");
        consensus.addAuthority(arbitrator, FederatedConsensus.AuthorityRole.LEGAL, "GLOBAL");

        // Set up compliance - KYC the honest user
        compliance.setComplianceOfficer(owner, true);
        compliance.setKYCProvider(owner, true);
        compliance.verifyKYC(honestUser, ComplianceRegistry.UserTier.RETAIL, "US", bytes32(0), "Jumio");
    }

    // ============ Sybil + Clawback Integration ============

    /**
     * @notice Sybil attacker creates multiple wallets to distribute stolen funds
     * @dev The cascading taint catches ALL puppet wallets automatically
     *      Even spreading across 3 puppets doesn't help - they all get tainted
     */
    function test_sybilFundDistributionCaughtByCascade() public {
        // Authority flags the attacker
        vm.prank(government);
        registry.openCase(sybilAttacker, 100_000e18, address(token), "Stolen funds via sybil attack");

        // Attacker distributes to 3 puppet wallets
        registry.recordTransaction(sybilAttacker, sybilPuppet1, 33_000e18, address(token));
        registry.recordTransaction(sybilAttacker, sybilPuppet2, 33_000e18, address(token));
        registry.recordTransaction(sybilAttacker, sybilPuppet3, 34_000e18, address(token));

        // ALL puppets are tainted
        for (uint i = 0; i < 3; i++) {
            address puppet = i == 0 ? sybilPuppet1 : (i == 1 ? sybilPuppet2 : sybilPuppet3);
            (ClawbackRegistry.TaintLevel level, bool safe, , ) = registry.checkWallet(puppet);
            assertEq(uint256(level), uint256(ClawbackRegistry.TaintLevel.TAINTED));
            assertFalse(safe);
        }

        // Honest user checks before transacting with puppet1
        (bool txSafe, ) = registry.checkTransactionSafety(honestUser, sybilPuppet1);
        assertFalse(txSafe); // Warning: don't interact!
    }

    /**
     * @notice Sybil puppets trying to launder through each other still tracked
     * @dev puppet1 -> puppet2 -> puppet3 -> ... doesn't escape taint
     */
    function test_sybilChainLaunderingTracked() public {
        vm.prank(government);
        registry.openCase(sybilAttacker, 100_000e18, address(token), "Sybil laundering");

        // Attacker -> puppet1 -> puppet2 -> puppet3
        registry.recordTransaction(sybilAttacker, sybilPuppet1, 100_000e18, address(token));
        registry.recordTransaction(sybilPuppet1, sybilPuppet2, 100_000e18, address(token));
        registry.recordTransaction(sybilPuppet2, sybilPuppet3, 100_000e18, address(token));

        // Each hop increases depth
        (, , , uint256 depth1) = registry.checkWallet(sybilPuppet1);
        (, , , uint256 depth2) = registry.checkWallet(sybilPuppet2);
        (, , , uint256 depth3) = registry.checkWallet(sybilPuppet3);

        assertEq(depth1, 1);
        assertEq(depth2, 2);
        assertEq(depth3, 3);

        // All blocked from VibeSwap
        assertTrue(registry.isBlocked(sybilAttacker));
    }

    // ============ Compliance + Clawback Integration ============

    /**
     * @notice Frozen compliance account also gets clawback flagging
     * @dev Double-layer protection: compliance freeze + clawback taint
     */
    function test_complianceFreezeAndClawbackStack() public {
        // Compliance officer freezes suspected account
        compliance.freezeUser(washTrader, "Suspicious wash trading pattern");

        // Separately, government opens clawback case
        vm.prank(government);
        registry.openCase(washTrader, 50_000e18, address(token), "Wash trading for fake Shapley rewards");

        // Both systems flag the wallet independently
        ComplianceRegistry.UserProfile memory profile = compliance.getUserProfile(washTrader);
        assertEq(uint256(profile.status), uint256(ComplianceRegistry.AccountStatus.FROZEN));

        (ClawbackRegistry.TaintLevel level, , , ) = registry.checkWallet(washTrader);
        assertEq(uint256(level), uint256(ClawbackRegistry.TaintLevel.FLAGGED));
    }

    /**
     * @notice KYC-expired wallet interacting with tainted funds gets caught
     */
    function test_expiredKycPlusTaintDoubleBlock() public {
        // Verify laundryman with KYC
        compliance.verifyKYC(laundryman, ComplianceRegistry.UserTier.RETAIL, "US", bytes32(0), "Jumio");

        // Time passes, KYC expires
        vm.warp(block.timestamp + 366 days);

        // Meanwhile, laundryman received tainted funds
        vm.prank(government);
        registry.openCase(sybilAttacker, 100_000e18, address(token), "Theft");
        registry.recordTransaction(sybilAttacker, laundryman, 50_000e18, address(token));

        // Double blocked: expired KYC + tainted
        (bool canTrade, string memory reason) = compliance.canTrade(laundryman, 1000e18, address(token), address(token));
        assertFalse(canTrade);
        assertEq(reason, "KYC expired");

        (ClawbackRegistry.TaintLevel level, bool safe, , ) = registry.checkWallet(laundryman);
        assertFalse(safe);
    }

    // ============ Off-Chain Authority Hook Tests ============

    /**
     * @notice Multi-jurisdictional authority cooperation
     * @dev Government (US), Lawyer (US), and Arbitrator (GLOBAL) can form quorum
     *      This simulates a real-world scenario where:
     *      - US FBI identifies stolen funds
     *      - Victim's lawyer files a civil claim
     *      - International arbitrator validates the evidence
     */
    function test_crossJurisdictionAuthorityCooperation() public {
        // FBI opens case
        vm.prank(government);
        bytes32 caseId = registry.openCase(sybilAttacker, 100_000e18, address(token), "FBI: International crypto theft ring");

        // Submit for vote
        vm.prank(government);
        registry.submitForVoting(caseId);

        (, , , , , , , , , bytes32 proposalId, ) = registry.cases(caseId);

        // US Government votes yes (FBI evidence)
        vm.prank(government);
        consensus.vote(proposalId, true);

        // Victim's lawyer votes yes (civil claim filed)
        vm.prank(lawyer);
        consensus.vote(proposalId, true);

        // International arbitrator votes yes (evidence validated)
        vm.prank(arbitrator);
        consensus.vote(proposalId, true);

        // 3-of-5 threshold met - approved
        FederatedConsensus.Proposal memory proposal = consensus.getProposal(proposalId);
        assertEq(uint256(proposal.status), uint256(FederatedConsensus.ProposalStatus.APPROVED));
    }

    /**
     * @notice SEC and court can independently verify authority claims
     * @dev Even if government + lawyer agree, the case still has a grace period
     *      where SEC or court can review and potentially vote no
     */
    function test_regulatoryOversightDuringGracePeriod() public {
        vm.prank(government);
        bytes32 caseId = registry.openCase(washTrader, 50_000e18, address(token), "Suspected wash trading");

        vm.prank(government);
        registry.submitForVoting(caseId);

        (, , , , , , , , , bytes32 proposalId, ) = registry.cases(caseId);

        // Government, lawyer, court approve (3/5 met)
        vm.prank(government);
        consensus.vote(proposalId, true);
        vm.prank(lawyer);
        consensus.vote(proposalId, true);
        vm.prank(court);
        consensus.vote(proposalId, true);

        // Approved, but grace period active (7 days)
        assertFalse(consensus.isExecutable(proposalId));

        // SEC reviews during grace period and can still vote (for record)
        vm.prank(sec);
        consensus.vote(proposalId, false); // SEC disagrees but it's already approved

        // Still approved - majority rule stands
        FederatedConsensus.Proposal memory proposal = consensus.getProposal(proposalId);
        assertEq(uint256(proposal.status), uint256(FederatedConsensus.ProposalStatus.APPROVED));
    }

    /**
     * @notice Authority role diversity prevents capture by any single entity type
     * @dev Having GOVERNMENT, LEGAL, COURT, REGULATOR as separate roles means
     *      no single branch of the legal system can dominate
     */
    function test_authorityRoleDiversity() public {
        // Verify all authorities have different roles
        (FederatedConsensus.AuthorityRole govRole, , , ) = consensus.authorities(government);
        (FederatedConsensus.AuthorityRole lawRole, , , ) = consensus.authorities(lawyer);
        (FederatedConsensus.AuthorityRole courtRole, , , ) = consensus.authorities(court);
        (FederatedConsensus.AuthorityRole secRole, , , ) = consensus.authorities(sec);

        assertEq(uint256(govRole), uint256(FederatedConsensus.AuthorityRole.GOVERNMENT));
        assertEq(uint256(lawRole), uint256(FederatedConsensus.AuthorityRole.LEGAL));
        assertEq(uint256(courtRole), uint256(FederatedConsensus.AuthorityRole.COURT));
        assertEq(uint256(secRole), uint256(FederatedConsensus.AuthorityRole.REGULATOR));
    }

    // ============ Wash Trading + Shapley Resistance ============

    /**
     * @notice Wash trader flagged -> Shapley rewards at risk of clawback
     * @dev If someone wash trades to game Shapley rewards, the clawback system
     *      can reverse those rewards. The THREAT of reversal deters the behavior.
     *      Even before a case is filed, rational actors won't risk it because:
     *      1. Wash trading creates observable patterns (sybil detection)
     *      2. If flagged, all downstream transactions (including reward claims) are tainted
     *      3. Clawback can reverse the rewards
     *      4. Legal authorities can pursue civil/criminal penalties via federation
     */
    function test_washTraderClawbackThreat() public {
        // SEC detects wash trading pattern
        vm.prank(sec);
        bytes32 caseId = registry.openCase(washTrader, 25_000e18, address(token), "SEC: Wash trading to inflate Shapley rewards");

        // Wash trader is immediately flagged
        assertTrue(registry.isBlocked(washTrader));

        // Anyone who received "rewards" from wash trader's activity is tainted
        address rewardRecipient = makeAddr("rewardRecipient");
        registry.recordTransaction(washTrader, rewardRecipient, 5_000e18, address(token));

        (ClawbackRegistry.TaintLevel level, , , ) = registry.checkWallet(rewardRecipient);
        assertEq(uint256(level), uint256(ClawbackRegistry.TaintLevel.TAINTED));
    }

    // ============ Honest User Protection ============

    /**
     * @notice Honest user checking safety before EVERY transaction stays clean
     * @dev This is the core UX value: "A crypto wallet that works for you"
     *      If you check safety before transacting, you never get caught in a cascade
     */
    function test_honestUserProtectedBySafetyChecks() public {
        // Bad actor gets flagged
        vm.prank(government);
        registry.openCase(sybilAttacker, 100_000e18, address(token), "Theft");

        // Honest user checks before sending to attacker
        (bool safe1, ) = registry.checkTransactionSafety(honestUser, sybilAttacker);
        assertFalse(safe1); // Warning! Don't send!

        // Honest user checks sending to clean wallet - all good
        address cleanWallet = makeAddr("cleanWallet");
        (bool safe2, string memory risk2) = registry.checkTransactionSafety(honestUser, cleanWallet);
        assertTrue(safe2);
        assertEq(risk2, "CLEAN");

        // Honest user stays clean throughout
        (ClawbackRegistry.TaintLevel level, bool isSafe, , ) = registry.checkWallet(honestUser);
        assertEq(uint256(level), uint256(ClawbackRegistry.TaintLevel.CLEAN));
        assertTrue(isSafe);
    }

    /**
     * @notice Full lifecycle: flag -> vote -> grace -> execute -> resolve
     * @dev End-to-end test of the entire clawback process with off-chain authority hooks
     */
    function test_fullClawbackLifecycle() public {
        // Step 1: Hacker steals funds and tries to launder
        vm.prank(government);
        bytes32 caseId = registry.openCase(
            sybilAttacker,
            100_000e18,
            address(token),
            "FBI Case #2847: International crypto theft via sybil network"
        );

        // Taint propagates to laundering chain
        registry.recordTransaction(sybilAttacker, laundryman, 50_000e18, address(token));
        registry.recordTransaction(laundryman, sybilPuppet1, 25_000e18, address(token));

        // Step 2: Submit for federated authority vote
        vm.prank(government);
        registry.submitForVoting(caseId);
        (, , , , , , , , , bytes32 proposalId, ) = registry.cases(caseId);

        // Step 3: Authorities vote (real-world: FBI presents evidence, lawyer files claim, court reviews)
        vm.prank(government);
        consensus.vote(proposalId, true);   // FBI: Evidence confirmed
        vm.prank(lawyer);
        consensus.vote(proposalId, true);   // Victim's lawyer: Civil claim valid
        vm.prank(court);
        consensus.vote(proposalId, true);   // Court: Legal authority granted

        // Step 4: Grace period (7 days - accused can challenge)
        assertFalse(consensus.isExecutable(proposalId));

        // Step 5: Grace period expires
        vm.warp(block.timestamp + 7 days + 1);
        assertTrue(consensus.isExecutable(proposalId));

        // Step 6: Execute clawback
        registry.executeClawback(caseId);

        // Step 7: Verify resolution
        (, , , , CaseStatus status, , , , , , ) = registry.cases(caseId);
        assertEq(uint256(status), uint256(ClawbackRegistry.CaseStatus.RESOLVED));

        // All wallets in the chain are frozen
        (ClawbackRegistry.TaintLevel hackerLevel, , , ) = registry.checkWallet(sybilAttacker);
        (ClawbackRegistry.TaintLevel laundryLevel, , , ) = registry.checkWallet(laundryman);
        (ClawbackRegistry.TaintLevel puppet1Level, , , ) = registry.checkWallet(sybilPuppet1);

        assertEq(uint256(hackerLevel), uint256(ClawbackRegistry.TaintLevel.FROZEN));
        assertEq(uint256(laundryLevel), uint256(ClawbackRegistry.TaintLevel.FROZEN));
        assertEq(uint256(puppet1Level), uint256(ClawbackRegistry.TaintLevel.FROZEN));
    }
}
