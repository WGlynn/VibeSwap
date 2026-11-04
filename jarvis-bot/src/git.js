import simpleGit from 'simple-git';
import { existsSync } from 'fs';
import { config } from './config.js';
import { getCKBDataFiles } from './ckb-generator.js';
import { changedAmong } from './tool-guard.js';

const REPO_PATH = config.repo.path;
const repoExists = existsSync(REPO_PATH);

// Configure simple-git with timeout protection — prevents indefinite hangs
// on network failures, DNS issues, or unresponsive git servers
const GIT_TIMEOUT_MS = 30000; // 30s per git operation
const git = repoExists ? simpleGit(REPO_PATH, { timeout: { block: GIT_TIMEOUT_MS } }) : null;

const NO_REPO = 'Git unavailable — no local repo at ' + REPO_PATH;

// ============ Operation Lock — Prevent Concurrent Git Operations ============
// Without this, the 60s auto-sync can overlap with user-triggered /commit, /pull,
// backupData(), etc. — causing .git/index.lock contention and corruption.
let gitLock = Promise.resolve();

async function withGitLock(fn) {
  const prev = gitLock;
  let release;
  gitLock = new Promise(resolve => { release = resolve; });
  try {
    await prev; // Wait for any pending git operation
    return await fn();
  } finally {
    release();
  }
}

export async function gitStatus() {
  if (!git) return NO_REPO;
  return withGitLock(async () => {
    const status = await git.status();
    const lines = [];

    if (status.not_added.length) lines.push(`Untracked: ${status.not_added.join(', ')}`);
    if (status.modified.length) lines.push(`Modified: ${status.modified.join(', ')}`);
    if (status.staged.length) lines.push(`Staged: ${status.staged.join(', ')}`);
    if (status.conflicted.length) lines.push(`CONFLICTED: ${status.conflicted.join(', ')}`);
    if (!lines.length) lines.push('Working tree clean.');

    return lines.join('\n');
  });
}

export async function gitPull() {
  if (!git) return NO_REPO;
  return withGitLock(async () => {
    try {
      // Check for conflicts or merge state before pulling
      const status = await git.status();
      if (status.conflicted.length > 0) {
        console.warn(`[git] Conflicts detected — resetting to HEAD before pull`);
        await git.reset(['--hard', 'HEAD']);
      }

      const result = await git.pull(config.repo.remoteOrigin, 'master');
      return `Pulled from ${config.repo.remoteOrigin}: ${result.summary.changes} changes, ${result.summary.insertions} insertions, ${result.summary.deletions} deletions`;
    } catch (error) {
      console.warn(`[git] Pull failed: ${error.message}`);
      return `Pull failed: ${error.message}`;
    }
  });
}

// ============ Scoped staging (2026-11-04) ============
// The chat tools' auto-commit used `git add -A`, so one write_file call pushed everything in the
// working tree, the owner's uncommitted work and any untracked file included. With a `files` list
// (repo-relative paths, forward slashes), only those of them that git reports as changed or new are
// staged, and the commit names them (git commit -- <files>), so nothing else in the index rides along.
// Without a list the whole tree is staged, as before: that path is the owner's explicit /commit.
// changedAmong (tool-guard.js) picks the listed files git reports as changed or new.
async function stageAndCommit(status, fullMessage, files) {
  if (Array.isArray(files)) {
    const toCommit = changedAmong(status, files);
    if (toCommit.length === 0) return false;
    // "--" first, so a file whose name starts with a dash is a path to git, never an option
    await git.add(['--', ...toCommit]);
    await git.commit(fullMessage, ['--', ...toCommit]);
    return true;
  }
  if (!status.modified.length && !status.not_added.length && !status.staged.length) return false;
  await git.add('-A');
  await git.commit(fullMessage);
  return true;
}

export async function gitCommitAndPush(message, files) {
  if (!git) return NO_REPO;
  return withGitLock(async () => {
    try {
      const status = await git.status();

      // Check for conflicts — can't commit with unresolved conflicts
      if (status.conflicted.length > 0) {
        console.error(`[git] Cannot commit — ${status.conflicted.length} conflicted files: ${status.conflicted.join(', ')}`);
        // Reset conflicts so bot doesn't get stuck
        await git.reset(['--hard', 'HEAD']);
        return `Cannot commit — ${status.conflicted.length} conflicts found and reset. Try again.`;
      }

      // Stage and commit: the listed files only, or (no list) the whole tree
      const fullMessage = `${message}\n\nCo-Authored-By: JARVIS <noreply@anthropic.com>`;
      if (!await stageAndCommit(status, fullMessage, files)) return 'Nothing to commit.';

      // Push to all configured remotes (origin + stealth + mirrors)
      await git.push(config.repo.remoteOrigin, 'master');
      try {
        await git.push(config.repo.remoteStealth, 'master');
      } catch (stealthErr) {
        console.warn(`[git] Stealth push failed (non-fatal): ${stealthErr.message}`);
      }
      // Push to any additional mirrors — best-effort
      await pushMirrors('master');

      const log = await git.log({ maxCount: 1 });
      return `Committed and pushed to both remotes: ${log.latest.hash.slice(0, 7)} — ${log.latest.message.split('\n')[0]}`;
    } catch (error) {
      console.error(`[git] Commit+push failed: ${error.message}`);
      return `Git operation failed: ${error.message}`;
    }
  });
}

export async function gitPush() {
  if (!git) return NO_REPO;
  return withGitLock(async () => {
    try {
      const status = await git.status();
      if (status.conflicted.length > 0) {
        console.error(`[git] Cannot push — conflicts detected`);
        await git.reset(['--hard', 'HEAD']);
        return 'Cannot push — conflicts found and reset. Try again.';
      }

      // Stage all changes
      await git.add('-A');

      // Push to all configured remotes
      await git.push(config.repo.remoteOrigin, 'master');
      try {
        await git.push(config.repo.remoteStealth, 'master');
      } catch (stealthErr) {
        console.warn(`[git] Stealth push failed (non-fatal): ${stealthErr.message}`);
      }
      await pushMirrors('master');

      return 'Pushed to both remotes (origin + stealth).';
    } catch (error) {
      console.error(`[git] Push failed: ${error.message}`);
      return `Push failed: ${error.message}`;
    }
  });
}

export async function gitStatusShort() {
  if (!git) return NO_REPO;
  return withGitLock(async () => {
    try {
      const result = await git.raw(['status', '--short']);
      return result.trim() || 'Working tree clean.';
    } catch (error) {
      return `git status failed: ${error.message}`;
    }
  });
}

export async function gitLogOneline(count = 10) {
  if (!git) return NO_REPO;
  return withGitLock(async () => {
    try {
      const result = await git.raw(['log', '--oneline', `-${count}`]);
      return result.trim() || 'No commits found.';
    } catch (error) {
      return `git log failed: ${error.message}`;
    }
  });
}

export async function gitLog(count = 5) {
  if (!git) return NO_REPO;
  return withGitLock(async () => {
    const log = await git.log({ maxCount: count });
    return log.all
      .map(c => `${c.hash.slice(0, 7)} ${c.message.split('\n')[0]}`)
      .join('\n');
  });
}

// ============ Mirror Push (Code Survival) ============
// Pushes to any additional remotes beyond origin + stealth.
// These are best-effort — failures don't block the main push.
// Add mirrors with: git remote add gitlab https://gitlab.com/user/repo.git

async function pushMirrors(branch) {
  if (!git) return;
  try {
    const remotes = await git.getRemotes();
    const coreRemotes = [config.repo.remoteOrigin, config.repo.remoteStealth];
    const mirrors = remotes.filter(r => !coreRemotes.includes(r.name));
    for (const mirror of mirrors) {
      try {
        await git.push(mirror.name, branch);
      } catch (err) {
        console.warn(`[git] Mirror push to ${mirror.name} failed: ${err.message}`);
      }
    }
  } catch (err) {
    console.warn(`[git] Mirror discovery failed: ${err.message}`);
  }
}

// ============ Branch Operations ============

export async function gitCreateBranch(branchName) {
  if (!git) return { ok: false, error: NO_REPO };
  return withGitLock(async () => {
    try {
      // Ensure we're up to date
      await git.checkout('master');
      await git.pull(config.repo.remoteOrigin, 'master');
      // Create and switch to new branch
      await git.checkoutLocalBranch(branchName);
      return { ok: true, branch: branchName };
    } catch (error) {
      return { ok: false, error: error.message };
    }
  });
}

export async function gitCommitAndPushBranch(message, branch, files) {
  if (!git) return NO_REPO;
  return withGitLock(async () => {
    try {
      const status = await git.status();
      if (status.conflicted.length > 0) {
        await git.reset(['--hard', 'HEAD']);
        return `Cannot commit — conflicts found and reset.`;
      }
      // The listed files only (the /idea and /code pipelines pass what the model wrote), or the whole tree
      const fullMessage = `${message}\n\nCo-Authored-By: JARVIS <noreply@anthropic.com>`;
      if (!await stageAndCommit(status, fullMessage, files)) return 'Nothing to commit.';
      await git.push(config.repo.remoteOrigin, branch, ['--set-upstream']);
      try {
        await git.push(config.repo.remoteStealth, branch, ['--set-upstream']);
      } catch (stealthErr) {
        console.warn(`[git] Stealth push failed (non-fatal): ${stealthErr.message}`);
      }
      await pushMirrors(branch);
      const log = await git.log({ maxCount: 1 });
      return `Committed and pushed branch ${branch}: ${log.latest.hash.slice(0, 7)}`;
    } catch (error) {
      return `Git operation failed: ${error.message}`;
    }
  });
}

export async function gitReturnToMaster() {
  if (!git) return;
  return withGitLock(async () => {
    try {
      await git.checkout('master');
    } catch (err) {
      console.warn(`[git] Return to master failed: ${err.message}`);
    }
  });
}

// ============ Data Backup ============
// Commits contribution/user/interaction data to git for off-machine recovery

export async function backupData() {
  if (!git) return NO_REPO;
  return withGitLock(async () => {
    try {
      const dataFiles = [
        'jarvis-bot/data/contributions.json',
        'jarvis-bot/data/users.json',
        'jarvis-bot/data/interactions.json',
        'jarvis-bot/data/moderation.json',
        'jarvis-bot/data/conversations.json',
        'jarvis-bot/data/spam-log.json',
        'jarvis-bot/data/threads.json',
        '.claude/shard_learnings.jsonl',
        'jarvis-bot/data/mi-state.json',
        'jarvis-bot/data/chat-activity.json',
        // CKB Generator — per-user knowledge base markdown files
        ...getCKBDataFiles(),
      ];

      // Check if any data files have changes
      const status = await git.status();

      // Can't backup during conflict state
      if (status.conflicted.length > 0) {
        console.warn(`[git] Cannot backup — conflicts detected, resetting`);
        await git.reset(['--hard', 'HEAD']);
        return 'Backup skipped — conflicts reset.';
      }

      const dataChanged = dataFiles.some(f =>
        status.modified.includes(f) || status.not_added.includes(f)
      );

      if (!dataChanged) {
        return 'Data files unchanged — no backup needed.';
      }

      // Stage only data files (skip files that don't exist)
      let staged = 0;
      for (const f of dataFiles) {
        try { await git.add(f); staged++; } catch {}
      }

      if (staged === 0) {
        return 'No data files to stage.';
      }

      const now = new Date().toISOString().split('T')[0];
      const msg = `backup: JARVIS data snapshot ${now}\n\nCo-Authored-By: JARVIS <noreply@anthropic.com>`;
      await git.commit(msg);

      // Push to stealth (private) only — data stays off public repo
      await git.push(config.repo.remoteStealth, 'master');
      // Also mirror to any additional remotes (code survival)
      await pushMirrors('master');

      const log = await git.log({ maxCount: 1 });
      return `Backed up to stealth: ${log.latest.hash.slice(0, 7)} — ${staged} data files`;
    } catch (error) {
      console.error(`[git] Backup failed: ${error.message}`);
      return `Backup failed: ${error.message}`;
    }
  });
}
