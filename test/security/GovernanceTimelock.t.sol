// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "forge-std/Test.sol";
import "@openzeppelin/contracts/proxy/ERC1967/ERC1967Proxy.sol";
import "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import "../../contracts/core/VibeSwapCore.sol";
import "../../contracts/core/interfaces/ICommitRevealAuction.sol";
import "../../contracts/core/interfaces/IVibeAMM.sol";
import "../../contracts/core/interfaces/IDAOTreasury.sol";
import "../../contracts/core/interfaces/IwBAR.sol";
import "../../contracts/libraries/SecurityLib.sol";

// ============ Minimal Mocks ============

contract MockGovERC20 is ERC20 {
    constructor(string memory name, string memory symbol) ERC20(name, symbol) {}
    function mint(address to, uint256 amount) external { _mint(to, amount); }
}

contract MockGovAuction {
    uint64 public currentBatchId = 1;
    ICommitRevealAuction.BatchPhase public currentPhase = ICommitRevealAuction.BatchPhase.COMMIT;
    uint256 public commitCount;

    ICommitRevealAuction.RevealedOrder[] private _revealedOrders;
    uint256[] private _executionOrder;
    ICommitRevealAuction.Batch private _batch;

    function commitOrder(bytes32) external payable returns (bytes32) {
        commitCount++;
        return keccak256(abi.encodePacked("commit", commitCount));
    }

    function revealOrderCrossChain(
        bytes32, address, address, address, uint256, uint256, bytes32, uint256
    ) external payable {}

    function advancePhase() external {}
    function settleBatch() external {}

    function getCurrentBatchId() external view returns (uint64) { return currentBatchId; }
    function getCurrentPhase() external view returns (ICommitRevealAuction.BatchPhase) { return currentPhase; }
    function getTimeUntilPhaseChange() external pure returns (uint256) { return 5; }

    function getRevealedOrders(uint64) external view returns (ICommitRevealAuction.RevealedOrder[] memory) {
        return _revealedOrders;
    }

    function getExecutionOrder(uint64) external view returns (uint256[] memory) {
        return _executionOrder;
    }

    function getBatch(uint64) external view returns (ICommitRevealAuction.Batch memory) {
        return _batch;
    }
}

contract MockGovAMM {
    function createPool(address token0, address token1, uint256) external returns (bytes32) {
        return keccak256(abi.encodePacked(token0, token1));
    }

    function executeBatchSwap(bytes32, uint64, IVibeAMM.SwapOrder[] calldata)
        external pure returns (IVibeAMM.BatchSwapResult memory result)
    {
        return result;
    }

    function getPoolId(address tokenA, address tokenB) external pure returns (bytes32) {
        return keccak256(abi.encodePacked(tokenA, tokenB));
    }

    function getPool(bytes32) external pure returns (IVibeAMM.Pool memory pool) {
        pool.token0 = address(1);
        pool.token1 = address(2);
        pool.reserve0 = 1000e18;
        pool.reserve1 = 1000e18;
        pool.feeRate = 30;
        pool.initialized = true;
    }

    function quote(bytes32, address, uint256 amountIn) external pure returns (uint256) {
        return amountIn * 99 / 100;
    }
}

contract MockGovTreasury {
    function receiveAuctionProceeds(uint64) external payable {}
    receive() external payable {}
}

contract MockGovRouter {
    function sendCommit(uint32, bytes32, uint256, bytes calldata, address) external payable {}
    receive() external payable {}
}

// ============ Test Contract ============

/**
 * @title GovernanceTimelockTest
 * @notice Verifies the onlyGovernance modifier and setTimelockController function
 *         in VibeSwapCore — Phase 2 disintermediation governance gate.
 */
contract GovernanceTimelockTest is Test {
    VibeSwapCore public core;
    MockGovAuction public auction;
    MockGovAMM public amm;
    MockGovTreasury public treasury;
    MockGovRouter public router;
    MockGovERC20 public tokenA;
    MockGovERC20 public tokenB;

    address public owner;
    address public timelock;
    address public rando;
    address public newGuardian;

    event TimelockControllerUpdated(address indexed oldTimelock, address indexed newTimelock);
    event ContractsUpdated(address auction, address amm, address treasury, address router);
    event UserBlacklisted(address indexed user, bool status);
    event GuardianUpdated(address indexed oldGuardian, address indexed newGuardian);
    event TokenSupported(address indexed token, bool supported);
    event WBARUpdated(address indexed wbar);
    event IncentiveControllerUpdated(address indexed controller);
    event ContractWhitelisted(address indexed contractAddr, bool status);

    function setUp() public {
        owner = makeAddr("owner");
        timelock = makeAddr("timelock");
        rando = makeAddr("rando");
        newGuardian = makeAddr("newGuardian");

        auction = new MockGovAuction();
        amm = new MockGovAMM();
        treasury = new MockGovTreasury();
        router = new MockGovRouter();
        tokenA = new MockGovERC20("Token A", "TKA");
        tokenB = new MockGovERC20("Token B", "TKB");

        VibeSwapCore impl = new VibeSwapCore();
        ERC1967Proxy proxy = new ERC1967Proxy(
            address(impl),
            abi.encodeWithSelector(
                VibeSwapCore.initialize.selector,
                owner,
                address(auction),
                address(amm),
                address(treasury),
                address(router)
            )
        );
        core = VibeSwapCore(payable(address(proxy)));

        vm.warp(100);
    }

    // ============ 1. Before Timelock: Only Owner ============

    function test_beforeTimelock_ownerCanCallUpdateContracts() public {
        vm.prank(owner);
        core.updateContracts(address(0), address(0), address(0), address(0));
    }

    function test_beforeTimelock_ownerCanCallSetSupportedToken() public {
        vm.prank(owner);
        core.setSupportedToken(address(tokenA), true);
        assertTrue(core.supportedTokens(address(tokenA)));
    }

    function test_beforeTimelock_ownerCanCallBatchBlacklist() public {
        address[] memory users = new address[](2);
        users[0] = makeAddr("user1");
        users[1] = makeAddr("user2");

        vm.prank(owner);
        core.batchBlacklist(users, true);
        assertTrue(core.blacklisted(users[0]));
        assertTrue(core.blacklisted(users[1]));
    }

    function test_beforeTimelock_ownerCanCallSetBlacklist() public {
        address user = makeAddr("badUser");
        vm.prank(owner);
        core.setBlacklist(user, true);
        assertTrue(core.blacklisted(user));
    }

    function test_beforeTimelock_ownerCanCallSetGuardian() public {
        vm.prank(owner);
        core.setGuardian(newGuardian);
        assertEq(core.guardian(), newGuardian);
    }

    function test_beforeTimelock_ownerCanCallSetWBAR() public {
        address mockWBAR = makeAddr("wbar");
        vm.prank(owner);
        core.setWBAR(mockWBAR);
        assertEq(address(core.wbar()), mockWBAR);
    }

    function test_beforeTimelock_ownerCanCallSetIncentiveController() public {
        address mockController = makeAddr("controller");
        vm.prank(owner);
        core.setIncentiveController(mockController);
        assertEq(address(core.incentiveController()), mockController);
    }

    function test_beforeTimelock_ownerCanCallSetContractWhitelist() public {
        address contractAddr = makeAddr("someContract");
        vm.prank(owner);
        core.setContractWhitelist(contractAddr, true);
        assertTrue(core.whitelistedContracts(contractAddr));
    }

    // ============ 2. After Timelock: Both Owner AND Timelock ============

    function test_afterTimelock_ownerCanStillCallGovernanceFunctions() public {
        // Set the timelock
        vm.prank(owner);
        core.setTimelockController(timelock);

        // Owner should still work
        vm.prank(owner);
        core.setSupportedToken(address(tokenA), true);
        assertTrue(core.supportedTokens(address(tokenA)));

        vm.prank(owner);
        core.setGuardian(newGuardian);
        assertEq(core.guardian(), newGuardian);
    }

    function test_afterTimelock_timelockCanCallUpdateContracts() public {
        vm.prank(owner);
        core.setTimelockController(timelock);

        address newAuction = makeAddr("newAuction");
        vm.prank(timelock);
        core.updateContracts(newAuction, address(0), address(0), address(0));
        assertEq(address(core.auction()), newAuction);
    }

    function test_afterTimelock_timelockCanCallSetSupportedToken() public {
        vm.prank(owner);
        core.setTimelockController(timelock);

        vm.prank(timelock);
        core.setSupportedToken(address(tokenA), true);
        assertTrue(core.supportedTokens(address(tokenA)));
    }

    function test_afterTimelock_timelockCanCallBatchBlacklist() public {
        vm.prank(owner);
        core.setTimelockController(timelock);

        address[] memory users = new address[](2);
        users[0] = makeAddr("user1");
        users[1] = makeAddr("user2");

        vm.prank(timelock);
        core.batchBlacklist(users, true);
        assertTrue(core.blacklisted(users[0]));
        assertTrue(core.blacklisted(users[1]));
    }

    function test_afterTimelock_timelockCanCallSetBlacklist() public {
        vm.prank(owner);
        core.setTimelockController(timelock);

        address user = makeAddr("badUser");
        vm.prank(timelock);
        core.setBlacklist(user, true);
        assertTrue(core.blacklisted(user));
    }

    function test_afterTimelock_timelockCanCallSetGuardian() public {
        vm.prank(owner);
        core.setTimelockController(timelock);

        vm.prank(timelock);
        core.setGuardian(newGuardian);
        assertEq(core.guardian(), newGuardian);
    }

    function test_afterTimelock_timelockCanCallSetWBAR() public {
        vm.prank(owner);
        core.setTimelockController(timelock);

        address mockWBAR = makeAddr("wbar");
        vm.prank(timelock);
        core.setWBAR(mockWBAR);
        assertEq(address(core.wbar()), mockWBAR);
    }

    function test_afterTimelock_timelockCanCallSetIncentiveController() public {
        vm.prank(owner);
        core.setTimelockController(timelock);

        address mockController = makeAddr("controller");
        vm.prank(timelock);
        core.setIncentiveController(mockController);
        assertEq(address(core.incentiveController()), mockController);
    }

    function test_afterTimelock_timelockCanCallSetContractWhitelist() public {
        vm.prank(owner);
        core.setTimelockController(timelock);

        address contractAddr = makeAddr("someContract");
        vm.prank(timelock);
        core.setContractWhitelist(contractAddr, true);
        assertTrue(core.whitelistedContracts(contractAddr));
    }

    // ============ 3. Random Addresses Cannot Call onlyGovernance ============

    function test_randoCannotCallUpdateContracts() public {
        vm.prank(rando);
        vm.expectRevert("Not governance");
        core.updateContracts(address(0), address(0), address(0), address(0));
    }

    function test_randoCannotCallSetSupportedToken() public {
        vm.prank(rando);
        vm.expectRevert("Not governance");
        core.setSupportedToken(address(tokenA), true);
    }

    function test_randoCannotCallBatchBlacklist() public {
        address[] memory users = new address[](1);
        users[0] = makeAddr("user1");

        vm.prank(rando);
        vm.expectRevert("Not governance");
        core.batchBlacklist(users, true);
    }

    function test_randoCannotCallSetBlacklist() public {
        vm.prank(rando);
        vm.expectRevert("Not governance");
        core.setBlacklist(rando, true);
    }

    function test_randoCannotCallSetGuardian() public {
        vm.prank(rando);
        vm.expectRevert("Not governance");
        core.setGuardian(rando);
    }

    function test_randoCannotCallSetWBAR() public {
        vm.prank(rando);
        vm.expectRevert("Not governance");
        core.setWBAR(rando);
    }

    function test_randoCannotCallSetIncentiveController() public {
        vm.prank(rando);
        vm.expectRevert("Not governance");
        core.setIncentiveController(rando);
    }

    function test_randoCannotCallSetContractWhitelist() public {
        vm.prank(rando);
        vm.expectRevert("Not governance");
        core.setContractWhitelist(rando, true);
    }

    function test_randoCannotCallGovernanceFunctionsEvenWithTimelockSet() public {
        // Set timelock first
        vm.prank(owner);
        core.setTimelockController(timelock);

        // Rando still cannot call
        vm.prank(rando);
        vm.expectRevert("Not governance");
        core.updateContracts(address(0), address(0), address(0), address(0));

        vm.prank(rando);
        vm.expectRevert("Not governance");
        core.setGuardian(rando);

        vm.prank(rando);
        vm.expectRevert("Not governance");
        core.setBlacklist(rando, true);
    }

    // ============ 4. Only Owner Can Call setTimelockController ============

    function test_ownerCanSetTimelockController() public {
        vm.prank(owner);
        vm.expectEmit(true, true, false, false);
        emit TimelockControllerUpdated(address(0), timelock);
        core.setTimelockController(timelock);

        assertEq(core.timelockController(), timelock);
    }

    function test_timelockCannotCallSetTimelockController() public {
        // First set a timelock
        vm.prank(owner);
        core.setTimelockController(timelock);

        // Timelock itself cannot change the timelock (onlyOwner, not onlyGovernance)
        address newTimelock = makeAddr("newTimelock");
        vm.prank(timelock);
        vm.expectRevert(abi.encodeWithSignature("OwnableUnauthorizedAccount(address)", timelock));
        core.setTimelockController(newTimelock);
    }

    function test_randoCannotCallSetTimelockController() public {
        vm.prank(rando);
        vm.expectRevert(abi.encodeWithSignature("OwnableUnauthorizedAccount(address)", rando));
        core.setTimelockController(timelock);
    }

    function test_guardianCannotCallSetTimelockController() public {
        address guardianAddr = core.guardian();
        // Guardian (which defaults to owner) is not a special case for setTimelockController
        // unless guardian == owner. Use a distinct guardian to prove this.
        vm.prank(owner);
        core.setGuardian(newGuardian);

        vm.prank(newGuardian);
        vm.expectRevert(abi.encodeWithSignature("OwnableUnauthorizedAccount(address)", newGuardian));
        core.setTimelockController(timelock);
    }

    // ============ 5. Setting Timelock to address(0) Disables Timelock Path ============

    function test_settingTimelockToZeroDisablesTimelockPath() public {
        // Set timelock
        vm.prank(owner);
        core.setTimelockController(timelock);

        // Timelock can call governance functions
        vm.prank(timelock);
        core.setSupportedToken(address(tokenA), true);
        assertTrue(core.supportedTokens(address(tokenA)));

        // Now disable the timelock
        vm.prank(owner);
        core.setTimelockController(address(0));
        assertEq(core.timelockController(), address(0));

        // Timelock address can no longer call governance functions
        vm.prank(timelock);
        vm.expectRevert("Not governance");
        core.setSupportedToken(address(tokenB), true);

        // Owner still works
        vm.prank(owner);
        core.setSupportedToken(address(tokenB), true);
        assertTrue(core.supportedTokens(address(tokenB)));
    }

    function test_settingTimelockToZeroDisablesUpdateContracts() public {
        vm.prank(owner);
        core.setTimelockController(timelock);

        // Verify timelock works
        vm.prank(timelock);
        core.updateContracts(address(0), address(0), address(0), address(0));

        // Disable
        vm.prank(owner);
        core.setTimelockController(address(0));

        // Timelock no longer accepted
        vm.prank(timelock);
        vm.expectRevert("Not governance");
        core.updateContracts(address(0), address(0), address(0), address(0));
    }

    function test_settingTimelockToZeroDisablesBlacklist() public {
        vm.prank(owner);
        core.setTimelockController(timelock);

        address user = makeAddr("badUser");

        // Timelock can blacklist
        vm.prank(timelock);
        core.setBlacklist(user, true);
        assertTrue(core.blacklisted(user));

        // Disable timelock
        vm.prank(owner);
        core.setTimelockController(address(0));

        // Timelock can no longer blacklist
        vm.prank(timelock);
        vm.expectRevert("Not governance");
        core.setBlacklist(user, false);
    }

    function test_settingTimelockToZeroEmitsEvent() public {
        vm.prank(owner);
        core.setTimelockController(timelock);

        vm.prank(owner);
        vm.expectEmit(true, true, false, false);
        emit TimelockControllerUpdated(timelock, address(0));
        core.setTimelockController(address(0));
    }

    // ============ Edge Cases ============

    function test_timelockDefaultsToZero() public view {
        assertEq(core.timelockController(), address(0));
    }

    function test_ownerCanChangeTimelockToNewAddress() public {
        vm.prank(owner);
        core.setTimelockController(timelock);
        assertEq(core.timelockController(), timelock);

        address newTimelock = makeAddr("newTimelock");
        vm.prank(owner);
        core.setTimelockController(newTimelock);
        assertEq(core.timelockController(), newTimelock);

        // Old timelock no longer works
        vm.prank(timelock);
        vm.expectRevert("Not governance");
        core.setSupportedToken(address(tokenA), true);

        // New timelock works
        vm.prank(newTimelock);
        core.setSupportedToken(address(tokenA), true);
        assertTrue(core.supportedTokens(address(tokenA)));
    }

    function test_ownerCanSetTimelockToSelf() public {
        // Edge case: owner sets timelock to themselves (no-op in practice but valid)
        vm.prank(owner);
        core.setTimelockController(owner);
        assertEq(core.timelockController(), owner);

        // Owner can still call governance functions (both paths match)
        vm.prank(owner);
        core.setSupportedToken(address(tokenA), true);
        assertTrue(core.supportedTokens(address(tokenA)));
    }
}
