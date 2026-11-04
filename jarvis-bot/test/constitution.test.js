// Tests for the code-enforced parts of the Jarvis Constitution (JARVIS/CONSTITUTION.md, 2026-11-01).
// They run in `npm test`, which gates every restart (scripts/restart-local.ps1): code that breaks
// an enforced article cannot be deployed. Case ids match the "Tested by" lines in the document.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, existsSync, mkdtempSync, writeFileSync, rmSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { spawnSync } from 'child_process';
import {
  parseConstitution, constitutionBlock, readConstitution, PRIVATE_SOURCES, RECENCY_RULE, RATIFIED_BRIEF, CONSTITUTION_PATH,
} from '../src/constitution.js';
import { gateFakeActions } from '../src/action-claims.js';
import { stripDashes } from '../src/text-style.js';
import { detectDirective } from '../src/directives.js';

const src = (f) => readFileSync(new URL(`../src/${f}`, import.meta.url), 'utf-8');

// ============ Article 11.3: an unratified draft never governs ============

test('A11 draft and "not ratified" status lines are not ratified', () => {
  for (const status of ['Status: draft, not yet ratified', 'Status: not ratified', '**Status:** draft', 'Status: proposed']) {
    assert.equal(parseConstitution(`Version: 0.1\n${status}\n`).ratified, false, status);
  }
});

test('A11 a ratified status line is recognized, plain or bold', () => {
  for (const status of ['Status: ratified 2026-11-02 by Will', '**Status:** ratified', 'Status : Ratified']) {
    assert.equal(parseConstitution(`Version: 1.0\n${status}\n`).ratified, true, status);
  }
  assert.equal(parseConstitution('Version: 1.0\nStatus: ratified\n').version, '1.0');
});

test('A11 only a ratified constitution produces a prompt block, and it says it wins conflicts', () => {
  assert.equal(constitutionBlock(parseConstitution('Version: 0.1\nStatus: draft\n# Text')), '');
  const block = constitutionBlock(parseConstitution('Version: 1.0\nStatus: ratified\n# The Jarvis Constitution\nArticle text'));
  assert.match(block, /^<constitution version="1\.0" status="ratified"/);
  assert.match(block, /the constitution wins/);
  assert.match(block, /you may quote it and link it/);
  assert.match(block, /Article text/);
  assert.match(RECENCY_RULE, /^26\. .*constitution wins/);
});

// ============ Article 2.1: private sources stay out of the chat voice's prompt ============

test('A2 P1 the private sources are named and each is guarded in the prompt builder', () => {
  assert.deepEqual(PRIVATE_SOURCES, ['MEMORY.md', 'JarvisxWill_SKB.md', 'JarvisxWill_GKB.md']);
  const m = src('memory.js');
  assert.match(m, /const constitution = readConstitution\(\);/);
  assert.match(m, /const skb = constitution\.ratified \? null : await safeRead\(SKB_PATH/);
  assert.match(m, /const gkb = constitution\.ratified \? null : await safeRead\(GKB_PATH/);
  assert.match(m, /for \(const file of \(constitution\.ratified \? \[\] : MEMORY_FILES\)\)/);
  assert.match(m, /constitution\.ratified \? RATIFIED_BRIEF :/);
});

test('A4 the ratified project brief follows Article 4 (contributor, not founder)', () => {
  assert.doesNotMatch(RATIFIED_BRIEF, /founder/i);
  assert.match(RATIFIED_BRIEF, /open source contributor/);
  assert.match(RATIFIED_BRIEF, /three minds/);
});

// ============ Article 1.2: no claimed action without a tool receipt ============

test('A1 H1 a bare "Saved." with no tool run is removed', () => {
  assert.equal(gateFakeActions('Saved. The binary state flip plus the living seed.', { toolsRan: 0 }).changed, true);
});

test('A1 H2 the same "Saved." passes when a tool actually ran', () => {
  assert.equal(gateFakeActions('Saved. The binary state flip plus the living seed.', { toolsRan: 1 }).changed, false);
});

test('A1 H3 a future promise to run an experiment is removed', () => {
  const r = gateFakeActions("good question. we'll benchmark that tonight.", { toolsRan: 0 });
  assert.equal(r.changed, true);
  assert.deepEqual(r.removed, ["we'll benchmark that tonight."]);
});

test('A1 H4 a true statement about the shared board passes', () => {
  assert.equal(gateFakeActions("that's already on the project board.", { toolsRan: 0 }).changed, false);
});

test('A1 H5 a first-person tracking promise is removed', () => {
  assert.equal(gateFakeActions("I'll keep track of that for you.", { toolsRan: 0 }).changed, true);
});

// Article 1.2 must hold on every reply path. Since 2026-11-01 the check lives at one point: chat()
// turns the model's output into a protocol object and returns only its checked reply (protocol.js),
// so no path can skip it by forgetting a gate call. The media, web and collision paths each did
// while the gate lived at the call sites.
test('A1 chat() returns only the protocol-checked reply', () => {
  const c = src('claude.js');
  const body = c.slice(c.indexOf('export async function chat('), c.indexOf('// ============ Cross-Chat Context Extraction'));
  assert.equal((body.match(/const spoken = speak\(/g) || []).length, 1);
  assert.match(body, /let assistantMessage = spoken\.reply \|\| '\.\.\.';/);
  assert.match(body, /protocol: spoken,/);
  // The only place chat() reads the model's text is the call into speak().
  assert.equal((body.match(/\.filter\(block => block\.type === 'text'\)/g) || []).length, 1);
  // /idea posts model text too, so codeGenChat returns the checked reply as well.
  assert.match(c, /return \{ text: spoken\.reply, filesWritten, protocol: spoken \};/);
});

test('A1 every logged model reply records its protocol object, and no path gates on its own', () => {
  const sites = src('index.js').split('\n')
    .filter((line) => /\brecordExchange\(/.test(line) && !/noModel/.test(line) && !/^\s*import\b/.test(line));
  assert.ok(sites.length >= 3, `expected the message, media and regeneration paths, found ${sites.length}`);
  for (const line of sites) assert.match(line, /protocol: \w+\.protocol/, line.trim());
  for (const f of ['index.js', 'web-api.js']) assert.doesNotMatch(src(f), /gateFakeActions\(/, f);
  assert.match(src('feed.js'), /protocol: meta\.noModel \? null : protocolSummary\(meta\.protocol\)/);
});

test('A1 chat() fails loud on arguments out of order, and the collision path calls it in order', () => {
  assert.match(src('claude.js'), /throw new TypeError\(`chat\(\): arguments out of order/);
  assert.match(src('index.js'), /await chat\(chatId, userName, collisionPrompt, ctx\.chat\.type, \[\]/);
});

test('A1 A5 broadcasts pass the protocol and skip quiet and tag-only chats (Article 5.2)', () => {
  const b = src('broadcast.js');
  assert.match(b, /cleanContent\(speak\(raw, turnRecord\(\{ chatType: 'group' \}\)\)\.reply\)/);
  assert.match(b, /if \(shouldSuppress\(chatId, 'broadcast'\)\)/);
});

test('A1 the exchange log records the tool receipt', () => {
  assert.match(src('feed.js'), /toolsRan: meta\.noModel \? 0 :/);
});

// ============ Article 5.1: a request to be quiet changes the mode ============

test('A5 R1 "please don\'t speak unless summoned" switches to tag-only', () => {
  assert.equal(detectDirective("please don't speak unless summoned")?.mode, 'tag-only');
});

test('A5 R2 "You can\'t respond unless tagged" switches to tag-only', () => {
  assert.equal(detectDirective("You can't respond unless tagged")?.mode, 'tag-only');
});

test('A5 R3 an ordinary question is not a directive', () => {
  assert.equal(detectDirective('can you respond to this when you get a chance?'), null);
});

// ============ Articles 1.2 and 5.1: a mode change is claimed only when it happened ============

test('A5 M1 "got it, back in tag-only mode" from the model is removed (2026-10-30 slip)', () => {
  const r = gateFakeActions('got it, back in tag-only mode.', { toolsRan: 0, chatMode: 'normal' });
  assert.equal(r.changed, true);
});

test('A5 M2 "I won\'t respond unless tagged" from the model is removed', () => {
  assert.equal(gateFakeActions("fair enough. I won't respond unless tagged.", { toolsRan: 0 }).changed, true);
});

test('A5 M3 a claim about the current mode passes only when it matches the stored mode', () => {
  const line = 'this chat is in tag-only mode, so tag me if you need me.';
  assert.equal(gateFakeActions(line, { toolsRan: 0, chatMode: 'tag-only' }).changed, false);
  assert.equal(gateFakeActions(line, { toolsRan: 0, chatMode: 'normal' }).changed, true);
});

test('A5 M4 talking about the tag-only feature is not a mode claim', () => {
  assert.equal(gateFakeActions('the tag-only design is per group, keyed by chat id.', { toolsRan: 0, chatMode: 'normal' }).changed, false);
});

// ============ Article 10.1: no em or en dashes in what the bot sends ============

test('A10 V1 em and en dashes are removed, number ranges keep a hyphen', () => {
  const out = stripDashes('a — b – c, 2010–2020');
  assert.doesNotMatch(out, /[–—]/);
  assert.match(out, /2010-2020/);
});

// ============ Article 12.1: every article says how it is enforced and tested ============

test('A12 the constitution file declares enforcement and tests for every article', (t) => {
  if (!existsSync(CONSTITUTION_PATH)) {
    t.skip(`constitution not found at ${CONSTITUTION_PATH} (the bot then runs unratified by design)`);
    return;
  }
  const text = readFileSync(CONSTITUTION_PATH, 'utf-8');
  const c = parseConstitution(text);
  assert.ok(c.version, 'the constitution must carry a Version line');
  assert.doesNotMatch(text, /[–—]/, 'the constitution itself uses no em or en dashes');
  const articles = text.split(/^## Article /m).slice(1);
  assert.ok(articles.length >= 12, `expected at least 12 articles, found ${articles.length}`);
  for (const a of articles) {
    const title = a.split('\n')[0];
    if (/^1[12]\./.test(title)) continue; // amendments and verification describe the process itself
    assert.match(a, /\*\*Enforced by:\*\*/, `Article ${title} lacks "Enforced by"`);
    assert.match(a, /\*\*Tested by:\*\*/, `Article ${title} lacks "Tested by"`);
  }
});

// ============ Article 11.4: only the published text can ratify ============

test('A11 a local edit to the status line does not ratify; a pushed commit does', () => {
  const tmp = mkdtempSync(join(tmpdir(), 'constitution-'));
  const origin = join(tmp, 'origin.git');
  const repo = join(tmp, 'JARVIS');
  const git = (cwd, ...args) => {
    const r = spawnSync('git', args, { cwd, encoding: 'utf-8' });
    assert.equal(r.status, 0, `git ${args.join(' ')}: ${r.stderr}`);
  };
  try {
    git(tmp, 'init', '--bare', '-b', 'main', origin);
    git(tmp, 'init', '-b', 'main', repo);
    git(repo, 'config', 'user.email', 'test@example.invalid');
    git(repo, 'config', 'user.name', 'test');
    const file = join(repo, 'CONSTITUTION.md');
    writeFileSync(file, 'Version: 0.1\nStatus: draft, not yet ratified\n');
    git(repo, 'add', 'CONSTITUTION.md');
    git(repo, 'commit', '-m', 'draft');
    git(repo, 'remote', 'add', 'origin', origin);
    git(repo, 'push', '-u', 'origin', 'main');
    assert.equal(readConstitution(file).ratified, false, 'published draft');

    writeFileSync(file, 'Version: 1.0\nStatus: ratified\n');
    assert.equal(readConstitution(file).ratified, false, 'a local edit alone must not ratify');
    git(repo, 'commit', '-am', 'ratify');
    assert.equal(readConstitution(file).ratified, false, 'committed but unpublished must not ratify');
    git(repo, 'push');
    assert.equal(readConstitution(file).ratified, true, 'the published commit ratifies');
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
});

// ============ Article 2.1: the private memory index is never in the prompt ============

test('A2 P2 the Claude Code memory index is not loaded at all, ratified or not', () => {
  assert.match(src('memory.js'), /const MEMORY_FILES = \[\];/);
});

test('A2 P3 group prompts no longer carry a person\'s private DM topics', () => {
  const idx = src('index.js');
  assert.doesNotMatch(idx, /messageForLLM = `\$\{messageForLLM\}\\n\\n\$\{dmCtx\}`/);
});

// ============ Article 8.1 and 1.1: no funding asks, no false claims about tips ============

test('A8 the bot never posts the tip-jar funding notice', () => {
  const idx = src('index.js');
  assert.doesNotMatch(idx, /Tip jar contributions \(\/tip\) restore premium quality/);
  assert.doesNotMatch(idx, /discuss funding the cascade/);
  assert.doesNotMatch(idx, /tip jar refilled credits/);
});

// ============ Article 1.2 and 10.1 on the web chat path ============

// Article 12.1: the suite that gates every restart is the whole suite. `npm test` names its files,
// and three test files (the protocol's among them) were silently left out until 2026-11-01.
test('A12 every test file runs in npm test', () => {
  const script = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf-8')).scripts.test;
  const dir = (d) => readdirSync(new URL(`../${d}/`, import.meta.url)).filter((f) => f.endsWith('.test.js')).map((f) => `${d}/${f}`);
  for (const f of [...dir('test'), ...dir('src')]) assert.ok(script.includes(f), `${f} is not in npm test`);
});

test('A1 V1 both web chat paths send the protocol-checked reply through the dash filter', () => {
  const w = src('web-api.js');
  assert.match(w, /reply: stripDashes\(response\.text\)/);
  // The streamed path had neither check until 2026-11-01.
  assert.match(w, /const fullText = stripDashes\(response\.text \|\| ''\);/);
});

// ============ Article 5.1: the documented quiet command works ============

test('A5 R4 to R8 plain quiet requests change the mode, including the documented "jarvis be quiet"', () => {
  assert.equal(detectDirective('jarvis be quiet')?.mode, 'quiet');
  assert.equal(detectDirective('shut up jarvis')?.mode, 'quiet');
  assert.equal(detectDirective('jarvis go quiet')?.mode, 'quiet');
  assert.equal(detectDirective('please stay quiet unless someone tags you')?.mode, 'tag-only');
  assert.equal(detectDirective('jarvis stop talking')?.mode, 'quiet');
  assert.equal(detectDirective('just be quiet about it, the code is fine'), null);
  assert.equal(detectDirective('jasmine be quiet'), null);
});
