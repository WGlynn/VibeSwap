import Anthropic from '@anthropic-ai/sdk';
import { config } from './config.js';
import { getGroupStats, getAllUsers, getUnsubmittedContributions } from './tracker.js';
import { getModerationLog } from './moderation.js';
import { getSpamLog } from './antispam.js';

const client = new Anthropic({ apiKey: config.anthropic.apiKey });

// ============ Daily Digest ============
// Jarvis compiles a daily summary of community activity and sends it to the group.
// Uses Haiku for cheap/fast summary generation.

let lastDigestTimestamp = 0;

export async function generateDigest(chatId) {
  const now = Date.now();
  const oneDayAgo = now - 24 * 60 * 60 * 1000;

  // Gather raw data
  const allContributions = getUnsubmittedContributions(oneDayAgo);
  const chatContributions = chatId
    ? allContributions.filter(c => c.chatId === chatId)
    : allContributions;

  if (chatContributions.length === 0) {
    return null; // No activity — skip digest
  }

  const groupStats = getGroupStats(chatId);
  const allUsers = getAllUsers();
  const modLog = getModerationLog(chatId, 50).filter(e => e.timestamp > oneDayAgo);
  const spamActions = getSpamLog(chatId, 50).filter(e => e.timestamp > oneDayAgo);

  // Compute daily metrics
  const activeUsers = new Set();
  const categoryBreakdown = {};
  let totalQuality = 0;
  const hourlyActivity = new Array(24).fill(0);

  for (const c of chatContributions) {
    activeUsers.add(c.telegramUserId);
    categoryBreakdown[c.category] = (categoryBreakdown[c.category] || 0) + 1;
    totalQuality += c.quality;
    const hour = new Date(c.timestamp).getHours();
    hourlyActivity[hour]++;
  }

  const peakHour = hourlyActivity.indexOf(Math.max(...hourlyActivity));
  const avgQuality = chatContributions.length > 0
    ? (totalQuality / chatContributions.length).toFixed(1)
    : 0;

  // Top contributors today
  const userCounts = {};
  const userQuality = {};
  for (const c of chatContributions) {
    const name = c.username || String(c.telegramUserId);
    userCounts[name] = (userCounts[name] || 0) + 1;
    userQuality[name] = (userQuality[name] || 0) + c.quality;
  }

  const topByVolume = Object.entries(userCounts)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5);

  const topByQuality = Object.entries(userQuality)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 3);

  // New members today
  const newMembers = Object.values(allUsers).filter(u =>
    u.firstSeen > oneDayAgo
  );

  // Build the structured data for Claude to summarize
  const digestData = {
    date: new Date().toISOString().split('T')[0],
    messages: chatContributions.length,
    activeUsers: activeUsers.size,
    newMembers: newMembers.length,
    avgQuality,
    peakHour: `${peakHour}:00 UTC`,
    categoryBreakdown,
    topByVolume: topByVolume.map(([name, count]) => `${name}: ${count} msgs`),
    topByQuality: topByQuality.map(([name, score]) => `${name}: ${score.toFixed(0)} quality pts`),
    modActions: modLog.length,
    spamBlocked: spamActions.length,
    totalAllTimeContributions: groupStats.totalContributions,
    totalAllTimeUsers: groupStats.totalUsers,
  };

  // Use Haiku for cheap/fast digest generation
  try {
    const response = await client.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 600,
      system: `You are JARVIS, the AI co-admin of VibeSwap. Write a brief daily digest for the Telegram community. Keep it under 200 words. Be conversational, not corporate. No emojis. Use plain text formatting (no markdown — this is Telegram). Include the key numbers but make it feel human. End with something motivating or a call to action. The real VibeSwap is not a DEX, it's a movement — wherever the Minds converge.`,
      messages: [{
        role: 'user',
        content: `Generate a daily community digest from this data:\n${JSON.stringify(digestData, null, 2)}`
      }],
    });

    const summary = response.content
      .filter(block => block.type === 'text')
      .map(block => block.text)
      .join('\n');

    lastDigestTimestamp = now;
    return summary;
  } catch (err) {
    console.error('[digest] Failed to generate:', err.message);
    return buildFallbackDigest(digestData);
  }
}

// Fallback if Claude API fails — static template
function buildFallbackDigest(data) {
  const lines = [
    `Daily Digest — ${data.date}`,
    '',
    `${data.messages} messages from ${data.activeUsers} active users`,
    `Average quality: ${data.avgQuality}/5`,
    `Peak activity: ${data.peakHour}`,
  ];

  if (data.newMembers > 0) {
    lines.push(`New members: ${data.newMembers}`);
  }

  lines.push('');
  lines.push('Top contributors:');
  for (const entry of data.topByVolume) {
    lines.push(`  ${entry}`);
  }

  if (data.modActions > 0 || data.spamBlocked > 0) {
    lines.push('');
    lines.push(`Moderation: ${data.modActions} actions, ${data.spamBlocked} spam blocked`);
  }

  lines.push('');
  lines.push(`All-time: ${data.totalAllTimeContributions} contributions from ${data.totalAllTimeUsers} users`);

  return lines.join('\n');
}

// ============ Weekly Digest ============
// More in-depth analysis for weekly summaries

export async function generateWeeklyDigest(chatId) {
  const now = Date.now();
  const oneWeekAgo = now - 7 * 24 * 60 * 60 * 1000;

  const allContributions = getUnsubmittedContributions(oneWeekAgo);
  const chatContributions = chatId
    ? allContributions.filter(c => c.chatId === chatId)
    : allContributions;

  if (chatContributions.length === 0) return null;

  // Daily breakdown
  const dailyCounts = {};
  const activeUsers = new Set();
  const categoryBreakdown = {};

  for (const c of chatContributions) {
    const day = new Date(c.timestamp).toISOString().split('T')[0];
    dailyCounts[day] = (dailyCounts[day] || 0) + 1;
    activeUsers.add(c.telegramUserId);
    categoryBreakdown[c.category] = (categoryBreakdown[c.category] || 0) + 1;
  }

  // Growth trend
  const days = Object.entries(dailyCounts).sort((a, b) => a[0].localeCompare(b[0]));
  const trend = days.length >= 2
    ? days[days.length - 1][1] > days[0][1] ? 'growing' : 'stable'
    : 'new';

  const data = {
    period: `${days[0]?.[0] || 'N/A'} to ${days[days.length - 1]?.[0] || 'N/A'}`,
    totalMessages: chatContributions.length,
    uniqueUsers: activeUsers.size,
    dailyAverage: Math.round(chatContributions.length / Math.max(days.length, 1)),
    trend,
    categoryBreakdown,
    busiestDay: days.sort((a, b) => b[1] - a[1])[0],
  };

  try {
    const response = await client.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 800,
      system: `You are JARVIS, AI co-admin of VibeSwap. Write a weekly community digest. Under 300 words. Conversational, not corporate. No emojis. Plain text (Telegram). Highlight trends, top categories, community health. End with a forward-looking statement.`,
      messages: [{
        role: 'user',
        content: `Generate a weekly digest from this data:\n${JSON.stringify(data, null, 2)}`
      }],
    });

    return response.content
      .filter(block => block.type === 'text')
      .map(block => block.text)
      .join('\n');
  } catch (err) {
    console.error('[digest] Weekly digest failed:', err.message);
    return `Weekly Digest — ${data.period}\n${data.totalMessages} messages from ${data.uniqueUsers} users. Daily avg: ${data.dailyAverage}. Trend: ${data.trend}.`;
  }
}

export function getLastDigestTimestamp() {
  return lastDigestTimestamp;
}
