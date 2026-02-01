// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "forge-std/Test.sol";
import "../../contracts/incentives/ILProtectionVault.sol";
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
            owner
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
        quoteToken.mint(address(vault), 1000 ether);
        vault.addReserves(address(quoteToken), 1000 ether);
    }

    // ============ Initialization Tests ============

    function test_initialize() public view {
        assertEq(vault.owner(), owner);
        assertEq(vault.incentiveController(), controller);
        assertEq(address(vault.volatilityOracle()), address(oracle));
    }

    function test_tierConfigs() public view {
        // Basic tier (0)
        (uint256 coverage0, uint256 minDuration0) = vault.tierConfigs(0);
        assertEq(coverage0, 2500); // 25%
        assertEq(minDuration0, 0);

        // Standard tier (1)
        (uint256 coverage1, uint256 minDuration1) = vault.tierConfigs(1);
        assertEq(coverage1, 5000); // 50%
        assertEq(minDuration1, 30 days);

        // Premium tier (2)
        (uint256 coverage2, uint256 minDuration2) = vault.tierConfigs(2);
        assertEq(coverage2, 8000); // 80%
        assertEq(minDuration2, 90 days);
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
        assertEq(pos.tier, 1);
        assertEq(pos.startTime, block.timestamp);
        assertTrue(pos.active);
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
        uint256 il = vault.calculateImpermanentLoss(1 ether, 1 ether, 100 ether);
        assertEq(il, 0);
    }

    function test_calculateIL_priceIncrease() public view {
        // Price doubles: IL ≈ 5.72%
        uint256 il = vault.calculateImpermanentLoss(1 ether, 2 ether, 100 ether);
        assertGt(il, 0);
        // Should be roughly 5.72% of 100 ether ≈ 5.72 ether
        assertApproxEqRel(il, 5.72 ether, 0.1e18); // 10% tolerance
    }

    function test_calculateIL_priceDecrease() public view {
        // Price halves: IL ≈ 5.72%
        uint256 il = vault.calculateImpermanentLoss(1 ether, 0.5 ether, 100 ether);
        assertGt(il, 0);
        assertApproxEqRel(il, 5.72 ether, 0.1e18);
    }

    function test_calculateIL_largerPriceChange() public view {
        // Price 4x: IL ≈ 20%
        uint256 il = vault.calculateImpermanentLoss(1 ether, 4 ether, 100 ether);
        assertApproxEqRel(il, 20 ether, 0.1e18);
    }

    // ============ Claim Tests ============

    function test_claimILProtection_basicTier() public {
        // Register position with basic tier (25% coverage, no min duration)
        vm.prank(controller);
        vault.registerPosition(POOL_ID, alice, 100 ether, 1 ether, 0);

        // Claim immediately (price doubled = 5.72% IL)
        uint256 balanceBefore = quoteToken.balanceOf(alice);

        vm.prank(controller);
        uint256 payout = vault.claimILProtection(POOL_ID, alice, 2 ether);

        // Should get 25% of IL
        assertGt(payout, 0);
        assertEq(quoteToken.balanceOf(alice), balanceBefore + payout);
    }

    function test_claimILProtection_standardTier() public {
        // Register with standard tier (50% coverage, 30 day min)
        vm.prank(controller);
        vault.registerPosition(POOL_ID, alice, 100 ether, 1 ether, 1);

        // Warp past minimum duration
        vm.warp(block.timestamp + 31 days);

        vm.prank(controller);
        uint256 payout = vault.claimILProtection(POOL_ID, alice, 2 ether);

        // Should get 50% of IL (more than basic)
        assertGt(payout, 0);
    }

    function test_claimILProtection_premiumTier() public {
        // Register with premium tier (80% coverage, 90 day min)
        vm.prank(controller);
        vault.registerPosition(POOL_ID, alice, 100 ether, 1 ether, 2);

        // Warp past minimum duration
        vm.warp(block.timestamp + 91 days);

        vm.prank(controller);
        uint256 payout = vault.claimILProtection(POOL_ID, alice, 2 ether);

        // Should get 80% of IL (most coverage)
        assertGt(payout, 0);
    }

    function test_claimILProtection_revertMinDurationNotMet() public {
        // Register with standard tier (30 day min)
        vm.prank(controller);
        vault.registerPosition(POOL_ID, alice, 100 ether, 1 ether, 1);

        // Try to claim before min duration
        vm.prank(controller);
        vm.expectRevert(ILProtectionVault.MinDurationNotMet.selector);
        vault.claimILProtection(POOL_ID, alice, 2 ether);
    }

    function test_claimILProtection_noIL() public {
        vm.prank(controller);
        vault.registerPosition(POOL_ID, alice, 100 ether, 1 ether, 0);

        // Same price = no IL = no payout
        vm.prank(controller);
        uint256 payout = vault.claimILProtection(POOL_ID, alice, 1 ether);

        assertEq(payout, 0);
    }

    // ============ Reserve Management Tests ============

    function test_addReserves() public {
        uint256 before = vault.reserves(address(quoteToken));

        quoteToken.mint(address(vault), 100 ether);
        vault.addReserves(address(quoteToken), 100 ether);

        assertEq(vault.reserves(address(quoteToken)), before + 100 ether);
    }

    function test_claimILProtection_revertInsufficientReserves() public {
        // Create new vault with no reserves
        ILProtectionVault emptyVault = _deployEmptyVault();

        vm.prank(controller);
        emptyVault.registerPosition(POOL_ID, alice, 100 ether, 1 ether, 0);

        vm.prank(controller);
        vm.expectRevert(ILProtectionVault.InsufficientReserves.selector);
        emptyVault.claimILProtection(POOL_ID, alice, 2 ether);
    }

    // ============ Admin Tests ============

    function test_setTierConfig() public {
        vault.setTierConfig(0, 3000, 7 days); // 30% coverage, 7 day min

        (uint256 coverage, uint256 minDuration) = vault.tierConfigs(0);
        assertEq(coverage, 3000);
        assertEq(minDuration, 7 days);
    }

    function test_setPoolQuoteToken() public {
        MockERC20 newToken = new MockERC20("New", "NEW");
        bytes32 newPool = keccak256("new-pool");

        vault.setPoolQuoteToken(newPool, address(newToken));
        assertEq(vault.poolQuoteTokens(newPool), address(newToken));
    }

    // ============ Helpers ============

    function _deployEmptyVault() internal returns (ILProtectionVault) {
        ILProtectionVault vaultImpl = new ILProtectionVault();
        bytes memory vaultInit = abi.encodeWithSelector(
            ILProtectionVault.initialize.selector,
            owner,
            address(oracle),
            controller,
            address(mockAMM)
        );
        ERC1967Proxy vaultProxy = new ERC1967Proxy(address(vaultImpl), vaultInit);
        ILProtectionVault v = ILProtectionVault(address(vaultProxy));
        v.setPoolQuoteToken(POOL_ID, address(quoteToken));
        return v;
    }
}
