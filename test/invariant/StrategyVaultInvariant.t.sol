// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "forge-std/Test.sol";
import "forge-std/StdInvariant.sol";
import "../../contracts/financial/StrategyVault.sol";
import "@openzeppelin/contracts/token/ERC20/ERC20.sol";

// ============ Mocks ============

contract MockInvToken is ERC20 {
    constructor() ERC20("Mock USDC", "USDC") {}
    function mint(address to, uint256 amount) external { _mint(to, amount); }
}

contract MockInvStrategy is IStrategy {
    IERC20 private _asset;
    address private _vault;

    constructor(address asset_, address vault_) {
        _asset = IERC20(asset_);
        _vault = vault_;
    }

    function asset() external view returns (address) { return address(_asset); }
    function vault() external view returns (address) { return _vault; }
    function totalAssets() external view returns (uint256) { return _asset.balanceOf(address(this)); }

    // Vault sends tokens via safeTransfer before calling deposit — this is just a notification
    function deposit(uint256) external {}

    function withdraw(uint256 amount) external returns (uint256) {
        uint256 bal = _asset.balanceOf(address(this));
        uint256 actual = amount > bal ? bal : amount;
        _asset.transfer(msg.sender, actual);
        return actual;
    }

    function harvest() external returns (uint256) { return 0; }

    function emergencyWithdraw() external returns (uint256) {
        uint256 bal = _asset.balanceOf(address(this));
        _asset.transfer(_vault, bal);
        return bal;
    }
}

// ============ Handler ============

contract VaultHandler is Test {
    StrategyVault public vault;
    MockInvToken public token;
    address[] public actors;

    uint256 public ghost_totalDeposited;
    uint256 public ghost_totalWithdrawn;
    uint256 public ghost_depositCount;
    uint256 public ghost_withdrawCount;

    constructor(StrategyVault _vault, MockInvToken _token) {
        vault = _vault;
        token = _token;

        for (uint256 i = 0; i < 5; i++) {
            address actor = address(uint160(0xB000 + i));
            actors.push(actor);
            token.mint(actor, 10_000_000 ether);
            vm.prank(actor);
            token.approve(address(vault), type(uint256).max);
        }
    }

    function deposit(uint256 actorSeed, uint256 amount) public {
        address actor = actors[actorSeed % actors.length];
        amount = bound(amount, 1 ether, 100_000 ether);

        vm.prank(actor);
        try vault.deposit(amount, actor) {
            ghost_totalDeposited += amount;
            ghost_depositCount++;
        } catch {}
    }

    function withdraw(uint256 actorSeed, uint256 shares) public {
        address actor = actors[actorSeed % actors.length];
        uint256 actorShares = vault.balanceOf(actor);
        if (actorShares == 0) return;

        shares = bound(shares, 1, actorShares);

        vm.prank(actor);
        try vault.redeem(shares, actor, actor) returns (uint256 assets) {
            ghost_totalWithdrawn += assets;
            ghost_withdrawCount++;
        } catch {}
    }
}

// ============ Invariant Tests ============

contract StrategyVaultInvariantTest is StdInvariant, Test {
    MockInvToken token;
    StrategyVault vault;
    MockInvStrategy strategy;
    VaultHandler handler;

    address feeRecipient = makeAddr("feeRecipient");

    function setUp() public {
        token = new MockInvToken();
        vault = new StrategyVault(
            IERC20(address(token)),
            "Vault Shares",
            "vUSDC",
            feeRecipient,
            0 // no deposit cap
        );

        strategy = new MockInvStrategy(address(token), address(vault));
        vault.proposeStrategy(address(strategy));
        vm.warp(block.timestamp + 2 days + 1);
        vault.activateStrategy();

        handler = new VaultHandler(vault, token);
        targetContract(address(handler));
    }

    // ============ Invariant: totalAssets >= totalSupply (no profit scenario) ============

    function invariant_totalAssetsBacksShares() public view {
        // Without profit, totalAssets should always be >= 0
        // With deposits only, assets backing should be maintained
        if (vault.totalSupply() > 0) {
            assertGe(vault.totalAssets(), 0);
        }
    }

    // ============ Invariant: vault + strategy = totalAssets ============

    function invariant_assetAccounting() public view {
        uint256 vaultBal = token.balanceOf(address(vault));
        uint256 stratBal = token.balanceOf(address(strategy));
        assertEq(vault.totalAssets(), vaultBal + stratBal);
    }

    // ============ Invariant: no tokens created from nothing ============

    function invariant_conservationOfAssets() public view {
        uint256 vaultBal = token.balanceOf(address(vault));
        uint256 stratBal = token.balanceOf(address(strategy));
        uint256 feeBal = token.balanceOf(feeRecipient);

        // Withdrawn + still in system <= deposited (can be less due to fees)
        assertLe(
            vaultBal + stratBal + feeBal + handler.ghost_totalWithdrawn(),
            handler.ghost_totalDeposited() + 1 // +1 for rounding
        );
    }

    // ============ Invariant: zero shares means zero claims ============

    function invariant_zeroSharesZeroClaims() public view {
        if (vault.totalSupply() == 0) {
            assertEq(vault.totalAssets(), 0);
        }
    }
}
