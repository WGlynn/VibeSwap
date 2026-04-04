// ============ Research & Analysis Tools — Deep Crypto Intelligence ============
//
// Making Jarvis the smartest crypto analyst in Telegram.
// All APIs are free with no API key required.
//
// Commands:
//   /tokenomics <token>          — Deep tokenomics breakdown
//   /protocol <a> <b>            — Side-by-side DeFi protocol comparison
//   /farms [minApy] [chain]      — Top yield farming opportunities
//   /governance <protocol>       — Governance proposals (Snapshot)
//   /github <owner/repo>         — GitHub repo activity analysis
//   /onchain [chain]             — Chain-level on-chain metrics
//   /correlation <a> <b> [days]  — Price correlation between two tokens
//   /regime                      — Market regime analysis
// ============

const HTTP_TIMEOUT = 15000;

// ============ Shared Helpers ============

async function fetchJSON(url, headers = {}) {
  const resp = await fetch(url, {
    signal: AbortSignal.timeout(HTTP_TIMEOUT),
    headers: { 'Accept': 'application/json', ...headers },
  });
  if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
  return resp.json();
}

function formatLargeNum(n) {
  if (n == null || isNaN(n)) return '?';
  if (n >= 1e12) return `${(n / 1e12).toFixed(2)}T`;
  if (n >= 1e9) return `${(n / 1e9).toFixed(2)}B`;
  if (n >= 1e6) return `${(n / 1e6).toFixed(2)}M`;
  if (n >= 1e3) return `${(n / 1e3).toFixed(1)}K`;
  return String(Math.round(n));
}

function fmtPct(p) {
  if (p == null) return '?';
  return `${p >= 0 ? '+' : ''}${p.toFixed(2)}%`;
}

function fmtPrice(p) {
  if (p == null) return '?';
  if (p >= 1) return `$${p.toLocaleString(undefined, { maximumFractionDigits: 2 })}`;
  if (p >= 0.01) return `$${p.toFixed(4)}`;
  return `$${p.toFixed(8)}`;
}

const COIN_ALIASES = {
  btc: 'bitcoin', eth: 'ethereum', sol: 'solana', bnb: 'binancecoin',
  xrp: 'ripple', ada: 'cardano', dot: 'polkadot', avax: 'avalanche-2',
  matic: 'matic-network', pol: 'matic-network', link: 'chainlink',
  uni: 'uniswap', aave: 'aave', arb: 'arbitrum', op: 'optimism',
  sui: 'sui', apt: 'aptos', near: 'near', atom: 'cosmos',
  doge: 'dogecoin', shib: 'shiba-inu', pepe: 'pepe',
  ton: 'the-open-network', trx: 'tron', ltc: 'litecoin',
  fil: 'filecoin', icp: 'internet-computer', ckb: 'nervos-network',
};

function resolveCoinId(input) {
  const lower = input.toLowerCase().trim();
  return COIN_ALIASES[lower] || lower;
}

// ============ /tokenomics — Deep Tokenomics Breakdown ============

export async function getTokenomicsAnalysis(token) {
  if (!token) return 'Usage: /tokenomics bitcoin\n\nDeep tokenomics breakdown: supply, distribution, FDV ratio, emission.';

  const id = resolveCoinId(token);

  try {
    const data = await fetchJSON(
      `https://api.coingecko.com/api/v3/coins/${id}?localization=false&tickers=false&community_data=false&developer_data=false`
    );

    const md = data.market_data;
    if (!md) return `No data found for "${token}". Try the full name or CoinGecko ID.`;

    const name = data.name;
    const symbol = (data.symbol || token).toUpperCase();
    const price = md.current_price?.usd;
    const mcap = md.market_cap?.usd;
    const fdv = md.fully_diluted_valuation?.usd;
    const circulating = md.circulating_supply;
    const total = md.total_supply;
    const max = md.max_supply;

    const lines = [`*TOKENOMICS: ${name} (${symbol})*\n`];

    // ---- Supply Breakdown ----
    lines.push('*Supply*');
    lines.push(`  Circulating: \`${circulating ? formatLargeNum(circulating) : '?'}\``);
    lines.push(`  Total:       \`${total ? formatLargeNum(total) : '?'}\``);
    lines.push(`  Max:         \`${max ? formatLargeNum(max) : 'Unlimited'}\``);

    // Circulating ratio
    if (circulating && total) {
      const circRatio = (circulating / total) * 100;
      lines.push(`  Circ/Total:  \`${circRatio.toFixed(1)}%\``);
    }
    if (circulating && max) {
      const circMaxRatio = (circulating / max) * 100;
      lines.push(`  Circ/Max:    \`${circMaxRatio.toFixed(1)}%\``);
    }

    // ---- Valuation Metrics ----
    lines.push('\n*Valuation*');
    lines.push(`  Price:  \`${fmtPrice(price)}\``);
    lines.push(`  MCap:   \`$${formatLargeNum(mcap)}\``);
    lines.push(`  FDV:    \`$${formatLargeNum(fdv)}\``);

    if (mcap && fdv && fdv > 0) {
      const fdvRatio = mcap / fdv;
      lines.push(`  MCap/FDV: \`${(fdvRatio * 100).toFixed(1)}%\``);

      // Dilution warning
      if (fdvRatio < 0.3) {
        lines.push('  WARNING: >70% of tokens not yet in circulation — high dilution risk');
      } else if (fdvRatio < 0.5) {
        lines.push('  CAUTION: >50% of tokens not yet in circulation');
      }
    }

    // ---- Emission Estimate ----
    if (circulating && total && total > circulating) {
      const unlocked = total - circulating;
      const unlockedPct = (unlocked / total) * 100;
      lines.push('\n*Emission Estimate*');
      lines.push(`  Locked/Unvested: \`${formatLargeNum(unlocked)} (${unlockedPct.toFixed(1)}%)\``);
      if (price) {
        const unlockedValue = unlocked * price;
        lines.push(`  Locked Value:    \`$${formatLargeNum(unlockedValue)}\``);
      }
    }

    // ---- Market Rank & Volume ----
    const vol = md.total_volume?.usd;
    const rank = data.market_cap_rank;
    lines.push('\n*Market*');
    if (rank) lines.push(`  Rank:   \`#${rank}\``);
    if (vol) lines.push(`  24h Vol: \`$${formatLargeNum(vol)}\``);
    if (vol && mcap) {
      const volMcap = (vol / mcap) * 100;
      lines.push(`  Vol/MCap: \`${volMcap.toFixed(2)}%\``);
      if (volMcap > 50) lines.push('  High turnover — potential volatility event');
      else if (volMcap < 1) lines.push('  Low turnover — thin liquidity');
    }

    // ---- Price Performance ----
    const change24h = md.price_change_percentage_24h;
    const change7d = md.price_change_percentage_7d;
    const change30d = md.price_change_percentage_30d;
    const change1y = md.price_change_percentage_1y;
    lines.push('\n*Performance*');
    lines.push(`  24h: \`${fmtPct(change24h)}\`  7d: \`${fmtPct(change7d)}\``);
    lines.push(`  30d: \`${fmtPct(change30d)}\`  1y: \`${fmtPct(change1y)}\``);

    return lines.join('\n');
  } catch (err) {
    return `Tokenomics lookup failed: ${err.message}`;
  }
}

// ============ /protocol — Side-by-Side DeFi Protocol Comparison ============

export async function getProtocolComparison(protocolA, protocolB) {
  if (!protocolA || !protocolB) return 'Usage: /protocol aave uniswap\n\nSide-by-side DeFi protocol comparison using DeFi Llama data.';

  try {
    const [a, b] = await Promise.all([
      fetchJSON(`https://api.llama.fi/protocol/${encodeURIComponent(protocolA.toLowerCase())}`),
      fetchJSON(`https://api.llama.fi/protocol/${encodeURIComponent(protocolB.toLowerCase())}`),
    ]);

    const nameA = a.name || protocolA;
    const nameB = b.name || protocolB;

    // Extract current TVL
    const tvlA = a.currentChainTvls?.total || (a.tvl?.length ? a.tvl[a.tvl.length - 1]?.totalLiquidityUSD : 0) || 0;
    const tvlB = b.currentChainTvls?.total || (b.tvl?.length ? b.tvl[b.tvl.length - 1]?.totalLiquidityUSD : 0) || 0;

    // TVL 30d ago for change calculation
    const tvl30dA = a.tvl?.length > 30 ? a.tvl[a.tvl.length - 31]?.totalLiquidityUSD : null;
    const tvl30dB = b.tvl?.length > 30 ? b.tvl[b.tvl.length - 31]?.totalLiquidityUSD : null;

    const tvlChange30dA = tvl30dA ? ((tvlA - tvl30dA) / tvl30dA) * 100 : null;
    const tvlChange30dB = tvl30dB ? ((tvlB - tvl30dB) / tvl30dB) * 100 : null;

    const chainsA = (a.chains || []).join(', ');
    const chainsB = (b.chains || []).join(', ');

    const colW = 16;
    const lines = [`*${nameA} vs ${nameB}*\n`];

    lines.push(`  ${'Metric'.padEnd(colW)} ${nameA.slice(0, colW).padEnd(colW)} ${nameB.slice(0, colW)}`);
    lines.push(`  ${'─'.repeat(colW)} ${'─'.repeat(colW)} ${'─'.repeat(colW)}`);

    const metrics = [
      ['Category', a.category || '?', b.category || '?'],
      ['TVL', `$${formatLargeNum(tvlA)}`, `$${formatLargeNum(tvlB)}`],
      ['TVL 30d', tvlChange30dA != null ? fmtPct(tvlChange30dA) : '?', tvlChange30dB != null ? fmtPct(tvlChange30dB) : '?'],
      ['Chains', String((a.chains || []).length), String((b.chains || []).length)],
      ['Token', a.symbol || '?', b.symbol || '?'],
      ['MCap', a.mcap ? `$${formatLargeNum(a.mcap)}` : '?', b.mcap ? `$${formatLargeNum(b.mcap)}` : '?'],
    ];

    for (const [label, valA, valB] of metrics) {
      lines.push(`  ${label.padEnd(colW)} ${valA.padEnd(colW)} ${valB}`);
    }

    // Chain breakdown
    lines.push(`\n*Chains*`);
    lines.push(`  ${nameA}: ${chainsA || 'N/A'}`);
    lines.push(`  ${nameB}: ${chainsB || 'N/A'}`);

    // Verdict
    lines.push('\n*Quick Take*');
    if (tvlA > tvlB * 2) lines.push(`  ${nameA} dominates in TVL (${(tvlA / tvlB).toFixed(1)}x larger)`);
    else if (tvlB > tvlA * 2) lines.push(`  ${nameB} dominates in TVL (${(tvlB / tvlA).toFixed(1)}x larger)`);
    else lines.push('  TVL roughly comparable');

    if ((a.chains || []).length > (b.chains || []).length * 2) lines.push(`  ${nameA} has broader chain coverage`);
    else if ((b.chains || []).length > (a.chains || []).length * 2) lines.push(`  ${nameB} has broader chain coverage`);

    return lines.join('\n');
  } catch (err) {
    if (err.message.includes('404')) return `One or both protocols not found on DeFi Llama. Try exact names (e.g., "aave", "uniswap").`;
    return `Protocol comparison failed: ${err.message}`;
  }
}

// ============ /farms — Top Yield Farming Opportunities ============

export async function getYieldFarming(minApy = 5, chain = null) {
  try {
    const data = await fetchJSON('https://yields.llama.fi/pools');
    let pools = data.data || [];

    // Filter by chain if specified
    if (chain) {
      const chainLower = chain.toLowerCase();
      pools = pools.filter(p => p.chain?.toLowerCase() === chainLower);
    }

    // Filter: APY > minApy, TVL > $100K, exclude outlier APYs
    pools = pools
      .filter(p =>
        p.tvlUsd > 100000 &&
        p.apy >= minApy &&
        p.apy < 10000 &&
        p.project &&
        p.symbol
      )
      .sort((a, b) => b.apy - a.apy)
      .slice(0, 15);

    if (pools.length === 0) {
      return chain
        ? `No yield farms found on ${chain} with APY >= ${minApy}%.`
        : `No yield farms found with APY >= ${minApy}%.`;
    }

    const title = chain
      ? `*Yield Farms — ${chain} (APY >= ${minApy}%)*`
      : `*Top Yield Farms (APY >= ${minApy}%)*`;

    const lines = [title, ''];
    lines.push(`  ${'#'.padEnd(3)} ${'Protocol'.padEnd(16)} ${'Pool'.padEnd(20)} ${'APY'.padEnd(10)} ${'TVL'.padEnd(10)} Chain`);
    lines.push(`  ${'─'.repeat(3)} ${'─'.repeat(16)} ${'─'.repeat(20)} ${'─'.repeat(10)} ${'─'.repeat(10)} ${'─'.repeat(10)}`);

    for (let i = 0; i < pools.length; i++) {
      const p = pools[i];
      const project = (p.project || '?').slice(0, 15);
      const symbol = (p.symbol || '?').slice(0, 19);
      const apy = `${p.apy.toFixed(2)}%`;
      const tvl = `$${formatLargeNum(p.tvlUsd)}`;
      const pChain = (p.chain || '?').slice(0, 10);
      lines.push(`  ${String(i + 1).padEnd(3)} ${project.padEnd(16)} ${symbol.padEnd(20)} \`${apy.padEnd(8)}\` ${tvl.padEnd(10)} ${pChain}`);
    }

    // Summary stats
    const avgApy = pools.reduce((s, p) => s + p.apy, 0) / pools.length;
    const totalTvl = pools.reduce((s, p) => s + p.tvlUsd, 0);
    lines.push(`\n  Avg APY: \`${avgApy.toFixed(2)}%\` | Combined TVL: \`$${formatLargeNum(totalTvl)}\``);

    return lines.join('\n');
  } catch (err) {
    return `Yield farming lookup failed: ${err.message}`;
  }
}

// ============ /governance — Governance Activity (Snapshot) ============

export async function getGovernanceActivity(protocol) {
  if (!protocol) return 'Usage: /governance aave\n\nShows active and recent governance proposals from Snapshot.';

  // Common protocol-to-Snapshot-space mapping
  const SPACE_MAP = {
    aave: 'aave.eth',
    uniswap: 'uniswapgovernance.eth',
    ens: 'ens.eth',
    compound: 'comp-vote.eth',
    arbitrum: 'arbitrumfoundation.eth',
    optimism: 'opcollective.eth',
    gitcoin: 'gitcoindao.eth',
    lido: 'lido-snapshot.eth',
    maker: 'makerdao.eth',
    curve: 'curve.eth',
    balancer: 'balancer.eth',
    sushi: 'sushigov.eth',
    hop: 'hop.eth',
  };

  // BOT-302: Sanitize space ID to prevent GraphQL injection
  const rawSpace = SPACE_MAP[protocol.toLowerCase()] || `${protocol.toLowerCase().replace(/[^a-z0-9.\-]/g, '')}.eth`;
  const space = rawSpace.replace(/["\\\n\r]/g, ''); // Strip GraphQL-breaking chars

  const query = `{
    space(id: "${space}") {
      id
      name
      members
      proposals(first: 8, skip: 0, orderBy: "created", orderDirection: desc) {
        id
        title
        state
        start
        end
        scores_total
        votes
        choices
        scores
      }
    }
  }`;

  try {
    const resp = await fetch('https://hub.snapshot.org/graphql', {
      method: 'POST',
      signal: AbortSignal.timeout(HTTP_TIMEOUT),
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ query }),
    });

    if (!resp.ok) throw new Error(`Snapshot ${resp.status}`);
    const data = await resp.json();
    const spaceData = data?.data?.space;

    if (!spaceData) return `Space "${space}" not found on Snapshot. Try: ${Object.keys(SPACE_MAP).join(', ')}`;

    const lines = [`*Governance: ${spaceData.name || space}*\n`];
    lines.push(`  Members: \`${(spaceData.members || 0).toLocaleString()}\``);

    const proposals = spaceData.proposals || [];
    if (proposals.length === 0) {
      lines.push('\n  No recent proposals.');
      return lines.join('\n');
    }

    // Separate active vs closed
    const active = proposals.filter(p => p.state === 'active');
    const closed = proposals.filter(p => p.state === 'closed');

    if (active.length > 0) {
      lines.push('\n*Active Proposals*');
      for (const p of active) {
        const endsIn = p.end ? formatTimeUntil(p.end * 1000) : '?';
        lines.push(`  VOTE NOW: ${p.title.slice(0, 70)}`);
        lines.push(`    Votes: \`${(p.votes || 0).toLocaleString()}\` | Ends: \`${endsIn}\``);
        if (p.choices && p.scores) {
          const topIdx = p.scores.indexOf(Math.max(...p.scores));
          const topChoice = p.choices[topIdx] || '?';
          const topPct = p.scores_total > 0 ? ((p.scores[topIdx] / p.scores_total) * 100).toFixed(1) : '0';
          lines.push(`    Leading: ${topChoice} (\`${topPct}%\`)`);
        }
      }
    }

    if (closed.length > 0) {
      lines.push('\n*Recent Closed*');
      for (const p of closed.slice(0, 5)) {
        const endDate = p.end ? new Date(p.end * 1000).toLocaleDateString() : '?';
        lines.push(`  ${p.title.slice(0, 65)}`);
        lines.push(`    Votes: \`${(p.votes || 0).toLocaleString()}\` | Ended: ${endDate}`);
        if (p.choices && p.scores && p.scores.length > 0) {
          const topIdx = p.scores.indexOf(Math.max(...p.scores));
          const topChoice = p.choices[topIdx] || '?';
          lines.push(`    Result: ${topChoice}`);
        }
      }
    }

    // Participation metric
    const avgVotes = proposals.filter(p => p.votes > 0).reduce((s, p) => s + p.votes, 0) / Math.max(1, proposals.filter(p => p.votes > 0).length);
    lines.push(`\n  Avg Participation: \`${Math.round(avgVotes).toLocaleString()} votes/proposal\``);

    return lines.join('\n');
  } catch (err) {
    return `Governance lookup failed: ${err.message}`;
  }
}

function formatTimeUntil(futureMs) {
  const diff = futureMs - Date.now();
  if (diff <= 0) return 'ended';
  if (diff < 3600000) return `${Math.round(diff / 60000)}m`;
  if (diff < 86400000) return `${Math.round(diff / 3600000)}h`;
  return `${Math.round(diff / 86400000)}d`;
}

// ============ /github — GitHub Repo Activity Analysis ============

export async function getGitHubActivity(repo) {
  if (!repo) return 'Usage: /github ethereum/go-ethereum\n\nAnalyzes GitHub repo: commits, PRs, issues, contributors, stars.';

  // If just a project name, try to resolve
  const PROJECT_MAP = {
    ethereum: 'ethereum/go-ethereum',
    bitcoin: 'bitcoin/bitcoin',
    solana: 'solana-labs/solana',
    uniswap: 'Uniswap/v3-core',
    aave: 'aave/aave-v3-core',
    arbitrum: 'OffchainLabs/nitro',
    optimism: 'ethereum-optimism/optimism',
    chainlink: 'smartcontractkit/chainlink',
    cosmos: 'cosmos/cosmos-sdk',
    near: 'near/nearcore',
    sui: 'MystenLabs/sui',
    aptos: 'aptos-labs/aptos-core',
    vibeswap: 'WGlynn/VibeSwap',
  };

  const repoPath = repo.includes('/') ? repo : (PROJECT_MAP[repo.toLowerCase()] || repo);
  const ghHeaders = { 'User-Agent': 'JarvisBot/1.0', 'Accept': 'application/vnd.github.v3+json' };

  try {
    // Parallel: repo info, recent commits, recent PRs, recent issues
    const [repoData, commits, pulls, issues] = await Promise.allSettled([
      fetchJSON(`https://api.github.com/repos/${repoPath}`, ghHeaders),
      fetchJSON(`https://api.github.com/repos/${repoPath}/commits?per_page=5`, ghHeaders),
      fetchJSON(`https://api.github.com/repos/${repoPath}/pulls?state=all&per_page=5&sort=updated`, ghHeaders),
      fetchJSON(`https://api.github.com/repos/${repoPath}/issues?state=all&per_page=5&sort=updated`, ghHeaders),
    ]);

    if (repoData.status === 'rejected') {
      return `Repository "${repoPath}" not found or rate limited. GitHub allows 60 requests/hour without auth.`;
    }

    const r = repoData.value;
    const lines = [`*GitHub: ${r.full_name}*\n`];

    // ---- Repo Overview ----
    lines.push('*Overview*');
    lines.push(`  Stars:       \`${(r.stargazers_count || 0).toLocaleString()}\``);
    lines.push(`  Forks:       \`${(r.forks_count || 0).toLocaleString()}\``);
    lines.push(`  Open Issues: \`${(r.open_issues_count || 0).toLocaleString()}\``);
    lines.push(`  Watchers:    \`${(r.subscribers_count || 0).toLocaleString()}\``);
    lines.push(`  Language:    \`${r.language || '?'}\``);
    if (r.license?.spdx_id) lines.push(`  License:     \`${r.license.spdx_id}\``);
    if (r.pushed_at) lines.push(`  Last Push:   \`${formatAge(new Date(r.pushed_at).getTime())}\``);
    if (r.created_at) lines.push(`  Created:     \`${new Date(r.created_at).toLocaleDateString()}\``);

    // ---- Activity Score ----
    const daysSinceLastPush = r.pushed_at ? (Date.now() - new Date(r.pushed_at).getTime()) / 86400000 : 999;
    const activityScore = daysSinceLastPush < 1 ? 'Very Active' :
                          daysSinceLastPush < 7 ? 'Active' :
                          daysSinceLastPush < 30 ? 'Moderate' :
                          daysSinceLastPush < 90 ? 'Slow' : 'Inactive';
    lines.push(`  Activity:    \`${activityScore}\``);

    // ---- Recent Commits ----
    if (commits.status === 'fulfilled' && Array.isArray(commits.value)) {
      lines.push('\n*Recent Commits*');
      for (const c of commits.value.slice(0, 5)) {
        const msg = (c.commit?.message?.split('\n')[0] || '?').slice(0, 60);
        const author = (c.commit?.author?.name || '?').slice(0, 15);
        const age = c.commit?.author?.date ? formatAge(new Date(c.commit.author.date).getTime()) : '';
        lines.push(`  \`${c.sha?.slice(0, 7)}\` ${msg}`);
        lines.push(`    by ${author} | ${age}`);
      }
    }

    // ---- Recent PRs ----
    if (pulls.status === 'fulfilled' && Array.isArray(pulls.value)) {
      const recentPRs = pulls.value.slice(0, 3);
      if (recentPRs.length > 0) {
        lines.push('\n*Recent PRs*');
        for (const pr of recentPRs) {
          const state = pr.merged_at ? 'merged' : pr.state;
          const title = (pr.title || '?').slice(0, 55);
          lines.push(`  [${state}] ${title}`);
          lines.push(`    by ${(pr.user?.login || '?').slice(0, 15)} | #${pr.number}`);
        }
      }
    }

    // ---- Recent Issues ----
    if (issues.status === 'fulfilled' && Array.isArray(issues.value)) {
      // Filter out pull requests (GitHub API returns PRs in issues too)
      const actualIssues = issues.value.filter(i => !i.pull_request).slice(0, 3);
      if (actualIssues.length > 0) {
        lines.push('\n*Recent Issues*');
        for (const issue of actualIssues) {
          const title = (issue.title || '?').slice(0, 55);
          lines.push(`  [${issue.state}] ${title}`);
          lines.push(`    #${issue.number} | ${(issue.comments || 0)} comments`);
        }
      }
    }

    return lines.join('\n');
  } catch (err) {
    return `GitHub analysis failed: ${err.message}`;
  }
}

function formatAge(timestamp) {
  const ms = Date.now() - timestamp;
  if (ms < 60000) return 'just now';
  if (ms < 3600000) return `${Math.round(ms / 60000)}m ago`;
  if (ms < 86400000) return `${Math.round(ms / 3600000)}h ago`;
  return `${Math.round(ms / 86400000)}d ago`;
}

// ============ /onchain — Chain-Level On-Chain Metrics ============

export async function getOnChainMetrics(chain = 'ethereum') {
  try {
    // Parallel: chain TVL data, all chains for ranking, stablecoins on chain
    const [chainsData, protocolsResp] = await Promise.allSettled([
      fetchJSON('https://api.llama.fi/v2/chains'),
      fetchJSON(`https://api.llama.fi/v2/historicalChainTvl/${encodeURIComponent(chain)}`),
    ]);

    const lines = [`*On-Chain Metrics: ${chain}*\n`];

    // ---- TVL & Ranking ----
    if (chainsData.status === 'fulfilled') {
      const chains = chainsData.value.sort((a, b) => (b.tvl || 0) - (a.tvl || 0));
      const chainInfo = chains.find(c => c.name.toLowerCase() === chain.toLowerCase() || c.gecko_id === chain.toLowerCase());
      const rank = chainInfo ? chains.indexOf(chainInfo) + 1 : '?';

      if (chainInfo) {
        lines.push('*TVL*');
        lines.push(`  Current TVL: \`$${formatLargeNum(chainInfo.tvl)}\``);
        lines.push(`  Chain Rank:  \`#${rank}\``);
        if (chainInfo.tokenSymbol) lines.push(`  Native Token: \`${chainInfo.tokenSymbol}\``);
      }
    }

    // ---- TVL History & Trend ----
    if (protocolsResp.status === 'fulfilled' && Array.isArray(protocolsResp.value)) {
      const tvlHistory = protocolsResp.value;
      if (tvlHistory.length > 1) {
        const current = tvlHistory[tvlHistory.length - 1]?.tvl || 0;
        const weekAgo = tvlHistory.length > 7 ? tvlHistory[tvlHistory.length - 8]?.tvl : null;
        const monthAgo = tvlHistory.length > 30 ? tvlHistory[tvlHistory.length - 31]?.tvl : null;

        lines.push('\n*TVL Trend*');
        if (weekAgo) {
          const weekChange = ((current - weekAgo) / weekAgo) * 100;
          lines.push(`  7d Change:  \`${fmtPct(weekChange)}\``);
        }
        if (monthAgo) {
          const monthChange = ((current - monthAgo) / monthAgo) * 100;
          lines.push(`  30d Change: \`${fmtPct(monthChange)}\``);
        }
      }
    }

    // ---- Top Protocols on Chain ----
    try {
      const protocols = await fetchJSON('https://api.llama.fi/protocols');
      const chainProtos = protocols
        .filter(p => p.chains?.some(c => c.toLowerCase() === chain.toLowerCase()))
        .sort((a, b) => (b.tvl || 0) - (a.tvl || 0))
        .slice(0, 8);

      if (chainProtos.length > 0) {
        lines.push('\n*Top Protocols*');
        for (let i = 0; i < chainProtos.length; i++) {
          const p = chainProtos[i];
          lines.push(`  ${String(i + 1).padStart(2)}. ${(p.name || '?').padEnd(18)} \`$${formatLargeNum(p.tvl || 0)}\` (${p.category || '?'})`);
        }
      }
    } catch {
      // Non-critical, skip
    }

    // ---- Bridge Flows (DeFi Llama) ----
    try {
      const bridges = await fetchJSON('https://bridges.llama.fi/bridges?includeChains=true');
      const chainBridges = (bridges.bridges || []).filter(b =>
        b.chains?.some(c => c.toLowerCase() === chain.toLowerCase())
      );
      if (chainBridges.length > 0) {
        lines.push(`\n*Bridges*`);
        lines.push(`  Active Bridges: \`${chainBridges.length}\``);
        const topBridges = chainBridges
          .sort((a, b) => (b.currentDayVolume || 0) - (a.currentDayVolume || 0))
          .slice(0, 3);
        for (const br of topBridges) {
          if (br.displayName) lines.push(`  ${br.displayName}: \`$${formatLargeNum(br.currentDayVolume || 0)}/day\``);
        }
      }
    } catch {
      // Non-critical, skip
    }

    return lines.join('\n');
  } catch (err) {
    return `On-chain metrics failed: ${err.message}`;
  }
}

// ============ /correlation — Price Correlation Analysis ============

export async function getCorrelationAnalysis(tokenA, tokenB, days = 30) {
  if (!tokenA || !tokenB) return 'Usage: /correlation bitcoin ethereum 30\n\nCalculates price correlation, beta, and relative performance.';

  const idA = resolveCoinId(tokenA);
  const idB = resolveCoinId(tokenB);

  try {
    const [histA, histB] = await Promise.all([
      fetchJSON(`https://api.coingecko.com/api/v3/coins/${idA}/market_chart?vs_currency=usd&days=${days}`),
      fetchJSON(`https://api.coingecko.com/api/v3/coins/${idB}/market_chart?vs_currency=usd&days=${days}`),
    ]);

    const pricesA = histA.prices || [];
    const pricesB = histB.prices || [];

    if (pricesA.length < 3 || pricesB.length < 3) return 'Insufficient price data for correlation analysis.';

    // Align timestamps — sample daily
    const step = Math.max(1, Math.floor(pricesA.length / Math.min(days, pricesA.length)));
    const sampledA = pricesA.filter((_, i) => i % step === 0).map(p => p[1]);
    const sampledB = pricesB.filter((_, i) => i % step === 0).map(p => p[1]);

    // Ensure same length
    const len = Math.min(sampledA.length, sampledB.length);
    const a = sampledA.slice(0, len);
    const b = sampledB.slice(0, len);

    // Calculate daily returns
    const returnsA = [];
    const returnsB = [];
    for (let i = 1; i < len; i++) {
      returnsA.push((a[i] - a[i - 1]) / a[i - 1]);
      returnsB.push((b[i] - b[i - 1]) / b[i - 1]);
    }

    if (returnsA.length < 2) return 'Not enough data points for correlation.';

    // Pearson correlation
    const n = returnsA.length;
    const meanA = returnsA.reduce((s, v) => s + v, 0) / n;
    const meanB = returnsB.reduce((s, v) => s + v, 0) / n;

    let cov = 0, varA = 0, varB = 0;
    for (let i = 0; i < n; i++) {
      const dA = returnsA[i] - meanA;
      const dB = returnsB[i] - meanB;
      cov += dA * dB;
      varA += dA * dA;
      varB += dB * dB;
    }

    const correlation = (varA > 0 && varB > 0) ? cov / Math.sqrt(varA * varB) : 0;
    const beta = varB > 0 ? cov / varB : 0;

    // Performance
    const perfA = ((a[len - 1] - a[0]) / a[0]) * 100;
    const perfB = ((b[len - 1] - b[0]) / b[0]) * 100;

    // Volatility (std dev of returns)
    const stdA = Math.sqrt(varA / n) * Math.sqrt(365) * 100; // Annualized
    const stdB = Math.sqrt(varB / n) * Math.sqrt(365) * 100;

    // Interpret correlation
    const corrLabel = correlation > 0.7 ? 'Strong Positive' :
                      correlation > 0.3 ? 'Moderate Positive' :
                      correlation > -0.3 ? 'Weak / No Correlation' :
                      correlation > -0.7 ? 'Moderate Negative' : 'Strong Negative';

    const symA = tokenA.toUpperCase();
    const symB = tokenB.toUpperCase();

    const lines = [`*Correlation: ${symA} vs ${symB} (${days}d)*\n`];

    lines.push('*Correlation*');
    lines.push(`  Pearson r:  \`${correlation.toFixed(4)}\``);
    lines.push(`  Strength:   \`${corrLabel}\``);
    lines.push(`  Beta:       \`${beta.toFixed(4)}\``);
    lines.push(`  Data Points: \`${n}\``);

    lines.push('\n*Performance*');
    lines.push(`  ${symA}: \`${fmtPct(perfA)}\``);
    lines.push(`  ${symB}: \`${fmtPct(perfB)}\``);
    lines.push(`  Spread: \`${fmtPct(perfA - perfB)}\``);

    lines.push('\n*Volatility (Annualized)*');
    lines.push(`  ${symA}: \`${stdA.toFixed(1)}%\``);
    lines.push(`  ${symB}: \`${stdB.toFixed(1)}%\``);

    lines.push('\n*Prices*');
    lines.push(`  ${symA}: \`${fmtPrice(a[0])}\` -> \`${fmtPrice(a[len - 1])}\``);
    lines.push(`  ${symB}: \`${fmtPrice(b[0])}\` -> \`${fmtPrice(b[len - 1])}\``);

    // Insight
    lines.push('\n*Insight*');
    if (correlation > 0.7) {
      lines.push(`  ${symA} and ${symB} move closely together — diversification benefit is low.`);
    } else if (correlation < -0.3) {
      lines.push(`  ${symA} and ${symB} tend to move inversely — potential hedge pair.`);
    } else {
      lines.push(`  ${symA} and ${symB} have weak correlation — good for portfolio diversification.`);
    }

    return lines.join('\n');
  } catch (err) {
    return `Correlation analysis failed: ${err.message}`;
  }
}

// ============ /regime — Market Regime Analysis ============

export async function getMarketRegime() {
  try {
    // Parallel fetch all data sources
    const [globalData, fngData, btcHistory, ethHistory, stablesData] = await Promise.allSettled([
      fetchJSON('https://api.coingecko.com/api/v3/global'),
      fetchJSON('https://api.alternative.me/fng/?limit=7'),
      fetchJSON('https://api.coingecko.com/api/v3/coins/bitcoin/market_chart?vs_currency=usd&days=30'),
      fetchJSON('https://api.coingecko.com/api/v3/coins/ethereum/market_chart?vs_currency=usd&days=30'),
      fetchJSON('https://stablecoins.llama.fi/stablecoins?includePrices=true'),
    ]);

    const lines = ['*Market Regime Analysis*\n'];

    let regimeSignals = { riskOn: 0, riskOff: 0, rotation: 0, accumulation: 0 };

    // ---- Fear & Greed ----
    if (fngData.status === 'fulfilled') {
      const entries = fngData.value?.data || [];
      if (entries.length > 0) {
        const current = parseInt(entries[0].value);
        const weekAgo = entries.length >= 7 ? parseInt(entries[6].value) : null;
        const label = entries[0].value_classification;
        const bar = '[' + '#'.repeat(Math.round(current / 5)) + '-'.repeat(20 - Math.round(current / 5)) + ']';

        lines.push('*Fear & Greed*');
        lines.push(`  ${bar} \`${current}/100\``);
        lines.push(`  Sentiment: \`${label}\``);
        if (weekAgo != null) {
          const fngTrend = current - weekAgo;
          lines.push(`  7d Trend: \`${fngTrend >= 0 ? '+' : ''}${fngTrend} pts\``);
        }

        if (current >= 70) regimeSignals.riskOn += 2;
        else if (current <= 30) { regimeSignals.riskOff += 1; regimeSignals.accumulation += 2; }
        else regimeSignals.accumulation += 1;
      }
    }

    // ---- BTC Dominance ----
    if (globalData.status === 'fulfilled') {
      const g = globalData.value?.data;
      if (g) {
        const btcDom = g.market_cap_percentage?.btc;
        const ethDom = g.market_cap_percentage?.eth;
        const totalMcap = g.total_market_cap?.usd;
        const mcapChange = g.market_cap_change_percentage_24h_usd;

        lines.push('\n*Market Overview*');
        lines.push(`  Total MCap: \`$${formatLargeNum(totalMcap)}\` (\`${fmtPct(mcapChange)}\` 24h)`);
        lines.push(`  BTC Dominance: \`${btcDom?.toFixed(1)}%\``);
        lines.push(`  ETH Dominance: \`${ethDom?.toFixed(1)}%\``);

        if (btcDom > 55) { regimeSignals.riskOff += 2; lines.push('  Signal: BTC dominance high — risk-off / flight to BTC'); }
        else if (btcDom < 45) { regimeSignals.riskOn += 2; lines.push('  Signal: BTC dominance low — altseason territory'); }

        // ETH/BTC ratio trend (proxy)
        if (ethDom && btcDom) {
          const ethBtcRatio = ethDom / btcDom;
          lines.push(`  ETH/BTC Ratio: \`${ethBtcRatio.toFixed(3)}\``);
          if (ethBtcRatio > 0.5) regimeSignals.rotation += 1;
        }
      }
    }

    // ---- BTC Trend (30d) ----
    if (btcHistory.status === 'fulfilled') {
      const prices = btcHistory.value?.prices || [];
      if (prices.length > 2) {
        const startPrice = prices[0][1];
        const endPrice = prices[prices.length - 1][1];
        const btc30d = ((endPrice - startPrice) / startPrice) * 100;

        lines.push('\n*BTC Trend (30d)*');
        lines.push(`  Price: \`${fmtPrice(endPrice)}\``);
        lines.push(`  30d Change: \`${fmtPct(btc30d)}\``);

        if (btc30d > 10) regimeSignals.riskOn += 2;
        else if (btc30d < -10) regimeSignals.riskOff += 2;
        else regimeSignals.accumulation += 1;
      }
    }

    // ---- ETH/BTC Trend (30d) ----
    if (btcHistory.status === 'fulfilled' && ethHistory.status === 'fulfilled') {
      const btcPrices = btcHistory.value?.prices || [];
      const ethPrices = ethHistory.value?.prices || [];
      if (btcPrices.length > 2 && ethPrices.length > 2) {
        const ethBtcStart = ethPrices[0][1] / btcPrices[0][1];
        const ethBtcEnd = ethPrices[ethPrices.length - 1][1] / btcPrices[btcPrices.length - 1][1];
        const ethBtcChange = ((ethBtcEnd - ethBtcStart) / ethBtcStart) * 100;

        lines.push('\n*ETH/BTC Ratio Trend*');
        lines.push(`  Current: \`${ethBtcEnd.toFixed(5)}\``);
        lines.push(`  30d Change: \`${fmtPct(ethBtcChange)}\``);

        if (ethBtcChange > 5) { regimeSignals.rotation += 2; lines.push('  Signal: ETH outperforming BTC — rotation to alts'); }
        else if (ethBtcChange < -5) { regimeSignals.riskOff += 1; lines.push('  Signal: BTC outperforming ETH — risk-off rotation'); }
      }
    }

    // ---- Stablecoin Supply (Flight to Safety) ----
    if (stablesData.status === 'fulfilled') {
      const stables = stablesData.value?.peggedAssets || [];
      const totalStableMcap = stables.reduce((s, st) => s + (st.circulating?.peggedUSD || 0), 0);

      lines.push('\n*Stablecoin Supply*');
      lines.push(`  Total: \`$${formatLargeNum(totalStableMcap)}\``);

      // High stablecoin market cap relative to crypto = dry powder / risk-off
      if (totalStableMcap > 150e9) {
        regimeSignals.accumulation += 1;
        lines.push('  Signal: Large stablecoin supply — dry powder for re-entry');
      }
    }

    // ---- Regime Determination ----
    const regimes = [
      { name: 'Risk On', score: regimeSignals.riskOn, desc: 'Markets bullish, capital flowing into risk assets' },
      { name: 'Risk Off', score: regimeSignals.riskOff, desc: 'Capital retreating to safety, BTC dominance rising' },
      { name: 'Rotation', score: regimeSignals.rotation, desc: 'Capital rotating between sectors, watch narratives' },
      { name: 'Accumulation', score: regimeSignals.accumulation, desc: 'Sideways action, smart money loading up' },
    ];

    regimes.sort((a, b) => b.score - a.score);
    const primary = regimes[0];
    const secondary = regimes[1];

    lines.push('\n*REGIME VERDICT*');
    lines.push(`  Primary:   \`${primary.name}\` (score: ${primary.score})`);
    lines.push(`  ${primary.desc}`);
    if (secondary.score > 0) {
      lines.push(`  Secondary: \`${secondary.name}\` (score: ${secondary.score})`);
    }

    // Actionable insight
    lines.push('\n*Strategy Hint*');
    if (primary.name === 'Risk On') lines.push('  Favor higher-beta alts, reduce stablecoin allocation');
    else if (primary.name === 'Risk Off') lines.push('  Favor BTC and stablecoins, reduce alt exposure');
    else if (primary.name === 'Rotation') lines.push('  Follow the narrative — sector rotation in play');
    else lines.push('  DCA into conviction plays, build positions slowly');

    return lines.join('\n');
  } catch (err) {
    return `Market regime analysis failed: ${err.message}`;
  }
}
