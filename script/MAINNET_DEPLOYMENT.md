# VibeSwap Mainnet Deployment Runbook

## Pre-Deployment Checklist

### 1. Security Audit
- [ ] Complete security audit by reputable firm
- [ ] All critical/high findings resolved
- [ ] Medium findings reviewed and addressed
- [ ] Audit report published

### 2. Testing
- [ ] All unit tests passing (`forge test`)
- [ ] Fuzz tests passing with 256+ runs
- [ ] Integration tests on testnet (Sepolia) complete
- [ ] Manual testing of all user flows complete
- [ ] Load testing for batch auction under high volume

### 3. Infrastructure
- [ ] Multi-sig wallet created (Gnosis Safe recommended)
  - Minimum 3/5 signers for mainnet
  - Signers are geographically distributed
  - Hardware wallets for all signers
- [ ] RPC endpoints configured (primary + fallback)
  - Alchemy/Infura for Ethereum
  - Chain-specific RPCs for L2s
- [ ] Monitoring and alerting setup
  - On-chain event monitoring
  - Oracle health monitoring
  - Circuit breaker alerts

### 4. Oracle Setup
- [ ] Oracle signer key generated (hardware wallet)
- [ ] Off-chain oracle tested on testnet
- [ ] Stablecoin data sources configured
- [ ] Exchange API keys obtained (Binance, Coinbase, etc.)
- [ ] Backup oracle infrastructure ready

### 5. Configuration
- [ ] Review `oracle/config/oracle.yaml` for production settings
- [ ] All environment variables set in `.env`
- [ ] Gas price limits appropriate for mainnet
- [ ] Circuit breaker thresholds reviewed

---

## Deployment Steps

### Environment Setup

```bash
# Clone repository
git clone https://github.com/WGlynn/vibeswap-private.git
cd vibeswap

# Install dependencies
forge install

# Build contracts
forge build

# Configure environment
cp .env.example .env
# Edit .env with production values
```

### Required Environment Variables

```bash
# Deployer (will be replaced by multisig)
PRIVATE_KEY=<deployer_private_key>

# Addresses
OWNER_ADDRESS=<initial_owner_or_multisig>
GUARDIAN_ADDRESS=<security_guardian>
MULTISIG_ADDRESS=<gnosis_safe_address>
ORACLE_SIGNER=<oracle_signer_address>

# RPC URLs
ETH_RPC_URL=https://eth-mainnet.g.alchemy.com/v2/<key>
ARB_RPC_URL=https://arb-mainnet.g.alchemy.com/v2/<key>
BASE_RPC_URL=https://base-mainnet.g.alchemy.com/v2/<key>

# Verification
ETHERSCAN_API_KEY=<etherscan_api_key>
```

### Step 1: Deploy to Mainnet

```bash
# Dry run first (no broadcast)
forge script script/DeployProduction.s.sol \
  --rpc-url $ETH_RPC_URL \
  -vvv

# If dry run successful, deploy with broadcast and verification
forge script script/DeployProduction.s.sol \
  --rpc-url $ETH_RPC_URL \
  --broadcast \
  --verify \
  --etherscan-api-key $ETHERSCAN_API_KEY \
  -vvv
```

### Step 2: Verify Deployment

```bash
# Export deployed addresses to .env (from deployment output)
export VIBESWAP_CORE=<address>
export VIBESWAP_AUCTION=<address>
export VIBESWAP_AMM=<address>
export VIBESWAP_TREASURY=<address>
export VIBESWAP_ROUTER=<address>
export TRUE_PRICE_ORACLE_ADDRESS=<address>
export STABLECOIN_REGISTRY_ADDRESS=<address>

# Run verification script
forge script script/VerifyDeployment.s.sol \
  --rpc-url $ETH_RPC_URL \
  -vvv
```

### Step 3: Configure Initial Pools

```bash
# Create ETH/USDC pool with liquidity protection
forge script script/SetupMVP.s.sol \
  --rpc-url $ETH_RPC_URL \
  --broadcast \
  -vvv
```

### Step 4: Start Oracle

```bash
# Configure oracle
cd oracle
cp .env.example .env
# Edit with production values

cp config/oracle.example.yaml config/oracle.yaml
# Edit active_chain and contract addresses

# Start oracle
python -m oracle.main
```

### Step 5: Transfer Ownership to Multisig

```bash
forge script script/DeployProduction.s.sol:TransferOwnership \
  --rpc-url $ETH_RPC_URL \
  --broadcast \
  -vvv
```

**IMPORTANT:** After running this script:
1. Go to Gnosis Safe
2. Accept ownership for each contract
3. Verify ownership transferred correctly

---

## Post-Deployment Verification

### On-Chain Checks

1. **Contract Verification**
   - [ ] All contracts verified on Etherscan
   - [ ] Proxy implementations correctly linked
   - [ ] Read functions accessible via Etherscan

2. **Ownership**
   - [ ] All contracts owned by multisig
   - [ ] Guardian address set correctly
   - [ ] No unexpected admin addresses

3. **Security Settings**
   - [ ] Flash loan protection: ENABLED
   - [ ] TWAP validation: ENABLED
   - [ ] Liquidity protection: ENABLED
   - [ ] Circuit breakers configured

4. **Oracle**
   - [ ] Oracle signer authorized
   - [ ] First price update successful
   - [ ] Stablecoin flow updates working

### Oracle Health Checks

```bash
# Check oracle status
curl http://localhost:9090/metrics

# Verify price updates on-chain
cast call $TRUE_PRICE_ORACLE_ADDRESS "getTruePrice(bytes32)" <pool_id>
```

---

## L2 Deployment (After Ethereum Mainnet)

### Arbitrum

```bash
# Deploy to Arbitrum
forge script script/DeployProduction.s.sol \
  --rpc-url $ARB_RPC_URL \
  --broadcast \
  --verify \
  -vvv

# Configure LayerZero peer
forge script script/ConfigurePeers.s.sol \
  --rpc-url $ARB_RPC_URL \
  --broadcast \
  -vvv
```

### Base

```bash
# Deploy to Base
forge script script/DeployProduction.s.sol \
  --rpc-url $BASE_RPC_URL \
  --broadcast \
  --verify \
  -vvv

# Configure LayerZero peer
forge script script/ConfigurePeers.s.sol \
  --rpc-url $BASE_RPC_URL \
  --broadcast \
  -vvv
```

### Cross-Chain Configuration

After deploying to all chains:

```bash
# Configure peers on Ethereum to recognize L2 deployments
forge script script/ConfigurePeers.s.sol \
  --rpc-url $ETH_RPC_URL \
  --broadcast \
  -vvv
```

---

## Emergency Procedures

### Emergency Pause

```bash
# Pause all AMM operations
forge script script/DeployProduction.s.sol:EmergencyPause \
  --rpc-url $ETH_RPC_URL \
  --broadcast
```

### Resume Operations

Through multisig:
1. Propose `setGlobalPause(false)` transaction
2. Collect required signatures
3. Execute transaction

### Oracle Emergency

If oracle is compromised:
1. Call `setAuthorizedSigner(compromisedAddress, false)` via multisig
2. Deploy new oracle signer
3. Call `setAuthorizedSigner(newAddress, true)` via multisig

---

## Monitoring & Alerts

### Key Metrics to Monitor

1. **Protocol Health**
   - TVL per pool
   - Daily volume
   - Batch settlement success rate
   - Average batch size

2. **Oracle Health**
   - Last update timestamp
   - Price deviation from exchanges
   - Stablecoin flow ratio
   - Regime changes

3. **Security**
   - Circuit breaker triggers
   - Failed transaction rate
   - Large withdrawal alerts
   - Price manipulation attempts

### Alert Thresholds

| Metric | Warning | Critical |
|--------|---------|----------|
| Oracle staleness | >3 min | >5 min |
| Price deviation | >3% | >5% |
| Volume breaker | 80% of threshold | Tripped |
| TVL drop | 10% in 1hr | 25% in 1hr |

---

## Rollback Plan

If critical issues discovered post-launch:

1. **Immediate**: Emergency pause via guardian
2. **Assessment**: Identify affected users/funds
3. **Communication**: Public announcement with timeline
4. **Fix**: Deploy new implementation if needed
5. **Upgrade**: Use UUPS upgrade pattern
6. **Resume**: Unpause after verification

---

## Contacts

- **Security Guardian**: [contact]
- **Multisig Signers**: [contacts]
- **Oracle Operator**: [contact]
- **On-call Engineer**: [contact]

---

## Appendix: Contract Addresses Template

After deployment, fill in:

```
# Ethereum Mainnet
VIBESWAP_CORE=
VIBESWAP_AUCTION=
VIBESWAP_AMM=
VIBESWAP_TREASURY=
VIBESWAP_ROUTER=
TRUE_PRICE_ORACLE_ADDRESS=
STABLECOIN_REGISTRY_ADDRESS=

# Arbitrum One
ARB_VIBESWAP_CORE=
ARB_VIBESWAP_AMM=
...

# Base
BASE_VIBESWAP_CORE=
BASE_VIBESWAP_AMM=
...
```
