// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "forge-std/Script.sol";
import "../contracts/core/VibeSwapCore.sol";
import "../contracts/core/CommitRevealAuction.sol";
import "../contracts/amm/VibeAMM.sol";
import "../contracts/governance/DAOTreasury.sol";

/**
 * @title SetupMVP
 * @notice MVP setup script for testers - creates pools and seeds liquidity
 * @dev Run after Deploy.s.sol: forge script script/SetupMVP.s.sol --rpc-url $RPC_URL --broadcast
 */
contract SetupMVP is Script {
    // Deployed contract addresses (set these from deployment output)
    address constant CORE = address(0); // UPDATE AFTER DEPLOY
    address constant AMM = address(0);  // UPDATE AFTER DEPLOY
    address constant WETH = address(0); // UPDATE AFTER DEPLOY
    address constant USDC = address(0); // UPDATE AFTER DEPLOY
    address constant WBTC = address(0); // UPDATE AFTER DEPLOY

    function run() external {
        uint256 deployerPrivateKey = vm.envUint("PRIVATE_KEY");
        address owner = vm.addr(deployerPrivateKey);

        // Get addresses from environment or use constants
        address core = vm.envOr("VIBESWAP_CORE", CORE);
        address amm = vm.envOr("VIBESWAP_AMM", AMM);
        address weth = vm.envOr("WETH", WETH);
        address usdc = vm.envOr("USDC", USDC);
        address wbtc = vm.envOr("WBTC", WBTC);

        require(core != address(0), "Set VIBESWAP_CORE env var");
        require(amm != address(0), "Set VIBESWAP_AMM env var");
        require(weth != address(0), "Set WETH env var");
        require(usdc != address(0), "Set USDC env var");

        console.log("Setting up MVP for testers...");
        console.log("Core:", core);
        console.log("AMM:", amm);

        vm.startBroadcast(deployerPrivateKey);

        // 1. Create pools via Core
        VibeSwapCore vibeCore = VibeSwapCore(payable(core));

        // WETH/USDC pool (0.3% fee)
        bytes32 wethUsdcPool = vibeCore.createPool(weth, usdc, 30);
        console.log("Created WETH/USDC pool:", vm.toString(wethUsdcPool));

        if (wbtc != address(0)) {
            // WBTC/USDC pool (0.3% fee)
            bytes32 wbtcUsdcPool = vibeCore.createPool(wbtc, usdc, 30);
            console.log("Created WBTC/USDC pool:", vm.toString(wbtcUsdcPool));

            // WBTC/WETH pool (0.3% fee)
            bytes32 wbtcWethPool = vibeCore.createPool(wbtc, weth, 30);
            console.log("Created WBTC/WETH pool:", vm.toString(wbtcWethPool));
        }

        // 2. Approve tokens for AMM
        IERC20(weth).approve(amm, type(uint256).max);
        IERC20(usdc).approve(amm, type(uint256).max);
        if (wbtc != address(0)) {
            IERC20(wbtc).approve(amm, type(uint256).max);
        }

        // 3. Add initial liquidity to pools
        VibeAMM vibeAMM = VibeAMM(amm);

        // Add liquidity to WETH/USDC (10 ETH + 20,000 USDC at ~$2000/ETH)
        vibeAMM.addLiquidity(
            wethUsdcPool,
            10 ether,      // 10 WETH
            20_000 * 1e6,  // 20,000 USDC
            9 ether,       // min WETH
            18_000 * 1e6   // min USDC
        );
        console.log("Added liquidity to WETH/USDC pool");

        vm.stopBroadcast();

        // Output test instructions
        console.log("\n=== MVP Setup Complete ===");
        console.log("Pools created and seeded with liquidity");
        console.log("");
        console.log("=== Testing Instructions ===");
        console.log("1. Get test tokens from faucet or mint them");
        console.log("2. Approve tokens for VibeSwapCore");
        console.log("3. Call commitSwap() during COMMIT phase");
        console.log("4. Call revealSwap() during REVEAL phase");
        console.log("5. Anyone can call settleBatch() after REVEAL ends");
        console.log("6. Call withdrawDeposit() to get your deposit back");
        console.log("");
        console.log("=== Contract Addresses ===");
        console.log("VibeSwapCore:", core);
        console.log("VibeAMM:", amm);
        console.log("WETH:", weth);
        console.log("USDC:", usdc);
        console.log("===========================\n");
    }
}

/**
 * @title TestSwapFlow
 * @notice Test script to verify the complete swap flow works
 */
contract TestSwapFlow is Script {
    function run() external {
        uint256 deployerPrivateKey = vm.envUint("PRIVATE_KEY");

        address core = vm.envAddress("VIBESWAP_CORE");
        address weth = vm.envAddress("WETH");
        address usdc = vm.envAddress("USDC");

        vm.startBroadcast(deployerPrivateKey);

        VibeSwapCore vibeCore = VibeSwapCore(payable(core));

        // Generate a random secret
        bytes32 secret = keccak256(abi.encodePacked(block.timestamp, msg.sender, "test"));

        // Approve tokens
        IERC20(weth).approve(core, type(uint256).max);

        // Commit a swap (0.1 WETH for USDC)
        bytes32 commitId = vibeCore.commitSwap{value: 0.01 ether}(
            weth,
            usdc,
            0.1 ether,    // 0.1 WETH
            100 * 1e6,    // min 100 USDC
            secret
        );

        console.log("Committed swap:", vm.toString(commitId));
        console.log("Wait for REVEAL phase, then run RevealSwap script");

        vm.stopBroadcast();
    }
}

/**
 * @title RevealSwap
 * @notice Reveal a previously committed swap
 */
contract RevealSwap is Script {
    function run() external {
        uint256 deployerPrivateKey = vm.envUint("PRIVATE_KEY");

        address core = vm.envAddress("VIBESWAP_CORE");
        bytes32 commitId = vm.envBytes32("COMMIT_ID");

        vm.startBroadcast(deployerPrivateKey);

        VibeSwapCore vibeCore = VibeSwapCore(payable(core));

        // Reveal with no priority bid
        vibeCore.revealSwap(commitId, 0);

        console.log("Revealed swap:", vm.toString(commitId));
        console.log("Wait for SETTLING phase, then run SettleBatch script");

        vm.stopBroadcast();
    }
}

/**
 * @title SettleBatch
 * @notice Settle the current batch after reveal phase
 */
contract SettleBatch is Script {
    function run() external {
        uint256 deployerPrivateKey = vm.envUint("PRIVATE_KEY");

        address core = vm.envAddress("VIBESWAP_CORE");
        address auction = vm.envAddress("VIBESWAP_AUCTION");

        vm.startBroadcast(deployerPrivateKey);

        VibeSwapCore vibeCore = VibeSwapCore(payable(core));
        ICommitRevealAuction auctionContract = ICommitRevealAuction(auction);

        uint64 batchId = auctionContract.getCurrentBatchId();

        vibeCore.settleBatch(batchId);

        console.log("Settled batch:", batchId);

        vm.stopBroadcast();
    }
}
