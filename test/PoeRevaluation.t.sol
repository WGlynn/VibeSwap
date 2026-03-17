// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "forge-std/Test.sol";
import "../contracts/incentives/PoeRevaluation.sol";
import "../contracts/mechanism/AugmentedBondingCurve.sol";
import "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import "@openzeppelin/contracts/proxy/ERC1967/ERC1967Proxy.sol";

/// @dev Mock ERC20 for testing
contract MockVIBE is ERC20 {
    constructor() ERC20("VIBE", "VIBE") {
        _mint(msg.sender, 21_000_000e18);
    }
    function mint(address to, uint256 amount) external { _mint(to, amount); }
    function burnFrom(address from, uint256 amount) external { _burn(from, amount); }
}

contract PoeRevaluationTest is Test {
    PoeRevaluation public poe;
    MockVIBE public vibe;
    AugmentedBondingCurve public abc;

    address owner = address(this);
    address contributor = address(0xC0FFEE);
    address staker1 = address(0xBEEF);
    address staker2 = address(0xDEAD);

    function setUp() public {
        vibe = new MockVIBE();

        // Deploy POE via proxy
        PoeRevaluation impl = new PoeRevaluation();
        bytes memory initData = abi.encodeWithSelector(
            PoeRevaluation.initialize.selector,
            owner,
            address(vibe),
            address(0x1), // emission controller (mock)
            address(0x2)  // shapley distributor (mock)
        );
        ERC1967Proxy proxy = new ERC1967Proxy(address(impl), initData);
        poe = PoeRevaluation(address(proxy));

        // Distribute VIBE to stakers
        vibe.transfer(staker1, 100_000e18);
        vibe.transfer(staker2, 100_000e18);
    }

    function test_propose() public {
        uint256 id = poe.propose(
            contributor,
            keccak256("evidence"),
            "Early MEV research that shaped commit-reveal",
            500 // 5% of Shapley pool
        );
        assertEq(id, 0, "First proposal should be ID 0");

        (address proposer, address c,,,,,,, PoeRevaluation.ProposalState state,) = poe.getProposal(0);
        assertEq(proposer, address(this));
        assertEq(c, contributor);
        assertEq(uint8(state), uint8(PoeRevaluation.ProposalState.PROPOSED));
    }

    function test_propose_revertsTooMuch() public {
        vm.expectRevert(PoeRevaluation.RequestedTooMuch.selector);
        poe.propose(contributor, keccak256("evidence"), "Too greedy", 1001); // > 10%
    }

    function test_propose_revertsZeroAddress() public {
        vm.expectRevert(PoeRevaluation.ZeroAddress.selector);
        poe.propose(address(0), keccak256("evidence"), "No one", 500);
    }

    function test_stakeConviction() public {
        poe.propose(contributor, keccak256("evidence"), "Undervalued work", 500);

        vm.startPrank(staker1);
        vibe.approve(address(poe), 50_000e18);
        poe.stakeConviction(0, 50_000e18);
        vm.stopPrank();

        (,,,, uint256 totalStaked,,,,, ) = poe.getProposal(0);
        assertEq(totalStaked, 50_000e18);
    }

    function test_convictionThreshold() public {
        // 0.1% of 21M = 21,000 VIBE
        uint256 threshold = poe.getConvictionThreshold();
        assertEq(threshold, 21_000e18);
    }

    function test_reachesExecutable() public {
        poe.propose(contributor, keccak256("evidence"), "Foundational work", 500);

        // Stake enough to meet threshold (21,000 VIBE)
        vm.startPrank(staker1);
        vibe.approve(address(poe), 25_000e18);
        poe.stakeConviction(0, 25_000e18);
        vm.stopPrank();

        (,,,,,,, uint256 convictionMetAt, PoeRevaluation.ProposalState state,) = poe.getProposal(0);
        assertEq(uint8(state), uint8(PoeRevaluation.ProposalState.EXECUTABLE));
        assertGt(convictionMetAt, 0);
    }

    function test_execute_revertsBeforeConvictionPeriod() public {
        poe.propose(contributor, keccak256("evidence"), "Too early", 500);

        vm.startPrank(staker1);
        vibe.approve(address(poe), 25_000e18);
        poe.stakeConviction(0, 25_000e18);
        vm.stopPrank();

        // Try to execute immediately — should fail (7 day conviction period)
        vm.expectRevert(PoeRevaluation.ConvictionPeriodNotMet.selector);
        poe.execute(0);
    }

    function test_execute_afterConvictionPeriod() public {
        poe.propose(contributor, keccak256("evidence"), "Poe's legacy", 500);

        vm.startPrank(staker1);
        vibe.approve(address(poe), 25_000e18);
        poe.stakeConviction(0, 25_000e18);
        vm.stopPrank();

        // Fast forward 7 days
        vm.warp(block.timestamp + 7 days + 1);

        poe.execute(0);

        (,,,,,,,, PoeRevaluation.ProposalState state,) = poe.getProposal(0);
        assertEq(uint8(state), uint8(PoeRevaluation.ProposalState.EXECUTED));
    }

    function test_cooldown() public {
        poe.propose(contributor, keccak256("ev1"), "First revaluation", 500);

        vm.startPrank(staker1);
        vibe.approve(address(poe), 25_000e18);
        poe.stakeConviction(0, 25_000e18);
        vm.stopPrank();

        vm.warp(block.timestamp + 7 days + 1);
        poe.execute(0);

        // Try to propose again for same contributor — should fail (30 day cooldown)
        vm.expectRevert();
        poe.propose(contributor, keccak256("ev2"), "Too soon", 500);
    }

    function test_unstake_afterExecution() public {
        poe.propose(contributor, keccak256("evidence"), "Unstake test", 500);

        vm.startPrank(staker1);
        vibe.approve(address(poe), 25_000e18);
        poe.stakeConviction(0, 25_000e18);
        vm.stopPrank();

        vm.warp(block.timestamp + 7 days + 1);
        poe.execute(0);

        uint256 balBefore = vibe.balanceOf(staker1);
        vm.prank(staker1);
        poe.unstake(0);
        uint256 balAfter = vibe.balanceOf(staker1);

        assertEq(balAfter - balBefore, 25_000e18, "Should get full stake back");
    }

    function test_reject() public {
        poe.propose(contributor, keccak256("evidence"), "Will be rejected", 500);

        poe.reject(0, "Insufficient evidence");

        (,,,,,,,, PoeRevaluation.ProposalState state,) = poe.getProposal(0);
        assertEq(uint8(state), uint8(PoeRevaluation.ProposalState.REJECTED));
    }

    function test_reject_onlyOwner() public {
        poe.propose(contributor, keccak256("evidence"), "Not your call", 500);

        vm.prank(staker1);
        vm.expectRevert();
        poe.reject(0, "Not authorized");
    }

    function test_proposalExpiry() public {
        poe.propose(contributor, keccak256("evidence"), "Will expire", 500);

        // Fast forward 91 days (past 90-day expiry)
        vm.warp(block.timestamp + 91 days);

        // Trying to stake should mark as expired
        vm.startPrank(staker1);
        vibe.approve(address(poe), 1000e18);
        vm.expectRevert(PoeRevaluation.ProposalExpired.selector);
        poe.stakeConviction(0, 1000e18);
        vm.stopPrank();
    }

    function test_sealBondingCurve_irreversible() public {
        // Deploy a mock ABC
        MockVIBE reserveToken = new MockVIBE();
        AugmentedBondingCurve mockABC = new AugmentedBondingCurve(
            address(reserveToken),
            address(vibe),
            address(vibe),
            6, 200, 500
        );
        reserveToken.mint(address(mockABC), 1000e18);
        mockABC.openCurve(1000e18, 100e18, vibe.totalSupply());

        // Seal
        poe.sealBondingCurve(address(mockABC));
        assertTrue(poe.bondingCurveSealed());

        // Try to seal again — should revert
        vm.expectRevert(PoeRevaluation.BondingCurveAlreadySealed.selector);
        poe.sealBondingCurve(address(mockABC));
    }
}
