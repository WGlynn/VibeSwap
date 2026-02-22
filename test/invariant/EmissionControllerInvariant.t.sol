// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "forge-std/Test.sol";
import "@openzeppelin/contracts/proxy/ERC1967/ERC1967Proxy.sol";
import "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import "../../contracts/incentives/EmissionController.sol";

// ============ Mocks ============

contract InvMockVIBE is ERC20 {
    uint256 public constant MAX_SUPPLY = 21_000_000e18;
    mapping(address => bool) public minters;

    constructor() ERC20("VIBE", "VIBE") {}

    function setMinter(address minter, bool authorized) external {
        minters[minter] = authorized;
    }

    function mint(address to, uint256 amount) external {
        require(minters[msg.sender], "Not minter");
        require(totalSupply() + amount <= MAX_SUPPLY, "Exceeds max");
        _mint(to, amount);
    }

    function mintableSupply() external view returns (uint256) {
        return MAX_SUPPLY - totalSupply();
    }
}

contract InvMockShapley {
    mapping(address => bool) public authorizedCreators;
    uint256 public gameCounter;

    function setAuthorizedCreator(address creator, bool authorized) external {
        authorizedCreators[creator] = authorized;
    }

    function createGameTyped(bytes32, uint256, address, uint8, IShapleyCreate.Participant[] calldata) external view {
        require(authorizedCreators[msg.sender], "Not authorized");
    }

    function computeShapleyValues(bytes32) external view {
        require(authorizedCreators[msg.sender], "Not authorized");
    }
}

contract InvMockStaking {
    address public rewardTokenAddr;
    address public stakingOwner;

    constructor(address _rewardToken) {
        rewardTokenAddr = _rewardToken;
        stakingOwner = msg.sender;
    }

    function transferOwnership(address newOwner) external {
        stakingOwner = newOwner;
    }

    function notifyRewardAmount(uint256 amount, uint256) external {
        require(msg.sender == stakingOwner, "Not owner");
        IERC20(rewardTokenAddr).transferFrom(msg.sender, address(this), amount);
    }
}

// ============ Handler ============

contract EmissionHandler is Test {
    EmissionController public ec;
    InvMockVIBE public vibe;

    uint256 public dripCount;
    uint256 public drainCount;
    uint256 public fundCount;

    constructor(EmissionController _ec, InvMockVIBE _vibe) {
        ec = _ec;
        vibe = _vibe;
    }

    function drip(uint256 timeDelta) external {
        timeDelta = bound(timeDelta, 1, 365 days);
        vm.warp(block.timestamp + timeDelta);

        try ec.drip() {
            dripCount++;
        } catch {}
    }

    function createGame(uint256 drainBps) external {
        drainBps = bound(drainBps, 100, 5000);

        if (ec.shapleyPool() == 0) return;

        uint256 drainAmount = (ec.shapleyPool() * drainBps) / 10_000;
        uint256 percentMin = (ec.shapleyPool() * ec.minDrainBps()) / 10_000;
        uint256 effectiveMin = percentMin > ec.minDrainAmount() ? percentMin : ec.minDrainAmount();
        if (drainAmount < effectiveMin) return;

        IShapleyCreate.Participant[] memory participants = new IShapleyCreate.Participant[](2);
        participants[0] = IShapleyCreate.Participant(address(0x1), 1000e18, 1 days, 5000, 5000);
        participants[1] = IShapleyCreate.Participant(address(0x2), 1000e18, 1 days, 5000, 5000);

        bytes32 gameId = keccak256(abi.encode(drainCount, block.timestamp));

        try ec.createContributionGame(gameId, participants, drainBps) {
            drainCount++;
        } catch {}
    }

    function fundStaking() external {
        if (ec.stakingPending() == 0) return;

        try ec.fundStaking() {
            fundCount++;
        } catch {}
    }
}

// ============ Invariant Tests ============

contract EmissionControllerInvariant is Test {
    EmissionController public ec;
    InvMockVIBE public vibe;
    InvMockShapley public shapley;
    InvMockStaking public staking;
    EmissionHandler public handler;
    address public gauge;

    uint256 public constant MAX_SUPPLY = 21_000_000e18;

    function setUp() public {
        vibe = new InvMockVIBE();
        shapley = new InvMockShapley();
        gauge = address(0x6A06E);
        staking = new InvMockStaking(address(vibe));

        EmissionController impl = new EmissionController();
        ERC1967Proxy proxy = new ERC1967Proxy(
            address(impl),
            abi.encodeCall(EmissionController.initialize, (
                address(this),
                address(vibe),
                address(shapley),
                gauge,
                address(staking)
            ))
        );
        ec = EmissionController(address(proxy));

        vibe.setMinter(address(ec), true);
        shapley.setAuthorizedCreator(address(ec), true);
        staking.transferOwnership(address(ec));
        ec.setAuthorizedDrainer(address(this), true);

        // Handler acts as the drainer (owner-level access through test contract)
        handler = new EmissionHandler(ec, vibe);
        ec.setAuthorizedDrainer(address(handler), true);

        // Target only the handler for invariant calls
        targetContract(address(handler));
    }

    // ============ Invariant 1: Total emitted never exceeds MAX_SUPPLY ============

    function invariant_totalEmittedLeMaxSupply() external view {
        assertLe(ec.totalEmitted(), MAX_SUPPLY);
        assertLe(vibe.totalSupply(), MAX_SUPPLY);
    }

    // ============ Invariant 2: Accounting identity ============
    // shapleyPool + totalShapleyDrained + totalGaugeFunded + stakingPending + totalStakingFunded == totalEmitted

    function invariant_accountingIdentity() external view {
        uint256 totalAccounted = ec.shapleyPool()
            + ec.totalShapleyDrained()
            + ec.totalGaugeFunded()
            + ec.stakingPending()
            + ec.totalStakingFunded();
        assertEq(totalAccounted, ec.totalEmitted());
    }

    // ============ Invariant 3: EC balance covers pool + pending ============

    function invariant_balanceCoversReserves() external view {
        uint256 ecBalance = vibe.balanceOf(address(ec));
        assertGe(ecBalance, ec.shapleyPool() + ec.stakingPending());
    }

    // ============ Invariant 4: Rate monotonically decreasing ============

    function invariant_rateLeBaseRate() external view {
        assertLe(ec.getCurrentRate(), ec.BASE_EMISSION_RATE());
    }

    // ============ Invariant 5: Era bounded ============

    function invariant_eraBounded() external view {
        assertLe(ec.getCurrentEra(), ec.MAX_ERAS());
    }

    // ============ Invariant 6: Gauge balance matches totalGaugeFunded ============

    function invariant_gaugeBalance() external view {
        assertEq(vibe.balanceOf(gauge), ec.totalGaugeFunded());
    }

    // ============ Call summary ============

    function invariant_callSummary() external view {
        // Just for logging — no assertions
        // console.log("Drips:", handler.dripCount());
        // console.log("Drains:", handler.drainCount());
        // console.log("Funds:", handler.fundCount());
    }
}
