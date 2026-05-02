// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "forge-std/Test.sol";
import "@openzeppelin/contracts/proxy/ERC1967/ERC1967Proxy.sol";
import "../../contracts/mechanism/VibeHarbergerPublicGoods.sol";

/**
 * @title VibeHarbergerPublicGoodsInitSafety — C23-F6 implementation-init lockdown
 * @notice VibeHarbergerPublicGoods is a UUPS-upgradeable Harberger-tax mechanism
 *         that owns tax-revenue routing to public-goods funds. The implementation
 *         contract must NOT be initializable directly — only fresh proxy storage.
 *
 *         Without _disableInitializers() in the constructor, anyone could seize
 *         ownership of the implementation contract by calling initialize() on it.
 *         While the impl has no funds, an attacker-owned impl is a footgun for
 *         the upgrade path and a confusing artifact for indexers / scanners.
 */
contract VibeHarbergerPublicGoodsInitSafetyTest is Test {
    address publicGoodsFund = address(0xAA);
    address grantsFund = address(0xBB);
    address researchFund = address(0xCC);

    function test_C23_implCannotBeInitialized() public {
        VibeHarbergerPublicGoods impl = new VibeHarbergerPublicGoods();
        vm.expectRevert();
        impl.initialize(publicGoodsFund, grantsFund, researchFund);
    }

    function test_C23_proxyStillInitializesNormally() public {
        VibeHarbergerPublicGoods impl = new VibeHarbergerPublicGoods();
        bytes memory initData = abi.encodeCall(
            VibeHarbergerPublicGoods.initialize,
            (publicGoodsFund, grantsFund, researchFund)
        );
        ERC1967Proxy proxy = new ERC1967Proxy(address(impl), initData);
        VibeHarbergerPublicGoods harberger = VibeHarbergerPublicGoods(payable(address(proxy)));

        assertEq(harberger.publicGoodsFund(), publicGoodsFund);
        assertEq(harberger.grantsFund(), grantsFund);
        assertEq(harberger.researchFund(), researchFund);
        assertEq(harberger.owner(), address(this));
        // Sanity: a default category tax rate was wired by initialize().
        assertEq(
            harberger.categoryTaxRateBps(VibeHarbergerPublicGoods.AssetCategory.DNS_NAME),
            1000
        );
    }

    function test_C23_proxyCannotBeReInitialized() public {
        VibeHarbergerPublicGoods impl = new VibeHarbergerPublicGoods();
        bytes memory initData = abi.encodeCall(
            VibeHarbergerPublicGoods.initialize,
            (publicGoodsFund, grantsFund, researchFund)
        );
        ERC1967Proxy proxy = new ERC1967Proxy(address(impl), initData);
        VibeHarbergerPublicGoods harberger = VibeHarbergerPublicGoods(payable(address(proxy)));

        vm.expectRevert();
        harberger.initialize(publicGoodsFund, grantsFund, researchFund);
    }
}
