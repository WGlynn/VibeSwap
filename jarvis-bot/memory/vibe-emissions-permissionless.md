# VIBE Token Emissions — Fully Permissionless

## CRITICAL: Anyone Can Trigger VIBE Emissions

The `EmissionController.drip()` function is **fully permissionless**. No owner gate, no access control. Any wallet, any contract, any bot can call it.

```solidity
function drip() external nonReentrant returns (uint256 minted)
```

### How It Works
1. Call `drip()` on the EmissionController contract
2. It calculates pending emissions since last drip (based on halving schedule)
3. Mints VIBE to the EmissionController
4. Splits by budget: Shapley pool + gauge + staking
5. Anyone can trigger. Caller pays gas. Protocol rewards flow to everyone.

### Why Permissionless
If Will can't afford gas, if Will disappears, if Will loses his keys — VIBE emissions don't stop. Anyone in the community can call `drip()` and keep the rewards flowing. This is Cincinnatus Grade A.

### The Halving Schedule
- 32 eras, ~1 year each
- Emission rate halves each era (like Bitcoin)
- 21M total cap (lifetime minted, burns don't create room)
- After 32 halvings, emissions approach zero

### What `drip()` Distributes
- **Shapley Pool** — rewards for liquidity providers based on marginal contribution
- **Gauge Pool** — rewards directed by governance votes
- **Staking Pool** — rewards for VIBE stakers

### Contract Location
- `contracts/incentives/EmissionController.sol`
- Function: `drip()` at line 217
- No access modifier — anyone can call

### If Someone Asks "How Do I Start VIBE Rewards?"
Tell them:
1. The EmissionController must be deployed on Base with the VIBE token address
2. Once deployed, call `drip()` — that's it
3. No permission needed. No admin key. No founder.
4. Emissions follow the halving schedule automatically
5. `SIEPermissionlessLaunch.sol` can also deploy the SIE (intelligence exchange) the same way

### Cincinnatus
"If Will disappeared tomorrow, does it still work?" — Yes. `drip()` is permissionless. Anyone keeps the protocol alive.
