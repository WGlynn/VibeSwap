// ============ Prediction Markets / Group Betting ============
//
// Group members create predictions and bet points on outcomes.
// Points economy tied to XP system. Leaderboard of best predictors.
// Think Polymarket but in your Telegram group chat.
//
// Commands:
//   /predict <question>            — Create a prediction market
//   /bet <id> <yes|no> [amount]    — Place a bet
//   /resolve <id> <yes|no>         — Resolve a prediction (creator or admin)
//   /markets                       — List active prediction markets
//   /mybets                        — Your betting history
//   /predictors                    — Predictor leaderboard
// ============

import { readFile, writeFile } from 'fs/promises';
import { join } from 'path';
import { config } from './config.js';

const DATA_DIR = config.dataDir;
const PREDICTIONS_FILE = join(DATA_DIR, 'predictions.json');

// Prediction market state
let markets = []; // { id, question, creatorId, creatorName, chatId, bets: [{userId, userName, side, amount}], status, result, createdAt, resolvedAt }
let nextId = 1;
let dirty = false;

// User prediction stats
const betterStats = new Map(); // userId -> { totalBets, wins, losses, pointsWon, pointsLost }

// Starting points per user
const DEFAULT_POINTS = 1000;
const userPoints = new Map(); // userId -> points

// ============ Init / Persist ============

export async function initPredictions() {
  try {
    const data = await readFile(PREDICTIONS_FILE, 'utf-8');
    const parsed = JSON.parse(data);
    markets = parsed.markets || [];
    nextId = parsed.nextId || 1;
    if (parsed.userPoints) {
      for (const [id, pts] of Object.entries(parsed.userPoints)) {
        userPoints.set(Number(id), pts);
      }
    }
    if (parsed.betterStats) {
      for (const [id, stats] of Object.entries(parsed.betterStats)) {
        betterStats.set(Number(id), stats);
      }
    }
    console.log(`[predictions] Loaded ${markets.length} markets, ${userPoints.size} bettors`);
  } catch {
    console.log('[predictions] No saved predictions — starting fresh');
  }
}

export async function flushPredictions() {
  if (!dirty) return;
  const obj = {
    markets,
    nextId,
    userPoints: Object.fromEntries(userPoints),
    betterStats: Object.fromEntries(betterStats),
  };
  await writeFile(PREDICTIONS_FILE, JSON.stringify(obj, null, 2));
  dirty = false;
}

function getPoints(userId) {
  if (!userPoints.has(userId)) userPoints.set(userId, DEFAULT_POINTS);
  return userPoints.get(userId);
}

function getStats(userId) {
  if (!betterStats.has(userId)) {
    betterStats.set(userId, { totalBets: 0, wins: 0, losses: 0, pointsWon: 0, pointsLost: 0, userName: '' });
  }
  return betterStats.get(userId);
}

// ============ /predict — Create Market ============

export function createPrediction(userId, userName, chatId, question) {
  if (!question || question.length < 10) {
    return 'Usage: /predict Will BTC hit $100k by end of March?\n\nQuestion must be at least 10 characters.';
  }
  if (question.length > 200) return 'Question too long (max 200 chars).';

  // Limit active markets per chat
  const activeInChat = markets.filter(m => m.chatId === chatId && m.status === 'open').length;
  if (activeInChat >= 10) return 'This chat has 10 active markets. Resolve some first.';

  const id = nextId++;
  markets.push({
    id,
    question: question.trim(),
    creatorId: userId,
    creatorName: userName,
    chatId,
    bets: [],
    status: 'open',
    result: null,
    createdAt: Date.now(),
    resolvedAt: null,
  });

  dirty = true;
  return `Market #${id} created!\n\n"${question}"\n\nBet: /bet ${id} yes 50\nOr:  /bet ${id} no 50`;
}

// ============ /bet — Place a Bet ============

export function placeBet(userId, userName, marketId, side, amount) {
  const id = parseInt(marketId);
  const market = markets.find(m => m.id === id);

  if (!market) return `Market #${marketId} not found.`;
  if (market.status !== 'open') return `Market #${id} is ${market.status}. Cannot bet.`;

  side = side?.toLowerCase();
  if (side !== 'yes' && side !== 'no') return 'Side must be "yes" or "no".';

  const betAmount = Math.max(1, Math.min(500, parseInt(amount) || 50));
  const points = getPoints(userId);

  if (points < betAmount) return `Not enough points. You have ${points} (need ${betAmount}).`;

  // Check if already bet
  const existing = market.bets.find(b => b.userId === userId);
  if (existing) return `You already bet ${existing.amount} on "${existing.side}" for this market.`;

  market.bets.push({ userId, userName, side, amount: betAmount, timestamp: Date.now() });
  userPoints.set(userId, points - betAmount);

  const stats = getStats(userId);
  stats.totalBets++;
  stats.userName = userName;

  dirty = true;

  const yesCount = market.bets.filter(b => b.side === 'yes').length;
  const noCount = market.bets.filter(b => b.side === 'no').length;
  const yesPct = market.bets.length > 0 ? Math.round((yesCount / market.bets.length) * 100) : 50;

  return `Bet placed: ${betAmount} pts on "${side}" for Market #${id}\n\n"${market.question}"\nYes: ${yesPct}% (${yesCount}) | No: ${100 - yesPct}% (${noCount})\nRemaining: ${getPoints(userId)} pts`;
}

// ============ /resolve — Resolve Market ============

export function resolveMarket(userId, marketId, result) {
  const id = parseInt(marketId);
  const market = markets.find(m => m.id === id);

  if (!market) return `Market #${marketId} not found.`;
  if (market.status !== 'open') return `Market #${id} already ${market.status}.`;

  // Only creator or owner can resolve
  if (market.creatorId !== userId && userId !== config.ownerUserId) {
    return 'Only the market creator or admin can resolve.';
  }

  result = result?.toLowerCase();
  if (result !== 'yes' && result !== 'no') return 'Result must be "yes" or "no".';

  market.status = 'resolved';
  market.result = result;
  market.resolvedAt = Date.now();

  // Calculate payouts
  const winners = market.bets.filter(b => b.side === result);
  const losers = market.bets.filter(b => b.side !== result);
  const totalPool = market.bets.reduce((s, b) => s + b.amount, 0);
  const winnerPool = winners.reduce((s, b) => s + b.amount, 0);

  const lines = [`Market #${id} RESOLVED: ${result.toUpperCase()}\n`];
  lines.push(`"${market.question}"\n`);

  if (totalPool === 0) {
    // Zero-bet market — nothing to distribute
    lines.push('  No bets placed. Market closed.');
  } else if (winners.length === 0) {
    // No winners — return bets to losers
    for (const b of losers) {
      const pts = getPoints(b.userId);
      userPoints.set(b.userId, pts + b.amount);
    }
    lines.push('  No winners. All bets returned.');
  } else if (winnerPool === 0) {
    // Winners exist but all bet 0 (edge case) — return loser bets
    for (const b of losers) {
      const pts = getPoints(b.userId);
      userPoints.set(b.userId, pts + b.amount);
    }
    lines.push('  Winners bet nothing. Loser bets returned.');
  } else {
    // Distribute pool proportionally to winners
    // Use floor to avoid over-distributing, give remainder to largest winner
    let distributed = 0;
    const shares = [];
    for (const w of winners) {
      const share = Math.floor((w.amount / winnerPool) * totalPool);
      shares.push(share);
      distributed += share;
    }
    // Rounding remainder goes to the largest bettor
    const remainder = totalPool - distributed;
    if (remainder > 0) {
      let maxIdx = 0;
      for (let i = 1; i < winners.length; i++) {
        if (winners[i].amount > winners[maxIdx].amount) maxIdx = i;
      }
      shares[maxIdx] += remainder;
    }

    for (let i = 0; i < winners.length; i++) {
      const w = winners[i];
      const share = shares[i];
      const pts = getPoints(w.userId);
      userPoints.set(w.userId, pts + share);
      const profit = share - w.amount;
      lines.push(`  ${w.userName}: +${profit} pts (bet ${w.amount}, won ${share})`);

      const stats = getStats(w.userId);
      stats.wins++;
      stats.pointsWon += profit;
    }
    for (const l of losers) {
      const stats = getStats(l.userId);
      stats.losses++;
      stats.pointsLost += l.amount;
    }
  }

  lines.push(`\n  Total pool: ${totalPool} pts | ${winners.length} winners, ${losers.length} losers`);
  dirty = true;
  return lines.join('\n');
}

// ============ /markets — List Active Markets ============

export function listMarkets(chatId) {
  const active = markets.filter(m => m.chatId === chatId && m.status === 'open');
  if (active.length === 0) {
    return 'No active prediction markets.\n\nCreate one: /predict Will ETH flip BTC this cycle?';
  }

  const lines = ['Active Prediction Markets\n'];
  for (const m of active) {
    const yesCount = m.bets.filter(b => b.side === 'yes').length;
    const noCount = m.bets.filter(b => b.side === 'no').length;
    const total = m.bets.reduce((s, b) => s + b.amount, 0);
    const age = formatAge(m.createdAt);

    lines.push(`  #${m.id}: "${m.question.slice(0, 60)}"`);
    lines.push(`    Yes: ${yesCount} | No: ${noCount} | Pool: ${total} pts | ${age}`);
  }

  lines.push('\n  /bet <id> yes 50 to place a bet');
  return lines.join('\n');
}

// ============ /mybets — Your Betting History ============

export function getMyBets(userId) {
  const myBets = [];
  for (const m of markets) {
    const bet = m.bets.find(b => b.userId === userId);
    if (bet) {
      myBets.push({ market: m, bet });
    }
  }

  if (myBets.length === 0) {
    return `No bets yet. You have ${getPoints(userId)} prediction points.\n\nSee markets: /markets\nCreate one: /predict <question>`;
  }

  const lines = [`Your Bets — ${getPoints(userId)} pts available\n`];

  // Active bets
  const active = myBets.filter(b => b.market.status === 'open');
  if (active.length > 0) {
    lines.push('  ACTIVE:');
    for (const { market, bet } of active) {
      lines.push(`    #${market.id}: ${bet.amount} on "${bet.side}" — "${market.question.slice(0, 50)}"`);
    }
  }

  // Resolved bets
  const resolved = myBets.filter(b => b.market.status === 'resolved').slice(-5);
  if (resolved.length > 0) {
    lines.push('\n  HISTORY:');
    for (const { market, bet } of resolved) {
      const won = bet.side === market.result;
      lines.push(`    #${market.id}: ${won ? 'WON' : 'LOST'} (${bet.amount} on "${bet.side}") — "${market.question.slice(0, 40)}"`);
    }
  }

  return lines.join('\n');
}

// ============ /predictors — Predictor Leaderboard ============

export function getPredictorLeaderboard() {
  const sorted = [...betterStats.entries()]
    .filter(([, s]) => s.totalBets >= 3)
    .sort((a, b) => {
      const aWinRate = a[1].totalBets > 0 ? a[1].wins / a[1].totalBets : 0;
      const bWinRate = b[1].totalBets > 0 ? b[1].wins / b[1].totalBets : 0;
      return bWinRate - aWinRate;
    })
    .slice(0, 10);

  if (sorted.length === 0) return 'No predictor data yet. Need at least 3 bets to qualify.';

  const lines = ['Predictor Leaderboard (min 3 bets)\n'];
  for (let i = 0; i < sorted.length; i++) {
    const [, stats] = sorted[i];
    const winRate = stats.totalBets > 0 ? ((stats.wins / stats.totalBets) * 100).toFixed(0) : 0;
    const pnl = stats.pointsWon - stats.pointsLost;
    const pnlStr = pnl >= 0 ? `+${pnl}` : String(pnl);
    lines.push(`  ${i + 1}. ${stats.userName} — ${winRate}% (${stats.wins}W/${stats.losses}L) P&L: ${pnlStr}`);
  }

  return lines.join('\n');
}

export function getPredictionStats() {
  return {
    totalMarkets: markets.length,
    activeMarkets: markets.filter(m => m.status === 'open').length,
    resolvedMarkets: markets.filter(m => m.status === 'resolved').length,
    totalBettors: userPoints.size,
    totalBets: markets.reduce((s, m) => s + m.bets.length, 0),
  };
}

// ============ Helpers ============

function formatAge(timestamp) {
  const ms = Date.now() - timestamp;
  if (ms < 60000) return 'just now';
  if (ms < 3600000) return `${Math.round(ms / 60000)}m ago`;
  if (ms < 86400000) return `${Math.round(ms / 3600000)}h ago`;
  return `${Math.round(ms / 86400000)}d ago`;
}
