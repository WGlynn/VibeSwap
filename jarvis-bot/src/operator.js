// ============ Shard Operator Management — Telegram-Native Deployment ============
//
// Allows blessed Telegram users to deploy their own JARVIS worker shards
// without needing CLI access, Fly.io accounts, or terminal experience.
//
// Flow:
//   1. Blessed user sends /shard in DM to Jarvis
//   2. Picks LLM provider (Claude, DeepSeek, Gemini, OpenAI)
//   3. Sends API key (encrypted at rest, message auto-deleted)
//   4. Jarvis validates key with test LLM call
//   5. Jarvis deploys shard via Fly.io Machines API
//   6. Shard boots, registers with router, joins consensus
//
// Security:
//   - API keys encrypted via Rosetta Stone Protocol (privacy.js)
//   - Keys only accepted in DMs
//   - All deployment uses Will's Fly.io account (operators don't need one)
//   - Shard secret auto-generated per operator
//
// "The network grows not by code, but by trust."
// ============

import { readFile, writeFile } from 'fs/promises';
import { existsSync } from 'fs';
import { join } from 'path';
import { createHash, randomBytes } from 'crypto';
import { config } from './config.js';
import { encrypt, decrypt, isEncryptionEnabled } from './privacy.js';

const OPERATORS_FILE = () => join(config.dataDir, 'operators.json');

// ============ State ============

// telegramId -> operator record
const operators = new Map();

// Pending wizard state: userId -> { step, provider, ... }
const wizardState = new Map();

// ============ Provider Config ============

const PROVIDERS = {
  '1': { id: 'claude', name: 'Claude (Anthropic)', model: 'claude-sonnet-4-5-20250929', keyEnv: 'ANTHROPIC_API_KEY', keyPrefix: 'sk-ant-' },
  '2': { id: 'deepseek', name: 'DeepSeek', model: 'deepseek-chat', keyEnv: 'DEEPSEEK_API_KEY', keyPrefix: 'sk-' },
  '3': { id: 'gemini', name: 'Gemini (Google)', model: 'gemini-2.0-flash', keyEnv: 'GEMINI_API_KEY', keyPrefix: 'AIza' },
  '4': { id: 'openai', name: 'OpenAI', model: 'gpt-5.4', keyEnv: 'OPENAI_API_KEY', keyPrefix: 'sk-' },
};

const PROVIDER_HELP = {
  claude: 'Get a key at https://console.anthropic.com/settings/keys',
  deepseek: 'Get a key at https://platform.deepseek.com/api_keys',
  gemini: 'Get a FREE key at https://aistudio.google.com/apikey',
  openai: 'Get a key at https://platform.openai.com/api-keys',
};

// ============ Init ============

export async function initOperators() {
  try {
    if (existsSync(OPERATORS_FILE())) {
      const raw = await readFile(OPERATORS_FILE(), 'utf-8');
      const data = JSON.parse(raw);
      for (const [id, record] of Object.entries(data)) {
        operators.set(Number(id), record);
      }
      console.log(`[operator] Loaded ${operators.size} shard operator(s)`);
    } else {
      console.log('[operator] No operator data — starting fresh');
    }
  } catch (err) {
    console.warn(`[operator] Init error: ${err.message}`);
  }
}

// ============ Persistence ============

export async function flushOperators() {
  try {
    const obj = {};
    for (const [id, record] of operators) obj[id] = record;
    await writeFile(OPERATORS_FILE(), JSON.stringify(obj, null, 2));
  } catch (err) {
    console.warn(`[operator] Flush error: ${err.message}`);
  }
}

// ============ Key Encryption ============

function deriveOperatorKey() {
  const masterKeyHex = config.privacy?.masterKey || 'operator-default-key';
  return createHash('sha256').update(`${masterKeyHex}:operator:api-keys`).digest();
}

function encryptApiKey(apiKey) {
  if (!isEncryptionEnabled()) return apiKey;
  return encrypt(apiKey, deriveOperatorKey());
}

function decryptApiKey(encrypted) {
  if (!isEncryptionEnabled()) return encrypted;
  return decrypt(encrypted, deriveOperatorKey());
}

// ============ Wizard State ============

export function getWizardState(userId) {
  return wizardState.get(userId) || null;
}

export function setWizardState(userId, state) {
  wizardState.set(userId, state);
}

export function clearWizardState(userId) {
  wizardState.delete(userId);
}

// ============ Operator Management ============

export function getOperator(userId) {
  return operators.get(userId) || null;
}

export function registerOperator(userId, name, provider, model, apiKey) {
  if (!name || typeof name !== 'string' || name.trim().length === 0) {
    throw new Error('Operator name is required');
  }
  if (!apiKey || typeof apiKey !== 'string' || apiKey.trim().length < 10) {
    throw new Error('Valid API key is required');
  }
  const shardName = name.toLowerCase().replace(/[^a-z0-9]/g, '').slice(0, 20) || `op${userId}`;
  const flyAppName = `jarvis-shard-${shardName}`;
  const shardId = `shard-${shardName}`;
  const shardSecret = randomBytes(32).toString('hex');

  const record = {
    userId,
    name,
    shardName,
    shardId,
    flyAppName,
    provider,
    model,
    apiKey: encryptApiKey(apiKey),
    apiKeyEnv: PROVIDERS[Object.keys(PROVIDERS).find(k => PROVIDERS[k].id === provider)]?.keyEnv || 'ANTHROPIC_API_KEY',
    shardSecret,
    status: 'registered', // registered -> deploying -> running -> stopped -> failed
    region: config.fly?.defaultRegion || 'iad',
    createdAt: Date.now(),
    deployedAt: null,
    lastHealthCheck: null,
    healthStatus: null,
  };

  operators.set(userId, record);
  return record;
}

// ============ Fly.io Machines API ============

const FLY_API_BASE = 'https://api.machines.dev/v1';

async function flyRequest(method, path, body = null) {
  const token = config.fly?.apiToken;
  if (!token) throw new Error('FLY_API_TOKEN not configured');

  const opts = {
    method,
    headers: {
      'Authorization': `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    signal: AbortSignal.timeout(30000),
  };
  if (body) opts.body = JSON.stringify(body);

  const response = await fetch(`${FLY_API_BASE}${path}`, opts);
  const text = await response.text();

  if (!response.ok) {
    throw new Error(`Fly.io API ${response.status}: ${text.slice(0, 200)}`);
  }

  return text ? JSON.parse(text) : null;
}

export async function deployOperatorShard(userId) {
  const record = operators.get(userId);
  if (!record) throw new Error('Operator not found');

  record.status = 'deploying';
  const { flyAppName, shardId, provider, model, region, shardSecret } = record;
  const org = config.fly?.org || 'personal';
  const routerUrl = `https://${config.fly?.primaryApp || 'jarvis-vibeswap'}.fly.dev`;

  try {
    // Step 1: Create app
    console.log(`[operator] Creating Fly.io app: ${flyAppName}`);
    try {
      await flyRequest('POST', '/apps', {
        app_name: flyAppName,
        org_slug: org,
      });
    } catch (err) {
      if (!err.message.includes('already exists')) throw err;
      console.log(`[operator] App ${flyAppName} already exists, continuing...`);
    }

    // Step 2: Create volume
    console.log(`[operator] Creating 1GB volume in ${region}`);
    try {
      await flyRequest('POST', `/apps/${flyAppName}/volumes`, {
        name: 'jarvis_data',
        size_gb: 1,
        region,
      });
    } catch (err) {
      if (!err.message.includes('already exists')) throw err;
      console.log(`[operator] Volume already exists, continuing...`);
    }

    // Step 3: Create machine with worker config
    const apiKey = decryptApiKey(record.apiKey);
    console.log(`[operator] Creating machine for ${flyAppName}`);

    const machineConfig = {
      image: 'ghcr.io/wglynn/jarvis-shard:latest',
      env: {
        DATA_DIR: '/app/data',
        DOCKER: '1',
        ENCRYPTION_ENABLED: 'true',
        NODE_ENV: 'production',
        HEALTH_PORT: '8080',
        SHARD_MODE: 'worker',
        SHARD_ID: shardId,
        TOTAL_SHARDS: '3',
        NODE_TYPE: 'full',
        ROUTER_URL: routerUrl,
        LLM_PROVIDER: provider,
        LLM_MODEL: model,
        [record.apiKeyEnv]: apiKey,
        SHARD_SECRET: shardSecret,
      },
      services: [{
        ports: [{ port: 443, handlers: ['tls', 'http'] }, { port: 80, handlers: ['http'] }],
        protocol: 'tcp',
        internal_port: 8080,
      }],
      checks: {
        health: {
          type: 'http',
          port: 8080,
          path: '/health',
          interval: '60s',
          timeout: '10s',
        },
      },
      mounts: [{
        volume: 'jarvis_data',
        path: '/app/data',
      }],
      guest: {
        cpu_kind: 'shared',
        cpus: 1,
        memory_mb: 256,
      },
      restart: { policy: 'always', max_retries: 10 },
    };

    const machine = await flyRequest('POST', `/apps/${flyAppName}/machines`, {
      name: `${shardId}-worker`,
      region,
      config: machineConfig,
    });

    record.machineId = machine.id;
    record.status = 'running';
    record.deployedAt = Date.now();
    console.log(`[operator] Shard ${shardId} deployed! Machine: ${machine.id}`);

    return {
      success: true,
      appUrl: `https://${flyAppName}.fly.dev`,
      healthUrl: `https://${flyAppName}.fly.dev/health`,
      shardId,
      machineId: machine.id,
    };
  } catch (err) {
    record.status = 'failed';
    record.lastError = err.message;
    console.error(`[operator] Deploy failed for ${flyAppName}: ${err.message}`);
    throw err;
  }
}

// ============ Health Check ============

export async function checkOperatorHealth(userId) {
  const record = operators.get(userId);
  if (!record) return null;

  try {
    const response = await fetch(`https://${record.flyAppName}.fly.dev/health`, {
      signal: AbortSignal.timeout(10000),
    });
    const data = await response.json();
    record.lastHealthCheck = Date.now();
    record.healthStatus = data.status || 'unknown';
    if (response.ok) record.status = 'running';
    return data;
  } catch (err) {
    record.lastHealthCheck = Date.now();
    record.healthStatus = 'unreachable';
    return { status: 'unreachable', error: err.message };
  }
}

// ============ Stop / Destroy ============

export async function stopOperatorShard(userId) {
  const record = operators.get(userId);
  if (!record?.machineId) throw new Error('No deployed shard found');

  await flyRequest('POST', `/apps/${record.flyAppName}/machines/${record.machineId}/stop`);
  record.status = 'stopped';
  return true;
}

export async function startOperatorShard(userId) {
  const record = operators.get(userId);
  if (!record?.machineId) throw new Error('No deployed shard found');

  await flyRequest('POST', `/apps/${record.flyAppName}/machines/${record.machineId}/start`);
  record.status = 'running';
  return true;
}

export async function destroyOperatorShard(userId) {
  const record = operators.get(userId);
  if (!record) throw new Error('Operator not found');

  try {
    // Delete machine
    if (record.machineId) {
      try {
        await flyRequest('POST', `/apps/${record.flyAppName}/machines/${record.machineId}/stop`);
      } catch { /* might already be stopped */ }
      await flyRequest('DELETE', `/apps/${record.flyAppName}/machines/${record.machineId}?force=true`);
    }
    // Delete app
    await flyRequest('DELETE', `/apps/${record.flyAppName}`);
  } catch (err) {
    console.warn(`[operator] Destroy warning for ${record.flyAppName}: ${err.message}`);
  }

  operators.delete(userId);
  return true;
}

// ============ API Key Validation ============

export async function validateApiKey(provider, apiKey) {
  const start = Date.now();
  try {
    let response;
    switch (provider) {
      case 'claude':
        response = await fetch('https://api.anthropic.com/v1/messages', {
          method: 'POST',
          headers: {
            'x-api-key': apiKey,
            'anthropic-version': '2023-06-01',
            'content-type': 'application/json',
          },
          body: JSON.stringify({
            model: 'claude-sonnet-4-5-20250929',
            max_tokens: 10,
            messages: [{ role: 'user', content: 'Say "ok"' }],
          }),
          signal: AbortSignal.timeout(15000),
        });
        break;

      case 'openai':
        response = await fetch('https://api.openai.com/v1/chat/completions', {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${apiKey}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            model: 'gpt-4o-mini',
            max_tokens: 10,
            messages: [{ role: 'user', content: 'Say "ok"' }],
          }),
          signal: AbortSignal.timeout(15000),
        });
        break;

      case 'gemini':
        response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${apiKey}`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            contents: [{ parts: [{ text: 'Say "ok"' }] }],
          }),
          signal: AbortSignal.timeout(15000),
        });
        break;

      case 'deepseek':
        response = await fetch('https://api.deepseek.com/chat/completions', {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${apiKey}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            model: 'deepseek-chat',
            max_tokens: 10,
            messages: [{ role: 'user', content: 'Say "ok"' }],
          }),
          signal: AbortSignal.timeout(15000),
        });
        break;

      default:
        return { valid: false, error: 'Unknown provider' };
    }

    const latencyMs = Date.now() - start;
    if (response.ok) {
      return { valid: true, latencyMs, model: PROVIDERS[Object.keys(PROVIDERS).find(k => PROVIDERS[k].id === provider)]?.model };
    }
    const errText = await response.text();
    const errLower = errText.toLowerCase();

    // 401 = bad key. 403 = forbidden. These mean the key itself is wrong.
    if (response.status === 401 || response.status === 403) {
      return { valid: false, error: 'Invalid API key — check for typos and try again.', latencyMs };
    }

    // Credit/billing errors = key is valid but account has no credits.
    // The shard has Wardenclyffe cascade, so it'll still work via fallback providers.
    if (errLower.includes('credit balance') || errLower.includes('billing') || errLower.includes('quota') || errLower.includes('rate limit')) {
      return { valid: true, warning: 'Key is valid but your account has low/no credits. The shard will use Wardenclyffe cascade (fallback providers) until credits are added.', latencyMs, model: PROVIDERS[Object.keys(PROVIDERS).find(k => PROVIDERS[k].id === provider)]?.model };
    }

    // Other errors (429 rate limit, 500 server error, etc.) — key is probably valid
    if (response.status === 429 || response.status >= 500) {
      return { valid: true, warning: `Provider returned ${response.status} — key accepted (temporary issue).`, latencyMs, model: PROVIDERS[Object.keys(PROVIDERS).find(k => PROVIDERS[k].id === provider)]?.model };
    }

    return { valid: false, error: `API returned ${response.status}: ${errText.slice(0, 100)}`, latencyMs };
  } catch (err) {
    return { valid: false, error: err.message, latencyMs: Date.now() - start };
  }
}

// ============ Stats ============

export function getOperatorStats() {
  const stats = {
    total: operators.size,
    running: 0,
    stopped: 0,
    failed: 0,
    deploying: 0,
    operators: [],
  };

  for (const [userId, record] of operators) {
    if (record.status === 'running') stats.running++;
    else if (record.status === 'stopped') stats.stopped++;
    else if (record.status === 'failed') stats.failed++;
    else if (record.status === 'deploying') stats.deploying++;

    stats.operators.push({
      userId,
      name: record.name,
      shardId: record.shardId,
      provider: record.provider,
      model: record.model,
      status: record.status,
      flyAppName: record.flyAppName,
      region: record.region,
      deployedAt: record.deployedAt ? new Date(record.deployedAt).toISOString() : null,
      healthStatus: record.healthStatus,
    });
  }

  return stats;
}

export function listOperators() {
  return Array.from(operators.entries()).map(([userId, record]) => ({
    userId,
    ...record,
    apiKey: '[encrypted]', // Never expose
  }));
}

export { PROVIDERS, PROVIDER_HELP };
