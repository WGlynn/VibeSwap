// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "forge-std/Test.sol";
import "../../contracts/consensus/SecondaryIssuanceController.sol";
import "../../contracts/consensus/DAOShelter.sol";
import "../../contracts/monetary/CKBNativeToken.sol";
import "@openzeppelin/contracts/proxy/ERC1967/ERC1967Proxy.sol";

/// Mock shard registry — receives and holds rewards
contract MockShardRegistry {
    IERC20 public token;
    uint256 public totalReceived;
    constructor(address _token) { token = IERC20(_token); }
    function distributeRewards(uint256 amount) external {
        token.transferFrom(msg.sender, address(this), amount);
        totalReceived += amount;
    }
}

/**
 * @title Issuance Integration: Off-Circulation Accounting (RSI C8 — C7-GOV-001)
 * @notice Proves that tokens held by registered staking contracts (like NCI)
 *         are now counted toward the shard share of emission. Before the fix,
 *         these were invisible to the split — staked CKB reduced shard emission.
 */
contract IssuanceWithOffCirculationTest is Test {
    SecondaryIssuanceController public issuance;
    CKBNativeToken public ckb;
    DAOShelter public shelter;
    MockShardRegistry public shardRegistry;

    address owner = makeAddr("owner");
    address minter = makeAddr("minter");
    address insurance = makeAddr("insurance");
    address user = makeAddr("user");
    address nciMock = makeAddr("nciMock");  // stand-in for NakamotoConsensusInfinity

    function setUp() public {
        // Deploy CKB
        CKBNativeToken ckbImpl = new CKBNativeToken();
        ERC1967Proxy ckbProxy = new ERC1967Proxy(
            address(ckbImpl),
            abi.encodeWithSelector(CKBNativeToken.initialize.selector, owner)
        );
        ckb = CKBNativeToken(address(ckbProxy));

        // Deploy shelter
        DAOShelter shelterImpl = new DAOShelter();
        ERC1967Proxy shelterProxy = new ERC1967Proxy(
            address(shelterImpl),
            abi.encodeWithSelector(DAOShelter.initialize.selector, address(ckb), owner)
        );
        shelter = DAOShelter(address(shelterProxy));

        shardRegistry = new MockShardRegistry(address(ckb));

        // Deploy issuance controller
        SecondaryIssuanceController issuanceImpl = new SecondaryIssuanceController();
        ERC1967Proxy issuanceProxy = new ERC1967Proxy(
            address(issuanceImpl),
            abi.encodeWithSelector(
                SecondaryIssuanceController.initialize.selector,
                address(ckb), address(shelter), address(shardRegistry), insurance, owner
            )
        );
        issuance = SecondaryIssuanceController(address(issuanceProxy));

        vm.startPrank(owner);
        ckb.setMinter(minter, true);
        ckb.setMinter(address(issuance), true);
        shelter.setIssuanceController(address(issuance));
        vm.stopPrank();
    }

    /**
     * @notice Core scenario: user stakes CKB to NCI via transferFrom.
     *         Before C7-GOV-001: staked tokens are invisible to split.
     *         After: staked tokens count toward shard share via offCirculation().
     */
    function test_stakedCkbCountsTowardShardShare() public {
        // Mint 1M CKB to user
        vm.prank(minter);
        ckb.mint(user, 1_000_000e18);

        // User "stakes" 300k to NCI (simulated — normally NCI.depositStake() does this)
        vm.prank(user);
        ckb.transfer(nciMock, 300_000e18);

        // Before registration: offCirculation = 0 (tokens invisible to issuance split)
        assertEq(ckb.offCirculation(), 0);
        assertEq(ckb.balanceOf(nciMock), 300_000e18);

        // Register NCI as off-circulation holder
        vm.prank(owner);
        ckb.setOffCirculationHolder(nciMock, true);

        // Now offCirculation reflects the 300k staked
        assertEq(ckb.offCirculation(), 300_000e18);

        // Warp forward 1 year and distribute emission
        vm.warp(block.timestamp + 365 days);
        issuance.distributeEpoch();

        // Expected: shardShare = emission * offCirc / totalSupply
        //                      = annualEmission * 300_000 / 1_000_000
        //                      = annualEmission * 30%
        // With default annualEmission (check contract for value)
        uint256 totalReceived = shardRegistry.totalReceived();
        uint256 totalEmitted = issuance.totalDistributed();

        // Shard share should be approximately 30% of total
        // (exact depends on totalSupply — which includes new mints from issuance itself,
        //  but NCI's balance doesn't grow with mints, so ratio shifts slightly)
        assertTrue(totalReceived > 0, "Shard registry should receive rewards");

        // Core invariant: proportional to NCI balance
        // Without C7-GOV-001, totalReceived would be 0 (totalOccupied = 0, no cell locks).
        // With C7-GOV-001, totalReceived should be ~30% of emission.
        uint256 expectedMin = totalEmitted * 25 / 100; // allow ±5% for totalSupply drift
        uint256 expectedMax = totalEmitted * 35 / 100;
        assertGe(totalReceived, expectedMin, "Shards received less than expected - off-circulation not counted?");
        assertLe(totalReceived, expectedMax, "Shards received more than expected");
    }

    /**
     * @notice Unregistered staking is invisible to the split (backward-compat bug).
     *         This test documents the old broken behavior for reference.
     */
    function test_unregisteredStakingInvisibleToSplit() public {
        vm.prank(minter);
        ckb.mint(user, 1_000_000e18);

        // Stake without registering NCI
        vm.prank(user);
        ckb.transfer(nciMock, 300_000e18);

        // offCirculation = 0 despite 300k locked in NCI
        assertEq(ckb.offCirculation(), 0);

        vm.warp(block.timestamp + 365 days);
        issuance.distributeEpoch();

        // Shards receive 0 — all goes to insurance
        assertEq(shardRegistry.totalReceived(), 0, "Unregistered staking: shards get nothing");
    }

    /**
     * @notice Combined: cell-locked tokens + registered holder balances both count.
     */
    function test_lockedAndRegisteredCombined() public {
        address cellLocker = makeAddr("cellLocker");
        vm.prank(owner);
        ckb.setLocker(cellLocker, true);

        vm.prank(minter);
        ckb.mint(user, 1_000_000e18);

        // Lock 100k via state rent
        vm.prank(user);
        ckb.approve(cellLocker, 100_000e18);
        vm.prank(cellLocker);
        ckb.lock(user, 100_000e18);

        // Stake 200k to NCI
        vm.prank(user);
        ckb.transfer(nciMock, 200_000e18);
        vm.prank(owner);
        ckb.setOffCirculationHolder(nciMock, true);

        // Total off-circulation = 100k (locked) + 200k (staked) = 300k
        assertEq(ckb.offCirculation(), 300_000e18);

        vm.warp(block.timestamp + 365 days);
        issuance.distributeEpoch();

        uint256 totalReceived = shardRegistry.totalReceived();
        uint256 totalEmitted = issuance.totalDistributed();

        // Shard share ~= 30% of emission
        uint256 expectedMin = totalEmitted * 25 / 100;
        assertGe(totalReceived, expectedMin);
    }
}
