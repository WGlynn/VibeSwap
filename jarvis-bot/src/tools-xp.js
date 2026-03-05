// ============ XP / Level / Achievement Gamification System ============
//
// Every interaction earns XP. Levels unlock features. Achievements for milestones.
// Tied to the Joule mining system — XP is fuel, Joules are the economic primitive.
//
// Commands:
//   /xp              — Check your XP and level
//   /level           — Same as /xp
//   /achievements    — View available & earned achievements
//   /top             — XP leaderboard
// ============

import { readFile, writeFile } from 'fs/promises';
import { join } from 'path';
import { config } from './config.js';

const DATA_DIR = config.dataDir;
const XP_FILE = join(DATA_DIR, 'xp.json');

// userId -> { xp, level, achievements: Set<string>, stats: {}, lastActive, streak, userName }
const players = new Map();
let dirty = false;

// ============ XP Curve ============

// Level thresholds — exponential curve
function xpForLevel(level) {
  return Math.floor(100 * Math.pow(1.5, level - 1));
}

function calculateLevel(totalXp) {
  let level = 1;
  let required = 0;
  while (true) {
    const next = xpForLevel(level);
    if (required + next > totalXp) break;
    required += next;
    level++;
  }
  return { level, currentXp: totalXp - required, nextLevelXp: xpForLevel(level) };
}

// ============ XP Awards ============

const XP_ACTIONS = {
  message: 2,           // Any message in a group
  command: 3,           // Using a bot command
  quality_message: 5,   // Substantive message (>50 chars)
  help_others: 8,       // Answering someone's question
  rugcheck: 5,          // Running security checks — good behavior
  alpha_report: 5,      // Using /alpha
  portfolio_update: 3,  // Managing portfolio
  prediction: 10,       // Making a prediction
  correct_prediction: 25, // Prediction was right
  gm: 1,               // GM (daily cap)
  streak_bonus: 5,      // Streak continuation
  first_daily: 10,      // First interaction of the day
};

// ============ Init / Persist ============

export async function initXP() {
  try {
    const data = await readFile(XP_FILE, 'utf-8');
    const parsed = JSON.parse(data);
    for (const [userId, profile] of Object.entries(parsed)) {
      profile.achievements = new Set(profile.achievements || []);
      players.set(Number(userId), profile);
    }
    console.log(`[xp] Loaded ${players.size} player profiles`);
  } catch {
    console.log('[xp] No saved XP data — starting fresh');
  }
}

export async function flushXP() {
  if (!dirty) return;
  const obj = {};
  for (const [userId, profile] of players) {
    obj[userId] = {
      ...profile,
      achievements: [...profile.achievements],
    };
  }
  await writeFile(XP_FILE, JSON.stringify(obj, null, 2));
  dirty = false;
}

function getOrCreate(userId, userName) {
  if (!players.has(userId)) {
    players.set(userId, {
      xp: 0,
      level: 1,
      achievements: new Set(),
      stats: {
        messages: 0,
        commands: 0,
        rugchecks: 0,
        predictions: 0,
        correctPredictions: 0,
        daysActive: 0,
        longestStreak: 0,
      },
      lastActive: 0,
      lastDailyBonus: '',
      streak: 0,
      userName: userName || 'Unknown',
    });
  }
  const p = players.get(userId);
  if (userName) p.userName = userName;
  return p;
}

// ============ Core XP Functions ============

export function awardXP(userId, userName, action, multiplier = 1) {
  const amount = (XP_ACTIONS[action] || 1) * multiplier;
  const profile = getOrCreate(userId, userName);

  profile.xp += amount;
  profile.lastActive = Date.now();

  // Daily first interaction bonus
  const today = new Date().toDateString();
  if (profile.lastDailyBonus !== today) {
    profile.xp += XP_ACTIONS.first_daily;
    profile.lastDailyBonus = today;
    profile.stats.daysActive++;

    // Streak check
    const yesterday = new Date(Date.now() - 86400000).toDateString();
    if (profile.lastDailyBonus === yesterday || profile.streak === 0) {
      profile.streak++;
      if (profile.streak > 1) {
        profile.xp += XP_ACTIONS.streak_bonus;
      }
      if (profile.streak > profile.stats.longestStreak) {
        profile.stats.longestStreak = profile.streak;
      }
    } else {
      profile.streak = 1;
    }
  }

  // Update stats
  if (action === 'message') profile.stats.messages++;
  else if (action === 'command') profile.stats.commands++;
  else if (action === 'rugcheck') profile.stats.rugchecks++;
  else if (action === 'prediction') profile.stats.predictions++;
  else if (action === 'correct_prediction') profile.stats.correctPredictions++;

  // Recalculate level
  const levelInfo = calculateLevel(profile.xp);
  const leveledUp = levelInfo.level > profile.level;
  profile.level = levelInfo.level;

  // Check achievements
  const newAchievements = checkAchievements(profile);

  dirty = true;

  return { amount, leveledUp, newLevel: profile.level, newAchievements };
}

// ============ Achievements ============

const ACHIEVEMENTS = [
  { id: 'first_message', name: 'Hello World', desc: 'Send your first message', check: (p) => p.stats.messages >= 1 },
  { id: 'chatterbox', name: 'Chatterbox', desc: 'Send 100 messages', check: (p) => p.stats.messages >= 100 },
  { id: 'veteran', name: 'Veteran', desc: 'Send 1,000 messages', check: (p) => p.stats.messages >= 1000 },
  { id: 'power_user', name: 'Power User', desc: 'Use 50 commands', check: (p) => p.stats.commands >= 50 },
  { id: 'security_minded', name: 'Security Minded', desc: 'Run 10 rug checks', check: (p) => p.stats.rugchecks >= 10 },
  { id: 'streak_3', name: 'On Fire', desc: '3-day streak', check: (p) => p.streak >= 3 },
  { id: 'streak_7', name: 'Dedicated', desc: '7-day streak', check: (p) => p.streak >= 7 },
  { id: 'streak_30', name: 'Unstoppable', desc: '30-day streak', check: (p) => p.streak >= 30 },
  { id: 'streak_100', name: 'Legend', desc: '100-day streak', check: (p) => p.stats.longestStreak >= 100 },
  { id: 'level_5', name: 'Rising Star', desc: 'Reach level 5', check: (p) => p.level >= 5 },
  { id: 'level_10', name: 'Established', desc: 'Reach level 10', check: (p) => p.level >= 10 },
  { id: 'level_25', name: 'Elite', desc: 'Reach level 25', check: (p) => p.level >= 25 },
  { id: 'level_50', name: 'Legendary', desc: 'Reach level 50', check: (p) => p.level >= 50 },
  { id: 'oracle', name: 'Oracle', desc: 'Make 10 predictions', check: (p) => p.stats.predictions >= 10 },
  { id: 'prophet', name: 'Prophet', desc: 'Get 5 predictions right', check: (p) => p.stats.correctPredictions >= 5 },
  { id: 'active_week', name: 'Full Week', desc: 'Active for 7 different days', check: (p) => p.stats.daysActive >= 7 },
  { id: 'active_month', name: 'Monthly Regular', desc: 'Active for 30 different days', check: (p) => p.stats.daysActive >= 30 },
  { id: 'xp_1000', name: 'Grinder', desc: 'Earn 1,000 XP', check: (p) => p.xp >= 1000 },
  { id: 'xp_10000', name: 'No-Lifer', desc: 'Earn 10,000 XP', check: (p) => p.xp >= 10000 },
  { id: 'xp_100000', name: 'Transcendent', desc: 'Earn 100,000 XP', check: (p) => p.xp >= 100000 },
];

function checkAchievements(profile) {
  const newOnes = [];
  for (const ach of ACHIEVEMENTS) {
    if (!profile.achievements.has(ach.id) && ach.check(profile)) {
      profile.achievements.add(ach.id);
      newOnes.push(ach);
    }
  }
  return newOnes;
}

// ============ Display Commands ============

export function getXPStatus(userId, userName) {
  const profile = getOrCreate(userId, userName);
  const levelInfo = calculateLevel(profile.xp);

  const progressBar = buildProgressBar(levelInfo.currentXp, levelInfo.nextLevelXp, 15);

  const lines = [`${profile.userName} — Level ${profile.level}\n`];
  lines.push(`  XP: ${profile.xp.toLocaleString()}`);
  lines.push(`  Progress: ${progressBar} ${levelInfo.currentXp}/${levelInfo.nextLevelXp}`);
  lines.push(`  Streak: ${profile.streak} days (best: ${profile.stats.longestStreak})`);
  lines.push(`  Messages: ${profile.stats.messages} | Commands: ${profile.stats.commands}`);
  lines.push(`  Days Active: ${profile.stats.daysActive}`);
  lines.push(`  Achievements: ${profile.achievements.size}/${ACHIEVEMENTS.length}`);

  return lines.join('\n');
}

export function getAchievements(userId, userName) {
  const profile = getOrCreate(userId, userName);

  const lines = [`Achievements — ${profile.userName}\n`];

  // Earned
  const earned = ACHIEVEMENTS.filter(a => profile.achievements.has(a.id));
  if (earned.length > 0) {
    lines.push('  EARNED:');
    for (const a of earned) {
      lines.push(`    [x] ${a.name} — ${a.desc}`);
    }
  }

  // Not earned
  const remaining = ACHIEVEMENTS.filter(a => !profile.achievements.has(a.id));
  if (remaining.length > 0) {
    lines.push('\n  LOCKED:');
    for (const a of remaining.slice(0, 10)) {
      lines.push(`    [ ] ${a.name} — ${a.desc}`);
    }
    if (remaining.length > 10) {
      lines.push(`    ... and ${remaining.length - 10} more`);
    }
  }

  return lines.join('\n');
}

export function getXPLeaderboard(limit = 10) {
  const sorted = [...players.entries()]
    .sort((a, b) => b[1].xp - a[1].xp)
    .slice(0, limit);

  if (sorted.length === 0) return 'No XP data yet. Start interacting to earn XP!';

  const lines = ['XP Leaderboard\n'];
  for (let i = 0; i < sorted.length; i++) {
    const [, profile] = sorted[i];
    const medal = i === 0 ? '1st' : i === 1 ? '2nd' : i === 2 ? '3rd' : `${i + 1}th`;
    lines.push(`  ${medal} ${profile.userName} — Lv.${profile.level} (${profile.xp.toLocaleString()} XP)`);
  }

  return lines.join('\n');
}

export function getXPStats() {
  return {
    totalPlayers: players.size,
    totalXP: [...players.values()].reduce((s, p) => s + p.xp, 0),
    avgLevel: players.size > 0
      ? ([...players.values()].reduce((s, p) => s + p.level, 0) / players.size).toFixed(1)
      : 0,
  };
}

// ============ Helpers ============

function buildProgressBar(current, total, width) {
  const pct = Math.min(1, current / total);
  const filled = Math.round(pct * width);
  return '[' + '='.repeat(filled) + ' '.repeat(width - filled) + ']';
}
