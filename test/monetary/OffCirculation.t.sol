// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "forge-std/Test.sol";
import "../../contracts/monetary/CKBNativeToken.sol";
import "@openzeppelin/contracts/proxy/ERC1967/ERC1967Proxy.sol";

/**
 * @title Off-Circulation Registry Tests (RSI C8 — C7-GOV-001)
 * @notice Tests the whitelist-based off-circulation tracker that aggregates
 *         balances from registered external holders (NCI, VibeStable, JCV, etc.)
 *         so issuance split accurately reflects tokens out of circulation.
 */
contract OffCirculationTest is Test {
    // Mirror events for vm.expectEmit
    event OffCirculationHolderSet(address indexed holder, bool enabled);

    CKBNativeToken public ckb;
    address owner = makeAddr("owner");
    address minter = makeAddr("minter");
    address locker = makeAddr("locker");
    address user = makeAddr("user");

    // Mock external holders (stand-ins for NCI, VibeStable, JCV)
    address nci = makeAddr("nci");
    address vibeStable = makeAddr("vibeStable");
    address jcv = makeAddr("jcv");

    function setUp() public {
        CKBNativeToken impl = new CKBNativeToken();
        bytes memory data = abi.encodeWithSelector(CKBNativeToken.initialize.selector, owner);
        ERC1967Proxy proxy = new ERC1967Proxy(address(impl), data);
        ckb = CKBNativeToken(address(proxy));

        vm.startPrank(owner);
        ckb.setMinter(minter, true);
        ckb.setLocker(locker, true);
        vm.stopPrank();

        // Seed tokens
        vm.prank(minter);
        ckb.mint(user, 1_000_000e18);
    }

    // ============ Registry Admin ============

    function test_onlyOwnerCanRegister() public {
        vm.prank(user);
        vm.expectRevert();  // Ownable revert
        ckb.setOffCirculationHolder(nci, true);
    }

    function test_cannotRegisterZeroAddress() public {
        vm.prank(owner);
        vm.expectRevert(CKBNativeToken.ZeroAddress.selector);
        ckb.setOffCirculationHolder(address(0), true);
    }

    function test_registerHolderSetsFlag() public {
        vm.prank(owner);
        ckb.setOffCirculationHolder(nci, true);

        assertTrue(ckb.isOffCirculationHolder(nci));
    }

    function test_registerEmitsEvent() public {
        vm.expectEmit(true, false, false, true);
        emit OffCirculationHolderSet(nci, true);

        vm.prank(owner);
        ckb.setOffCirculationHolder(nci, true);
    }

    function test_unregisterClearsFlag() public {
        vm.startPrank(owner);
        ckb.setOffCirculationHolder(nci, true);
        assertTrue(ckb.isOffCirculationHolder(nci));

        ckb.setOffCirculationHolder(nci, false);
        assertFalse(ckb.isOffCirculationHolder(nci));
        vm.stopPrank();
    }

    function test_doubleRegisterIsNoop() public {
        vm.startPrank(owner);
        ckb.setOffCirculationHolder(nci, true);
        ckb.setOffCirculationHolder(nci, true);  // No-op, no revert
        vm.stopPrank();

        assertTrue(ckb.isOffCirculationHolder(nci));
    }

    // ============ Off-Circulation Calculation ============

    function test_offCirculationStartsAtZero() public view {
        assertEq(ckb.offCirculation(), 0);
    }

    function test_offCirculationIncludesTotalOccupied() public {
        // Approve locker, lock tokens
        vm.prank(user);
        ckb.approve(locker, 100e18);
        vm.prank(locker);
        ckb.lock(user, 100e18);

        assertEq(ckb.totalOccupied(), 100e18);
        assertEq(ckb.offCirculation(), 100e18);
    }

    function test_offCirculationIncludesRegisteredHolderBalance() public {
        // Transfer tokens to NCI (as if NCI used transferFrom for staking)
        vm.prank(user);
        ckb.transfer(nci, 50_000e18);

        // Before registration: offCirculation doesn't count NCI's balance
        assertEq(ckb.offCirculation(), 0);

        // Register NCI as off-circulation holder
        vm.prank(owner);
        ckb.setOffCirculationHolder(nci, true);

        // After registration: offCirculation includes NCI's balance
        assertEq(ckb.offCirculation(), 50_000e18);
    }

    function test_offCirculationAggregatesMultipleHolders() public {
        // Transfer to multiple mock contracts
        vm.startPrank(user);
        ckb.transfer(nci, 30_000e18);
        ckb.transfer(vibeStable, 20_000e18);
        ckb.transfer(jcv, 10_000e18);
        vm.stopPrank();

        // Register all three
        vm.startPrank(owner);
        ckb.setOffCirculationHolder(nci, true);
        ckb.setOffCirculationHolder(vibeStable, true);
        ckb.setOffCirculationHolder(jcv, true);
        vm.stopPrank();

        assertEq(ckb.offCirculation(), 60_000e18);
    }

    function test_offCirculationCombinesLockedAndRegistered() public {
        // Lock tokens via lock()
        vm.prank(user);
        ckb.approve(locker, 10_000e18);
        vm.prank(locker);
        ckb.lock(user, 10_000e18);

        // Transfer to NCI and register
        vm.prank(user);
        ckb.transfer(nci, 50_000e18);
        vm.prank(owner);
        ckb.setOffCirculationHolder(nci, true);

        // offCirculation = totalOccupied (10k) + NCI balance (50k) = 60k
        assertEq(ckb.offCirculation(), 60_000e18);
    }

    function test_unregisteredHolderBalanceNotCounted() public {
        // Transfer to NCI but don't register
        vm.prank(user);
        ckb.transfer(nci, 100_000e18);

        assertEq(ckb.balanceOf(nci), 100_000e18);
        assertEq(ckb.offCirculation(), 0);
    }

    function test_offCirculationFollowsBalanceChanges() public {
        vm.prank(user);
        ckb.transfer(nci, 100_000e18);

        vm.prank(owner);
        ckb.setOffCirculationHolder(nci, true);

        assertEq(ckb.offCirculation(), 100_000e18);

        // NCI transfers half out (e.g., user unstakes)
        vm.prank(nci);
        ckb.transfer(user, 40_000e18);

        // offCirculation reflects new balance
        assertEq(ckb.offCirculation(), 60_000e18);
    }

    function test_unregisterDropsBalance() public {
        vm.prank(user);
        ckb.transfer(nci, 100_000e18);

        vm.startPrank(owner);
        ckb.setOffCirculationHolder(nci, true);
        assertEq(ckb.offCirculation(), 100_000e18);

        ckb.setOffCirculationHolder(nci, false);
        assertEq(ckb.offCirculation(), 0);
        vm.stopPrank();
    }

    // ============ Circulating Supply ============

    function test_circulatingSupplyExcludesAllOffCirculation() public {
        // Mint more to distribute
        vm.prank(minter);
        ckb.mint(nci, 200_000e18);

        // Register NCI
        vm.prank(owner);
        ckb.setOffCirculationHolder(nci, true);

        // Lock some user tokens
        vm.prank(user);
        ckb.approve(locker, 100e18);
        vm.prank(locker);
        ckb.lock(user, 100e18);

        // Circulating = totalSupply - offCirculation
        // totalSupply = 1_000_000e18 (user) + 200_000e18 (NCI) = 1_200_000e18
        // offCirculation = 200_000e18 (NCI balance) + 100e18 (locked) = 200_100e18
        // circulating = 1_000_000e18 - 100e18 = 999_900e18
        uint256 expected = 1_200_000e18 - 200_100e18;
        assertEq(ckb.circulatingSupply(), expected);
    }

    // ============ Array State ============

    function test_offCirculationHoldersArrayTracksRegistrations() public {
        vm.startPrank(owner);
        ckb.setOffCirculationHolder(nci, true);
        ckb.setOffCirculationHolder(vibeStable, true);
        vm.stopPrank();

        assertEq(ckb.offCirculationHolders(0), nci);
        assertEq(ckb.offCirculationHolders(1), vibeStable);
    }

    function test_unregisterRemovesFromArray() public {
        vm.startPrank(owner);
        ckb.setOffCirculationHolder(nci, true);
        ckb.setOffCirculationHolder(vibeStable, true);
        ckb.setOffCirculationHolder(jcv, true);

        // Remove middle entry — swap-and-pop
        ckb.setOffCirculationHolder(vibeStable, false);

        // vibeStable should be gone; array length should be 2
        vm.expectRevert();
        ckb.offCirculationHolders(2);  // out of bounds

        assertFalse(ckb.isOffCirculationHolder(vibeStable));
        // jcv and nci still registered
        assertTrue(ckb.isOffCirculationHolder(nci));
        assertTrue(ckb.isOffCirculationHolder(jcv));
        vm.stopPrank();
    }
}
