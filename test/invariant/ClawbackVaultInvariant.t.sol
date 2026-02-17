// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "forge-std/Test.sol";
import "forge-std/StdInvariant.sol";
import "../../contracts/compliance/ClawbackVault.sol";
import "@openzeppelin/contracts/proxy/ERC1967/ERC1967Proxy.sol";
import "@openzeppelin/contracts/token/ERC20/ERC20.sol";

// ============ Mocks ============

contract MockCVIToken is ERC20 {
    constructor() ERC20("Mock", "MCK") {}
    function mint(address to, uint256 amount) external { _mint(to, amount); }
}

// ============ Handler ============

contract CVHandler is Test {
    ClawbackVault public vault;
    MockCVIToken public token;
    address public registry;

    // Ghost variables
    uint256 public ghost_totalEscrowed;
    uint256 public ghost_totalReleased;
    uint256 public ghost_escrowCount;
    bytes32[] public ghost_escrowIds;
    mapping(bytes32 => bool) public ghost_released;

    constructor(ClawbackVault _vault, MockCVIToken _token, address _registry) {
        vault = _vault;
        token = _token;
        registry = _registry;
    }

    /// @notice Escrow funds with random amounts
    function escrowFunds(uint256 amount, uint256 ownerSeed) external {
        amount = bound(amount, 1, 1e24);
        address originalOwner = address(uint160(bound(ownerSeed, 1, 1000)));

        vm.prank(registry);
        bytes32 eid = vault.escrowFunds(
            bytes32(uint256(ghost_escrowCount + 1)),
            originalOwner,
            address(token),
            amount
        );

        ghost_totalEscrowed += amount;
        ghost_escrowCount++;
        ghost_escrowIds.push(eid);
    }

    /// @notice Release a random existing escrow to a random recipient
    function releaseRandom(uint256 indexSeed, uint256 recipientSeed) external {
        if (ghost_escrowIds.length == 0) return;

        uint256 idx = indexSeed % ghost_escrowIds.length;
        bytes32 eid = ghost_escrowIds[idx];
        if (ghost_released[eid]) return;

        address recipient = address(uint160(bound(recipientSeed, 1001, 2000)));

        vm.prank(registry);
        vault.releaseTo(eid, recipient);

        ClawbackVault.EscrowRecord memory record = vault.getEscrow(eid);
        ghost_totalReleased += record.amount;
        ghost_totalEscrowed -= record.amount;
        ghost_released[eid] = true;
    }

    /// @notice Return a random existing escrow to its original owner
    function returnRandom(uint256 indexSeed) external {
        if (ghost_escrowIds.length == 0) return;

        uint256 idx = indexSeed % ghost_escrowIds.length;
        bytes32 eid = ghost_escrowIds[idx];
        if (ghost_released[eid]) return;

        vm.prank(registry);
        vault.returnToOwner(eid);

        ClawbackVault.EscrowRecord memory record = vault.getEscrow(eid);
        ghost_totalReleased += record.amount;
        ghost_totalEscrowed -= record.amount;
        ghost_released[eid] = true;
    }

    function getEscrowCount() external view returns (uint256) {
        return ghost_escrowIds.length;
    }
}

// ============ Invariant Test ============

contract ClawbackVaultInvariantTest is StdInvariant, Test {
    ClawbackVault public vault;
    MockCVIToken public token;
    CVHandler public handler;
    address public registry;

    function setUp() public {
        registry = makeAddr("registry");
        token = new MockCVIToken();

        ClawbackVault impl = new ClawbackVault();
        bytes memory initData = abi.encodeWithSelector(ClawbackVault.initialize.selector, address(this), registry);
        ERC1967Proxy proxy = new ERC1967Proxy(address(impl), initData);
        vault = ClawbackVault(address(proxy));

        token.mint(registry, type(uint128).max);
        vm.prank(registry);
        token.approve(address(vault), type(uint256).max);

        handler = new CVHandler(vault, token, registry);
        targetContract(address(handler));
    }

    /// @notice Vault token balance always equals totalEscrowed
    function invariant_balanceMatchesTotalEscrowed() public view {
        assertEq(
            token.balanceOf(address(vault)),
            vault.totalEscrowed(address(token)),
            "Vault balance must match totalEscrowed"
        );
    }

    /// @notice Ghost totalEscrowed matches on-chain totalEscrowed
    function invariant_ghostMatchesOnChain() public view {
        assertEq(
            handler.ghost_totalEscrowed(),
            vault.totalEscrowed(address(token)),
            "Ghost must match on-chain totalEscrowed"
        );
    }

    /// @notice Escrow count matches ghost count
    function invariant_escrowCountMatches() public view {
        assertEq(
            vault.escrowCount(),
            handler.ghost_escrowCount(),
            "Escrow count mismatch"
        );
    }

    /// @notice Released escrows are always marked as released
    function invariant_releasedMarkedCorrectly() public view {
        uint256 count = handler.getEscrowCount();
        for (uint256 i = 0; i < count && i < 50; i++) {
            bytes32 eid = handler.ghost_escrowIds(i);
            ClawbackVault.EscrowRecord memory record = vault.getEscrow(eid);

            if (handler.ghost_released(eid)) {
                assertTrue(record.released, "Ghost-released must be on-chain released");
                assertTrue(record.releasedTo != address(0), "Released must have recipient");
            }
        }
    }

    /// @notice Total escrowed + total released equals total deposited
    function invariant_conservationOfFunds() public view {
        uint256 totalDeposited = handler.ghost_totalEscrowed() + handler.ghost_totalReleased();
        // All funds ever escrowed must be either still escrowed or released
        // The vault balance + released amounts should be consistent
        assertEq(
            token.balanceOf(address(vault)) + handler.ghost_totalReleased(),
            totalDeposited,
            "Conservation of funds violated"
        );
    }
}
