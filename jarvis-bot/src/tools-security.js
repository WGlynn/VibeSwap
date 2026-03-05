// ============ Security Tools — Contract Audit & Rug Detection ============
//
// GoPlus Security API — completely free, no key required.
// The single most requested feature in crypto Telegram groups.
//
// Commands:
//   /rugcheck <address> [chain]  — Full token security scan
//   /audit <address> [chain]     — Contract verification + security
//   /honeypot <address> [chain]  — Quick honeypot check
//   /holders <address>           — Top token holders (Etherscan)
// ============

const HTTP_TIMEOUT = 12000;

// Chain ID mapping for GoPlus
const CHAIN_IDS = {
  eth: '1', ethereum: '1',
  bsc: '56', bnb: '56', binance: '56',
  polygon: '137', matic: '137', poly: '137',
  arbitrum: '42161', arb: '42161',
  optimism: '10', op: '10',
  avalanche: '43114', avax: '43114',
  fantom: '250', ftm: '250',
  base: '8453',
  solana: 'solana', sol: 'solana',
};

function resolveChainId(input) {
  if (!input) return '1'; // Default ETH
  return CHAIN_IDS[input.toLowerCase()] || input;
}

// ============ GoPlus Token Security (free, no key) ============

export async function rugCheck(address, chain = 'eth') {
  const chainId = resolveChainId(chain);

  if (!address || !address.startsWith('0x') || address.length !== 42) {
    return 'Usage: /rugcheck 0x... [chain]\n\nChains: eth, bsc, polygon, arbitrum, optimism, avalanche, base, fantom';
  }

  try {
    const resp = await fetch(
      `https://api.gopluslabs.io/api/v1/token_security/${chainId}?contract_addresses=${address}`,
      { signal: AbortSignal.timeout(HTTP_TIMEOUT) }
    );
    if (!resp.ok) throw new Error(`GoPlus ${resp.status}`);
    const data = await resp.json();

    if (data.code !== 1) return `GoPlus API error: ${data.message || 'Unknown'}`;

    const token = data.result?.[address.toLowerCase()];
    if (!token) return `Token not found at ${address} on chain ${chain}.`;

    // Risk assessment
    const risks = [];
    const warnings = [];
    const safe = [];

    // Critical risks
    if (token.is_honeypot === '1') risks.push('HONEYPOT DETECTED');
    if (token.is_blacklisted === '1') risks.push('Has blacklist function');
    if (token.can_take_back_ownership === '1') risks.push('Can reclaim ownership');
    if (token.owner_change_balance === '1') risks.push('Owner can change balances');
    if (token.hidden_owner === '1') risks.push('Hidden owner');
    if (token.selfdestruct === '1') risks.push('Has selfdestruct');
    if (token.external_call === '1') risks.push('External call risk');

    // Warnings
    if (token.is_proxy === '1') warnings.push('Proxy contract (upgradeable)');
    if (token.is_mintable === '1') warnings.push('Mintable');
    if (token.slippage_modifiable === '1') warnings.push('Slippage modifiable');
    if (token.transfer_pausable === '1') warnings.push('Transfers pausable');
    if (token.trading_cooldown === '1') warnings.push('Trading cooldown');
    if (token.anti_whale_modifiable === '1') warnings.push('Anti-whale modifiable');
    if (token.cannot_sell_all === '1') warnings.push('Cannot sell all tokens');

    // Safe indicators
    if (token.is_open_source === '1') safe.push('Open source');
    if (token.is_honeypot === '0') safe.push('Not a honeypot');
    if (token.is_blacklisted === '0') safe.push('No blacklist');
    if (token.can_take_back_ownership === '0') safe.push('Ownership secure');

    const name = token.token_name || 'Unknown';
    const symbol = token.token_symbol || '?';
    const totalSupply = token.total_supply ? parseFloat(token.total_supply).toLocaleString() : '?';
    const holders = token.holder_count || '?';
    const lpHolders = token.lp_holder_count || '?';

    // Build report
    const riskLevel = risks.length > 0 ? 'HIGH RISK' : warnings.length > 2 ? 'MODERATE RISK' : 'LOW RISK';
    const riskEmoji = risks.length > 0 ? '🔴' : warnings.length > 2 ? '🟡' : '🟢';

    const lines = [`${riskEmoji} ${name} (${symbol}) — ${riskLevel}\n`];
    lines.push(`  Address: ${address.slice(0, 10)}...${address.slice(-6)}`);
    lines.push(`  Chain: ${chain.toUpperCase()} | Holders: ${holders} | LP Holders: ${lpHolders}`);

    if (token.buy_tax) lines.push(`  Buy Tax: ${(parseFloat(token.buy_tax) * 100).toFixed(1)}%`);
    if (token.sell_tax) lines.push(`  Sell Tax: ${(parseFloat(token.sell_tax) * 100).toFixed(1)}%`);

    if (risks.length > 0) {
      lines.push(`\n  RISKS:`);
      for (const r of risks) lines.push(`    ❌ ${r}`);
    }
    if (warnings.length > 0) {
      lines.push(`\n  WARNINGS:`);
      for (const w of warnings) lines.push(`    ⚠️ ${w}`);
    }
    if (safe.length > 0) {
      lines.push(`\n  SAFE:`);
      for (const s of safe) lines.push(`    ✅ ${s}`);
    }

    // Owner info
    if (token.owner_address) {
      const ownerStr = token.owner_address === '0x0000000000000000000000000000000000000000'
        ? 'Renounced' : `${token.owner_address.slice(0, 10)}...`;
      lines.push(`\n  Owner: ${ownerStr}`);
    }
    if (token.creator_address) {
      lines.push(`  Creator: ${token.creator_address.slice(0, 10)}...`);
    }

    return lines.join('\n');
  } catch (err) {
    return `Security scan failed: ${err.message}`;
  }
}

// ============ Quick Honeypot Check ============

export async function honeypotCheck(address, chain = 'eth') {
  const chainId = resolveChainId(chain);

  if (!address?.startsWith('0x')) return 'Usage: /honeypot 0x... [chain]';

  try {
    const resp = await fetch(
      `https://api.gopluslabs.io/api/v1/token_security/${chainId}?contract_addresses=${address}`,
      { signal: AbortSignal.timeout(HTTP_TIMEOUT) }
    );
    const data = await resp.json();
    const token = data.result?.[address.toLowerCase()];
    if (!token) return `Token not found at ${address}.`;

    const isHoneypot = token.is_honeypot === '1';
    const buyTax = token.buy_tax ? (parseFloat(token.buy_tax) * 100).toFixed(1) : '?';
    const sellTax = token.sell_tax ? (parseFloat(token.sell_tax) * 100).toFixed(1) : '?';
    const name = token.token_name || 'Unknown';

    if (isHoneypot) {
      return `🔴 ${name} — HONEYPOT DETECTED!\n\nDo NOT buy this token. You will not be able to sell.`;
    }

    return `🟢 ${name} — Not a honeypot\n\n  Buy Tax: ${buyTax}% | Sell Tax: ${sellTax}%\n  Use /rugcheck ${address} for full audit.`;
  } catch (err) {
    return `Honeypot check failed: ${err.message}`;
  }
}

// ============ Contract Audit (Etherscan + GoPlus) ============

export async function contractAudit(address, chain = 'eth') {
  if (!address?.startsWith('0x')) return 'Usage: /audit 0x... [chain]';

  try {
    // GoPlus contract security
    const chainId = resolveChainId(chain);
    const gpResp = await fetch(
      `https://api.gopluslabs.io/api/v1/contract_security/${chainId}?contract_addresses=${address}`,
      { signal: AbortSignal.timeout(HTTP_TIMEOUT) }
    );
    const gpData = await gpResp.json();
    const contract = gpData.result?.[address.toLowerCase()];

    // Etherscan source code check
    let etherscanData = null;
    if (chainId === '1') {
      try {
        const esResp = await fetch(
          `https://api.etherscan.io/api?module=contract&action=getsourcecode&address=${address}`,
          { signal: AbortSignal.timeout(HTTP_TIMEOUT) }
        );
        const esData = await esResp.json();
        etherscanData = esData.result?.[0];
      } catch {}
    }

    const lines = [`Contract Audit: ${address.slice(0, 10)}...${address.slice(-6)}\n`];

    if (etherscanData) {
      const verified = etherscanData.SourceCode ? 'Yes' : 'No';
      lines.push(`  Verified: ${verified}`);
      if (etherscanData.ContractName) lines.push(`  Name: ${etherscanData.ContractName}`);
      if (etherscanData.CompilerVersion) lines.push(`  Compiler: ${etherscanData.CompilerVersion.slice(0, 20)}`);
      if (etherscanData.LicenseType) lines.push(`  License: ${etherscanData.LicenseType}`);
    }

    if (contract) {
      if (contract.is_proxy === '1') lines.push('  Type: Proxy (upgradeable)');
      if (contract.is_open_source === '1') lines.push('  ✅ Open source');
      else lines.push('  ❌ Not open source');
    }

    if (!contract && !etherscanData) {
      lines.push('  No contract data found. May not be verified.');
    }

    lines.push(`\n  Full security scan: /rugcheck ${address} ${chain}`);
    return lines.join('\n');
  } catch (err) {
    return `Audit failed: ${err.message}`;
  }
}

// ============ Top Holders (Etherscan) ============

export async function getTopHolders(address) {
  if (!address?.startsWith('0x')) return 'Usage: /holders 0x...';

  try {
    const resp = await fetch(
      `https://api.etherscan.io/api?module=token&action=tokenholderlist&contractaddress=${address}&page=1&offset=10`,
      { signal: AbortSignal.timeout(HTTP_TIMEOUT) }
    );
    const data = await resp.json();

    if (data.status !== '1' || !data.result?.length) {
      return `No holder data found for ${address.slice(0, 10)}...`;
    }

    const lines = [`Top Holders: ${address.slice(0, 10)}...${address.slice(-6)}\n`];
    for (let i = 0; i < Math.min(10, data.result.length); i++) {
      const h = data.result[i];
      const pct = h.TokenHolderQuantity && h.TotalSupply
        ? ((parseFloat(h.TokenHolderQuantity) / parseFloat(h.TotalSupply)) * 100).toFixed(2)
        : '?';
      const addr = `${h.TokenHolderAddress.slice(0, 8)}...${h.TokenHolderAddress.slice(-4)}`;
      lines.push(`  ${String(i + 1).padStart(2)}. ${addr} — ${pct}%`);
    }
    return lines.join('\n');
  } catch (err) {
    return `Holders lookup failed: ${err.message}`;
  }
}

// ============ GoPlus Approval Security ============

export async function checkApprovals(address, chain = 'eth') {
  const chainId = resolveChainId(chain);
  if (!address?.startsWith('0x')) return 'Usage: /approvals 0x... [chain]';

  try {
    const resp = await fetch(
      `https://api.gopluslabs.io/api/v2/token_approval_security/${chainId}?addresses=${address}`,
      { signal: AbortSignal.timeout(HTTP_TIMEOUT) }
    );
    const data = await resp.json();
    if (data.code !== 1) return 'Approval check unavailable.';

    const results = data.result;
    if (!results || Object.keys(results).length === 0) {
      return `No token approvals found for ${address.slice(0, 10)}...`;
    }

    const lines = [`Token Approvals: ${address.slice(0, 10)}...${address.slice(-6)}\n`];
    let risky = 0;
    for (const [token, info] of Object.entries(results)) {
      if (info.is_contract_danger === '1') risky++;
    }

    lines.push(`  Total approvals: ${Object.keys(results).length}`);
    if (risky > 0) lines.push(`  ⚠️ Risky approvals: ${risky}`);
    lines.push(`\n  Revoke risky approvals at revoke.cash`);
    return lines.join('\n');
  } catch (err) {
    return `Approval check failed: ${err.message}`;
  }
}
