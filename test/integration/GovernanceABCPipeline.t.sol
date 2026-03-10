// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "forge-std/Test.sol";
import "../../contracts/mechanism/AugmentedBondingCurve.sol";
import "../../contracts/mechanism/ConvictionGovernance.sol";
import "@openzeppelin/contracts/token/ERC20/ERC20.sol";

// ============ Mocks ============

contract MockGovReserve is ERC20 {
    constructor() ERC20("Reserve", "DAI") {
        _mint(msg.sender, 1_000_000_000e18);
    }
    function mint(address to, uint256 amount) external { _mint(to, amount); }
}

contract MockGovToken is ERC20 {
    address public controller;
    constructor() ERC20("Community", "VIBE") {}
    function setController(address _c) external { controller = _c; }
    function mint(address to, uint256 amount) external {
        require(msg.sender == controller, "Not controller");
        _mint(to, amount);
    }
    function burnFrom(address from, uint256 amount) external {
        require(msg.sender == controller, "Not controller");
        _burn(from, amount);
    }
}

contract MockJUL is ERC20 {
    constructor() ERC20("JUL", "JUL") {
        _mint(msg.sender, 1_000_000_000e18);
    }
    function mint(address to, uint256 amount) external { _mint(to, amount); }
}

contract MockRepOracle {
    function isEligible(address, uint8) external pure returns (bool) { return true; }
    function getReputation(address) external pure returns (uint256) { return 100; }
    function getTier(address) external pure returns (uint8) { return 5; }
}

contract MockSoulbound {
    mapping(address => bool) public hasIdentity;
    function setIdentity(address addr, bool val) external { hasIdentity[addr] = val; }
}

// ============ Integration Test ============

contract GovernanceABCPipelineTest is Test {
    AugmentedBondingCurve public abc;
    ConvictionGovernance public governance;
    MockGovReserve public dai;
    MockGovToken public vibe;
    MockJUL public jul;
    MockRepOracle public repOracle;
    MockSoulbound public soulbound;

    address alice = address(0xA1);
    address bob = address(0xB0);
    address resolver = address(0xC0);

    uint256 constant KAPPA = 6;
    uint256 constant INIT_SUPPLY = 500_000_000e18;
    uint256 constant INIT_RESERVE = 3_000_000e18;
    uint256 constant INIT_FUNDING = 2_000_000e18;

    function setUp() public {
        dai = new MockGovReserve();
        vibe = new MockGovToken();
        jul = new MockJUL();
        repOracle = new MockRepOracle();
        soulbound = new MockSoulbound();

        // Deploy ABC
        abc = new AugmentedBondingCurve(
            address(dai),
            address(vibe),
            address(vibe),
            KAPPA,
            500,   // 5% entry tribute
            1000   // 10% exit tribute
        );
        vibe.setController(address(abc));

        // Mint initial supply and open curve
        vibe.setController(address(this));
        vibe.mint(alice, INIT_SUPPLY / 2);
        vibe.mint(bob, INIT_SUPPLY / 2);
        vibe.setController(address(abc));

        dai.mint(address(abc), INIT_RESERVE + INIT_FUNDING);
        abc.openCurve(INIT_RESERVE, INIT_FUNDING, INIT_SUPPLY);

        // Deploy governance
        governance = new ConvictionGovernance(
            address(jul),
            address(repOracle),
            address(soulbound)
        );

        // Wire governance as allocator on ABC
        abc.setAllocator(address(governance), true);
        governance.setBondingCurve(address(abc));
        governance.addResolver(resolver);

        // Setup identities
        soulbound.setIdentity(alice, true);
        soulbound.setIdentity(bob, true);

        // Give JUL to stakers
        jul.mint(alice, 100_000e18);
        jul.mint(bob, 100_000e18);

        vm.prank(alice);
        jul.approve(address(governance), type(uint256).max);
        vm.prank(bob);
        jul.approve(address(governance), type(uint256).max);
    }

    // ============ Test: Full Pipeline ============

    function test_fullGovernanceToABCAllocation() public {
        // 1. Alice creates a proposal requesting 100K DAI
        uint256 requestedAmount = 100_000e18;
        vm.prank(alice);
        uint256 proposalId = governance.createProposal("Fund community garden", bytes32(0), requestedAmount);

        // 2. Alice and Bob signal conviction
        vm.prank(alice);
        governance.signalConviction(proposalId, 50_000e18);
        vm.prank(bob);
        governance.signalConviction(proposalId, 50_000e18);

        // 3. Fast forward to accumulate enough conviction
        vm.warp(block.timestamp + 30 days);

        // 4. Trigger pass
        governance.triggerPass(proposalId);

        // Verify proposal passed
        IConvictionGovernance.GovernanceProposal memory p = governance.getProposal(proposalId);
        assertEq(uint(p.state), uint(IConvictionGovernance.GovernanceProposalState.PASSED));

        // 5. Record state before execution
        uint256 fundingBefore = abc.fundingPool();
        uint256 reserveBefore = abc.reserve();
        uint256 supplyBefore = vibe.totalSupply();
        uint256 aliceVibeBefore = vibe.balanceOf(alice);
        uint256 v0 = abc.invariantV0();

        // 6. Resolver executes — triggers allocateWithRebond
        vm.prank(resolver);
        governance.executeProposal(proposalId);

        // 7. Verify ABC state changes
        assertEq(abc.fundingPool(), fundingBefore - requestedAmount, "Funding pool should decrease");
        assertEq(abc.reserve(), reserveBefore + requestedAmount, "Reserve should increase");
        assertGt(vibe.totalSupply(), supplyBefore, "Supply should increase from minting");
        assertGt(vibe.balanceOf(alice), aliceVibeBefore, "Alice should receive minted tokens");

        // 8. Conservation invariant still holds
        uint256 currentV = abc.currentInvariant();
        uint256 tolerance = v0 / 1000;
        assertApproxEqAbs(currentV, v0, tolerance, "Conservation invariant violated after governance allocation");

        // 9. Proposal marked executed
        p = governance.getProposal(proposalId);
        assertEq(uint(p.state), uint(IConvictionGovernance.GovernanceProposalState.EXECUTED));
    }

    // ============ Test: Custom Beneficiary ============

    function test_customBeneficiaryReceivesTokens() public {
        address beneficiary = address(0xBEEF);

        vm.prank(alice);
        uint256 proposalId = governance.createProposal("Fund research", bytes32(0), 50_000e18);

        // Alice sets custom beneficiary
        vm.prank(alice);
        governance.setProposalBeneficiary(proposalId, beneficiary);

        // Build conviction
        vm.prank(alice);
        governance.signalConviction(proposalId, 50_000e18);
        vm.warp(block.timestamp + 30 days);
        governance.triggerPass(proposalId);

        // Execute
        vm.prank(resolver);
        governance.executeProposal(proposalId);

        // Beneficiary got the tokens, not proposer
        assertGt(vibe.balanceOf(beneficiary), 0, "Beneficiary should receive minted tokens");
    }

    // ============ Test: Insufficient Funding Reverts ============

    function test_revertWhenFundingInsufficient() public {
        // Request more than the entire funding pool
        uint256 tooMuch = INIT_FUNDING + 1e18;

        vm.prank(alice);
        uint256 proposalId = governance.createProposal("Too ambitious", bytes32(0), tooMuch);

        vm.prank(alice);
        governance.signalConviction(proposalId, 50_000e18);
        vm.warp(block.timestamp + 30 days);
        governance.triggerPass(proposalId);

        vm.prank(resolver);
        vm.expectRevert(IConvictionGovernance.FundingInsufficient.selector);
        governance.executeProposal(proposalId);
    }

    // ============ Test: No ABC Still Works (Backwards Compatible) ============

    function test_executeWithoutABCJustMarksExecuted() public {
        // Deploy a governance without bonding curve
        ConvictionGovernance gov2 = new ConvictionGovernance(
            address(jul),
            address(repOracle),
            address(soulbound)
        );
        gov2.addResolver(resolver);

        vm.prank(alice);
        uint256 proposalId = gov2.createProposal("Simple vote", bytes32(0), 1000e18);

        vm.prank(alice);
        jul.approve(address(gov2), type(uint256).max);
        vm.prank(alice);
        gov2.signalConviction(proposalId, 50_000e18);
        vm.warp(block.timestamp + 30 days);
        gov2.triggerPass(proposalId);

        // Execute without ABC — should just mark as executed
        vm.prank(resolver);
        gov2.executeProposal(proposalId);

        IConvictionGovernance.GovernanceProposal memory p = gov2.getProposal(proposalId);
        assertEq(uint(p.state), uint(IConvictionGovernance.GovernanceProposalState.EXECUTED));
    }

    // ============ Test: Price Increases After Allocation ============

    function test_priceIncreasesAfterAllocation() public {
        uint256 priceBefore = abc.spotPrice();

        vm.prank(alice);
        uint256 proposalId = governance.createProposal("Build bridge", bytes32(0), 200_000e18);

        vm.prank(alice);
        governance.signalConviction(proposalId, 50_000e18);
        vm.warp(block.timestamp + 30 days);
        governance.triggerPass(proposalId);

        vm.prank(resolver);
        governance.executeProposal(proposalId);

        uint256 priceAfter = abc.spotPrice();
        assertGt(priceAfter, priceBefore, "Price should increase after funding allocation to reserve");
    }

    // ============ Test: Multiple Proposals Sequential ============

    function test_multipleProposalsSequential() public {
        // Create and execute 3 proposals
        for (uint256 i = 0; i < 3; i++) {
            uint256 amount = 100_000e18;

            vm.prank(alice);
            uint256 pid = governance.createProposal("Proposal", bytes32(0), amount);

            vm.prank(alice);
            governance.signalConviction(pid, 50_000e18);
            vm.warp(block.timestamp + 30 days);
            governance.triggerPass(pid);

            vm.prank(resolver);
            governance.executeProposal(pid);

            // Remove signal for next round
            vm.prank(alice);
            governance.removeSignal(pid);
        }

        // Funding pool decreased by 300K total
        assertEq(abc.fundingPool(), INIT_FUNDING - 300_000e18, "Funding should decrease by 300K total");

        // Conservation invariant holds
        uint256 currentV = abc.currentInvariant();
        uint256 v0 = abc.invariantV0();
        uint256 tolerance = v0 / 1000;
        assertApproxEqAbs(currentV, v0, tolerance, "Conservation invariant violated after 3 allocations");
    }
}
