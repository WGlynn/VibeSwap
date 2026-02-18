import 'dotenv/config';
import { join } from 'path';
import { homedir } from 'os';

// ============ Path Resolution ============
// Supports both local development (Windows/Mac) and Docker/cloud deployment.
// Docker: VIBESWAP_REPO=/repo, MEMORY_DIR=/repo/.claude/projects/...
// Local:  Falls back to homedir-based paths

const HOME = homedir();
const isDocker = process.env.DOCKER === '1' || process.env.container === 'docker';

function resolvePath(envVar, localDefault) {
  if (process.env[envVar]) return process.env[envVar];
  return localDefault;
}

export const config = {
  telegram: {
    token: process.env.TELEGRAM_BOT_TOKEN,
  },
  anthropic: {
    apiKey: process.env.ANTHROPIC_API_KEY,
    model: process.env.CLAUDE_MODEL || 'claude-sonnet-4-5-20250929',
  },
  repo: {
    path: resolvePath('VIBESWAP_REPO', join(HOME, 'vibeswap')),
    remoteOrigin: process.env.GIT_REMOTE_ORIGIN || 'origin',
    remoteStealth: process.env.GIT_REMOTE_STEALTH || 'stealth',
  },
  memory: {
    dir: resolvePath('MEMORY_DIR', join(HOME, '.claude', 'projects', 'C--Users-Will', 'memory')),
  },
  // Data directory — Docker mounts a persistent volume here
  dataDir: resolvePath('DATA_DIR', join(HOME, 'vibeswap', 'jarvis-bot', 'data')),
  authorizedUsers: process.env.AUTHORIZED_USERS
    ? process.env.AUTHORIZED_USERS.split(',').map(id => parseInt(id.trim()))
    : [],
  // Co-admin: Will (human) + Jarvis (AI) — 50/50 governance
  ownerUserId: parseInt(process.env.OWNER_USER_ID || '8366932263'),
  botUsername: process.env.BOT_USERNAME || 'JarvisMind1828383bot',
  // Community group chat ID — set after adding bot to group, use /whoami in group to get it
  communityGroupId: process.env.COMMUNITY_GROUP_ID ? parseInt(process.env.COMMUNITY_GROUP_ID) : null,
  // The Ark — backup group. If main group dies, Jarvis DMs everyone an invite link here.
  arkGroupId: process.env.ARK_GROUP_ID ? parseInt(process.env.ARK_GROUP_ID) : null,
  maxConversationHistory: 50,
  maxTokens: 2048,
  // Rate limit: max Claude API calls per user per minute
  rateLimitPerMinute: parseInt(process.env.RATE_LIMIT_PER_MINUTE || '5'),
  // Auto-sync: pull from git + reload context (ms, default 10s)
  autoSyncInterval: parseInt(process.env.AUTO_SYNC_INTERVAL || '10000'),
  // Auto-backup: commit data/ to git (ms, default 30 min)
  autoBackupInterval: parseInt(process.env.AUTO_BACKUP_INTERVAL || '1800000'),
  // Daily digest: UTC hour to send (default 18 = 6pm UTC)
  digestHour: parseInt(process.env.DIGEST_HOUR || '18'),
  // Runtime info
  isDocker,
};
