// ============ VibeSwap Protocol Tools — On-Chain Data (Base Mainnet) ============
//
// VibeSwap-specific protocol queries. All free APIs — no keys required.
// Uses DexScreener, DeFi Llama, and Base public RPC.
//
// Commands:
//   /vibeprice           — VIBE token price from DEX pools
//   /poolstats           — VibeSwap pool data (TVL, volume, fees)
//   /emission            — Current VIBE emission rate and era info
//   /auction             — Current batch auction status
//   /shapley <address>   — Pending Shapley rewards for an address
//   /staking <address>   — Staking position details
//   /lp <address>        — LP positions across all pools
//   /health              — Overall protocol health dashboard
// ============

const HTTP_TIMEOUT = 10000;

// ============ Contract Addresses (Base Mainnet — Chain ID 8453) ============
// Placeholder addresses until mainnet deployment.
// Replace these with real proxy addresses post-deploy.

const CONTRACTS = {
  VIBE_TOKEN:           null, // ERC-20 VIBE token
  VIBE_AMM:             null, // VibeAMM proxy
  VIBE_SWAP_CORE:       null, // VibeSwapCore orchestrator
  COMMIT_REVEAL:        null, // CommitRevealAuction
  SHAPLEY_DISTRIBUTOR:  null, // ShapleyDistributor
  LP_NFT:               null, // VibeLPNFT
  CIRCUIT_BREAKER:      null, // CircuitBreaker
  DAO_TREASURY:         null, // DAOTreasury
};

const BASE_RPC = 'https://mainnet.base.org';
const CHAIN_ID = 8453;

// ============ Helpers ============

function formatLargeNum(n) {
  if (n >= 1e12) return (n / 1e12).toFixed(2) + 'T';
  if (n >= 1e9) return (n / 1e9).toFixed(2) + 'B';
  if (n >= 1e6) return (n / 1e6).toFixed(2) + 'M';
  if (n >= 1e3) return (n / 1e3).toFixed(1) + 'K';
  return n.toFixed(2);
}

function shortAddr(address) {
  if (!address) return '???';
  return `${address.slice(0, 6)}...${address.slice(-4)}`;
}

function isValidAddress(address) {
  return address && /^0x[a-fA-F0-9]{40}$/.test(address);
}

function contractsDeployed() {
  return Object.values(CONTRACTS).some(addr => addr !== null);
}

async function fetchJSON(url, options = {}) {
  const resp = await fetch(url, {
    signal: AbortSignal.timeout(HTTP_TIMEOUT),
    headers: { 'Accept': 'application/json' },
    ...options,
  });
  if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
  return resp.json();
}

async function callBaseRPC(method, params) {
  const resp = await fetch(BASE_RPC, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', method, id: 1, params }),
    signal: AbortSignal.timeout(HTTP_TIMEOUT),
  });
  const data = await resp.json();
  if (data.error) throw new Error(data.error.message);
  return data.result;
}

// eth_call helper for reading contract view functions
async function readContract(contractAddr, calldata) {
  return callBaseRPC('eth_call', [
    { to: contractAddr, data: calldata },
    'latest',
  ]);
}

// ============ VIBE Token Price (DexScreener — free, no key) ============

export async function getVibePrice() {
  try {
    // If we have a token address, query DexScreener directly
    if (CONTRACTS.VIBE_TOKEN) {
      const data = await fetchJSON(
        `https://api.dexscreener.com/latest/dex/tokens/${CONTRACTS.VIBE_TOKEN}`
      );
      const pairs = data.pairs || [];
      if (pairs.length === 0) {
        return '*VIBE Token*\n\n`No trading pairs found yet.`\nToken may be newly deployed.';
      }

      // Use the highest-liquidity pair
      const pair = pairs.sort((a, b) => (b.liquidity?.usd || 0) - (a.liquidity?.usd || 0))[0];
      const price = parseFloat(pair.priceUsd || 0);
      const change24h = parseFloat(pair.priceChange?.h24 || 0);
      const volume24h = parseFloat(pair.volume?.h24 || 0);
      const liquidity = parseFloat(pair.liquidity?.usd || 0);
      const fdv = parseFloat(pair.fdv || 0);
      const arrow = change24h >= 0 ? '+' : '';

      const lines = ['*VIBE Token*\n'];
      lines.push(`  Price: \`$${price < 1 ? price.toFixed(6) : price.toFixed(4)}\``);
      lines.push(`  24h: \`${arrow}${change24h.toFixed(2)}%\``);
      lines.push(`  Volume: \`$${formatLargeNum(volume24h)}\``);
      lines.push(`  Liquidity: \`$${formatLargeNum(liquidity)}\``);
      if (fdv > 0) lines.push(`  FDV: \`$${formatLargeNum(fdv)}\``);
      lines.push(`  DEX: ${pair.dexId} on ${pair.chainId}`);
      lines.push(`  Pair: \`${shortAddr(pair.pairAddress)}\``);
      return lines.join('\n');
    }

    // No token address yet — try searching DexScreener by name
    try {
      const search = await fetchJSON(
        'https://api.dexscreener.com/latest/dex/search?q=vibeswap'
      );
      const pairs = search.pairs || [];
      if (pairs.length > 0) {
        const pair = pairs[0];
        const price = parseFloat(pair.priceUsd || 0);
        return `*VIBE Token* (via search)\n\n  Price: \`$${price.toFixed(6)}\`\n  Pair: ${pair.baseToken?.symbol}/${pair.quoteToken?.symbol}\n  DEX: ${pair.dexId}`;
      }
    } catch {
      // Search failed, fall through
    }

    return '*VIBE Token*\n\n`Protocol not yet deployed on Base mainnet.`\nContracts are in testnet phase.\n\nUse `/price` to check other token prices.';
  } catch (err) {
    return `VIBE price lookup failed: ${err.message}`;
  }
}

// ============ Pool Stats (DeFi Llama + on-chain) ============

export async function getPoolStats() {
  try {
    // Try DeFi Llama first
    try {
      const data = await fetchJSON('https://api.llama.fi/protocol/vibeswap');
      const tvl = data.currentChainTvls || {};
      const totalTvl = Object.values(tvl).reduce((sum, v) => sum + (v || 0), 0);
      const chains = data.chains || [];

      const lines = ['*VibeSwap Pool Stats*\n'];
      lines.push(`  Total TVL: \`$${formatLargeNum(totalTvl)}\``);
      lines.push(`  Category: ${data.category || 'DEX'}`);
      lines.push(`  Chains: ${chains.join(', ') || 'Base'}`);

      // Per-chain breakdown
      if (Object.keys(tvl).length > 0) {
        lines.push('\n*TVL by Chain:*');
        for (const [chain, val] of Object.entries(tvl)) {
          if (val > 0) {
            lines.push(`  ${chain}: \`$${formatLargeNum(val)}\``);
          }
        }
      }
      return lines.join('\n');
    } catch {
      // Not on DeFi Llama yet
    }

    // If contracts are deployed, read on-chain
    if (CONTRACTS.VIBE_AMM) {
      // Read pool count and basic stats via RPC
      // getPoolCount() selector: keccak256("getPoolCount()")[:4]
      const poolCountData = await readContract(
        CONTRACTS.VIBE_AMM,
        '0x3b350be4' // getPoolCount()
      );
      const poolCount = parseInt(poolCountData, 16);

      const lines = ['*VibeSwap Pool Stats*\n'];
      lines.push(`  Active Pools: \`${poolCount}\``);
      lines.push(`  Chain: Base (${CHAIN_ID})`);
      lines.push(`  AMM: \`${shortAddr(CONTRACTS.VIBE_AMM)}\``);
      lines.push('\n_Use /lp <address> to check your positions._');
      return lines.join('\n');
    }

    return '*VibeSwap Pool Stats*\n\n`Protocol not yet deployed.`\n\nVibeSwap uses constant-product AMM (x*y=k)\nwith commit-reveal batch auctions for MEV protection.\n\n*Design specs:*\n  Batch size: `10 seconds`\n  Commit phase: `8s`\n  Reveal phase: `2s`\n  Settlement: uniform clearing price';
  } catch (err) {
    return `Pool stats failed: ${err.message}`;
  }
}

// ============ Emission Rate ============

export async function getEmissionRate() {
  try {
    if (CONTRACTS.SHAPLEY_DISTRIBUTOR) {
      // Read current era and emission rate on-chain
      // getCurrentEra() selector
      const eraData = await readContract(
        CONTRACTS.SHAPLEY_DISTRIBUTOR,
        '0x1c1b4f3a' // getCurrentEra()
      );
      const era = parseInt(eraData, 16);

      // getEmissionRate() selector
      const rateData = await readContract(
        CONTRACTS.SHAPLEY_DISTRIBUTOR,
        '0x96365d44' // getEmissionRate()
      );
      const rateWei = BigInt(rateData);
      const ratePerSec = Number(rateWei) / 1e18;

      const lines = ['*VIBE Emission Schedule*\n'];
      lines.push(`  Era: \`${era}\``);
      lines.push(`  Rate: \`~${ratePerSec.toFixed(4)} VIBE/sec\``);
      lines.push(`  Daily: \`~${(ratePerSec * 86400).toFixed(0)} VIBE/day\``);
      lines.push(`  Split: \`50/35/15\``);
      lines.push(`    Shapley rewards: 50%`);
      lines.push(`    Gauge voting:    35%`);
      lines.push(`    Staking:         15%`);
      return lines.join('\n');
    }

    // Hardcoded design spec
    return '*VIBE Emission Schedule*\n\n`Era 0 | ~0.333 VIBE/sec | 50/35/15 split`\n\n*Distribution:*\n  Shapley rewards: `50%` (game-theory optimal)\n  Gauge voting:    `35%` (pool incentives)\n  Staking:         `15%` (protocol security)\n\n*Halving:*\n  Every `~6 months` (era transition)\n  Supply cap: `100M VIBE`\n\n_Emission schedule activates at mainnet launch._';
  } catch (err) {
    return `Emission rate lookup failed: ${err.message}`;
  }
}

// ============ Batch Auction Status ============

export async function getAuctionStatus() {
  try {
    if (CONTRACTS.COMMIT_REVEAL) {
      // Read current batch info on-chain
      // getCurrentBatchId() selector
      const batchData = await readContract(
        CONTRACTS.COMMIT_REVEAL,
        '0xa0712d68' // getCurrentBatchId()
      );
      const batchId = parseInt(batchData, 16);

      // getBatchPhase() selector
      const phaseData = await readContract(
        CONTRACTS.COMMIT_REVEAL,
        '0x56c8b834' // getBatchPhase()
      );
      const phase = parseInt(phaseData, 16);

      const phaseNames = ['Commit', 'Reveal', 'Settling', 'Settled'];
      const phaseName = phaseNames[phase] || `Unknown (${phase})`;

      // Batch timing: 10-second batches (8s commit + 2s reveal)
      const now = Math.floor(Date.now() / 1000);
      const batchStart = batchId * 10; // approximate
      const elapsed = now - batchStart;
      let timeRemaining;
      if (phase === 0) {
        timeRemaining = Math.max(0, 8 - elapsed);
      } else if (phase === 1) {
        timeRemaining = Math.max(0, 10 - elapsed);
      } else {
        timeRemaining = 0;
      }

      const lines = ['*Batch Auction Status*\n'];
      lines.push(`  Batch: \`#${batchId}\``);
      lines.push(`  Phase: *${phaseName}*`);
      if (timeRemaining > 0) {
        lines.push(`  Time left: \`${timeRemaining}s\``);
      }
      lines.push(`  Contract: \`${shortAddr(CONTRACTS.COMMIT_REVEAL)}\``);
      return lines.join('\n');
    }

    return '*Batch Auction Status*\n\n`Auction engine not yet live.`\n\n*How VibeSwap auctions work:*\n  1. *Commit* (8s): Submit `hash(order || secret)` + deposit\n  2. *Reveal* (2s): Reveal orders + optional priority bids\n  3. *Settle*: Fisher-Yates shuffle, uniform clearing price\n\n*MEV Protection:*\n  Orders are hidden during commit phase\n  Deterministic shuffle prevents ordering manipulation\n  Uniform price = no sandwich attacks\n\n_Batches run every 10 seconds at launch._';
  } catch (err) {
    return `Auction status failed: ${err.message}`;
  }
}

// ============ Shapley Rewards ============

export async function getShapleyRewards(address) {
  if (!isValidAddress(address)) {
    return 'Usage: `/shapley 0xYourAddress`\n\nCheck pending Shapley rewards for any address.';
  }

  try {
    if (CONTRACTS.SHAPLEY_DISTRIBUTOR) {
      // pendingRewards(address) selector + padded address
      const paddedAddr = address.slice(2).toLowerCase().padStart(64, '0');
      const calldata = '0x31d98b3f' + paddedAddr; // pendingRewards(address)

      const result = await readContract(CONTRACTS.SHAPLEY_DISTRIBUTOR, calldata);
      const rewardsWei = BigInt(result);
      const rewards = Number(rewardsWei) / 1e18;

      const lines = ['*Shapley Rewards*\n'];
      lines.push(`  Address: \`${shortAddr(address)}\``);
      lines.push(`  Pending: \`${rewards.toFixed(4)} VIBE\``);
      lines.push(`  Contract: \`${shortAddr(CONTRACTS.SHAPLEY_DISTRIBUTOR)}\``);
      lines.push('\n_Claim via the VibeSwap app or directly on-chain._');
      return lines.join('\n');
    }

    return `*Shapley Rewards*\n\n  Address: \`${shortAddr(address)}\`\n  Status: \`Protocol not yet deployed\`\n\n*How Shapley rewards work:*\n  Based on game theory (Shapley values)\n  Fair allocation of priority bid revenue\n  50% of all VIBE emissions\n  Rewards proportional to contribution\n\n_Rewards will be claimable at mainnet launch._`;
  } catch (err) {
    return `Shapley lookup failed: ${err.message}`;
  }
}

// ============ Staking Info ============

export async function getStakingInfo(address) {
  if (!isValidAddress(address)) {
    return 'Usage: `/staking 0xYourAddress`\n\nCheck staking position for any address.';
  }

  try {
    if (CONTRACTS.VIBE_TOKEN) {
      // Try to read staking contract
      // getStake(address) — hypothetical selector
      const paddedAddr = address.slice(2).toLowerCase().padStart(64, '0');
      const calldata = '0x7a766460' + paddedAddr; // getStake(address)

      try {
        const result = await readContract(CONTRACTS.VIBE_TOKEN, calldata);
        // Decode: amount (uint256), rewardDebt (uint256), unlockTime (uint256)
        const amount = Number(BigInt('0x' + result.slice(2, 66))) / 1e18;
        const unlockTime = parseInt(result.slice(130, 194), 16);

        const lines = ['*Staking Position*\n'];
        lines.push(`  Address: \`${shortAddr(address)}\``);
        lines.push(`  Staked: \`${amount.toFixed(4)} VIBE\``);
        if (unlockTime > 0) {
          const unlockDate = new Date(unlockTime * 1000);
          const now = Date.now();
          if (unlockTime * 1000 > now) {
            const daysLeft = Math.ceil((unlockTime * 1000 - now) / 86400000);
            lines.push(`  Unlock: \`${unlockDate.toLocaleDateString()}\` (${daysLeft}d)`);
          } else {
            lines.push(`  Status: *Unlocked* (ready to withdraw)`);
          }
        }
        return lines.join('\n');
      } catch {
        return `*Staking Position*\n\n  Address: \`${shortAddr(address)}\`\n  Staked: \`0 VIBE\`\n\n_No staking position found._`;
      }
    }

    return `*Staking Position*\n\n  Address: \`${shortAddr(address)}\`\n  Status: \`Protocol not yet deployed\`\n\n*Staking details:*\n  15% of VIBE emissions go to stakers\n  Lock periods: 1 week to 1 year\n  Longer lock = higher boost (up to 2.5x)\n  Stakers also earn priority bid revenue share\n\n_Staking will be available at mainnet launch._`;
  } catch (err) {
    return `Staking lookup failed: ${err.message}`;
  }
}

// ============ LP Positions ============

export async function getLPPositions(address) {
  if (!isValidAddress(address)) {
    return 'Usage: `/lp 0xYourAddress`\n\nList LP positions across all VibeSwap pools.';
  }

  try {
    if (CONTRACTS.LP_NFT) {
      // balanceOf(address) — ERC-721 standard
      const paddedAddr = address.slice(2).toLowerCase().padStart(64, '0');
      const calldata = '0x70a08231' + paddedAddr; // balanceOf(address)

      const result = await readContract(CONTRACTS.LP_NFT, calldata);
      const count = parseInt(result, 16);

      if (count === 0) {
        return `*LP Positions*\n\n  Address: \`${shortAddr(address)}\`\n  Positions: \`0\`\n\n_No active LP positions found._\n_Add liquidity via the VibeSwap app._`;
      }

      const lines = ['*LP Positions*\n'];
      lines.push(`  Address: \`${shortAddr(address)}\``);
      lines.push(`  Active Positions: \`${count}\``);
      lines.push(`  NFT Contract: \`${shortAddr(CONTRACTS.LP_NFT)}\``);
      lines.push('\n_View full details in the VibeSwap app._');
      return lines.join('\n');
    }

    return `*LP Positions*\n\n  Address: \`${shortAddr(address)}\`\n  Status: \`Protocol not yet deployed\`\n\n*LP Design:*\n  Positions represented as NFTs (ERC-721)\n  Concentrated liquidity ranges\n  IL protection via insurance vault\n  Earn trading fees + VIBE gauge rewards\n\n_LP positions available at mainnet launch._`;
  } catch (err) {
    return `LP positions lookup failed: ${err.message}`;
  }
}

// ============ Protocol Health Dashboard ============

export async function getProtocolHealth() {
  try {
    const lines = ['*VibeSwap Protocol Health*\n'];

    // If contracts are deployed, gather live data
    if (contractsDeployed()) {
      const checks = [];

      // 1. TVL from DeFi Llama
      checks.push(
        fetchJSON('https://api.llama.fi/protocol/vibeswap')
          .then(d => {
            const tvl = d.currentChainTvls || {};
            return Object.values(tvl).reduce((s, v) => s + (v || 0), 0);
          })
          .catch(() => null)
      );

      // 2. Latest Base block (chain liveness)
      checks.push(
        callBaseRPC('eth_blockNumber', [])
          .then(r => parseInt(r, 16))
          .catch(() => null)
      );

      // 3. VIBE price from DexScreener
      checks.push(
        CONTRACTS.VIBE_TOKEN
          ? fetchJSON(`https://api.dexscreener.com/latest/dex/tokens/${CONTRACTS.VIBE_TOKEN}`)
              .then(d => {
                const pair = (d.pairs || []).sort((a, b) => (b.liquidity?.usd || 0) - (a.liquidity?.usd || 0))[0];
                return pair ? parseFloat(pair.priceUsd) : null;
              })
              .catch(() => null)
          : Promise.resolve(null)
      );

      const [tvl, blockNum, vibePrice] = await Promise.all(checks);

      if (tvl !== null) lines.push(`  TVL: \`$${formatLargeNum(tvl)}\``);
      if (vibePrice !== null) lines.push(`  VIBE: \`$${vibePrice < 1 ? vibePrice.toFixed(6) : vibePrice.toFixed(4)}\``);
      if (blockNum !== null) lines.push(`  Base Block: \`${blockNum.toLocaleString()}\``);

      // Circuit breaker status
      if (CONTRACTS.CIRCUIT_BREAKER) {
        try {
          // isTripped() selector
          const tripped = await readContract(CONTRACTS.CIRCUIT_BREAKER, '0x1703e5f9');
          const isTripped = parseInt(tripped, 16) !== 0;
          lines.push(`  Circuit Breaker: ${isTripped ? '*TRIPPED*' : '\`Normal\`'}`);
        } catch {
          lines.push(`  Circuit Breaker: \`Unknown\``);
        }
      }

      lines.push(`\n*Contracts:*`);
      for (const [name, addr] of Object.entries(CONTRACTS)) {
        if (addr) lines.push(`  ${name}: \`${shortAddr(addr)}\``);
      }
      return lines.join('\n');
    }

    // Pre-deployment: show design specs and Base chain status
    let baseBlock = null;
    try {
      const result = await callBaseRPC('eth_blockNumber', []);
      baseBlock = parseInt(result, 16);
    } catch {
      // Base RPC unavailable
    }

    lines.push('*Status:* `Pre-deployment`');
    lines.push(`*Chain:* Base (${CHAIN_ID})`);
    if (baseBlock) {
      lines.push(`*Base Block:* \`${baseBlock.toLocaleString()}\``);
    }

    lines.push('\n*Protocol Parameters:*');
    lines.push('  Batch interval: `10s`');
    lines.push('  Commit phase: `8s`');
    lines.push('  Reveal phase: `2s`');
    lines.push('  TWAP max deviation: `5%`');
    lines.push('  Rate limit: `100K tokens/hr/user`');
    lines.push('  Invalid reveal slash: `50%`');

    lines.push('\n*Security:*');
    lines.push('  Flash loan protection (EOA-only)');
    lines.push('  Circuit breakers (volume/price/withdrawal)');
    lines.push('  TWAP oracle validation');
    lines.push('  Deterministic shuffle (Fisher-Yates)');

    lines.push('\n*Architecture:*');
    lines.push('  AMM: Constant product (x*y=k)');
    lines.push('  Upgrades: UUPS proxy pattern');
    lines.push('  Cross-chain: LayerZero V2');
    lines.push('  Rewards: Shapley value distribution');

    return lines.join('\n');
  } catch (err) {
    return `Protocol health check failed: ${err.message}`;
  }
}
