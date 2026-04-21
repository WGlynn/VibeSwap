// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "forge-std/Test.sol";
import "../../contracts/consensus/SecondaryIssuanceController.sol";
import "../../contracts/consensus/DAOShelter.sol";
import "../../contracts/monetary/CKBNativeToken.sol";
import "@openzeppelin/contracts/proxy/ERC1967/ERC1967Proxy.sol";

/// @notice Mock shard registry that receives and holds rewards
contract MockShardRegistry {
    IERC20 public token;
    uint256 public totalReceived;

    constructor(address _token) {
        token = IERC20(_token);
    }

    function distributeRewards(uint256 amount) external {
        token.transferFrom(msg.sender, address(this), amount);
        totalReceived += amount;
    }
}

contract SecondaryIssuanceTest is Test {
    SecondaryIssuanceController public issuance;
    CKBNativeToken public ckb;
    DAOShelter public shelter;
    MockShardRegistry public shardRegistry;

    address owner = makeAddr("owner");
    address minter = makeAddr("minter");
    address insurance = makeAddr("insurance");
    address user1 = makeAddr("user1");
    address locker = makeAddr("locker");

    function setUp() public {
        // Deploy CKB-native
        CKBNativeToken ckbImpl = new CKBNativeToken();
        bytes memory ckbData = abi.encodeWithSelector(CKBNativeToken.initialize.selector, owner);
        ERC1967Proxy ckbProxy = new ERC1967Proxy(address(ckbImpl), ckbData);
        ckb = CKBNativeToken(address(ckbProxy));

        // Deploy shelter
        DAOShelter shelterImpl = new DAOShelter();
        bytes memory shelterData = abi.encodeWithSelector(
            DAOShelter.initialize.selector, address(ckb), owner
        );
        ERC1967Proxy shelterProxy = new ERC1967Proxy(address(shelterImpl), shelterData);
        shelter = DAOShelter(address(shelterProxy));

        // Deploy mock shard registry
        shardRegistry = new MockShardRegistry(address(ckb));

        // Deploy issuance controller
        SecondaryIssuanceController issuanceImpl = new SecondaryIssuanceController();
        bytes memory issuanceData = abi.encodeWithSelector(
            SecondaryIssuanceController.initialize.selector,
            address(ckb),
            address(shelter),
            address(shardRegistry),
            insurance,
            owner
        );
        ERC1967Proxy issuanceProxy = new ERC1967Proxy(address(issuanceImpl), issuanceData);
        issuance = SecondaryIssuanceController(address(issuanceProxy));

        // Wire permissions
        vm.startPrank(owner);
        ckb.setMinter(minter, true);
        ckb.setMinter(address(issuance), true);
        ckb.setLocker(locker, true);
        shelter.setIssuanceController(address(issuance));
        vm.stopPrank();
    }

    function test_noSupplyAllGoesToInsurance() public {
        // No existing supply — all emission goes to insurance
        vm.warp(block.timestamp + 1 days);

        issuance.distributeEpoch();

        // Insurance should have received everything
        assertTrue(ckb.balanceOf(insurance) > 0);
        assertEq(issuance.totalDistributed(), ckb.balanceOf(insurance));
    }

    function test_threWaySplit() public {
        // Create supply with 3 categories:
        // - 40% occupied (locked in cells)
        // - 30% in DAO shelter
        // - 30% free (neither locked nor sheltered)

        vm.prank(minter);
        ckb.mint(user1, 10_000e18);

        // Lock 4000 in cells (40%)
        vm.prank(user1);
        ckb.approve(locker, 4000e18);
        vm.prank(locker);
        ckb.lock(user1, 4000e18);

        // Deposit 3000 in shelter (30%)
        vm.prank(user1);
        ckb.approve(address(shelter), 3000e18);
        vm.prank(user1);
        shelter.deposit(3000e18);

        // 3000 free (30%) → insurance

        // Advance 1 day
        vm.warp(block.timestamp + 1 days);

        issuance.distributeEpoch();

        uint256 dailyEmission = issuance.annualEmission() / 365;

        // Shard share = 40% of emission
        uint256 expectedShard = (dailyEmission * 4000e18) / 10_000e18;
        // DAO share = 30% of emission
        uint256 expectedDAO = (dailyEmission * 3000e18) / 10_000e18;
        // Insurance = remainder
        uint256 expectedInsurance = dailyEmission - expectedShard - expectedDAO;

        // Allow 1% tolerance for rounding
        assertApproxEqRel(shardRegistry.totalReceived(), expectedShard, 0.01e18);
        assertApproxEqRel(ckb.balanceOf(insurance), expectedInsurance, 0.01e18);
    }

    function test_cannotDistributeTooSoon() public {
        vm.expectRevert(SecondaryIssuanceController.TooSoon.selector);
        issuance.distributeEpoch();
    }

    function test_multipleEpochs() public {
        vm.prank(minter);
        ckb.mint(user1, 10_000e18);

        // Day 1
        vm.warp(block.timestamp + 1 days);
        issuance.distributeEpoch();
        uint256 after1 = issuance.totalDistributed();

        // Day 2
        vm.warp(block.timestamp + 1 days);
        issuance.distributeEpoch();
        uint256 after2 = issuance.totalDistributed();

        assertTrue(after2 > after1);
    }

    function test_previewMatchesActual() public {
        vm.prank(minter);
        ckb.mint(user1, 10_000e18);

        vm.warp(block.timestamp + 1 days);

        (uint256 pEmission,,,) = issuance.previewNextEpoch();

        issuance.distributeEpoch();

        assertEq(issuance.totalDistributed(), pEmission);
    }

    // ============ C36-F2: admin setter event observability ============

    event MinDistributionUpdated(uint256 oldMin, uint256 newMin);
    event InsurancePoolUpdated(address indexed oldPool, address indexed newPool);

    function test_C36F2_setMinDistribution_emitsEvent() public {
        uint256 oldM = issuance.minDistribution();
        uint256 newM = 42e18;
        vm.expectEmit(false, false, false, true);
        emit MinDistributionUpdated(oldM, newM);
        vm.prank(owner);
        issuance.setMinDistribution(newM);
    }

    function test_C36F2_setInsurancePool_emitsEvent() public {
        address oldP = issuance.insurancePool();
        address newP = makeAddr("newInsurance");
        vm.expectEmit(true, true, false, true);
        emit InsurancePoolUpdated(oldP, newP);
        vm.prank(owner);
        issuance.setInsurancePool(newP);
    }
}
