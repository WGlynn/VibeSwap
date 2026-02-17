// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "forge-std/Test.sol";
import "../../contracts/identity/SoulboundIdentity.sol";
import "@openzeppelin/contracts/proxy/ERC1967/ERC1967Proxy.sol";

contract SoulboundIdentityFuzzTest is Test {
    SoulboundIdentity public sbi;
    address public recorder;

    function setUp() public {
        recorder = makeAddr("recorder");

        SoulboundIdentity impl = new SoulboundIdentity();
        bytes memory initData = abi.encodeWithSelector(SoulboundIdentity.initialize.selector);
        ERC1967Proxy proxy = new ERC1967Proxy(address(impl), initData);
        sbi = SoulboundIdentity(address(proxy));

        sbi.setAuthorizedRecorder(recorder, true);
    }

    /// @notice XP accumulates correctly across many contributions
    function testFuzz_xpAccumulates(uint8 numContribs) public {
        numContribs = uint8(bound(numContribs, 1, 50));

        address user = makeAddr("user");
        vm.prank(user);
        sbi.mintIdentity("fuzz_user");

        uint256 expectedXP = 0;
        for (uint256 i = 0; i < numContribs; i++) {
            SoulboundIdentity.ContributionType cType = SoulboundIdentity.ContributionType(i % 5);
            vm.prank(recorder);
            sbi.recordContribution(user, keccak256(abi.encodePacked("c", i)), cType);

            if (cType == SoulboundIdentity.ContributionType.POST) expectedXP += 10;
            else if (cType == SoulboundIdentity.ContributionType.REPLY) expectedXP += 5;
            else if (cType == SoulboundIdentity.ContributionType.PROPOSAL) expectedXP += 50;
            else if (cType == SoulboundIdentity.ContributionType.CODE) expectedXP += 100;
            else expectedXP += 10; // TRADE_INSIGHT
        }

        assertEq(sbi.getIdentity(user).xp, expectedXP, "XP mismatch");
        assertEq(sbi.getIdentity(user).contributions, numContribs, "Contribution count mismatch");
    }

    /// @notice Level always matches XP thresholds
    function testFuzz_levelMatchesXP(uint256 xpAmount) public {
        xpAmount = bound(xpAmount, 0, 50000);

        address user = makeAddr("user");
        vm.prank(user);
        sbi.mintIdentity("fuzz_user");

        if (xpAmount > 0) {
            sbi.awardXP(user, xpAmount, "test");
        }

        uint256 level = sbi.getIdentity(user).level;

        // Verify level against thresholds
        if (xpAmount >= 10000) assertEq(level, 10);
        else if (xpAmount >= 6000) assertEq(level, 9);
        else if (xpAmount >= 4000) assertEq(level, 8);
        else if (xpAmount >= 2500) assertEq(level, 7);
        else if (xpAmount >= 1500) assertEq(level, 6);
        else if (xpAmount >= 1000) assertEq(level, 5);
        else if (xpAmount >= 600) assertEq(level, 4);
        else if (xpAmount >= 300) assertEq(level, 3);
        else if (xpAmount >= 100) assertEq(level, 2);
        else assertEq(level, 1);
    }

    /// @notice Alignment stays clamped to [-100, 100]
    function testFuzz_alignmentClamped(uint8 numUpvotes, uint8 numDownvotes) public {
        numUpvotes = uint8(bound(numUpvotes, 0, 120));
        numDownvotes = uint8(bound(numDownvotes, 0, 120));

        address author = makeAddr("author");
        address voter = makeAddr("voter");

        vm.prank(author);
        sbi.mintIdentity("author_user");
        vm.prank(voter);
        sbi.mintIdentity("voter_user");

        uint256 totalVotes = uint256(numUpvotes) + uint256(numDownvotes);
        for (uint256 i = 0; i < totalVotes; i++) {
            vm.prank(recorder);
            uint256 cid = sbi.recordContribution(author, keccak256(abi.encodePacked("c", i)), SoulboundIdentity.ContributionType.REPLY);

            bool isUpvote = i < numUpvotes;
            vm.prank(voter);
            sbi.vote(cid, isUpvote);
        }

        int256 alignment = sbi.getIdentity(author).alignment;
        assertTrue(alignment >= -100 && alignment <= 100, "Alignment out of range");
    }

    /// @notice Username change frees old name and claims new name
    function testFuzz_usernameChangeFreesOld() public {
        address user1 = makeAddr("user1");
        address user2 = makeAddr("user2");

        vm.prank(user1);
        sbi.mintIdentity("original_name");

        vm.prank(user1);
        sbi.changeUsername("new_name_here");

        // Old name should be free for user2
        vm.prank(user2);
        sbi.mintIdentity("original_name");
        assertTrue(sbi.hasIdentity(user2));
    }

    /// @notice Reputation cost of username change: always 10%
    function testFuzz_usernameChangeCosts10Pct(uint256 reputation) public {
        reputation = bound(reputation, 1, 1e6);

        address user = makeAddr("user");
        vm.prank(user);
        sbi.mintIdentity("user_name");

        // Build reputation by awarding XP (which doesn't affect rep directly)
        // We need to use upvotes. Let's use multiple voters.
        address voter = makeAddr("voter");
        vm.prank(voter);
        sbi.mintIdentity("voter_name");

        // Record many contributions and upvote them
        for (uint256 i = 0; i < reputation && i < 200; i++) {
            vm.prank(recorder);
            uint256 cid = sbi.recordContribution(user, keccak256(abi.encodePacked("rep", i)), SoulboundIdentity.ContributionType.REPLY);
            vm.prank(voter);
            sbi.vote(cid, true);
        }

        uint256 repBefore = sbi.getIdentity(user).reputation;
        if (repBefore == 0) return;

        vm.prank(user);
        sbi.changeUsername("changed_nm");

        uint256 repAfter = sbi.getIdentity(user).reputation;
        assertEq(repAfter, (repBefore * 90) / 100, "Must lose exactly 10%");
    }

    /// @notice Each address can only have one identity
    function testFuzz_oneIdentityPerAddress(uint8 numAttempts) public {
        numAttempts = uint8(bound(numAttempts, 2, 10));

        address user = makeAddr("user");
        vm.prank(user);
        sbi.mintIdentity("first_name");

        for (uint256 i = 1; i < numAttempts; i++) {
            vm.prank(user);
            vm.expectRevert(SoulboundIdentity.AlreadyHasIdentity.selector);
            sbi.mintIdentity(string(abi.encodePacked("name_", i)));
        }
    }

    /// @notice Transfer always reverts (soulbound)
    function testFuzz_transferAlwaysReverts(address to) public {
        vm.assume(to != address(0));

        address user = makeAddr("user");
        vm.prank(user);
        sbi.mintIdentity("soulbound_u");

        vm.prank(user);
        vm.expectRevert(SoulboundIdentity.SoulboundNoTransfer.selector);
        sbi.transferFrom(user, to, 1);
    }
}
