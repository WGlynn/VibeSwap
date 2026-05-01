// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "forge-std/Test.sol";
import "../../contracts/identity/SoulboundIdentity.sol";
import "@openzeppelin/contracts/proxy/ERC1967/ERC1967Proxy.sol";
import "@openzeppelin/contracts/token/ERC721/IERC721Receiver.sol";

/**
 * @notice C28-F2 — Regression test for ERC721-receiver reentrancy in SoulboundIdentity.mintIdentity.
 *
 * @dev Vulnerability shape (pre-fix):
 *      _mintIdentity(...) calls _safeMint(msg.sender, tokenId) BEFORE writing to
 *      addressToTokenId[msg.sender]. ERC721 _safeMint invokes onERC721Received on
 *      contract recipients. A malicious contract recipient can re-enter mintIdentity
 *      during the callback — at that point addressToTokenId[itself] is still 0,
 *      so the "one identity per address" guard is bypassed.
 *
 *      Impact: HIGH. Soulbound's defining property is 1-identity-per-address.
 *      Reentrancy lets the same address acquire N identities in a single tx, breaking
 *      every downstream invariant (trust scores, voting weight, sybil resistance).
 *
 *      Fix: nonReentrant on mintIdentity / mintIdentityQuantum + ReentrancyGuardUpgradeable
 *      inheritance + __ReentrancyGuard_init() in initialize().
 */
contract MaliciousMinter is IERC721Receiver {
    SoulboundIdentity public sbi;
    bool public reentered;
    bool public secondMintSucceeded;
    string public secondUsername;

    constructor(SoulboundIdentity _sbi, string memory _secondUsername) {
        sbi = _sbi;
        secondUsername = _secondUsername;
    }

    function attack(string calldata firstUsername) external {
        sbi.mintIdentity(firstUsername);
    }

    function onERC721Received(
        address /*operator*/,
        address /*from*/,
        uint256 /*tokenId*/,
        bytes calldata /*data*/
    ) external returns (bytes4) {
        // Re-enter exactly once — try to mint a second identity to ourselves.
        if (!reentered) {
            reentered = true;
            try sbi.mintIdentity(secondUsername) {
                secondMintSucceeded = true;
            } catch {
                secondMintSucceeded = false;
            }
        }
        return IERC721Receiver.onERC721Received.selector;
    }
}

contract SoulboundIdentityMintReentrancyTest is Test {
    SoulboundIdentity public sbi;

    function setUp() public {
        SoulboundIdentity impl = new SoulboundIdentity();
        bytes memory initData = abi.encodeWithSelector(SoulboundIdentity.initialize.selector);
        ERC1967Proxy proxy = new ERC1967Proxy(address(impl), initData);
        sbi = SoulboundIdentity(address(proxy));
    }

    /**
     * @notice After the C28-F2 fix, a re-entrant second mint MUST be blocked by
     *         ReentrancyGuard. The attacker's onERC721Received hook still tries
     *         to mint, but the inner mintIdentity reverts with
     *         ReentrancyGuardReentrantCall. The attacker swallows that revert in
     *         its try/catch (the realistic case — a sophisticated attacker isn't
     *         going to bubble its own kill-switch), so the outer mint completes
     *         and the attacker holds exactly ONE identity. The fix's success
     *         condition is: secondMintSucceeded == false AND totalIdentities == 1.
     *
     *         Pre-fix behaviour (documented for record): secondMintSucceeded == true
     *         and totalIdentities == 2 — the attacker minted two identities to one
     *         address, breaking the soulbound 1-identity-per-address invariant.
     */
    function test_reentrantMint_blocked_by_nonReentrant() public {
        MaliciousMinter attacker = new MaliciousMinter(sbi, "evil_2");

        attacker.attack("evil_1");

        // Inner re-entrant mint MUST have failed.
        assertTrue(attacker.reentered(), "callback must have fired");
        assertFalse(attacker.secondMintSucceeded(), "C28-F2: second mint must be blocked by nonReentrant");

        // The attacker holds exactly ONE identity (the legitimate first mint).
        assertEq(sbi.addressToTokenId(address(attacker)), 1, "attacker has exactly one identity");
        assertEq(sbi.totalIdentities(), 1, "exactly one identity minted total");
    }

    /**
     * @notice Sanity: a normal contract recipient (returns the magic value, no reentry)
     *         can still mint exactly one identity. Confirms the fix doesn't
     *         over-block legitimate ERC721-receiver use.
     */
    function test_normalContractRecipient_canMintOnce() public {
        QuietReceiver q = new QuietReceiver(sbi);
        q.mint("alice");
        assertEq(sbi.addressToTokenId(address(q)), 1);
        assertEq(sbi.totalIdentities(), 1);
    }
}

contract QuietReceiver is IERC721Receiver {
    SoulboundIdentity public sbi;

    constructor(SoulboundIdentity _sbi) {
        sbi = _sbi;
    }

    function mint(string calldata u) external {
        sbi.mintIdentity(u);
    }

    function onERC721Received(
        address, address, uint256, bytes calldata
    ) external pure returns (bytes4) {
        return IERC721Receiver.onERC721Received.selector;
    }
}
