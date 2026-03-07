// ============ LIMNI — Trading Terminal Integration & Monitoring Layer ============
//
// Reusable monitoring layer for Freedom's Limni proprietary trading terminal.
// This module lives in Jarvis — Freedom forks it into Poseidon (his Jarvis fork).
//
// Design principle (Freedom): "What we build doesn't constantly need to be tinkered
// with. It has to be coded in a way where it can be autonomous."
//
// Architecture:
//   Limni Terminal (Freedom's proprietary)
//     ←→ This module (limni.js — monitoring/integration)
//       ←→ Jarvis/Poseidon (AI layer)
//
// This module does NOT execute trades. It:
//   1. Connects to Limni's API to read trade state and strategy status
//   2. Verifies trades match strategy rules
//   3. Monitors VPS health (bot uptime, connectivity)
//   4. Accepts new strategy definitions → backtest → verify → deploy pipeline
//   5. Alerts via Jarvis/Poseidon (Telegram, etc.) when something is wrong
//
// Role assignments:
//   Will (Jarvis):    Katarakti monitoring (crypto-only, small capital)
//   Freedom (Poseidon): Universal monitoring
//   TBD:               Third operator
//
// Fork path: Freedom copies this into Poseidon, connects to his Limni instance.
// ============

import { writeFile, readFile, mkdir } from 'fs/promises';
import { existsSync } from 'fs';
import { join } from 'path';
import { config } from './config.js';

const DATA_DIR = config.dataDir;
const LIMNI_DIR = join(DATA_DIR, 'poseidon');
const STATE_FILE = join(LIMNI_DIR, 'state.json');
const TRADES_FILE = join(LIMNI_DIR, 'trades.jsonl');
const ALERTS_FILE = join(LIMNI_DIR, 'alerts.jsonl');
const STRATEGIES_FILE = join(LIMNI_DIR, 'strategies.json');
const BACKTEST_DIR = join(LIMNI_DIR, 'backtests');

// ============ State ============

let state = {
  initialized: false,
  connectedTerminals: {},    // terminalId -> { url, status, lastSeen, operator }
  activeStrategies: {},      // strategyId -> strategy definition
  tradeLog: [],              // Recent trades (in-memory ring buffer, flushed to JSONL)
  alerts: [],                // Recent alerts (in-memory, flushed to JSONL)
  vpsHealth: {},             // vpsId -> { status, lastCheck, uptime, metrics }
  backtestResults: {},       // backtestId -> results
  stats: {
    totalTrades: 0,
    validTrades: 0,
    invalidTrades: 0,
    missedTrades: 0,
    alertsSent: 0,
    lastCheck: null,
    upSince: null,
  },
};

// ============ Init ============

export async function initLimni() {
  try {
    await mkdir(LIMNI_DIR, { recursive: true });
    await mkdir(BACKTEST_DIR, { recursive: true });

    if (existsSync(STATE_FILE)) {
      const raw = await readFile(STATE_FILE, 'utf8');
      const saved = JSON.parse(raw);
      state = { ...state, ...saved };
    }

    if (existsSync(STRATEGIES_FILE)) {
      const raw = await readFile(STRATEGIES_FILE, 'utf8');
      state.activeStrategies = JSON.parse(raw);
    }

    state.initialized = true;
    state.stats.upSince = state.stats.upSince || Date.now();
    console.log(`[limni] Initialized. ${Object.keys(state.activeStrategies).length} strategies, ${Object.keys(state.connectedTerminals).length} terminals.`);
    return state;
  } catch (err) {
    console.warn(`[limni] Init warning: ${err.message}`);
    state.initialized = true;
    state.stats.upSince = Date.now();
    return state;
  }
}

// ============ Flush (Harmonic Tick) ============

export async function flushLimni() {
  if (!state.initialized) return;
  try {
    const { tradeLog, alerts, ...persistState } = state;
    await writeFile(STATE_FILE, JSON.stringify(persistState, null, 2));
    await writeFile(STRATEGIES_FILE, JSON.stringify(state.activeStrategies, null, 2));

    // Append new trades to JSONL
    if (tradeLog.length > 0) {
      const lines = tradeLog.map(t => JSON.stringify(t)).join('\n') + '\n';
      const { appendFile } = await import('fs/promises');
      await appendFile(TRADES_FILE, lines);
      state.tradeLog = []; // Clear after flush
    }

    // Append new alerts to JSONL
    if (alerts.length > 0) {
      const lines = alerts.map(a => JSON.stringify(a)).join('\n') + '\n';
      const { appendFile } = await import('fs/promises');
      await appendFile(ALERTS_FILE, lines);
      state.alerts = []; // Clear after flush
    }
  } catch (err) {
    console.warn(`[limni] Flush error: ${err.message}`);
  }
}

// ============ Terminal Connection ============

/**
 * Register a Limni terminal endpoint for monitoring.
 * @param {string} terminalId - Unique identifier (e.g., 'katarakti', 'universal')
 * @param {Object} terminalConfig - { url, apiKey?, operator, strategies[] }
 */
export function registerTerminal(terminalId, terminalConfig) {
  state.connectedTerminals[terminalId] = {
    id: terminalId,
    url: terminalConfig.url,
    apiKey: terminalConfig.apiKey || null,
    operator: terminalConfig.operator,
    strategies: terminalConfig.strategies || [],
    status: 'registered',
    lastSeen: null,
    lastError: null,
    registeredAt: Date.now(),
  };
  console.log(`[limni] Terminal registered: ${terminalId} (${terminalConfig.url}) — operator: ${terminalConfig.operator}`);
  return state.connectedTerminals[terminalId];
}

/**
 * Check health of a connected Limni terminal.
 */
export async function checkTerminalHealth(terminalId) {
  const terminal = state.connectedTerminals[terminalId];
  if (!terminal) return { error: `Terminal '${terminalId}' not found` };

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 10000);

    const response = await fetch(`${terminal.url}/health`, {
      signal: controller.signal,
      headers: terminal.apiKey ? { 'Authorization': `Bearer ${terminal.apiKey}` } : {},
    });
    clearTimeout(timeout);

    if (response.ok) {
      terminal.status = 'healthy';
      terminal.lastSeen = Date.now();
      terminal.lastError = null;
      return { status: 'healthy', terminalId };
    } else {
      terminal.status = 'unhealthy';
      terminal.lastError = `HTTP ${response.status}`;
      emitAlert('terminal_unhealthy', `Terminal ${terminalId} returned HTTP ${response.status}`, { terminalId });
      return { status: 'unhealthy', terminalId, error: terminal.lastError };
    }
  } catch (err) {
    terminal.status = 'unreachable';
    terminal.lastError = err.message;
    emitAlert('terminal_unreachable', `Terminal ${terminalId} unreachable: ${err.message}`, { terminalId });
    return { status: 'unreachable', terminalId, error: err.message };
  }
}

// ============ Trade Monitoring ============

/**
 * Fetch recent trades from a Limni terminal.
 */
export async function fetchTrades(terminalId) {
  const terminal = state.connectedTerminals[terminalId];
  if (!terminal) return { error: `Terminal '${terminalId}' not found` };

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 15000);

    const response = await fetch(`${terminal.url}/api/trades/recent`, {
      signal: controller.signal,
      headers: {
        'Content-Type': 'application/json',
        ...(terminal.apiKey ? { 'Authorization': `Bearer ${terminal.apiKey}` } : {}),
      },
    });
    clearTimeout(timeout);

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${await response.text()}`);
    }

    const trades = await response.json();
    return { trades, terminalId, count: trades.length };
  } catch (err) {
    return { error: err.message, terminalId };
  }
}

/**
 * Verify that a trade matches the expected strategy rules.
 * Returns { valid, reason, trade, strategy }
 */
export function verifyTrade(trade, strategy) {
  const result = { valid: true, reasons: [], trade, strategyId: strategy?.id };

  if (!strategy) {
    return { valid: false, reasons: ['No strategy found for this trade'], trade };
  }

  // Check symbol/pair match
  if (strategy.allowedPairs && !strategy.allowedPairs.includes(trade.pair)) {
    result.valid = false;
    result.reasons.push(`Pair ${trade.pair} not in allowed pairs: [${strategy.allowedPairs.join(', ')}]`);
  }

  // Check position size limits
  if (strategy.maxPositionSize && trade.size > strategy.maxPositionSize) {
    result.valid = false;
    result.reasons.push(`Position size ${trade.size} exceeds max ${strategy.maxPositionSize}`);
  }

  // Check allowed order types
  if (strategy.allowedOrderTypes && !strategy.allowedOrderTypes.includes(trade.orderType)) {
    result.valid = false;
    result.reasons.push(`Order type '${trade.orderType}' not allowed. Expected: [${strategy.allowedOrderTypes.join(', ')}]`);
  }

  // Check max drawdown
  if (strategy.maxDrawdownPct && trade.unrealizedPnlPct < -strategy.maxDrawdownPct) {
    result.valid = false;
    result.reasons.push(`Unrealized loss ${trade.unrealizedPnlPct}% exceeds max drawdown ${strategy.maxDrawdownPct}%`);
  }

  // Check trading hours (if strategy restricts)
  if (strategy.tradingHoursUTC) {
    const hour = new Date(trade.timestamp).getUTCHours();
    if (hour < strategy.tradingHoursUTC.start || hour >= strategy.tradingHoursUTC.end) {
      result.valid = false;
      result.reasons.push(`Trade at UTC hour ${hour} outside allowed window [${strategy.tradingHoursUTC.start}-${strategy.tradingHoursUTC.end})`);
    }
  }

  // Check max daily trades
  if (strategy.maxDailyTrades) {
    const today = new Date(trade.timestamp).toISOString().slice(0, 10);
    const todayCount = state.tradeLog.filter(t =>
      t.strategyId === strategy.id &&
      new Date(t.timestamp).toISOString().slice(0, 10) === today
    ).length;
    if (todayCount >= strategy.maxDailyTrades) {
      result.valid = false;
      result.reasons.push(`Daily trade limit reached (${todayCount}/${strategy.maxDailyTrades})`);
    }
  }

  // Record in trade log
  state.tradeLog.push({
    ...trade,
    strategyId: strategy.id,
    valid: result.valid,
    reasons: result.reasons,
    verifiedAt: Date.now(),
  });
  state.stats.totalTrades++;
  if (result.valid) {
    state.stats.validTrades++;
  } else {
    state.stats.invalidTrades++;
    emitAlert('invalid_trade', `Invalid trade on ${strategy.id}: ${result.reasons.join('; ')}`, { trade, strategy: strategy.id });
  }

  return result;
}

// ============ Trade Monitor Loop ============

let monitorInterval = null;

/**
 * Start the autonomous trade monitoring loop.
 * Checks all connected terminals at the specified interval.
 * @param {number} intervalMs - Check interval (default: 30 seconds)
 */
export function startMonitorLoop(intervalMs = 30000) {
  if (monitorInterval) {
    console.warn('[limni] Monitor loop already running');
    return;
  }

  console.log(`[limni] Monitor loop started (every ${intervalMs / 1000}s)`);

  let monitorCheckCount = 0;

  monitorInterval = setInterval(async () => {
    state.stats.lastCheck = Date.now();
    monitorCheckCount++;

    let terminalsChecked = 0, healthy = 0, tradesVerified = 0;

    for (const [terminalId, terminal] of Object.entries(state.connectedTerminals)) {
      terminalsChecked++;
      // Health check
      await checkTerminalHealth(terminalId);

      if (terminal.status !== 'healthy') continue;
      healthy++;

      // Fetch and verify trades
      const result = await fetchTrades(terminalId);
      if (result.error) {
        console.warn(`[limni] Trade fetch failed for ${terminalId}: ${result.error}`);
        continue;
      }

      if (result.trades) {
        for (const trade of result.trades) {
          // Find matching strategy
          const strategyId = trade.strategyId || terminal.strategies[0];
          const strategy = state.activeStrategies[strategyId];
          verifyTrade(trade, strategy);
          tradesVerified++;
        }
      }
    }

    // Log summary every 10 checks so operator knows loop is alive
    if (monitorCheckCount % 10 === 0) {
      console.log(`[limni] Monitor check #${monitorCheckCount}: ${healthy}/${terminalsChecked} terminals healthy, ${tradesVerified} trades verified, ${state.alerts.length} total alerts`);
    }
  }, intervalMs);
}

/**
 * Stop the monitor loop.
 */
export function stopMonitorLoop() {
  if (monitorInterval) {
    clearInterval(monitorInterval);
    monitorInterval = null;
    console.log('[limni] Monitor loop stopped');
  }
}

// ============ VPS Health Monitoring ============

/**
 * Register a VPS for health monitoring.
 */
export function registerVPS(vpsId, vpsConfig) {
  state.vpsHealth[vpsId] = {
    id: vpsId,
    host: vpsConfig.host,
    port: vpsConfig.port || 22,
    healthUrl: vpsConfig.healthUrl,
    operator: vpsConfig.operator,
    status: 'registered',
    lastCheck: null,
    uptimeStart: null,
    consecutiveFailures: 0,
  };
  console.log(`[limni] VPS registered: ${vpsId} (${vpsConfig.host}) — operator: ${vpsConfig.operator}`);
  return state.vpsHealth[vpsId];
}

/**
 * Check health of a registered VPS.
 */
export async function checkVPSHealth(vpsId) {
  const vps = state.vpsHealth[vpsId];
  if (!vps) return { error: `VPS '${vpsId}' not found` };

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 10000);

    const response = await fetch(vps.healthUrl, { signal: controller.signal });
    clearTimeout(timeout);

    if (response.ok) {
      vps.status = 'healthy';
      vps.lastCheck = Date.now();
      vps.consecutiveFailures = 0;
      if (!vps.uptimeStart) vps.uptimeStart = Date.now();
      return { status: 'healthy', vpsId };
    } else {
      throw new Error(`HTTP ${response.status}`);
    }
  } catch (err) {
    vps.status = 'unhealthy';
    vps.lastCheck = Date.now();
    vps.consecutiveFailures++;
    vps.uptimeStart = null;

    if (vps.consecutiveFailures >= 3) {
      emitAlert('vps_down', `VPS ${vpsId} (${vps.host}) is DOWN — ${vps.consecutiveFailures} consecutive failures`, { vpsId });
    }

    return { status: 'unhealthy', vpsId, error: err.message, failures: vps.consecutiveFailures };
  }
}

/**
 * Check all registered VPS instances.
 */
export async function checkAllVPS() {
  const results = {};
  for (const vpsId of Object.keys(state.vpsHealth)) {
    results[vpsId] = await checkVPSHealth(vpsId);
  }
  return results;
}

// ============ Strategy Management ============

/**
 * Register or update a strategy definition.
 * Strategies are declarative — they define rules, not execution logic.
 * Limni handles execution; Poseidon handles verification.
 */
export function registerStrategy(strategyId, strategyDef) {
  state.activeStrategies[strategyId] = {
    id: strategyId,
    name: strategyDef.name,
    version: strategyDef.version || 'v1',
    description: strategyDef.description || '',
    type: strategyDef.type || 'crypto',       // crypto, forex, equities
    // Rule definitions (for trade verification)
    allowedPairs: strategyDef.allowedPairs || null,
    allowedOrderTypes: strategyDef.allowedOrderTypes || ['market', 'limit'],
    maxPositionSize: strategyDef.maxPositionSize || null,
    maxDailyTrades: strategyDef.maxDailyTrades || null,
    maxDrawdownPct: strategyDef.maxDrawdownPct || null,
    tradingHoursUTC: strategyDef.tradingHoursUTC || null,
    // Entry/exit conditions (declarative, for backtest + verification)
    entryConditions: strategyDef.entryConditions || [],
    exitConditions: strategyDef.exitConditions || [],
    // Risk management
    stopLossPct: strategyDef.stopLossPct || null,
    takeProfitPct: strategyDef.takeProfitPct || null,
    trailingStopPct: strategyDef.trailingStopPct || null,
    maxOpenPositions: strategyDef.maxOpenPositions || null,
    // Metadata
    operator: strategyDef.operator || 'unassigned',
    terminal: strategyDef.terminal || null,
    createdAt: state.activeStrategies[strategyId]?.createdAt || Date.now(),
    updatedAt: Date.now(),
  };
  console.log(`[limni] Strategy registered: ${strategyId} (${strategyDef.name || strategyId})`);
  return state.activeStrategies[strategyId];
}

/**
 * List all registered strategies.
 */
export function listStrategies() {
  return Object.values(state.activeStrategies).map(s => ({
    id: s.id,
    name: s.name,
    version: s.version,
    type: s.type,
    operator: s.operator,
    terminal: s.terminal,
    pairs: s.allowedPairs,
  }));
}

/**
 * Get full strategy details.
 */
export function getStrategy(strategyId) {
  return state.activeStrategies[strategyId] || null;
}

/**
 * Remove a strategy.
 */
export function removeStrategy(strategyId) {
  const existed = !!state.activeStrategies[strategyId];
  delete state.activeStrategies[strategyId];
  return existed;
}

// ============ Backtesting ============

/**
 * Run a backtest against historical price data.
 * This is a simplified engine — it evaluates entry/exit conditions
 * against a price series and returns performance metrics.
 *
 * @param {string} strategyId - Strategy to backtest
 * @param {Array} priceData - Array of { timestamp, open, high, low, close, volume }
 * @param {Object} options - { initialCapital, feeRate }
 */
export function runBacktest(strategyId, priceData, options = {}) {
  const strategy = state.activeStrategies[strategyId];
  if (!strategy) return { error: `Strategy '${strategyId}' not found` };
  if (!priceData || priceData.length === 0) return { error: 'No price data provided' };

  const initialCapital = options.initialCapital || 10000;
  const feeRate = options.feeRate || 0.001; // 0.1% per trade

  let capital = initialCapital;
  let position = null;    // { entryPrice, size, side, entryTime }
  const trades = [];
  let maxCapital = capital;
  let maxDrawdown = 0;

  for (let i = 1; i < priceData.length; i++) {
    const prev = priceData[i - 1];
    const candle = priceData[i];

    // Check exit conditions first (if in position)
    if (position) {
      let exitReason = null;
      const pnlPct = position.side === 'long'
        ? (candle.close - position.entryPrice) / position.entryPrice * 100
        : (position.entryPrice - candle.close) / position.entryPrice * 100;

      // Stop loss
      if (strategy.stopLossPct && pnlPct <= -strategy.stopLossPct) {
        exitReason = 'stop_loss';
      }
      // Take profit
      if (strategy.takeProfitPct && pnlPct >= strategy.takeProfitPct) {
        exitReason = 'take_profit';
      }
      // Strategy exit conditions
      if (!exitReason && evaluateConditions(strategy.exitConditions, candle, prev, position)) {
        exitReason = 'exit_signal';
      }

      if (exitReason) {
        const grossPnl = position.size * (pnlPct / 100);
        const fee = Math.abs(position.size) * feeRate;
        capital += grossPnl - fee;

        trades.push({
          entryTime: position.entryTime,
          exitTime: candle.timestamp,
          entryPrice: position.entryPrice,
          exitPrice: candle.close,
          side: position.side,
          size: position.size,
          pnlPct,
          grossPnl,
          fee,
          netPnl: grossPnl - fee,
          exitReason,
        });

        position = null;

        // Track drawdown
        maxCapital = Math.max(maxCapital, capital);
        const dd = (maxCapital - capital) / maxCapital * 100;
        maxDrawdown = Math.max(maxDrawdown, dd);
      }
    }

    // Check entry conditions (if not in position)
    if (!position && evaluateConditions(strategy.entryConditions, candle, prev, null)) {
      const size = Math.min(capital * 0.95, strategy.maxPositionSize || capital * 0.95);
      const fee = size * feeRate;
      position = {
        entryPrice: candle.close,
        size: size - fee,
        side: 'long', // Default to long; strategies can override
        entryTime: candle.timestamp,
      };
      capital -= fee;
    }
  }

  // Close any remaining position at last price
  if (position) {
    const lastCandle = priceData[priceData.length - 1];
    const pnlPct = (lastCandle.close - position.entryPrice) / position.entryPrice * 100;
    const grossPnl = position.size * (pnlPct / 100);
    const fee = Math.abs(position.size) * feeRate;
    capital += grossPnl - fee;
    trades.push({
      entryTime: position.entryTime,
      exitTime: lastCandle.timestamp,
      entryPrice: position.entryPrice,
      exitPrice: lastCandle.close,
      side: position.side,
      size: position.size,
      pnlPct,
      grossPnl,
      fee,
      netPnl: grossPnl - fee,
      exitReason: 'end_of_data',
    });
  }

  // Calculate metrics
  const winningTrades = trades.filter(t => t.netPnl > 0);
  const losingTrades = trades.filter(t => t.netPnl <= 0);
  const totalReturn = ((capital - initialCapital) / initialCapital) * 100;

  const result = {
    backtestId: `bt_${strategyId}_${Date.now()}`,
    strategyId,
    strategyName: strategy.name,
    period: {
      start: priceData[0]?.timestamp,
      end: priceData[priceData.length - 1]?.timestamp,
      candles: priceData.length,
    },
    performance: {
      initialCapital,
      finalCapital: Math.round(capital * 100) / 100,
      totalReturnPct: Math.round(totalReturn * 100) / 100,
      maxDrawdownPct: Math.round(maxDrawdown * 100) / 100,
      totalTrades: trades.length,
      winningTrades: winningTrades.length,
      losingTrades: losingTrades.length,
      winRate: trades.length > 0 ? Math.round((winningTrades.length / trades.length) * 10000) / 100 : 0,
      avgWin: winningTrades.length > 0
        ? Math.round((winningTrades.reduce((s, t) => s + t.netPnl, 0) / winningTrades.length) * 100) / 100
        : 0,
      avgLoss: losingTrades.length > 0
        ? Math.round((losingTrades.reduce((s, t) => s + t.netPnl, 0) / losingTrades.length) * 100) / 100
        : 0,
      profitFactor: losingTrades.length > 0
        ? Math.round(Math.abs(
            winningTrades.reduce((s, t) => s + t.netPnl, 0) /
            (losingTrades.reduce((s, t) => s + t.netPnl, 0) || -1)
          ) * 100) / 100
        : Infinity,
      sharpeRatio: calculateSharpe(trades),
      totalFees: Math.round(trades.reduce((s, t) => s + t.fee, 0) * 100) / 100,
    },
    trades,
    timestamp: Date.now(),
  };

  // Store result
  state.backtestResults[result.backtestId] = result;

  return result;
}

/**
 * Evaluate declarative conditions against candle data.
 * Conditions are simple comparisons that can be composed.
 *
 * Each condition: { field, operator, value, compareField? }
 *   field: 'close', 'open', 'high', 'low', 'volume', 'change_pct'
 *   operator: '>', '<', '>=', '<=', '==', 'crosses_above', 'crosses_below'
 *   value: number (or omit if using compareField)
 *   compareField: compare against another field instead of a literal value
 */
function evaluateConditions(conditions, candle, prevCandle, position) {
  if (!conditions || conditions.length === 0) return false;

  for (const cond of conditions) {
    const fieldVal = getFieldValue(cond.field, candle, position);
    const compareVal = cond.compareField
      ? getFieldValue(cond.compareField, candle, position)
      : cond.value;

    if (fieldVal === null || compareVal === null) return false;

    switch (cond.operator) {
      case '>':  if (!(fieldVal > compareVal)) return false; break;
      case '<':  if (!(fieldVal < compareVal)) return false; break;
      case '>=': if (!(fieldVal >= compareVal)) return false; break;
      case '<=': if (!(fieldVal <= compareVal)) return false; break;
      case '==': if (!(Math.abs(fieldVal - compareVal) < 0.0001)) return false; break;
      case 'crosses_above': {
        if (!prevCandle) return false;
        const prevVal = getFieldValue(cond.field, prevCandle, position);
        const prevCompare = cond.compareField
          ? getFieldValue(cond.compareField, prevCandle, position)
          : cond.value;
        if (!(prevVal <= prevCompare && fieldVal > compareVal)) return false;
        break;
      }
      case 'crosses_below': {
        if (!prevCandle) return false;
        const prevVal = getFieldValue(cond.field, prevCandle, position);
        const prevCompare = cond.compareField
          ? getFieldValue(cond.compareField, prevCandle, position)
          : cond.value;
        if (!(prevVal >= prevCompare && fieldVal < compareVal)) return false;
        break;
      }
      default:
        return false; // Unknown operator
    }
  }

  return true; // All conditions met
}

function getFieldValue(field, candle, position) {
  switch (field) {
    case 'close': return candle.close;
    case 'open': return candle.open;
    case 'high': return candle.high;
    case 'low': return candle.low;
    case 'volume': return candle.volume;
    case 'change_pct': return ((candle.close - candle.open) / candle.open) * 100;
    case 'range_pct': return ((candle.high - candle.low) / candle.low) * 100;
    case 'body_pct': return (Math.abs(candle.close - candle.open) / candle.open) * 100;
    case 'pnl_pct': {
      if (!position) return 0;
      return position.side === 'long'
        ? (candle.close - position.entryPrice) / position.entryPrice * 100
        : (position.entryPrice - candle.close) / position.entryPrice * 100;
    }
    default: return candle[field] ?? null;
  }
}

function calculateSharpe(trades) {
  if (trades.length < 2) return 0;
  const returns = trades.map(t => t.pnlPct);
  const mean = returns.reduce((s, r) => s + r, 0) / returns.length;
  const variance = returns.reduce((s, r) => s + (r - mean) ** 2, 0) / (returns.length - 1);
  const stdDev = Math.sqrt(variance);
  if (stdDev === 0) return 0;
  return Math.round((mean / stdDev) * Math.sqrt(252) * 100) / 100; // Annualized
}

// ============ Alerts ============

const alertCallbacks = [];

/**
 * Register a callback for alerts (e.g., send to Telegram via Jarvis).
 */
export function onAlert(callback) {
  alertCallbacks.push(callback);
}

/**
 * Emit an alert.
 */
function emitAlert(type, message, data = {}) {
  const alert = {
    type,
    message,
    data,
    timestamp: Date.now(),
    acknowledged: false,
  };
  state.alerts.push(alert);
  state.stats.alertsSent++;

  console.warn(`[limni] ALERT [${type}]: ${message}`);

  for (const cb of alertCallbacks) {
    try { cb(alert); } catch {}
  }

  return alert;
}

/**
 * Get recent alerts.
 */
export function getAlerts(limit = 20) {
  return state.alerts.slice(-limit);
}

// ============ Strategy Pipeline (Freedom's Vision) ============
//
// "We can just tell Poseidon and then boom — it's built.
//  Pipeline and everything. He should be able to backtest all that, verify, etc."
//
// The pipeline:
//   1. Accept strategy definition (natural language or structured)
//   2. Parse into declarative rules
//   3. Backtest against historical data
//   4. Generate performance report
//   5. If approved, register as active strategy
//   6. Deploy to Limni terminal via API
//

/**
 * Full strategy pipeline: define → backtest → verify → register.
 *
 * @param {Object} strategyDef - Strategy definition
 * @param {Array} priceData - Historical data for backtesting
 * @param {Object} options - Pipeline options
 * @returns {Object} Pipeline result with backtest metrics + strategy registration
 */
export async function strategyPipeline(strategyDef, priceData, options = {}) {
  const strategyId = strategyDef.id || `strategy_${Date.now()}`;
  const minWinRate = options.minWinRate || 45;
  const maxDrawdown = options.maxDrawdown || 25;
  const minProfitFactor = options.minProfitFactor || 1.2;

  console.log(`[limni] Pipeline started for: ${strategyDef.name || strategyId}`);

  // Step 1: Register strategy (temporary, for backtesting)
  registerStrategy(strategyId, strategyDef);

  // Step 2: Backtest
  const backtest = runBacktest(strategyId, priceData, {
    initialCapital: options.initialCapital || 10000,
    feeRate: options.feeRate || 0.001,
  });

  if (backtest.error) {
    removeStrategy(strategyId);
    return { success: false, error: backtest.error, phase: 'backtest' };
  }

  // Step 3: Verify against thresholds
  const perf = backtest.performance;
  const violations = [];

  if (perf.winRate < minWinRate) {
    violations.push(`Win rate ${perf.winRate}% below minimum ${minWinRate}%`);
  }
  if (perf.maxDrawdownPct > maxDrawdown) {
    violations.push(`Max drawdown ${perf.maxDrawdownPct}% exceeds limit ${maxDrawdown}%`);
  }
  if (perf.profitFactor < minProfitFactor) {
    violations.push(`Profit factor ${perf.profitFactor} below minimum ${minProfitFactor}`);
  }
  if (perf.totalTrades < 5) {
    violations.push(`Only ${perf.totalTrades} trades — insufficient sample size`);
  }

  if (violations.length > 0 && !options.force) {
    removeStrategy(strategyId);
    return {
      success: false,
      phase: 'verification',
      violations,
      backtest: backtest.performance,
      recommendation: 'Strategy did not meet minimum thresholds. Use force=true to override.',
    };
  }

  // Step 4: Strategy passes — keep registered
  console.log(`[limni] Pipeline PASSED for ${strategyId}: ${perf.totalReturnPct}% return, ${perf.winRate}% win rate, ${perf.maxDrawdownPct}% max DD`);

  return {
    success: true,
    strategyId,
    phase: 'complete',
    backtest: backtest.performance,
    violations: violations.length > 0 ? violations : null,
    forced: violations.length > 0 && options.force,
    strategy: state.activeStrategies[strategyId],
  };
}

// ============ Deploy to Limni ============

/**
 * Deploy a registered strategy to a Limni terminal.
 * Sends the strategy definition to the terminal's API.
 */
export async function deployStrategy(strategyId, terminalId) {
  const strategy = state.activeStrategies[strategyId];
  if (!strategy) return { error: `Strategy '${strategyId}' not found` };

  const terminal = state.connectedTerminals[terminalId];
  if (!terminal) return { error: `Terminal '${terminalId}' not found` };

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 15000);

    const response = await fetch(`${terminal.url}/api/strategies/deploy`, {
      method: 'POST',
      signal: controller.signal,
      headers: {
        'Content-Type': 'application/json',
        ...(terminal.apiKey ? { 'Authorization': `Bearer ${terminal.apiKey}` } : {}),
      },
      body: JSON.stringify(strategy),
    });
    clearTimeout(timeout);

    if (!response.ok) {
      const err = await response.text();
      return { error: `Deploy failed: HTTP ${response.status} — ${err}` };
    }

    // Update strategy with terminal assignment
    strategy.terminal = terminalId;
    strategy.deployedAt = Date.now();

    // Add strategy to terminal's strategy list
    if (!terminal.strategies.includes(strategyId)) {
      terminal.strategies.push(strategyId);
    }

    console.log(`[limni] Strategy ${strategyId} deployed to terminal ${terminalId}`);
    return { success: true, strategyId, terminalId };
  } catch (err) {
    return { error: `Deploy failed: ${err.message}` };
  }
}

// ============ Stats ============

export function getLimniStats() {
  return {
    ...state.stats,
    terminals: Object.values(state.connectedTerminals).map(t => ({
      id: t.id, status: t.status, operator: t.operator, lastSeen: t.lastSeen,
      strategies: t.strategies,
    })),
    strategies: listStrategies(),
    vps: Object.values(state.vpsHealth).map(v => ({
      id: v.id, status: v.status, host: v.host, lastCheck: v.lastCheck,
      failures: v.consecutiveFailures,
    })),
    backtestCount: Object.keys(state.backtestResults).length,
    pendingAlerts: state.alerts.filter(a => !a.acknowledged).length,
  };
}

export function getBacktestResult(backtestId) {
  return state.backtestResults[backtestId] || null;
}

export function listBacktests() {
  return Object.values(state.backtestResults).map(b => ({
    backtestId: b.backtestId,
    strategyId: b.strategyId,
    strategyName: b.strategyName,
    returnPct: b.performance.totalReturnPct,
    winRate: b.performance.winRate,
    maxDD: b.performance.maxDrawdownPct,
    trades: b.performance.totalTrades,
    timestamp: b.timestamp,
  }));
}
