// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "forge-std/Test.sol";
import "@openzeppelin/contracts/proxy/ERC1967/ERC1967Proxy.sol";
import "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import "../../contracts/incentives/EmissionController.sol";

// ============ Mock (same as unit test) ============

contract FuzzMockVIBE is ERC20 {
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

contract FuzzMockShapley {
    mapping(address => bool) public authorizedCreators;

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

contract FuzzMockStaking {
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

// ============ Fuzz Tests ============

contract EmissionControllerFuzz is Test {
    EmissionController public ec;
    FuzzMockVIBE public vibe;
    FuzzMockShapley public shapley;
    FuzzMockStaking public staking;
    address public gauge;

    uint256 public constant BASE_RATE = 332_880_110_000_000_000;
    uint256 public constant ERA_DURATION = 31_557_600;
    uint256 public constant MAX_SUPPLY = 21_000_000e18;

    function setUp() public {
        vibe = new FuzzMockVIBE();
        shapley = new FuzzMockShapley();
        gauge = address(0x6A06E);
        staking = new FuzzMockStaking(address(vibe));

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
    }

    // ============ Fuzz: Drip at any time ============

    function testFuzzDrip(uint256 elapsed) public {
        elapsed = bound(elapsed, 1, 50 * ERA_DURATION); // 0 to 50 years

        vm.warp(block.timestamp + elapsed);

        uint256 pending = ec.pendingEmissions();
        uint256 mintable = vibe.mintableSupply();
        uint256 expectedMint = pending > mintable ? mintable : pending;

        if (expectedMint == 0) return; // nothing to drip

        uint256 minted = ec.drip();
        assertEq(minted, expectedMint);
        assertLe(ec.totalEmitted(), MAX_SUPPLY);
    }

    // ============ Fuzz: Max supply cap ============

    function testFuzzMaxSupplyCap(uint256 elapsed) public {
        elapsed = bound(elapsed, 1, 100 * ERA_DURATION);

        vm.warp(block.timestamp + elapsed);

        uint256 pending = ec.pendingEmissions();
        uint256 mintable = vibe.mintableSupply();

        if (pending == 0) return;

        ec.drip();

        // Core invariant: never exceed MAX_SUPPLY
        assertLe(vibe.totalSupply(), MAX_SUPPLY);
        assertLe(ec.totalEmitted(), MAX_SUPPLY);
    }

    // ============ Fuzz: Cross-era accrual ============

    function testFuzzCrossEraAccrual(uint256 elapsed) public {
        elapsed = bound(elapsed, 1, 10 * ERA_DURATION);

        vm.warp(block.timestamp + elapsed);

        uint256 pending = ec.pendingEmissions();

        // Manual calculation for verification
        uint256 genesis = ec.genesisTime();
        uint256 lastTime = ec.lastDripTime();
        uint256 currentTime = block.timestamp;
        uint256 manualTotal = 0;

        for (uint256 era = 0; era <= 32; era++) {
            uint256 rate = BASE_RATE >> era;
            if (rate == 0) break;

            uint256 eraStart = genesis + era * ERA_DURATION;
            uint256 eraEnd = genesis + (era + 1) * ERA_DURATION;

            if (eraEnd <= lastTime) continue;
            if (eraStart >= currentTime) break;

            uint256 start = lastTime > eraStart ? lastTime : eraStart;
            uint256 end = currentTime < eraEnd ? currentTime : eraEnd;

            manualTotal += rate * (end - start);
        }

        assertEq(pending, manualTotal);
    }

    // ============ Fuzz: Budget split sums correctly ============

    function testFuzzBudgetSplit(uint16 s, uint16 g) public {
        // Ensure s + g <= 10000 so stakingBps = 10000 - s - g >= 0
        uint256 shapleyBps = bound(uint256(s), 0, 10000);
        uint256 gaugeBps = bound(uint256(g), 0, 10000 - shapleyBps);
        uint256 stakingBps = 10000 - shapleyBps - gaugeBps;

        ec.setBudget(shapleyBps, gaugeBps, stakingBps);

        vm.warp(block.timestamp + 1 days);
        uint256 minted = ec.drip();

        uint256 shapleyShare = (minted * shapleyBps) / 10000;
        uint256 gaugeShare = (minted * gaugeBps) / 10000;
        uint256 stakingShare = minted - shapleyShare - gaugeShare;

        // All shares sum to minted
        assertEq(shapleyShare + gaugeShare + stakingShare, minted);

        // Accounting matches
        assertEq(ec.shapleyPool(), shapleyShare);
        assertEq(ec.stakingPending(), stakingShare);
    }

    // ============ Fuzz: Create game with valid drain ============

    function testFuzzCreateGame(uint256 drainBps) public {
        drainBps = bound(drainBps, 100, 5000); // between minDrainBps and maxDrainBps

        vm.warp(block.timestamp + 30 days);
        ec.drip();

        uint256 poolBefore = ec.shapleyPool();
        uint256 drainAmount = (poolBefore * drainBps) / 10000;

        // Check minimum
        uint256 percentMin = (poolBefore * 100) / 10000; // minDrainBps = 100
        if (drainAmount < percentMin) return; // would revert, skip

        IShapleyCreate.Participant[] memory participants = new IShapleyCreate.Participant[](2);
        participants[0] = IShapleyCreate.Participant(address(0x1), 1000e18, 1 days, 5000, 5000);
        participants[1] = IShapleyCreate.Participant(address(0x2), 1000e18, 1 days, 5000, 5000);

        ec.createContributionGame(keccak256(abi.encode("game", drainBps)), participants, drainBps);

        assertEq(ec.shapleyPool(), poolBefore - drainAmount);
        assertEq(ec.totalShapleyDrained(), drainAmount);
    }

    // ============ Fuzz: Sequential drips maintain accounting ============

    function testFuzzSequentialDrips(uint8 numDrips) public {
        numDrips = uint8(bound(uint256(numDrips), 1, 20));
        uint256 genesis = ec.genesisTime();

        uint256 totalMinted;
        for (uint256 i = 0; i < numDrips; i++) {
            vm.warp(genesis + (i + 1) * 1 hours);
            uint256 minted = ec.drip();
            totalMinted += minted;
        }

        assertEq(ec.totalEmitted(), totalMinted);

        // Accounting invariant
        uint256 totalAccounted = ec.shapleyPool()
            + ec.totalShapleyDrained()
            + ec.totalGaugeFunded()
            + ec.stakingPending()
            + ec.totalStakingFunded();
        assertEq(totalAccounted, ec.totalEmitted());
    }
}
