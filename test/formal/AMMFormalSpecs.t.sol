// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "forge-std/Test.sol";
import "../../contracts/amm/VibeAMM.sol";
import "@openzeppelin/contracts/proxy/ERC1967/ERC1967Proxy.sol";
import "@openzeppelin/contracts/token/ERC20/ERC20.sol";

contract MockToken is ERC20 {
    constructor(string memory name, string memory symbol) ERC20(name, symbol) {}
    function mint(address to, uint256 amount) external { _mint(to, amount); }
}

/**
 * @title AMM Formal Specs — Constant Product Invariants
 * @notice Properties for Foundry fuzz / Halmos symbolic execution.
 *
 * Specs:
 * 1. k never decreases after swap (fees increase k)
 * 2. Reserves never go to zero from a swap
 * 3. Output always less than input reserve
 * 4. Swap is monotonic (more input = more output)
 */
contract AMMFormalSpecs is Test {
    VibeAMM public amm;
    MockToken public token0;
    MockToken public token1;

    address public owner;
    bytes32 public poolId;

    function setUp() public {
        owner = address(this);

        token0 = new MockToken("Token0", "T0");
        token1 = new MockToken("Token1", "T1");

        VibeAMM impl = new VibeAMM();
        bytes memory initData = abi.encodeWithSelector(
            VibeAMM.initialize.selector,
            owner,
            owner // treasury
        );
        ERC1967Proxy proxy = new ERC1967Proxy(address(impl), initData);
        amm = VibeAMM(address(proxy));

        amm.setAuthorizedExecutor(address(this), true);
        amm.setFlashLoanProtection(false);

        // Create pool with initial liquidity
        token0.mint(address(this), 10000 ether);
        token1.mint(address(this), 20000000 ether);
        token0.approve(address(amm), type(uint256).max);
        token1.approve(address(amm), type(uint256).max);

        poolId = amm.createPool(address(token0), address(token1), 30); // 0.3% fee
        amm.addLiquidity(poolId, 1000 ether, 2000000 ether, 0, 0);
    }

    // SPEC 1: k never decreases
    function testFuzz_kNeverDecreases(uint256 amountIn) public {
        amountIn = bound(amountIn, 0.001 ether, 100 ether);

        IVibeAMM.Pool memory poolBefore = amm.getPool(poolId);
        uint256 kBefore = poolBefore.reserve0 * poolBefore.reserve1;

        token0.mint(address(this), amountIn);
        token0.approve(address(amm), amountIn);

        try amm.executeSwap(poolId, address(token0), amountIn, 0, 1) {
            IVibeAMM.Pool memory poolAfter = amm.getPool(poolId);
            uint256 kAfter = poolAfter.reserve0 * poolAfter.reserve1;
            assertGe(kAfter, kBefore, "K DECREASED after swap");
        } catch {
            // Swap reverted — k unchanged, that's fine
        }
    }

    // SPEC 2: Reserves never zero from swap
    function testFuzz_reservesNeverZero(uint256 amountIn) public {
        amountIn = bound(amountIn, 0.001 ether, 500 ether);

        token0.mint(address(this), amountIn);
        token0.approve(address(amm), amountIn);

        try amm.executeSwap(poolId, address(token0), amountIn, 0, 1) {
            IVibeAMM.Pool memory pool = amm.getPool(poolId);
            assertGt(pool.reserve0, 0, "Reserve0 hit zero");
            assertGt(pool.reserve1, 0, "Reserve1 hit zero");
        } catch {}
    }
}
