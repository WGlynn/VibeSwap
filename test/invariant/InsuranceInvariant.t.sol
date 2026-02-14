// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "forge-std/Test.sol";
import "forge-std/StdInvariant.sol";
import "../../contracts/financial/VibeInsurance.sol";
import "../../contracts/financial/interfaces/IVibeInsurance.sol";
import "../../contracts/oracle/IReputationOracle.sol";
import "@openzeppelin/contracts/token/ERC20/ERC20.sol";

// ============ Mocks ============

contract MockInvToken is ERC20 {
    constructor(string memory name_, string memory symbol_) ERC20(name_, symbol_) {}
    function mint(address to, uint256 amount) external { _mint(to, amount); }
}

contract MockInvOracle is IReputationOracle {
    mapping(address => uint8) public tiers;

    function setTier(address user, uint8 tier) external { tiers[user] = tier; }
    function getTrustScore(address user) external view returns (uint256) { return uint256(tiers[user]) * 2500; }
    function getTrustTier(address user) external view returns (uint8) { return tiers[user]; }
    function isEligible(address user, uint8 requiredTier) external view returns (bool) { return tiers[user] >= requiredTier; }
}

// ============ Handler ============

/**
 * @title InsuranceHandler
 * @notice Bounded random operations against VibeInsurance for invariant testing.
 *         Tracks ghost variables for protocol-wide property assertions.
 */
contract InsuranceHandler is Test {
    VibeInsurance public ins;
    MockInvToken public collateral;
    MockInvOracle public oracle;

    address[] public actors;
    uint8 public marketId; // single market for focused invariant testing

    // Ghost variables
    uint256 public ghost_totalUnderwritten;
    uint256 public ghost_totalPremiumsPaid;
    uint256 public ghost_totalClaimed;
    uint256 public ghost_policiesBought;
    uint256 public ghost_underwriteCount;
    uint256 public ghost_claimCount;
    uint256 public ghost_withdrawCount;
    bool public ghost_resolved;
    bool public ghost_triggered;
    bool public ghost_settled;

    // Track individual underwriter deposits
    mapping(address => uint256) public ghost_underwriterDeposits;
    mapping(uint256 => bool) public ghost_policyClaimed;

    // Track minted policy IDs
    uint256[] public policyIds;

    constructor(
        VibeInsurance _ins,
        MockInvToken _collateral,
        MockInvOracle _oracle,
        uint8 _marketId
    ) {
        ins = _ins;
        collateral = _collateral;
        oracle = _oracle;
        marketId = _marketId;

        // Create 10 actors
        for (uint256 i = 0; i < 10; i++) {
            address actor = address(uint160(i + 2000));
            actors.push(actor);
            // Set random-ish tiers
            oracle.setTier(actor, uint8(i % 5));
            // Fund and approve
            collateral.mint(actor, 100_000_000 ether);
            vm.prank(actor);
            collateral.approve(address(ins), type(uint256).max);
        }
    }

    // ============ Handler Actions ============

    function underwrite(uint256 actorSeed, uint256 amount) public {
        if (ghost_resolved) return; // can't underwrite after resolution

        address actor = actors[actorSeed % actors.length];
        amount = bound(amount, 0.1 ether, 100_000 ether);

        vm.prank(actor);
        try ins.underwrite(marketId, amount) {
            ghost_totalUnderwritten += amount;
            ghost_underwriterDeposits[actor] += amount;
            ghost_underwriteCount++;
        } catch {}
    }

    function buyPolicy(uint256 actorSeed, uint256 coverage) public {
        if (ghost_resolved) return;

        address actor = actors[actorSeed % actors.length];

        // Bound coverage to available capacity
        uint256 capacity = ins.availableCapacity(marketId);
        if (capacity == 0) return;
        coverage = bound(coverage, 1, capacity);

        uint256 premium = ins.effectivePremium(marketId, coverage, actor);

        vm.prank(actor);
        try ins.buyPolicy(marketId, coverage) returns (uint256 policyId) {
            ghost_totalPremiumsPaid += premium;
            ghost_policiesBought++;
            policyIds.push(policyId);
        } catch {}
    }

    function resolve(bool triggered) public {
        if (ghost_resolved) return;

        IVibeInsurance.InsuranceMarket memory mkt = ins.getMarket(marketId);
        vm.warp(uint256(mkt.windowEnd) + 1);

        try ins.resolveMarket(marketId, triggered) {
            ghost_resolved = true;
            ghost_triggered = triggered;
        } catch {}
    }

    function claimPayout(uint256 policySeed) public {
        if (!ghost_resolved || !ghost_triggered) return;
        if (policyIds.length == 0) return;

        uint256 idx = policySeed % policyIds.length;
        uint256 policyId = policyIds[idx];

        if (ghost_policyClaimed[policyId]) return;

        IVibeInsurance.Policy memory pol = ins.getPolicy(policyId);
        if (pol.state != IVibeInsurance.PolicyState.ACTIVE) return;

        vm.prank(pol.holder);
        try ins.claimPayout(policyId) {
            ghost_totalClaimed += pol.coverage;
            ghost_policyClaimed[policyId] = true;
            ghost_claimCount++;
        } catch {}
    }

    function settle() public {
        if (!ghost_resolved || ghost_settled) return;

        vm.warp(block.timestamp + 30 days + 1);
        try ins.settleMarket(marketId) {
            ghost_settled = true;
        } catch {}
    }

    function withdrawCapital(uint256 actorSeed) public {
        if (!ghost_resolved) return;
        // If triggered, must be settled first
        if (ghost_triggered && !ghost_settled) return;

        address actor = actors[actorSeed % actors.length];
        if (ghost_underwriterDeposits[actor] == 0) return;

        vm.prank(actor);
        try ins.withdrawCapital(marketId) {
            ghost_withdrawCount++;
        } catch {}
    }

    // ============ View Helpers ============

    function policyCount() external view returns (uint256) {
        return policyIds.length;
    }
}

// ============ Invariant Tests ============

/**
 * @title Insurance Invariant Tests
 * @notice Protocol-wide invariants verified under random sequences of operations.
 *         Mandatory verification layer — part of VSOS build standard.
 *
 *         Properties tested:
 *         1. Coverage is always backed by capital (solvency)
 *         2. Claims never exceed the pool
 *         3. Premium accounting is consistent
 *         4. Market state transitions are monotonic
 *         5. Policy count matches minted NFTs
 */
contract InsuranceInvariantTest is StdInvariant, Test {
    VibeInsurance public ins;
    MockInvToken public usdc;
    MockInvToken public jul;
    MockInvOracle public oracle;
    InsuranceHandler public handler;

    uint8 public marketId;

    function setUp() public {
        jul = new MockInvToken("JUL Token", "JUL");
        usdc = new MockInvToken("USD Coin", "USDC");
        oracle = new MockInvOracle();

        ins = new VibeInsurance(address(jul), address(oracle), address(usdc));

        // Create a market
        marketId = ins.createMarket(IVibeInsurance.CreateMarketParams({
            description: "Invariant test: ETH 30% drop",
            triggerType: IVibeInsurance.TriggerType.PRICE_DROP,
            triggerData: bytes32(uint256(3000)),
            windowStart: uint40(block.timestamp + 1),
            windowEnd: uint40(block.timestamp + 1 + 30 days),
            premiumBps: 500
        }));

        // Deposit JUL for keeper tips
        jul.mint(address(this), 1_000_000 ether);
        jul.approve(address(ins), type(uint256).max);
        ins.depositJulRewards(1000 ether);

        // Setup handler
        handler = new InsuranceHandler(ins, usdc, oracle, marketId);

        // Target the handler for invariant testing
        targetContract(address(handler));
    }

    // ============ Solvency Invariants ============

    /**
     * @notice CRITICAL: Coverage is always backed by capital.
     *         totalCoverage <= totalCapital at all times.
     *         This is THE core insurance invariant — violation = insolvency.
     */
    function invariant_coverageBackedByCapital() public view {
        IVibeInsurance.InsuranceMarket memory mkt = ins.getMarket(marketId);
        assertLe(
            mkt.totalCoverage,
            mkt.totalCapital,
            "SOLVENCY VIOLATION: coverage exceeds capital"
        );
    }

    /**
     * @notice Claims never exceed the total pool (capital + premiums).
     *         If this fails, the contract is paying out money it doesn't have.
     */
    function invariant_claimsNotExceedPool() public view {
        IVibeInsurance.InsuranceMarket memory mkt = ins.getMarket(marketId);
        assertLe(
            mkt.totalClaimed,
            mkt.totalCapital + mkt.totalPremiums,
            "PAYOUT VIOLATION: claims exceed pool"
        );
    }

    /**
     * @notice Contract's actual token balance must be >= what it owes.
     *         Pool's real collateral balance covers outstanding obligations.
     */
    function invariant_contractSolvent() public view {
        uint256 balance = usdc.balanceOf(address(ins));
        IVibeInsurance.InsuranceMarket memory mkt = ins.getMarket(marketId);

        // Contract holds: capital + premiums - claims already paid
        uint256 expectedMin = 0;
        if (mkt.totalCapital + mkt.totalPremiums > mkt.totalClaimed) {
            expectedMin = mkt.totalCapital + mkt.totalPremiums - mkt.totalClaimed;
        }

        assertGe(
            balance,
            expectedMin,
            "BALANCE VIOLATION: contract holds less than expected"
        );
    }

    // ============ Accounting Invariants ============

    /**
     * @notice totalCapital matches the sum of ghost underwriter deposits.
     */
    function invariant_capitalMatchesDeposits() public view {
        IVibeInsurance.InsuranceMarket memory mkt = ins.getMarket(marketId);
        assertEq(
            mkt.totalCapital,
            handler.ghost_totalUnderwritten(),
            "Capital accounting mismatch"
        );
    }

    /**
     * @notice Policy count from contract matches handler's tracking.
     */
    function invariant_policyCountConsistent() public view {
        assertEq(
            ins.totalPolicies(),
            handler.ghost_policiesBought(),
            "Policy count mismatch"
        );
    }

    /**
     * @notice Available capacity = totalCapital - totalCoverage (never negative).
     */
    function invariant_availableCapacityConsistent() public view {
        IVibeInsurance.InsuranceMarket memory mkt = ins.getMarket(marketId);
        uint256 expected = 0;
        if (mkt.totalCapital > mkt.totalCoverage) {
            expected = mkt.totalCapital - mkt.totalCoverage;
        }
        assertEq(
            ins.availableCapacity(marketId),
            expected,
            "Available capacity inconsistent"
        );
    }

    // ============ State Transition Invariants ============

    /**
     * @notice Market state transitions are monotonic: OPEN → RESOLVED → SETTLED.
     *         Can never go backwards.
     */
    function invariant_marketStateMonotonic() public view {
        IVibeInsurance.InsuranceMarket memory mkt = ins.getMarket(marketId);

        if (handler.ghost_settled()) {
            assertTrue(
                mkt.state == IVibeInsurance.MarketState.SETTLED,
                "Settled flag set but market not SETTLED"
            );
        } else if (handler.ghost_resolved()) {
            assertTrue(
                mkt.state == IVibeInsurance.MarketState.RESOLVED ||
                mkt.state == IVibeInsurance.MarketState.SETTLED,
                "Resolved flag set but market still OPEN"
            );
        }
    }

    /**
     * @notice Triggered flag only set when market is actually triggered.
     */
    function invariant_triggerConsistency() public view {
        IVibeInsurance.InsuranceMarket memory mkt = ins.getMarket(marketId);

        if (mkt.state == IVibeInsurance.MarketState.OPEN) {
            assertFalse(mkt.triggered, "Open market cannot be triggered");
        }

        if (handler.ghost_triggered()) {
            assertTrue(mkt.triggered, "Handler triggered but market says not triggered");
        }
    }

    // ============ Call Summary ============

    function invariant_callSummary() public view {
        console.log("--- Insurance Invariant Summary ---");
        console.log("Underwrite calls:", handler.ghost_underwriteCount());
        console.log("Total underwritten:", handler.ghost_totalUnderwritten());
        console.log("Policies bought:", handler.ghost_policiesBought());
        console.log("Total premiums:", handler.ghost_totalPremiumsPaid());
        console.log("Claims:", handler.ghost_claimCount());
        console.log("Total claimed:", handler.ghost_totalClaimed());
        console.log("Withdrawals:", handler.ghost_withdrawCount());
        console.log("Resolved:", handler.ghost_resolved());
        console.log("Triggered:", handler.ghost_triggered());
        console.log("Settled:", handler.ghost_settled());
    }
}
