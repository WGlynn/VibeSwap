// ============ Portfolio & Wallet Tracking — Multi-Chain ============
//
// Free APIs only — no API keys required.
// Uses public block explorer APIs, CoinGecko, DeFi Llama.
//
// Commands:
//   /portfolio <address> [chains]  — Aggregate wallet balances across chains
//   /tokens <address> [chain]      — ERC20 token balances
//   /txhistory <address> [chain]   — Recent transactions
//   /nfts <address> [chain]        — NFT holdings
//   /defi <address>                — DeFi positions across protocols
//   /track <address> <label>       — Save wallet for tracking
//   /tracked                       — List tracked wallets
//   /whales [chain]                — Recent large transfers
// ============

const HTTP_TIMEOUT = 12000;

// ============ Helpers ============

function formatLargeNum(n) {
  if (n >= 1e12) return (n / 1e12).toFixed(2) + 'T';
  if (n >= 1e9) return (n / 1e9).toFixed(2) + 'B';
  if (n >= 1e6) return (n / 1e6).toFixed(2) + 'M';
  if (n >= 1e3) return (n / 1e3).toFixed(1) + 'K';
  return n.toFixed(2);
}

function shortAddr(address) {
  if (!address || address.length < 10) return address || '?';
  return `${address.slice(0, 6)}...${address.slice(-4)}`;
}

function isValidAddress(address) {
  return address && /^0x[a-fA-F0-9]{40}$/.test(address);
}

function timeAgo(timestamp) {
  const seconds = Math.floor(Date.now() / 1000 - timestamp);
  if (seconds < 60) return `${seconds}s ago`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h ago`;
  return `${Math.floor(seconds / 86400)}d ago`;
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

// ============ Chain Configuration ============

const CHAIN_CONFIG = {
  eth: {
    name: 'Ethereum',
    native: 'ETH',
    explorer: 'https://api.etherscan.io/api',
    rpc: 'https://eth.llamarpc.com',
    coingeckoId: 'ethereum',
    decimals: 18,
  },
  base: {
    name: 'Base',
    native: 'ETH',
    explorer: 'https://api.basescan.org/api',
    rpc: 'https://mainnet.base.org',
    coingeckoId: 'ethereum',
    decimals: 18,
  },
  arb: {
    name: 'Arbitrum',
    native: 'ETH',
    explorer: 'https://api.arbiscan.io/api',
    rpc: 'https://arb1.arbitrum.io/rpc',
    coingeckoId: 'ethereum',
    decimals: 18,
  },
  polygon: {
    name: 'Polygon',
    native: 'POL',
    explorer: 'https://api.polygonscan.com/api',
    rpc: 'https://polygon-rpc.com',
    coingeckoId: 'matic-network',
    decimals: 18,
  },
  optimism: {
    name: 'Optimism',
    native: 'ETH',
    explorer: 'https://api-optimistic.etherscan.io/api',
    rpc: 'https://mainnet.optimism.io',
    coingeckoId: 'ethereum',
    decimals: 18,
  },
  bsc: {
    name: 'BSC',
    native: 'BNB',
    explorer: 'https://api.bscscan.com/api',
    rpc: 'https://bsc-dataseed.binance.org',
    coingeckoId: 'binancecoin',
    decimals: 18,
  },
  avax: {
    name: 'Avalanche',
    native: 'AVAX',
    explorer: 'https://api.snowscan.xyz/api',
    rpc: 'https://api.avax.network/ext/bc/C/rpc',
    coingeckoId: 'avalanche-2',
    decimals: 18,
  },
};

// ============ Native Balance via RPC (most reliable, no key) ============

async function getNativeBalance(address, chain) {
  const config = CHAIN_CONFIG[chain];
  if (!config) return null;

  try {
    const data = await fetchJSON(config.rpc, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        jsonrpc: '2.0', method: 'eth_getBalance', id: 1,
        params: [address, 'latest'],
      }),
    });
    if (data.error) return null;
    const balanceWei = BigInt(data.result || '0x0');
    return Number(balanceWei) / Math.pow(10, config.decimals);
  } catch {
    return null;
  }
}

// ============ CoinGecko Price Fetch ============

async function getNativePrices(coingeckoIds) {
  try {
    const unique = [...new Set(coingeckoIds)];
    const data = await fetchJSON(
      `https://api.coingecko.com/api/v3/simple/price?ids=${unique.join(',')}&vs_currencies=usd`
    );
    return data;
  } catch {
    return {};
  }
}

// ============ Portfolio — Aggregate Multi-Chain ============

export async function getPortfolio(address, chains = ['eth', 'base', 'arb']) {
  if (!isValidAddress(address)) {
    return 'Invalid address. Use a valid 0x EVM address.';
  }

  // Normalize chain input
  if (typeof chains === 'string') {
    chains = chains.split(',').map(c => c.trim().toLowerCase());
  }

  // Validate chains
  const validChains = chains.filter(c => CHAIN_CONFIG[c]);
  if (validChains.length === 0) {
    return `No valid chains. Supported: ${Object.keys(CHAIN_CONFIG).join(', ')}`;
  }

  try {
    // Fetch all native balances in parallel
    const balancePromises = validChains.map(async (chain) => {
      const balance = await getNativeBalance(address, chain);
      return { chain, balance };
    });

    const balances = await Promise.all(balancePromises);

    // Fetch native token prices
    const priceIds = validChains.map(c => CHAIN_CONFIG[c].coingeckoId);
    const prices = await getNativePrices(priceIds);

    // Build output
    const lines = [`Portfolio for ${shortAddr(address)}\n`];
    let totalUSD = 0;
    const errors = [];

    for (const { chain, balance } of balances) {
      const config = CHAIN_CONFIG[chain];

      if (balance === null) {
        errors.push(chain);
        continue;
      }

      const price = prices[config.coingeckoId]?.usd || 0;
      const usdValue = balance * price;
      totalUSD += usdValue;

      if (balance > 0.000001) {
        lines.push(`  ${config.name} (${config.native})`);
        lines.push(`    ${balance.toFixed(6)} ${config.native}`);
        if (price > 0) lines.push(`    ~$${usdValue.toLocaleString('en-US', { maximumFractionDigits: 2 })}`);
      } else {
        lines.push(`  ${config.name}: 0 ${config.native}`);
      }
    }

    lines.push('');
    if (totalUSD > 0) {
      lines.push(`  Total (native): ~$${totalUSD.toLocaleString('en-US', { maximumFractionDigits: 2 })}`);
    }

    if (errors.length > 0) {
      lines.push(`\n  [!] Could not fetch: ${errors.join(', ')}`);
    }

    lines.push(`\n  Note: Native balances only. Use /tokens for ERC20s.`);
    return lines.join('\n');
  } catch (err) {
    return `Portfolio lookup failed: ${err.message}`;
  }
}

// ============ Token Balances (ERC20) ============

export async function getTokenBalances(address, chain = 'eth') {
  if (!isValidAddress(address)) {
    return 'Invalid address. Use a valid 0x EVM address.';
  }

  const config = CHAIN_CONFIG[chain.toLowerCase()];
  if (!config) {
    return `Unknown chain "${chain}". Supported: ${Object.keys(CHAIN_CONFIG).join(', ')}`;
  }

  try {
    // Use block explorer tokentx to discover tokens, then check balances
    // Free tier: no API key, rate limited but functional
    const txData = await fetchJSON(
      `${config.explorer}?module=account&action=tokentx&address=${address}&page=1&offset=100&sort=desc`
    );

    if (txData.status !== '1' || !txData.result?.length) {
      // Try the native balance at least
      const native = await getNativeBalance(address, chain.toLowerCase());
      if (native !== null && native > 0) {
        return `${shortAddr(address)} on ${config.name}\n\n  ${config.native}: ${native.toFixed(6)}\n\n  No ERC20 token transfers found.`;
      }
      return `No token activity found for ${shortAddr(address)} on ${config.name}.`;
    }

    // Extract unique token contracts from recent transfers
    const tokenMap = new Map();
    for (const tx of txData.result) {
      if (!tokenMap.has(tx.contractAddress)) {
        tokenMap.set(tx.contractAddress, {
          symbol: tx.tokenSymbol || '???',
          name: tx.tokenName || 'Unknown',
          decimals: parseInt(tx.tokenDecimal) || 18,
          contract: tx.contractAddress,
        });
      }
      if (tokenMap.size >= 20) break; // Cap at 20 tokens
    }

    // For each token, get current balance via RPC balanceOf call
    const balancePromises = [...tokenMap.entries()].map(async ([contract, token]) => {
      try {
        // ERC20 balanceOf(address) selector = 0x70a08231
        const paddedAddr = address.slice(2).toLowerCase().padStart(64, '0');
        const calldata = '0x70a08231' + paddedAddr;

        const data = await fetchJSON(config.rpc, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            jsonrpc: '2.0', method: 'eth_call', id: 1,
            params: [{ to: contract, data: calldata }, 'latest'],
          }),
        });

        if (data.result && data.result !== '0x' && data.result !== '0x0') {
          const rawBalance = BigInt(data.result);
          const balance = Number(rawBalance) / Math.pow(10, token.decimals);
          return { ...token, balance };
        }
        return { ...token, balance: 0 };
      } catch {
        return { ...token, balance: 0 };
      }
    });

    const tokenBalances = await Promise.all(balancePromises);

    // Filter non-zero and sort by balance descending (rough USD proxy)
    const nonZero = tokenBalances
      .filter(t => t.balance > 0.000001)
      .sort((a, b) => b.balance - a.balance);

    if (nonZero.length === 0) {
      const native = await getNativeBalance(address, chain.toLowerCase());
      return `${shortAddr(address)} on ${config.name}\n\n  ${config.native}: ${native?.toFixed(6) || '?'}\n\n  No ERC20 balances found (may have transferred all).`;
    }

    const lines = [`Token Balances — ${shortAddr(address)} on ${config.name}\n`];

    // Include native balance
    const native = await getNativeBalance(address, chain.toLowerCase());
    if (native !== null) {
      lines.push(`  ${config.native}: ${native.toFixed(6)} (native)`);
    }

    lines.push('');
    for (const t of nonZero.slice(0, 15)) {
      const balStr = t.balance >= 1
        ? t.balance.toLocaleString('en-US', { maximumFractionDigits: 4 })
        : t.balance.toFixed(8);
      lines.push(`  ${t.symbol}: ${balStr}`);
    }

    if (nonZero.length > 15) {
      lines.push(`\n  ... and ${nonZero.length - 15} more tokens`);
    }

    return lines.join('\n');
  } catch (err) {
    return `Token balance lookup failed: ${err.message}`;
  }
}

// ============ Transaction History ============

export async function getTransactionHistory(address, chain = 'eth', limit = 10) {
  if (!isValidAddress(address)) {
    return 'Invalid address. Use a valid 0x EVM address.';
  }

  const config = CHAIN_CONFIG[chain.toLowerCase()];
  if (!config) {
    return `Unknown chain "${chain}". Supported: ${Object.keys(CHAIN_CONFIG).join(', ')}`;
  }

  limit = Math.min(Math.max(1, parseInt(limit) || 10), 25);

  try {
    const data = await fetchJSON(
      `${config.explorer}?module=account&action=txlist&address=${address}&page=1&offset=${limit}&sort=desc`
    );

    if (data.status !== '1' || !data.result?.length) {
      return `No transactions found for ${shortAddr(address)} on ${config.name}.`;
    }

    const lowerAddr = address.toLowerCase();
    const lines = [`Recent Transactions — ${shortAddr(address)} on ${config.name}\n`];

    for (let i = 0; i < data.result.length; i++) {
      const tx = data.result[i];
      const isOut = tx.from.toLowerCase() === lowerAddr;
      const direction = isOut ? 'OUT' : 'IN';
      const counterparty = isOut ? shortAddr(tx.to) : shortAddr(tx.from);
      const valueEth = Number(BigInt(tx.value || '0')) / 1e18;
      const ts = parseInt(tx.timeStamp);
      const status = tx.isError === '1' ? ' [FAILED]' : '';

      lines.push(`  ${i + 1}. ${direction} ${valueEth.toFixed(6)} ${config.native}${status}`);
      lines.push(`     ${isOut ? 'To' : 'From'}: ${counterparty}`);
      lines.push(`     ${timeAgo(ts)} | Gas: ${(parseInt(tx.gasUsed || '0') * parseInt(tx.gasPrice || '0') / 1e18).toFixed(6)} ${config.native}`);
      if (i < data.result.length - 1) lines.push('');
    }

    return lines.join('\n');
  } catch (err) {
    return `Transaction history failed: ${err.message}`;
  }
}

// ============ NFT Holdings ============

export async function getNFTs(address, chain = 'eth') {
  if (!isValidAddress(address)) {
    return 'Invalid address. Use a valid 0x EVM address.';
  }

  const config = CHAIN_CONFIG[chain.toLowerCase()];
  if (!config) {
    return `Unknown chain "${chain}". Supported: ${Object.keys(CHAIN_CONFIG).join(', ')}`;
  }

  try {
    // Use block explorer ERC-721 token transfer endpoint to discover NFTs
    const data = await fetchJSON(
      `${config.explorer}?module=account&action=tokennfttx&address=${address}&page=1&offset=100&sort=desc`
    );

    if (data.status !== '1' || !data.result?.length) {
      return `No NFT activity found for ${shortAddr(address)} on ${config.name}.\n\n  Note: Free APIs have limited NFT data. For full NFT tracking, dedicated NFT APIs (Alchemy, SimpleHash) offer better coverage.`;
    }

    // Track current holdings: count ins and outs per tokenID
    const lowerAddr = address.toLowerCase();
    const holdings = new Map(); // key: contract+tokenId

    for (const tx of data.result) {
      const key = `${tx.contractAddress}:${tx.tokenID}`;
      const isIn = tx.to.toLowerCase() === lowerAddr;
      const isOut = tx.from.toLowerCase() === lowerAddr;

      if (!holdings.has(key)) {
        holdings.set(key, {
          name: tx.tokenName || 'Unknown',
          symbol: tx.tokenSymbol || '???',
          tokenId: tx.tokenID,
          contract: tx.contractAddress,
          held: 0,
        });
      }

      const item = holdings.get(key);
      if (isIn) item.held++;
      if (isOut) item.held--;
    }

    // Filter to currently held NFTs
    const currentlyHeld = [...holdings.values()].filter(h => h.held > 0);

    if (currentlyHeld.length === 0) {
      return `${shortAddr(address)} has no NFTs on ${config.name} (based on recent transfer history).`;
    }

    // Group by collection
    const collections = new Map();
    for (const nft of currentlyHeld) {
      const key = nft.contract;
      if (!collections.has(key)) {
        collections.set(key, { name: nft.name, symbol: nft.symbol, items: [] });
      }
      collections.get(key).items.push(nft.tokenId);
    }

    const lines = [`NFTs — ${shortAddr(address)} on ${config.name}\n`];
    let count = 0;

    for (const [, col] of collections) {
      if (count >= 15) {
        lines.push(`\n  ... and more collections`);
        break;
      }
      const itemCount = col.items.length;
      const preview = col.items.slice(0, 3).join(', ');
      const more = itemCount > 3 ? ` +${itemCount - 3} more` : '';
      lines.push(`  ${col.name} (${col.symbol}) — ${itemCount} item${itemCount > 1 ? 's' : ''}`);
      lines.push(`    IDs: ${preview}${more}`);
      count++;
    }

    lines.push(`\n  Total: ${currentlyHeld.length} NFT${currentlyHeld.length > 1 ? 's' : ''}`);
    return lines.join('\n');
  } catch (err) {
    return `NFT lookup failed: ${err.message}`;
  }
}

// ============ DeFi Positions ============

export async function getDefiPositions(address) {
  if (!isValidAddress(address)) {
    return 'Invalid address. Use a valid 0x EVM address.';
  }

  try {
    // Try DeFi Llama yield data + known protocol contracts
    // DeBank open API was deprecated; use DeFi Llama as the free source
    const lines = [`DeFi Positions — ${shortAddr(address)}\n`];

    // Check common DeFi protocols via RPC calls
    const positions = [];

    // Aave V3 (Ethereum): check aToken balances
    const aaveTokens = [
      { name: 'aWETH', contract: '0x4d5F47FA6A74757f35C14fD3a6Ef8E3C9BC514E8', symbol: 'WETH', decimals: 18 },
      { name: 'aUSDC', contract: '0x98C23E9d8f34FEFb1B7BD6a91B7FF122F4e16F5c', symbol: 'USDC', decimals: 6 },
      { name: 'aDAI', contract: '0x018008bfb33d285247A21d44E50697654f754e63', symbol: 'DAI', decimals: 18 },
      { name: 'aUSDT', contract: '0x23878914EFE38d27C4D67Ab83ed1b93A74D4086a', symbol: 'USDT', decimals: 6 },
    ];

    // Check Aave positions
    const aavePromises = aaveTokens.map(async (token) => {
      try {
        const paddedAddr = address.slice(2).toLowerCase().padStart(64, '0');
        const calldata = '0x70a08231' + paddedAddr;
        const data = await fetchJSON('https://eth.llamarpc.com', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            jsonrpc: '2.0', method: 'eth_call', id: 1,
            params: [{ to: token.contract, data: calldata }, 'latest'],
          }),
        });
        if (data.result && data.result !== '0x' && data.result !== '0x0') {
          const balance = Number(BigInt(data.result)) / Math.pow(10, token.decimals);
          if (balance > 0.001) {
            return { protocol: 'Aave V3', type: 'Lending', asset: token.symbol, balance };
          }
        }
      } catch { /* skip */ }
      return null;
    });

    // Check Lido stETH
    const lidoPromise = (async () => {
      try {
        const paddedAddr = address.slice(2).toLowerCase().padStart(64, '0');
        const calldata = '0x70a08231' + paddedAddr;
        const data = await fetchJSON('https://eth.llamarpc.com', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            jsonrpc: '2.0', method: 'eth_call', id: 1,
            params: [{ to: '0xae7ab96520DE3A18E5e111B5EaAb095312D7fE84', data: calldata }, 'latest'],
          }),
        });
        if (data.result && data.result !== '0x' && data.result !== '0x0') {
          const balance = Number(BigInt(data.result)) / 1e18;
          if (balance > 0.001) {
            return { protocol: 'Lido', type: 'Staking', asset: 'stETH', balance };
          }
        }
      } catch { /* skip */ }
      return null;
    })();

    // Check Rocket Pool rETH
    const rethPromise = (async () => {
      try {
        const paddedAddr = address.slice(2).toLowerCase().padStart(64, '0');
        const calldata = '0x70a08231' + paddedAddr;
        const data = await fetchJSON('https://eth.llamarpc.com', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            jsonrpc: '2.0', method: 'eth_call', id: 1,
            params: [{ to: '0xae78736Cd615f374D3085123A210448E74Fc6393', data: calldata }, 'latest'],
          }),
        });
        if (data.result && data.result !== '0x' && data.result !== '0x0') {
          const balance = Number(BigInt(data.result)) / 1e18;
          if (balance > 0.001) {
            return { protocol: 'Rocket Pool', type: 'Staking', asset: 'rETH', balance };
          }
        }
      } catch { /* skip */ }
      return null;
    })();

    const results = await Promise.all([...aavePromises, lidoPromise, rethPromise]);
    for (const r of results) {
      if (r) positions.push(r);
    }

    if (positions.length === 0) {
      lines.push('  No DeFi positions detected on Ethereum mainnet.');
      lines.push('');
      lines.push('  Checked: Aave V3, Lido, Rocket Pool');
      lines.push('  Note: Free APIs have limited protocol coverage.');
      lines.push('  Positions on L2s or smaller protocols may not appear.');
      return lines.join('\n');
    }

    // Get ETH price for USD estimates
    const prices = await getNativePrices(['ethereum']);
    const ethPrice = prices.ethereum?.usd || 0;

    let totalUSD = 0;
    for (const pos of positions) {
      const usdEst = pos.asset === 'USDC' || pos.asset === 'USDT' || pos.asset === 'DAI'
        ? pos.balance
        : pos.balance * ethPrice;
      totalUSD += usdEst;

      lines.push(`  ${pos.protocol} — ${pos.type}`);
      lines.push(`    ${pos.balance.toFixed(6)} ${pos.asset} (~$${usdEst.toLocaleString('en-US', { maximumFractionDigits: 2 })})`);
    }

    lines.push('');
    lines.push(`  Total DeFi Value: ~$${totalUSD.toLocaleString('en-US', { maximumFractionDigits: 2 })}`);
    lines.push('');
    lines.push('  Checked: Aave V3, Lido, Rocket Pool (Ethereum only)');
    return lines.join('\n');
  } catch (err) {
    return `DeFi position lookup failed: ${err.message}`;
  }
}

// ============ Tracked Wallets (in-memory with persistence hooks) ============

const trackedWallets = new Map();

export function trackWallet(address, label) {
  if (!isValidAddress(address)) {
    return 'Invalid address. Use a valid 0x EVM address.';
  }

  if (!label || label.trim().length === 0) {
    return 'Please provide a label. Usage: /track 0x... MyWallet';
  }

  const cleanLabel = label.trim().slice(0, 30);
  trackedWallets.set(address.toLowerCase(), {
    address,
    label: cleanLabel,
    addedAt: Date.now(),
  });

  return `Wallet tracked!\n\n  Label: ${cleanLabel}\n  Address: ${shortAddr(address)}\n\n  Use /tracked to see all tracked wallets.`;
}

export async function getTrackedWallets() {
  if (trackedWallets.size === 0) {
    return 'No wallets tracked yet.\n\n  Use /track <address> <label> to start tracking.';
  }

  try {
    const lines = [`Tracked Wallets (${trackedWallets.size})\n`];

    // Fetch ETH balances for all tracked wallets in parallel
    const entries = [...trackedWallets.values()];
    const balancePromises = entries.map(async (w) => {
      const balance = await getNativeBalance(w.address, 'eth');
      return { ...w, ethBalance: balance };
    });

    const wallets = await Promise.all(balancePromises);

    // Get ETH price
    const prices = await getNativePrices(['ethereum']);
    const ethPrice = prices.ethereum?.usd || 0;

    let totalUSD = 0;
    for (const w of wallets) {
      const usd = (w.ethBalance || 0) * ethPrice;
      totalUSD += usd;

      lines.push(`  ${w.label}`);
      lines.push(`    ${shortAddr(w.address)}`);
      if (w.ethBalance !== null) {
        lines.push(`    ${w.ethBalance.toFixed(4)} ETH (~$${usd.toLocaleString('en-US', { maximumFractionDigits: 2 })})`);
      } else {
        lines.push(`    Balance unavailable`);
      }
      lines.push('');
    }

    if (totalUSD > 0) {
      lines.push(`  Combined (ETH only): ~$${totalUSD.toLocaleString('en-US', { maximumFractionDigits: 2 })}`);
    }

    return lines.join('\n');
  } catch (err) {
    return `Tracked wallets fetch failed: ${err.message}`;
  }
}

// Export for external persistence if needed
export function getTrackedWalletsRaw() {
  return Object.fromEntries(trackedWallets);
}

export function loadTrackedWallets(data) {
  if (data && typeof data === 'object') {
    for (const [key, value] of Object.entries(data)) {
      trackedWallets.set(key, value);
    }
  }
}

// ============ Whale Alerts ============

export async function getWhaleAlerts(chain = 'eth') {
  const config = CHAIN_CONFIG[chain.toLowerCase()];
  if (!config) {
    return `Unknown chain "${chain}". Supported: ${Object.keys(CHAIN_CONFIG).join(', ')}`;
  }

  try {
    // Strategy: fetch the latest block, then scan for large-value transactions
    // This is free and requires no API key

    // Get latest block number
    const blockData = await fetchJSON(config.rpc, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', method: 'eth_blockNumber', id: 1, params: [] }),
    });

    const latestBlock = parseInt(blockData.result, 16);
    if (!latestBlock) return 'Could not fetch latest block.';

    // Get ETH price for USD thresholds
    const prices = await getNativePrices([config.coingeckoId]);
    const nativePrice = prices[config.coingeckoId]?.usd || 0;

    if (nativePrice === 0) {
      return `Could not fetch ${config.native} price. Try again later.`;
    }

    // Threshold: $500K in native token
    const thresholdWei = BigInt(Math.floor(500000 / nativePrice * 1e18));

    // Scan last 3 blocks for large transfers (to stay within free RPC limits)
    const whales = [];
    const blockPromises = [];

    for (let i = 0; i < 3; i++) {
      const blockHex = '0x' + (latestBlock - i).toString(16);
      blockPromises.push(
        fetchJSON(config.rpc, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            jsonrpc: '2.0', method: 'eth_getBlockByNumber', id: i + 10,
            params: [blockHex, true], // true = include full tx objects
          }),
        }).catch(() => null)
      );
    }

    const blocks = await Promise.all(blockPromises);

    for (const blockResp of blocks) {
      if (!blockResp?.result?.transactions) continue;
      const block = blockResp.result;
      const blockTime = parseInt(block.timestamp, 16);

      for (const tx of block.transactions) {
        const value = BigInt(tx.value || '0x0');
        if (value >= thresholdWei) {
          const ethValue = Number(value) / 1e18;
          const usdValue = ethValue * nativePrice;
          whales.push({
            from: tx.from,
            to: tx.to || 'Contract Creation',
            value: ethValue,
            usd: usdValue,
            hash: tx.hash,
            time: blockTime,
          });
        }
      }
    }

    if (whales.length === 0) {
      return `Whale Alerts — ${config.name}\n\n  No transfers >$500K in the last 3 blocks.\n  Note: Scanning recent blocks only. For continuous alerts, consider dedicated whale tracking services.`;
    }

    // Sort by USD value descending
    whales.sort((a, b) => b.usd - a.usd);
    const top = whales.slice(0, 10);

    const lines = [`Whale Alerts — ${config.name} (last 3 blocks)\n`];
    for (let i = 0; i < top.length; i++) {
      const w = top[i];
      lines.push(`  ${i + 1}. $${formatLargeNum(w.usd)} (${w.value.toFixed(4)} ${config.native})`);
      lines.push(`     ${shortAddr(w.from)} -> ${typeof w.to === 'string' && w.to.startsWith('0x') ? shortAddr(w.to) : w.to}`);
      lines.push(`     ${timeAgo(w.time)} | tx: ${w.hash.slice(0, 14)}...`);
      if (i < top.length - 1) lines.push('');
    }

    return lines.join('\n');
  } catch (err) {
    return `Whale alert lookup failed: ${err.message}`;
  }
}
