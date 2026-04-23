// ============ Archive Git Mirror ============
//
// Periodically commits and pushes the chat archive to a companion git
// repository — typically `jarvis-archive`. This is the public
// observability layer: the community can inspect every byte JARVIS uses
// to report stats, digests, or identity claims.
//
// The canonical archive dir (DATA_DIR/archive/) IS the working tree.
// One-time operator setup:
//
//   cd $DATA_DIR
//   rm -rf archive  # only if empty
//   git clone <archive-remote> archive
//   # (or for a new repo: git init inside archive/, add remote, first push)
//
// Then set ARCHIVE_MIRROR_ENABLED=true and the bot takes over — commits
// every 15 min (configurable), skips empty commits, fails soft on any
// network/lock error without taking the rest of the bot down.
//
// Security: the archive directory is whatever was configured. The mirror
// does NOT manipulate the main vibeswap repo. Git ops are scoped to the
// archive dir only.

import simpleGit from 'simple-git';
import { existsSync } from 'fs';
import { join } from 'path';
import { config } from './config.js';

const ARCHIVE_DIR = join(config.dataDir, 'archive');
const GIT_TIMEOUT_MS = 30_000;
const DEFAULT_INTERVAL_MS = 15 * 60 * 1000;

let mirrorEnabled = false;
let git = null;
let timer = null;
let mirrorLock = Promise.resolve();
let lastCommitTs = 0;
let lastStatus = 'not-initialized';

async function withMirrorLock(fn) {
  const prev = mirrorLock;
  let release;
  mirrorLock = new Promise(r => { release = r; });
  try {
    await prev;
    return await fn();
  } finally {
    release();
  }
}

function intervalMs() {
  const raw = parseInt(process.env.ARCHIVE_MIRROR_INTERVAL_MS, 10);
  if (Number.isFinite(raw) && raw >= 60_000) return raw;
  return DEFAULT_INTERVAL_MS;
}

async function isGitCheckout(dir) {
  if (!existsSync(join(dir, '.git'))) return false;
  try {
    const probe = simpleGit(dir, { timeout: { block: 5_000 } });
    await probe.status(); // throws if not a git dir or unreadable
    return true;
  } catch {
    return false;
  }
}

// ============ Lifecycle ============

export async function initArchiveMirror() {
  lastStatus = 'disabled';
  mirrorEnabled = false;

  const enabled = (process.env.ARCHIVE_MIRROR_ENABLED || '').toLowerCase();
  if (enabled !== 'true' && enabled !== '1' && enabled !== 'yes') {
    console.log('[archive-mirror] disabled (set ARCHIVE_MIRROR_ENABLED=true to enable)');
    return;
  }
  if (!existsSync(ARCHIVE_DIR)) {
    console.warn(`[archive-mirror] archive dir does not exist yet: ${ARCHIVE_DIR} — will retry on first commit attempt`);
    // Still schedule the timer — directory will be created by archiveMessage()
    // on first received update, and a subsequent tick will initialize git.
  } else if (!(await isGitCheckout(ARCHIVE_DIR))) {
    console.warn(`[archive-mirror] ${ARCHIVE_DIR} is not a git checkout. One-time setup:`);
    console.warn('  cd ' + ARCHIVE_DIR + ' && git init && git remote add origin <url> && git branch -M master');
    console.warn('[archive-mirror] staying disabled');
    lastStatus = 'disabled:not-a-git-checkout';
    return;
  }

  git = simpleGit(ARCHIVE_DIR, { timeout: { block: GIT_TIMEOUT_MS } });
  mirrorEnabled = true;
  lastStatus = 'enabled';

  const ms = intervalMs();
  timer = setInterval(() => {
    commitAndPushMirror().catch(err => {
      console.warn(`[archive-mirror] scheduled tick failed: ${err.message}`);
    });
  }, ms);
  if (timer.unref) timer.unref();

  console.log(`[archive-mirror] enabled — commit+push every ${Math.round(ms / 60_000)}m from ${ARCHIVE_DIR}`);
}

export function stopArchiveMirror() {
  if (timer) {
    clearInterval(timer);
    timer = null;
  }
  mirrorEnabled = false;
}

// ============ Commit + Push ============
//
// Adds every archive file, commits if there's something to commit,
// pushes to origin. Every error is logged and swallowed — the bot must
// continue running even if the mirror is permanently broken (e.g. remote
// went offline). Anti-hallucination: if a push fails, subsequent digest
// output reflects local archive state, not a promised-but-undone push.

export async function commitAndPushMirror() {
  if (!mirrorEnabled) return { ok: false, reason: lastStatus };

  return withMirrorLock(async () => {
    // Re-check dir — the first received message might have just created it
    if (!existsSync(ARCHIVE_DIR) || !(await isGitCheckout(ARCHIVE_DIR))) {
      lastStatus = 'skipped:not-a-git-checkout';
      return { ok: false, reason: lastStatus };
    }

    try {
      const status = await git.status();

      if (status.conflicted.length > 0) {
        console.warn(`[archive-mirror] conflicts detected — resetting to HEAD to recover`);
        await git.reset(['--hard', 'HEAD']);
        lastStatus = 'recovered:conflicts-reset';
        return { ok: false, reason: lastStatus };
      }

      const hasChanges =
        status.not_added.length > 0 ||
        status.modified.length > 0 ||
        status.created.length > 0 ||
        status.deleted.length > 0 ||
        status.staged.length > 0;

      if (!hasChanges) {
        lastStatus = 'no-changes';
        // Still try to push in case local is ahead (previous commit + failed push)
        if (status.ahead > 0) {
          try {
            await git.push('origin', status.current || 'master');
            lastStatus = `pushed-ahead:${status.ahead}`;
          } catch (pushErr) {
            console.warn(`[archive-mirror] push of ahead commits failed: ${pushErr.message}`);
            lastStatus = `push-failed:${pushErr.message}`;
          }
        }
        return { ok: true, reason: lastStatus };
      }

      await git.add(['.']);
      const msg = `archive ${new Date().toISOString().replace('T', ' ').replace(/\.\d+Z$/, 'Z')}`;
      await git.commit(msg);
      lastCommitTs = Date.now();

      try {
        await git.push('origin', status.current || 'master');
        lastStatus = `pushed:${msg}`;
      } catch (pushErr) {
        console.warn(`[archive-mirror] commit landed locally but push failed: ${pushErr.message}`);
        lastStatus = `committed-local-only:${pushErr.message}`;
      }

      return { ok: true, reason: lastStatus };
    } catch (err) {
      console.warn(`[archive-mirror] ${err.message}`);
      lastStatus = `error:${err.message}`;
      return { ok: false, reason: lastStatus };
    }
  });
}

// ============ Introspection ============

export function getArchiveMirrorStatus() {
  return {
    enabled: mirrorEnabled,
    archiveDir: ARCHIVE_DIR,
    lastCommitTs,
    lastCommitAgeSec: lastCommitTs ? Math.round((Date.now() - lastCommitTs) / 1000) : null,
    lastStatus,
    intervalMs: intervalMs(),
  };
}
