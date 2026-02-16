// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "forge-std/Test.sol";
import "forge-std/StdInvariant.sol";
import "../../contracts/incentives/SlippageGuaranteeFund.sol";
import "../../contracts/incentives/interfaces/ISlippageGuaranteeFund.sol";
import "@openzeppelin/contracts/proxy/ERC1967/ERC1967Proxy.sol";
import "@openzeppelin/contracts/token/ERC20/ERC20.sol";

// ============ Mocks ============

contract MockSGIToken is ERC20 {
    constructor(string memory name_, string memory symbol_) ERC20(name_, symbol_) {}
    function mint(address to, uint256 amount) external { _mint(to, amount); }
}

// ============ Handler ============

contract SGFHandler is Test {
    SlippageGuaranteeFund public fund;
    MockSGIToken public token;

    address public controller;
    address public depositor;

    // Ghost variables
    uint256 public ghost_totalDeposited;
    uint256 public ghost_totalCompensated;
    uint256 public ghost_claimsCreated;
    uint256 public ghost_claimsProcessed;

    bytes32[] public pendingClaims;
    address[] public traders;

    constructor(
        SlippageGuaranteeFund _fund,
        MockSGIToken _token,
        address _controller,
        address _depositor
    ) {
        fund = _fund;
        token = _token;
        controller = _controller;
        depositor = _depositor;

        // Pre-generate trader addresses
        for (uint256 i = 0; i < 5; i++) {
            traders.push(address(uint160(i + 200)));
        }
    }

    function depositFunds(uint256 amount) public {
        amount = bound(amount, 1 ether, 10_000 ether);

        token.mint(depositor, amount);
        vm.prank(depositor);
        token.approve(address(fund), amount);

        vm.prank(depositor);
        try fund.depositFunds(address(token), amount) {
            ghost_totalDeposited += amount;
        } catch {}
    }

    function recordExecution(uint256 expectedSeed, uint256 shortfallBps, uint256 traderSeed) public {
        uint256 expected = bound(expectedSeed, 1000 ether, 100_000 ether);
        shortfallBps = bound(shortfallBps, 50, 3000); // 0.5% to 30%
        address trader = traders[traderSeed % traders.length];

        uint256 shortfall = (expected * shortfallBps) / 10000;
        uint256 actual = expected - shortfall;

        vm.prank(controller);
        try fund.recordExecution(
            keccak256(abi.encode("pool", ghost_claimsCreated)),
            trader,
            address(token),
            expected,
            actual
        ) returns (bytes32 claimId) {
            if (claimId != bytes32(0)) {
                pendingClaims.push(claimId);
                ghost_claimsCreated++;
            }
        } catch {}
    }

    function processClaim(uint256 claimSeed) public {
        if (pendingClaims.length == 0) return;

        uint256 idx = claimSeed % pendingClaims.length;
        bytes32 claimId = pendingClaims[idx];

        ISlippageGuaranteeFund.SlippageClaim memory claim = fund.getClaim(claimId);

        vm.prank(controller);
        try fund.processClaim(claimId) returns (uint256 compensation) {
            ghost_totalCompensated += compensation;
            ghost_claimsProcessed++;
            // Remove from pending
            pendingClaims[idx] = pendingClaims[pendingClaims.length - 1];
            pendingClaims.pop();
        } catch {}
    }

    function advanceTime(uint256 delta) public {
        delta = bound(delta, 1, 2 hours);
        vm.warp(block.timestamp + delta);
    }

    function getPendingCount() external view returns (uint256) {
        return pendingClaims.length;
    }
}

// ============ Invariant Tests ============

contract SlippageGuaranteeInvariantTest is StdInvariant, Test {
    SlippageGuaranteeFund public fund;
    MockSGIToken public token;
    SGFHandler public handler;

    address public owner;
    address public controller;
    address public depositor;

    function setUp() public {
        owner = address(this);
        controller = makeAddr("controller");
        depositor = makeAddr("depositor");

        token = new MockSGIToken("USDC", "USDC");

        SlippageGuaranteeFund impl = new SlippageGuaranteeFund();
        bytes memory initData = abi.encodeWithSelector(
            SlippageGuaranteeFund.initialize.selector,
            owner,
            controller
        );
        ERC1967Proxy proxy = new ERC1967Proxy(address(impl), initData);
        fund = SlippageGuaranteeFund(address(proxy));

        // Initial reserve deposit
        token.mint(address(this), 1_000_000 ether);
        token.approve(address(fund), 1_000_000 ether);
        fund.depositFunds(address(token), 1_000_000 ether);

        handler = new SGFHandler(fund, token, controller, depositor);
        targetContract(address(handler));
    }

    // ============ Invariant: reserves never negative (solvency) ============

    function invariant_reservesSolvent() public view {
        uint256 reserves = fund.getTotalReserves(address(token));
        uint256 tokenBal = token.balanceOf(address(fund));
        assertGe(tokenBal, reserves, "SOLVENCY: token balance < tracked reserves");
    }

    // ============ Invariant: totalClaimsProcessed consistent ============

    function invariant_claimsProcessedConsistent() public view {
        assertEq(
            fund.totalClaimsProcessed(),
            handler.ghost_claimsProcessed(),
            "CLAIMS: processed count mismatch"
        );
    }

    // ============ Invariant: totalCompensationPaid consistent ============

    function invariant_compensationPaidConsistent() public view {
        assertEq(
            fund.totalCompensationPaid(),
            handler.ghost_totalCompensated(),
            "COMPENSATION: paid mismatch"
        );
    }

    // ============ Invariant: claimNonce monotonically increasing ============

    function invariant_nonceMonotonic() public view {
        assertGe(
            fund.claimNonce(),
            handler.ghost_claimsCreated(),
            "NONCE: less than claims created"
        );
    }

    // ============ Invariant: compensation never exceeds deposits ============

    function invariant_compensationBounded() public view {
        // Total compensation should not exceed initial deposit + handler deposits
        uint256 totalFunded = 1_000_000 ether + handler.ghost_totalDeposited();
        assertLe(
            handler.ghost_totalCompensated(),
            totalFunded,
            "COMPENSATION: exceeds total funded"
        );
    }
}
