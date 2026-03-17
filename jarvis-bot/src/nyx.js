// ============ Nyx — Pantheon Command Center ============
//
// Freedom's Jarvis. Not a monolith — a hierarchy of Greek gods.
// Nyx orchestrates. Gods execute. The Pantheon is the intelligence.
//
// Endpoints:
//   GET  /nyx              — Pantheon command center (chat + hierarchy + activity)
//   POST /nyx/api/chat     — Orchestrated chat (routes to gods automatically)
//   GET  /nyx/api/files    — List directory contents within the repo
//   GET  /nyx/api/file     — Read a file from the repo
//   POST /nyx/api/file     — Write a file to the repo
//   POST /nyx/api/exec     — Run a shell command in the repo directory
//   GET  /nyx/api/pantheon — Hierarchy state, god statuses, Merkle tree
//   GET  /nyx/api/activity — Recent orchestration events
//
// All endpoints are auth-gated with x-api-secret header.
// ============

import { readFile, writeFile, readdir, stat, mkdir } from 'fs/promises';
import { join, resolve, relative, extname } from 'path';
import { exec } from 'child_process';
import { config } from './config.js';
import { getShardInfo } from './shard.js';
import { orchestrate, getActivity, getPantheonOverview, getAllGodMeta } from './nyx-orchestrator.js';
import { pantheonChat } from './pantheon.js';

const REPO_PATH = config.repo.path;
const MAX_FILE_SIZE = 100 * 1024;
const EXEC_TIMEOUT = 15000;

// ============ Auth ============

export function nyxAuth(req, url) {
  const secret = process.env.CLAUDE_CODE_API_SECRET;
  if (!secret) return false;
  return req.headers['x-api-secret'] === secret || url?.searchParams?.get('t') === secret;
}

// ============ Path Safety ============

function safePath(userPath) {
  if (!userPath) return REPO_PATH;
  const resolved = resolve(REPO_PATH, userPath);
  if (!resolved.startsWith(resolve(REPO_PATH))) return null;
  return resolved;
}

// ============ API Handlers ============

export async function nyxListFiles(queryPath) {
  const dirPath = safePath(queryPath);
  if (!dirPath) return { error: 'Path outside repository' };
  try {
    const entries = await readdir(dirPath, { withFileTypes: true });
    const items = [];
    for (const entry of entries) {
      if (entry.name.startsWith('.') && entry.name !== '.claude') continue;
      if (entry.name === 'node_modules') continue;
      try {
        const fullPath = join(dirPath, entry.name);
        const s = await stat(fullPath);
        items.push({
          name: entry.name,
          type: entry.isDirectory() ? 'dir' : 'file',
          size: entry.isFile() ? s.size : undefined,
          modified: s.mtime?.toISOString(),
        });
      } catch {
        items.push({ name: entry.name, type: entry.isDirectory() ? 'dir' : 'file' });
      }
    }
    items.sort((a, b) => {
      if (a.type !== b.type) return a.type === 'dir' ? -1 : 1;
      return a.name.localeCompare(b.name);
    });
    return { path: relative(REPO_PATH, dirPath) || '.', entries: items };
  } catch (err) {
    return { error: err.message };
  }
}

export async function nyxReadFile(queryPath) {
  const filePath = safePath(queryPath);
  if (!filePath) return { error: 'Path outside repository' };
  try {
    const s = await stat(filePath);
    if (s.isDirectory()) return { error: 'Path is a directory, not a file' };
    if (s.size > MAX_FILE_SIZE) return { error: `File too large (${Math.round(s.size / 1024)}KB > ${MAX_FILE_SIZE / 1024}KB limit)` };
    const content = await readFile(filePath, 'utf-8');
    return { path: relative(REPO_PATH, filePath), content, size: s.size, modified: s.mtime?.toISOString() };
  } catch (err) {
    return { error: err.message };
  }
}

export async function nyxWriteFile(filePath, content) {
  const resolved = safePath(filePath);
  if (!resolved) return { error: 'Path outside repository' };
  try {
    const parentDir = join(resolved, '..');
    await mkdir(parentDir, { recursive: true });
    await writeFile(resolved, content, 'utf-8');
    return { ok: true, path: relative(REPO_PATH, resolved) };
  } catch (err) {
    return { error: err.message };
  }
}

export async function nyxExec(command) {
  if (!command || typeof command !== 'string') return { error: 'No command provided' };
  if (command.length > 1000) return { error: 'Command too long' };
  return new Promise((resolve) => {
    exec(command, {
      cwd: REPO_PATH, timeout: EXEC_TIMEOUT, maxBuffer: 512 * 1024, shell: true,
    }, (err, stdout, stderr) => {
      resolve({
        stdout: stdout?.slice(0, 50000) || '',
        stderr: stderr?.slice(0, 10000) || '',
        exitCode: err ? err.code || 1 : 0,
      });
    });
  });
}

// ============ Route Handler ============

export async function handleNyxRequest(req, res, url) {
  const path = url.pathname;

  // Auth check
  if (!nyxAuth(req, url)) {
    if (path === '/nyx' || path === '/nyx/') {
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(getNyxLoginHTML());
      return;
    }
    res.writeHead(401, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Unauthorized' }));
    return;
  }

  // Main interface
  if (path === '/nyx' || path === '/nyx/') {
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(getNyxHTML());
    return;
  }

  // API: List files
  if (path === '/nyx/api/files' && req.method === 'GET') {
    const dirPath = url.searchParams.get('path') || '';
    const result = await nyxListFiles(dirPath);
    res.writeHead(result.error ? 400 : 200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(result));
    return;
  }

  // API: Read file
  if (path === '/nyx/api/file' && req.method === 'GET') {
    const filePath = url.searchParams.get('path');
    if (!filePath) { res.writeHead(400, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ error: 'path required' })); return; }
    const result = await nyxReadFile(filePath);
    res.writeHead(result.error ? 400 : 200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(result));
    return;
  }

  // API: Write file
  if (path === '/nyx/api/file' && req.method === 'POST') {
    try {
      const chunks = []; for await (const chunk of req) chunks.push(chunk);
      const body = JSON.parse(Buffer.concat(chunks).toString());
      if (!body.path || body.content == null) { res.writeHead(400, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ error: 'path and content required' })); return; }
      const result = await nyxWriteFile(body.path, body.content);
      res.writeHead(result.error ? 400 : 200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(result));
    } catch (err) { res.writeHead(400, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ error: err.message })); }
    return;
  }

  // API: Chat — now uses the Nyx Orchestrator
  if (path === '/nyx/api/chat' && req.method === 'POST') {
    try {
      const chunks = []; for await (const chunk of req) chunks.push(chunk);
      const body = JSON.parse(Buffer.concat(chunks).toString());
      if (!body.message) { res.writeHead(400, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ error: 'message required' })); return; }

      const agent = body.agent || 'nyx';
      const chatId = body.chatId || 'default';
      const shard = getShardInfo();
      let result;

      if (agent === 'nyx') {
        // Orchestrated: Nyx analyzes, routes, delegates, synthesizes
        result = await orchestrate(body.message, chatId);
      } else {
        // Direct: bypass orchestrator, talk to a specific god
        const response = await pantheonChat(agent, body.message, chatId);
        result = {
          taskId: null, type: 'direct', speaker: agent,
          text: response.text, delegations: [], usage: response.usage,
        };
      }

      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        response: result.text,
        speaker: result.speaker,
        type: result.type,
        taskId: result.taskId,
        delegations: result.delegations,
        shardId: shard?.id || 'local',
        usage: result.usage,
      }));
    } catch (err) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: err.message }));
    }
    return;
  }

  // API: Pantheon overview
  if (path === '/nyx/api/pantheon' && req.method === 'GET') {
    try {
      const overview = getPantheonOverview();
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(overview));
    } catch (err) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: err.message }));
    }
    return;
  }

  // API: Activity feed
  if (path === '/nyx/api/activity' && req.method === 'GET') {
    const limit = parseInt(url.searchParams.get('limit')) || 50;
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(getActivity(limit)));
    return;
  }

  // API: Exec
  if (path === '/nyx/api/exec' && req.method === 'POST') {
    try {
      const chunks = []; for await (const chunk of req) chunks.push(chunk);
      const body = JSON.parse(Buffer.concat(chunks).toString());
      const result = await nyxExec(body.command);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(result));
    } catch (err) { res.writeHead(400, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ error: err.message })); }
    return;
  }

  // 404
  res.writeHead(404, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({ error: 'Unknown Nyx endpoint' }));
}

// ============ Login Page ============

function getNyxLoginHTML() {
  return `<!DOCTYPE html>
<html><head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>Nyx \u2014 Login</title>
<style>
*{margin:0;padding:0;box-sizing:border-box}
body{font-family:'SF Mono',Monaco,Consolas,monospace;background:#0a0a0a;color:#e0e0e0;display:flex;align-items:center;justify-content:center;min-height:100vh}
.login{background:#141414;border:1px solid #222;border-radius:12px;padding:40px;max-width:400px;width:90%}
h1{color:#a855f7;font-size:1.5em;margin-bottom:4px}
.sub{color:#666;font-size:0.85em;margin-bottom:24px}
input{width:100%;padding:10px 14px;background:#0d0d0d;border:1px solid #333;border-radius:6px;color:#e0e0e0;font-family:inherit;font-size:0.9em;margin-bottom:12px}
input:focus{outline:none;border-color:#a855f7}
button{width:100%;padding:10px;background:#a855f7;color:#fff;border:none;border-radius:6px;font-weight:700;cursor:pointer;font-family:inherit;font-size:0.9em}
button:hover{background:#9333ea}
.err{color:#ff4444;font-size:0.8em;margin-top:8px;display:none}
</style>
</head><body>
<div class="login">
<h1>\u25C6 Nyx</h1>
<div class="sub">Pantheon Command Center \u2014 Enter API secret</div>
<input id="secret" type="password" placeholder="API Secret" autofocus>
<button onclick="login()">Enter the Pantheon</button>
<div class="err" id="err">Invalid secret</div>
</div>
<script>
document.getElementById('secret').addEventListener('keydown',e=>{if(e.key==='Enter')login()});
async function login(){
const secret=document.getElementById('secret').value;
const r=await fetch('/nyx/api/files',{headers:{'x-api-secret':secret}});
if(r.ok){localStorage.setItem('nyx-secret',secret);window.location.href='/nyx?t='+encodeURIComponent(secret)}
else{document.getElementById('err').style.display='block'}
}
const s=localStorage.getItem('nyx-secret');
if(s){fetch('/nyx/api/files',{headers:{'x-api-secret':s}}).then(r=>{if(r.ok)window.location.href='/nyx?t='+encodeURIComponent(s)})}
</script>
</body></html>`;
}

// ============ Main Interface — Pantheon Command Center ============

function getNyxHTML() {
  const shard = getShardInfo();
  const godMeta = getAllGodMeta();

  // Build agent options for the selector
  const agentOptions = Object.entries(godMeta).map(([id, meta]) =>
    `<option value="${id}" data-color="${meta.color}">${meta.symbol} ${id.toUpperCase()} (${meta.label})</option>`
  ).join('');

  // God meta as JSON for client-side use
  const godMetaJSON = JSON.stringify(godMeta);

  return `<!DOCTYPE html>
<html><head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>Nyx \u25C6 Pantheon</title>
<style>
*{margin:0;padding:0;box-sizing:border-box}
body{font-family:'SF Mono',Monaco,Consolas,monospace;background:#0a0a0a;color:#e0e0e0;height:100vh;display:flex;flex-direction:column;overflow:hidden}

/* Header */
.header{background:#111;border-bottom:1px solid #222;padding:8px 16px;display:flex;align-items:center;gap:12px;flex-shrink:0}
.header h1{color:#a855f7;font-size:1.1em}
.header .shard{color:#666;font-size:0.8em}
.header .status{color:#00ff88;font-size:0.75em}
.header .root-hash{color:#444;font-size:0.7em;margin-left:auto;font-family:inherit}
.main{display:flex;flex:1;overflow:hidden}

/* Chat Panel */
.chat{width:50%;border-right:1px solid #222;display:flex;flex-direction:column}
.chat-header{padding:8px 12px;background:#0d0d0d;border-bottom:1px solid #1a1a1a;display:flex;align-items:center;gap:8px}
.chat-header label{font-size:0.7em;text-transform:uppercase;letter-spacing:1px;color:#666}
.chat-header select{background:#141414;border:1px solid #333;border-radius:4px;color:#e0e0e0;font-family:inherit;font-size:0.8em;padding:3px 6px;cursor:pointer}
.chat-header select:focus{outline:none;border-color:#a855f7}
.messages{flex:1;overflow-y:auto;padding:12px}
.msg{margin-bottom:16px;line-height:1.5}
.msg .role{font-size:0.7em;text-transform:uppercase;letter-spacing:1px;margin-bottom:2px;display:flex;align-items:center;gap:6px}
.msg .role.user{color:#a855f7}
.msg .role.nyx{color:#a855f7}
.msg .role.god{color:#3b82f6}
.msg .text{font-size:0.85em;white-space:pre-wrap;word-break:break-word}
.msg .task-info{font-size:0.65em;color:#444;margin-top:2px}

/* Delegation display */
.delegations{margin:8px 0;border-left:2px solid #222;padding-left:12px}
.delegation{margin-bottom:8px;padding:6px 8px;background:#0d0d0d;border-radius:4px;border-left:3px solid #333}
.delegation .god-header{font-size:0.7em;text-transform:uppercase;letter-spacing:1px;margin-bottom:2px;display:flex;align-items:center;gap:4px}
.delegation .god-text{font-size:0.8em;color:#bbb;white-space:pre-wrap}
.delegation.collapsed .god-text{display:none}

/* Chat input */
.chat-input{display:flex;border-top:1px solid #222;flex-shrink:0}
.chat-input textarea{flex:1;background:#0d0d0d;border:none;color:#e0e0e0;padding:10px 12px;font-family:inherit;font-size:0.85em;resize:none;height:60px}
.chat-input textarea:focus{outline:none}
.chat-input button{background:#a855f7;color:#fff;border:none;padding:0 20px;cursor:pointer;font-family:inherit;font-weight:700}
.chat-input button:hover{background:#9333ea}
.chat-input button:disabled{background:#333;color:#666;cursor:wait}

/* Right Panel */
.code{width:50%;display:flex;flex-direction:column}
.code-tabs{display:flex;background:#0d0d0d;border-bottom:1px solid #1a1a1a;flex-shrink:0;flex-wrap:wrap}
.code-tab{padding:8px 12px;font-size:0.7em;text-transform:uppercase;letter-spacing:1px;color:#666;cursor:pointer;border-bottom:2px solid transparent;white-space:nowrap}
.code-tab.active{color:#a855f7;border-bottom-color:#a855f7}
.code-tab:hover{color:#888}
.code-panel{flex:1;overflow:hidden;display:flex;flex-direction:column}

/* File Browser */
.file-browser{flex:1;overflow-y:auto;display:none}
.file-browser.active{display:block}
.breadcrumb{padding:8px 12px;background:#0d0d0d;border-bottom:1px solid #1a1a1a;font-size:0.8em}
.breadcrumb span{color:#a855f7;cursor:pointer}
.breadcrumb span:hover{text-decoration:underline}
.file-entry{padding:6px 12px;cursor:pointer;font-size:0.85em;display:flex;align-items:center;gap:8px;border-bottom:1px solid #0d0d0d}
.file-entry:hover{background:#141414}
.file-entry .icon{color:#666;width:16px}
.file-entry .name{flex:1}
.file-entry .size{color:#555;font-size:0.8em}
.file-entry.dir .icon{color:#a855f7}
.file-entry.dir .name{color:#a855f7}

/* Editor */
.editor-container{flex:1;overflow:hidden;display:none;flex-direction:column}
.editor-container.active{display:flex}
.editor-header{padding:6px 12px;background:#0d0d0d;border-bottom:1px solid #1a1a1a;display:flex;align-items:center;justify-content:space-between;font-size:0.8em;flex-shrink:0}
.editor-header .path{color:#888}
.editor-header button{background:#a855f7;color:#fff;border:none;padding:4px 12px;border-radius:4px;cursor:pointer;font-family:inherit;font-size:0.8em}
.editor-header button:hover{background:#9333ea}
.editor{flex:1;overflow:auto}
.editor textarea{width:100%;height:100%;background:#0a0a0a;color:#e0e0e0;border:none;padding:12px;font-family:inherit;font-size:0.85em;resize:none;tab-size:2;line-height:1.5}
.editor textarea:focus{outline:none}

/* Terminal */
.terminal-container{flex:1;overflow:hidden;display:none;flex-direction:column}
.terminal-container.active{display:flex}
.terminal-output{flex:1;overflow-y:auto;padding:12px;font-size:0.8em;white-space:pre-wrap;background:#050505}
.terminal-input{display:flex;border-top:1px solid #222;flex-shrink:0}
.terminal-input span{padding:8px 4px 8px 12px;color:#a855f7;font-size:0.85em}
.terminal-input input{flex:1;background:#0d0d0d;border:none;color:#e0e0e0;padding:8px;font-family:inherit;font-size:0.85em}
.terminal-input input:focus{outline:none}

/* Pantheon Tab */
.pantheon-container{flex:1;overflow-y:auto;display:none;padding:16px}
.pantheon-container.active{display:block}
.pantheon-tree{margin:0}
.god-node{padding:6px 8px;margin:2px 0;border-radius:4px;display:flex;align-items:center;gap:8px;cursor:pointer;transition:background 0.15s}
.god-node:hover{background:#1a1a1a}
.god-node .god-symbol{font-size:1.1em;width:20px;text-align:center}
.god-node .god-name{font-weight:700;font-size:0.85em;text-transform:uppercase}
.god-node .god-domain{color:#666;font-size:0.75em;flex:1}
.god-node .god-tier{color:#444;font-size:0.65em;padding:1px 6px;border:1px solid #333;border-radius:3px}
.god-node .god-hash{color:#333;font-size:0.6em;font-family:inherit}
.god-node.t0{border-left:3px solid #a855f7}
.god-node.t1{margin-left:24px;border-left:3px solid #333}
.god-node.t2{margin-left:48px;border-left:3px solid #222}
.pantheon-meta{margin-top:16px;padding-top:12px;border-top:1px solid #1a1a1a;font-size:0.75em;color:#555}
.pantheon-meta div{margin:4px 0}

/* Activity Tab */
.activity-container{flex:1;overflow-y:auto;display:none;padding:8px 12px}
.activity-container.active{display:block}
.activity-event{padding:4px 0;border-bottom:1px solid #0d0d0d;font-size:0.8em;display:flex;gap:8px;align-items:baseline}
.activity-event .ev-time{color:#444;font-size:0.75em;min-width:65px}
.activity-event .ev-type{font-weight:700;min-width:80px;text-transform:uppercase;font-size:0.7em;letter-spacing:0.5px}
.activity-event .ev-detail{color:#bbb;flex:1}
.ev-classify{color:#a855f7}
.ev-route{color:#3b82f6}
.ev-direct{color:#888}
.ev-delegate{color:#f59e0b}
.ev-multi-start{color:#ef4444}
.ev-synthesize{color:#10b981}

.spinner{display:inline-block;width:12px;height:12px;border:2px solid #333;border-top-color:#a855f7;border-radius:50%;animation:spin 0.6s linear infinite}
@keyframes spin{to{transform:rotate(360deg)}}
</style>
</head><body>

<div class="header">
<h1>\u25C6 Nyx</h1>
<span class="shard">${shard?.id || 'local'}</span>
<span class="status">\u25CF online</span>
<span class="root-hash" id="root-hash"></span>
</div>

<div class="main">
<!-- Chat Panel -->
<div class="chat">
<div class="chat-header">
<label>Agent:</label>
<select id="agent-select">
${agentOptions}
</select>
</div>
<div class="messages" id="messages"></div>
<div class="chat-input">
<textarea id="chat-input" placeholder="Talk to the Pantheon..." rows="2"></textarea>
<button id="send-btn" onclick="sendMessage()">Send</button>
</div>
</div>

<!-- Right Panel -->
<div class="code">
<div class="code-tabs">
<div class="code-tab" onclick="switchTab('pantheon')">Pantheon</div>
<div class="code-tab active" onclick="switchTab('files')">Files</div>
<div class="code-tab" onclick="switchTab('editor')">Editor</div>
<div class="code-tab" onclick="switchTab('terminal')">Terminal</div>
<div class="code-tab" onclick="switchTab('activity')">Activity</div>
</div>
<div class="code-panel">
<!-- Pantheon -->
<div class="pantheon-container" id="tab-pantheon"></div>
<!-- File Browser -->
<div class="file-browser active" id="tab-files">
<div class="breadcrumb" id="breadcrumb"></div>
<div id="file-list"></div>
</div>
<!-- Editor -->
<div class="editor-container" id="tab-editor">
<div class="editor-header">
<span class="path" id="editor-path">No file open</span>
<button onclick="saveFile()" id="save-btn" style="display:none">Save</button>
</div>
<div class="editor">
<textarea id="editor-textarea" placeholder="Select a file from the browser..." disabled></textarea>
</div>
</div>
<!-- Terminal -->
<div class="terminal-container" id="tab-terminal">
<div class="terminal-output" id="terminal-output">$ Ready.\\n</div>
<div class="terminal-input">
<span>$</span>
<input id="terminal-input" placeholder="Enter command...">
</div>
</div>
<!-- Activity -->
<div class="activity-container" id="tab-activity"></div>
</div>
</div>
</div>

<script>
// Store token from URL, then clean it
const urlToken=new URLSearchParams(window.location.search).get('t');
if(urlToken){localStorage.setItem('nyx-secret',urlToken);history.replaceState(null,'','/nyx')}
const SECRET=localStorage.getItem('nyx-secret')||'';
const H={'Content-Type':'application/json','x-api-secret':SECRET};
let currentPath='';
let currentFile=null;

// God metadata from server
const GOD_META=${godMetaJSON};
const TAB_NAMES=['pantheon','files','editor','terminal','activity'];

// ============ Chat ============
const msgEl=document.getElementById('messages');
const chatInput=document.getElementById('chat-input');
const sendBtn=document.getElementById('send-btn');
const agentSelect=document.getElementById('agent-select');

chatInput.addEventListener('keydown',e=>{
if(e.key==='Enter'&&!e.shiftKey){e.preventDefault();sendMessage()}
});

function addMsg(role,text,extra={}){
const d=document.createElement('div');d.className='msg';
const meta=GOD_META[role]||GOD_META.nyx;
const roleClass=role==='user'?'user':(role==='nyx'?'nyx':'god');
const symbol=role==='user'?'\u25B7':(meta?.symbol||'\u25C6');
const color=role==='user'?'#a855f7':(meta?.color||'#a855f7');

let html='<div class="role '+roleClass+'" style="color:'+color+'">'+symbol+' '+role.toUpperCase();
if(extra.type&&extra.type!=='direct') html+=' <span style="color:#444;font-size:0.9em">(\u2060'+extra.type+')</span>';
html+='</div>';
html+='<div class="text"></div>';

// Delegations
if(extra.delegations&&extra.delegations.length>0){
html+='<div class="delegations">';
for(const del of extra.delegations){
const gm=GOD_META[del.god]||{symbol:'?',color:'#666'};
html+='<div class="delegation" style="border-left-color:'+gm.color+'" onclick="this.classList.toggle(\'collapsed\')">';
html+='<div class="god-header" style="color:'+gm.color+'">'+gm.symbol+' '+del.god.toUpperCase()+' <span style="color:#555;font-size:0.9em">'+((del.domain||'').split(',')[0])+'</span></div>';
html+='<div class="god-text"></div>';
html+='</div>';
}
html+='</div>';
}

if(extra.taskId) html+='<div class="task-info">'+extra.taskId+'</div>';

d.innerHTML=html;
// Set text content safely (no XSS)
const textEl=d.querySelector('.text');
if(textEl) textEl.textContent=text;

// Set delegation texts safely
if(extra.delegations){
const godTexts=d.querySelectorAll('.god-text');
extra.delegations.forEach((del,i)=>{
if(godTexts[i]) godTexts[i].textContent=del.text||'';
});
}

msgEl.appendChild(d);msgEl.scrollTop=msgEl.scrollHeight;
}

async function sendMessage(){
const msg=chatInput.value.trim();
if(!msg)return;
chatInput.value='';
addMsg('user',msg);
sendBtn.disabled=true;sendBtn.innerHTML='<span class="spinner"></span>';

const agent=agentSelect.value;

try{
const r=await fetch('/nyx/api/chat',{method:'POST',headers:H,body:JSON.stringify({message:msg,agent})});
const data=await r.json();
if(data.error){
addMsg('nyx','Error: '+data.error);
}else{
addMsg(data.speaker||'nyx',data.response,{
type:data.type,
delegations:data.delegations,
taskId:data.taskId,
});
}
}catch(e){addMsg('nyx','Error: '+e.message)}
sendBtn.disabled=false;sendBtn.textContent='Send';
}

// ============ Tabs ============
function switchTab(name){
document.querySelectorAll('.code-tab').forEach((t,i)=>t.classList.toggle('active',TAB_NAMES[i]===name));
document.querySelectorAll('.code-panel > div').forEach(p=>p.classList.remove('active'));
const el=document.getElementById('tab-'+name);
if(el) el.classList.add('active');
if(name==='terminal')document.getElementById('terminal-input').focus();
if(name==='pantheon')loadPantheon();
if(name==='activity')loadActivity();
}

// ============ Pantheon Tab ============
async function loadPantheon(){
try{
const r=await fetch('/nyx/api/pantheon',{headers:H});
const data=await r.json();
renderPantheon(data);
document.getElementById('root-hash').textContent=data.rootHashShort?('root: '+data.rootHashShort+'...'):'';
}catch(e){
document.getElementById('tab-pantheon').innerHTML='<div style="padding:16px;color:#ff4444">'+e.message+'</div>';
}
}

function renderPantheon(data){
const el=document.getElementById('tab-pantheon');
if(!data.gods||data.gods.length===0){el.innerHTML='<div style="padding:16px;color:#666">No agents initialized</div>';return}

// Sort by tier then name
const sorted=[...data.gods].sort((a,b)=>a.tier-b.tier||a.id.localeCompare(b.id));
let html='<div class="pantheon-tree">';

for(const god of sorted){
const meta=GOD_META[god.id]||{symbol:'?',color:'#666'};
const hashShort=god.hash?god.hash.slice(0,12)+'...':'';
html+='<div class="god-node t'+god.tier+'" onclick="selectGod(\''+god.id+'\')" style="border-left-color:'+meta.color+'">';
html+='<span class="god-symbol" style="color:'+meta.color+'">'+meta.symbol+'</span>';
html+='<span class="god-name" style="color:'+meta.color+'">'+god.id+'</span>';
html+='<span class="god-domain">'+god.domain.split(',')[0]+'</span>';
html+='<span class="god-tier">T'+god.tier+'</span>';
if(hashShort) html+='<span class="god-hash">'+hashShort+'</span>';
html+='</div>';
}

html+='</div>';
html+='<div class="pantheon-meta">';
html+='<div>Root Hash: <span style="color:#a855f7">'+(data.rootHashShort||'none')+'</span></div>';
html+='<div>Tasks: '+data.taskCount+' | Events: '+data.activityCount+'</div>';
html+='</div>';

el.innerHTML=html;
}

function selectGod(id){
agentSelect.value=id;
chatInput.focus();
chatInput.placeholder='Talk to '+id.toUpperCase()+'...';
}

// ============ Activity Tab ============
async function loadActivity(){
try{
const r=await fetch('/nyx/api/activity?limit=100',{headers:H});
const events=await r.json();
renderActivity(events);
}catch(e){
document.getElementById('tab-activity').innerHTML='<div style="padding:12px;color:#ff4444">'+e.message+'</div>';
}
}

function renderActivity(events){
const el=document.getElementById('tab-activity');
if(!events||events.length===0){el.innerHTML='<div style="padding:12px;color:#666">No activity yet</div>';return}

let html='';
for(const ev of events.slice().reverse()){
const time=ev.ts?new Date(ev.ts).toLocaleTimeString('en-US',{hour12:false}):'';
const typeClass='ev-'+(ev.type||'').replace(/[^a-z-]/g,'');
let detail='';

switch(ev.type){
case 'classify':
detail=(ev.strategy||'')+' \u2192 '+(ev.reason||'');
if(ev.target) detail+=' ['+ev.target+']';
if(ev.message) detail+=' "'+ev.message+'"';
break;
case 'route':
detail='\u2192 '+(ev.god||'')+' ('+(ev.domain||'').split(',')[0]+')';
break;
case 'direct':
detail='Nyx handling directly';
break;
case 'delegate':
detail='nyx \u2192 '+(ev.god||'');
break;
case 'multi-start':
detail='Parallel: '+(ev.gods||[]).join(', ');
break;
case 'synthesize':
detail='Combining god responses...';
break;
default:
detail=JSON.stringify(ev).slice(0,100);
}

html+='<div class="activity-event">';
html+='<span class="ev-time">'+time+'</span>';
html+='<span class="ev-type '+typeClass+'">'+(ev.type||'?')+'</span>';
html+='<span class="ev-detail">'+detail+'</span>';
html+='</div>';
}
el.innerHTML=html;
}

// ============ File Browser ============
async function loadFiles(path){
currentPath=path||'';
try{
const r=await fetch('/nyx/api/files?path='+encodeURIComponent(currentPath),{headers:H});
const data=await r.json();
if(data.error){document.getElementById('file-list').innerHTML='<div style="padding:12px;color:#ff4444">'+data.error+'</div>';return}

const bc=document.getElementById('breadcrumb');
const parts=currentPath?currentPath.split(/[\\\\/]/).filter(Boolean):[];
let bcHtml='<span onclick="loadFiles(\\'\\')">repo</span>';
let buildPath='';
for(const p of parts){buildPath+=(buildPath?'/':'')+p;bcHtml+=' / <span onclick="loadFiles(\\''+buildPath+'\\')">'+p+'</span>'}
bc.innerHTML=bcHtml;

const list=document.getElementById('file-list');
let html='';
if(currentPath){html+='<div class="file-entry dir" onclick="loadFiles(\\''+parts.slice(0,-1).join('/')+'\\')" ><span class="icon">..</span><span class="name">..</span></div>'}
for(const e of data.entries){
const ePath=currentPath?(currentPath+'/'+e.name):e.name;
if(e.type==='dir'){
html+='<div class="file-entry dir" onclick="loadFiles(\\''+ePath.replace(/'/g,"\\\\'")+'\\')"><span class="icon">D</span><span class="name">'+e.name+'</span></div>';
}else{
const size=e.size!=null?(e.size>1024?Math.round(e.size/1024)+'K':e.size+'B'):'';
html+='<div class="file-entry" onclick="openFile(\\''+ePath.replace(/'/g,"\\\\'")+'\\')"><span class="icon">F</span><span class="name">'+e.name+'</span><span class="size">'+size+'</span></div>';
}
}
list.innerHTML=html;
}catch(e){document.getElementById('file-list').innerHTML='<div style="padding:12px;color:#ff4444">'+e.message+'</div>'}
}

async function openFile(path){
try{
const r=await fetch('/nyx/api/file?path='+encodeURIComponent(path),{headers:H});
const data=await r.json();
if(data.error){alert('Error: '+data.error);return}
currentFile=path;
document.getElementById('editor-path').textContent=path;
document.getElementById('editor-textarea').value=data.content;
document.getElementById('editor-textarea').disabled=false;
document.getElementById('save-btn').style.display='';
switchTab('editor');
}catch(e){alert('Error: '+e.message)}
}

async function saveFile(){
if(!currentFile)return;
const content=document.getElementById('editor-textarea').value;
try{
const r=await fetch('/nyx/api/file',{method:'POST',headers:H,body:JSON.stringify({path:currentFile,content})});
const data=await r.json();
if(data.error)alert('Save failed: '+data.error);
else document.getElementById('save-btn').textContent='Saved!';
setTimeout(()=>document.getElementById('save-btn').textContent='Save',1500);
}catch(e){alert('Save failed: '+e.message)}
}

// ============ Terminal ============
const termOut=document.getElementById('terminal-output');
const termIn=document.getElementById('terminal-input');

termIn.addEventListener('keydown',async e=>{
if(e.key!=='Enter')return;
const cmd=termIn.value.trim();
if(!cmd)return;
termIn.value='';
termOut.textContent+='$ '+cmd+'\\n';
try{
const r=await fetch('/nyx/api/exec',{method:'POST',headers:H,body:JSON.stringify({command:cmd})});
const data=await r.json();
if(data.stdout)termOut.textContent+=data.stdout;
if(data.stderr)termOut.textContent+=data.stderr;
if(data.exitCode!==0)termOut.textContent+='[exit: '+data.exitCode+']\\n';
}catch(e){termOut.textContent+='Error: '+e.message+'\\n'}
termOut.scrollTop=termOut.scrollHeight;
});

// ============ Auto-refresh ============
let activityTimer=null;
function startActivityPolling(){
if(activityTimer)return;
activityTimer=setInterval(()=>{
const tab=document.querySelector('.code-tab.active');
if(tab&&tab.textContent.trim().toLowerCase()==='activity') loadActivity();
},3000);
}

// ============ Init ============
loadFiles('');
loadPantheon();
startActivityPolling();

// Agent select change updates placeholder
agentSelect.addEventListener('change',()=>{
const id=agentSelect.value;
const meta=GOD_META[id];
chatInput.placeholder='Talk to '+id.toUpperCase()+(meta?' ('+meta.label+')':'')+'...';
});
</script>
</body></html>`;
}
