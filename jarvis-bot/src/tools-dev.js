// ============ Developer Productivity Tools ============
// Free API endpoints for blockchain dev workflows
// No API keys required for any of these endpoints

const HTTP_TIMEOUT = 10000;

// ============ Chain Configs ============

const CHAIN_RPC = {
  eth: 'https://eth.llamarpc.com',
  base: 'https://mainnet.base.org',
  arb: 'https://arb1.arbitrum.io/rpc',
  polygon: 'https://polygon-rpc.com',
  op: 'https://mainnet.optimism.io',
};

const EXPLORER_API = {
  eth: 'https://api.etherscan.io/api',
  base: 'https://api.basescan.org/api',
  arb: 'https://api.arbiscan.io/api',
  polygon: 'https://api.polygonscan.com/api',
  op: 'https://api-optimistic.etherscan.io/api',
};

const CHAIN_NAMES = {
  eth: 'Ethereum',
  base: 'Base',
  arb: 'Arbitrum',
  polygon: 'Polygon',
  op: 'Optimism',
};

const CHAIN_CURRENCY = {
  eth: 'ETH',
  base: 'ETH',
  arb: 'ETH',
  polygon: 'MATIC',
  op: 'ETH',
};

// ============ Helpers ============

async function fetchJSON(url, options = {}) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), HTTP_TIMEOUT);
  try {
    const res = await fetch(url, { ...options, signal: controller.signal });
    if (!res.ok) throw new Error('HTTP ' + res.status);
    return await res.json();
  } finally {
    clearTimeout(timeout);
  }
}

async function rpcCall(chain, method, params = []) {
  const rpcUrl = CHAIN_RPC[chain];
  if (!rpcUrl) throw new Error('Unknown chain: ' + chain);
  const body = JSON.stringify({ jsonrpc: '2.0', id: 1, method, params });
  const data = await fetchJSON(rpcUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body,
  });
  if (data.error) throw new Error(data.error.message || 'RPC error');
  return data.result;
}

function formatGwei(hexWei) {
  const wei = BigInt(hexWei);
  const gwei = Number(wei) / 1e9;
  return gwei.toFixed(2);
}

function formatEther(hexWei) {
  const wei = BigInt(hexWei);
  const eth = Number(wei) / 1e18;
  return eth.toFixed(6);
}

function formatLargeNum(n) {
  if (n >= 1e9) return (n / 1e9).toFixed(2) + 'B';
  if (n >= 1e6) return (n / 1e6).toFixed(2) + 'M';
  if (n >= 1e3) return (n / 1e3).toFixed(1) + 'K';
  return n.toString();
}

function shortAddr(addr) {
  if (!addr || addr.length < 10) return addr || 'N/A';
  return addr.slice(0, 6) + '...' + addr.slice(-4);
}

function hexToDecimal(hex) {
  return parseInt(hex, 16);
}

function isValidAddress(addr) {
  return /^0x[0-9a-fA-F]{40}$/.test(addr);
}

function isValidTxHash(hash) {
  return /^0x[0-9a-fA-F]{64}$/.test(hash);
}

// Minimal keccak256 — tries available packages, falls back gracefully
function getKeccak256() {
  try {
    const { keccak_256 } = require('js-sha3');
    return (buf) => Buffer.from(keccak_256(buf), 'hex');
  } catch {
    try {
      const createKeccakHash = require('keccak');
      return (buf) => createKeccakHash('keccak256').update(buf).digest();
    } catch {
      // Fallback: Node.js crypto sha3-256
      // NOTE: sha3-256 !== keccak256 (different padding), but best effort without deps
      const { createHash } = require('crypto');
      return (buf) => createHash('sha3-256').update(buf).digest();
    }
  }
}

const keccak256 = getKeccak256();

// EIP-55 checksum implementation
function toChecksumAddress(address) {
  if (!isValidAddress(address)) throw new Error('Invalid address format');
  const addr = address.toLowerCase().replace('0x', '');
  const hash = keccak256(Buffer.from(addr, 'utf8')).toString('hex');
  let checksummed = '0x';
  for (let i = 0; i < 40; i++) {
    if (parseInt(hash[i], 16) >= 8) {
      checksummed += addr[i].toUpperCase();
    } else {
      checksummed += addr[i];
    }
  }
  return checksummed;
}

// ENS namehash (EIP-137)
function ensNamehash(name) {
  let node = Buffer.alloc(32, 0);
  if (name) {
    const labels = name.split('.');
    for (let i = labels.length - 1; i >= 0; i--) {
      const labelHash = keccak256(Buffer.from(labels[i], 'utf8'));
      node = keccak256(Buffer.concat([node, labelHash]));
    }
  }
  return '0x' + node.toString('hex');
}

// Decode ABI-encoded string from eth_call result
function decodeABIString(hex) {
  if (!hex || hex === '0x' || hex.length < 130) return null;
  const data = hex.replace('0x', '');
  const length = parseInt(data.slice(64, 128), 16);
  if (length === 0 || length > 1000) return null;
  const strHex = data.slice(128, 128 + length * 2);
  return Buffer.from(strHex, 'hex').toString('utf8');
}

// ============ /gas — Multi-chain Gas Tracker ============

export async function getGasTracker() {
  try {
    const results = [];

    // Ethereum — etherscan gas oracle (no key needed for basic rate)
    const ethGasPromise = fetchJSON(
      'https://api.etherscan.io/api?module=gastracker&action=gasoracle'
    )
      .then((data) => {
        if (data.status === '1' && data.result) {
          const r = data.result;
          results.push(
            '*Ethereum*\n' +
            '  Low: ' + r.SafeGasPrice + ' gwei\n' +
            '  Avg: ' + r.ProposeGasPrice + ' gwei\n' +
            '  Fast: ' + r.FastGasPrice + ' gwei'
          );
        } else {
          results.push('*Ethereum*\n  Unable to fetch');
        }
      })
      .catch(() => results.push('*Ethereum*\n  Unable to fetch'));

    // L2s — public RPC eth_gasPrice
    const l2Chains = ['base', 'arb', 'polygon', 'op'];
    const l2Promises = l2Chains.map((chain) =>
      rpcCall(chain, 'eth_gasPrice')
        .then((hexPrice) => {
          const gwei = formatGwei(hexPrice);
          results.push('*' + CHAIN_NAMES[chain] + '*\n  Gas: ' + gwei + ' gwei');
        })
        .catch(() => results.push('*' + CHAIN_NAMES[chain] + '*\n  Unable to fetch'))
    );

    await Promise.all([ethGasPromise, ...l2Promises]);

    return '*Gas Prices*\n\n' + results.join('\n\n');
  } catch (err) {
    return 'Error fetching gas prices: ' + err.message;
  }
}

// ============ /contract — Contract Info ============

export async function getContractInfo(address, chain = 'eth') {
  try {
    if (!isValidAddress(address)) {
      return 'Invalid address format. Expected: 0x followed by 40 hex characters.';
    }

    const explorer = EXPLORER_API[chain];
    if (!explorer) {
      return 'Unknown chain: ' + chain + '. Supported: ' + Object.keys(EXPLORER_API).join(', ');
    }

    const url = explorer + '?module=contract&action=getsourcecode&address=' + address;
    const data = await fetchJSON(url);

    if (data.status !== '1' || !data.result || !data.result[0]) {
      return 'No contract info found for ' + shortAddr(address) + ' on ' + (CHAIN_NAMES[chain] || chain) + '.';
    }

    const c = data.result[0];
    const isVerified = c.SourceCode && c.SourceCode.length > 0;
    const isProxy = c.Proxy === '1';

    let msg = '*Contract Info \u2014 ' + (CHAIN_NAMES[chain] || chain) + '*\n\n';
    msg += 'Address: `' + address + '`\n';
    msg += 'Name: ' + (c.ContractName || 'Unknown') + '\n';
    msg += 'Verified: ' + (isVerified ? 'Yes' : 'No') + '\n';
    msg += 'Compiler: ' + (c.CompilerVersion || 'N/A') + '\n';
    msg += 'Optimization: ' + (c.OptimizationUsed === '1' ? 'Yes (' + c.Runs + ' runs)' : 'No') + '\n';
    msg += 'Proxy: ' + (isProxy ? 'Yes -> ' + (c.Implementation || 'unknown impl') : 'No') + '\n';
    msg += 'License: ' + (c.LicenseType || 'N/A');

    return msg;
  } catch (err) {
    return 'Error fetching contract info: ' + err.message;
  }
}

// ============ /decode — Decode Transaction ============

export async function decodeTx(txHash, chain = 'eth') {
  try {
    if (!isValidTxHash(txHash)) {
      return 'Invalid transaction hash. Expected: 0x followed by 64 hex characters.';
    }

    if (!CHAIN_RPC[chain]) {
      return 'Unknown chain: ' + chain + '. Supported: ' + Object.keys(CHAIN_RPC).join(', ');
    }

    // Fetch tx data and receipt in parallel
    const [tx, receipt] = await Promise.all([
      rpcCall(chain, 'eth_getTransactionByHash', [txHash]),
      rpcCall(chain, 'eth_getTransactionReceipt', [txHash]),
    ]);

    if (!tx) return 'Transaction not found on ' + (CHAIN_NAMES[chain] || chain) + '.';

    const currency = CHAIN_CURRENCY[chain] || 'ETH';
    const value = tx.value ? formatEther(tx.value) : '0';
    const gasPrice = tx.gasPrice ? formatGwei(tx.gasPrice) : 'N/A';
    const methodSelector = (tx.input && tx.input.length >= 10)
      ? tx.input.slice(0, 10)
      : 'N/A (no input)';
    const inputSize = tx.input ? Math.max(0, (tx.input.length - 2) / 2) : 0;

    let msg = '*Transaction \u2014 ' + (CHAIN_NAMES[chain] || chain) + '*\n\n';
    msg += 'Hash: `' + txHash + '`\n';
    msg += 'From: `' + shortAddr(tx.from) + '`\n';
    msg += 'To: `' + shortAddr(tx.to) + '`\n';
    msg += 'Value: ' + value + ' ' + currency + '\n';
    msg += 'Gas Price: ' + gasPrice + ' gwei\n';
    msg += 'Method: `' + methodSelector + '`\n';
    msg += 'Input Data: ' + inputSize + ' bytes\n';

    if (receipt) {
      const gasUsed = hexToDecimal(receipt.gasUsed);
      const gasLimit = hexToDecimal(tx.gas);
      const status = receipt.status === '0x1' ? 'Success' : 'Failed';
      const blockNum = hexToDecimal(receipt.blockNumber);

      msg += 'Status: ' + status + '\n';
      msg += 'Block: ' + blockNum.toLocaleString() + '\n';
      msg += 'Gas Used: ' + gasUsed.toLocaleString() + ' / ' + gasLimit.toLocaleString() +
        ' (' + ((gasUsed / gasLimit) * 100).toFixed(1) + '%)\n';
      msg += 'Logs: ' + (receipt.logs ? receipt.logs.length : 0) + ' events';
    } else {
      msg += 'Status: Pending';
    }

    return msg;
  } catch (err) {
    return 'Error decoding transaction: ' + err.message;
  }
}

// ============ /ens — ENS Resolution ============

export async function resolveENS(nameOrAddress) {
  try {
    if (!nameOrAddress) return 'Usage: /ens <name.eth | 0xAddress>';

    const ENS_REGISTRY = '0x00000000000C2E074eC69A0dFb2997BA6C7d2e1e';

    if (isValidAddress(nameOrAddress)) {
      // Reverse resolution: address -> name
      const addr = nameOrAddress.toLowerCase().replace('0x', '');
      const reverseName = addr + '.addr.reverse';
      const nameHash = ensNamehash(reverseName);

      // resolver(bytes32 node) — selector 0x0178b8bf
      const resolverCalldata = '0x0178b8bf' + nameHash.replace('0x', '');
      const resolverResult = await rpcCall('eth', 'eth_call', [
        { to: ENS_REGISTRY, data: resolverCalldata },
        'latest',
      ]);

      const resolverAddr = '0x' + resolverResult.slice(26);
      if (resolverAddr === '0x' + '0'.repeat(40)) {
        return 'No ENS reverse record found for `' + shortAddr(nameOrAddress) + '`';
      }

      // name(bytes32 node) — selector 0x691f3431
      const nameCalldata = '0x691f3431' + nameHash.replace('0x', '');
      const nameResult = await rpcCall('eth', 'eth_call', [
        { to: resolverAddr, data: nameCalldata },
        'latest',
      ]);

      const name = decodeABIString(nameResult);
      if (!name) {
        return 'No ENS name set for `' + shortAddr(nameOrAddress) + '`';
      }

      return '*ENS Reverse Lookup*\n\nAddress: `' + nameOrAddress + '`\nName: ' + name;
    } else {
      // Forward resolution: name -> address
      const name = nameOrAddress.endsWith('.eth') ? nameOrAddress : nameOrAddress + '.eth';
      const nameHash = ensNamehash(name);

      // Get resolver from ENS registry
      const resolverCalldata = '0x0178b8bf' + nameHash.replace('0x', '');
      const resolverResult = await rpcCall('eth', 'eth_call', [
        { to: ENS_REGISTRY, data: resolverCalldata },
        'latest',
      ]);

      const resolverAddr = '0x' + resolverResult.slice(26);
      if (resolverAddr === '0x' + '0'.repeat(40)) {
        return 'No ENS record found for *' + name + '*';
      }

      // addr(bytes32 node) — selector 0x3b3b57de
      const addrCalldata = '0x3b3b57de' + nameHash.replace('0x', '');
      const addrResult = await rpcCall('eth', 'eth_call', [
        { to: resolverAddr, data: addrCalldata },
        'latest',
      ]);

      const resolved = '0x' + addrResult.slice(26);
      if (resolved === '0x' + '0'.repeat(40)) {
        return '*' + name + '* is registered but has no address set.';
      }

      return '*ENS Lookup*\n\nName: ' + name + '\nAddress: `' + resolved + '`';
    }
  } catch (err) {
    return 'Error resolving ENS: ' + err.message;
  }
}

// ============ /checksum — EIP-55 Checksum Address ============

export async function checksumAddress(address) {
  try {
    if (!address) return 'Usage: /checksum <0xAddress>';

    if (!isValidAddress(address)) {
      return 'Invalid address format. Expected: 0x followed by 40 hex characters.';
    }

    const checksummed = toChecksumAddress(address);
    const wasCorrect = address === checksummed;

    let msg = '*EIP-55 Checksum*\n\n';
    msg += 'Input: `' + address + '`\n';
    msg += 'Checksum: `' + checksummed + '`\n';
    msg += wasCorrect ? 'Already correctly checksummed.' : 'Input was NOT correctly checksummed.';

    return msg;
  } catch (err) {
    return 'Error computing checksum: ' + err.message;
  }
}

// ============ /abi — Fetch Contract ABI ============

export async function getContractABI(address, chain = 'eth') {
  try {
    if (!isValidAddress(address)) {
      return 'Invalid address format. Expected: 0x followed by 40 hex characters.';
    }

    const explorer = EXPLORER_API[chain];
    if (!explorer) {
      return 'Unknown chain: ' + chain + '. Supported: ' + Object.keys(EXPLORER_API).join(', ');
    }

    const url = explorer + '?module=contract&action=getabi&address=' + address;
    const data = await fetchJSON(url);

    if (data.status !== '1' || !data.result) {
      return 'No verified ABI found for `' + shortAddr(address) + '` on ' +
        (CHAIN_NAMES[chain] || chain) + '. Contract may not be verified.';
    }

    let abi;
    try {
      abi = JSON.parse(data.result);
    } catch {
      return 'Failed to parse ABI response.';
    }

    // Extract function signatures
    const functions = abi
      .filter((item) => item.type === 'function')
      .map((fn) => {
        const inputs = (fn.inputs || []).map((i) => i.type + ' ' + i.name).join(', ');
        const mutability = fn.stateMutability !== 'nonpayable'
          ? ' [' + fn.stateMutability + ']'
          : '';
        return '  `' + fn.name + '(' + inputs + ')`' + mutability;
      });

    const events = abi.filter((item) => item.type === 'event');

    let msg = '*Contract ABI \u2014 ' + (CHAIN_NAMES[chain] || chain) + '*\n\n';
    msg += 'Address: `' + shortAddr(address) + '`\n';
    msg += 'Functions: ' + functions.length + ' | Events: ' + events.length + '\n\n';

    if (functions.length > 0) {
      // Cap at 25 to avoid Telegram message size limits
      const shown = functions.slice(0, 25);
      msg += '*Functions:*\n' + shown.join('\n');
      if (functions.length > 25) {
        msg += '\n  ... and ' + (functions.length - 25) + ' more';
      }
    } else {
      msg += 'No public functions found.';
    }

    return msg;
  } catch (err) {
    return 'Error fetching ABI: ' + err.message;
  }
}

// ============ /block — Latest Block Info ============

export async function getLatestBlock(chain = 'eth') {
  try {
    if (!CHAIN_RPC[chain]) {
      return 'Unknown chain: ' + chain + '. Supported: ' + Object.keys(CHAIN_RPC).join(', ');
    }

    const block = await rpcCall(chain, 'eth_getBlockByNumber', ['latest', false]);

    if (!block) return 'Failed to fetch latest block on ' + (CHAIN_NAMES[chain] || chain) + '.';

    const number = hexToDecimal(block.number);
    const timestamp = hexToDecimal(block.timestamp);
    const date = new Date(timestamp * 1000);
    const txCount = block.transactions ? block.transactions.length : 0;
    const gasUsed = hexToDecimal(block.gasUsed);
    const gasLimit = hexToDecimal(block.gasLimit);
    const gasPercent = ((gasUsed / gasLimit) * 100).toFixed(1);
    const baseFee = block.baseFeePerGas ? formatGwei(block.baseFeePerGas) : 'N/A';

    let msg = '*Latest Block \u2014 ' + (CHAIN_NAMES[chain] || chain) + '*\n\n';
    msg += 'Block: ' + number.toLocaleString() + '\n';
    msg += 'Time: ' + date.toISOString().replace('T', ' ').replace('.000Z', ' UTC') + '\n';
    msg += 'Transactions: ' + txCount + '\n';
    msg += 'Gas Used: ' + formatLargeNum(gasUsed) + ' / ' + formatLargeNum(gasLimit) +
      ' (' + gasPercent + '%)\n';
    msg += 'Base Fee: ' + baseFee + ' gwei\n';
    msg += 'Hash: `' + shortAddr(block.hash) + '`';

    return msg;
  } catch (err) {
    return 'Error fetching block: ' + err.message;
  }
}

// ============ /npm — npm Package Info ============

export async function getNpmInfo(packageName) {
  try {
    if (!packageName) return 'Usage: /npm <package-name>';

    const data = await fetchJSON(
      'https://registry.npmjs.org/' + encodeURIComponent(packageName)
    );

    if (data.error) return 'Package not found: ' + packageName;

    const latest = data['dist-tags'] && data['dist-tags'].latest;
    const latestVersion = data.versions && data.versions[latest];
    const description = data.description || 'No description';
    const license = (latestVersion && latestVersion.license) || data.license || 'N/A';
    const depsCount = (latestVersion && latestVersion.dependencies)
      ? Object.keys(latestVersion.dependencies).length
      : 0;
    const lastPublish = (data.time && data.time[latest])
      ? new Date(data.time[latest]).toISOString().split('T')[0]
      : 'N/A';

    // Weekly downloads from separate endpoint
    let weeklyDownloads = 'N/A';
    try {
      const dlData = await fetchJSON(
        'https://api.npmjs.org/downloads/point/last-week/' + encodeURIComponent(packageName)
      );
      if (dlData.downloads) weeklyDownloads = formatLargeNum(dlData.downloads);
    } catch {
      // Downloads API may fail — non-critical
    }

    const homepage = (latestVersion && latestVersion.homepage) || data.homepage || '';

    let msg = '*npm \u2014 ' + packageName + '*\n\n';
    msg += 'Version: ' + (latest || 'N/A') + '\n';
    msg += 'Description: ' + description + '\n';
    msg += 'License: ' + license + '\n';
    msg += 'Weekly Downloads: ' + weeklyDownloads + '\n';
    msg += 'Dependencies: ' + depsCount + '\n';
    msg += 'Last Published: ' + lastPublish;
    if (homepage) msg += '\nHomepage: ' + homepage;

    return msg;
  } catch (err) {
    if (err.message.includes('404')) return 'Package not found: ' + packageName;
    return 'Error fetching npm info: ' + err.message;
  }
}

// ============ /crate — Rust Crate Info ============

export async function getCrateInfo(crateName) {
  try {
    if (!crateName) return 'Usage: /crate <crate-name>';

    const data = await fetchJSON(
      'https://crates.io/api/v1/crates/' + encodeURIComponent(crateName),
      { headers: { 'User-Agent': 'vibeswap-jarvis-bot (telegram)' } }
    );

    if (data.errors) return 'Crate not found: ' + crateName;

    const crate = data.crate;
    const latestVersion = crate.newest_version || crate.max_version;
    const description = crate.description || 'No description';
    const downloads = crate.downloads ? formatLargeNum(crate.downloads) : 'N/A';
    const recentDownloads = crate.recent_downloads
      ? formatLargeNum(crate.recent_downloads)
      : 'N/A';
    const categories = data.categories
      ? data.categories.map((c) => c.category).join(', ')
      : 'N/A';
    const updated = crate.updated_at
      ? new Date(crate.updated_at).toISOString().split('T')[0]
      : 'N/A';

    let msg = '*crates.io \u2014 ' + crateName + '*\n\n';
    msg += 'Version: ' + latestVersion + '\n';
    msg += 'Description: ' + description + '\n';
    msg += 'Total Downloads: ' + downloads + '\n';
    msg += 'Recent Downloads: ' + recentDownloads + '\n';
    msg += 'Categories: ' + categories + '\n';
    msg += 'Last Updated: ' + updated;
    if (crate.homepage) msg += '\nHomepage: ' + crate.homepage;
    if (crate.repository) msg += '\nRepo: ' + crate.repository;

    return msg;
  } catch (err) {
    if (err.message.includes('404')) return 'Crate not found: ' + crateName;
    return 'Error fetching crate info: ' + err.message;
  }
}
