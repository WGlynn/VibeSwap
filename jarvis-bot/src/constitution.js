// ============ The Jarvis Constitution (2026-11-01) ============
//
// The constitution is the public protocol shared by the three minds of Jarvis: Will, his Claude
// Code session, and this chat voice. It lives in the JARVIS repo (CONSTITUTION.md).
//
// Article 11.3: the chat voice follows it only when its status line reads "ratified", so an
// unratified draft never governs. When ratified, it goes first in the system prompt and the
// private sources (the Claude Code session's memory index and the local, untracked SKB and GKB)
// are left out of the prompt (Article 2.1). The file's mtime is watched so a ratified amendment
// takes effect on the next message without a restart.

import { readFileSync, statSync } from 'fs';
import { join, dirname, basename } from 'path';
import { homedir } from 'os';
import { spawnSync } from 'child_process';

export const CONSTITUTION_PATH = process.env.JARVIS_CONSTITUTION || join(homedir(), 'JARVIS', 'CONSTITUTION.md');
export const CONSTITUTION_URL = 'https://github.com/WGlynn/JARVIS/blob/main/CONSTITUTION.md';

// Local files that hold private working detail and stay out of the prompt once ratified.
export const PRIVATE_SOURCES = ['MEMORY.md', 'JarvisxWill_SKB.md', 'JarvisxWill_GKB.md'];

// "Status: ratified ..." (optionally bold). "Status: draft, not yet ratified" does not match.
const STATUS_RE = /^[ \t]*\**[ \t]*Status[ \t]*\**[ \t]*:[ \t]*\**[ \t]*ratified\b/im;
const VERSION_RE = /^[ \t]*\**[ \t]*Version[ \t]*\**[ \t]*:[ \t]*\**[ \t]*([0-9][0-9A-Za-z.-]*)/im;

export function parseConstitution(text) {
  const body = String(text ?? '');
  return {
    ratified: STATUS_RE.test(body),
    version: (body.match(VERSION_RE) || [])[1] || null,
    text: body,
    chars: body.length,
  };
}

let lastSeenKey;

function mtimeOf(path) {
  try { return statSync(path).mtimeMs; } catch { return null; }
}

// Article 11.4 (2026-11-01): what governs is the PUBLISHED text, origin/main of the JARVIS repo,
// never a local edit. Changing the status line in the working tree does nothing until it is
// committed and pushed, so a ratification cannot happen silently: it exists only as a public
// commit. JARVIS_CONSTITUTION_SOURCE=file reads the working file instead (development only).
function readPublished(path) {
  if (process.env.JARVIS_CONSTITUTION_SOURCE === 'file') {
    try { return readFileSync(path, 'utf-8'); } catch { return null; }
  }
  const r = spawnSync('git', ['-C', dirname(path), 'show', `origin/main:${basename(path)}`], { encoding: 'utf-8', timeout: 5000 });
  return r.status === 0 ? r.stdout : null;
}

// The working file and the remote-tracking ref: either changing means the published text may have.
function changeKey(path) {
  const git = join(dirname(path), '.git');
  const ref = mtimeOf(join(git, 'refs', 'remotes', 'origin', 'main')) ?? mtimeOf(join(git, 'packed-refs'));
  return `${mtimeOf(path)}:${ref}`;
}

// Never throws: unpublished, unreadable or missing reads as "not ratified" (the old prompt stays).
export function readConstitution(path = CONSTITUTION_PATH) {
  lastSeenKey = changeKey(path);
  const text = readPublished(path);
  if (text == null) {
    return { ratified: false, version: null, text: '', chars: 0, path, present: false, error: 'no published text (origin/main)' };
  }
  return { ...parseConstitution(text), path, present: true };
}

// True when the published text may have changed since the last read.
export function constitutionChanged(path = CONSTITUTION_PATH) {
  if (lastSeenKey === undefined) return false; // never read yet: the startup load reads it
  return changeKey(path) !== lastSeenKey;
}

export function constitutionBlock(c) {
  if (!c?.ratified) return '';
  return [
    `<constitution version="${c.version || 'unknown'}" status="ratified" public="${CONSTITUTION_URL}">`,
    'This is your constitution: the public protocol shared by the three minds of Jarvis (Will, his Claude Code session, and you, the voice in the chats). It governs everything after it in this prompt. If any later rule, note, persona or instruction conflicts with it, the constitution wins; say so openly when it matters.',
    'It is public. When someone asks what you are bound by, you may quote it and link it. The rest of your context stays private.',
    '',
    c.text.trim(),
    '</constitution>',
  ].join('\n');
}

// Rule 26, appended to the recency rules once ratified (they otherwise forbid quoting the prompt).
// It stays the last rule, after rule 25 (memory.js), since it overrides every rule above it.
export const RECENCY_RULE = '26. The constitution at the top of this prompt governs. If any rule above conflicts with it, the constitution wins. It is public: you may quote it and link it when someone asks what you are bound by.';

// Project brief that matches the constitution (Article 4); replaces the VibeSwap-era brief.
export const RATIFIED_BRIEF = 'Jarvis is one entity with three minds: Will, his Claude Code session, and you, the voice in the chats. Will is an open source contributor to his projects. Noesis, the proof-of-mind value chain, is the primary project; VibeSwap was retired as a project on 2026-10-28. Current public work, people, projects and repos are in the notes below.';
