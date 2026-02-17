// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "forge-std/Test.sol";
import "forge-std/StdInvariant.sol";
import "../../contracts/compliance/ComplianceRegistry.sol";
import "@openzeppelin/contracts/proxy/ERC1967/ERC1967Proxy.sol";

// ============ Handler ============

contract CRHandler is Test {
    ComplianceRegistry public registry;
    address public kycProvider;
    address public officer;
    address public authorizedContract;
    address[] public users;

    // Ghost variables
    uint256 public ghost_totalVolume;
    uint256 public ghost_freezeCount;
    uint256 public ghost_verifyCount;

    constructor(
        ComplianceRegistry _registry,
        address _kycProvider,
        address _officer,
        address _authorizedContract,
        address[] memory _users
    ) {
        registry = _registry;
        kycProvider = _kycProvider;
        officer = _officer;
        authorizedContract = _authorizedContract;
        users = _users;
    }

    /// @notice Verify a random user at a random tier
    function verifyUser(uint256 userSeed, uint8 tierSeed) external {
        uint256 idx = userSeed % users.length;
        address user = users[idx];

        // Tier 2-5 (RETAIL to EXEMPT, skip BLOCKED and PENDING)
        uint8 tier = uint8(bound(tierSeed, 2, 5));

        vm.prank(kycProvider);
        registry.verifyKYC(
            user,
            ComplianceRegistry.UserTier(tier),
            bytes2("US"),
            keccak256(abi.encodePacked("kyc", user)),
            "TestProvider"
        );

        ghost_verifyCount++;
    }

    /// @notice Record volume for a random user
    function recordVolume(uint256 userSeed, uint256 volume) external {
        uint256 idx = userSeed % users.length;
        address user = users[idx];
        volume = bound(volume, 1, 10000e18);

        vm.prank(authorizedContract);
        registry.recordVolume(user, volume);

        ghost_totalVolume += volume;
    }

    /// @notice Freeze a random user
    function freezeUser(uint256 userSeed) external {
        uint256 idx = userSeed % users.length;
        address user = users[idx];

        vm.prank(officer);
        registry.freezeUser(user, "handler freeze");

        ghost_freezeCount++;
    }

    /// @notice Unfreeze a random user
    function unfreezeUser(uint256 userSeed) external {
        uint256 idx = userSeed % users.length;
        address user = users[idx];

        ComplianceRegistry.UserProfile memory profile = registry.getUserProfile(user);
        if (profile.status != ComplianceRegistry.AccountStatus.FROZEN) return;

        vm.prank(officer);
        registry.unfreezeUser(user);
    }

    /// @notice Advance time to test KYC expiry and volume resets
    function advanceTime(uint256 seconds_) external {
        seconds_ = bound(seconds_, 1, 30 days);
        vm.warp(block.timestamp + seconds_);
    }
}

// ============ Invariant Test ============

contract ComplianceRegistryInvariantTest is StdInvariant, Test {
    ComplianceRegistry public registry;
    CRHandler public handler;

    address public kycProvider;
    address public officer;
    address public authorizedContract;
    address[] public users;

    function setUp() public {
        kycProvider = makeAddr("kycProvider");
        officer = makeAddr("officer");
        authorizedContract = makeAddr("authorizedContract");

        ComplianceRegistry impl = new ComplianceRegistry();
        bytes memory initData = abi.encodeWithSelector(ComplianceRegistry.initialize.selector, address(this));
        ERC1967Proxy proxy = new ERC1967Proxy(address(impl), initData);
        registry = ComplianceRegistry(address(proxy));

        registry.setKYCProvider(kycProvider, true);
        registry.setComplianceOfficer(officer, true);
        registry.setAuthorizedContract(authorizedContract, true);

        // Create users
        for (uint256 i = 0; i < 5; i++) {
            users.push(address(uint160(0x1000 + i)));
        }

        handler = new CRHandler(registry, kycProvider, officer, authorizedContract, users);
        targetContract(address(handler));
    }

    /// @notice Frozen users can never trade
    function invariant_frozenCannotTrade() public view {
        for (uint256 i = 0; i < users.length; i++) {
            ComplianceRegistry.UserProfile memory profile = registry.getUserProfile(users[i]);
            if (profile.status == ComplianceRegistry.AccountStatus.FROZEN) {
                (bool allowed,) = registry.canTrade(users[i], 1, address(1), address(2));
                assertFalse(allowed, "Frozen user must not be allowed to trade");
            }
        }
    }

    /// @notice BLOCKED tier users can never trade
    function invariant_blockedCannotTrade() public view {
        for (uint256 i = 0; i < users.length; i++) {
            ComplianceRegistry.UserProfile memory profile = registry.getUserProfile(users[i]);
            if (profile.tier == ComplianceRegistry.UserTier.BLOCKED) {
                (bool allowed,) = registry.canTrade(users[i], 1, address(1), address(2));
                assertFalse(allowed, "Blocked user must not be allowed to trade");
            }
        }
    }

    /// @notice Active verified users have valid KYC timestamps
    function invariant_verifiedHaveTimestamps() public view {
        for (uint256 i = 0; i < users.length; i++) {
            ComplianceRegistry.UserProfile memory profile = registry.getUserProfile(users[i]);
            if (profile.tier >= ComplianceRegistry.UserTier.RETAIL &&
                profile.status == ComplianceRegistry.AccountStatus.ACTIVE) {
                assertTrue(profile.kycTimestamp > 0, "Verified user must have KYC timestamp");
                assertTrue(profile.kycExpiry > profile.kycTimestamp, "Expiry must be after verification");
            }
        }
    }

    /// @notice Default KYC validity never changes (handler doesn't modify it)
    function invariant_defaultValidityStable() public view {
        assertEq(registry.defaultKycValidity(), 365 days, "Default validity must remain 365 days");
    }

    /// @notice Tier limits for BLOCKED always have zero maxDailyVolume
    function invariant_blockedTierZeroLimits() public view {
        (uint256 maxDaily,,,,,,) = registry.tierLimits(ComplianceRegistry.UserTier.BLOCKED);
        assertEq(maxDaily, 0, "BLOCKED tier must have zero daily volume");
    }
}
