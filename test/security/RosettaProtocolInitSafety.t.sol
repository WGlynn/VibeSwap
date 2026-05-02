// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "forge-std/Test.sol";
import "@openzeppelin/contracts/proxy/ERC1967/ERC1967Proxy.sol";
import "../../contracts/mechanism/RosettaProtocol.sol";

/**
 * @title RosettaProtocolInitSafety — C23 implementation-init lockdown
 * @notice RosettaProtocol holds challenge stake escrows in ETH and pins
 *         the immutable COVENANT_HASH on initialize(). If the implementation
 *         can be initialized directly, an attacker becomes its owner and
 *         could authorize a malicious upgrade later — and ANY arbitrary
 *         covenant text could be pinned to the impl, polluting indexers
 *         and creating a parallel "Rosetta" surface.
 */
contract RosettaProtocolInitSafetyTest is Test {
    string[10] covenants;
    address[] resolvers;

    function setUp() public {
        for (uint256 i = 0; i < 10; i++) {
            covenants[i] = string(abi.encodePacked("Covenant ", vm.toString(i)));
        }
        resolvers.push(address(0xCAFE));
    }

    function test_C23_implCannotBeInitialized() public {
        RosettaProtocol impl = new RosettaProtocol();
        vm.expectRevert();
        impl.initialize(address(this), covenants, resolvers);
    }

    function test_C23_proxyStillInitializesNormally() public {
        RosettaProtocol impl = new RosettaProtocol();
        bytes memory initData = abi.encodeCall(
            RosettaProtocol.initialize,
            (address(this), covenants, resolvers)
        );
        ERC1967Proxy proxy = new ERC1967Proxy(address(impl), initData);
        RosettaProtocol rosetta = RosettaProtocol(payable(address(proxy)));

        assertEq(rosetta.owner(), address(this));
        assertTrue(rosetta.COVENANT_HASH() != bytes32(0));
        assertTrue(rosetta.isTrustedResolver(address(0xCAFE)));
    }
}
