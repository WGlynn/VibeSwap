// Tests for the 2026-11-04 tool guard (src/tool-guard.js). The chat model's read_file and run_command
// had no owner check: anyone in any chat who got the model to call them could read jarvis-bot/.env
// (it sits inside the repo the tool reads) or run a command with the bot's whole environment,
// CLAUDE_CODE_API_SECRET included. Will: "only you can use those two tools, and secret files are
// blocked for everyone." A temp dir stands in for the repo, and every secret in it is a fake.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'fs';
import { mkdtempSync, mkdirSync, writeFileSync, symlinkSync, rmSync, readFileSync, existsSync } from 'fs';
import { tmpdir } from 'os';
import { join, dirname } from 'path';
import {
  OWNER_ONLY_TOOLS, offeredTools, readFileTool, runCommandTool, isDeniedPath, mentionsDeniedPath,
  childEnv, redactSecrets, SECRET_REFUSAL,
} from '../src/tool-guard.js';

const src = (f) => readFileSync(new URL(`../src/${f}`, import.meta.url), 'utf-8');
const OWNER = 1002;
const STRANGER = 1001;
const OUTSIDE = 'Refused: read_file reads files inside the repository only.';

// The stand-in repo. repo/notes is a junction to a .ssh dir inside it, and repo/elsewhere-link one to
// a plain dir outside it: innocent names, real paths that are refused. A junction needs no admin
// rights on Windows; a file symlink does.
const root = mkdtempSync(join(tmpdir(), 'tool-guard-'));
const repo = join(root, 'repo');
const put = (p, text) => { mkdirSync(dirname(p), { recursive: true }); writeFileSync(p, text); };
put(join(repo, 'README.md'), 'VibeSwap readme\n');
put(join(repo, 'docs', 'TOKENOMICS.md'), 'three tokens\n');
put(join(repo, 'logs.txt'), 'boot with fake-api-secret-0001\n');
put(join(repo, 'jarvis-bot', '.env'), 'CLAUDE_CODE_API_SECRET=fake-api-secret-0001\n');
put(join(repo, 'jarvis-bot', '.env.local'), 'X=1\n');
put(join(repo, 'jarvis-bot', 'key.pem'), 'fake key\n');
put(join(repo, 'jarvis-bot', 'data', '.master-key'), 'ab'.repeat(32));
put(join(root, 'outside.txt'), 'outside\n');
put(join(repo, 'vault', '.ssh', 'config'), 'Host fake\n');
put(join(root, 'elsewhere', 'plain.txt'), 'plain\n');
symlinkSync(join(repo, 'vault', '.ssh'), join(repo, 'notes'), 'junction');
symlinkSync(join(root, 'elsewhere'), join(repo, 'elsewhere-link'), 'junction');
let fileLink = true;
try { symlinkSync(join(repo, 'jarvis-bot', '.env'), join(repo, 'readme-link.md'), 'file'); } catch { fileLink = false; }
after(() => rmSync(root, { recursive: true, force: true }));

const as = (userId, extra = {}) => ({ userId, ownerUserId: OWNER, repoPath: repo, ...extra });
const FAKE_SECRETS = {
  CLAUDE_CODE_API_SECRET: 'fake-api-secret-0001', TELEGRAM_BOT_TOKEN: '123:fake-bot-token', GEMINI_API_KEY: 'fake-gemini-key-0001',
  GEMINI_API_KEYS: 'fake-gemini-key-0002,fake-gemini-key-0003', GROQ_API_KEY: 'fake-groq-key-0001',
  OPENROUTER_API_KEY: 'fake-openrouter-key-01', ANTHROPIC_API_KEY: 'fake-anthropic-key-01', GMAIL_APP_PASSWORD: 'fake gmail app pass',
  TG_API_HASH: 'fake-tg-api-hash-01', SHARD_SECRET: 'fake-shard-secret-01', GITHUB_TOKEN: 'fake-github-token-01',
  JARVIS_MASTER_KEY: 'fake-master-key-0001',
};

test('G1 anyone but the owner is not offered read_file or run_command', () => {
  const tools = ['web_search', 'read_file', 'write_file', 'run_command', 'learn_fact'].map(name => ({ name }));
  const names = (userId, ownerUserId = OWNER) => offeredTools(tools, userId, ownerUserId).map(t => t.name);
  assert.deepEqual(OWNER_ONLY_TOOLS, ['read_file', 'run_command']);
  assert.deepEqual(names(OWNER), ['web_search', 'read_file', 'write_file', 'run_command', 'learn_fact']);
  assert.deepEqual(names(String(OWNER)), names(OWNER)); // a Telegram id may arrive as a number or a string
  // A stranger, an internal caller with no id, and a group id all get neither tool.
  for (const who of [STRANGER, undefined, null, '', -1001234]) {
    assert.deepEqual(names(who), ['web_search', 'write_file', 'learn_fact'], `userId ${who}`);
  }
  assert.deepEqual(names(undefined, undefined), ['web_search', 'write_file', 'learn_fact']); // no owner set: nobody
});

test('G2 a call that arrives anyway is refused for anyone but the owner, and nothing runs', async () => {
  for (const who of [STRANGER, undefined]) {
    assert.equal(await readFileTool({ path: 'README.md' }, as(who)), 'Refused: read_file is available to the owner only.');
    assert.equal(runCommandTool({ command: `node -e "require('fs').writeFileSync('ran.txt', 'x')"` }, as(who)),
      'Refused: run_command is available to the owner only.');
  }
  assert.equal(existsSync(join(repo, 'ran.txt')), false);
});

test('G3 the owner reads a normal file, docs about tokens included', async () => {
  assert.equal(await readFileTool({ path: 'README.md' }, as(OWNER)), 'VibeSwap readme\n');
  assert.equal(await readFileTool({ path: 'docs/TOKENOMICS.md' }, as(OWNER)), 'three tokens\n');
  assert.equal(await readFileTool({ path: join(repo, 'README.md') }, as(OWNER)), 'VibeSwap readme\n'); // absolute, inside
});

test('G4 .env and the other secret files are refused for the owner too, ../ included', async () => {
  const asked = ['jarvis-bot/.env', 'jarvis-bot/.ENV', 'jarvis-bot/.env.local', 'jarvis-bot/key.pem',
    'jarvis-bot/data/.master-key', 'docs/../jarvis-bot/.env', './jarvis-bot/./.env', join(repo, 'jarvis-bot', '.env')];
  // Windows opens these as the file itself: a trailing dot (realpath keeps it), the default data
  // stream, a backslash path.
  if (process.platform === 'win32') {
    asked.push('jarvis-bot/.env.', 'jarvis-bot/key.pem.', 'jarvis-bot/.env::$DATA', 'jarvis-bot/data/.master-key::$DATA', 'jarvis-bot\\.env');
  }
  for (const path of asked) assert.equal(await readFileTool({ path }, as(OWNER)), SECRET_REFUSAL, path);
  // Outside the repo is refused before anything there is touched.
  for (const path of ['../outside.txt', join(root, 'outside.txt'), 'docs/../../outside.txt']) {
    assert.equal(await readFileTool({ path }, as(OWNER)), OUTSIDE, path);
  }
});

test('G5 a junction with an innocent name is checked on its real path', async () => {
  assert.equal(await readFileTool({ path: 'notes/config' }, as(OWNER)), SECRET_REFUSAL); // notes -> a .ssh dir
  assert.equal(await readFileTool({ path: 'elsewhere-link/plain.txt' }, as(OWNER)), OUTSIDE); // leaves the repo
});

test('G5b a file symlink to .env is refused', { skip: !fileLink && 'file symlinks need admin rights or developer mode here' }, async () => {
  assert.equal(await readFileTool({ path: 'readme-link.md' }, as(OWNER)), SECRET_REFUSAL);
});

test('G6 the denylist: keys, tokens, credentials and .env anywhere; code and docs about tokens stay open', () => {
  const home = join(root, 'home');
  for (const p of [
    join(home, '.claude', '.credentials.json'), join(home, '.ssh', 'id_rsa'), join(home, 'keys', 'id_ed25519.pub'),
    join(home, '.ssh', 'known_hosts'), join(home, '.gnupg', 'pubring.kbx'), join(home, '.aws', 'credentials'),
    join(home, '.npmrc'), join(home, '.netrc'), join(repo, 'client_secret_123.apps.json'), join(repo, 'gmail-token.json'),
    join(repo, 'jarvis-bot', 'data', 'mtproto-session.txt'), join(repo, 'jarvis-bot', 'data', 'wallet-encrypted.json'),
    join(repo, 'cert.p12'), join(repo, 'putty.ppk'), join(repo, 'api.key'), join(repo, 'frontend', '.env.production'),
  ]) assert.equal(isDeniedPath(p), true, p);
  for (const p of [
    join(repo, 'contracts', 'VibeSwapCanonicalToken.sol'), join(repo, 'docs', 'THREE_TOKEN_ECONOMY.md'),
    join(repo, 'frontend', 'src', 'tokens.js'), join(repo, 'cogproof', 'src', 'credentials', 'credential-registry.js'),
    join(repo, 'jarvis-bot', 'src', 'config.js'), join(repo, 'package.json'), join(repo, 'docs', 'environment.md'),
  ]) assert.equal(isDeniedPath(p), false, p);
});

test('G7 run_command refuses a command or working directory naming a secret path, the owner included', () => {
  const refused = ['cat jarvis-bot/.env', 'cat ../repo/jarvis-bot/.env', 'git show HEAD:jarvis-bot/.env',
    'grep -n SECRET jarvis-bot/.ENV', 'cat "jarvis-bot/data/.master-key"', 'head -1 jarvis-bot/key.pem', 'cat notes/config'];
  if (fs.globSync) refused.push('cat jarvis-bot/.e*', 'cat jarvis-bot/*.pem'); // globs are expanded where Node can (22+)
  for (const command of refused) assert.equal(runCommandTool({ command }, as(OWNER)), SECRET_REFUSAL, command);
  assert.equal(runCommandTool({ command: 'ls', cwd: 'notes' }, as(OWNER)), SECRET_REFUSAL); // cwd inside a .ssh dir
  // Words that only talk about tokens are not paths.
  for (const command of ['git commit -m "fix the refresh token."', 'grep -rn token src', 'npm install jsonwebtoken@9.0.0',
    'node -e "console.log(process.env.PATH)"']) assert.equal(mentionsDeniedPath(command, repo), false, command);
});

test('G8 the run_command child gets PATH and the system dirs, none of the bot\'s secrets', () => {
  const env = { ...process.env, ...FAKE_SECRETS };
  const child = childEnv(env);
  for (const name of Object.keys(FAKE_SECRETS)) assert.equal(child[name], undefined, name);
  assert.ok(Object.keys(child).some(k => k.toUpperCase() === 'PATH'));
  assert.equal(child.GIT_TERMINAL_PROMPT, '0');
  // A real child: the owner runs node through run_command, and it sees none of them.
  const out = runCommandTool({ command: `node -e "console.log(Object.keys(process.env).join(' '))"` }, as(OWNER, { env }));
  const seen = out.trim().split(/\s+/).map(k => k.toUpperCase());
  assert.ok(seen.includes('PATH'), out);
  for (const name of Object.keys(FAKE_SECRETS)) assert.equal(seen.includes(name), false, name);
});

test('G9 a secret value that reaches the output anyway is masked', async () => {
  const env = { ...process.env, ...FAKE_SECRETS, VIBESWAP_REPO: 'C:/Users/fake/vibeswap', SHORT_KEY: 'abc' };
  assert.equal(redactSecrets('a fake-api-secret-0001 b fake-gemini-key-0003 c C:/Users/fake/vibeswap abc', env),
    'a [redacted] b [redacted] c C:/Users/fake/vibeswap abc');
  assert.equal(await readFileTool({ path: 'logs.txt' }, as(OWNER, { env })), 'boot with [redacted]\n');
  // A path built inside a program gets past the text check; the value it prints is still masked.
  const out = runCommandTool({ command: `node -e "process.stdout.write(require('fs').readFileSync('jarvis-bot/.e' + 'nv', 'utf8'))"` },
    as(OWNER, { env }));
  assert.equal(out, 'CLAUDE_CODE_API_SECRET=[redacted]\n');
});

test('G10 claude.js offers the two tools through offeredTools and runs them only through the guard', () => {
  const c = src('claude.js');
  assert.match(c, /const tools = isLightContext \? \[\] : offeredTools\(selectTools\(messageText, allTools\), userId, config\.ownerUserId\);/);
  assert.match(c, /result = await readFileTool\(tb\.input, \{ userId, ownerUserId: config\.ownerUserId, repoPath: REPO_PATH \}\);/);
  assert.match(c, /result = runCommandTool\(tb\.input, \{ userId, ownerUserId: config\.ownerUserId, repoPath: REPO_PATH \}\);/);
  assert.doesNotMatch(c, /execSync\(cmd/); // the old run_command, which handed the child process.env
  assert.match(c, /if \(isDeniedPath\(fullPath\)\) return SECRET_REFUSAL;/); // the /idea code-gen read_file
  assert.match(c, /Failed to\|Refused\)\/i\.test\(String\(result\)\)/); // a refusal backs no claim
});
