// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "forge-std/Script.sol";
import "../contracts/core/VibeSwapCore.sol";
import "../contracts/core/CommitRevealAuction.sol";
import "../contracts/amm/VibeAMM.sol";
import "../contracts/governance/DAOTreasury.sol";
import "../contracts/messaging/CrossChainRouter.sol";
import "@openzeppelin/contracts/proxy/ERC1967/ERC1967Proxy.sol";

/**
 * @title DeployVibeSwap
 * @notice Deployment script for VibeSwap omnichain DEX
 * @dev Run with: forge script script/Deploy.s.sol --rpc-url $RPC_URL --broadcast
 */
contract DeployVibeSwap is Script {
    // Deployment addresses
    address public auction;
    address public amm;
    address public treasury;
    address public router;
    address public core;

    // Configuration
    address public owner;
    address public lzEndpoint;

    function run() external {
        uint256 deployerPrivateKey = vm.envUint("PRIVATE_KEY");
        owner = vm.addr(deployerPrivateKey);

        // Get LayerZero endpoint for the current chain
        lzEndpoint = _getLZEndpoint(block.chainid);

        console.log("Deploying VibeSwap to chain:", block.chainid);
        console.log("Owner:", owner);
        console.log("LZ Endpoint:", lzEndpoint);

        vm.startBroadcast(deployerPrivateKey);

        // 1. Deploy implementations
        CommitRevealAuction auctionImpl = new CommitRevealAuction();
        VibeAMM ammImpl = new VibeAMM();
        DAOTreasury treasuryImpl = new DAOTreasury();
        CrossChainRouter routerImpl = new CrossChainRouter();
        VibeSwapCore coreImpl = new VibeSwapCore();

        console.log("Implementations deployed");

        // 2. Deploy AMM proxy first (Treasury needs it)
        bytes memory ammInit = abi.encodeWithSelector(
            VibeAMM.initialize.selector,
            owner,
            address(0x1) // Placeholder, will update
        );
        ERC1967Proxy ammProxy = new ERC1967Proxy(address(ammImpl), ammInit);
        amm = address(ammProxy);
        console.log("VibeAMM:", amm);

        // 3. Deploy Treasury proxy
        bytes memory treasuryInit = abi.encodeWithSelector(
            DAOTreasury.initialize.selector,
            owner,
            amm
        );
        ERC1967Proxy treasuryProxy = new ERC1967Proxy(address(treasuryImpl), treasuryInit);
        treasury = address(treasuryProxy);
        console.log("DAOTreasury:", treasury);

        // 4. Update AMM treasury
        VibeAMM(amm).setTreasury(treasury);

        // 5. Deploy Auction proxy
        bytes memory auctionInit = abi.encodeWithSelector(
            CommitRevealAuction.initialize.selector,
            owner,
            treasury
        );
        ERC1967Proxy auctionProxy = new ERC1967Proxy(address(auctionImpl), auctionInit);
        auction = address(auctionProxy);
        console.log("CommitRevealAuction:", auction);

        // 6. Deploy Router proxy
        bytes memory routerInit = abi.encodeWithSelector(
            CrossChainRouter.initialize.selector,
            owner,
            lzEndpoint,
            auction
        );
        ERC1967Proxy routerProxy = new ERC1967Proxy(address(routerImpl), routerInit);
        router = address(routerProxy);
        console.log("CrossChainRouter:", router);

        // 7. Deploy Core proxy
        bytes memory coreInit = abi.encodeWithSelector(
            VibeSwapCore.initialize.selector,
            owner,
            auction,
            amm,
            treasury,
            router
        );
        ERC1967Proxy coreProxy = new ERC1967Proxy(address(coreImpl), coreInit);
        core = address(coreProxy);
        console.log("VibeSwapCore:", core);

        // 8. Configure authorizations
        CommitRevealAuction(payable(auction)).setAuthorizedSettler(core, true);
        CommitRevealAuction(payable(auction)).setAuthorizedSettler(router, true);
        VibeAMM(amm).setAuthorizedExecutor(core, true);
        DAOTreasury(payable(treasury)).setAuthorizedFeeSender(amm, true);
        DAOTreasury(payable(treasury)).setAuthorizedFeeSender(core, true);
        CrossChainRouter(payable(router)).setAuthorized(core, true);

        console.log("Authorizations configured");

        // 9. Configure security settings
        _configureSecuritySettings();
        console.log("Security settings configured");

        vm.stopBroadcast();

        // Output deployment summary
        console.log("\n=== Deployment Summary ===");
        console.log("Chain ID:", block.chainid);
        console.log("CommitRevealAuction:", auction);
        console.log("VibeAMM:", amm);
        console.log("DAOTreasury:", treasury);
        console.log("CrossChainRouter:", router);
        console.log("VibeSwapCore:", core);
        console.log("========================\n");
    }

    function _configureSecuritySettings() internal {
        // Configure VibeSwapCore security
        VibeSwapCore(payable(core)).setRequireEOA(true); // Flash loan protection
        VibeSwapCore(payable(core)).setMaxSwapPerHour(1_000_000 * 1e18); // 1M token limit per hour
        VibeSwapCore(payable(core)).setCommitCooldown(1); // 1 second between commits

        // Configure AMM security (guardian can pause)
        VibeAMM(amm).setGuardian(owner, true);

        // Enable TWAP validation and flash loan protection on AMM
        VibeAMM(amm).setFlashLoanProtection(true);
        VibeAMM(amm).setTWAPValidation(true);

        console.log("Security: Flash loan protection enabled");
        console.log("Security: TWAP validation enabled");
        console.log("Security: Rate limiting configured");
    }

    function _getLZEndpoint(uint256 chainId) internal pure returns (address) {
        // LayerZero V2 Endpoints
        if (chainId == 1) return 0x1a44076050125825900e736c501f859c50fE728c; // Ethereum
        if (chainId == 42161) return 0x1a44076050125825900e736c501f859c50fE728c; // Arbitrum
        if (chainId == 10) return 0x1a44076050125825900e736c501f859c50fE728c; // Optimism
        if (chainId == 137) return 0x1a44076050125825900e736c501f859c50fE728c; // Polygon
        if (chainId == 8453) return 0x1a44076050125825900e736c501f859c50fE728c; // Base
        if (chainId == 43114) return 0x1a44076050125825900e736c501f859c50fE728c; // Avalanche

        // Testnets
        if (chainId == 11155111) return 0x6EDCE65403992e310A62460808c4b910D972f10f; // Sepolia
        if (chainId == 421614) return 0x6EDCE65403992e310A62460808c4b910D972f10f; // Arbitrum Sepolia

        revert("Unsupported chain");
    }
}

/**
 * @title DeployTestTokens
 * @notice Deploy test tokens for development/testing
 */
contract DeployTestTokens is Script {
    function run() external {
        uint256 deployerPrivateKey = vm.envUint("PRIVATE_KEY");

        vm.startBroadcast(deployerPrivateKey);

        // Deploy mock tokens
        MockToken weth = new MockToken("Wrapped Ether", "WETH", 18);
        MockToken usdc = new MockToken("USD Coin", "USDC", 6);
        MockToken wbtc = new MockToken("Wrapped Bitcoin", "WBTC", 8);

        console.log("WETH:", address(weth));
        console.log("USDC:", address(usdc));
        console.log("WBTC:", address(wbtc));

        // Mint initial supply to deployer
        address deployer = vm.addr(deployerPrivateKey);
        weth.mint(deployer, 1000 ether);
        usdc.mint(deployer, 1000000e6);
        wbtc.mint(deployer, 100e8);

        vm.stopBroadcast();
    }
}

contract MockToken {
    string public name;
    string public symbol;
    uint8 public decimals;
    uint256 public totalSupply;
    mapping(address => uint256) public balanceOf;
    mapping(address => mapping(address => uint256)) public allowance;

    event Transfer(address indexed from, address indexed to, uint256 value);
    event Approval(address indexed owner, address indexed spender, uint256 value);

    constructor(string memory _name, string memory _symbol, uint8 _decimals) {
        name = _name;
        symbol = _symbol;
        decimals = _decimals;
    }

    function mint(address to, uint256 amount) external {
        balanceOf[to] += amount;
        totalSupply += amount;
        emit Transfer(address(0), to, amount);
    }

    function approve(address spender, uint256 amount) external returns (bool) {
        allowance[msg.sender][spender] = amount;
        emit Approval(msg.sender, spender, amount);
        return true;
    }

    function transfer(address to, uint256 amount) external returns (bool) {
        balanceOf[msg.sender] -= amount;
        balanceOf[to] += amount;
        emit Transfer(msg.sender, to, amount);
        return true;
    }

    function transferFrom(address from, address to, uint256 amount) external returns (bool) {
        allowance[from][msg.sender] -= amount;
        balanceOf[from] -= amount;
        balanceOf[to] += amount;
        emit Transfer(from, to, amount);
        return true;
    }
}
