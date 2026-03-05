// ============ Fun & Community Engagement Tools ============
//
// Commands:
//   /poll <question> | <opt1> | <opt2> ...  — Native Telegram poll
//   /flip                                    — Coin flip
//   /roll [NdN]                              — Dice roll (D&D notation)
//   /8ball <question>                        — Magic 8-ball
//   /trivia                                  — Random crypto trivia
//   /gm                                      — GM streak tracker
//   /leaderboard                             — Top contributors
// ============

// ============ Polls (Telegram native) ============

export function parsePollArgs(text) {
  // Format: /poll Question here | Option 1 | Option 2 | Option 3
  const parts = text.split('|').map(s => s.trim()).filter(Boolean);
  if (parts.length < 3) {
    return { error: 'Usage: /poll Question | Option 1 | Option 2 [| Option 3 ...]' };
  }
  return { question: parts[0], options: parts.slice(1, 11) }; // Telegram max 10 options
}

// ============ Coin Flip ============

export function coinFlip() {
  const result = Math.random() < 0.5 ? 'Heads' : 'Tails';
  const emoji = result === 'Heads' ? '🪙' : '🪙';
  return `${emoji} ${result}!`;
}

// ============ Dice Roll (supports D&D notation) ============

export function diceRoll(notation = '1d6') {
  const match = notation.toLowerCase().match(/^(\d+)?d(\d+)([+-]\d+)?$/);
  if (!match) {
    // Simple number = roll 1 die with that many sides
    const sides = parseInt(notation);
    if (sides > 0 && sides <= 1000) {
      const result = Math.floor(Math.random() * sides) + 1;
      return `🎲 d${sides}: ${result}`;
    }
    return 'Usage: /roll [NdN+M] — e.g., 2d6, 1d20+5, d100';
  }

  const count = Math.min(parseInt(match[1] || '1'), 20); // Max 20 dice
  const sides = Math.min(parseInt(match[2]), 1000);
  const modifier = parseInt(match[3] || '0');

  if (sides < 1) return 'Dice must have at least 1 side.';

  const rolls = [];
  let total = 0;
  for (let i = 0; i < count; i++) {
    const r = Math.floor(Math.random() * sides) + 1;
    rolls.push(r);
    total += r;
  }
  total += modifier;

  const modStr = modifier > 0 ? `+${modifier}` : modifier < 0 ? `${modifier}` : '';
  const rollStr = count > 1 ? ` [${rolls.join(', ')}]` : '';

  return `🎲 ${count}d${sides}${modStr}:${rollStr} = ${total}`;
}

// ============ Magic 8-Ball ============

const EIGHT_BALL_RESPONSES = [
  // Positive
  'It is certain.', 'Without a doubt.', 'Yes, definitely.',
  'You may rely on it.', 'As I see it, yes.', 'Most likely.',
  'Outlook good.', 'Yes.', 'Signs point to yes.',
  // Neutral
  'Reply hazy, try again.', 'Ask again later.',
  'Better not tell you now.', 'Cannot predict now.',
  'Concentrate and ask again.',
  // Negative
  'Don\'t count on it.', 'My reply is no.',
  'My sources say no.', 'Outlook not so good.', 'Very doubtful.',
  // Jarvis specials
  'Sir, the probability matrix suggests yes.',
  'I\'ve run the numbers. It\'s a no.',
  'I asked the Mind Network. Consensus: maybe.',
  'CRPC evaluation complete. The answer is yes.',
  'Let me consult the knowledge chain... yes.',
];

export function magicEightBall(question) {
  const response = EIGHT_BALL_RESPONSES[Math.floor(Math.random() * EIGHT_BALL_RESPONSES.length)];
  return `🎱 ${response}`;
}

// ============ Crypto Trivia ============

const CRYPTO_TRIVIA = [
  { q: 'What is the maximum supply of Bitcoin?', a: '21 million BTC', category: 'Bitcoin' },
  { q: 'Who published the Bitcoin whitepaper?', a: 'Satoshi Nakamoto, in 2008', category: 'Bitcoin' },
  { q: 'What is the "genesis block" in Bitcoin?', a: 'The first block ever mined (Block 0), created on January 3, 2009', category: 'Bitcoin' },
  { q: 'What does "HODL" stand for?', a: 'It\'s a misspelling of "HOLD" from a 2013 Bitcointalk forum post', category: 'Culture' },
  { q: 'What is a "rug pull" in DeFi?', a: 'When project developers abandon the project and run away with investor funds', category: 'DeFi' },
  { q: 'What does MEV stand for?', a: 'Maximal Extractable Value — profit extracted by reordering/inserting/censoring transactions', category: 'DeFi' },
  { q: 'What is the "merge" in Ethereum?', a: 'The transition from Proof of Work to Proof of Stake on September 15, 2022', category: 'Ethereum' },
  { q: 'What is impermanent loss?', a: 'The loss LP providers face when the price ratio of their deposited tokens changes vs. holding', category: 'DeFi' },
  { q: 'What does AMM stand for?', a: 'Automated Market Maker — uses math formulas instead of order books', category: 'DeFi' },
  { q: 'What is a flash loan?', a: 'An uncollateralized loan that must be borrowed and repaid in a single transaction', category: 'DeFi' },
  { q: 'What year was Ethereum launched?', a: '2015, by Vitalik Buterin and team', category: 'Ethereum' },
  { q: 'What is EIP-1559?', a: 'The fee market reform that introduced base fee burning on Ethereum (August 2021)', category: 'Ethereum' },
  { q: 'What does TVL stand for in DeFi?', a: 'Total Value Locked — the total value of assets deposited in DeFi protocols', category: 'DeFi' },
  { q: 'What is the Bitcoin halving?', a: 'An event every ~4 years where Bitcoin mining rewards are cut in half', category: 'Bitcoin' },
  { q: 'What is a commit-reveal scheme?', a: 'A two-phase protocol where you commit to a value (hash) first, then reveal it — prevents front-running!', category: 'Crypto' },
  { q: 'What is a Sybil attack?', a: 'Creating many fake identities to gain disproportionate influence in a network', category: 'Security' },
  { q: 'What does DAO stand for?', a: 'Decentralized Autonomous Organization — governed by smart contracts and token holders', category: 'Governance' },
  { q: 'What is the Byzantine Generals Problem?', a: 'The challenge of reaching consensus among distributed systems that may contain faulty/malicious nodes', category: 'Consensus' },
  { q: 'What is a liquidity pool?', a: 'A smart contract that holds pairs of tokens for decentralized trading', category: 'DeFi' },
  { q: 'What is the difference between a hot and cold wallet?', a: 'Hot wallets are connected to the internet; cold wallets are offline (more secure)', category: 'Security' },
  { q: 'What is Shapley value in game theory?', a: 'A method to fairly distribute rewards among contributors based on their marginal contribution', category: 'Game Theory' },
  { q: 'What is LayerZero?', a: 'An omnichain interoperability protocol enabling cross-chain messaging', category: 'Infrastructure' },
  { q: 'What is proof of work?', a: 'A consensus mechanism where miners solve computational puzzles to validate transactions', category: 'Consensus' },
  { q: 'What makes VibeSwap unique?', a: 'Commit-reveal batch auctions with uniform clearing prices that eliminate MEV!', category: 'VibeSwap' },
];

export function getTrivia() {
  const item = CRYPTO_TRIVIA[Math.floor(Math.random() * CRYPTO_TRIVIA.length)];
  return { question: `[${item.category}] ${item.q}`, answer: item.a };
}

// ============ GM Streak Tracker (in-memory) ============

// userId -> { streak, lastGM, totalGMs, longestStreak }
const gmStreaks = new Map();

export function recordGM(userId, username) {
  const now = Date.now();
  const today = new Date(now).toDateString();
  const entry = gmStreaks.get(userId) || { streak: 0, lastGM: null, totalGMs: 0, longestStreak: 0, username };

  const lastDate = entry.lastGM ? new Date(entry.lastGM).toDateString() : null;

  if (lastDate === today) {
    return `You already said GM today! Current streak: ${entry.streak} days.`;
  }

  // Check if yesterday (streak continues) or gap (streak resets)
  const yesterday = new Date(now - 86400000).toDateString();
  if (lastDate === yesterday) {
    entry.streak++;
  } else {
    entry.streak = 1;
  }

  entry.lastGM = now;
  entry.totalGMs++;
  entry.username = username;
  if (entry.streak > entry.longestStreak) entry.longestStreak = entry.streak;

  gmStreaks.set(userId, entry);

  const fire = entry.streak >= 7 ? ' 🔥' : entry.streak >= 3 ? ' ✨' : '';
  return `GM ${username}! Streak: ${entry.streak} day${entry.streak > 1 ? 's' : ''}${fire} | Total GMs: ${entry.totalGMs}`;
}

export function getGMLeaderboard() {
  const entries = [...gmStreaks.entries()]
    .filter(([, e]) => e.streak > 0)
    .sort((a, b) => b[1].streak - a[1].streak)
    .slice(0, 10);

  if (entries.length === 0) return 'No GM streaks yet. Say /gm to start!';

  const lines = ['GM Streak Leaderboard\n'];
  for (let i = 0; i < entries.length; i++) {
    const [, e] = entries[i];
    const fire = e.streak >= 7 ? ' 🔥' : e.streak >= 3 ? ' ✨' : '';
    lines.push(`  ${i + 1}. ${e.username}: ${e.streak} day${e.streak > 1 ? 's' : ''}${fire} (${e.totalGMs} total)`);
  }
  return lines.join('\n');
}
