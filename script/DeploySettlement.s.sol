// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "forge-std/Script.sol";
import "../contracts/settlement/VibeStateChain.sol";
import "../contracts/settlement/ShapleyVerifier.sol";
import "../contracts/settlement/TrustScoreVerifier.sol";
import "../contracts/settlement/VoteVerifier.sol";
import "../contracts/settlement/BatchPriceVerifier.sol";
import "../contracts/settlement/VerifierCheckpointBridge.sol";
import "@openzeppelin/contracts/proxy/ERC1967/ERC1967Proxy.sol";

/**
 * @title DeploySettlement
 * @notice Deploys the settlement layer — the kernel that persists
 * @dev Run after DeployTokenomics.s.sol (ShapleyDistributor needs verifier address):
 *      forge script script/DeploySettlement.s.sol --rpc-url $RPC_URL --broadcast --verify
 *
 * Deploys:
 *   1. VibeStateChain (UUPS proxy) — CKB-inspired state settlement chain
 *   2. ShapleyVerifier (UUPS proxy) — off-chain Shapley value verification
 *   3. TrustScoreVerifier (UUPS proxy) — off-chain trust score verification
 *   4. VoteVerifier (UUPS proxy) — off-chain vote tally verification
 *   5. BatchPriceVerifier (UUPS proxy) — clearing price verification
 *   6. VerifierCheckpointBridge (UUPS proxy) — bridges verifiers → state chain
 *
 * Post-deploy wiring:
 *   - Register all verifiers in the checkpoint bridge
 *   - Set ShapleyVerifier address in ShapleyDistributor (if deployed)
 *
 * Required environment variables:
 *   - PRIVATE_KEY: Deployer private key
 *
 * Optional environment variables:
 *   - OWNER_ADDRESS: Override owner (defaults to deployer)
 *   - DISPUTE_WINDOW: Verifier dispute window in seconds (default: 1 hour)
 *   - BOND_AMOUNT: Verifier submitter bond in wei (default: 0.01 ETH)
 *   - QUORUM_BPS: VoteVerifier default quorum in BPS (default: 1000 = 10%)
 *   - SHAPLEY_DISTRIBUTOR: ShapleyDistributor proxy address (optional, for wiring)
 */
contract DeploySettlement is Script {
    // UUPS proxies
    address public vibeStateChainImpl;
    address public vibeStateChain;

    address public shapleyVerifierImpl;
    address public shapleyVerifier;

    address public trustScoreVerifierImpl;
    address public trustScoreVerifier;

    address public voteVerifierImpl;
    address public voteVerifier;

    address public batchPriceVerifierImpl;
    address public batchPriceVerifier;

    address public checkpointBridgeImpl;
    address public checkpointBridge;

    // Config
    address public owner;

    function run() external {
        uint256 deployerPrivateKey = vm.envUint("PRIVATE_KEY");
        address deployer = vm.addr(deployerPrivateKey);

        owner = vm.envOr("OWNER_ADDRESS", deployer);
        uint256 disputeWindow = vm.envOr("DISPUTE_WINDOW", uint256(1 hours));
        uint256 bondAmount = vm.envOr("BOND_AMOUNT", uint256(0.01 ether));
        uint256 quorumBps = vm.envOr("QUORUM_BPS", uint256(1000));

        console.log("=== VibeSwap Settlement Layer Deployment ===");
        console.log("Chain ID:", block.chainid);
        console.log("Deployer:", deployer);
        console.log("Owner:", owner);
        console.log("Dispute Window:", disputeWindow, "seconds");
        console.log("Bond Amount:", bondAmount, "wei");
        console.log("");

        vm.startBroadcast(deployerPrivateKey);

        // Step 1: Deploy VibeStateChain (UUPS proxy)
        console.log("Step 1: Deploying VibeStateChain...");
        vibeStateChainImpl = address(new VibeStateChain());
        bytes memory stateChainInit = abi.encodeWithSelector(VibeStateChain.initialize.selector);
        vibeStateChain = address(new ERC1967Proxy(vibeStateChainImpl, stateChainInit));
        console.log("  VibeStateChain impl:", vibeStateChainImpl);
        console.log("  VibeStateChain proxy:", vibeStateChain);

        // Step 2: Deploy ShapleyVerifier (UUPS proxy)
        console.log("Step 2: Deploying ShapleyVerifier...");
        shapleyVerifierImpl = address(new ShapleyVerifier());
        bytes memory shapleyInit = abi.encodeWithSelector(
            ShapleyVerifier.initialize.selector, disputeWindow, bondAmount
        );
        shapleyVerifier = address(new ERC1967Proxy(shapleyVerifierImpl, shapleyInit));
        console.log("  ShapleyVerifier impl:", shapleyVerifierImpl);
        console.log("  ShapleyVerifier proxy:", shapleyVerifier);

        // Step 3: Deploy TrustScoreVerifier (UUPS proxy)
        console.log("Step 3: Deploying TrustScoreVerifier...");
        trustScoreVerifierImpl = address(new TrustScoreVerifier());
        bytes memory trustInit = abi.encodeWithSelector(
            TrustScoreVerifier.initialize.selector, disputeWindow, bondAmount
        );
        trustScoreVerifier = address(new ERC1967Proxy(trustScoreVerifierImpl, trustInit));
        console.log("  TrustScoreVerifier impl:", trustScoreVerifierImpl);
        console.log("  TrustScoreVerifier proxy:", trustScoreVerifier);

        // Step 4: Deploy VoteVerifier (UUPS proxy)
        console.log("Step 4: Deploying VoteVerifier...");
        voteVerifierImpl = address(new VoteVerifier());
        bytes memory voteInit = abi.encodeWithSelector(
            VoteVerifier.initialize.selector, disputeWindow, bondAmount, quorumBps
        );
        voteVerifier = address(new ERC1967Proxy(voteVerifierImpl, voteInit));
        console.log("  VoteVerifier impl:", voteVerifierImpl);
        console.log("  VoteVerifier proxy:", voteVerifier);

        // Step 5: Deploy BatchPriceVerifier (UUPS proxy)
        console.log("Step 5: Deploying BatchPriceVerifier...");
        batchPriceVerifierImpl = address(new BatchPriceVerifier());
        bytes memory batchInit = abi.encodeWithSelector(
            BatchPriceVerifier.initialize.selector, owner, bondAmount, uint64(disputeWindow)
        );
        batchPriceVerifier = address(new ERC1967Proxy(batchPriceVerifierImpl, batchInit));
        console.log("  BatchPriceVerifier impl:", batchPriceVerifierImpl);
        console.log("  BatchPriceVerifier proxy:", batchPriceVerifier);

        // Step 6: Deploy VerifierCheckpointBridge (UUPS proxy)
        console.log("Step 6: Deploying VerifierCheckpointBridge...");
        checkpointBridgeImpl = address(new VerifierCheckpointBridge());
        bytes memory bridgeInit = abi.encodeWithSelector(
            VerifierCheckpointBridge.initialize.selector, vibeStateChain
        );
        checkpointBridge = address(new ERC1967Proxy(checkpointBridgeImpl, bridgeInit));
        console.log("  VerifierCheckpointBridge impl:", checkpointBridgeImpl);
        console.log("  VerifierCheckpointBridge proxy:", checkpointBridge);

        // Step 7: Wire verifiers into checkpoint bridge
        console.log("Step 7: Wiring verifiers into checkpoint bridge...");
        VerifierCheckpointBridge bridge = VerifierCheckpointBridge(checkpointBridge);
        bridge.registerVerifier(shapleyVerifier, bridge.SOURCE_SHAPLEY());
        bridge.registerVerifier(trustScoreVerifier, bridge.SOURCE_TRUST());
        bridge.registerVerifier(voteVerifier, bridge.SOURCE_VOTE());
        bridge.registerVerifier(batchPriceVerifier, bridge.SOURCE_BATCH_PRICE());
        console.log("  4 verifiers registered");

        // Step 8: Wire ShapleyVerifier into ShapleyDistributor (if available)
        address shapleyDistributor = vm.envOr("SHAPLEY_DISTRIBUTOR", address(0));
        if (shapleyDistributor != address(0)) {
            console.log("Step 8: Wiring ShapleyVerifier into ShapleyDistributor...");
            // Call setShapleyVerifier on the distributor
            (bool ok, ) = shapleyDistributor.call(
                abi.encodeWithSignature("setShapleyVerifier(address)", shapleyVerifier)
            );
            if (ok) {
                console.log("  ShapleyVerifier wired into ShapleyDistributor");
            } else {
                console.log("  WARNING: Failed to wire (check ownership)");
            }
        }

        // Step 9: Verify
        console.log("Step 9: Running verification...");
        _verify();

        vm.stopBroadcast();

        _outputSummary();
    }

    function _verify() internal view {
        require(vibeStateChain.code.length > 0, "VibeStateChain proxy has no code");
        require(shapleyVerifier.code.length > 0, "ShapleyVerifier proxy has no code");
        require(trustScoreVerifier.code.length > 0, "TrustScoreVerifier proxy has no code");
        require(voteVerifier.code.length > 0, "VoteVerifier proxy has no code");
        require(batchPriceVerifier.code.length > 0, "BatchPriceVerifier proxy has no code");
        require(checkpointBridge.code.length > 0, "CheckpointBridge proxy has no code");

        console.log("  All verifications passed");
    }

    function _outputSummary() internal view {
        console.log("");
        console.log("=== SETTLEMENT LAYER DEPLOYMENT SUCCESSFUL ===");
        console.log("");
        console.log("State Chain:");
        console.log("  VIBE_STATE_CHAIN=", vibeStateChain);
        console.log("");
        console.log("Verifiers (all UUPS):");
        console.log("  SHAPLEY_VERIFIER=", shapleyVerifier);
        console.log("  TRUST_SCORE_VERIFIER=", trustScoreVerifier);
        console.log("  VOTE_VERIFIER=", voteVerifier);
        console.log("  BATCH_PRICE_VERIFIER=", batchPriceVerifier);
        console.log("");
        console.log("Bridge:");
        console.log("  VERIFIER_CHECKPOINT_BRIDGE=", checkpointBridge);
        console.log("");
        console.log("Settlement Architecture:");
        console.log("  Off-chain compute -> Verifier (axiom checks) -> Dispute window -> Finalize");
        console.log("  Finalized results -> CheckpointBridge -> VibeStateChain (permanent record)");
        console.log("  Pure verification functions -> portable to CKB RISC-V");
        console.log("");
        console.log("Next steps:");
        console.log("1. Set SHAPLEY_DISTRIBUTOR env var and re-run to wire distributor");
        console.log("2. Bond submitters on each verifier (bond() with ETH)");
        console.log("3. Register VibeStateChain as validator on the checkpoint bridge");
        console.log("4. Submit first off-chain Shapley computation for verification");
        console.log("================================================");
        console.log("");
        console.log("// Copy these to your .env file:");
        console.log(string(abi.encodePacked("VIBE_STATE_CHAIN=", vm.toString(vibeStateChain))));
        console.log(string(abi.encodePacked("SHAPLEY_VERIFIER=", vm.toString(shapleyVerifier))));
        console.log(string(abi.encodePacked("TRUST_SCORE_VERIFIER=", vm.toString(trustScoreVerifier))));
        console.log(string(abi.encodePacked("VOTE_VERIFIER=", vm.toString(voteVerifier))));
        console.log(string(abi.encodePacked("BATCH_PRICE_VERIFIER=", vm.toString(batchPriceVerifier))));
        console.log(string(abi.encodePacked("VERIFIER_CHECKPOINT_BRIDGE=", vm.toString(checkpointBridge))));
    }
}
