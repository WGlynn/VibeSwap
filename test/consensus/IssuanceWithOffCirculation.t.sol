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

        // C9-AUDIT-6: setOffCirculationHolder requires code.length > 0
        vm.etch(nciMock, hex"00");
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

    // ============ C10-AUDIT-5: DAOShelter double-registration guard ============

    /// @notice If an operator mistakenly registers DAOShelter as an off-circulation
    ///         holder (the deploy script's REGISTER_DAO_SHELTER=true path), the
    ///         controller now subtracts its balance from offCirc at distribute time
    ///         to prevent the shelter's CKB from being double-counted.
    function test_daoShelterDoubleRegistrationIsNeutralized() public {
        // User deposits 400k to DAOShelter
        vm.prank(minter);
        ckb.mint(user, 1_000_000e18);

        vm.prank(user);
        ckb.approve(address(shelter), type(uint256).max);
        vm.prank(user);
        shelter.deposit(400_000e18);

        // Shelter now holds 400k + has totalDeposited=400k
        assertEq(ckb.balanceOf(address(shelter)), 400_000e18);
        assertEq(shelter.totalDeposited(), 400_000e18);

        // Mistakenly register shelter as off-circulation holder
        vm.prank(owner);
        ckb.setOffCirculationHolder(address(shelter), true);
        assertEq(ckb.offCirculation(), 400_000e18);

        // Run distribution — without C10-AUDIT-5, shelter balance would be counted
        // BOTH in shardShare (via offCirc) and in daoShare (via totalDeposited),
        // summing to 800k on a 1M supply, starving insurance via the scale-down guard.
        vm.warp(block.timestamp + 365 days);
        issuance.distributeEpoch();

        uint256 shardReceived = shardRegistry.totalReceived();
        uint256 totalEmitted = issuance.totalDistributed();

        // With the fix: shelter subtracted from offCirc → shardShare ≈ 0
        // (no other registered holders). DAO gets ~40% via yield path. Insurance
        // gets the remainder instead of being zeroed.
        assertLe(shardReceived, totalEmitted * 5 / 100, "shardShare not inflated by shelter balance");
    }

    /// @notice C11-AUDIT-10: when the shelter is double-registered and holds
    ///         yield on top of principal (balance > totalDeposited), the
    ///         controller's double-count subtract must use totalDeposited
    ///         (principal), not balanceOf. Using balanceOf over-corrects and
    ///         strips the yield portion from shardShare that it was entitled
    ///         to via the offCirculation path.
    function test_shelterYieldCountedInShardShare_AUDIT10() public {
        // Mint 1M to user. 400k deposited to shelter as principal.
        vm.prank(minter);
        ckb.mint(user, 1_000_000e18);
        vm.prank(user);
        ckb.approve(address(shelter), type(uint256).max);
        vm.prank(user);
        shelter.deposit(400_000e18);

        // Simulate 50k of yield accrued in the shelter — mint directly so
        // totalDeposited stays at 400k while balance grows to 450k. This
        // mirrors the state after depositYield() has been routed to the
        // shelter over time.
        vm.prank(minter);
        ckb.mint(address(shelter), 50_000e18);
        assertEq(ckb.balanceOf(address(shelter)), 450_000e18);
        assertEq(shelter.totalDeposited(), 400_000e18);

        // Another 200k lives in NCI as legitimate stake (off-circ) so we
        // can observe the difference between subtracting principal vs balance.
        vm.prank(user);
        ckb.transfer(nciMock, 200_000e18);

        // Double-register: both shelter (wrong, but guarded) AND nci (correct).
        vm.startPrank(owner);
        ckb.setOffCirculationHolder(address(shelter), true);
        ckb.setOffCirculationHolder(nciMock, true);
        vm.stopPrank();

        // offCirc raw = shelter(450k) + nci(200k) = 650k
        assertEq(ckb.offCirculation(), 650_000e18);

        vm.warp(block.timestamp + 365 days);
        issuance.distributeEpoch();

        uint256 shardReceived = shardRegistry.totalReceived();
        uint256 totalEmitted = issuance.totalDistributed();

        // With AUDIT-10 fix (subtract principal 400k): effective offCirc for
        // the split is 650k - 400k = 250k. So shardShare ~ 250k/totalSupply.
        // Without the fix (subtract balance 450k): effective offCirc = 200k.
        // The 50k yield delta maps to a distinct, assertable shardShare floor.
        // totalSupply grows across the epoch as new tokens mint, but the floor
        // based on 250k of offCirc should land comfortably above the
        // would-be-200k ceiling.
        uint256 minShardShare = totalEmitted * 22 / 100; // principal path floor
        uint256 maxUnderBug   = totalEmitted * 21 / 100; // balance path ceiling
        assertGe(shardReceived, minShardShare, "yield delta not credited to shardShare");
        assertGt(shardReceived, maxUnderBug, "appears to subtract balanceOf, not totalDeposited");
    }

    // ============ C14-AUDIT-3 + C14-AUDIT-4: empty-shelter reroute, no over-emission ============

    /// @notice C14-AUDIT-3: Before the fix, DAOShelter.depositYield silent-returned
    ///         when totalDeposited==0, which tripped SecondaryIssuanceController's
    ///         C11-AUDIT-1 short-pull guard → ShelterShortPull revert → whole epoch
    ///         bricked whenever shelter was empty (bootstrap, or all depositors withdrew).
    ///         After the fix: shelter reverts with NoDepositors → controller's catch
    ///         absorbs and reroutes daoShare to insurance.
    function test_C14_EmptyShelter_DistributeSucceeds_RoutesToInsurance() public {
        vm.prank(minter);
        ckb.mint(user, 1_000_000e18);

        // Don't deposit to shelter. Simulate NCI staking so shardShare is non-zero.
        vm.prank(user);
        ckb.transfer(nciMock, 300_000e18);
        vm.prank(owner);
        ckb.setOffCirculationHolder(nciMock, true);

        uint256 supplyBefore = ckb.totalSupply();
        uint256 insuranceBalBefore = ckb.balanceOf(insurance);

        vm.warp(block.timestamp + 365 days);
        issuance.distributeEpoch();

        uint256 totalEmitted = issuance.totalDistributed();
        uint256 supplyAfter = ckb.totalSupply();
        uint256 insuranceBalAfter = ckb.balanceOf(insurance);

        // Core invariant: supply grows by exactly emission, no over-mint.
        assertEq(supplyAfter - supplyBefore, totalEmitted, "supply conservation - no over-emission");

        // Insurance should have received (originalInsurance + rerouted daoShare).
        // Neither should exceed emission total.
        uint256 insuranceDelta = insuranceBalAfter - insuranceBalBefore;
        assertGt(insuranceDelta, 0, "insurance received rerouted daoShare");
        assertLe(insuranceDelta, totalEmitted, "insurance <= total emission");
    }

    /// @notice C14-AUDIT-4: Explicit assertion that the catch path does NOT over-emit.
    ///         Before the fix, `insuranceShare += daoShare` in the catch caused the
    ///         subsequent mint(insurancePool, insuranceShare) to mint `daoShare` extra
    ///         tokens on top of the already-transferred rerouted amount. Net: emission
    ///         + daoShare per epoch whenever shelter was empty — silent inflation.
    function test_C14_EmptyShelter_NoOverEmission() public {
        vm.prank(minter);
        ckb.mint(user, 1_000_000e18);

        vm.warp(block.timestamp + 365 days);

        uint256 supplyBefore = ckb.totalSupply();
        issuance.distributeEpoch();
        uint256 supplyAfter = ckb.totalSupply();
        uint256 totalEmitted = issuance.totalDistributed();

        // Strict equality — supply growth == emission. Pre-fix: supply grew by
        // emission + daoShare (~40% extra).
        assertEq(supplyAfter - supplyBefore, totalEmitted, "no over-emission under catch path");
    }
}
