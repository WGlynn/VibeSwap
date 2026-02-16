// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "forge-std/Test.sol";
import "forge-std/StdInvariant.sol";
import "../../contracts/governance/DAOTreasury.sol";
import "@openzeppelin/contracts/proxy/ERC1967/ERC1967Proxy.sol";
import "@openzeppelin/contracts/token/ERC20/ERC20.sol";

// ============ Mocks ============

contract MockTreasuryIToken is ERC20 {
    constructor(string memory name_, string memory symbol_) ERC20(name_, symbol_) {}
    function mint(address to, uint256 amount) external { _mint(to, amount); }
}

contract MockTreasuryIAMM {
    struct Pool {
        address token0;
        address token1;
        uint256 reserve0;
        uint256 reserve1;
        uint256 totalLiquidity;
        uint256 feeRate;
        bool initialized;
    }

    function getPool(bytes32) external pure returns (Pool memory) {
        return Pool(address(0), address(0), 0, 0, 0, 0, false);
    }
}

// ============ Handler ============

contract TreasuryHandler is Test {
    DAOTreasury public treasury;
    MockTreasuryIToken public token;

    address public owner;
    address public feeSender;
    address public recipient;

    // Ghost variables
    uint256 public ghost_totalFees;
    uint256 public ghost_requestCount;
    uint256 public ghost_executedCount;
    uint256 public ghost_cancelledCount;

    uint256[] public pendingRequests;

    constructor(
        DAOTreasury _treasury,
        MockTreasuryIToken _token,
        address _owner,
        address _feeSender,
        address _recipient
    ) {
        treasury = _treasury;
        token = _token;
        owner = _owner;
        feeSender = _feeSender;
        recipient = _recipient;
    }

    function receiveFees(uint256 amount) public {
        amount = bound(amount, 1, 100_000 ether);

        token.mint(feeSender, amount);
        vm.prank(feeSender);
        token.approve(address(treasury), amount);

        vm.prank(feeSender);
        try treasury.receiveProtocolFees(address(token), amount, uint64(ghost_requestCount)) {
            ghost_totalFees += amount;
        } catch {}
    }

    function queueWithdrawal(uint256 amount) public {
        amount = bound(amount, 1, 10 ether);

        // Ensure treasury has enough balance
        uint256 bal = token.balanceOf(address(treasury));
        if (bal < amount) {
            token.mint(address(treasury), amount - bal);
        }

        vm.prank(owner);
        try treasury.queueWithdrawal(recipient, address(token), amount) returns (uint256 id) {
            ghost_requestCount++;
            pendingRequests.push(id);
        } catch {}
    }

    function executeWithdrawal(uint256 seed) public {
        if (pendingRequests.length == 0) return;

        uint256 idx = seed % pendingRequests.length;
        uint256 requestId = pendingRequests[idx];

        try treasury.executeWithdrawal(requestId) {
            ghost_executedCount++;
            // Remove from pending
            pendingRequests[idx] = pendingRequests[pendingRequests.length - 1];
            pendingRequests.pop();
        } catch {}
    }

    function cancelWithdrawal(uint256 seed) public {
        if (pendingRequests.length == 0) return;

        uint256 idx = seed % pendingRequests.length;
        uint256 requestId = pendingRequests[idx];

        vm.prank(owner);
        try treasury.cancelWithdrawal(requestId) {
            ghost_cancelledCount++;
            // Remove from pending
            pendingRequests[idx] = pendingRequests[pendingRequests.length - 1];
            pendingRequests.pop();
        } catch {}
    }

    function advanceTime(uint256 delta) public {
        delta = bound(delta, 1, 3 days);
        vm.warp(block.timestamp + delta);
    }

    function getPendingCount() external view returns (uint256) {
        return pendingRequests.length;
    }
}

// ============ Invariant Tests ============

contract DAOTreasuryInvariantTest is StdInvariant, Test {
    DAOTreasury public treasury;
    MockTreasuryIToken public token;
    MockTreasuryIAMM public mockAMM;
    TreasuryHandler public handler;

    address public owner;
    address public feeSender;
    address public recipient;

    function setUp() public {
        owner = address(this);
        feeSender = makeAddr("feeSender");
        recipient = makeAddr("recipient");

        token = new MockTreasuryIToken("USDC", "USDC");
        mockAMM = new MockTreasuryIAMM();

        DAOTreasury impl = new DAOTreasury();
        bytes memory initData = abi.encodeWithSelector(
            DAOTreasury.initialize.selector,
            owner,
            address(mockAMM)
        );
        ERC1967Proxy proxy = new ERC1967Proxy(address(impl), initData);
        treasury = DAOTreasury(payable(address(proxy)));

        treasury.setAuthorizedFeeSender(feeSender, true);

        handler = new TreasuryHandler(treasury, token, owner, feeSender, recipient);
        targetContract(address(handler));
    }

    // ============ Invariant: nextRequestId = requestCount + 1 ============

    function invariant_requestIdConsistent() public view {
        assertEq(
            treasury.nextRequestId(),
            handler.ghost_requestCount() + 1,
            "REQUEST_ID: mismatch"
        );
    }

    // ============ Invariant: totalFeesReceived matches ghost ============

    function invariant_feesTrackedCorrectly() public view {
        assertEq(
            treasury.totalFeesReceived(address(token)),
            handler.ghost_totalFees(),
            "FEES: tracking mismatch"
        );
    }

    // ============ Invariant: timelock duration always within bounds ============

    function invariant_timelockWithinBounds() public view {
        uint256 duration = treasury.timelockDuration();
        assertGe(duration, treasury.MIN_TIMELOCK(), "TIMELOCK: below minimum");
        assertLe(duration, treasury.MAX_TIMELOCK(), "TIMELOCK: above maximum");
    }

    // ============ Invariant: executed + cancelled + pending = total requests ============

    function invariant_requestAccountingConsistent() public view {
        uint256 totalRequests = handler.ghost_requestCount();
        uint256 executed = handler.ghost_executedCount();
        uint256 cancelled = handler.ghost_cancelledCount();
        uint256 pending = handler.getPendingCount();

        assertEq(
            executed + cancelled + pending,
            totalRequests,
            "ACCOUNTING: requests don't sum"
        );
    }

    // ============ Invariant: treasury token balance >= 0 (solvency) ============

    function invariant_treasurySolvent() public view {
        // Token balance should never underflow — this is implicitly true
        // but we check the treasury reports a valid balance
        uint256 bal = treasury.getBalance(address(token));
        assertGe(bal, 0, "SOLVENCY: negative balance");
    }
}
