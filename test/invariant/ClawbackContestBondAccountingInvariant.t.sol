// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "forge-std/Test.sol";
import "forge-std/StdInvariant.sol";
import "../../contracts/compliance/ClawbackRegistry.sol";
import "@openzeppelin/contracts/proxy/ERC1967/ERC1967Proxy.sol";
import "@openzeppelin/contracts/token/ERC20/ERC20.sol";

// ============ Mock FederatedConsensus ============

contract MockConsensus {
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

// ============ Mock ERC20 ============

contract MockBondToken is ERC20 {
    constructor() ERC20("Bond", "BND") {}
    function mint(address to, uint256 amount) external { _mint(to, amount); }
}

// ============ Handler ============
//
// Drives the full contest lifecycle and tracks all bond movements.
//
// Bond accounting closes at every snapshot:
//
//   contestRewardPool
//     + sum(bonds returned to contestants on uphold)
//     + sum(bonds still locked in ACTIVE contests)
//   = sum(bonds deposited)
//     + sum(governance funding deposits)
//     - sum(success rewards paid out)
//
// Equivalently: token balance of registry minus active-bond escrow equals
// contestRewardPool. We also assert pool monotonicity in the dismiss/expire
// path (forfeits credit the pool) and refund correctness in the uphold path.
contract ClawbackContestHandler is Test {
    ClawbackRegistry public registry;
    MockBondToken public token;
    MockConsensus public consensus;
    address public owner;
    address public authority;

    address[] public contestants;
    address[] public badActors;

    bytes32[] public openCaseIds;
    bytes32[] public allCaseIds;
    mapping(bytes32 => bool) public hasContest;

    // Ghost ledger
    uint256 public ghost_bondsDeposited;
    uint256 public ghost_bondsReturnedOnUphold;
    uint256 public ghost_rewardsPaidOnUphold;
    uint256 public ghost_bondsForfeitedToPool;
    uint256 public ghost_governanceFunded;

    constructor(
        ClawbackRegistry _registry,
        MockBondToken _token,
        MockConsensus _consensus,
        address _owner,
        address _authority,
        address[] memory _contestants,
        address[] memory _badActors
    ) {
        registry = _registry;
        token = _token;
        consensus = _consensus;
        owner = _owner;
        authority = _authority;
        contestants = _contestants;
        badActors = _badActors;
    }

    function _pickContestant(uint256 seed) internal view returns (address) {
        return contestants[seed % contestants.length];
    }
    function _pickBadActor(uint256 seed) internal view returns (address) {
        return badActors[seed % badActors.length];
    }

    /// @notice Open a case. Authority-gated.
    function openCase(uint256 seed) external {
        if (allCaseIds.length >= 16) return; // bound state explosion
        address actor = _pickBadActor(seed);

        vm.warp(block.timestamp + 1);
        vm.prank(authority);
        try registry.openCase(actor, 100 ether, address(token), "fuzz") returns (bytes32 cid) {
            allCaseIds.push(cid);
            openCaseIds.push(cid);
        } catch {}
    }

    /// @notice Open a contest on a case. Bond is pulled via safeTransferFrom.
    function openContest(uint256 caseSeed, uint256 contestantSeed) external {
        if (openCaseIds.length == 0) return;
        bytes32 cid = openCaseIds[caseSeed % openCaseIds.length];
        if (hasContest[cid]) return; // one contest per case at a time

        // Skip if case is no longer in OPEN/VOTING — use the bool helper.
        // (Direct cases() destructuring is brittle because reason is a string.)
        if (registry.hasActiveContest(cid)) return;

        address contestant = _pickContestant(contestantSeed);
        uint256 bond = registry.contestBondAmount();
        token.mint(contestant, bond);

        vm.prank(contestant);
        token.approve(address(registry), bond);

        vm.prank(contestant);
        try registry.openContest(cid, "ipfs://evidence") {
            hasContest[cid] = true;
            ghost_bondsDeposited += bond;
        } catch {}
    }

    /// @notice Authority upholds a contest — bond + reward returned, case dismissed.
    function upholdContest(uint256 caseSeed) external {
        if (allCaseIds.length == 0) return;
        bytes32 cid = allCaseIds[caseSeed % allCaseIds.length];

        ClawbackRegistry.CaseContest memory ct = registry.getCaseContest(cid);
        if (ct.status != ClawbackRegistry.ContestStatus.ACTIVE) return;
        if (block.timestamp > ct.deadline) return; // would revert with ContestExpiredError

        uint256 poolBefore = registry.contestRewardPool();
        uint256 reward = registry.contestSuccessReward();
        if (reward > poolBefore) reward = poolBefore;

        vm.prank(authority);
        try registry.upholdContest(cid) {
            ghost_bondsReturnedOnUphold += ct.bond;
            ghost_rewardsPaidOnUphold += reward;
        } catch {}
    }

    /// @notice Authority dismisses a contest — bond forfeited to pool.
    function dismissContest(uint256 caseSeed) external {
        if (allCaseIds.length == 0) return;
        bytes32 cid = allCaseIds[caseSeed % allCaseIds.length];

        ClawbackRegistry.CaseContest memory ct = registry.getCaseContest(cid);
        if (ct.status != ClawbackRegistry.ContestStatus.ACTIVE) return;
        if (block.timestamp > ct.deadline) return;

        vm.prank(authority);
        try registry.dismissContest(cid) {
            ghost_bondsForfeitedToPool += ct.bond;
        } catch {}
    }

    /// @notice Anyone can resolve an expired contest after the deadline passes.
    ///         Bond is forfeited to the pool.
    function resolveExpiredContest(uint256 caseSeed) external {
        if (allCaseIds.length == 0) return;
        bytes32 cid = allCaseIds[caseSeed % allCaseIds.length];

        ClawbackRegistry.CaseContest memory ct = registry.getCaseContest(cid);
        if (ct.status != ClawbackRegistry.ContestStatus.ACTIVE) return;
        if (block.timestamp <= ct.deadline) return;

        try registry.resolveExpiredContest(cid) {
            ghost_bondsForfeitedToPool += ct.bond;
        } catch {}
    }

    /// @notice Governance / donor funds the pool directly.
    function fundPool(uint256 amount) external {
        amount = bound(amount, 0.01 ether, 10 ether);
        token.mint(address(this), amount);
        token.approve(address(registry), amount);

        try registry.fundContestRewardPool(amount) {
            ghost_governanceFunded += amount;
        } catch {}
    }

    /// @notice Advance time so contests can expire.
    function warpTime(uint256 dt) external {
        dt = bound(dt, 0, 4 hours);
        vm.warp(block.timestamp + dt);
    }

    function caseCount() external view returns (uint256) { return allCaseIds.length; }
    function caseAt(uint256 i) external view returns (bytes32) { return allCaseIds[i]; }
}

// ============ Invariant Test ============

contract ClawbackContestBondAccountingInvariant is StdInvariant, Test {
    ClawbackRegistry public registry;
    MockConsensus public consensus;
    MockBondToken public token;
    ClawbackContestHandler public handler;

    address public owner = makeAddr("owner");
    address public authority = makeAddr("authority");

    address[] public contestants;
    address[] public badActors;

    uint256 constant CONTEST_BOND = 1 ether;
    uint64 constant CONTEST_WINDOW = 2 hours;
    uint256 constant SUCCESS_REWARD = 0.5 ether;

    function setUp() public {
        consensus = new MockConsensus();
        token = new MockBondToken();

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

        consensus.setActiveAuthority(authority, true);

        vm.prank(owner);
        registry.setVault(makeAddr("vault"));

        vm.prank(owner);
        registry.initializeContestV1(
            address(token),
            CONTEST_BOND,
            CONTEST_WINDOW,
            SUCCESS_REWARD
        );

        // Pre-fund the pool so success rewards have something to draw from.
        token.mint(address(this), 5 ether);
        token.approve(address(registry), 5 ether);
        registry.fundContestRewardPool(5 ether);

        for (uint256 i = 0; i < 5; i++) {
            contestants.push(address(uint160(0x4700 + i)));
            badActors.push(address(uint160(0x4800 + i)));
        }

        handler = new ClawbackContestHandler(
            registry,
            token,
            consensus,
            owner,
            authority,
            contestants,
            badActors
        );

        targetContract(address(handler));

        bytes4[] memory selectors = new bytes4[](7);
        selectors[0] = handler.openCase.selector;
        selectors[1] = handler.openContest.selector;
        selectors[2] = handler.upholdContest.selector;
        selectors[3] = handler.dismissContest.selector;
        selectors[4] = handler.resolveExpiredContest.selector;
        selectors[5] = handler.fundPool.selector;
        selectors[6] = handler.warpTime.selector;
        targetSelector(FuzzSelector({addr: address(handler), selectors: selectors}));
    }

    /// @notice Sum of bonds locked in ACTIVE contests.
    function _activeBondEscrow() internal view returns (uint256 escrow) {
        uint256 n = handler.caseCount();
        for (uint256 i = 0; i < n; i++) {
            bytes32 cid = handler.caseAt(i);
            ClawbackRegistry.CaseContest memory ct = registry.getCaseContest(cid);
            if (ct.status == ClawbackRegistry.ContestStatus.ACTIVE) {
                escrow += ct.bond;
            }
        }
    }

    // ============ CORE INVARIANT ============

    /// @notice Token-balance closure: registry's bond-token balance equals
    ///         contestRewardPool + active-bond escrow + bonds-already-paid-out
    ///         minus reward-payouts. Refactored as: balance == pool + escrow.
    ///
    /// Justification:
    ///   - Bonds enter via openContest (escrow ↑)
    ///   - Bonds leave via uphold (escrow ↓ by bond, pool ↓ by reward, balance
    ///     ↓ by bond+reward — net pool change matches reward, escrow matches
    ///     bond)
    ///   - Bonds leave via dismiss/expire (escrow ↓ by bond, pool ↑ by bond,
    ///     balance unchanged)
    ///   - Governance funding (pool ↑ by amount, balance ↑ by amount)
    ///
    /// Therefore at all times: balance == pool + escrow.
    function invariant_balanceEqualsPoolPlusEscrow() public view {
        uint256 balance = token.balanceOf(address(registry));
        uint256 pool = registry.contestRewardPool();
        uint256 escrow = _activeBondEscrow();
        assertEq(balance, pool + escrow, "C47 bond accounting closure broken");
    }

    /// @notice Ghost-ledger closure: deposits match the structural movements.
    ///   bondsDeposited + governanceFunded
    ///     = (bondsReturnedOnUphold) + (bondsForfeitedToPool) + activeEscrow
    ///       + (rewardsPaidOnUphold) + (poolBalanceMinusForfeitsAndFunding)
    ///
    /// Simplified token-conservation form (ignoring the pre-test seed):
    ///   bondsDeposited + governanceFunded - bondsReturnedOnUphold - rewardsPaidOnUphold
    ///     == registry.balance - 5 ether (initial seed)
    function invariant_ghostLedgerMatchesBalance() public view {
        // Arrange the equation as `balance + outflow == inflow + seed`
        // to avoid underflow when outflow temporarily exceeds inflow
        // (rewards drawn from the 5 ether seed pool).
        uint256 inflow = handler.ghost_bondsDeposited() + handler.ghost_governanceFunded();
        uint256 outflow = handler.ghost_bondsReturnedOnUphold() + handler.ghost_rewardsPaidOnUphold();
        uint256 balance = token.balanceOf(address(registry));
        assertEq(
            balance + outflow,
            inflow + 5 ether, // 5 ether = test seed
            "ghost ledger drift vs registry balance"
        );
    }

    /// @notice Pool is monotone non-decreasing EXCEPT when an uphold pays out a reward.
    ///         Equivalently: pool >= governance-funded + bonds-forfeited - rewards-paid.
    function invariant_poolEqualsForfeitsPlusFundingMinusRewards() public view {
        // Re-arrange `pool = seed + funded + forfeited - rewards` to
        // `pool + rewards = seed + funded + forfeited` to avoid underflow
        // in the intermediate uint subtraction.
        uint256 lhs = registry.contestRewardPool() + handler.ghost_rewardsPaidOnUphold();
        uint256 rhs = 5 ether
            + handler.ghost_governanceFunded()
            + handler.ghost_bondsForfeitedToPool();
        assertEq(lhs, rhs, "pool drift vs ghost forfeit/funding/reward ledger");
    }

    /// @notice Reward is bounded above by pool at uphold time — never underflows.
    ///         (Implicitly checked by the closure invariant; this is a paranoia
    ///         gate that fires fast on signed-arithmetic regressions.)
    function invariant_rewardsLeqDeposits() public view {
        // Total rewards paid can never exceed total inflows.
        uint256 inflow = handler.ghost_bondsDeposited()
            + handler.ghost_governanceFunded()
            + 5 ether;
        assertGe(
            inflow,
            handler.ghost_rewardsPaidOnUphold(),
            "rewards paid exceeded total inflows"
        );
    }
}
