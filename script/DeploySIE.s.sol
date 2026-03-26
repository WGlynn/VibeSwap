// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "forge-std/Script.sol";
import "../contracts/mechanism/IntelligenceExchange.sol";
import "../contracts/mechanism/CognitiveConsensusMarket.sol";
import "@openzeppelin/contracts/proxy/ERC1967/ERC1967Proxy.sol";

/**
 * @title DeploySIE — Deploy the Sovereign Intelligence Exchange
 * @notice Deploys IntelligenceExchange behind a UUPS proxy.
 *         Configures epoch submitter for the Jarvis knowledge bridge.
 *
 * @dev Usage:
 *   forge script script/DeploySIE.s.sol --rpc-url $RPC --broadcast
 *
 *   Required env vars:
 *     PRIVATE_KEY        — deployer private key
 *     VIBE_TOKEN         — address of deployed VIBE token
 *     JARVIS_SHARD       — address authorized to submit knowledge epochs
 */
contract DeploySIE is Script {
    function run() external {
        uint256 deployerKey = vm.envUint("PRIVATE_KEY");
        address deployer = vm.addr(deployerKey);
        address vibeToken = vm.envAddress("VIBE_TOKEN");

        // Optional: Jarvis shard address for epoch anchoring
        address jarvisShard = vm.envOr("JARVIS_SHARD", address(0));

        console.log("=== Sovereign Intelligence Exchange Deployment ===");
        console.log("Deployer:", deployer);
        console.log("VIBE Token:", vibeToken);
        console.log("Jarvis Shard:", jarvisShard);

        vm.startBroadcast(deployerKey);

        // Deploy implementation
        IntelligenceExchange impl = new IntelligenceExchange();
        console.log("Implementation:", address(impl));

        // Deploy proxy
        bytes memory initData = abi.encodeCall(
            IntelligenceExchange.initialize,
            (vibeToken, deployer)
        );
        ERC1967Proxy proxy = new ERC1967Proxy(address(impl), initData);
        IntelligenceExchange sie = IntelligenceExchange(payable(address(proxy)));
        console.log("Proxy (SIE):", address(proxy));

        // Verify P-001
        require(sie.PROTOCOL_FEE_BPS() == 0, "P-001 VIOLATION: protocol fee must be zero");
        console.log("P-001 verified: 0% protocol fee");

        // Authorize Jarvis shard for epoch anchoring
        if (jarvisShard != address(0)) {
            sie.addEpochSubmitter(jarvisShard);
            console.log("Epoch submitter authorized:", jarvisShard);
        }

        // Deploy CognitiveConsensusMarket (Phase 1)
        CognitiveConsensusMarket ccm = new CognitiveConsensusMarket(vibeToken);
        console.log("CognitiveConsensusMarket:", address(ccm));

        // Wire SIE <-> CCM
        sie.setCognitiveConsensusMarket(address(ccm));
        console.log("SIE wired to CCM");

        // Verify deployment
        require(address(sie.vibeToken()) == vibeToken, "VIBE token mismatch");
        require(sie.assetCount() == 0, "Asset count should be 0");
        require(sie.epochCount() == 0, "Epoch count should be 0");
        require(sie.cognitiveConsensusMarket() == address(ccm), "CCM not wired");
        console.log("Deployment verified");

        vm.stopBroadcast();

        console.log("");
        console.log("=== SIE + CCM Deployed Successfully ===");
        console.log("Set INTELLIGENCE_EXCHANGE=%s in Jarvis .env", address(proxy));
        console.log("Set COGNITIVE_CONSENSUS_MARKET=%s in Jarvis .env", address(ccm));
        console.log("Nothing is promised. Everything is earned.");
    }
}
