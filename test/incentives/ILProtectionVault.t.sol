// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "forge-std/Test.sol";
import "../../contracts/incentives/ILProtectionVault.sol";
import "../../contracts/incentives/interfaces/IILProtectionVault.sol";
import "../../contracts/oracles/VolatilityOracle.sol";
import "@openzeppelin/contracts/proxy/ERC1967/ERC1967Proxy.sol";
import "@openzeppelin/contracts/token/ERC20/ERC20.sol";

contract MockERC20 is ERC20 {
    constructor(string memory name, string memory symbol) ERC20(name, symbol) {}

    function mint(address to, uint256 amount) external {
        _mint(to, amount);
    }
}

contract MockVibeAMM {
    function getPool(bytes32) external pure returns (
        address token0,
        address token1,
        uint256 reserve0,
        uint256 reserve1,
        uint256 feeRate,
        bool initialized
    ) {
        return (address(0), address(0), 100 ether, 100 ether, 30, true);
    }
}

contract ILProtectionVaultTest is Test {
    ILProtectionVault public vault;
    VolatilityOracle public oracle;
    MockERC20 public quoteToken;
    MockVibeAMM public mockAMM;

    address public owner;
    address public controller;
    address public alice;
    address public bob;

    bytes32 public constant POOL_ID = keccak256("pool-1");

    function setUp() public {
        owner = address(this);
        controller = makeAddr("controller");
        alice = makeAddr("alice");
        bob = makeAddr("bob");

        // Deploy mocks
        quoteToken = new MockERC20("Quote", "QT");
        mockAMM = new MockVibeAMM();

        // Deploy oracle
        VolatilityOracle oracleImpl = new VolatilityOracle();
        bytes memory oracleInit = abi.encodeWithSelector(
            VolatilityOracle.initialize.selector,
            owner,
            address(mockAMM)
        );
        ERC1967Proxy oracleProxy = new ERC1967Proxy(address(oracleImpl), oracleInit);
        oracle = VolatilityOracle(address(oracleProxy));

        // Deploy vault
        ILProtectionVault vaultImpl = new ILProtectionVault();
        bytes memory vaultInit = abi.encodeWithSelector(
            ILProtectionVault.initialize.selector,
            owner,
            address(oracle),
            controller,
            address(mockAMM)
        );
        ERC1967Proxy vaultProxy = new ERC1967Proxy(address(vaultImpl), vaultInit);
        vault = ILProtectionVault(address(vaultProxy));

        // Setup pool quote token
        vault.setPoolQuoteToken(POOL_ID, address(quoteToken));

        // Fund vault reserves
        quoteToken.mint(address(this), 1000 ether);
        quoteToken.approve(address(vault), 1000 ether);
        vault.depositFunds(address(quoteToken), 1000 ether);
    }

    // ============ Initialization Tests ============

    function test_initialize() public view {
        assertEq(vault.owner(), owner);
        assertEq(vault.incentiveController(), controller);
        assertEq(address(vault.volatilityOracle()), address(oracle));
    }

    function test_tierConfigs() public view {
        // Basic tier (0)
        IILProtectionVault.TierConfig memory tier0 = vault.getTierConfig(0);
        assertEq(tier0.coverageRateBps, 2500); // 25%
        assertEq(tier0.minDuration, 0);

        // Standard tier (1)
        IILProtectionVault.TierConfig memory tier1 = vault.getTierConfig(1);
        assertEq(tier1.coverageRateBps, 5000); // 50%
        assertEq(tier1.minDuration, 30 days);

        // Premium tier (2)
        IILProtectionVault.TierConfig memory tier2 = vault.getTierConfig(2);
        assertEq(tier2.coverageRateBps, 8000); // 80%
        assertEq(tier2.minDuration, 90 days);
    }

    // ============ Position Registration Tests ============

    function test_registerPosition() public {
        vm.prank(controller);
        vault.registerPosition(
            POOL_ID,
            alice,
            100 ether,  // liquidity
            1 ether,    // entryPrice
            1           // tier (Standard)
        );

        IILProtectionVault.LPPosition memory pos = vault.getPosition(POOL_ID, alice);
        assertEq(pos.liquidity, 100 ether);
        assertEq(pos.entryPrice, 1 ether);
        assertEq(pos.protectionTier, 1);
        assertEq(pos.depositTimestamp, block.timestamp);
    }

    function test_registerPosition_revertUnauthorized() public {
        vm.prank(alice);
        vm.expectRevert(ILProtectionVault.Unauthorized.selector);
        vault.registerPosition(POOL_ID, alice, 100 ether, 1 ether, 0);
    }

    function test_registerPosition_revertInvalidTier() public {
        vm.prank(controller);
        vm.expectRevert(ILProtectionVault.InvalidTier.selector);
        vault.registerPosition(POOL_ID, alice, 100 ether, 1 ether, 5);
    }

    // ============ IL Calculation Tests ============

    function test_calculateIL_noChange() public view {
        // Same price = no IL
        uint256 ilBps = vault.calculateIL(1 ether, 1 ether);
        assertEq(ilBps, 0);
    }

    function test_calculateIL_priceIncrease() public view {
        // Price doubles: IL ≈ 5.72% = 572 bps
        uint256 ilBps = vault.calculateIL(1 ether, 2 ether);
        assertGt(ilBps, 0);
        assertLt(ilBps, 1000); // Less than 10%
    }

    function test_calculateIL_priceDecrease() public view {
        // Price halves: IL ≈ 5.72% = 572 bps
        uint256 ilBps = vault.calculateIL(1 ether, 0.5 ether);
        assertGt(ilBps, 0);
        assertLt(ilBps, 1000); // Less than 10%
    }

    function test_calculateIL_largerPriceChange() public view {
        // Price 4x: IL ≈ 20% = 2000 bps
        uint256 ilBps = vault.calculateIL(1 ether, 4 ether);
        assertGt(ilBps, 1000); // More than 10%
        assertLt(ilBps, 3000); // Less than 30%
    }

    // ============ Reserve Management Tests ============

    function test_depositFunds() public {
        uint256 before = vault.getTotalReserves(address(quoteToken));

        quoteToken.mint(address(this), 100 ether);
        quoteToken.approve(address(vault), 100 ether);
        vault.depositFunds(address(quoteToken), 100 ether);

        assertEq(vault.getTotalReserves(address(quoteToken)), before + 100 ether);
    }

    // ============ Admin Tests ============

    function test_configureTier() public {
        vault.configureTier(0, 3000, 7 days); // 30% coverage, 7 day min

        IILProtectionVault.TierConfig memory tier = vault.getTierConfig(0);
        assertEq(tier.coverageRateBps, 3000);
        assertEq(tier.minDuration, 7 days);
    }

    function test_setPoolQuoteToken() public {
        MockERC20 newToken = new MockERC20("New", "NEW");
        bytes32 newPool = keccak256("new-pool");

        vault.setPoolQuoteToken(newPool, address(newToken));
        assertEq(vault.poolQuoteTokens(newPool), address(newToken));
    }

    // ============ C16-F2: Tier kill-switch (access-control asymmetry) ============

    /// @dev Pre-fix: TierConfig.active was checked in closePosition but never settable
    ///      to false (initializer + configureTier both wrote `active: true` only). Even
    ///      worse, claimProtection and getClaimableAmount didn't check `active` at all,
    ///      so the gate was half-enforced. This test asserts:
    ///        1. setTierActive(false) actually flips the flag.
    ///        2. closePosition skips compensation when tier is inactive.
    ///        3. claimProtection returns 0 (no payout, no revert) when tier is inactive.
    ///        4. getClaimableAmount mirrors the on-chain decision.
    function test_C16F2_setTierActive_flipsFlag() public {
        // Initially active
        assertTrue(vault.getTierConfig(0).active);

        vault.setTierActive(0, false);
        assertFalse(vault.getTierConfig(0).active);

        vault.setTierActive(0, true);
        assertTrue(vault.getTierConfig(0).active);
    }

    function test_C16F2_setTierActive_revertsOnInvalidTier() public {
        vm.expectRevert(ILProtectionVault.InvalidTier.selector);
        vault.setTierActive(99, false);
    }

    function test_C16F2_setTierActive_onlyOwner() public {
        vm.prank(alice);
        vm.expectRevert(); // OZ Ownable revert
        vault.setTierActive(0, false);
    }

    function test_C16F2_claimProtection_skipsWhenInactive() public {
        // Register a position on tier 0 (no minDuration), accrue some IL, then
        // deactivate the tier and confirm claim returns 0.
        vm.prank(controller);
        vault.registerPosition(POOL_ID, alice, 100 ether, 1e18, 0);

        // Force ilAccrued > 0 by closing at a moved price (this also pays compensation
        // via the controller path, but we're going to test direct claim afterwards)
        // Use closePosition's tier-0 (zero minDuration, 25% coverage).
        vm.prank(controller);
        vault.closePosition(POOL_ID, alice, 1.5e18); // exitPrice 1.5x

        // Re-register to set up a fresh position, then deactivate tier and try claim
        vm.prank(controller);
        vault.registerPosition(POOL_ID, bob, 100 ether, 1e18, 0);

        // Manually accrue IL by calling closePosition for bob then re-registering — but
        // close position zeros liquidity? Actually closePosition doesn't zero liquidity
        // in this contract; it only updates ilAccrued. So bob has accrued IL now.
        vm.prank(controller);
        vault.closePosition(POOL_ID, bob, 1.5e18);

        // Now deactivate tier 0
        vault.setTierActive(0, false);

        // Bob tries to claim directly — pre-fix this would pay; post-fix returns 0.
        uint256 reservesBefore = vault.getTotalReserves(address(quoteToken));
        vm.prank(bob);
        uint256 claimed = vault.claimProtection(POOL_ID, bob);
        assertEq(claimed, 0, "Claim should return 0 when tier inactive");
        assertEq(
            vault.getTotalReserves(address(quoteToken)),
            reservesBefore,
            "Reserves should not move when tier inactive"
        );
    }

    function test_C16F2_getClaimableAmount_mirrorsActiveFlag() public {
        // Register and accrue IL
        vm.prank(controller);
        vault.registerPosition(POOL_ID, alice, 100 ether, 1e18, 0);
        vm.prank(controller);
        vault.closePosition(POOL_ID, alice, 1.5e18);

        // Active: claimable > 0
        uint256 claimableActive = vault.getClaimableAmount(POOL_ID, alice);

        // Deactivate
        vault.setTierActive(0, false);
        uint256 claimableInactive = vault.getClaimableAmount(POOL_ID, alice);
        assertEq(claimableInactive, 0, "View must mirror on-chain inactive state");

        // Reactivate restores parity
        vault.setTierActive(0, true);
        assertEq(vault.getClaimableAmount(POOL_ID, alice), claimableActive);
    }
}
