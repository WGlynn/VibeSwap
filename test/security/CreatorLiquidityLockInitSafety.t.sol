// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "forge-std/Test.sol";
import "@openzeppelin/contracts/proxy/ERC1967/ERC1967Proxy.sol";
import "../../contracts/intent-markets/CreatorLiquidityLock.sol";

/**
 * @title CreatorLiquidityLockInitSafety — C23 implementation-init lockdown
 * @notice CreatorLiquidityLock is a UUPS-upgradeable contract that escrows
 *         creator liquidity with 50% slashing. The implementation contract
 *         must NOT be initializable directly — only fresh proxy storage.
 *
 *         Without _disableInitializers() in the constructor, anyone could
 *         seize ownership of the implementation contract by calling
 *         initialize() on it. While the impl has no funds, an attacker-owned
 *         impl is a footgun for the upgrade path and a confusing artifact
 *         for indexers / scanners.
 */
contract CreatorLiquidityLockInitSafetyTest is Test {
    address lpRewardPool = address(0xDD);

    function test_C23_implCannotBeInitialized() public {
        CreatorLiquidityLock impl = new CreatorLiquidityLock();
        vm.expectRevert();
        impl.initialize(lpRewardPool, 1 days, 30 days, 1 ether);
    }

    function test_C23_proxyStillInitializesNormally() public {
        CreatorLiquidityLock impl = new CreatorLiquidityLock();
        bytes memory initData = abi.encodeCall(
            CreatorLiquidityLock.initialize,
            (lpRewardPool, 1 days, 30 days, 1 ether)
        );
        ERC1967Proxy proxy = new ERC1967Proxy(address(impl), initData);
        CreatorLiquidityLock lock = CreatorLiquidityLock(payable(address(proxy)));

        assertEq(lock.lpRewardPool(), lpRewardPool);
        assertEq(lock.minLockDuration(), 1 days);
        assertEq(lock.owner(), address(this));
    }

    function test_C23_proxyCannotBeReInitialized() public {
        CreatorLiquidityLock impl = new CreatorLiquidityLock();
        bytes memory initData = abi.encodeCall(
            CreatorLiquidityLock.initialize,
            (lpRewardPool, 1 days, 30 days, 1 ether)
        );
        ERC1967Proxy proxy = new ERC1967Proxy(address(impl), initData);
        CreatorLiquidityLock lock = CreatorLiquidityLock(payable(address(proxy)));

        vm.expectRevert();
        lock.initialize(lpRewardPool, 1 days, 30 days, 1 ether);
    }
}
