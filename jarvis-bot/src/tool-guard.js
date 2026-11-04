// ============ Tool guard: read_file and run_command (Will 2026-11-04) ============
// "only you can use those two tools, and secret files are blocked for everyone." Before this, a
// person in any chat who got the model to call read_file could read jarvis-bot/.env (it sits inside
// the repo the tool reads), and run_command ran with the bot's whole environment, which holds
// CLAUDE_CODE_API_SECRET (it unlocks /api/say and /api/email). The layers:
// 1. Owner only. claude.js offers the two tools on the owner's turns only (offeredTools), and both
//    refuse anyone else at execution, so a call that arrives anyway does nothing.
// 2. Secret files are refused for everyone, the owner included, on the real path (normalized, links
//    and junctions followed), so "../" or a link with an innocent name does not get around it.
// 3. run_command's child gets a small allowlisted environment, never the bot's keys and tokens, and
//    a command whose text names a secret path is refused.
// Pure (no config import): the owner id, repo path and environment are passed in.

import * as fs from 'fs';
import { readFile } from 'fs/promises';
import { execSync } from 'child_process';
import { resolve, dirname, basename, join, relative, isAbsolute } from 'path';

// ============ 1. Owner only ============
export const OWNER_ONLY_TOOLS = ['read_file', 'run_command'];

export function isOwner(userId, ownerUserId) {
  const id = String(userId ?? '');
  return id !== '' && id === String(ownerUserId ?? '');
}

// The tools offered to the model this turn: anyone but the owner does not see the two.
export function offeredTools(tools, userId, ownerUserId) {
  return isOwner(userId, ownerUserId) ? tools : tools.filter(t => !OWNER_ONLY_TOOLS.includes(t.name));
}

const ownerOnly = (tool) => `Refused: ${tool} is available to the owner only.`;

// ============ 2. Secret files, refused for everyone ============
const SECRET_DIRS = ['.ssh', '.gnupg'];                                   // everything under these
const SECRET_FILES = ['.netrc', '.npmrc', '.pypirc', '.git-credentials',  // credential stores
  '.master-key', 'mtproto-session.txt', 'wallet-encrypted.json'];         // the bot's key files in data/
const KEY_FILE = /^id_(rsa|dsa|ecdsa|ed25519)|\.(pem|key|p12|pfx|ppk)$/;  // id_rsa, cert.pem, key.pem
const ENV_FILE = /^\.env(\.|$)/;                                         // .env, .env.local, .env.example
// A data file named for a credential, token or secret (token.json, .credentials.json,
// client_secret.json). Code and docs about tokens (VibeSwapCanonicalToken.sol, TOKENOMICS.md) stay readable.
const SECRET_NAME = /credential|token|secret/;
const CODE_OR_DOC = /\.(c?js|mjs|jsx|tsx?|sol|rs|py|go|md|html|css)$/;

export const SECRET_REFUSAL = 'Refused: that is a secret file (.env, a key, a token or a credential). No chat tool opens it, for anyone.';

// A UNC path (\\host\share) is only read as text: touching it would make Windows contact the host.
const isUnc = (p) => /^[\\/]{2}/.test(p);

// The real path of p: normalized, links and junctions followed. A path that does not exist yet gets
// its deepest existing parent's real path with the rest appended.
export function realPath(p) {
  const full = resolve(p);
  if (isUnc(full)) return full;
  try { return fs.realpathSync.native(full); } catch {}
  const parent = dirname(full);
  return parent === full ? full : join(realPath(parent), basename(full));
}

export function isDeniedPath(p) {
  // Lowercased, since Windows names ignore case, with a trailing dot or ":stream" dropped, since
  // Windows opens ".env." and ".env::$DATA" as ".env".
  const parts = realPath(p).toLowerCase().split(/[\\/]+/).map(s => s.replace(/:.*$/, '').replace(/[. ]+$/, ''));
  const name = parts[parts.length - 1];
  return parts.some(s => SECRET_DIRS.includes(s)) || SECRET_FILES.includes(name) || KEY_FILE.test(name)
    || ENV_FILE.test(name) || (SECRET_NAME.test(name) && !CODE_OR_DOC.test(name));
}

// p is dir or inside it (path.relative ignores case on Windows).
function isInside(p, dir) {
  const r = relative(dir, p);
  return !isAbsolute(r) && r.split(/[\\/]/)[0] !== '..';
}

// What a command or file prints can still hold a secret no path check saw (grep -r over jarvis-bot
// reads .env). The values of the bot's secret variables are masked before the model sees the text.
const SECRET_VAR = /(KEY|TOKEN|SECRET|PASSWORD|HASH)S?$|WEBHOOK_URL$/i;
export function redactSecrets(text, env = process.env) {
  let out = String(text);
  for (const [name, value] of Object.entries(env)) {
    if (!SECRET_VAR.test(name) || !value) continue;
    for (const s of [String(value), ...String(value).split(',')].map(v => v.trim())) {
      if (s.length >= 8) out = out.split(s).join('[redacted]');
    }
  }
  return out;
}

// read_file: owner only, a file inside the repo, never a secret file. The checks run on the real
// path, and the real path is what gets read. Nothing outside the repo is touched.
export async function readFileTool(input, { userId, ownerUserId, repoPath, env = process.env }) {
  if (!isOwner(userId, ownerUserId)) return ownerOnly('read_file');
  const asked = resolve(repoPath, String(input?.path ?? ''));
  const real = isInside(asked, resolve(repoPath)) ? realPath(asked) : null;
  if (!real || !isInside(real, realPath(repoPath))) return 'Refused: read_file reads files inside the repository only.';
  if (isDeniedPath(real)) return SECRET_REFUSAL;
  try {
    const content = redactSecrets(await readFile(real, 'utf-8'), env);
    return content.length > 8000 ? content.slice(0, 8000) + `\n\n[... truncated, ${content.length} chars total]` : content;
  } catch (err) {
    return `Failed to read file: ${err.message}`;
  }
}

// ============ 3. run_command ============
// Only what node, git, npm, python and the shell need. Nothing else from the bot's environment
// reaches the child, so CLAUDE_CODE_API_SECRET, TELEGRAM_BOT_TOKEN and the provider keys never do.
// Windows variable names ignore case (Path, SystemRoot), so the match does too.
const CHILD_ENV = ['PATH', 'PATHEXT', 'SYSTEMROOT', 'WINDIR', 'COMSPEC', 'SYSTEMDRIVE', 'TEMP', 'TMP', 'TMPDIR',
  'HOME', 'USERPROFILE', 'HOMEDRIVE', 'HOMEPATH', 'APPDATA', 'LOCALAPPDATA'];

export function childEnv(env = process.env) {
  const out = {};
  for (const [name, value] of Object.entries(env)) if (CHILD_ENV.includes(name.toUpperCase())) out[name] = value;
  out.GIT_TERMINAL_PROMPT = '0';
  return out;
}

// Second layer: a command whose text names a secret path, resolved from its working directory (so
// "../jarvis-bot/.env", "HEAD:jarvis-bot/.env" and links count), or a glob matching one. A word counts
// as a path when it has a slash, a leading dot or an extension, or names something on disk, so "fix
// the refresh token" in a commit message does not. A path built inside a program (node -e) gets past
// any text check; the owner check, the scrubbed environment and redactSecrets cover that.
export function mentionsDeniedPath(command, cwd) {
  for (const word of String(command).split(/[\s"'=,:<>()]+/)) {
    const full = resolve(cwd, word);
    if (!word || !(/[\\/]|^\.|\.[a-z]/i.test(word) || (!isUnc(full) && fs.existsSync(full)))) continue;
    const matches = /[*?[]/.test(word) && fs.globSync && !isUnc(full) ? fs.globSync(word, { cwd }) : [word];
    if (matches.some(m => isDeniedPath(resolve(cwd, m)))) return true;
  }
  return false;
}

// BOT-101 (moved here from claude.js unchanged): an allowlist of command prefixes, no shell chaining.
const ALLOWED_PREFIXES = [
  'git ', 'git\t', 'forge ', 'npm ', 'npx ', 'node ', 'python ', 'pip ',
  'ls ', 'ls\t', 'dir ', 'cat ', 'head ', 'tail ', 'wc ', 'find ',
  'grep ', 'rg ', 'echo ', 'pwd', 'which ', 'date', 'uptime',
];

export function runCommandTool(input, { userId, ownerUserId, repoPath, env = process.env }) {
  if (!isOwner(userId, ownerUserId)) return ownerOnly('run_command');
  const cmd = String(input?.command ?? '').trim();
  const isAllowed = ALLOWED_PREFIXES.some(p => cmd.startsWith(p)) || cmd === 'ls' || cmd === 'pwd' || cmd === 'date' || cmd === 'uptime';
  if (!isAllowed) return 'Blocked: only repository-related commands are allowed (git, forge, npm, node, python, ls, grep, etc).';
  if (/[;&|`$]|\bsudo\b/.test(cmd)) return 'Blocked: shell operators (;, &, |, `, $) and sudo are not allowed.';
  const cwd = input?.cwd ? resolve(repoPath, String(input.cwd)) : repoPath;
  if (isDeniedPath(cwd) || mentionsDeniedPath(cmd, cwd)) return SECRET_REFUSAL;
  try {
    const output = redactSecrets(execSync(cmd, {
      cwd, timeout: 60000, encoding: 'utf-8', maxBuffer: 1024 * 1024, env: childEnv(env),
    }), env);
    return output.length > 4000 ? output.slice(0, 4000) + `\n\n[... truncated, ${output.length} chars total]` : output || '(no output)';
  } catch (err) {
    return redactSecrets(`Command failed: ${err.stderr || err.message || String(err)}`, env).slice(0, 2000);
  }
}
