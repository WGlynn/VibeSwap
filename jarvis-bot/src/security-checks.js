// ============ Security Checks — Startup Posture Verification ============
//
// Runs on every startup to verify security posture.
// Logs warnings for misconfigurations that could lead to vulnerabilities.
// Does NOT block startup — provides visibility so operators can fix issues.
// ============

import { config } from './config.js';
import { readFile } from 'fs/promises';
import { join } from 'path';

export async function runSecurityChecks() {
  const issues = [];
  const warnings = [];
  const ok = [];

  // ============ 1. Authorization Whitelist ============
  if (!config.authorizedUsers || config.authorizedUsers.length === 0) {
    warnings.push('AUTHORIZED_USERS is empty — only owner can use commands (fail-closed)');
  } else {
    ok.push(`AUTHORIZED_USERS: ${config.authorizedUsers.length} users configured`);
  }

  // ============ 2. Owner ID ============
  if (!config.ownerUserId) {
    issues.push('OWNER_USER_ID is not set — owner commands will not work');
  } else {
    ok.push(`OWNER_USER_ID: ${config.ownerUserId}`);
  }

  // ============ 3. Shard Secret (multi-shard only) ============
  const isMultiShard = config.shard?.totalShards > 1;
  if (isMultiShard && !config.shard?.secret) {
    issues.push('SHARD_SECRET is NOT set but multi-shard is enabled — consensus endpoints will reject all requests (fail-closed)');
  } else if (isMultiShard && config.shard?.secret) {
    ok.push('SHARD_SECRET: configured for inter-shard HMAC authentication');
  } else if (!isMultiShard) {
    ok.push('Single-shard mode — SHARD_SECRET not required');
  }

  // ============ 4. Encryption ============
  if (!config.privacy?.masterKey) {
    warnings.push('JARVIS_MASTER_KEY is not set — shadow identities will be stored in plaintext');
  } else {
    ok.push('JARVIS_MASTER_KEY: encryption enabled for shadow identities');
  }

  // ============ 5. State File Integrity ============
  const stateFiles = [
    { name: 'compute-economics', path: join(config.dataDir, 'compute-economics.json') },
    { name: 'mining-state', path: join(config.dataDir, 'mining-state.json') },
    { name: 'shadows', path: join(config.dataDir, 'shadows.json') },
  ];

  for (const { name, path } of stateFiles) {
    try {
      const data = await readFile(path, 'utf-8');
      JSON.parse(data); // Verify valid JSON
      ok.push(`State file ${name}: valid JSON`);
    } catch (err) {
      if (err.code === 'ENOENT') {
        ok.push(`State file ${name}: not yet created (fresh start)`);
      } else {
        warnings.push(`State file ${name}: ${err.message} — will use default state`);
      }
    }
  }

  // ============ 6. Bot Token ============
  if (config.shard?.mode === 'primary' && !config.telegram?.token) {
    issues.push('TELEGRAM_BOT_TOKEN is not set in primary mode');
  }

  // ============ 7. LLM Provider Fallback Chain (Infinite Compute) ============
  const freeTierProviders = [
    { name: 'Cerebras', key: config.llm?.cerebrasApiKey },
    { name: 'Groq', key: config.llm?.groqApiKey },
    { name: 'OpenRouter', key: config.llm?.openrouterApiKey },
    { name: 'Mistral', key: config.llm?.mistralApiKey },
    { name: 'Together', key: config.llm?.togetherApiKey },
  ];

  const configuredFree = freeTierProviders.filter(p => p.key);
  const missingFree = freeTierProviders.filter(p => !p.key);

  if (configuredFree.length > 0) {
    ok.push(`Free-tier LLM providers: ${configuredFree.map(p => p.name).join(', ')} (${configuredFree.length}/5)`);
  }
  if (missingFree.length > 0 && missingFree.length < 5) {
    warnings.push(`Missing free-tier LLM keys: ${missingFree.map(p => p.name).join(', ')} — partial Infinite Compute coverage`);
  }
  if (configuredFree.length === 0) {
    warnings.push('No free-tier LLM providers configured — JARVIS depends entirely on paid providers. Set CEREBRAS_API_KEY, GROQ_API_KEY, etc. for resilience.');
  }
  if (configuredFree.length === 5) {
    ok.push('Infinite Compute: ALL 5 free-tier providers configured — blackout risk eliminated');
  }

  // ============ Log Summary ============
  console.log('\n============ Security Posture Check ============');

  if (issues.length > 0) {
    console.log(`\n  CRITICAL (${issues.length}):`);
    for (const issue of issues) {
      console.log(`    [!] ${issue}`);
    }
  }

  if (warnings.length > 0) {
    console.log(`\n  WARNINGS (${warnings.length}):`);
    for (const warning of warnings) {
      console.log(`    [~] ${warning}`);
    }
  }

  console.log(`\n  OK (${ok.length}):`);
  for (const item of ok) {
    console.log(`    [+] ${item}`);
  }

  console.log('\n================================================\n');

  return { issues, warnings, ok };
}
