// ============ Scheduled Briefings & Alerts ============
//
// Proactive intelligence: auto-schedule recurring tasks.
// Users can schedule daily briefings, price alerts, and reminders.
//
// Commands:
//   /schedule morning <HH:MM>     — Daily morning briefing at specified time (UTC)
//   /schedule price <token> <pct> — Alert when token moves more than X% in 1h
//   /schedule gas <gwei>          — Alert when ETH gas drops below threshold
//   /schedule list                — List your scheduled tasks
//   /schedule remove <id>         — Remove a scheduled task
// ============

import { readFile, writeFile } from 'fs/promises';
import { join } from 'path';
import { config } from './config.js';
import { getMorningBriefing } from './tools-engagement.js';

const DATA_DIR = config.dataDir;
const SCHEDULES_FILE = join(DATA_DIR, 'schedules.json');

// All active schedules
// { id, userId, chatId, type, params, lastRun, createdAt }
let schedules = [];
let dirty = false;
let checkInterval = null;
let sendFn = null; // Will be set to bot.telegram.sendMessage

// ============ Init / Persist ============

export async function initScheduler(telegramSendFn) {
  sendFn = telegramSendFn;
  try {
    const data = await readFile(SCHEDULES_FILE, 'utf-8');
    schedules = JSON.parse(data);
    console.log(`[scheduler] Loaded ${schedules.length} schedules`);
  } catch {
    console.log('[scheduler] No saved schedules — starting fresh');
  }
  // Check every minute
  checkInterval = setInterval(checkSchedules, 60 * 1000);
}

export async function flushScheduler() {
  if (!dirty) return;
  await writeFile(SCHEDULES_FILE, JSON.stringify(schedules, null, 2));
  dirty = false;
}

export function stopScheduler() {
  if (checkInterval) clearInterval(checkInterval);
}

// ============ Schedule Management ============

export function addSchedule(userId, chatId, type, params) {
  const id = `sched_${Date.now().toString(36)}`;

  // Limit per user
  const userSchedules = schedules.filter(s => s.userId === userId);
  if (userSchedules.length >= 10) return 'You have reached the limit of 10 schedules. Remove one first.';

  // Validate type
  if (!['morning', 'price', 'gas'].includes(type)) {
    return `Unknown schedule type "${type}".\n\nTypes:\n  morning <HH:MM> — Daily briefing (UTC)\n  price <token> <pct> — Price movement alert\n  gas <gwei> — Gas price alert`;
  }

  const schedule = { id, userId, chatId, type, params, lastRun: 0, createdAt: Date.now() };

  // Validate params
  if (type === 'morning') {
    const time = params.time || '08:00';
    if (!/^\d{1,2}:\d{2}$/.test(time)) return 'Invalid time format. Use HH:MM (e.g., 08:00)';
    const [h, m] = time.split(':').map(Number);
    if (h < 0 || h > 23 || m < 0 || m > 59) return 'Invalid time. Hours 0-23, minutes 0-59.';
    schedule.params = { time };
  } else if (type === 'price') {
    if (!params.token) return 'Usage: /schedule price btc 5\n\nAlerts when token moves more than X% in 1 hour.';
    schedule.params = { token: params.token.toLowerCase(), threshold: Math.abs(parseFloat(params.threshold) || 5) };
  } else if (type === 'gas') {
    if (!params.gwei) return 'Usage: /schedule gas 20\n\nAlerts when ETH gas drops below this gwei threshold.';
    schedule.params = { gwei: parseFloat(params.gwei) || 20 };
  }

  schedules.push(schedule);
  dirty = true;

  const descriptions = {
    morning: `Daily briefing at ${schedule.params.time} UTC`,
    price: `Alert when ${schedule.params.token?.toUpperCase()} moves ${schedule.params.threshold}%+`,
    gas: `Alert when ETH gas < ${schedule.params.gwei} gwei`,
  };

  return `Scheduled: ${descriptions[type]}\nID: ${id}`;
}

export function removeSchedule(userId, scheduleId) {
  const idx = schedules.findIndex(s => s.id === scheduleId && s.userId === userId);
  if (idx === -1) return `Schedule "${scheduleId}" not found or not yours.`;
  schedules.splice(idx, 1);
  dirty = true;
  return `Removed schedule ${scheduleId}`;
}

export function listSchedules(userId) {
  const userSchedules = schedules.filter(s => s.userId === userId);
  if (userSchedules.length === 0) {
    return 'No active schedules.\n\nUsage:\n  /schedule morning 08:00\n  /schedule price btc 5\n  /schedule gas 20';
  }

  const lines = ['Your Schedules\n'];
  for (const s of userSchedules) {
    const desc = s.type === 'morning' ? `Daily briefing at ${s.params.time} UTC`
      : s.type === 'price' ? `${s.params.token?.toUpperCase()} >${s.params.threshold}% move`
      : s.type === 'gas' ? `Gas < ${s.params.gwei} gwei`
      : s.type;
    const lastRun = s.lastRun ? new Date(s.lastRun).toLocaleString() : 'never';
    lines.push(`  [${s.id}] ${desc}`);
    lines.push(`    Last triggered: ${lastRun}`);
  }

  lines.push(`\n  /schedule remove <id> to delete`);
  return lines.join('\n');
}

// ============ Check Loop ============

// Price cache to detect movements
const priceCache = new Map(); // token -> { price, timestamp }

async function checkSchedules() {
  if (!sendFn) return;
  const now = new Date();
  const utcHour = now.getUTCHours();
  const utcMinute = now.getUTCMinutes();
  const utcTimeStr = `${utcHour}:${String(utcMinute).padStart(2, '0')}`;

  for (const schedule of schedules) {
    try {
      if (schedule.type === 'morning') {
        await checkMorningSchedule(schedule, utcTimeStr);
      } else if (schedule.type === 'price') {
        await checkPriceSchedule(schedule);
      } else if (schedule.type === 'gas') {
        await checkGasSchedule(schedule);
      }
    } catch (err) {
      console.error(`[scheduler] Error checking ${schedule.id}: ${err.message}`);
    }
  }

  if (dirty) flushScheduler().catch(() => {});
}

async function checkMorningSchedule(schedule, currentTime) {
  if (schedule.params.time !== currentTime) return;

  // Don't run more than once per day
  const lastRunDate = schedule.lastRun ? new Date(schedule.lastRun).toDateString() : '';
  if (lastRunDate === new Date().toDateString()) return;

  const briefing = await getMorningBriefing();
  try {
    await sendFn(schedule.chatId, briefing);
    schedule.lastRun = Date.now();
    dirty = true;
  } catch (err) {
    console.error(`[scheduler] Failed to send morning briefing to ${schedule.chatId}: ${err.message}`);
  }
}

async function checkPriceSchedule(schedule) {
  const { token, threshold } = schedule.params;

  // Only check every 5 minutes
  if (schedule.lastRun && Date.now() - schedule.lastRun < 5 * 60 * 1000) return;

  try {
    const resp = await fetch(
      `https://api.coingecko.com/api/v3/simple/price?ids=${token}&vs_currencies=usd&include_1hr_change=true`,
      { signal: AbortSignal.timeout(8000) }
    );
    const data = await resp.json();
    const info = data[token];
    if (!info) return;

    const change1h = info.usd_1h_change;
    if (change1h == null) return;

    if (Math.abs(change1h) >= threshold) {
      const direction = change1h > 0 ? 'UP' : 'DOWN';
      const msg = `Price Alert: ${token.toUpperCase()} ${direction} ${Math.abs(change1h).toFixed(1)}% in 1h\n\nPrice: $${info.usd.toLocaleString()}`;
      await sendFn(schedule.chatId, msg);
      schedule.lastRun = Date.now();
      dirty = true;
    }
  } catch (err) {
    console.warn(`[scheduler] Price check failed: ${err.message}`);
  }
}

async function checkGasSchedule(schedule) {
  // Only check every 3 minutes
  if (schedule.lastRun && Date.now() - schedule.lastRun < 3 * 60 * 1000) return;

  try {
    const resp = await fetch(
      'https://api.etherscan.io/api?module=gastracker&action=gasoracle',
      { signal: AbortSignal.timeout(8000) }
    );
    const data = await resp.json();
    if (data.status !== '1') return;

    const gas = parseFloat(data.result?.ProposeGasPrice);
    if (isNaN(gas)) return;

    if (gas <= schedule.params.gwei) {
      const msg = `Gas Alert: ETH gas at ${gas} gwei (below your ${schedule.params.gwei} threshold)\n\nGood time for on-chain activity!`;
      await sendFn(schedule.chatId, msg);
      schedule.lastRun = Date.now();
      dirty = true;
    }
  } catch (err) {
    console.warn(`[scheduler] Gas check failed: ${err.message}`);
  }
}

export function getSchedulerStats() {
  return {
    totalSchedules: schedules.length,
    byType: {
      morning: schedules.filter(s => s.type === 'morning').length,
      price: schedules.filter(s => s.type === 'price').length,
      gas: schedules.filter(s => s.type === 'gas').length,
    },
    uniqueUsers: new Set(schedules.map(s => s.userId)).size,
  };
}
