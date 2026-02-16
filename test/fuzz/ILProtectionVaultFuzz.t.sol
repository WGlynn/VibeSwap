// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "forge-std/Test.sol";
import "../../contracts/incentives/ILProtectionVault.sol";
import "../../contracts/incentives/interfaces/IILProtectionVault.sol";
import "../../contracts/oracles/VolatilityOracle.sol";
import "@openzeppelin/contracts/proxy/ERC1967/ERC1967Proxy.sol";
import "@openzeppelin/contracts/token/ERC20/ERC20.sol";

// ============ Mocks ============

contract MockILFToken is ERC20 {
    constructor(string memory name_, string memory symbol_) ERC20(name_, symbol_) {}
    function mint(address to, uint256 amount) external { _mint(to, amount); }
}

contract MockILFAMM {
    function getPool(bytes32) external pure returns (
        address, address, uint256, uint256, uint256, bool
    ) {
        return (address(0), address(0), 100 ether, 100 ether, 30, true);
    }
}

// ============ Fuzz Tests ============

contract ILProtectionVaultFuzzTest is Test {
    ILProtectionVault public vault;
    VolatilityOracle public oracle;
    MockILFToken public quoteToken;
    MockILFAMM public mockAMM;

    address public owner;
    address public controller;
    address public lp;

    bytes32 constant POOL_ID = keccak256("pool-fuzz");

    function setUp() public {
        owner = address(this);
        controller = makeAddr("controller");
        lp = makeAddr("lp");

        quoteToken = new MockILFToken("Quote", "QT");
        mockAMM = new MockILFAMM();

        VolatilityOracle oracleImpl = new VolatilityOracle();
        bytes memory oracleInit = abi.encodeWithSelector(
            VolatilityOracle.initialize.selector,
            owner,
            address(mockAMM)
        );
        ERC1967Proxy oracleProxy = new ERC1967Proxy(address(oracleImpl), oracleInit);
        oracle = VolatilityOracle(address(oracleProxy));

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

        vault.setPoolQuoteToken(POOL_ID, address(quoteToken));

        quoteToken.mint(address(this), 10_000_000 ether);
        quoteToken.approve(address(vault), 10_000_000 ether);
        vault.depositFunds(address(quoteToken), 10_000_000 ether);
    }

    // ============ Fuzz: IL symmetric for price ratio ============

    function testFuzz_ilSymmetric(uint256 entryPrice, uint256 exitPrice) public view {
        entryPrice = bound(entryPrice, 1e15, 1e24);
        exitPrice = bound(exitPrice, 1e15, 1e24);

        uint256 ilForward = vault.calculateIL(entryPrice, exitPrice);
        uint256 ilReverse = vault.calculateIL(exitPrice, entryPrice);

        assertEq(ilForward, ilReverse, "IL must be symmetric for price ratio");
    }

    // ============ Fuzz: IL zero when prices equal ============

    function testFuzz_ilZeroWhenEqual(uint256 price) public view {
        price = bound(price, 1e15, 1e24);

        uint256 il = vault.calculateIL(price, price);
        assertEq(il, 0, "IL must be 0 when entry == exit price");
    }

    // ============ Fuzz: IL always < 10000 BPS (< 100%) ============

    function testFuzz_ilBounded(uint256 entryPrice, uint256 exitPrice) public view {
        entryPrice = bound(entryPrice, 1e15, 1e24);
        exitPrice = bound(exitPrice, 1e15, 1e24);

        uint256 il = vault.calculateIL(entryPrice, exitPrice);
        assertLt(il, 10000, "IL must be < 100%");
    }

    // ============ Fuzz: coverage bounded by tier rate ============

    function testFuzz_coverageBoundedByTier(uint256 liquidity, uint256 exitPrice, uint8 tier) public {
        liquidity = bound(liquidity, 1 ether, 1_000_000 ether);
        exitPrice = bound(exitPrice, 1e15, 1e24);
        tier = uint8(bound(tier, 0, 2));

        uint256 entryPrice = 1 ether;

        vm.prank(controller);
        vault.registerPosition(POOL_ID, lp, liquidity, entryPrice, tier);

        // Advance past max duration for any tier
        vm.warp(block.timestamp + 91 days);

        vm.prank(controller);
        (uint256 ilAmount, uint256 compensation) = vault.closePosition(POOL_ID, lp, exitPrice);

        IILProtectionVault.TierConfig memory config = vault.getTierConfig(tier);
        uint256 maxCompensation = (ilAmount * config.coverageRateBps) / 10000;

        assertLe(compensation, maxCompensation, "Compensation must be <= tier coverage rate * IL");
    }

    // ============ Fuzz: register creates correct position ============

    function testFuzz_registerCreatesPosition(uint256 liquidity, uint256 entryPrice, uint8 tier) public {
        liquidity = bound(liquidity, 1 ether, 1_000_000 ether);
        entryPrice = bound(entryPrice, 1e15, 1e24);
        tier = uint8(bound(tier, 0, 2));

        vm.prank(controller);
        vault.registerPosition(POOL_ID, lp, liquidity, entryPrice, tier);

        IILProtectionVault.LPPosition memory pos = vault.getPosition(POOL_ID, lp);
        assertEq(pos.liquidity, liquidity, "Position liquidity must match");
        assertEq(pos.entryPrice, entryPrice, "Position entryPrice must match");
        assertEq(pos.protectionTier, tier, "Position tier must match");
    }

    // ============ Fuzz: deposit increases reserves exactly ============

    function testFuzz_depositIncreasesReserves(uint256 amount) public {
        amount = bound(amount, 1, 1_000_000 ether);

        uint256 reserveBefore = vault.getTotalReserves(address(quoteToken));

        quoteToken.mint(address(this), amount);
        quoteToken.approve(address(vault), amount);
        vault.depositFunds(address(quoteToken), amount);

        assertEq(
            vault.getTotalReserves(address(quoteToken)),
            reserveBefore + amount,
            "Reserves must increase by deposit amount"
        );
    }
}
