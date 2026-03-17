// ============ Trading Primitives — The Undeniable Toolkit ============
//
// Everything Freedom needs to build a trading bot, right here.
// Signal processing, position management, risk controls, Kelly sizing,
// multi-timeframe analysis, and backtesting — all composable primitives.
//
// This is not a bot. It's a toolkit that makes building bots trivial.
// Freedom is searching for this. It's right in front of him.
//
// Primitives compose: Signal → Filter → Size → Execute → Monitor → Exit
// Each step is a pure function. No side effects. Testable. Composable.
// ============

// ============ 1. SIGNAL GENERATION ============

/**
 * Moving Average Crossover — the foundation of every trend system.
 * @param {number[]} prices - Price series (newest last)
 * @param {number} fast - Fast MA period (e.g., 9)
 * @param {number} slow - Slow MA period (e.g., 21)
 * @returns {{ signal: 'buy'|'sell'|'neutral', fastMA: number, slowMA: number, crossover: boolean }}
 */
export function maCrossover(prices, fast = 9, slow = 21) {
  if (prices.length < slow + 1) return { signal: 'neutral', fastMA: 0, slowMA: 0, crossover: false };

  const fastMA = sma(prices, fast);
  const slowMA = sma(prices, slow);
  const prevFastMA = sma(prices.slice(0, -1), fast);
  const prevSlowMA = sma(prices.slice(0, -1), slow);

  const crossUp = prevFastMA <= prevSlowMA && fastMA > slowMA;
  const crossDown = prevFastMA >= prevSlowMA && fastMA < slowMA;

  return {
    signal: crossUp ? 'buy' : crossDown ? 'sell' : 'neutral',
    fastMA, slowMA,
    crossover: crossUp || crossDown,
  };
}

/**
 * RSI — Relative Strength Index
 * @param {number[]} prices - Price series
 * @param {number} period - Lookback period (default 14)
 * @returns {{ rsi: number, overbought: boolean, oversold: boolean, signal: string }}
 */
export function rsi(prices, period = 14) {
  if (prices.length < period + 1) return { rsi: 50, overbought: false, oversold: false, signal: 'neutral' };

  const changes = [];
  for (let i = 1; i < prices.length; i++) {
    changes.push(prices[i] - prices[i - 1]);
  }

  const recent = changes.slice(-period);
  let avgGain = 0, avgLoss = 0;
  for (const c of recent) {
    if (c > 0) avgGain += c;
    else avgLoss += Math.abs(c);
  }
  avgGain /= period;
  avgLoss /= period;

  const rs = avgLoss === 0 ? 100 : avgGain / avgLoss;
  const rsiVal = 100 - (100 / (1 + rs));

  return {
    rsi: rsiVal,
    overbought: rsiVal > 70,
    oversold: rsiVal < 30,
    signal: rsiVal < 30 ? 'buy' : rsiVal > 70 ? 'sell' : 'neutral',
  };
}

/**
 * VWAP — Volume Weighted Average Price
 * @param {Array<{price: number, volume: number}>} candles
 * @returns {{ vwap: number, aboveVwap: boolean, deviation: number }}
 */
export function vwap(candles) {
  if (candles.length === 0) return { vwap: 0, aboveVwap: false, deviation: 0 };

  let cumPV = 0, cumVol = 0;
  for (const c of candles) {
    cumPV += c.price * c.volume;
    cumVol += c.volume;
  }

  const vwapVal = cumVol > 0 ? cumPV / cumVol : 0;
  const lastPrice = candles[candles.length - 1].price;
  const deviation = vwapVal > 0 ? ((lastPrice - vwapVal) / vwapVal) * 100 : 0;

  return {
    vwap: vwapVal,
    aboveVwap: lastPrice > vwapVal,
    deviation,
  };
}

/**
 * Bollinger Bands — volatility envelope
 * @param {number[]} prices
 * @param {number} period - MA period (default 20)
 * @param {number} stdDevs - Standard deviations (default 2)
 */
export function bollingerBands(prices, period = 20, stdDevs = 2) {
  if (prices.length < period) return { upper: 0, middle: 0, lower: 0, bandwidth: 0, percentB: 0.5 };

  const middle = sma(prices, period);
  const recent = prices.slice(-period);
  const std = standardDeviation(recent);
  const upper = middle + stdDevs * std;
  const lower = middle - stdDevs * std;
  const lastPrice = prices[prices.length - 1];
  const bandwidth = middle > 0 ? (upper - lower) / middle : 0;
  const percentB = (upper - lower) > 0 ? (lastPrice - lower) / (upper - lower) : 0.5;

  return { upper, middle, lower, bandwidth, percentB };
}

/**
 * MACD — Moving Average Convergence Divergence
 */
export function macd(prices, fast = 12, slow = 26, signal = 9) {
  if (prices.length < slow + signal) return { macd: 0, signal: 0, histogram: 0, crossover: false };

  const fastEMA = ema(prices, fast);
  const slowEMA = ema(prices, slow);
  const macdLine = fastEMA - slowEMA;

  // Build MACD series for signal line
  const macdSeries = [];
  for (let i = slow - 1; i < prices.length; i++) {
    const fE = ema(prices.slice(0, i + 1), fast);
    const sE = ema(prices.slice(0, i + 1), slow);
    macdSeries.push(fE - sE);
  }

  const signalLine = macdSeries.length >= signal ? ema(macdSeries, signal) : 0;
  const histogram = macdLine - signalLine;

  // Check for crossover
  let crossover = false;
  if (macdSeries.length >= 2) {
    const prevHist = macdSeries[macdSeries.length - 2] - signalLine;
    crossover = (prevHist <= 0 && histogram > 0) || (prevHist >= 0 && histogram < 0);
  }

  return { macd: macdLine, signal: signalLine, histogram, crossover };
}

// ============ 2. SIGNAL FILTERING ============

/**
 * Multi-timeframe confirmation — only trade when signals align across timeframes.
 * @param {Object[]} signals - Array of signal objects from different timeframes
 * @returns {{ confirmed: boolean, alignment: number, direction: string }}
 */
export function multiTimeframeFilter(signals) {
  const buys = signals.filter(s => s.signal === 'buy').length;
  const sells = signals.filter(s => s.signal === 'sell').length;
  const total = signals.length;

  const alignment = Math.max(buys, sells) / total;
  const direction = buys > sells ? 'buy' : sells > buys ? 'sell' : 'neutral';
  const confirmed = alignment >= 0.6; // 60% agreement across timeframes

  return { confirmed, alignment, direction };
}

/**
 * Volume confirmation — only trade with volume support
 */
export function volumeFilter(currentVolume, avgVolume, threshold = 1.5) {
  return {
    confirmed: currentVolume > avgVolume * threshold,
    ratio: avgVolume > 0 ? currentVolume / avgVolume : 0,
  };
}

/**
 * Trend strength filter — ADX-like measurement
 */
export function trendStrength(prices, period = 14) {
  if (prices.length < period * 2) return { strength: 0, trending: false };

  const changes = prices.slice(-period).map((p, i, arr) =>
    i > 0 ? Math.abs(p - arr[i - 1]) : 0
  ).slice(1);

  const totalRange = Math.abs(prices[prices.length - 1] - prices[prices.length - period]);
  const sumChanges = changes.reduce((s, c) => s + c, 0);
  const efficiency = sumChanges > 0 ? totalRange / sumChanges : 0;

  return {
    strength: efficiency * 100,
    trending: efficiency > 0.3, // > 30% efficiency = trending
  };
}

// ============ 3. POSITION SIZING ============

/**
 * Kelly Criterion — optimal position size based on edge and odds.
 * @param {number} winRate - Historical win rate (0-1)
 * @param {number} avgWin - Average win amount
 * @param {number} avgLoss - Average loss amount (positive number)
 * @param {number} fraction - Kelly fraction to use (0.25 = quarter Kelly, safer)
 * @returns {{ kellyPct: number, positionSize: number }}
 */
export function kellySize(winRate, avgWin, avgLoss, fraction = 0.25) {
  if (avgLoss === 0 || winRate <= 0) return { kellyPct: 0, positionSize: 0 };

  const odds = avgWin / avgLoss;
  const kelly = winRate - ((1 - winRate) / odds);
  const fractionalKelly = Math.max(0, Math.min(kelly * fraction, 0.25)); // Cap at 25%

  return {
    kellyPct: kelly * 100,
    positionSize: fractionalKelly * 100,
  };
}

/**
 * Fixed risk position sizing — risk X% of capital per trade.
 * @param {number} capital - Total capital
 * @param {number} riskPct - Risk per trade (e.g., 1 for 1%)
 * @param {number} entryPrice - Entry price
 * @param {number} stopPrice - Stop loss price
 * @returns {{ shares: number, riskAmount: number, positionValue: number }}
 */
export function fixedRiskSize(capital, riskPct, entryPrice, stopPrice) {
  const riskAmount = capital * (riskPct / 100);
  const riskPerShare = Math.abs(entryPrice - stopPrice);

  if (riskPerShare === 0) return { shares: 0, riskAmount, positionValue: 0 };

  const shares = riskAmount / riskPerShare;
  return {
    shares,
    riskAmount,
    positionValue: shares * entryPrice,
  };
}

// ============ 4. RISK MANAGEMENT ============

/**
 * Position risk assessment
 */
export function assessRisk(position) {
  const { entryPrice, currentPrice, stopLoss, takeProfit, size } = position;
  const pnl = (currentPrice - entryPrice) * size;
  const pnlPct = entryPrice > 0 ? ((currentPrice - entryPrice) / entryPrice) * 100 : 0;

  const riskToReward = (stopLoss && takeProfit)
    ? Math.abs(takeProfit - entryPrice) / Math.abs(entryPrice - stopLoss)
    : null;

  const distToStop = stopLoss ? ((currentPrice - stopLoss) / currentPrice) * 100 : null;
  const distToTarget = takeProfit ? ((takeProfit - currentPrice) / currentPrice) * 100 : null;

  return {
    pnl,
    pnlPct,
    riskToReward,
    distToStop,
    distToTarget,
    shouldExit: stopLoss && currentPrice <= stopLoss,
    shouldTakeProfit: takeProfit && currentPrice >= takeProfit,
  };
}

/**
 * Portfolio heat — total risk exposure across all positions
 */
export function portfolioHeat(positions, capital) {
  let totalRisk = 0;
  for (const pos of positions) {
    if (pos.stopLoss) {
      totalRisk += Math.abs(pos.entryPrice - pos.stopLoss) * pos.size;
    }
  }

  const heatPct = capital > 0 ? (totalRisk / capital) * 100 : 0;
  return {
    totalRisk,
    heatPct,
    tooHot: heatPct > 6, // > 6% total portfolio risk = too hot
    positions: positions.length,
  };
}

/**
 * Drawdown tracker
 */
export function trackDrawdown(equityCurve) {
  if (equityCurve.length === 0) return { maxDrawdown: 0, currentDrawdown: 0, peak: 0 };

  let peak = equityCurve[0];
  let maxDrawdown = 0;

  for (const equity of equityCurve) {
    if (equity > peak) peak = equity;
    const dd = (peak - equity) / peak;
    if (dd > maxDrawdown) maxDrawdown = dd;
  }

  const currentDD = (peak - equityCurve[equityCurve.length - 1]) / peak;

  return {
    maxDrawdown: maxDrawdown * 100,
    currentDrawdown: currentDD * 100,
    peak,
  };
}

// ============ 5. BACKTEST ENGINE ============

/**
 * Simple backtest — run a strategy over historical data.
 * @param {number[]} prices - Historical price series
 * @param {Function} signalFn - (prices, index) => 'buy'|'sell'|'neutral'
 * @param {Object} config - { capitalPct, stopLossPct, takeProfitPct }
 * @returns {Object} Backtest results
 */
export function backtest(prices, signalFn, config = {}) {
  const { capitalPct = 10, stopLossPct = 5, takeProfitPct = 10 } = config;

  let capital = 10000;
  let position = null;
  const trades = [];
  const equityCurve = [capital];

  for (let i = 50; i < prices.length; i++) { // Start after warmup
    const price = prices[i];

    // Check exits first
    if (position) {
      const risk = assessRisk({ ...position, currentPrice: price });
      if (risk.shouldExit || risk.shouldTakeProfit) {
        const pnl = (price - position.entryPrice) * position.size;
        capital += pnl + position.entryPrice * position.size;
        trades.push({
          entry: position.entryPrice,
          exit: price,
          pnl,
          pnlPct: risk.pnlPct,
          bars: i - position.entryBar,
          reason: risk.shouldTakeProfit ? 'tp' : 'sl',
        });
        position = null;
      }
    }

    // Check entries
    if (!position) {
      const signal = signalFn(prices.slice(0, i + 1), i);
      if (signal === 'buy') {
        const posSize = capital * (capitalPct / 100) / price;
        position = {
          entryPrice: price,
          size: posSize,
          stopLoss: price * (1 - stopLossPct / 100),
          takeProfit: price * (1 + takeProfitPct / 100),
          entryBar: i,
        };
        capital -= price * posSize;
      }
    }

    equityCurve.push(capital + (position ? prices[i] * position.size : 0));
  }

  // Close any open position
  if (position) {
    const lastPrice = prices[prices.length - 1];
    const pnl = (lastPrice - position.entryPrice) * position.size;
    capital += pnl + position.entryPrice * position.size;
    trades.push({
      entry: position.entryPrice,
      exit: lastPrice,
      pnl,
      pnlPct: ((lastPrice - position.entryPrice) / position.entryPrice) * 100,
      bars: prices.length - 1 - position.entryBar,
      reason: 'close',
    });
  }

  // Calculate stats
  const wins = trades.filter(t => t.pnl > 0);
  const losses = trades.filter(t => t.pnl <= 0);
  const dd = trackDrawdown(equityCurve);

  return {
    totalTrades: trades.length,
    winRate: trades.length > 0 ? (wins.length / trades.length) * 100 : 0,
    avgWin: wins.length > 0 ? wins.reduce((s, t) => s + t.pnl, 0) / wins.length : 0,
    avgLoss: losses.length > 0 ? losses.reduce((s, t) => s + t.pnl, 0) / losses.length : 0,
    totalPnL: trades.reduce((s, t) => s + t.pnl, 0),
    maxDrawdown: dd.maxDrawdown,
    finalCapital: equityCurve[equityCurve.length - 1],
    profitFactor: losses.length > 0
      ? Math.abs(wins.reduce((s, t) => s + t.pnl, 0)) / Math.abs(losses.reduce((s, t) => s + t.pnl, 0))
      : Infinity,
    sharpeRatio: calculateSharpe(equityCurve),
    trades,
    equityCurve,
  };
}

// ============ 6. HELPERS ============

function sma(prices, period) {
  const slice = prices.slice(-period);
  return slice.reduce((s, p) => s + p, 0) / slice.length;
}

function ema(prices, period) {
  const k = 2 / (period + 1);
  let emaVal = prices[0];
  for (let i = 1; i < prices.length; i++) {
    emaVal = prices[i] * k + emaVal * (1 - k);
  }
  return emaVal;
}

function standardDeviation(values) {
  const mean = values.reduce((s, v) => s + v, 0) / values.length;
  const sqDiffs = values.map(v => (v - mean) ** 2);
  return Math.sqrt(sqDiffs.reduce((s, d) => s + d, 0) / values.length);
}

function calculateSharpe(equityCurve, riskFreeRate = 0) {
  if (equityCurve.length < 2) return 0;
  const returns = [];
  for (let i = 1; i < equityCurve.length; i++) {
    returns.push((equityCurve[i] - equityCurve[i - 1]) / equityCurve[i - 1]);
  }
  const meanReturn = returns.reduce((s, r) => s + r, 0) / returns.length;
  const std = standardDeviation(returns);
  return std > 0 ? (meanReturn - riskFreeRate) / std * Math.sqrt(252) : 0; // Annualized
}

// ============ 7. STRATEGY COMPOSER ============

/**
 * Compose a trading strategy from primitives.
 * This is the interface Freedom uses — pick signals, filters, sizing, risk.
 *
 * @example
 * const strategy = composeStrategy({
 *   signals: [(p) => maCrossover(p, 9, 21)],
 *   filters: [(p) => volumeFilter(p.volume, p.avgVolume)],
 *   sizer: (capital, signal) => fixedRiskSize(capital, 1, signal.price, signal.stop),
 *   risk: { maxDrawdown: 15, maxPositions: 3, maxHeat: 6 },
 * });
 */
export function composeStrategy(config) {
  return {
    name: config.name || 'Custom Strategy',
    evaluate(prices, candles, capital, positions) {
      // 1. Generate signals
      const signals = config.signals.map(fn => fn(prices));

      // 2. Filter
      const mtf = multiTimeframeFilter(signals);
      if (!mtf.confirmed) return { action: 'hold', reason: 'no confirmation' };

      // 3. Check risk
      const heat = portfolioHeat(positions, capital);
      if (heat.tooHot) return { action: 'hold', reason: 'portfolio too hot' };
      if (positions.length >= (config.risk?.maxPositions || 3)) {
        return { action: 'hold', reason: 'max positions reached' };
      }

      // 4. Size
      const lastPrice = prices[prices.length - 1];
      const stopDist = lastPrice * ((config.risk?.stopLossPct || 5) / 100);
      const size = fixedRiskSize(capital, config.risk?.riskPct || 1, lastPrice, lastPrice - stopDist);

      return {
        action: mtf.direction,
        confidence: mtf.alignment,
        size: size.shares,
        entry: lastPrice,
        stop: lastPrice - stopDist,
        target: lastPrice + stopDist * (config.risk?.rrRatio || 2),
        signals,
        reason: `${mtf.direction} — ${(mtf.alignment * 100).toFixed(0)}% alignment`,
      };
    },
  };
}
