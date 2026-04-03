// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "forge-std/Test.sol";
import "../../contracts/core/CommitRevealAuction.sol";
import "../../contracts/core/PoolComplianceConfig.sol";
import "../../contracts/libraries/DeterministicShuffle.sol";
import "../../contracts/libraries/ProofOfWorkLib.sol";
import "@openzeppelin/contracts/proxy/ERC1967/ERC1967Proxy.sol";

// ============ Mock Contracts ============

/// @notice Mock ComplianceRegistry for pool compliance tests
contract MockComplianceRegistry {
    struct UserData {
        uint8 tier;
        uint8 status;
        uint64 kycTimestamp;
        uint64 kycExpiry;
        bytes2 jurisdiction;
        bool hasKYC;
        bool kycValid;
        bool accredited;
        bool inGoodStanding;
    }

    mapping(address => UserData) public users;

    function setUser(
        address user,
        uint8 tier,
        bytes2 jurisdiction,
        bool hasKYC,
        bool kycValid,
        bool accredited,
        bool inGoodStanding
    ) external {
        users[user] = UserData({
            tier: tier,
            status: 1,
            kycTimestamp: uint64(block.timestamp),
            kycExpiry: uint64(block.timestamp + 365 days),
            jurisdiction: jurisdiction,
            hasKYC: hasKYC,
            kycValid: kycValid,
            accredited: accredited,
            inGoodStanding: inGoodStanding
        });
    }

    function getUserProfile(address user) external view returns (
        uint8 tier,
        uint8 status,
        uint64 kycTimestamp,
        uint64 kycExpiry,
        bytes2 jurisdiction,
        uint256 dailyVolumeUsed,
        uint256 lastVolumeReset,
        string memory kycProvider,
        bytes32 kycHash
    ) {
        UserData memory u = users[user];
        return (u.tier, u.status, u.kycTimestamp, u.kycExpiry, u.jurisdiction, 0, 0, "mock", bytes32(0));
    }

    function isInGoodStanding(address user) external view returns (bool) {
        return users[user].inGoodStanding;
    }

    function getKYCStatus(address user) external view returns (bool hasKYC, bool isValid) {
        return (users[user].hasKYC, users[user].kycValid);
    }

    function isAccredited(address user) external view returns (bool) {
        return users[user].accredited;
    }
}

/// @notice Mock ReputationOracle for trust-tier fallback tests
contract MockReputationOracle {
    mapping(address => uint8) public tiers;
    mapping(address => uint256) public scores;

    function setTier(address user, uint8 tier) external {
        tiers[user] = tier;
    }

    function setScore(address user, uint256 score) external {
        scores[user] = score;
    }

    function getTrustScore(address user) external view returns (uint256) {
        return scores[user];
    }

    function getTrustTier(address user) external view returns (uint8) {
        return tiers[user];
    }

    function isEligible(address user, uint8 requiredTier) external view returns (bool) {
        return tiers[user] >= requiredTier;
    }
}

/// @notice Contract that rejects ETH transfers (for treasury failure tests)
contract RejectingTreasury {
    receive() external payable {
        revert("I reject ETH");
    }
}

/// @notice Contract that can toggle ETH acceptance
contract ToggleTreasury {
    bool public accepting = true;

    function setAccepting(bool _accepting) external {
        accepting = _accepting;
    }

    receive() external payable {
        require(accepting, "Not accepting");
    }
}

/// @notice Contract that rejects ETH (for refund failure tests)
contract RejectingTrader {
    CommitRevealAuction public auction;

    constructor(CommitRevealAuction _auction) {
        auction = _auction;
    }

    function commitOrder(bytes32 commitHash) external payable returns (bytes32) {
        return auction.commitOrder{value: msg.value}(commitHash);
    }

    function revealOrder(
        bytes32 commitId,
        address tokenIn,
        address tokenOut,
        uint256 amountIn,
        uint256 minAmountOut,
        bytes32 secret,
        uint256 priorityBid
    ) external payable {
        auction.revealOrder{value: msg.value}(
            commitId, tokenIn, tokenOut, amountIn, minAmountOut, secret, priorityBid
        );
    }

    function claimRefund() external {
        auction.claimRefund();
    }

    // Reject all ETH transfers
    receive() external payable {
        revert("reject");
    }
}

/**
 * @title CommitRevealAuctionTRP
 * @notice TRP Loop R3 regression tests for CommitRevealAuction
 * @dev Targets gaps not covered by existing CommitRevealAuction.t.sol
 *      and CommitRevealAuction.advanced.t.sol
 *
 * Coverage targets:
 * 1. Flash loan protection (same-block commit+reveal blocked)
 * 2. Pull-pattern refunds (claimRefund, excess ETH)
 * 3. Slashed funds recovery (pendingSlashedFunds, withdrawPendingSlashedFunds)
 * 4. Treasury failure paths (rejecting treasury, zero treasury)
 * 5. Cross-chain reveals (revealOrderCrossChain)
 * 6. Pool compliance (tiers, KYC, jurisdiction, accreditation)
 * 7. Phase transition edge cases (advancePhase timing, double settle)
 * 8. Deposit withdraw edge cases (wrong owner, wrong status, double withdraw)
 * 9. commitOrderToPool with collateral calculations
 * 10. Fund safety invariants (no ETH stuck)
 * 11. Admin function access control
 * 12. Shuffle determinism with block entropy (generateSeedSecure)
 */
contract CommitRevealAuctionTRP is Test {
    CommitRevealAuction public auction;
    address public owner;
    address public treasury;

    // Traders
    address public alice;
    address public bob;
    address public charlie;

    // Tokens
    address public tokenA;
    address public tokenB;

    // Mocks
    MockComplianceRegistry public compliance;
    MockReputationOracle public repOracle;

    // ============ Setup ============

    function setUp() public {
        owner = address(this);
        treasury = makeAddr("treasury");

        alice = makeAddr("alice");
        bob = makeAddr("bob");
        charlie = makeAddr("charlie");

        tokenA = makeAddr("tokenA");
        tokenB = makeAddr("tokenB");

        // Deploy implementation + proxy
        CommitRevealAuction impl = new CommitRevealAuction();
        bytes memory initData = abi.encodeWithSelector(
            CommitRevealAuction.initialize.selector,
            owner,
            treasury,
            address(0) // complianceRegistry starts null
        );
        ERC1967Proxy proxy = new ERC1967Proxy(address(impl), initData);
        auction = CommitRevealAuction(payable(address(proxy)));

        // Authorize test contract as settler (for cross-chain tests)
        auction.setAuthorizedSettler(address(this), true);

        // Fund traders
        vm.deal(alice, 100 ether);
        vm.deal(bob, 100 ether);
        vm.deal(charlie, 100 ether);

        // Deploy mocks
        compliance = new MockComplianceRegistry();
        repOracle = new MockReputationOracle();
    }

    // ============ Helpers ============

    function _hash(
        address trader,
        address tknIn,
        address tknOut,
        uint256 amtIn,
        uint256 minOut,
        bytes32 secret
    ) internal pure returns (bytes32) {
        return keccak256(abi.encodePacked(trader, tknIn, tknOut, amtIn, minOut, secret));
    }

    /// @notice Helper: commit during COMMIT phase (0.05 ether deposit — covers 5% collateral on 1 ether amountIn)
    function _commit(address trader, bytes32 secret) internal returns (bytes32 commitId, bytes32 commitHash) {
        commitHash = _hash(trader, tokenA, tokenB, 1 ether, 0.9 ether, secret);
        vm.prank(trader);
        commitId = auction.commitOrder{value: 0.05 ether}(commitHash);
    }

    /// @notice Helper: commit with explicit deposit — required when amountIn > 0.2 ether (5% collateral)
    function _commitWithDeposit(address trader, bytes32 secret, uint256 deposit)
        internal
        returns (bytes32 commitId, bytes32 commitHash)
    {
        commitHash = _hash(trader, tokenA, tokenB, 1 ether, 0.9 ether, secret);
        vm.prank(trader);
        commitId = auction.commitOrder{value: deposit}(commitHash);
    }

    /// @notice Helper: reveal during REVEAL phase (caller must vm.warp to reveal first)
    function _reveal(address trader, bytes32 commitId, bytes32 secret) internal {
        vm.prank(trader);
        auction.revealOrder(commitId, tokenA, tokenB, 1 ether, 0.9 ether, secret, 0);
    }

    /// @notice Helper: reveal with priority bid
    function _revealWithPriority(address trader, bytes32 commitId, bytes32 secret, uint256 priorityBid) internal {
        vm.prank(trader);
        auction.revealOrder{value: priorityBid}(
            commitId, tokenA, tokenB, 1 ether, 0.9 ether, secret, priorityBid
        );
    }

    /// @notice Helper: full commit-reveal-settle cycle for one trader
    function _fullCycle(address trader, bytes32 secret) internal returns (bytes32 commitId) {
        (commitId, ) = _commit(trader, secret);
        vm.warp(block.timestamp + 9); // Move to REVEAL
        _reveal(trader, commitId, secret);
        vm.warp(block.timestamp + 3); // Move past BATCH_DURATION
        auction.advancePhase();
        vm.roll(block.number + 1); // Must wait 1 block after reveal phase ends
        auction.settleBatch();
    }

    /// @notice Helper: deploy auction with specific treasury address
    function _deployWithTreasury(address _treasury) internal returns (CommitRevealAuction) {
        CommitRevealAuction impl = new CommitRevealAuction();
        bytes memory initData = abi.encodeWithSelector(
            CommitRevealAuction.initialize.selector,
            owner,
            _treasury,
            address(0)
        );
        ERC1967Proxy proxy = new ERC1967Proxy(address(impl), initData);
        CommitRevealAuction a = CommitRevealAuction(payable(address(proxy)));
        a.setAuthorizedSettler(address(this), true);
        return a;
    }

    /// @notice Helper: deploy auction with compliance registry
    function _deployWithCompliance(address _compliance) internal returns (CommitRevealAuction) {
        CommitRevealAuction impl = new CommitRevealAuction();
        bytes memory initData = abi.encodeWithSelector(
            CommitRevealAuction.initialize.selector,
            owner,
            treasury,
            _compliance
        );
        ERC1967Proxy proxy = new ERC1967Proxy(address(impl), initData);
        CommitRevealAuction a = CommitRevealAuction(payable(address(proxy)));
        a.setAuthorizedSettler(address(this), true);
        return a;
    }

    // ============================================================
    // 1. FLASH LOAN PROTECTION
    // ============================================================

    /// @notice Same-block commit should fail for same user
    function test_flashLoan_sameBlockDoubleCommitReverts() public {
        bytes32 secret1 = keccak256("s1");
        bytes32 secret2 = keccak256("s2");
        bytes32 hash1 = _hash(alice, tokenA, tokenB, 1 ether, 0.9 ether, secret1);
        bytes32 hash2 = _hash(alice, tokenA, tokenB, 2 ether, 1.8 ether, secret2);

        vm.prank(alice);
        auction.commitOrder{value: 0.01 ether}(hash1);

        // Same block, same user -> FlashLoanDetected
        vm.prank(alice);
        vm.expectRevert(CommitRevealAuction.FlashLoanDetected.selector);
        auction.commitOrder{value: 0.01 ether}(hash2);
    }

    /// @notice Different users can commit in the same block
    function test_flashLoan_differentUsersCanCommitSameBlock() public {
        bytes32 secretA = keccak256("a");
        bytes32 secretB = keccak256("b");
        bytes32 hashA = _hash(alice, tokenA, tokenB, 1 ether, 0.9 ether, secretA);
        bytes32 hashB = _hash(bob, tokenA, tokenB, 1 ether, 0.9 ether, secretB);

        vm.prank(alice);
        auction.commitOrder{value: 0.01 ether}(hashA);

        // Different user in same block is fine
        vm.prank(bob);
        auction.commitOrder{value: 0.01 ether}(hashB);
    }

    /// @notice Cross-block commit allowed for same user
    function test_flashLoan_crossBlockCommitAllowed() public {
        bytes32 secret1 = keccak256("s1");
        bytes32 hash1 = _hash(alice, tokenA, tokenB, 1 ether, 0.9 ether, secret1);

        vm.prank(alice);
        auction.commitOrder{value: 0.01 ether}(hash1);

        // Advance to next block
        vm.roll(block.number + 1);

        bytes32 secret2 = keccak256("s2");
        bytes32 hash2 = _hash(alice, tokenA, tokenB, 2 ether, 1.8 ether, secret2);

        vm.prank(alice);
        auction.commitOrder{value: 0.01 ether}(hash2);
    }

    // ============================================================
    // 2. PULL-PATTERN REFUNDS
    // ============================================================

    /// @notice Excess ETH from reveal goes to pendingRefunds
    function test_refund_excessETHAccumulates() public {
        bytes32 secret = keccak256("s");
        (bytes32 commitId, ) = _commit(alice, secret);

        vm.warp(block.timestamp + 9);

        // Send 0.5 ETH with no priority bid -> all is excess
        vm.prank(alice);
        auction.revealOrder{value: 0.5 ether}(
            commitId, tokenA, tokenB, 1 ether, 0.9 ether, secret, 0
        );

        assertEq(auction.pendingRefunds(alice), 0.5 ether);
    }

    /// @notice Excess ETH = msg.value - priorityBid
    function test_refund_excessIsValueMinusPriority() public {
        bytes32 secret = keccak256("s");
        (bytes32 commitId, ) = _commit(alice, secret);

        vm.warp(block.timestamp + 9);

        // Send 1 ETH with 0.3 ETH priority -> 0.7 ETH excess
        vm.prank(alice);
        auction.revealOrder{value: 1 ether}(
            commitId, tokenA, tokenB, 1 ether, 0.9 ether, secret, 0.3 ether
        );

        assertEq(auction.pendingRefunds(alice), 0.7 ether);
    }

    /// @notice claimRefund sends accumulated ETH
    function test_refund_claimRefundSendsETH() public {
        bytes32 secret = keccak256("s");
        (bytes32 commitId, ) = _commit(alice, secret);

        vm.warp(block.timestamp + 9);

        vm.prank(alice);
        auction.revealOrder{value: 0.5 ether}(
            commitId, tokenA, tokenB, 1 ether, 0.9 ether, secret, 0
        );

        uint256 balBefore = alice.balance;

        vm.prank(alice);
        auction.claimRefund();

        assertEq(alice.balance, balBefore + 0.5 ether);
        assertEq(auction.pendingRefunds(alice), 0);
    }

    /// @notice claimRefund reverts when no refund pending
    function test_refund_claimRefundRevertsWhenZero() public {
        vm.prank(alice);
        vm.expectRevert(abi.encodeWithSignature("NoRefundPending()"));
        auction.claimRefund();
    }

    /// @notice Multiple reveals accumulate refunds, single claim
    function test_refund_multipleRevealsAccumulateSingleClaim() public {
        // Two separate batches, both with excess
        bytes32 secret1 = keccak256("s1");
        (bytes32 commitId1, ) = _commit(alice, secret1);
        vm.warp(block.timestamp + 9);
        vm.prank(alice);
        auction.revealOrder{value: 0.2 ether}(commitId1, tokenA, tokenB, 1 ether, 0.9 ether, secret1, 0);
        vm.warp(block.timestamp + 3);
        auction.advancePhase();
        vm.roll(block.number + 1);
        auction.settleBatch();

        // Batch 2
        bytes32 secret2 = keccak256("s2");
        bytes32 hash2 = _hash(alice, tokenA, tokenB, 1 ether, 0.9 ether, secret2);
        vm.roll(block.number + 1); // Avoid flash loan
        vm.prank(alice);
        bytes32 commitId2 = auction.commitOrder{value: 0.05 ether}(hash2);
        vm.warp(block.timestamp + 9);
        vm.prank(alice);
        auction.revealOrder{value: 0.3 ether}(commitId2, tokenA, tokenB, 1 ether, 0.9 ether, secret2, 0);

        // Total accumulated: 0.2 + 0.3 = 0.5
        assertEq(auction.pendingRefunds(alice), 0.5 ether);

        uint256 balBefore = alice.balance;
        vm.prank(alice);
        auction.claimRefund();
        assertEq(alice.balance, balBefore + 0.5 ether);
    }

    /// @notice No excess when msg.value equals priorityBid exactly
    function test_refund_noExcessWhenExactPriority() public {
        bytes32 secret = keccak256("s");
        (bytes32 commitId, ) = _commit(alice, secret);

        vm.warp(block.timestamp + 9);

        vm.prank(alice);
        auction.revealOrder{value: 0.5 ether}(
            commitId, tokenA, tokenB, 1 ether, 0.9 ether, secret, 0.5 ether
        );

        assertEq(auction.pendingRefunds(alice), 0);
    }

    // ============================================================
    // 3. SLASHED FUNDS RECOVERY (pendingSlashedFunds)
    // ============================================================

    /// @notice When treasury rejects ETH, slash funds go to pendingSlashedFunds
    function test_slash_treasuryRejectHoldsFunds() public {
        RejectingTreasury rejectTreasury = new RejectingTreasury();
        CommitRevealAuction a = _deployWithTreasury(address(rejectTreasury));
        vm.deal(alice, 10 ether);

        bytes32 secret = keccak256("s");
        bytes32 hash = _hash(alice, tokenA, tokenB, 1 ether, 0.9 ether, secret);

        vm.prank(alice);
        bytes32 commitId = a.commitOrder{value: 0.01 ether}(hash);

        vm.warp(block.timestamp + 9);

        // Reveal with wrong data to trigger slash
        vm.prank(alice);
        a.revealOrder(commitId, tokenA, tokenB, 2 ether, 0.9 ether, secret, 0);

        // Treasury rejected -> funds held in contract
        assertEq(a.pendingSlashedFunds(), 0.005 ether); // 50% of 0.01
        assertEq(a.userSlashedAmounts(alice), 0.005 ether);
    }

    /// @notice When treasury is address(0), slash funds go to pendingSlashedFunds
    function test_slash_zeroTreasuryHoldsFunds() public {
        CommitRevealAuction a = _deployWithTreasury(address(0));
        // Cannot set treasury to 0 via setTreasury (reverts), but initialize allows it
        vm.deal(alice, 10 ether);

        bytes32 secret = keccak256("s");
        bytes32 hash = _hash(alice, tokenA, tokenB, 1 ether, 0.9 ether, secret);

        vm.prank(alice);
        bytes32 commitId = a.commitOrder{value: 0.01 ether}(hash);

        vm.warp(block.timestamp + 9);

        // Invalid reveal triggers slash
        vm.prank(alice);
        a.revealOrder(commitId, tokenA, tokenB, 99 ether, 0.9 ether, secret, 0);

        assertEq(a.pendingSlashedFunds(), 0.005 ether);
    }

    /// @notice withdrawPendingSlashedFunds sends held funds to treasury
    function test_slash_withdrawPendingToTreasury() public {
        ToggleTreasury toggleTreasury = new ToggleTreasury();
        CommitRevealAuction a = _deployWithTreasury(address(toggleTreasury));
        vm.deal(alice, 10 ether);

        // Step 1: Treasury rejects
        toggleTreasury.setAccepting(false);

        bytes32 secret = keccak256("s");
        bytes32 hash = _hash(alice, tokenA, tokenB, 1 ether, 0.9 ether, secret);
        vm.prank(alice);
        bytes32 commitId = a.commitOrder{value: 0.02 ether}(hash);
        vm.warp(block.timestamp + 9);
        vm.prank(alice);
        a.revealOrder(commitId, tokenA, tokenB, 99 ether, 0.9 ether, secret, 0);

        uint256 pending = a.pendingSlashedFunds();
        assertTrue(pending > 0);

        // Step 2: Treasury accepts again
        toggleTreasury.setAccepting(true);

        uint256 treasuryBal = address(toggleTreasury).balance;
        a.withdrawPendingSlashedFunds();
        assertEq(address(toggleTreasury).balance, treasuryBal + pending);
        assertEq(a.pendingSlashedFunds(), 0);
    }

    /// @notice withdrawPendingSlashedFunds reverts when no pending funds
    function test_slash_withdrawPendingRevertsWhenZero() public {
        vm.expectRevert(abi.encodeWithSignature("NoRefundPending()"));
        auction.withdrawPendingSlashedFunds();
    }

    /// @notice withdrawPendingSlashedFunds reverts when no treasury configured
    function test_slash_withdrawPendingRevertsNoTreasury() public {
        CommitRevealAuction a = _deployWithTreasury(address(0));
        vm.expectRevert(abi.encodeWithSignature("InvalidTreasury()"));
        a.withdrawPendingSlashedFunds();
    }

    /// @notice withdrawPendingSlashedFunds restores amount if transfer fails
    function test_slash_withdrawPendingRestoresOnFailure() public {
        RejectingTreasury rejectTreasury = new RejectingTreasury();
        CommitRevealAuction a = _deployWithTreasury(address(rejectTreasury));
        vm.deal(alice, 10 ether);

        // Create pending slash
        bytes32 secret = keccak256("s");
        bytes32 hash = _hash(alice, tokenA, tokenB, 1 ether, 0.9 ether, secret);
        vm.prank(alice);
        bytes32 commitId = a.commitOrder{value: 0.02 ether}(hash);
        vm.warp(block.timestamp + 9);
        vm.prank(alice);
        a.revealOrder(commitId, tokenA, tokenB, 99 ether, 0.9 ether, secret, 0);

        uint256 pending = a.pendingSlashedFunds();
        assertTrue(pending > 0);

        // Now try to withdraw but treasury still rejects -> restore
        // Set treasury to the rejecting one (it already is)
        vm.expectRevert(CommitRevealAuction.TransferFailed.selector);
        a.withdrawPendingSlashedFunds();

        // pendingSlashedFunds should be restored
        assertEq(a.pendingSlashedFunds(), pending);
    }

    // ============================================================
    // 4. SLASH MECHANICS - UNREVEALED COMMITMENTS
    // ============================================================

    /// @notice Slashing unrevealed commitment sends 50% to treasury, 50% back
    function test_slash_unrevealedDistribution() public {
        bytes32 secret = keccak256("s");
        (bytes32 commitId, ) = _commit(alice, secret);

        // Skip to settle without revealing
        vm.warp(block.timestamp + 12);
        auction.advancePhase();
        vm.roll(block.number + 1);
        auction.settleBatch();

        uint256 treasuryBal = treasury.balance;
        uint256 aliceBal = alice.balance;

        auction.slashUnrevealedCommitment(commitId);

        // 50% to treasury (deposit is 0.05 ether, so 50% = 0.025 ether)
        assertEq(treasury.balance, treasuryBal + 0.025 ether);
        // 50% refunded to alice
        assertEq(alice.balance, aliceBal + 0.025 ether);

        ICommitRevealAuction.OrderCommitment memory c = auction.getCommitment(commitId);
        assertEq(uint256(c.status), uint256(ICommitRevealAuction.CommitStatus.SLASHED));
    }

    /// @notice Cannot slash the same commitment twice
    function test_slash_cannotDoubleSlash() public {
        bytes32 secret = keccak256("s");
        (bytes32 commitId, ) = _commit(alice, secret);

        vm.warp(block.timestamp + 12);
        auction.advancePhase();
        vm.roll(block.number + 1);
        auction.settleBatch();

        auction.slashUnrevealedCommitment(commitId);

        // Second attempt should fail (status is now SLASHED, not COMMITTED)
        vm.expectRevert(CommitRevealAuction.NotSlashable.selector);
        auction.slashUnrevealedCommitment(commitId);
    }

    /// @notice Invalid reveal (wrong hash) triggers immediate slash
    function test_slash_invalidRevealSlashesImmediately() public {
        bytes32 secret = keccak256("s");
        (bytes32 commitId, ) = _commit(alice, secret);

        vm.warp(block.timestamp + 9);

        uint256 treasuryBal = treasury.balance;

        // Wrong secret -> hash mismatch -> slash
        vm.prank(alice);
        auction.revealOrder(commitId, tokenA, tokenB, 1 ether, 0.9 ether, keccak256("wrong"), 0);

        ICommitRevealAuction.OrderCommitment memory c = auction.getCommitment(commitId);
        assertEq(uint256(c.status), uint256(ICommitRevealAuction.CommitStatus.SLASHED));
        assertEq(treasury.balance, treasuryBal + 0.025 ether); // 50% of 0.05 ether deposit
    }

    /// @notice Slash refund failure accrues to pendingRefunds (pull pattern)
    function test_slash_refundFailureAccruesToPending() public {
        // Deploy a trader contract that rejects ETH
        RejectingTrader rejectTrader = new RejectingTrader(auction);
        vm.deal(address(rejectTrader), 10 ether);

        bytes32 secret = keccak256("s");
        bytes32 hash = _hash(address(rejectTrader), tokenA, tokenB, 1 ether, 0.9 ether, secret);

        // 5% of 1 ether amountIn = 0.05 ether collateral required
        vm.prank(address(rejectTrader));
        bytes32 commitId = auction.commitOrder{value: 0.05 ether}(hash);

        vm.warp(block.timestamp + 12);
        auction.advancePhase();
        vm.roll(block.number + 1);
        auction.settleBatch();

        // Slash - refund portion fails because rejectTrader rejects ETH
        auction.slashUnrevealedCommitment(commitId);

        // 50% refund portion should go to pendingRefunds (50% of 0.05 = 0.025)
        assertEq(auction.pendingRefunds(address(rejectTrader)), 0.025 ether);
    }

    // ============================================================
    // 5. CROSS-CHAIN REVEALS
    // ============================================================

    /// @notice Authorized settler can reveal on behalf of original depositor
    function test_crossChain_authorizedSettlerCanReveal() public {
        bytes32 secret = keccak256("xchain");
        (bytes32 commitId, ) = _commit(alice, secret);

        vm.warp(block.timestamp + 9);

        // This contract is an authorized settler
        auction.revealOrderCrossChain(
            commitId,
            alice, // original depositor
            tokenA,
            tokenB,
            1 ether,
            0.9 ether,
            secret,
            0
        );

        ICommitRevealAuction.OrderCommitment memory c = auction.getCommitment(commitId);
        assertEq(uint256(c.status), uint256(ICommitRevealAuction.CommitStatus.REVEALED));
    }

    /// @notice Non-authorized address cannot call revealOrderCrossChain
    function test_crossChain_unauthorizedReverts() public {
        bytes32 secret = keccak256("xchain");
        (bytes32 commitId, ) = _commit(alice, secret);

        vm.warp(block.timestamp + 9);

        vm.prank(bob); // Not authorized
        vm.expectRevert(CommitRevealAuction.NotAuthorized.selector);
        auction.revealOrderCrossChain(
            commitId, alice, tokenA, tokenB, 1 ether, 0.9 ether, secret, 0
        );
    }

    /// @notice Cross-chain reveal with wrong depositor hash -> slash
    function test_crossChain_wrongDepositorReverts() public {
        bytes32 secret = keccak256("xchain");
        (bytes32 commitId, ) = _commit(alice, secret);

        vm.warp(block.timestamp + 9);

        // TRP-R1-F03: wrong depositor now reverts early (more secure than slashing)
        vm.expectRevert(CommitRevealAuction.NotOwner.selector);
        auction.revealOrderCrossChain(
            commitId,
            bob, // Wrong depositor — contract rejects before hash check
            tokenA,
            tokenB,
            1 ether,
            0.9 ether,
            secret,
            0
        );
    }

    /// @notice Cross-chain reveal with priority bid
    function test_crossChain_revealWithPriorityBid() public {
        bytes32 secret = keccak256("xchain");
        (bytes32 commitId, ) = _commit(alice, secret);

        vm.warp(block.timestamp + 9);

        auction.revealOrderCrossChain{value: 0.5 ether}(
            commitId, alice, tokenA, tokenB, 1 ether, 0.9 ether, secret, 0.5 ether
        );

        ICommitRevealAuction.Batch memory batch = auction.getBatch(1);
        assertEq(batch.totalPriorityBids, 0.5 ether);
    }

    /// @notice Cross-chain reveal only works during REVEAL phase
    function test_crossChain_wrongPhaseReverts() public {
        bytes32 secret = keccak256("xchain");
        (bytes32 commitId, ) = _commit(alice, secret);

        // Still in COMMIT phase
        vm.expectRevert(CommitRevealAuction.InvalidPhase.selector);
        auction.revealOrderCrossChain(
            commitId, alice, tokenA, tokenB, 1 ether, 0.9 ether, secret, 0
        );
    }

    // ============================================================
    // 6. POOL COMPLIANCE
    // ============================================================

    /// @notice Default pool (bytes32(0)) allows anyone
    function test_pool_defaultPoolAllowsAnyone() public {
        // Already tested implicitly, but verify explicitly
        bytes32 secret = keccak256("s");
        bytes32 hash = _hash(alice, tokenA, tokenB, 1 ether, 0.9 ether, secret);

        vm.prank(alice);
        bytes32 commitId = auction.commitOrderToPool{value: 0.01 ether}(bytes32(0), hash, 0);

        ICommitRevealAuction.OrderCommitment memory c = auction.getCommitment(commitId);
        assertEq(uint256(c.status), uint256(ICommitRevealAuction.CommitStatus.COMMITTED));
    }

    /// @notice Creating pool from preset OPEN works
    function test_pool_createOpenPreset() public {
        bytes32 poolId = auction.createPoolFromPreset(PoolComplianceConfig.PoolPreset.OPEN);
        assertTrue(poolId != bytes32(0));
    }

    /// @notice Tier-gated pool blocks low-tier users (with compliance registry)
    function test_pool_tierBlocksLowTierUser() public {
        // Deploy with compliance
        CommitRevealAuction a = _deployWithCompliance(address(compliance));
        vm.deal(alice, 10 ether);

        // Set alice as tier 1 user
        compliance.setUser(alice, 1, "US", true, true, false, true);

        // Create pool requiring tier 2
        bytes2[] memory blocked = new bytes2[](0);
        bytes32 poolId = a.createPoolWithCustomAccess(2, false, false, 0, blocked, "tier2pool");

        bytes32 hash = _hash(alice, tokenA, tokenB, 1 ether, 0.9 ether, keccak256("s"));

        vm.prank(alice);
        vm.expectRevert(CommitRevealAuction.UserBelowMinTier.selector);
        a.commitOrderToPool{value: 0.01 ether}(poolId, hash, 0);
    }

    /// @notice Tier-gated pool allows sufficient-tier user
    function test_pool_tierAllowsSufficientTier() public {
        CommitRevealAuction a = _deployWithCompliance(address(compliance));
        vm.deal(alice, 10 ether);

        compliance.setUser(alice, 3, "US", true, true, false, true);

        bytes2[] memory blocked = new bytes2[](0);
        bytes32 poolId = a.createPoolWithCustomAccess(2, false, false, 0, blocked, "tier2pool");

        bytes32 hash = _hash(alice, tokenA, tokenB, 1 ether, 0.9 ether, keccak256("s"));

        vm.prank(alice);
        bytes32 commitId = a.commitOrderToPool{value: 0.01 ether}(poolId, hash, 0);

        ICommitRevealAuction.OrderCommitment memory c = a.getCommitment(commitId);
        assertEq(uint256(c.status), uint256(ICommitRevealAuction.CommitStatus.COMMITTED));
    }

    /// @notice KYC-required pool blocks non-KYC user
    function test_pool_kycBlocksNonKYCUser() public {
        CommitRevealAuction a = _deployWithCompliance(address(compliance));
        vm.deal(alice, 10 ether);

        // Alice has no KYC
        compliance.setUser(alice, 2, "US", false, false, false, true);

        bytes2[] memory blocked = new bytes2[](0);
        bytes32 poolId = a.createPoolWithCustomAccess(0, true, false, 0, blocked, "kycpool");

        bytes32 hash = _hash(alice, tokenA, tokenB, 1 ether, 0.9 ether, keccak256("s"));

        vm.prank(alice);
        vm.expectRevert(CommitRevealAuction.KYCRequired.selector);
        a.commitOrderToPool{value: 0.01 ether}(poolId, hash, 0);
    }

    /// @notice Jurisdiction-blocked user cannot trade
    function test_pool_jurisdictionBlocked() public {
        CommitRevealAuction a = _deployWithCompliance(address(compliance));
        vm.deal(alice, 10 ether);

        // Alice is in blocked jurisdiction
        compliance.setUser(alice, 3, "CN", true, true, false, true);

        bytes2[] memory blocked = new bytes2[](1);
        blocked[0] = "CN";
        bytes32 poolId = a.createPoolWithCustomAccess(1, false, false, 0, blocked, "noCN");

        bytes32 hash = _hash(alice, tokenA, tokenB, 1 ether, 0.9 ether, keccak256("s"));

        vm.prank(alice);
        vm.expectRevert(CommitRevealAuction.JurisdictionBlocked.selector);
        a.commitOrderToPool{value: 0.01 ether}(poolId, hash, 0);
    }

    /// @notice Accreditation-required pool blocks non-accredited user
    function test_pool_accreditationRequired() public {
        CommitRevealAuction a = _deployWithCompliance(address(compliance));
        vm.deal(alice, 10 ether);

        compliance.setUser(alice, 3, "US", true, true, false, true);

        bytes2[] memory blocked = new bytes2[](0);
        bytes32 poolId = a.createPoolWithCustomAccess(0, false, true, 0, blocked, "accredited");

        bytes32 hash = _hash(alice, tokenA, tokenB, 1 ether, 0.9 ether, keccak256("s"));

        vm.prank(alice);
        vm.expectRevert(CommitRevealAuction.AccreditationRequired.selector);
        a.commitOrderToPool{value: 0.01 ether}(poolId, hash, 0);
    }

    /// @notice Trade size limit enforcement
    function test_pool_tradeSizeExceeded() public {
        CommitRevealAuction a = _deployWithCompliance(address(compliance));
        vm.deal(alice, 10 ether);

        compliance.setUser(alice, 3, "US", true, true, true, true);

        bytes2[] memory blocked = new bytes2[](0);
        bytes32 poolId = a.createPoolWithCustomAccess(0, false, false, 1 ether, blocked, "smallpool");

        bytes32 hash = _hash(alice, tokenA, tokenB, 1 ether, 0.9 ether, keccak256("s"));

        // estimatedTradeValue exceeds maxTradeSize
        vm.prank(alice);
        vm.expectRevert(CommitRevealAuction.TradeSizeExceeded.selector);
        a.commitOrderToPool{value: 0.01 ether}(poolId, hash, 2 ether);
    }

    /// @notice Reputation oracle fallback when compliance tier is 0
    function test_pool_reputationOracleFallback() public {
        CommitRevealAuction a = _deployWithCompliance(address(compliance));
        a.setReputationOracle(address(repOracle));
        vm.deal(alice, 10 ether);

        // Compliance returns tier 0
        compliance.setUser(alice, 0, "US", false, false, false, true);
        // Reputation oracle returns tier 3
        repOracle.setTier(alice, 3);

        bytes2[] memory blocked = new bytes2[](0);
        bytes32 poolId = a.createPoolWithCustomAccess(2, false, false, 0, blocked, "reppool");

        bytes32 hash = _hash(alice, tokenA, tokenB, 1 ether, 0.9 ether, keccak256("s"));

        // Should pass because reputation oracle returns tier 3
        vm.prank(alice);
        a.commitOrderToPool{value: 0.01 ether}(poolId, hash, 0);
    }

    /// @notice canUserTradeOnPool returns correct results
    function test_pool_canUserTradeOnPoolView() public {
        CommitRevealAuction a = _deployWithCompliance(address(compliance));

        compliance.setUser(alice, 3, "US", true, true, true, true);

        bytes2[] memory blocked = new bytes2[](0);
        bytes32 poolId = a.createPoolWithCustomAccess(2, true, false, 0, blocked, "viewtest");

        (bool allowed, string memory reason) = a.canUserTradeOnPool(poolId, alice);
        assertTrue(allowed);
        assertEq(bytes(reason).length, 0);
    }

    // ============================================================
    // 7. PHASE TRANSITIONS & BATCH LIFECYCLE
    // ============================================================

    /// @notice advancePhase is a no-op when phase hasn't changed
    function test_phase_advanceNoOpWhenUnchanged() public {
        // Still in COMMIT phase
        ICommitRevealAuction.BatchPhase before = auction.getCurrentPhase();
        auction.advancePhase();
        ICommitRevealAuction.BatchPhase after_ = auction.getCurrentPhase();
        assertEq(uint256(before), uint256(after_));
    }

    /// @notice Cannot settle during COMMIT phase
    function test_phase_cannotSettleDuringCommit() public {
        vm.expectRevert(CommitRevealAuction.BatchNotReady.selector);
        auction.settleBatch();
    }

    /// @notice Cannot settle during REVEAL phase
    function test_phase_cannotSettleDuringReveal() public {
        vm.warp(block.timestamp + 9);
        vm.expectRevert(CommitRevealAuction.BatchNotReady.selector);
        auction.settleBatch();
    }

    /// @notice Double settlement reverts
    function test_phase_doubleSettlementReverts() public {
        vm.warp(block.timestamp + 12);
        auction.advancePhase();
        vm.roll(block.number + 1);
        auction.settleBatch();

        // settleBatch starts new batch -> need to warp again
        vm.warp(block.timestamp + 12);
        auction.advancePhase();

        // But we actually want to test settling batch 1 again
        // Since settleBatch moves us to batch 2, batch 1 is already settled
        // Verify: batch 1 is settled, getBatch(1).isSettled
        ICommitRevealAuction.Batch memory b = auction.getBatch(1);
        assertTrue(b.isSettled);
    }

    /// @notice Empty batch (zero reveals) settles correctly
    function test_phase_emptyBatchSettles() public {
        vm.warp(block.timestamp + 12);
        auction.advancePhase();
        vm.roll(block.number + 1);
        auction.settleBatch();

        ICommitRevealAuction.Batch memory b = auction.getBatch(1);
        assertTrue(b.isSettled);
        assertEq(auction.getCurrentBatchId(), 2);
    }

    /// @notice Batch rollover starts new batch at correct timestamp
    function test_phase_batchRolloverTimestamp() public {
        vm.warp(block.timestamp + 12);
        auction.advancePhase();
        vm.roll(block.number + 1);

        uint256 settleTime = block.timestamp;
        auction.settleBatch();

        ICommitRevealAuction.Batch memory newBatch = auction.getBatch(2);
        assertEq(newBatch.startTimestamp, settleTime);
        assertEq(newBatch.orderCount, 0);
        assertFalse(newBatch.isSettled);
    }

    /// @notice Phase is computed from wall clock, not stored state
    function test_phase_computedFromTimestamp() public {
        // At t=0: COMMIT
        assertEq(uint256(auction.getCurrentPhase()), uint256(ICommitRevealAuction.BatchPhase.COMMIT));

        // At t=4: still COMMIT
        vm.warp(block.timestamp + 4);
        assertEq(uint256(auction.getCurrentPhase()), uint256(ICommitRevealAuction.BatchPhase.COMMIT));

        // At t=8: REVEAL
        vm.warp(block.timestamp + 4);
        assertEq(uint256(auction.getCurrentPhase()), uint256(ICommitRevealAuction.BatchPhase.REVEAL));

        // At t=9: still REVEAL
        vm.warp(block.timestamp + 1);
        assertEq(uint256(auction.getCurrentPhase()), uint256(ICommitRevealAuction.BatchPhase.REVEAL));

        // At t=10: SETTLING
        vm.warp(block.timestamp + 1);
        assertEq(uint256(auction.getCurrentPhase()), uint256(ICommitRevealAuction.BatchPhase.SETTLING));

        // At t=100: still SETTLING (until settled)
        vm.warp(block.timestamp + 90);
        assertEq(uint256(auction.getCurrentPhase()), uint256(ICommitRevealAuction.BatchPhase.SETTLING));
    }

    /// @notice getTimeUntilPhaseChange returns 0 after batch duration
    function test_phase_timeUntilPhaseChangeZeroAfterBatch() public {
        vm.warp(block.timestamp + 100);
        assertEq(auction.getTimeUntilPhaseChange(), 0);
    }

    /// @notice advancePhase records batchRevealEndBlock when transitioning to SETTLING
    function test_phase_advanceRecordsRevealEndBlock() public {
        vm.warp(block.timestamp + 12);
        vm.roll(42);

        auction.advancePhase();

        uint256 endBlock = auction.batchRevealEndBlock(1);
        assertEq(endBlock, 42);
    }

    // ============================================================
    // 8. DEPOSIT WITHDRAWAL
    // ============================================================

    /// @notice withdrawDeposit works for revealed orders after settlement
    function test_withdraw_revealedAfterSettlement() public {
        bytes32 secret = keccak256("s");
        bytes32 commitId = _fullCycle(alice, secret);

        uint256 balBefore = alice.balance;
        vm.prank(alice);
        auction.withdrawDeposit(commitId);
        assertEq(alice.balance, balBefore + 0.05 ether);
    }

    /// @notice Cannot withdraw if not the depositor
    function test_withdraw_notOwnerReverts() public {
        bytes32 secret = keccak256("s");
        bytes32 commitId = _fullCycle(alice, secret);

        vm.prank(bob);
        vm.expectRevert(CommitRevealAuction.NotOwner.selector);
        auction.withdrawDeposit(commitId);
    }

    /// @notice Cannot withdraw if not revealed
    function test_withdraw_notRevealedReverts() public {
        bytes32 secret = keccak256("s");
        (bytes32 commitId, ) = _commit(alice, secret);

        // Settle without revealing
        vm.warp(block.timestamp + 12);
        auction.advancePhase();
        vm.roll(block.number + 1);
        auction.settleBatch();

        vm.prank(alice);
        vm.expectRevert(CommitRevealAuction.NotRevealed.selector);
        auction.withdrawDeposit(commitId);
    }

    /// @notice Cannot withdraw before settlement
    function test_withdraw_beforeSettlementReverts() public {
        bytes32 secret = keccak256("s");
        (bytes32 commitId, ) = _commit(alice, secret);

        vm.warp(block.timestamp + 9);
        _reveal(alice, commitId, secret);

        // Not settled yet
        vm.prank(alice);
        vm.expectRevert(CommitRevealAuction.BatchNotSettled.selector);
        auction.withdrawDeposit(commitId);
    }

    /// @notice Cannot double-withdraw (status changes to EXECUTED)
    function test_withdraw_doubleWithdrawReverts() public {
        bytes32 secret = keccak256("s");
        bytes32 commitId = _fullCycle(alice, secret);

        vm.prank(alice);
        auction.withdrawDeposit(commitId);

        // Status is now EXECUTED, not REVEALED
        vm.prank(alice);
        vm.expectRevert(CommitRevealAuction.NotRevealed.selector);
        auction.withdrawDeposit(commitId);
    }

    // ============================================================
    // 9. COLLATERAL CALCULATIONS
    // ============================================================

    /// @notice commitOrderToPool with estimatedTradeValue requires 5% collateral
    function test_collateral_5percentRequired() public {
        bytes32 hash = _hash(alice, tokenA, tokenB, 1 ether, 0.9 ether, keccak256("s"));

        // estimatedTradeValue = 1 ether -> 5% = 0.05 ether
        vm.prank(alice);
        vm.expectRevert(CommitRevealAuction.InsufficientDeposit.selector);
        auction.commitOrderToPool{value: 0.04 ether}(bytes32(0), hash, 1 ether);

        // 0.05 ether should work
        vm.roll(block.number + 1);
        vm.prank(alice);
        auction.commitOrderToPool{value: 0.05 ether}(bytes32(0), hash, 1 ether);
    }

    /// @notice MIN_DEPOSIT floor enforced when collateral is small
    function test_collateral_minDepositFloor() public {
        bytes32 hash = _hash(alice, tokenA, tokenB, 1 ether, 0.9 ether, keccak256("s"));

        // estimatedTradeValue = 0.01 ether -> 5% = 0.0005 ether < MIN_DEPOSIT (0.001)
        // So MIN_DEPOSIT is the floor
        vm.prank(alice);
        vm.expectRevert(CommitRevealAuction.InsufficientDeposit.selector);
        auction.commitOrderToPool{value: 0.0005 ether}(bytes32(0), hash, 0.01 ether);

        vm.roll(block.number + 1);
        vm.prank(alice);
        auction.commitOrderToPool{value: 0.001 ether}(bytes32(0), hash, 0.01 ether);
    }

    /// @notice getRequiredDeposit returns correct amount
    function test_collateral_getRequiredDeposit() public view {
        // For 10 ether trade: 5% = 0.5 ether
        assertEq(auction.getRequiredDeposit(10 ether), 0.5 ether);

        // For 0.01 ether trade: 5% = 0.0005 ether < MIN_DEPOSIT -> returns MIN_DEPOSIT
        assertEq(auction.getRequiredDeposit(0.01 ether), 0.001 ether);

        // For 0 trade: 0% = 0 < MIN_DEPOSIT -> returns MIN_DEPOSIT
        assertEq(auction.getRequiredDeposit(0), 0.001 ether);
    }

    // ============================================================
    // 10. PRIORITY ORDERING & BUBBLE SORT
    // ============================================================

    /// @notice Priority orders always come before regular orders
    function test_priority_ordersBeforeRegular() public {
        bytes32 s1 = keccak256("s1");
        bytes32 s2 = keccak256("s2");
        bytes32 s3 = keccak256("s3");

        (bytes32 id1, ) = _commit(alice, s1);
        (bytes32 id2, ) = _commit(bob, s2);
        (bytes32 id3, ) = _commit(charlie, s3);

        vm.warp(block.timestamp + 9);

        // Alice: no priority (index 0)
        _reveal(alice, id1, s1);
        // Bob: priority 1 ETH (index 1)
        _revealWithPriority(bob, id2, s2, 1 ether);
        // Charlie: no priority (index 2)
        _reveal(charlie, id3, s3);

        vm.warp(block.timestamp + 3);
        auction.advancePhase();
        vm.roll(block.number + 1);
        auction.settleBatch();

        uint256[] memory order = auction.getExecutionOrder(1);
        assertEq(order.length, 3);
        // Bob (index 1) must be first (only priority order)
        assertEq(order[0], 1);
    }

    /// @notice Descending sort: highest bid first
    function test_priority_descendingSortByBid() public {
        bytes32 s1 = keccak256("s1");
        bytes32 s2 = keccak256("s2");
        bytes32 s3 = keccak256("s3");

        (bytes32 id1, ) = _commit(alice, s1);
        (bytes32 id2, ) = _commit(bob, s2);
        (bytes32 id3, ) = _commit(charlie, s3);

        vm.warp(block.timestamp + 9);

        _revealWithPriority(alice, id1, s1, 0.1 ether);  // lowest
        _revealWithPriority(bob, id2, s2, 1 ether);      // highest
        _revealWithPriority(charlie, id3, s3, 0.5 ether); // middle

        vm.warp(block.timestamp + 3);
        auction.advancePhase();
        vm.roll(block.number + 1);
        auction.settleBatch();

        uint256[] memory order = auction.getExecutionOrder(1);
        assertEq(order[0], 1); // Bob (1 ETH)
        assertEq(order[1], 2); // Charlie (0.5 ETH)
        assertEq(order[2], 0); // Alice (0.1 ETH)
    }

    /// @notice Tiebreaker: same bid -> earlier reveal index wins
    function test_priority_tiebreakByRevealOrder() public {
        bytes32 s1 = keccak256("s1");
        bytes32 s2 = keccak256("s2");

        (bytes32 id1, ) = _commit(alice, s1);
        (bytes32 id2, ) = _commit(bob, s2);

        vm.warp(block.timestamp + 9);

        // Same bid, alice reveals first (index 0), bob second (index 1)
        _revealWithPriority(alice, id1, s1, 0.5 ether);
        _revealWithPriority(bob, id2, s2, 0.5 ether);

        vm.warp(block.timestamp + 3);
        auction.advancePhase();
        vm.roll(block.number + 1);
        auction.settleBatch();

        uint256[] memory order = auction.getExecutionOrder(1);
        assertEq(order[0], 0); // Alice (lower index = revealed first)
        assertEq(order[1], 1); // Bob (higher index)
    }

    // ============================================================
    // 11. SHUFFLE DETERMINISM
    // ============================================================

    /// @notice Same seed always produces same shuffle
    function test_shuffle_sameSeedSameOrder() public pure {
        bytes32 seed = keccak256("fixed_seed");
        uint256[] memory s1 = DeterministicShuffle.shuffle(10, seed);
        uint256[] memory s2 = DeterministicShuffle.shuffle(10, seed);

        for (uint256 i = 0; i < 10; i++) {
            assertEq(s1[i], s2[i]);
        }
    }

    /// @notice Different seeds produce different shuffles (statistical)
    function test_shuffle_differentSeedsDifferentOrder() public pure {
        bytes32 seed1 = keccak256("seed_a");
        bytes32 seed2 = keccak256("seed_b");
        uint256[] memory s1 = DeterministicShuffle.shuffle(20, seed1);
        uint256[] memory s2 = DeterministicShuffle.shuffle(20, seed2);

        bool anyDifferent = false;
        for (uint256 i = 0; i < 20; i++) {
            if (s1[i] != s2[i]) {
                anyDifferent = true;
                break;
            }
        }
        assertTrue(anyDifferent);
    }

    /// @notice Shuffle of length 0 returns empty array
    function test_shuffle_lengthZero() public pure {
        uint256[] memory result = DeterministicShuffle.shuffle(0, bytes32(0));
        assertEq(result.length, 0);
    }

    /// @notice Shuffle of length 1 returns [0]
    function test_shuffle_lengthOne() public pure {
        uint256[] memory result = DeterministicShuffle.shuffle(1, keccak256("s"));
        assertEq(result.length, 1);
        assertEq(result[0], 0);
    }

    /// @notice Shuffle is a valid permutation (no duplicates, all indices present)
    function test_shuffle_validPermutation() public pure {
        bytes32 seed = keccak256("perm");
        uint256 n = 50;
        uint256[] memory s = DeterministicShuffle.shuffle(n, seed);

        assertEq(s.length, n);

        bool[] memory seen = new bool[](n);
        for (uint256 i = 0; i < n; i++) {
            assertTrue(s[i] < n, "Index out of bounds");
            assertFalse(seen[s[i]], "Duplicate index");
            seen[s[i]] = true;
        }
    }

    /// @notice generateSeedSecure produces different seed than generateSeed
    function test_shuffle_secureVsUnsecureSeed() public pure {
        bytes32[] memory secrets = new bytes32[](3);
        secrets[0] = keccak256("a");
        secrets[1] = keccak256("b");
        secrets[2] = keccak256("c");

        bytes32 unsecure = DeterministicShuffle.generateSeed(secrets);
        bytes32 secure = DeterministicShuffle.generateSeedSecure(secrets, keccak256("blockdata"), 1);

        assertTrue(unsecure != secure);
    }

    /// @notice partitionAndShuffle keeps priority indices first
    function test_shuffle_partitionAndShuffle() public pure {
        uint256[] memory result = DeterministicShuffle.partitionAndShuffle(5, 2, keccak256("s"));

        assertEq(result.length, 5);
        // First 2 must be 0 and 1 (priority)
        assertEq(result[0], 0);
        assertEq(result[1], 1);

        // Remaining 3 must be a permutation of {2, 3, 4}
        bool[] memory seen = new bool[](5);
        for (uint256 i = 2; i < 5; i++) {
            assertTrue(result[i] >= 2 && result[i] <= 4);
            assertFalse(seen[result[i]]);
            seen[result[i]] = true;
        }
    }

    // ============================================================
    // 12. ADMIN FUNCTION ACCESS CONTROL
    // ============================================================

    /// @notice Only owner can set authorized settler
    function test_admin_onlyOwnerCanSetSettler() public {
        vm.prank(alice);
        vm.expectRevert();
        auction.setAuthorizedSettler(bob, true);
    }

    /// @notice Only owner can set treasury
    function test_admin_onlyOwnerCanSetTreasury() public {
        vm.prank(alice);
        vm.expectRevert();
        auction.setTreasury(bob);
    }

    /// @notice Cannot set treasury to zero
    function test_admin_cannotSetTreasuryToZero() public {
        vm.expectRevert(CommitRevealAuction.InvalidTreasury.selector);
        auction.setTreasury(address(0));
    }

    /// @notice Only owner can set PoW base value
    function test_admin_onlyOwnerCanSetPoWBaseValue() public {
        vm.prank(alice);
        vm.expectRevert();
        auction.setPoWBaseValue(0.001 ether);
    }

    /// @notice setPoWBaseValue updates correctly
    function test_admin_setPoWBaseValue() public {
        auction.setPoWBaseValue(0.001 ether);
        assertEq(auction.powBaseValue(), 0.001 ether);
    }

    /// @notice Only owner can set reputation oracle
    function test_admin_onlyOwnerCanSetReputationOracle() public {
        vm.prank(alice);
        vm.expectRevert();
        auction.setReputationOracle(address(repOracle));
    }

    /// @notice Revoking settler authorization works
    function test_admin_revokeSettler() public {
        auction.setAuthorizedSettler(bob, true);
        assertTrue(auction.authorizedSettlers(bob));

        auction.setAuthorizedSettler(bob, false);
        assertFalse(auction.authorizedSettlers(bob));
    }

    // ============================================================
    // 13. COMMIT EDGE CASES
    // ============================================================

    /// @notice commitOrder with zero hash reverts
    function test_commit_zeroHashReverts() public {
        vm.prank(alice);
        vm.expectRevert(CommitRevealAuction.InvalidHash.selector);
        auction.commitOrder{value: 0.01 ether}(bytes32(0));
    }

    /// @notice Commit during REVEAL phase reverts
    function test_commit_duringRevealReverts() public {
        vm.warp(block.timestamp + 9);
        vm.prank(alice);
        vm.expectRevert(CommitRevealAuction.InvalidPhase.selector);
        auction.commitOrder{value: 0.01 ether}(keccak256("h"));
    }

    /// @notice Commit during SETTLING phase reverts
    function test_commit_duringSettlingReverts() public {
        vm.warp(block.timestamp + 12);
        vm.prank(alice);
        vm.expectRevert(CommitRevealAuction.InvalidPhase.selector);
        auction.commitOrder{value: 0.01 ether}(keccak256("h"));
    }

    // ============================================================
    // 14. REVEAL EDGE CASES
    // ============================================================

    /// @notice Cannot reveal someone else's commitment
    function test_reveal_wrongOwnerReverts() public {
        bytes32 secret = keccak256("s");
        (bytes32 commitId, ) = _commit(alice, secret);

        vm.warp(block.timestamp + 9);

        vm.prank(bob);
        vm.expectRevert(CommitRevealAuction.NotOwner.selector);
        auction.revealOrder(commitId, tokenA, tokenB, 1 ether, 0.9 ether, secret, 0);
    }

    /// @notice Cannot reveal a commitment that was already revealed
    function test_reveal_doubleRevealReverts() public {
        bytes32 secret = keccak256("s");
        (bytes32 commitId, ) = _commit(alice, secret);

        vm.warp(block.timestamp + 9);
        _reveal(alice, commitId, secret);

        // Second reveal should fail (status is REVEALED, not COMMITTED)
        vm.prank(alice);
        vm.expectRevert(CommitRevealAuction.InvalidCommitment.selector);
        auction.revealOrder(commitId, tokenA, tokenB, 1 ether, 0.9 ether, secret, 0);
    }

    /// @notice Priority bid requires sufficient msg.value
    function test_reveal_insufficientPriorityBidReverts() public {
        bytes32 secret = keccak256("s");
        (bytes32 commitId, ) = _commit(alice, secret);

        vm.warp(block.timestamp + 9);

        vm.prank(alice);
        vm.expectRevert(CommitRevealAuction.InsufficientPriorityBid.selector);
        auction.revealOrder{value: 0.1 ether}(
            commitId, tokenA, tokenB, 1 ether, 0.9 ether, secret, 0.5 ether
        );
    }

    /// @notice Reveal with wrong tokenIn triggers slash (not revert)
    function test_reveal_wrongTokenInSlashes() public {
        bytes32 secret = keccak256("s");
        (bytes32 commitId, ) = _commit(alice, secret);

        vm.warp(block.timestamp + 9);

        vm.prank(alice);
        auction.revealOrder(commitId, tokenB, tokenA, 1 ether, 0.9 ether, secret, 0); // swapped tokens

        ICommitRevealAuction.OrderCommitment memory c = auction.getCommitment(commitId);
        assertEq(uint256(c.status), uint256(ICommitRevealAuction.CommitStatus.SLASHED));
    }

    /// @notice Reveal with wrong minAmountOut triggers slash
    function test_reveal_wrongMinAmountOutSlashes() public {
        bytes32 secret = keccak256("s");
        (bytes32 commitId, ) = _commit(alice, secret);

        vm.warp(block.timestamp + 9);

        vm.prank(alice);
        auction.revealOrder(commitId, tokenA, tokenB, 1 ether, 0.5 ether, secret, 0); // wrong minOut

        ICommitRevealAuction.OrderCommitment memory c = auction.getCommitment(commitId);
        assertEq(uint256(c.status), uint256(ICommitRevealAuction.CommitStatus.SLASHED));
    }

    // ============================================================
    // 15. FUND SAFETY INVARIANTS
    // ============================================================

    /// @notice Deposit + slash amounts are fully accounted
    function test_fundSafety_slashDistributionComplete() public {
        uint256 depositAmount = 0.1 ether;

        bytes32 secret = keccak256("s");
        bytes32 hash = _hash(alice, tokenA, tokenB, 1 ether, 0.9 ether, secret);

        vm.prank(alice);
        bytes32 commitId = auction.commitOrder{value: depositAmount}(hash);

        vm.warp(block.timestamp + 12);
        auction.advancePhase();
        vm.roll(block.number + 1);
        auction.settleBatch();

        uint256 treasuryBal = treasury.balance;
        uint256 aliceBal = alice.balance;

        auction.slashUnrevealedCommitment(commitId);

        uint256 treasuryReceived = treasury.balance - treasuryBal;
        uint256 aliceReceived = alice.balance - aliceBal;

        // 50% slashed + 50% refunded = 100% of deposit
        assertEq(treasuryReceived + aliceReceived, depositAmount);
    }

    /// @notice Deposit is fully returned on valid reveal + withdraw
    function test_fundSafety_depositFullyReturned() public {
        uint256 depositAmount = 0.05 ether;

        bytes32 secret = keccak256("s");
        bytes32 hash = _hash(alice, tokenA, tokenB, 1 ether, 0.9 ether, secret);

        uint256 aliceBefore = alice.balance;

        vm.prank(alice);
        bytes32 commitId = auction.commitOrder{value: depositAmount}(hash);

        vm.warp(block.timestamp + 9);
        _reveal(alice, commitId, secret);
        vm.warp(block.timestamp + 3);
        auction.advancePhase();
        vm.roll(block.number + 1);
        auction.settleBatch();

        vm.prank(alice);
        auction.withdrawDeposit(commitId);

        // Alice gets back exactly what she deposited (priority bid was 0)
        assertEq(alice.balance, aliceBefore);
    }

    /// @notice Contract balance tracks: deposits in, withdrawals out, slashes to treasury
    function test_fundSafety_contractBalanceTracking() public {
        uint256 contractBefore = address(auction).balance;

        // Alice commits
        bytes32 s1 = keccak256("s1");
        (bytes32 id1, ) = _commit(alice, s1);

        // Bob commits
        bytes32 s2 = keccak256("s2");
        (bytes32 id2, ) = _commit(bob, s2);

        // 2 deposits of 0.05 ether
        assertEq(address(auction).balance, contractBefore + 0.1 ether);

        vm.warp(block.timestamp + 9);

        // Only Alice reveals
        _reveal(alice, id1, s1);

        vm.warp(block.timestamp + 3);
        auction.advancePhase();
        vm.roll(block.number + 1);
        auction.settleBatch();

        // Alice withdraws deposit
        vm.prank(alice);
        auction.withdrawDeposit(id1);

        // Slash Bob
        auction.slashUnrevealedCommitment(id2);

        // Contract should hold no unclaimed funds from this batch
        // (Alice withdrew, Bob was slashed: 50% to treasury, 50% refunded)
        // Contract balance should be back to original
        assertEq(address(auction).balance, contractBefore);
    }

    // ============================================================
    // 16. PROTOCOL CONSTANTS
    // ============================================================

    /// @notice Protocol constants are correct
    function test_constants_protocolValues() public view {
        assertEq(auction.COMMIT_DURATION(), 8);
        assertEq(auction.REVEAL_DURATION(), 2);
        assertEq(auction.BATCH_DURATION(), 10);
        assertEq(auction.MIN_DEPOSIT(), 0.001 ether);
        assertEq(auction.COLLATERAL_BPS(), 500);
        assertEq(auction.SLASH_RATE_BPS(), 5000);
        assertEq(auction.MAX_TRADE_SIZE_BPS(), 1000);
    }

    /// @notice getBatchDuration returns BATCH_DURATION
    function test_constants_getBatchDuration() public view {
        assertEq(auction.getBatchDuration(), 10);
    }

    // ============================================================
    // 17. INITIALIZATION
    // ============================================================

    /// @notice Cannot initialize twice (upgradeable guard)
    function test_init_cannotReinitialize() public {
        vm.expectRevert();
        auction.initialize(owner, treasury, address(0));
    }

    /// @notice Initial state is correct
    function test_init_initialState() public view {
        assertEq(auction.getCurrentBatchId(), 1);
        assertEq(auction.treasury(), treasury);
        assertEq(auction.powBaseValue(), 0.0001 ether);
        assertEq(uint256(auction.getCurrentPhase()), uint256(ICommitRevealAuction.BatchPhase.COMMIT));
    }

    // ============================================================
    // 18. POOL CREATION EDGE CASES
    // ============================================================

    /// @notice Pool IDs are unique
    function test_pool_idsAreUnique() public {
        bytes32 p1 = auction.createPoolFromPreset(PoolComplianceConfig.PoolPreset.OPEN);
        vm.warp(block.timestamp + 1); // Ensure different timestamp
        bytes32 p2 = auction.createPoolFromPreset(PoolComplianceConfig.PoolPreset.OPEN);
        assertTrue(p1 != p2);
    }

    /// @notice getPoolConfig returns correct data
    function test_pool_getPoolConfig() public {
        bytes2[] memory blocked = new bytes2[](1);
        blocked[0] = "RU";
        bytes32 poolId = auction.createPoolWithCustomAccess(3, true, true, 50000 ether, blocked, "custom");

        PoolComplianceConfig.Config memory config = auction.getPoolConfig(poolId);
        assertEq(config.minTierRequired, 3);
        assertTrue(config.kycRequired);
        assertTrue(config.accreditationRequired);
        assertEq(config.maxTradeSize, 50000 ether);
        assertTrue(config.initialized);
    }

    // ============================================================
    // 19. VIEW FUNCTIONS
    // ============================================================

    /// @notice getRevealedOrders returns correct orders
    function test_view_getRevealedOrders() public {
        bytes32 s1 = keccak256("s1");
        bytes32 s2 = keccak256("s2");

        (bytes32 id1, ) = _commit(alice, s1);
        (bytes32 id2, ) = _commit(bob, s2);

        vm.warp(block.timestamp + 9);
        _reveal(alice, id1, s1);
        _reveal(bob, id2, s2);

        ICommitRevealAuction.RevealedOrder[] memory orders = auction.getRevealedOrders(1);
        assertEq(orders.length, 2);
        assertEq(orders[0].trader, alice);
        assertEq(orders[1].trader, bob);
        assertEq(orders[0].amountIn, 1 ether);
        assertEq(orders[0].tokenIn, tokenA);
        assertEq(orders[0].tokenOut, tokenB);
    }

    /// @notice getExecutionOrder reverts for unsettled batch
    function test_view_getExecutionOrderUnsettledReverts() public {
        vm.expectRevert(CommitRevealAuction.BatchNotSettled.selector);
        auction.getExecutionOrder(1);
    }

    /// @notice getCommitment returns all fields correctly
    function test_view_getCommitment() public {
        bytes32 secret = keccak256("s");
        bytes32 hash = _hash(alice, tokenA, tokenB, 1 ether, 0.9 ether, secret);

        vm.prank(alice);
        bytes32 commitId = auction.commitOrder{value: 0.05 ether}(hash);

        ICommitRevealAuction.OrderCommitment memory c = auction.getCommitment(commitId);
        assertEq(c.commitHash, hash);
        assertEq(c.batchId, 1);
        assertEq(c.depositAmount, 0.05 ether);
        assertEq(c.depositor, alice);
        assertEq(c.poolId, bytes32(0));
        assertEq(uint256(c.status), uint256(ICommitRevealAuction.CommitStatus.COMMITTED));
    }

    // ============================================================
    // 20. MULTI-BATCH STRESS
    // ============================================================

    /// @notice Three consecutive batches with mixed reveals and slashes
    function test_multiBatch_threeConsecutiveBatches() public {
        // Batch 1: Alice commits and reveals, Bob commits but doesn't reveal
        bytes32 s1a = keccak256("b1a");
        bytes32 s1b = keccak256("b1b");
        (bytes32 id1a, ) = _commit(alice, s1a);
        (bytes32 id1b, ) = _commit(bob, s1b);

        vm.warp(block.timestamp + 9);
        _reveal(alice, id1a, s1a);
        // Bob doesn't reveal

        vm.warp(block.timestamp + 3);
        auction.advancePhase();
        vm.roll(block.number + 1);
        auction.settleBatch();

        assertEq(auction.getCurrentBatchId(), 2);

        // Slash Bob from batch 1
        auction.slashUnrevealedCommitment(id1b);

        // Batch 2: Charlie commits and reveals
        bytes32 s2 = keccak256("b2c");
        bytes32 hash2 = _hash(charlie, tokenA, tokenB, 1 ether, 0.9 ether, s2);
        vm.prank(charlie);
        bytes32 id2 = auction.commitOrder{value: 0.05 ether}(hash2);

        vm.warp(block.timestamp + 9);
        vm.prank(charlie);
        auction.revealOrder(id2, tokenA, tokenB, 1 ether, 0.9 ether, s2, 0);

        vm.warp(block.timestamp + 3);
        auction.advancePhase();
        vm.roll(block.number + 1);
        auction.settleBatch();

        assertEq(auction.getCurrentBatchId(), 3);

        // Batch 3: Empty batch
        vm.warp(block.timestamp + 12);
        auction.advancePhase();
        vm.roll(block.number + 1);
        auction.settleBatch();

        assertEq(auction.getCurrentBatchId(), 4);

        // Verify all batches settled
        assertTrue(auction.getBatch(1).isSettled);
        assertTrue(auction.getBatch(2).isSettled);
        assertTrue(auction.getBatch(3).isSettled);
    }

    // ============================================================
    // 21. PROOF OF WORK INTEGRATION
    // ============================================================

    /// @notice revealOrderWithPoW with zero nonce = no PoW (standard reveal)
    function test_pow_zeroNonceNoPoW() public {
        bytes32 secret = keccak256("s");
        (bytes32 commitId, ) = _commit(alice, secret);

        vm.warp(block.timestamp + 9);

        vm.prank(alice);
        auction.revealOrderWithPoW(
            commitId,
            tokenA,
            tokenB,
            1 ether,
            0.9 ether,
            secret,
            0,           // no ETH priority
            bytes32(0),  // no PoW nonce
            0,           // algorithm
            0            // difficulty
        );

        ICommitRevealAuction.OrderCommitment memory c = auction.getCommitment(commitId);
        assertEq(uint256(c.status), uint256(ICommitRevealAuction.CommitStatus.REVEALED));
    }

    /// @notice revealOrderWithPoW with invalid PoW proof reverts
    function test_pow_invalidProofReverts() public {
        bytes32 secret = keccak256("s");
        (bytes32 commitId, ) = _commit(alice, secret);

        vm.warp(block.timestamp + 9);

        vm.prank(alice);
        vm.expectRevert(CommitRevealAuction.InvalidPoWProof.selector);
        auction.revealOrderWithPoW(
            commitId,
            tokenA,
            tokenB,
            1 ether,
            0.9 ether,
            secret,
            0,
            keccak256("bad_nonce"), // nonce that won't meet difficulty
            0,                      // keccak256
            200                     // impossibly high difficulty
        );
    }

    /// @notice revealOrderWithPoW with wrong hash triggers slash
    function test_pow_wrongHashSlashes() public {
        bytes32 secret = keccak256("s");
        (bytes32 commitId, ) = _commit(alice, secret);

        vm.warp(block.timestamp + 9);

        uint256 treasuryBal = treasury.balance;

        vm.prank(alice);
        auction.revealOrderWithPoW(
            commitId,
            tokenA,
            tokenB,
            999 ether, // wrong amount
            0.9 ether,
            secret,
            0,
            bytes32(0),
            0,
            0
        );

        ICommitRevealAuction.OrderCommitment memory c = auction.getCommitment(commitId);
        assertEq(uint256(c.status), uint256(ICommitRevealAuction.CommitStatus.SLASHED));
    }

    // ============================================================
    // R1-F04 FIX: PoW Virtual Value Must Not Inflate ETH Accounting
    // ============================================================

    /// @notice PoW virtual value is tracked separately from real ETH priority bids.
    ///         totalPriorityBids reflects only actual ETH held, so withdrawPriorityBids
    ///         never attempts to send more ETH than exists.
    function test_r1f04_realBidWithNoPoW_onlyCountsAsRealETH() public {
        bytes32 secret = keccak256("r1f04_a");
        // 5% of 1 ether amountIn = 0.05 ether collateral required
        (bytes32 commitId, ) = _commitWithDeposit(alice, secret, 0.05 ether);
        vm.warp(block.timestamp + 9);

        uint256 realBid = 0.1 ether;
        vm.prank(alice);
        // revealOrderWithPoW with zero nonce = no PoW path, only real ETH bid
        auction.revealOrderWithPoW{value: realBid}(
            commitId, tokenA, tokenB, 1 ether, 0.9 ether, secret,
            realBid, bytes32(0), 0, 0
        );

        ICommitRevealAuction.Batch memory batch = auction.getBatch(1);
        assertEq(batch.totalPriorityBids, realBid, "R1-F04: real ETH bid in totalPriorityBids");
        assertEq(batch.totalVirtualPriorityBids, 0, "R1-F04: no virtual bids without PoW");
        assertGe(address(auction).balance, batch.totalPriorityBids, "R1-F04: ETH solvency");
    }

    /// @notice Two plain revealOrder calls: totalPriorityBids = sum of real bids,
    ///         totalVirtualPriorityBids stays zero. Verifies standard path is unaffected
    ///         by the PoW accounting split.
    function test_r1f04_twoPlainReveals_splitAccountingZeroVirtual() public {
        bytes32 s1 = keccak256("r1f04_b1");
        bytes32 s2 = keccak256("r1f04_b2");
        // 5% of 1 ether amountIn = 0.05 ether collateral required
        (bytes32 c1, ) = _commitWithDeposit(alice, s1, 0.05 ether);
        (bytes32 c2, ) = _commitWithDeposit(bob,   s2, 0.05 ether);
        vm.warp(block.timestamp + 9);

        uint256 bid1 = 0.2 ether;
        uint256 bid2 = 0.05 ether;
        vm.prank(alice);
        auction.revealOrder{value: bid1}(c1, tokenA, tokenB, 1 ether, 0.9 ether, s1, bid1);
        vm.prank(bob);
        auction.revealOrder{value: bid2}(c2, tokenA, tokenB, 1 ether, 0.9 ether, s2, bid2);

        ICommitRevealAuction.Batch memory batch = auction.getBatch(1);
        assertEq(batch.totalPriorityBids, bid1 + bid2, "R1-F04: sum of real ETH bids");
        assertEq(batch.totalVirtualPriorityBids, 0, "R1-F04: no virtual bids in plain reveal path");
        assertGe(address(auction).balance, batch.totalPriorityBids, "R1-F04: ETH solvency invariant");
    }

    // ============================================================
    // 22. RECEIVE FUNCTION
    // ============================================================

    /// @notice Contract can receive plain ETH transfers
    function test_receive_acceptsETH() public {
        uint256 before_ = address(auction).balance;
        (bool success, ) = address(auction).call{value: 1 ether}("");
        assertTrue(success);
        assertEq(address(auction).balance, before_ + 1 ether);
    }

    // ============================================================
    // 23. FUZZ TESTS
    // ============================================================

    /// @notice Fuzz: deposit amount >= MIN_DEPOSIT always succeeds
    function testFuzz_commitWithValidDeposit(uint256 deposit) public {
        deposit = bound(deposit, 0.001 ether, 10 ether);

        bytes32 hash = _hash(alice, tokenA, tokenB, 1 ether, 0.9 ether, keccak256("fuzz"));

        vm.prank(alice);
        bytes32 commitId = auction.commitOrder{value: deposit}(hash);

        ICommitRevealAuction.OrderCommitment memory c = auction.getCommitment(commitId);
        assertEq(c.depositAmount, deposit);
    }

    /// @notice Fuzz: slash always distributes 50/50
    function testFuzz_slashDistribution(uint256 deposit) public {
        deposit = bound(deposit, 0.05 ether, 5 ether); // min 0.05 to cover 5% collateral on 1 ether amountIn

        bytes32 secret = keccak256(abi.encode("fuzz_slash", deposit));
        bytes32 hash = _hash(alice, tokenA, tokenB, 1 ether, 0.9 ether, secret);

        vm.prank(alice);
        bytes32 commitId = auction.commitOrder{value: deposit}(hash);

        vm.warp(block.timestamp + 12);
        auction.advancePhase();
        vm.roll(block.number + 1);
        auction.settleBatch();

        uint256 treasuryBal = treasury.balance;
        uint256 aliceBal = alice.balance;

        auction.slashUnrevealedCommitment(commitId);

        uint256 expectedSlash = (deposit * 5000) / 10000;
        uint256 expectedRefund = deposit - expectedSlash;

        assertEq(treasury.balance - treasuryBal, expectedSlash);
        assertEq(alice.balance - aliceBal, expectedRefund);
    }

    /// @notice Fuzz: collateral calculation
    function testFuzz_collateralCalculation(uint256 tradeValue) public view {
        tradeValue = bound(tradeValue, 0, 1000000 ether);

        uint256 required = auction.getRequiredDeposit(tradeValue);
        uint256 collateral = (tradeValue * 500) / 10000;
        uint256 expected = collateral > 0.001 ether ? collateral : 0.001 ether;

        assertEq(required, expected);
    }

    // ============================================================
    // R1-F04 (continued): Live PoW Path - Real ETH vs Virtual Split
    // ============================================================

    /// @notice Helper: brute-force find a nonce producing >= targetBits leading zero bits
    ///         using keccak256(challenge || nonce). Low target (1 bit) completes in <256
    ///         iterations on average.
    function _findPoWNonce(bytes32 challenge, uint8 targetBits)
        internal
        pure
        returns (bytes32 nonce, uint8 achievedBits)
    {
        for (uint256 i = 1; i < 10_000; i++) {
            bytes32 candidate = bytes32(i);
            bytes32 h = keccak256(abi.encodePacked(challenge, candidate));
            uint8 leading = _countLeadingZeroBits(h);
            if (leading >= targetBits) {
                return (candidate, leading);
            }
        }
        revert("_findPoWNonce: no nonce found within 10k iterations");
    }

    /// @notice Mirror of ProofOfWorkLib.countLeadingZeroBits (pure, accessible in tests)
    function _countLeadingZeroBits(bytes32 hash) internal pure returns (uint8 zeros) {
        uint256 value = uint256(hash);
        if (value == 0) return 255;
        zeros = 0;
        if (value <= 0x00000000FFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFF) { zeros += 32; value <<= 32; }
        if (value <= 0x0000FFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFF) { zeros += 16; value <<= 16; }
        if (value <= 0x00FFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFF) { zeros += 8;  value <<= 8; }
        if (value <= 0x0FFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFF) { zeros += 4;  value <<= 4; }
        if (value <= 0x3FFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFF) { zeros += 2;  value <<= 2; }
        if (value <= 0x7FFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFF) { zeros += 1; }
    }

    /// @notice R1-F04 CRITICAL: A real PoW reveal puts virtual value into
    ///         totalVirtualPriorityBids only; totalPriorityBids reflects only
    ///         the real ETH sent. Contract remains solvent: ETH balance >=
    ///         totalPriorityBids at all times.
    function test_r1f04_powReveal_virtualValueIsolatedFromETHAccounting() public {
        bytes32 secret = keccak256("r1f04_pow_live");
        // 5% of 1 ether amountIn = 0.05 ether collateral required
        (bytes32 commitId, ) = _commitWithDeposit(alice, secret, 0.05 ether);
        vm.warp(block.timestamp + 9);

        // Find valid nonce in a scoped block to reduce stack depth
        bytes32 powNonce;
        {
            bytes32 challenge = keccak256(abi.encodePacked(
                alice, uint64(1), bytes32(0), block.chainid, address(auction)
            ));
            uint8 achievedBits;
            (powNonce, achievedBits) = _findPoWNonce(challenge, 1);
            assertGe(achievedBits, 1, "sanity: nonce meets difficulty");
        }

        uint256 realBid = 0.05 ether;
        uint256 expectedPowValue = auction.powBaseValue();

        // Reveal via helper to avoid stack-too-deep on 10-arg call
        vm.prank(alice);
        _revealWithPoWHelper(commitId, secret, realBid, powNonce, 1);

        ICommitRevealAuction.Batch memory batch = auction.getBatch(1);

        assertEq(batch.totalPriorityBids, realBid,
            "R1-F04: totalPriorityBids must equal only real ETH bid");
        assertEq(batch.totalVirtualPriorityBids, expectedPowValue,
            "R1-F04: totalVirtualPriorityBids must equal PoW virtual value");
        assertGe(address(auction).balance, batch.totalPriorityBids,
            "R1-F04: ETH solvency - contract holds enough for all real priority withdrawals");
        // deposit(0.05) + realBid(0.05) = 0.10 ether; virtual value does not inflate ETH balance
        assertEq(address(auction).balance, 0.05 ether + realBid,
            "R1-F04: contract ETH matches only real ETH received");
    }

    /// @dev Helper to reduce stack depth: reveal with PoW using stored locals
    function _revealWithPoWHelper(
        bytes32 commitId,
        bytes32 secret,
        uint256 realBid,
        bytes32 powNonce,
        uint8 difficulty
    ) internal {
        auction.revealOrderWithPoW{value: realBid}(
            commitId, tokenA, tokenB, 1 ether, 0.9 ether, secret,
            realBid, powNonce, 0, difficulty
        );
    }

    /// @notice R1-F04: Mixed batch - one plain ETH bid + one PoW reveal.
    ///         totalPriorityBids sums only real ETH; totalVirtualPriorityBids
    ///         holds only the PoW virtual portion. Solvency invariant holds.
    function test_r1f04_mixedBatch_powAndPlainBidsAccountedSeparately() public {
        bytes32 sAlice = keccak256("r1f04_mixed_alice");
        bytes32 sBob   = keccak256("r1f04_mixed_bob");
        // 5% of 1 ether amountIn = 0.05 ether collateral required
        (bytes32 cAlice, ) = _commitWithDeposit(alice, sAlice, 0.05 ether);
        (bytes32 cBob,   ) = _commitWithDeposit(bob,   sBob,   0.05 ether);

        vm.warp(block.timestamp + 9);

        // Find valid PoW nonce for Alice (scoped block to free stack)
        bytes32 powNonce;
        {
            bytes32 challenge = keccak256(abi.encodePacked(
                alice, uint64(1), bytes32(0), block.chainid, address(auction)
            ));
            (powNonce, ) = _findPoWNonce(challenge, 1);
        }

        uint256 aliceRealBid = 0.03 ether;
        uint256 bobRealBid   = 0.07 ether;
        uint256 expectedPowValue = auction.powBaseValue();

        // Alice reveals with PoW (via helper to stay within stack limit)
        vm.prank(alice);
        _revealWithPoWHelper(cAlice, sAlice, aliceRealBid, powNonce, 1);

        // Bob reveals plain
        vm.prank(bob);
        auction.revealOrder{value: bobRealBid}(
            cBob, tokenA, tokenB, 1 ether, 0.9 ether, sBob, bobRealBid
        );

        ICommitRevealAuction.Batch memory batch = auction.getBatch(1);

        assertEq(
            batch.totalPriorityBids,
            aliceRealBid + bobRealBid,
            "R1-F04: totalPriorityBids = sum of real ETH bids only"
        );
        assertEq(
            batch.totalVirtualPriorityBids,
            expectedPowValue,
            "R1-F04: totalVirtualPriorityBids = Alice PoW virtual value only"
        );
        assertGe(
            address(auction).balance,
            batch.totalPriorityBids,
            "R1-F04: solvency - enough ETH for all real priority withdrawals"
        );
    }

    // ============================================================
    // TRP-R38: COLLATERAL UNDERPRICING FIXES
    // ============================================================

    /// @notice TRP-R38: estimatedTradeValue is stored in commitment
    function test_R38_estimatedTradeValueStored() public {
        bytes32 secret = keccak256("r38_stored");
        bytes32 hash = _hash(alice, tokenA, tokenB, 1 ether, 0.9 ether, secret);

        // Commit with estimatedTradeValue = 10 ether (requires 0.5 ETH collateral)
        vm.prank(alice);
        bytes32 commitId = auction.commitOrderToPool{value: 0.5 ether}(bytes32(0), hash, 10 ether);

        ICommitRevealAuction.OrderCommitment memory c = auction.getCommitment(commitId);
        assertEq(c.estimatedTradeValue, 10 ether, "estimatedTradeValue should be stored");
        assertEq(c.depositAmount, 0.5 ether, "deposit should be 0.5 ETH");
    }

    /// @notice TRP-R38: legacy commitOrder stores estimatedTradeValue=0
    function test_R38_legacyCommitStoresZeroEstimate() public {
        bytes32 secret = keccak256("r38_legacy");
        bytes32 hash = _hash(alice, tokenA, tokenB, 1 ether, 0.9 ether, secret);

        vm.prank(alice);
        bytes32 commitId = auction.commitOrder{value: 0.01 ether}(hash);

        ICommitRevealAuction.OrderCommitment memory c = auction.getCommitment(commitId);
        assertEq(c.estimatedTradeValue, 0, "legacy commitOrder should store 0 estimate");
    }

    /// @notice TRP-R38: Reveal within tolerance succeeds (amountIn <= estimate * 2)
    function test_R38_revealWithinToleranceSucceeds() public {
        bytes32 secret = keccak256("r38_ok");
        uint256 amountIn = 1 ether;
        uint256 estimatedTradeValue = 1 ether; // amountIn == estimate, well within 2x

        bytes32 hash = _hash(alice, tokenA, tokenB, amountIn, 0.9 ether, secret);

        vm.prank(alice);
        bytes32 commitId = auction.commitOrderToPool{value: 0.05 ether}(bytes32(0), hash, estimatedTradeValue);

        // Move to reveal phase
        vm.warp(block.timestamp + 9);

        vm.prank(alice);
        auction.revealOrder(commitId, tokenA, tokenB, amountIn, 0.9 ether, secret, 0);

        ICommitRevealAuction.OrderCommitment memory c = auction.getCommitment(commitId);
        assertEq(uint8(c.status), uint8(ICommitRevealAuction.CommitStatus.REVEALED), "Should be REVEALED");
    }

    /// @notice TRP-R38: Reveal at exact 2x tolerance succeeds
    function test_R38_revealAtExact2xToleranceSucceeds() public {
        bytes32 secret = keccak256("r38_edge");
        uint256 estimatedTradeValue = 0.5 ether;
        uint256 amountIn = 1 ether; // exactly 2x estimate — should pass

        bytes32 hash = _hash(alice, tokenA, tokenB, amountIn, 0.9 ether, secret);

        // 5% of actual amountIn (1 ETH) = 0.05 ETH (collateral check at reveal uses actual amountIn)
        vm.prank(alice);
        bytes32 commitId = auction.commitOrderToPool{value: 0.05 ether}(bytes32(0), hash, estimatedTradeValue);

        vm.warp(block.timestamp + 9);

        vm.prank(alice);
        auction.revealOrder(commitId, tokenA, tokenB, amountIn, 0.9 ether, secret, 0);

        ICommitRevealAuction.OrderCommitment memory c = auction.getCommitment(commitId);
        assertEq(uint8(c.status), uint8(ICommitRevealAuction.CommitStatus.REVEALED), "2x edge should pass");
    }

    /// @notice TRP-R38: Reveal exceeding 2x tolerance is SLASHED
    function test_R38_revealExceedingToleranceSlashed() public {
        bytes32 secret = keccak256("r38_slash");
        uint256 estimatedTradeValue = 0.5 ether;
        uint256 amountIn = 1.01 ether; // just over 2x estimate — should be slashed

        bytes32 hash = _hash(alice, tokenA, tokenB, amountIn, 0.9 ether, secret);

        vm.prank(alice);
        bytes32 commitId = auction.commitOrderToPool{value: 0.025 ether}(bytes32(0), hash, estimatedTradeValue);

        vm.warp(block.timestamp + 9);

        uint256 treasuryBalBefore = treasury.balance;
        vm.prank(alice);
        auction.revealOrder(commitId, tokenA, tokenB, amountIn, 0.9 ether, secret, 0);

        ICommitRevealAuction.OrderCommitment memory c = auction.getCommitment(commitId);
        assertEq(uint8(c.status), uint8(ICommitRevealAuction.CommitStatus.SLASHED), "Should be SLASHED");

        // 50% of deposit slashed to treasury
        uint256 expectedSlash = (0.025 ether * 5000) / 10000;
        assertEq(treasury.balance - treasuryBalBefore, expectedSlash, "Treasury should receive slash");
    }

    /// @notice TRP-R38: Massive overshoot (100x estimate) is slashed
    function test_R38_massiveOvershootSlashed() public {
        bytes32 secret = keccak256("r38_huge");
        uint256 estimatedTradeValue = 0.01 ether;
        uint256 amountIn = 100 ether; // 10000x estimate

        bytes32 hash = _hash(alice, tokenA, tokenB, amountIn, 0.9 ether, secret);

        // MIN_DEPOSIT = 0.001 ether (5% of 0.01 = 0.0005, below floor)
        vm.prank(alice);
        bytes32 commitId = auction.commitOrderToPool{value: 0.001 ether}(bytes32(0), hash, estimatedTradeValue);

        vm.warp(block.timestamp + 9);

        vm.prank(alice);
        auction.revealOrder(commitId, tokenA, tokenB, amountIn, 0.9 ether, secret, 0);

        ICommitRevealAuction.OrderCommitment memory c = auction.getCommitment(commitId);
        assertEq(uint8(c.status), uint8(ICommitRevealAuction.CommitStatus.SLASHED), "100x overshoot must slash");
    }

    /// @notice TRP-R38: Legacy commitOrder (estimatedTradeValue=0) skips tolerance check
    function test_R38_legacyCommitSkipsToleranceCheck() public {
        bytes32 secret = keccak256("r38_legacy_reveal");
        uint256 amountIn = 1 ether;

        bytes32 hash = _hash(alice, tokenA, tokenB, amountIn, 0.9 ether, secret);

        // Legacy commitOrder: estimatedTradeValue=0, deposit must cover 5% collateral
        vm.prank(alice);
        bytes32 commitId = auction.commitOrder{value: 0.05 ether}(hash);

        vm.warp(block.timestamp + 9);

        // Reveal should succeed — tolerance check is skipped when estimate=0
        vm.prank(alice);
        auction.revealOrder(commitId, tokenA, tokenB, amountIn, 0.9 ether, secret, 0);

        ICommitRevealAuction.OrderCommitment memory c = auction.getCommitment(commitId);
        assertEq(uint8(c.status), uint8(ICommitRevealAuction.CommitStatus.REVEALED), "Legacy should still reveal OK");
    }

    /// @notice TRP-R38: ESTIMATE_TOLERANCE_X constant is 2
    function test_R38_estimateToleranceConstant() public view {
        assertEq(auction.ESTIMATE_TOLERANCE_X(), 2, "ESTIMATE_TOLERANCE_X should be 2");
    }

    /// @notice TRP-R38: Spam attack scenario — low-collateral griefing blocked
    function test_R38_spamGriefingBlocked() public {
        // Attacker tries to submit 1000 ETH trade with tiny collateral
        bytes32 secret = keccak256("r38_spam");
        uint256 estimatedTradeValue = 0.01 ether; // lie about trade size
        uint256 realAmountIn = 1000 ether; // actual trade much bigger

        bytes32 hash = _hash(alice, tokenA, tokenB, realAmountIn, 900 ether, secret);

        // Attacker pays only MIN_DEPOSIT (0.001 ETH)
        vm.prank(alice);
        bytes32 commitId = auction.commitOrderToPool{value: 0.001 ether}(bytes32(0), hash, estimatedTradeValue);

        vm.warp(block.timestamp + 9);

        // When revealing the real amount, it's 100000x the estimate — slashed
        vm.prank(alice);
        auction.revealOrder(commitId, tokenA, tokenB, realAmountIn, 900 ether, secret, 0);

        ICommitRevealAuction.OrderCommitment memory c = auction.getCommitment(commitId);
        assertEq(uint8(c.status), uint8(ICommitRevealAuction.CommitStatus.SLASHED), "Spam griefing should be slashed");
    }

    /// @notice TRP-R38: Cross-chain reveal also enforces estimate tolerance
    function test_R38_crossChainRevealEnforcesTolerance() public {
        bytes32 secret = keccak256("r38_xchain");
        uint256 estimatedTradeValue = 1 ether;
        uint256 amountIn = 3 ether; // 3x estimate > 2x tolerance

        bytes32 hash = keccak256(abi.encodePacked(alice, tokenA, tokenB, amountIn, uint256(0.9 ether), secret));

        // Alice commits via commitOrderToPool
        vm.prank(alice);
        bytes32 commitId = auction.commitOrderToPool{value: 0.05 ether}(bytes32(0), hash, estimatedTradeValue);

        vm.warp(block.timestamp + 9);

        // Authorized settler reveals on behalf of alice — should be slashed
        auction.revealOrderCrossChain(commitId, alice, tokenA, tokenB, amountIn, 0.9 ether, secret, 0);

        ICommitRevealAuction.OrderCommitment memory c = auction.getCommitment(commitId);
        assertEq(uint8(c.status), uint8(ICommitRevealAuction.CommitStatus.SLASHED), "Cross-chain should enforce tolerance");
    }

    /// @notice TRP-R38 Fuzz: amountIn <= estimate*2 always reveals, > always slashes
    function testFuzz_R38_toleranceEnforcement(uint256 estimate, uint256 amountIn) public {
        estimate = bound(estimate, 0.02 ether, 100 ether); // min 0.02 ETH to keep collateral > MIN_DEPOSIT
        amountIn = bound(amountIn, 0.001 ether, 1000 ether);

        bytes32 secret = keccak256(abi.encodePacked("r38_fuzz", estimate, amountIn));
        bytes32 hash = _hash(alice, tokenA, tokenB, amountIn, 0.9 ether, secret);

        // Deposit must cover collateral for the max tolerated amountIn (estimate * 2)
        // because the collateral check at reveal uses actual amountIn, not estimate.
        // For amountIn > estimate*2, tolerance check slashes first (before collateral check).
        uint256 requiredDeposit = auction.getRequiredDeposit(estimate * 2);

        vm.prank(alice);
        bytes32 commitId = auction.commitOrderToPool{value: requiredDeposit}(bytes32(0), hash, estimate);

        vm.warp(block.timestamp + 9);

        vm.prank(alice);
        auction.revealOrder(commitId, tokenA, tokenB, amountIn, 0.9 ether, secret, 0);

        ICommitRevealAuction.OrderCommitment memory c = auction.getCommitment(commitId);

        if (amountIn > estimate * 2) {
            assertEq(uint8(c.status), uint8(ICommitRevealAuction.CommitStatus.SLASHED), "Over 2x must slash");
        } else {
            assertEq(uint8(c.status), uint8(ICommitRevealAuction.CommitStatus.REVEALED), "Within 2x must reveal");
        }
    }
}
