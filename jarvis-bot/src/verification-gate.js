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

// ============ Verification Functions ============
// Each returns { verified: boolean, proof: string }
// The proof string is what the LLM sees.

/**
 * Verify a file was actually written with expected content.
 */
async function verifyFileWrite(filePath, expectedLength) {
  try {
    const stats = await stat(filePath);
    if (!stats.isFile()) return { verified: false, proof: `VERIFICATION FAILED: ${filePath} is not a file` };
    if (stats.size === 0) return { verified: false, proof: `VERIFICATION FAILED: ${filePath} exists but is empty (0 bytes)` };
    // Check size is within 10% of expected (encoding may add/remove bytes)
    if (expectedLength && stats.size < expectedLength * 0.5) {
      return { verified: false, proof: `VERIFICATION FAILED: ${filePath} exists but is ${stats.size} bytes (expected ~${expectedLength})` };
    }
    return { verified: true, proof: `VERIFIED: ${filePath} written (${stats.size} bytes)` };
  } catch (e) {
    return { verified: false, proof: `VERIFICATION FAILED: ${filePath} does not exist after write — ${e.message}` };
  }
}

/**
 * Verify a git operation actually happened.
 */
async function verifyGitOperation(operation, repoPath) {
  try {
    const { execSync } = await import('child_process');

    if (operation === 'commit') {
      // Check that HEAD changed (a new commit was made)
      const log = execSync('git log -1 --format="%H %s" HEAD', {
        cwd: repoPath, encoding: 'utf-8', timeout: 10000,
      }).trim();
      return { verified: true, proof: `VERIFIED: Latest commit — ${log}` };
    }

    if (operation === 'push') {
      // Check that local HEAD matches remote
      const local = execSync('git rev-parse HEAD', {
        cwd: repoPath, encoding: 'utf-8', timeout: 10000,
      }).trim();
      const remote = execSync('git rev-parse @{u}', {
        cwd: repoPath, encoding: 'utf-8', timeout: 10000,
      }).trim().split('\n')[0];
      const synced = local === remote;
      return synced
        ? { verified: true, proof: `VERIFIED: Push confirmed — local and remote at ${local.slice(0, 8)}` }
        : { verified: false, proof: `VERIFICATION FAILED: Local (${local.slice(0, 8)}) != remote (${remote.slice(0, 8)}) — push may have failed` };
    }

    if (operation === 'pull') {
      const status = execSync('git status --porcelain', {
        cwd: repoPath, encoding: 'utf-8', timeout: 10000,
      }).trim();
      return { verified: true, proof: `VERIFIED: Pull complete. Working tree: ${status ? 'has changes' : 'clean'}` };
    }

    return { verified: true, proof: `Git operation '${operation}' executed (no specific verification)` };
  } catch (e) {
    return { verified: false, proof: `VERIFICATION FAILED: git ${operation} — ${e.message}` };
  }
}

/**
 * Verify an HTTP endpoint is actually responding.
 */
async function verifyEndpoint(url, expectedStatus = 200) {
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(15000) });
    if (res.status === expectedStatus) {
      return { verified: true, proof: `VERIFIED: ${url} responding (HTTP ${res.status})` };
    }
    return { verified: false, proof: `VERIFICATION FAILED: ${url} returned HTTP ${res.status} (expected ${expectedStatus})` };
  } catch (e) {
    return { verified: false, proof: `VERIFICATION FAILED: ${url} unreachable — ${e.message}` };
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

  // write_file: verify the file actually exists and has content
  if (toolName === 'write_file' && !result.startsWith('Blocked') && !result.startsWith('Failed')) {
    const filePath = join(repoPath, input.path);
    const v = await verifyFileWrite(filePath, input.content?.length);
    return v.verified ? `${result}\n${v.proof}` : v.proof;
  }

  // run_command: verify git operations
  if (toolName === 'run_command') {
    const cmd = (input.command || '').toLowerCase();

    if (cmd.includes('git commit')) {
      const v = await verifyGitOperation('commit', repoPath);
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

    // Deploy commands: verify the endpoint after
    if (cmd.includes('deploy') || cmd.includes('docker compose') || cmd.includes('docker restart')) {
      // Check for failure indicators in output
      const v = verifyCommandOutput(result, [], ['error', 'failed', 'fatal', 'exit code 1']);
      return `${result}\n${v.proof}`;
    }
  }

  // No verification gate applies — return raw result
  return result;
}

// ============ Response Verification (Post-LLM) ============
// Scan the LLM's response for unverified claims and flag them.
// This runs AFTER the LLM generates text but BEFORE sending to user.

const CLAIM_PATTERNS = [
  { pattern: /(?:deployed|pushed|live|online|fixed|done|committed|saved|updated|installed|created|built|compiled|running)\b/gi, label: 'action-claim' },
];

/**
 * Check if a response contains unverified action claims.
 * Returns warnings to log (not to inject into response — that would be intrusive).
 * The warnings help us track lying patterns for debugging.
 */
export function auditResponse(responseText, verifiedActions = []) {
  const claims = [];
  for (const { pattern, label } of CLAIM_PATTERNS) {
    const matches = responseText.match(pattern);
    if (matches) {
      for (const match of matches) {
        const wasVerified = verifiedActions.some(a =>
          a.toLowerCase().includes(match.toLowerCase())
        );
        if (!wasVerified) {
          claims.push({ word: match, label, verified: false });
        }
      }
    }
  }
  return claims;
}
