// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "forge-std/Test.sol";
import "forge-std/StdInvariant.sol";
import "../../contracts/governance/VibeTimelock.sol";
import "../../contracts/governance/interfaces/IVibeTimelock.sol";
import "../../contracts/oracle/IReputationOracle.sol";
import "@openzeppelin/contracts/token/ERC20/ERC20.sol";

// ============ Mocks ============

contract MockTLInvToken is ERC20 {
    constructor(string memory name_, string memory symbol_) ERC20(name_, symbol_) {}
    function mint(address to, uint256 amount) external { _mint(to, amount); }
}

contract MockTLInvOracle is IReputationOracle {
    mapping(address => uint8) public tiers;
    function setTier(address user, uint8 tier) external { tiers[user] = tier; }
    function getTrustScore(address user) external view returns (uint256) { return uint256(tiers[user]) * 2500; }
    function getTrustTier(address user) external view returns (uint8) { return tiers[user]; }
    function isEligible(address user, uint8 requiredTier) external view returns (bool) { return tiers[user] >= requiredTier; }
}

contract MockTLInvTarget {
    uint256 public value;
    function setValue(uint256 _value) external { value = _value; }
}

// ============ Handler ============

contract TimelockHandler is Test {
    VibeTimelock public timelock;
    MockTLInvTarget public target;
    address public proposer;
    address public executor;
    address public canceller;

    // Ghost variables
    uint256 public ghost_scheduled;
    uint256 public ghost_executed;
    uint256 public ghost_cancelled;
    uint256 public ghost_tipsPaid;

    // Track operation IDs
    bytes32[] public operationIds;
    mapping(bytes32 => bool) public isScheduled;
    mapping(bytes32 => bool) public isExecuted;
    mapping(bytes32 => bool) public isCancelled;

    uint256 private _nextSalt;

    constructor(
        VibeTimelock _timelock,
        MockTLInvTarget _target,
        address _proposer,
        address _executor,
        address _canceller
    ) {
        timelock = _timelock;
        target = _target;
        proposer = _proposer;
        executor = _executor;
        canceller = _canceller;
    }

    function scheduleOp(uint256 valueSeed) public {
        uint256 val = bound(valueSeed, 0, 1_000_000);
        bytes memory data = abi.encodeCall(MockTLInvTarget.setValue, (val));
        bytes32 salt = bytes32(_nextSalt++);

        bytes32 id = timelock.hashOperation(address(target), 0, data, bytes32(0), salt);

        vm.prank(proposer);
        try timelock.schedule(address(target), 0, data, bytes32(0), salt, 2 days) {
            ghost_scheduled++;
            operationIds.push(id);
            isScheduled[id] = true;
        } catch {}
    }

    function executeOp(uint256 indexSeed) public {
        if (operationIds.length == 0) return;
        uint256 idx = indexSeed % operationIds.length;
        bytes32 id = operationIds[idx];

        if (isExecuted[id] || isCancelled[id]) return;

        // Warp past delay
        vm.warp(block.timestamp + 2 days + 1);

        // We need to reconstruct the call data — but we don't store it.
        // For invariant testing, we'll use the salt pattern to reconstruct.
        // The salt was idx in the array at time of creation, but we need the original val.
        // Simpler: just try to execute and let it fail gracefully.

        // Since we can't reconstruct, let's take a different approach:
        // schedule and immediately track all params.
        // For now, just skip execution in handler and test structural invariants.
    }

    function cancelOp(uint256 indexSeed) public {
        if (operationIds.length == 0) return;
        uint256 idx = indexSeed % operationIds.length;
        bytes32 id = operationIds[idx];

        if (isExecuted[id] || isCancelled[id]) return;

        vm.prank(canceller);
        try timelock.cancel(id) {
            ghost_cancelled++;
            isCancelled[id] = true;
        } catch {}
    }

    function warpTime(uint256 seconds_) public {
        seconds_ = bound(seconds_, 0, 7 days);
        vm.warp(block.timestamp + seconds_);
    }

    function operationIdsLength() external view returns (uint256) {
        return operationIds.length;
    }
}

// ============ Full-Execution Handler ============

/// @dev A handler that tracks full operation data for execute testing
contract TimelockExecHandler is Test {
    VibeTimelock public timelock;
    MockTLInvTarget public target;
    address public proposer;
    address public executor;
    address public canceller;

    struct OpRecord {
        uint256 value;
        bytes32 salt;
        bytes32 id;
        bool executed;
        bool cancelled;
    }

    OpRecord[] public ops;
    uint256 public ghost_scheduled;
    uint256 public ghost_executed;
    uint256 public ghost_cancelled;

    uint256 private _nextSalt;

    constructor(
        VibeTimelock _timelock,
        MockTLInvTarget _target,
        address _proposer,
        address _executor,
        address _canceller
    ) {
        timelock = _timelock;
        target = _target;
        proposer = _proposer;
        executor = _executor;
        canceller = _canceller;
    }

    function scheduleOp(uint256 valueSeed) public {
        uint256 val = bound(valueSeed, 0, 1_000_000);
        bytes32 salt = bytes32(_nextSalt++);
        bytes memory data = abi.encodeCall(MockTLInvTarget.setValue, (val));
        bytes32 id = timelock.hashOperation(address(target), 0, data, bytes32(0), salt);

        vm.prank(proposer);
        try timelock.schedule(address(target), 0, data, bytes32(0), salt, 2 days) {
            ops.push(OpRecord(val, salt, id, false, false));
            ghost_scheduled++;
        } catch {}
    }

    function executeOp(uint256 indexSeed) public {
        if (ops.length == 0) return;
        uint256 idx = indexSeed % ops.length;
        OpRecord storage op = ops[idx];
        if (op.executed || op.cancelled) return;

        // Warp past delay
        vm.warp(block.timestamp + 2 days + 1);

        bytes memory data = abi.encodeCall(MockTLInvTarget.setValue, (op.value));

        vm.prank(executor);
        try timelock.execute(address(target), 0, data, bytes32(0), op.salt) {
            op.executed = true;
            ghost_executed++;
        } catch {}
    }

    function cancelOp(uint256 indexSeed) public {
        if (ops.length == 0) return;
        uint256 idx = indexSeed % ops.length;
        OpRecord storage op = ops[idx];
        if (op.executed || op.cancelled) return;

        vm.prank(canceller);
        try timelock.cancel(op.id) {
            op.cancelled = true;
            ghost_cancelled++;
        } catch {}
    }

    function warpTime(uint256 seconds_) public {
        seconds_ = bound(seconds_, 0, 7 days);
        vm.warp(block.timestamp + seconds_);
    }

    function opsLength() external view returns (uint256) {
        return ops.length;
    }
}

// ============ Invariant Tests ============

contract TimelockInvariantTest is StdInvariant, Test {
    VibeTimelock public timelock;
    MockTLInvToken public jul;
    MockTLInvOracle public oracle;
    MockTLInvTarget public target;
    TimelockExecHandler public handler;

    address public proposer;
    address public executor;
    address public canceller;
    address public guardian;

    function setUp() public {
        proposer = makeAddr("proposer");
        executor = makeAddr("executor");
        canceller = makeAddr("canceller");
        guardian = makeAddr("guardian");

        jul = new MockTLInvToken("JUL", "JUL");
        oracle = new MockTLInvOracle();
        target = new MockTLInvTarget();

        address[] memory p = new address[](1);
        p[0] = proposer;
        address[] memory e = new address[](1);
        e[0] = executor;
        address[] memory c = new address[](1);
        c[0] = canceller;

        timelock = new VibeTimelock(
            2 days, address(jul), address(oracle), guardian, p, e, c
        );

        // Fund JUL
        jul.mint(address(this), 100_000 ether);
        jul.approve(address(timelock), type(uint256).max);
        timelock.depositJulRewards(10_000 ether);

        handler = new TimelockExecHandler(timelock, target, proposer, executor, canceller);
        targetContract(address(handler));
    }

    // ============ Structural Invariants ============

    /**
     * @notice Executed + cancelled operations never exceed scheduled.
     */
    function invariant_executedPlusCancelledLteScheduled() public view {
        assertLe(
            handler.ghost_executed() + handler.ghost_cancelled(),
            handler.ghost_scheduled(),
            "Executed + cancelled must never exceed scheduled"
        );
    }

    /**
     * @notice operationCount matches ghost_scheduled.
     */
    function invariant_operationCountMatchesGhost() public view {
        assertEq(
            timelock.operationCount(),
            handler.ghost_scheduled(),
            "operationCount mismatch"
        );
    }

    /**
     * @notice JUL reward pool + tips paid = initial deposit.
     */
    function invariant_julAccountingSound() public view {
        uint256 tipsPaid = jul.balanceOf(executor);
        uint256 remainingPool = timelock.julRewardPool();
        // Initial deposit was 10_000 ether
        assertEq(
            remainingPool + tipsPaid,
            10_000 ether,
            "JUL accounting: pool + tips must equal initial deposit"
        );
    }

    /**
     * @notice Every executed operation is in EXECUTED state.
     */
    function invariant_executedOpsInCorrectState() public view {
        uint256 len = handler.opsLength();
        for (uint256 i = 0; i < len && i < 50; i++) {
            (, , bytes32 id, bool executed, bool cancelled) = handler.ops(i);
            if (executed) {
                assertEq(
                    uint8(timelock.getOperationState(id)),
                    uint8(IVibeTimelock.OperationState.EXECUTED),
                    "Executed op not in EXECUTED state"
                );
            }
            if (cancelled) {
                assertEq(
                    uint8(timelock.getOperationState(id)),
                    uint8(IVibeTimelock.OperationState.CANCELLED),
                    "Cancelled op not in CANCELLED state"
                );
            }
        }
    }

    /**
     * @notice minDelay never changes (only through timelock self-call).
     */
    function invariant_minDelayUnchanged() public view {
        assertEq(timelock.minDelay(), 2 days, "minDelay must not change without self-call");
    }

    // ============ Call Summary ============

    function invariant_callSummary() public view {
        console.log("--- Timelock Invariant Summary ---");
        console.log("Scheduled:", handler.ghost_scheduled());
        console.log("Executed:", handler.ghost_executed());
        console.log("Cancelled:", handler.ghost_cancelled());
        console.log("JUL pool remaining:", timelock.julRewardPool());
    }
}
