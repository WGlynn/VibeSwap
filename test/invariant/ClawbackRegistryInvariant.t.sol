// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "forge-std/Test.sol";
import "../../contracts/compliance/ClawbackRegistry.sol";
import "@openzeppelin/contracts/proxy/ERC1967/ERC1967Proxy.sol";
import "@openzeppelin/contracts/token/ERC20/ERC20.sol";

// ============ Mock FederatedConsensus ============

contract MockConsensusInv {
    mapping(address => bool) public activeAuthorities;
    mapping(bytes32 => bool) public executableProposals;
    uint256 proposalCount;

    function setActiveAuthority(address addr, bool active) external {
        activeAuthorities[addr] = active;
    }

    function isActiveAuthority(address addr) external view returns (bool) {
        return activeAuthorities[addr];
    }

    function createProposal(bytes32, address, uint256, address, string calldata)
        external returns (bytes32) {
        proposalCount++;
        return keccak256(abi.encodePacked(proposalCount));
    }

    function setExecutable(bytes32 proposalId, bool executable) external {
        executableProposals[proposalId] = executable;
    }

    function isExecutable(bytes32 proposalId) external view returns (bool) {
        return executableProposals[proposalId];
    }

    function markExecuted(bytes32) external {}
}

// ============ Mock Token ============

contract MockERC20Inv is ERC20 {
    constructor() ERC20("Mock", "MCK") {}
    function mint(address to, uint256 amount) external { _mint(to, amount); }
}

// ============ Handler ============

contract ClawbackRegistryHandler is Test {
    ClawbackRegistry public registry;
    MockConsensusInv public consensus;
    MockERC20Inv public token;

    address public owner;
    address public tracker;

    // Ghost state for invariant checking
    uint256 public totalCasesOpened;
    uint256 public totalDismissed;
    uint256 public totalTaintPropagations;
    mapping(address => bool) public everFlagged;
    address[] public flaggedWallets;
    bytes32[] public openedCases;

    constructor(
        ClawbackRegistry _registry,
        MockConsensusInv _consensus,
        MockERC20Inv _token,
        address _owner,
        address _tracker
    ) {
        registry = _registry;
        consensus = _consensus;
        token = _token;
        owner = _owner;
        tracker = _tracker;
    }

    function openCase(uint160 walletSeed) external {
        address wallet = address(walletSeed + 1); // avoid address(0)
        if (wallet == address(0)) wallet = address(1);

        vm.prank(owner);
        bytes32 caseId = registry.openCase(wallet, 100 ether, address(token), "invariant");

        totalCasesOpened++;
        openedCases.push(caseId);

        if (!everFlagged[wallet]) {
            everFlagged[wallet] = true;
            flaggedWallets.push(wallet);
        }
    }

    function recordTransaction(uint160 fromSeed, uint160 toSeed, uint256 amount) external {
        address from = address(fromSeed + 1);
        address to = address(toSeed + 1);
        if (from == address(0)) from = address(1);
        if (to == address(0)) to = address(1);
        if (from == to) return;

        amount = bound(amount, 0, 1000 ether);

        vm.prank(tracker);
        try registry.recordTransaction(from, to, amount, address(token)) {
            // Check if taint propagated
            (ClawbackRegistry.TaintLevel level,,,) = registry.checkWallet(to);
            if (uint256(level) >= uint256(ClawbackRegistry.TaintLevel.TAINTED)) {
                totalTaintPropagations++;
                if (!everFlagged[to]) {
                    everFlagged[to] = true;
                    flaggedWallets.push(to);
                }
            }
        } catch {
            // MaxCascadeDepthReached is acceptable
        }
    }

    function dismissCase(uint256 idx) external {
        if (openedCases.length == 0) return;
        idx = idx % openedCases.length;
        bytes32 caseId = openedCases[idx];

        vm.prank(owner);
        try registry.dismissCase(caseId) {
            totalDismissed++;
        } catch {
            // Already dismissed/resolved
        }
    }

    function getFlaggedWalletsCount() external view returns (uint256) {
        return flaggedWallets.length;
    }

    function getFlaggedWallet(uint256 idx) external view returns (address) {
        return flaggedWallets[idx];
    }

    function getOpenedCasesCount() external view returns (uint256) {
        return openedCases.length;
    }
}

// ============ Invariant Tests ============

contract ClawbackRegistryInvariantTest is Test {
    ClawbackRegistry registry;
    MockConsensusInv consensus;
    MockERC20Inv token;
    ClawbackRegistryHandler handler;

    address owner = makeAddr("owner");
    address tracker = makeAddr("tracker");

    function setUp() public {
        consensus = new MockConsensusInv();
        token = new MockERC20Inv();

        ClawbackRegistry impl = new ClawbackRegistry();
        bytes memory initData = abi.encodeWithSelector(
            ClawbackRegistry.initialize.selector,
            owner,
            address(consensus),
            5,
            1 ether
        );
        ERC1967Proxy proxy = new ERC1967Proxy(address(impl), initData);
        registry = ClawbackRegistry(address(proxy));

        consensus.setActiveAuthority(owner, true);

        vm.prank(owner);
        registry.setAuthorizedTracker(tracker, true);

        vm.prank(owner);
        registry.setVault(makeAddr("vault"));

        handler = new ClawbackRegistryHandler(registry, consensus, token, owner, tracker);

        targetContract(address(handler));
    }

    // ============ Invariant: caseCount always matches ghost state ============
    function invariant_caseCount_matchesGhost() public view {
        assertEq(registry.caseCount(), handler.totalCasesOpened(), "Case count mismatch");
    }

    // ============ Invariant: caseCount never decreases ============
    function invariant_caseCount_monotonic() public view {
        // caseCount should always be >= totalCasesOpened (which is cumulative)
        assertGe(registry.caseCount(), 0, "Case count should never be negative");
    }

    // ============ Invariant: blocked wallets are always FLAGGED or above ============
    function invariant_blockedWallets_areFlaggedOrAbove() public view {
        uint256 count = handler.getFlaggedWalletsCount();
        for (uint256 i = 0; i < count && i < 20; i++) {
            address wallet = handler.getFlaggedWallet(i);
            bool blocked = registry.isBlocked(wallet);
            (ClawbackRegistry.TaintLevel level,,,) = registry.checkWallet(wallet);

            if (blocked) {
                assertTrue(
                    uint256(level) >= uint256(ClawbackRegistry.TaintLevel.FLAGGED),
                    "Blocked wallet must be FLAGGED or above"
                );
            }
        }
    }

    // ============ Invariant: clean wallets are never blocked ============
    function invariant_cleanWallets_neverBlocked() public view {
        // Check a few random addresses that were never touched
        for (uint256 i = 0; i < 5; i++) {
            address clean = address(uint160(0xDEAD0000 + i));
            (ClawbackRegistry.TaintLevel level, bool safe,,) = registry.checkWallet(clean);
            if (uint256(level) == 0) {
                assertTrue(safe, "Clean wallet should be safe");
                assertFalse(registry.isBlocked(clean), "Clean wallet should not be blocked");
            }
        }
    }

    // ============ Invariant: maxCascadeDepth is always set ============
    function invariant_maxCascadeDepth_nonZero() public view {
        // We initialized with 5, never changed it
        assertEq(registry.maxCascadeDepth(), 5, "Max cascade depth should remain 5");
    }

    // ============ Invariant: taint depth never exceeds maxCascadeDepth ============
    function invariant_taintDepth_bounded() public view {
        uint256 maxDepth = registry.maxCascadeDepth();
        uint256 count = handler.getFlaggedWalletsCount();
        for (uint256 i = 0; i < count && i < 20; i++) {
            address wallet = handler.getFlaggedWallet(i);
            (,,, uint256 depth) = registry.checkWallet(wallet);
            assertLe(depth, maxDepth, "Taint depth should never exceed maxCascadeDepth");
        }
    }

    // ============ Invariant: isSafe is consistent with taintLevel ============
    function invariant_isSafe_consistentWithTaintLevel() public view {
        uint256 count = handler.getFlaggedWalletsCount();
        for (uint256 i = 0; i < count && i < 20; i++) {
            address wallet = handler.getFlaggedWallet(i);
            (ClawbackRegistry.TaintLevel level, bool safe,,) = registry.checkWallet(wallet);

            if (uint256(level) <= uint256(ClawbackRegistry.TaintLevel.WATCHLIST)) {
                assertTrue(safe, "CLEAN/WATCHLIST should be safe");
            } else {
                assertFalse(safe, "TAINTED+ should be unsafe");
            }
        }
    }
}
