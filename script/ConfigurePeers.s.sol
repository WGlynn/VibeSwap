// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "forge-std/Script.sol";
import "../contracts/messaging/CrossChainRouter.sol";

/**
 * @title ConfigurePeers
 * @notice Configure cross-chain peer connections for VibeSwap
 * @dev Run after deploying on all chains
 */
contract ConfigurePeers is Script {
    // LayerZero V2 Endpoint IDs
    uint32 constant EID_ETHEREUM = 30101;
    uint32 constant EID_ARBITRUM = 30110;
    uint32 constant EID_OPTIMISM = 30111;
    uint32 constant EID_POLYGON = 30109;
    uint32 constant EID_BASE = 30184;
    uint32 constant EID_AVALANCHE = 30106;

    // Testnet EIDs
    uint32 constant EID_SEPOLIA = 40161;
    uint32 constant EID_ARB_SEPOLIA = 40231;

    struct ChainConfig {
        uint256 chainId;
        uint32 eid;
        address router;
    }

    function run() external {
        uint256 deployerPrivateKey = vm.envUint("PRIVATE_KEY");

        // Load router addresses from environment
        address currentRouter = vm.envAddress("ROUTER_ADDRESS");

        // Define peer configurations
        ChainConfig[] memory peers = new ChainConfig[](6);

        // Mainnet configuration
        peers[0] = ChainConfig({
            chainId: 1,
            eid: EID_ETHEREUM,
            router: vm.envOr("ROUTER_ETHEREUM", address(0))
        });
        peers[1] = ChainConfig({
            chainId: 42161,
            eid: EID_ARBITRUM,
            router: vm.envOr("ROUTER_ARBITRUM", address(0))
        });
        peers[2] = ChainConfig({
            chainId: 10,
            eid: EID_OPTIMISM,
            router: vm.envOr("ROUTER_OPTIMISM", address(0))
        });
        peers[3] = ChainConfig({
            chainId: 137,
            eid: EID_POLYGON,
            router: vm.envOr("ROUTER_POLYGON", address(0))
        });
        peers[4] = ChainConfig({
            chainId: 8453,
            eid: EID_BASE,
            router: vm.envOr("ROUTER_BASE", address(0))
        });
        peers[5] = ChainConfig({
            chainId: 43114,
            eid: EID_AVALANCHE,
            router: vm.envOr("ROUTER_AVALANCHE", address(0))
        });

        vm.startBroadcast(deployerPrivateKey);

        CrossChainRouter router = CrossChainRouter(payable(currentRouter));

        for (uint256 i = 0; i < peers.length; i++) {
            if (peers[i].router != address(0) && peers[i].chainId != block.chainid) {
                bytes32 peerBytes = bytes32(uint256(uint160(peers[i].router)));

                router.setPeer(peers[i].eid, peerBytes);

                console.log("Set peer for chain", peers[i].chainId);
                console.log("  EID:", peers[i].eid);
                console.log("  Router:", peers[i].router);
            }
        }

        vm.stopBroadcast();

        console.log("\nPeer configuration complete!");
    }
}

/**
 * @title ConfigureTestnetPeers
 * @notice Configure peers for testnet deployment
 */
contract ConfigureTestnetPeers is Script {
    function run() external {
        uint256 deployerPrivateKey = vm.envUint("PRIVATE_KEY");

        address sepoliaRouter = vm.envAddress("ROUTER_SEPOLIA");
        address arbSepoliaRouter = vm.envAddress("ROUTER_ARB_SEPOLIA");

        vm.startBroadcast(deployerPrivateKey);

        // Configure based on current chain
        if (block.chainid == 11155111) {
            // On Sepolia, set Arbitrum Sepolia as peer
            CrossChainRouter router = CrossChainRouter(payable(sepoliaRouter));
            router.setPeer(40231, bytes32(uint256(uint160(arbSepoliaRouter))));
            console.log("Configured Sepolia -> Arbitrum Sepolia peer");
        } else if (block.chainid == 421614) {
            // On Arbitrum Sepolia, set Sepolia as peer
            CrossChainRouter router = CrossChainRouter(payable(arbSepoliaRouter));
            router.setPeer(40161, bytes32(uint256(uint160(sepoliaRouter))));
            console.log("Configured Arbitrum Sepolia -> Sepolia peer");
        }

        vm.stopBroadcast();
    }
}

/**
 * @title VerifyPeers
 * @notice Verify peer configurations are correct
 */
contract VerifyPeers is Script {
    function run() external view {
        address routerAddress = vm.envAddress("ROUTER_ADDRESS");
        CrossChainRouter router = CrossChainRouter(payable(routerAddress));

        console.log("Checking peers for router:", routerAddress);

        // Check common chain EIDs
        uint32[] memory eids = new uint32[](6);
        eids[0] = 30101; // Ethereum
        eids[1] = 30110; // Arbitrum
        eids[2] = 30111; // Optimism
        eids[3] = 30109; // Polygon
        eids[4] = 30184; // Base
        eids[5] = 30106; // Avalanche

        string[6] memory names = ["Ethereum", "Arbitrum", "Optimism", "Polygon", "Base", "Avalanche"];

        for (uint256 i = 0; i < eids.length; i++) {
            bytes32 peer = router.peers(eids[i]);
            if (peer != bytes32(0)) {
                console.log(names[i], "peer:", uint256(peer));
            } else {
                console.log(names[i], ": not configured");
            }
        }
    }
}
