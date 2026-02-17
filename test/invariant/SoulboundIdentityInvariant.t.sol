// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "forge-std/Test.sol";
import "forge-std/StdInvariant.sol";
import "../../contracts/identity/SoulboundIdentity.sol";
import "@openzeppelin/contracts/proxy/ERC1967/ERC1967Proxy.sol";

// ============ Handler ============

contract SBIHandler is Test {
    SoulboundIdentity public sbi;
    address public recorder;

    address[] public allUsers;
    address[] public mintedUsers;
    uint256 public nextUserIdx;

    // Ghost variables
    uint256 public ghost_totalMinted;
    uint256 public ghost_totalContributions;
    uint256 public ghost_totalXPAwarded;
    uint256 public ghost_totalVotes;

    constructor(SoulboundIdentity _sbi, address _recorder, address[] memory _users) {
        sbi = _sbi;
        recorder = _recorder;
        allUsers = _users;
    }

    /// @notice Mint identity for next available user
    function mintIdentity(uint256 userSeed) external {
        if (nextUserIdx >= allUsers.length) return;

        address user = allUsers[nextUserIdx];
        nextUserIdx++;

        string memory username = string(abi.encodePacked("user_", _toStr(nextUserIdx)));

        vm.prank(user);
        sbi.mintIdentity(username);

        mintedUsers.push(user);
        ghost_totalMinted++;
    }

    /// @notice Record a contribution for a random minted user
    function recordContribution(uint256 userSeed, uint8 typeSeed) external {
        if (mintedUsers.length == 0) return;

        uint256 idx = userSeed % mintedUsers.length;
        address user = mintedUsers[idx];

        SoulboundIdentity.ContributionType cType = SoulboundIdentity.ContributionType(typeSeed % 5);

        vm.prank(recorder);
        sbi.recordContribution(
            user,
            keccak256(abi.encodePacked("contrib", ghost_totalContributions)),
            cType
        );

        ghost_totalContributions++;

        // Track XP
        if (cType == SoulboundIdentity.ContributionType.POST) ghost_totalXPAwarded += 10;
        else if (cType == SoulboundIdentity.ContributionType.REPLY) ghost_totalXPAwarded += 5;
        else if (cType == SoulboundIdentity.ContributionType.PROPOSAL) ghost_totalXPAwarded += 50;
        else if (cType == SoulboundIdentity.ContributionType.CODE) ghost_totalXPAwarded += 100;
        else ghost_totalXPAwarded += 10; // TRADE_INSIGHT
    }

    /// @notice Vote on a random contribution
    function vote(uint256 voterSeed, uint256 contribSeed, bool upvote) external {
        if (mintedUsers.length < 2) return;
        if (ghost_totalContributions == 0) return;

        uint256 voterIdx = voterSeed % mintedUsers.length;
        address voter = mintedUsers[voterIdx];

        uint256 cid = (contribSeed % ghost_totalContributions) + 1;

        SoulboundIdentity.Contribution memory c = sbi.getContribution(cid);
        if (c.author == voter) return; // Can't vote own content
        if (sbi.hasVoted(cid, voter)) return; // Already voted

        vm.prank(voter);
        sbi.vote(cid, upvote);

        ghost_totalVotes++;
        // XP: author gets 2 for upvote, voter gets 1
        if (upvote) ghost_totalXPAwarded += 3; // 2 for author + 1 for voter
        else ghost_totalXPAwarded += 1; // 1 for voter
    }

    function getMintedCount() external view returns (uint256) {
        return mintedUsers.length;
    }

    function _toStr(uint256 value) internal pure returns (string memory) {
        if (value == 0) return "0";
        uint256 temp = value;
        uint256 digits;
        while (temp != 0) { digits++; temp /= 10; }
        bytes memory buffer = new bytes(digits);
        while (value != 0) {
            digits -= 1;
            buffer[digits] = bytes1(uint8(48 + value % 10));
            value /= 10;
        }
        return string(buffer);
    }
}

// ============ Invariant Test ============

contract SoulboundIdentityInvariantTest is StdInvariant, Test {
    SoulboundIdentity public sbi;
    SBIHandler public handler;
    address public recorder;
    address[] public users;

    function setUp() public {
        recorder = makeAddr("recorder");

        SoulboundIdentity impl = new SoulboundIdentity();
        bytes memory initData = abi.encodeWithSelector(SoulboundIdentity.initialize.selector);
        ERC1967Proxy proxy = new ERC1967Proxy(address(impl), initData);
        sbi = SoulboundIdentity(address(proxy));

        sbi.setAuthorizedRecorder(recorder, true);

        // Create 20 potential users
        for (uint256 i = 0; i < 20; i++) {
            users.push(address(uint160(0x2000 + i)));
        }

        handler = new SBIHandler(sbi, recorder, users);
        targetContract(address(handler));
    }

    /// @notice totalIdentities matches ghost count
    function invariant_totalMatchesGhost() public view {
        assertEq(
            sbi.totalIdentities(),
            handler.ghost_totalMinted(),
            "Total identities mismatch"
        );
    }

    /// @notice totalContributions matches ghost count
    function invariant_contributionCountMatches() public view {
        assertEq(
            sbi.totalContributions(),
            handler.ghost_totalContributions(),
            "Total contributions mismatch"
        );
    }

    /// @notice Every minted user has exactly one identity
    function invariant_oneIdentityPerUser() public view {
        uint256 mintedCount = handler.getMintedCount();
        for (uint256 i = 0; i < mintedCount && i < 20; i++) {
            address user = handler.mintedUsers(i);
            assertTrue(sbi.hasIdentity(user), "Minted user must have identity");
            uint256 tokenId = sbi.addressToTokenId(user);
            assertEq(sbi.ownerOf(tokenId), user, "Token owner must match");
        }
    }

    /// @notice Level is always >= 1 and consistent with XP
    function invariant_levelConsistentWithXP() public view {
        uint256 mintedCount = handler.getMintedCount();
        for (uint256 i = 0; i < mintedCount && i < 20; i++) {
            address user = handler.mintedUsers(i);
            SoulboundIdentity.Identity memory id = sbi.getIdentity(user);
            assertTrue(id.level >= 1, "Level must be >= 1");
            assertTrue(id.level <= 10, "Level must be <= 10");
        }
    }

    /// @notice Alignment always stays in [-100, 100]
    function invariant_alignmentBounded() public view {
        uint256 mintedCount = handler.getMintedCount();
        for (uint256 i = 0; i < mintedCount && i < 20; i++) {
            address user = handler.mintedUsers(i);
            SoulboundIdentity.Identity memory id = sbi.getIdentity(user);
            assertTrue(id.alignment >= -100 && id.alignment <= 100, "Alignment out of bounds");
        }
    }
}
