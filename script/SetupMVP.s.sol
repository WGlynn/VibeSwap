// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "forge-std/Script.sol";
import "../contracts/core/VibeSwapCore.sol";
import "../contracts/core/CommitRevealAuction.sol";
import "../contracts/amm/VibeAMM.sol";
import "../contracts/governance/DAOTreasury.sol";
import "../contracts/libraries/LiquidityProtection.sol";

/**
 * @title SetupMVP
 * @notice MVP setup script for mainnet - creates pools with liquidity protection
 * @dev Run after Deploy.s.sol: forge script script/SetupMVP.s.sol --rpc-url $RPC_URL --broadcast
 *
 * Required environment variables:
 * - PRIVATE_KEY: Owner private key
 * - VIBESWAP_CORE: Core contract address
 * - VIBESWAP_AMM: AMM contract address
 *
 * Optional environment variables:
 * - WETH_ADDRESS, USDC_ADDRESS, USDT_ADDRESS, WBTC_ADDRESS: Token addresses
 */
contract SetupMVP is Script {
    // Token addresses by chain
    struct ChainTokens {
        address weth;
        address usdc;
        address usdt;
        address wbtc;
    }

    function run() external {
        uint256 deployerPrivateKey = vm.envUint("PRIVATE_KEY");

        address core = vm.envAddress("VIBESWAP_CORE");
        address amm = vm.envAddress("VIBESWAP_AMM");

        ChainTokens memory tokens = _getTokenAddresses(block.chainid);

        console.log("=== VibeSwap MVP Pool Setup ===");
        console.log("Chain ID:", block.chainid);
        console.log("Core:", core);
        console.log("AMM:", amm);
        console.log("");

        vm.startBroadcast(deployerPrivateKey);

        VibeSwapCore vibeCore = VibeSwapCore(payable(core));
        VibeAMM vibeAMM = VibeAMM(amm);

        // Create pools
        console.log("Creating pools...");

        // ETH/USDC - Primary pool, 0.05% fee
        bytes32 ethUsdcPool = _createPool(vibeCore, vibeAMM, tokens.weth, tokens.usdc, 5, "ETH/USDC");

        // ETH/USDT - Secondary stablecoin pair, 0.05% fee
        bytes32 ethUsdtPool;
        if (tokens.usdt != address(0)) {
            ethUsdtPool = _createPool(vibeCore, vibeAMM, tokens.weth, tokens.usdt, 5, "ETH/USDT");
        }

        // USDC/USDT - Stablecoin pair, 0.01% fee (Curve-style)
        bytes32 usdcUsdtPool;
        if (tokens.usdt != address(0)) {
            usdcUsdtPool = _createPool(vibeCore, vibeAMM, tokens.usdc, tokens.usdt, 1, "USDC/USDT");
        }

        // WBTC/USDC - BTC exposure, 0.05% fee
        bytes32 wbtcUsdcPool;
        if (tokens.wbtc != address(0)) {
            wbtcUsdcPool = _createPool(vibeCore, vibeAMM, tokens.wbtc, tokens.usdc, 5, "WBTC/USDC");
        }

        // ETH/WBTC - Major pair, 0.05% fee
        bytes32 ethWbtcPool;
        if (tokens.wbtc != address(0)) {
            ethWbtcPool = _createPool(vibeCore, vibeAMM, tokens.weth, tokens.wbtc, 5, "ETH/WBTC");
        }

        console.log("");
        console.log("Configuring liquidity protection...");

        // Configure volatile pair protection
        _configureVolatilePairProtection(vibeAMM, ethUsdcPool, "ETH/USDC");

        if (tokens.usdt != address(0)) {
            _configureVolatilePairProtection(vibeAMM, ethUsdtPool, "ETH/USDT");
        }

        if (tokens.wbtc != address(0)) {
            _configureVolatilePairProtection(vibeAMM, wbtcUsdcPool, "WBTC/USDC");
            _configureVolatilePairProtection(vibeAMM, ethWbtcPool, "ETH/WBTC");
        }

        // Configure stablecoin pair protection (high amplification)
        if (tokens.usdt != address(0)) {
            _configureStablePairProtection(vibeAMM, usdcUsdtPool, "USDC/USDT");
        }

        console.log("");
        console.log("Configuring oracle settings...");

        // Grow oracle cardinality for longer TWAP/VWAP windows
        vibeAMM.growOracleCardinality(ethUsdcPool, 120); // 1 hour of 30s observations
        vibeAMM.growVWAPCardinality(ethUsdcPool, 120);
        console.log("  ETH/USDC: Oracle cardinality set to 120");

        if (tokens.wbtc != address(0)) {
            vibeAMM.growOracleCardinality(wbtcUsdcPool, 120);
            vibeAMM.growVWAPCardinality(wbtcUsdcPool, 120);
            console.log("  WBTC/USDC: Oracle cardinality set to 120");
        }

        vm.stopBroadcast();

        _outputSummary(ethUsdcPool, ethUsdtPool, usdcUsdtPool, wbtcUsdcPool, ethWbtcPool);
    }

    function _createPool(
        VibeSwapCore vibeCore,
        VibeAMM vibeAMM,
        address token0,
        address token1,
        uint256 feeRate,
        string memory name
    ) internal returns (bytes32 poolId) {
        // Ensure consistent ordering
        if (token0 > token1) {
            (token0, token1) = (token1, token0);
        }

        poolId = vibeAMM.getPoolId(token0, token1);

        // Check if pool already exists
        VibeAMM.Pool memory existingPool = vibeAMM.getPool(poolId);
        if (existingPool.initialized) {
            console.log("  ", name, "pool already exists");
            return poolId;
        }

        // Create pool via Core (maintains authorization flow)
        poolId = vibeCore.createPool(token0, token1, feeRate);
        console.log("  Created", name, "pool");
    }

    function _configureVolatilePairProtection(
        VibeAMM vibeAMM,
        bytes32 poolId,
        string memory name
    ) internal {
        // Standard volatile pair config:
        // - 10x amplification (moderate virtual liquidity boost)
        // - 300 bps (3%) max price impact
        // - $10,000 minimum liquidity to trade
        // - $100k low liquidity threshold for dynamic fees
        // - All protection mechanisms enabled

        LiquidityProtection.ProtectionConfig memory config = LiquidityProtection.ProtectionConfig({
            amplificationFactor: 10,
            maxPriceImpactBps: 300,
            minLiquidityUsd: 10_000 * 1e18,
            lowLiquidityThreshold: 100_000 * 1e18,
            virtualReservesEnabled: true,
            dynamicFeesEnabled: true,
            priceImpactCapEnabled: true,
            minLiquidityGateEnabled: true
        });

        vibeAMM.setPoolProtectionConfig(poolId, config);
        console.log("  ", name, ": Volatile pair protection configured");
    }

    function _configureStablePairProtection(
        VibeAMM vibeAMM,
        bytes32 poolId,
        string memory name
    ) internal {
        // Stablecoin pair config (Curve-style):
        // - 100x amplification (high virtual liquidity for stable pairs)
        // - 10 bps (0.1%) max price impact
        // - $1,000 minimum liquidity (lower threshold for stables)
        // - $50k low liquidity threshold for dynamic fees
        // - All protection mechanisms enabled

        LiquidityProtection.ProtectionConfig memory config = LiquidityProtection.ProtectionConfig({
            amplificationFactor: 100,
            maxPriceImpactBps: 10,
            minLiquidityUsd: 1_000 * 1e18,
            lowLiquidityThreshold: 50_000 * 1e18,
            virtualReservesEnabled: true,
            dynamicFeesEnabled: true,
            priceImpactCapEnabled: true,
            minLiquidityGateEnabled: true
        });

        vibeAMM.setPoolProtectionConfig(poolId, config);
        console.log("  ", name, ": Stable pair protection (100x amplification)");
    }

    function _getTokenAddresses(uint256 chainId) internal view returns (ChainTokens memory) {
        // Ethereum Mainnet
        if (chainId == 1) {
            return ChainTokens({
                weth: 0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2,
                usdc: 0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48,
                usdt: 0xdAC17F958D2ee523a2206206994597C13D831ec7,
                wbtc: 0x2260FAC5E5542a773Aa44fBCfeDf7C193bc2C599
            });
        }

        // Arbitrum One
        if (chainId == 42161) {
            return ChainTokens({
                weth: 0x82aF49447D8a07e3bd95BD0d56f35241523fBab1,
                usdc: 0xaf88d065e77c8cC2239327C5EDb3A432268e5831,
                usdt: 0xFd086bC7CD5C481DCC9C85ebE478A1C0b69FCbb9,
                wbtc: 0x2f2a2543B76A4166549F7aaB2e75Bef0aefC5B0f
            });
        }

        // Base
        if (chainId == 8453) {
            return ChainTokens({
                weth: 0x4200000000000000000000000000000000000006,
                usdc: 0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913,
                usdt: address(0),
                wbtc: address(0)
            });
        }

        // Optimism
        if (chainId == 10) {
            return ChainTokens({
                weth: 0x4200000000000000000000000000000000000006,
                usdc: 0x0b2C639c533813f4Aa9D7837CAf62653d097Ff85,
                usdt: 0x94b008aA00579c1307B0EF2c499aD98a8ce58e58,
                wbtc: 0x68f180fcCe6836688e9084f035309E29Bf0A2095
            });
        }

        // Sepolia Testnet (use environment variables)
        if (chainId == 11155111) {
            return ChainTokens({
                weth: vm.envOr("WETH_ADDRESS", address(0)),
                usdc: vm.envOr("USDC_ADDRESS", address(0)),
                usdt: vm.envOr("USDT_ADDRESS", address(0)),
                wbtc: vm.envOr("WBTC_ADDRESS", address(0))
            });
        }

        // Default: use environment variables
        return ChainTokens({
            weth: vm.envAddress("WETH_ADDRESS"),
            usdc: vm.envAddress("USDC_ADDRESS"),
            usdt: vm.envOr("USDT_ADDRESS", address(0)),
            wbtc: vm.envOr("WBTC_ADDRESS", address(0))
        });
    }

    function _outputSummary(
        bytes32 ethUsdcPool,
        bytes32 ethUsdtPool,
        bytes32 usdcUsdtPool,
        bytes32 wbtcUsdcPool,
        bytes32 ethWbtcPool
    ) internal view {
        console.log("");
        console.log("=== MVP SETUP COMPLETE ===");
        console.log("");
        console.log("Pool IDs:");
        console.log("  ETH/USDC:", vm.toString(ethUsdcPool));
        if (ethUsdtPool != bytes32(0)) {
            console.log("  ETH/USDT:", vm.toString(ethUsdtPool));
        }
        if (usdcUsdtPool != bytes32(0)) {
            console.log("  USDC/USDT:", vm.toString(usdcUsdtPool));
        }
        if (wbtcUsdcPool != bytes32(0)) {
            console.log("  WBTC/USDC:", vm.toString(wbtcUsdcPool));
        }
        if (ethWbtcPool != bytes32(0)) {
            console.log("  ETH/WBTC:", vm.toString(ethWbtcPool));
        }
        console.log("");
        console.log("Next steps:");
        console.log("1. Add initial liquidity to pools");
        console.log("2. Set token USD prices (UpdateTokenPrices script)");
        console.log("3. Test swaps with small amounts");
        console.log("4. Start oracle (python -m oracle.main)");
        console.log("============================");
    }
}

/**
 * @title UpdateTokenPrices
 * @notice Update token prices for liquidity protection calculations
 * @dev Run periodically or connect to Chainlink
 */
contract UpdateTokenPrices is Script {
    function run() external {
        uint256 ownerKey = vm.envUint("PRIVATE_KEY");
        address amm = vm.envAddress("VIBESWAP_AMM");

        // Get current prices from env (should come from oracle in production)
        uint256 ethPrice = vm.envOr("ETH_USD_PRICE", uint256(2500 * 1e18));
        uint256 btcPrice = vm.envOr("BTC_USD_PRICE", uint256(45000 * 1e18));
        uint256 usdcPrice = 1e18;
        uint256 usdtPrice = 1e18;

        address weth = vm.envOr("WETH_ADDRESS", address(0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2));
        address usdc = vm.envOr("USDC_ADDRESS", address(0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48));
        address usdt = vm.envOr("USDT_ADDRESS", address(0xdAC17F958D2ee523a2206206994597C13D831ec7));
        address wbtc = vm.envOr("WBTC_ADDRESS", address(0x2260FAC5E5542a773Aa44fBCfeDf7C193bc2C599));

        console.log("Updating token prices...");
        console.log("  ETH:", ethPrice / 1e18, "USD");
        console.log("  BTC:", btcPrice / 1e18, "USD");

        vm.startBroadcast(ownerKey);

        VibeAMM vibeAMM = VibeAMM(amm);
        vibeAMM.updateTokenPrice(weth, ethPrice);
        vibeAMM.updateTokenPrice(usdc, usdcPrice);
        vibeAMM.updateTokenPrice(usdt, usdtPrice);
        vibeAMM.updateTokenPrice(wbtc, btcPrice);

        vm.stopBroadcast();

        console.log("Token prices updated");
    }
}

/**
 * @title AddInitialLiquidity
 * @notice Add initial liquidity to bootstrap pools
 */
contract AddInitialLiquidity is Script {
    function run() external {
        uint256 deployerPrivateKey = vm.envUint("PRIVATE_KEY");
        address amm = vm.envAddress("VIBESWAP_AMM");

        address weth = vm.envOr("WETH_ADDRESS", address(0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2));
        address usdc = vm.envOr("USDC_ADDRESS", address(0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48));

        // Liquidity amounts (adjust based on available capital)
        uint256 ethAmount = vm.envOr("ETH_LIQUIDITY", uint256(10 ether));
        uint256 usdcAmount = vm.envOr("USDC_LIQUIDITY", uint256(25_000 * 1e6));

        console.log("Adding initial liquidity...");
        console.log("  ETH:", ethAmount / 1e18);
        console.log("  USDC:", usdcAmount / 1e6);

        vm.startBroadcast(deployerPrivateKey);

        VibeAMM vibeAMM = VibeAMM(amm);
        bytes32 poolId = vibeAMM.getPoolId(weth, usdc);

        // Approve tokens
        IERC20(weth).approve(amm, ethAmount);
        IERC20(usdc).approve(amm, usdcAmount);

        // Add liquidity with 5% slippage tolerance
        vibeAMM.addLiquidity(
            poolId,
            ethAmount,
            usdcAmount,
            ethAmount * 95 / 100,
            usdcAmount * 95 / 100
        );

        vm.stopBroadcast();

        console.log("Initial liquidity added to ETH/USDC pool");
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
        address weth = vm.envAddress("WETH_ADDRESS");
        address usdc = vm.envAddress("USDC_ADDRESS");

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
            0.1 ether,
            100 * 1e6,
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
