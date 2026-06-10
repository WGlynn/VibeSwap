#!/usr/bin/env python3
"""Generate VibeSwap papers site from medium-pipeline-2026-06-10/*.md.

Outputs:
  frontend/public/papers/index.html        — rolodex of 30 cards with cmd-K search
  frontend/public/papers/NN_NAME.html      — per-paper page with sticky TOC + progress bar

Aesthetic: terminal-console (matrix-green on true black, Inter + JetBrains Mono).
Locked per vibeswap/CLAUDE.md. ASCII-only output for cp1252 safety in pipes.
"""
import sys
sys.stdout.reconfigure(encoding='utf-8')

import json
import re
from pathlib import Path

try:
    import markdown
except ImportError:
    print("pip install markdown", file=sys.stderr)
    sys.exit(1)

SRC = Path.home() / "Desktop" / "medium-pipeline-2026-06-10"
OUT = Path(__file__).resolve().parents[1] / "public" / "papers"
OUT.mkdir(parents=True, exist_ok=True)

# Audit status from 4-agent sweep 2026-06-10
STATUS = {
    1:  ("PARTIAL",        "matrix",   "Fairness fixed point"),
    2:  ("PRIMITIVE-ONLY", "muted",    "Substrate incompleteness"),
    3:  ("IMPLEMENTED",    "matrix",   "Attention auction paradox"),
    4:  ("SPEC-ONLY",      "amber",    "Cooperative emergence threshold"),
    5:  ("IMPLEMENTED",    "matrix",   "Fork resistance constant"),
    6:  ("PARTIAL",        "matrix",   "Kolmogorov complexity of attribution"),
    7:  ("PARTIAL",        "matrix",   "The uncomputable marginal"),
    8:  ("PARTIAL",        "matrix",   "Entropy preservation in DAG"),
    9:  ("PARTIAL",        "matrix",   "Observer effect in attestation"),
    10: ("PARTIAL",        "matrix",   "Rational ignorance as mechanism"),
    11: ("IMPLEMENTED",    "matrix",   "Siren protocol"),
    12: ("IMPLEMENTED",    "matrix",   "Clawback cascade mechanics"),
    13: ("IMPLEMENTED",    "matrix",   "NCI weight function"),
    14: ("IMPLEMENTED",    "matrix",   "Lawson floor mathematics"),
    15: ("IMPLEMENTED",    "matrix",   "Disintermediation grades"),
    16: ("IMPLEMENTED",    "matrix",   "Rosetta covenants"),
    17: ("PARTIAL",        "matrix",   "ZK attribution"),
    18: ("PARTIAL",        "matrix",   "Optimistic Shapley"),
    19: ("ESSAY",          "terminal", "Why VibeSwap wins in 2030"),
    20: ("ESSAY",          "terminal", "The coordination primitive market"),
    21: ("ESSAY",          "terminal", "Investor economic model"),
    22: ("ESSAY",          "terminal", "Regulatory compliance deep dive"),
    23: ("ESSAY",          "terminal", "The community bootstrap playbook"),
    24: ("PARTIAL",        "matrix",   "The cognitive economy thesis"),
    25: ("PRIMITIVE-ONLY", "muted",    "Attention as infrastructure"),
    26: ("IMPLEMENTED",    "matrix",   "The dignity gradient"),
    27: ("PRIMITIVE-ONLY", "muted",    "What LLMs teach us about mind"),
    28: ("IMPLEMENTED",    "matrix",   "True price oracle deep dive"),
    29: ("PARTIAL",        "matrix",   "Cross-chain state atomicity"),
    30: ("IMPLEMENTED",    "matrix",   "Storage slot ecology"),
}

# --- Shared CSS variables / aesthetic ---
ROOT_CSS = r"""
@property --conic-angle {
  syntax: '<angle>';
  initial-value: 0deg;
  inherits: false;
}
:root {
  --bg: #000000;
  --surface-1: #080808;
  --surface-2: #0d0d0d;
  --surface-3: #181818;
  --border: #252525;
  --border-hi: #424242;
  --matrix: #00ff41;
  --matrix-dim: #00cc34;
  --terminal: #00d4ff;
  --term-dim: #00a8cc;
  --amber: #ffaa00;
  --fg: #e0e0e0;
  --fg-white: #ffffff;
  --muted: #808080;
  --muted-dim: #505050;
}
* { box-sizing: border-box; margin: 0; padding: 0; }
html { scroll-behavior: smooth; }
body {
  background: var(--bg);
  color: var(--fg);
  font-family: 'Inter', system-ui, -apple-system, sans-serif;
  letter-spacing: -0.01em;
  -webkit-font-smoothing: antialiased;
  line-height: 1.65;
  min-height: 100vh;
  overflow-x: hidden;
  background-image:
    linear-gradient(rgba(255,255,255,0.022) 1px, transparent 1px),
    linear-gradient(90deg, rgba(255,255,255,0.022) 1px, transparent 1px);
  background-size: 48px 48px;
}
body::before {
  content: '';
  position: fixed; inset: 0;
  pointer-events: none; z-index: 1;
  background: repeating-linear-gradient(0deg, transparent 0 2px, rgba(0,255,65,0.025) 2px 3px);
  mix-blend-mode: screen;
}
/* SVG fractalNoise grain — breaks the flatness of #000 */
body::after {
  content: '';
  position: fixed; inset: 0;
  pointer-events: none; z-index: 2;
  opacity: 0.04;
  mix-blend-mode: overlay;
  background-image: url("data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='300' height='300'><filter id='n'><feTurbulence type='fractalNoise' baseFrequency='0.9' numOctaves='2' stitchTiles='stitch'/></filter><rect width='100%25' height='100%25' filter='url(%23n)' opacity='0.6'/></svg>");
}
/* CRT corner brackets — viewport chrome */
.crt-corners {
  position: fixed; inset: 14px; pointer-events: none; z-index: 5;
}
.crt-corners > i {
  position: absolute; width: 18px; height: 18px;
  border: 1px solid rgba(0,255,65,0.4);
  animation: cornerFade 1.4s ease-out both;
}
.crt-corners > i.tl { top: 0; left: 0; border-right: 0; border-bottom: 0; }
.crt-corners > i.tr { top: 0; right: 0; border-left: 0; border-bottom: 0; }
.crt-corners > i.bl { bottom: 0; left: 0; border-right: 0; border-top: 0; }
.crt-corners > i.br { bottom: 0; right: 0; border-left: 0; border-top: 0; }
@keyframes cornerFade {
  from { opacity: 0; transform: scale(0.7); }
  to { opacity: 1; transform: scale(1); }
}
.mono { font-family: 'JetBrains Mono', 'SF Mono', monospace; }
a { color: var(--matrix); text-decoration: none; border-bottom: 1px solid rgba(0,255,65,0.2); }
a:hover { color: var(--matrix); border-bottom-color: var(--matrix); }

/* Header bar */
.topbar {
  position: sticky; top: 0; z-index: 50;
  background: rgba(0,0,0,0.85); backdrop-filter: blur(8px);
  border-bottom: 1px solid var(--border);
}
.topbar-inner {
  max-width: 1280px; margin: 0 auto;
  padding: 14px 32px;
  display: flex; align-items: center; justify-content: space-between;
  font-family: 'JetBrains Mono', monospace; font-size: 12px;
  color: var(--muted-dim);
}
.brand { color: var(--fg-white); font-weight: 700; letter-spacing: 0.05em; }
.brand-accent { color: var(--matrix); }
.brand-sep { color: var(--muted-dim); margin: 0 8px; }
.topbar-nav a { color: var(--muted); border: none; margin-left: 22px; }
.topbar-nav a:hover { color: var(--matrix); }

/* Reading progress bar (CSS-only scroll-timeline) */
.progress {
  position: fixed; top: 0; left: 0; right: 0;
  height: 2px; transform-origin: left;
  background: linear-gradient(90deg, var(--matrix), var(--terminal));
  z-index: 100;
  transform: scaleX(0);
  animation: grow linear; animation-timeline: scroll(root);
}
@keyframes grow { to { transform: scaleX(1); } }

/* Gradient divider */
.gdivider {
  height: 1px;
  background: linear-gradient(90deg, transparent, rgba(0,255,65,0.35), transparent);
  margin: 48px 0;
}

/* Status badges */
.badge {
  display: inline-block;
  font-family: 'JetBrains Mono', monospace;
  font-size: 10px; font-weight: 600; letter-spacing: 0.12em;
  padding: 4px 10px; border-radius: 2px;
  border: 1px solid;
}
.badge-matrix { color: var(--matrix); border-color: var(--matrix); background: rgba(0,255,65,0.06); }
.badge-terminal { color: var(--terminal); border-color: var(--terminal); background: rgba(0,212,255,0.06); }
.badge-amber { color: var(--amber); border-color: var(--amber); background: rgba(255,170,0,0.06); }
.badge-muted { color: var(--muted); border-color: var(--border-hi); background: var(--surface-2); }

/* Footer */
.site-footer {
  max-width: 1280px; margin: 64px auto 0;
  padding: 24px 32px;
  border-top: 1px solid var(--border);
  display: flex; justify-content: space-between; align-items: center;
  font-family: 'JetBrains Mono', monospace; font-size: 11px;
  color: var(--muted-dim);
}
.site-footer .dot {
  display: inline-block; width: 8px; height: 8px;
  border-radius: 50%; background: var(--matrix); margin-right: 8px;
  box-shadow: 0 0 8px rgba(0,255,65,0.4);
  animation: breathe 2.4s ease-in-out infinite;
}
@keyframes breathe {
  0%, 100% { opacity: 0.7; transform: scale(1); }
  50% { opacity: 1; transform: scale(1.15); }
}
"""

# --- Index page template (rolodex of 30) ---
INDEX_TEMPLATE = r"""<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<meta name="theme-color" content="#000000">
<title>VibeSwap :: Papers</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600;700;800&family=JetBrains+Mono:wght@400;500;600;700&display=swap" rel="stylesheet">
<style>
__ROOT_CSS__

/* Hero */
.hero { max-width: 1280px; margin: 0 auto; padding: 56px 32px 32px; }
.kicker {
  font-family: 'JetBrains Mono', monospace;
  font-size: 13px; color: var(--matrix);
  font-weight: 600; margin-bottom: 18px; letter-spacing: 0.02em;
}
.kicker .caret { animation: blink 1s steps(2) infinite; }
@keyframes blink { 50% { opacity: 0; } }
h1.hero-title {
  font-size: clamp(48px, 7.5vw, 88px); font-weight: 800;
  letter-spacing: -0.035em; color: var(--fg-white); line-height: 1;
}
.hero-title .dot { color: var(--matrix); }
.hero-sub {
  font-size: 20px; color: var(--terminal);
  margin-top: 18px; font-weight: 600; letter-spacing: -0.015em;
}
.hero-hint {
  font-family: 'JetBrains Mono', monospace;
  font-size: 12px; color: var(--muted); margin-top: 22px;
}
.hero-hint kbd {
  background: var(--surface-3); border: 1px solid var(--border);
  padding: 1px 8px; border-radius: 3px; color: var(--fg-white); margin: 0 2px;
}

/* Filter chips */
.filters {
  max-width: 1280px; margin: 0 auto; padding: 8px 32px 24px;
  display: flex; flex-wrap: wrap; gap: 8px;
  font-family: 'JetBrains Mono', monospace; font-size: 11px;
}
.chip {
  padding: 6px 12px; border: 1px solid var(--border);
  border-radius: 2px; cursor: pointer;
  color: var(--muted); transition: all 0.15s;
  letter-spacing: 0.08em;
}
.chip:hover { color: var(--fg); border-color: var(--border-hi); }
.chip.active {
  color: var(--matrix); border-color: var(--matrix);
  background: rgba(0,255,65,0.05);
}

/* Rolodex */
.rolodex {
  max-width: 1280px; margin: 0 auto;
  padding: 20px 32px 60px;
  min-height: 620px;
  display: flex; flex-direction: column;
  align-items: center; justify-content: center;
}
.stage {
  position: relative; width: 100%; height: 500px;
  perspective: 1400px; perspective-origin: center center;
  margin-bottom: 30px;
}
.paper-card {
  position: absolute; top: 50%; left: 50%;
  width: min(560px, 90vw); height: 440px;
  margin-left: calc(min(560px, 90vw) / -2);
  margin-top: -220px;
  background: var(--surface-1); border: 1px solid var(--border);
  border-radius: 4px; padding: 28px 32px; cursor: pointer;
  transform-style: preserve-3d;
  transition: transform 0.5s cubic-bezier(0.22, 0.61, 0.36, 1), opacity 0.4s ease, border-color 0.3s, box-shadow 0.3s;
  backface-visibility: hidden; will-change: transform, opacity;
}
/* Active card — conic-gradient animated border (the "Vercel" trick) */
.paper-card.active {
  border-color: transparent;
  background:
    linear-gradient(var(--surface-1), var(--surface-1)) padding-box,
    conic-gradient(from var(--conic-angle), rgba(0,255,65,0.7), rgba(0,255,65,0), rgba(0,255,65,0.7)) border-box;
  animation: spinAngle 6s linear infinite;
  box-shadow: 0 0 50px -10px rgba(0,255,65,0.28), 0 0 20px -5px rgba(0,255,65,0.15),
              inset 0 1px 0 rgba(0,255,65,0.06);
}
@keyframes spinAngle { to { --conic-angle: 360deg; } }
.paper-card.cyan.active {
  border-color: var(--terminal);
  box-shadow: 0 0 50px -10px rgba(0,212,255,0.28), 0 0 20px -5px rgba(0,212,255,0.15);
}
.paper-chrome {
  display: flex; justify-content: space-between; align-items: center;
  font-family: 'JetBrains Mono', monospace; font-size: 10px; color: var(--muted-dim);
  padding-bottom: 14px; border-bottom: 1px solid var(--border);
  letter-spacing: 0.05em;
}
.paper-chrome .num { color: var(--fg-white); font-weight: 700; }
.paper-chrome .accent { color: var(--matrix); }
.paper-card.cyan .paper-chrome .accent { color: var(--terminal); }
.paper-body { padding-top: 22px; }
.paper-card h2 {
  font-size: 30px; font-weight: 800; color: var(--fg-white);
  letter-spacing: -0.025em; line-height: 1.1; margin-bottom: 14px;
}
.paper-tagline {
  font-size: 14px; color: var(--terminal); font-weight: 500;
  line-height: 1.4; margin-bottom: 18px; letter-spacing: -0.01em;
}
.paper-summary {
  font-size: 13px; color: var(--muted); line-height: 1.6;
  display: -webkit-box; -webkit-line-clamp: 4; -webkit-box-orient: vertical;
  overflow: hidden;
}
.paper-footer {
  position: absolute; bottom: 22px; left: 32px; right: 32px;
  display: flex; justify-content: space-between; align-items: center;
  font-family: 'JetBrains Mono', monospace; font-size: 11px;
  color: var(--muted-dim); padding-top: 14px; border-top: 1px solid var(--border);
}
.paper-cta { color: var(--matrix); font-weight: 600; letter-spacing: 0.08em; }
.paper-card.cyan .paper-cta { color: var(--terminal); }

/* Nav */
.nav-row {
  display: flex; align-items: center; gap: 24px; margin-top: 8px;
}
.nav-btn {
  background: var(--surface-1); border: 1px solid var(--border); color: var(--fg);
  font-family: 'JetBrains Mono', monospace; font-size: 18px; font-weight: 700;
  width: 44px; height: 44px; border-radius: 4px; cursor: pointer;
  transition: all 0.2s; display: flex; align-items: center; justify-content: center;
}
.nav-btn:hover:not(:disabled) {
  border-color: var(--matrix); color: var(--matrix);
  box-shadow: 0 0 15px -5px rgba(0,255,65,0.3);
}
.nav-btn:disabled { opacity: 0.25; cursor: not-allowed; }
.counter {
  font-family: 'JetBrains Mono', monospace; font-size: 13px;
  color: var(--muted); min-width: 80px; text-align: center;
}
.counter .current { color: var(--matrix); font-weight: 700; }

/* Cmd-K palette */
.palette-backdrop {
  position: fixed; inset: 0; background: rgba(0,0,0,0.75);
  backdrop-filter: blur(6px); z-index: 200;
  display: none; align-items: flex-start; justify-content: center;
  padding-top: 12vh;
}
.palette-backdrop.open { display: flex; }
.palette {
  width: min(560px, 92vw); max-height: 60vh;
  background: var(--surface-1); border: 1px solid var(--matrix);
  border-radius: 6px;
  box-shadow: 0 30px 80px -10px rgba(0,0,0,0.6), 0 0 40px -10px rgba(0,255,65,0.3);
  display: flex; flex-direction: column;
}
.palette input {
  background: transparent; border: 0; outline: 0;
  font-family: 'JetBrains Mono', monospace; font-size: 16px;
  color: var(--fg-white); padding: 18px 22px;
  border-bottom: 1px solid var(--border);
}
.palette input::placeholder { color: var(--muted-dim); }
.palette-list { overflow-y: auto; flex: 1; padding: 6px 0; }
.palette-item {
  padding: 10px 22px;
  font-family: 'JetBrains Mono', monospace; font-size: 13px;
  cursor: pointer; display: flex; align-items: center; gap: 14px;
  color: var(--fg);
}
.palette-item .num { color: var(--muted-dim); width: 28px; }
.palette-item .ttl { flex: 1; }
.palette-item.cursor { background: rgba(0,255,65,0.08); color: var(--fg-white); }

/* Mobile */
@media (max-width: 900px) {
  .topbar-inner { padding: 12px 18px; font-size: 11px; }
  .topbar-nav a { margin-left: 14px; font-size: 11px; }
  .hero { padding: 32px 18px 20px; }
  h1.hero-title { font-size: 40px; }
  .hero-sub { font-size: 15px; }
  .filters { padding: 4px 18px 16px; }
  .rolodex { padding: 12px 18px 40px; min-height: auto; }
  .stage { height: 400px; perspective: 900px; }
  .paper-card { width: min(340px, 92vw); height: 380px; margin-left: calc(min(340px, 92vw) / -2); margin-top: -190px; padding: 22px; }
  .paper-card h2 { font-size: 22px; }
  .paper-tagline { font-size: 13px; }
  .paper-summary { font-size: 12px; -webkit-line-clamp: 5; }
  .paper-footer { left: 22px; right: 22px; bottom: 18px; font-size: 10px; }
}
</style>
</head>
<body>

<div class="progress"></div>
<div class="crt-corners"><i class="tl"></i><i class="tr"></i><i class="bl"></i><i class="br"></i></div>

<div class="topbar">
  <div class="topbar-inner">
    <div>
      <span class="brand">VIBESWAP</span><span class="brand-sep">::</span><span class="brand-accent">PAPERS</span>
    </div>
    <nav class="topbar-nav">
      <a href="/">home</a>
      <a href="/decks.html">decks</a>
      <a href="#" onclick="openPalette();return false;">cmd+K</a>
    </nav>
  </div>
</div>

<section class="hero">
  <div class="kicker">&gt; research // 30 papers <span class="caret">_</span></div>
  <h1 class="hero-title" id="heroTitle">Papers<span class="dot">.</span></h1>
  <div class="hero-sub">Mechanism design, fairness math, substrate philosophy.</div>
  <div class="hero-hint">
    <kbd>&#9664;</kbd> <kbd>&#9654;</kbd> rotate &middot; <kbd>Enter</kbd> open &middot; <kbd>Cmd</kbd>+<kbd>K</kbd> search &middot; tap a card to bring to center
  </div>
</section>

<div class="filters" id="filters">
  <span class="chip active" data-filter="ALL">ALL <span style="color:var(--muted-dim);margin-left:6px">30</span></span>
  <span class="chip" data-filter="IMPLEMENTED">IMPLEMENTED <span style="color:var(--muted-dim);margin-left:6px" id="cnt-IMPLEMENTED"></span></span>
  <span class="chip" data-filter="PARTIAL">PARTIAL <span style="color:var(--muted-dim);margin-left:6px" id="cnt-PARTIAL"></span></span>
  <span class="chip" data-filter="ESSAY">ESSAY <span style="color:var(--muted-dim);margin-left:6px" id="cnt-ESSAY"></span></span>
  <span class="chip" data-filter="PRIMITIVE-ONLY">PRIMITIVE-ONLY <span style="color:var(--muted-dim);margin-left:6px" id="cnt-PRIMITIVE-ONLY"></span></span>
  <span class="chip" data-filter="SPEC-ONLY">SPEC-ONLY <span style="color:var(--muted-dim);margin-left:6px" id="cnt-SPEC-ONLY"></span></span>
</div>

<section class="rolodex">
  <div class="stage" id="stage"></div>
  <div class="nav-row">
    <button class="nav-btn" id="prev" aria-label="Previous">&#9664;</button>
    <span class="counter"><span class="current" id="cur">1</span> / <span id="total">30</span></span>
    <button class="nav-btn" id="next" aria-label="Next">&#9654;</button>
  </div>
</section>

<div class="palette-backdrop" id="palette" onclick="if(event.target===this)closePalette()">
  <div class="palette">
    <input id="paletteInput" placeholder="search papers..." autocomplete="off">
    <div class="palette-list" id="paletteList"></div>
  </div>
</div>

<div class="site-footer">
  <div><span class="dot"></span>LIVE // 2026</div>
  <div><a href="/" style="color: var(--terminal); border: 0;">&larr; vibeswap home</a></div>
  <div>vibeswap.org</div>
</div>

<script>
const PAPERS = __PAPERS_JSON__;
let currentIndex = 0;
let activeFilter = 'ALL';
const stage = document.getElementById('stage');
const counterEl = document.getElementById('cur');
const totalEl = document.getElementById('total');
const prevBtn = document.getElementById('prev');
const nextBtn = document.getElementById('next');

function filteredPapers() {
  if (activeFilter === 'ALL') return PAPERS;
  return PAPERS.filter(p => p.status === activeFilter);
}

function getTransform(rel) {
  const offsetX = rel * 220;
  const scale = rel === 0 ? 1 : Math.max(0.7, 1 - Math.abs(rel) * 0.14);
  const rotY = rel * -22;
  const z = rel === 0 ? 0 : -Math.min(300, Math.abs(rel) * 140);
  return `translateX(${offsetX}px) translateZ(${z}px) rotateY(${rotY}deg) scale(${scale})`;
}

function render() {
  const list = filteredPapers();
  totalEl.textContent = list.length;
  stage.innerHTML = '';
  if (currentIndex >= list.length) currentIndex = 0;
  list.forEach((p, i) => {
    const rel = i - currentIndex;
    const card = document.createElement('div');
    const cyanClass = p.accent === 'terminal' ? ' cyan' : '';
    card.className = 'paper-card' + cyanClass + (rel === 0 ? ' active' : '');
    card.innerHTML = `
      <div class="paper-chrome">
        <div><span class="num">${String(p.num).padStart(2,'0')}</span>&nbsp;&nbsp;<span class="accent">${p.subject}</span></div>
        <span class="badge badge-${p.badgeColor}">${p.status}</span>
      </div>
      <div class="paper-body">
        <h2>${p.title}</h2>
        <div class="paper-tagline">${p.tagline}</div>
        <div class="paper-summary">${p.summary}</div>
      </div>
      <div class="paper-footer">
        <span>${p.href}</span>
        <span class="paper-cta">${rel === 0 ? 'OPEN &rarr;' : 'BRING TO CENTER'}</span>
      </div>`;
    card.style.transform = getTransform(rel);
    const absRel = Math.abs(rel);
    card.style.opacity = absRel > 3 ? '0' : String(Math.max(0.2, 1 - absRel * 0.28));
    card.style.zIndex = String(100 - absRel);
    card.style.pointerEvents = absRel > 3 ? 'none' : 'auto';
    card.addEventListener('click', () => {
      if (rel === 0) window.location.href = p.href;
      else { currentIndex = i; render(); }
    });
    stage.appendChild(card);
  });
  counterEl.textContent = currentIndex + 1;
  prevBtn.disabled = currentIndex === 0;
  nextBtn.disabled = currentIndex >= list.length - 1;
}

function next() { const list = filteredPapers(); if (currentIndex < list.length - 1) { currentIndex++; render(); } }
function prev() { if (currentIndex > 0) { currentIndex--; render(); } }
prevBtn.addEventListener('click', prev);
nextBtn.addEventListener('click', next);

document.addEventListener('keydown', (e) => {
  if (document.getElementById('palette').classList.contains('open')) return;
  if (e.key === 'ArrowRight') { e.preventDefault(); next(); }
  else if (e.key === 'ArrowLeft') { e.preventDefault(); prev(); }
  else if (e.key === 'Enter') { e.preventDefault(); const list=filteredPapers(); if(list[currentIndex]) window.location.href = list[currentIndex].href; }
  else if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') { e.preventDefault(); openPalette(); }
});

// Touch swipe
let touchStartX = null;
stage.addEventListener('touchstart', (e) => { touchStartX = e.touches[0].clientX; });
stage.addEventListener('touchend', (e) => {
  if (touchStartX === null) return;
  const dx = e.changedTouches[0].clientX - touchStartX;
  if (Math.abs(dx) > 50) { if (dx < 0) next(); else prev(); }
  touchStartX = null;
});

// Filter chips
document.querySelectorAll('.chip').forEach(chip => {
  chip.addEventListener('click', () => {
    document.querySelectorAll('.chip').forEach(c => c.classList.remove('active'));
    chip.classList.add('active');
    activeFilter = chip.dataset.filter;
    currentIndex = 0;
    render();
  });
});

// Populate filter counts
const counts = {};
PAPERS.forEach(p => { counts[p.status] = (counts[p.status] || 0) + 1; });
Object.keys(counts).forEach(k => {
  const el = document.getElementById('cnt-' + k);
  if (el) el.textContent = counts[k];
});

// Cmd-K palette
const paletteEl = document.getElementById('palette');
const paletteInput = document.getElementById('paletteInput');
const paletteList = document.getElementById('paletteList');
let paletteCursor = 0;
let paletteResults = PAPERS;

function openPalette() {
  paletteEl.classList.add('open');
  paletteInput.value = '';
  paletteResults = PAPERS;
  paletteCursor = 0;
  renderPalette();
  setTimeout(() => paletteInput.focus(), 50);
}
function closePalette() { paletteEl.classList.remove('open'); }

function renderPalette() {
  paletteList.innerHTML = '';
  paletteResults.forEach((p, i) => {
    const row = document.createElement('div');
    row.className = 'palette-item' + (i === paletteCursor ? ' cursor' : '');
    row.innerHTML = `<span class="num">${String(p.num).padStart(2,'0')}</span><span class="ttl">${p.title}</span><span class="badge badge-${p.badgeColor}">${p.status}</span>`;
    row.addEventListener('click', () => { window.location.href = p.href; });
    paletteList.appendChild(row);
  });
}

paletteInput.addEventListener('input', () => {
  const q = paletteInput.value.toLowerCase().trim();
  paletteResults = PAPERS.filter(p =>
    p.title.toLowerCase().includes(q) ||
    p.tagline.toLowerCase().includes(q) ||
    p.summary.toLowerCase().includes(q) ||
    p.subject.toLowerCase().includes(q)
  );
  paletteCursor = 0;
  renderPalette();
});
paletteInput.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') { closePalette(); }
  else if (e.key === 'ArrowDown') { e.preventDefault(); paletteCursor = Math.min(paletteCursor + 1, paletteResults.length - 1); renderPalette(); }
  else if (e.key === 'ArrowUp') { e.preventDefault(); paletteCursor = Math.max(paletteCursor - 1, 0); renderPalette(); }
  else if (e.key === 'Enter') { e.preventDefault(); if (paletteResults[paletteCursor]) window.location.href = paletteResults[paletteCursor].href; }
});

render();

// Split-letter hero reveal — clip-path mask stagger
(function () {
  const h = document.getElementById('heroTitle');
  if (!h) return;
  const text = h.innerHTML;
  const tmp = document.createElement('div'); tmp.innerHTML = text;
  // Walk text nodes only; preserve span.dot
  const out = [];
  let i = 0;
  for (const node of tmp.childNodes) {
    if (node.nodeType === 3) {
      for (const ch of node.textContent) {
        out.push(`<span class="rl" style="display:inline-block;clip-path:inset(0 0 110% 0);transform:translateY(0.2em);transition:clip-path 0.7s cubic-bezier(0.22,0.61,0.36,1) ${i*0.045}s, transform 0.7s cubic-bezier(0.22,0.61,0.36,1) ${i*0.045}s">${ch === ' ' ? '&nbsp;' : ch}</span>`);
        i++;
      }
    } else {
      out.push(`<span class="rl" style="display:inline-block;clip-path:inset(0 0 110% 0);transform:translateY(0.2em);transition:clip-path 0.7s cubic-bezier(0.22,0.61,0.36,1) ${i*0.045}s, transform 0.7s cubic-bezier(0.22,0.61,0.36,1) ${i*0.045}s">${node.outerHTML}</span>`);
      i++;
    }
  }
  h.innerHTML = out.join('');
  requestAnimationFrame(() => {
    requestAnimationFrame(() => {
      h.querySelectorAll('.rl').forEach(el => {
        el.style.clipPath = 'inset(0 0 -5% 0)';
        el.style.transform = 'translateY(0)';
      });
    });
  });
})();

// Lenis smooth scroll (desktop only; mobile inertia is already good)
if (window.matchMedia('(min-width: 769px)').matches && !window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
  const s = document.createElement('script'); s.type = 'module';
  s.textContent = `
    import Lenis from 'https://cdn.jsdelivr.net/npm/lenis@1.1.20/+esm';
    const lenis = new Lenis({ duration: 1.05, easing: t => Math.min(1, 1.001 - Math.pow(2, -10 * t)) });
    function raf(time) { lenis.raf(time); requestAnimationFrame(raf); }
    requestAnimationFrame(raf);
  `;
  document.body.appendChild(s);
}
</script>

</body>
</html>
"""

# --- Per-paper page template ---
PAPER_TEMPLATE = r"""<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<meta name="theme-color" content="#000000">
<title>__TITLE__ :: VibeSwap Papers</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600;700;800&family=JetBrains+Mono:wght@400;500;600;700&display=swap" rel="stylesheet">
<style>
__ROOT_CSS__

/* Layout */
.page {
  max-width: 1280px; margin: 0 auto;
  display: grid; grid-template-columns: 220px 1fr; gap: 48px;
  padding: 48px 32px 32px;
}

/* TOC */
.toc {
  position: sticky; top: 64px; align-self: start;
  font-family: 'JetBrains Mono', monospace;
  font-size: 11px; line-height: 1.7;
  border-left: 1px solid var(--border);
  padding-left: 18px; max-height: calc(100vh - 96px); overflow-y: auto;
}
.toc-label { color: var(--matrix); font-weight: 600; letter-spacing: 0.18em; margin-bottom: 14px; }
.toc-link {
  display: block; color: var(--muted);
  padding: 4px 0; border: 0; transition: color 0.15s;
  text-decoration: none;
}
.toc-link.l3 { padding-left: 12px; font-size: 10.5px; }
.toc-link:hover { color: var(--fg); }
.toc-link.active { color: var(--matrix); }

/* Article */
.article {
  font-size: 18px; line-height: 1.75;
  color: var(--fg); max-width: 760px;
}
.article .hero-meta {
  font-family: 'JetBrains Mono', monospace; font-size: 12px;
  color: var(--muted-dim); letter-spacing: 0.1em; margin-bottom: 14px;
  display: flex; align-items: center; gap: 18px;
}
.article .hero-meta .num { color: var(--fg-white); font-weight: 700; }
.article h1 {
  font-size: clamp(38px, 5.5vw, 56px); font-weight: 800;
  letter-spacing: -0.03em; color: var(--fg-white);
  line-height: 1.05; margin-bottom: 18px;
}
.article .tagline {
  font-size: 20px; color: var(--terminal); font-weight: 600;
  letter-spacing: -0.015em; line-height: 1.4; margin-bottom: 32px;
}
.article h2 {
  font-size: 28px; font-weight: 700;
  color: var(--fg-white); letter-spacing: -0.02em;
  margin: 56px 0 18px;
}
.article h2::before {
  content: '> ';
  color: var(--matrix); font-family: 'JetBrains Mono', monospace;
  font-weight: 500;
}
.article h3 {
  font-size: 20px; font-weight: 600;
  color: var(--fg-white); margin: 36px 0 12px;
}
.article p { margin: 0 0 20px; }
.article p:first-of-type::first-letter {
  font-family: 'JetBrains Mono', monospace;
  float: left; font-size: 4.6rem; line-height: 0.85;
  color: var(--matrix); padding: 0.4rem 0.6rem 0 0; font-weight: 600;
}
.article a {
  color: var(--matrix); border-bottom: 1px solid rgba(0,255,65,0.25);
  transition: border-color 0.15s;
}
.article a:hover { border-bottom-color: var(--matrix); }
.article strong { color: var(--fg-white); font-weight: 600; }
.article em { color: var(--terminal); font-style: italic; }
.article code {
  font-family: 'JetBrains Mono', monospace;
  background: var(--surface-2); border: 1px solid var(--border);
  padding: 2px 6px; border-radius: 3px;
  color: var(--matrix); font-size: 0.9em;
}
.article pre {
  background: var(--surface-1); border: 1px solid var(--border);
  border-left: 3px solid var(--matrix);
  padding: 18px 22px; border-radius: 4px;
  overflow-x: auto; font-size: 13px; line-height: 1.6;
  margin: 28px 0; color: var(--fg);
}
.article pre code {
  background: transparent; border: 0; padding: 0; color: inherit; font-size: inherit;
}
.article blockquote {
  border-left: 3px solid var(--terminal);
  padding: 6px 0 6px 22px; margin: 28px 0;
  color: var(--terminal); font-style: italic;
}
.article ul, .article ol { padding-left: 28px; margin: 0 0 22px; }
.article li { margin-bottom: 8px; }
.article table {
  border-collapse: collapse; width: 100%; margin: 28px 0; font-size: 14px;
  font-family: 'JetBrains Mono', monospace;
}
.article th, .article td {
  border: 1px solid var(--border); padding: 10px 14px; text-align: left;
}
.article th { background: var(--surface-2); color: var(--matrix); font-weight: 600; }
.article hr {
  border: 0; height: 1px;
  background: linear-gradient(90deg, transparent, rgba(0,255,65,0.35), transparent);
  margin: 48px 0;
}
.article img { max-width: 100%; height: auto; border-radius: 4px; margin: 22px 0; }

/* Reveal on scroll (native scroll-driven anim) */
@supports (animation-timeline: view()) {
  .article h2, .article h3, .article p, .article ul, .article ol, .article pre, .article blockquote, .article table {
    animation: reveal-up linear both;
    animation-timeline: view();
    animation-range: entry 0% entry 40%;
  }
  @keyframes reveal-up {
    from { opacity: 0; transform: translateY(20px); }
    to { opacity: 1; transform: translateY(0); }
  }
}

/* Prev/Next nav */
.paper-nav {
  max-width: 1280px; margin: 32px auto 0;
  padding: 32px;
  display: grid; grid-template-columns: 1fr 1fr; gap: 24px;
  border-top: 1px solid var(--border);
}
.paper-nav .nav-cell {
  padding: 22px; border: 1px solid var(--border); border-radius: 4px;
  transition: all 0.2s; cursor: pointer;
  text-decoration: none; color: var(--fg); border-bottom: 1px solid var(--border);
  font-family: 'JetBrains Mono', monospace;
}
.paper-nav .nav-cell:hover {
  border-color: var(--matrix); transform: translateY(-2px);
  box-shadow: 0 10px 30px -10px rgba(0,255,65,0.15);
}
.paper-nav .label {
  font-size: 11px; color: var(--matrix); letter-spacing: 0.15em; margin-bottom: 10px;
}
.paper-nav .ttl { font-size: 16px; color: var(--fg-white); font-weight: 600; line-height: 1.3; }
.paper-nav .nav-cell.next { text-align: right; }
.paper-nav .nav-cell.empty {
  border: 1px dashed var(--border); cursor: default; opacity: 0.4;
}
.paper-nav .nav-cell.empty:hover { transform: none; box-shadow: none; border-color: var(--border); }

/* Mobile */
@media (max-width: 900px) {
  .page { grid-template-columns: 1fr; gap: 24px; padding: 24px 18px; }
  .toc { display: none; }
  .article { font-size: 17px; max-width: 100%; }
  .article h1 { font-size: 32px; }
  .article h2 { font-size: 22px; margin: 40px 0 14px; }
  .article p:first-of-type::first-letter { font-size: 3.4rem; }
  .paper-nav { grid-template-columns: 1fr; padding: 24px 18px; }
  .paper-nav .nav-cell.next { text-align: left; }
}
</style>
</head>
<body>

<div class="progress"></div>
<div class="crt-corners"><i class="tl"></i><i class="tr"></i><i class="bl"></i><i class="br"></i></div>

<div class="topbar">
  <div class="topbar-inner">
    <div>
      <span class="brand">VIBESWAP</span><span class="brand-sep">::</span><span class="brand-accent">PAPERS</span><span class="brand-sep">/</span><span style="color:var(--muted)">__NUM__</span>
    </div>
    <nav class="topbar-nav">
      <a href="/papers/">index</a>
      <a href="/">home</a>
    </nav>
  </div>
</div>

<div class="page">
  <aside class="toc">
    <div class="toc-label">CONTENTS</div>
    __TOC_HTML__
  </aside>

  <article class="article">
    <div class="hero-meta">
      <span class="num">__NUM__</span>
      <span class="badge badge-__BADGE__">__STATUS__</span>
      <span>__SUBJECT__</span>
    </div>
    __BODY__
  </article>
</div>

<div class="paper-nav">
  __PREV_CELL__
  __NEXT_CELL__
</div>

<div class="site-footer">
  <div><span class="dot"></span>LIVE // 2026</div>
  <div><a href="/papers/" style="color: var(--terminal); border: 0;">&larr; all papers</a></div>
  <div>vibeswap.org</div>
</div>

<script>
// TOC scroll-spy via IntersectionObserver
const links = document.querySelectorAll('.toc-link');
const headings = Array.from(document.querySelectorAll('.article h2, .article h3'));
if (headings.length && 'IntersectionObserver' in window) {
  const byId = new Map(Array.from(links).map(l => [l.getAttribute('href').slice(1), l]));
  const io = new IntersectionObserver((entries) => {
    entries.forEach(e => {
      const link = byId.get(e.target.id);
      if (!link) return;
      if (e.isIntersecting) {
        links.forEach(l => l.classList.remove('active'));
        link.classList.add('active');
      }
    });
  }, { rootMargin: '-40% 0px -55% 0px' });
  headings.forEach(h => io.observe(h));
}

// Lenis smooth scroll on desktop
if (window.matchMedia('(min-width: 769px)').matches && !window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
  const s = document.createElement('script'); s.type = 'module';
  s.textContent = `
    import Lenis from 'https://cdn.jsdelivr.net/npm/lenis@1.1.20/+esm';
    const lenis = new Lenis({ duration: 1.05, easing: t => Math.min(1, 1.001 - Math.pow(2, -10 * t)) });
    function raf(time) { lenis.raf(time); requestAnimationFrame(raf); }
    requestAnimationFrame(raf);
  `;
  document.body.appendChild(s);
}
</script>

</body>
</html>
"""


def slugify(text):
    s = re.sub(r'[^a-zA-Z0-9\s-]', '', text).strip().lower()
    return re.sub(r'\s+', '-', s)[:60]


def extract_title(text):
    for line in text.splitlines():
        line = line.strip()
        if line.startswith('# '):
            return line[2:].strip()
    return None


def extract_tagline(text):
    """First non-empty paragraph after the H1, max ~180 chars."""
    lines = text.splitlines()
    found_h1 = False
    for i, line in enumerate(lines):
        if line.startswith('# '):
            found_h1 = True
            continue
        if found_h1 and line.strip() and not line.startswith('#'):
            p = line.strip()
            if len(p) > 200:
                p = p[:197].rsplit(' ', 1)[0] + '...'
            return p
    return ''


def extract_summary(text):
    """Concat 2nd-3rd paragraphs for card summary."""
    paragraphs = []
    buf = []
    found_h1 = False
    skipped_tagline = False
    for line in text.splitlines():
        if line.startswith('# '):
            found_h1 = True
            continue
        if not found_h1:
            continue
        if line.startswith('#'):
            if buf:
                paragraphs.append(' '.join(buf).strip())
                buf = []
            continue
        if line.strip() == '' or line.strip() == '---':
            if buf:
                paragraphs.append(' '.join(buf).strip())
                buf = []
            continue
        buf.append(line.strip())
    if buf:
        paragraphs.append(' '.join(buf).strip())
    paragraphs = [p for p in paragraphs if p and not p.startswith('*Word count')]
    summary = ' '.join(paragraphs[1:3]) if len(paragraphs) > 1 else (paragraphs[0] if paragraphs else '')
    summary = re.sub(r'\s+', ' ', summary)
    if len(summary) > 340:
        summary = summary[:337].rsplit(' ', 1)[0] + '...'
    return summary or '(no summary extracted)'


def build_toc(html_body):
    """Parse h2/h3 from rendered HTML, build TOC + add ids."""
    toc_items = []

    def replace_heading(m):
        level = m.group(1)
        inner = m.group(2)
        text = re.sub(r'<[^>]+>', '', inner).strip()
        anchor = slugify(text)
        toc_items.append((level, text, anchor))
        return f'<h{level} id="{anchor}">{inner}</h{level}>'

    new_html = re.sub(r'<h([23])>(.*?)</h\1>', replace_heading, html_body, flags=re.DOTALL)
    toc_html_lines = []
    for level, text, anchor in toc_items:
        cls = 'toc-link' + (' l3' if level == '3' else '')
        toc_html_lines.append(f'<a class="{cls}" href="#{anchor}">{text}</a>')
    return new_html, '\n    '.join(toc_html_lines) if toc_html_lines else '<span style="color:var(--muted-dim)">(no sections)</span>'


def main():
    md_files = sorted(p for p in SRC.glob('*.md') if not p.name.startswith('_'))
    if not md_files:
        print(f"No source .md files at {SRC}", file=sys.stderr)
        sys.exit(1)

    papers = []
    extensions = ['extra', 'tables', 'fenced_code', 'sane_lists', 'attr_list']

    for p in md_files:
        m = re.match(r'(\d+)_(.+)\.md$', p.name)
        if not m:
            continue
        num = int(m.group(1))
        stem = m.group(2)
        text = p.read_text(encoding='utf-8')
        title = extract_title(text) or stem.replace('_', ' ').title()
        tagline = extract_tagline(text)
        summary = extract_summary(text)
        body_html = markdown.markdown(text, extensions=extensions)
        body_html, toc_html = build_toc(body_html)

        # Drop the first <h1> from body (we render it in the article hero block separately)
        body_html_minus_h1 = re.sub(r'<h1>.*?</h1>', '', body_html, count=1, flags=re.DOTALL)

        status, accent, subject = STATUS.get(num, ('UNCLASSIFIED', 'muted', 'paper'))
        badge_color = {
            'IMPLEMENTED': 'matrix',
            'PARTIAL':     'matrix',
            'SPEC-ONLY':   'amber',
            'ESSAY':       'terminal',
            'PRIMITIVE-ONLY': 'muted',
        }.get(status, 'muted')

        papers.append({
            'num': num,
            'stem': stem,
            'filename': p.name.replace('.md', '.html'),
            'href': f'/papers/{p.name.replace(".md", ".html")}',
            'title': title,
            'tagline': tagline,
            'summary': summary,
            'status': status,
            'subject': subject,
            'accent': accent,
            'badgeColor': badge_color,
            'body_html': body_html_minus_h1,
            'toc_html': toc_html,
        })

    # Write index
    index_html = INDEX_TEMPLATE.replace('__ROOT_CSS__', ROOT_CSS)
    index_html = index_html.replace('__PAPERS_JSON__', json.dumps([{
        'num': p['num'], 'title': p['title'], 'tagline': p['tagline'],
        'summary': p['summary'], 'status': p['status'], 'subject': p['subject'],
        'accent': p['accent'], 'badgeColor': p['badgeColor'], 'href': p['href'],
    } for p in papers], ensure_ascii=False))
    (OUT / 'index.html').write_text(index_html, encoding='utf-8')
    print(f"wrote {OUT}/index.html")

    # Write each paper
    for i, p in enumerate(papers):
        prev_p = papers[i - 1] if i > 0 else None
        next_p = papers[i + 1] if i + 1 < len(papers) else None

        prev_cell = (
            f'<a href="{prev_p["href"]}" class="nav-cell prev"><div class="label">&larr; PREV // {str(prev_p["num"]).zfill(2)}</div><div class="ttl">{prev_p["title"]}</div></a>'
            if prev_p else
            '<div class="nav-cell empty"><div class="label">&larr; PREV</div><div class="ttl" style="color:var(--muted-dim)">(start of pipeline)</div></div>'
        )
        next_cell = (
            f'<a href="{next_p["href"]}" class="nav-cell next"><div class="label">NEXT // {str(next_p["num"]).zfill(2)} &rarr;</div><div class="ttl">{next_p["title"]}</div></a>'
            if next_p else
            '<div class="nav-cell empty next"><div class="label">NEXT &rarr;</div><div class="ttl" style="color:var(--muted-dim)">(end of pipeline)</div></div>'
        )

        # Build article HTML — H1 + tagline rendered as part of the article hero, then body
        article_body = (
            f'<h1>{p["title"]}</h1>\n'
            + (f'<div class="tagline">{p["tagline"]}</div>\n' if p["tagline"] else '')
            + p['body_html']
        )

        html = PAPER_TEMPLATE
        html = html.replace('__ROOT_CSS__', ROOT_CSS)
        html = html.replace('__TITLE__', p['title'])
        html = html.replace('__NUM__', str(p['num']).zfill(2))
        html = html.replace('__STATUS__', p['status'])
        html = html.replace('__BADGE__', p['badgeColor'])
        html = html.replace('__SUBJECT__', p['subject'])
        html = html.replace('__TOC_HTML__', p['toc_html'])
        html = html.replace('__BODY__', article_body)
        html = html.replace('__PREV_CELL__', prev_cell)
        html = html.replace('__NEXT_CELL__', next_cell)

        out_path = OUT / p['filename']
        out_path.write_text(html, encoding='utf-8')
        print(f"  wrote {p['filename']}")

    print(f"\nDone. Index at /papers/index.html + {len(papers)} paper pages.")


if __name__ == '__main__':
    main()
