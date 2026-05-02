// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "forge-std/Test.sol";
import "@openzeppelin/contracts/proxy/ERC1967/ERC1967Proxy.sol";
import "../../contracts/intent-markets/MemecoinLaunchAuction.sol";

/**
 * @title MemecoinLaunchAuctionInitSafety — C23 implementation-init lockdown
 * @notice MemecoinLaunchAuction is the launch coordinator: it wires
 *         CommitRevealAuction, CreatorLiquidityLock, VibeAMM, and the
 *         reputation/sybil guards. An attacker who initializes the
 *         implementation contract becomes its owner and could call
 *         _authorizeUpgrade — hijacking any future bare-impl callsite.
 */
contract MemecoinLaunchAuctionInitSafetyTest is Test {
    function test_C23_implCannotBeInitialized() public {
        MemecoinLaunchAuction impl = new MemecoinLaunchAuction();

        vm.expectRevert();
        impl.initialize(
            address(0xA1), // auction
            address(0xA2), // creatorLock
            address(0xA3), // amm
            address(0),    // reputation verifier
            address(0),    // sybil guard
            1 hours,
            0.01 ether
        );
    }

    function test_C23_proxyStillInitializesNormally() public {
        MemecoinLaunchAuction impl = new MemecoinLaunchAuction();
        bytes memory initData = abi.encodeCall(
            MemecoinLaunchAuction.initialize,
            (
                address(0xA1),
                address(0xA2),
                address(0xA3),
                address(0),
                address(0),
                1 hours,
                0.01 ether
            )
        );
        ERC1967Proxy proxy = new ERC1967Proxy(address(impl), initData);
        MemecoinLaunchAuction launch = MemecoinLaunchAuction(payable(address(proxy)));

        assertEq(launch.owner(), address(this));
        assertEq(launch.launchCooldown(), 1 hours);
        assertEq(launch.minCreatorDeposit(), 0.01 ether);
    }
}
