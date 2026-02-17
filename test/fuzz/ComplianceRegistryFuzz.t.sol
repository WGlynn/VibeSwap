// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "forge-std/Test.sol";
import "../../contracts/compliance/ComplianceRegistry.sol";
import "@openzeppelin/contracts/proxy/ERC1967/ERC1967Proxy.sol";

contract ComplianceRegistryFuzzTest is Test {
    ComplianceRegistry public registry;

    address public kycProvider;
    address public officer;
    address public authorizedContract;

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
    }

    /// @notice Verified user can always trade within single trade limit
    function testFuzz_retailCanTradeWithinLimit(uint256 volume) public {
        volume = bound(volume, 1, 10000e18); // Retail max single = 10,000

        address user = makeAddr("user");
        vm.prank(kycProvider);
        registry.verifyKYC(user, ComplianceRegistry.UserTier.RETAIL, bytes2("US"), keccak256("kyc"), "P1");

        (bool allowed,) = registry.canTrade(user, volume, address(1), address(2));
        assertTrue(allowed, "Should allow within limits");
    }

    /// @notice Retail always blocked above single trade limit
    function testFuzz_retailBlockedAboveLimit(uint256 volume) public {
        volume = bound(volume, 10001e18, 1e30);

        address user = makeAddr("user");
        vm.prank(kycProvider);
        registry.verifyKYC(user, ComplianceRegistry.UserTier.RETAIL, bytes2("US"), keccak256("kyc"), "P1");

        (bool allowed, string memory reason) = registry.canTrade(user, volume, address(1), address(2));
        assertFalse(allowed, "Should block above limit");
        assertEq(reason, "Single trade limit exceeded");
    }

    /// @notice Daily volume accumulates correctly and blocks when exceeded
    function testFuzz_dailyVolumeAccumulates(uint256 vol1, uint256 vol2) public {
        vol1 = bound(vol1, 1, 25000e18);
        vol2 = bound(vol2, 1, 25000e18);

        address user = makeAddr("user");
        vm.prank(kycProvider);
        registry.verifyKYC(user, ComplianceRegistry.UserTier.RETAIL, bytes2("US"), keccak256("kyc"), "P1");

        vm.prank(authorizedContract);
        registry.recordVolume(user, vol1);

        // Check remaining
        uint256 remaining = registry.getRemainingDailyVolume(user);
        if (vol1 >= 50000e18) {
            assertEq(remaining, 0);
        } else {
            assertEq(remaining, 50000e18 - vol1);
        }

        // Second trade check
        (bool allowed,) = registry.canTrade(user, vol2, address(1), address(2));
        if (vol1 + vol2 <= 50000e18 && vol2 <= 10000e18) {
            assertTrue(allowed, "Should allow if within both limits");
        }
    }

    /// @notice Frozen accounts always denied trading
    function testFuzz_frozenAlwaysDenied(uint256 volume) public {
        volume = bound(volume, 1, 1e18);

        address user = makeAddr("user");
        vm.prank(kycProvider);
        registry.verifyKYC(user, ComplianceRegistry.UserTier.INSTITUTIONAL, bytes2("US"), keccak256("kyc"), "P1");

        vm.prank(officer);
        registry.freezeUser(user, "investigation");

        (bool allowed,) = registry.canTrade(user, volume, address(1), address(2));
        assertFalse(allowed, "Frozen must always be denied");
    }

    /// @notice Institutional tier has unlimited volume
    function testFuzz_institutionalUnlimited(uint256 volume) public {
        volume = bound(volume, 1, 1e30);

        address user = makeAddr("user");
        vm.prank(kycProvider);
        registry.verifyKYC(user, ComplianceRegistry.UserTier.INSTITUTIONAL, bytes2("US"), keccak256("kyc"), "P1");

        (bool allowed,) = registry.canTrade(user, volume, address(1), address(2));
        assertTrue(allowed, "Institutional should be unlimited");
    }

    /// @notice KYC always expires after validity period
    function testFuzz_kycExpires(uint64 validity, uint256 timeAdvance) public {
        validity = uint64(bound(validity, 1 days, 730 days));
        timeAdvance = bound(timeAdvance, uint256(validity) + 1, uint256(validity) + 365 days);

        registry.setDefaultKycValidity(validity);

        address user = makeAddr("user");
        vm.prank(kycProvider);
        registry.verifyKYC(user, ComplianceRegistry.UserTier.RETAIL, bytes2("US"), keccak256("kyc"), "P1");

        vm.warp(block.timestamp + timeAdvance);

        (bool allowed, string memory reason) = registry.canTrade(user, 100e18, address(1), address(2));
        assertFalse(allowed, "Should be blocked after KYC expires");
        assertEq(reason, "KYC expired");
    }

    /// @notice Volume resets on new day
    function testFuzz_volumeResetsDaily(uint256 vol1) public {
        vol1 = bound(vol1, 1, 50000e18);

        address user = makeAddr("user");
        vm.prank(kycProvider);
        registry.verifyKYC(user, ComplianceRegistry.UserTier.RETAIL, bytes2("US"), keccak256("kyc"), "P1");

        vm.prank(authorizedContract);
        registry.recordVolume(user, vol1);

        // Advance to next day
        vm.warp(block.timestamp + 1 days + 1);

        uint256 remaining = registry.getRemainingDailyVolume(user);
        assertEq(remaining, 50000e18, "Should reset to full daily limit");
    }

    /// @notice Batch freeze freezes all users
    function testFuzz_batchFreeze(uint8 numUsers) public {
        numUsers = uint8(bound(numUsers, 1, 20));

        address[] memory users = new address[](numUsers);
        for (uint256 i = 0; i < numUsers; i++) {
            users[i] = address(uint160(0x1000 + i));
        }

        vm.prank(officer);
        registry.batchFreezeUsers(users, "batch freeze");

        for (uint256 i = 0; i < numUsers; i++) {
            ComplianceRegistry.UserProfile memory profile = registry.getUserProfile(users[i]);
            assertEq(uint8(profile.status), uint8(ComplianceRegistry.AccountStatus.FROZEN));
        }
    }
}
