// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "forge-std/Test.sol";
import "../../contracts/monetary/CKBNativeToken.sol";
import "../../contracts/monetary/JULBridge.sol";
import "../../contracts/consensus/StateRentVault.sol";
import "../../contracts/consensus/DAOShelter.sol";
import "../../contracts/consensus/SecondaryIssuanceController.sol";
import "../../contracts/consensus/ShardOperatorRegistry.sol";
import "@openzeppelin/contracts/proxy/ERC1967/ERC1967Proxy.sol";

/// @notice Mock JUL for integration test. C7-GOV-005: exposes `internalBalanceOf`
///         for JULBridge's rebase-invariant rate limiting. Default scalar=1e18
///         means internal == display for legacy test paths.
contract MockJULIntegration {
    mapping(address => uint256) public balanceOf;
    mapping(address => mapping(address => uint256)) public allowance;

    /// @dev Returns the same value as balanceOf (scalar fixed at 1e18 in this mock).
    function internalBalanceOf(address account) external view returns (uint256) {
        return balanceOf[account];
    }

    function mint(address to, uint256 amount) external {
        balanceOf[to] += amount;
    }

    function approve(address spender, uint256 amount) external returns (bool) {
        allowance[msg.sender][spender] = amount;
        return true;
    }

    function transferFrom(address from, address to, uint256 amount) external returns (bool) {
        require(balanceOf[from] >= amount, "insufficient");
        require(allowance[from][msg.sender] >= amount, "no allowance");
        balanceOf[from] -= amount;
        allowance[from][msg.sender] -= amount;
        balanceOf[to] += amount;
        return true;
    }
}

/**
 * @title ThreeTokenConsensus — Full Integration Test
 * @notice Tests the complete 3-token lifecycle:
 *   Mine JUL → Bridge to CKB-native → Stake in shard → Lock in cells →
 *   Shelter remaining → Secondary issuance distributes → Claim rewards
 */
contract ThreeTokenConsensusTest is Test {
    CKBNativeToken public ckb;
    MockJULIntegration public jul;
    JULBridge public bridge;
    StateRentVault public vault;
    DAOShelter public shelter;
    SecondaryIssuanceController public issuance;
    ShardOperatorRegistry public registry;

    address owner = makeAddr("owner");
    address miner = makeAddr("miner");
    address shardOp = makeAddr("shardOperator");
    address cellManager = makeAddr("cellManager");
    address insurance = makeAddr("insurance");

    function setUp() public {
        jul = new MockJULIntegration();

        // Deploy CKB-native
        ckb = CKBNativeToken(address(new ERC1967Proxy(
            address(new CKBNativeToken()),
            abi.encodeWithSelector(CKBNativeToken.initialize.selector, owner)
        )));

        // Deploy bridge
        bridge = JULBridge(address(new ERC1967Proxy(
            address(new JULBridge()),
            abi.encodeWithSelector(JULBridge.initialize.selector, address(jul), address(ckb), owner)
        )));

        // Deploy vault
        vault = StateRentVault(address(new ERC1967Proxy(
            address(new StateRentVault()),
            abi.encodeWithSelector(StateRentVault.initialize.selector, address(ckb), owner)
        )));

        // Deploy shelter
        shelter = DAOShelter(address(new ERC1967Proxy(
            address(new DAOShelter()),
            abi.encodeWithSelector(DAOShelter.initialize.selector, address(ckb), owner)
        )));

        // Deploy registry
        registry = ShardOperatorRegistry(address(new ERC1967Proxy(
            address(new ShardOperatorRegistry()),
            abi.encodeWithSelector(ShardOperatorRegistry.initialize.selector, address(ckb), owner)
        )));

        // Deploy issuance controller
        issuance = SecondaryIssuanceController(address(new ERC1967Proxy(
            address(new SecondaryIssuanceController()),
            abi.encodeWithSelector(
                SecondaryIssuanceController.initialize.selector,
                address(ckb), address(shelter), address(registry), insurance, owner
            )
        )));

        // Wire all permissions
        vm.startPrank(owner);
        ckb.setMinter(address(bridge), true);
        ckb.setMinter(address(issuance), true);
        ckb.setLocker(address(vault), true);
        vault.setCellManager(cellManager, true);
        shelter.setIssuanceController(address(issuance));
        registry.setIssuanceController(address(issuance));
        vm.stopPrank();
    }

    // ============ Full Lifecycle ============

    function test_fullLifecycle() public {
        // Step 1: Miner mines JUL (simulated)
        jul.mint(miner, 50_000e18);

        // Step 2: Miner bridges JUL → CKB-native
        vm.startPrank(miner);
        jul.approve(address(bridge), 50_000e18);
        uint256 ckbReceived = bridge.bridge(50_000e18);
        vm.stopPrank();

        assertEq(ckbReceived, 50_000e18, "1:1 bridge");
        assertEq(ckb.balanceOf(miner), 50_000e18);
        assertEq(jul.balanceOf(address(bridge)), 50_000e18, "JUL locked");

        // Step 3: Miner distributes CKB-native across the system
        // - 20K to shard operator (for staking)
        // - 15K to cell manager (for state rent)
        // - 15K to shelter (for inflation protection)
        vm.startPrank(miner);
        ckb.transfer(shardOp, 20_000e18);
        ckb.transfer(cellManager, 15_000e18);
        vm.stopPrank();

        // Step 4: Shard operator registers and stakes
        vm.startPrank(shardOp);
        ckb.approve(address(registry), 20_000e18);
        registry.registerShard(keccak256("shard-alpha"), 20_000e18);
        registry.reportCellsServed(100);
        vm.stopPrank();

        assertEq(registry.activeShardCount(), 1);
        assertEq(registry.totalStaked(), 20_000e18);

        // Step 5: Cell manager creates cells (state rent)
        vm.startPrank(cellManager);
        ckb.approve(address(vault), 15_000e18);
        vault.createCell(keccak256("cell-data-1"), 5_000e18, keccak256("d1"));
        vault.createCell(keccak256("cell-data-2"), 5_000e18, keccak256("d2"));
        vault.createCell(keccak256("cell-data-3"), 5_000e18, keccak256("d3"));
        vm.stopPrank();

        assertEq(vault.activeCellCount(), 3);
        assertEq(ckb.totalOccupied(), 15_000e18);
        assertEq(ckb.circulatingSupply(), 35_000e18); // 50K - 15K locked

        // Step 6: Miner deposits remainder in DAO shelter
        vm.startPrank(miner);
        ckb.approve(address(shelter), 15_000e18);
        shelter.deposit(15_000e18);
        vm.stopPrank();

        assertEq(shelter.totalDeposited(), 15_000e18);

        // Step 7: Time passes, secondary issuance triggers
        vm.warp(block.timestamp + 1 days);

        // Get pre-distribution state
        uint256 totalSupply = ckb.totalSupply(); // 50K from bridge
        uint256 occupied = ckb.totalOccupied();  // 15K in cells
        uint256 daoDeposits = shelter.totalDeposited(); // 15K in shelter

        // Expected split:
        // shardShare = emission * 15K / 50K = 30%
        // daoShare = emission * 15K / 50K = 30%
        // insuranceShare = 40% (the free/unstaked portion)

        issuance.distributeEpoch();

        // Verify distribution happened
        assertTrue(issuance.totalDistributed() > 0);
        assertTrue(ckb.balanceOf(insurance) > 0, "Insurance received share");

        // Miner can claim yield from shelter
        uint256 yield = shelter.pendingYield(miner);
        assertTrue(yield > 0, "Miner has pending yield");

        // Shard operator can claim rewards
        uint256 shardReward = registry.pendingRewards(shardOp);
        assertTrue(shardReward > 0, "Shard op has pending rewards");

        // Step 8: Shard op claims rewards
        vm.prank(shardOp);
        registry.claimRewards();
        assertTrue(ckb.balanceOf(shardOp) > 0);

        // Step 9: Cell manager destroys a cell — tokens return
        vm.prank(cellManager);
        vault.destroyCell(keccak256("cell-data-1"));

        assertEq(vault.activeCellCount(), 2);
        assertEq(ckb.totalOccupied(), 10_000e18);
        assertEq(ckb.balanceOf(cellManager), 5_000e18); // Got 5K back
    }

    // ============ Conservation Invariants ============

    function test_tokenConservation() public {
        // Mine and bridge
        jul.mint(miner, 10_000e18);
        vm.startPrank(miner);
        jul.approve(address(bridge), 10_000e18);
        bridge.bridge(10_000e18);
        vm.stopPrank();

        uint256 totalBefore = ckb.totalSupply();

        // Lock some in cells
        vm.prank(miner);
        ckb.approve(address(vault), 3_000e18);

        vm.startPrank(owner);
        vault.setCellManager(miner, true);
        vm.stopPrank();

        vm.startPrank(miner);
        vault.createCell(keccak256("c1"), 3_000e18, keccak256("x"));
        vm.stopPrank();

        // Total supply unchanged (locking doesn't burn)
        assertEq(ckb.totalSupply(), totalBefore);

        // circulatingSupply = totalSupply - occupied
        assertEq(ckb.circulatingSupply(), totalBefore - 3_000e18);

        // Destroy cell — supply still unchanged
        vm.prank(miner);
        vault.destroyCell(keccak256("c1"));

        assertEq(ckb.totalSupply(), totalBefore);
        assertEq(ckb.circulatingSupply(), totalBefore);
    }

    // ============ Bridge is One-Way ============

    function test_bridgeOneWay() public {
        jul.mint(miner, 5_000e18);

        vm.startPrank(miner);
        jul.approve(address(bridge), 5_000e18);
        bridge.bridge(5_000e18);
        vm.stopPrank();

        // JUL is permanently in the bridge — no withdrawal exists
        assertEq(jul.balanceOf(address(bridge)), 5_000e18);
        assertEq(ckb.balanceOf(miner), 5_000e18);

        // Verify: no reverse function exists (compile-time guarantee)
        // The bridge contract has no withdraw, reverse, or unbridgefunction
    }

    // ============ Secondary Issuance Math ============

    function test_allInsuranceWhenNoCellsNoDAO() public {
        // Create some supply but don't lock or shelter any
        jul.mint(miner, 1000e18);
        vm.startPrank(miner);
        jul.approve(address(bridge), 1000e18);
        bridge.bridge(1000e18);
        vm.stopPrank();

        vm.warp(block.timestamp + 1 days);
        issuance.distributeEpoch();

        // 100% should go to insurance (nothing occupied, nothing in DAO)
        uint256 totalEmitted = issuance.totalDistributed();
        assertEq(ckb.balanceOf(insurance), totalEmitted, "All to insurance");
    }
}
