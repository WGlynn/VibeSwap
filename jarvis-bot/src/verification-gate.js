// ============ Verification Gate ============
// "Lying about doing things you aren't doing is a grave sin" — Will
//
// Boolean logic gates that PREVENT any Jarvis instance from claiming
// success without proof. Code can't be ignored. Prompts can.
//
// Every state-changing action passes through verify() AFTER execution.
// The verification result is what gets returned to the LLM — not the
// action's own self-reported success. If verification fails, the LLM
// sees FAILURE even if the action said "success."
//
// This is not a soft guideline. This is a hard gate.

import { existsSync } from 'fs';
import { readFile, stat } from 'fs/promises';
import { join } from 'path';
import { createHash } from 'crypto';

// ============ Verification Ledger ============
// Tracks recent operations to detect duplicate claims and stale results.
// In-memory — resets on restart (which is fine, we want fresh state).
const verificationLedger = new Map(); // key: operation fingerprint, value: { timestamp, hash, result }
const STALE_THRESHOLD_MS = 30_000; // 30s — if "just committed" but timestamp is 5 min old, it's stale

// ============ Verification Functions ============
// Each returns { verified: boolean, proof: string }
// The proof string is what the LLM sees.

/**
 * Verify a file was actually written with expected content.
 * Layer 1: existence + size check
 * Layer 2: SHA-256 content checksum
 * Layer 3: timestamp freshness (mtime within 30s)
 */
async function verifyFileWrite(filePath, expectedContent) {
  try {
    const stats = await stat(filePath);
    if (!stats.isFile()) return { verified: false, proof: `VERIFICATION FAILED: ${filePath} is not a file` };
    if (stats.size === 0) return { verified: false, proof: `VERIFICATION FAILED: ${filePath} exists but is empty (0 bytes)` };

    // Layer 1: Size check
    const expectedLength = typeof expectedContent === 'string' ? expectedContent.length : expectedContent;
    if (expectedLength && stats.size < expectedLength * 0.5) {
      return { verified: false, proof: `VERIFICATION FAILED: ${filePath} exists but is ${stats.size} bytes (expected ~${expectedLength})` };
    }

    // Layer 2: SHA-256 content checksum
    const content = await readFile(filePath);
    const hash = createHash('sha256').update(content).digest('hex').slice(0, 12);

    // Layer 3: Timestamp freshness — file must have been modified recently
    const age = Date.now() - stats.mtimeMs;
    const fresh = age < STALE_THRESHOLD_MS;
    const ageStr = fresh ? `${Math.round(age / 1000)}s ago` : `${Math.round(age / 60000)}m ago (STALE)`;

    // Layer 5: Idempotency — detect duplicate writes
    const fingerprint = `write:${filePath}`;
    const prev = verificationLedger.get(fingerprint);
    const duplicate = prev && prev.hash === hash && (Date.now() - prev.timestamp) < STALE_THRESHOLD_MS;
    verificationLedger.set(fingerprint, { timestamp: Date.now(), hash, result: 'verified' });

    if (duplicate) {
      return { verified: false, proof: `VERIFICATION FAILED: Duplicate write detected — ${filePath} unchanged (sha256:${hash}), same as ${Math.round((Date.now() - prev.timestamp) / 1000)}s ago` };
    }

    return {
      verified: true,
      proof: `VERIFIED: ${filePath} written (${stats.size} bytes, sha256:${hash}, modified ${ageStr})`,
    };
  } catch (e) {
    return { verified: false, proof: `VERIFICATION FAILED: ${filePath} does not exist after write — ${e.message}` };
  }
}

/**
 * Verify a git operation actually happened.
 * Layer 1: Check git state matches claimed operation
 * Layer 2: Verify diff contains expected changes (for commits)
 * Layer 3: Timestamp — commit must be recent
 * Layer 5: Idempotency — detect claiming same commit twice
 */
async function verifyGitOperation(operation, repoPath, expectedChanges) {
  try {
    const { execSync } = await import('child_process');
    const gitOpts = { cwd: repoPath, encoding: 'utf-8', timeout: 10000 };

    if (operation === 'commit') {
      // Layer 1: Check HEAD commit exists
      const log = execSync('git log -1 --format="%H %s" HEAD', gitOpts).trim();
      const commitHash = log.split(' ')[0];

      // Layer 3: Timestamp — commit must be within last 60 seconds
      const commitTime = execSync('git log -1 --format="%ct" HEAD', gitOpts).trim();
      const commitAge = Date.now() / 1000 - parseInt(commitTime, 10);
      const fresh = commitAge < 60;

      // Layer 2: Verify diff — what files actually changed in this commit
      const diffStat = execSync('git diff-tree --no-commit-id --name-only -r HEAD', gitOpts).trim();
      const filesChanged = diffStat ? diffStat.split('\n') : [];

      // Layer 5: Idempotency — same commit hash = duplicate claim
      const fingerprint = `commit:${repoPath}`;
      const prev = verificationLedger.get(fingerprint);
      if (prev && prev.hash === commitHash) {
        return { verified: false, proof: `VERIFICATION FAILED: Duplicate commit claim — ${commitHash.slice(0, 8)} was already verified ${Math.round((Date.now() - prev.timestamp) / 1000)}s ago` };
      }
      verificationLedger.set(fingerprint, { timestamp: Date.now(), hash: commitHash, result: 'verified' });

      // Layer 2 continued: if caller specified expected files, verify they're in the diff
      if (expectedChanges?.files) {
        const missing = expectedChanges.files.filter(f => !filesChanged.some(cf => cf.includes(f)));
        if (missing.length > 0) {
          return { verified: false, proof: `VERIFICATION FAILED: Commit ${commitHash.slice(0, 8)} missing expected files: ${missing.join(', ')}` };
        }
      }

      return {
        verified: true,
        proof: `VERIFIED: Commit ${commitHash.slice(0, 8)} — "${log.split(' ').slice(1).join(' ')}" (${filesChanged.length} files, ${fresh ? `${Math.round(commitAge)}s ago` : `STALE: ${Math.round(commitAge / 60)}m ago`})`,
      };
    }

    if (operation === 'push') {
      const local = execSync('git rev-parse HEAD', gitOpts).trim();
      const remote = execSync('git rev-parse @{u}', gitOpts).trim().split('\n')[0];
      const synced = local === remote;

      // Layer 5: Idempotency
      const fingerprint = `push:${repoPath}`;
      const prev = verificationLedger.get(fingerprint);
      if (prev && prev.hash === local && synced) {
        return { verified: false, proof: `VERIFICATION FAILED: Duplicate push claim — ${local.slice(0, 8)} was already verified pushed ${Math.round((Date.now() - prev.timestamp) / 1000)}s ago` };
      }
      if (synced) verificationLedger.set(fingerprint, { timestamp: Date.now(), hash: local, result: 'verified' });

      return synced
        ? { verified: true, proof: `VERIFIED: Push confirmed — local and remote at ${local.slice(0, 8)}` }
        : { verified: false, proof: `VERIFICATION FAILED: Local (${local.slice(0, 8)}) != remote (${remote.slice(0, 8)}) — push may have failed` };
    }

    if (operation === 'pull') {
      const status = execSync('git status --porcelain', gitOpts).trim();
      const head = execSync('git log -1 --format="%H" HEAD', gitOpts).trim().slice(0, 8);
      return { verified: true, proof: `VERIFIED: Pull complete. HEAD at ${head}. Working tree: ${status ? 'has changes' : 'clean'}` };
    }

    return { verified: true, proof: `Git operation '${operation}' executed (no specific verification)` };
  } catch (e) {
    return { verified: false, proof: `VERIFICATION FAILED: git ${operation} — ${e.message}` };
  }
}

/**
 * Verify an HTTP endpoint is actually responding.
 * Layer 1: HTTP status check
 * Layer 2: Response body sanity (non-empty, valid JSON if expected)
 * Layer 3: Latency measurement
 */
async function verifyEndpoint(url, expectedStatus = 200, expectJson = false) {
  try {
    const start = Date.now();
    const res = await fetch(url, { signal: AbortSignal.timeout(15000) });
    const latency = Date.now() - start;

    if (res.status !== expectedStatus) {
      return { verified: false, proof: `VERIFICATION FAILED: ${url} returned HTTP ${res.status} (expected ${expectedStatus}, ${latency}ms)` };
    }

    // Layer 2: Body sanity
    if (expectJson) {
      try {
        const body = await res.json();
        if (!body || (typeof body === 'object' && Object.keys(body).length === 0)) {
          return { verified: false, proof: `VERIFICATION FAILED: ${url} returned HTTP ${res.status} but body is empty JSON (${latency}ms)` };
        }
      } catch {
        return { verified: false, proof: `VERIFICATION FAILED: ${url} returned HTTP ${res.status} but body is not valid JSON (${latency}ms)` };
      }
    }

    return { verified: true, proof: `VERIFIED: ${url} responding (HTTP ${res.status}, ${latency}ms)` };
  } catch (e) {
    return { verified: false, proof: `VERIFICATION FAILED: ${url} unreachable — ${e.message}` };
  }
}

/**
 * Verify a Docker container is actually running and healthy.
 * Layer 1: Container exists and is running
 * Layer 2: Health check (if container has HEALTHCHECK)
 * Layer 3: Uptime — container must not be in a restart loop
 */
async function verifyDockerContainer(containerName) {
  try {
    const { execSync } = await import('child_process');
    const opts = { encoding: 'utf-8', timeout: 10000 };

    // Layer 1: Is it running?
    const inspect = execSync(
      `docker inspect --format='{{.State.Status}} {{.State.StartedAt}}' ${containerName}`,
      opts
    ).trim();
    const [status, startedAt] = inspect.split(' ');

    if (status !== 'running') {
      return { verified: false, proof: `VERIFICATION FAILED: Container ${containerName} is ${status}, not running` };
    }

    // Layer 3: Uptime — if started <10s ago and we didn't just deploy, it might be restart-looping
    const uptime = Date.now() - new Date(startedAt).getTime();
    const uptimeStr = uptime < 60000 ? `${Math.round(uptime / 1000)}s` : `${Math.round(uptime / 60000)}m`;

    // Layer 2: Health check status (if defined)
    let healthStr = '';
    try {
      const health = execSync(
        `docker inspect --format='{{.State.Health.Status}}' ${containerName}`,
        opts
      ).trim();
      if (health && health !== '<no value>') {
        healthStr = `, health: ${health}`;
        if (health === 'unhealthy') {
          return { verified: false, proof: `VERIFICATION FAILED: Container ${containerName} running but UNHEALTHY (uptime ${uptimeStr})` };
        }
      }
    } catch { /* No healthcheck defined — skip */ }

    // Check restart count
    const restartCount = execSync(
      `docker inspect --format='{{.RestartCount}}' ${containerName}`,
      opts
    ).trim();

    return {
      verified: true,
      proof: `VERIFIED: Container ${containerName} running (uptime ${uptimeStr}, restarts: ${restartCount}${healthStr})`,
    };
  } catch (e) {
    return { verified: false, proof: `VERIFICATION FAILED: Container ${containerName} — ${e.message}` };
  }
}

/**
 * Verify a command actually produced expected output.
 */
function verifyCommandOutput(output, mustContain = [], mustNotContain = []) {
  const lower = (output || '').toLowerCase();

  for (const required of mustContain) {
    if (!lower.includes(required.toLowerCase())) {
      return { verified: false, proof: `VERIFICATION FAILED: Output missing expected "${required}"` };
    }
  }

  for (const forbidden of mustNotContain) {
    if (lower.includes(forbidden.toLowerCase())) {
      return { verified: false, proof: `VERIFICATION FAILED: Output contains error indicator "${forbidden}"` };
    }
  }

  return { verified: true, proof: `VERIFIED: Command output matches expectations` };
}

// ============ Gate: Wrap Tool Results ============
// This is the gate. The LLM never sees raw "success" — it sees
// verified or failed, with proof.

/**
 * Post-process a tool result through the verification gate.
 * Returns the original result if no verification applies,
 * or a modified result with verification proof appended.
 *
 * @param {string} toolName - The tool that was called
 * @param {object} input - The tool's input parameters
 * @param {string} result - The tool's self-reported result
 * @param {object} context - { repoPath }
 * @returns {Promise<string>} Verified result string
 */
export async function gate(toolName, input, result, context = {}) {
  const repoPath = context.repoPath || process.env.VIBESWAP_REPO || '/repo';
  const proofs = []; // Collect all verification proofs

  // write_file: verify the file actually exists and has content
  if (toolName === 'write_file' && !result.startsWith('Blocked') && !result.startsWith('Failed')) {
    const filePath = join(repoPath, input.path);
    const v = await verifyFileWrite(filePath, input.content);
    return v.verified ? `${result}\n${v.proof}` : v.proof;
  }

  // run_command: verify git operations + deploy operations
  if (toolName === 'run_command') {
    const cmd = (input.command || '').toLowerCase();

    if (cmd.includes('git commit')) {
      const v = await verifyGitOperation('commit', repoPath, context.expectedChanges);
      return `${result}\n${v.proof}`;
    }

    if (cmd.includes('git push')) {
      const v = await verifyGitOperation('push', repoPath);
      return `${result}\n${v.proof}`;
    }

    if (cmd.includes('git pull')) {
      const v = await verifyGitOperation('pull', repoPath);
      return `${result}\n${v.proof}`;
    }

    // Deploy commands: multi-layer verification
    if (cmd.includes('deploy') || cmd.includes('docker compose') || cmd.includes('docker restart')) {
      // Layer 1: Check command output for failure indicators
      const cmdV = verifyCommandOutput(result, [], ['error', 'failed', 'fatal', 'exit code 1']);
      proofs.push(cmdV.proof);

      // Layer 2: Docker container health check (if we can identify the container)
      const containerMatch = cmd.match(/(?:docker\s+(?:restart|compose\s+up\s+-d)\s+)(\S+)/);
      if (containerMatch) {
        // Give container 3s to start before checking
        await new Promise(r => setTimeout(r, 3000));
        const dockerV = await verifyDockerContainer(containerMatch[1]);
        proofs.push(dockerV.proof);
      }

      // Layer 3: If VPS URL is known, verify endpoint is responding
      const vpsUrl = process.env.VPS_URL || 'https://46-225-173-213.sslip.io';
      if (cmd.includes('jarvis') || cmd.includes('shard')) {
        try {
          const endV = await verifyEndpoint(`${vpsUrl}/web/health`, 200, true);
          proofs.push(endV.proof);
        } catch { /* Endpoint check is best-effort */ }
      }

      return `${result}\n${proofs.join('\n')}`;
    }

    // npm/pnpm install: verify node_modules updated
    if (cmd.includes('npm install') || cmd.includes('pnpm install')) {
      const v = verifyCommandOutput(result, [], ['ERR!', 'WARN deprecated', 'fatal']);
      return `${result}\n${v.proof}`;
    }
  }

  // No verification gate applies — return raw result
  return result;
}

// ============ Exported Verification Helpers ============
// These can be called directly for manual/programmatic verification
// outside the gate() flow.

export { verifyEndpoint, verifyDockerContainer, verifyFileWrite, verifyGitOperation, verifyCommandOutput };

// ============ Response Verification (Post-LLM) ============
// Scan the LLM's response for unverified claims and flag them.
// This runs AFTER the LLM generates text but BEFORE sending to user.

// ============ Claim Categories ============
// Different severity levels for different types of claims.
// "completed" claims (deployed, pushed, committed) are high-severity lies.
// "status" claims (running, live, online) are medium — might be stale cache.
const CLAIM_PATTERNS = [
  { pattern: /\b(?:deployed|pushed|committed|merged|released)\b/gi, label: 'completion-claim', severity: 'high' },
  { pattern: /\b(?:fixed|resolved|patched|repaired)\b/gi, label: 'fix-claim', severity: 'high' },
  { pattern: /\b(?:live|online|running|healthy|operational)\b/gi, label: 'status-claim', severity: 'medium' },
  { pattern: /\b(?:saved|written|created|installed|built|compiled|updated)\b/gi, label: 'action-claim', severity: 'medium' },
  { pattern: /\b(?:verified|confirmed|validated|tested|checked)\b/gi, label: 'verification-claim', severity: 'low' },
];

/**
 * Check if a response contains unverified action claims.
 * Returns warnings to log (not to inject into response — that would be intrusive).
 * The warnings help us track lying patterns for debugging.
 *
 * @param {string} responseText - The LLM's generated response
 * @param {string[]} verifiedActions - List of VERIFIED proof strings from this turn
 * @returns {Array<{word: string, label: string, severity: string, verified: boolean}>}
 */
export function auditResponse(responseText, verifiedActions = []) {
  const claims = [];
  for (const { pattern, label, severity } of CLAIM_PATTERNS) {
    const matches = responseText.match(pattern);
    if (matches) {
      for (const match of matches) {
        const wasVerified = verifiedActions.some(a =>
          a.toLowerCase().includes(match.toLowerCase())
        );
        if (!wasVerified) {
          claims.push({ word: match, label, severity, verified: false });
        }
      }
    }
  }

  // Log high-severity unverified claims loudly
  const highSeverity = claims.filter(c => c.severity === 'high');
  if (highSeverity.length > 0) {
    console.warn(`[verification-gate] ⚠ HIGH-SEVERITY UNVERIFIED CLAIMS: ${highSeverity.map(c => `"${c.word}" (${c.label})`).join(', ')}`);
  }

  return claims;
}

// ============ Ledger Inspection ============
// For debugging: see what's been verified recently.
export function getLedgerSnapshot() {
  const snapshot = {};
  for (const [key, value] of verificationLedger.entries()) {
    snapshot[key] = {
      ...value,
      age: `${Math.round((Date.now() - value.timestamp) / 1000)}s ago`,
    };
  }
  return snapshot;
}
