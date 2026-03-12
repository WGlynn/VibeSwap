// ============ Constellation — Live Interactive Pantheon Visualization ============
//
// A gamified, real-time visualization of TheAI as a living star map.
// Each agent = a star. Messages = light particles. The Merkle root = the pulse.
//
// Features:
//   - Interactive star map with click-to-consult
//   - Particle effects for agent-to-agent messages
//   - Alignment XP from primitive gate passes
//   - Live Merkle root hash display
//   - Agent health/activity indicators
//   - Gamified stats (messages, consultations, prunes)
//
// Endpoint: GET /theai/constellation
// ============

import { getTreeState, initMerkleTree, buildTree, generateProof } from './pantheon-merkle.js'
import { nyxAuth } from './nyx.js'
import { listAgents, pantheonChat, getArchetypes, getAllCosts, getEvents, routeQuestion } from './pantheon.js'
import { getPrimitiveManifest, getGateHistory } from './primitive-gate.js'

export function initConstellation() {
  initMerkleTree()
  console.log('[constellation] Initialized.')
}

export async function handleConstellationRequest(req, res, url) {
  const path = url.pathname

  if (!nyxAuth(req, url)) {
    res.writeHead(302, { Location: '/nyx' })
    res.end()
    return
  }

  if (path === '/theai/constellation' || path === '/theai/constellation/') {
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' })
    res.end(getConstellationHTML())
    return
  }

  if (path === '/theai/constellation/api/state') {
    const treeState = getTreeState()
    const agents = await listAgents()
    const costs = await getAllCosts()
    const events = getEvents({}, 20)
    const gate = await getGateHistory(5)
    const manifest = getPrimitiveManifest()

    // Calculate XP from gate passes
    let alignmentXP = 0
    for (const g of gate) {
      if (g.decision === 'PASS') alignmentXP += Math.round(g.alignmentScore)
      else if (g.decision === 'WARN') alignmentXP += Math.round(g.alignmentScore * 0.5)
    }

    res.writeHead(200, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify({
      tree: treeState,
      activeAgents: agents,
      costs,
      events,
      gateHistory: gate,
      alignmentXP,
      primitiveHash: manifest.hash.slice(0, 16),
      primitiveCount: manifest.count,
    }))
    return
  }

  if (path === '/theai/constellation/api/proof' && req.method === 'POST') {
    const chunks = []; for await (const c of req) chunks.push(c)
    const body = JSON.parse(Buffer.concat(chunks).toString())
    const proof = generateProof(body.agent)
    res.writeHead(200, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify(proof))
    return
  }

  if (path === '/theai/constellation/api/consult' && req.method === 'POST') {
    const chunks = []; for await (const c of req) chunks.push(c)
    const body = JSON.parse(Buffer.concat(chunks).toString())
    let agent = body.agent
    if (agent === 'auto') {
      const route = routeQuestion(body.message)
      agent = route.agent
    }
    const response = await pantheonChat(agent, body.message, 'constellation')
    // Rebuild tree after consultation (context changed)
    buildTree()
    res.writeHead(200, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify({ agent, response: response.text, cost: response.usage.cost, newRootHash: getTreeState().rootHashShort }))
    return
  }

  res.writeHead(404)
  res.end('Not found')
}

// ============ The Constellation HTML — A Living Star Map ============

function getConstellationHTML() {
  return `<!DOCTYPE html>
<html><head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>TheAI Constellation</title>
<style>
*{margin:0;padding:0;box-sizing:border-box}
html,body{width:100%;height:100%;overflow:hidden;background:#000;font-family:'SF Mono',Monaco,Consolas,monospace;color:#e0e0e0}
canvas{position:fixed;top:0;left:0;z-index:0}

/* HUD Overlay */
.hud{position:fixed;z-index:10;pointer-events:none}
.hud>*{pointer-events:auto}

.hud-top{top:16px;left:16px;right:16px;display:flex;justify-content:space-between;align-items:flex-start}
.hud-title{font-size:1.8em;font-weight:200;letter-spacing:6px;background:linear-gradient(90deg,#a855f7,#6366f1,#ec4899);-webkit-background-clip:text;-webkit-text-fill-color:transparent}
.hud-subtitle{font-size:0.65em;color:#555;letter-spacing:3px;margin-top:4px}
.hud-stats{text-align:right;font-size:0.7em;color:#666;line-height:1.8}
.hud-stats .val{color:#a855f7;font-weight:700}
.hud-stats .xp{color:#00ff88;font-size:1.2em}

/* Merkle Hash Display */
.merkle-bar{position:fixed;bottom:16px;left:16px;right:16px;z-index:10;display:flex;gap:12px;align-items:center;font-size:0.7em}
.merkle-label{color:#555;text-transform:uppercase;letter-spacing:2px}
.merkle-hash{color:#a855f7;font-family:monospace;letter-spacing:1px;opacity:0.8}
.merkle-pulse{width:8px;height:8px;border-radius:50%;background:#a855f7;animation:pulse 2s ease-in-out infinite}
@keyframes pulse{0%,100%{opacity:0.3;transform:scale(1)}50%{opacity:1;transform:scale(1.5)}}

/* Agent Tooltip */
.tooltip{position:fixed;z-index:20;background:rgba(10,10,18,0.95);border:1px solid #1a1a2e;border-radius:8px;padding:12px 16px;pointer-events:none;display:none;max-width:300px;backdrop-filter:blur(10px)}
.tooltip .name{font-size:1em;font-weight:700;margin-bottom:4px}
.tooltip .domain{font-size:0.8em;color:#888;margin-bottom:8px}
.tooltip .hash{font-size:0.7em;color:#555;font-family:monospace}
.tooltip .tier{font-size:0.65em;color:#a855f7;text-transform:uppercase;letter-spacing:1px}

/* Chat Panel */
.chat-panel{position:fixed;bottom:60px;right:16px;z-index:20;width:380px;background:rgba(10,10,18,0.95);border:1px solid #1a1a2e;border-radius:12px;display:none;backdrop-filter:blur(10px)}
.chat-panel.open{display:block}
.chat-head{padding:12px 16px;border-bottom:1px solid #1a1a2e;display:flex;justify-content:space-between;align-items:center}
.chat-head .agent-name{font-size:0.9em;font-weight:700}
.chat-head button{background:none;border:none;color:#666;cursor:pointer;font-size:1.2em}
.chat-msgs{max-height:250px;overflow-y:auto;padding:12px 16px;font-size:0.8em}
.chat-msgs .m{margin-bottom:8px;line-height:1.4}
.chat-msgs .m.user{color:#a855f7}
.chat-msgs .m.agent{color:#e0e0e0}
.chat-msgs .m .l{font-size:0.65em;color:#555;text-transform:uppercase}
.chat-row{padding:8px 12px;display:flex;gap:8px;border-top:1px solid #1a1a2e}
.chat-row input{flex:1;background:#050508;border:1px solid #333;color:#e0e0e0;padding:6px 10px;border-radius:6px;font-family:inherit;font-size:0.85em;outline:none}
.chat-row input:focus{border-color:#a855f7}
.chat-row button{background:#a855f7;color:#fff;border:none;padding:6px 14px;border-radius:6px;cursor:pointer;font-family:inherit;font-weight:700}

/* Event Feed */
.event-feed{position:fixed;top:80px;right:16px;z-index:10;width:260px;font-size:0.65em;color:#555;max-height:200px;overflow:hidden}
.event{margin-bottom:4px;opacity:0;animation:fadeIn 0.5s forwards}
.event .time{color:#333}.event .type{color:#a855f7}
@keyframes fadeIn{to{opacity:1}}

/* XP Bar */
.xp-bar{position:fixed;top:80px;left:16px;z-index:10;width:200px}
.xp-label{font-size:0.65em;color:#555;text-transform:uppercase;letter-spacing:2px;margin-bottom:4px}
.xp-track{height:4px;background:#1a1a2e;border-radius:2px;overflow:hidden}
.xp-fill{height:100%;background:linear-gradient(90deg,#00ff88,#a855f7);border-radius:2px;transition:width 1s ease}
.xp-text{font-size:0.7em;color:#00ff88;margin-top:2px}

/* Proof Modal */
.proof-modal{position:fixed;top:50%;left:50%;transform:translate(-50%,-50%);z-index:30;background:rgba(10,10,18,0.98);border:1px solid #a855f7;border-radius:12px;padding:24px;width:450px;display:none;backdrop-filter:blur(20px)}
.proof-modal.open{display:block}
.proof-modal h3{color:#a855f7;font-size:0.9em;margin-bottom:12px}
.proof-path{font-size:0.75em;color:#888;line-height:2}
.proof-path .hash{color:#a855f7;font-family:monospace}
.proof-path .arrow{color:#333;margin:0 8px}
.proof-close{position:absolute;top:12px;right:16px;background:none;border:none;color:#666;cursor:pointer;font-size:1.2em}
</style>
</head><body>

<canvas id="sky"></canvas>

<div class="hud hud-top">
<div>
<div class="hud-title">T H E A I</div>
<div class="hud-subtitle">CONSTELLATION</div>
</div>
<div class="hud-stats" id="stats">
<div>Agents: <span class="val" id="s-agents">-</span></div>
<div>Messages: <span class="val" id="s-msgs">-</span></div>
<div>LLM Cost: <span class="val" id="s-cost">-</span></div>
<div>Alignment XP: <span class="xp" id="s-xp">0</span></div>
</div>
</div>

<div class="xp-bar">
<div class="xp-label">Alignment Level</div>
<div class="xp-track"><div class="xp-fill" id="xp-fill" style="width:0%"></div></div>
<div class="xp-text" id="xp-text">Level 0</div>
</div>

<div class="event-feed" id="events"></div>

<div class="merkle-bar">
<div class="merkle-pulse"></div>
<div class="merkle-label">Merkle Root</div>
<div class="merkle-hash" id="merkle-hash">computing...</div>
<div style="flex:1"></div>
<div class="merkle-label">Primitives</div>
<div class="merkle-hash" id="primitive-hash">-</div>
</div>

<div class="tooltip" id="tooltip">
<div class="tier" id="tt-tier"></div>
<div class="name" id="tt-name"></div>
<div class="domain" id="tt-domain"></div>
<div class="hash" id="tt-hash"></div>
</div>

<div class="chat-panel" id="chat-panel">
<div class="chat-head">
<span class="agent-name" id="chat-agent">-</span>
<button onclick="closeChat()">&times;</button>
</div>
<div class="chat-msgs" id="chat-msgs"></div>
<div class="chat-row">
<input id="chat-input" placeholder="Ask anything..." onkeydown="if(event.key==='Enter')sendMsg()">
<button onclick="sendMsg()">Ask</button>
</div>
</div>

<div class="proof-modal" id="proof-modal">
<button class="proof-close" onclick="closeProof()">&times;</button>
<h3>Merkle Proof</h3>
<div class="proof-path" id="proof-path"></div>
</div>

<script>
const SECRET=new URLSearchParams(location.search).get('t')||localStorage.getItem('nyx-secret')||'';
if(SECRET&&location.search.includes('t=')){localStorage.setItem('nyx-secret',SECRET);history.replaceState(null,'','/theai/constellation')}
const H={'Content-Type':'application/json','x-api-secret':SECRET};

// ============ Canvas Setup ============
const canvas=document.getElementById('sky');
const ctx=canvas.getContext('2d');
let W,HH;
function resize(){W=canvas.width=innerWidth;HH=canvas.height=innerHeight}
resize();
addEventListener('resize',resize);

// ============ State ============
let stars={};
let connections=[];
let particles=[];
let mouseX=0,mouseY=0;
let hoveredStar=null;
let selectedAgent=null;
let state=null;
const ARCHETYPES={nyx:{domain:'Oversight, coordination'},poseidon:{domain:'Finance, trading, liquidity'},athena:{domain:'Architecture, planning, strategy'},hephaestus:{domain:'Building, implementation, DevOps'},hermes:{domain:'Communication, APIs, integration'},apollo:{domain:'Analytics, data science'},proteus:{domain:'Adaptive strategy'},artemis:{domain:'Security, threat detection'},anansi:{domain:'Social media, community'}};

// ============ Background Stars ============
const bgStars=[];
for(let i=0;i<300;i++){
  bgStars.push({x:Math.random(),y:Math.random(),size:Math.random()*1.5,twinkle:Math.random()*Math.PI*2,speed:0.5+Math.random()*2});
}

// ============ Fetch State ============
async function fetchState(){
  try{
    const r=await fetch('/theai/constellation/api/state',{headers:H});
    state=await r.json();
    updateStars();
    updateHUD();
  }catch(e){console.error(e)}
}

function updateStars(){
  if(!state?.tree?.nodes)return;
  stars={};
  connections=[];
  for(const[id,node]of Object.entries(state.tree.nodes)){
    const c=node.constellation;
    if(!c)continue;
    const isActive=state.activeAgents.includes(id);
    stars[id]={
      x:c.x*W,y:c.y*HH,
      baseX:c.x,baseY:c.y,
      radius:isActive?(c.magnitude*20+8):(c.magnitude*12+4),
      color:c.color,symbol:c.symbol,
      hash:node.hash,fullHash:node.fullHash,
      tier:node.tier,active:isActive,
      glow:0,pulsePhase:Math.random()*Math.PI*2,
    };
    // Connections to children
    for(const child of node.children||[]){
      connections.push({from:id,to:child});
    }
  }
  // Jarvis as peer
  stars.jarvis={
    x:0.85*W,y:0.15*HH,baseX:0.85,baseY:0.15,
    radius:22,color:'#00ff88',symbol:'◈',
    hash:'independent',fullHash:'peer',tier:'P',active:true,
    glow:0,pulsePhase:0,
  };
  connections.push({from:'nyx',to:'jarvis',dashed:true});
}

function updateHUD(){
  if(!state)return;
  document.getElementById('s-agents').textContent=state.activeAgents.length;
  document.getElementById('s-msgs').textContent=state.costs.totalCalls;
  document.getElementById('s-cost').textContent=state.costs.totalUsd;
  document.getElementById('s-xp').textContent=state.alignmentXP;
  document.getElementById('merkle-hash').textContent=state.tree.rootHashShort||'none';
  document.getElementById('primitive-hash').textContent=state.primitiveHash;

  // XP bar (100 XP per level)
  const level=Math.floor(state.alignmentXP/100);
  const progress=(state.alignmentXP%100);
  document.getElementById('xp-fill').style.width=progress+'%';
  document.getElementById('xp-text').textContent='Level '+level+' ('+state.alignmentXP+' XP)';

  // Events
  const evEl=document.getElementById('events');
  evEl.innerHTML=state.events.slice(-8).reverse().map(e=>{
    const t=e.timestamp?.slice(11,19)||'';
    return '<div class="event"><span class="time">'+t+'</span> <span class="type">'+e.type+'</span> '+(e.agent||e.from||'')+'</div>';
  }).join('');
}

// ============ Render Loop ============
let frame=0;
function render(){
  frame++;
  ctx.fillStyle='rgba(0,0,0,0.15)';
  ctx.fillRect(0,0,W,HH);

  // Background stars
  for(const s of bgStars){
    const twinkle=Math.sin(frame*0.02*s.speed+s.twinkle)*0.5+0.5;
    ctx.fillStyle='rgba(255,255,255,'+(0.1+twinkle*0.4)+')';
    ctx.beginPath();
    ctx.arc(s.x*W,s.y*HH,s.size,0,Math.PI*2);
    ctx.fill();
  }

  // Connections
  for(const c of connections){
    const a=stars[c.from],b=stars[c.to];
    if(!a||!b)continue;
    ctx.strokeStyle='rgba(168,85,247,0.15)';
    ctx.lineWidth=1;
    if(c.dashed){ctx.setLineDash([5,10])}else{ctx.setLineDash([])}
    ctx.beginPath();
    ctx.moveTo(a.x,a.y);
    ctx.lineTo(b.x,b.y);
    ctx.stroke();
    ctx.setLineDash([]);
  }

  // Particles
  for(let i=particles.length-1;i>=0;i--){
    const p=particles[i];
    p.progress+=p.speed;
    if(p.progress>=1){particles.splice(i,1);continue}
    const x=p.sx+(p.ex-p.sx)*p.progress;
    const y=p.sy+(p.ey-p.sy)*p.progress;
    const alpha=1-p.progress;
    ctx.fillStyle='rgba(168,85,247,'+alpha+')';
    ctx.beginPath();
    ctx.arc(x,y,2,0,Math.PI*2);
    ctx.fill();
    // Trail
    ctx.fillStyle='rgba(168,85,247,'+(alpha*0.3)+')';
    ctx.beginPath();
    ctx.arc(x-2,y-1,1.5,0,Math.PI*2);
    ctx.fill();
  }

  // Stars
  hoveredStar=null;
  for(const[id,s]of Object.entries(stars)){
    s.x=s.baseX*W;
    s.y=s.baseY*HH;
    const pulse=Math.sin(frame*0.03+s.pulsePhase)*0.2+1;
    const r=s.radius*pulse;

    // Check hover
    const dx=mouseX-s.x,dy=mouseY-s.y;
    const dist=Math.sqrt(dx*dx+dy*dy);
    if(dist<r+10){hoveredStar=id;s.glow=Math.min(s.glow+0.1,1)}
    else{s.glow=Math.max(s.glow-0.05,0)}

    // Outer glow
    if(s.active){
      const grad=ctx.createRadialGradient(s.x,s.y,r*0.5,s.x,s.y,r*3);
      grad.addColorStop(0,s.color+'44');
      grad.addColorStop(1,s.color+'00');
      ctx.fillStyle=grad;
      ctx.beginPath();
      ctx.arc(s.x,s.y,r*3,0,Math.PI*2);
      ctx.fill();
    }

    // Hover glow
    if(s.glow>0){
      const hGrad=ctx.createRadialGradient(s.x,s.y,r,s.x,s.y,r*4);
      hGrad.addColorStop(0,s.color+(Math.round(s.glow*80).toString(16).padStart(2,'0')));
      hGrad.addColorStop(1,s.color+'00');
      ctx.fillStyle=hGrad;
      ctx.beginPath();
      ctx.arc(s.x,s.y,r*4,0,Math.PI*2);
      ctx.fill();
    }

    // Core
    ctx.fillStyle=s.active?s.color:'#333';
    ctx.beginPath();
    ctx.arc(s.x,s.y,r,0,Math.PI*2);
    ctx.fill();

    // Inner bright core
    ctx.fillStyle='rgba(255,255,255,0.6)';
    ctx.beginPath();
    ctx.arc(s.x,s.y,r*0.3,0,Math.PI*2);
    ctx.fill();

    // Label
    ctx.fillStyle=s.active?'rgba(255,255,255,0.7)':'rgba(255,255,255,0.2)';
    ctx.font='bold '+(s.tier===0?'11px':s.tier===1?'10px':'9px')+' monospace';
    ctx.textAlign='center';
    ctx.fillText(id.toUpperCase(),s.x,s.y+r+14);
  }

  // Tooltip
  const tt=document.getElementById('tooltip');
  if(hoveredStar&&stars[hoveredStar]){
    const s=stars[hoveredStar];
    tt.style.display='block';
    tt.style.left=(s.x+30)+'px';
    tt.style.top=(s.y-30)+'px';
    document.getElementById('tt-name').textContent=hoveredStar.toUpperCase();
    document.getElementById('tt-name').style.color=s.color;
    document.getElementById('tt-tier').textContent=s.tier==='P'?'PEER':'TIER '+s.tier;
    document.getElementById('tt-domain').textContent=ARCHETYPES[hoveredStar]?.domain||'Independent';
    document.getElementById('tt-hash').textContent='Hash: '+s.hash;
    canvas.style.cursor='pointer';
  }else{
    tt.style.display='none';
    canvas.style.cursor='default';
  }

  requestAnimationFrame(render);
}

// ============ Interactions ============
canvas.addEventListener('mousemove',e=>{mouseX=e.clientX;mouseY=e.clientY});
canvas.addEventListener('click',e=>{
  if(hoveredStar&&hoveredStar!=='jarvis'){
    openChat(hoveredStar);
    // Spawn particles from clicked star to Nyx
    spawnParticles(hoveredStar,'nyx',5);
  }
});

canvas.addEventListener('dblclick',e=>{
  if(hoveredStar&&hoveredStar!=='jarvis'){
    showProof(hoveredStar);
  }
});

function spawnParticles(fromId,toId,count){
  const a=stars[fromId],b=stars[toId];
  if(!a||!b)return;
  for(let i=0;i<count;i++){
    particles.push({
      sx:a.x,sy:a.y,ex:b.x,ey:b.y,
      progress:i*-0.1,speed:0.008+Math.random()*0.005
    });
  }
}

// ============ Chat ============
function openChat(agent){
  selectedAgent=agent;
  document.getElementById('chat-agent').textContent=agent.toUpperCase();
  document.getElementById('chat-agent').style.color=stars[agent]?.color||'#a855f7';
  document.getElementById('chat-msgs').innerHTML='';
  document.getElementById('chat-panel').classList.add('open');
  document.getElementById('chat-input').focus();
}
function closeChat(){document.getElementById('chat-panel').classList.remove('open');selectedAgent=null}

async function sendMsg(){
  if(!selectedAgent)return;
  const input=document.getElementById('chat-input');
  const msg=input.value.trim();if(!msg)return;
  input.value='';
  const msgs=document.getElementById('chat-msgs');
  msgs.innerHTML+='<div class="m user"><div class="l">you</div>'+esc(msg)+'</div>';
  msgs.scrollTop=msgs.scrollHeight;

  // Spawn particles from star to Nyx (going through hierarchy)
  spawnParticles(selectedAgent,'nyx',3);

  try{
    const r=await fetch('/theai/constellation/api/consult',{method:'POST',headers:H,body:JSON.stringify({agent:selectedAgent,message:msg})});
    const d=await r.json();
    msgs.innerHTML+='<div class="m agent"><div class="l">'+d.agent+' ('+d.cost+')</div>'+esc(d.response)+'</div>';
    // Update Merkle hash
    if(d.newRootHash)document.getElementById('merkle-hash').textContent=d.newRootHash;
    // Spawn return particles
    spawnParticles('nyx',selectedAgent,3);
  }catch(e){msgs.innerHTML+='<div class="m agent" style="color:#f44">Error: '+e.message+'</div>'}
  msgs.scrollTop=msgs.scrollHeight;
}

// ============ Merkle Proof ============
async function showProof(agent){
  try{
    const r=await fetch('/theai/constellation/api/proof',{method:'POST',headers:H,body:JSON.stringify({agent})});
    const d=await r.json();
    let html='<div style="margin-bottom:8px;color:#888">Agent: <span style="color:'+stars[agent]?.color+'">'+agent.toUpperCase()+'</span></div>';
    html+='<div style="margin-bottom:12px;color:#555">Root: <span class="hash">'+d.rootHash?.slice(0,24)+'...</span></div>';
    for(const step of d.proof||[]){
      html+='<div><span class="hash">'+step.hash?.slice(0,12)+'</span> <span class="arrow">→</span> '+step.node;
      if(step.siblings.length>0){
        html+=' <span style="color:#555">[+'+step.siblings.map(s=>s.agentId).join(',')+']</span>';
      }
      html+='</div>';
    }
    html+='<div style="margin-top:12px;color:'+(d.verified?'#00ff88':'#f44')+'">Verified: '+(d.verified?'YES':'NO')+'</div>';
    document.getElementById('proof-path').innerHTML=html;
    document.getElementById('proof-modal').classList.add('open');
    // Spawn proof particles up the tree
    const path=d.proof?.map(s=>s.node)||[];
    for(let i=0;i<path.length-1;i++){
      setTimeout(()=>spawnParticles(path[i],path[i+1],3),i*300);
    }
  }catch(e){alert(e.message)}
}
function closeProof(){document.getElementById('proof-modal').classList.remove('open')}

function esc(s){const d=document.createElement('div');d.textContent=s;return d.innerHTML}

// ============ Boot ============
fetchState();
setInterval(fetchState,15000);
render();
</script>
</body></html>`
}
