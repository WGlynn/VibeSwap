# VibeSwap Deployment Runbook

## Prerequisites

- **Private key** with sufficient ETH for gas (~0.5 ETH on L2, ~2 ETH on mainnet)
- **Multisig wallet** (e.g., Safe) deployed on target chain
- **Guardian address** for emergency pause capability
- **Oracle signer** key pair for off-chain price feeds
- **Keeper bot** address for automated emission drip/drain

## Environment Variables

```bash
# Required
export PRIVATE_KEY=0x...
export GUARDIAN_ADDRESS=0x...
export ORACLE_SIGNER=0x...

# Optional (defaults to deployer)
export OWNER_ADDRESS=0x...
export MULTISIG_ADDRESS=0x...
export KEEPER_ADDRESS=0x...
```

## Deployment Order

Contracts must be deployed in this exact sequence due to inter-contract dependencies.

### Phase 1: Core Trading System

```bash
forge script script/DeployProduction.s.sol --rpc-url $RPC_URL --broadcast --verify
```

**Deploys:** VibeSwapCore, CommitRevealAuction, VibeAMM, DAOTreasury, CrossChainRouter, TruePriceOracle, StablecoinFlowRegistry, FeeRouter, ProtocolFeeAdapter, BuybackEngine

**Post-deploy:**
- Copy all output addresses to `.env`
- Run `VerifyDeployment.s.sol` to validate

### Phase 2: Pool Creation

```bash
forge script script/SetupMVP.s.sol --rpc-url $RPC_URL --broadcast
```

**Creates:** ETH/USDC, ETH/USDT, USDC/USDT, WBTC/USDC, ETH/WBTC pools with liquidity protection

**Post-deploy:**
- Add initial liquidity: `SetupMVP.s.sol:AddInitialLiquidity`
- Set token prices: `SetupMVP.s.sol:UpdateTokenPrices`

### Phase 3: Incentive Vaults

```bash
# Set Phase 1 addresses
export VIBE_AMM=0x...       # From Phase 1 output
export VIBESWAP_CORE=0x...  # From Phase 1 output
export DAO_TREASURY=0x...   # From Phase 1 output

forge script script/DeployIncentives.s.sol --rpc-url $RPC_URL --broadcast --verify
```

**Deploys:** VolatilityOracle, IncentiveController, VolatilityInsurancePool, ILProtectionVault, SlippageGuaranteeFund, LoyaltyRewardsManager, MerkleAirdrop

**Auto-configured:**
- IncentiveController.setVolatilityOracle(VolatilityOracle)
- IncentiveController.setVolatilityInsurancePool(VolatilityInsurancePool)
- IncentiveController.setILProtectionVault(ILProtectionVault)
- IncentiveController.setSlippageGuaranteeFund(SlippageGuaranteeFund)
- IncentiveController.setLoyaltyRewardsManager(LoyaltyRewardsManager)
- IncentiveController authorizes VibeAMM + VibeSwapCore as callers
- VibeAMM.setIncentiveController(IncentiveController) -- enables LP lifecycle hooks + volatility fee routing
- VibeSwapCore.setIncentiveController(IncentiveController) -- enables execution tracking + slippage compensation
- FeeRouter.setInsurance(VolatilityInsurancePool) -- redirects 20% fee split from deployer to actual insurance pool

**Post-deploy:**
- Fund VolatilityInsurancePool with initial reserves
- Fund SlippageGuaranteeFund with initial reserves

### Phase 4: Tokenomics Layer

```bash
export VIBESWAP_CORE=0x...  # From Phase 1 output

forge script script/DeployTokenomics.s.sol --rpc-url $RPC_URL --broadcast --verify
```

**Deploys:** VIBEToken, Joule, ShapleyDistributor, PriorityRegistry, LiquidityGauge, SingleStaking, EmissionController

**Auto-configured:**
- VIBEToken.setMinter(EmissionController)
- ShapleyDistributor.setAuthorizedCreator(EmissionController)
- ShapleyDistributor.setAuthorizedCreator(VibeSwapCore)
- SingleStaking ownership → EmissionController
- EmissionController.setAuthorizedDrainer(owner)

**Post-deploy:**
- Update BuybackEngine: `BuybackEngine.setProtocolToken(VIBE_TOKEN)`
- Wire IncentiveController: `IncentiveController.setShapleyDistributor(SHAPLEY_DISTRIBUTOR)`
- Wire FeeRouter revShare: `FeeRouter.setRevShare(VIBE_REVSHARE)` (deploy VibeRevShare first)
- Create gauges: `DeployTokenomics.s.sol:SetupGauges`
- Start emissions: `DeployTokenomics.s.sol:StartEmissions`

### Phase 5: Compliance Layer

```bash
export VIBESWAP_CORE=0x...  # From Phase 1 output

forge script script/DeployCompliance.s.sol --rpc-url $RPC_URL --broadcast --verify
```

**Deploys:** FederatedConsensus, ClawbackRegistry, ClawbackVault, ComplianceRegistry

**Auto-configured:**
- FederatedConsensus.setExecutor(ClawbackRegistry)
- ClawbackRegistry.setVault(ClawbackVault)
- ClawbackRegistry.setAuthorizedTracker(VibeSwapCore)
- ComplianceRegistry.setAuthorizedContract(VibeSwapCore)

**Post-deploy:**
- Add compliance authorities: `FederatedConsensus.addAuthority(addr, role, jurisdiction)`
- Set compliance officers: `ComplianceRegistry.setComplianceOfficer(addr, true)`
- Set KYC providers: `ComplianceRegistry.setKYCProvider(addr, true)`

### Phase 6: Governance Layer

```bash
export VIBE_AMM=0x...            # From Phase 1 output
export DAO_TREASURY=0x...        # From Phase 1 output
export VOLATILITY_ORACLE=0x...   # From Phase 3 output
export JOULE_TOKEN=0x...         # From Phase 4 output (optional)
export FEDERATED_CONSENSUS=0x... # From Phase 5 output (optional)

forge script script/DeployGovernance.s.sol --rpc-url $RPC_URL --broadcast --verify
```

**Deploys:** TreasuryStabilizer, VibeTimelock, VibeKeeperNetwork, DisputeResolver

**Post-deploy:**
- TreasuryStabilizer.setMainPool(token, poolId) for each managed token
- VibeKeeperNetwork.registerTask(...) for automated jobs (drip, settle, etc.)
- DisputeResolver.setTribunal(tribunalAddress) if DecentralizedTribunal deployed

### Phase 7: Financial Instruments

```bash
export JOULE_TOKEN=0x...         # From Phase 4 output
export VIBE_AMM=0x...            # From Phase 1 output
export VOLATILITY_ORACLE=0x...   # From Phase 3 output
export FEE_ROUTER=0x...          # From Phase 1 output
export REVENUE_TOKEN=0x...       # Stablecoin address (e.g., USDC)
export COLLATERAL_TOKEN=0x...    # Insurance collateral token

forge script script/DeployFinancial.s.sol --rpc-url $RPC_URL --broadcast --verify
```

**Deploys:** VibeRevShare, VibeInsurance, VibeBonds, VibeOptions, VibeStream, VestingSchedule

**Auto-configured:**
- FeeRouter.setRevShare(VibeRevShare) -- completes 30% revenue share pipeline
- VibeRevShare.setRevenueSource(FeeRouter) -- authorizes revenue deposits

**Post-deploy:**
- VibeInsurance.setTriggerResolver(keeperAddr, true)
- VestingSchedule.createSchedule(...) for team/investor vesting
- BuybackEngine.setProtocolToken(VIBE_TOKEN) if not already set

### Phase 8: Identity Layer

```bash
export VIBE_TOKEN=0x...  # From Phase 3 output

forge script script/DeployIdentity.s.sol --rpc-url $RPC_URL --broadcast --verify
```

**Deploys:** SoulboundIdentity, AgentRegistry, ContributionDAG, VibeCode, RewardLedger, ContributionAttestor

### Phase 9: Genesis Contributions

```bash
export CONTRIBUTION_DAG=0x...    # From Phase 4
export REWARD_LEDGER=0x...       # From Phase 4
export FARADAY1_ADDRESS=0x...    # Will's address
export JARVIS_ADDRESS=0x...      # Jarvis agent address
export FREEDOM_WARRIOR_ADDRESS=0x... # FreedomWarrior13's address

forge script script/GenesisContributions.s.sol --rpc-url $RPC_URL --broadcast
```

**Records:** Retroactive contributions for founders (NOT finalized — requires 3-factor validation)

### Phase 10: Cross-Chain Setup

```bash
forge script script/ConfigurePeers.s.sol --rpc-url $RPC_URL --broadcast
```

**Configures:** LayerZero V2 peer connections to other deployed chains

### Phase 11: Ownership Transfer

```bash
export MULTISIG_ADDRESS=0x...

# Transfer core contracts
forge script script/DeployProduction.s.sol:TransferOwnership --rpc-url $RPC_URL --broadcast

# Transfer incentive contracts
forge script script/DeployIncentives.s.sol:TransferIncentivesOwnership --rpc-url $RPC_URL --broadcast

# Transfer tokenomics contracts
forge script script/DeployTokenomics.s.sol:TransferTokenomicsOwnership --rpc-url $RPC_URL --broadcast
```

**Transfers:** All contract ownership to multisig (40+ contracts)

```bash
# Transfer governance contracts
forge script script/DeployGovernance.s.sol:TransferGovernanceOwnership --rpc-url $RPC_URL --broadcast

# Transfer compliance contracts
forge script script/DeployCompliance.s.sol:TransferComplianceOwnership --rpc-url $RPC_URL --broadcast

# Transfer financial contracts
forge script script/DeployFinancial.s.sol:TransferFinancialOwnership --rpc-url $RPC_URL --broadcast
```

### Phase 12: Start Operations

1. **Oracle**: `python -m oracle.main` (off-chain Kalman filter)
2. **Keeper bot**: Schedule `EmissionController.drip()` calls (every ~10 min)
3. **Frontend**: Update `.env` with all contract addresses, deploy to Vercel
4. **Monitor**: Watch events for first drip, first swap, first Shapley game

## Verification Checklist

After full deployment, verify:

- [ ] All proxy contracts have correct implementation code
- [ ] All ownership is set to intended addresses
- [ ] VIBEToken has EmissionController as only minter
- [ ] ShapleyDistributor authorized creators = [EmissionController, VibeSwapCore]
- [ ] SingleStaking owner = EmissionController
- [ ] Guardian can pause VibeSwapCore
- [ ] CircuitBreaker thresholds are configured
- [ ] Flash loan protection enabled
- [ ] TWAP validation enabled
- [ ] Rate limiting configured (1M/hr/user)
- [ ] Oracle signer authorized on TruePriceOracle + StablecoinFlowRegistry
- [ ] Pools created with liquidity protection
- [ ] Token prices set (for liquidity protection USD calculations)
- [ ] IncentiveController vaults wired (VolatilityInsurancePool, ILProtectionVault, SlippageGuaranteeFund, LoyaltyRewardsManager)
- [ ] IncentiveController authorized callers = [VibeAMM, VibeSwapCore]
- [ ] IncentiveController.shapleyDistributor set (after DeployTokenomics)
- [ ] VolatilityInsurancePool + SlippageGuaranteeFund funded with initial reserves
- [ ] Fee pipeline: AMM → FeeAdapter → FeeRouter → (Treasury 40%, Insurance 20%, RevShare 30%, Buyback 10%)
- [ ] EmissionController.drip() succeeds
- [ ] Test swap completes full commit → reveal → settle cycle
- [ ] FederatedConsensus.executor = ClawbackRegistry
- [ ] ClawbackRegistry.vault = ClawbackVault
- [ ] ClawbackRegistry authorized trackers include VibeSwapCore
- [ ] ComplianceRegistry authorized contracts include VibeSwapCore
- [ ] FederatedConsensus has >= approvalThreshold authorities registered
- [ ] TreasuryStabilizer wired to VibeAMM + DAOTreasury + VolatilityOracle
- [ ] VibeTimelock min delay >= 2 days
- [ ] FeeRouter.revShare = VibeRevShare (after DeployFinancial)
- [ ] VibeRevShare.revenueSource(FeeRouter) = true

## Emergency Procedures

### Pause All Trading
```bash
forge script script/DeployProduction.s.sol:EmergencyPause --rpc-url $RPC_URL --broadcast
```
Guardian or owner can call. Resumes with `VibeSwapCore.unpause()`.

### Contract Upgrade
UUPS upgrades require:
1. Deploy new implementation
2. Call `upgradeToAndCall(newImpl, "")` from owner/multisig
3. Verify new implementation on block explorer

### Emission Emergency
If EmissionController is compromised:
1. `VIBEToken.setMinter(emissionController, false)` — revoke minting
2. MAX_SUPPLY hard cap in VIBEToken prevents over-minting regardless

## Supported Chains

| Chain | Chain ID | LZ Endpoint | WETH |
|-------|----------|-------------|------|
| Ethereum | 1 | 0x1a44...728c | 0xC02a...6Cc2 |
| Arbitrum | 42161 | 0x1a44...728c | 0x82aF...Bab1 |
| Optimism | 10 | 0x1a44...728c | 0x4200...0006 |
| Base | 8453 | 0x1a44...728c | 0x4200...0006 |
| Polygon | 137 | 0x1a44...728c | 0x7ceB...f619 |
| Avalanche | 43114 | 0x1a44...728c | 0x49D5...0bAB |
| BSC | 56 | 0x1a44...728c | 0x2170...33F8 |
| Sepolia | 11155111 | 0x6EDC...f10f | env var |
| Base Sepolia | 84532 | 0x6EDC...f10f | env var |
