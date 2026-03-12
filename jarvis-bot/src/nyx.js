// ============ Nyx — Per-Node Agent Interface ============
//
// Freedom's vision: each VPS node gets a web interface where you can
// TALK to the LLM and WORK on code. Named after the Greek goddess of night.
//
// Endpoints:
//   GET  /nyx           — Main web interface (chat + file browser + editor)
//   POST /nyx/api/chat  — Send message to the LLM on this node
//   GET  /nyx/api/files — List directory contents within the repo
//   GET  /nyx/api/file  — Read a file from the repo
//   POST /nyx/api/file  — Write a file to the repo
//   POST /nyx/api/exec  — Run a shell command in the repo directory
//
// All endpoints are auth-gated with x-api-secret header.
// ============

import { readFile, writeFile, readdir, stat, mkdir } from 'fs/promises';
import { join, resolve, relative, extname } from 'path';
import { exec } from 'child_process';
import { config } from './config.js';
import { getShardInfo } from './shard.js';

const REPO_PATH = config.repo.path;
const MAX_FILE_SIZE = 100 * 1024; // 100KB max file read
const EXEC_TIMEOUT = 15000; // 15s command timeout

// ============ Auth ============

export function nyxAuth(req) {
  const secret = process.env.CLAUDE_CODE_API_SECRET;
  if (!secret) return false; // No secret configured = Nyx disabled
  return req.headers['x-api-secret'] === secret;
}

// ============ Path Safety ============

function safePath(userPath) {
  if (!userPath) return REPO_PATH;
  const resolved = resolve(REPO_PATH, userPath);
  if (!resolved.startsWith(resolve(REPO_PATH))) return null; // traversal attempt
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
      // Skip hidden dirs and node_modules at top level
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

    // Sort: dirs first, then files, alphabetical
    items.sort((a, b) => {
      if (a.type !== b.type) return a.type === 'dir' ? -1 : 1;
      return a.name.localeCompare(b.name);
    });

    return {
      path: relative(REPO_PATH, dirPath) || '.',
      entries: items,
    };
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
    return {
      path: relative(REPO_PATH, filePath),
      content,
      size: s.size,
      modified: s.mtime?.toISOString(),
    };
  } catch (err) {
    return { error: err.message };
  }
}

export async function nyxWriteFile(filePath, content) {
  const resolved = safePath(filePath);
  if (!resolved) return { error: 'Path outside repository' };

  try {
    // Ensure parent directory exists
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
      cwd: REPO_PATH,
      timeout: EXEC_TIMEOUT,
      maxBuffer: 512 * 1024,
      shell: true,
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

  // Auth check — everything behind the gate
  if (!nyxAuth(req)) {
    if (path === '/nyx' || path === '/nyx/') {
      // Show login page instead of 401
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(getNyxLoginHTML());
      return;
    }
    res.writeHead(401, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Unauthorized — x-api-secret header required' }));
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
    if (!filePath) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'path parameter required' }));
      return;
    }
    const result = await nyxReadFile(filePath);
    res.writeHead(result.error ? 400 : 200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(result));
    return;
  }

  // API: Write file
  if (path === '/nyx/api/file' && req.method === 'POST') {
    try {
      const chunks = [];
      for await (const chunk of req) chunks.push(chunk);
      const body = JSON.parse(Buffer.concat(chunks).toString());
      if (!body.path || body.content == null) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'path and content required' }));
        return;
      }
      const result = await nyxWriteFile(body.path, body.content);
      res.writeHead(result.error ? 400 : 200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(result));
    } catch (err) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: err.message }));
    }
    return;
  }

  // API: Chat
  if (path === '/nyx/api/chat' && req.method === 'POST') {
    try {
      const chunks = [];
      for await (const chunk of req) chunks.push(chunk);
      const body = JSON.parse(Buffer.concat(chunks).toString());
      if (!body.message) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'message required' }));
        return;
      }
      const { chat } = await import('./claude.js');
      const response = await chat(
        body.chatId || 'nyx',
        body.userName || 'nyx-user',
        body.message,
        'private'
      );
      const shard = getShardInfo();
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        response: response.text,
        shardId: shard?.id || 'local',
        usage: response.usage,
      }));
    } catch (err) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: err.message }));
    }
    return;
  }

  // API: Exec
  if (path === '/nyx/api/exec' && req.method === 'POST') {
    try {
      const chunks = [];
      for await (const chunk of req) chunks.push(chunk);
      const body = JSON.parse(Buffer.concat(chunks).toString());
      const result = await nyxExec(body.command);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(result));
    } catch (err) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: err.message }));
    }
    return;
  }

  // 404
  res.writeHead(404, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({ error: 'Unknown Nyx endpoint' }));
}

// ============ Login Page (No Auth) ============

function getNyxLoginHTML() {
  return `<!DOCTYPE html>
<html><head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>Nyx — Login</title>
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
<h1>Nyx</h1>
<div class="sub">Agent Interface — Enter API secret to continue</div>
<input id="secret" type="password" placeholder="API Secret" autofocus>
<button onclick="login()">Enter</button>
<div class="err" id="err">Invalid secret</div>
</div>
<script>
document.getElementById('secret').addEventListener('keydown',e=>{if(e.key==='Enter')login()});
async function login(){
const secret=document.getElementById('secret').value;
const r=await fetch('/nyx/api/files',{headers:{'x-api-secret':secret}});
if(r.ok){localStorage.setItem('nyx-secret',secret);await loadNyx(secret)}
else{document.getElementById('err').style.display='block'}
}
async function loadNyx(secret){
const r=await fetch('/nyx',{headers:{'x-api-secret':secret}});
const html=await r.text();
document.open();document.write(html);document.close();
}
// Auto-login if secret stored
const s=localStorage.getItem('nyx-secret');
if(s){fetch('/nyx/api/files',{headers:{'x-api-secret':s}}).then(r=>{if(r.ok)loadNyx(s)})}
</script>
</body></html>`;
}

// ============ Main Interface ============

function getNyxHTML() {
  const shard = getShardInfo();
  return `<!DOCTYPE html>
<html><head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>Nyx — ${shard?.id || 'local'}</title>
<style>
*{margin:0;padding:0;box-sizing:border-box}
body{font-family:'SF Mono',Monaco,Consolas,monospace;background:#0a0a0a;color:#e0e0e0;height:100vh;display:flex;flex-direction:column;overflow:hidden}
.header{background:#111;border-bottom:1px solid #222;padding:8px 16px;display:flex;align-items:center;gap:12px;flex-shrink:0}
.header h1{color:#a855f7;font-size:1.1em}
.header .shard{color:#666;font-size:0.8em}
.header .status{color:#00ff88;font-size:0.75em}
.main{display:flex;flex:1;overflow:hidden}

/* Chat Panel */
.chat{width:50%;border-right:1px solid #222;display:flex;flex-direction:column}
.chat-header{padding:8px 12px;background:#0d0d0d;border-bottom:1px solid #1a1a1a;font-size:0.75em;color:#888;text-transform:uppercase;letter-spacing:1px}
.messages{flex:1;overflow-y:auto;padding:12px}
.msg{margin-bottom:12px;line-height:1.5}
.msg .role{font-size:0.7em;text-transform:uppercase;letter-spacing:1px;margin-bottom:2px}
.msg .role.user{color:#a855f7}
.msg .role.assistant{color:#00ff88}
.msg .text{font-size:0.85em;white-space:pre-wrap;word-break:break-word}
.chat-input{display:flex;border-top:1px solid #222;flex-shrink:0}
.chat-input textarea{flex:1;background:#0d0d0d;border:none;color:#e0e0e0;padding:10px 12px;font-family:inherit;font-size:0.85em;resize:none;height:60px}
.chat-input textarea:focus{outline:none}
.chat-input button{background:#a855f7;color:#fff;border:none;padding:0 20px;cursor:pointer;font-family:inherit;font-weight:700}
.chat-input button:hover{background:#9333ea}
.chat-input button:disabled{background:#333;color:#666;cursor:wait}

/* Code Panel */
.code{width:50%;display:flex;flex-direction:column}
.code-tabs{display:flex;background:#0d0d0d;border-bottom:1px solid #1a1a1a;flex-shrink:0}
.code-tab{padding:8px 16px;font-size:0.75em;text-transform:uppercase;letter-spacing:1px;color:#666;cursor:pointer;border-bottom:2px solid transparent}
.code-tab.active{color:#a855f7;border-bottom-color:#a855f7}
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

.spinner{display:inline-block;width:12px;height:12px;border:2px solid #333;border-top-color:#a855f7;border-radius:50%;animation:spin 0.6s linear infinite}
@keyframes spin{to{transform:rotate(360deg)}}
</style>
</head><body>

<div class="header">
<h1>Nyx</h1>
<span class="shard">${shard?.id || 'local'}</span>
<span class="status">online</span>
</div>

<div class="main">
<!-- Chat Panel -->
<div class="chat">
<div class="chat-header">conversation</div>
<div class="messages" id="messages"></div>
<div class="chat-input">
<textarea id="chat-input" placeholder="Talk to this agent..." rows="2"></textarea>
<button id="send-btn" onclick="sendMessage()">Send</button>
</div>
</div>

<!-- Code Panel -->
<div class="code">
<div class="code-tabs">
<div class="code-tab active" onclick="switchTab('files')">Files</div>
<div class="code-tab" onclick="switchTab('editor')">Editor</div>
<div class="code-tab" onclick="switchTab('terminal')">Terminal</div>
</div>
<div class="code-panel">
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
<input id="terminal-input" placeholder="Enter command..." autofocus>
</div>
</div>
</div>
</div>
</div>

<script>
const SECRET=localStorage.getItem('nyx-secret')||'';
const H={'Content-Type':'application/json','x-api-secret':SECRET};
let currentPath='';
let currentFile=null;

// ============ Chat ============
const msgEl=document.getElementById('messages');
const chatInput=document.getElementById('chat-input');
const sendBtn=document.getElementById('send-btn');

chatInput.addEventListener('keydown',e=>{
if(e.key==='Enter'&&!e.shiftKey){e.preventDefault();sendMessage()}
});

function addMsg(role,text){
const d=document.createElement('div');d.className='msg';
d.innerHTML='<div class="role '+role+'">'+role+'</div><div class="text"></div>';
d.querySelector('.text').textContent=text;
msgEl.appendChild(d);msgEl.scrollTop=msgEl.scrollHeight;
}

async function sendMessage(){
const msg=chatInput.value.trim();
if(!msg)return;
chatInput.value='';
addMsg('user',msg);
sendBtn.disabled=true;sendBtn.textContent='...';
try{
const r=await fetch('/nyx/api/chat',{method:'POST',headers:H,body:JSON.stringify({message:msg})});
const data=await r.json();
if(data.error)addMsg('assistant','Error: '+data.error);
else addMsg('assistant',data.response);
}catch(e){addMsg('assistant','Error: '+e.message)}
sendBtn.disabled=false;sendBtn.textContent='Send';
}

// ============ Tabs ============
function switchTab(name){
document.querySelectorAll('.code-tab').forEach((t,i)=>t.classList.toggle('active',['files','editor','terminal'][i]===name));
document.querySelectorAll('.code-panel > div').forEach(p=>p.classList.remove('active'));
document.getElementById('tab-'+name).classList.add('active');
if(name==='terminal')document.getElementById('terminal-input').focus();
}

// ============ File Browser ============
async function loadFiles(path){
currentPath=path||'';
try{
const r=await fetch('/nyx/api/files?path='+encodeURIComponent(currentPath),{headers:H});
const data=await r.json();
if(data.error){document.getElementById('file-list').innerHTML='<div style="padding:12px;color:#ff4444">'+data.error+'</div>';return}

// Breadcrumb
const bc=document.getElementById('breadcrumb');
const parts=currentPath?currentPath.split(/[\\/]/).filter(Boolean):[];
let bcHtml='<span onclick="loadFiles(\\'\\')">repo</span>';
let buildPath='';
for(const p of parts){buildPath+=(buildPath?'/':'')+p;bcHtml+=' / <span onclick="loadFiles(\\''+buildPath+'\\')">'+p+'</span>'}
bc.innerHTML=bcHtml;

// Entries
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

// Init
loadFiles('');
</script>
</body></html>`;
}
