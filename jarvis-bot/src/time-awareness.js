import { writeFile, readFile, mkdir } from 'fs/promises';
import { join } from 'path';
import { config } from './config.js';

const DATA_DIR = config.dataDir;
const TIMEZONE_FILE = join(DATA_DIR, 'user-timezones.json');

// ============ State ============

const userTimezones = new Map(); // userId -> IANA timezone string

// ============ Timezone Detection Patterns ============

const TIMEZONE_ABBREVIATIONS = {
  'est': 'America/New_York',
  'edt': 'America/New_York',
  'eastern': 'America/New_York',
  'cst': 'America/Chicago',
  'cdt': 'America/Chicago',
  'central': 'America/Chicago',
  'mst': 'America/Denver',
  'mdt': 'America/Denver',
  'mountain': 'America/Denver',
  'pst': 'America/Los_Angeles',
  'pdt': 'America/Los_Angeles',
  'pacific': 'America/Los_Angeles',
  'gmt': 'Europe/London',
  'bst': 'Europe/London',
  'utc': 'UTC',
  'cet': 'Europe/Berlin',
  'cest': 'Europe/Berlin',
  'eet': 'Europe/Helsinki',
  'eest': 'Europe/Helsinki',
  'ist': 'Asia/Kolkata',
  'jst': 'Asia/Tokyo',
  'kst': 'Asia/Seoul',
  'aest': 'Australia/Sydney',
  'aedt': 'Australia/Sydney',
  'nzst': 'Pacific/Auckland',
  'nzdt': 'Pacific/Auckland',
  'hkt': 'Asia/Hong_Kong',
  'sgt': 'Asia/Singapore',
  'pht': 'Asia/Manila',
};

const CITY_TIMEZONES = {
  'new york': 'America/New_York',
  'nyc': 'America/New_York',
  'chicago': 'America/Chicago',
  'denver': 'America/Denver',
  'los angeles': 'America/Los_Angeles',
  'la': 'America/Los_Angeles',
  'san francisco': 'America/Los_Angeles',
  'sf': 'America/Los_Angeles',
  'seattle': 'America/Los_Angeles',
  'london': 'Europe/London',
  'paris': 'Europe/Paris',
  'berlin': 'Europe/Berlin',
  'amsterdam': 'Europe/Amsterdam',
  'tokyo': 'Asia/Tokyo',
  'seoul': 'Asia/Seoul',
  'singapore': 'Asia/Singapore',
  'hong kong': 'Asia/Hong_Kong',
  'sydney': 'Australia/Sydney',
  'melbourne': 'Australia/Melbourne',
  'auckland': 'Pacific/Auckland',
  'mumbai': 'Asia/Kolkata',
  'delhi': 'Asia/Kolkata',
  'dubai': 'Asia/Dubai',
  'toronto': 'America/Toronto',
  'vancouver': 'America/Vancouver',
  'miami': 'America/New_York',
  'houston': 'America/Chicago',
  'phoenix': 'America/Phoenix',
  'honolulu': 'Pacific/Honolulu',
  'anchorage': 'America/Anchorage',
  'lisbon': 'Europe/Lisbon',
  'madrid': 'Europe/Madrid',
  'rome': 'Europe/Rome',
  'moscow': 'Europe/Moscow',
  'istanbul': 'Europe/Istanbul',
  'cairo': 'Africa/Cairo',
  'lagos': 'Africa/Lagos',
  'nairobi': 'Africa/Nairobi',
  'bangkok': 'Asia/Bangkok',
  'jakarta': 'Asia/Jakarta',
  'shanghai': 'Asia/Shanghai',
  'beijing': 'Asia/Shanghai',
  'taipei': 'Asia/Taipei',
  'manila': 'Asia/Manila',
  'saigon': 'Asia/Ho_Chi_Minh',
};

// ============ Timezone Management ============

export function setUserTimezone(userId, timezone) {
  userTimezones.set(String(userId), timezone);
  console.log(`[time] Set timezone for user ${userId}: ${timezone}`);
}

export function getUserTimezone(userId) {
  return userTimezones.get(String(userId)) || null;
}

// ============ Timezone Detection ============

export function detectTimezone(text) {
  if (!text) return null;
  const lower = text.toLowerCase();

  // Match UTC offset patterns: UTC+5, UTC-3, GMT+5:30, UTC+05:30
  const utcOffsetMatch = lower.match(/(?:utc|gmt)\s*([+-])\s*(\d{1,2})(?::(\d{2}))?/);
  if (utcOffsetMatch) {
    const sign = utcOffsetMatch[1];
    const hours = parseInt(utcOffsetMatch[2]);
    const minutes = utcOffsetMatch[3] ? parseInt(utcOffsetMatch[3]) : 0;
    // Etc/GMT uses inverted sign convention
    if (minutes === 0) {
      const etcSign = sign === '+' ? '-' : '+';
      return `Etc/GMT${etcSign}${hours}`;
    }
    // For fractional offsets, map to known IANA zones
    const totalMinutes = (sign === '+' ? 1 : -1) * (hours * 60 + minutes);
    if (totalMinutes === 330) return 'Asia/Kolkata';
    if (totalMinutes === 345) return 'Asia/Kathmandu';
    if (totalMinutes === 545) return 'Australia/Adelaide';
    if (totalMinutes === -210) return 'America/St_Johns';
    // Fallback: use whole-hour Etc/GMT
    const etcSign = sign === '+' ? '-' : '+';
    return `Etc/GMT${etcSign}${hours}`;
  }

  // Match "I'm in [city/region]" or "[city] time"
  for (const [city, tz] of Object.entries(CITY_TIMEZONES)) {
    const cityPattern = new RegExp(`(?:i'?m\\s+in|from|live\\s+in|based\\s+in|located\\s+in)\\s+${city}|${city}\\s+time`, 'i');
    if (cityPattern.test(lower)) return tz;
  }

  // Match timezone abbreviations as standalone words
  for (const [abbr, tz] of Object.entries(TIMEZONE_ABBREVIATIONS)) {
    const abbrPattern = new RegExp(`\\b${abbr}\\b`, 'i');
    if (abbrPattern.test(lower)) return tz;
  }

  // Match "it's [time] here" to infer rough offset (informational only, less reliable)
  const timeHereMatch = lower.match(/it'?s\s+(\d{1,2})(?::(\d{2}))?\s*(am|pm)?\s*here/i);
  if (timeHereMatch) {
    // Can't reliably determine timezone from just a time claim — return null
    // The user should explicitly state their timezone
    return null;
  }

  return null;
}

// ============ Time Context ============

export function getTimeContext(userId) {
  const tz = getUserTimezone(String(userId)) || 'UTC';

  try {
    const now = new Date();

    const dateFormatter = new Intl.DateTimeFormat('en-US', {
      timeZone: tz,
      weekday: 'long',
      year: 'numeric',
      month: 'long',
      day: 'numeric',
    });

    const timeFormatter = new Intl.DateTimeFormat('en-US', {
      timeZone: tz,
      hour: 'numeric',
      minute: '2-digit',
      hour12: true,
    });

    const hourFormatter = new Intl.DateTimeFormat('en-US', {
      timeZone: tz,
      hour: 'numeric',
      hour12: false,
    });

    const dateStr = dateFormatter.format(now);
    const timeStr = timeFormatter.format(now);
    const hour = parseInt(hourFormatter.format(now));

    // Determine short timezone label
    const tzLabel = new Intl.DateTimeFormat('en-US', {
      timeZone: tz,
      timeZoneName: 'short',
    }).formatToParts(now).find(p => p.type === 'timeZoneName')?.value || tz;

    // Determine time of day
    let timeOfDay;
    if (hour >= 5 && hour < 12) timeOfDay = 'morning';
    else if (hour >= 12 && hour < 17) timeOfDay = 'afternoon';
    else if (hour >= 17 && hour < 21) timeOfDay = 'evening';
    else if (hour >= 21 || hour < 1) timeOfDay = 'night';
    else timeOfDay = 'late night';

    return `[Current time: ${dateStr} ${timeStr} ${tzLabel}. Time of day: ${timeOfDay}.]`;
  } catch (err) {
    console.log(`[time] Error formatting time for timezone ${tz}: ${err.message}`);
    return null;
  }
}

// ============ Greeting ============

export function getGreeting(userId) {
  const tz = getUserTimezone(String(userId)) || 'UTC';

  try {
    const now = new Date();
    const hourFormatter = new Intl.DateTimeFormat('en-US', {
      timeZone: tz,
      hour: 'numeric',
      hour12: false,
    });
    const hour = parseInt(hourFormatter.format(now));

    if (hour >= 1 && hour < 5) return "You're up late";
    if (hour >= 5 && hour < 12) return 'Good morning';
    if (hour >= 12 && hour < 17) return 'Good afternoon';
    if (hour >= 17 && hour < 21) return 'Good evening';
    // 21-1: night but not "up late" territory
    return 'Good evening';
  } catch (err) {
    console.log(`[time] Error getting greeting for timezone ${tz}: ${err.message}`);
    return 'Hello';
  }
}

// ============ Persistence ============

export async function flushTimezones() {
  try {
    await mkdir(DATA_DIR, { recursive: true });
    const data = Object.fromEntries(userTimezones);
    await writeFile(TIMEZONE_FILE, JSON.stringify(data, null, 2), 'utf-8');
    console.log(`[time] Flushed ${userTimezones.size} user timezones to disk`);
  } catch (err) {
    console.log(`[time] Error flushing timezones: ${err.message}`);
  }
}

export async function initTimeAwareness() {
  try {
    const raw = await readFile(TIMEZONE_FILE, 'utf-8');
    const data = JSON.parse(raw);
    for (const [userId, tz] of Object.entries(data)) {
      userTimezones.set(String(userId), tz);
    }
    console.log(`[time] Loaded ${userTimezones.size} user timezones from disk`);
  } catch (err) {
    if (err.code === 'ENOENT') {
      console.log('[time] No timezone file found, starting fresh');
    } else {
      console.log(`[time] Error loading timezones: ${err.message}`);
    }
  }
}
