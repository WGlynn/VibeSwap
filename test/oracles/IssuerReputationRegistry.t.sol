// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "forge-std/Test.sol";
import "@openzeppelin/contracts-upgradeable/proxy/utils/UUPSUpgradeable.sol";
import "@openzeppelin/contracts/proxy/ERC1967/ERC1967Proxy.sol";
import "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import "../../contracts/oracles/IssuerReputationRegistry.sol";
import "../../contracts/oracles/interfaces/IIssuerReputationRegistry.sol";

contract MockStakeToken is ERC20 {
    constructor() ERC20("Stake", "STK") {}

    function mint(address to, uint256 amount) external {
        _mint(to, amount);
    }
}

/// @title IssuerReputationRegistry — C12 tests
/// @notice Covers register / unbond / slash / reputation decay / status transitions.
contract IssuerReputationRegistryTest is Test {
    IssuerReputationRegistry public registry;
    MockStakeToken public token;

    address public owner = address(0xA1);
    address public slasher = address(0xA2);
    address public issuerSigner = address(0xB1);
    bytes32 public constant ISSUER_KEY = bytes32(uint256(0x1337));

    uint256 public constant MIN_STAKE = 100e18;
    uint256 public constant MIN_REPUTATION = 2000; // 20%

    function setUp() public {
        token = new MockStakeToken();
        IssuerReputationRegistry impl = new IssuerReputationRegistry();
        bytes memory initData = abi.encodeCall(
            IssuerReputationRegistry.initialize,
            (address(token), owner, MIN_STAKE, MIN_REPUTATION)
        );
        ERC1967Proxy proxy = new ERC1967Proxy(address(impl), initData);
        registry = IssuerReputationRegistry(address(proxy));

        vm.prank(owner);
        registry.setAuthorizedSlasher(slasher, true);

        token.mint(issuerSigner, 10_000e18);
        vm.prank(issuerSigner);
        token.approve(address(registry), type(uint256).max);
    }

    // ============ Registration ============

    function test_RegisterIssuer_Success() public {
        vm.prank(issuerSigner);
        registry.registerIssuer(ISSUER_KEY, issuerSigner, MIN_STAKE);

        (
            IIssuerReputationRegistry.IssuerStatus status,
            address signer,
            uint256 stake,
            uint256 reputation,
            uint256 unbondAt
        ) = registry.getIssuerStatus(ISSUER_KEY);

        assertEq(uint8(status), uint8(IIssuerReputationRegistry.IssuerStatus.ACTIVE));
        assertEq(signer, issuerSigner);
        assertEq(stake, MIN_STAKE);
        assertEq(reputation, 5000); // MID_REPUTATION
        assertEq(unbondAt, 0);
    }

    function test_RegisterIssuer_RevertsBelowMinStake() public {
        vm.prank(issuerSigner);
        vm.expectRevert(IssuerReputationRegistry.InsufficientStake.selector);
        registry.registerIssuer(ISSUER_KEY, issuerSigner, MIN_STAKE - 1);
    }

    function test_RegisterIssuer_RevertsDoubleRegister() public {
        vm.startPrank(issuerSigner);
        registry.registerIssuer(ISSUER_KEY, issuerSigner, MIN_STAKE);

        vm.expectRevert(IssuerReputationRegistry.AlreadyRegistered.selector);
        registry.registerIssuer(ISSUER_KEY, issuerSigner, MIN_STAKE);
        vm.stopPrank();
    }

    function test_RegisterIssuer_RevertsSignerBoundElsewhere() public {
        bytes32 otherKey = bytes32(uint256(0xBEEF));
        vm.startPrank(issuerSigner);
        registry.registerIssuer(ISSUER_KEY, issuerSigner, MIN_STAKE);

        vm.expectRevert(IssuerReputationRegistry.SignerAlreadyBound.selector);
        registry.registerIssuer(otherKey, issuerSigner, MIN_STAKE);
        vm.stopPrank();
    }

    // ============ Verify ============

    function test_VerifyIssuer_ActiveAndCorrect() public {
        vm.prank(issuerSigner);
        registry.registerIssuer(ISSUER_KEY, issuerSigner, MIN_STAKE);

        assertTrue(registry.verifyIssuer(ISSUER_KEY, issuerSigner));
    }

    function test_VerifyIssuer_WrongSigner() public {
        vm.prank(issuerSigner);
        registry.registerIssuer(ISSUER_KEY, issuerSigner, MIN_STAKE);

        assertFalse(registry.verifyIssuer(ISSUER_KEY, address(0xDEAD)));
    }

    function test_VerifyIssuer_UnregisteredReturnsFalse() public {
        assertFalse(registry.verifyIssuer(ISSUER_KEY, issuerSigner));
    }

    // ============ Slash ============

    function test_SlashIssuer_ByOwner() public {
        vm.prank(issuerSigner);
        registry.registerIssuer(ISSUER_KEY, issuerSigner, MIN_STAKE);

        vm.prank(owner);
        registry.slashIssuer(ISSUER_KEY, 1000, "bad bundle"); // 10% slash

        (, , uint256 stake, uint256 reputation, ) = registry.getIssuerStatus(ISSUER_KEY);
        assertEq(stake, MIN_STAKE - (MIN_STAKE * 1000 / 10000));
        assertEq(reputation, 4000); // 5000 - 1000
    }

    function test_SlashIssuer_BySlasher() public {
        vm.prank(issuerSigner);
        registry.registerIssuer(ISSUER_KEY, issuerSigner, MIN_STAKE);

        vm.prank(slasher);
        registry.slashIssuer(ISSUER_KEY, 500, "authorized slasher");

        (, , , uint256 reputation, ) = registry.getIssuerStatus(ISSUER_KEY);
        assertEq(reputation, 4500);
    }

    function test_SlashIssuer_RevertsByUnauthorized() public {
        vm.prank(issuerSigner);
        registry.registerIssuer(ISSUER_KEY, issuerSigner, MIN_STAKE);

        vm.prank(address(0xBADD));
        vm.expectRevert(IssuerReputationRegistry.NotSlasher.selector);
        registry.slashIssuer(ISSUER_KEY, 100, "no auth");
    }

    function test_SlashIssuer_DropsBelowMinReputation_MarksSlashedOut() public {
        vm.prank(issuerSigner);
        registry.registerIssuer(ISSUER_KEY, issuerSigner, MIN_STAKE);

        // Slash enough to drop below minReputation (2000 bps). 5000 - 3500 = 1500.
        vm.prank(owner);
        registry.slashIssuer(ISSUER_KEY, 3500, "catastrophic");

        (IIssuerReputationRegistry.IssuerStatus status, , , , ) = registry.getIssuerStatus(ISSUER_KEY);
        assertEq(uint8(status), uint8(IIssuerReputationRegistry.IssuerStatus.SLASHED_OUT));
        assertFalse(registry.verifyIssuer(ISSUER_KEY, issuerSigner));
    }

    function test_SlashIssuer_StakeBelowMin_MarksSlashedOut() public {
        vm.prank(issuerSigner);
        registry.registerIssuer(ISSUER_KEY, issuerSigner, MIN_STAKE);

        // 100% stake slash — drops stake to 0, below minStake.
        vm.prank(owner);
        registry.slashIssuer(ISSUER_KEY, 10000, "full slash stake");

        (IIssuerReputationRegistry.IssuerStatus status, , uint256 stake, , ) = registry.getIssuerStatus(ISSUER_KEY);
        assertEq(uint8(status), uint8(IIssuerReputationRegistry.IssuerStatus.SLASHED_OUT));
        assertEq(stake, 0);
    }

    // ============ Unbond ============

    function test_Unbond_HappyPath() public {
        vm.startPrank(issuerSigner);
        registry.registerIssuer(ISSUER_KEY, issuerSigner, MIN_STAKE);
        registry.requestUnbond(ISSUER_KEY);

        (IIssuerReputationRegistry.IssuerStatus s1, , , , uint256 available) = registry.getIssuerStatus(ISSUER_KEY);
        assertEq(uint8(s1), uint8(IIssuerReputationRegistry.IssuerStatus.UNBONDING));
        assertEq(available, block.timestamp + 7 days);

        vm.warp(block.timestamp + 7 days + 1);
        uint256 balBefore = token.balanceOf(issuerSigner);
        registry.completeUnbond(ISSUER_KEY);
        assertEq(token.balanceOf(issuerSigner), balBefore + MIN_STAKE);

        (IIssuerReputationRegistry.IssuerStatus s2, , , , ) = registry.getIssuerStatus(ISSUER_KEY);
        assertEq(uint8(s2), uint8(IIssuerReputationRegistry.IssuerStatus.UNREGISTERED));
        vm.stopPrank();
    }

    function test_Unbond_CannotCompleteEarly() public {
        vm.startPrank(issuerSigner);
        registry.registerIssuer(ISSUER_KEY, issuerSigner, MIN_STAKE);
        registry.requestUnbond(ISSUER_KEY);

        vm.warp(block.timestamp + 1 days); // Not enough.
        vm.expectRevert(IssuerReputationRegistry.UnbondNotReady.selector);
        registry.completeUnbond(ISSUER_KEY);
        vm.stopPrank();
    }

    function test_Unbond_SlashStillPossibleDuringUnbond() public {
        vm.startPrank(issuerSigner);
        registry.registerIssuer(ISSUER_KEY, issuerSigner, MIN_STAKE);
        registry.requestUnbond(ISSUER_KEY);
        vm.stopPrank();

        // Slash during unbonding must still succeed — this is the anti-slash-dodge property.
        vm.prank(owner);
        registry.slashIssuer(ISSUER_KEY, 1000, "caught during unbond");
        (, , uint256 stake, , ) = registry.getIssuerStatus(ISSUER_KEY);
        assertEq(stake, MIN_STAKE - (MIN_STAKE * 1000 / 10000));
    }

    // ============ Reputation decay ============

    function test_ReputationDecay_MovesTowardMid() public {
        vm.prank(issuerSigner);
        registry.registerIssuer(ISSUER_KEY, issuerSigner, MIN_STAKE);

        // Slash to set reputation to 3000 (below MID 5000).
        vm.prank(owner);
        registry.slashIssuer(ISSUER_KEY, 2000, "setup"); // 5000 - 2000 = 3000

        // Warp one half-life (30 days). Gap = 5000 - 3000 = 2000; after 1 half-life → 1000.
        // So reputation should move from 3000 to 5000 - 1000 = 4000.
        vm.warp(block.timestamp + 30 days);
        (, , , uint256 reputation, ) = registry.getIssuerStatus(ISSUER_KEY);
        assertEq(reputation, 4000);
    }

    function test_ReputationDecay_DoesNotReactivate() public {
        vm.prank(issuerSigner);
        registry.registerIssuer(ISSUER_KEY, issuerSigner, MIN_STAKE);

        // Slash below min reputation.
        vm.prank(owner);
        registry.slashIssuer(ISSUER_KEY, 3500, "severe"); // rep = 1500 < 2000 → SLASHED_OUT

        (IIssuerReputationRegistry.IssuerStatus s1, , , , ) = registry.getIssuerStatus(ISSUER_KEY);
        assertEq(uint8(s1), uint8(IIssuerReputationRegistry.IssuerStatus.SLASHED_OUT));

        // Warp forward a lot.
        vm.warp(block.timestamp + 365 days);
        registry.touchReputation(ISSUER_KEY);

        // Status stays SLASHED_OUT despite decay bringing reputation back up.
        (IIssuerReputationRegistry.IssuerStatus s2, , , uint256 rep, ) = registry.getIssuerStatus(ISSUER_KEY);
        assertEq(uint8(s2), uint8(IIssuerReputationRegistry.IssuerStatus.SLASHED_OUT));
        // rep should have drifted toward MID but cannot reactivate.
        assertGt(rep, 2000);
    }
}
