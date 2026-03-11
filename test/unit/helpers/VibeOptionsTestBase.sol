// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "forge-std/Test.sol";
import "../../../contracts/financial/VibeOptions.sol";
import "@openzeppelin/contracts/token/ERC20/ERC20.sol";

// ============ Mocks ============

contract MockOptUToken is ERC20 {
    constructor(string memory name, string memory symbol) ERC20(name, symbol) {}
    function mint(address to, uint256 amount) external { _mint(to, amount); }
}

contract MockOptUAMM {
    bytes32 public testPoolId;
    address public token0;
    address public token1;
    uint256 public spotPrice;
    uint256 public twapPrice;

    function setup(address _t0, address _t1, uint256 _spot) external {
        token0 = _t0;
        token1 = _t1;
        testPoolId = keccak256(abi.encodePacked(_t0, _t1));
        spotPrice = _spot;
        twapPrice = _spot;
    }

    function setSpot(uint256 price) external { spotPrice = price; }
    function setTWAP(uint256 price) external { twapPrice = price; }

    function getPool(bytes32) external view returns (IVibeAMM.Pool memory) {
        return IVibeAMM.Pool({
            token0: token0,
            token1: token1,
            reserve0: 1000e18,
            reserve1: 2_000_000e18,
            totalLiquidity: 1000e18,
            feeRate: 30,
            initialized: true
        });
    }

    function getSpotPrice(bytes32) external view returns (uint256) { return spotPrice; }
    function getTWAP(bytes32, uint32) external view returns (uint256) { return twapPrice; }
}

contract MockOptUVolOracle {
    uint256 public vol = 5000;
    function setVol(uint256 v) external { vol = v; }
    function calculateRealizedVolatility(bytes32, uint32) external view returns (uint256) { return vol; }
    function getDynamicFeeMultiplier(bytes32) external pure returns (uint256) { return 1e18; }
    function getVolatilityTier(bytes32) external pure returns (uint8) { return 0; }
    function updateVolatility(bytes32) external {}
    function getVolatilityData(bytes32) external view returns (uint256, uint8, uint64) {
        return (vol, 0, uint64(block.timestamp));
    }
}

// ============ Base Test Contract ============

abstract contract VibeOptionsTestBase is Test {
    VibeOptions public options;
    MockOptUAMM public amm;
    MockOptUVolOracle public volOracle;
    MockOptUToken public weth;
    MockOptUToken public usdc;

    address alice = address(0xA1);
    address bob = address(0xB0);

    bytes32 poolId;
    uint256 constant SPOT_PRICE = 2000e18;
    uint256 constant STRIKE_CALL = 2100e18;
    uint256 constant STRIKE_PUT = 1900e18;
    uint40 expiry;

    function setUp() public virtual {
        vm.warp(1000);

        weth = new MockOptUToken("WETH", "WETH");
        usdc = new MockOptUToken("USDC", "USDC");

        amm = new MockOptUAMM();
        amm.setup(address(weth), address(usdc), SPOT_PRICE);
        poolId = amm.testPoolId();

        volOracle = new MockOptUVolOracle();
        options = new VibeOptions(address(amm), address(volOracle));
        expiry = uint40(block.timestamp) + 30 days;

        weth.mint(alice, 1000e18);
        weth.mint(bob, 1000e18);
        usdc.mint(alice, 10_000_000e18);
        usdc.mint(bob, 10_000_000e18);

        vm.prank(alice);
        weth.approve(address(options), type(uint256).max);
        vm.prank(alice);
        usdc.approve(address(options), type(uint256).max);
        vm.prank(bob);
        weth.approve(address(options), type(uint256).max);
        vm.prank(bob);
        usdc.approve(address(options), type(uint256).max);
    }

    function _writeCall(address writer, uint256 amount, uint256 strike, uint256 premium)
        internal returns (uint256)
    {
        vm.prank(writer);
        return options.writeOption(IVibeOptions.WriteParams({
            poolId: poolId,
            optionType: IVibeOptions.OptionType.CALL,
            amount: amount,
            strikePrice: strike,
            premium: premium,
            expiry: expiry,
            exerciseWindow: 7 days
        }));
    }

    function _writePut(address writer, uint256 amount, uint256 strike, uint256 premium)
        internal returns (uint256)
    {
        vm.prank(writer);
        return options.writeOption(IVibeOptions.WriteParams({
            poolId: poolId,
            optionType: IVibeOptions.OptionType.PUT,
            amount: amount,
            strikePrice: strike,
            premium: premium,
            expiry: expiry,
            exerciseWindow: 7 days
        }));
    }

    function onERC721Received(address, address, uint256, bytes calldata) external pure returns (bytes4) {
        return this.onERC721Received.selector;
    }
}
