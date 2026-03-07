// ============ News & Social Feed Tools ============
//
// Commands:
//   /news [topic]       — Crypto news aggregator (Reddit + HN + RSS)
//   /reddit [sub]       — Reddit hot posts
//   /hackernews         — HN crypto/tech stories
//   /rss <url>          — Read any RSS feed
//   /devactivity <project> — GitHub dev activity
// ============

const HTTP_TIMEOUT = 10000;

// ============ Reddit (free, no key — use .json endpoints) ============

const CRYPTO_SUBREDDITS = ['cryptocurrency', 'bitcoin', 'ethereum', 'defi', 'CryptoMoonShots'];

export async function getRedditPosts(subreddit = 'cryptocurrency', sort = 'hot') {
  const sub = subreddit.replace(/^r\//, '');
  try {
    const resp = await fetch(
      `https://www.reddit.com/r/${encodeURIComponent(sub)}/${sort}.json?limit=8`,
      {
        signal: AbortSignal.timeout(HTTP_TIMEOUT),
        headers: { 'User-Agent': 'JarvisBot/1.0' },
      }
    );
    if (!resp.ok) {
      if (resp.status === 404) return `Subreddit r/${sub} not found.`;
      throw new Error(`Reddit ${resp.status}`);
    }
    const data = await resp.json();
    const posts = data?.data?.children || [];

    if (posts.length === 0) return `No posts found in r/${sub}.`;

    const lines = [`r/${sub} — ${sort}\n`];
    for (let i = 0; i < Math.min(8, posts.length); i++) {
      const p = posts[i].data;
      if (p.stickied) continue;
      const score = p.score >= 1000 ? `${(p.score / 1000).toFixed(1)}k` : String(p.score);
      const comments = p.num_comments >= 1000 ? `${(p.num_comments / 1000).toFixed(1)}k` : String(p.num_comments);
      const title = p.title.length > 80 ? p.title.slice(0, 80) + '...' : p.title;
      const age = formatAge(p.created_utc * 1000);
      lines.push(`  ${score} pts | ${title}`);
      lines.push(`    ${comments} comments | ${age} | u/${p.author}`);
    }
    return lines.join('\n');
  } catch (err) {
    return `Reddit failed: ${err.message}`;
  }
}

// ============ Hacker News (free, no key) ============

export async function getHackerNews(filter = 'crypto') {
  try {
    // Get top stories
    const topResp = await fetch('https://hacker-news.firebaseio.com/v0/topstories.json', {
      signal: AbortSignal.timeout(HTTP_TIMEOUT),
    });
    if (!topResp.ok) return 'Hacker News unavailable.';
    const topIds = await topResp.json();

    // Fetch first 30 stories (allSettled — don't fail entire batch on one story)
    const storyPromises = topIds.slice(0, 30).map(async (id) => {
      const resp = await fetch(`https://hacker-news.firebaseio.com/v0/item/${id}.json`, {
        signal: AbortSignal.timeout(5000),
      });
      if (!resp.ok) return null;
      return resp.json();
    });

    const stories = (await Promise.all(storyPromises)).filter(Boolean);

    // Filter for crypto/tech keywords
    const keywords = filter.toLowerCase() === 'all' ? null : [
      'crypto', 'bitcoin', 'ethereum', 'blockchain', 'defi', 'token',
      'web3', 'solidity', 'smart contract', 'nft', 'dao', 'wallet',
      'decentralized', 'consensus', 'layer 2', 'rollup', 'zk',
      ...filter.toLowerCase().split(/\s+/),
    ];

    let filtered = stories.filter(s => s && s.title && !s.dead && !s.deleted);
    if (keywords) {
      filtered = filtered.filter(s =>
        keywords.some(k => s.title.toLowerCase().includes(k))
      );
    }

    if (filtered.length === 0) {
      // Fallback: show top stories regardless
      filtered = stories.filter(s => s && s.title && !s.dead).slice(0, 8);
      if (filtered.length === 0) return 'No Hacker News stories available.';
    }

    const topStories = filtered.slice(0, 8);
    const lines = [`Hacker News${keywords ? ` — "${filter}"` : ''}\n`];
    for (const s of topStories) {
      const score = s.score || 0;
      const comments = s.descendants || 0;
      const title = s.title.length > 80 ? s.title.slice(0, 80) + '...' : s.title;
      lines.push(`  ${score} pts | ${title}`);
      lines.push(`    ${comments} comments | https://news.ycombinator.com/item?id=${s.id}`);
    }
    return lines.join('\n');
  } catch (err) {
    return `Hacker News failed: ${err.message}`;
  }
}

// ============ RSS Feed Reader (rss2json — free, no key) ============

export async function readRSSFeed(url) {
  if (!url) return 'Usage: /rss https://blog.ethereum.org/feed.xml\n\nPopular feeds:\n  blog.ethereum.org/feed.xml\n  cointelegraph.com/rss\n  thedefiant.io/feed';

  // Ensure URL has protocol
  if (!url.startsWith('http')) url = 'https://' + url;

  try {
    const resp = await fetch(
      `https://api.rss2json.com/v1/api.json?rss_url=${encodeURIComponent(url)}`,
      { signal: AbortSignal.timeout(HTTP_TIMEOUT) }
    );
    if (!resp.ok) throw new Error(`RSS2JSON ${resp.status}`);
    const data = await resp.json();

    if (data.status !== 'ok') return `RSS feed error: ${data.message || 'Invalid feed'}`;

    const items = data.items?.slice(0, 6) || [];
    if (items.length === 0) return 'No items in feed.';

    const lines = [`${data.feed?.title || url}\n`];
    for (const item of items) {
      const title = item.title?.length > 80 ? item.title.slice(0, 80) + '...' : item.title;
      const date = item.pubDate ? new Date(item.pubDate).toLocaleDateString() : '';
      lines.push(`  ${title}`);
      if (date) lines.push(`    ${date} | ${item.link?.slice(0, 60) || ''}`);
    }
    return lines.join('\n');
  } catch (err) {
    return `RSS feed failed: ${err.message}`;
  }
}

// ============ Combined Crypto News ============

export async function getCryptoNews(topic) {
  try {
    // Fetch from multiple sources in parallel
    const [reddit, hn] = await Promise.allSettled([
      getRedditPosts('cryptocurrency', 'hot'),
      getHackerNews(topic || 'crypto'),
    ]);

    const lines = ['Crypto News Aggregator\n'];

    if (reddit.status === 'fulfilled' && !reddit.value.includes('failed')) {
      // Extract just first 3 posts from Reddit
      const redditLines = reddit.value.split('\n').slice(1, 7);
      lines.push('  --- Reddit r/cryptocurrency ---');
      lines.push(...redditLines.slice(0, 6));
    }

    if (hn.status === 'fulfilled' && !hn.value.includes('failed')) {
      const hnLines = hn.value.split('\n').slice(1, 7);
      lines.push('\n  --- Hacker News ---');
      lines.push(...hnLines.slice(0, 6));
    }

    return lines.length > 2 ? lines.join('\n') : 'News sources temporarily unavailable.';
  } catch (err) {
    return `News aggregation failed: ${err.message}`;
  }
}

// ============ GitHub Dev Activity (free, no key for 60 req/hr) ============

const PROJECT_REPOS = {
  ethereum: 'ethereum/go-ethereum',
  bitcoin: 'bitcoin/bitcoin',
  solana: 'solana-labs/solana',
  polygon: 'maticnetwork/bor',
  arbitrum: 'OffchainLabs/nitro',
  optimism: 'ethereum-optimism/optimism',
  uniswap: 'Uniswap/v3-core',
  aave: 'aave/aave-v3-core',
  compound: 'compound-finance/compound-protocol',
  chainlink: 'smartcontractkit/chainlink',
  cosmos: 'cosmos/cosmos-sdk',
  polkadot: 'nickvdyck/polkadot-sdk',
  near: 'near/nearcore',
  avalanche: 'ava-labs/avalanchego',
  sui: 'MystenLabs/sui',
  aptos: 'aptos-labs/aptos-core',
  vibeswap: 'WGlynn/VibeSwap',
};

export async function getDevActivity(project) {
  if (!project) return `Usage: /devactivity ethereum\n\nProjects: ${Object.keys(PROJECT_REPOS).join(', ')}`;

  const repo = PROJECT_REPOS[project.toLowerCase()] || project;
  const repoPath = repo.includes('/') ? repo : `${project}/${project}`;

  try {
    const [commitsResp, repoResp] = await Promise.all([
      fetch(`https://api.github.com/repos/${repoPath}/commits?per_page=5`, {
        signal: AbortSignal.timeout(HTTP_TIMEOUT),
        headers: { 'Accept': 'application/vnd.github.v3+json', 'User-Agent': 'JarvisBot' },
      }),
      fetch(`https://api.github.com/repos/${repoPath}`, {
        signal: AbortSignal.timeout(HTTP_TIMEOUT),
        headers: { 'Accept': 'application/vnd.github.v3+json', 'User-Agent': 'JarvisBot' },
      }),
    ]);

    if (!commitsResp.ok) {
      if (commitsResp.status === 404) return `Repository "${repoPath}" not found.`;
      throw new Error(`GitHub ${commitsResp.status}`);
    }

    const commits = await commitsResp.json();
    const repoInfo = repoResp.ok ? await repoResp.json() : null;

    const lines = [`Dev Activity — ${repoPath}\n`];
    if (repoInfo) {
      lines.push(`  Stars: ${repoInfo.stargazers_count?.toLocaleString()} | Forks: ${repoInfo.forks_count?.toLocaleString()}`);
      lines.push(`  Open Issues: ${repoInfo.open_issues_count?.toLocaleString()}`);
      if (repoInfo.pushed_at) lines.push(`  Last Push: ${formatAge(new Date(repoInfo.pushed_at).getTime())}`);
      lines.push('');
    }

    lines.push('  Recent Commits:');
    for (const c of commits.slice(0, 5)) {
      const msg = c.commit?.message?.split('\n')[0]?.slice(0, 70) || '?';
      const author = c.commit?.author?.name?.slice(0, 15) || '?';
      const date = c.commit?.author?.date ? formatAge(new Date(c.commit.author.date).getTime()) : '';
      lines.push(`    ${author}: ${msg}`);
      lines.push(`      ${date} | ${c.sha?.slice(0, 7)}`);
    }

    return lines.join('\n');
  } catch (err) {
    return `Dev activity failed: ${err.message}`;
  }
}

// ============ Helpers ============

function formatAge(timestamp) {
  const ms = Date.now() - timestamp;
  if (ms < 60000) return 'just now';
  if (ms < 3600000) return `${Math.round(ms / 60000)}m ago`;
  if (ms < 86400000) return `${Math.round(ms / 3600000)}h ago`;
  return `${Math.round(ms / 86400000)}d ago`;
}
