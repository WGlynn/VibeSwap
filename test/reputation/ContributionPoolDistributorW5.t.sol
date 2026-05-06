// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "forge-std/Test.sol";
import "@openzeppelin/contracts/proxy/ERC1967/ERC1967Proxy.sol";
import "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import "@openzeppelin/contracts/token/ERC20/extensions/ERC20Burnable.sol";
import "../../contracts/reputation/ContributionPoolDistributor.sol";
import "../../contracts/reputation/DAGRegistry.sol";

// ============ Mocks ============

contract MockVibeToken is ERC20 {
    mapping(address => bool) public minters;

    constructor() ERC20("VIBE", "VIBE") {}

    function setMinter(address m, bool val) external { minters[m] = val; }

    function mint(address to, uint256 amount) external {
        require(minters[msg.sender], "not minter");
        _mint(to, amount);
    }

    function totalSupply() public view override returns (uint256) {
        return super.totalSupply();
    }
}

/// @notice DAGRegistry mock that supports one or more DAGs, with optional distribute() revert.
contract MockDAGRegistry {
    address[] public dags;
    mapping(address => uint256) public weights;
    mapping(address => bool) public shouldRevert;

    function addDAG(address dag, uint256 weight) external {
        dags.push(dag);
        weights[dag] = weight;
    }

    function setShouldRevert(address dag, bool val) external { shouldRevert[dag] = val; }

    function getDAGAt(uint256 idx) external view returns (address) { return dags[idx]; }
    function getDAGCount() external view returns (uint256) { return dags.length; }
    function getTotalWeight() external view returns (uint256 total) {
        for (uint256 i = 0; i < dags.length; i++) {
            total += weights[dags[i]];
        }
    }
    function getDAGWeight(address dag) external view returns (uint256) { return weights[dag]; }
    function recordEpochActivity(address, uint256) external {}
}

/// @notice DAG contract that can be toggled to revert on distribute().
contract MockDAG {
    MockVibeToken public vibe;
    bool public shouldRevert;
    uint256 public received;

    constructor(address _vibe) { vibe = MockVibeToken(_vibe); }

    function setShouldRevert(bool val) external { shouldRevert = val; }

    function distribute(uint256 amount) external {
        if (shouldRevert) revert("MockDAG: distribute failed");
        // Pull via transferFrom (distributor has already approved).
        vibe.transferFrom(msg.sender, address(this), amount);
        received += amount;
    }
}

// ============ Test Harness ============

contract ContributionPoolDistributorW5Test is Test {
    ContributionPoolDistributor public distributor;
    MockVibeToken public vibe;
    MockDAGRegistry public dagRegistry;
    MockDAG public dag1;
    MockDAG public dag2;

    // W5 events for vm.recordLogs
    event DAGDistributeFailed(address indexed dag, uint256 amount);
    event DAGDistributeRetried(address indexed dag, uint256 amount, bool success);
    event DAGShareRouted(address indexed dag, uint256 amount, uint256 weight);

    function setUp() public {
        // Deploy mock vibe token and authorize distributor as minter.
        vibe = new MockVibeToken();

        // Deploy DAG registry mock.
        dagRegistry = new MockDAGRegistry();

        // Deploy DAGs.
        dag1 = new MockDAG(address(vibe));
        dag2 = new MockDAG(address(vibe));

        // Register DAGs with equal weight.
        dagRegistry.addDAG(address(dag1), 5000);
        dagRegistry.addDAG(address(dag2), 5000);

        // Deploy distributor (UUPS proxy pattern).
        ContributionPoolDistributor impl = new ContributionPoolDistributor();
        ERC1967Proxy proxy = new ERC1967Proxy(
            address(impl),
            abi.encodeWithSelector(
                ContributionPoolDistributor.initialize.selector,
                address(vibe),
                address(dagRegistry),
                address(this)
            )
        );
        distributor = ContributionPoolDistributor(address(proxy));

        // Authorize distributor as minter.
        vibe.setMinter(address(distributor), true);

        // Approve DAGs to pull from distributor (normally done inside distributor via forceApprove).
        // The distributor does forceApprove internally before the try call.
    }

    // ============ W5 regression tests ============

    /// @notice W5: when distribute() reverts, strandedShares must be set and DAGDistributeFailed emitted.
    function test_W5_distributeEpoch_strandedSharesSet() public {
        // Make dag1 revert on distribute().
        dag1.setShouldRevert(true);

        // Advance past one epoch.
        vm.warp(block.timestamp + 7 days + 1);

        vm.recordLogs();
        distributor.distributeEpoch();
        Vm.Log[] memory logs = vm.getRecordedLogs();

        // Find DAGDistributeFailed log for dag1.
        bytes32 failedTopic = keccak256("DAGDistributeFailed(address,uint256)");
        bool foundFailed;
        uint256 strandedAmount;
        for (uint256 i = 0; i < logs.length; i++) {
            if (logs[i].topics[0] == failedTopic &&
                address(uint160(uint256(logs[i].topics[1]))) == address(dag1)) {
                foundFailed = true;
                strandedAmount = abi.decode(logs[i].data, (uint256));
                break;
            }
        }

        assertTrue(foundFailed, "W5: DAGDistributeFailed not emitted for dag1");
        assertGt(strandedAmount, 0, "W5: stranded amount must be > 0");
        assertEq(distributor.strandedShares(address(dag1)), strandedAmount, "W5: strandedShares mapping mismatch");

        // dag2 should have received its share successfully (distribute not reverted).
        assertGt(dag2.received(), 0, "W5: dag2 should have received tokens");
    }

    /// @notice W5: successful retryDAGDistribute clears strandedShares and delivers tokens.
    function test_W5_retryDAGDistribute_succeeds() public {
        dag1.setShouldRevert(true);
        vm.warp(block.timestamp + 7 days + 1);
        distributor.distributeEpoch();

        uint256 stranded = distributor.strandedShares(address(dag1));
        assertGt(stranded, 0, "W5: stranded shares must be > 0");

        // Now allow dag1 to succeed.
        dag1.setShouldRevert(false);

        distributor.retryDAGDistribute(address(dag1));

        assertEq(distributor.strandedShares(address(dag1)), 0, "W5: strandedShares not cleared after retry");
        assertEq(dag1.received(), stranded, "W5: dag1 should have received stranded amount");
    }

    /// @notice W5: retry when still failing leaves strandedShares intact.
    function test_W5_retryDAGDistribute_stillFails() public {
        dag1.setShouldRevert(true);
        vm.warp(block.timestamp + 7 days + 1);
        distributor.distributeEpoch();

        uint256 stranded = distributor.strandedShares(address(dag1));
        assertGt(stranded, 0, "W5: stranded shares must be > 0");

        // Still fails.
        distributor.retryDAGDistribute(address(dag1));

        assertEq(distributor.strandedShares(address(dag1)), stranded, "W5: strandedShares should remain on failed retry");
    }

    /// @notice W5: retrying a DAG with no stranded shares reverts.
    function test_W5_retryDAGDistribute_noStrandedReverts() public {
        vm.expectRevert("ContributionPoolDistributor: no stranded shares for DAG");
        distributor.retryDAGDistribute(address(dag1));
    }

    /// @notice W5: totalDistributed increases on successful retry (not double-counted).
    function test_W5_retryDAGDistribute_totalDistributedIncreases() public {
        dag1.setShouldRevert(true);
        vm.warp(block.timestamp + 7 days + 1);
        distributor.distributeEpoch();

        uint256 totalAfterEpoch = distributor.totalDistributed();
        uint256 stranded = distributor.strandedShares(address(dag1));

        dag1.setShouldRevert(false);
        distributor.retryDAGDistribute(address(dag1));

        assertEq(distributor.totalDistributed(), totalAfterEpoch + stranded,
            "W5: totalDistributed should increase by stranded amount on retry");
    }
}
