// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "forge-std/Test.sol";
import "@openzeppelin/contracts/proxy/ERC1967/ERC1967Proxy.sol";
import "../../contracts/financial/VibeFeeDistributor.sol";

/**
 * @title VibeFeeDistributorInitSafety — C23 implementation-init lockdown
 * @notice Verifies that VibeFeeDistributor's implementation contract cannot
 *         be initialized directly. An attacker initializing the implementation
 *         could call privileged functions on the impl (which would not affect
 *         live proxy state but could be used as a bait/honeypot, or — worse —
 *         to bait an unsuspecting upgrade that delegatecalls a dirty impl).
 *
 *         The fix: constructor calls _disableInitializers() so the impl is
 *         locked out forever; only fresh proxy storage can be initialized.
 */
contract VibeFeeDistributorInitSafetyTest is Test {
    address treasuryAddr = address(0xDD);
    address insuranceAddr = address(0xEE);
    address mindAddr = address(0xFF);

    function test_C23_implCannotBeInitialized() public {
        VibeFeeDistributor impl = new VibeFeeDistributor();
        // _disableInitializers() locks _initialized to type(uint64).max.
        // OZ v5 reverts with InvalidInitialization() (0xf92ee8a9).
        vm.expectRevert();
        impl.initialize(treasuryAddr, insuranceAddr, mindAddr);
    }

    function test_C23_proxyStillInitializesNormally() public {
        VibeFeeDistributor impl = new VibeFeeDistributor();
        bytes memory initData = abi.encodeCall(
            VibeFeeDistributor.initialize,
            (treasuryAddr, insuranceAddr, mindAddr)
        );
        ERC1967Proxy proxy = new ERC1967Proxy(address(impl), initData);
        VibeFeeDistributor dist = VibeFeeDistributor(payable(address(proxy)));

        // Sanity: proxy state initialized, owner is deployer.
        assertEq(dist.treasury(), treasuryAddr);
        assertEq(dist.owner(), address(this));
    }

    function test_C23_proxyCannotBeReInitialized() public {
        VibeFeeDistributor impl = new VibeFeeDistributor();
        bytes memory initData = abi.encodeCall(
            VibeFeeDistributor.initialize,
            (treasuryAddr, insuranceAddr, mindAddr)
        );
        ERC1967Proxy proxy = new ERC1967Proxy(address(impl), initData);
        VibeFeeDistributor dist = VibeFeeDistributor(payable(address(proxy)));

        // Second init must revert.
        vm.expectRevert();
        dist.initialize(treasuryAddr, insuranceAddr, mindAddr);
    }
}
