// Tests for fact provenance (proposal 0003, agreed by Will 2026-11-01): "Every stored fact carries where
// it was learned (a DM or a group, which chat, when) and whether it is public. A fact learned in a DM is
// simply not offered in a group prompt." Case ids continue Article 2's P series (CONSTITUTION.md).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { spawnSync } from 'child_process';
import { learnedIn, offerable, mergedProvenance } from '../src/provenance.js';
import { addUserMemory, getUserMemoryContext } from '../src/user-memory.js';
import { setUserTimezone, getUserTimezone } from '../src/time-awareness.js';

const src = (f) => readFileSync(new URL(`../src/${f}`, import.meta.url), 'utf-8');

const AT = '2026-11-01T12:00:00.000Z';
const inDM = learnedIn({ chatType: 'private', chatId: 42, at: AT });
const inGroup = learnedIn({ chatType: 'supergroup', chatId: -100777, at: AT });
const inPublicGroup = learnedIn({ chatType: 'supergroup', chatId: -100999, chatPublic: true, at: AT });
const DM = { scope: 'dm', chatId: '42' };
const GROUP = { scope: 'group', chatId: '-100777' };
const OTHER_GROUP = { scope: 'group', chatId: '-100888' };

test('A2 P4 a stored fact records where it was learned: which kind of chat, which chat, when, whether public', () => {
  assert.deepEqual(inDM, { scope: 'dm', chatId: '42', public: false, at: AT });
  assert.deepEqual(inGroup, { scope: 'group', chatId: '-100777', public: false, at: AT });
  assert.equal(learnedIn({ chatType: 'web', chatId: 'web-abc' }).scope, 'web');
  assert.equal(learnedIn({ chatType: 'channel', chatId: -1 }).scope, 'group');
  assert.equal(inPublicGroup.public, true);
  // Only a group anyone can read makes a fact public. Telegram gives a DM chat the person's own
  // username, so "the chat has a username" must never make a DM fact public.
  assert.equal(learnedIn({ chatType: 'private', chatId: 42, chatPublic: true }).public, false);
  assert.equal(learnedIn({ chatType: 'web', chatId: 'web-abc', chatPublic: true }).public, false);
});

test('A2 P5 a fact learned in a DM is never offered in a group prompt', () => {
  assert.equal(offerable(inDM, GROUP), false);
  assert.equal(offerable(inDM, OTHER_GROUP), false);
  assert.equal(offerable(inDM, DM), true);
  // Stored before provenance existed: nothing says where it came from, so it is treated as private.
  assert.equal(offerable(undefined, GROUP), false);
  assert.equal(offerable(null, DM), true);
  // A turn that does not say where it is gets only what may be said anywhere.
  assert.equal(offerable(inGroup, undefined), false);
  assert.equal(offerable(inPublicGroup, undefined), true);
});

test('A2 P6 a group fact is offered in its own group and the person\'s DM, in another group only if public', () => {
  assert.equal(offerable(inGroup, GROUP), true);
  assert.equal(offerable(inGroup, OTHER_GROUP), false);
  assert.equal(offerable(inGroup, DM), true);
  assert.equal(offerable(inPublicGroup, OTHER_GROUP), true);
});

test('A2 P7 a merged fact is offered only where every part may be', () => {
  const offeredIn = (p) => [DM, GROUP, OTHER_GROUP].map((turn) => offerable(p, turn));
  const otherGroup = learnedIn({ chatType: 'group', chatId: -100888, at: AT });
  assert.deepEqual(offeredIn(mergedProvenance([inGroup, inGroup])), [true, true, false]);
  assert.deepEqual(offeredIn(mergedProvenance([inGroup, inPublicGroup])), [true, true, false]);
  assert.deepEqual(offeredIn(mergedProvenance([inPublicGroup, inPublicGroup])), [true, true, true]);
  assert.deepEqual(offeredIn(mergedProvenance([inDM, inGroup])), [true, false, false]);
  assert.deepEqual(offeredIn(mergedProvenance([inGroup, otherGroup])), [true, false, false]);
  assert.deepEqual(offeredIn(mergedProvenance([inGroup, undefined])), [true, false, false]);
});

test('A2 P8 remembered personal details follow the same rule', () => {
  const uid = 'p8-test-user';
  addUserMemory(uid, 'Lives in Hyannis', inDM);
  addUserMemory(uid, 'Prefers to be called Billy', inGroup);
  addUserMemory(uid, 'Has a dog named Rex'); // no provenance given: private
  const dm = getUserMemoryContext(uid, DM);
  for (const m of ['Hyannis', 'Billy', 'Rex']) assert.match(dm, new RegExp(m));
  const group = getUserMemoryContext(uid, GROUP);
  assert.match(group, /Billy/);
  assert.doesNotMatch(group, /Hyannis|Rex/);
  assert.equal(getUserMemoryContext(uid, OTHER_GROUP), '');
  assert.equal(getUserMemoryContext(uid), '');
});

// End to end against the real learning store, in a child process with its own data dir and repo dir,
// because learning.js writes files. Facts are kept under 17 characters: the value-density threshold
// prunes any longer fact at its first prompt build (reported 2026-11-01, not changed here).
test('A2 P9 end to end: a DM fact reaches neither a group prompt nor the cross-shard bus; stored memories too', () => {
  const dir = mkdtempSync(join(tmpdir(), 'jarvis-provenance-'));
  try {
    const data = join(dir, 'data');
    const repo = join(dir, 'repo');
    mkdirSync(join(data, 'knowledge', 'deep'), { recursive: true });
    mkdirSync(join(repo, '.claude'), { recursive: true });
    // Memories stored before provenance existed are plain strings.
    writeFileSync(join(data, 'user-memories.json'), JSON.stringify({ 424242: { userName: 'T', memories: ['Lives in Hyannis'] } }));
    const learning = new URL('../src/learning.js', import.meta.url).href;
    const memory = new URL('../src/user-memory.js', import.meta.url).href;
    const script = `
      import { readFileSync, existsSync } from 'fs';
      const L = await import(${JSON.stringify(learning)});
      const M = await import(${JSON.stringify(memory)});
      const uid = '424242';
      await L.learnFact(uid, 'T', uid, 'private', 'Orbit Dec 12', 'project', []);
      await L.learnFact(uid, 'T', '-100777', 'supergroup', 'Uses Rust', 'technical', []);
      await L.learnFact(uid, 'T', '-100999', 'supergroup', 'Ships Friday', 'project', [], { chatPublic: true });
      const ctx = (chatId, chatType) => L.buildKnowledgeContext(uid, chatId, chatType, 'orbit rust ships');
      await M.initUserMemory();
      const bus = ${JSON.stringify(join(repo, '.claude', 'shard_learnings.jsonl'))};
      console.log('RESULT ' + JSON.stringify({
        dm: await ctx(uid, 'private'),
        group: await ctx('-100777', 'supergroup'),
        other: await ctx('-100888', 'supergroup'),
        bus: existsSync(bus) ? readFileSync(bus, 'utf8') : '',
        memDM: M.getUserMemoryContext(uid, { scope: 'dm', chatId: uid }),
        memGroup: M.getUserMemoryContext(uid, { scope: 'group', chatId: '-100777' }),
      }));
      process.exit(0);`;
    const run = spawnSync(process.execPath, ['--input-type=module', '-e', script], {
      env: { ...process.env, DATA_DIR: data, VIBESWAP_REPO: repo, ENCRYPTION_ENABLED: 'false' },
      encoding: 'utf-8',
      timeout: 60000,
    });
    const line = (run.stdout || '').split('\n').find((l) => l.startsWith('RESULT '));
    assert.ok(line, `child produced no result: ${run.stderr}`);
    const r = JSON.parse(line.slice('RESULT '.length));
    assert.match(r.dm, /Orbit Dec 12/);
    assert.match(r.dm, /Uses Rust/);
    assert.doesNotMatch(r.group, /Orbit/);
    assert.match(r.group, /Uses Rust/);
    assert.doesNotMatch(r.other, /Orbit|Uses Rust/);
    assert.match(r.other, /Ships Friday/);
    // The bus is read into every prompt on every other shard: only public facts go on it.
    assert.doesNotMatch(r.bus, /Orbit|Uses Rust/);
    assert.match(r.bus, /Ships Friday/);
    assert.match(r.memDM, /Hyannis/);
    assert.equal(r.memGroup, '');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('A2 P11 a timezone guessed from a DM does not put the person\'s local time into a group prompt', () => {
  const uid = 'p11-test-user';
  setUserTimezone(uid, 'America/New_York', inDM);
  assert.equal(getUserTimezone(uid, DM), 'America/New_York');
  assert.equal(getUserTimezone(uid, GROUP), null);
  setUserTimezone(uid, 'Asia/Tokyo', inGroup);
  assert.equal(getUserTimezone(uid, GROUP), 'Asia/Tokyo');
  assert.equal(getUserTimezone(uid, OTHER_GROUP), null);
  assert.match(src('time-awareness.js'), /export function getTimeContext\(userId, turn\) \{\r?\n  const tz = getUserTimezone\(String\(userId\), turn\) \|\| 'UTC';/);
});

test('A2 P10 every path that puts a person\'s stored facts into a prompt checks where they were learned', () => {
  // The per-user knowledge base (learning.js), the archive behind recall_knowledge (claude.js), and the
  // remembered personal details (index.js); the group knowledge base is loaded only for its own group.
  assert.match(src('learning.js'), /offerableFacts\(userCKB\.facts, \{ scope: scopeOf\(chatType\), chatId \}\)/);
  assert.match(src('claude.js'), /offerableFacts\(await searchDeepStorageFull\(/);
  const idx = src('index.js');
  assert.match(idx, /getUserMemoryContext\(String\(ctx\.from\.id\), \{ scope: scopeOf\(ctx\.chat\?\.type\), chatId: ctx\.chat\?\.id \}\)/);
  assert.match(idx, /extractAndStoreMemories\(.*learnedIn\(\{ chatType: ctx\.chat\?\.type, chatId: ctx\.chat\?\.id, chatPublic: !!ctx\.chat\?\.username \}\)\)/);
  assert.match(idx, /chatTitle: ctx\.chat\?\.title, chatPublic: !!ctx\.chat\?\.username/);
  assert.match(idx, /getTimeContext\(String\(ctx\.from\.id\), \{ scope: scopeOf\(ctx\.chat\?\.type\), chatId: ctx\.chat\?\.id \}\)/);
  assert.match(idx, /setUserTimezone\(String\(ctx\.from\.id\), detectedTz, learnedIn\(\{ chatType: ctx\.chat\?\.type, chatId: ctx\.chat\?\.id, chatPublic: !!ctx\.chat\?\.username \}\)\)/);
});
