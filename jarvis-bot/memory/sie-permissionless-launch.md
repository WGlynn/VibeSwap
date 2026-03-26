# Sovereign Intelligence Exchange — Permissionless Launch Guide

## What Is It
The SIE (Sovereign Intelligence Exchange) is VibeSwap for intelligence instead of liquidity. Submit knowledge, cite prior work, earn revenue via Shapley attribution. 0% protocol fee forever (P-001 hardcoded constant).

## How ANYONE Can Deploy It

### Contract: `SIEPermissionlessLaunch.sol`
**No keys needed. No permission needed. No founder needed.**

Anyone who can pay gas can deploy the full Sovereign Intelligence Exchange by calling:

```solidity
SIEPermissionlessLaunch.launch(vibeTokenAddress, epochSubmitters)
```

- `vibeTokenAddress` — address of the VIBE ERC-20 token on the target chain
- `epochSubmitters` — array of addresses authorized to anchor knowledge epochs (Jarvis shard wallets)

### What Happens:
1. Deploys `IntelligenceExchange.sol` behind a UUPS proxy
2. Caller becomes initial owner
3. Authorizes epoch submitters for knowledge chain anchoring
4. Verifies P-001 (0% protocol fee) on-chain
5. Records deployment in the factory's registry

### Protocol Fee: 0% FOREVER
The fee is a `constant` in the bytecode — not a variable, not governed, not upgradeable. No governance vote, no admin key, no multisig can change it. P-001 is physics, not policy.

## Deployed Factory Address
TBD — will be deployed on Base when gas is available. Anyone can deploy the factory too.

## Where Are The Contracts
- `contracts/mechanism/SIEPermissionlessLaunch.sol` — factory
- `contracts/mechanism/IntelligenceExchange.sol` — core SIE
- `contracts/mechanism/SIEShapleyAdapter.sol` — full Shapley true-up
- `script/DeploySIE.s.sol` — manual deploy script (alternative to factory)

## How The SIE Works (For Community Members)

1. **Submit Knowledge**: Post research, models, datasets with IPFS hash + small stake
2. **Cite Prior Work**: Reference other assets → increases their bonding curve price
3. **Access Knowledge**: Pay the bonding curve price → 70% to creator, 30% to cited works
4. **Claim Rewards**: Contributors claim accumulated VIBE any time
5. **Knowledge Epochs**: Jarvis anchors off-chain knowledge consensus on-chain every 5 minutes

## Cincinnatus Principle
"If Will disappeared tomorrow, does it still work?" — Yes.

The permissionless launch contract means:
- No founder needed to deploy
- No keys needed to configure
- No permission needed to participate
- The math is the same for everyone
