// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "forge-std/Test.sol";
import "@openzeppelin/contracts/proxy/ERC1967/ERC1967Proxy.sol";
import "../../contracts/mechanism/VibeYieldFarming.sol";

/**
 * @title VibeYieldFarmingInitSafety — C23 implementation-init lockdown
 * @notice MasterChef-style yield farming. The implementation must not be
 *         initializable directly — otherwise an attacker becomes owner of
 *         the bare impl, controls _authorizeUpgrade, and creates a
 *         confusing artifact for off-chain indexers (and a footgun for
 *         anyone who mistakenly proxy-calls the impl directly).
 */
contract VibeYieldFarmingInitSafetyTest is Test {
    address feeRecipient = address(0xFE);

    function test_C23_implCannotBeInitialized() public {
        VibeYieldFarming impl = new VibeYieldFarming();
        vm.expectRevert();
        impl.initialize(1e18, block.number, feeRecipient);
    }

    function test_C23_proxyStillInitializesNormally() public {
        VibeYieldFarming impl = new VibeYieldFarming();
        bytes memory initData = abi.encodeCall(
            VibeYieldFarming.initialize,
            (1e18, block.number, feeRecipient)
        );
        ERC1967Proxy proxy = new ERC1967Proxy(address(impl), initData);
        VibeYieldFarming farm = VibeYieldFarming(payable(address(proxy)));

        assertEq(farm.rewardPerBlock(), 1e18);
        assertEq(farm.feeRecipient(), feeRecipient);
        assertEq(farm.owner(), address(this));
    }
}
