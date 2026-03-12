// ============ TheAI Dashboard — Digital Corporation Visualization ============
//
// Web interface for the Pantheon agent system.
// Shows hierarchy, agent status, costs, and inline chat.
//
// Endpoints:
//   GET  /theai              — Dashboard HTML
//   GET  /theai/api/status   — Full system status JSON
//   POST /theai/api/chat     — Chat with any agent
//   POST /theai/api/fork     — Fork new agent from archetype
//   POST /theai/api/prune    — Trigger prune cycle
//   GET  /theai/api/health   — Full pipeline health check
//
// Auth: x-api-secret header or ?t= token (same as Nyx)
// ============

import { nyxAuth } from './nyx.js'
import {
  listAgents, getArchetypes, getAllCosts, getInfraCosts,
  pantheonChat, forkAgent, pruneAll, clearConversation,
  getAgentCosts, consultAgent, getTheAIStatus,
  PANTHEON_TOOL_NAMES,
} from './pantheon.js'

// ============ Route Handler ============

export async function handleTheAIRequest(req, res, url) {
  const path = url.pathname

  // Auth — reuse Nyx's auth (same secret)
  if (!nyxAuth(req, url)) {
    if (path === '/theai' || path === '/theai/') {
      res.writeHead(302, { Location: `/nyx` }) // Redirect to Nyx login
      res.end()
      return
    }
    res.writeHead(401, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify({ error: 'Unauthorized' }))
    return
  }

  // Dashboard
  if (path === '/theai' || path === '/theai/') {
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' })
    res.end(getDashboardHTML())
    return
  }

  // API: System status
  if (path === '/theai/api/status') {
    const [agents, costs, infra] = await Promise.all([
      listAgents(), getAllCosts(), getInfraCosts(),
    ])
    const archetypes = getArchetypes()
    const agentDetails = agents.map(name => {
      const arch = archetypes[name]
      const cost = costs.agents[name]
      return {
        name, tier: arch?.tier ?? '?', domain: arch?.domain || 'custom',
        manager: arch?.manager || null, tradition: arch?.tradition || 'custom',
        costs: cost || { calls: 0, costUsd: 0 },
      }
    })
    res.writeHead(200, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify({ agents: agentDetails, archetypes, costs, infra }))
    return
  }

  // API: Chat
  if (path === '/theai/api/chat' && req.method === 'POST') {
    const chunks = []; for await (const c of req) chunks.push(c)
    const body = JSON.parse(Buffer.concat(chunks).toString())
    if (!body.agent || !body.message) {
      res.writeHead(400, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({ error: 'agent and message required' }))
      return
    }
    const response = await pantheonChat(body.agent, body.message, body.chatId || 'dashboard')
    res.writeHead(200, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify(response))
    return
  }

  // API: Fork
  if (path === '/theai/api/fork' && req.method === 'POST') {
    const chunks = []; for await (const c of req) chunks.push(c)
    const body = JSON.parse(Buffer.concat(chunks).toString())
    const result = await forkAgent(body.archetype, body.customizations || {})
    res.writeHead(200, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify(result))
    return
  }

  // API: Prune
  if (path === '/theai/api/prune' && req.method === 'POST') {
    const results = await pruneAll()
    res.writeHead(200, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify(results))
    return
  }

  // API: Health — full pipeline check
  if (path === '/theai/api/health') {
    const status = await getTheAIStatus()
    const health = {
      status: 'ok',
      agents: status.activeAgents,
      jarvisBridge: { wired: true, tools: PANTHEON_TOOL_NAMES },
      ollamaConfigured: !!process.env.OLLAMA_URL,
      model: process.env.PANTHEON_MODEL || (process.env.OLLAMA_URL ? 'qwen2.5:7b' : 'claude-sonnet-4-5-20250929'),
      nextPrune: status.nextPrune,
      totalCost: status.totalCost,
    }
    res.writeHead(200, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify(health))
    return
  }

  res.writeHead(404); res.end('Not found')
}

// ============ Dashboard HTML ============

function getDashboardHTML() {
  return `<!DOCTYPE html>
<html><head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>TheAI — Digital Corporation</title>
<style>
*{margin:0;padding:0;box-sizing:border-box}
body{font-family:'SF Mono',Monaco,Consolas,monospace;background:#050508;color:#e0e0e0;min-height:100vh}
.header{background:linear-gradient(135deg,#0a0a12,#12081f);border-bottom:1px solid #1a1a2e;padding:20px 24px;display:flex;align-items:center;justify-content:space-between}
.header h1{font-size:1.6em;background:linear-gradient(90deg,#a855f7,#6366f1,#ec4899);-webkit-background-clip:text;-webkit-text-fill-color:transparent}
.header .sub{color:#666;font-size:0.8em}
.header .stats{color:#888;font-size:0.75em;text-align:right}
.container{max-width:1400px;margin:0 auto;padding:20px}

/* Hierarchy */
.section{margin-bottom:24px}
.section-title{color:#a855f7;font-size:0.75em;text-transform:uppercase;letter-spacing:2px;margin-bottom:12px;padding-left:4px}
.tree{background:#0a0a12;border:1px solid #1a1a2e;border-radius:8px;padding:20px;font-size:0.85em;line-height:1.8}
.tree .node{color:#a855f7}.tree .peer{color:#00ff88}.tree .line{color:#333}
.tree .dormant{color:#555}

/* Agent Grid */
.grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(280px,1fr));gap:12px}
.card{background:#0a0a12;border:1px solid #1a1a2e;border-radius:8px;padding:16px;transition:border-color 0.2s}
.card:hover{border-color:#a855f7}
.card .name{font-size:1.1em;font-weight:700;margin-bottom:4px}
.card .tier{font-size:0.7em;color:#666;text-transform:uppercase;letter-spacing:1px}
.card .domain{font-size:0.8em;color:#888;margin:8px 0}
.card .meta{font-size:0.75em;color:#555;display:flex;gap:12px;margin-top:8px}
.card .meta span{display:flex;align-items:center;gap:4px}
.card.active .name{color:#a855f7}
.card.dormant .name{color:#555}
.card .chat-btn{margin-top:12px;background:#1a1a2e;border:1px solid #333;color:#a855f7;padding:6px 12px;border-radius:4px;cursor:pointer;font-family:inherit;font-size:0.8em;width:100%}
.card .chat-btn:hover{background:#a855f7;color:#fff;border-color:#a855f7}

/* Fork Section */
.fork-grid{display:flex;flex-wrap:wrap;gap:8px}
.fork-btn{background:#0a0a12;border:1px solid #1a1a2e;color:#888;padding:8px 14px;border-radius:6px;cursor:pointer;font-family:inherit;font-size:0.8em;transition:all 0.2s}
.fork-btn:hover{border-color:#a855f7;color:#a855f7}
.fork-btn.exists{border-color:#1a3a1a;color:#00ff88;cursor:default}

/* Chat Panel */
.chat-panel{background:#0a0a12;border:1px solid #1a1a2e;border-radius:8px;padding:16px;display:none}
.chat-panel.open{display:block}
.chat-header{display:flex;align-items:center;justify-content:space-between;margin-bottom:12px}
.chat-header h3{color:#a855f7;font-size:0.9em}
.chat-header button{background:none;border:none;color:#666;cursor:pointer;font-size:1.2em}
.chat-messages{max-height:300px;overflow-y:auto;margin-bottom:12px;font-size:0.85em}
.chat-messages .msg{margin-bottom:8px;line-height:1.5}
.chat-messages .msg.user{color:#a855f7}
.chat-messages .msg.agent{color:#e0e0e0}
.chat-messages .msg .label{font-size:0.7em;color:#555;text-transform:uppercase}
.chat-input-row{display:flex;gap:8px}
.chat-input-row input{flex:1;background:#050508;border:1px solid #333;color:#e0e0e0;padding:8px 12px;border-radius:4px;font-family:inherit;font-size:0.85em}
.chat-input-row input:focus{outline:none;border-color:#a855f7}
.chat-input-row button{background:#a855f7;color:#fff;border:none;padding:8px 16px;border-radius:4px;cursor:pointer;font-family:inherit;font-weight:700}
.chat-input-row button:disabled{background:#333;color:#666}

/* Costs */
.costs-bar{display:flex;gap:16px;flex-wrap:wrap}
.cost-item{background:#0a0a12;border:1px solid #1a1a2e;border-radius:8px;padding:12px 16px;min-width:140px}
.cost-item .label{font-size:0.7em;color:#666;text-transform:uppercase;letter-spacing:1px}
.cost-item .value{font-size:1.3em;color:#a855f7;margin-top:4px}
.cost-item .detail{font-size:0.75em;color:#555;margin-top:2px}

.loading{color:#555;font-style:italic}
</style>
</head><body>

<div class="header">
<div>
<h1>TheAI</h1>
<div class="sub">Digital Corporation — Pantheon Agent System</div>
</div>
<div class="stats" id="header-stats">Loading...</div>
</div>

<div class="container">

<!-- Hierarchy -->
<div class="section">
<div class="section-title">Hierarchy</div>
<div class="tree" id="tree">Loading...</div>
</div>

<!-- Chat Panel -->
<div class="chat-panel" id="chat-panel">
<div class="chat-header">
<h3 id="chat-agent-name">Chat</h3>
<button onclick="closeChat()">&times;</button>
</div>
<div class="chat-messages" id="chat-messages"></div>
<div class="chat-input-row">
<input id="chat-input" placeholder="Message..." onkeydown="if(event.key==='Enter')sendChat()">
<button onclick="sendChat()" id="chat-send">Send</button>
</div>
</div>

<!-- Active Agents -->
<div class="section">
<div class="section-title">Active Agents</div>
<div class="grid" id="agent-grid"><div class="loading">Loading...</div></div>
</div>

<!-- Fork -->
<div class="section">
<div class="section-title">Available Archetypes</div>
<div class="fork-grid" id="fork-grid"></div>
</div>

<!-- System Status -->
<div class="section">
<div class="section-title">System Status</div>
<div class="costs-bar" id="status-bar"><div class="loading">Loading...</div></div>
</div>

<!-- Costs -->
<div class="section">
<div class="section-title">Cost Tracking</div>
<div class="costs-bar" id="costs-bar"><div class="loading">Loading...</div></div>
</div>

</div>

<script>
const SECRET=new URLSearchParams(window.location.search).get('t')||localStorage.getItem('nyx-secret')||'';
if(SECRET&&window.location.search.includes('t=')){localStorage.setItem('nyx-secret',SECRET);history.replaceState(null,'','/theai')}
const H={'Content-Type':'application/json','x-api-secret':SECRET};
let currentAgent=null;

async function load(){
  const [r,hr]=await Promise.all([
    fetch('/theai/api/status',{headers:H}),
    fetch('/theai/api/health',{headers:H}),
  ]);
  const d=await r.json();
  const health=await hr.json();
  renderTree(d);
  renderAgents(d);
  renderFork(d);
  renderCosts(d);
  renderStatus(health);
  document.getElementById('header-stats').innerHTML=
    d.agents.length+' agents | '+d.costs.totalUsd+' total LLM cost';
}

function renderTree(d){
  const active=d.agents.map(a=>a.name);
  let html='<span class="node">NYX</span> <span class="line">────────</span> <span class="peer">JARVIS</span> <span class="line">(peer)</span>\\n';
  const t1=Object.entries(d.archetypes).filter(([_,a])=>a.tier===1);
  const t2=Object.entries(d.archetypes).filter(([_,a])=>a.tier===2);
  t1.forEach(([name,a],i)=>{
    const isLast=i===t1.length-1&&t2.filter(([_,x])=>x.manager===name).length===0;
    const prefix=isLast?'└── ':'├── ';
    const cls=active.includes(name)?'node':'dormant';
    html+='<span class="line">'+prefix+'</span><span class="'+cls+'">'+name.toUpperCase()+'</span> <span class="line">('+a.domain.split(',')[0]+')</span>\\n';
    const subs=t2.filter(([_,x])=>x.manager===name);
    subs.forEach(([sn,sa],si)=>{
      const subPre=isLast?'    ':'│   ';
      const subConn=si===subs.length-1?'└── ':'├── ';
      const sCls=active.includes(sn)?'node':'dormant';
      html+=subPre+'<span class="line">'+subConn+'</span><span class="'+sCls+'">'+sn.toUpperCase()+'</span> <span class="line">('+sa.domain.split(',')[0]+')</span>\\n';
    });
  });
  document.getElementById('tree').innerHTML='<pre>'+html+'</pre>';
}

function renderAgents(d){
  if(d.agents.length===0){document.getElementById('agent-grid').innerHTML='<div class="loading">No agents yet. Fork one below.</div>';return}
  document.getElementById('agent-grid').innerHTML=d.agents.map(a=>{
    const c=a.costs;
    return '<div class="card active"><div class="name">'+a.name.toUpperCase()+'</div>'
      +'<div class="tier">Tier '+a.tier+' | '+a.tradition+'</div>'
      +'<div class="domain">'+a.domain+'</div>'
      +'<div class="meta"><span>'+c.calls+' calls</span><span>$'+(c.costUsd||0).toFixed(4)+'</span></div>'
      +'<button class="chat-btn" onclick="openChat(\\''+a.name+'\\')">Chat with '+a.name.toUpperCase()+'</button></div>';
  }).join('');
}

function renderFork(d){
  const active=d.agents.map(a=>a.name);
  document.getElementById('fork-grid').innerHTML=Object.entries(d.archetypes).map(([name,a])=>{
    if(active.includes(name))return'<div class="fork-btn exists">'+name+' ✓</div>';
    return'<button class="fork-btn" onclick="forkAgent(\\''+name+'\\')">Fork '+name+'</button>';
  }).join('');
}

function renderCosts(d){
  let html='<div class="cost-item"><div class="label">Total LLM</div><div class="value">'+d.costs.totalUsd+'</div><div class="detail">'+d.costs.totalCalls+' calls</div></div>';
  html+='<div class="cost-item"><div class="label">Headless VPS</div><div class="value">'+d.infra.estimate.headless+'</div><div class="detail">per agent</div></div>';
  html+='<div class="cost-item"><div class="label">Desktop VPS</div><div class="value">'+d.infra.estimate.desktop+'</div><div class="detail">per agent</div></div>';
  for(const[name,data]of Object.entries(d.costs.agents||{})){
    html+='<div class="cost-item"><div class="label">'+name+'</div><div class="value">'+data.formatted+'</div><div class="detail">'+data.calls+' calls, avg '+data.perCall+'</div></div>';
  }
  document.getElementById('costs-bar').innerHTML=html;
}

function openChat(agent){
  currentAgent=agent;
  document.getElementById('chat-agent-name').textContent=agent.toUpperCase();
  document.getElementById('chat-messages').innerHTML='';
  document.getElementById('chat-panel').classList.add('open');
  document.getElementById('chat-input').focus();
}
function closeChat(){document.getElementById('chat-panel').classList.remove('open');currentAgent=null}

async function sendChat(){
  if(!currentAgent)return;
  const input=document.getElementById('chat-input');
  const msg=input.value.trim();if(!msg)return;
  input.value='';
  const msgs=document.getElementById('chat-messages');
  msgs.innerHTML+='<div class="msg user"><div class="label">you</div>'+escHtml(msg)+'</div>';
  msgs.scrollTop=msgs.scrollHeight;
  document.getElementById('chat-send').disabled=true;
  try{
    const r=await fetch('/theai/api/chat',{method:'POST',headers:H,body:JSON.stringify({agent:currentAgent,message:msg})});
    const d=await r.json();
    msgs.innerHTML+='<div class="msg agent"><div class="label">'+currentAgent+' ('+d.usage.cost+')</div>'+escHtml(d.text)+'</div>';
  }catch(e){msgs.innerHTML+='<div class="msg agent" style="color:#ff4444">Error: '+e.message+'</div>'}
  msgs.scrollTop=msgs.scrollHeight;
  document.getElementById('chat-send').disabled=false;
  input.focus();
}

async function forkAgent(name){
  const r=await fetch('/theai/api/fork',{method:'POST',headers:H,body:JSON.stringify({archetype:name})});
  const d=await r.json();
  if(d.error)alert('Fork failed: '+d.error);
  else{alert(name+' forked successfully!');load()}
}

function renderStatus(h){
  let html='';
  html+='<div class="cost-item"><div class="label">Jarvis Bridge</div><div class="value" style="color:'+(h.jarvisBridge.wired?'#00ff88':'#ff4444')+'">'+(h.jarvisBridge.wired?'WIRED':'OFFLINE')+'</div><div class="detail">'+h.jarvisBridge.tools.join(', ')+'</div></div>';
  html+='<div class="cost-item"><div class="label">LLM Model</div><div class="value" style="font-size:0.9em">'+h.model+'</div><div class="detail">Ollama: '+(h.ollamaConfigured?'YES':'NO')+'</div></div>';
  html+='<div class="cost-item"><div class="label">Next Prune</div><div class="value" style="font-size:0.9em">'+h.nextPrune+'</div><div class="detail"><button class="fork-btn" onclick="triggerPrune()" style="margin-top:4px">Prune Now</button></div></div>';
  document.getElementById('status-bar').innerHTML=html;
}

async function triggerPrune(){
  if(!confirm('Run prune cycle for all agents?'))return;
  const r=await fetch('/theai/api/prune',{method:'POST',headers:H});
  const d=await r.json();
  alert('Prune complete: '+d.length+' agents processed');
  load();
}

function escHtml(s){const d=document.createElement('div');d.textContent=s;return d.innerHTML}
load();
</script>
</body></html>`
}
