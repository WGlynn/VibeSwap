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
  // Meeting transcript webhook — receives live transcripts from Fireflies.ai
  transcriptWebhookSecret: process.env.TRANSCRIPT_WEBHOOK_SECRET || null,
  transcriptChatId: process.env.TRANSCRIPT_CHAT_ID ? parseInt(process.env.TRANSCRIPT_CHAT_ID) : null,
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
  // Claude Code API bridge — shared secret for direct communication
  claudeCodeApiSecret: process.env.CLAUDE_CODE_API_SECRET || null,
  // Privacy / Encryption (Rosetta Stone Protocol)
  privacy: {
    masterKey: process.env.JARVIS_MASTER_KEY || null,
    encryptionEnabled: process.env.ENCRYPTION_ENABLED !== 'false', // ON by default
  },
  // Shard / Network configuration (Decentralized Mind Network)
  shard: {
    id: process.env.SHARD_ID || 'shard-0',
    totalShards: parseInt(process.env.TOTAL_SHARDS || '1'),
    nodeType: process.env.NODE_TYPE || 'full', // 'light' | 'full' | 'archive'
    stateBackend: process.env.STATE_BACKEND || 'file', // 'file' | 'redis'
    redisUrl: process.env.REDIS_URL || null,
    routerUrl: process.env.ROUTER_URL || null,
    // Worker mode: shard runs without Telegram bot, participates in consensus/CRPC only
    // Auto-detected when TELEGRAM_BOT_TOKEN is missing and SHARD_MODE=worker
    mode: process.env.SHARD_MODE || (process.env.TELEGRAM_BOT_TOKEN ? 'primary' : 'worker'),
    // Shared secret for inter-shard HMAC authentication (required for multi-shard)
    secret: process.env.SHARD_SECRET || null,
    // Static peer seeds — known shard URLs for router-independent discovery (comma-separated)
    // These are public URLs that work even if the router is down
    peerSeeds: process.env.PEER_SEEDS ? process.env.PEER_SEEDS.split(',').map(s => s.trim()) : [],
  },
  // LLM Provider (Multi-Model Mind Network)
  llm: {
    provider: process.env.LLM_PROVIDER || 'claude', // 'claude' | 'openai' | 'ollama' | 'gemini' | 'deepseek'
    model: process.env.LLM_MODEL || process.env.CLAUDE_MODEL || 'claude-sonnet-4-5-20250929',
    baseUrl: process.env.LLM_BASE_URL || null, // Custom endpoint (e.g., self-hosted Ollama)
    openaiApiKey: process.env.OPENAI_API_KEY || null,
    geminiApiKey: process.env.GEMINI_API_KEY || null,
    deepseekApiKey: process.env.DEEPSEEK_API_KEY || null,
    ollamaUrl: process.env.OLLAMA_URL || 'http://localhost:11434',
    whisperModel: process.env.WHISPER_MODEL || 'whisper-1',
    // Tier 2 — Free/Low-Cost providers (Infinite Compute fallback chain)
    cerebrasApiKey: process.env.CEREBRAS_API_KEY || null,
    groqApiKey: process.env.GROQ_API_KEY || null,
    openrouterApiKey: process.env.OPENROUTER_API_KEY || null,
    mistralApiKey: process.env.MISTRAL_API_KEY || null,
    togetherApiKey: process.env.TOGETHER_API_KEY || null,
    sambanovaApiKey: process.env.SAMBANOVA_API_KEY || null,
    fireworksApiKey: process.env.FIREWORKS_API_KEY || null,
    novitaApiKey: process.env.NOVITA_API_KEY || null,
  },
  // Web Portal — public-facing API for frontend
  web: {
    corsOrigins: (process.env.WEB_CORS_ORIGINS || 'https://frontend-jade-five-87.vercel.app,http://localhost:3000,http://localhost:5173').split(','),
    rateLimitPerMinute: parseInt(process.env.WEB_RATE_LIMIT || '5'),
    sessionTtlMs: 2 * 60 * 60 * 1000, // 2 hours
  },
  // Fireflies.ai integration (meeting transcription)
  fireflies: {
    apiKey: process.env.FIREFLIES_API_KEY || null,
    webhookSecret: process.env.FIREFLIES_WEBHOOK_SECRET || null, // HMAC verification
  },
  // Fly.io Machines API — for deploying operator shards
  fly: {
    apiToken: process.env.FLY_API_TOKEN || null,
    org: process.env.FLY_ORG || 'personal',
    primaryApp: process.env.FLY_APP_NAME || 'jarvis-vibeswap',
    defaultRegion: process.env.FLY_DEFAULT_REGION || 'iad',
  },
  // MI Host SDK — Micro-Interface cell runtime
  mi: {
    cellsDir: process.env.MI_CELLS_DIR || './cells',
    stateFile: process.env.MI_STATE_FILE || './data/mi-state.json',
    maxSignalQueue: parseInt(process.env.MI_MAX_SIGNAL_QUEUE || '1000'),
    signalProcessIntervalMs: parseInt(process.env.MI_SIGNAL_INTERVAL || '100'),
    persistIntervalMs: parseInt(process.env.MI_PERSIST_INTERVAL || '300000'),
    hotReloadDebounceMs: parseInt(process.env.MI_HOT_RELOAD_DEBOUNCE || '2000'),
    lifecycleCheckIntervalMs: parseInt(process.env.MI_LIFECYCLE_CHECK_INTERVAL || '60000'),
  },
  // Tip jar — ETH address for voluntary contributions
  tipJarAddress: process.env.TIP_JAR_ADDRESS || '0xa-EOFc55d6f6478918076B5Bb85E8Cf3738549a2',
  // Runtime info
  isDocker,
};
