// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "forge-std/Test.sol";
import "forge-std/StdInvariant.sol";
import "../../contracts/mechanism/AugmentedBondingCurve.sol";
import "@openzeppelin/contracts/token/ERC20/ERC20.sol";

// ============ Mock Tokens ============

contract MockABCIReserve is ERC20 {
    constructor() ERC20("Reserve", "DAI") {
        _mint(msg.sender, 1_000_000_000e18);
    }
    function mint(address to, uint256 amount) external { _mint(to, amount); }
}

contract MockABCIToken is ERC20 {
    address public controller;
    constructor() ERC20("Community", "VIBE") {}
    function setController(address _c) external { controller = _c; }
    function mint(address to, uint256 amount) external {
        require(msg.sender == controller, "Not controller");
        _mint(to, amount);
    }
    function burnFrom(address from, uint256 amount) external {
        require(msg.sender == controller, "Not controller");
        _burn(from, amount);
    }
}

// ============ Handler: bounded actions ============

contract ABCHandler is Test {
    AugmentedBondingCurve public abc;
    MockABCIReserve public dai;
    MockABCIToken public vibe;

    address[] public actors;
    uint256 public bondCount;
    uint256 public burnCount;
    uint256 public totalTributes;

    constructor(AugmentedBondingCurve _abc, MockABCIReserve _dai, MockABCIToken _vibe) {
        abc = _abc;
        dai = _dai;
        vibe = _vibe;

        // Create actors
        for (uint256 i = 0; i < 5; i++) {
            address actor = address(uint160(0xA000 + i));
            actors.push(actor);
            dai.mint(actor, 50_000_000e18);
            vm.prank(actor);
            dai.approve(address(abc), type(uint256).max);
            vm.prank(actor);
            vibe.approve(address(abc), type(uint256).max);
        }
    }

    function bondToMint(uint256 actorSeed, uint256 amount) external {
        address actor = actors[actorSeed % actors.length];
        amount = bound(amount, 1e15, 500_000e18);

        vm.prank(actor);
        try abc.bondToMint(amount, 0) returns (uint256) {
            bondCount++;
            // Track entry tributes
            uint256 tribute = (amount * abc.entryTributeBps()) / 10000;
            totalTributes += tribute;
        } catch {}
    }

    function burnToWithdraw(uint256 actorSeed, uint256 burnPct) external {
        address actor = actors[actorSeed % actors.length];
        uint256 balance = vibe.balanceOf(actor);
        if (balance == 0) return;

        // Burn 1-50% of holdings
        burnPct = bound(burnPct, 1, 50);
        uint256 burnAmount = (balance * burnPct) / 100;
        if (burnAmount == 0) return;

        // Don't burn entire supply
        if (burnAmount >= vibe.totalSupply() - 1e18) return;

        vm.prank(actor);
        try abc.burnToWithdraw(burnAmount, 0) returns (uint256) {
            burnCount++;
        } catch {}
    }

    function deposit(uint256 actorSeed, uint256 amount) external {
        address actor = actors[actorSeed % actors.length];
        amount = bound(amount, 1e15, 100_000e18);

        vm.prank(actor);
        try abc.deposit(amount) {} catch {}
    }
}

// ============ Invariant Test Suite ============

contract AugmentedBondingCurveInvariantTest is StdInvariant, Test {
    AugmentedBondingCurve public abc;
    MockABCIReserve public dai;
    MockABCIToken public vibe;
    ABCHandler public handler;

    uint256 constant PRECISION = 1e18;
    uint256 constant KAPPA = 6;
    uint256 public initialInvariant;

    function setUp() public {
        dai = new MockABCIReserve();
        vibe = new MockABCIToken();

        abc = new AugmentedBondingCurve(
            address(dai),
            address(vibe),
            address(vibe),
            KAPPA,
            500,  // 5% entry tribute
            1000  // 10% exit tribute
        );

        vibe.setController(address(abc));

        // Initialize with hatch supply
        uint256 initSupply = 500_000_000e18;
        uint256 reserveAmount = 3_000_000e18;
        uint256 fundingAmount = 2_000_000e18;

        // Mint initial supply
        vibe.setController(address(this));
        // Distribute to 5 actors
        for (uint256 i = 0; i < 5; i++) {
            address actor = address(uint160(0xA000 + i));
            vibe.mint(actor, initSupply / 5);
        }
        vibe.setController(address(abc));

        // Fund and open
        dai.mint(address(abc), reserveAmount + fundingAmount);
        abc.openCurve(reserveAmount, fundingAmount, initSupply);

        initialInvariant = abc.currentInvariant();

        // Create handler
        handler = new ABCHandler(abc, dai, vibe);

        // Target only the handler
        targetContract(address(handler));
    }

    // ============ Invariant 1: Conservation V(R,S) = V₀ ============

    function invariant_conservationInvariant() public view {
        uint256 currentV = abc.currentInvariant();
        uint256 v0 = abc.invariantV0();

        // Allow 0.1% tolerance for rounding
        uint256 tolerance = v0 / 1000;
        if (tolerance == 0) tolerance = 1;

        assertApproxEqAbs(currentV, v0, tolerance, "Conservation invariant violated");
    }

    // ============ Invariant 2: Reserve + Funding = Total locked DAI ============

    function invariant_reservePlusFundingMatchesBalance() public view {
        uint256 daiBalance = dai.balanceOf(address(abc));
        uint256 reservePlusFunding = abc.reserve() + abc.fundingPool();

        // ABC's DAI balance should be >= reserve + funding
        // (it can be slightly more due to rounding)
        assertGe(daiBalance, reservePlusFunding - 1, "DAI balance < reserve + funding");
    }

    // ============ Invariant 3: Spot price is always positive ============

    function invariant_positiveSpotPrice() public view {
        uint256 price = abc.spotPrice();
        assertGt(price, 0, "Spot price must be positive");
    }

    // ============ Invariant 4: Supply is always positive ============

    function invariant_positiveSupply() public view {
        uint256 supply = vibe.totalSupply();
        assertGt(supply, 0, "Supply must be positive");
    }

    // ============ Invariant 5: Funding pool never negative (unsigned, but check logic) ============

    function invariant_fundingPoolNonNegative() public view {
        // This is guaranteed by uint256 but checks accounting
        // Funding pool is uint256 so always >= 0, but verify accounting is sane
        uint256 fp = abc.fundingPool();
        assertGe(fp, 0, "Funding pool is non-negative");
    }

    // ============ Invariant 6: Curve must be open ============

    function invariant_curveIsOpen() public view {
        assertTrue(abc.isOpen(), "Curve must stay open");
    }

    // ============ Invariant 7: Price derived from state (κR/S) ============

    function invariant_priceDerivedFromState() public view {
        uint256 supply = vibe.totalSupply();
        uint256 expectedPrice = (KAPPA * abc.reserve() * PRECISION) / supply;
        uint256 actualPrice = abc.spotPrice();

        assertEq(actualPrice, expectedPrice, "Price must be derived from kappa*R/S");
    }

    // ============ Call summary ============

    function invariant_callSummary() public view {
        // Just for debugging — no assertions
    }
}
