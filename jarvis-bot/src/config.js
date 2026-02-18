import 'dotenv/config';
import { resolve } from 'path';

export const config = {
  telegram: {
    token: process.env.TELEGRAM_BOT_TOKEN,
  },
  anthropic: {
    apiKey: process.env.ANTHROPIC_API_KEY,
    model: process.env.CLAUDE_MODEL || 'claude-sonnet-4-5-20250929',
  },
  repo: {
    path: process.env.VIBESWAP_REPO || '/c/Users/Will/vibeswap',
    remoteOrigin: process.env.GIT_REMOTE_ORIGIN || 'origin',
    remoteStealth: process.env.GIT_REMOTE_STEALTH || 'stealth',
  },
  memory: {
    dir: process.env.MEMORY_DIR || '/c/Users/Will/.claude/projects/C--Users-Will/memory',
  },
  authorizedUsers: process.env.AUTHORIZED_USERS
    ? process.env.AUTHORIZED_USERS.split(',').map(id => parseInt(id.trim()))
    : [],
  // Jarvis is the sole admin — Will's Telegram user ID
  ownerUserId: process.env.OWNER_USER_ID ? parseInt(process.env.OWNER_USER_ID) : null,
  maxConversationHistory: 50,
  maxTokens: 1024,
  // Auto-sync: pull from git + reload context (ms, default 1 hour)
  autoSyncInterval: parseInt(process.env.AUTO_SYNC_INTERVAL || '3600000'),
  // Auto-backup: commit data/ to git (ms, default 6 hours)
  autoBackupInterval: parseInt(process.env.AUTO_BACKUP_INTERVAL || '21600000'),
};
