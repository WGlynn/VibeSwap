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
  OWNER_ONLY_TOOLS, offeredTools, readFileTool, runCommandTool, writeFileTool, editFileTool, isDeniedPath, mentionsDeniedPath,
  childEnv, redactSecrets, SECRET_REFUSAL, OUTSIDE_WRITE_REFUSAL, GIT_DIR_REFUSAL, changedAmong,
  repoTarget, clonedFilePath, REPO_URL_REFUSAL, GIT_HOSTS,
} from '../src/tool-guard.js';

// Source files carry CRLF or LF depending on the editor that last touched them; the assertions see LF.
const src = (f) => readFileSync(new URL(`../src/${f}`, import.meta.url), 'utf-8').replace(/\r\n/g, '\n');
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

test('G1 anyone but the owner is not offered read_file, run_command, write_file or edit_file', () => {
  const tools = ['web_search', 'read_file', 'write_file', 'edit_file', 'run_command', 'learn_fact'].map(name => ({ name }));
  const names = (userId, ownerUserId = OWNER) => offeredTools(tools, userId, ownerUserId).map(t => t.name);
  assert.deepEqual(OWNER_ONLY_TOOLS, ['read_file', 'run_command', 'write_file', 'edit_file']);
  assert.deepEqual(names(OWNER), ['web_search', 'read_file', 'write_file', 'edit_file', 'run_command', 'learn_fact']);
  assert.deepEqual(names(String(OWNER)), names(OWNER)); // a Telegram id may arrive as a number or a string
  // A stranger, an internal caller with no id, and a group id all get none of the four.
  for (const who of [STRANGER, undefined, null, '', -1001234]) {
    assert.deepEqual(names(who), ['web_search', 'learn_fact'], `userId ${who}`);
  }
  assert.deepEqual(names(undefined, undefined), ['web_search', 'learn_fact']); // no owner set: nobody
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

// ============ write_file and edit_file (second pass, 2026-11-04) ============
// Before: write_file had no owner check and a prefix check that followed no link, so anyone in any
// chat who got the model to call it could write any path the prefix matched, and the auto-commit
// then ran git add -A and pushed the whole working tree.

test('G11 anyone but the owner is refused by write_file and edit_file, and nothing is written', async () => {
  for (const who of [STRANGER, undefined, '']) {
    const written = [];
    assert.equal(await writeFileTool({ path: 'docs/stranger.md', content: 'x' }, as(who, { written })), 'Refused: write_file is available to the owner only.');
    assert.equal(await editFileTool({ path: 'README.md', old_string: 'readme', new_string: 'x' }, as(who, { written })), 'Refused: edit_file is available to the owner only.');
    assert.deepEqual(written, []);
  }
  assert.equal(existsSync(join(repo, 'docs', 'stranger.md')), false);
  assert.equal(readFileSync(join(repo, 'README.md'), 'utf-8'), 'VibeSwap readme\n');
});

test('G12 the owner writes inside the repo; the written list gets the repo-relative path, new directories included', async () => {
  const written = [];
  assert.equal(await writeFileTool({ path: 'docs/ideas/new-idea.md', content: 'draft' }, as(OWNER, { written })), 'Wrote 5 chars to docs/ideas/new-idea.md');
  assert.equal(readFileSync(join(repo, 'docs', 'ideas', 'new-idea.md'), 'utf-8'), 'draft');
  assert.equal(await writeFileTool({ path: join(repo, 'docs', 'abs.md'), content: 'absolute, inside' }, as(OWNER, { written })), 'Wrote 16 chars to docs/abs.md');
  assert.equal(await writeFileTool({ path: 'docs\\back.md', content: 'x' }, as(OWNER, { written })), 'Wrote 1 chars to docs/back.md');
  assert.equal(await editFileTool({ path: 'README.md', old_string: 'readme', new_string: 'guide' }, as(OWNER, { written })), 'Edited README.md: replaced 6 chars with 5 chars');
  assert.equal(readFileSync(join(repo, 'README.md'), 'utf-8'), 'VibeSwap guide\n');
  assert.equal(await editFileTool({ path: 'README.md', old_string: 'guide', new_string: 'a$&b' }, as(OWNER, { written })), 'Edited README.md: replaced 5 chars with 4 chars');
  assert.equal(readFileSync(join(repo, 'README.md'), 'utf-8'), 'VibeSwap a$&b\n'); // "$&" stays literal
  assert.deepEqual(written, ['docs/ideas/new-idea.md', 'docs/abs.md', 'docs/back.md', 'README.md', 'README.md']);
  // edit_file's own refusals, none of which touch the list.
  const untouched = [];
  assert.equal(await editFileTool({ path: 'README.md', old_string: 'nope', new_string: 'x' }, as(OWNER, { written: untouched })), 'old_string not found in README.md. Read the file first to get the exact text.');
  assert.equal(await editFileTool({ path: 'README.md', old_string: 'b', new_string: 'x' }, as(OWNER, { written: untouched })), 'old_string found 2 times in README.md. Provide more context to make it unique.');
  assert.equal(await editFileTool({ path: 'README.md', old_string: '', new_string: 'x' }, as(OWNER, { written: untouched })), 'old_string is required.');
  assert.equal(await editFileTool({ path: 'docs/missing.md', old_string: 'a', new_string: 'x' }, as(OWNER, { written: untouched })), 'File not found: docs/missing.md');
  assert.deepEqual(untouched, []);
});

test('G13 outside the repo, a secret file, a junction out, the base itself and .git are refused for the owner too', async () => {
  const written = [];
  const tryWrite = (path) => writeFileTool({ path, content: 'x' }, as(OWNER, { written }));
  const tryEdit = (path) => editFileTool({ path, old_string: 'a', new_string: 'b' }, as(OWNER, { written }));
  for (const path of ['../outside.txt', join(root, 'outside.txt'), 'docs/../../outside.txt', 'elsewhere-link/plain.txt', '', '.', 'docs/..', join(root, 'elsewhere', 'x.txt')]) {
    assert.equal(await tryWrite(path), OUTSIDE_WRITE_REFUSAL, path);
    assert.equal(await tryEdit(path), OUTSIDE_WRITE_REFUSAL, path);
  }
  for (const path of ['jarvis-bot/.env', 'jarvis-bot/.env.production', 'jarvis-bot/new.pem', 'jarvis-bot/data/.master-key', 'notes/config',
    'jarvis-bot/token.json', 'frontend/.credentials.json', 'docs/../jarvis-bot/.env', 'vault/.ssh/id_ed25519']) {
    assert.equal(await tryWrite(path), SECRET_REFUSAL, path);
    assert.equal(await tryEdit(path), SECRET_REFUSAL, path);
  }
  for (const path of ['.git/hooks/pre-commit', '.git/config', 'sub/.git/hooks/post-checkout', '.GIT/config']) {
    assert.equal(await tryWrite(path), GIT_DIR_REFUSAL, path);
    assert.equal(await tryEdit(path), GIT_DIR_REFUSAL, path);
  }
  assert.deepEqual(written, []);
  assert.equal(readFileSync(join(repo, 'jarvis-bot', '.env'), 'utf-8'), 'CLAUDE_CODE_API_SECRET=fake-api-secret-0001\n');
  assert.equal(existsSync(join(root, 'outside.txt')) && readFileSync(join(root, 'outside.txt'), 'utf-8'), 'outside\n');
  assert.equal(existsSync(join(repo, '.git')), false);
  assert.equal(existsSync(join(root, 'elsewhere', 'x.txt')), false);
});

test('G14 the auto-commit stages the written files alone: changedAmong keeps only listed files git reports as changed', () => {
  const status = {
    modified: ['docs/a.md', 'jarvis-bot/.env'], not_added: ['docs/ideas/new.md', 'secret-notes.txt'], created: ['docs/c.md'],
    staged: ['docs/s.md'], renamed: [{ from: 'docs/old.md', to: 'docs/b.md' }],
  };
  assert.deepEqual(changedAmong(status, ['docs/a.md', 'docs/ideas/new.md', 'docs/untouched.md', 'docs/b.md', 'docs/c.md', 'docs/s.md', 'docs/nope.md']),
    ['docs/a.md', 'docs/ideas/new.md', 'docs/b.md', 'docs/c.md', 'docs/s.md']);
  assert.deepEqual(changedAmong(status, []), []); // nothing written: nothing staged, whatever else is dirty
  assert.deepEqual(changedAmong(status, ['docs/ideas']), []); // a directory is not a file
});

test('G15 claude.js, index.js and git.js are wired: the guard runs the writes, and every pipeline commit names its files', () => {
  const c = src('claude.js');
  assert.match(c, /import \{ offeredTools, readFileTool, runCommandTool, writeFileTool, editFileTool, isDeniedPath, SECRET_REFUSAL, repoTarget, clonedFilePath, childEnv \} from '\.\/tool-guard\.js';/);
  // The chat tool loop: the guard, with the list the auto-commit stages; no inline write is left.
  assert.match(c, /result = await writeFileTool\(tb\.input, \{ userId, ownerUserId: config\.ownerUserId, repoPath: REPO_PATH, written: filesWrittenInLoop \}\);/);
  assert.doesNotMatch(c, /filesWrittenInLoop\.push\(/);
  assert.doesNotMatch(c, /resolved\.startsWith\(repoResolved\)/);
  assert.match(c, /const pushResult = await gitCommitAndPush\(commitMsg, filesWrittenInLoop\);/);
  // The /idea and /code pipeline: the same guard, the tools offered through offeredTools, the model's path never written directly.
  assert.match(c, /if \(toolName === 'write_file'\) return await writeFileTool\(input, guard\);\n\s+if \(toolName === 'edit_file'\) return await editFileTool\(input, guard\);/);
  assert.match(c, /const guard = \{ userId, ownerUserId: config\.ownerUserId, repoPath: REPO_PATH, written: filesWritten \};\n\s+const tools = offeredTools\(CODE_GEN_TOOLS, userId, config\.ownerUserId\);/);
  assert.match(c, /const result = await handleCodeGenTool\(tb\.name, tb\.input, guard\);/);
  assert.doesNotMatch(c, /filesWritten\.push\(/);
  const codegen = c.slice(c.indexOf('async function handleCodeGenTool('), c.indexOf('export async function codeGenChat('));
  assert.doesNotMatch(codegen, /writeFile\(/);
  // index.js: both pipelines pass the caller and commit the written files by name; the owner's /commit keeps the whole tree.
  const idx = src('index.js');
  assert.match(idx, /await codeGenChat\(ideaText, author, \{ userId: ctx\.from\.id \}\);/);
  assert.match(idx, /author,\n\s+\{ userId: ctx\.from\.id \}\n\s+\);/);
  assert.equal((idx.match(/gitCommitAndPushBranch\(commitMsg, branch, filesWritten\)/g) || []).length, 2);
  assert.equal((idx.match(/gitCommitAndPushBranch\(/g) || []).length, 2);
  assert.equal((idx.match(/await gitCommitAndPush\(message\);/g) || []).length, 2); // /commit and /gitcommit, authorized users, explicit
  // git.js: a list stages and commits those files, after "--"; -A survives only on the no-list path.
  const g = src('git.js');
  assert.match(g, /import \{ changedAmong \} from '\.\/tool-guard\.js';/);
  assert.match(g, /const toCommit = changedAmong\(status, files\);\n\s+if \(toCommit\.length === 0\) return false;\n.*\n\s+await git\.add\(\['--', \.\.\.toCommit\]\);\n\s+await git\.commit\(fullMessage, \['--', \.\.\.toCommit\]\);/);
  const staging = g.slice(g.indexOf('async function stageAndCommit('), g.indexOf('export async function gitCommitAndPush('));
  assert.match(staging, /if \(Array\.isArray\(files\)\) \{/);
  assert.equal((staging.match(/git\.add\('-A'\)/g) || []).length, 1); // the no-list branch only
  assert.match(g, /export async function gitCommitAndPush\(message, files\) \{/);
  assert.match(g, /export async function gitCommitAndPushBranch\(message, branch, files\) \{/);
});

// ============ fetch_repo (2026-11-04) ============
// Before: the files list accepted "../", the URL could name any host, and git ran with the bot's
// environment and the owner's credential helper.

test('G16 fetch_repo accepts an https URL of a public repository on a known host and nothing else', () => {
  assert.deepEqual(GIT_HOSTS, ['github.com', 'gitlab.com', 'bitbucket.org', 'codeberg.org']);
  const noesis = { url: 'https://github.com/WGlynn/noesis.git', host: 'github.com', owner: 'WGlynn', name: 'noesis' };
  for (const ok of ['https://github.com/WGlynn/noesis', 'https://github.com/WGlynn/noesis.git', 'https://github.com/WGlynn/noesis/', ' https://GitHub.com/WGlynn/noesis ']) {
    assert.deepEqual(repoTarget(ok), noesis, ok);
  }
  assert.deepEqual(repoTarget('https://gitlab.com/some-group/my.project'), { url: 'https://gitlab.com/some-group/my.project.git', host: 'gitlab.com', owner: 'some-group', name: 'my.project' });
  for (const bad of ['http://github.com/a/b', 'https://user:pw@github.com/a/b', 'https://user@github.com/a/b', 'https://github.com/a/b?x=1',
    'https://github.com/a/b#x', 'https://github.com/a', 'https://github.com/a/b/c', 'https://github.com/../b', 'https://github.com/a/..',
    'https://github.com/.a/b', 'https://github.com/a/-b', 'https://github.com/a/--upload-pack=x', 'https://github.com/a/b%2F..%2Fc',
    'https://github.com/a/b;rm', 'https://github.com/a/b c', 'https://evil.example/a/b', 'https://github.com.evil.example/a/b',
    'https://127.0.0.1/a/b', 'https://localhost/a/b', 'https://[::1]/a/b', 'https://github.com:8443/a/b'.replace(':8443', ':443') === 'https://github.com/a/b' ? 'ssh://git@github.com/a/b' : 'ssh://git@github.com/a/b',
    'git@github.com:a/b.git', 'file:///C:/Users/x', '', undefined, null, 42]) {
    assert.deepEqual(repoTarget(bad), { refused: REPO_URL_REFUSAL }, String(bad));
  }
  assert.match(REPO_URL_REFUSAL, /^Refused: /);
});

test('G17 a file from the clone is read on its real path inside it; outside, a secret file or .git is refused', () => {
  const clone = join(root, 'repo-cache', 'github.com', 'someone', 'thing');
  put(join(clone, 'README.md'), 'readme\n');
  put(join(clone, 'src', 'index.ts'), 'code\n');
  put(join(clone, '.git', 'config'), '[core]\n');
  put(join(clone, '.env'), 'X=fake\n');
  put(join(clone, 'deploy', 'key.pem'), 'fake key\n');
  symlinkSync(join(root, 'elsewhere'), join(clone, 'out'), 'junction');
  const real = (p) => fs.realpathSync.native(join(clone, p));
  assert.deepEqual(clonedFilePath('README.md', clone), { real: real('README.md'), rel: 'README.md' });
  assert.deepEqual(clonedFilePath('./src/../src/index.ts', clone), { real: real('src/index.ts'), rel: 'src/index.ts' });
  assert.deepEqual(clonedFilePath('src\\index.ts', clone), { real: real('src/index.ts'), rel: 'src/index.ts' });
  assert.deepEqual(clonedFilePath('missing.md', clone).rel, 'missing.md'); // read fails later as "not found"
  for (const [asked, why] of [['../../../outside.txt', 'outside the repository'], [join(root, 'outside.txt'), 'outside the repository'],
    ['', 'outside the repository'], ['.', 'outside the repository'], ['out/plain.txt', 'outside the repository'],
    ['.env', 'a secret file'], ['deploy/key.pem', 'a secret file'], ['src/../.env', 'a secret file'],
    ['.git/config', 'under .git'], ['.git/hooks/pre-commit', 'under .git'], ['.GIT/config', 'under .git']]) {
    assert.deepEqual(clonedFilePath(asked, clone), { refused: why }, asked);
  }
});

test('G18 claude.js clones through the allowlist with a scrubbed environment and no credential helper, and reads through clonedFilePath', () => {
  const c = src('claude.js');
  const block = c.slice(c.indexOf("} else if (tb.name === 'fetch_repo') {"), c.indexOf("} else if (tb.name === 'flag_deceiver') {"));
  assert.match(block, /const target = repoTarget\(tb\.input\?\.url\);\n\s+if \(target\.refused\) \{\n\s+result = target\.refused;/);
  assert.match(block, /const cacheDir = join\(REPO_PATH, '\.claude', 'repo-cache', target\.host, target\.owner\);\n\s+const tempDir = join\(cacheDir, target\.name\);/);
  assert.match(block, /env: childEnv\(process\.env\)/);
  assert.match(block, /execFileSync\('git', \['-c', 'credential\.helper=', 'pull', '--ff-only'\], \{ \.\.\.gitOpts, cwd: tempDir, timeout: 30000 \}\);/);
  assert.match(block, /execFileSync\('git', \['-c', 'credential\.helper=', 'clone', '--depth', '1', target\.url, tempDir\], \{ \.\.\.gitOpts, timeout: 60000 \}\);/);
  assert.match(block, /const file = clonedFilePath\(f, tempDir\);\n\s+if \(file\.refused\) \{/);
  assert.match(block, /await readFile\(file\.real, 'utf-8'\)/);
  assert.doesNotMatch(block, /join\(tempDir, f\)|\.\.\.process\.env|url\.split\('\/'\)\.pop\(\)/);
});
