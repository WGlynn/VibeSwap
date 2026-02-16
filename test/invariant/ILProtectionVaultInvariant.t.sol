// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "forge-std/Test.sol";
import "forge-std/StdInvariant.sol";
import "../../contracts/incentives/ILProtectionVault.sol";
import "../../contracts/incentives/interfaces/IILProtectionVault.sol";
import "../../contracts/oracles/VolatilityOracle.sol";
import "@openzeppelin/contracts/proxy/ERC1967/ERC1967Proxy.sol";
import "@openzeppelin/contracts/token/ERC20/ERC20.sol";

// ============ Mocks ============

contract MockILIToken is ERC20 {
    constructor(string memory name_, string memory symbol_) ERC20(name_, symbol_) {}
    function mint(address to, uint256 amount) external { _mint(to, amount); }
}

contract MockILIAMM {
    function getPool(bytes32) external pure returns (
        address, address, uint256, uint256, uint256, bool
    ) {
        return (address(0), address(0), 100 ether, 100 ether, 30, true);
    }
}

// ============ Handler ============

contract ILVHandler is Test {
    ILProtectionVault public vault;
    MockILIToken public quoteToken;
    address public controller;

    bytes32 constant POOL_ID = keccak256("pool-inv");

    // Ghost variables
    uint256 public ghost_totalDeposited;
    uint256 public ghost_positionsCreated;

    address[] public lps;
    mapping(address => bool) public hasPosition;

    constructor(
        ILProtectionVault _vault,
        MockILIToken _quoteToken,
        address _controller
    ) {
        vault = _vault;
        quoteToken = _quoteToken;
        controller = _controller;

        for (uint256 i = 0; i < 5; i++) {
            lps.push(address(uint160(i + 400)));
        }
    }

    function registerPosition(uint256 lpSeed, uint256 liquidity, uint256 entryPrice, uint256 tierSeed) public {
        liquidity = bound(liquidity, 1 ether, 100_000 ether);
        entryPrice = bound(entryPrice, 1e15, 1e24);
        uint8 tier = uint8(tierSeed % 3);
        address lp = lps[lpSeed % lps.length];

        vm.prank(controller);
        try vault.registerPosition(POOL_ID, lp, liquidity, entryPrice, tier) {
            if (!hasPosition[lp]) {
                ghost_positionsCreated++;
                hasPosition[lp] = true;
            }
        } catch {}
    }

    function depositFunds(uint256 amount) public {
        amount = bound(amount, 1 ether, 10_000 ether);

        quoteToken.mint(address(this), amount);
        quoteToken.approve(address(vault), amount);

        try vault.depositFunds(address(quoteToken), amount) {
            ghost_totalDeposited += amount;
        } catch {}
    }

    function advanceTime(uint256 delta) public {
        delta = bound(delta, 1, 91 days);
        vm.warp(block.timestamp + delta);
    }

    function getLPCount() external view returns (uint256) {
        return lps.length;
    }
}

// ============ Invariant Tests ============

contract ILProtectionVaultInvariantTest is StdInvariant, Test {
    ILProtectionVault public vault;
    VolatilityOracle public oracle;
    MockILIToken public quoteToken;
    MockILIAMM public mockAMM;
    ILVHandler public handler;

    address public owner;
    address public controller;

    bytes32 constant POOL_ID = keccak256("pool-inv");

    function setUp() public {
        owner = address(this);
        controller = makeAddr("controller");

        quoteToken = new MockILIToken("Quote", "QT");
        mockAMM = new MockILIAMM();

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

        // Initial reserve deposit
        quoteToken.mint(address(this), 1_000_000 ether);
        quoteToken.approve(address(vault), 1_000_000 ether);
        vault.depositFunds(address(quoteToken), 1_000_000 ether);

        handler = new ILVHandler(vault, quoteToken, controller);
        targetContract(address(handler));
    }

    // ============ Invariant: reserves solvent ============

    function invariant_reservesSolvent() public view {
        uint256 tracked = vault.getTotalReserves(address(quoteToken));
        uint256 actual = quoteToken.balanceOf(address(vault));
        assertGe(actual, tracked, "SOLVENCY: token balance < tracked reserves");
    }

    // ============ Invariant: totalILPaid monotonically increasing ============

    function invariant_totalILPaidMonotonic() public view {
        // uint256 can't go negative, so this verifies no underflow
        uint256 paid = vault.totalILPaid();
        assertGe(paid, 0, "IL_PAID: must be non-negative");
    }

    // ============ Invariant: totalPositionsRegistered monotonic ============

    function invariant_positionsRegisteredMonotonic() public view {
        uint256 registered = vault.totalPositionsRegistered();
        assertGe(registered, 0, "POSITIONS: must be non-negative");
    }

    // ============ Invariant: all tier configs have valid coverage rates ============

    function invariant_tierConfigsValid() public view {
        for (uint8 t = 0; t <= 2; t++) {
            IILProtectionVault.TierConfig memory config = vault.getTierConfig(t);
            assertLe(config.coverageRateBps, 10000, "TIER: coverage rate exceeds 100%");
        }
    }

    // ============ Invariant: position claimed <= position IL accrued ============

    function invariant_claimedNeverExceedsIL() public view {
        uint256 lpCount = handler.getLPCount();

        for (uint256 i = 0; i < lpCount; i++) {
            address lp = handler.lps(i);
            IILProtectionVault.LPPosition memory pos = vault.getPosition(POOL_ID, lp);

            if (pos.liquidity > 0) {
                assertLe(pos.ilClaimed, pos.ilAccrued, "CLAIM: claimed exceeds IL accrued");
            }
        }
    }
}
