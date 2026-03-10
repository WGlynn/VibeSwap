// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "forge-std/Test.sol";
import "forge-std/StdInvariant.sol";
import "../../contracts/mechanism/HatchManager.sol";
import "../../contracts/mechanism/AugmentedBondingCurve.sol";
import "@openzeppelin/contracts/token/ERC20/ERC20.sol";

// ============ Mock Tokens ============

contract MockHMIReserve is ERC20 {
    constructor() ERC20("Reserve", "DAI") {
        _mint(msg.sender, 1_000_000_000e18);
    }
    function mint(address to, uint256 amount) external { _mint(to, amount); }
}

contract MockHMIToken is ERC20 {
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

contract HatchHandler is Test {
    HatchManager public hatch;
    MockHMIReserve public dai;
    MockHMIToken public vibe;

    address[] public hatchers;
    uint256 public contributionCount;
    uint256 public totalContributed;

    constructor(HatchManager _hatch, MockHMIReserve _dai, MockHMIToken _vibe) {
        hatch = _hatch;
        dai = _dai;
        vibe = _vibe;

        // Create hatcher actors
        for (uint256 i = 0; i < 5; i++) {
            address hatcher = address(uint160(0xB000 + i));
            hatchers.push(hatcher);
            dai.mint(hatcher, 10_000_000e18);
            vm.prank(hatcher);
            dai.approve(address(hatch), type(uint256).max);
        }
    }

    function contribute(uint256 hatcherSeed, uint256 amount) external {
        address hatcher = hatchers[hatcherSeed % hatchers.length];
        amount = bound(amount, 1e18, 100_000e18);

        // Don't exceed max raise
        uint256 remaining = hatch.getHatchConfig().maxRaise - hatch.totalRaised();
        if (remaining == 0) return;
        if (amount > remaining) amount = remaining;

        vm.prank(hatcher);
        try hatch.contribute(amount) {
            contributionCount++;
            totalContributed += amount;
        } catch {}
    }
}

// ============ Invariant Test Suite ============

contract HatchManagerInvariantTest is StdInvariant, Test {
    HatchManager public hatch;
    AugmentedBondingCurve public abc;
    MockHMIReserve public dai;
    MockHMIToken public vibe;
    HatchHandler public handler;

    uint256 constant PRECISION = 1e18;
    uint256 constant KAPPA = 6;

    function setUp() public {
        dai = new MockHMIReserve();
        vibe = new MockHMIToken();

        abc = new AugmentedBondingCurve(
            address(dai),
            address(vibe),
            address(vibe),
            KAPPA,
            500,  // 5% entry tribute
            1000  // 10% exit tribute
        );

        HatchManager.HatchConfig memory cfg = HatchManager.HatchConfig({
            minRaise: 100_000e18,
            maxRaise: 5_000_000e18,
            hatchPrice: 0.01e18,
            thetaBps: 4000,  // 40% to funding
            vestingHalfLife: 1000,
            hatchDeadline: block.number + 10_000 // Long deadline for invariant runs
        });

        hatch = new HatchManager(
            address(abc),
            address(dai),
            address(vibe),
            address(vibe),
            cfg
        );

        abc.setHatchManager(address(hatch));
        vibe.setController(address(hatch));

        // Approve all hatchers and start hatch
        handler = new HatchHandler(hatch, dai, vibe);
        for (uint256 i = 0; i < 5; i++) {
            hatch.approveHatcher(address(uint160(0xB000 + i)));
        }
        hatch.startHatch();

        // Target only the handler
        targetContract(address(handler));
    }

    // ============ Invariant 1: totalRaised = sum of contributions ============

    function invariant_totalRaisedConsistent() public view {
        assertEq(hatch.totalRaised(), handler.totalContributed(), "totalRaised must match handler tracking");
    }

    // ============ Invariant 2: DAI balance matches totalRaised ============

    function invariant_daiBalanceMatchesTotalRaised() public view {
        uint256 daiBalance = dai.balanceOf(address(hatch));
        assertEq(daiBalance, hatch.totalRaised(), "DAI balance must equal totalRaised");
    }

    // ============ Invariant 3: totalRaised <= maxRaise ============

    function invariant_neverExceedsMaxRaise() public view {
        HatchManager.HatchConfig memory cfg = hatch.getHatchConfig();
        assertLe(hatch.totalRaised(), cfg.maxRaise, "Must not exceed max raise");
    }

    // ============ Invariant 4: Token allocation matches raise / price ============

    function invariant_tokenAllocationConsistent() public view {
        HatchManager.HatchConfig memory cfg = hatch.getHatchConfig();
        uint256 expectedTokens = (hatch.totalRaised() * PRECISION) / cfg.hatchPrice;
        assertEq(hatch.totalHatchTokens(), expectedTokens, "Token allocation must match raise/price");
    }

    // ============ Invariant 5: Phase stays OPEN during contributions ============

    function invariant_phaseIsOpen() public view {
        assertEq(uint(hatch.phase()), uint(HatchManager.HatchPhase.OPEN), "Phase must stay OPEN");
    }

    // ============ Invariant 6: Hatcher count is bounded ============

    function invariant_hatcherCountBounded() public view {
        assertLe(hatch.hatcherCount(), 5, "At most 5 hatchers");
    }

    // ============ Call summary ============

    function invariant_callSummary() public view {
        // For debugging — no assertions
    }
}
