// ============ MI Bridge — Wire Cell Capabilities to Tool Functions ============
// Maps MI manifest capabilities to actual tool implementations.
// Called at startup after MI Host init to register handlers.
//
// This is the bridge between declarative manifests and imperative code.
// When the MI Host invokes a capability, the bridge routes it to the
// correct function in tools.js, tools-utility.js, etc.
//
// Usage:
//   import { registerMIBridge } from './mi-bridge.js';
//   await registerMIBridge();  // After initMIHost()
// ============

import { registerHandler, emitSignal } from './mi-host.js';

// ============ Handler Registry ============
// Maps cellId.capabilityName → handler function
// Lazy imports: tools are loaded on first use to avoid circular deps

let toolsLoaded = false;
let tools = {};
let toolsUtility = {};
let toolsFun = {};
let toolsAlerts = {};
let limni = {};
let learning = {};

async function ensureToolsLoaded() {
  if (toolsLoaded) return;
  try {
    tools = await import('./tools.js');
    toolsUtility = await import('./tools-utility.js');
    toolsFun = await import('./tools-fun.js');
    toolsAlerts = await import('./tools-alerts.js');
    limni = await import('./limni.js');
    learning = await import('./learning.js');
    toolsLoaded = true;
  } catch (err) {
    console.warn(`[mi-bridge] Failed to load tools: ${err.message}`);
  }
}

// ============ Bridge Registration ============

/**
 * Register all MI cell capability handlers.
 * Call this after initMIHost() in the startup sequence.
 */
export async function registerMIBridge() {
  await ensureToolsLoaded();
  if (!toolsLoaded) {
    console.warn('[mi-bridge] Tools not available — bridge not registered');
    return { registered: 0 };
  }

  let count = 0;

  // ============ Price Feed Cell ============
  count += registerIfExists('price-feed-cell', 'getPrice', async (input) => {
    const result = await tools.getPrice(input.symbol || input.pair || 'bitcoin');
    return result;
  });

  count += registerIfExists('price-feed-cell', 'getMarketOverview', async (input) => {
    const trending = await tools.getTrending();
    const fearGreed = await tools.getFearGreed();
    return `${trending}\n\n${fearGreed}`;
  });

  // ============ Market Data Cell ============
  count += registerIfExists('market-data-cell', 'getPrice', async (input) => {
    return await tools.getPrice(input.token);
  });

  count += registerIfExists('market-data-cell', 'getTrending', async () => {
    return await tools.getTrending();
  });

  count += registerIfExists('market-data-cell', 'getChart', async (input) => {
    return await tools.getChart(input.token, input.days || 7);
  });

  count += registerIfExists('market-data-cell', 'getFearGreed', async () => {
    return await tools.getFearGreed();
  });

  count += registerIfExists('market-data-cell', 'getGasPrices', async () => {
    return await tools.getGasPrices();
  });

  count += registerIfExists('market-data-cell', 'getATH', async (input) => {
    return await tools.getATH(input.token);
  });

  count += registerIfExists('market-data-cell', 'getDominance', async () => {
    return await tools.getDominance();
  });

  count += registerIfExists('market-data-cell', 'convertCrypto', async (input) => {
    return await tools.convertCrypto(input.amount, input.from, input.to);
  });

  // ============ DeFi Analytics Cell ============
  count += registerIfExists('defi-analytics-cell', 'getTVL', async (input) => {
    return await tools.getTVL(input.protocol);
  });

  count += registerIfExists('defi-analytics-cell', 'getYields', async (input) => {
    const result = await tools.getYields(input.chain);
    // Emit yield alert for exceptionally high APY (>100%) — possible rug/unsustainable
    if (result && typeof result === 'string' && /\d{3,}%/.test(result)) {
      emitSignal('defi.yield.alert', { chain: input.chain, result: result.slice(0, 200) });
    }
    return result;
  });

  count += registerIfExists('defi-analytics-cell', 'getDexVolume', async () => {
    return await tools.getDexVolume();
  });

  count += registerIfExists('defi-analytics-cell', 'getChains', async () => {
    return await tools.getChains();
  });

  count += registerIfExists('defi-analytics-cell', 'getStables', async () => {
    return await tools.getStables();
  });

  count += registerIfExists('defi-analytics-cell', 'getWalletBalance', async (input) => {
    return await tools.getWalletBalance(input.address);
  });

  // ============ Utility Tools Cell ============
  count += registerIfExists('utility-tools-cell', 'getWeather', async (input) => {
    return await toolsUtility.getWeather(input.city);
  });

  count += registerIfExists('utility-tools-cell', 'getWiki', async (input) => {
    return await toolsUtility.getWiki(input.topic);
  });

  count += registerIfExists('utility-tools-cell', 'translateText', async (input) => {
    return await toolsUtility.translateText(input.targetLang, input.text);
  });

  count += registerIfExists('utility-tools-cell', 'calculate', async (input) => {
    return toolsUtility.calculate(input.expression);
  });

  count += registerIfExists('utility-tools-cell', 'getWorldTime', async (input) => {
    return toolsUtility.getWorldTime(input.query);
  });

  // ============ Community Engagement Cell ============
  count += registerIfExists('community-engagement-cell', 'coinFlip', async () => {
    return toolsFun.coinFlip();
  });

  count += registerIfExists('community-engagement-cell', 'diceRoll', async (input) => {
    return toolsFun.diceRoll(input.notation || '1d6');
  });

  count += registerIfExists('community-engagement-cell', 'getTrivia', async () => {
    return toolsFun.getTrivia();
  });

  count += registerIfExists('community-engagement-cell', 'recordGM', async (input) => {
    const result = toolsFun.recordGM(input.userId, input.username);
    // Emit milestone signal when streak thresholds are hit
    if (result && typeof result === 'string' && /streak/i.test(result)) {
      emitSignal('community.streak.milestone', {
        userId: input.userId,
        username: input.username,
        result,
      });
    }
    return result;
  });

  count += registerIfExists('community-engagement-cell', 'getGMLeaderboard', async () => {
    return toolsFun.getGMLeaderboard();
  });

  // ============ Rug Check Cell ============
  count += registerIfExists('rug-check-cell', 'checkRug', async (input) => {
    if (toolsAlerts.checkRug) {
      const result = await toolsAlerts.checkRug(input.address, input.chain);
      // Emit security alert for high-risk findings
      if (result && typeof result === 'object' && result.riskLevel === 'high') {
        emitSignal('security.alert.high', {
          address: input.address,
          chain: input.chain,
          riskLevel: result.riskLevel,
          flags: result.flags,
        });
      }
      return result;
    }
    return { error: 'Rug check API not configured' };
  });

  // ============ Limni Trading Cell ============
  count += registerIfExists('limni-trading-cell', 'registerTerminal', async (input) => {
    return limni.registerTerminal(input.terminalId, {
      url: input.url, apiKey: input.apiKey, operator: input.operator
    });
  });

  count += registerIfExists('limni-trading-cell', 'checkTerminalHealth', async (input) => {
    return await limni.checkTerminalHealth(input.terminalId);
  });

  count += registerIfExists('limni-trading-cell', 'registerStrategy', async (input) => {
    return limni.registerStrategy(input.strategyId, input.strategyDef);
  });

  count += registerIfExists('limni-trading-cell', 'listStrategies', async () => {
    return limni.listStrategies();
  });

  count += registerIfExists('limni-trading-cell', 'runBacktest', async (input) => {
    return limni.runBacktest(input.strategyId, input.priceData || [], input.options || {});
  });

  count += registerIfExists('limni-trading-cell', 'deployStrategy', async (input) => {
    return await limni.deployStrategy(input.strategyId, input.terminalId);
  });

  count += registerIfExists('limni-trading-cell', 'getAlerts', async (input) => {
    return limni.getAlerts(input.limit || 20);
  });

  count += registerIfExists('limni-trading-cell', 'getLimniStats', async () => {
    return limni.getLimniStats();
  });

  count += registerIfExists('limni-trading-cell', 'registerVPS', async (input) => {
    return limni.registerVPS(input.vpsId, input.vpsConfig || {});
  });

  count += registerIfExists('limni-trading-cell', 'checkAllVPS', async () => {
    return await limni.checkAllVPS();
  });

  // ============ Knowledge Learner Cell ============
  count += registerIfExists('knowledge-learner-cell', 'learnFact', async (input) => {
    // learnFact requires userId/userName/chatId/chatType — use system defaults for MI invocation
    const result = await learning.learnFact(
      input.userId || 'mi-system',
      input.userName || 'MI Cell',
      input.chatId || 'mi-internal',
      'private',
      input.fact,
      input.category || 'general',
      input.tags || []
    );
    return { stored: result, broadcast: true };
  });

  count += registerIfExists('knowledge-learner-cell', 'recallKnowledge', async (input) => {
    // If a query is provided, use full knowledge context builder (searches facts by relevance)
    if (input.query) {
      const context = await learning.buildKnowledgeContext(
        input.userId || 'mi-system',
        input.chatId || 'mi-internal',
        'private',
        input.query
      );
      return { context, query: input.query };
    }
    // With userId only, return user knowledge summary
    if (input.userId) {
      const summary = await learning.getUserKnowledgeSummary(input.userId);
      return { facts: summary ? [summary] : [], count: summary ? 1 : 0 };
    }
    // Fallback: general learning stats
    const stats = await learning.getLearningStats(input.userId || 'mi-system', input.chatId);
    return { facts: stats ? [stats] : [], count: stats ? 1 : 0 };
  });

  console.log(`[mi-bridge] Registered ${count} capability handlers`);
  return { registered: count };
}

/**
 * Register a handler only if the cell exists in the MI Host.
 * Returns 1 if registered, 0 if cell not found.
 */
function registerIfExists(cellId, capName, handler) {
  const success = registerHandler(cellId, capName, handler);
  if (!success) {
    // Cell not loaded — skip silently
    return 0;
  }
  return 1;
}
