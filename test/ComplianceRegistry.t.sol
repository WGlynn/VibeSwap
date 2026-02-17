// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "forge-std/Test.sol";
import "../contracts/compliance/ComplianceRegistry.sol";
import "@openzeppelin/contracts/proxy/ERC1967/ERC1967Proxy.sol";

contract ComplianceRegistryTest is Test {
    ComplianceRegistry public registry;

    address public owner;
    address public officer;
    address public kycProvider;
    address public authorizedContract;
    address public alice;
    address public bob;

    address public secToken;
    address public derivToken;
    address public normalToken;

    event UserTierUpdated(address indexed user, ComplianceRegistry.UserTier oldTier, ComplianceRegistry.UserTier newTier, address indexed updatedBy);
    event UserStatusUpdated(address indexed user, ComplianceRegistry.AccountStatus oldStatus, ComplianceRegistry.AccountStatus newStatus, string reason);
    event UserKYCVerified(address indexed user, string provider, bytes2 jurisdiction, uint64 expiry);
    event UserFrozen(address indexed user, string reason, address indexed frozenBy);
    event UserUnfrozen(address indexed user, address indexed unfrozenBy);
    event VolumeRecorded(address indexed user, uint256 volumeUsd, uint256 dailyTotal);

    function setUp() public {
        owner = address(this);
        officer = makeAddr("officer");
        kycProvider = makeAddr("kycProvider");
        authorizedContract = makeAddr("authorizedContract");
        alice = makeAddr("alice");
        bob = makeAddr("bob");

        secToken = makeAddr("securityToken");
        derivToken = makeAddr("derivativeToken");
        normalToken = makeAddr("normalToken");

        ComplianceRegistry impl = new ComplianceRegistry();
        bytes memory initData = abi.encodeWithSelector(
            ComplianceRegistry.initialize.selector,
            owner
        );
        ERC1967Proxy proxy = new ERC1967Proxy(address(impl), initData);
        registry = ComplianceRegistry(address(proxy));

        // Setup roles
        registry.setComplianceOfficer(officer, true);
        registry.setKYCProvider(kycProvider, true);
        registry.setAuthorizedContract(authorizedContract, true);
        registry.setSecurityToken(secToken, true);
        registry.setDerivativeToken(derivToken, true);
    }

    // ============ Initialization ============

    function test_initialize() public view {
        assertEq(registry.owner(), owner);
        assertEq(registry.defaultKycValidity(), 365 days);
        assertFalse(registry.compliancePaused());
    }

    function test_initialize_defaultTierLimits() public view {
        // BLOCKED - zero everything
        (uint256 maxDaily,,,,,,) = registry.tierLimits(ComplianceRegistry.UserTier.BLOCKED);
        assertEq(maxDaily, 0);

        // RETAIL - 50k/day
        (uint256 retailDaily, uint256 retailSingle,,,,,) = registry.tierLimits(ComplianceRegistry.UserTier.RETAIL);
        assertEq(retailDaily, 50000e18);
        assertEq(retailSingle, 10000e18);

        // INSTITUTIONAL - unlimited (0)
        (uint256 instDaily,,,,,,) = registry.tierLimits(ComplianceRegistry.UserTier.INSTITUTIONAL);
        assertEq(instDaily, 0);
    }

    // ============ KYC Verification ============

    function test_verifyKYC_success() public {
        vm.prank(kycProvider);
        registry.verifyKYC(alice, ComplianceRegistry.UserTier.RETAIL, bytes2("US"), keccak256("kyc"), "Provider1");

        ComplianceRegistry.UserProfile memory profile = registry.getUserProfile(alice);
        assertEq(uint8(profile.tier), uint8(ComplianceRegistry.UserTier.RETAIL));
        assertEq(uint8(profile.status), uint8(ComplianceRegistry.AccountStatus.ACTIVE));
        assertEq(profile.jurisdiction, bytes2("US"));
        assertEq(profile.kycProvider, "Provider1");
        assertTrue(profile.kycExpiry > block.timestamp);
    }

    function test_verifyKYC_cannotVerifyAsBlocked() public {
        vm.prank(kycProvider);
        vm.expectRevert("Cannot verify as blocked");
        registry.verifyKYC(alice, ComplianceRegistry.UserTier.BLOCKED, bytes2("US"), keccak256("kyc"), "P1");
    }

    function test_verifyKYC_onlyKYCProvider() public {
        vm.prank(alice);
        vm.expectRevert(ComplianceRegistry.NotKYCProvider.selector);
        registry.verifyKYC(alice, ComplianceRegistry.UserTier.RETAIL, bytes2("US"), keccak256("kyc"), "P1");
    }

    function test_verifyKYC_ownerCanCall() public {
        registry.verifyKYC(alice, ComplianceRegistry.UserTier.RETAIL, bytes2("US"), keccak256("kyc"), "P1");
        ComplianceRegistry.UserProfile memory profile = registry.getUserProfile(alice);
        assertEq(uint8(profile.tier), uint8(ComplianceRegistry.UserTier.RETAIL));
    }

    function test_extendKYC() public {
        vm.prank(kycProvider);
        registry.verifyKYC(alice, ComplianceRegistry.UserTier.RETAIL, bytes2("US"), keccak256("kyc"), "P1");

        uint64 originalExpiry = registry.getUserProfile(alice).kycExpiry;

        vm.prank(kycProvider);
        registry.extendKYC(alice, 30 days);

        assertEq(registry.getUserProfile(alice).kycExpiry, originalExpiry + 30 days);
    }

    // ============ canTrade ============

    function test_canTrade_verifiedRetail() public {
        vm.prank(kycProvider);
        registry.verifyKYC(alice, ComplianceRegistry.UserTier.RETAIL, bytes2("US"), keccak256("kyc"), "P1");

        (bool allowed, string memory reason) = registry.canTrade(alice, 5000e18, normalToken, normalToken);
        assertTrue(allowed);
        assertEq(bytes(reason).length, 0);
    }

    function test_canTrade_blockedUser() public {
        // Default tier is BLOCKED (0)
        (bool allowed, string memory reason) = registry.canTrade(alice, 100e18, normalToken, normalToken);
        assertFalse(allowed);
        assertEq(reason, "User blocked");
    }

    function test_canTrade_frozenAccount() public {
        vm.prank(kycProvider);
        registry.verifyKYC(alice, ComplianceRegistry.UserTier.RETAIL, bytes2("US"), keccak256("kyc"), "P1");

        vm.prank(officer);
        registry.freezeUser(alice, "investigation");

        (bool allowed, string memory reason) = registry.canTrade(alice, 100e18, normalToken, normalToken);
        assertFalse(allowed);
        assertEq(reason, "Account frozen");
    }

    function test_canTrade_suspendedAccount() public {
        vm.prank(kycProvider);
        registry.verifyKYC(alice, ComplianceRegistry.UserTier.RETAIL, bytes2("US"), keccak256("kyc"), "P1");

        vm.prank(officer);
        registry.suspendUser(alice, "review");

        (bool allowed, string memory reason) = registry.canTrade(alice, 100e18, normalToken, normalToken);
        assertFalse(allowed);
        assertEq(reason, "Account suspended");
    }

    function test_canTrade_terminatedAccount() public {
        vm.prank(kycProvider);
        registry.verifyKYC(alice, ComplianceRegistry.UserTier.RETAIL, bytes2("US"), keccak256("kyc"), "P1");

        vm.prank(officer);
        registry.terminateUser(alice, "bad actor");

        (bool allowed, string memory reason) = registry.canTrade(alice, 100e18, normalToken, normalToken);
        assertFalse(allowed);
        assertEq(reason, "Account terminated");
    }

    function test_canTrade_kycExpired() public {
        vm.prank(kycProvider);
        registry.verifyKYC(alice, ComplianceRegistry.UserTier.RETAIL, bytes2("US"), keccak256("kyc"), "P1");

        // Advance past KYC expiry
        vm.warp(block.timestamp + 366 days);

        (bool allowed, string memory reason) = registry.canTrade(alice, 100e18, normalToken, normalToken);
        assertFalse(allowed);
        assertEq(reason, "KYC expired");
    }

    function test_canTrade_singleTradeLimitExceeded() public {
        vm.prank(kycProvider);
        registry.verifyKYC(alice, ComplianceRegistry.UserTier.RETAIL, bytes2("US"), keccak256("kyc"), "P1");

        // Retail max single trade = 10,000e18
        (bool allowed, string memory reason) = registry.canTrade(alice, 15000e18, normalToken, normalToken);
        assertFalse(allowed);
        assertEq(reason, "Single trade limit exceeded");
    }

    function test_canTrade_dailyVolumeLimitExceeded() public {
        vm.prank(kycProvider);
        registry.verifyKYC(alice, ComplianceRegistry.UserTier.RETAIL, bytes2("US"), keccak256("kyc"), "P1");

        // Record volume close to daily limit
        vm.prank(authorizedContract);
        registry.recordVolume(alice, 45000e18);

        // Now try a trade that would exceed daily limit (50,000e18)
        (bool allowed, string memory reason) = registry.canTrade(alice, 6000e18, normalToken, normalToken);
        assertFalse(allowed);
        assertEq(reason, "Daily volume limit exceeded");
    }

    function test_canTrade_securityTokenRestricted() public {
        vm.prank(kycProvider);
        registry.verifyKYC(alice, ComplianceRegistry.UserTier.RETAIL, bytes2("US"), keccak256("kyc"), "P1");

        // Retail cannot access security tokens
        (bool allowed, string memory reason) = registry.canTrade(alice, 100e18, secToken, normalToken);
        assertFalse(allowed);
        assertEq(reason, "Security token access restricted");
    }

    function test_canTrade_derivativeRestricted() public {
        vm.prank(kycProvider);
        registry.verifyKYC(alice, ComplianceRegistry.UserTier.RETAIL, bytes2("US"), keccak256("kyc"), "P1");

        (bool allowed, string memory reason) = registry.canTrade(alice, 100e18, normalToken, derivToken);
        assertFalse(allowed);
        assertEq(reason, "Derivative access restricted");
    }

    function test_canTrade_accreditedCanAccessSecurities() public {
        vm.prank(kycProvider);
        registry.verifyKYC(alice, ComplianceRegistry.UserTier.ACCREDITED, bytes2("US"), keccak256("kyc"), "P1");

        (bool allowed,) = registry.canTrade(alice, 100e18, secToken, normalToken);
        assertTrue(allowed);
    }

    function test_canTrade_jurisdictionBlocked() public {
        vm.prank(kycProvider);
        registry.verifyKYC(alice, ComplianceRegistry.UserTier.RETAIL, bytes2("KP"), keccak256("kyc"), "P1");

        // Block jurisdiction
        registry.blockJurisdiction(bytes2("KP"));

        (bool allowed, string memory reason) = registry.canTrade(alice, 100e18, normalToken, normalToken);
        assertFalse(allowed);
        assertEq(reason, "Jurisdiction blocked");
    }

    function test_canTrade_jurisdictionRequiresAccreditation() public {
        ComplianceRegistry.JurisdictionConfig memory config = ComplianceRegistry.JurisdictionConfig({
            blocked: false,
            retailAllowed: false,
            requiresAccreditation: true,
            maxDailyVolume: 0
        });
        registry.setJurisdiction(bytes2("JP"), config);

        vm.prank(kycProvider);
        registry.verifyKYC(alice, ComplianceRegistry.UserTier.RETAIL, bytes2("JP"), keccak256("kyc"), "P1");

        (bool allowed, string memory reason) = registry.canTrade(alice, 100e18, normalToken, normalToken);
        assertFalse(allowed);
        assertEq(reason, "Accreditation required for jurisdiction");
    }

    function test_canTrade_whenPausedReverts() public {
        registry.setCompliancePaused(true);
        vm.expectRevert(ComplianceRegistry.CompliancePaused.selector);
        registry.canTrade(alice, 100e18, normalToken, normalToken);
    }

    function test_canTrade_institutionalUnlimited() public {
        vm.prank(kycProvider);
        registry.verifyKYC(alice, ComplianceRegistry.UserTier.INSTITUTIONAL, bytes2("US"), keccak256("kyc"), "P1");

        (bool allowed,) = registry.canTrade(alice, 10_000_000e18, secToken, derivToken);
        assertTrue(allowed);
    }

    function test_canTrade_exemptSkipsKycExpiry() public {
        registry.exemptAddress(alice);

        // Even without KYC, exempt addresses can trade
        (bool allowed,) = registry.canTrade(alice, 10_000_000e18, secToken, derivToken);
        assertTrue(allowed);
    }

    // ============ canProvideLiquidity / canUsePriorityAuction ============

    function test_canProvideLiquidity_retail() public {
        vm.prank(kycProvider);
        registry.verifyKYC(alice, ComplianceRegistry.UserTier.RETAIL, bytes2("US"), keccak256("kyc"), "P1");

        assertTrue(registry.canProvideLiquidity(alice));
    }

    function test_canProvideLiquidity_pending() public {
        vm.prank(kycProvider);
        registry.verifyKYC(alice, ComplianceRegistry.UserTier.PENDING, bytes2("US"), keccak256("kyc"), "P1");

        assertFalse(registry.canProvideLiquidity(alice));
    }

    function test_canProvideLiquidity_frozenDenied() public {
        vm.prank(kycProvider);
        registry.verifyKYC(alice, ComplianceRegistry.UserTier.RETAIL, bytes2("US"), keccak256("kyc"), "P1");

        vm.prank(officer);
        registry.freezeUser(alice, "investigation");

        assertFalse(registry.canProvideLiquidity(alice));
    }

    function test_canUsePriorityAuction_retail() public {
        vm.prank(kycProvider);
        registry.verifyKYC(alice, ComplianceRegistry.UserTier.RETAIL, bytes2("US"), keccak256("kyc"), "P1");

        assertTrue(registry.canUsePriorityAuction(alice));
    }

    function test_canUsePriorityAuction_pending() public {
        vm.prank(kycProvider);
        registry.verifyKYC(alice, ComplianceRegistry.UserTier.PENDING, bytes2("US"), keccak256("kyc"), "P1");

        assertFalse(registry.canUsePriorityAuction(alice));
    }

    // ============ Volume Recording ============

    function test_recordVolume() public {
        vm.prank(kycProvider);
        registry.verifyKYC(alice, ComplianceRegistry.UserTier.RETAIL, bytes2("US"), keccak256("kyc"), "P1");

        vm.prank(authorizedContract);
        registry.recordVolume(alice, 5000e18);

        ComplianceRegistry.UserProfile memory profile = registry.getUserProfile(alice);
        assertEq(profile.dailyVolumeUsed, 5000e18);
    }

    function test_recordVolume_resetsOnNewDay() public {
        vm.prank(kycProvider);
        registry.verifyKYC(alice, ComplianceRegistry.UserTier.RETAIL, bytes2("US"), keccak256("kyc"), "P1");

        vm.prank(authorizedContract);
        registry.recordVolume(alice, 5000e18);

        // Advance to next day
        vm.warp(block.timestamp + 1 days + 1);

        vm.prank(authorizedContract);
        registry.recordVolume(alice, 1000e18);

        ComplianceRegistry.UserProfile memory profile = registry.getUserProfile(alice);
        assertEq(profile.dailyVolumeUsed, 1000e18);
    }

    function test_recordVolume_onlyAuthorizedContract() public {
        vm.prank(alice);
        vm.expectRevert(ComplianceRegistry.NotAuthorizedContract.selector);
        registry.recordVolume(alice, 100e18);
    }

    // ============ Compliance Officer Functions ============

    function test_freezeUser() public {
        vm.prank(officer);
        registry.freezeUser(alice, "suspicious activity");

        ComplianceRegistry.UserProfile memory profile = registry.getUserProfile(alice);
        assertEq(uint8(profile.status), uint8(ComplianceRegistry.AccountStatus.FROZEN));
    }

    function test_unfreezeUser() public {
        vm.prank(officer);
        registry.freezeUser(alice, "investigation");

        vm.prank(officer);
        registry.unfreezeUser(alice);

        ComplianceRegistry.UserProfile memory profile = registry.getUserProfile(alice);
        assertEq(uint8(profile.status), uint8(ComplianceRegistry.AccountStatus.ACTIVE));
    }

    function test_suspendUser() public {
        vm.prank(officer);
        registry.suspendUser(alice, "pending review");

        ComplianceRegistry.UserProfile memory profile = registry.getUserProfile(alice);
        assertEq(uint8(profile.status), uint8(ComplianceRegistry.AccountStatus.SUSPENDED));
    }

    function test_terminateUser() public {
        vm.prank(officer);
        registry.terminateUser(alice, "fraud confirmed");

        ComplianceRegistry.UserProfile memory profile = registry.getUserProfile(alice);
        assertEq(uint8(profile.status), uint8(ComplianceRegistry.AccountStatus.TERMINATED));
        assertEq(uint8(profile.tier), uint8(ComplianceRegistry.UserTier.BLOCKED));
    }

    function test_blockUser() public {
        vm.prank(kycProvider);
        registry.verifyKYC(alice, ComplianceRegistry.UserTier.RETAIL, bytes2("US"), keccak256("kyc"), "P1");

        vm.prank(officer);
        registry.blockUser(alice);

        ComplianceRegistry.UserProfile memory profile = registry.getUserProfile(alice);
        assertEq(uint8(profile.tier), uint8(ComplianceRegistry.UserTier.BLOCKED));
    }

    function test_batchFreezeUsers() public {
        address[] memory users = new address[](2);
        users[0] = alice;
        users[1] = bob;

        vm.prank(officer);
        registry.batchFreezeUsers(users, "mass freeze");

        assertEq(uint8(registry.getUserProfile(alice).status), uint8(ComplianceRegistry.AccountStatus.FROZEN));
        assertEq(uint8(registry.getUserProfile(bob).status), uint8(ComplianceRegistry.AccountStatus.FROZEN));
    }

    function test_complianceOfficer_onlyOfficer() public {
        vm.prank(alice);
        vm.expectRevert(ComplianceRegistry.NotComplianceOfficer.selector);
        registry.freezeUser(bob, "test");
    }

    // ============ Admin Functions ============

    function test_setTierLimits() public {
        ComplianceRegistry.TierLimits memory limits = ComplianceRegistry.TierLimits({
            maxDailyVolume: 100_000e18,
            maxSingleTrade: 20_000e18,
            maxPositionSize: 200_000e18,
            canAccessSecurities: true,
            canAccessDerivatives: false,
            canProvideLiquidity: true,
            canUsePriority: true
        });
        registry.setTierLimits(ComplianceRegistry.UserTier.RETAIL, limits);

        (uint256 maxDaily, uint256 maxSingle,,,,, ) = registry.tierLimits(ComplianceRegistry.UserTier.RETAIL);
        assertEq(maxDaily, 100_000e18);
        assertEq(maxSingle, 20_000e18);
    }

    function test_setComplianceOfficer() public {
        registry.setComplianceOfficer(alice, true);
        assertTrue(registry.complianceOfficers(alice));

        registry.setComplianceOfficer(alice, false);
        assertFalse(registry.complianceOfficers(alice));
    }

    function test_setKYCProvider() public {
        registry.setKYCProvider(alice, true);
        assertTrue(registry.kycProviders(alice));
    }

    function test_setAuthorizedContract() public {
        registry.setAuthorizedContract(alice, true);
        assertTrue(registry.authorizedContracts(alice));
    }

    function test_setDefaultKycValidity() public {
        registry.setDefaultKycValidity(180 days);
        assertEq(registry.defaultKycValidity(), 180 days);
    }

    function test_setUserTier() public {
        registry.setUserTier(alice, ComplianceRegistry.UserTier.ACCREDITED);
        assertEq(uint8(registry.getUserProfile(alice).tier), uint8(ComplianceRegistry.UserTier.ACCREDITED));
    }

    function test_exemptAddress() public {
        registry.exemptAddress(alice);
        ComplianceRegistry.UserProfile memory profile = registry.getUserProfile(alice);
        assertEq(uint8(profile.tier), uint8(ComplianceRegistry.UserTier.EXEMPT));
        assertEq(uint8(profile.status), uint8(ComplianceRegistry.AccountStatus.ACTIVE));
    }

    // ============ View Functions ============

    function test_getRemainingDailyVolume_unlimited() public {
        registry.exemptAddress(alice);
        assertEq(registry.getRemainingDailyVolume(alice), type(uint256).max);
    }

    function test_getRemainingDailyVolume_afterUsage() public {
        vm.prank(kycProvider);
        registry.verifyKYC(alice, ComplianceRegistry.UserTier.RETAIL, bytes2("US"), keccak256("kyc"), "P1");

        vm.prank(authorizedContract);
        registry.recordVolume(alice, 10000e18);

        assertEq(registry.getRemainingDailyVolume(alice), 40000e18);
    }

    function test_isInGoodStanding() public {
        assertFalse(registry.isInGoodStanding(alice)); // BLOCKED by default

        vm.prank(kycProvider);
        registry.verifyKYC(alice, ComplianceRegistry.UserTier.RETAIL, bytes2("US"), keccak256("kyc"), "P1");

        assertTrue(registry.isInGoodStanding(alice));
    }

    function test_isInGoodStanding_kycExpired() public {
        vm.prank(kycProvider);
        registry.verifyKYC(alice, ComplianceRegistry.UserTier.RETAIL, bytes2("US"), keccak256("kyc"), "P1");

        vm.warp(block.timestamp + 366 days);
        assertFalse(registry.isInGoodStanding(alice));
    }
}
