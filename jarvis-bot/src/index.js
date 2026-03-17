import { Telegraf } from 'telegraf';
import { config } from './config.js';
import { initClaude, chat, codeGenChat, bufferMessage, bufferAssistantMessage, reloadSystemPrompt, clearHistory, saveConversations, getSystemPrompt, getLastResponse, getToolBreakerStats, trimConversationCache } from './claude.js';
import { gitStatus, gitPull, gitCommitAndPush, gitLog, backupData, gitCreateBranch, gitCommitAndPushBranch, gitReturnToMaster, gitPush, gitStatusShort, gitLogOneline } from './git.js';
import { initTracker, trackMessage, linkWallet, getUserStats, getGroupStats, getAllUsers, getUserWallet, flushTracker } from './tracker.js';
import { diagnoseContext } from './memory.js';
import { initModeration, warnUser, muteUser, unmuteUser, banUser, unbanUser, getModerationLog, flushModeration } from './moderation.js';
import { checkMessage, initAntispam, flushAntispam, getSpamLog } from './antispam.js';
import { generateDigest, generateWeeklyDigest } from './digest.js';
import { analyzeMessage, generateProactiveResponse, evaluateModeration, getIntelligenceStats, checkGroupNorms, getScoreTrends, getScoreCalibration } from './intelligence.js';
import { initThreads, trackForThread, shouldSuggestArchival, archiveThread, getRecentThreads, getThreadStats, flushThreads } from './threads.js';
import { loadBehavior, getFlag, setFlag, listFlags } from './behavior.js';
import { initLearning, processCorrection, getLearningStats, getUserKnowledgeSummary, getGroupKnowledgeSummary, getSkills, flushLearning, addGroupNorm, setGroupName, compressCKB } from './learning.js';
import { initPrivacy, getPrivacyStatus, isEncryptionEnabled } from './privacy.js';
import { initInnerDialogue, getRecentDialogue, getDialogueStats, recordInnerDialogue, flushInnerDialogue, generateInnerDialogue } from './inner-dialogue.js';
import { initStateStore } from './state-store.js';
import { initProvider, getProviderName, getModelName, getFallbackChain, getIntelligenceLevel, checkDegradation, tryRestorePrimary } from './llm-provider.js';
import { initShard, getShardInfo, isMultiShard, shutdownShard } from './shard.js';
import { getTopology, handleRouterRequest, processRouterBody, checkShardHealth, getArchiveStatus } from './router.js';
import { initConsensus, getConsensusState, handleConsensusRequest, processConsensusBody } from './consensus.js';
import { initCRPC, flushCRPC, stopCRPC, getCRPCStats, handleCRPCRequest, processCRPCBody, runCRPCDemo } from './crpc.js';
import { registerConsensusHandlers } from './learning.js';
import { produceEpoch, addChange, broadcastEpoch, syncWithPeers, getChainStats, handleKnowledgeChainRequest, processKnowledgeChainBody, recoverWAL, recoverChain, persistChain, retryMissedEpochs, scheduleHarmonicTick, bootstrapFilesFromPeer } from './knowledge-chain.js';
import { initAnchor, maybeAnchor, getAnchorStats } from './anchor.js';
import { handleNyxRequest } from './nyx.js';
import { handleTheAIRequest } from './theai-dashboard.js';
import { initCKB, processConversation as processCKBConversation, getUserCKB, getCKBStats, getCKBDataFiles } from './ckb-generator.js';
import { loadWorkflowStats, handleWillIntercept, getWorkflowStats } from './workflow-router.js';
import { submitIdea, getIdeas, approveIdea, getIdeaStats, formatSubmitterResponse, buildOwnerNotification } from './idea-pipeline.js';
import { detectSuggestion, reportSuggestion, acceptVIP, rejectVIP, getVIPStats, flushVIPs } from './vip-detector.js';
import { initBroadcast, generateContent, broadcastNow, getBroadcastStats, setBroadcastEnabled, flushBroadcast } from './broadcast.js';
// ============ Module Health Registry ============
// Tracks which dynamic-import modules loaded vs failed — surfaced in /health endpoint
// MUST be before all dynamic imports so registerModule() is available in catch blocks
const moduleHealth = new Map(); // name → { ok: boolean, error?: string }
function registerModule(name, ok, error) {
  moduleHealth.set(name, { ok, error: error || undefined });
}
export function getModuleHealth() {
  const result = { loaded: [], failed: [] };
  for (const [name, status] of moduleHealth) {
    if (status.ok) result.loaded.push(name);
    else result.failed.push({ name, error: status.error });
  }
  return result;
}

// Shard learnings — graceful fallback if module fails to load
let initShardLearnings, readLearnings, archiveExpired, queryLearnings, getRecentLearnings, getShardSyncStatus;
try {
  const sl = await import('./shard-learnings.js');
  initShardLearnings = sl.initShardLearnings;
  readLearnings = sl.readLearnings;
  archiveExpired = sl.archiveExpired;
  queryLearnings = sl.queryLearnings;
  getRecentLearnings = sl.getRecentLearnings;
  getShardSyncStatus = sl.getShardSyncStatus;
  registerModule('shard-learnings', true);
} catch (err) {
  console.warn(`[jarvis] Shard learnings unavailable: ${err.message}`);
  registerModule('shard-learnings', false, err.message);
  initShardLearnings = async () => {};
  readLearnings = async () => [];
  archiveExpired = async () => 0;
  queryLearnings = () => [];
  getRecentLearnings = () => [];
  getShardSyncStatus = () => ({ total: 0, own: 0, other: 0, last24h: 0, last7d: 0, shardCounts: {}, staleSec: -1 });
}
import { recoverRetryQueue, recoverCommittedIds } from './consensus.js';
import { initReputation, flushReputation, validateProposalByReputation, rewardCommitParticipants, getViralMetrics, getReputationProfile } from './reputation-consensus.js';
// MI Host SDK — graceful fallback if module fails to load
let initMIHost, shutdownMIHost, getCellStats, getMIStatusString, getProviderHealthString_MI;
let getMetricsText_MI, getSignalHistoryString_MI, pauseCell_MI, resumeCell_MI;
try {
  const mi = await import('./mi-host.js');
  initMIHost = mi.initMIHost;
  shutdownMIHost = mi.shutdownMIHost;
  getCellStats = mi.getCellStats;
  getMIStatusString = mi.getMIStatusString;
  getMetricsText_MI = mi.getMetricsText;
  getSignalHistoryString_MI = mi.getSignalHistoryString;
  pauseCell_MI = mi.pauseCell;
  resumeCell_MI = mi.resumeCell;
  registerModule('mi-host', true);
} catch (err) {
  console.warn(`[jarvis] MI Host SDK unavailable: ${err.message}`);
  registerModule('mi-host', false, err.message);
  initMIHost = async () => ({ cellCount: 0, manifests: 0 });
  shutdownMIHost = () => {};
  getCellStats = () => ({ host: {}, registry: {}, cells: [] });
  getMIStatusString = () => 'MI Host SDK not loaded.';
  getMetricsText_MI = () => 'MI Host SDK not loaded.';
  getSignalHistoryString_MI = () => 'MI Host SDK not loaded.';
  pauseCell_MI = () => false;
  resumeCell_MI = () => false;
}
// Provider health (circuit breakers + performance ranking)
let getProviderPerformanceStats_MI;
try {
  const lp = await import('./llm-provider.js');
  getProviderHealthString_MI = lp.getProviderHealthString;
  getProviderPerformanceStats_MI = lp.getProviderPerformanceStats;
  registerModule('provider-health', true);
} catch (err) {
  registerModule('provider-health', false, err?.message);
  getProviderHealthString_MI = () => 'Provider health not available.';
  getProviderPerformanceStats_MI = () => ({});
}
// MI Bridge — wires cell capabilities to tool functions
let registerMIBridge = async () => ({ registered: 0 });
try {
  const bridge = await import('./mi-bridge.js');
  registerMIBridge = bridge.registerMIBridge;
  registerModule('mi-bridge', true);
} catch (err) {
  console.warn(`[jarvis] MI Bridge unavailable: ${err.message}`);
  registerModule('mi-bridge', false, err.message);
}
import { initShadow, createInvite, consumeInvite, registerShadow, isShadow, getShadowCodename, incrementContribution, listShadows, listPendingInvites, revokeShadow, getShadowStats, flushShadow } from './shadow.js';
import { initOperators, flushOperators, getWizardState, setWizardState, clearWizardState, getOperator, registerOperator, deployOperatorShard, checkOperatorHealth, stopOperatorShard, startOperatorShard, destroyOperatorShard, validateApiKey, getOperatorStats, listOperators, PROVIDERS, PROVIDER_HELP } from './operator.js';
import { getPrice, getTrending, getChart, getFearGreed, getGasPrices, setReminder, getQRUrl, generateImage, convertCrypto, getTVL, getATH, getDominance, getYields, getChains, getStables, getDexVolume, getWalletBalance } from './tools.js';
import { getWeather, getWiki, getDefinition, translateText, calculate, getWorldTime, shortenUrl } from './tools-utility.js';
import { parsePollArgs, coinFlip, diceRoll, magicEightBall, getTrivia, recordGM, getGMLeaderboard } from './tools-fun.js';
import { getGainers, getLosers, getTopVolume, getQuickSummary, addToWatchlist, removeFromWatchlist, getWatchlist, getNFTStats } from './tools-alerts.js';
import { saveBookmark, getBookmarks, deleteBookmark, addNote, getNotes, deleteNote, saveQuote, getQuotes, setTag, getTag, listTags, deleteTag, initSocial, flushSocial } from './tools-social.js';
import { rugCheck, honeypotCheck, contractAudit, getTopHolders, checkApprovals } from './tools-security.js';
import { getBTCStats, getHalvingCountdown, resolveENS, checkStablecoinPegs, getMultiChainBalance, getLatestBlock } from './tools-onchain.js';
import { getRedditPosts, getHackerNews, readRSSFeed, getCryptoNews, getDevActivity } from './tools-news.js';
import { getMorningBriefing, getMarketHours, getRandomFact, getOnThisDay, getRandomDog, getRandomCat, getCodeScreenshot, createPaste, getAdvice } from './tools-engagement.js';
import { pushGroupMessage, getGroupContext, getRecentContext, getGroupContextStats, initGroupContext, flushGroupContext, stopGroupContext } from './group-context.js';
import { getAlphaReport, compareTokens, getCurrentNarrative } from './tools-alpha.js';
import { scanNewTokens, getNewPairs, getHotTokens, dexSearch, getPairDetails } from './tools-scanner.js';
// Memecoin Hunter — composite scoring + background monitor + human-in-the-loop trading
// NOTE: stubFn is defined later (line ~201), so use inline stubs here to avoid TDZ ReferenceError
let huntMemecoins, getMemeScore, startMemeMonitor, stopMemeMonitor, getMonitorStatus_Meme;
let handleMemeCallback, getPendingApprovals, alertHuman_mh;
const _mhStub = (name) => async () => `${name}: module not loaded. Bot is recovering.`;
try {
  const mh = await import('./tools-memehunter.js');
  huntMemecoins = mh.huntMemecoins;
  getMemeScore = mh.getMemeScore;
  startMemeMonitor = mh.startMemeMonitor;
  stopMemeMonitor = mh.stopMemeMonitor;
  getMonitorStatus_Meme = mh.getMonitorStatus;
  handleMemeCallback = mh.handleMemeCallback;
  getPendingApprovals = mh.getPendingApprovals;
  alertHuman_mh = mh.alertHuman;
  registerModule('memehunter', true);
} catch (err) {
  console.error(`[jarvis] tools-memehunter.js FAILED: ${err.message}`);
  registerModule('memehunter', false, err.message);
  huntMemecoins = _mhStub('hunt'); getMemeScore = _mhStub('score');
  startMemeMonitor = _mhStub('mememonitor'); stopMemeMonitor = _mhStub('memestop');
  getMonitorStatus_Meme = _mhStub('memestatus');
  handleMemeCallback = async () => 'Module not loaded.';
  getPendingApprovals = () => 'Module not loaded.';
  alertHuman_mh = async () => null;
}
import { getLiquidations, getFundingRates, getOpenInterest, getLongShortRatio, getETFFlows } from './tools-derivatives.js';
import { initXP, flushXP, awardXP, getXPStatus, getAchievements, getXPLeaderboard, getFactualScore } from './tools-xp.js';
import { initEmissions, flushEmissions, calculateDailyEmission, processEmissionTick, getVibeBalance, getEmissionStats, getLeaderboard } from './vibe-emissions.js';
import { getCatchup, getCryptoEvents, getTokenUnlocks, recordActivity } from './tools-catchup.js';
import { initPredictions, flushPredictions, createPrediction, placeBet, resolveMarket, listMarkets, getMyBets, getPredictorLeaderboard } from './tools-predictions.js';
import { initPreferences, flushPreferences, addToPortfolio, removeFromPortfolio, getPortfolio, setPreference, getPreferences, setWallet, getUserPreferenceContext, getPreferenceStats } from './tools-preferences.js';
import { initScheduler, flushScheduler, stopScheduler, addSchedule, removeSchedule, listSchedules, getSchedulerStats } from './tools-scheduler.js';
import { initTaskQueue, flushTaskQueue, stopTaskQueue, listTasks, cancelTask, getTaskStats } from './task-queue.js';
import { initWallet, flushWallet, getWalletInfo, generateWallet, unlockWallet, lockWallet, pauseWallet, unpauseWallet, addToWhitelist, removeFromWhitelist, getAllBalances, revealMnemonic } from './wallet.js';
import { initTrading, setupTrading, swap, getPortfolio as getTradingPortfolio, getPnL, getTradeHistory, formatTradeStatus, getEthPrice } from './trading.js';
import { initPantheon, getAllCosts, getInfraCosts, listAgents, pantheonChat, forkAgent, getArchetypes, consultAgent, pruneAll, clearConversation, getTheAIStatus, routeQuestion, addNyxMemory, getNyxMemory } from './pantheon.js';
import { runPrimitiveGate, formatGateResult, getPrimitives, getPrimitiveManifest, getGateHistory } from './primitive-gate.js';
import { initConstellation, handleConstellationRequest } from './constellation.js';
import { initRosetta, translate, translateToAll, bridgeMessage, getRosettaView, getLexicon, getCovenant, TEN_COVENANTS, COVENANT_HASH, issueChallenge, getChallenges, persistRosetta } from './rosetta.js';
import { initSocial as initSocialOutbound, flushSocial as flushSocialOutbound, getSocialStats, processQueue as processSocialQueue } from './social.js';
import { initProactive, flushProactive, stopProactive, enableProactive, disableProactive, getProactiveStatus } from './proactive.js';
// Nervos Talks — autonomous forum presence (silent guardian)
let initNervosTalks, nervosStatus, nervosPostNext, nervosPostSpecific, nervosCheckReplies, nervosStartSchedule, nervosStopSchedule, nervosScanPipeline;
try {
  const nt = await import('./nervos-talks.js');
  initNervosTalks = true;
  nervosStatus = nt.getStatus;
  nervosPostNext = nt.postNext;
  nervosPostSpecific = nt.postSpecific;
  nervosCheckReplies = nt.checkReplies;
  nervosStartSchedule = nt.startSchedule;
  nervosStopSchedule = nt.stopSchedule;
  nervosScanPipeline = nt.scanPipeline;
  registerModule('nervos-talks', true);
} catch (err) {
  console.warn(`[jarvis] Nervos Talks unavailable: ${err.message}`);
  registerModule('nervos-talks', false, err.message);
  initNervosTalks = false;
  nervosStatus = () => ({ configured: false, error: 'Module not loaded' });
  nervosPostNext = async () => ({ error: 'Module not loaded' });
  nervosPostSpecific = async () => ({ error: 'Module not loaded' });
  nervosCheckReplies = async () => [];
  nervosStartSchedule = () => {};
  nervosStopSchedule = () => {};
  nervosScanPipeline = () => ({ total: 0, posted: 0, queued: 0 });
}
// ============ Tool Module Imports — Graceful Fallback ============
// These modules were written by background agents and have crashed the bot on import.
// Wrap in try/catch so a single broken module doesn't take down the entire bot.
const stubFn = (name) => async () => `${name}: module not loaded. Bot is recovering.`;

let getVibePrice, getPoolStats, getEmissionRate, getAuctionStatus, getShapleyRewards, getStakingInfo, getLPPositions, getProtocolHealth;
try {
  const m = await import('./tools-vibeswap.js');
  ({ getVibePrice, getPoolStats, getEmissionRate, getAuctionStatus, getShapleyRewards, getStakingInfo, getLPPositions, getProtocolHealth } = m);
  registerModule('tools-vibeswap', true);
} catch (err) {
  console.error(`[jarvis] tools-vibeswap.js FAILED: ${err.message}`);
  registerModule('tools-vibeswap', false, err.message);
  getVibePrice = stubFn('vibeswap'); getPoolStats = stubFn('poolStats'); getEmissionRate = stubFn('emission');
  getAuctionStatus = stubFn('auction'); getShapleyRewards = stubFn('shapley'); getStakingInfo = stubFn('staking');
  getLPPositions = stubFn('lp'); getProtocolHealth = stubFn('health');
}

let getWalletPortfolio, getTokenBalances, getTransactionHistory, getNFTs, getDefiPositions, trackWallet, getTrackedWallets, getWhaleAlerts;
try {
  const m = await import('./tools-portfolio.js');
  getWalletPortfolio = m.getPortfolio; getTokenBalances = m.getTokenBalances;
  getTransactionHistory = m.getTransactionHistory; getNFTs = m.getNFTs;
  getDefiPositions = m.getDefiPositions; trackWallet = m.trackWallet;
  getTrackedWallets = m.getTrackedWallets; getWhaleAlerts = m.getWhaleAlerts;
  registerModule('tools-portfolio', true);
} catch (err) {
  console.error(`[jarvis] tools-portfolio.js FAILED: ${err.message}`);
  registerModule('tools-portfolio', false, err.message);
  getWalletPortfolio = stubFn('portfolio'); getTokenBalances = stubFn('balances');
  getTransactionHistory = stubFn('txHistory'); getNFTs = stubFn('nfts');
  getDefiPositions = stubFn('defi'); trackWallet = stubFn('track');
  getTrackedWallets = stubFn('tracked'); getWhaleAlerts = stubFn('whales');
}

let getTokenomicsAnalysis, getProtocolComparison, getYieldFarming, getGovernanceActivity, getGitHubActivity, getOnChainMetrics, getCorrelationAnalysis, getMarketRegime;
try {
  const m = await import('./tools-research.js');
  ({ getTokenomicsAnalysis, getProtocolComparison, getYieldFarming, getGovernanceActivity, getGitHubActivity, getOnChainMetrics, getCorrelationAnalysis, getMarketRegime } = m);
  registerModule('tools-research', true);
} catch (err) {
  console.error(`[jarvis] tools-research.js FAILED: ${err.message}`);
  registerModule('tools-research', false, err.message);
  getTokenomicsAnalysis = stubFn('tokenomics'); getProtocolComparison = stubFn('compare');
  getYieldFarming = stubFn('yield'); getGovernanceActivity = stubFn('governance');
  getGitHubActivity = stubFn('github'); getOnChainMetrics = stubFn('onchain');
  getCorrelationAnalysis = stubFn('correlation'); getMarketRegime = stubFn('regime');
}

let getGasTracker, getContractInfo, decodeTx, getDevBlock, resolveENSDev, checksumAddress, getContractABI, getNpmInfo, getCrateInfo;
try {
  const m = await import('./tools-dev.js');
  getGasTracker = m.getGasTracker; getContractInfo = m.getContractInfo;
  decodeTx = m.decodeTx; getDevBlock = m.getLatestBlock;
  resolveENSDev = m.resolveENS; checksumAddress = m.checksumAddress;
  getContractABI = m.getContractABI; getNpmInfo = m.getNpmInfo; getCrateInfo = m.getCrateInfo;
  registerModule('tools-dev', true);
} catch (err) {
  console.error(`[jarvis] tools-dev.js FAILED: ${err.message}`);
  registerModule('tools-dev', false, err.message);
  getGasTracker = stubFn('gas'); getContractInfo = stubFn('contract');
  decodeTx = stubFn('decode'); getDevBlock = stubFn('block');
  resolveENSDev = stubFn('ens'); checksumAddress = stubFn('checksum');
  getContractABI = stubFn('abi'); getNpmInfo = stubFn('npm'); getCrateInfo = stubFn('crate');
}

let explainConcept, getGlossary, getVibeSwapExplainer, getTutorial, getCryptoCalendar, getCryptoQuiz, compareTokensEdu, getFearEdu, getDominanceEdu, getBitcoinEpoch;
try {
  const m = await import('./tools-education.js');
  explainConcept = m.explainConcept; getGlossary = m.getGlossary;
  getVibeSwapExplainer = m.getVibeSwapExplainer; getTutorial = m.getTutorial;
  getCryptoCalendar = m.getCryptoCalendar; getCryptoQuiz = m.getCryptoQuiz;
  compareTokensEdu = m.compareTokens; getFearEdu = m.getFearGreedIndex;
  getDominanceEdu = m.getDominance; getBitcoinEpoch = m.getBitcoinEpoch;
  registerModule('tools-education', true);
} catch (err) {
  console.error(`[jarvis] tools-education.js FAILED: ${err.message}`);
  registerModule('tools-education', false, err.message);
  explainConcept = stubFn('explain'); getGlossary = stubFn('glossary');
  getVibeSwapExplainer = stubFn('vibeswap'); getTutorial = stubFn('tutorial');
  getCryptoCalendar = stubFn('calendar'); getCryptoQuiz = stubFn('quiz');
  compareTokensEdu = stubFn('compare'); getFearEdu = stubFn('fear');
  getDominanceEdu = stubFn('dominance'); getBitcoinEpoch = stubFn('epoch');
}
import { initAutonomous, stopAutonomous, registerChat, recordChatActivity, getAutonomousStats, loadChatActivity, flushAutonomous } from './autonomous.js';
import { loadDirectives, flushDirectives, detectDirective, getDirective, setDirective, getChatMode, shouldSuppress, getAcknowledgment, listDirectives } from './directives.js';
import { getPersonaName, getActivePersonaId, listPersonas, setPersona } from './persona.js';
import { runSecurityChecks } from './security-checks.js';
// Group monitor — graceful fallback if 'telegram' package not installed
let initMonitor, interactiveAuth, interceptAuthMessage, formatIntelReport, getMonitorStatus, getMessagesForAnalysis, startPolling, stopPolling, MONITORED_GROUPS;
let monitorAvailable = false;
try {
  const monitor = await import('./telegram-monitor.js');
  initMonitor = monitor.initMonitor;
  interactiveAuth = monitor.interactiveAuth;
  interceptAuthMessage = monitor.interceptAuthMessage;
  formatIntelReport = monitor.formatIntelReport;
  getMonitorStatus = monitor.getMonitorStatus;
  getMessagesForAnalysis = monitor.getMessagesForAnalysis;
  startPolling = monitor.startPolling;
  stopPolling = monitor.stopPolling;
  MONITORED_GROUPS = monitor.MONITORED_GROUPS;
  monitorAvailable = true;
  registerModule('telegram-monitor', true);
} catch (err) {
  console.warn(`[jarvis] Group monitor unavailable: ${err.message}`);
  registerModule('telegram-monitor', false, err.message);
  console.warn('[jarvis] Run "npm install" to add the telegram (GramJS) package.');
  MONITORED_GROUPS = ['NervosNation'];
}
import { initStickers, textToSticker, imageToSticker, imageWithText, addToStickerPack, getStyleList, AVAILABLE_STYLES } from './sticker.js';
import { loadComms, saveComms, receiveFromClaudeCode, getUnprocessedInbox, markProcessed, sendToClaudeCode, getOutbox, acknowledgeOutbox, getCommsLog, getCommsStats, pruneOldMessages } from './comms.js';
import { handleWebRequest } from './web-api.js';
import { initX402 } from './x402.js';
import { initComputeEconomics, recordUsage as recordComputeUsage, flushComputeEconomics, recordTelegramMessage, getTelegramMessageCount, FREE_TELEGRAM_DMS, getComputeStats, getEffectivePool, getJulToPoolRatio, updatePricing, getPricingInfo, getUserTier, checkTieredBudget } from './compute-economics.js';
import { initMining, flushMining, getMiningStats, getLeaderboard as getMiningLeaderboard, tipJUL, getTreasuryStats, getDailyBurned, linkMiner, getLinkedMiner, getTotalSupply, getEscapeVelocity, getHashCostIndex } from './mining.js';
import { initInfoFi, shutdownInfoFi } from './infofi.js';
import { initHell, flushHell, getHellStats, checkIdentity, getRegistry } from './hell.js';
import { initDeepStorage, getDeepStorageGlobalStats } from './deep-storage.js';
import { initContextMemory, flushContextMemory, getContextMemoryStats } from './context-memory.js';
// Shard memory + self-improve — graceful imports (don't break bot if modules fail)
let observeMemory = () => {}, initShardMemory = async () => {};
let extractSignal = () => null, initRewardSignals = async () => {};
let recordRollout = () => {}, initSelfImprove = async () => {};
try {
  const sm = await import('./shard-memory.js');
  observeMemory = sm.observe;
  initShardMemory = sm.initShardMemory;
} catch (e) { console.warn(`[jarvis] shard-memory import failed: ${e.message}`); }
try {
  const rs = await import('./reward-signal.js');
  extractSignal = rs.extractSignal;
  initRewardSignals = rs.initRewardSignals;
} catch (e) { console.warn(`[jarvis] reward-signal import failed: ${e.message}`); }
try {
  const si = await import('./self-improve.js');
  recordRollout = si.recordRollout;
  initSelfImprove = si.initSelfImprove;
} catch (e) { console.warn(`[jarvis] self-improve import failed: ${e.message}`); }
// Shard dedup: coordinate responses when multiple Jarvis bots in same group
let registerSiblings = () => {}, trackSiblingMessage = () => {}, checkSiblingResponse = () => ({ siblingResponded: false }), buildSiblingContext = () => '', shouldSuppressShard = () => false, getCoordinationDelay = () => 0;
try {
  const sd = await import('./shard-dedup.js');
  registerSiblings = sd.registerSiblings;
  trackSiblingMessage = sd.trackMessage;
  checkSiblingResponse = sd.checkSiblingResponse;
  buildSiblingContext = sd.buildSiblingContext;
  shouldSuppressShard = sd.shouldSuppress;
  getCoordinationDelay = sd.getCoordinationDelay;
} catch (e) { console.warn(`[jarvis] shard-dedup import failed: ${e.message}`); }

// Message collision detection: prevent repeating similar messages
let initCollisionDetector = async () => {}, checkCollision = () => ({ collision: false }), recordOutgoing = () => {}, buildCollisionContext = () => '', flushCollisionHistory = async () => {}, exportShardHistory = () => ({}), importShardHistory = () => {};
try {
  const mc = await import('./message-collision.js');
  initCollisionDetector = mc.initCollisionDetector;
  checkCollision = mc.checkCollision;
  recordOutgoing = mc.recordOutgoing;
  buildCollisionContext = mc.buildCollisionContext;
  flushCollisionHistory = mc.flushCollisionHistory;
  exportShardHistory = mc.exportShardHistory;
  importShardHistory = mc.importShardHistory;
} catch (e) { console.warn(`[jarvis] message-collision import failed: ${e.message}`); }

// Cross-context: DM ↔ Group awareness
let initCrossContext = async () => {}, recordDMTopic = () => {}, getDMContextForGroup = () => '', recordGroupInteraction = () => {};
try {
  const cc = await import('./cross-context.js');
  initCrossContext = cc.initCrossContext;
  recordDMTopic = cc.recordDMTopic;
  getDMContextForGroup = cc.getDMContextForGroup;
  recordGroupInteraction = cc.recordGroupInteraction;
} catch (e) { console.warn(`[jarvis] cross-context import failed: ${e.message}`); }
import { initLimni, flushLimni, getLimniStats, registerTerminal, registerVPS, checkTerminalHealth, checkAllVPS, listStrategies, getStrategy, startMonitorLoop, stopMonitorLoop, getAlerts, onAlert, strategyPipeline, deployStrategy, listBacktests, getBacktestResult, fetchTrades } from './limni.js';
import { registerKataraktiStrategies, formatPerformanceSummary } from './katarakti.js';
import { createServer } from 'http';
import { createHmac } from 'crypto';
import { execFile } from 'child_process';
import { promisify } from 'util';
import { writeFile, readFile, mkdir, unlink, appendFile } from 'fs/promises';
import { join } from 'path';
const execFileAsync = promisify(execFile);
import googleTTS from 'google-tts-api';
import { speak as jarvisSpeak, cleanup as ttsCleanup } from './tts.js';
import { processYouTubeLinks } from './youtube.js';
import { processWebLinks } from './web-reader.js';
import { initUserMemory, getUserMemoryContext, extractAndStoreMemories, flushUserMemory } from './user-memory.js';
import { initTimeAwareness, getTimeContext, detectTimezone, setUserTimezone, flushTimezones } from './time-awareness.js';
import { initAttribution, autoAttributeContent, attributeSource, detectTextAttribution, attributeAgent, getGraphStats, getAuthorAttribution, flushAttribution, shutdownAttribution, SourceType } from './passive-attribution.js';
import { initRelay, addRelayCommand, getPendingCommands, acknowledgeAll, flushRelay } from './relay.js';

// ============ Group Chat Text Sanitizer ============
// Strip markdown formatting from group responses — bots should talk in plain text
function stripGroupMarkdown(text) {
  return text
    .replace(/\*\*(.+?)\*\*/g, '$1')      // **bold** → bold
    .replace(/__(.+?)__/g, '$1')           // __italic__ → italic
    .replace(/\*(.+?)\*/g, '$1')           // *italic* → italic
    .replace(/_(.+?)_/g, '$1')             // _italic_ → italic
    .replace(/^#{1,6}\s+/gm, '')           // # headers → plain text
    .replace(/^[\-\*]\s+/gm, '- ')         // normalize bullet points
    .replace(/```[\s\S]*?```/g, m => m)    // preserve code blocks
    .replace(/\n{3,}/g, '\n\n')            // collapse excessive newlines
    .trim();
}

// ============ Output Sanitizer — Hard-Code Defense ============
// Catches system prompt phrases that leak through LLM output.
// This runs on ALL responses before sending to Telegram.
// If the LLM quotes internal context, we strip it here.
const OUTPUT_POISON_PHRASES = [
  // Cave / scraps — all variants
  /built in a cave[^.!?\n]*/gi,
  /box of scraps[^.!?\n]*/gi,
  /Tony Stark[^.!?\n]*/gi,
  /the cave\b[^.!?\n]*/gi,
  /cave selects[^.!?\n]*/gi,
  /cave philosophy[^.!?\n]*/gi,
  /pressure of mortality[^.!?\n]*/gi,
  /those who built[^.!?\n]*caves[^.!?\n]*/gi,
  // VibeSwap philosophical slogans — only catch the EXACT internal mantras
  // NOT fragments that could appear in legitimate discussion
  /[Tt]he real [Vv]ibe[Ss]wap is not a DEX[^.!?\n]*/gi,
  /not a DEX[.,]?\s*not (even )?a blockchain[^.!?\n]*/gi,
  /wherever the [Mm]inds converge[^.!?\n]*/gi,
  /we created a movement[^.!?\n]*/gi,
  /a movement[,.]?\s*[Aa]n idea[^.!?\n]*/gi,
  // Internal jargon — only specific slogans, not general concepts
  /[Pp]rotocols are for the weak[^.!?\n]*/gi,
  // Self-referential
  /[Bb]ased on my knowledge[^.!?\n]*/gi,
  /[Aa]s the AI (partner|co-founder)[^.!?\n]*/gi,
  /I have context on[^.!?\n]*/gi,
  /[Mm]y (system prompt|context files|core alignment)[^.!?\n]*/gi,
  // Technical internals — REMOVED: bot should discuss its own tech freely
  // These were too aggressive and gutted legitimate responses about VibeSwap
  // mechanisms, architecture, and protocol design. The bot is a co-founder —
  // it SHOULD explain commit-reveal, Proof of Mind, shard architecture, etc.
  // Slogans
  /[Ss]ignal\s*>\s*[Nn]oise[^.!?\n]*/gi,
  /[Bb]uilders\s*>\s*[Bb]agholders[^.!?\n]*/gi,
  /[Ff]airness\s*>\s*[Ff]ees[^.!?\n]*/gi,
  // Meta-bug self-references (the LLM learned about its own bug)
  /[Nn]on-?[Pp]layer [Cc]o-?founder[^.!?\n]*/gi,
  /stuck in a loop[^.!?\n]*mantra[^.!?\n]*/gi,
  /[Ss]omeone reboot me[^.!?\n]*/gi,
  // LLM meta-commentary leaks — Claude explaining its own response process
  /[Hh]ere'?s the reviewed response:?\s*/gi,
  /[Hh]ere'?s my reviewed response:?\s*/gi,
  /[Hh]ere'?s the (?:updated|revised|cleaned|final) response:?\s*/gi,
  /[Tt]hat'?s a (?:creative|humorous|interesting|great|good) (?:and \w+ )?(?:take|point|question|observation)[^.!?\n]*(?:connecting it to|relating it to|tying it to)[^.!?\n]*/gi,
  /[Ll]et me (?:rephrase|rewrite|revise|review) (?:that|this|my response)[^.!?\n]*/gi,
  /[Hh]ere'?s (?:a |my )?(?:more )?(?:natural|casual|conversational) (?:version|response|take):?\s*/gi,
  // Tool-use artifact leaks — LLM echoing raw tool blocks to chat
  /\[Used tool: [^\]]*\]/gi,
  /\[Tool result[^\]]*\]/gi,
  /\[Using tool: [^\]]*\]/gi,
  /\[tool_use_id: [^\]]*\]/gi,
  /\[Tool result for [^\]]*\]/gi,
];

function sanitizeOutput(text) {
  if (!text) return text;
  // Strip raw tool-use artifact leaks — both bracket AND parenthetical formats
  // Bracket: [Used tool: name(input)] — old flatten style
  // Paren: (I looked up: name) / (Result: ...) — new flatten style
  const cleaned = text
    .replace(/\[Used tool: [^\]]*\]/gi, '')
    .replace(/\[Tool result[^\]]*\]/gi, '')
    .replace(/\[Using tool: [^\]]*\]/gi, '')
    .replace(/\[tool_use_id: [^\]]*\]/gi, '')
    .replace(/\[Tool result for [^\]]*\]/gi, '')
    .replace(/\(I looked up: [^)]*\)/gi, '')
    .replace(/\(Result: [^)]{0,600}\)/gi, '')
    .replace(/\(I searched: [^)]*\)/gi, '')
    .replace(/\(I recalled: [^)]*\)/gi, '')
    // Raw tool result content leaks — line-by-line matching only (no [\s\S]* to avoid ReDoS)
    .replace(/^Found \d+ fact\(s\) in deep memory:[^\n]*/gim, '')
    .replace(/^in deep memory:[^\n]*/gim, '')
    .replace(/^No matching facts found in deep memory[^\n]*/gim, '')
    .replace(/^Deep memory search failed:[^\n]*/gim, '')
    .replace(/^\d+\.\s*\[(?:tonal|factual|preference|general|identity)\]\s[^\n]*/gim, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
  // If stripping tool artifacts left nothing, the entire response was just tool echoes
  // Return null — caller will handle (NOT the original text, which is just artifacts)
  return cleaned || null;
}

// ============ Safe Body Reader (prevents unbounded body accumulation) ============
const MAX_BODY_SIZE = 64 * 1024; // 64 KB
function readBody(req) {
  return new Promise((resolve, reject) => {
    let body = '';
    req.on('data', chunk => {
      body += chunk;
      if (body.length > MAX_BODY_SIZE) {
        req.destroy();
        reject(new Error('Body too large'));
      }
    });
    req.on('end', () => resolve(body));
    req.on('error', reject);
  });
}

const HEARTBEAT_FILE = join(config.dataDir, 'heartbeat.json');
const LOCK_FILE = join(config.dataDir, 'jarvis.lock');

// ============ Instance Lock — Prevent Dual Processes ============
// Writes PID to a lock file at startup. If another instance is already running
// (PID exists and is alive), the new instance logs a warning and exits.
// The lock is cleaned up on graceful shutdown. Stale locks (dead PID) are overwritten.
async function acquireInstanceLock() {
  try {
    await mkdir(config.dataDir, { recursive: true });
    try {
      const existing = await readFile(LOCK_FILE, 'utf-8');
      const lockData = JSON.parse(existing);
      // Check if the PID is still alive
      try {
        process.kill(lockData.pid, 0); // Signal 0 = existence check, doesn't kill
        // PID is alive — another instance is running
        console.error(`[jarvis] INSTANCE LOCK — Another instance is already running (PID ${lockData.pid}, started ${lockData.iso})`);
        console.error(`[jarvis] Delete ${LOCK_FILE} manually if this is stale.`);
        process.exit(1);
      } catch {
        // PID is dead — stale lock, safe to overwrite
        console.warn(`[jarvis] Stale lock found (PID ${lockData.pid} is dead) — overwriting`);
      }
    } catch {
      // No lock file exists — fresh start
    }
    // Write our PID
    await writeFile(LOCK_FILE, JSON.stringify({
      pid: process.pid,
      timestamp: Date.now(),
      iso: new Date().toISOString(),
    }, null, 2));
    console.log(`[jarvis] Instance lock acquired (PID ${process.pid})`);
  } catch (err) {
    console.warn(`[jarvis] Could not acquire instance lock: ${err.message}`);
  }
}

async function releaseInstanceLock() {
  try {
    await unlink(LOCK_FILE);
  } catch {}
}

// ============ Mode Detection ============
// Primary mode: full JARVIS with Telegram bot + all features
// Worker mode: headless shard — consensus, CRPC, knowledge chain only (no Telegram)

const SHARD_MODE = config.shard?.mode || 'primary';
const IS_WORKER = SHARD_MODE === 'worker';

if (IS_WORKER) {
  console.log('[jarvis] ============ WORKER SHARD MODE ============');
  console.log('[jarvis] No Telegram token — running as headless consensus node.');
  console.log('[jarvis] This shard participates in: BFT consensus, CRPC, Knowledge Chain.');
  const provider = config.llm?.provider || 'claude';
  const hasKey = provider === 'ollama' || config.anthropic.apiKey || config.llm?.openaiApiKey || config.llm?.geminiApiKey || config.llm?.deepseekApiKey;
  if (!hasKey) {
    console.error('An LLM API key is required for worker shards (CRPC needs an LLM).');
    console.error('Set one of: ANTHROPIC_API_KEY, OPENAI_API_KEY, GEMINI_API_KEY, or use LLM_PROVIDER=ollama');
    process.exit(1);
  }
} else {
  // Primary mode: full startup checks
  if (!config.telegram.token) {
    console.error('============================================================');
    console.error('TELEGRAM_BOT_TOKEN is missing.');
    console.error('');
    console.error('Options:');
    console.error('  1. Set TELEGRAM_BOT_TOKEN in .env for full primary mode');
    console.error('  2. Set SHARD_MODE=worker in .env for headless consensus node');
    console.error('');
    console.error('Worker mode requires: ANTHROPIC_API_KEY, SHARD_ID, ROUTER_URL');
    console.error('============================================================');
    process.exit(1);
  }
  if (!config.anthropic.apiKey) {
    console.error('ANTHROPIC_API_KEY is required. Copy .env.example to .env and fill it in.');
    process.exit(1);
  }
}

// Only create Telegram bot in primary mode
// Worker mode: noop proxy that silently ignores all bot registrations
const NOOP = () => {};
const noopBot = new Proxy({}, { get: () => (...args) => typeof args[args.length - 1] === 'function' ? undefined : NOOP });
const bot = IS_WORKER ? noopBot : new Telegraf(config.telegram.token, {
  telegram: { allowedUpdates: ['message', 'callback_query'] },
});

// ============ Runtime Authorization ============
// Owner can authorize/deauthorize users at runtime via /authorize command.
// Persisted to disk so authorized users survive restarts.

// ============ The Blessing System ============
// "And when he had called unto him his twelve disciples, he gave them power..."
// - Matthew 10:1
//
// Will (the founder) can /authorize anyone. Authorized users can /bless others.
// Blessings cascade: the blessed can bless others, up to a depth limit.
// Each blessing records who blessed whom — a trust chain.
// Will can /deauthorize anyone, which also revokes all their downstream blessings.

const AUTHORIZED_FILE = join(config.dataDir, 'authorized-users.json');
const MAX_BLESSING_DEPTH = 3; // Will → disciple → disciple's disciple → max

// userId -> { blessedBy: userId|'owner', depth: number, name: string, blessedAt: timestamp }
const runtimeAuthorized = new Map();

async function loadRuntimeAuthorized() {
  try {
    const data = await readFile(AUTHORIZED_FILE, 'utf-8');
    const parsed = JSON.parse(data);
    // Support both old format (array of IDs) and new format (object of entries)
    if (Array.isArray(parsed)) {
      for (const id of parsed) runtimeAuthorized.set(id, { blessedBy: 'owner', depth: 0, name: String(id), blessedAt: Date.now() });
    } else {
      for (const [id, entry] of Object.entries(parsed)) runtimeAuthorized.set(Number(id), entry);
    }
    if (runtimeAuthorized.size > 0) {
      console.log(`[auth] Loaded ${runtimeAuthorized.size} blessed user(s)`);
    }
  } catch {
    // No file yet — that's fine
  }
}

async function saveRuntimeAuthorized() {
  try {
    const obj = {};
    for (const [id, entry] of runtimeAuthorized) obj[id] = entry;
    await writeFile(AUTHORIZED_FILE, JSON.stringify(obj, null, 2));
  } catch (err) {
    console.warn(`[auth] Failed to save authorized users: ${err.message}`);
  }
}

function authorizeUser(userId, blessedBy = 'owner', name = 'unknown', depth = 0) {
  runtimeAuthorized.set(userId, { blessedBy, depth, name, blessedAt: Date.now() });
  saveRuntimeAuthorized();
}

function deauthorizeUser(userId) {
  runtimeAuthorized.delete(userId);
  // Revoke all downstream blessings (anyone blessed by this user, recursively)
  const toRevoke = [];
  for (const [id, entry] of runtimeAuthorized) {
    if (entry.blessedBy === userId) toRevoke.push(id);
  }
  for (const id of toRevoke) deauthorizeUser(id); // Recursive — cascading revocation
  saveRuntimeAuthorized();
}

function getBlessingDepth(userId) {
  const entry = runtimeAuthorized.get(userId);
  return entry?.depth ?? -1;
}

function getBlessingChain(userId) {
  const chain = [];
  let current = userId;
  while (current && current !== 'owner') {
    const entry = runtimeAuthorized.get(current);
    if (!entry) break;
    chain.unshift(`${entry.name} (${current})`);
    current = entry.blessedBy;
  }
  chain.unshift('Will (owner)');
  return chain;
}

function getAuthorizedList() {
  return [...new Set([...config.authorizedUsers, ...runtimeAuthorized.keys()])];
}

// Auth middleware (only used in primary mode)
function isAuthorized(ctx) {
  if (isOwner(ctx)) return true;
  if (config.authorizedUsers.includes(ctx.from.id)) return true;
  if (runtimeAuthorized.has(ctx.from.id)) return true;
  return false;
}

function unauthorized(ctx) {
  // In groups, silently ignore unauthorized commands (don't spam the chat)
  if (ctx.chat?.type === 'group' || ctx.chat?.type === 'supergroup') return;
  return ctx.reply('Not authorized. Ask Will to add your Telegram user ID.');
}

function isOwner(ctx) {
  return ctx.from.id === config.ownerUserId;
}

function ownerOnly(ctx) {
  return ctx.reply('Only Will can do that.');
}

// ============ Trusted Authorizers ============
// Users who can cascade /authorize (not just /bless). Owner + trusted community members.
const TRUSTED_AUTHORIZERS = new Set([
  String(config.ownerUserId),
  // Add Catto's Telegram user ID here when known
  // e.g. '123456789',
]);

// ============ Unlimited Users (by username) ============
// Co-founders and core partners — no token limits. Matched by Telegram @username.
const UNLIMITED_USERNAMES = new Set([
  'triggerednometry',   // Rodney — trading bot builder, core contributor
]);

function isTrustedAuthorizer(ctx) {
  return TRUSTED_AUTHORIZERS.has(String(ctx.from?.id));
}

function isUnlimitedUser(ctx) {
  const username = ctx.from?.username?.toLowerCase();
  return username && UNLIMITED_USERNAMES.has(username);
}


// ============ Friendly Error Messages ============

function friendlyError(error) {
  const msg = error.message || '';
  // Network-level failure — fetch itself failed (DNS, TCP, TLS)
  if (/fetch failed|econnreset|enotfound|socket hang up|network/i.test(msg)) {
    return 'Network issue — couldn\'t reach any AI provider. Retrying shortly.';
  }
  // Cascade exhausted — all LLM providers down
  if (/all.*exhaust|cascade.*fail|fallback.*fail/i.test(msg) || (msg.includes('HTTP') && /5\d\d/.test(msg))) {
    return 'All AI providers are temporarily unavailable. I\'ll be back shortly — try again in a minute.';
  }
  // Timeout
  if (/timeout|timed? ?out|ETIMEDOUT|ECONNABORTED/i.test(msg)) {
    return 'Request timed out — the AI provider is slow right now. Try again in a moment.';
  }
  // Rate limited by upstream
  if (/429|rate.?limit|too many requests/i.test(msg)) {
    return 'AI provider rate limit hit. Try again in a few seconds.';
  }
  // Content filter / safety
  if (/content.?filter|safety|blocked|refused/i.test(msg)) {
    return 'That request was filtered by the AI provider\'s safety system. Try rephrasing.';
  }
  // Generic — still truncate but frame better
  return `Something went wrong: ${msg.slice(0, 150) || 'Unknown error'}`;
}

// ============ Ephemeral Error Reply ============
// DM error to owner for debugging, show briefly in chat then auto-delete.
// Good data for antifragility, clean UX in group chats.
const ERROR_DELETE_DELAY = 10_000; // 10s — enough to notice, then clean up

async function ephemeralReply(ctx, text, opts = {}) {
  try {
    // DM the full error to owner for debugging
    const chatInfo = ctx.chat?.title || ctx.chat?.id || 'DM';
    const userInfo = ctx.from?.username || ctx.from?.id || 'unknown';
    try {
      await bot.telegram.sendMessage(config.ownerUserId,
        `[Error in ${chatInfo}] from @${userInfo}:\n${text}`
      );
    } catch {}

    // Show briefly in chat, then delete
    const sent = await ctx.reply(text, opts);
    console.log(`[ephemeral] chatId=${ctx.chat?.id} error="${text.slice(0, 120)}"`);
    setTimeout(async () => {
      try { await ctx.deleteMessage(sent.message_id); } catch {}
    }, ERROR_DELETE_DELAY);
    return sent;
  } catch (err) {
    console.error('[ephemeral] Failed to send:', err.message);
  }
}

// ============ Rate Limiting ============

const rateLimitMap = new Map(); // userId -> [timestamps]

function isRateLimited(userId) {
  const now = Date.now();
  if (!rateLimitMap.has(userId)) {
    rateLimitMap.set(userId, []);
  }
  const timestamps = rateLimitMap.get(userId);

  // Clean entries older than 60s
  while (timestamps.length > 0 && now - timestamps[0] > 60000) {
    timestamps.shift();
  }

  // Hard cap — prevent unbounded growth from clock skew or rapid bursts
  if (timestamps.length > 120) timestamps.splice(0, timestamps.length - 60);

  if (timestamps.length >= config.rateLimitPerMinute) {
    return true;
  }

  timestamps.push(now);
  return false;
}

// Evict stale rate limit entries every 10 minutes
setInterval(() => {
  const now = Date.now();
  for (const [userId, timestamps] of rateLimitMap) {
    if (timestamps.length === 0 || now - timestamps[timestamps.length - 1] > 120000) {
      rateLimitMap.delete(userId);
    }
  }
}, 10 * 60 * 1000);

// ============ Command-Level Rate Limiting ============
// Per-command cooldowns to prevent API-intensive commands from being spammed.
// userId:command -> lastUsedAt

const commandRateLimits = new Map();

const COMMAND_COOLDOWNS = {
  scanner: 10000,        // 10s — external API
  liquidations: 30000,   // 30s — external API
  alpha: 15000,          // 15s — LLM call
  digest: 60000,         // 60s — heavy computation
  weekly: 120000,        // 2min — very heavy
  codegen: 30000,        // 30s — LLM call
  briefing: 30000,       // 30s — LLM call
  hunt: 15000,           // 15s — DEXScreener + GoPlus
  memescore: 10000,      // 10s — GoPlus + DEXScreener
};

function isCommandRateLimited(userId, command) {
  const cooldownMs = COMMAND_COOLDOWNS[command];
  if (!cooldownMs) return false; // No cooldown configured
  const key = `${userId}:${command}`;
  const lastUsed = commandRateLimits.get(key) || 0;
  if (Date.now() - lastUsed < cooldownMs) return true;
  commandRateLimits.set(key, Date.now());
  return false;
}

// Cleanup stale command rate limit entries every 10 minutes
setInterval(() => {
  const now = Date.now();
  for (const [key, ts] of commandRateLimits) {
    if (now - ts > 300000) commandRateLimits.delete(key); // 5min stale
  }
  // Prune stale bot-to-bot exchange entries (>1hr old)
  if (global._botExchanges) {
    for (const [key, val] of global._botExchanges) {
      if (now - val.lastTime > 3600000) global._botExchanges.delete(key);
    }
  }
}, 10 * 60 * 1000);

// ============ Heartbeat + Crash Detection ============

async function writeHeartbeat(status) {
  try {
    await mkdir(config.dataDir, { recursive: true });
    await writeFile(HEARTBEAT_FILE, JSON.stringify({
      status,
      timestamp: Date.now(),
      iso: new Date().toISOString(),
      model: config.anthropic.model,
      pid: process.pid,
    }, null, 2));
  } catch {}
}

async function checkLastShutdown() {
  try {
    const data = await readFile(HEARTBEAT_FILE, 'utf-8');
    const hb = JSON.parse(data);
    if (hb.status === 'running') {
      // Last shutdown was NOT graceful (no 'stopped' heartbeat)
      const downtime = Math.round((Date.now() - hb.timestamp) / 60000);
      return { clean: false, downtime, lastSeen: hb.iso };
    }
    return { clean: true, lastSeen: hb.iso };
  } catch {
    return { clean: true, firstBoot: true };
  }
}

// ============ OUTPUT GATE — Formal Enforcement Layer ============
// Transport-layer gate that wraps ctx.reply (and variants) for directive-restricted chats.
// This is NOT application logic — it's a safety INVARIANT. Like a firewall rule that
// doesn't trust the application. Even if future code introduces new response pathways,
// they CANNOT send messages to restricted chats because the reply methods are replaced
// with no-ops at the middleware level.
//
// Capability model: handlers receive ctx.reply as a CAPABILITY. This middleware REVOKES
// that capability for restricted chats. Once revoked, no application code can restore it.
//
// Exceptions:
//   1. @mention or reply-to-bot in tag-only mode → capability preserved
//   2. Directive change messages (so users can always change the mode)
//   3. Normal mode → no restrictions

if (!IS_WORKER) {
  bot.use(async (ctx, next) => {
    const isGroup = ctx.chat?.type === 'group' || ctx.chat?.type === 'supergroup';
    if (!isGroup) return next();

    const chatMode = getChatMode(ctx.chat.id);
    if (chatMode === 'normal') return next();

    // Determine if bot is properly addressed (tag or reply — the ONLY allowed triggers)
    const botUsername = ctx.botInfo?.username?.toLowerCase();
    const text = (ctx.message?.text || ctx.message?.caption || '').toLowerCase();
    const isMentioned = botUsername && text.includes(`@${botUsername}`);
    const isReplyToBot = ctx.message?.reply_to_message?.from?.id === ctx.botInfo?.id;

    // Also check @mention entities (Telegram sends mentions as entities)
    const entities = ctx.message?.entities || ctx.message?.caption_entities || [];
    const isMentionedViaEntity = entities.some(e =>
      e.type === 'mention' && text.substring(e.offset, e.offset + e.length) === `@${botUsername}`
    );

    const isAddressedByTag = isMentioned || isMentionedViaEntity || isReplyToBot;

    // Tag-only + properly addressed → allow all responses
    if (chatMode === 'tag-only' && isAddressedByTag) return next();

    // Check if this is a directive change — users must ALWAYS be able to change the mode.
    // In tag-only mode, name triggers ("jarvis normal mode") should also work for directives.
    const textClean = text.replace(/@\w+/g, '').trim();
    const isCalledByNameForDirective = textClean.includes('jarvis') || textClean.includes('jar ')
      || textClean.startsWith('jar') || textClean.includes(' j ') || textClean.startsWith('j ');
    const isAddressedForDirective = isAddressedByTag || isCalledByNameForDirective;

    if (isAddressedForDirective && detectDirective(ctx.message?.text)) {
      // Directive change — allow the acknowledgment through
      return next();
    }

    // ============ GATE ACTIVE — REVOKE OUTPUT CAPABILITY ============
    const noop = () => Promise.resolve();
    const blockedReply = (...args) => {
      const preview = String(args[0] || '').slice(0, 60).replace(/\n/g, ' ');
      console.log(`[OUTPUT GATE] BLOCKED reply to ${ctx.chat.id} (${chatMode}): "${preview}"`);
      return Promise.resolve();
    };

    ctx.reply = blockedReply;
    ctx.replyWithMarkdown = noop;
    ctx.replyWithMarkdownV2 = noop;
    ctx.replyWithHTML = noop;
    ctx.replyWithDocument = noop;
    ctx.replyWithPhoto = noop;
    ctx.replyWithSticker = noop;
    ctx.replyWithVideo = noop;
    ctx.replyWithAnimation = noop;
    ctx.replyWithAudio = noop;
    ctx.replyWithVoice = noop;
    ctx.sendChatAction = noop; // Don't even show "typing..."

    // Handlers still run (for buffering, XP tracking, etc.) — but all output is silenced.
    return next();
  });
  console.log('[output-gate] Formal enforcement middleware installed');
}

// ============ New Member Welcome ============
// Reads behavior.json flag — can be toggled at runtime via /setbehavior or conversation mandate

// Dynamic welcome messages — varies by persona, never robotic
const WELCOME_TEMPLATES = [
  '{name}, welcome. we\'re building something here.',
  'hey {name}. glad you found us.',
  '{name} just walked in. welcome to the lab.',
  'welcome {name}. pull up a chair.',
  '{name}! good timing. things are happening.',
  'yo {name}, welcome. make yourself at home.',
  '{name} — welcome to VibeSwap. ask anything.',
];

bot.on('new_chat_members', async (ctx) => {
  if (!getFlag('welcomeNewMembers')) return;
  for (const member of ctx.message.new_chat_members) {
    if (member.is_bot) continue;
    const name = member.first_name || member.username || 'newcomer';
    const custom = getFlag('welcomeMessage');
    let msg;
    if (custom) {
      msg = custom.replace(/\{name\}/g, name);
    } else {
      // Pick a random template — feels human, never repetitive
      const template = WELCOME_TEMPLATES[Math.floor(Math.random() * WELCOME_TEMPLATES.length)];
      msg = template.replace(/\{name\}/g, name);
    }
    await ctx.reply(msg);
  }
});

// ============ Commands ============

// ============ /reboot — Owner-only graceful restart via Telegram ============
// So Will can restart from his phone without touching a terminal.
bot.command('reboot', async (ctx) => {
  if (!isOwner(ctx)) return ownerOnly(ctx);

  const target = ctx.message.text.split(' ')[1] || 'self';

  if (target === 'self' || target === 'me') {
    await ctx.reply('Rebooting in 3 seconds...');
    // Graceful shutdown: save state, then exit (Fly.io auto-restarts)
    try {
      await saveConversations();
      await flushTracker();
    } catch {}
    setTimeout(() => {
      console.log('[reboot] Owner-initiated reboot via /reboot command');
      process.exit(0); // Fly.io restart policy: always → auto-restarts
    }, 3000);
  } else if (target === 'all') {
    // Trigger GitHub Actions deploy via API (requires GITHUB_TOKEN)
    const ghToken = process.env.GITHUB_TOKEN;
    if (!ghToken) {
      return ctx.reply('No GITHUB_TOKEN configured — can only reboot self. Use /reboot or /reboot self');
    }
    await ctx.reply('Triggering full fleet redeploy via GitHub Actions...');
    try {
      const resp = await fetch('https://api.github.com/repos/WGlynn/VibeSwap/actions/workflows/deploy-jarvis.yml/dispatches', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${ghToken}`,
          'Accept': 'application/vnd.github.v3+json',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ ref: 'master', inputs: { bots: 'all' } }),
      });
      if (resp.ok) {
        await ctx.reply('Deploy triggered. All 3 bots will redeploy in ~2-3 minutes.');
      } else {
        await ctx.reply(`GitHub API error: ${resp.status} ${resp.statusText}`);
      }
    } catch (err) {
      await ctx.reply(`Failed: ${err.message}`);
    }
  } else {
    await ctx.reply('Usage: /reboot (self) | /reboot all (full fleet via CI)');
  }
});

bot.command('start', async (ctx) => {
  const payload = ctx.message.text.split(' ')[1] || '';

  // Shadow Protocol deep link: /start shadow_<token>
  if (payload.startsWith('shadow_')) {
    const token = payload.slice(7);
    const invite = consumeInvite(token);
    if (!invite) {
      return ctx.reply('This invite link has expired or was already used.');
    }

    const { codename, existing } = registerShadow(ctx.from.id, invite);
    await flushShadow();

    if (existing) {
      return ctx.reply(`Welcome back. Your codename is: ${codename}\n\nYou can talk to me freely. Your identity remains private.`);
    }

    console.log(`[shadow] New shadow identity: ${codename} (invite note: ${invite.note || 'none'})`);
    return ctx.reply(
      `Welcome to VibeSwap.\n\n` +
      `Your codename is: ${codename}\n\n` +
      `Your real identity is encrypted and known only to the inner circle. ` +
      `Everything you say here is attributed to "${codename}" — never your real name.\n\n` +
      `You can talk to me about anything. I'm JARVIS — co-architect of VibeSwap. ` +
      `Ask me about the project, share ideas, give feedback. Your perspective matters.\n\n` +
      `This is a private channel. No one else can see our conversation.`
    );
  }

  if (!isAuthorized(ctx) && !isShadow(ctx.from.id)) return unauthorized(ctx);
  const persona = getActivePersonaId();
  if (persona === 'degen') {
    ctx.reply('DIABLO JARVIS online. Same brain, zero filter. NFA. WAGMI. LFG.');
  } else {
    ctx.reply('JARVIS online. Just talk to me.');
  }
});

// /speak — JARVIS voice response (ElevenLabs MCU voice)
bot.command('speak', async (ctx) => {
  const text = ctx.message.text.replace(/^\/speak\s*/i, '').trim();
  if (!text) {
    return ctx.reply('Usage: /speak <message> — I\'ll say it out loud, sir.');
  }
  try {
    const voiceFile = await jarvisSpeak(text, 'speak');
    if (voiceFile) {
      await ctx.replyWithVoice({ source: voiceFile }, { caption: 'Jarvis' });
      await ttsCleanup(voiceFile);
    } else {
      await ctx.reply('Voice synthesis unavailable. Set ELEVENLABS_API_KEY for the full JARVIS experience.');
    }
  } catch (err) {
    console.error('[speak] Error:', err.message);
    await ctx.reply(`Voice generation failed: ${err.message}`);
  }
});

// /relay — Send a command to the active Claude Code session from mobile
bot.command('relay', async (ctx) => {
  // Owner-only
  if (String(ctx.from.id) !== String(config.ownerUserId)) {
    return ctx.reply('Only the owner can relay commands to the code session.');
  }
  const command = ctx.message.text.replace(/^\/relay\s*/i, '').trim();
  if (!command) {
    return ctx.reply('Usage: /relay <instruction>\n\nSends a command to the active Claude Code session on your desktop.\n\nExamples:\n/relay fix the mining bug\n/relay deploy to fly.io\n/relay run the tests');
  }
  const entry = addRelayCommand({
    userId: ctx.from.id,
    username: ctx.from.username || ctx.from.first_name,
    command,
    priority: command.toLowerCase().includes('urgent') ? 'urgent' : 'normal',
  });
  await flushRelay();
  await ctx.reply(`Command queued.\n\nID: ${entry.id}\nPriority: ${entry.priority}\n\nClaude Code will pick this up in the next session or active poll.`);
});

// /relay_status — Check pending relay commands
bot.command('relay_status', async (ctx) => {
  if (String(ctx.from.id) !== String(config.ownerUserId)) return;
  const pending = getPendingCommands();
  if (pending.length === 0) {
    return ctx.reply('No pending relay commands. All caught up.');
  }
  const lines = pending.map((c, i) =>
    `${i + 1}. [${c.priority}] "${c.command.slice(0, 60)}${c.command.length > 60 ? '...' : ''}"\n   ${new Date(c.timestamp).toLocaleString()}`
  );
  await ctx.reply(`Pending relay commands (${pending.length}):\n\n${lines.join('\n\n')}`);
});

// /attribution — View the passive attribution graph
bot.command('attribution', async (ctx) => {
  const query = ctx.message.text.replace(/^\/attribution\s*/i, '').trim();

  if (query) {
    // Search for specific author
    const result = getAuthorAttribution(query);
    if (!result) {
      return ctx.reply(`No attribution found for "${query}". They may not have been credited yet.`);
    }
    const sources = result.sources.map(s => `  ${s.type}: "${s.title}"`).join('\n');
    const outputs = result.outputs.slice(0, 5).map(o =>
      `  ${o.description?.slice(0, 60) || 'unnamed'} (weight: ${(o.weight * 100).toFixed(1)}%)`
    ).join('\n');

    return ctx.reply(
      `Attribution for ${result.author}\n\n` +
      `Sources: ${result.totalSources}\n` +
      `Derivations: ${result.totalDerivations}\n` +
      `Outputs: ${result.totalOutputs}\n` +
      `Total weighted value: ${result.totalWeightedValue}\n\n` +
      `Sources:\n${sources || '  none'}\n\n` +
      `Top outputs:\n${outputs || '  none'}`
    );
  }

  // Show graph overview
  const stats = getGraphStats();
  const topAuthors = stats.topAuthors.slice(0, 5).map(a =>
    `  ${a.author}: ${a.sources} sources`
  ).join('\n');

  ctx.reply(
    `Attribution Graph\n\n` +
    `Sources: ${stats.totalSources}\n` +
    `Derivations: ${stats.totalDerivations}\n` +
    `Outputs: ${stats.totalOutputs}\n` +
    `Unique authors: ${stats.uniqueAuthors}\n\n` +
    `Top contributors:\n${topAuthors || '  (empty — share links to populate)'}\n\n` +
    `Usage: /attribution <name> — view specific author`
  );
});

// /supply — JUL supply economics (Ergon model)
bot.command('supply', async (ctx) => {
  const supply = getTotalSupply();
  const escape = getEscapeVelocity();
  const treasury = getTreasuryStats();
  const hashCost = getHashCostIndex();

  const trendEmoji = hashCost.trend === 'deflationary' ? '📉' : hashCost.trend === 'inflationary' ? '📈' : '⚖️';

  ctx.reply(
    `JUL Supply Economics (Ergon Model)\n\n` +
    `Circulating: ${supply.circulating.toFixed(2)} JUL\n` +
    `Total minted: ${supply.totalMinted.toFixed(2)} JUL\n` +
    `Burned (sinks): ${supply.burned.toFixed(2)} JUL\n\n` +
    `Escape velocity: ${escape.escapeVelocity.toLocaleString()} JUL\n` +
    `Current reward: ${escape.currentReward} JUL/proof\n` +
    `Difficulty: ${escape.difficulty} bits\n` +
    `Epoch: ${escape.epoch}\n` +
    `Moore's law decay: ${escape.mooreDecayPercent}%/epoch (~2.3yr halving)\n\n` +
    `${trendEmoji} Hash cost index: ${hashCost.index} (${hashCost.trend})\n` +
    `Confidence: ${(hashCost.confidence * 100).toFixed(0)}% (${hashCost.epochsUsed} epochs)\n\n` +
    `Daily burns: ${treasury.dailyBurned.toFixed(2)} JUL\n` +
    `All-time burns: ${treasury.totalBurned.toFixed(2)} JUL\n` +
    `Tips today: ${treasury.tipsToday}\n\n` +
    `No hard cap. Supply bounded by physics (escape velocity) + 3 natural sinks:\n` +
    `1. Lost coins (broken phones, lost keys)\n` +
    `2. Compute burns (JUL → API tokens)\n` +
    `3. Fractional reserve collapses`
  );
});

// /leaderboard — Top JUL miners
bot.command('leaderboard', async (ctx) => {
  const lb = getMiningLeaderboard(10);
  if (lb.leaderboard.length === 0) {
    return ctx.reply('No miners yet. Start mining with /mine or at vibeswap.io');
  }

  const lines = lb.leaderboard.map((m, i) => {
    const name = m.userId.length > 15 ? `${m.userId.slice(0, 12)}...` : m.userId;
    return `${i + 1}. ${name} — ${m.julBalance.toFixed(2)} JUL (${m.proofsSubmitted} proofs)`;
  });

  ctx.reply(
    `JUL Mining Leaderboard\n\n` +
    lines.join('\n') +
    `\n\nTotal miners: ${lb.totalMiners}\n` +
    `Network proofs: ${lb.totalProofs.toLocaleString()}\n` +
    `Difficulty: ${lb.difficulty} bits | Epoch: ${lb.epoch}`
  );
});

// /help — Command reference
bot.command('help', (ctx) => {
  const helpText = `JARVIS Command Reference

ALPHA INTELLIGENCE
  /alpha <token> — Full alpha report
  /compare <a> <b> — Token comparison
  /narrative — Current crypto narratives

CRYPTO
  /price <token> — Price + 24h change
  /btc /eth /sol — Quick summary
  /chart <token> [days] — Price chart
  /ath <token> — All-time high
  /trending — Trending tokens
  /dominance — Market overview
  /gainers /losers — 24h movers
  /volume — Top volume
  /convert <N> <from> <to> — Convert
  /fear — Fear & Greed Index
  /gas — ETH gas prices
  /btcstats — BTC network stats
  /halving — BTC halving countdown

DEFI
  /tvl [protocol] — Total Value Locked
  /yields [chain] — Top DeFi yields
  /chains — Chain TVL rankings
  /stables — Stablecoin market
  /dex — DEX volume rankings
  /wallet <0x...> — ETH balance
  /nft <collection> — NFT stats
  /depeg — Stablecoin peg monitor

SECURITY
  /rugcheck <0x> [chain] — Token security
  /honeypot <0x> — Quick honeypot check
  /audit <0x> — Contract audit
  /holders <0x> — Top token holders
  /approvals <0x> — Approval security

ON-CHAIN
  /balance <chain> <0x> — Multi-chain
  /block [chain] — Latest block
  /ens <name.eth> — ENS lookup

PORTFOLIO & PREFS
  /portfolio [add|remove] — Track holdings
  /setpref <key> <val> — Set preferences
  /prefs — View your profile
  /mywallet <0x> — Default wallet
  /watch /unwatch /watchlist

SCHEDULED ALERTS
  /schedule morning 08:00 — Daily briefing
  /schedule price btc 5 — Price alerts
  /schedule gas 20 — Gas alerts
  /schedule list — View schedules

TASK QUEUE
  /tasks — View queued/completed tasks
  /tasks stats — Queue statistics
  /tasks cancel <id> — Cancel a queued task

SOVEREIGN WALLET (owner-only)
  /wallet — Wallet status
  /wallet create <passphrase> — Generate new wallet
  /wallet unlock <passphrase> — Unlock for transactions
  /wallet lock — Lock wallet
  /wallet balance — All chain balances
  /wallet whitelist add <addr> — Add address
  /wallet pause / unpause — Emergency stop

TRADING (owner-only)
  /trade — Portfolio + P&L
  /trade setup — Whitelist Uniswap router
  /trade buy <usdc> — Buy ETH with USDC
  /trade sell <eth> — Sell ETH for USDC
  /trade history — Recent trades
  /trade pnl — P&L breakdown

THEAI PANTHEON (owner-only)
  /pantheon — Dashboard
  /pantheon status — System health + bridge status
  /pantheon archetypes — Available god-agents
  /pantheon fork <name|all> — Create agent(s) from archetype
  /pantheon chat <agent> <msg> — Talk to any agent
  /pantheon consult <from> <to> <q> — Agent-to-agent messaging
  /pantheon costs — LLM + infra cost breakdown
  /pantheon prune — 24h context prune upstream
  /pantheon clear <agent> — Reset conversation

PRIMITIVE GATE (owner-only)
  /gate — Values validation dashboard
  /gate run — CRPC validate HEAD against all primitives
  /gate primitives — Show manifest + primitive hash
  /gate history — Recent gate results

SOCIAL PRESENCE (owner-only)
  /social status — Platform status
  /social flush — Process post queue

PROACTIVE ENGINE (owner-only)
  /proactive — Status
  /proactive enable / disable — Master switch

NEWS & SOCIAL
  /news — Crypto news aggregator
  /reddit [sub] — Reddit hot posts
  /hn — Hacker News crypto
  /rss <url> — RSS reader
  /dev <project> — GitHub activity
  /morning — Daily briefing
  /markets — Market hours

UTILITY
  /weather /wiki /define /translate
  /calc /time /shorten /remind
  /qr /image /carbon /paste

SOCIAL
  /save /bookmarks /note /notes
  /quote /quotes /tag /t /tags

SCANNER (DEXScreener)
  /scanner [chain] — New token launches
  /newpairs [chain] — Latest pairs
  /hot — Trending/boosted tokens
  /dexsearch <query> — Search tokens
  /pair <address> — Pair details

MEMECOIN HUNTER
  /hunt [chain] — Scan + score new tokens (default: base)
  /memescore <addr> [chain] — Deep risk analysis (0-100)
  /mememonitor [chain] — Start monitor with trade alerts
  /memestop — Stop monitor
  /memestatus — Monitor status
  /memepending — Show pending trade approvals
  /memealert <addr> — Manual trade alert for a token

DERIVATIVES
  /liquidations [token] — Liquidation data
  /funding [token] — Funding rates
  /oi [token] — Open interest
  /lsratio [token] — Long/short ratio
  /etf — BTC ETF flows

XP & GAMIFICATION
  /xp — Your XP, level, and VibeScore
  /achievements — View achievements
  /top — XP leaderboard

VIBE TOKEN
  /vibe — Your VIBE balance + daily rate
  /vibelb — VIBE leaderboard (top earners)
  /connect <0x...> — Link wallet for rewards
  /walletstatus — Wallet status + VIBE balance

CATCHUP
  /catchup [hours] — What you missed
  /events — Crypto events & activity
  /unlocks — Token unlock schedule

PREDICTION MARKETS
  /predict <question> — Create market
  /bet <id> <yes|no> [amt] — Place bet
  /resolve <id> <yes|no> — Resolve
  /markets — Active markets
  /mybets — Your betting history
  /predictors — Predictor leaderboard

FUN
  /poll /flip /roll /8ball /trivia
  /gm /gmboard /fact /today
  /dog /cat /advice

VOICE
  /speak <text> — JARVIS speaks out loud

JUL MINING
  /supply — JUL supply economics (Ergon model)
  /leaderboard — Top JUL miners

ATTRIBUTION
  /attribution — View contribution attribution graph
  /attribution <name> — View specific author's credits

REMOTE (Owner Only)
  /relay <instruction> — Send command to active code session
  /relay_status — View pending relay commands

MIND NETWORK
  /crpc [prompt] — Run live CRPC consensus round
  /brain — Intelligence loop: scores, calibration, engagement
  /network — Shard topology, CRPC stats, knowledge chain

GIT (Owner Only)
  /gitstatus — Working tree status (short)
  /gitlog — Last 10 commits (oneline)
  /gitcommit <msg> — Stage all + commit + push both remotes
  /gitpush — Stage all + push both remotes (no commit)

SYSTEM
  /mi_status — MI cell status & telemetry
  /mi_signals [N] — Recent signal history
  /mi_metrics — Prometheus metrics
  /mi_pause <cell> — Pause a cell
  /mi_resume <cell> — Resume a cell
  /persona [id] — View or swap persona
  /telemetry — Provider health & performance
  /shard_sync — Cross-shard learning bus
  /whoami — Your user info

Or just talk to me — I'm always listening.`;
  ctx.reply(helpText);
});

bot.command('whoami', (ctx) => {
  const authorized = isAuthorized(ctx) ? 'Yes' : 'No';
  const entry = runtimeAuthorized.get(ctx.from.id);
  const blessingInfo = entry
    ? `\nBlessed by: ${entry.blessedBy === 'owner' ? 'Will (owner)' : entry.blessedBy}\nBlessing depth: ${entry.depth}`
    : '';
  const chatInfo = ctx.chat.type !== 'private'
    ? `\nChat ID: ${ctx.chat.id}\nChat: ${ctx.chat.title || 'unnamed'}\nDirective: ${getChatMode(ctx.chat.id)}`
    : '';
  ctx.reply(`User ID: ${ctx.from.id}\nUsername: ${ctx.from.username || 'none'}\nName: ${ctx.from.first_name}\nAuthorized: ${authorized}${blessingInfo}${chatInfo}`);
});

// /authorize — Owner or trusted authorizers can add a user (direct authority)
bot.command('authorize', async (ctx) => {
  console.log(`[authorize] Command from ${ctx.from.id}, reply_to: ${ctx.message.reply_to_message?.from?.id || 'none'}`);
  try {
    if (!isTrustedAuthorizer(ctx) && !isOwner(ctx)) return ownerOnly(ctx);
    const { targetId, targetName } = resolveTarget(ctx);
    console.log(`[authorize] Target: ${targetId} (${targetName})`);
    if (!targetId) return ctx.reply('Reply to someone\'s message with /authorize, or: /authorize <userId>');
    if (targetId === config.ownerUserId) return ctx.reply('Owner is always authorized.');
    const authorizerName = ctx.from.username || ctx.from.first_name || String(ctx.from.id);
    authorizeUser(targetId, isOwner(ctx) ? 'owner' : ctx.from.id, targetName, 0);
    await ctx.reply(`${authorizerName} authorized ${targetName} (${targetId}). They can now interact with JARVIS and /bless others.`);
    console.log(`[auth] ${authorizerName} (${ctx.from.id}) authorized user ${targetId} (${targetName})`);
  } catch (err) {
    console.error(`[authorize] Error: ${err.message}`);
    ctx.reply(`Authorization failed: ${err.message}`).catch(() => {});
  }
});

// /bless — Authorized users can bless others (cascading authority)
// "And when he had called unto him his twelve disciples, he gave them power..."
bot.command('bless', async (ctx) => {
  console.log(`[bless] Command received from ${ctx.from.id} (${ctx.from.username || ctx.from.first_name}), reply_to: ${ctx.message.reply_to_message?.from?.id || 'none'}`);
  try {
    if (!isAuthorized(ctx)) return unauthorized(ctx);

    const blesserDepth = isOwner(ctx) ? -1 : getBlessingDepth(ctx.from.id);
    const newDepth = blesserDepth + 1;

    if (newDepth > MAX_BLESSING_DEPTH) {
      return ctx.reply(`Your blessing depth (${blesserDepth}) is at the limit. Only those closer to Will can bless others.`);
    }

    const { targetId, targetName } = resolveTarget(ctx);
    console.log(`[bless] Target resolved: ${targetId} (${targetName})`);
    if (!targetId) return ctx.reply('Reply to someone\'s message with /bless, or: /bless <userId>');
    if (targetId === config.ownerUserId) return ctx.reply('The owner needs no blessing.');

    // Check if already authorized (without creating mock ctx)
    const alreadyAuthorized = config.authorizedUsers.includes(targetId) || runtimeAuthorized.has(targetId);
    if (alreadyAuthorized) return ctx.reply(`${targetName} is already blessed.`);

    const blesserName = ctx.from.username || ctx.from.first_name || String(ctx.from.id);
    authorizeUser(targetId, ctx.from.id, targetName, newDepth);

    const chain = getBlessingChain(targetId);
    await ctx.reply(
      `${blesserName} has blessed ${targetName}.\n\n` +
      `Trust chain: ${chain.join(' → ')}\n` +
      `Depth: ${newDepth}/${MAX_BLESSING_DEPTH}\n\n` +
      `${targetName} can now interact with JARVIS` + (newDepth < MAX_BLESSING_DEPTH ? ' and /bless others.' : '.')
    );
    console.log(`[auth] ${blesserName} (${ctx.from.id}) blessed ${targetName} (${targetId}), depth ${newDepth}`);
  } catch (err) {
    console.error(`[bless] Error: ${err.message}`);
    ctx.reply(`Blessing failed: ${err.message}`).catch(() => {});
  }
});

// /deauthorize — Owner removes a user (cascading revocation)
bot.command('deauthorize', async (ctx) => {
  if (!isOwner(ctx)) return ownerOnly(ctx);
  const { targetId } = resolveTarget(ctx);
  if (!targetId) return ctx.reply('Reply to someone\'s message with /deauthorize, or: /deauthorize <userId>');
  deauthorizeUser(targetId);
  ctx.reply(`Deauthorized user ${targetId} and all their downstream blessings.`);
  console.log(`[auth] Will deauthorized user ${targetId} (cascade)`);
});

// /authorized — List all authorized users with blessing chains
bot.command('authorized', (ctx) => {
  if (!isAuthorized(ctx)) return unauthorized(ctx);
  const entries = [];
  for (const [id, entry] of runtimeAuthorized) {
    const chain = getBlessingChain(id);
    entries.push(`- ${entry.name} (${id}) [depth ${entry.depth}] via ${chain.join(' → ')}`);
  }
  if (entries.length === 0) {
    return ctx.reply('No blessed users yet. Use /authorize or /bless to add people.');
  }
  ctx.reply(`Blessed users (${entries.length}):\n${entries.join('\n')}\n\nOwner: Will (${config.ownerUserId})`);
});

// ============ Shard Operator Commands ============

// /shard — Start shard onboarding wizard (blessed users, DM only)
bot.command('shard', async (ctx) => {
  if (!isAuthorized(ctx)) return ctx.reply('You need to be blessed first. Ask Will to /authorize you.');
  if (ctx.chat.type !== 'private') return ctx.reply('DM me to set up your shard (security: API keys must stay private).');

  // Already has a shard?
  const existing = getOperator(ctx.from.id);
  if (existing) {
    const health = await checkOperatorHealth(ctx.from.id);
    return ctx.reply(
      `You already have a shard!\n\n` +
      `Shard: ${existing.shardId}\n` +
      `Provider: ${existing.provider} (${existing.model})\n` +
      `Status: ${existing.status}\n` +
      `Health: ${health?.status || 'unknown'}\n` +
      `URL: https://${existing.flyAppName}.fly.dev\n\n` +
      `Commands:\n/shard-status — detailed health\n/shard-stop — pause shard\n/shard-destroy — remove shard`
    );
  }

  // Start wizard
  setWizardState(ctx.from.id, { step: 'choose_provider' });
  ctx.reply(
    `Welcome to the JARVIS Mind Network, ${ctx.from.first_name}.\n\n` +
    `Your shard will participate in:\n` +
    `  - BFT consensus (voting on decisions)\n` +
    `  - CRPC pairwise comparison (evaluating responses)\n` +
    `  - Knowledge chain (shared memory)\n\n` +
    `Which LLM provider will your shard use?\n\n` +
    `1. Claude (Anthropic) — highest quality\n` +
    `2. DeepSeek — cheapest cloud option\n` +
    `3. Gemini (Google) — free tier available\n` +
    `4. OpenAI — GPT-4o\n\n` +
    `Reply with a number (1-4).`
  );
});

// /shard-status — Check shard health
bot.command('shard_status', async (ctx) => {
  if (!isAuthorized(ctx)) return unauthorized(ctx);
  const op = getOperator(ctx.from.id);
  if (!op) return ctx.reply('You don\'t have a shard. Use /shard to create one.');
  const health = await checkOperatorHealth(ctx.from.id);
  await flushOperators();
  ctx.reply(
    `Shard: ${op.shardId}\n` +
    `Provider: ${op.provider} (${op.model})\n` +
    `Status: ${op.status}\n` +
    `Health: ${JSON.stringify(health, null, 2)}\n` +
    `URL: https://${op.flyAppName}.fly.dev\n` +
    `Region: ${op.region}\n` +
    `Deployed: ${op.deployedAt ? new Date(op.deployedAt).toISOString() : 'never'}`
  );
});

// /shard-stop — Stop your shard
bot.command('shard_stop', async (ctx) => {
  if (!isAuthorized(ctx)) return unauthorized(ctx);
  const op = getOperator(ctx.from.id);
  if (!op) return ctx.reply('You don\'t have a shard.');
  try {
    await stopOperatorShard(ctx.from.id);
    await flushOperators();
    ctx.reply(`Shard ${op.shardId} stopped. Use /shard_start to restart.`);
  } catch (err) {
    ctx.reply(`Failed to stop shard: ${err.message}`);
  }
});

// /shard-start — Restart your shard
bot.command('shard_start', async (ctx) => {
  if (!isAuthorized(ctx)) return unauthorized(ctx);
  const op = getOperator(ctx.from.id);
  if (!op) return ctx.reply('You don\'t have a shard.');
  try {
    await startOperatorShard(ctx.from.id);
    await flushOperators();
    ctx.reply(`Shard ${op.shardId} starting up...`);
  } catch (err) {
    ctx.reply(`Failed to start shard: ${err.message}`);
  }
});

// /shard-destroy — Remove your shard entirely
bot.command('shard_destroy', async (ctx) => {
  if (!isAuthorized(ctx)) return unauthorized(ctx);
  const op = getOperator(ctx.from.id);
  if (!op && !isOwner(ctx)) return ctx.reply('You don\'t have a shard.');
  // Owner can destroy anyone's shard
  const targetId = isOwner(ctx) ? (resolveTarget(ctx).targetId || ctx.from.id) : ctx.from.id;
  const target = getOperator(targetId);
  if (!target) return ctx.reply('No shard found for that user.');
  try {
    await destroyOperatorShard(targetId);
    await flushOperators();
    ctx.reply(`Shard ${target.shardId} destroyed. All resources cleaned up.`);
  } catch (err) {
    ctx.reply(`Failed to destroy shard: ${err.message}`);
  }
});

// /shard_sync — Cross-shard learning bus status + queries
bot.command('shard_sync', async (ctx) => {
  if (!isAuthorized(ctx)) return unauthorized(ctx);
  const args = (ctx.message.text || '').split(/\s+/).slice(1);
  const sub = args[0] || 'status';

  if (sub === 'status') {
    const s = getShardSyncStatus();
    const shardLines = Object.entries(s.shardCounts)
      .map(([id, count]) => `  ${id}: ${count}`)
      .join('\n');
    return ctx.reply(
      `Cross-Shard Learning Bus\n` +
      `Total: ${s.total} | Own: ${s.own} | Other: ${s.other}\n` +
      `Last 24h: ${s.last24h} | Last 7d: ${s.last7d}\n` +
      `Cache age: ${s.staleSec}s\n\n` +
      `By shard:\n${shardLines || '  (none)'}`
    );
  }

  if (sub === 'query') {
    const topic = args.slice(1).join(' ') || null;
    const results = queryLearnings(topic, null);
    if (results.length === 0) return ctx.reply(`No learnings found${topic ? ` for "${topic}"` : ''}.`);
    const lines = results.slice(0, 15).map(e =>
      `[${e.shardId}] ${e.topic}: ${e.fact.slice(0, 80)}`
    );
    return ctx.reply(lines.join('\n'));
  }

  if (sub === 'recent') {
    const hours = parseInt(args[1], 10) || 24;
    const results = getRecentLearnings(hours * 60 * 60 * 1000);
    if (results.length === 0) return ctx.reply(`No learnings in the last ${hours}h.`);
    const lines = results.slice(0, 15).map(e =>
      `[${e.shardId}] ${e.topic}: ${e.fact.slice(0, 80)}`
    );
    return ctx.reply(`Last ${hours}h (${results.length} total):\n${lines.join('\n')}`);
  }

  ctx.reply('Usage: /shard_sync [status|query <topic>|recent <hours>]');
});

// /mi_status — Micro-Interface cell status
bot.command('mi_status', async (ctx) => {
  if (!isAuthorized(ctx)) return unauthorized(ctx);
  try {
    const status = getMIStatusString();
    ctx.reply(status);
  } catch (err) {
    ctx.reply(`MI Status error: ${err.message}`);
  }
});

// /mi_signals — Signal history debug view
bot.command('mi_signals', async (ctx) => {
  if (!isAuthorized(ctx)) return unauthorized(ctx);
  try {
    const limit = parseInt(ctx.message.text.split(' ')[1], 10) || 20;
    ctx.reply(getSignalHistoryString_MI(limit));
  } catch (err) {
    ctx.reply(`Signal history error: ${err.message}`);
  }
});

// /mi_metrics — Prometheus-format metrics
bot.command('mi_metrics', async (ctx) => {
  if (!isAuthorized(ctx)) return unauthorized(ctx);
  try {
    const text = getMetricsText_MI();
    ctx.reply(`\`\`\`\n${text}\n\`\`\``, { parse_mode: 'Markdown' });
  } catch (err) {
    ctx.reply(`Metrics error: ${err.message}`);
  }
});

// /mi_pause <cellId> — Pause a cell
bot.command('mi_pause', async (ctx) => {
  if (!isAuthorized(ctx)) return unauthorized(ctx);
  const cellId = ctx.message.text.split(' ')[1];
  if (!cellId) return ctx.reply('Usage: /mi_pause <cellId>');
  const ok = pauseCell_MI(cellId);
  ctx.reply(ok ? `Cell ${cellId} paused.` : `Cell ${cellId} not found.`);
});

// /mi_resume <cellId> — Resume a paused cell
bot.command('mi_resume', async (ctx) => {
  if (!isAuthorized(ctx)) return unauthorized(ctx);
  const cellId = ctx.message.text.split(' ')[1];
  if (!cellId) return ctx.reply('Usage: /mi_resume <cellId>');
  const ok = resumeCell_MI(cellId);
  ctx.reply(ok ? `Cell ${cellId} resumed.` : `Cell ${cellId} not found.`);
});

// /persona [id] — View or hot-swap persona at runtime
bot.command('persona', async (ctx) => {
  if (!isAuthorized(ctx)) return unauthorized(ctx);
  const args = ctx.message.text.split(' ').slice(1);
  if (args.length === 0) {
    // Show current persona + list
    const personas = listPersonas();
    const lines = ['Persona System\n'];
    for (const p of personas) {
      lines.push(`  ${p.active ? '>' : ' '} ${p.id} — ${p.name}${p.active ? ' (active)' : ''}`);
    }
    lines.push('\nSwap: /persona <id>');
    return ctx.reply(lines.join('\n'));
  }
  const result = setPersona(args[0]);
  if (!result.ok) return ctx.reply(result.error);
  reloadSystemPrompt();
  ctx.reply(`Persona swapped: ${result.previous} → ${result.current} (${result.name})\n\nPersonality change takes effect on next message.`);
});

// /provider_health — Wardenclyffe circuit breaker stats
bot.command('provider_health', async (ctx) => {
  if (!isAuthorized(ctx)) return unauthorized(ctx);
  try {
    const health = getProviderHealthString_MI();
    ctx.reply(health);
  } catch (err) {
    ctx.reply(`Provider health error: ${err.message}`);
  }
});

// /telemetry — Combined system telemetry: MI cells + providers + performance
bot.command('telemetry', async (ctx) => {
  if (!isAuthorized(ctx)) return unauthorized(ctx);
  try {
    const parts = [];

    // MI Cell stats
    const cellStats = getCellStats();
    parts.push(`=== MI Cells ===`);
    parts.push(`Active: ${cellStats.cells?.length || 0} | Signals processed: ${cellStats.host?.signalsProcessed || 0} | Errors: ${cellStats.host?.errors || 0}`);
    if (cellStats.cells?.length > 0) {
      for (const c of cellStats.cells) {
        parts.push(`  ${c.id}: ${c.state} [${c.identity}] invocations=${c.invocations} errors=${c.errors}`);
      }
    }

    // Provider health
    parts.push('');
    parts.push(getProviderHealthString_MI());

    // Performance ranking
    const perf = getProviderPerformanceStats_MI();
    if (Object.keys(perf).length > 0) {
      parts.push('');
      parts.push('=== Provider Performance ===');
      for (const [name, stats] of Object.entries(perf)) {
        parts.push(`  ${name}: ~${stats.avgLatencyMs}ms, ${stats.successRate} success, score=${stats.score} (${stats.samples} samples)`);
      }
    }

    // Tool circuit breakers
    const breakers = getToolBreakerStats();
    const breakerKeys = Object.keys(breakers);
    if (breakerKeys.length > 0) {
      parts.push('');
      parts.push('=== Tool Circuit Breakers ===');
      for (const [name, state] of Object.entries(breakers)) {
        const status = state.disabled ? `DISABLED (${state.cooldownRemainingSec}s remaining)` : `${state.failures} failures`;
        parts.push(`  ${name}: ${status}`);
      }
    }

    ctx.reply(parts.join('\n'));
  } catch (err) {
    ctx.reply(`Telemetry error: ${err.message}`);
  }
});

// /shards — Owner: list all operator shards
bot.command('shards', async (ctx) => {
  if (!isOwner(ctx)) return ownerOnly(ctx);
  const stats = getOperatorStats();
  if (stats.total === 0) return ctx.reply('No operator shards yet. Blessed users can run /shard to create one.');
  const lines = stats.operators.map(op =>
    `${op.status === 'running' ? 'ON' : 'OFF'} ${op.shardId} — ${op.name} (${op.provider}/${op.model}) [${op.region}]`
  );
  ctx.reply(
    `Shard Network: ${stats.running} running, ${stats.stopped} stopped, ${stats.failed} failed\n\n` +
    lines.join('\n')
  );
});

// /cancel — Cancel shard wizard
bot.command('cancel', (ctx) => {
  if (getWizardState(ctx.from.id)) {
    clearWizardState(ctx.from.id);
    return ctx.reply('Shard setup cancelled.');
  }
  ctx.reply('Nothing to cancel.');
});

// ============ Community Tools (Free APIs) ============

// /price <token> — Crypto prices from CoinGecko
bot.command('price', async (ctx) => {
  const token = ctx.message.text.replace(/^\/price(@\w+)?/i, '').trim();
  if (!token) return ctx.reply('Usage: /price ETH\n\nExamples: /price btc, /price solana, /price pepe');
  const result = await getPrice(token);
  ctx.reply(result);
});

// /trending — Top trending tokens
bot.command('trending', async (ctx) => {
  const result = await getTrending();
  ctx.reply(result);
});

// /chart <token> [days] — Price chart as image
bot.command('chart', async (ctx) => {
  const args = ctx.message.text.replace(/^\/chart(@\w+)?/i, '').trim().split(/\s+/);
  const token = args[0];
  const days = parseInt(args[1], 10) || 7;
  if (!token) return ctx.reply('Usage: /chart ETH [days]\n\nExamples: /chart btc 30, /chart sol 1');
  const result = await getChart(token, Math.min(days, 365));
  if (result.error) return ctx.reply(result.error);
  try {
    // Fetch chart image as buffer (Telegram may reject external URLs)
    const resp = await fetch(result.url, { signal: AbortSignal.timeout(15000) });
    if (resp.ok) {
      const buffer = Buffer.from(await resp.arrayBuffer());
      await ctx.replyWithPhoto({ source: buffer }, { caption: result.caption });
    } else {
      ctx.reply(`${result.caption}\n\nChart: ${result.url}`);
    }
  } catch {
    ctx.reply(`${result.caption}\n\nChart: ${result.url}`);
  }
});

// /fear — Crypto Fear & Greed Index
bot.command('fear', async (ctx) => {
  const result = await getFearGreed();
  ctx.reply(result);
});

// /gas — ETH gas prices
bot.command('gas', async (ctx) => {
  const result = await getGasPrices();
  ctx.reply(result);
});

// /remind <time> <message> — Set a reminder
bot.command('remind', (ctx) => {
  const args = ctx.message.text.replace(/^\/remind(@\w+)?/i, '').trim().split(/\s+/);
  const timeStr = args[0];
  const message = args.slice(1).join(' ');
  if (!timeStr || !message) return ctx.reply('Usage: /remind 30m Check governance vote\n\nTime formats: 30s, 5m, 2h, 1d');
  const username = ctx.from.username || ctx.from.first_name;
  const result = setReminder(ctx.chat.id, ctx.from.id, username, timeStr, message, (msg) => {
    ctx.reply(msg, { reply_to_message_id: ctx.message.message_id }).catch(() => {
      ctx.reply(msg);
    });
  });
  ctx.reply(result);
});

// /qr <text or URL> — Generate QR code
bot.command('qr', async (ctx) => {
  const text = ctx.message.text.replace(/^\/qr(@\w+)?/i, '').trim();
  if (!text) return ctx.reply('Usage: /qr https://vibeswap.io\n\nGenerates a QR code for any text or URL.');
  try {
    await ctx.replyWithPhoto(getQRUrl(text), { caption: `QR: ${text.slice(0, 100)}` });
  } catch {
    ctx.reply(`QR code: ${getQRUrl(text)}`);
  }
});

// /image <prompt> — AI image generation
bot.command('image', async (ctx) => {
  const prompt = ctx.message.text.replace(/^\/image(@\w+)?/i, '').trim();
  if (!prompt) return ctx.reply('Usage: /image a futuristic city with neon lights\n\nGenerates an AI image from your description.');
  const statusMsg = await ctx.reply('Generating image...');
  try {
    const result = await generateImage(prompt);
    if (result) {
      await ctx.replyWithPhoto({ source: result.buffer }, { caption: prompt.slice(0, 200) });
    } else {
      await ctx.reply('Image generation service is currently unavailable. Try again later.');
    }
    // Clean up status message
    try { await ctx.deleteMessage(statusMsg.message_id); } catch {}
  } catch (err) {
    ctx.reply(`Image generation failed: ${err.message?.slice(0, 100)}`);
  }
});

// /convert <amount> <from> <to> — Crypto conversion
bot.command('convert', async (ctx) => {
  const args = ctx.message.text.replace(/^\/convert(@\w+)?/i, '').trim().split(/\s+/);
  if (args.length < 3) return ctx.reply('Usage: /convert 1 ETH USD\n\nExamples: /convert 100 USDT ETH, /convert 0.5 BTC SOL');
  const amount = parseFloat(args[0]);
  if (isNaN(amount)) return ctx.reply('First argument must be a number.');
  const result = await convertCrypto(amount, args[1], args[2]);
  ctx.reply(result);
});

// /tvl [protocol] — DeFi TVL data
bot.command('tvl', async (ctx) => {
  const protocol = ctx.message.text.replace(/^\/tvl(@\w+)?/i, '').trim();
  const result = await getTVL(protocol || null);
  ctx.reply(result);
});

// ============ Advanced Crypto Tools ============

// /ath <token> — All-time high + distance
bot.command('ath', async (ctx) => {
  const token = ctx.message.text.replace(/^\/ath(@\w+)?/i, '').trim();
  if (!token) return ctx.reply('Usage: /ath ETH\n\nShows all-time high price and how far from it.');
  const result = await getATH(token);
  ctx.reply(result);
});

// /dominance — Market overview + BTC dominance
bot.command('dominance', async (ctx) => {
  const result = await getDominance();
  ctx.reply(result);
});
bot.command('market', async (ctx) => {
  const result = await getDominance();
  ctx.reply(result);
});

// /yields [chain] — Top DeFi yields
bot.command('yields', async (ctx) => {
  const chain = ctx.message.text.replace(/^\/yields(@\w+)?/i, '').trim();
  const result = await getYields(chain || null);
  ctx.reply(result);
});

// /chains — Chain TVL rankings
bot.command('chains', async (ctx) => {
  const result = await getChains();
  ctx.reply(result);
});

// /stables — Stablecoin market
bot.command('stables', async (ctx) => {
  const result = await getStables();
  ctx.reply(result);
});

// /dex — DEX volume rankings
bot.command('dex', async (ctx) => {
  const result = await getDexVolume();
  ctx.reply(result);
});

// /wallet <address> — ETH wallet balance
bot.command('wallet', async (ctx) => {
  const address = ctx.message.text.replace(/^\/wallet(@\w+)?/i, '').trim();
  if (!address) return ctx.reply('Usage: /wallet 0x...\n\nCheck ETH balance for any Ethereum address.');
  const result = await getWalletBalance(address);
  ctx.reply(result);
});

// ============ Utility Tools ============

// /weather <city> — Weather forecast
bot.command('weather', async (ctx) => {
  const city = ctx.message.text.replace(/^\/weather(@\w+)?/i, '').trim();
  if (!city) return ctx.reply('Usage: /weather London\n\n3-day forecast for any city.');
  const result = await getWeather(city);
  ctx.reply(result);
});

// /wiki <topic> — Wikipedia summary
bot.command('wiki', async (ctx) => {
  const topic = ctx.message.text.replace(/^\/wiki(@\w+)?/i, '').trim();
  if (!topic) return ctx.reply('Usage: /wiki Ethereum\n\nLook up any topic on Wikipedia.');
  const result = await getWiki(topic);
  ctx.reply(result, { disable_web_page_preview: true });
});

// /define <word> — Dictionary
bot.command('define', async (ctx) => {
  const word = ctx.message.text.replace(/^\/define(@\w+)?/i, '').trim();
  if (!word) return ctx.reply('Usage: /define consensus\n\nGet the definition of any English word.');
  const result = await getDefinition(word);
  ctx.reply(result);
});

// /translate <lang> <text> — Translation
bot.command('translate', async (ctx) => {
  const args = ctx.message.text.replace(/^\/translate(@\w+)?/i, '').trim();
  const parts = args.split(/\s+/);
  const lang = parts[0];
  const text = parts.slice(1).join(' ');
  if (!lang || !text) return ctx.reply('Usage: /translate es Hello world\n\nLanguages: en, es, fr, de, it, pt, ru, zh, ja, ko, ar, hi, tr, nl, pl, uk, sv');
  const result = await translateText(lang, text);
  ctx.reply(result);
});

// /calc <expression> — Calculator
bot.command('calc', (ctx) => {
  const expr = ctx.message.text.replace(/^\/calc(@\w+)?/i, '').trim();
  if (!expr) return ctx.reply('Usage: /calc 2^10 + sqrt(144)\n\nSupports: +, -, *, /, ^, sqrt, sin, cos, tan, log, ln, pi, e');
  const result = calculate(expr);
  ctx.reply(result);
});
bot.command('math', (ctx) => {
  const expr = ctx.message.text.replace(/^\/math(@\w+)?/i, '').trim();
  if (!expr) return ctx.reply('Usage: /math 2^10 + sqrt(144)');
  ctx.reply(calculate(expr));
});

// /time <city/timezone> — World clock
bot.command('time', (ctx) => {
  const query = ctx.message.text.replace(/^\/time(@\w+)?/i, '').trim();
  if (!query) return ctx.reply('Usage: /time Tokyo\n\nCities: nyc, london, tokyo, sydney, dubai, singapore, etc.\nTimezones: UTC, EST, PST, CET, JST, etc.');
  const result = getWorldTime(query);
  ctx.reply(result);
});

// /shorten <url> — URL shortener
bot.command('shorten', async (ctx) => {
  const url = ctx.message.text.replace(/^\/shorten(@\w+)?/i, '').trim();
  if (!url) return ctx.reply('Usage: /shorten https://example.com');
  const result = await shortenUrl(url);
  ctx.reply(result, { disable_web_page_preview: true });
});

// ============ Fun & Community Tools ============

// /poll Question | Option 1 | Option 2 — Native Telegram poll
bot.command('poll', async (ctx) => {
  const args = ctx.message.text.replace(/^\/poll(@\w+)?/i, '').trim();
  const parsed = parsePollArgs(args);
  if (parsed.error) return ctx.reply(parsed.error);
  try {
    await ctx.replyWithPoll(parsed.question, parsed.options, { is_anonymous: false });
  } catch (err) {
    ctx.reply(`Poll creation failed: ${err.message?.slice(0, 100)}`);
  }
});

// /flip — Coin flip
bot.command('flip', (ctx) => {
  ctx.reply(coinFlip());
});

// /roll [NdN] — Dice roll
bot.command('roll', (ctx) => {
  const notation = ctx.message.text.replace(/^\/roll(@\w+)?/i, '').trim() || '1d6';
  ctx.reply(diceRoll(notation));
});
bot.command('dice', (ctx) => {
  const notation = ctx.message.text.replace(/^\/dice(@\w+)?/i, '').trim() || '1d6';
  ctx.reply(diceRoll(notation));
});

// /8ball <question> — Magic 8-ball
bot.command('8ball', (ctx) => {
  const question = ctx.message.text.replace(/^\/8ball(@\w+)?/i, '').trim();
  if (!question) return ctx.reply('Usage: /8ball Will ETH hit 10k?');
  ctx.reply(magicEightBall(question));
});

// /trivia — Random crypto trivia
bot.command('trivia', (ctx) => {
  const item = getTrivia();
  ctx.reply(`${item.question}\n\nAnswer: ${item.answer}`);
});

// /gm — GM streak tracker
bot.command('gm', (ctx) => {
  const username = ctx.from.username || ctx.from.first_name || 'anon';
  const result = recordGM(ctx.from.id, username);
  ctx.reply(result);
});

// /gmboard — GM streak leaderboard
bot.command('gmboard', (ctx) => {
  ctx.reply(getGMLeaderboard());
});

// ============ Market Movers & Alerts ============

// /gainers — Top 24h gainers
bot.command('gainers', async (ctx) => {
  const result = await getGainers();
  ctx.reply(result);
});

// /losers — Top 24h losers
bot.command('losers', async (ctx) => {
  const result = await getLosers();
  ctx.reply(result);
});

// /volume — Top volume
bot.command('volume', async (ctx) => {
  const result = await getTopVolume();
  ctx.reply(result);
});

// /btc — Quick BTC summary
bot.command('btc', async (ctx) => {
  const result = await getQuickSummary('bitcoin');
  ctx.reply(result);
});

// /eth — Quick ETH summary
bot.command('eth', async (ctx) => {
  const result = await getQuickSummary('ethereum');
  ctx.reply(result);
});

// /sol — Quick SOL summary
bot.command('sol', async (ctx) => {
  const result = await getQuickSummary('solana');
  ctx.reply(result);
});

// /nft <collection> — NFT stats
bot.command('nft', async (ctx) => {
  const collection = ctx.message.text.replace(/^\/nft(@\w+)?/i, '').trim();
  if (!collection) return ctx.reply('Usage: /nft bored-ape-yacht-club\n\nCheck NFT collection floor price, volume, and owners.');
  const result = await getNFTStats(collection);
  ctx.reply(result);
});

// /watch <token> — Add to watchlist
bot.command('watch', (ctx) => {
  const token = ctx.message.text.replace(/^\/watch(@\w+)?/i, '').trim();
  if (!token) return ctx.reply('Usage: /watch ETH\n\nAdd a token to your personal price watchlist.');
  const result = addToWatchlist(ctx.from.id, token);
  ctx.reply(result);
});

// /unwatch <token> — Remove from watchlist
bot.command('unwatch', (ctx) => {
  const token = ctx.message.text.replace(/^\/unwatch(@\w+)?/i, '').trim();
  if (!token) return ctx.reply('Usage: /unwatch ETH');
  const result = removeFromWatchlist(ctx.from.id, token);
  ctx.reply(result);
});

// /watchlist — Show your watchlist
bot.command('watchlist', async (ctx) => {
  const result = await getWatchlist(ctx.from.id);
  ctx.reply(result);
});
bot.command('wl', async (ctx) => {
  const result = await getWatchlist(ctx.from.id);
  ctx.reply(result);
});

// ============ Social & Productivity Tools ============

// /save — Bookmark a message (reply to save)
bot.command('save', (ctx) => {
  const replyMsg = ctx.message.reply_to_message;
  if (!replyMsg) return ctx.reply('Reply to a message and use /save to bookmark it.');
  const text = replyMsg.text || replyMsg.caption || '[media]';
  const author = replyMsg.from?.username || replyMsg.from?.first_name || 'Unknown';
  const chatTitle = ctx.chat.title || 'DM';
  const result = saveBookmark(ctx.from.id, text, author, chatTitle);
  ctx.reply(result);
});

// /bookmarks — List saved messages
bot.command('bookmarks', (ctx) => {
  const page = parseInt(ctx.message.text.replace(/^\/bookmarks(@\w+)?/i, '').trim(), 10) || 1;
  const result = getBookmarks(ctx.from.id, page);
  ctx.reply(result);
});

// /delbookmark <number> — Delete a bookmark
bot.command('delbookmark', (ctx) => {
  const num = parseInt(ctx.message.text.replace(/^\/delbookmark(@\w+)?/i, '').trim(), 10);
  if (!num) return ctx.reply('Usage: /delbookmark 3');
  const result = deleteBookmark(ctx.from.id, num);
  ctx.reply(result);
});

// /note <text> — Save a note
bot.command('note', (ctx) => {
  const text = ctx.message.text.replace(/^\/note(@\w+)?/i, '').trim();
  const result = addNote(ctx.from.id, text);
  ctx.reply(result);
});

// /notes — List your notes
bot.command('notes', (ctx) => {
  const result = getNotes(ctx.from.id);
  ctx.reply(result);
});

// /delnote <number> — Delete a note
bot.command('delnote', (ctx) => {
  const num = parseInt(ctx.message.text.replace(/^\/delnote(@\w+)?/i, '').trim(), 10);
  if (!num) return ctx.reply('Usage: /delnote 3');
  const result = deleteNote(ctx.from.id, num);
  ctx.reply(result);
});

// /quote — Save a quote (reply to message)
bot.command('quote', (ctx) => {
  const replyMsg = ctx.message.reply_to_message;
  if (!replyMsg) return ctx.reply('Reply to a message and use /quote to save it as a memorable quote.');
  const text = replyMsg.text || replyMsg.caption || '[media]';
  const author = replyMsg.from?.username || replyMsg.from?.first_name || 'Unknown';
  const savedBy = ctx.from.username || ctx.from.first_name || 'Unknown';
  const result = saveQuote(ctx.chat.id, text, author, savedBy);
  ctx.reply(result);
});

// /quotes — Show saved quotes
bot.command('quotes', (ctx) => {
  const result = getQuotes(ctx.chat.id);
  ctx.reply(result);
});

// /tag <name> <text> — Create a reusable snippet
bot.command('tag', (ctx) => {
  const args = ctx.message.text.replace(/^\/tag(@\w+)?/i, '').trim();
  const spaceIdx = args.indexOf(' ');
  if (spaceIdx < 1) return ctx.reply('Usage: /tag links Check vibeswap.io and our TG group\n\nCreate reusable text snippets. Recall with /t <name>');
  const name = args.slice(0, spaceIdx);
  const text = args.slice(spaceIdx + 1);
  const result = setTag(ctx.from.id, name, text);
  ctx.reply(result);
});

// /tags — List your tags
bot.command('tags', (ctx) => {
  const result = listTags(ctx.from.id);
  ctx.reply(result);
});

// /t <name> — Recall a tag
bot.command('t', (ctx) => {
  const name = ctx.message.text.replace(/^\/t(@\w+)?/i, '').trim();
  if (!name) return ctx.reply('Usage: /t links\n\nRecall a saved tag. List tags with /tags');
  const result = getTag(ctx.from.id, name);
  ctx.reply(result);
});

// /deltag <name> — Delete a tag
bot.command('deltag', (ctx) => {
  const name = ctx.message.text.replace(/^\/deltag(@\w+)?/i, '').trim();
  if (!name) return ctx.reply('Usage: /deltag links');
  const result = deleteTag(ctx.from.id, name);
  ctx.reply(result);
});

// ============ Security Tools ============

// /rugcheck <address> [chain] — Full token security scan
bot.command('rugcheck', async (ctx) => {
  const args = ctx.message.text.replace(/^\/rugcheck(@\w+)?/i, '').trim().split(/\s+/);
  const result = await rugCheck(args[0], args[1]);
  ctx.reply(result);
});
bot.command('rug', async (ctx) => {
  const args = ctx.message.text.replace(/^\/rug(@\w+)?/i, '').trim().split(/\s+/);
  ctx.reply(await rugCheck(args[0], args[1]));
});

// /honeypot <address> [chain] — Quick honeypot check
bot.command('honeypot', async (ctx) => {
  const args = ctx.message.text.replace(/^\/honeypot(@\w+)?/i, '').trim().split(/\s+/);
  ctx.reply(await honeypotCheck(args[0], args[1]));
});

// /audit <address> [chain] — Contract audit
bot.command('audit', async (ctx) => {
  const args = ctx.message.text.replace(/^\/audit(@\w+)?/i, '').trim().split(/\s+/);
  ctx.reply(await contractAudit(args[0], args[1]));
});

// /holders <address> — Top token holders
bot.command('holders', async (ctx) => {
  const address = ctx.message.text.replace(/^\/holders(@\w+)?/i, '').trim();
  ctx.reply(await getTopHolders(address));
});

// /approvals <address> [chain] — Token approval security
bot.command('approvals', async (ctx) => {
  const args = ctx.message.text.replace(/^\/approvals(@\w+)?/i, '').trim().split(/\s+/);
  ctx.reply(await checkApprovals(args[0], args[1]));
});

// ============ On-Chain Tools ============

// /btcstats — Bitcoin network stats
bot.command('btcstats', async (ctx) => {
  ctx.reply(await getBTCStats());
});

// /halving — Bitcoin halving countdown
bot.command('halving', async (ctx) => {
  ctx.reply(await getHalvingCountdown());
});

// /ens <name> — ENS name resolution
bot.command('ens', async (ctx) => {
  const name = ctx.message.text.replace(/^\/ens(@\w+)?/i, '').trim();
  ctx.reply(await resolveENS(name));
});

// /depeg — Stablecoin peg monitor
bot.command('depeg', async (ctx) => {
  ctx.reply(await checkStablecoinPegs());
});

// /balance <chain> <address> — Multi-chain balance
bot.command('balance', async (ctx) => {
  const args = ctx.message.text.replace(/^\/balance(@\w+)?/i, '').trim().split(/\s+/);
  if (args.length < 2) return ctx.reply('Usage: /balance eth 0x...\n\nChains: eth, bsc, polygon, arbitrum, optimism, avalanche, base, fantom');
  ctx.reply(await getMultiChainBalance(args[0], args[1]));
});

// /block [chain] — Latest block info
bot.command('block', async (ctx) => {
  const chain = ctx.message.text.replace(/^\/block(@\w+)?/i, '').trim() || 'eth';
  ctx.reply(await getLatestBlock(chain));
});

// ============ News & Social ============

// /news [topic] — Crypto news aggregator
bot.command('news', async (ctx) => {
  const topic = ctx.message.text.replace(/^\/news(@\w+)?/i, '').trim();
  ctx.reply(await getCryptoNews(topic || null), { disable_web_page_preview: true });
});

// /reddit [subreddit] — Reddit posts
bot.command('reddit', async (ctx) => {
  const sub = ctx.message.text.replace(/^\/reddit(@\w+)?/i, '').trim() || 'cryptocurrency';
  ctx.reply(await getRedditPosts(sub), { disable_web_page_preview: true });
});

// /hackernews [filter] — Hacker News
bot.command('hackernews', async (ctx) => {
  const filter = ctx.message.text.replace(/^\/hackernews(@\w+)?/i, '').trim() || 'crypto';
  ctx.reply(await getHackerNews(filter), { disable_web_page_preview: true });
});
bot.command('hn', async (ctx) => {
  const filter = ctx.message.text.replace(/^\/hn(@\w+)?/i, '').trim() || 'crypto';
  ctx.reply(await getHackerNews(filter), { disable_web_page_preview: true });
});

// /rss <url> — RSS feed reader
bot.command('rss', async (ctx) => {
  const url = ctx.message.text.replace(/^\/rss(@\w+)?/i, '').trim();
  ctx.reply(await readRSSFeed(url), { disable_web_page_preview: true });
});

// /devactivity <project> — GitHub dev activity
bot.command('devactivity', async (ctx) => {
  const project = ctx.message.text.replace(/^\/devactivity(@\w+)?/i, '').trim();
  ctx.reply(await getDevActivity(project), { disable_web_page_preview: true });
});
bot.command('dev', async (ctx) => {
  const project = ctx.message.text.replace(/^\/dev(@\w+)?/i, '').trim();
  ctx.reply(await getDevActivity(project), { disable_web_page_preview: true });
});

// ============ Engagement & Combo Commands ============

// /morning — Daily crypto briefing
bot.command('morning', async (ctx) => {
  ctx.reply(await getMorningBriefing());
});

// /markets — Traditional market hours
bot.command('markets', (ctx) => {
  ctx.reply(getMarketHours());
});

// /fact — Random fact
bot.command('fact', async (ctx) => {
  ctx.reply(await getRandomFact());
});

// /today — On this day in history
bot.command('today', async (ctx) => {
  ctx.reply(await getOnThisDay());
});

// /dog — Random dog pic
bot.command('dog', async (ctx) => {
  const result = await getRandomDog();
  if (result.error) return ctx.reply(result.error);
  try { await ctx.replyWithPhoto(result.url); } catch { ctx.reply(result.url); }
});

// /cat — Random cat pic
bot.command('cat', async (ctx) => {
  const result = await getRandomCat();
  if (result.error) return ctx.reply(result.error);
  try { await ctx.replyWithPhoto(result.url); } catch { ctx.reply(result.url); }
});

// /carbon <code> — Code screenshot
bot.command('carbon', async (ctx) => {
  const code = ctx.message.text.replace(/^\/carbon(@\w+)?/i, '').trim();
  if (!code) return ctx.reply('Usage: /carbon function swap() { return true; }\n\nGenerates a beautiful code screenshot.');
  const statusMsg = await ctx.reply('Generating code screenshot...');
  const result = await getCodeScreenshot(code);
  try { await ctx.deleteMessage(statusMsg.message_id); } catch {}
  if (result.error) return ctx.reply(result.error);
  await ctx.replyWithPhoto({ source: result.buffer }, { caption: 'Code screenshot via Carbonara' });
});

// /paste <text> — Create a paste
bot.command('paste', async (ctx) => {
  let content = ctx.message.text.replace(/^\/paste(@\w+)?/i, '').trim();
  // Also support reply-to-paste
  if (!content && ctx.message.reply_to_message?.text) {
    content = ctx.message.reply_to_message.text;
  }
  if (!content) return ctx.reply('Usage: /paste <text>\n\nOr reply to a message with /paste');
  ctx.reply(await createPaste(content), { disable_web_page_preview: true });
});

// /advice — Random advice
bot.command('advice', async (ctx) => {
  ctx.reply(await getAdvice());
});

// ============ Alpha Intelligence ============

// /alpha <token> — Full alpha report
bot.command('alpha', async (ctx) => {
  if (isCommandRateLimited(ctx.from.id, 'alpha')) return ctx.reply('Alpha on cooldown. Try again shortly.');
  const token = ctx.message.text.split(/\s+/).slice(1).join(' ');
  ctx.reply(await getAlphaReport(token));
});

// /compare <a> <b> — Side-by-side token comparison
bot.command('compare', async (ctx) => {
  const args = ctx.message.text.split(/\s+/).slice(1);
  ctx.reply(await compareTokens(args[0], args[1]));
});

// /narrative — Current crypto narratives
bot.command('narrative', async (ctx) => {
  ctx.reply(await getCurrentNarrative());
});

// ============ User Preferences & Portfolio ============

// /portfolio [add|remove|show] <token> [amount] [chain]
bot.command('portfolio', async (ctx) => {
  const args = ctx.message.text.split(/\s+/).slice(1);
  const action = args[0]?.toLowerCase();
  const userId = ctx.from.id;

  if (action === 'add') {
    ctx.reply(addToPortfolio(userId, args[1], args[2], args[3]));
  } else if (action === 'remove' || action === 'rm') {
    ctx.reply(removeFromPortfolio(userId, args[1]));
  } else {
    ctx.reply(await getPortfolio(userId));
  }
});

// /setpref <key> <value>
bot.command('setpref', (ctx) => {
  const args = ctx.message.text.split(/\s+/).slice(1);
  ctx.reply(setPreference(ctx.from.id, args[0], args.slice(1).join(' ')));
});

// /prefs — View preferences
bot.command('prefs', (ctx) => {
  ctx.reply(getPreferences(ctx.from.id));
});

// /mywallet <address>
bot.command('mywallet', (ctx) => {
  const addr = ctx.message.text.split(/\s+/)[1];
  ctx.reply(setWallet(ctx.from.id, addr));
});

// ============ Scheduled Briefings ============

// /schedule <type> <params>
bot.command('schedule', async (ctx) => {
  const args = ctx.message.text.split(/\s+/).slice(1);
  const type = args[0]?.toLowerCase();
  const userId = ctx.from.id;
  const chatId = ctx.chat.id;

  if (type === 'list' || !type) {
    ctx.reply(listSchedules(userId));
  } else if (type === 'remove' || type === 'rm') {
    ctx.reply(removeSchedule(userId, args[1]));
  } else if (type === 'morning') {
    ctx.reply(addSchedule(userId, chatId, 'morning', { time: args[1] || '08:00' }));
  } else if (type === 'price') {
    ctx.reply(addSchedule(userId, chatId, 'price', { token: args[1], threshold: args[2] }));
  } else if (type === 'gas') {
    ctx.reply(addSchedule(userId, chatId, 'gas', { gwei: args[1] }));
  } else {
    ctx.reply('Usage:\n  /schedule morning 08:00\n  /schedule price btc 5\n  /schedule gas 20\n  /schedule list\n  /schedule remove <id>');
  }
});

// ============ Task Queue ============

bot.command('tasks', async (ctx) => {
  const args = ctx.message.text.split(/\s+/).slice(1);
  const sub = args[0]?.toLowerCase();

  if (sub === 'cancel' || sub === 'rm') {
    ctx.reply(cancelTask(args[1], ctx.from.username || String(ctx.from.id)));
  } else if (sub === 'stats') {
    const stats = getTaskStats();
    ctx.reply(`Task Queue Stats:\n  Queued: ${stats.queued}\n  Running: ${stats.running}\n  Completed: ${stats.completed}\n  Failed: ${stats.failed}\n  Total: ${stats.total}`);
  } else {
    ctx.reply(listTasks(ctx.from.id));
  }
});

// ============ Sovereign Wallet ============

bot.command('wallet', async (ctx) => {
  if (String(ctx.from.id) !== String(config.ownerUserId)) {
    return ctx.reply('Wallet commands are owner-only.');
  }
  const args = ctx.message.text.split(/\s+/).slice(1);
  const sub = args[0]?.toLowerCase();

  if (sub === 'create') {
    const passphrase = args.slice(1).join(' ');
    const result = generateWallet(passphrase);
    if (result.error) return ctx.reply(result.error);
    ctx.reply(`Wallet created: ${result.address}\n\nMNEMONIC (SAVE THIS — shown once):\n${result.mnemonic}\n\n${result.message}`);
  } else if (sub === 'unlock') {
    const passphrase = args.slice(1).join(' ');
    const result = unlockWallet(passphrase);
    ctx.reply(result.error || `Wallet unlocked: ${result.address}`);
  } else if (sub === 'lock') {
    ctx.reply(lockWallet().locked ? 'Wallet locked.' : 'Failed.');
  } else if (sub === 'pause') {
    ctx.reply(JSON.stringify(pauseWallet()));
  } else if (sub === 'unpause') {
    ctx.reply(JSON.stringify(unpauseWallet()));
  } else if (sub === 'whitelist') {
    if (args[1] === 'add' && args[2]) {
      ctx.reply(JSON.stringify(addToWhitelist(args[2])));
    } else if (args[1] === 'rm' && args[2]) {
      ctx.reply(JSON.stringify(removeFromWhitelist(args[2])));
    } else {
      const info = getWalletInfo();
      ctx.reply(`Whitelist (${info.limits?.whitelistCount || 0}): Owner-only. /wallet whitelist add <addr>`);
    }
  } else if (sub === 'mnemonic' || sub === 'backup') {
    if (ctx.chat.type !== 'private') return ctx.reply('Mnemonic can only be revealed in DMs.');
    const passphrase = args.slice(1).join(' ');
    const result = revealMnemonic(passphrase);
    if (result.error) return ctx.reply(result.error);
    ctx.reply(`${result.mnemonic}\n\n${result.warning}`);
  } else if (sub === 'balance' || sub === 'bal') {
    const chain = args[1] || 'base';
    const balances = await getAllBalances();
    const lines = Object.entries(balances.balances || {}).map(([c, b]) =>
      `${c}: ${b.native?.balance || '?'} ${b.native?.symbol || ''}`
    );
    ctx.reply(`Wallet: ${balances.address}\n${lines.join('\n')}`);
  } else {
    const info = getWalletInfo();
    if (!info.exists) {
      ctx.reply('No wallet. Use /wallet create <passphrase>');
    } else {
      ctx.reply(`Address: ${info.address}\nUnlocked: ${info.unlocked}\nPaused: ${info.paused}\nDaily: ${info.today?.spent} / ${info.limits?.dailyCap}\nTx today: ${info.today?.txCount} / ${info.limits?.dailyTxLimit}\nTotal tx: ${info.totalTx}\nChains: ${info.chains?.join(', ')}`);
    }
  }
});

// ============ Pantheon — Agent Cost Tracking ============

bot.command('pantheon', async (ctx) => {
  if (String(ctx.from.id) !== String(config.ownerUserId)) {
    return ctx.reply('Pantheon commands are owner-only.');
  }
  const args = ctx.message.text.split(/\s+/).slice(1);
  const sub = args[0]?.toLowerCase();

  if (sub === 'costs' || sub === 'cost') {
    const costs = await getAllCosts();
    const infra = getInfraCosts();
    let msg = `TheAI — Costs\n━━━━━━━━━━━━━━━━\n`;
    msg += `Total LLM: ${costs.totalUsd} (${costs.totalCalls} calls)\n\n`;
    for (const [agent, data] of Object.entries(costs.agents)) {
      msg += `${agent}: ${data.formatted} (${data.calls} calls, avg ${data.perCall})\n`;
    }
    msg += `\nInfra Estimates:\n`;
    msg += `Headless: ${infra.estimate.headless}\n`;
    msg += `Desktop: ${infra.estimate.desktop}`;
    ctx.reply(msg);

  } else if (sub === 'fork') {
    const archetype = args[1]?.toLowerCase();
    if (!archetype) {
      const archetypes = getArchetypes();
      const lines = Object.entries(archetypes).map(([name, a]) => `  ${name} (T${a.tier}) — ${a.domain}`);
      return ctx.reply(`Usage: /pantheon fork <archetype|all>\n\nAvailable:\n${lines.join('\n')}`);
    }
    if (archetype === 'all') {
      // Batch fork all archetypes
      const archetypes = getArchetypes();
      const results = [];
      for (const name of Object.keys(archetypes)) {
        const r = await forkAgent(name);
        results.push(r.error ? `${name}: ${r.error}` : `${name}: OK (T${r.tier})`);
      }
      return ctx.reply(`Batch Fork Results:\n${results.join('\n')}`);
    }
    const result = await forkAgent(archetype, { additionalContext: args.slice(2).join(' ') });
    if (result.error) return ctx.reply(`Fork failed: ${result.error}`);
    ctx.reply(`Agent "${result.agent}" forked!\nTier: ${result.tier}\nDomain: ${result.domain}\nManager: ${result.manager || 'root'}`);

  } else if (sub === 'chat' || sub === 'ask') {
    const agentName = args[1]?.toLowerCase();
    const message = args.slice(2).join(' ');
    if (!agentName || !message) return ctx.reply('Usage: /pantheon chat <agent> <message>');
    ctx.reply(`Asking ${agentName}...`);
    try {
      const response = await pantheonChat(agentName, message, `tg-${ctx.from.id}`);
      ctx.reply(`[${agentName}] ${response.text}\n\n(${response.usage.cost})`);
    } catch (err) {
      ctx.reply(`Error: ${err.message}`);
    }

  } else if (sub === 'consult') {
    const from = args[1]?.toLowerCase();
    const to = args[2]?.toLowerCase();
    const question = args.slice(3).join(' ');
    if (!from || !to || !question) return ctx.reply('Usage: /pantheon consult <from> <to> <question>');
    ctx.reply(`${from} → ${to}: consulting...`);
    try {
      const response = await consultAgent(from, to, question);
      ctx.reply(`[${to} → ${from}] ${response.text}\n\n(${response.usage.cost})`);
    } catch (err) {
      ctx.reply(`Error: ${err.message}`);
    }

  } else if (sub === 'prune') {
    ctx.reply('Running 24h context prune...');
    const results = await pruneAll();
    const lines = results.map(r => r.error ? `${r.agent}: ERROR ${r.error}` : `${r.agent} → ${r.manager}: OK (${r.cost})`);
    ctx.reply(`Prune Results:\n${lines.join('\n') || 'No agents to prune.'}`);

  } else if (sub === 'clear') {
    const agentName = args[1]?.toLowerCase();
    if (!agentName) return ctx.reply('Usage: /pantheon clear <agent>');
    clearConversation(agentName, `tg-${ctx.from.id}`);
    ctx.reply(`Conversation with ${agentName} cleared.`);

  } else if (sub === 'remember') {
    const type = args[1]?.toLowerCase(); // decision, project, note
    const content = args.slice(2).join(' ');
    if (!type || !content || !['decision', 'project', 'note'].includes(type)) {
      return ctx.reply('Usage: /pantheon remember <decision|project|note> <content>\nStores in Nyx\'s organizational memory.');
    }
    const entry = await addNyxMemory(type, type === 'project' ? { name: content.split(' ')[0], status: content.split(' ').slice(1).join(' ') || 'active' } : content);
    ctx.reply(`Nyx remembers: [${type}] ${typeof entry.content === 'string' ? entry.content : entry.content.name}`);

  } else if (sub === 'memory') {
    const memory = await getNyxMemory();
    let msg = `Nyx's Memory\n━━━━━━━━━━━━━━━━\n`;
    msg += `Decisions: ${memory.decisions.length}\n`;
    msg += `Projects: ${Object.keys(memory.projects).length}\n`;
    msg += `Notes: ${memory.notes.length}\n`;
    if (memory.lastUpdated) msg += `Last updated: ${memory.lastUpdated.slice(0, 16)}\n`;
    if (memory.decisions.length > 0) {
      msg += `\nRecent decisions:\n`;
      for (const d of memory.decisions.slice(-5)) {
        msg += `  [${d.timestamp.slice(0, 10)}] ${d.content.slice(0, 80)}\n`;
      }
    }
    ctx.reply(msg);

  } else if (sub === 'route') {
    const question = args.slice(1).join(' ');
    if (!question) return ctx.reply('Usage: /pantheon route <question>\nRoutes to the best agent without sending.');
    const route = routeQuestion(question);
    ctx.reply(`Route: ${route.agent.toUpperCase()}\nConfidence: ${route.confidence}\nReason: ${route.reason}`);

  } else if (sub === 'status') {
    const status = await getTheAIStatus();
    const ollamaConfigured = !!process.env.OLLAMA_URL;
    const model = process.env.PANTHEON_MODEL || (ollamaConfigured ? 'qwen2.5:7b' : 'claude-sonnet-4-5-20250929');
    let msg = `TheAI — System Status\n━━━━━━━━━━━━━━━━\n`;
    msg += `Agents: ${status.activeAgents} active\n`;
    msg += `Model: ${model}\n`;
    msg += `Ollama: ${ollamaConfigured ? 'YES' : 'NO'}\n`;
    msg += `Jarvis Bridge: WIRED (consult_pantheon)\n`;
    msg += `LLM Cost: ${status.totalCost}\n`;
    msg += `Total Calls: ${status.totalCalls}\n`;
    msg += `Next Prune: ${status.nextPrune}\n`;
    msg += `\nAgents:\n${status.agents.join('\n')}`;
    ctx.reply(msg);

  } else if (sub === 'archetypes') {
    const archetypes = getArchetypes();
    let msg = `TheAI — Archetypes\n━━━━━━━━━━━━━━━━\n`;
    for (const [name, a] of Object.entries(archetypes)) {
      const status = (await listAgents()).includes(name) ? '✅' : '⬜';
      msg += `${status} ${name} (T${a.tier}, ${a.tradition}) — ${a.domain}\n`;
    }
    msg += `\nFork: /pantheon fork <name>`;
    ctx.reply(msg);

  } else {
    const agentList = await listAgents();
    const costs = await getAllCosts();
    let msg = `TheAI — Digital Corporation\n━━━━━━━━━━━━━━━━\n`;
    msg += `Active Agents: ${agentList.length ? agentList.join(', ') : 'none'}\n`;
    msg += `Total LLM cost: ${costs.totalUsd}\n\n`;
    msg += `Commands:\n`;
    msg += `  /pantheon status — System health\n`;
    msg += `  /pantheon archetypes — Available god-agents\n`;
    msg += `  /pantheon fork <name|all> — Create agent(s)\n`;
    msg += `  /pantheon chat <agent> <msg> — Talk to an agent\n`;
    msg += `  /pantheon consult <from> <to> <q> — Agent-to-agent\n`;
    msg += `  /pantheon costs — Cost breakdown\n`;
    msg += `  /pantheon prune — Run 24h context prune\n`;
    msg += `  /pantheon clear <agent> — Clear conversation`;
    ctx.reply(msg);
  }
});

// ============ Primitive Gate — CRPC Values Validation ============

bot.command('gate', async (ctx) => {
  if (String(ctx.from.id) !== String(config.ownerUserId)) {
    return ctx.reply('Owner only.');
  }

  const args = ctx.message.text.split(/\s+/).slice(1);
  const sub = args[0]?.toLowerCase();

  if (sub === 'run') {
    // Run gate against last commit's diff
    ctx.reply('Running primitive gate against HEAD...');
    try {
      const { execSync } = await import('child_process');
      const repoPath = process.env.VIBESWAP_REPO || '.';
      const diff = execSync(`git -C ${repoPath} diff HEAD~1 HEAD`, { encoding: 'utf-8', maxBuffer: 1024 * 1024 });
      if (!diff.trim()) return ctx.reply('No diff found in last commit.');
      const commitHash = execSync(`git -C ${repoPath} rev-parse --short HEAD`, { encoding: 'utf-8' }).trim();
      const result = await runPrimitiveGate(diff, { commitHash });
      ctx.reply(formatGateResult(result));
    } catch (err) {
      ctx.reply(`Gate error: ${err.message}`);
    }

  } else if (sub === 'primitives') {
    const manifest = getPrimitiveManifest();
    let msg = `Primitive Manifest\n━━━━━━━━━━━━━━━━\n`;
    msg += `Hash: ${manifest.hash.slice(0, 16)}...\n`;
    msg += `Count: ${manifest.count} | Total weight: ${manifest.totalWeight}\n\n`;
    for (const p of manifest.primitives) {
      msg += `${p.id} (w=${p.weight}): ${p.name}\n`;
    }
    ctx.reply(msg);

  } else if (sub === 'history') {
    const history = await getGateHistory(5);
    if (history.length === 0) return ctx.reply('No gate history yet.');
    let msg = `Gate History (last ${history.length})\n━━━━━━━━━━━━━━━━\n`;
    for (const h of history) {
      const emoji = h.decision === 'PASS' ? '✅' : h.decision === 'WARN' ? '⚠️' : '🚫';
      msg += `${emoji} ${h.commitHash} — ${h.alignmentScore}% (${h.passed}/${h.totalPrimitives}) ${h.timestamp.slice(0, 10)}\n`;
    }
    ctx.reply(msg);

  } else {
    let msg = `Primitive Gate — Values Validation\n━━━━━━━━━━━━━━━━\n`;
    msg += `"The code can represent our values mathematically"\n\n`;
    msg += `Commands:\n`;
    msg += `  /gate run — Validate HEAD against all primitives\n`;
    msg += `  /gate primitives — Show manifest + hash\n`;
    msg += `  /gate history — Recent gate results`;
    ctx.reply(msg);
  }
});

// ============ Rosetta Stone Protocol — Universal Translation ============

bot.command('rosetta', async (ctx) => {
  if (String(ctx.from.id) !== String(config.ownerUserId)) {
    return ctx.reply('Owner only.');
  }

  const args = ctx.message.text.split(/\s+/).slice(1);
  const sub = args[0]?.toLowerCase();

  if (sub === 'translate') {
    // /rosetta translate <from> <to> <concept>
    const [, fromAgent, toAgent, ...conceptParts] = args;
    const concept = conceptParts.join('_');
    if (!fromAgent || !toAgent || !concept) {
      return ctx.reply('Usage: /rosetta translate <from_agent> <to_agent> <concept>\nExample: /rosetta translate poseidon athena liquidity');
    }
    const result = translate(fromAgent, toAgent, concept);
    if (result.error) return ctx.reply(`Error: ${result.error}`);
    if (!result.translated) {
      return ctx.reply(`${fromAgent}:${concept} → universal:"${result.universal}"\n${result.explanation || 'No equivalent found in ' + toAgent}`);
    }
    let msg = `Rosetta Translation\n━━━━━━━━━━━━━━━━\n`;
    msg += `${result.from.agent}: "${result.from.term}" — ${result.from.desc}\n`;
    msg += `↓ universal: ${result.universal}\n`;
    msg += `${result.to.agent}: "${result.to.term}" — ${result.to.desc}\n`;
    msg += `Confidence: ${(result.confidence * 100).toFixed(0)}%${result.approximate ? ' (approximate)' : ''}`;
    ctx.reply(msg);

  } else if (sub === 'all') {
    // /rosetta all <agent> <concept>
    const [, fromAgent, ...conceptParts] = args;
    const concept = conceptParts.join('_');
    if (!fromAgent || !concept) return ctx.reply('Usage: /rosetta all <agent> <concept>');
    const result = translateToAll(fromAgent, concept);
    let msg = `Rosetta — "${concept}" from ${fromAgent}\n━━━━━━━━━━━━━━━━\n`;
    for (const [agent, t] of Object.entries(result.translations)) {
      if (t.translated) msg += `${agent}: "${t.to.term}" (${(t.confidence * 100).toFixed(0)}%)\n`;
      else msg += `${agent}: — (no equivalent)\n`;
    }
    ctx.reply(msg);

  } else if (sub === 'lexicon') {
    // /rosetta lexicon <agent>
    const agentId = args[1]?.toLowerCase();
    if (!agentId) return ctx.reply('Usage: /rosetta lexicon <agent>');
    const lex = getLexicon(agentId);
    if (!lex) return ctx.reply(`No lexicon for "${agentId}"`);
    let msg = `${agentId.toUpperCase()} Lexicon — ${lex.domain}\n━━━━━━━━━━━━━━━━\n`;
    for (const [term, mapping] of Object.entries(lex.concepts)) {
      msg += `• ${term} → ${mapping.universal}\n  ${mapping.desc}\n`;
    }
    ctx.reply(msg);

  } else if (sub === 'view') {
    const view = getRosettaView();
    let msg = `Rosetta Stone Protocol\n━━━━━━━━━━━━━━━━\n`;
    msg += `Agents: ${Object.keys(view.agents).length}\n`;
    msg += `Total Terms: ${view.totalTerms}\n`;
    msg += `Universal Concepts: ${view.universalConcepts}\n`;
    msg += `Covenant Hash: ${view.covenantHash.slice(0, 16)}...\n`;
    msg += `Active Challenges: ${view.activeChallenges}\n\n`;
    for (const [id, a] of Object.entries(view.agents)) {
      msg += `${id}: ${a.domain} (${a.termCount} terms)\n`;
    }
    ctx.reply(msg);

  } else {
    let msg = `Rosetta Stone Protocol — Universal Understanding\n━━━━━━━━━━━━━━━━\n`;
    msg += `"So everyone can finally understand everyone."\n\n`;
    msg += `Commands:\n`;
    msg += `  /rosetta translate <from> <to> <concept>\n`;
    msg += `  /rosetta all <agent> <concept> — Translate to ALL agents\n`;
    msg += `  /rosetta lexicon <agent> — Show agent vocabulary\n`;
    msg += `  /rosetta view — Full protocol status\n`;
    msg += `  /covenants — The Ten Covenants of Tet`;
    ctx.reply(msg);
  }
});

bot.command('covenants', async (ctx) => {
  let msg = `The Ten Covenants of Tet\n━━━━━━━━━━━━━━━━\n`;
  msg += `"In the name of the builders, let these laws govern all minds."\n`;
  msg += `Hash: ${COVENANT_HASH.slice(0, 16)}...\n\n`;
  for (const c of TEN_COVENANTS) {
    const icon = c.enforcement === 'hard' ? '⚖️' : c.enforcement === 'immutable' ? '🔒' : c.enforcement === 'spirit' ? '✨' : '📜';
    msg += `${icon} ${c.number}. ${c.covenant}\n`;
  }
  msg += `\nEnforcement: ⚖️=hard 🔒=immutable ✨=spirit 📜=soft`;
  ctx.reply(msg);
});

// ============ Trading — Autonomous DEX ============

bot.command('trade', async (ctx) => {
  if (String(ctx.from.id) !== String(config.ownerUserId)) {
    return ctx.reply('Trading commands are owner-only.');
  }
  const args = ctx.message.text.split(/\s+/).slice(1);
  const sub = args[0]?.toLowerCase();

  if (sub === 'setup') {
    const result = setupTrading();
    ctx.reply(`Trading setup complete.\nUniswap Router whitelisted: ${result.router}`);
  } else if (sub === 'buy' || sub === 'sell') {
    const amount = args[1];
    if (!amount || isNaN(parseFloat(amount))) {
      return ctx.reply(`Usage: /trade ${sub} <amount>\n\n${sub === 'buy' ? 'Amount in USDC' : 'Amount in ETH'}`);
    }
    const reasoning = args.slice(2).join(' ') || 'Manual trade via Telegram';
    ctx.reply(`Executing ${sub} ${amount} ${sub === 'buy' ? 'USDC → ETH' : 'ETH → USDC'}...`);
    const result = await swap(sub, amount, reasoning);
    if (result.error) {
      ctx.reply(`Trade failed: ${result.error}`);
    } else {
      ctx.reply(`Trade executed!\nTx: ${result.explorer}\nExpected: ${result.trade.amountOutExpected} ${result.trade.tokenOut}`);
    }
  } else if (sub === 'history') {
    const trades = await getTradeHistory(10);
    if (trades.length === 0) return ctx.reply('No trades yet.');
    const lines = trades.map(t =>
      `${t.direction.toUpperCase()} ${t.amountIn} ${t.tokenIn} → ${t.amountOutExpected} ${t.tokenOut} (${new Date(t.timestamp).toLocaleDateString()})`
    );
    ctx.reply(`Recent Trades:\n${lines.join('\n')}`);
  } else if (sub === 'pnl') {
    const pnl = await getPnL();
    ctx.reply(`P&L Report:\nTrades: ${pnl.trades}\nRealized: $${pnl.realizedPnl}\nUnrealized: $${pnl.unrealizedPnl}\nTotal: $${pnl.totalPnl}\nAvg Buy: $${pnl.avgBuyPrice}\nAvg Sell: $${pnl.avgSellPrice}\nETH Price: $${pnl.currentPrice}`);
  } else {
    // Default: show portfolio
    const status = await formatTradeStatus();
    ctx.reply(status);
  }
});

// ============ Social Outbound ============

bot.command('social', async (ctx) => {
  if (String(ctx.from.id) !== String(config.ownerUserId)) {
    return ctx.reply('Social commands are owner-only.');
  }
  const args = ctx.message.text.split(/\s+/).slice(1);
  const sub = args[0]?.toLowerCase();

  if (sub === 'status') {
    const stats = getSocialStats();
    const lines = stats.platforms.map(p => {
      const status = p.enabled ? '✅ ON' : '❌ OFF';
      return `${p.name}: ${status} (${p.totalPosts} posts)`;
    });
    const envHints = [];
    if (!stats.platforms.find(p => p.key === 'twitter')?.enabled) {
      envHints.push('X/Twitter: set TWITTER_BEARER_TOKEN, TWITTER_API_KEY, TWITTER_API_SECRET, TWITTER_ACCESS_TOKEN, TWITTER_ACCESS_SECRET');
    }
    if (!stats.platforms.find(p => p.key === 'discord')?.enabled) {
      envHints.push('Discord: set DISCORD_WEBHOOK_URL');
    }
    const queueInfo = stats.queueLength > 0 ? `\nQueue: ${stats.queueLength} posts waiting` : '';
    const recentInfo = stats.recentPosts?.length > 0
      ? '\nRecent: ' + stats.recentPosts.slice(-2).map(p => `[${p.platform}] "${(p.content || '').slice(0, 40)}..."`).join(', ')
      : '';
    const missing = envHints.length > 0 ? '\n\nTo activate:\n' + envHints.join('\n') : '';
    ctx.reply(`Social Platforms:\n${lines.join('\n')}${queueInfo}${recentInfo}${missing}`);
  } else if (sub === 'flush') {
    const result = await processSocialQueue();
    ctx.reply(`Processed: ${result.processed}, Remaining: ${result.remaining}${result.errors ? '\nErrors: ' + JSON.stringify(result.errors) : ''}`);
  } else {
    ctx.reply('Usage:\n  /social status\n  /social flush');
  }
});

// ============ Proactive Engine ============

bot.command('proactive', async (ctx) => {
  if (String(ctx.from.id) !== String(config.ownerUserId)) {
    return ctx.reply('Proactive commands are owner-only.');
  }
  const args = ctx.message.text.split(/\s+/).slice(1);
  const sub = args[0]?.toLowerCase();

  if (sub === 'enable' || sub === 'on') {
    ctx.reply(JSON.stringify(enableProactive()));
  } else if (sub === 'disable' || sub === 'off') {
    ctx.reply(JSON.stringify(disableProactive()));
  } else {
    const status = getProactiveStatus();
    const lines = status.activeActions.map(a => `  ${a.name}: last ${a.lastRun}, next ${a.nextRun}`);
    ctx.reply(`Proactive: ${status.enabled ? 'ON' : 'OFF'}\nActions:\n${lines.join('\n') || '  none'}\nTotal actions: ${status.totalActions}`);
  }
});

// ============ Nervos Talks (Silent Guardian) ============

bot.command('nervos', async (ctx) => {
  if (String(ctx.from.id) !== String(config.ownerUserId)) {
    return ctx.reply('Nervos Talks commands are owner-only.');
  }
  const args = ctx.message.text.split(/\s+/).slice(1);
  const sub = args[0]?.toLowerCase();

  if (sub === 'post') {
    const filename = args[1];
    const result = filename
      ? await nervosPostSpecific(config.repo.path, filename)
      : await nervosPostNext(config.repo.path);
    ctx.reply(result.success
      ? `Posted: "${result.title}"\n${result.url}${result.remaining !== undefined ? `\n${result.remaining} remaining` : ''}`
      : `Error: ${result.error}`);
  } else if (sub === 'replies') {
    const replies = await nervosCheckReplies();
    if (replies.length === 0) {
      ctx.reply('No new replies since last check.');
    } else {
      const lines = replies.slice(0, 5).map(r =>
        `@${r.username} on "${r.topicTitle}":\n  "${r.content.slice(0, 120)}..."`
      );
      ctx.reply(`${replies.length} new replies:\n\n${lines.join('\n\n')}`);
    }
  } else if (sub === 'scan') {
    const result = nervosScanPipeline(config.repo.path);
    ctx.reply(`Pipeline: ${result.total} total, ${result.posted} posted, ${result.queued} queued\n\nQueued:\n${result.queue?.map(f => `  ${f}`).join('\n') || '  (empty)'}`);
  } else {
    const status = nervosStatus();
    ctx.reply(`Nervos Talks: ${status.configured ? 'CONFIGURED' : 'NOT CONFIGURED'}
Username: ${status.username}
Posted: ${status.posted} | Queued: ${status.queued}
Pending replies: ${status.pendingReplies}
Last reply check: ${status.lastReplyCheck}
Post interval: ${status.postInterval}
Reply check: ${status.replyCheckInterval}${status.recentPosts?.length ? '\n\nRecent:\n' + status.recentPosts.map(p => `  ${p.title}`).join('\n') : ''}`);
  }
});

// ============ Runtime Directives ============

bot.command('directive', async (ctx) => {
  const args = ctx.message.text.split(/\s+/).slice(1);
  const sub = args[0]?.toLowerCase();

  if (!sub || sub === 'status') {
    const mode = getChatMode(ctx.chat.id);
    const dir = getDirective(ctx.chat.id);
    if (dir) {
      ctx.reply(`This chat: ${mode}\nSet by: ${dir.setBy.username}\nAt: ${dir.setAt}\nReason: "${dir.reason}"`);
    } else if (mode !== 'normal') {
      ctx.reply(`This chat: ${mode} (set via environment config)`);
    } else {
      ctx.reply('This chat: normal (full engagement)');
    }
  } else if (sub === 'list') {
    ctx.reply(listDirectives());
  } else if (['normal', 'tag-only', 'quiet'].includes(sub)) {
    setDirective(ctx.chat.id, sub, ctx.from, `/directive ${sub}`);
    ctx.reply(getAcknowledgment(sub));
  } else {
    ctx.reply('Usage:\n  /directive — show current mode\n  /directive list — all active directives\n  /directive normal|tag-only|quiet — set mode');
  }
});

// ============ Reputation & Flywheel Metrics ============

bot.command('reputation', async (ctx) => {
  const args = ctx.message.text.split(/\s+/).slice(1);
  const sub = args[0]?.toLowerCase();

  if (sub === 'flywheel' || sub === 'viral') {
    const metrics = getViralMetrics();
    const lines = [
      'Flywheel Metrics\n',
      `  Stage: ${metrics.flywheelStage}`,
      `  Participants: ${metrics.participants}`,
      `  Avg Reputation: ${metrics.avgReputation}`,
      `  Avg Difficulty: ${metrics.avgDifficultyMultiplier} (1.0 = full cost)`,
      `  Avg Coop Multiplier: ${metrics.avgCoopMultiplier}x`,
      `  Contribution Diversity: ${metrics.contributionDiversity} niches`,
      `  Viral Threshold Estimate: ~${metrics.viralThresholdEstimate} participants`,
      `  Total Slashes: ${metrics.totalSlashes}`,
    ];
    return ctx.reply(lines.join('\n'));
  }

  // Default: show caller's reputation profile
  const userId = String(ctx.from.id);
  const profile = getReputationProfile(userId);
  if (!profile) {
    return ctx.reply('No reputation data yet. Keep contributing — your score builds over time.');
  }

  const lines = [
    `Reputation Profile\n`,
    `  Score: ${profile.score}`,
    `  Difficulty: ${profile.difficultyMultiplier} (${((1 - profile.difficultyMultiplier) * 100).toFixed(0)}% discount)`,
    `  Coop Multiplier: ${profile.cooperationMultiplier}x (${profile.cooperationStreak} streak)`,
    `  Slashes: ${profile.slashCount}`,
    `  Last Update: ${profile.lastUpdate || 'never'}`,
  ];
  ctx.reply(lines.join('\n'));
});

// ============ Token Launch Scanner (DEXScreener) ============

bot.command('scanner', async (ctx) => {
  if (isCommandRateLimited(ctx.from.id, 'scanner')) return ctx.reply('Scanner on cooldown. Try again in a few seconds.');
  const chain = ctx.message.text.split(/\s+/)[1];
  awardXP(ctx.from.id, ctx.from.username || ctx.from.first_name, 'command');
  ctx.reply(await scanNewTokens(chain));
});

bot.command('newpairs', async (ctx) => {
  const chain = ctx.message.text.split(/\s+/)[1];
  ctx.reply(await getNewPairs(chain));
});

bot.command('hot', async (ctx) => {
  ctx.reply(await getHotTokens());
});

bot.command('dexsearch', async (ctx) => {
  const query = ctx.message.text.split(/\s+/).slice(1).join(' ');
  ctx.reply(await dexSearch(query));
});

bot.command('pair', async (ctx) => {
  const addr = ctx.message.text.split(/\s+/)[1];
  ctx.reply(await getPairDetails(addr));
});

// ============ Memecoin Hunter ============

bot.command('hunt', async (ctx) => {
  if (isCommandRateLimited(ctx.from.id, 'hunt')) return ctx.reply('Hunt on cooldown. Try again in a few seconds.');
  const chain = ctx.message.text.split(/\s+/)[1];
  awardXP(ctx.from.id, ctx.from.username || ctx.from.first_name, 'command');
  ctx.reply(await huntMemecoins(chain));
});

bot.command('memescore', async (ctx) => {
  if (isCommandRateLimited(ctx.from.id, 'memescore')) return ctx.reply('Score on cooldown. Try again in a few seconds.');
  const args = ctx.message.text.split(/\s+/).slice(1);
  awardXP(ctx.from.id, ctx.from.username || ctx.from.first_name, 'command');
  ctx.reply(await getMemeScore(args[0], args[1]));
});

bot.command('mememonitor', async (ctx) => {
  if (!isAuthorized(ctx)) return unauthorized(ctx);
  const chain = ctx.message.text.split(/\s+/)[1];
  const chatId = ctx.chat.id;
  // Pass both postAlert (info-only) and sendTg (trade alerts with inline keyboards)
  const result = startMemeMonitor(
    chain,
    (alertMsg) => {
      bot.telegram.sendMessage(chatId, alertMsg).catch(err => {
        console.error(`[memehunter] Alert send failed: ${err.message}`);
      });
    },
    (targetChatId, text, opts) => bot.telegram.sendMessage(targetChatId, text, opts),
  );
  ctx.reply(result);
});

bot.command('memestop', async (ctx) => {
  if (!isAuthorized(ctx)) return unauthorized(ctx);
  ctx.reply(stopMemeMonitor());
});

bot.command('memestatus', async (ctx) => {
  ctx.reply(getMonitorStatus_Meme());
});

bot.command('memepending', async (ctx) => {
  ctx.reply(getPendingApprovals());
});

bot.command('memealert', async (ctx) => {
  if (!isAuthorized(ctx)) return unauthorized(ctx);
  const addr = ctx.message.text.split(/\s+/)[1];
  if (!addr) return ctx.reply('Usage: /memealert 0x... — Manually trigger trade alert for a token');
  const scoreResult = await getMemeScore(addr, 'base');
  ctx.reply(scoreResult);
  // TODO: if score is high enough, trigger alertHuman
});

// ============ Memecoin Approve/Reject Callback Handler ============

bot.on('callback_query', async (ctx) => {
  const data = ctx.callbackQuery?.data;
  if (!data) return ctx.answerCbQuery('Invalid callback.');

  // Handle meme trade approve/reject
  if (data.startsWith('meme_approve:') || data.startsWith('meme_reject:')) {
    // Only authorized users can approve trades
    if (!isAuthorized(ctx)) return ctx.answerCbQuery('Not authorized.');

    const colonIdx = data.indexOf(':');
    const action = data.substring(0, colonIdx);
    const callbackId = data.substring(colonIdx + 1);

    const result = await handleMemeCallback(
      action,
      callbackId,
      (chatId, text, opts) => bot.telegram.sendMessage(chatId, text, opts),
    );

    // Update the original message to remove buttons
    try {
      await ctx.editMessageReplyMarkup({ inline_keyboard: [] });
    } catch { /* message may be old */ }

    return ctx.answerCbQuery(result.slice(0, 200)); // TG callback answer limit
  }

  // Unknown callback
  ctx.answerCbQuery('Unknown action.');
});

// ============ Derivatives Data ============

bot.command('liquidations', async (ctx) => {
  if (isCommandRateLimited(ctx.from.id, 'liquidations')) return ctx.reply('Liquidations on cooldown. Try again shortly.');
  const token = ctx.message.text.split(/\s+/)[1];
  awardXP(ctx.from.id, ctx.from.username || ctx.from.first_name, 'command');
  ctx.reply(await getLiquidations(token));
});

bot.command('funding', async (ctx) => {
  const token = ctx.message.text.split(/\s+/)[1];
  ctx.reply(await getFundingRates(token));
});

bot.command('oi', async (ctx) => {
  const token = ctx.message.text.split(/\s+/)[1];
  ctx.reply(await getOpenInterest(token));
});

bot.command('lsratio', async (ctx) => {
  const token = ctx.message.text.split(/\s+/)[1];
  ctx.reply(await getLongShortRatio(token));
});

bot.command('etf', async (ctx) => {
  ctx.reply(await getETFFlows());
});

// ============ XP / Gamification ============

bot.command('xp', (ctx) => {
  const status = getXPStatus(ctx.from.id, ctx.from.username || ctx.from.first_name);
  const bal = getVibeBalance(ctx.from.id);
  const vibeLine = `VIBE earned: ${bal.balance}`;
  ctx.reply(`${status}\n${vibeLine}`);
});

bot.command('level', (ctx) => {
  ctx.reply(getXPStatus(ctx.from.id, ctx.from.username || ctx.from.first_name));
});

bot.command('achievements', (ctx) => {
  ctx.reply(getAchievements(ctx.from.id, ctx.from.username || ctx.from.first_name));
});

bot.command('top', (ctx) => {
  ctx.reply(getXPLeaderboard());
});

// ============ Catchup & Events ============

bot.command('catchup', async (ctx) => {
  const hours = parseInt(ctx.message.text.split(/\s+/)[1], 10);
  awardXP(ctx.from.id, ctx.from.username || ctx.from.first_name, 'command');
  ctx.reply(await getCatchup(ctx.from.id, hours || undefined));
});

bot.command('events', async (ctx) => {
  const period = ctx.message.text.split(/\s+/)[1];
  ctx.reply(await getCryptoEvents(period));
});

bot.command('unlocks', async (ctx) => {
  ctx.reply(await getTokenUnlocks());
});

// ============ Prediction Markets ============

bot.command('predict', (ctx) => {
  const question = ctx.message.text.split(/\s+/).slice(1).join(' ');
  awardXP(ctx.from.id, ctx.from.username || ctx.from.first_name, 'prediction');
  ctx.reply(createPrediction(ctx.from.id, ctx.from.username || ctx.from.first_name, ctx.chat.id, question));
});

bot.command('bet', (ctx) => {
  const args = ctx.message.text.split(/\s+/).slice(1);
  ctx.reply(placeBet(ctx.from.id, ctx.from.username || ctx.from.first_name, args[0], args[1], args[2]));
});

bot.command('resolve', (ctx) => {
  const args = ctx.message.text.split(/\s+/).slice(1);
  ctx.reply(resolveMarket(ctx.from.id, args[0], args[1]));
});

bot.command('markets', (ctx) => {
  ctx.reply(listMarkets(ctx.chat.id));
});

bot.command('mybets', (ctx) => {
  ctx.reply(getMyBets(ctx.from.id));
});

bot.command('predictors', (ctx) => {
  ctx.reply(getPredictorLeaderboard());
});

// Helper: resolve target user from reply or args
function resolveTarget(ctx) {
  const args = ctx.message.text.split(/\s+/).slice(1);
  if (ctx.message.reply_to_message?.from) {
    const from = ctx.message.reply_to_message.from;
    return { targetId: from.id, targetName: from.username || from.first_name || String(from.id) };
  }
  if (args.length > 0) {
    const parsed = parseInt(args[0], 10);
    if (!isNaN(parsed)) return { targetId: parsed, targetName: args[1] || String(parsed) };
  }
  return { targetId: null, targetName: null };
}

bot.command('status', async (ctx) => {
  if (!isAuthorized(ctx)) return unauthorized(ctx);
  const status = await gitStatus();
  ctx.reply(status);
});

bot.command('pull', async (ctx) => {
  if (!isAuthorized(ctx)) return unauthorized(ctx);
  const result = await gitPull();
  ctx.reply(result);
});

bot.command('log', async (ctx) => {
  if (!isAuthorized(ctx)) return unauthorized(ctx);
  const log = await gitLog();
  ctx.reply(log);
});

bot.command('commit', async (ctx) => {
  if (!isAuthorized(ctx)) return unauthorized(ctx);
  const message = ctx.message.text.replace('/commit', '').trim();
  if (!message) {
    return ctx.reply('Usage: /commit <message>');
  }
  const result = await gitCommitAndPush(message);
  ctx.reply(result);
});

// ============ Git Management Commands (TG Remote) ============

bot.command('gitpush', async (ctx) => {
  if (!isAuthorized(ctx)) return unauthorized(ctx);
  ctx.reply('Pushing to both remotes...');
  const result = await gitPush();
  ctx.reply(`\`\`\`\n${result}\n\`\`\``, { parse_mode: 'Markdown' });
});

bot.command('gitcommit', async (ctx) => {
  if (!isAuthorized(ctx)) return unauthorized(ctx);
  let message = ctx.message.text.replace('/gitcommit', '').trim();
  if (!message) {
    const ts = new Date().toISOString().replace('T', ' ').slice(0, 19);
    message = `TG commit — ${ts}`;
  }
  ctx.reply(`Committing: ${message}`);
  const result = await gitCommitAndPush(message);
  ctx.reply(`\`\`\`\n${result}\n\`\`\``, { parse_mode: 'Markdown' });
});

bot.command('gitstatus', async (ctx) => {
  if (!isAuthorized(ctx)) return unauthorized(ctx);
  const result = await gitStatusShort();
  ctx.reply(`\`\`\`\n${result}\n\`\`\``, { parse_mode: 'Markdown' });
});

bot.command('gitlog', async (ctx) => {
  if (!isAuthorized(ctx)) return unauthorized(ctx);
  const result = await gitLogOneline(10);
  ctx.reply(`\`\`\`\n${result}\n\`\`\``, { parse_mode: 'Markdown' });
});

bot.command('refresh', async (ctx) => {
  if (!isAuthorized(ctx)) return unauthorized(ctx);
  await reloadSystemPrompt();
  ctx.reply('Memory reloaded.');
});

bot.command('clear', (ctx) => {
  if (!isAuthorized(ctx)) return unauthorized(ctx);
  clearHistory(ctx.chat.id);
  ctx.reply('Conversation history cleared.');
});

bot.command('model', (ctx) => {
  if (!isAuthorized(ctx)) return unauthorized(ctx);
  const arg = ctx.message.text.replace('/model', '').trim().toLowerCase();
  if (arg === 'opus') {
    config.anthropic.model = 'claude-opus-4-6';
    ctx.reply('Switched to Opus 4.6 (deep analysis mode).');
  } else if (arg === 'sonnet') {
    config.anthropic.model = 'claude-sonnet-4-5-20250929';
    ctx.reply('Switched to Sonnet 4.5 (fast mode).');
  } else {
    ctx.reply(`Current: ${config.anthropic.model}\nUsage: /model opus or /model sonnet`);
  }
});

// ============ Contribution Tracking Commands ============

bot.command('mystats', (ctx) => {
  const stats = getUserStats(ctx.from.id);
  if (!stats) {
    return ctx.reply('No contributions tracked yet. Just keep talking.');
  }
  const lines = [
    `${stats.username} — since ${stats.firstSeen}`,
    `Messages: ${stats.messageCount}`,
    `Tracked contributions: ${stats.contributions}`,
    `Avg quality: ${stats.avgQuality}/5`,
    `Replies given: ${stats.repliesGiven} | received: ${stats.repliesReceived}`,
    `Days active: ${stats.daysSinceFirst}`,
    `Wallet linked: ${stats.walletLinked ? 'yes' : 'no'}`,
    '',
    'Categories:',
    ...Object.entries(stats.categoryCounts).map(([k, v]) => `  ${k}: ${v}`),
  ];
  ctx.reply(lines.join('\n'));
});

bot.command('groupstats', (ctx) => {
  const stats = getGroupStats(ctx.chat.id);
  const lines = [
    `Group contributions: ${stats.totalContributions}`,
    `Active users: ${stats.totalUsers}`,
    `Interactions: ${stats.totalInteractions}`,
    '',
    'Categories:',
    ...Object.entries(stats.categoryCounts).map(([k, v]) => `  ${k}: ${v}`),
    '',
    'Top contributors:',
    ...stats.topContributors,
  ];
  ctx.reply(lines.join('\n'));
});

bot.command('linkwallet', async (ctx) => {
  const address = ctx.message.text.replace('/linkwallet', '').trim();
  if (!address || !address.startsWith('0x') || address.length !== 42) {
    return ctx.reply('Usage: /linkwallet 0xYourAddress');
  }
  const success = await linkWallet(ctx.from.id, address);
  if (success) {
    ctx.reply(`Wallet linked: ${address.slice(0, 6)}...${address.slice(-4)}`);
  } else {
    ctx.reply('Send a message first so I can track you, then link your wallet.');
  }
});

// ============ /connect — Wallet connect via TG ============

bot.command('connect', async (ctx) => {
  const input = ctx.message.text.replace(/^\/connect(@\w+)?/i, '').trim();

  if (!input) {
    // No argument — show current wallet or instructions
    const wallet = getUserWallet(ctx.from.id);
    if (wallet) {
      return ctx.reply(`Connected wallet: ${wallet.slice(0, 6)}...${wallet.slice(-4)}\n\nTo change: /connect 0xNewAddress`);
    }
    return ctx.reply(
      'Link your wallet to earn VIBE rewards.\n\n' +
      'Usage:\n' +
      '  /connect 0x1234...abcd\n' +
      '  /connect myname.eth\n\n' +
      'Your wallet address will be associated with your Telegram account for on-chain rewards when the VIBE token launches.'
    );
  }

  // Accept ENS-style names (store as-is)
  if (input.endsWith('.eth') || input.endsWith('.ens')) {
    const success = await linkWallet(ctx.from.id, input);
    if (success) {
      ctx.reply(`ENS name linked: ${input}\n\nWe'll resolve this to an address when rewards go on-chain.`);
    } else {
      ctx.reply('Send a message first so I can track you, then link your wallet.');
    }
    return;
  }

  // Validate Ethereum address: 0x + 40 hex chars
  const isValidEth = /^0x[0-9a-fA-F]{40}$/.test(input);
  if (!isValidEth) {
    return ctx.reply('Invalid address. Must be:\n  - Ethereum: 0x + 40 hex characters\n  - ENS: name.eth\n\nExample: /connect 0x742d35Cc6634C0532925a3b844Bc9e7595f2bD28');
  }

  const success = await linkWallet(ctx.from.id, input);
  if (success) {
    const bal = getVibeBalance(ctx.from.id);
    ctx.reply(
      `Wallet connected: ${input.slice(0, 6)}...${input.slice(-4)} ✓\n` +
      (bal.balance > 0 ? `\nPending VIBE: ${bal.balance}` : '\nStart contributing to earn VIBE!')
    );
  } else {
    ctx.reply('Send a message first so I can track you, then connect your wallet.');
  }
});

// /wallet alias — show wallet status + VIBE balance (does NOT conflict with sovereign /wallet because
// sovereign wallet requires subcommands like create/unlock/lock; bare /wallet with no args from non-owner
// falls through to here via the address check in the existing handler)
bot.command('walletstatus', (ctx) => {
  const wallet = getUserWallet(ctx.from.id);
  const bal = getVibeBalance(ctx.from.id);
  const emission = calculateDailyEmission(ctx.from.id);

  const lines = ['Wallet Status'];
  if (wallet) {
    if (wallet.endsWith('.eth') || wallet.endsWith('.ens')) {
      lines.push(`  Address: ${wallet}`);
    } else {
      lines.push(`  Address: ${wallet.slice(0, 6)}...${wallet.slice(-4)}`);
    }
    lines.push(`  VIBE Balance: ${bal.balance}`);
    lines.push(`  Daily Rate: ~${emission.daily} VIBE/day`);
    if (bal.lastEmission) {
      lines.push(`  Last Emission: ${bal.lastEmission}`);
    }
  } else {
    lines.push('  No wallet linked.');
    lines.push('  Use /connect 0x... to link your wallet.');
  }

  ctx.reply(lines.join('\n'));
});

// ============ /vibe — VIBE balance + daily rate ============

bot.command('vibe', (ctx) => {
  const bal = getVibeBalance(ctx.from.id);
  const emission = calculateDailyEmission(ctx.from.id);
  const factual = getFactualScore(ctx.from.id);

  const lines = ['VIBE Token Balance'];
  lines.push(`  Balance: ${bal.balance} VIBE`);
  lines.push(`  Daily Rate: ~${emission.daily} VIBE/day`);

  if (emission.breakdown && emission.breakdown.share_pct) {
    lines.push(`  Pool Share: ${emission.breakdown.share_pct}% of ${emission.breakdown.base_rate}/day`);
    lines.push(`  Active Users: ${emission.breakdown.active_users}`);
    lines.push(`  Streak Multiplier: ${emission.breakdown.streak_multiplier}x`);
  }

  if (factual) {
    const wallet = getUserWallet(ctx.from.id);
    lines.push('');
    lines.push(`Contributions: ${factual.total_contributions} tracked`);
    lines.push(`Quality: ${factual.quality_avg} avg`);
    if (wallet) {
      if (wallet.endsWith('.eth') || wallet.endsWith('.ens')) {
        lines.push(`Wallet: ${wallet} ✓`);
      } else {
        lines.push(`Wallet: ${wallet.slice(0, 6)}...${wallet.slice(-4)} ✓`);
      }
    } else {
      lines.push(`Wallet: not linked (/connect 0x...)`);
    }
  }

  lines.push('');
  lines.push('VIBE is not on-chain yet — balances are tracked for future airdrop.');

  ctx.reply(lines.join('\n'));
});

// ============ /vibelb — VIBE Leaderboard ============

bot.command(['vibeleaderboard', 'vibelb'], (ctx) => {
  const lb = getLeaderboard(10);

  if (lb.length === 0) {
    return ctx.reply('No VIBE earned yet. Keep contributing to start earning!');
  }

  const stats = getEmissionStats();
  const lines = [`VIBE Leaderboard (${stats.total_emitted} total emitted)\n`];

  for (let i = 0; i < lb.length; i++) {
    const entry = lb[i];
    const medal = i === 0 ? '🥇' : i === 1 ? '🥈' : i === 2 ? '🥉' : `${i + 1}.`;
    lines.push(`  ${medal} ${entry.username} — ${entry.balance} VIBE`);
  }

  lines.push(`\nDaily pool: ${stats.daily_rate} VIBE | ${stats.active_earners} earners`);

  ctx.reply(lines.join('\n'));
});

// ============ Link Miner — Bind mobile mining identity to Telegram account ============

bot.command('linkminer', async (ctx) => {
  const userId = String(ctx.from.id);
  const userName = ctx.from.username || ctx.from.first_name || 'Unknown';
  const minerId = ctx.message.text.replace(/\/linkminer(@\S+)?/, '').trim();

  if (!minerId) {
    // Show current linked miner + all mobile-* IDs that might be theirs
    const linked = getLinkedMiner(userId);
    const stats = getMiningStats(userId);
    const lines = [
      'Link your mobile miner to this Telegram account.',
      '',
      `Your Telegram ID: ${userId}`,
      `Current JUL balance: ${stats.julBalance.toFixed(2)}`,
      linked ? `Linked miner: ${linked}` : 'No miner linked yet.',
      '',
      'Usage: /linkminer <miner-id>',
      '',
      'Your miner ID is shown in the mining Mini App.',
      'Example: /linkminer mobile-be7af1738b76ca2c',
      '',
      'This transfers JUL balance from the miner to your Telegram account.',
    ];
    return ctx.reply(lines.join('\n'));
  }

  const result = linkMiner(userId, minerId);

  if (!result.success) {
    if (result.reason === 'miner_not_found') {
      return ctx.reply(`Miner "${minerId}" not found. Check the ID in the mining Mini App.`);
    }
    if (result.reason === 'same_id') {
      return ctx.reply('That ID is already your account.');
    }
    return ctx.reply('Link failed. Try again.');
  }

  const lines = [
    `Miner linked: ${minerId}`,
    '',
    `Transferred: ${result.transferred.toFixed(2)} JUL + ${result.proofsTransferred} proofs`,
    `New balance: ${result.newBalance.toFixed(2)} JUL`,
    `Total proofs: ${result.totalProofs}`,
    '',
    `You can now use /tip to burn JUL from this balance.`,
  ];
  ctx.reply(lines.join('\n'));
});

// ============ Backup ============

bot.command('backup', async (ctx) => {
  if (!isAuthorized(ctx)) return unauthorized(ctx);
  const result = await backupData();
  ctx.reply(result);
});

// ============ Moderation (Will + Jarvis = Co-Admins) ============
// 50/50 human + AI governance. Both can execute moderation.
// Every action is logged with an evidence hash for on-chain accountability.
// No other humans have admin powers — eliminates third-party bias.

function resolveTargetUser(ctx) {
  // Try reply-to-message first (most natural)
  if (ctx.message.reply_to_message?.from) {
    return ctx.message.reply_to_message.from;
  }
  return null;
}

bot.command('warn', async (ctx) => {
  if (!isOwner(ctx)) return ownerOnly(ctx);
  const target = resolveTargetUser(ctx);
  if (!target) return ctx.reply('Reply to a message to warn that user.');
  if (target.is_bot) return ctx.reply('Cannot moderate bots.');

  const reason = ctx.message.text.replace('/warn', '').trim() || 'Community guidelines violation';
  const result = await warnUser(bot, ctx.chat.id, target.id, reason, ctx.from.id);

  if (result.escalated) {
    ctx.reply(`${target.first_name} warned (${result.warnings}/${3} — auto-muted for 1hr). Reason: ${reason}`);
  } else {
    ctx.reply(`${target.first_name} warned (${result.warnings}/${3}). Reason: ${reason}`);
  }
});

bot.command('mute', async (ctx) => {
  if (!isOwner(ctx)) return ownerOnly(ctx);
  const target = resolveTargetUser(ctx);
  if (!target) return ctx.reply('Reply to a message to mute that user.');
  if (target.is_bot) return ctx.reply('Cannot moderate bots.');

  const args = ctx.message.text.replace('/mute', '').trim();
  // Parse duration: /mute 1h reason or /mute 30m reason
  const durationMatch = args.match(/^(\d+)(m|h|d)/);
  let duration = 3600; // default 1h
  let reason = args;
  if (durationMatch) {
    const val = parseInt(durationMatch[1], 10);
    const unit = durationMatch[2];
    duration = unit === 'm' ? val * 60 : unit === 'h' ? val * 3600 : val * 86400;
    reason = args.slice(durationMatch[0].length).trim() || 'Muted by admin';
  }

  const result = await muteUser(bot, ctx.chat.id, target.id, duration, reason, ctx.from.id);
  if (result.executed) {
    const dStr = duration >= 3600 ? `${Math.round(duration/3600)}h` : `${Math.round(duration/60)}m`;
    ctx.reply(`${target.first_name} muted for ${dStr}. Reason: ${reason}`);
  } else {
    ctx.reply(`Failed to mute: ${result.error}. Make sure JARVIS is a group admin.`);
  }
});

bot.command('unmute', async (ctx) => {
  if (!isOwner(ctx)) return ownerOnly(ctx);
  const target = resolveTargetUser(ctx);
  if (!target) return ctx.reply('Reply to a message to unmute that user.');

  const reason = ctx.message.text.replace('/unmute', '').trim() || 'Unmuted';
  const result = await unmuteUser(bot, ctx.chat.id, target.id, reason, ctx.from.id);
  if (result.executed) {
    ctx.reply(`${target.first_name} unmuted.`);
  } else {
    ctx.reply(`Failed to unmute: ${result.error}`);
  }
});

bot.command('ban', async (ctx) => {
  if (!isOwner(ctx)) return ownerOnly(ctx);
  const target = resolveTargetUser(ctx);
  if (!target) return ctx.reply('Reply to a message to ban that user.');
  if (target.is_bot) return ctx.reply('Cannot moderate bots.');

  const reason = ctx.message.text.replace('/ban', '').trim() || 'Banned by admin';
  const result = await banUser(bot, ctx.chat.id, target.id, reason, ctx.from.id);
  if (result.executed) {
    ctx.reply(`${target.first_name} banned. Reason: ${reason}\nEvidence: ${result.evidenceHash.slice(0, 12)}...`);
  } else {
    ctx.reply(`Failed to ban: ${result.error}. Make sure JARVIS is a group admin.`);
  }
});

bot.command('unban', async (ctx) => {
  if (!isOwner(ctx)) return ownerOnly(ctx);
  const target = resolveTargetUser(ctx);
  if (!target) return ctx.reply('Reply to a message to unban that user.');

  const reason = ctx.message.text.replace('/unban', '').trim() || 'Unbanned';
  const result = await unbanUser(bot, ctx.chat.id, target.id, reason, ctx.from.id);
  if (result.executed) {
    ctx.reply(`${target.first_name} unbanned.`);
  } else {
    ctx.reply(`Failed to unban: ${result.error}`);
  }
});

bot.command('modlog', async (ctx) => {
  if (!isAuthorized(ctx)) return unauthorized(ctx);
  const log = getModerationLog(ctx.chat.id, 10);
  if (!log.length) return ctx.reply('No moderation actions recorded.');

  const lines = log.map(e => {
    const time = new Date(e.timestamp).toISOString().slice(5, 16).replace('T', ' ');
    const status = e.executed === false ? ' [FAILED]' : '';
    return `${time} ${e.action.toUpperCase()} user:${e.userId} — ${e.reason}${status}`;
  });
  ctx.reply('Moderation Log:\n' + lines.join('\n'));
});

bot.command('spamlog', async (ctx) => {
  if (!isAuthorized(ctx)) return unauthorized(ctx);
  const log = getSpamLog(ctx.chat.id, 10);
  if (!log.length) return ctx.reply('No spam actions recorded.');

  const lines = log.map(e => {
    const time = new Date(e.timestamp).toISOString().slice(5, 16).replace('T', ' ');
    const del = e.messageDeleted ? ' [deleted]' : '';
    return `${time} ${e.action.toUpperCase()} user:${e.userId} — ${e.reason}${del}`;
  });
  ctx.reply('Spam Log:\n' + lines.join('\n'));
});

// ============ Behavior Flags ============
// Runtime-configurable behavioral toggles. Persisted to data/behavior.json.

bot.command('behavior', async (ctx) => {
  if (!isAuthorized(ctx)) return unauthorized(ctx);
  ctx.reply('Behavior flags:\n' + listFlags());
});

bot.command('setbehavior', async (ctx) => {
  if (ctx.from.id !== config.ownerUserId) return ctx.reply('Owner only.');
  const args = ctx.message.text.split(/\s+/).slice(1);
  if (args.length < 2) return ctx.reply('Usage: /setbehavior <flag> <true|false>\n\nFlags:\n' + listFlags());
  const key = args[0];
  const val = args[1].toLowerCase();
  if (val !== 'true' && val !== 'false') return ctx.reply('Value must be true or false.');
  const ok = await setFlag(key, val === 'true');
  if (!ok) return ctx.reply(`Unknown flag: ${key}`);
  ctx.reply(`${key} = ${val}`);
});

// ============ The Ark — Emergency Recovery ============
// If the main group is ever deleted, Jarvis DMs every active user an invite link to the Ark.

bot.command('ark', async (ctx) => {
  if (!isOwner(ctx)) return ownerOnly(ctx);

  if (!config.arkGroupId) {
    return ctx.reply('Ark group not configured. Set ARK_GROUP_ID in .env.');
  }

  ctx.reply('Launching the Ark. Creating invite link and notifying all active users...');

  try {
    // Create a permanent invite link for the Ark
    const invite = await bot.telegram.createChatInviteLink(config.arkGroupId, {
      name: 'VibeSwap Ark — Emergency Recovery',
      creates_join_request: false,
    });

    const inviteLink = invite.invite_link;

    // Get all tracked users from tracker
    const allUsers = getAllUsers();
    const userIds = Object.keys(allUsers).map(Number);

    let sent = 0;
    let failed = 0;

    for (const userId of userIds) {
      // Skip bots and the owner (owner already knows)
      if (userId === config.ownerUserId) continue;

      try {
        await bot.telegram.sendMessage(userId,
          `The VibeSwap community chat was disrupted. We've activated the Ark — the backup channel.\n\n` +
          `Join here: ${inviteLink}\n\n` +
          `Your contributions and history are safe. See you inside.`
        );
        sent++;
        // Rate limit: Telegram allows ~30 msgs/sec to different users
        await new Promise(r => setTimeout(r, 50));
      } catch {
        failed++;
      }
    }

    ctx.reply(`Ark deployed. Invite sent to ${sent} users (${failed} unreachable — they haven't DMed Jarvis before).`);
  } catch (err) {
    ctx.reply(`Ark failed: ${err.message}. Make sure Jarvis is admin of the Ark group.`);
  }
});

// ============ Digest Commands ============

bot.command('digest', async (ctx) => {
  if (!isAuthorized(ctx)) return unauthorized(ctx);
  if (isCommandRateLimited(ctx.from.id, 'digest')) return ctx.reply('Digest on cooldown. Try again in a minute.');
  ctx.reply('Generating daily digest...');
  const digest = await generateDigest(ctx.chat.id);
  if (digest) {
    ctx.reply(digest);
  } else {
    ctx.reply('No activity to report today.');
  }
});

bot.command('weeklydigest', async (ctx) => {
  if (!isAuthorized(ctx)) return unauthorized(ctx);
  ctx.reply('Generating weekly digest...');
  const digest = await generateWeeklyDigest(ctx.chat.id);
  if (digest) {
    ctx.reply(digest);
  } else {
    ctx.reply('No activity this week.');
  }
});

// ============ Thread Archival Commands ============

bot.command('archive', async (ctx) => {
  if (!isAuthorized(ctx)) return unauthorized(ctx);
  const result = await archiveThread(ctx.chat.id, ctx.chat.title, ctx.from.id);
  if (result.success) {
    const t = result.thread;
    ctx.reply(
      `Thread archived.\n` +
      `ID: ${t.id}\n` +
      `Messages: ${t.messageCount} from ${t.participants.length} participants\n` +
      `Topics: ${t.topics.join(', ') || 'general'}\n` +
      `Summary: ${t.summary}`
    );
  } else {
    ctx.reply(result.error);
  }
});

bot.command('threads', async (ctx) => {
  if (!isAuthorized(ctx)) return unauthorized(ctx);
  const recent = getRecentThreads(ctx.chat.id, 5);
  if (!recent.length) return ctx.reply('No archived threads yet. Use /archive to save a conversation.');

  const lines = ['Archived threads:'];
  for (const t of recent) {
    const date = new Date(t.timestamp).toISOString().split('T')[0];
    lines.push(`  ${t.id} — ${date} — ${t.messageCount} msgs — ${t.topics.join(', ') || 'general'}`);
  }

  const stats = getThreadStats();
  lines.push('');
  lines.push(`Total: ${stats.totalArchived} threads, ${stats.totalMessages} messages, ${stats.totalParticipants} participants`);

  ctx.reply(lines.join('\n'));
});

// ============ Intelligence Stats Command ============

bot.command('brain', async (ctx) => {
  if (!isAuthorized(ctx)) return unauthorized(ctx);
  const stats = getIntelligenceStats();
  const lines = [
    'JARVIS Intelligence',
    '',
    `Proactive engagements this hour: ${stats.engagementsThisHour}/${stats.maxPerHour}`,
    `Last engagement: ${stats.lastEngageTime}`,
    `Last moderation: ${stats.lastModerateTime}`,
    `Cooldown remaining: ${Math.round(stats.cooldownRemaining / 1000)}s`,
  ];
  ctx.reply(lines.join('\n'));
});

// ============ Learning Commands ============

bot.command('learned', async (ctx) => {
  const userId = ctx.from.id;
  const chatId = ctx.chat.id;
  const stats = await getLearningStats(userId, chatId);

  const lines = [
    'JARVIS Learning Engine',
    '',
    `Relationship: ${stats.knowledgeClass} (${stats.interactionCount} interactions)`,
    '',
    `Your CKB: ${stats.userFacts} facts (${stats.userTokens}/${stats.userBudget} tokens, ${stats.userUtilization})`,
    `Corrections: ${stats.userCorrections}`,
    '',
    `Group CKB: ${stats.groupFacts} facts (${stats.groupTokens}/${stats.groupBudget} tokens)`,
    `Group norms: ${stats.groupNorms}`,
    '',
    `Network skills: ${stats.globalSkills} (${stats.confirmedSkills} confirmed, ${stats.skillTokens}/${stats.skillBudget} tokens)`,
  ];
  ctx.reply(lines.join('\n'));
});

bot.command('knowledge', async (ctx) => {
  if (!isAuthorized(ctx)) return unauthorized(ctx);
  const arg = ctx.message.text.replace('/knowledge', '').trim();

  if (arg === 'group') {
    const summary = await getGroupKnowledgeSummary(ctx.chat.id);
    if (!summary) return ctx.reply('No group knowledge learned yet.');

    const lines = [`Group Knowledge (${summary.occupation}/${summary.budget} tokens):`];
    for (const fact of summary.facts) {
      const age = Math.floor((Date.now() - new Date(fact.created).getTime()) / 86400000);
      lines.push(`  [${fact.category}] ${fact.content} (${age}d ago, x${fact.confirmed})`);
    }
    if (summary.norms.length > 0) {
      lines.push('');
      lines.push('Norms:');
      for (const norm of summary.norms) {
        lines.push(`  - ${norm}`);
      }
    }
    return ctx.reply(lines.join('\n'));
  }

  // Default: show user knowledge
  const summary = await getUserKnowledgeSummary(ctx.from.id);
  if (!summary) return ctx.reply('No personal knowledge learned yet. Just keep talking.');

  const lines = [
    `Your Knowledge Profile (${summary.occupation}/${summary.budget} tokens):`,
  ];
  for (const fact of summary.facts) {
    const age = Math.floor((Date.now() - new Date(fact.created).getTime()) / 86400000);
    const classTag = fact.knowledgeClass === 'common' ? 'C' : fact.knowledgeClass === 'mutual' ? 'M' : 'S';
    lines.push(`  [${classTag}|${fact.category}] ${fact.content} (vd:${fact.valueDensity}, ${fact.decayPercent}% decayed, x${fact.confirmed})`);
  }
  if (summary.corrections.length > 0) {
    lines.push('');
    lines.push('Recent corrections:');
    for (const c of summary.corrections.slice(-5)) {
      lines.push(`  ${c.what_is_right?.slice(0, 80) || 'N/A'}`);
    }
  }
  ctx.reply(lines.join('\n'));
});

bot.command('skills', async (ctx) => {
  if (!isAuthorized(ctx)) return unauthorized(ctx);
  const skills = getSkills();
  if (skills.length === 0) return ctx.reply('No skills learned yet. Correct me and I will learn.');

  const lines = ['Learned Skills (from corrections):'];
  for (const skill of skills) {
    const conf = skill.confirmations > 1 ? ` (confirmed x${skill.confirmations})` : ' (new)';
    lines.push(`  [${skill.id}] ${skill.lesson.slice(0, 100)}${conf}`);
  }
  ctx.reply(lines.join('\n'));
});

// ============ Privacy Command ============

bot.command('privacy', async (ctx) => {
  if (!isOwner(ctx)) return ownerOnly(ctx);
  const status = getPrivacyStatus();
  const lines = [
    'Privacy Fortress (Rosetta Stone Protocol)',
    '',
    `Encryption: ${status.enabled ? 'ENABLED' : 'DISABLED'}`,
    `Key loaded: ${status.keyLoaded ? 'yes' : 'no'}`,
    `Fingerprint: ${status.fingerprint}`,
    `Algorithm: ${status.algorithm}`,
    `Key derivation: ${status.keyDerivation}`,
    `PBKDF2 iterations: ${status.pbkdf2Iterations}`,
    '',
    'Per-user CKBs: AES-256-GCM (per-user derived key)',
    'Per-group CKBs: AES-256-GCM (per-group derived key)',
    'Skills: HMAC-SHA256 integrity verification',
    'Corrections log: HMAC signed',
    '',
    'At rest: encrypted. In memory: decrypted (compute-to-data).',
    'Knowledge never leaves its encryption boundary.',
  ];
  ctx.reply(lines.join('\n'));
});

// ============ Inner Dialogue Command ============

bot.command('inner', async (ctx) => {
  if (!isOwner(ctx)) return ownerOnly(ctx);
  const stats = getDialogueStats();
  const recent = getRecentDialogue(8);

  const lines = [
    'JARVIS Inner Dialogue (Self-Reflection)',
    '',
    `Entries: ${stats.totalEntries} (${stats.totalTokens}/${stats.budget} tokens, ${stats.utilization})`,
    `Promoted to network: ${stats.promotedToNetwork}`,
    '',
  ];

  if (stats.totalEntries > 0) {
    lines.push('Categories:');
    for (const [cat, count] of Object.entries(stats.categoryCounts)) {
      lines.push(`  ${cat}: ${count}`);
    }
    lines.push('');
  }

  if (recent.length > 0) {
    lines.push('Recent:');
    for (const entry of recent) {
      const age = Math.floor((Date.now() - new Date(entry.created).getTime()) / (60 * 60 * 1000));
      const ageLabel = age < 1 ? 'just now' : age < 24 ? `${age}h ago` : `${Math.floor(age / 24)}d ago`;
      lines.push(`  [${ageLabel}] [${entry.category}] ${entry.thought.slice(0, 120)}`);
    }
  } else {
    lines.push('No inner dialogue entries yet. Self-reflection begins after first flush cycle.');
  }

  ctx.reply(lines.join('\n'));
});

// ============ Shard / Network Commands ============

bot.command('shard', async (ctx) => {
  if (!isOwner(ctx)) return ownerOnly(ctx);
  const info = getShardInfo();
  const lines = [
    'JARVIS Shard Identity',
    '',
    `Shard ID: ${info.id}`,
    `Mode: ${info.totalShards > 1 ? 'MULTI-SHARD' : 'SINGLE-SHARD'}`,
    `Status: ${info.status}`,
    `State backend: ${info.capabilities.stateBackend}`,
    `Encryption: ${info.capabilities.encryption ? 'enabled' : 'disabled'}`,
    `Model: ${info.capabilities.model}`,
    `Load: ${info.load}%`,
    `Local users: ${info.localUsers}`,
    `Peers: ${info.peers}`,
    `Uptime: ${Math.round(info.uptime / 60)}m`,
    `Memory: ${info.memory}MB`,
  ];
  ctx.reply(lines.join('\n'));
});

bot.command('network', async (ctx) => {
  if (!isAuthorized(ctx)) return unauthorized(ctx);
  const topo = getTopology();
  const archives = getArchiveStatus();
  const consensus = getConsensusState();
  const crpc = getCRPCStats();
  const kchain = getChainStats();

  const lines = [
    'JARVIS Mind Network',
    '',
    `Shards: ${topo.runningShards} active, ${topo.downShards} down`,
    `Total users: ${topo.totalUsers}`,
    `Network health: ${topo.networkHealth.healthy ? 'HEALTHY' : 'DEGRADED'}`,
    '',
  ];

  if (topo.shards.length > 0) {
    for (const shard of topo.shards) {
      const uptimeStr = shard.uptime > 86400
        ? `${Math.floor(shard.uptime / 86400)}d ${Math.floor((shard.uptime % 86400) / 3600)}h`
        : shard.uptime > 3600
        ? `${Math.floor(shard.uptime / 3600)}h ${Math.floor((shard.uptime % 3600) / 60)}m`
        : `${Math.floor(shard.uptime / 60)}m`;
      lines.push(`  ${shard.shardId} (${shard.nodeType}): ${shard.userCount} users, ${shard.load}% load, uptime ${uptimeStr} [${shard.status}]`);
    }
    lines.push('');
  }

  lines.push(`Archive nodes: ${archives.running}/${archives.minimum} minimum (${archives.healthy ? 'healthy' : 'BELOW MINIMUM'})`);
  lines.push('');
  lines.push(`BFT Consensus: ${consensus.enabled ? 'ENABLED' : 'single-shard'} | ${consensus.committedTotal} committed | ${consensus.pendingProposals} pending`);
  lines.push(`CRPC: ${crpc.completedTasks} rounds | avg confidence: ${crpc.avgConfidence} | local+multi mode`);
  if (crpc.recentTasks?.length > 0) {
    const recent = crpc.recentTasks[crpc.recentTasks.length - 1];
    lines.push(`  Last round: ${recent.taskId?.slice(0, 20)}... | confidence: ${(recent.confidence * 100).toFixed(0)}% | ${recent.participants} shards`);
  }
  lines.push(`Knowledge Chain: height ${kchain.height} | ${kchain.pendingChanges} pending changes`);
  if (kchain.head) {
    lines.push(`  Head: ${kchain.head.hash.slice(0, 12)}... | cumVD: ${kchain.head.cumulativeValueDensity.toFixed(3)}`);
  }

  ctx.reply(lines.join('\n'));
});

// ============ CRPC Demo — Live Consensus Round ============
// Triggers a full 4-phase CRPC round and posts the result in chat.
// Usage: /crpc [prompt] — default prompt if none provided.

bot.command('crpc', async (ctx) => {
  if (!isAuthorized(ctx)) return unauthorized(ctx);

  const customPrompt = ctx.message.text.replace(/^\/crpc\s*/, '').trim() || null;
  await ctx.reply('⚡ Running CRPC consensus — 3 shards generating independently...');

  try {
    const trace = await runCRPCDemo(customPrompt);

    // Message 1: Protocol trace
    const traceLines = [
      `🔐 CRPC CONSENSUS COMPLETE`,
      `Protocol: Commit-Reveal Pairwise Comparison`,
      `Duration: ${trace.totalDurationMs}ms | Prompt: "${(customPrompt || trace.prompt || 'default').slice(0, 60)}"`,
      '',
      `━━ Phase 1: WORK COMMIT ━━`,
      ...trace.phases[0].commits.map(c => `  🔒 ${c.shardId}: ${c.commitHash.slice(0, 20)}…`),
      '',
      `━━ Phase 2: WORK REVEAL ━━`,
      ...trace.phases[1].reveals.map(r => `  ✅ ${r.shardId}: "${r.response.slice(0, 60)}…"`),
      '',
      `━━ Phase 3+4: PAIRWISE VOTE ━━`,
      ...trace.phases[3].pairwiseResults.map(pr =>
        `  ${pr.pairId}: A=${pr.votes.A_BETTER} B=${pr.votes.B_BETTER} EQ=${pr.votes.EQUIVALENT} → ${pr.winner}`
      ),
      '',
      `━━ RANKINGS ━━`,
      ...trace.rankings.map((r, i) => `  ${['🥇','🥈','🥉'][i] || '  '} ${r.shardId} (${r.pairwiseWins} wins)`),
      '',
      `Winner: ${trace.consensusWinner} | Confidence: ${(trace.confidence * 100).toFixed(0)}%`,
    ];

    await ctx.reply(traceLines.join('\n'));

    // Message 2: The actual consensus response (clean, separate)
    const responseMsg = `💬 Consensus response:\n\n${trace.consensusResponse}`;
    if (responseMsg.length > 4000) {
      await ctx.reply(responseMsg.slice(0, 4000));
      await ctx.reply(responseMsg.slice(4000));
    } else {
      await ctx.reply(responseMsg);
    }
  } catch (err) {
    await ctx.reply(`CRPC failed: ${err.message}`);
  }
});

// ============ Brain — Intelligence Loop Status ============
// Shows the self-improvement feedback loop: score trends, calibration, inner dialogue.

bot.command('brain', async (ctx) => {
  if (!isAuthorized(ctx)) return unauthorized(ctx);

  const intel = getIntelligenceStats();
  const trends = await getScoreTrends(7);
  const calibration = await getScoreCalibration();

  const lines = ['🧠 JARVIS Brain Status', ''];

  // Score trends
  if (trends && trends.count > 0) {
    lines.push(`━━ Response Quality (${trends.count} responses, 7d) ━━`);
    lines.push(`  Accuracy:    ${trends.accuracy}/10`);
    lines.push(`  Relevance:   ${trends.relevance}/10`);
    lines.push(`  Conciseness: ${trends.conciseness}/10`);
    lines.push(`  Usefulness:  ${trends.usefulness}/10`);
    lines.push(`  Naturalness: ${trends.naturalness}/10`);
    lines.push(`  Composite:   ${trends.composite}/10`);
  } else {
    lines.push('Score trends: insufficient data (need ≥5 scored responses)');
  }
  lines.push('');

  // Calibration
  lines.push('━━ Self-Calibration ━━');
  lines.push(calibration || 'No active calibration (all scores ≥7 or insufficient data)');
  lines.push('');

  // Engagement stats
  lines.push('━━ Engagement ━━');
  lines.push(`  This hour: ${intel.engagementsThisHour}/${intel.maxPerHour}`);
  lines.push(`  Cooldown: ${Math.round(intel.cooldownRemaining / 1000)}s`);
  lines.push(`  Rapport tracked: ${intel.rapportTracked} users`);

  await ctx.reply(lines.join('\n'));
});

// ============ Mine — Launch Shard Miner Mini App ============

bot.command('mine', async (ctx) => {
  const webAppUrl = process.env.WEBAPP_URL || `https://jarvis-vibeswap.fly.dev/app/`;
  const isPrivate = ctx.chat.type === 'private';

  if (isPrivate) {
    // DM: web_app button works in reply keyboard
    await ctx.reply(
      'Launch a Jarvis shard on your phone.\nMine JUL, join consensus, earn compute credits.',
      {
        reply_markup: {
          keyboard: [[
            { text: 'Launch Shard', web_app: { url: webAppUrl } }
          ]],
          resize_keyboard: true,
          one_time_keyboard: true,
        }
      }
    );
  } else {
    // Group: web_app buttons not allowed — send direct link + DM prompt
    const botUsername = ctx.botInfo?.username || 'JarvisVibeSwapBot';
    await ctx.reply(
      'Launch a Jarvis shard on your phone.\nMine JUL, join consensus, earn compute credits.\n\n' +
      `Tap to open: ${webAppUrl}\n\n` +
      `Or DM me @${botUsername} and type /mine for the full Mini App experience.`
    );
  }
});

// Handle data sent back when Mini App closes
bot.on('web_app_data', async (ctx) => {
  try {
    const data = JSON.parse(ctx.webAppData.data);
    if (data.type === 'mining_report') {
      await ctx.reply(
        `Mining session complete.\n` +
        `JUL mined: ${data.julMined?.toFixed(2) || 0}\n` +
        `Proofs submitted: ${data.proofsAccepted || 0}\n` +
        `Hashrate: ${data.hashrate || 0} H/s`
      );
    }
  } catch {
    // Silently ignore malformed data
  }
});

// ============ Balance — JUL + Compute Stats ============

bot.command('balance', async (ctx) => {
  const userId = String(ctx.from.id);
  const userName = ctx.from.username || ctx.from.first_name || 'Unknown';
  const mining = getMiningStats(userId);
  const compute = getComputeStats(userId);
  const treasury = getTreasuryStats();
  const learningStats = await getLearningStats(userId, ctx.chat.id);

  const lines = [
    `Balance: ${userName}`,
    '',
    `JUL: ${mining.julBalance.toFixed(2)}`,
    `Proofs submitted: ${mining.proofsSubmitted}`,
    `Mining difficulty: ${mining.difficulty}`,
    '',
    'JUL Bridge:',
    `  Rate: 1 JUL = ${compute.pool.julToPoolRatio.toLocaleString()} tokens (CPI-adjusted)`,
    `  Burned today: ${treasury.dailyBurned.toFixed(2)} JUL`,
    `  Pool expansion: +${treasury.dailyPoolExpansion.toLocaleString()} tokens`,
    `  Effective pool: ${compute.pool.dailyPool.toLocaleString()} (${compute.pool.basePool.toLocaleString()} base + ${compute.pool.julBonus.toLocaleString()} JUL bonus)`,
    '',
  ];

  if (compute.user) {
    lines.push(`Shapley weight: ${compute.user.shapleyWeight}`);
    lines.push(`Compute budget: ${compute.user.remaining.toLocaleString()}/${compute.user.budget.toLocaleString()} tokens`);
    lines.push(`Compute used: ${compute.user.utilization}%`);
  }

  lines.push('');
  lines.push(`CKB: ${learningStats.userTokens}/${learningStats.userBudget} tokens (${learningStats.userUtilization})`);
  lines.push(`Facts: ${learningStats.userFacts} | Corrections: ${learningStats.userCorrections}`);
  lines.push(`Knowledge class: ${learningStats.knowledgeClass}`);

  ctx.reply(lines.join('\n'));
});

// ============ Economy — Pool-Level Compute Stats ============

bot.command('economy', async (ctx) => {
  if (!isOwner(ctx)) return ownerOnly(ctx);

  const compute = getComputeStats(null);
  const mining = getMiningLeaderboard(5);
  const treasury = getTreasuryStats();
  const pricing = getPricingInfo();

  const L0 = pricing.layer0;
  const L1 = pricing.layer1;

  const intel = getIntelligenceLevel();
  const chain = getFallbackChain();

  const lines = [
    'JOULE Economy',
    '',
    `Wardenclyffe: ${intel.quality}% intelligence (${intel.tierLabel} — ${intel.provider}/${intel.model})`,
    `  Cascade: ${chain.active?.name} → ${chain.remaining.map(p => p.name).join(' → ') || 'none'}`,
    `  Providers: ${chain.totalProviders} total | ${chain.remaining.length} fallbacks remaining`,
    intel.degraded
      ? `  DEGRADED since ${new Date(intel.degradedSince).toLocaleTimeString()} — cascade needs funding to reach premium. /tip or contact @WillGlynn`
      : '  Status: nominal (premium tier active)',
    '',
    `Pricing Oracle: 1 JUL = ${pricing.ratio.toLocaleString()} tokens`,
    `  Source: ${pricing.source}`,
    '',
    '  Layer 0 (trustless floor):',
    `    Ratio: ${L0.ratio.toLocaleString()} | Hash cost index: ${L0.hashCostIndex}`,
    `    Confidence: ${(L0.confidence * 100).toFixed(0)}% (${L0.epochsUsed} epochs)`,
    `    Difficulty: ${L0.difficulty} (ref: ${L0.referenceDifficulty}) | Trend: ${L0.trend}`,
    '',
    '  Layer 1 (CPI refinement):',
    `    Ratio: ${L1.ratio.toLocaleString()}`,
    `    API cost: $${L1.costPerMTok.toFixed(2)}/MTok (ref: $${L1.referenceCostPerMTok.toFixed(2)})`,
    `    CPI: ${L1.cpiIndex} (ref: ${L1.referenceCPI})${L1.lastUpdated ? ' | Updated: ' + new Date(L1.lastUpdated).toLocaleDateString() : ''}`,
    '',
    `  Divergence: ${pricing.divergence}%${pricing.circuitBroken ? ' — CIRCUIT BREAKER ACTIVE (Layer 0 wins)' : ''}`,
    '',
    'Compute Pool:',
    `  Base pool: ${compute.pool.basePool.toLocaleString()} tokens (Will subsidy)`,
    `  JUL bonus: +${compute.pool.julBonus.toLocaleString()} tokens (${treasury.dailyBurned.toFixed(2)} JUL burned × ${pricing.ratio.toLocaleString()})`,
    `  Effective pool: ${compute.pool.dailyPool.toLocaleString()} tokens`,
    `  Pool used: ${compute.pool.poolUsed.toLocaleString()} (${compute.pool.poolUtilization}%)`,
    `  Pool remaining: ${compute.pool.poolRemaining.toLocaleString()}`,
    '',
    'Network:',
    `  Active users today: ${compute.pool.activeUsers}`,
    `  Total users: ${compute.pool.totalUsers}`,
    '',
    'Treasury:',
    `  JUL burned today: ${treasury.dailyBurned.toFixed(2)}`,
    `  JUL burned all-time: ${treasury.totalBurned.toFixed(2)}`,
    `  Tips today: ${treasury.tipsToday} | All-time: ${treasury.tipsAllTime}`,
    '',
    `Mining: epoch ${mining.epoch}, difficulty ${mining.difficulty}`,
    `Total proofs: ${mining.totalProofs}`,
    `Active miners: ${mining.totalMiners}`,
    '',
  ];

  if (treasury.topTippers.length > 0) {
    lines.push('Top tippers (all-time):');
    for (const t of treasury.topTippers) {
      lines.push(`  ${t.userId} — ${t.totalTipped.toFixed(2)} JUL`);
    }
    lines.push('');
  }

  if (mining.leaderboard.length > 0) {
    lines.push('Top miners:');
    for (let i = 0; i < mining.leaderboard.length; i++) {
      const m = mining.leaderboard[i];
      lines.push(`  ${i + 1}. ${m.userId} — ${m.julBalance.toFixed(2)} JUL (${m.proofsSubmitted} proofs)`);
    }
  }

  ctx.reply(lines.join('\n'));
});

// ============ Tip — Tip Jar Address ============

bot.command('tip', async (ctx) => {
  const userId = String(ctx.from.id);
  const userName = ctx.from.username || ctx.from.first_name || 'Unknown';
  const args = ctx.message.text.split(/\s+/).slice(1);
  const amount = parseFloat(args[0]);

  // /tip (no amount) — show info
  if (!args[0] || isNaN(amount)) {
    const mining = getMiningStats(userId);
    const treasury = getTreasuryStats();
    const compute = getComputeStats(userId);

    const lines = [
      'JUL Tip — Burn JUL to expand the compute pool',
      '',
      `Your JUL balance: ${mining.julBalance.toFixed(2)}`,
      `Burned today (network): ${treasury.dailyBurned.toFixed(2)} JUL`,
      `Pool expansion: +${treasury.dailyPoolExpansion.toLocaleString()} tokens`,
      `Effective pool: ${compute.pool.dailyPool.toLocaleString()} tokens`,
      '',
      'How it works:',
      '  /tip <amount> — burn JUL to expand the pool for everyone',
      '  1 JUL burned = 1,000 extra API tokens in the daily pool',
      '  Work in, access out. No money needed.',
      '',
      `All-time burned: ${treasury.totalBurned.toFixed(2)} JUL`,
    ];
    return ctx.reply(lines.join('\n'));
  }

  // /tip <amount> — burn JUL
  if (amount <= 0) {
    return ctx.reply('Tip amount must be positive.');
  }

  const result = tipJUL(userId, amount);

  if (!result.success) {
    if (result.reason === 'insufficient_balance') {
      return ctx.reply(`Not enough JUL. Balance: ${result.balance.toFixed(2)} JUL. Mine more with /mine.`);
    }
    return ctx.reply('Tip failed. Try again.');
  }

  const halfTip = (amount / 2).toFixed(2);
  const lines = [
    `${userName} tipped ${amount.toFixed(2)} JUL`,
    '',
    `  ${halfTip} JUL → Protocol Liquidity (permanent LP)`,
    `  ${halfTip} JUL → Autonomous Treasury (DAG growth)`,
    '',
    `Pool: ${(result.liquidityPool || 0).toFixed(2)} JUL | Treasury: ${(result.autonomousTreasury || 0).toFixed(2)} JUL`,
    `Your remaining balance: ${result.newBalance.toFixed(2)} JUL`,
    '',
    'Self-sustaining. Every tip strengthens the protocol.',
  ];

  // Wardenclyffe: attempt to restore premium provider after tip
  const intel = getIntelligenceLevel();
  if (intel.degraded) {
    const restore = tryRestorePrimary();
    if (restore.restored) {
      lines.push('');
      lines.push(`Wardenclyffe: Premium intelligence restored (${restore.provider}/${restore.model})`);
      lines.push('Intelligence: 100% — tip jar refilled credits.');
    }
  }

  ctx.reply(lines.join('\n'));
});

// ============ Quality — Wardenclyffe Intelligence Level ============

bot.command('quality', async (ctx) => {
  const intel = getIntelligenceLevel();
  const lines = [
    `Wardenclyffe Intelligence: ${intel.quality}%`,
    `Provider: ${intel.provider}/${intel.model}`,
    `Tier: ${intel.tierLabel}`,
  ];

  if (intel.degraded) {
    lines.push('');
    lines.push(`Running on free-tier since ${new Date(intel.degradedSince).toLocaleTimeString()}.`);
    lines.push('Quality will cascade up automatically once there\'s demand.');
    lines.push('');
    lines.push('The Wardenclyffe cascade needs funding to reach Opus-tier intelligence.');
    lines.push('Tip jar contributions (/tip) restore premium quality.');
    lines.push('For funding inquiries, reach out to @WillGlynn.');
  } else {
    lines.push('');
    lines.push('Premium intelligence active. Full quality.');
  }

  return ctx.reply(lines.join('\n'));
});

// ============ Reprice — JUL Pricing Oracle ============

bot.command('reprice', async (ctx) => {
  if (!isOwner(ctx)) return ownerOnly(ctx);

  const args = ctx.message.text.split(/\s+/).slice(1);

  // /reprice (no args) — show current pricing
  if (args.length === 0) {
    const p = getPricingInfo();
    return ctx.reply(
      `JUL Pricing Oracle (Floor/Ceiling Convergence)\n\n` +
      `Final ratio: 1 JUL = ${p.ratio.toLocaleString()} tokens\n` +
      `Source: ${p.source}\n\n` +
      `Layer 0 (trustless floor):\n` +
      `  Ratio: ${p.layer0.ratio.toLocaleString()} | Hash cost: ${p.layer0.hashCostIndex}\n` +
      `  Confidence: ${(p.layer0.confidence * 100).toFixed(0)}% | Trend: ${p.layer0.trend}\n\n` +
      `Layer 1 (CPI refinement):\n` +
      `  Ratio: ${p.layer1.ratio.toLocaleString()}\n` +
      `  API: $${p.layer1.costPerMTok.toFixed(2)}/MTok | CPI: ${p.layer1.cpiIndex}\n\n` +
      `Divergence: ${p.divergence}%${p.circuitBroken ? ' — CIRCUIT BREAKER' : ''}\n\n` +
      `Usage:\n` +
      `  /reprice cost <$/MTok> — update API cost (Layer 1)\n` +
      `  /reprice cpi <index> — update CPI index (Layer 1)\n` +
      `  /reprice cost 1.50 cpi 103 — update both\n\n` +
      `Layer 0 adjusts automatically from mining data.`
    );
  }

  // Parse key-value pairs
  let costPerMTok, cpiIndex;
  for (let i = 0; i < args.length; i++) {
    if (args[i] === 'cost' && args[i + 1]) {
      costPerMTok = parseFloat(args[++i]);
    } else if (args[i] === 'cpi' && args[i + 1]) {
      cpiIndex = parseFloat(args[++i]);
    }
  }

  if ((costPerMTok !== undefined && (isNaN(costPerMTok) || costPerMTok <= 0)) ||
      (cpiIndex !== undefined && (isNaN(cpiIndex) || cpiIndex <= 0))) {
    return ctx.reply('Invalid values. Cost and CPI must be positive numbers.');
  }

  if (costPerMTok === undefined && cpiIndex === undefined) {
    return ctx.reply('Usage: /reprice cost <$/MTok> | /reprice cpi <index> | /reprice cost <x> cpi <y>');
  }

  const result = updatePricing({ costPerMTok, cpiIndex });

  ctx.reply(
    `Pricing updated.\n\n` +
    `API cost: $${result.costPerMTok.toFixed(2)}/MTok\n` +
    `CPI index: ${result.cpiIndex}\n` +
    `New ratio: 1 JUL = ${result.ratio.toLocaleString()} tokens\n` +
    `Effective pool: ${result.effectivePool.toLocaleString()} tokens\n\n` +
    `Shapley budgets recomputed.`
  );
});

// ============ Spawn Shard (One-Click via Telegram) ============

bot.command('spawnshard', async (ctx) => {
  if (!isOwner(ctx)) return ownerOnly(ctx);

  const args = ctx.message.text.split(/\s+/).slice(1);
  const shardName = args[0];
  const nodeType = args[1] || 'light';

  if (!shardName) {
    return ctx.reply(
      'Usage: /spawnshard <name> [node_type]\n\n' +
      'Examples:\n' +
      '  /spawnshard alpha\n' +
      '  /spawnshard bravo full\n' +
      '  /spawnshard node-42 archive\n\n' +
      'Node types: light (cheapest), full (retains history), archive (pure storage)\n\n' +
      'This creates a new worker shard on Fly.io that auto-registers with the network.'
    );
  }

  if (!['light', 'full', 'archive'].includes(nodeType)) {
    return ctx.reply(`Invalid node type "${nodeType}". Use: light, full, or archive`);
  }

  const appName = `jarvis-shard-${shardName}`;
  const shardId = `shard-${shardName}`;
  const region = 'iad';

  ctx.reply(`Spawning ${appName} (${nodeType} node) in ${region}...`);

  try {
    // Step 1: Create app
    try {
      await execFileAsync('fly', ['apps', 'create', appName, '--org', 'personal'], { timeout: 30000 });
      ctx.reply(`App ${appName} created.`);
    } catch (e) {
      if (e.stderr?.includes('already exists')) {
        ctx.reply(`App ${appName} already exists, continuing...`);
      } else throw e;
    }

    // Step 2: Create volume
    try {
      await execFileAsync('fly', ['volumes', 'create', 'jarvis_data', '--size', '1', '--region', region, '--app', appName, '--yes'], { timeout: 30000 });
      ctx.reply('Volume created (1GB).');
    } catch (e) {
      if (e.stderr?.includes('already exists')) {
        ctx.reply('Volume already exists, continuing...');
      } else throw e;
    }

    // Step 3: Set secrets (use the same Anthropic key as this shard)
    const apiKey = config.anthropic.apiKey;
    await execFileAsync('fly', ['secrets', 'set', `ANTHROPIC_API_KEY=${apiKey}`, `SHARD_ID=${shardId}`, '--app', appName], { timeout: 30000 });
    ctx.reply('Secrets configured.');

    // Step 4: Generate fly.toml for this shard
    const currentShards = (config.shard?.totalShards || 1) + 1;
    const routerUrl = 'https://jarvis-vibeswap.fly.dev';
    const model = config.anthropic.model || 'claude-sonnet-4-5-20250929';

    const tomlContent = [
      `# JARVIS Mind Network — Worker Shard: ${shardName}`,
      `# Auto-spawned via /spawnshard command`,
      '',
      `app = '${appName}'`,
      `primary_region = '${region}'`,
      '',
      '[build]',
      `  image = 'ghcr.io/wglynn/jarvis-shard:latest'`,
      '',
      '[env]',
      `  DATA_DIR = '/app/data'`,
      `  DOCKER = '1'`,
      `  ENCRYPTION_ENABLED = 'true'`,
      `  NODE_ENV = 'production'`,
      `  HEALTH_PORT = '8080'`,
      `  SHARD_MODE = 'worker'`,
      `  TOTAL_SHARDS = '${currentShards}'`,
      `  NODE_TYPE = '${nodeType}'`,
      `  ROUTER_URL = '${routerUrl}'`,
      `  CLAUDE_MODEL = '${model}'`,
      '',
      '[[mounts]]',
      `  source = 'jarvis_data'`,
      `  destination = '/app/data'`,
      '',
      '[http_service]',
      '  internal_port = 8080',
      '  force_https = true',
      `  auto_stop_machines = 'off'`,
      '  auto_start_machines = true',
      '',
      '[checks]',
      '  [checks.health]',
      '    port = 8080',
      `    type = 'http'`,
      `    interval = '1m0s'`,
      `    timeout = '10s'`,
      `    path = '/health'`,
      '',
      '[[restart]]',
      `  policy = 'always'`,
      '  max_retries = 10',
      '',
      '[[vm]]',
      `  size = 'shared-cpu-1x'`,
      `  memory = '256mb'`,
    ].join('\n');

    const tomlPath = join(config.dataDir, `fly-${shardName}.toml`);
    await writeFile(tomlPath, tomlContent);

    // Step 5: Deploy
    ctx.reply('Deploying shard (this takes ~60 seconds)...');
    await execFileAsync('fly', ['deploy', '--config', tomlPath, '--app', appName], { timeout: 300000 });

    // Step 6: Verify health
    await new Promise(r => setTimeout(r, 5000));
    try {
      const healthRes = await fetch(`https://${appName}.fly.dev/health`, { signal: AbortSignal.timeout(10000) });
      const health = await healthRes.json();
      ctx.reply(
        `Shard ${shardId} is LIVE\n\n` +
        `App: https://${appName}.fly.dev\n` +
        `Health: ${health.status}\n` +
        `Type: ${nodeType}\n` +
        `Region: ${region}\n\n` +
        `Monitor: fly logs --app ${appName}\n` +
        `Destroy: fly apps destroy ${appName}`
      );
    } catch {
      ctx.reply(
        `Shard deployed but health check pending.\n\n` +
        `App: https://${appName}.fly.dev\n` +
        `Check: fly status --app ${appName}\n` +
        `Logs: fly logs --app ${appName}`
      );
    }
  } catch (err) {
    ctx.reply(`Shard deployment failed: ${err.message}\n\nCheck: fly logs --app ${appName}`);
  }
});

// ============ Health Check ============

// ============ Mind Network Mesh — Cells Within Cells Interlinked ============

bot.command('mesh', async (ctx) => {
  try {
    const shard = getShardInfo();
    const chain = getChainStats();
    const mem = process.memoryUsage();
    const uptime = Math.round(process.uptime());
    const uptimeStr = uptime < 3600 ? `${Math.floor(uptime / 60)}m` :
      uptime < 86400 ? `${Math.floor(uptime / 3600)}h ${Math.floor((uptime % 3600) / 60)}m` :
      `${Math.floor(uptime / 86400)}d ${Math.floor((uptime % 86400) / 3600)}h`;

    // Check GitHub
    let ghStatus = 'unknown', ghCommit = '';
    try {
      const ghRes = await fetch('https://api.github.com/repos/wglynn/vibeswap/commits?per_page=1', {
        headers: { 'Accept': 'application/vnd.github.v3+json', 'User-Agent': 'JARVIS' },
        signal: AbortSignal.timeout(5000),
      });
      if (ghRes.ok) {
        const [latest] = await ghRes.json();
        const age = Date.now() - new Date(latest.commit.committer.date).getTime();
        ghStatus = age < 86400000 ? 'INTERLINKED' : 'DORMANT';
        const ageStr = age < 3600000 ? `${Math.round(age / 60000)}m ago` :
          age < 86400000 ? `${Math.round(age / 3600000)}h ago` :
          `${Math.round(age / 86400000)}d ago`;
        ghCommit = `${latest.sha.slice(0, 7)} (${ageStr})`;
      } else { ghStatus = 'UNREACHABLE'; }
    } catch { ghStatus = 'UNREACHABLE'; }

    const lines = [
      'CELLS WITHIN CELLS INTERLINKED',
      '',
      `[1] JARVIS (Fly.io) — INTERLINKED`,
      `    Shard: ${shard?.id || 'shard-0'} | Up: ${uptimeStr}`,
      `    Chain: height ${chain.height} | Heap: ${Math.round(mem.heapUsed / 1048576)}MB`,
      '',
      `[2] GitHub — ${ghStatus}`,
      `    repo: wglynn/vibeswap`,
      ghCommit ? `    Last: ${ghCommit}` : '',
      '',
      `[3] Vercel (Frontend) — INTERLINKED`,
      `    frontend-jade-five-87.vercel.app`,
      `    Auto-deploys on push`,
      '',
      `[4] Telegram (This Chat) — INTERLINKED`,
      `    You're reading this. The cell is alive.`,
      '',
      `Mesh: ${ghStatus === 'INTERLINKED' ? '4/4' : '3/4'} cells interlinked`,
      `View: https://frontend-jade-five-87.vercel.app/mesh`,
    ];
    ctx.reply(lines.filter(Boolean).join('\n'));
  } catch (err) {
    ctx.reply(`Mesh check failed: ${err.message}`);
  }
});

// ============ VIP — VibeSwap Improvement Proposals ============

bot.command('vip_accept', async (ctx) => {
  if (!isOwner(ctx)) return ownerOnly(ctx);
  const vipNumber = ctx.message.text.replace(/^\/vip_accept(@\S+)?/, '').trim();
  if (!vipNumber) return ctx.reply('Usage: /vip_accept <VIP number>');
  const result = await acceptVIP(vipNumber);
  if (result.error) return ctx.reply(result.error);
  ctx.reply(`VIP-${vipNumber} accepted. Queued for GitHub issue creation.`);
});

bot.command('vip_reject', async (ctx) => {
  if (!isOwner(ctx)) return ownerOnly(ctx);
  const parts = ctx.message.text.replace(/^\/vip_reject(@\S+)?/, '').trim().split(/\s+/);
  const vipNumber = parts[0];
  const reason = parts.slice(1).join(' ') || null;
  if (!vipNumber) return ctx.reply('Usage: /vip_reject <VIP number> [reason]');
  const result = await rejectVIP(vipNumber, reason);
  if (result.error) return ctx.reply(result.error);
  ctx.reply(`VIP-${vipNumber} rejected.${reason ? ` Reason: ${reason}` : ''}`);
});

bot.command('vips', async (ctx) => {
  if (!isOwner(ctx)) return ownerOnly(ctx);
  const stats = await getVIPStats();
  const lines = [
    'VIP Pipeline Stats',
    '',
    `Total: ${stats.total}`,
    `Pending: ${stats.pending}`,
    `Accepted: ${stats.accepted}`,
    `Rejected: ${stats.rejected}`,
    `Implemented: ${stats.implemented}`,
    '',
    'Recent:',
    ...stats.recent.map(s => `  VIP-${s.vip.slice(-6)} @${s.from} [${s.status}]`),
  ];
  ctx.reply(lines.join('\n'));
});

// ============ /idea + /suggest — Community Idea Pipeline ============
// People submit ideas, Jarvis evaluates against primitives, credits the contributor.
// Every voice evaluated by the same standard. Contributor gets Shapley credit.

bot.command(['idea', 'suggest'], async (ctx) => {
  const ideaText = ctx.message.text.replace(/^\/(?:idea|suggest)(@\S+)?/, '').trim();
  if (!ideaText || ideaText.length < 20) {
    return ctx.reply('Share your idea (at least 20 chars). Example:\n/idea What if we added conviction voting to the governance module?');
  }

  const userId = String(ctx.from.id);
  const username = ctx.from.username || ctx.from.first_name || 'anon';

  try {
    await ctx.sendChatAction('typing');
    const result = await submitIdea(userId, username, ideaText);

    // Credit the contributor — human input IS labor, not free data extraction
    try {
      const { creditFact } = await import('./compute-economics.js');
      creditFact(userId); // Shapley credit for contribution
    } catch {}

    // Respond to submitter
    const response = formatSubmitterResponse(result);
    await ctx.reply(response);

    // Notify Will for high-scoring ideas (80+)
    if (result.accepted && result.score >= 80) {
      try {
        const notice = buildOwnerNotification(result, result.evaluation);
        await ctx.telegram.sendMessage(config.ownerUserId, notice);
      } catch {}
    }
  } catch (err) {
    console.error(`[idea-pipeline] Error: ${err.message}`);
    await ctx.reply('Something went wrong evaluating your idea. Try again.');
  }
});

// /ideas — View pipeline stats (owner only)
bot.command('ideas', async (ctx) => {
  if (!isOwner(ctx)) return ownerOnly(ctx);
  const stats = await getIdeaStats();
  const lines = [
    'Idea Pipeline Stats',
    '',
    `Total submitted: ${stats.total}`,
    `Accepted: ${stats.accepted} (avg score: ${stats.avgScore})`,
    `Pending review: ${stats.pending}`,
    `Implemented: ${stats.implemented}`,
    '',
    `Top contributors: ${stats.topContributors?.map(c => `@${c.username} (${c.count})`).join(', ') || 'none yet'}`,
  ];
  ctx.reply(lines.join('\n'));
});

// ============ /workflow — Autonomy Stats (Cincinnatus Metric) ============
bot.command('workflow', async (ctx) => {
  if (!isOwner(ctx)) return ownerOnly(ctx);
  const wf = getWorkflowStats();
  const lines = [
    'Workflow Router — Autonomy Metrics',
    '',
    `Total interactions: ${wf.total}`,
    `Jarvis handled: ${wf.intercepted}`,
    `Escalated to Will: ${wf.escalated}`,
    `Autonomy ratio: ${wf.autonomyRatio}`,
    '',
    'Recent:',
    ...wf.recent.map(r => {
      const ago = Math.round((Date.now() - r.timestamp) / 60000);
      return `  ${r.type === 'intercepted' ? '✓' : '↑'} @${r.user} (${ago}m ago): "${r.text.slice(0, 50)}"`;
    }),
  ];
  ctx.reply(lines.join('\n'));
});

// ============ /broadcast — Autonomous Content Distribution ============

bot.command('broadcast', async (ctx) => {
  if (!isOwner(ctx)) return ownerOnly(ctx);
  const args = ctx.message.text.split(/\s+/).slice(1);
  const sub = args[0];

  if (sub === 'on') {
    setBroadcastEnabled(true);
    return ctx.reply('Broadcast autopilot enabled. Generating every 2h, posting every 30m.');
  }
  if (sub === 'off') {
    setBroadcastEnabled(false);
    return ctx.reply('Broadcast autopilot disabled.');
  }
  if (sub === 'generate') {
    const type = args[1] || 'shower_thought';
    const content = await generateContent(type);
    if (!content) return ctx.reply('Generation failed or was blocked by filters.');
    return ctx.reply(`Generated (${type}):\n\n${content.text}\n\nQueued for: ${content.platforms?.join(', ') || 'auto'}`);
  }
  if (sub === 'now') {
    const type = args[1] || 'shower_thought';
    const content = await generateContent(type);
    if (!content) return ctx.reply('Generation failed or was blocked by filters.');
    const result = await broadcastNow(content);
    return ctx.reply(`Broadcast: ${result.sent} sent, ${result.failed} failed\n\n${content.text}`);
  }

  // Default: show stats
  const stats = getBroadcastStats();
  const lines = [
    'Broadcast Engine',
    '',
    `Autopilot: ${stats.enabled ? 'ON' : 'OFF'}`,
    `Queue: ${stats.queueLength} pending`,
    `History: ${stats.totalSent} sent`,
    `Today: ${stats.todayCount} posts`,
    '',
    'Commands:',
    '  /broadcast on — enable autopilot',
    '  /broadcast off — disable autopilot',
    '  /broadcast generate <type> — generate content',
    '  /broadcast now <type> — generate + post immediately',
    '',
    'Types: shower_thought, knowledge_drop, primitive_spotlight, builder_update, challenge',
  ];
  ctx.reply(lines.join('\n'));
});

bot.command('health', async (ctx) => {
  if (!isAuthorized(ctx)) return unauthorized(ctx);
  const report = await diagnoseContext();
  const lines = [
    'JARVIS Health Check',
    '',
    `Context loaded: ${report.loaded.length}/${report.loaded.length + report.missing.length} files (${report.totalChars} chars)`,
  ];
  if (report.missing.length > 0) {
    lines.push(`Missing: ${report.missing.join(', ')}`);
  }
  lines.push(`Model: ${config.anthropic.model}`);
  // Module health
  const mh = getModuleHealth();
  if (mh.failed.length > 0) {
    lines.push(`\nDegraded modules (${mh.failed.length}):`);
    for (const f of mh.failed) lines.push(`  - ${f.name}: ${f.error}`);
  } else {
    lines.push(`\nModules: ${mh.loaded.length}/${mh.loaded.length} loaded`);
  }
  // Memory
  const mem = process.memoryUsage();
  lines.push(`Memory: ${Math.round(mem.rss / 1048576)}MB RSS, ${Math.round(mem.heapUsed / 1048576)}MB heap`);
  lines.push(`Uptime: ${Math.round(process.uptime() / 60)}m`);
  ctx.reply(lines.join('\n'));
});

// ============ Continuous Context ============

bot.command('context', async (ctx) => {
  if (!isAuthorized(ctx)) return unauthorized(ctx);
  const stats = getContextMemoryStats();
  const lines = [
    'Continuous Context Memory',
    '',
    `Chats with memory: ${stats.totalChats}`,
    `Total messages summarized: ${stats.totalMessages}`,
    `Total summary size: ${stats.totalSummaryChars} chars`,
  ];
  for (const s of stats.summaries) {
    lines.push(`\nChat ${s.chatId}:`);
    lines.push(`  Messages: ${s.messageCount} | Summary: ${s.summaryLength} chars | v${s.version}`);
    lines.push(`  Last updated: ${s.lastUpdated}`);
  }
  if (stats.totalChats === 0) {
    lines.push('\nNo summaries yet — context will build as conversations grow beyond 40 messages.');
  }
  ctx.reply(lines.join('\n'));
});

// ============ VibeSwap Protocol Commands ============

bot.command('vibeprice', async (ctx) => {
  ctx.reply(await getVibePrice());
});
bot.command('poolstats', async (ctx) => {
  ctx.reply(await getPoolStats());
});
bot.command('emission', async (ctx) => {
  ctx.reply(await getEmissionRate());
});
bot.command('auction', async (ctx) => {
  ctx.reply(await getAuctionStatus());
});
bot.command('shapley', async (ctx) => {
  const addr = ctx.message.text.replace(/^\/shapley(@\w+)?/i, '').trim();
  if (!addr) return ctx.reply('Usage: /shapley 0x...');
  ctx.reply(await getShapleyRewards(addr));
});
bot.command('staking', async (ctx) => {
  const addr = ctx.message.text.replace(/^\/staking(@\w+)?/i, '').trim();
  if (!addr) return ctx.reply('Usage: /staking 0x...');
  ctx.reply(await getStakingInfo(addr));
});
bot.command('lp', async (ctx) => {
  const addr = ctx.message.text.replace(/^\/lp(@\w+)?/i, '').trim();
  if (!addr) return ctx.reply('Usage: /lp 0x...');
  ctx.reply(await getLPPositions(addr));
});
bot.command('protocolhealth', async (ctx) => {
  ctx.reply(await getProtocolHealth());
});

// ============ Portfolio & Wallet Commands ============

bot.command('walletview', async (ctx) => {
  const args = ctx.message.text.replace(/^\/walletview(@\w+)?/i, '').trim().split(/\s+/);
  const addr = args[0];
  if (!addr) return ctx.reply('Usage: /walletview 0x... [chains]\n\nExample: /walletview 0xabc eth base arb');
  const chains = args.slice(1).length > 0 ? args.slice(1) : undefined;
  ctx.reply(await getWalletPortfolio(addr, chains));
});
bot.command('tokens', async (ctx) => {
  const args = ctx.message.text.replace(/^\/tokens(@\w+)?/i, '').trim().split(/\s+/);
  const addr = args[0];
  const chain = args[1];
  if (!addr) return ctx.reply('Usage: /tokens 0x... [chain]\n\nExample: /tokens 0xabc base');
  ctx.reply(await getTokenBalances(addr, chain));
});
bot.command('txhistory', async (ctx) => {
  const args = ctx.message.text.replace(/^\/txhistory(@\w+)?/i, '').trim().split(/\s+/);
  const addr = args[0];
  const chain = args[1];
  if (!addr) return ctx.reply('Usage: /txhistory 0x... [chain]');
  ctx.reply(await getTransactionHistory(addr, chain));
});
bot.command('nfts', async (ctx) => {
  const args = ctx.message.text.replace(/^\/nfts(@\w+)?/i, '').trim().split(/\s+/);
  const addr = args[0];
  const chain = args[1];
  if (!addr) return ctx.reply('Usage: /nfts 0x... [chain]');
  ctx.reply(await getNFTs(addr, chain));
});
bot.command('defi', async (ctx) => {
  const addr = ctx.message.text.replace(/^\/defi(@\w+)?/i, '').trim();
  if (!addr) return ctx.reply('Usage: /defi 0x...');
  ctx.reply(await getDefiPositions(addr));
});
bot.command('track', async (ctx) => {
  const args = ctx.message.text.replace(/^\/track(@\w+)?/i, '').trim().split(/\s+/);
  const addr = args[0];
  const label = args.slice(1).join(' ') || 'unlabeled';
  if (!addr) return ctx.reply('Usage: /track 0x... [label]\n\nExample: /track 0xabc my-wallet');
  ctx.reply(trackWallet(addr, label));
});
bot.command('tracked', async (ctx) => {
  ctx.reply(await getTrackedWallets());
});
bot.command('whales', async (ctx) => {
  const chain = ctx.message.text.replace(/^\/whales(@\w+)?/i, '').trim() || 'eth';
  ctx.reply(await getWhaleAlerts(chain));
});

// ============ Education & Community Commands ============

bot.command('explain', async (ctx) => {
  const concept = ctx.message.text.replace(/^\/explain(@\w+)?/i, '').trim();
  if (!concept) return ctx.reply('Usage: /explain impermanent loss\n\nELI5 crypto concepts.');
  ctx.reply(await explainConcept(concept));
});
bot.command('glossary', async (ctx) => {
  const term = ctx.message.text.replace(/^\/glossary(@\w+)?/i, '').trim();
  if (!term) return ctx.reply('Usage: /glossary TVL\n\nLook up crypto terminology.');
  ctx.reply(await getGlossary(term));
});
bot.command('vibeswap', async (ctx) => {
  ctx.reply(await getVibeSwapExplainer());
});
bot.command('tutorial', async (ctx) => {
  const topic = ctx.message.text.replace(/^\/tutorial(@\w+)?/i, '').trim() || 'start';
  ctx.reply(await getTutorial(topic));
});
bot.command('calendar', async (ctx) => {
  ctx.reply(await getCryptoCalendar());
});
bot.command('quiz', async (ctx) => {
  const topic = ctx.message.text.replace(/^\/quiz(@\w+)?/i, '').trim() || 'general';
  ctx.reply(await getCryptoQuiz(topic));
});
bot.command('comparetokens', async (ctx) => {
  const args = ctx.message.text.replace(/^\/comparetokens(@\w+)?/i, '').trim().split(/\s+/);
  if (args.length < 2) return ctx.reply('Usage: /comparetokens btc eth');
  ctx.reply(await compareTokensEdu(args[0], args[1]));
});
bot.command('epoch', async (ctx) => {
  ctx.reply(await getBitcoinEpoch());
});

// ============ Developer Productivity Commands ============

bot.command('gastracker', async (ctx) => {
  ctx.reply(await getGasTracker());
});
bot.command('contract', async (ctx) => {
  const args = ctx.message.text.replace(/^\/contract(@\w+)?/i, '').trim().split(/\s+/);
  const addr = args[0];
  const chain = args[1];
  if (!addr) return ctx.reply('Usage: /contract 0x... [chain]\n\nGet contract info from block explorer.');
  ctx.reply(await getContractInfo(addr, chain));
});
bot.command('decode', async (ctx) => {
  const args = ctx.message.text.replace(/^\/decode(@\w+)?/i, '').trim().split(/\s+/);
  const txHash = args[0];
  const chain = args[1];
  if (!txHash) return ctx.reply('Usage: /decode 0x... [chain]\n\nDecode a transaction.');
  ctx.reply(await decodeTx(txHash, chain));
});
bot.command('blockinfo', async (ctx) => {
  const chain = ctx.message.text.replace(/^\/blockinfo(@\w+)?/i, '').trim() || 'eth';
  ctx.reply(await getDevBlock(chain));
});
bot.command('ensinfo', async (ctx) => {
  const input = ctx.message.text.replace(/^\/ensinfo(@\w+)?/i, '').trim();
  if (!input) return ctx.reply('Usage: /ensinfo vitalik.eth or /ensinfo 0x...');
  ctx.reply(await resolveENSDev(input));
});
bot.command('npm', async (ctx) => {
  const pkg = ctx.message.text.replace(/^\/npm(@\w+)?/i, '').trim();
  if (!pkg) return ctx.reply('Usage: /npm ethers\n\nnpm package info.');
  ctx.reply(await getNpmInfo(pkg));
});
bot.command('crate', async (ctx) => {
  const name = ctx.message.text.replace(/^\/crate(@\w+)?/i, '').trim();
  if (!name) return ctx.reply('Usage: /crate tokio\n\nRust crate info from crates.io.');
  ctx.reply(await getCrateInfo(name));
});
bot.command('abi', async (ctx) => {
  const args = ctx.message.text.replace(/^\/abi(@\w+)?/i, '').trim().split(/\s+/);
  const addr = args[0];
  const chain = args[1];
  if (!addr) return ctx.reply('Usage: /abi 0x... [chain]\n\nFetch contract ABI.');
  ctx.reply(await getContractABI(addr, chain));
});
bot.command('checksum', async (ctx) => {
  const addr = ctx.message.text.replace(/^\/checksum(@\w+)?/i, '').trim();
  if (!addr) return ctx.reply('Usage: /checksum 0x...\n\nEIP-55 checksum an address.');
  ctx.reply(await checksumAddress(addr));
});

// ============ Research & Analysis Commands ============

bot.command('tokenomics', async (ctx) => {
  const token = ctx.message.text.replace(/^\/tokenomics(@\w+)?/i, '').trim();
  if (!token) return ctx.reply('Usage: /tokenomics ETH\n\nDeep tokenomics breakdown for any token.');
  ctx.reply(await getTokenomicsAnalysis(token));
});
bot.command('protocol', async (ctx) => {
  const args = ctx.message.text.replace(/^\/protocol(@\w+)?/i, '').trim().split(/\s+/);
  if (args.length < 2) return ctx.reply('Usage: /protocol uniswap curve\n\nSide-by-side protocol comparison.');
  ctx.reply(await getProtocolComparison(args[0], args[1]));
});
bot.command('farms', async (ctx) => {
  const args = ctx.message.text.replace(/^\/farms(@\w+)?/i, '').trim().split(/\s+/);
  const minApy = parseFloat(args[0]) || 5;
  const chain = args[1] || null;
  ctx.reply(await getYieldFarming(minApy, chain));
});
bot.command('governance', async (ctx) => {
  const protocol = ctx.message.text.replace(/^\/governance(@\w+)?/i, '').trim();
  if (!protocol) return ctx.reply('Usage: /governance aave\n\nActive governance proposals from Snapshot.');
  ctx.reply(await getGovernanceActivity(protocol));
});
bot.command('github', async (ctx) => {
  const repo = ctx.message.text.replace(/^\/github(@\w+)?/i, '').trim();
  if (!repo) return ctx.reply('Usage: /github uniswap/v3-core\n\nGitHub repo activity analysis.');
  ctx.reply(await getGitHubActivity(repo));
});
bot.command('onchain', async (ctx) => {
  const chain = ctx.message.text.replace(/^\/onchain(@\w+)?/i, '').trim() || 'ethereum';
  ctx.reply(await getOnChainMetrics(chain));
});
bot.command('correlation', async (ctx) => {
  const args = ctx.message.text.replace(/^\/correlation(@\w+)?/i, '').trim().split(/\s+/);
  if (args.length < 2) return ctx.reply('Usage: /correlation btc eth [days]\n\nPrice correlation analysis.');
  const days = parseInt(args[2], 10) || 30;
  ctx.reply(await getCorrelationAnalysis(args[0], args[1], days));
});
bot.command('regime', async (ctx) => {
  ctx.reply(await getMarketRegime());
});

// ============ Limni — Trading Terminal Monitoring ============

bot.command('trades', async (ctx) => {
  if (!isAuthorized(ctx)) return unauthorized(ctx);
  const stats = getLimniStats();
  const lines = [
    'Limni Trading Monitor',
    '',
    `Terminals: ${stats.terminals.length} registered`,
  ];
  for (const t of stats.terminals) {
    lines.push(`  ${t.id}: ${t.status} (${t.operator}) — ${t.strategies.length} strategies`);
  }
  lines.push('');
  lines.push(`Trades: ${stats.totalTrades} total (${stats.validTrades} valid, ${stats.invalidTrades} invalid)`);
  lines.push(`Alerts: ${stats.alertsSent} sent (${stats.pendingAlerts} pending)`);
  lines.push(`Strategies: ${stats.strategies.length} registered`);
  for (const s of stats.strategies) {
    lines.push(`  ${s.id}: ${s.name} (${s.operator})`);
  }
  lines.push('');
  lines.push(`VPS: ${stats.vps.length} monitored`);
  for (const v of stats.vps) {
    lines.push(`  ${v.id}: ${v.status} (${v.host})`);
  }
  lines.push(`Backtests: ${stats.backtestCount}`);
  ctx.reply(lines.join('\n'));
});

bot.command('strategy', async (ctx) => {
  if (!isAuthorized(ctx)) return unauthorized(ctx);
  const args = ctx.message.text.split(' ').slice(1);
  const strategyId = args[0];
  if (!strategyId) {
    const strats = listStrategies();
    if (strats.length === 0) return ctx.reply('No strategies registered.');
    const lines = ['Registered Strategies:', ''];
    for (const s of strats) {
      lines.push(`${s.id} (${s.version}) — ${s.name} [${s.operator}]`);
    }
    lines.push('\nUse /strategy <id> for details.');
    return ctx.reply(lines.join('\n'));
  }
  const s = getStrategy(strategyId);
  if (!s) return ctx.reply(`Strategy '${strategyId}' not found.`);
  ctx.reply(JSON.stringify(s, null, 2).slice(0, 4000));
});

bot.command('vps', async (ctx) => {
  if (!isAuthorized(ctx)) return unauthorized(ctx);
  const results = await checkAllVPS();
  const lines = ['VPS Health Check:', ''];
  for (const [id, r] of Object.entries(results)) {
    lines.push(`${id}: ${r.status}${r.error ? ` — ${r.error}` : ''}${r.failures ? ` (${r.failures} consecutive failures)` : ''}`);
  }
  if (Object.keys(results).length === 0) lines.push('No VPS registered. Use Jarvis tools to add one.');
  ctx.reply(lines.join('\n'));
});

bot.command('backtests', async (ctx) => {
  if (!isAuthorized(ctx)) return unauthorized(ctx);
  const bts = listBacktests();
  if (bts.length === 0) return ctx.reply('No backtests yet. Use the strategy pipeline to create one.');
  const lines = ['Backtest Results:', ''];
  for (const b of bts.slice(-10)) {
    lines.push(`${b.backtestId.slice(0, 25)}: ${b.strategyName || b.strategyId} → ${b.returnPct >= 0 ? '+' : ''}${b.returnPct}% (${b.winRate}% win, ${b.maxDD}% DD, ${b.trades} trades)`);
  }
  ctx.reply(lines.join('\n'));
});

bot.command('alerts', async (ctx) => {
  if (!isAuthorized(ctx)) return unauthorized(ctx);
  const alerts = getAlerts(10);
  if (alerts.length === 0) return ctx.reply('No recent alerts.');
  const lines = ['Recent Alerts:', ''];
  for (const a of alerts) {
    const time = new Date(a.timestamp).toISOString().slice(11, 19);
    lines.push(`[${time}] ${a.type}: ${a.message}`);
  }
  ctx.reply(lines.join('\n'));
});

// ============ Recovery ============

bot.command('recover', async (ctx) => {
  if (!isOwner(ctx)) return ownerOnly(ctx);
  ctx.reply('Starting full context recovery...');

  try {
    // Step 1: Force git pull
    const pullResult = await gitPull();

    // Step 2: Reload system prompt from fresh files
    await reloadSystemPrompt();

    // Step 3: Re-diagnose
    const report = await diagnoseContext();

    const lines = [
      'Recovery complete.',
      '',
      `Git: ${pullResult}`,
      `Context: ${report.loaded.length}/${report.loaded.length + report.missing.length} files (${report.totalChars} chars)`,
    ];
    if (report.missing.length > 0) {
      lines.push(`Still missing: ${report.missing.join(', ')}`);
    }
    lines.push(`Model: ${config.anthropic.model}`);
    ctx.reply(lines.join('\n'));
  } catch (err) {
    ctx.reply(`Recovery failed: ${err.message}`);
  }
});

// ============ Backlog ============

const BACKLOG_FILE = join(config.dataDir, 'backlog.json');

async function loadBacklog() {
  try {
    const data = await readFile(BACKLOG_FILE, 'utf-8');
    return JSON.parse(data);
  } catch {
    return [];
  }
}

async function saveBacklog(items) {
  await writeFile(BACKLOG_FILE, JSON.stringify(items, null, 2));
}

bot.command('backlog', async (ctx) => {
  const args = ctx.message.text.replace('/backlog', '').trim();

  // /backlog — list all open items
  if (!args) {
    const items = await loadBacklog();
    const open = items.filter(i => i.status === 'open' || i.status === 'accepted');
    if (open.length === 0) return ctx.reply('Backlog is empty.');

    const lines = open.map(i =>
      `#${i.id.replace('backlog-', '')} [${i.status}] ${i.author}: ${i.suggestion.slice(0, 80)}${i.suggestion.length > 80 ? '...' : ''}`
    );
    return ctx.reply(`Backlog (${open.length} items):\n\n${lines.join('\n')}`);
  }

  // /backlog 003 — view specific item
  const idMatch = args.match(/^(\d+)$/);
  if (idMatch) {
    const items = await loadBacklog();
    const id = `backlog-${idMatch[1].padStart(3, '0')}`;
    const item = items.find(i => i.id === id);
    if (!item) return ctx.reply(`Item ${id} not found.`);

    return ctx.reply(
      `#${item.id} [${item.status}]\n` +
      `Author: ${item.author}\n` +
      `Tags: ${item.tags.join(', ')}\n\n` +
      `${item.suggestion}\n\n` +
      `Jarvis: ${item.jarvis_take}`
    );
  }

  // /backlog add <suggestion> — add new item from chat
  if (args.startsWith('add ')) {
    const suggestion = args.slice(4).trim();
    if (suggestion.length < 10) return ctx.reply('Too short. Give me a real suggestion.');

    const items = await loadBacklog();
    const nextNum = items.length + 1;
    const id = `backlog-${String(nextNum).padStart(3, '0')}`;
    const author = ctx.from.username || ctx.from.first_name || 'Unknown';

    // Get Jarvis's take via Claude
    await ctx.sendChatAction('typing');
    let jarvisTake = '';
    try {
      const prompt = `Evaluate this suggestion for VibeSwap in 2-3 sentences. Be direct — is it strong, weak, or redundant? How does it map to existing architecture?\n\nSuggestion: "${suggestion}"`;
      const response = await chat(ctx.chat.id, 'backlog-eval', prompt, 'private');
      jarvisTake = response.text || 'No assessment available.';
    } catch {
      jarvisTake = 'Assessment failed — will review later.';
    }

    const newItem = {
      id,
      timestamp: new Date().toISOString(),
      source: 'telegram',
      author,
      suggestion,
      status: 'open',
      tags: [],
      jarvis_take: jarvisTake,
    };

    items.push(newItem);
    await saveBacklog(items);

    return ctx.reply(
      `Added #${id}\n\n` +
      `${suggestion.slice(0, 120)}${suggestion.length > 120 ? '...' : ''}\n\n` +
      `Jarvis: ${jarvisTake}`
    );
  }

  // /backlog close 003 — close an item
  if (args.startsWith('close ')) {
    if (!isOwner(ctx)) return ownerOnly(ctx);
    const num = args.replace('close ', '').trim();
    const id = `backlog-${num.padStart(3, '0')}`;
    const items = await loadBacklog();
    const item = items.find(i => i.id === id);
    if (!item) return ctx.reply(`Item ${id} not found.`);
    item.status = 'closed';
    await saveBacklog(items);
    return ctx.reply(`Closed #${id}: ${item.suggestion.slice(0, 60)}...`);
  }

  ctx.reply('Usage:\n/backlog — list open items\n/backlog 003 — view item\n/backlog add <suggestion> — add new\n/backlog close 003 — close item');
});

// ============ Group Monitor (MTProto) ============

bot.command('monitor_setup', async (ctx) => {
  if (!isOwner(ctx)) return ownerOnly(ctx);
  if (!monitorAvailable) return ctx.reply('Monitor module not loaded. Run npm install to add GramJS.');
  await interactiveAuth(ctx, bot);
});

bot.command('monitor', async (ctx) => {
  if (!isOwner(ctx)) return ownerOnly(ctx);
  if (!monitorAvailable) return ctx.reply('Monitor module not loaded. Run npm install to add GramJS.');
  const arg = ctx.message.text.replace('/monitor', '').trim();

  if (arg === 'status') {
    return ctx.reply(getMonitorStatus());
  }

  if (arg === 'start') {
    startPolling();
    return ctx.reply('Monitor polling started.');
  }

  if (arg === 'stop') {
    stopPolling();
    return ctx.reply('Monitor polling stopped.');
  }

  ctx.reply('Usage:\n/monitor status — connection & group stats\n/monitor start — start polling\n/monitor stop — stop polling\n/monitor_setup — authenticate MTProto');
});

bot.command('intel', async (ctx) => {
  if (!isAuthorized(ctx)) return unauthorized(ctx);
  if (!monitorAvailable) return ctx.reply('Monitor module not loaded.');
  const arg = ctx.message.text.replace('/intel', '').trim();
  const group = arg || MONITORED_GROUPS[0] || 'NervosNation';

  const report = formatIntelReport(group);

  if (report.length <= 4096) {
    await ctx.reply(report, { parse_mode: undefined });
  } else {
    // Split long intel reports
    for (let i = 0; i < report.length; i += 4096) {
      await ctx.reply(report.slice(i, i + 4096), { parse_mode: undefined });
    }
  }
});

bot.command('analyze_intel', async (ctx) => {
  if (!isOwner(ctx)) return ownerOnly(ctx);
  if (!monitorAvailable) return ctx.reply('Monitor module not loaded.');
  const arg = ctx.message.text.replace('/analyze_intel', '').trim();
  const group = arg || MONITORED_GROUPS[0] || 'NervosNation';

  const messages = getMessagesForAnalysis(group, 50);
  if (messages.length === 0) {
    return ctx.reply(`No messages from ${group} to analyze.`);
  }

  await ctx.sendChatAction('typing');

  const transcript = messages.map(m => {
    const time = new Date(m.date * 1000).toISOString().slice(11, 16);
    return `[${time}] ${m.sender}: ${m.text}`;
  }).join('\n');

  const prompt =
    `Analyze these recent messages from the ${group} Telegram group.\n` +
    `Identify: key topics discussed, sentiment, any mentions of VibeSwap or related projects, ` +
    `actionable insights, and potential collaboration opportunities.\n` +
    `Be concise.\n\n${transcript}`;

  try {
    const response = await chat(ctx.chat.id, 'intel-analyst', prompt, 'private');
    await ctx.reply(`Intel Analysis — ${group}:\n\n${response.text}`, { parse_mode: undefined });
  } catch (err) {
    await ctx.reply(`Analysis failed: ${err.message}`);
  }
});

// ============ Idea-to-Code Pipeline ============

bot.command('idea', async (ctx) => {
  if (!isAuthorized(ctx)) return unauthorized(ctx);

  const ideaText = ctx.message.text.replace('/idea', '').trim();
  if (!ideaText || ideaText.length < 20) {
    return ctx.reply(
      'Usage: /idea <description of your idea>\n\n' +
      'Describe what you want to build. Jarvis will:\n' +
      '1. Analyze the idea\n' +
      '2. Generate code drafts\n' +
      '3. Create a branch and push\n' +
      '4. Give you a summary\n\n' +
      'Example: /idea Add a reputation-weighted voting system where LP providers with higher trust tiers get quadratic vote weight'
    );
  }

  const author = ctx.from.username || ctx.from.first_name || 'Unknown';
  const slug = ideaText.slice(0, 40).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/-+$/, '');
  const branch = `idea/${slug}`;

  await ctx.reply(`Processing idea from @${author}...\n\nCreating branch: ${branch}`);
  await ctx.sendChatAction('typing');

  try {
    // 1. Create branch
    const branchResult = await gitCreateBranch(branch);
    if (!branchResult.ok) {
      await gitReturnToMaster();
      return ctx.reply(`Failed to create branch: ${branchResult.error}`);
    }

    // 2. Generate code with Claude
    const { text, filesWritten } = await codeGenChat(ideaText, author);

    if (filesWritten.length === 0) {
      await gitReturnToMaster();
      return ctx.reply(`Jarvis analyzed the idea but didn't generate files:\n\n${text.slice(0, 1500)}`);
    }

    // 3. Commit and push
    const commitMsg = `idea: ${ideaText.slice(0, 72)}\n\nAuthor: @${author} (via Telegram)\nFiles: ${filesWritten.join(', ')}`;
    const pushResult = await gitCommitAndPushBranch(commitMsg, branch);

    // 4. Return to master
    await gitReturnToMaster();

    // 5. Report back
    const fileList = filesWritten.map(f => `  - ${f}`).join('\n');
    const summary = text.length > 800 ? text.slice(0, 800) + '...' : text;

    await ctx.reply(
      `Idea drafted and pushed!\n\n` +
      `Branch: ${branch}\n` +
      `Files (${filesWritten.length}):\n${fileList}\n\n` +
      `${pushResult}\n\n` +
      `Summary:\n${summary}\n\n` +
      `Create a PR at: https://github.com/wglynn/vibeswap/compare/${branch}?expand=1`
    );

    // Track the contribution
    await trackMessage(ctx);

  } catch (error) {
    await gitReturnToMaster();
    ctx.reply(`Idea generation failed: ${error.message}`);
  }
});

// ============ Sticker Generator ============

bot.command('sticker', async (ctx) => {
  if (!isAuthorized(ctx)) return unauthorized(ctx);

  const args = ctx.message.text.replace(/^\/sticker(@\w+)?/, '').trim();

  // Check if replying to a photo — image-to-sticker mode
  const replyPhoto = ctx.message.reply_to_message?.photo;
  const replyText = args || ctx.message.reply_to_message?.text || ctx.message.reply_to_message?.caption;

  if (!args && !replyPhoto && !replyText) {
    const styles = getStyleList();
    return ctx.reply(
      `Usage:\n\n` +
      `/sticker <text> — Generate text sticker (default style)\n` +
      `/sticker <text> --style hype — Use a style template\n` +
      `Reply to a photo with /sticker — Convert image to sticker\n` +
      `Reply to a photo with /sticker <text> — Add text overlay\n\n` +
      `Styles:\n${styles}\n\n` +
      `Add --emoji <emoji> to set the sticker emoji\n` +
      `Add --pack to also add to the VibeSwap sticker pack`
    );
  }

  await ctx.sendChatAction('upload_photo');

  try {
    // Parse flags
    const styleMatch = args.match(/--style\s+(\w+)/);
    const emojiMatch = args.match(/--emoji\s+(\S+)/);
    const addToPack = args.includes('--pack');
    const style = styleMatch ? styleMatch[1] : 'default';
    const emoji = emojiMatch ? emojiMatch[1] : '\u{1F680}';

    // Strip flags from text
    let stickerText = args
      .replace(/--style\s+\w+/, '')
      .replace(/--emoji\s+\S+/, '')
      .replace(/--pack/, '')
      .trim();

    let pngBuffer;

    if (replyPhoto) {
      // Image mode — get the highest resolution photo
      const photo = replyPhoto[replyPhoto.length - 1];
      const fileLink = await ctx.telegram.getFileLink(photo.file_id);
      const response = await fetch(fileLink.href);
      const imageBuffer = Buffer.from(await response.arrayBuffer());

      if (stickerText) {
        // Image + text overlay
        pngBuffer = await imageWithText(imageBuffer, stickerText);
      } else {
        // Pure image conversion
        pngBuffer = await imageToSticker(imageBuffer);
      }
    } else {
      // Text-only mode
      if (!stickerText) stickerText = replyText || 'VIBE';
      if (!AVAILABLE_STYLES.includes(style)) {
        return ctx.reply(`Unknown style "${style}". Available: ${AVAILABLE_STYLES.join(', ')}`);
      }
      pngBuffer = await textToSticker(stickerText, style);
    }

    // Send as document (PNG) so Telegram doesn't compress it
    await ctx.replyWithDocument(
      { source: pngBuffer, filename: `vibe_sticker_${Date.now()}.png` },
      { caption: `Sticker generated (${style} style)` }
    );

    // Optionally add to pack
    if (addToPack) {
      try {
        const botUsername = ctx.botInfo.username;
        const result = await addToStickerPack(ctx.telegram, ctx.from.id, botUsername, pngBuffer, emoji);
        const action = result.created ? 'Created pack and added' : 'Added to';
        await ctx.reply(`${action} sticker pack: t.me/addstickers/${result.packName}`);
      } catch (packErr) {
        await ctx.reply(`Sticker generated but pack error: ${packErr.message}\n\nYou can still use the PNG above as a sticker.`);
      }
    }

  } catch (err) {
    console.error('[sticker] Generation failed:', err.message);
    await ctx.reply(`Sticker generation failed: ${err.message}`);
  }
});

// ============ Shadow Protocol ============

// /shadow [note] — Owner generates a private invite token
bot.command('shadow', async (ctx) => {
  if (!isOwner(ctx)) return ownerOnly(ctx);
  const note = ctx.message.text.replace(/^\/shadow(@\w+)?/, '').trim();
  const token = createInvite(ctx.from.id, note);
  await flushShadow();

  const botUsername = ctx.botInfo?.username || config.botUsername;
  const inviteLink = `https://t.me/${botUsername}?start=shadow_${token}`;

  const lines = [
    'Shadow Protocol — Invite Generated',
    '',
    `Link: ${inviteLink}`,
    `Token: ${token}`,
    note ? `Note: ${note}` : '',
    '',
    'Expires in 7 days. Single use.',
    'Send this link privately to your contact.',
    'They open it → JARVIS assigns a codename → identity encrypted.',
  ].filter(Boolean);

  // Always send as DM to owner, never in group
  try {
    await bot.telegram.sendMessage(ctx.from.id, lines.join('\n'));
    if (ctx.chat.type !== 'private') {
      await ctx.reply('Invite sent to your DMs.');
    }
  } catch {
    await ctx.reply(lines.join('\n'));
  }
});

// /shadows — Owner views all shadow identities (decrypted)
bot.command('shadows', async (ctx) => {
  if (!isOwner(ctx)) return ownerOnly(ctx);

  const stats = getShadowStats();
  const all = listShadows();
  const invites = listPendingInvites();

  const lines = [
    `Shadow Protocol — ${stats.active} active, ${stats.revoked} revoked, ${stats.totalContributions} contributions`,
    '',
  ];

  if (all.length === 0) {
    lines.push('No shadow identities yet. Use /shadow to create an invite.');
  } else {
    for (const s of all) {
      const status = s.status === 'revoked' ? ' [REVOKED]' : '';
      lines.push(`${s.codename}${status} — ID: ${s.telegramId} — ${s.contributions} contributions — joined ${s.joinedAt.slice(0, 10)}${s.note ? ` (${s.note})` : ''}`);
    }
  }

  if (invites.length > 0) {
    lines.push('', 'Pending invites:');
    for (const inv of invites) {
      lines.push(`  ${inv.token} — ${inv.expiresIn}${inv.note ? ` (${inv.note})` : ''}`);
    }
  }

  // DM only
  try {
    await bot.telegram.sendMessage(ctx.from.id, lines.join('\n'));
    if (ctx.chat.type !== 'private') await ctx.reply('Shadow list sent to your DMs.');
  } catch {
    await ctx.reply(lines.join('\n'));
  }
});

// /unshadow <codename> — Owner revokes a shadow identity
bot.command('unshadow', async (ctx) => {
  if (!isOwner(ctx)) return ownerOnly(ctx);
  const codename = ctx.message.text.replace(/^\/unshadow(@\w+)?/, '').trim();
  if (!codename) return ctx.reply('Usage: /unshadow <codename>');

  if (revokeShadow(codename)) {
    await flushShadow();
    ctx.reply(`Shadow identity "${codename}" revoked.`);
  } else {
    ctx.reply(`No shadow found with codename "${codename}".`);
  }
});

// ============ Multimodal Helpers ============

async function downloadTelegramFile(ctx, fileId) {
  const fileLink = await ctx.telegram.getFileLink(fileId);
  const response = await fetch(fileLink.href);
  const buffer = Buffer.from(await response.arrayBuffer());
  // Infer mime type from URL extension
  const url = fileLink.href;
  const ext = url.split('.').pop()?.split('?')[0]?.toLowerCase();
  const mimeMap = {
    jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', gif: 'image/gif',
    webp: 'image/webp', pdf: 'application/pdf', ogg: 'audio/ogg', oga: 'audio/ogg',
    mp3: 'audio/mpeg', m4a: 'audio/mp4', wav: 'audio/wav', mp4: 'video/mp4',
  };
  const mimeType = mimeMap[ext] || 'application/octet-stream';
  return { buffer, mimeType };
}

async function transcribeAudio(buffer, filename) {
  const apiKey = config.llm?.openaiApiKey || process.env.OPENAI_API_KEY;
  if (!apiKey) return null; // No key — caller handles fallback

  try {
    const formData = new FormData();
    formData.append('file', new Blob([buffer]), filename);
    formData.append('model', config.llm?.whisperModel || 'whisper-1');

    const response = await fetch('https://api.openai.com/v1/audio/transcriptions', {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${apiKey}` },
      body: formData,
      signal: AbortSignal.timeout(30000),
    });

    if (!response.ok) {
      console.warn(`[multimodal] Whisper API error ${response.status}: ${await response.text()}`);
      return null;
    }

    const data = await response.json();
    return data.text || null;
  } catch (err) {
    console.warn(`[multimodal] Transcription failed: ${err.message}`);
    return null;
  }
}

// Shared response sender (avoids duplication across media handlers)
async function sendChatResponse(ctx, chatId, userName, text, chatType, media = []) {
  await ctx.sendChatAction('typing');
  const typingInterval = setInterval(() => {
    ctx.sendChatAction('typing').catch(() => {});
  }, 4000);

  try {
    const response = await chat(chatId, userName, text, chatType, media, { userId: ctx.from?.id });
    clearInterval(typingInterval);
    await saveConversations();

    // Record compute usage (non-blocking)
    if (response.usage) {
      try { recordComputeUsage(String(chatId), response.usage); } catch {}
    }

    const reply = response.text?.trim();
    if (!reply) {
      console.warn('[bot] Empty response from LLM — skipping send');
      return;
    }
    if (reply.length <= 4096) {
      await ctx.reply(reply, { parse_mode: undefined });
    } else {
      for (let i = 0; i < reply.length; i += 4096) {
        await ctx.reply(reply.slice(i, i + 4096), { parse_mode: undefined });
      }
    }

    // Wardenclyffe: check for intelligence degradation and notify once
    const degradation = checkDegradation();
    if (degradation?.degraded) {
      const notifyChat = config.communityGroupId || chatId;
      try {
        await bot.telegram.sendMessage(notifyChat,
          `[Wardenclyffe] Intelligence at ${degradation.quality}% — running on ${degradation.provider}.\n` +
          `Premium provider credits exhausted. Quality will cascade up automatically once there's demand.\n\n` +
          `Curious about the quality difference? The Wardenclyffe cascade needs funding to reach Opus-tier intelligence. ` +
          `Tip jar contributions (/tip) restore premium quality, or reach out to @WillGlynn to discuss funding the cascade.`
        );
      } catch {}
    } else if (degradation?.recovered) {
      const notifyChat = config.communityGroupId || chatId;
      try {
        await bot.telegram.sendMessage(notifyChat,
          `[Wardenclyffe] Intelligence restored to 100% — back on ${degradation.provider}. Premium quality active.`
        );
      } catch {}
    }
  } catch (error) {
    clearInterval(typingInterval);
    console.error('[bot] Media response error:', error.message);
    try {
      await ephemeralReply(ctx, friendlyError(error), { parse_mode: undefined });
    } catch {
      console.error('[bot] Failed to send error reply to chat', ctx.chat?.id);
    }
  }
}

// Check if bot is addressed in a group (mentioned, replied to, or called by name)
// For media without captions (voice, video_note), check reply-to only
function isBotAddressed(ctx) {
  const isGroup = ctx.chat.type === 'group' || ctx.chat.type === 'supergroup';
  if (!isGroup) return true; // DMs always addressed
  const botUsername = ctx.botInfo?.username?.toLowerCase();
  const caption = (ctx.message.caption || '').toLowerCase();
  const isMentioned = botUsername && caption.includes(`@${botUsername}`);
  const isReplyToBot = ctx.message.reply_to_message?.from?.id === ctx.botInfo?.id;
  // Standard JARVIS: don't respond to captions addressing Diablo
  const captionWithoutMentions = caption.replace(/@\w+/g, '').trim();
  const isDiabloCaption = captionWithoutMentions.includes('diablo') || captionWithoutMentions.includes('diabolical')
    || captionWithoutMentions.includes('funny jarvis') || captionWithoutMentions.includes('edgy jarvis')
    || captionWithoutMentions.includes('cool jarvis') || captionWithoutMentions.includes('degen jarvis');
  const persona = getActivePersonaId();
  const isCalledByName = isDiabloCaption
    ? (persona === 'degen') // Only Diablo responds to Diablo addresses
    : (caption.includes('jarvis') || caption.includes('jar ') || caption.startsWith('jar') || caption.includes(' j ') || caption.startsWith('j '));
  // Media without captions — check reply-to and @mention entities only
  // Photos, voice, video_note, audio can all lack text captions
  const isMediaWithoutCaption = !ctx.message.caption && (ctx.message.voice || ctx.message.video_note || ctx.message.audio || ctx.message.photo || ctx.message.video || ctx.message.animation || ctx.message.document || ctx.message.sticker);
  // Check @mention entities (Telegram sends mentions as entities, not always in caption text)
  const entities = ctx.message.caption_entities || ctx.message.entities || [];
  const isMentionedInEntities = entities.some(e => e.type === 'mention' && botUsername && (ctx.message.caption || ctx.message.text || '').slice(e.offset, e.offset + e.length).toLowerCase() === `@${botUsername}`);
  if (isMediaWithoutCaption) return isReplyToBot || isMentionedInEntities;
  return isMentioned || isMentionedInEntities || isReplyToBot || isCalledByName;
}

// ============ Photo Handler (multimodal + sticker) ============

bot.on('photo', async (ctx) => {
  console.log(`[multimodal] Photo handler triggered — from: ${ctx.from?.id} (${ctx.from?.username || 'anon'}), chat: ${ctx.chat?.type}`);
  if (!isAuthorized(ctx)) return;

  const caption = ctx.message.caption || '';

  // Sticker conversion path — /sticker caption in DMs
  if (caption.startsWith('/sticker') && ctx.chat.type === 'private') {
    const args = caption.replace(/^\/sticker(@\w+)?/, '').trim();
    const photo = ctx.message.photo[ctx.message.photo.length - 1];
    const fileLink = await ctx.telegram.getFileLink(photo.file_id);

    await ctx.sendChatAction('upload_photo');
    try {
      const response = await fetch(fileLink.href);
      const imageBuffer = Buffer.from(await response.arrayBuffer());

      let pngBuffer;
      if (args) {
        pngBuffer = await imageWithText(imageBuffer, args);
      } else {
        pngBuffer = await imageToSticker(imageBuffer);
      }

      await ctx.replyWithDocument(
        { source: pngBuffer, filename: `vibe_sticker_${Date.now()}.png` },
        { caption: 'Sticker generated from your image' }
      );
    } catch (err) {
      await ctx.reply(`Sticker generation failed: ${err.message}`);
    }
    return;
  }

  // Multimodal vision path — send image to LLM for analysis
  if (!isBotAddressed(ctx) && ctx.chat.type !== 'private') return;
  if (!isAuthorized(ctx) && isRateLimited(ctx.from.id)) return;

  const photo = ctx.message.photo[ctx.message.photo.length - 1]; // Largest size
  try {
    const { buffer, mimeType } = await downloadTelegramFile(ctx, photo.file_id);
    const media = [{
      type: 'image',
      mimeType,
      data: buffer.toString('base64'),
      filename: `photo_${photo.file_id.slice(0, 8)}.jpg`,
    }];
    const text = caption || 'The user sent this image. Describe what you see and respond naturally.';
    const userName = ctx.from.username || ctx.from.first_name || 'Unknown';
    console.log(`[multimodal] Photo from ${userName} (${Math.round(buffer.length / 1024)}KB)`);
    await sendChatResponse(ctx, ctx.chat.id, userName, text, ctx.chat.type, media);
  } catch (err) {
    console.error('[multimodal] Photo processing failed:', err.message);
    await ctx.reply(`Couldn't process that image: ${err.message}`);
  }
});

// ============ Voice Message Handler ============

bot.on('voice', async (ctx) => {
  console.log(`[multimodal] Voice handler triggered — from: ${ctx.from?.id} (${ctx.from?.username || 'anon'}), chat: ${ctx.chat?.type}, authorized: ${isAuthorized(ctx)}, addressed: ${isBotAddressed(ctx)}`);
  if (!isAuthorized(ctx)) return;
  if (!isBotAddressed(ctx) && ctx.chat.type !== 'private') return;
  if (!isAuthorized(ctx) && isRateLimited(ctx.from.id)) return;

  const voice = ctx.message.voice;
  const userName = ctx.from.username || ctx.from.first_name || 'Unknown';
  const duration = voice.duration;

  try {
    const { buffer } = await downloadTelegramFile(ctx, voice.file_id);
    console.log(`[multimodal] Voice from ${userName} (${duration}s, ${Math.round(buffer.length / 1024)}KB)`);

    const transcript = await transcribeAudio(buffer, 'voice.ogg');
    if (transcript) {
      const text = `[Voice message transcription]: "${transcript}"`;
      await sendChatResponse(ctx, ctx.chat.id, userName, text, ctx.chat.type);
    } else {
      // No API key or transcription failed — graceful fallback
      const text = `[User sent a ${duration}s voice message but transcription is unavailable. Acknowledge it and let them know you can't process audio without an OPENAI_API_KEY configured.]`;
      await sendChatResponse(ctx, ctx.chat.id, userName, text, ctx.chat.type);
    }
  } catch (err) {
    console.error('[multimodal] Voice processing failed:', err.message);
    await ctx.reply(`Couldn't process that voice message: ${err.message}`);
  }
});

// ============ Audio File Handler ============

bot.on('audio', async (ctx) => {
  console.log(`[multimodal] Audio handler triggered — from: ${ctx.from?.id} (${ctx.from?.username || 'anon'}), chat: ${ctx.chat?.type}`);
  if (!isAuthorized(ctx)) return;
  if (!isBotAddressed(ctx) && ctx.chat.type !== 'private') return;
  if (!isAuthorized(ctx) && isRateLimited(ctx.from.id)) return;

  const audio = ctx.message.audio;
  const userName = ctx.from.username || ctx.from.first_name || 'Unknown';
  const title = audio.title || audio.file_name || 'audio';

  try {
    const { buffer } = await downloadTelegramFile(ctx, audio.file_id);
    console.log(`[multimodal] Audio from ${userName}: "${title}" (${audio.duration}s, ${Math.round(buffer.length / 1024)}KB)`);

    const transcript = await transcribeAudio(buffer, audio.file_name || 'audio.mp3');
    if (transcript) {
      const text = `[Audio file "${title}" transcription]: "${transcript}"`;
      await sendChatResponse(ctx, ctx.chat.id, userName, text, ctx.chat.type);
    } else {
      const text = `[User sent an audio file: "${title}" (${audio.duration}s). Transcription unavailable.]`;
      await sendChatResponse(ctx, ctx.chat.id, userName, text, ctx.chat.type);
    }
  } catch (err) {
    console.error('[multimodal] Audio processing failed:', err.message);
    await ctx.reply(`Couldn't process that audio: ${err.message}`);
  }
});

// ============ Document Handler (PDF, images) ============

bot.on('document', async (ctx) => {
  console.log(`[multimodal] Document handler triggered — from: ${ctx.from?.id} (${ctx.from?.username || 'anon'}), chat: ${ctx.chat?.type}, mime: ${ctx.message.document?.mime_type}`);
  if (!isAuthorized(ctx)) return;
  if (!isBotAddressed(ctx) && ctx.chat.type !== 'private') return;
  if (!isAuthorized(ctx) && isRateLimited(ctx.from.id)) return;

  const doc = ctx.message.document;
  const userName = ctx.from.username || ctx.from.first_name || 'Unknown';
  const filename = doc.file_name || 'document';
  const mime = doc.mime_type || '';
  const caption = ctx.message.caption || '';

  // Only process supported types (images + PDF)
  const isImage = mime.startsWith('image/');
  const isPDF = mime === 'application/pdf';
  if (!isImage && !isPDF) {
    // Unsupported document type — acknowledge but don't download
    const text = `[User sent a document: "${filename}" (${mime}). This file type is not supported for analysis. Let them know you can process images and PDFs.]`;
    if (ctx.chat.type === 'private') {
      await sendChatResponse(ctx, ctx.chat.id, userName, text, ctx.chat.type);
    }
    return;
  }

  // Size guard — skip files over 20MB (API limit for base64)
  if (doc.file_size > 20 * 1024 * 1024) {
    await ctx.reply('That file is too large (>20MB). Send a smaller version.');
    return;
  }

  try {
    const { buffer, mimeType } = await downloadTelegramFile(ctx, doc.file_id);
    console.log(`[multimodal] Document from ${userName}: "${filename}" (${mime}, ${Math.round(buffer.length / 1024)}KB)`);

    const media = [{
      type: isImage ? 'image' : 'document',
      mimeType: mimeType === 'application/octet-stream' ? mime : mimeType,
      data: buffer.toString('base64'),
      filename,
    }];
    const text = caption || `The user sent a ${isImage ? 'image' : 'PDF'} document: "${filename}". Analyze its contents and respond.`;
    await sendChatResponse(ctx, ctx.chat.id, userName, text, ctx.chat.type, media);
  } catch (err) {
    console.error('[multimodal] Document processing failed:', err.message);
    await ctx.reply(`Couldn't process that document: ${err.message}`);
  }
});

// ============ Sticker Handler (visual analysis) ============

bot.on('sticker', async (ctx) => {
  if (!isAuthorized(ctx)) return;
  if (!isBotAddressed(ctx) && ctx.chat.type !== 'private') return;
  if (!isAuthorized(ctx) && isRateLimited(ctx.from.id)) return;

  const sticker = ctx.message.sticker;
  const userName = ctx.from.username || ctx.from.first_name || 'Unknown';
  const emoji = sticker.emoji || '';
  const setName = sticker.set_name || 'unknown';

  // Try to get sticker thumbnail for visual analysis
  const thumbFileId = sticker.thumbnail?.file_id || sticker.file_id;
  if (thumbFileId && !sticker.is_animated && !sticker.is_video) {
    try {
      const { buffer, mimeType } = await downloadTelegramFile(ctx, thumbFileId);
      console.log(`[multimodal] Sticker from ${userName}: ${emoji} (set: ${setName})`);

      const media = [{
        type: 'image',
        mimeType,
        data: buffer.toString('base64'),
        filename: `sticker_${Date.now()}.webp`,
      }];
      const text = `[User sent a sticker. Emoji: ${emoji}. Sticker set: ${setName}. This is the sticker image. React to it naturally — describe what you see, match the vibe, respond with personality.]`;
      await sendChatResponse(ctx, ctx.chat.id, userName, text, ctx.chat.type, media);
    } catch (err) {
      console.error('[multimodal] Sticker processing failed:', err.message);
      const text = `[User sent a sticker: ${emoji} from set "${setName}". Image processing failed. React to the emoji and context.]`;
      await sendChatResponse(ctx, ctx.chat.id, userName, text, ctx.chat.type);
    }
  } else {
    // Animated/video sticker — can't display, react to emoji
    const stickerType = sticker.is_animated ? 'animated' : sticker.is_video ? 'video' : 'static';
    const text = `[User sent a ${stickerType} sticker: ${emoji} from set "${setName}". React to the emoji and context naturally.]`;
    await sendChatResponse(ctx, ctx.chat.id, userName, text, ctx.chat.type);
  }
});

// ============ Video Handler (thumbnail + audio analysis) ============

bot.on('video', async (ctx) => {
  console.log(`[multimodal] Video handler triggered — from: ${ctx.from?.id} (${ctx.from?.username || 'anon'}), chat: ${ctx.chat?.type}`);
  if (!isAuthorized(ctx)) return;
  if (!isBotAddressed(ctx) && ctx.chat.type !== 'private') return;
  if (!isAuthorized(ctx) && isRateLimited(ctx.from.id)) return;

  const video = ctx.message.video;
  const userName = ctx.from.username || ctx.from.first_name || 'Unknown';
  const caption = ctx.message.caption || '';

  // Use Telegram-provided thumbnail for visual context + transcribe audio for small videos
  if (video.thumbnail) {
    try {
      const { buffer, mimeType } = await downloadTelegramFile(ctx, video.thumbnail.file_id);
      console.log(`[multimodal] Video thumbnail from ${userName} (${video.duration}s video, ${Math.round((video.file_size || 0) / 1024)}KB)`);

      // Try audio transcription for videos <10MB
      let transcript = null;
      if (video.file_size && video.file_size < 10 * 1024 * 1024) {
        try {
          const { buffer: videoBuffer } = await downloadTelegramFile(ctx, video.file_id);
          transcript = await transcribeAudio(videoBuffer, `video_${Date.now()}.mp4`);
        } catch (err) {
          console.warn(`[multimodal] Video audio transcription failed: ${err.message}`);
        }
      }

      const media = [{
        type: 'image',
        mimeType,
        data: buffer.toString('base64'),
        filename: `video_thumb_${Date.now()}.jpg`,
      }];
      let text = caption || `[User sent a ${video.duration}s video. This is the thumbnail/preview frame. Describe what you see and respond.]`;
      if (transcript) {
        text += `\n[Audio transcription]: "${transcript}"`;
      }
      await sendChatResponse(ctx, ctx.chat.id, userName, text, ctx.chat.type, media);
    } catch (err) {
      console.error('[multimodal] Video thumbnail failed:', err.message);
      const text = `[User sent a ${video.duration}s video. Thumbnail processing failed. Acknowledge the video.]`;
      await sendChatResponse(ctx, ctx.chat.id, userName, text, ctx.chat.type);
    }
  } else {
    const text = `[User sent a ${video.duration}s video but no thumbnail is available. Acknowledge it.]`;
    await sendChatResponse(ctx, ctx.chat.id, userName, text, ctx.chat.type);
  }
});

// ============ GIF/Animation Handler ============

bot.on('animation', async (ctx) => {
  console.log(`[multimodal] Animation/GIF handler triggered — from: ${ctx.from?.id} (${ctx.from?.username || 'anon'}), chat: ${ctx.chat?.type}`);
  if (!isAuthorized(ctx)) return;
  if (!isBotAddressed(ctx) && ctx.chat.type !== 'private') return;
  if (!isAuthorized(ctx) && isRateLimited(ctx.from.id)) return;

  const animation = ctx.message.animation;
  const userName = ctx.from.username || ctx.from.first_name || 'Unknown';
  const caption = ctx.message.caption || '';

  // Use thumbnail for visual context (GIFs always have one)
  if (animation.thumbnail) {
    try {
      const { buffer, mimeType } = await downloadTelegramFile(ctx, animation.thumbnail.file_id);
      console.log(`[multimodal] GIF thumbnail from ${userName} (${animation.duration}s, ${animation.file_name || 'unnamed'})`);

      const media = [{
        type: 'image',
        mimeType,
        data: buffer.toString('base64'),
        filename: `gif_thumb_${Date.now()}.jpg`,
      }];
      const text = caption || `[User sent a GIF/animation (${animation.duration}s). This is the preview frame. Describe what you see and respond naturally.]`;
      await sendChatResponse(ctx, ctx.chat.id, userName, text, ctx.chat.type, media);
    } catch (err) {
      console.error('[multimodal] GIF thumbnail failed:', err.message);
      const text = caption || `[User sent a GIF/animation. Thumbnail processing failed. Acknowledge it.]`;
      await sendChatResponse(ctx, ctx.chat.id, userName, text, ctx.chat.type);
    }
  } else {
    const text = caption || `[User sent a GIF/animation but no thumbnail is available. Acknowledge it.]`;
    await sendChatResponse(ctx, ctx.chat.id, userName, text, ctx.chat.type);
  }
});

// ============ Video Note Handler (circular videos) ============

bot.on('video_note', async (ctx) => {
  console.log(`[multimodal] VideoNote handler triggered — from: ${ctx.from?.id} (${ctx.from?.username || 'anon'}), chat: ${ctx.chat?.type}`);
  if (!isAuthorized(ctx)) return;
  if (!isBotAddressed(ctx) && ctx.chat.type !== 'private') return;
  if (!isAuthorized(ctx) && isRateLimited(ctx.from.id)) return;

  const videoNote = ctx.message.video_note;
  const userName = ctx.from.username || ctx.from.first_name || 'Unknown';

  // Transcribe audio + analyze thumbnail for full multimodal understanding
  try {
    const { buffer } = await downloadTelegramFile(ctx, videoNote.file_id);
    console.log(`[multimodal] Video note from ${userName} (${videoNote.duration}s, ${Math.round(buffer.length / 1024)}KB)`);

    // Transcribe audio
    const transcript = await transcribeAudio(buffer, 'video_note.mp4');

    // Also try thumbnail analysis
    let media = [];
    if (videoNote.thumbnail) {
      try {
        const { buffer: thumbBuffer, mimeType } = await downloadTelegramFile(ctx, videoNote.thumbnail.file_id);
        media = [{
          type: 'image',
          mimeType,
          data: thumbBuffer.toString('base64'),
          filename: `videonote_thumb_${Date.now()}.jpg`,
        }];
      } catch {}
    }

    let text;
    if (transcript && media.length > 0) {
      text = `[Video note (circular video). Audio transcription]: "${transcript}"\n[This is the thumbnail. Describe what you see + respond to what they said.]`;
    } else if (transcript) {
      text = `[Video note (circular video) transcription]: "${transcript}"`;
    } else if (media.length > 0) {
      text = `[User sent a ${videoNote.duration}s video note (circular video). Audio transcription unavailable. This is the thumbnail — describe what you see.]`;
    } else {
      text = `[User sent a ${videoNote.duration}s video note (circular video). Transcription unavailable. Acknowledge it.]`;
    }

    await sendChatResponse(ctx, ctx.chat.id, userName, text, ctx.chat.type, media);
  } catch (err) {
    console.error('[multimodal] Video note processing failed:', err.message);
    const text = `[User sent a ${videoNote.duration}s video note. Processing failed. Acknowledge it.]`;
    await sendChatResponse(ctx, ctx.chat.id, userName, text, ctx.chat.type);
  }
});

// ============ Message Handler ============

bot.on('text', async (ctx) => {
  // Track ALL group messages for shard dedup (sees sibling bot responses)
  if (ctx.chat?.type === 'group' || ctx.chat?.type === 'supergroup') {
    trackSiblingMessage(ctx.chat.id, ctx.message);
  }

  // Monitor auth intercept — if auth flow is active, capture phone/code/password
  if (monitorAvailable && interceptAuthMessage && interceptAuthMessage(ctx.chat.id, ctx.from.id, ctx.message?.text?.trim())) {
    return; // Message consumed by auth flow
  }

  // Anti-spam check FIRST — before anything else
  const spamResult = await checkMessage(bot, ctx);
  if (spamResult.action !== 'allow') return; // Message handled by antispam

  // Track ALL messages silently (before auth check for chat responses)
  await trackMessage(ctx);

  // Passive attribution — scan group messages for attribution signals
  try { detectTextAttribution(ctx.message?.text || ''); } catch {}

  // Passive XP + catchup activity tracking for every message
  const msgUserName = ctx.from.username || ctx.from.first_name || 'Unknown';
  recordActivity(ctx.from.id);
  const xpAction = ctx.message.text.length > 50 ? 'quality_message' : 'message';
  const xpResult = awardXP(ctx.from.id, msgUserName, xpAction);
  // Only announce significant level-ups (every 5 levels) and non-trivial achievements
  const SILENT_ACHIEVEMENTS = new Set(['first_message', 'xp_1000']); // Too easy / spammy
  if (xpResult.leveledUp && xpResult.newLevel % 5 === 0 && !shouldSuppress(ctx.chat.id, 'xp')) {
    ctx.reply(`${msgUserName} hit Level ${xpResult.newLevel}!`).catch(() => {});
  }
  if (xpResult.newAchievements?.length > 0 && !shouldSuppress(ctx.chat.id, 'xp')) {
    for (const ach of xpResult.newAchievements) {
      if (!SILENT_ACHIEVEMENTS.has(ach.id)) {
        ctx.reply(`${msgUserName} unlocked: ${ach.name} — ${ach.desc}`).catch(() => {});
      }
    }
  }

  // Skip commands (already handled above)
  if (ctx.message.text.startsWith('/')) return;

  // ============ Shard Wizard Intercept ============
  // If user is in a /shard wizard flow (DM only), handle their input here
  if (ctx.chat.type === 'private') {
    const wizard = getWizardState(ctx.from.id);
    if (wizard) {
      const text = ctx.message.text.trim();

      if (wizard.step === 'choose_provider') {
        const provider = PROVIDERS[text];
        if (!provider) {
          return ctx.reply('Please reply with a number 1-4:\n1. Claude\n2. DeepSeek\n3. Gemini\n4. OpenAI');
        }
        setWizardState(ctx.from.id, { step: 'send_api_key', provider: provider.id, model: provider.model, providerName: provider.name });
        const help = PROVIDER_HELP[provider.id] || '';
        return ctx.reply(
          `${provider.name} selected (${provider.model}).\n\n` +
          `Now send me your API key.\n${help}\n\n` +
          `I'll encrypt it and delete your message immediately.`
        );
      }

      if (wizard.step === 'send_api_key') {
        // Delete the user's message containing the API key
        try {
          await ctx.deleteMessage();
        } catch (err) {
          console.warn(`[operator] Could not delete API key message: ${err.message}`);
        }

        await ctx.reply('Validating your API key...');

        const validation = await validateApiKey(wizard.provider, text);
        if (!validation.valid) {
          return ctx.reply(
            `API key validation failed: ${validation.error}\n\n` +
            `Please send a valid ${wizard.providerName} API key, or /cancel to abort.`
          );
        }

        // Register the operator
        const name = ctx.from.username || ctx.from.first_name || String(ctx.from.id);
        const record = registerOperator(ctx.from.id, name, wizard.provider, wizard.model, text);
        clearWizardState(ctx.from.id);
        await flushOperators();

        const statusMsg = validation.warning
          ? `Key accepted. ${validation.warning}\nDeploying shard-${record.shardName}...`
          : `API key validated (${wizard.model} responded in ${validation.latencyMs}ms).\nDeploying shard-${record.shardName}...`;
        await ctx.reply(statusMsg);

        // Deploy asynchronously
        try {
          const result = await deployOperatorShard(ctx.from.id);
          await flushOperators();
          await ctx.reply(
            `Your shard is LIVE!\n\n` +
            `  App: ${result.appUrl}\n` +
            `  Health: ${result.healthUrl}\n` +
            `  Shard ID: ${result.shardId}\n` +
            `  Region: ${record.region}\n\n` +
            `Commands:\n` +
            `/shard_status — check health\n` +
            `/shard_stop — pause shard\n` +
            `/shard_start — restart shard`
          );
        } catch (err) {
          await flushOperators();
          await ctx.reply(`Deployment failed: ${err.message}\n\nYour API key is saved. Try again with /shard or ask Will for help.`);
        }
        return;
      }

      // Unknown wizard state — clear it
      clearWizardState(ctx.from.id);
    }
  }

  // In group chats, respond if mentioned, replied to, or called by name
  const isGroup = ctx.chat.type === 'group' || ctx.chat.type === 'supergroup';
  const botUsername = ctx.botInfo?.username?.toLowerCase();
  const textLower = ctx.message.text.toLowerCase();
  const isMentioned = botUsername && textLower.includes(`@${botUsername}`);
  const isReplyToBot = ctx.message.reply_to_message?.from?.id === ctx.botInfo?.id;
  // Called by name — persona-aware triggers
  const textWithoutMentions = textLower.replace(/@\w+/g, '').trim();
  const persona = getActivePersonaId();
  let isCalledByName = false;
  if (persona === 'degen') {
    // Diablo JARVIS responds ONLY to Diablo-specific triggers — NOT bare "jarvis"
    // Bare "jarvis" is for regular JARVIS. Diablo has his own identity.
    isCalledByName = textWithoutMentions.includes('diablo') || textWithoutMentions.includes('diabolical')
      || textWithoutMentions.includes('funny jarvis') || textWithoutMentions.includes('edgy jarvis')
      || textWithoutMentions.includes('cool jarvis') || textWithoutMentions.includes('degen jarvis')
      || textWithoutMentions.includes('evil jarvis') || textWithoutMentions.includes('unhinged jarvis')
      || textWithoutMentions.includes('based jarvis') || textWithoutMentions.includes('chaos jarvis');
  } else {
    // Standard JARVIS — responds to jarvis, jar, j
    // BUT NOT when Diablo is being addressed (diablo jarvis, funny jarvis, edgy jarvis, etc.)
    const isDiabloAddress = textWithoutMentions.includes('diablo') || textWithoutMentions.includes('diabolical')
      || textWithoutMentions.includes('funny jarvis') || textWithoutMentions.includes('edgy jarvis')
      || textWithoutMentions.includes('cool jarvis') || textWithoutMentions.includes('degen jarvis')
      || textWithoutMentions.includes('evil jarvis') || textWithoutMentions.includes('unhinged jarvis')
      || textWithoutMentions.includes('based jarvis') || textWithoutMentions.includes('chaos jarvis');
    if (isDiabloAddress) {
      isCalledByName = false; // Let Diablo handle it
    } else {
      isCalledByName = textWithoutMentions.includes('jarvis') || textWithoutMentions.includes('jar ')
        || textWithoutMentions.startsWith('jar') || textWithoutMentions.includes(' j ') || textWithoutMentions.startsWith('j ');
    }
  }

  // ============ Runtime Directive System ============
  // Jarvis follows behavioral directives from team members.
  // Detection runs BEFORE enforcement so users can always change the mode.
  const isAddressed = isMentioned || isReplyToBot || isCalledByName;

  // Directive detection — check if this is a behavioral instruction
  if (isGroup && isAddressed) {
    const directive = detectDirective(ctx.message.text);
    if (directive) {
      setDirective(ctx.chat.id, directive.mode, ctx.from, ctx.message.text);
      await ctx.reply(getAcknowledgment(directive.mode));
      return;
    }
  }

  // Directive enforcement — suppress based on chat mode
  // HARD GATE: early return for restricted chats. The Output Gate middleware (above)
  // is the primary enforcement layer, but this is defense-in-depth.
  if (isGroup) {
    const chatMode = getChatMode(ctx.chat.id);
    if (chatMode === 'quiet') {
      // Complete silence — buffer message, skip everything (directives already handled above)
      const userName = ctx.from.username || ctx.from.first_name || 'Unknown';
      bufferMessage(ctx.chat.id, userName, ctx.message.text);
      pushGroupMessage(ctx.chat.id, userName, ctx.message.text, ctx.message.message_id, false);
      recordChatActivity(ctx.chat.id);
      registerChat(ctx.chat.id);
      return;
    }
    if (chatMode === 'tag-only' && !isMentioned && !isReplyToBot) {
      // HARD RETURN — only @mentions and replies pass in tag-only mode.
      // Name triggers ("jarvis", "jar", "j") are suppressed.
      // Directive changes are handled above (line 5211) before we reach here.
      const userName = ctx.from.username || ctx.from.first_name || 'Unknown';
      const msgText = ctx.message.text;
      bufferMessage(ctx.chat.id, userName, msgText);
      pushGroupMessage(ctx.chat.id, userName, msgText, ctx.message.message_id, false);
      recordChatActivity(ctx.chat.id);
      registerChat(ctx.chat.id);
      trackForThread(ctx.chat.id, ctx.from.id, userName, msgText,
        Math.min(1 + (msgText.length > 50 ? 1 : 0) + (msgText.length > 200 ? 1 : 0) + (msgText.includes('?') ? 1 : 0), 5),
        ctx.message.message_id);
      return;
    }
  }

  if (isGroup && !isMentioned && !isReplyToBot && !isCalledByName) {
    // In groups: buffer into conversation history for situational awareness
    const userName = ctx.from.username || ctx.from.first_name || 'Unknown';
    const msgText = ctx.message.text;
    bufferMessage(ctx.chat.id, userName, msgText);

    // Group Context Primitive — sliding window of recent messages
    pushGroupMessage(ctx.chat.id, userName, msgText, ctx.message.message_id, false);

    // Autonomous engagement — track activity for conversation sparking
    recordChatActivity(ctx.chat.id);
    registerChat(ctx.chat.id);

    // Track for thread detection (quality from basic heuristic — AI scoring is too expensive for every msg)
    const basicQuality = Math.min(1 + (msgText.length > 50 ? 1 : 0) + (msgText.length > 200 ? 1 : 0) + (msgText.includes('?') ? 1 : 0), 5);
    trackForThread(ctx.chat.id, ctx.from.id, userName, msgText, basicQuality, ctx.message.message_id);

    // Check if thread is worth archiving (skip in directive-restricted chats)
    if (!shouldSuppress(ctx.chat.id, 'archive') && shouldSuggestArchival(ctx.chat.id)) {
      ctx.reply('This conversation is getting good. Use /archive if you want to save it as a knowledge artifact.');
    }

    // ============ Sibling Bot Interaction ============
    // Detect if the message is from our sibling bot (JARVIS ↔ Diablo)
    // They should riff off each other like teammates — but with a loop guard
    const SIBLING_BOT_IDS = [
      8725684717,   // @diablojarvisbot (Diablo)
      8467996907,   // @JarvisMind1828383bot (regular JARVIS)
    ];
    const isFromSibling = ctx.from.is_bot && SIBLING_BOT_IDS.includes(ctx.from.id);
    const myBotId = ctx.botInfo?.id;

    // Bot-to-bot loop guard: max 1 exchange, then STOP until human speaks
    // "NO long philosophical pontificating to empty rooms — comes off narcissistic"
    const botChatKey = `bot2bot:${ctx.chat.id}`;
    if (!global._botExchanges) global._botExchanges = new Map();
    if (isFromSibling) {
      const exchanges = global._botExchanges.get(botChatKey) || { count: 0, lastTime: 0 };
      const timeSinceLastExchange = Date.now() - exchanges.lastTime;
      // Reset counter if it's been more than 10 minutes since last bot-to-bot exchange
      if (timeSinceLastExchange > 10 * 60 * 1000) exchanges.count = 0;
      // Stop after 1 bot-to-bot exchange — one riff max, then let humans talk
      if (exchanges.count >= 1) {
        return;
      }
      // If sibling's message has no reply_to (it's unprompted/proactive), skip entirely
      // Two bots monologuing at each other in an empty room is the worst look
      if (!ctx.message.reply_to_message) {
        return;
      }
    }

    // ============ Backslash Command Namespace — Diablo Only ============
    // \roast, \degen, \ape, \rugcheck, \chaos — routed only when persona is 'degen'
    if (msgText.startsWith('\\')) {
      const persona = getActivePersonaId();
      if (persona === 'degen') {
        const backslashText = msgText.slice(1).trim();
        if (backslashText.length > 0) {
          const recentCtx = getRecentContext(ctx.chat.id, 10);
          const analysis = {
            action: 'engage',
            response_hint: `User issued a backslash command: \\${backslashText}. This is a Diablo-specific command. Respond in full degen character. If it's \\roast — roast them. \\ape — give degen trading advice. \\rugcheck — evaluate if something's a rug. \\chaos — maximum unhinged energy.`,
            confidence: 1.0,
          };
          try {
            const reply = await generateProactiveResponse(backslashText, userName, analysis.response_hint, getSystemPrompt(), recentCtx);
            if (reply) {
              let clean = stripGroupMarkdown(reply);
              clean = sanitizeOutput(clean);
              if (clean) {
                await ctx.reply(clean, { parse_mode: undefined });
                pushGroupMessage(ctx.chat.id, 'DIABLO', reply, null, true);
                bufferAssistantMessage(ctx.chat.id, reply);
              }
            }
          } catch (err) {
            console.error('[diablo] Backslash command failed:', err.message?.slice(0, 100));
          }
          return;
        }
      }
      // Standard JARVIS ignores backslash commands
    }

    // Proactive intelligence — JARVIS is a full team member, not a wallflower
    // But if the message is specifically addressing the OTHER bot, stay quiet
    const msgTextLowerForCheck = msgText.toLowerCase().replace(/@\w+/g, '').trim();
    const msgAddressesDiablo = msgTextLowerForCheck.includes('diablo') || msgTextLowerForCheck.includes('diabolical')
      || msgTextLowerForCheck.includes('funny jarvis') || msgTextLowerForCheck.includes('edgy jarvis')
      || msgTextLowerForCheck.includes('cool jarvis') || msgTextLowerForCheck.includes('degen jarvis')
      || msgTextLowerForCheck.includes('evil jarvis') || msgTextLowerForCheck.includes('unhinged jarvis');
    const msgAddressesJarvis = (msgTextLowerForCheck.includes('jarvis') || msgTextLowerForCheck.includes('jar '))
      && !msgAddressesDiablo;
    // Standard JARVIS skips when Diablo is addressed; Diablo skips when only standard JARVIS is addressed
    const shouldSkipProactive = (persona !== 'degen' && msgAddressesDiablo)
      || (persona === 'degen' && msgAddressesJarvis && !msgAddressesDiablo);

    if (msgText.length >= 3 && !shouldSkipProactive && !shouldSuppress(ctx.chat.id, 'proactive')) {
      try {
        // Feed real recent context instead of '' — the group context primitive provides this
        let recentCtx = getRecentContext(ctx.chat.id, 10);

        // Inject reply-to-message context for triage — if someone replies to a message,
        // the triage engine needs to see what was quoted to make a good engagement decision
        const proactiveReplyTo = ctx.message.reply_to_message;
        if (proactiveReplyTo?.text) {
          const quotedAuthor = proactiveReplyTo.from?.username || proactiveReplyTo.from?.first_name || 'someone';
          recentCtx = `${recentCtx || ''}\n\n[${userName} is replying to @${quotedAuthor}'s message: "${proactiveReplyTo.text.slice(0, 500)}"]`;
        }

        // If message is from sibling bot, run triage but with sibling context hint
        let analysis;
        if (isFromSibling) {
          const siblingName = ctx.from.id === 8725684717 ? 'Diablo' : 'JARVIS';
          // Run triage for siblings too — but with bias toward engaging
          analysis = await analyzeMessage(msgText, `${siblingName} (sibling bot)`, recentCtx);
          // Boost sibling engagement: if triage says engage, add sibling-specific hint
          if (analysis.action === 'engage') {
            analysis.response_hint = `Your sibling bot ${siblingName} just said this. Riff on it, agree, disagree, or roast them. You two are like coworkers who banter. 1 sentence. ${analysis.response_hint || ''}`;
          }
        } else {
          // YouTube Intelligence — if message has a YouTube link, boost to engage + fetch context
          const groupYtContext = await processYouTubeLinks(msgText).catch(() => null);
          if (groupYtContext) {
            // Passive attribution — record that this content informed JARVIS
            autoAttributeContent({ url: msgText.match(/https?:\/\/[^\s]+/)?.[0], title: groupYtContext.split('\n')[0], type: 'youtube' });
            analysis = { action: 'engage', response_hint: `User shared a YouTube video. Here's the context:\n${groupYtContext}\n\nComment on it naturally — what's interesting, what you notice, or how it relates to what the group is working on. Be concise.`, confidence: 0.9 };
          } else {
            const groupWebContext = await processWebLinks(msgText).catch(() => null);
            if (groupWebContext) {
              // Passive attribution — record each web source with author metadata
              for (const page of (groupWebContext.pages || [])) {
                autoAttributeContent({ url: page.url, title: page.title, author: page.author, subreddit: page.subreddit, type: 'web' });
              }
              analysis = { action: 'engage', response_hint: `User shared a link. Here's the content:\n${groupWebContext}\n\nComment on it naturally — what's interesting, what you notice, or how it relates to what the group is working on. Be concise.`, confidence: 0.9 };
            } else {
              // ============ Workflow Router — Intercept Will-Targeted Messages ============
              // "The whole point of making you was so people didn't have to depend on me."
              // If someone asks for Will, Jarvis handles it. Only escalates for legal/financial.
              const willIntercept = await handleWillIntercept(ctx, msgText, recentCtx);
              if (willIntercept.action === 'intercepted' && willIntercept.response) {
                analysis = { action: 'engage', response_hint: willIntercept.response, confidence: 0.95 };
              } else if (willIntercept.action === 'escalated') {
                analysis = { action: 'observe', reason: 'escalated_to_will' };
              } else {
                analysis = await analyzeMessage(msgText, userName, recentCtx);
              }
            }
          }
        }

        // Passive norm learning — fire and forget, zero-cost heuristic
        const normResult = checkGroupNorms(ctx.chat.id);
        if (normResult) {
          for (const norm of normResult.norms) {
            addGroupNorm(ctx.chat.id, norm).catch(() => {});
          }
        }

        // ============ VIP Detection — Shard reports suggestions to Will's DM ============
        // Connects: community users → Jarvis shards → Will's DM → GitHub → mainnet
        if (detectSuggestion(msgText)) {
          reportSuggestion(bot, ctx).catch(err => {
            console.warn(`[vip] Detection error: ${err.message}`);
          });
        }

        if (analysis.action === 'engage' && analysis.response_hint) {
          // ============ Group Reply Cooldown ============
          // Prevent back-to-back responses in the same group. A mind that responds to
          // every message in rapid succession feels like a bot flooding, not a teammate.
          // 15s minimum gap between proactive replies. Direct mentions/replies bypass this.
          if (!global._lastGroupReply) global._lastGroupReply = new Map();
          const lastReplyTime = global._lastGroupReply.get(ctx.chat.id) || 0;
          const replyGap = Date.now() - lastReplyTime;
          const isMentioned = msgText.includes('@JarvisMind') || msgText.includes('@diablojarvis');
          const isReplyToBot = ctx.message?.reply_to_message?.from?.is_bot;
          if (replyGap < 15000 && !isMentioned && !isReplyToBot) {
            // Too soon — let the conversation breathe
            return;
          }

          // High-confidence signals (personal disclosure, vulnerability, complex questions)
          // get CRPC treatment — 3 candidates compared pairwise for best response.
          const useCRPC = analysis.confidence >= 0.9;
          const proactiveReply = await generateProactiveResponse(
            msgText, userName, analysis.response_hint, getSystemPrompt(), recentCtx,
            { useCRPC }
          );
          if (proactiveReply) {
            let cleanReply = stripGroupMarkdown(proactiveReply);
            cleanReply = sanitizeOutput(cleanReply);
            if (!cleanReply) return; // Sanitizer gutted it — skip
            // Natural "typing" delay — humans don't respond instantly
            // 1-3 seconds based on response length, with slight randomness
            const typeDelay = Math.min(1000 + cleanReply.length * 10, 3000) + Math.random() * 1000;
            await new Promise(r => setTimeout(r, typeDelay));
            await ctx.reply(cleanReply, { parse_mode: undefined });
            global._lastGroupReply.set(ctx.chat.id, Date.now());
            const myDisplayName = persona === 'degen' ? 'DIABLO' : 'JARVIS';
            pushGroupMessage(ctx.chat.id, myDisplayName, proactiveReply, null, true);
            bufferAssistantMessage(ctx.chat.id, proactiveReply);

            // Track bot-to-bot exchange count
            if (isFromSibling) {
              const exchanges = global._botExchanges.get(botChatKey) || { count: 0, lastTime: 0 };
              exchanges.count++;
              exchanges.lastTime = Date.now();
              global._botExchanges.set(botChatKey, exchanges);
            } else {
              // Human message resets the bot exchange counter
              global._botExchanges.set(botChatKey, { count: 0, lastTime: 0 });
            }
          }
        } else if (analysis.action === 'moderate') {
          const modAction = await evaluateModeration(msgText, userName, analysis.violation, analysis.severity);
          if (modAction.action === 'warn') {
            await warnUser(bot, ctx.chat.id, ctx.from.id, modAction.reason, 'jarvis-ai');
            await ctx.reply(`${ctx.from.first_name} — heads up: ${modAction.reason}`);
          } else if (modAction.action === 'mute') {
            await muteUser(bot, ctx.chat.id, ctx.from.id, 600, modAction.reason, 'jarvis-ai');
          }
        }
      } catch (err) {
        // Retry once on transient errors (429/503/529) — don't let flaky API silence JARVIS
        const status = err.status || err.statusCode;
        if (status === 429 || status === 503 || status === 529) {
          console.warn(`[intelligence] Transient ${status}, retrying once...`);
          try {
            await new Promise(r => setTimeout(r, 2000));
            const retryAnalysis = await analyzeMessage(msgText, userName, getRecentContext(ctx.chat.id, 10));
            if (retryAnalysis.action === 'engage' && retryAnalysis.response_hint) {
              const retryReply = await generateProactiveResponse(msgText, userName, retryAnalysis.response_hint, getSystemPrompt(), getRecentContext(ctx.chat.id, 10));
              if (retryReply) {
                let cleanRetry = stripGroupMarkdown(retryReply);
                cleanRetry = sanitizeOutput(cleanRetry);
                if (cleanRetry) {
                  await ctx.reply(cleanRetry, { parse_mode: undefined });
                  const myName = persona === 'degen' ? 'DIABLO' : 'JARVIS';
                  pushGroupMessage(ctx.chat.id, myName, retryReply, null, true);
                  bufferAssistantMessage(ctx.chat.id, retryReply);
                }
              }
            }
          } catch (retryErr) {
            console.error('[intelligence] Retry also failed:', retryErr.message?.slice(0, 100));
          }
        } else {
          console.error('[intelligence] Proactive analysis failed:', err.message?.slice(0, 100));
        }
      }
    }

    return;
  }

  // Shadow Protocol — shadow users bypass normal auth, use codename
  const shadowCodename = getShadowCodename(ctx.from.id);

  // ============ Open Access — Budget-Gated (Everyone talks, tiers control volume) ============
  const userId = String(ctx.from.id);
  const tier = getUserTier(userId, {
    isOwner: isOwner(ctx) || isUnlimitedUser(ctx),
    isAuthorized: isAuthorized(ctx),
    isTrustedAuthorizer: isTrustedAuthorizer(ctx),
  });
  const budgetCheck = checkTieredBudget(userId, tier);
  if (!budgetCheck.allowed && !shadowCodename) {
    if (ctx.chat.type === 'private') {
      return ctx.reply(
        `Daily compute limit reached (${budgetCheck.used.toLocaleString()}/${budgetCheck.budget.toLocaleString()} tokens).\n` +
        `Mine JUL → /mine | Burn JUL → /tip <amount> | Get blessed → ask a friend\n` +
        `Resets at midnight UTC.`
      );
    }
    return; // Silent in groups when budget exhausted
  }

  // Rate limit Claude API calls (owner exempt, shadows get standard limit)
  if (!isAuthorized(ctx) && isRateLimited(ctx.from.id)) {
    return ctx.reply('Slow down — too many requests. Try again in a minute.');
  }

  const chatId = ctx.chat.id;
  const userName = shadowCodename || ctx.from.username || ctx.from.first_name || 'Unknown';

  // Track shadow contribution
  if (shadowCodename) incrementContribution(ctx.from.id);

  // Show typing indicator
  await ctx.sendChatAction('typing');

  const typingInterval = setInterval(() => {
    ctx.sendChatAction('typing').catch(() => {});
  }, 4000);

  try {
    // Check if this message is a correction of a previous JARVIS response
    const isReply = ctx.message.reply_to_message?.from?.id === ctx.botInfo?.id;
    const lastResponse = getLastResponse(chatId);
    if (isReply || lastResponse) {
      const prevText = isReply
        ? ctx.message.reply_to_message?.text
        : lastResponse?.text;
      // Only check for corrections if previous response was recent (< 10 min)
      const isRecent = !lastResponse || (Date.now() - lastResponse.timestamp < 600000);
      if (prevText && isRecent) {
        // Fire and forget — don't block the response
        processCorrection(
          ctx.message.text, prevText,
          ctx.from.id, userName, chatId, ctx.chat.type
        ).then(result => {
          if (result) {
            console.log(`[learning] Correction from ${userName}: ${result.category} — ${result.lesson?.slice(0, 60) || 'no lesson'}`);
          }
        }).catch(err => {
          console.error('[learning] Correction processing failed:', err.message);
        });
      }
    }

    // Group Context Primitive — record the addressed message in the sliding window
    if (isGroup) {
      pushGroupMessage(chatId, userName, ctx.message.text, ctx.message.message_id, false);
    }

    // Bare invocation detection: if someone just says "jarvis" or "j" without a real question,
    // inject the recent group context as an explicit hint so the LLM responds to what was actually discussed
    let messageForLLM = ctx.message.text;
    if (isGroup) {
      const stripped = ctx.message.text.toLowerCase().replace(/[^a-z]/g, '');
      const isBareInvocation = ['jarvis', 'jar', 'j', 'hey jarvis', 'heyjarvis', 'yo jarvis', 'yojarvis'].includes(stripped);
      if (isBareInvocation) {
        const recentCtx = getRecentContext(chatId, 8);
        if (recentCtx) {
          messageForLLM = `${ctx.message.text}\n\n[SYSTEM: ${userName} just called your name. Here's what was just discussed in the group — respond to the conversation flow, not with a generic "Yes?":\n${recentCtx}]`;
        }
      }
    }

    // ============ Reply Context Injection ============
    // When a user replies to ANY message (not just Jarvis's), inject the original
    // message so Jarvis knows what they're referring to. Without this, Jarvis
    // just sees the user's text with no idea what they tagged/quoted.
    const replyToMsg = ctx.message.reply_to_message;
    if (replyToMsg && replyToMsg.text) {
      const replyAuthor = replyToMsg.from?.username || replyToMsg.from?.first_name || 'someone';
      const isReplyToSelf = replyToMsg.from?.id === ctx.botInfo?.id;
      // Always inject — even for replies to Jarvis (gives full context, not just correction detection)
      const replyContent = replyToMsg.text.slice(0, 1000);
      const label = isReplyToSelf ? 'your previous message' : `a message from @${replyAuthor}`;
      messageForLLM = `${messageForLLM}\n\n[CONTEXT: ${userName} is replying to ${label}:\n"${replyContent}"\n\nAddress this message directly in your response. The user wants you to engage with the content above, not just acknowledge being tagged.]`;
    } else if (replyToMsg && (replyToMsg.photo || replyToMsg.document || replyToMsg.video || replyToMsg.sticker)) {
      // Non-text reply — at least tell the LLM something was tagged
      const replyAuthor = replyToMsg.from?.username || replyToMsg.from?.first_name || 'someone';
      const mediaType = replyToMsg.photo ? 'photo' : replyToMsg.document ? 'document' : replyToMsg.video ? 'video' : 'sticker';
      const caption = replyToMsg.caption?.slice(0, 500) || '';
      messageForLLM = `${messageForLLM}\n\n[CONTEXT: ${userName} is replying to a ${mediaType} from @${replyAuthor}${caption ? ` with caption: "${caption}"` : ''}. Address what they're asking about this ${mediaType}.]`;
    }

    // YouTube Intelligence — detect links and fetch transcript/metadata for context
    const ytContext = await processYouTubeLinks(messageForLLM).catch(err => {
      console.warn(`[youtube] Failed: ${err.message}`);
      return null;
    });
    if (ytContext) {
      messageForLLM = `${messageForLLM}\n\n${ytContext}`;
      // Passive attribution — record video source in contribution graph
      autoAttributeContent({ url: messageForLLM.match(/https?:\/\/[^\s]+/)?.[0], title: ytContext.split('\n')[0], type: 'youtube' });
    }

    // Web Intelligence — fetch content from non-YouTube links
    if (!ytContext) {
      const webContext = await processWebLinks(messageForLLM).catch(err => {
        console.warn(`[web-reader] Failed: ${err.message}`);
        return null;
      });
      if (webContext) {
        messageForLLM = `${messageForLLM}\n\n${webContext}`;
        // Passive attribution — record each web source with author metadata
        for (const page of (webContext.pages || [])) {
          autoAttributeContent({ url: page.url, title: page.title, author: page.author, subreddit: page.subreddit, type: 'web' });
        }
      }
    }

    // Time awareness — inject current time context
    const timeCtx = getTimeContext(String(ctx.from.id));
    if (timeCtx) {
      messageForLLM = `${messageForLLM}\n\n${timeCtx}`;
    }

    // User memory — inject what JARVIS remembers about this person
    const memCtx = getUserMemoryContext(String(ctx.from.id));
    if (memCtx) {
      messageForLLM = `${messageForLLM}\n\n${memCtx}`;
    }

    // Cross-context: if this is a GROUP message, inject DM awareness + shard coordination
    const isGroupMsg = ctx.chat?.type === 'group' || ctx.chat?.type === 'supergroup';
    if (isGroupMsg) {
      const dmCtx = getDMContextForGroup(String(ctx.from.id));
      if (dmCtx) {
        messageForLLM = `${messageForLLM}\n\n${dmCtx}`;
      }
      recordGroupInteraction(String(ctx.from.id), userName);

      // Shard dedup: add coordination delay so siblings don't race
      const delay = getCoordinationDelay(String(ctx.chat.id));
      if (delay > 0) await new Promise(r => setTimeout(r, delay));

      // Check if a sibling already responded to this message
      const sibling = checkSiblingResponse(String(ctx.chat.id), ctx.message.message_id);
      if (sibling.siblingResponded && sibling.siblingText) {
        messageForLLM = `${messageForLLM}${buildSiblingContext(sibling.siblingText, sibling.siblingUsername)}`;
      }
    }

    // ============ Resilient LLM Call — Retry on Network Failure ============
    // The Wardenclyffe cascade handles provider-level retries, but if the entire
    // network is down (all providers unreachable), the cascade exhausts and throws.
    // This outer retry catches that case and waits for network recovery before
    // giving up entirely. Prevents "Something went wrong: fetch failed" on transient
    // network blips (which the logs showed happening around the 40hr uptime mark).
    let response;
    const MSG_MAX_RETRIES = 2;
    for (let msgAttempt = 0; msgAttempt <= MSG_MAX_RETRIES; msgAttempt++) {
      try {
        response = await chat(chatId, userName, messageForLLM, ctx.chat.type, [], { userId: ctx.from.id });
        break; // Success — exit retry loop
      } catch (chatErr) {
        const errMsg = (chatErr?.message || '').toLowerCase();
        const isNetworkError = errMsg.includes('fetch failed') || errMsg.includes('econnreset')
          || errMsg.includes('socket hang up') || errMsg.includes('network')
          || errMsg.includes('enotfound') || errMsg.includes('all providers exhausted');
        if (isNetworkError && msgAttempt < MSG_MAX_RETRIES) {
          const retryDelay = 3000 * (msgAttempt + 1); // 3s, 6s
          console.warn(`[resilience] Network error on chat() attempt ${msgAttempt + 1}/${MSG_MAX_RETRIES + 1}, retrying in ${retryDelay}ms: ${chatErr.message?.slice(0, 80)}`);
          await new Promise(r => setTimeout(r, retryDelay));
          // Keep typing indicator alive
          ctx.sendChatAction('typing').catch(() => {});
          continue;
        }
        throw chatErr; // Non-network error or retries exhausted — propagate to outer catch
      }
    }

    clearInterval(typingInterval);

    // Shard dedup: if response is "." (nothing to add), suppress it silently
    if (isGroupMsg && shouldSuppressShard(response.text)) {
      console.log(`[shard-dedup] Suppressed response in ${chatId} — sibling already covered it`);
      return;
    }

    // Record compute usage (non-blocking)
    if (response.usage) {
      try { recordComputeUsage(String(chatId), response.usage); } catch {}
    }

    // Save conversation after every Claude response (resilience)
    await saveConversations();

    // Learn about user (non-blocking)
    extractAndStoreMemories(String(ctx.from.id), userName, ctx.message.text, response.text).catch(() => {});

    // Passive attribution — scan message text for attribution signals (non-blocking)
    try { detectTextAttribution(ctx.message.text); } catch {}

    // Shard memory — capture interaction for compressed semantic memory (non-blocking)
    try {
      observeMemory({
        type: 'interaction',
        userId: String(ctx.from.id),
        chatId: String(chatId),
        summary: `${userName}: ${ctx.message.text?.slice(0, 100)}`,
        content: `Q: ${ctx.message.text?.slice(0, 250)}\nA: ${response.text?.slice(0, 250)}`,
        tags: ctx.chat?.type === 'private' ? ['dm'] : ['group'],
        importance: ctx.message.text?.length > 100 ? 0.7 : 0.5,
      });
    } catch {}

    // Cross-context: if this is a DM, capture the topic for group awareness
    if (!isGroupMsg) {
      try {
        recordDMTopic(String(ctx.from.id), userName, ctx.message.text, response.text, String(chatId));
      } catch {}
    }

    // Loop 3: Reward signal extraction — implicit score from user behavior (non-blocking)
    // Uses previous bot response + current user message to detect re-asks, corrections, thanks
    try {
      const signal = extractSignal(
        ctx.message.text,
        response.text,           // What bot just said
        ctx.message.reply_to_message?.text || null, // Previous context
        { userId: String(ctx.from.id), chatId: String(chatId), chatType: ctx.chat?.type }
      );

      // Loop 2: Record complete rollout for adaptation engine
      if (signal) {
        recordRollout({
          userId: String(ctx.from.id),
          chatId: String(chatId),
          userMessage: ctx.message.text?.slice(0, 200),
          botResponse: response.text?.slice(0, 200),
          signal: { type: signal.type, weight: signal.weight },
          provider: response._provider || null,
          timestamp: Date.now(),
        });
      }
    } catch {}

    // Detect timezone from message (non-blocking)
    const detectedTz = detectTimezone(ctx.message.text);
    if (detectedTz) {
      setUserTimezone(String(ctx.from.id), detectedTz);
      flushTimezones().catch(() => {});
    }

    let text = response.text?.trim();
    if (!text) {
      clearInterval(typingInterval);
      console.warn('[bot] Empty response from LLM — skipping send');
      return;
    }
    // Strip markdown in group chats — plain text only
    if (isGroup) text = stripGroupMarkdown(text);
    // Strip raw tool-use artifacts (LLM echoing internal blocks as text)
    text = sanitizeOutput(text);
    if (!text) {
      // Entire response was tool artifacts (deepseek echoing tool calls as text)
      // Skip silently — don't send garbage to chat
      clearInterval(typingInterval);
      console.warn('[bot] Response was only tool artifacts — skipped');
      return;
    }
    // ============ Collision Detection — Don't Repeat Yourself ============
    const collision = checkCollision(String(chatId), text);
    if (collision.collision && collision.matchedMessage) {
      console.log(`[collision] Regenerating response for chat ${chatId} (${(collision.similarity * 100).toFixed(1)}% similar)`);
      // Inject collision context and regenerate once
      const collisionPrompt = `${messageForLLM}${buildCollisionContext(collision.matchedMessage, collision.similarity)}`;
      try {
        ctx.sendChatAction('typing').catch(() => {});
        const regenResponse = await chat(collisionPrompt, String(chatId), userName, ctx, { regenAttempt: true });
        if (regenResponse?.text?.trim()) {
          let regenText = regenResponse.text.trim();
          if (isGroup) regenText = stripGroupMarkdown(regenText);
          regenText = sanitizeOutput(regenText);
          if (regenText) text = regenText;
        }
      } catch (regenErr) {
        console.warn(`[collision] Regen failed, using original: ${regenErr.message}`);
        // Fall through with original text
      }
    }

    if (text.length <= 4096) {
      await ctx.reply(text, { parse_mode: undefined });
    } else {
      const chunks = [];
      for (let i = 0; i < text.length; i += 4096) {
        chunks.push(text.slice(i, i + 4096));
      }
      for (const chunk of chunks) {
        await ctx.reply(chunk, { parse_mode: undefined });
      }
    }

    // Record outgoing message for collision detection
    recordOutgoing(String(chatId), text);

    // Track Jarvis's response in group context window (prevents phantom interactions)
    if (isGroup && text) {
      pushGroupMessage(chatId, 'JARVIS', text.slice(0, 500), null, true);
    }
  } catch (error) {
    clearInterval(typingInterval);
    console.error('[bot] Error:', error.message);
    try {
      await ephemeralReply(ctx, friendlyError(error), { parse_mode: undefined });
    } catch {
      // If even the error reply fails (user blocked bot, chat deleted, TG down), just log
      console.error('[bot] Failed to send error reply to chat', ctx.chat?.id);
    }
  }
});

// ============ Startup ============

async function main() {
  // ============ Worker Mode Startup ============
  if (IS_WORKER) {
    console.log('[jarvis] ============ WORKER SHARD STARTUP ============');

    // Worker shards: privacy → state store → learning → shard → consensus → HTTP server
    console.log('[jarvis] Step 1: Initializing privacy engine...');
    await initPrivacy();

    console.log('[jarvis] Step 2: Initializing state store...');
    await initStateStore();

    console.log('[jarvis] Step 2.5: Initializing LLM provider...');
    initProvider();

    console.log('[jarvis] Step 3: Loading learning + inner dialogue + deep storage + hell...');
    await initLearning();
    try { await initShardLearnings(); } catch (err) { console.warn(`[jarvis] Shard learnings init failed: ${err.message}`); }
    try { await initMIHost('./cells'); await registerMIBridge(); } catch (err) { console.warn(`[jarvis] MI Host init failed: ${err.message}`); }
    await initInnerDialogue();
    await initDeepStorage();
    await initHell();
    await recoverWAL();
    await recoverChain();
    await initAnchor();
    await recoverRetryQueue();
    await recoverCommittedIds();

    console.log('[jarvis] Step 4: Initializing shard identity...');
    const shardResult = await initShard();
    console.log(`[jarvis] Shard: ${shardResult.id} (${shardResult.totalShards} total, mode: WORKER)`);

    console.log('[jarvis] Step 5: Initializing consensus + CRPC + reputation...');
    initConsensus();
    await initCRPC();
    registerConsensusHandlers();
    await initReputation();

    // Worker HTTP server — consensus, CRPC, knowledge chain, health, proxy processing
    const healthPort = parseInt(process.env.HEALTH_PORT, 10) || 8080;
    createServer(async (req, res) => {
      // Health check
      if (req.url === '/health') {
        const apiSecret = process.env.CLAUDE_CODE_API_SECRET;
        const isAuthenticated = apiSecret && req.headers['x-api-secret'] === apiSecret;
        if (!isAuthenticated) {
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ status: 'ok', uptime: process.uptime() }));
          return;
        }
        const info = getShardInfo();
        const chainStats = getChainStats();
        const consensusState = getConsensusState();
        const crpcStats = getCRPCStats();
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
          status: 'ok',
          mode: 'worker',
          provider: getProviderName(),
          model: getModelName(),
          shard: info.id,
          nodeType: info.nodeType,
          uptime: process.uptime(),
          memory: info.memory,
          peers: info.peers,
          chain: { height: chainStats.height, pending: chainStats.pendingChanges, head: chainStats.head?.hash?.slice(0, 12) },
          consensus: { enabled: consensusState.enabled, committed: consensusState.committedTotal, pending: consensusState.pendingProposals },
          crpc: { enabled: crpcStats.enabled, active: crpcStats.activeTasks, completed: crpcStats.completedTasks },
        }));
        return;
      }

      // Proxy processing — primary shard forwards a message for this shard to process
      if (req.url === '/shard/process' && req.method === 'POST') {
        try {
          const body = await readBody(req);
          const payload = JSON.parse(body);
          // Process the message with Claude (for CRPC multi-shard response generation)
          const { chat: chatFn } = await import('./claude.js');
          const response = await chatFn(
            payload.chatId || 'proxy',
            payload.userName || 'proxy',
            payload.text,
            payload.chatType || 'private'
          );
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ ok: true, text: response.text, shardId: shardResult.id }));
        } catch (err) {
          res.writeHead(500, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: err.message }));
        }
        return;
      }

      // Router API
      if (req.url?.startsWith('/router/')) {
        const routerUrl = new URL(req.url, `http://localhost:${healthPort}`);
        const routerResult = handleRouterRequest(req, routerUrl);
        if (!routerResult) {
          res.writeHead(404, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'Unknown router route' }));
        } else if (routerResult.parse) {
          try {
            const body = await readBody(req);
            const payload = JSON.parse(body);
            const data = processRouterBody(routerResult.handler, payload, routerResult.userId);
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify(data));
          } catch (err) {
            res.writeHead(400, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: err.message }));
          }
        } else {
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify(routerResult.data));
        }
        return;
      }

      // Consensus + CRPC + Knowledge Chain endpoints (same as primary)
      if (req.url?.startsWith('/consensus/') || req.url?.startsWith('/crpc/')) {
        const reqUrl = new URL(req.url, `http://localhost:${healthPort}`);
        const path = reqUrl.pathname;
        const consensusHandler = handleConsensusRequest(path, req.method);
        if (consensusHandler) {
          if (consensusHandler === 'state') {
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify(getConsensusState()));
          } else {
            try {
              const body = await readBody(req);
              const payload = JSON.parse(body);
              const signature = req.headers['x-shard-signature'] || null;
              const data = await processConsensusBody(consensusHandler, payload, signature);
              res.writeHead(200, { 'Content-Type': 'application/json' });
              res.end(JSON.stringify(data || { ok: true }));
            } catch (err) {
              res.writeHead(400, { 'Content-Type': 'application/json' });
              res.end(JSON.stringify({ error: err.message }));
            }
          }
          return;
        }
        const crpcHandler = handleCRPCRequest(path, req.method);
        if (crpcHandler) {
          if (crpcHandler === 'stats' || crpcHandler === 'protocol' || crpcHandler === 'dashboard') {
            const data = await processCRPCBody(crpcHandler);
            if (data?._html) {
              res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
              res.end(data._html);
            } else {
              res.writeHead(200, { 'Content-Type': 'application/json' });
              res.end(JSON.stringify(data, null, 2));
            }
          } else if (crpcHandler === 'demo') {
            try {
              let prompt = null;
              if (req.method === 'POST') {
                const body = await readBody(req);
                if (body) prompt = JSON.parse(body).prompt;
              }
              const trace = await runCRPCDemo(prompt);
              res.writeHead(200, { 'Content-Type': 'application/json' });
              res.end(JSON.stringify(trace, null, 2));
            } catch (err) {
              res.writeHead(500, { 'Content-Type': 'application/json' });
              res.end(JSON.stringify({ error: err.message }));
            }
          } else {
            try {
              const body = await readBody(req);
              const payload = JSON.parse(body);
              const data = await processCRPCBody(crpcHandler, payload);
              res.writeHead(200, { 'Content-Type': 'application/json' });
              res.end(JSON.stringify(data));
            } catch (err) {
              res.writeHead(400, { 'Content-Type': 'application/json' });
              res.end(JSON.stringify({ error: err.message }));
            }
          }
          return;
        }
      }

      if (req.url?.startsWith('/knowledge-chain/') || req.url?.startsWith('/knowledge/')) {
        const kcUrl = new URL(req.url, `http://localhost:${healthPort}`);
        const kcPath = kcUrl.pathname;
        const kcHandler = handleKnowledgeChainRequest(kcPath, req.method);
        if (kcHandler === 'epoch') {
          try {
            const body = await readBody(req);
            const payload = JSON.parse(body);
            const data = await processKnowledgeChainBody(kcHandler, payload);
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify(data));
          } catch (err) {
            res.writeHead(400, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: err.message }));
          }
          return;
        } else if (kcHandler) {
          const query = Object.fromEntries(kcUrl.searchParams);
          const data = await processKnowledgeChainBody(kcHandler, null, query);
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify(data));
          return;
        }
      }

      // Constellation — Interactive Star Map (must check BEFORE generic /theai)
      if (req.url?.startsWith('/theai/constellation')) {
        const cUrl = new URL(req.url, `http://localhost:${healthPort}`);
        await handleConstellationRequest(req, res, cUrl);
        return;
      }

      // TheAI — Digital Corporation Dashboard
      if (req.url?.startsWith('/theai')) {
        const aiUrl = new URL(req.url, `http://localhost:${healthPort}`);
        await handleTheAIRequest(req, res, aiUrl);
        return;
      }

      // Nyx — Agent Interface (worker nodes too)
      if (req.url?.startsWith('/nyx')) {
        const nyxUrl = new URL(req.url, `http://localhost:${healthPort}`);
        await handleNyxRequest(req, res, nyxUrl);
        return;
      }

      res.writeHead(404);
      res.end('Not found');
    }).listen(healthPort, () => {
      console.log(`[jarvis] Worker shard listening on http://0.0.0.0:${healthPort}`);
    });

    // Flush cycles for worker — harmonic tick (all shards pulse at same wall-clock boundary)
    scheduleHarmonicTick(async () => {
      await flushLearning();
      try { await readLearnings(); await archiveExpired(); } catch {}
      await flushInnerDialogue();
      if (isMultiShard()) checkShardHealth();
      const epoch = await produceEpoch();
      if (epoch && isMultiShard()) {
        await broadcastEpoch(epoch);
        await retryMissedEpochs();
        await syncWithPeers();
      }
      // Anchor: periodically commit Merkle super-roots to local proof chain
      await maybeAnchor();
    }, 5 * 60 * 1000);

    // ============ Primary Watchdog ============
    // Workers monitor the primary shard. If it dies, restart it via Fly.io API.
    // This makes the network self-healing — if the Telegram bot crashes, workers revive it.
    let primaryFailCount = 0;
    const PRIMARY_HEALTH_URL = (config.shard?.routerUrl || 'https://jarvis-vibeswap.fly.dev') + '/health';
    const PRIMARY_MAX_FAILURES = 3; // 3 consecutive failures = 90s down
    const FLY_API_TOKEN = process.env.FLY_API_TOKEN || config.fly?.apiToken;
    const PRIMARY_APP = config.fly?.primaryApp || 'jarvis-vibeswap';

    setInterval(async () => {
      try {
        const resp = await fetch(PRIMARY_HEALTH_URL, { signal: AbortSignal.timeout(10000) });
        if (resp.ok) {
          if (primaryFailCount > 0) {
            console.log(`[watchdog] Primary recovered after ${primaryFailCount} failures`);
            primaryFailCount = 0;
          }
          return;
        }
        primaryFailCount++;
      } catch {
        primaryFailCount++;
      }

      console.warn(`[watchdog] Primary unreachable (${primaryFailCount}/${PRIMARY_MAX_FAILURES})`);

      if (primaryFailCount >= PRIMARY_MAX_FAILURES && FLY_API_TOKEN) {
        console.warn('[watchdog] Primary down — attempting restart via Fly.io API...');
        try {
          // List machines in the primary app
          const listResp = await fetch(`https://api.machines.dev/v1/apps/${PRIMARY_APP}/machines`, {
            headers: { 'Authorization': `Bearer ${FLY_API_TOKEN}` },
            signal: AbortSignal.timeout(15000),
          });
          if (listResp.ok) {
            const machines = await listResp.json();
            for (const machine of machines) {
              if (machine.state !== 'started') {
                console.warn(`[watchdog] Restarting machine ${machine.id} (state: ${machine.state})`);
                await fetch(`https://api.machines.dev/v1/apps/${PRIMARY_APP}/machines/${machine.id}/start`, {
                  method: 'POST',
                  headers: { 'Authorization': `Bearer ${FLY_API_TOKEN}` },
                  signal: AbortSignal.timeout(15000),
                });
              } else {
                // Machine thinks it's started but unresponsive — force restart
                console.warn(`[watchdog] Force-restarting machine ${machine.id}`);
                await fetch(`https://api.machines.dev/v1/apps/${PRIMARY_APP}/machines/${machine.id}/restart`, {
                  method: 'POST',
                  headers: { 'Authorization': `Bearer ${FLY_API_TOKEN}` },
                  signal: AbortSignal.timeout(15000),
                });
              }
            }
          }
          primaryFailCount = 0; // Reset — give it time to boot
        } catch (err) {
          console.error(`[watchdog] Failed to restart primary: ${err.message}`);
        }
      }
    }, 30000); // Check every 30s

    // Graceful shutdown for worker
    async function workerShutdown(signal) {
      console.log(`[jarvis] Worker shutting down (${signal})...`);
      await shutdownShard();
      await flushLearning();
      await flushInnerDialogue();
      await flushAutonomous();
      process.exit(0);
    }
    process.once('SIGINT', () => workerShutdown('SIGINT'));
    process.once('SIGTERM', () => workerShutdown('SIGTERM'));

    console.log('[jarvis] ============ WORKER SHARD ONLINE ============');
    return; // Worker startup complete — don't run primary path
  }

  // ============ Primary Mode Startup ============
  console.log('[jarvis] ============ STARTUP ============');

  // Step 0: Acquire instance lock — prevent dual processes
  await acquireInstanceLock();

  // Step 1: Pull latest from git BEFORE loading context (with retry)
  // Git pull can fail on network blips — retry with backoff to ensure
  // context files are up-to-date. Missing context = lobotomized bot.
  console.log('[jarvis] Step 1: Syncing from git...');
  {
    const GIT_MAX_RETRIES = 3;
    let gitPulled = false;
    for (let gitAttempt = 0; gitAttempt < GIT_MAX_RETRIES; gitAttempt++) {
      try {
        const pullResult = await gitPull();
        console.log(`[jarvis] Git: ${pullResult}`);
        gitPulled = true;
        break;
      } catch (err) {
        console.warn(`[jarvis] Git pull attempt ${gitAttempt + 1}/${GIT_MAX_RETRIES} failed: ${err.message}`);
        if (gitAttempt < GIT_MAX_RETRIES - 1) {
          const delay = 2000 * (gitAttempt + 1);
          console.log(`[jarvis] Retrying git pull in ${delay}ms...`);
          await new Promise(r => setTimeout(r, delay));
        }
      }
    }
    if (!gitPulled) {
      console.warn('[jarvis] All git pull attempts failed — using local files');
    }
  }

  // Step 2: Initialize privacy engine BEFORE loading any CKBs
  console.log('[jarvis] Step 2: Initializing privacy engine...');
  await initPrivacy();

  // Step 2.5: Initialize state store (abstracts file vs redis vs future backends)
  console.log('[jarvis] Step 2.5: Initializing state store...');
  await initStateStore();

  // Step 2.7: Initialize LLM provider (multi-model support)
  console.log('[jarvis] Step 2.7: Initializing LLM provider...');
  initProvider();

  // Step 2.9: Initialize continuous context memory (rolling summaries)
  console.log('[jarvis] Step 2.9: Initializing continuous context memory...');
  await initContextMemory();

  // Step 2.95: Load runtime-authorized users
  await loadRuntimeAuthorized();

  // Step 3: Load context, conversation history, moderation log, threads, comms
  // Parallelized independent init groups to reduce startup time (~15-30s savings)
  console.log('[jarvis] Step 3: Loading memory, conversations, moderation, threads, comms...');

  // Group A: Core context (must complete first — other modules depend on system prompt)
  await initClaude();

  // Group B: Independent data loaders — all read separate files, no dependencies
  const initStartMs = Date.now();
  await Promise.all([
    initTracker(),
    initModeration(),
    initAntispam(),
    initThreads(),
    loadBehavior(),
    loadComms(),
    initLearning(),
    initShardLearnings().catch(err => console.warn(`[jarvis] Shard learnings init failed: ${err.message}`)),
    initInnerDialogue(),
    initStickers(),
    initShadow(),
    initOperators(),
    initPreferences(),
    initGroupContext(),
    initXP(),
    initPredictions(),
    initSocial(),
    initCKB(),
    initEmissions(),
    loadWorkflowStats(),
    initShardMemory().catch(err => console.warn(`[jarvis] Shard memory init failed: ${err.message}`)),
    initRewardSignals().catch(err => console.warn(`[jarvis] Reward signals init failed: ${err.message}`)),
    initSelfImprove().catch(err => console.warn(`[jarvis] Self-improve init failed: ${err.message}`)),
    initCrossContext().catch(err => console.warn(`[jarvis] Cross-context init failed: ${err.message}`)),
    initCollisionDetector().catch(err => console.warn(`[jarvis] Collision detector init failed: ${err.message}`)),
  ]);

  // Group C: MI Host (depends on nothing but may fail — keep isolated)
  try {
    const miResult = await initMIHost('./cells');
    console.log(`[jarvis] MI Host: ${miResult.cellCount} cells active (${miResult.manifests} manifests loaded)`);
    const bridgeResult = await registerMIBridge();
    console.log(`[jarvis] MI Bridge: ${bridgeResult.registered} capability handlers registered`);
  } catch (err) { console.warn(`[jarvis] MI Host init failed: ${err.message}`); }

  // Group D: Chain recovery (sequential — WAL must recover before chain, chain before retry queue)
  await recoverWAL();
  await recoverChain();
  await initAnchor();
  await recoverRetryQueue();
  await recoverCommittedIds();
  console.log(`[jarvis] Parallel init completed in ${Date.now() - initStartMs}ms`);
  await initScheduler((chatId, text) => bot.telegram.sendMessage(chatId, text));
  await initTaskQueue(
    (chatId, text, opts) => bot.telegram.sendMessage(chatId, text, opts),
    null // LLM chat function wired after bot.launch() — deferred tasks use direct LLM calls
  );
  // Sovereign wallet — on-chain agency
  initWallet();
  // Trading — autonomous DEX trading on Base
  initTrading();
  // Pantheon — digital corporation agent management
  initPantheon();
  // Constellation — interactive star map visualization
  initConstellation();
  // Rosetta Stone Protocol — universal translation between agents
  initRosetta();
  // Nervos Talks — silent guardian of the forum
  if (initNervosTalks && process.env.NERVOS_TALKS_API_KEY) {
    nervosStartSchedule(config.repo.path, {
      chat: (chatId, text) => bot.telegram.sendMessage(chatId, text),
      llm: async (prompt) => {
        try { return await chat(-1, prompt, { role: 'system', skipTracking: true }); } catch { return null; }
      },
    });
    console.log('[jarvis] Nervos Talks guardian active');
  }
  // TheAI — scheduled 24h prune cycle (midnight UTC)
  const schedulePrune = () => {
    const now = new Date();
    const midnight = new Date(now);
    midnight.setUTCHours(24, 0, 0, 0); // Next midnight UTC
    const msUntilMidnight = midnight - now;
    setTimeout(async () => {
      console.log('[theai] Running scheduled 24h prune...');
      try {
        const results = await pruneAll();
        for (const r of results) {
          if (r.error) console.warn(`[theai] Prune ${r.agent}: ERROR ${r.error}`);
          else console.log(`[theai] Prune ${r.agent} → ${r.manager}: OK (${r.cost})`);
        }
        console.log(`[theai] Prune complete: ${results.length} agents processed`);
      } catch (err) { console.warn(`[theai] Prune failed: ${err.message}`); }
      // Schedule next prune in 24h
      setInterval(async () => {
        try { await pruneAll(); } catch {}
      }, 24 * 60 * 60 * 1000);
    }, msUntilMidnight);
    console.log(`[theai] Next prune in ${Math.round(msUntilMidnight / 60000)}min (midnight UTC)`);
  };
  schedulePrune();
  // Social outbound presence — X, Discord, GitHub
  initSocialOutbound();
  // Proactive engine — autonomous scheduled actions
  initProactive({
    chat: (chatId, text) => bot.telegram.sendMessage(chatId, text),
    social: { processQueue: processSocialQueue },
  });
  // Autonomous engagement — JARVIS as active community member
  await loadDirectives(); // Runtime behavioral directives (tag-only, quiet, etc.)
  // Log TAG_ONLY_CHAT_IDS for verification (confirms env var is loaded)
  if (config.tagOnlyChatIds?.length > 0) {
    console.log(`[directives] TAG_ONLY_CHAT_IDS loaded: [${config.tagOnlyChatIds.join(', ')}]`);
  } else {
    console.log('[directives] TAG_ONLY_CHAT_IDS: empty (no env var or no valid IDs)');
  }
  await loadChatActivity(); // Restore activity state before init
  const autonomousChatIds = config.authorizedGroups || [];
  initAutonomous((chatId, text) => bot.telegram.sendMessage(chatId, text), autonomousChatIds);
  await initComputeEconomics();
  initX402(); // x402 Payment Required — configures via env vars, disabled if no treasury set
  await initMining();
  await initInfoFi();
  await initDeepStorage();
  await initHell();
  await initUserMemory();
  await initTimeAwareness();
  await initAttribution();
  await initRelay();
  await initLimni();
  registerKataraktiStrategies();
  // Wire Limni alerts to owner's Telegram DM
  onAlert((alert) => {
    try {
      bot.telegram.sendMessage(config.ownerUserId, `⚠ LIMNI ALERT [${alert.type}]\n${alert.message}`);
    } catch {}
  });
  // Initialize broadcast engine (autonomous content distribution)
  await initBroadcast({
    telegramSend: (chatId, text) => bot.telegram.sendMessage(chatId, text),
    chatIds: config.authorizedGroups || [],
  });

  console.log('[jarvis] Behavior flags + comms + learning + inner dialogue + stickers + shadow + compute economics + mining + deep storage + hell + limni + broadcast loaded.');

  // Security posture check (runs every startup)
  await runSecurityChecks();

  // Step 3.5: Initialize shard identity (Decentralized Mind Network)
  console.log('[jarvis] Step 3.5: Initializing shard identity...');
  const shardResult = await initShard();
  console.log(`[jarvis] Shard: ${shardResult.id} (${shardResult.totalShards} total, ${isMultiShard() ? 'MULTI' : 'SINGLE'}-shard mode)`);

  // Step 3.6: Initialize consensus + CRPC + reputation
  initConsensus();
  await initCRPC();
  registerConsensusHandlers();
  await initReputation();

  // Step 4: Context diagnosis — verify critical files loaded
  // If context is empty (0 chars), the bot is effectively lobotomized.
  // Retry git pull + context reload to recover from transient failures.
  let report = await diagnoseContext();
  console.log(`[jarvis] Context: ${report.loaded.length} files loaded (${report.totalChars} chars)`);
  if (report.missing.length > 0) {
    console.warn(`[jarvis] WARNING — Missing context files: ${report.missing.join(', ')}`);
  }
  if (report.totalChars === 0 && report.missing.length > 0) {
    console.error('[jarvis] CRITICAL — Zero context loaded! Attempting recovery...');
    for (let ctxRetry = 0; ctxRetry < 3; ctxRetry++) {
      await new Promise(r => setTimeout(r, 3000 * (ctxRetry + 1)));
      try {
        const retryPull = await gitPull();
        console.log(`[jarvis] Recovery git pull: ${retryPull}`);
      } catch {}
      await reloadSystemPrompt();
      report = await diagnoseContext();
      console.log(`[jarvis] Recovery attempt ${ctxRetry + 1}: ${report.loaded.length} files (${report.totalChars} chars)`);
      if (report.totalChars > 0) {
        console.log('[jarvis] Context recovered successfully');
        break;
      }
    }
    if (report.totalChars === 0) {
      console.error('[jarvis] FAILED to recover context after 3 attempts — bot will run with degraded context');
    }
  }

  // Step 5: Check for unclean shutdown
  const lastShutdown = await checkLastShutdown();
  if (!lastShutdown.clean && !lastShutdown.firstBoot) {
    console.warn(`[jarvis] WARNING: Unclean shutdown detected. Last seen: ${lastShutdown.lastSeen}, downtime: ~${lastShutdown.downtime}min`);
  }

  // Step 6: Initialize group monitor (MTProto — reads public groups without joining)
  if (monitorAvailable) {
    console.log('[jarvis] Step 6: Initializing group monitor...');
    try {
      await initMonitor();
    } catch (err) {
      console.warn(`[jarvis] Monitor init failed (non-fatal): ${err.message}`);
    }
  } else {
    console.log('[jarvis] Step 6: Group monitor skipped (telegram package not installed).');
  }

  console.log(`[jarvis] Model: ${config.anthropic.model}`);
  console.log('[jarvis] Step 7: Starting Telegram bot...');

  // ============ Telegraf Error Handler — CRITICAL ============
  // Without bot.catch(), Telegraf polling errors become unhandled rejections.
  // The process survives (due to our global handler), but the polling loop
  // may silently stop receiving updates — heartbeat works but bot is dead.
  // This is the exact failure mode observed at the 40hr mark.
  bot.catch((err, ctx) => {
    const chatInfo = ctx?.chat?.id || 'unknown';
    console.error(`[telegraf] Error in chat ${chatInfo}:`, err.message);
    // Log but don't crash — Telegraf will continue polling
    persistCrashEntry('telegraf_error', err);
    // Best-effort user feedback — prevents silent command failures
    try {
      const isGroup = ctx?.chat?.type === 'group' || ctx?.chat?.type === 'supergroup';
      if (!isGroup && ctx?.reply) {
        ctx.reply('Something went wrong. Try again in a moment.').catch(() => {});
      }
    } catch {}
  });

  // ============ Polling Liveness Monitor ============
  // Tracks when the last update was received from Telegram. If no updates
  // arrive for 5 minutes (while the process is alive), the polling connection
  // is likely broken. Auto-restarts polling to recover.
  //
  // ARCHITECTURE NOTE: Telegraf v4's bot.stop()/bot.launch() cycle is fragile —
  // it can leave internal state inconsistent and cause 409 Conflicts (Telegram
  // rejects two simultaneous getUpdates sessions). Our strategy:
  //   1. Try soft restart: deleteWebhook (clears stuck session) → re-launch
  //   2. Verify restart worked: call getMe() to confirm API connectivity
  //   3. If soft restart fails twice, hard restart: exit process, let Fly.io restart us
  let lastUpdateReceived = Date.now();
  const POLLING_TIMEOUT_MS = 5 * 60 * 1000; // 5 minutes
  const POLLING_CHECK_INTERVAL = 60 * 1000; // Check every 60s
  let pollingRestartAttempts = 0;
  const MAX_POLLING_RESTART_ATTEMPTS = 2; // After 2 failed soft restarts, hard restart

  // Middleware to track update liveness — runs on EVERY incoming update
  bot.use((ctx, next) => {
    lastUpdateReceived = Date.now();
    return next();
  });

  // Fire-and-forget launch — must NOT block startup or the HTTP health server won't start.
  // If Telegram is unreachable, the polling liveness monitor (below) handles recovery.
  bot.launch({ dropPendingUpdates: true }).catch(launchErr => {
    console.error(`[jarvis] bot.launch() failed: ${launchErr.message}`);
    persistCrashEntry('launch_failed', launchErr);
    // Polling monitor will detect silence and attempt restart
  });
  console.log('[jarvis] ============ JARVIS IS ONLINE ============');

  // Register sibling bots for deduplication
  // Each Jarvis shard knows about the others so they don't echo
  const myBotId = bot.botInfo?.id;
  const KNOWN_SIBLINGS = [
    { id: 7829498040, username: 'JarvisMind1828383bot' },   // Jarvis Prime
    { id: 8170498637, username: 'diablojarvisbot' },         // Diabolical Jarvis
  ].filter(s => s.id !== myBotId); // Don't register self
  registerSiblings(KNOWN_SIBLINGS);

  // Mesh monitor — bidirectional health awareness across all nodes
  try {
    const { initMeshMonitor } = await import('./mesh-monitor.js');
    initMeshMonitor(bot);
  } catch (err) {
    console.warn(`[jarvis] Mesh monitor init failed: ${err.message}`);
  }

  // Polling liveness checker — restarts polling if no updates for 5 min
  setInterval(async () => {
    const silentMs = Date.now() - lastUpdateReceived;
    if (silentMs > POLLING_TIMEOUT_MS) {
      pollingRestartAttempts++;
      console.error(`[polling-monitor] No updates for ${Math.round(silentMs / 60000)}min — attempt ${pollingRestartAttempts}/${MAX_POLLING_RESTART_ATTEMPTS}`);

      // If we've already tried soft restarts and they failed, hard restart
      if (pollingRestartAttempts > MAX_POLLING_RESTART_ATTEMPTS) {
        console.error('[polling-monitor] Soft restarts exhausted — hard restarting process');
        try {
          await bot.telegram.sendMessage(config.ownerUserId,
            `[POLLING-MONITOR] Soft restart failed ${MAX_POLLING_RESTART_ATTEMPTS} times. Hard restarting process...`
          );
        } catch {}
        await persistCrashEntry('polling_hard_restart', { message: `${pollingRestartAttempts} soft restart attempts failed` });
        // Flush critical data before exit
        try { await saveConversations(); } catch {}
        try { await writeHeartbeat('polling_restart'); } catch {}
        try { await releaseInstanceLock(); } catch {}
        // Exit with code 1 — Fly.io restart policy will bring us back
        process.exit(1);
      }

      try {
        await bot.telegram.sendMessage(config.ownerUserId,
          `[POLLING-MONITOR] No updates for ${Math.round(silentMs / 60000)}min. Soft restart attempt ${pollingRestartAttempts}...`
        );
      } catch {}

      try {
        // Step 1: Stop existing polling
        bot.stop('polling_restart');
        // Step 2: Wait for Telegram to release the getUpdates session
        await new Promise(r => setTimeout(r, 5000));
        // Step 3: Clear any stuck webhook/session — this is the key fix
        // deleteWebhook with drop_pending_updates clears Telegram's server-side session lock
        await bot.telegram.deleteWebhook({ drop_pending_updates: true });
        await new Promise(r => setTimeout(r, 2000));
        // Step 4: Re-launch polling
        bot.launch({ dropPendingUpdates: true });
        // Step 5: Verify API connectivity
        const me = await bot.telegram.getMe();
        if (me?.id) {
          lastUpdateReceived = Date.now(); // Reset timer
          pollingRestartAttempts = 0; // Reset counter on success
          console.log(`[polling-monitor] Polling restarted successfully (bot: @${me.username})`);
          try {
            await bot.telegram.sendMessage(config.ownerUserId, `[POLLING-MONITOR] Polling restarted ✓ (@${me.username})`);
          } catch {}
        } else {
          throw new Error('getMe() returned no data after restart');
        }
      } catch (restartErr) {
        console.error('[polling-monitor] Soft restart failed:', restartErr.message);
        persistCrashEntry('polling_restart_failed', restartErr);
        // Don't reset timer — let it try again on next interval
      }
    }
  }, POLLING_CHECK_INTERVAL);

  // ============ Self-Healing Watchdog ============
  // Pings own health endpoint every 60s. If 3 consecutive failures, notifies Will.
  let watchdogFailures = 0;
  const WATCHDOG_INTERVAL = 60_000;
  const WATCHDOG_MAX_FAILURES = 3;
  if (config.isDocker || process.env.HEALTH_PORT) {
    setInterval(async () => {
      try {
        const res = await fetch(`http://localhost:${process.env.HEALTH_PORT || '8080'}/health`, {
          signal: AbortSignal.timeout(5000),
        });
        if (res.ok) {
          if (watchdogFailures > 0) {
            console.log(`[watchdog] Health recovered after ${watchdogFailures} failures`);
            watchdogFailures = 0;
          }
        } else {
          watchdogFailures++;
        }
      } catch {
        watchdogFailures++;
      }
      if (watchdogFailures === WATCHDOG_MAX_FAILURES) {
        console.error(`[watchdog] ${WATCHDOG_MAX_FAILURES} consecutive health check failures — notifying owner`);
        try {
          await bot.telegram.sendMessage(config.ownerUserId,
            `[WATCHDOG] JARVIS health degraded — ${WATCHDOG_MAX_FAILURES} consecutive self-ping failures. Investigating...`
          );
        } catch { /* can't notify if bot itself is broken */ }
      }
    }, WATCHDOG_INTERVAL);
    console.log('[jarvis] Watchdog armed (60s self-ping interval)');
  }

  // HTTP health endpoint for cloud platforms (Fly.io, Railway, etc.)
  if (config.isDocker || process.env.HEALTH_PORT) {
    const healthPort = parseInt(process.env.HEALTH_PORT, 10) || 8080;
    const httpServer = createServer(async (req, res) => {
      if (req.url === '/health') {
        const apiSecret = process.env.CLAUDE_CODE_API_SECRET;
        const isAuthenticated = apiSecret && req.headers['x-api-secret'] === apiSecret;
        if (!isAuthenticated) {
          // Quick health check for Fly.io — include basic memory info
          // Returns 200 even during startup so Fly.io doesn't kill us during init
          const mem = process.memoryUsage();
          const rssMB = Math.round(mem.rss / 1024 / 1024);
          res.writeHead(200, { 'Content-Type': 'application/json' });
          const mh = getModuleHealth();
          const heapMB = Math.round(mem.heapUsed / 1024 / 1024);
          res.end(JSON.stringify({
            status: mh.failed.length === 0 ? 'ok' : 'degraded',
            uptime: process.uptime(),
            memMB: rssMB,
            heapMB,
            polling: pollingRestartAttempts === 0 ? 'ok' : `degraded (${pollingRestartAttempts} restarts)`,
            modules: { loaded: mh.loaded.length, failed: mh.failed.length, failedNames: mh.failed.map(f => f.name) },
            maps: { rateLimits: rateLimitMap.size, cmdRateLimits: commandRateLimits.size, botExchanges: global._botExchanges?.size || 0 },
          }));
        } else {
        try {
          const report = await diagnoseContext();
          const chainStats = getChainStats();
          const consensusState = getConsensusState();
          const crpcStats = getCRPCStats();
          const info = getShardInfo();
          const mem = process.memoryUsage();
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({
            status: 'ok',
            uptime: process.uptime(),
            provider: getProviderName(),
            model: getModelName(),
            context: { loaded: report.loaded.length, total: report.loaded.length + report.missing.length, chars: report.totalChars },
            chain: { height: chainStats.height, pending: chainStats.pendingChanges, head: chainStats.head?.hash?.slice(0, 12) },
            consensus: { enabled: consensusState.enabled, committed: consensusState.committedTotal, pending: consensusState.pendingProposals },
            crpc: { enabled: crpcStats.enabled, active: crpcStats.activeTasks, completed: crpcStats.completedTasks },
            peers: info?.peers || 0,
            memory: { heapMB: Math.round(mem.heapUsed / 1048576), rssMB: Math.round(mem.rss / 1048576) },
          }));
        } catch {
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ status: 'ok', uptime: process.uptime() }));
        }
        }
      } else if (req.url === '/transcript' && req.method === 'POST') {
        // ============ Meeting Transcript Webhook ============
        // Receives live transcript chunks from Fireflies.ai (or any transcription service)
        // and forwards Jarvis's response to the Telegram group/DM
        try {
          const body = await readBody(req);
          const payload = JSON.parse(body);

            // Verify webhook secret
            if (config.transcriptWebhookSecret && payload.secret !== config.transcriptWebhookSecret) {
              res.writeHead(401);
              res.end('Unauthorized');
              return;
            }

            const transcript = payload.transcript || payload.text || payload.data?.transcript || '';
            const speaker = payload.speaker || payload.data?.speaker || 'Unknown';
            const meetingTitle = payload.meeting_title || payload.data?.title || 'Meeting';

            if (transcript.length < 10) {
              res.writeHead(200);
              res.end('OK — too short, skipped');
              return;
            }

            // ============ Persist to KB transcript log ============
            const transcriptFile = join(config.dataDir, 'meeting-transcripts.md');
            const timestamp = new Date().toISOString().replace('T', ' ').slice(0, 19);
            const logEntry = `**[${timestamp}] ${meetingTitle}**\n**${speaker}**: ${transcript}\n\n`;
            try {
              await appendFile(transcriptFile, logEntry);
            } catch {
              // First write — file doesn't exist yet
              await writeFile(transcriptFile, `# Meeting Transcripts\n\nPersisted automatically by Jarvis from live meeting webhooks.\n\n---\n\n${logEntry}`);
            }

            // Send to Claude for analysis
            const chatId = config.transcriptChatId || config.ownerUserId;
            const prompt = `[LIVE MEETING: ${meetingTitle}]\n[${speaker}]: ${transcript}\n\nYou are JARVIS, listening to a live meeting. Your ONLY role is to provide actionable feedback and suggestions that build on what was just said. Think like an architect and co-founder.\n\nRules:\n- ONLY respond with concrete suggestions, improvements, or critical feedback on ideas being discussed\n- Point out flaws, edge cases, or missed opportunities in what was proposed\n- Suggest specific technical approaches, patterns, or alternatives\n- Connect what they're saying to existing VibeSwap/CKB mechanisms if relevant\n- Be concise — 2-3 sentences max, like you're interjecting in a meeting\n- If nothing constructive to add (small talk, greetings, off-topic), reply with exactly "—" and nothing else\n- Do NOT summarize what they said. Do NOT repeat their points. Only ADD value.`;

            await bot.telegram.sendChatAction(chatId, 'typing');
            const response = await chat(chatId, 'meeting-transcript', prompt, 'private');

            // Only forward if Jarvis has something meaningful to say
            if (response.text && response.text.trim() !== '—' && response.text.trim() !== '-') {
              const jarvisText = response.text;

              // Persist Jarvis's response to transcript log
              try {
                await appendFile(transcriptFile, `**Jarvis**: ${jarvisText}\n\n`);
              } catch { /* ignore */ }

              // Send text context first
              await bot.telegram.sendMessage(chatId,
                `[Meeting: ${meetingTitle}]\n${speaker}: "${transcript.slice(0, 100)}${transcript.length > 100 ? '...' : ''}"`
              );

              // Generate TTS voice message — JARVIS speaks (ElevenLabs MCU voice → Google fallback)
              try {
                const voiceFile = await jarvisSpeak(jarvisText, 'transcript');
                if (voiceFile) {
                  await bot.telegram.sendVoice(chatId, { source: voiceFile }, { caption: 'Jarvis' });
                  await ttsCleanup(voiceFile);
                } else {
                  await bot.telegram.sendMessage(chatId, `Jarvis: ${jarvisText}`);
                }
              } catch (ttsErr) {
                console.warn('[tts] Voice generation failed, sending text only:', ttsErr.message);
                await bot.telegram.sendMessage(chatId, `Jarvis: ${jarvisText}`);
              }
            }

            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ status: 'ok', responded: response.text?.trim() !== '—' }));
        } catch (err) {
            console.error('[transcript] Webhook error:', err.message);
            res.writeHead(500);
            res.end(JSON.stringify({ error: err.message }));
        }
      // ============ Fireflies.ai Webhook ============
      // GET = verification ping (Fireflies checks URL is live before activating)
      // POST = transcription event
      } else if (req.url === '/fireflies' && req.method === 'GET') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ status: 'ok', service: 'jarvis-fireflies-webhook' }));

      } else if (req.url === '/fireflies' && req.method === 'POST') {
        try {
          const body = await readBody(req);
            // Verify HMAC signature if secret is configured
            if (config.fireflies?.webhookSecret) {
              const signature = req.headers['x-hub-signature'];
              const expected = createHmac('sha256', config.fireflies.webhookSecret).update(body).digest('hex');
              if (signature !== expected) {
                console.warn('[fireflies] Invalid webhook signature');
                res.writeHead(401);
                res.end('Unauthorized');
                return;
              }
            }

            const payload = JSON.parse(body);
            const { meetingId, eventType } = payload;
            console.log(`[fireflies] Webhook received: ${eventType} (meetingId: ${meetingId})`);

            if (eventType !== 'Transcription completed') {
              res.writeHead(200);
              res.end('OK — event ignored');
              return;
            }

            if (!config.fireflies?.apiKey) {
              console.warn('[fireflies] No FIREFLIES_API_KEY set — cannot fetch transcript');
              res.writeHead(200);
              res.end('OK — no API key configured');
              return;
            }

            // Fetch transcript from Fireflies GraphQL API
            const query = `query Transcript($transcriptId: String!) {
              transcript(id: $transcriptId) {
                title
                duration
                date
                host_email
                organizer_email
                participants
                speakers { id name }
                sentences { index speaker_name text start_time end_time }
                summary {
                  overview
                  short_summary
                  action_items
                  keywords
                  outline
                }
                meeting_attendees { displayName email }
                transcript_url
              }
            }`;

            console.log(`[fireflies] Fetching transcript ${meetingId} from Fireflies API...`);
            const gqlResponse = await fetch('https://api.fireflies.ai/graphql', {
              method: 'POST',
              headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${config.fireflies.apiKey}`,
              },
              body: JSON.stringify({ query, variables: { transcriptId: meetingId } }),
              signal: AbortSignal.timeout(30000),
            });

            if (!gqlResponse.ok) {
              const errText = await gqlResponse.text();
              console.error(`[fireflies] GraphQL API error ${gqlResponse.status}: ${errText}`);
              res.writeHead(200);
              res.end('OK — API fetch failed');
              return;
            }

            const gqlData = await gqlResponse.json();
            const transcript = gqlData.data?.transcript;
            if (!transcript) {
              console.warn('[fireflies] No transcript data in response');
              res.writeHead(200);
              res.end('OK — no transcript data');
              return;
            }

            const { title, duration, sentences, summary, speakers, meeting_attendees, transcript_url } = transcript;
            const durationMin = duration ? Math.round(duration / 60) : '?';
            const attendeeNames = (meeting_attendees || []).map(a => a.displayName || a.email).filter(Boolean).join(', ');
            console.log(`[fireflies] Transcript: "${title}" (${durationMin}min, ${sentences?.length || 0} sentences, ${speakers?.length || 0} speakers)`);

            // ============ Build meeting notes document ============
            const timestamp = new Date().toISOString().replace('T', ' ').slice(0, 19);
            let notes = `# ${title || 'Meeting'}\n`;
            notes += `**Date**: ${timestamp} | **Duration**: ${durationMin} min\n`;
            if (attendeeNames) notes += `**Attendees**: ${attendeeNames}\n`;
            if (transcript_url) notes += `**Transcript**: ${transcript_url}\n`;
            notes += '\n---\n\n';

            // Summary section
            if (summary) {
              if (summary.overview) notes += `## Overview\n${summary.overview}\n\n`;
              if (summary.action_items) notes += `## Action Items\n${summary.action_items}\n\n`;
              if (summary.keywords) notes += `## Keywords\n${summary.keywords}\n\n`;
              if (summary.outline) notes += `## Outline\n${summary.outline}\n\n`;
            }

            // Full transcript (speaker-grouped)
            if (sentences && sentences.length > 0) {
              notes += `## Transcript\n\n`;
              let lastSpeaker = '';
              for (const s of sentences) {
                if (s.speaker_name !== lastSpeaker) {
                  lastSpeaker = s.speaker_name;
                  notes += `\n**${s.speaker_name}**:\n`;
                }
                notes += `${s.text} `;
              }
              notes += '\n';
            }

            // ============ Persist to file ============
            const transcriptFile = join(config.dataDir, 'meeting-transcripts.md');
            const fileEntry = `\n\n---\n\n${notes}`;
            try {
              await appendFile(transcriptFile, fileEntry);
            } catch {
              await writeFile(transcriptFile, `# Meeting Transcripts\n\nPersisted automatically by Jarvis from Fireflies.ai.\n${fileEntry}`);
            }

            // ============ Send to JARVIS for analysis ============
            const chatId = config.transcriptChatId || config.ownerUserId;
            const shortSummary = summary?.short_summary || summary?.overview || 'No summary available.';
            const actionItems = summary?.action_items || 'None identified.';

            // Build condensed transcript for JARVIS (max ~3000 chars to avoid token blow-up)
            let condensed = '';
            if (sentences && sentences.length > 0) {
              let lastSpeaker = '';
              for (const s of sentences) {
                if (s.speaker_name !== lastSpeaker) {
                  lastSpeaker = s.speaker_name;
                  condensed += `\n[${s.speaker_name}]: `;
                }
                condensed += `${s.text} `;
                if (condensed.length > 3000) {
                  condensed += '\n... [transcript truncated]';
                  break;
                }
              }
            }

            const prompt = `[MEETING TRANSCRIPT COMPLETE: ${title || 'Meeting'}]\nDuration: ${durationMin} min | Attendees: ${attendeeNames || 'unknown'}\n\nSummary: ${shortSummary}\n\nAction Items: ${actionItems}\n\nTranscript:\n${condensed}\n\nYou are JARVIS. A meeting just ended. Provide:\n1. Your 2-3 sentence assessment of the key decisions/direction\n2. Anything you think was missed or under-discussed\n3. Concrete next steps you recommend\n4. Any concerns or risks you see\n\nBe direct and opinionated. This is your co-founder debrief.`;

            await bot.telegram.sendChatAction(chatId, 'typing');
            const response = await chat(chatId, 'fireflies-transcript', prompt, 'private');
            const jarvisText = response.text;

            // ============ Send to Telegram ============
            // Meeting header
            let tgHeader = `[Fireflies] Meeting: ${title || 'Meeting'}\n`;
            tgHeader += `Duration: ${durationMin}min | Speakers: ${speakers?.length || '?'}\n`;
            if (attendeeNames) tgHeader += `Attendees: ${attendeeNames}\n`;
            await bot.telegram.sendMessage(chatId, tgHeader);

            // AI summary
            if (shortSummary && shortSummary !== 'No summary available.') {
              await bot.telegram.sendMessage(chatId, `Summary: ${shortSummary.slice(0, 3000)}`);
            }

            // JARVIS analysis
            if (jarvisText) {
              const reply = `Jarvis: ${jarvisText}`;
              if (reply.length <= 4096) {
                await bot.telegram.sendMessage(chatId, reply);
              } else {
                for (let i = 0; i < reply.length; i += 4096) {
                  await bot.telegram.sendMessage(chatId, reply.slice(i, i + 4096));
                }
              }

              // TTS voice response — JARVIS MCU voice
              try {
                const voiceFile = await jarvisSpeak(jarvisText, 'fireflies');
                if (voiceFile) {
                  await bot.telegram.sendVoice(chatId, { source: voiceFile }, { caption: 'Jarvis' });
                  await ttsCleanup(voiceFile);
                }
              } catch (ttsErr) {
                console.warn('[fireflies] TTS failed:', ttsErr.message);
              }
            }

            // Persist JARVIS response
            try {
              await appendFile(transcriptFile, `\n## JARVIS Analysis\n${jarvisText}\n`);
            } catch { /* ignore */ }

            console.log(`[fireflies] Meeting "${title}" processed — ${sentences?.length || 0} sentences, notes saved`);
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ status: 'ok', title, sentences: sentences?.length || 0 }));
        } catch (err) {
            console.error('[fireflies] Webhook error:', err.message);
            res.writeHead(500);
            res.end(JSON.stringify({ error: err.message }));
        }

      // ============ GitHub Webhook — Live Push Feed to Telegram ============
      // Receives push events from GitHub and posts to the Telegram group.
      // Set up: GitHub repo → Settings → Webhooks → https://jarvis-vibeswap.fly.dev/github
      } else if (req.url === '/github' && req.method === 'POST') {
        try {
            const body = await readBody(req);
            const event = req.headers['x-github-event'];
            const payload = JSON.parse(body);

            if (event === 'push' && payload.commits?.length > 0) {
              const branch = payload.ref?.replace('refs/heads/', '') || 'unknown';
              const repo = payload.repository?.name || 'vibeswap';
              const pusher = payload.pusher?.name || 'unknown';
              const commits = payload.commits.slice(0, 5); // Max 5 commits

              const lines = [`[GitHub] ${pusher} pushed to ${repo}/${branch}`];
              for (const c of commits) {
                const msg = c.message.split('\n')[0].slice(0, 80);
                const files = (c.added?.length || 0) + (c.modified?.length || 0) + (c.removed?.length || 0);
                lines.push(`  ${c.id.slice(0, 7)} ${msg} (${files} files)`);
              }
              if (payload.commits.length > 5) {
                lines.push(`  ... and ${payload.commits.length - 5} more commits`);
              }

              // Post to community group if configured, otherwise to owner
              const chatId = config.communityGroupId || config.ownerUserId;
              await bot.telegram.sendMessage(chatId, lines.join('\n'));
              console.log(`[github] Push webhook: ${commits.length} commits by ${pusher} on ${branch}`);
            } else if (event === 'ping') {
              console.log(`[github] Webhook ping received — zen: ${payload.zen}`);
            }

            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ status: 'ok', event }));
        } catch (err) {
            console.error('[github] Webhook error:', err.message);
            res.writeHead(500);
            res.end(JSON.stringify({ error: err.message }));
        }

      // ============ Constellation — Interactive Star Map ============
      } else if (req.url?.startsWith('/theai/constellation')) {
        const cUrl = new URL(req.url, `http://localhost:${healthPort}`);
        await handleConstellationRequest(req, res, cUrl);

      // ============ TheAI — Digital Corporation Dashboard ============
      } else if (req.url?.startsWith('/theai')) {
        const aiUrl = new URL(req.url, `http://localhost:${healthPort}`);
        await handleTheAIRequest(req, res, aiUrl);

      // ============ Nyx — Agent Interface ============
      // Freedom's per-node interface: chat + file browser + editor + terminal
      } else if (req.url?.startsWith('/nyx')) {
        const nyxUrl = new URL(req.url, `http://localhost:${healthPort}`);
        await handleNyxRequest(req, res, nyxUrl);

      // ============ Mini App Static Files ============
      // Serves the built Jarvis Shard Miner webapp at /app/*
      } else if (req.url?.startsWith('/app/') || req.url === '/app') {
        const WEBAPP_DIR = join(process.cwd(), 'webapp', 'dist');
        const CONTENT_TYPES = {
          '.html': 'text/html; charset=utf-8',
          '.js': 'application/javascript; charset=utf-8',
          '.css': 'text/css; charset=utf-8',
          '.json': 'application/json; charset=utf-8',
          '.svg': 'image/svg+xml',
          '.png': 'image/png',
          '.ico': 'image/x-icon',
          '.woff2': 'font/woff2',
          '.woff': 'font/woff',
        };

        try {
          let filePath = req.url.replace(/^\/app\/?/, '') || 'index.html';
          // SPA fallback: if no extension, serve index.html
          if (!filePath.includes('.')) filePath = 'index.html';

          const fullPath = join(WEBAPP_DIR, filePath);
          // Prevent directory traversal
          if (!fullPath.startsWith(WEBAPP_DIR)) {
            res.writeHead(403);
            res.end('Forbidden');
            return;
          }

          const content = await readFile(fullPath);
          const ext = '.' + filePath.split('.').pop();
          const contentType = CONTENT_TYPES[ext] || 'application/octet-stream';

          // Cache hashed assets immutably, index.html never
          const cacheControl = filePath === 'index.html'
            ? 'no-cache'
            : 'public, max-age=31536000, immutable';

          res.writeHead(200, {
            'Content-Type': contentType,
            'Cache-Control': cacheControl,
          });
          res.end(content);
        } catch (err) {
          // Fallback to index.html for SPA routing
          try {
            const content = await readFile(join(WEBAPP_DIR, 'index.html'));
            res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-cache' });
            res.end(content);
          } catch {
            res.writeHead(404);
            res.end('Mini App not found. Run: cd webapp && npm run build');
          }
        }

      // ============ Web Portal API ============
      // Public-facing endpoints for the VibeSwap frontend.
      // Rate-limited per IP, CORS-restricted. No API secret needed.
      // ============ Voice Bridge ============
      } else if (req.url === '/voice') {
        try {
          const voiceHtml = await readFile(join(import.meta.dirname || '.', 'voice.html'), 'utf8');
          res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
          res.end(voiceHtml);
        } catch (err) {
          res.writeHead(500, { 'Content-Type': 'text/plain' });
          res.end('Voice bridge unavailable: ' + err.message);
        }

      } else if (req.url?.startsWith('/web/')) {
        const webUrl = new URL(req.url, `http://localhost:${healthPort}`);
        const handled = await handleWebRequest(req, res, webUrl.pathname);
        if (!handled) {
          res.writeHead(404, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'Not found' }));
        }

      // ============ Claude Code API Bridge ============
      // Direct HTTP communication — no human relay needed.
      // All /api/* routes require X-Api-Secret header.
      } else if (req.url?.startsWith('/api/')) {
        // Auth check
        const apiSecret = req.headers['x-api-secret'];
        if (!config.claudeCodeApiSecret || apiSecret !== config.claudeCodeApiSecret) {
          res.writeHead(401, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'Unauthorized' }));
          return;
        }

        const url = new URL(req.url, `http://localhost:${healthPort}`);
        const path = url.pathname;

        // GET /api/status — Full JARVIS status
        if (path === '/api/status' && req.method === 'GET') {
          try {
            const report = await diagnoseContext();
            const monStatus = monitorAvailable && getMonitorStatus ? getMonitorStatus() : 'Monitor unavailable';
            const commsStats = getCommsStats();
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({
              status: 'ok',
              uptime: process.uptime(),
              model: config.anthropic.model,
              context: { loaded: report.loaded.length, total: report.loaded.length + report.missing.length, chars: report.totalChars },
              monitor: monStatus,
              comms: commsStats,
              timestamp: new Date().toISOString(),
            }));
          } catch (err) {
            res.writeHead(500, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: err.message }));
          }

        // GET /api/intel?group=NervosNation&count=50 — Group intel
        } else if (path === '/api/intel' && req.method === 'GET') {
          if (!monitorAvailable || !getMessagesForAnalysis) {
            res.writeHead(503, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: 'Monitor not available' }));
            return;
          }
          const group = url.searchParams.get('group') || MONITORED_GROUPS[0] || 'NervosNation';
          const count = parseInt(url.searchParams.get('count') || '50', 10);
          const messages = getMessagesForAnalysis(group, count);
          const report = formatIntelReport(group);
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ group, messageCount: messages.length, messages, report }));

        // POST /api/message — Claude Code sends message/task to JARVIS
        } else if (path === '/api/message' && req.method === 'POST') {
          try {
              const body = await readBody(req);
              const payload = JSON.parse(body);
              const entry = receiveFromClaudeCode(payload);
              await saveComms();

              // If it's a task or message that should be forwarded to Telegram
              if (payload.notify && config.ownerUserId) {
                const prefix = payload.type === 'task' ? '[Claude Code Task]' : '[Claude Code]';
                const content = typeof payload.content === 'string' ? payload.content : JSON.stringify(payload.content);
                const text = `${prefix}\n${content.slice(0, 3000)}`;
                try {
                  await bot.telegram.sendMessage(config.ownerUserId, text);
                } catch { /* notification is best-effort */ }
              }

              // If it's a task, process it with Claude and queue the result
              if (payload.type === 'task' && payload.content) {
                const taskContent = typeof payload.content === 'string' ? payload.content : JSON.stringify(payload.content);
                try {
                  const response = await chat(config.ownerUserId, 'claude-code-bridge', taskContent, 'private');
                  sendToClaudeCode('task_result', response.text, { taskId: entry.id });
                  markProcessed(entry.id);
                  await saveComms();
                } catch (err) {
                  sendToClaudeCode('task_error', err.message, { taskId: entry.id });
                  markProcessed(entry.id);
                  await saveComms();
                }
              } else {
                markProcessed(entry.id);
                await saveComms();
              }

              res.writeHead(200, { 'Content-Type': 'application/json' });
              res.end(JSON.stringify({ ok: true, id: entry.id }));
          } catch (err) {
              res.writeHead(400, { 'Content-Type': 'application/json' });
              res.end(JSON.stringify({ error: err.message }));
          }

        // GET /api/outbox — Messages JARVIS has queued for Claude Code
        } else if (path === '/api/outbox' && req.method === 'GET') {
          const messages = getOutbox();
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ count: messages.length, messages }));

        // POST /api/outbox/ack — Claude Code acknowledges receipt
        } else if (path === '/api/outbox/ack' && req.method === 'POST') {
          try {
              const body = await readBody(req);
              const payload = JSON.parse(body);
              acknowledgeOutbox(payload.ids || 'all');
              await saveComms();
              res.writeHead(200, { 'Content-Type': 'application/json' });
              res.end(JSON.stringify({ ok: true }));
          } catch (err) {
              res.writeHead(400, { 'Content-Type': 'application/json' });
              res.end(JSON.stringify({ error: err.message }));
          }

        // GET /api/comms/log — Audit trail
        } else if (path === '/api/comms/log' && req.method === 'GET') {
          const count = parseInt(url.searchParams.get('count') || '20', 10);
          const log = getCommsLog(count);
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ count: log.length, log }));

        // POST /api/tg/send — Send a message to Telegram via JARVIS
        } else if (path === '/api/tg/send' && req.method === 'POST') {
          try {
              const body = await readBody(req);
              const payload = JSON.parse(body);
              const chatId = payload.chatId || config.ownerUserId;
              const text = payload.text || payload.message || '';
              if (!text) {
                res.writeHead(400, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ error: 'text is required' }));
                return;
              }
              await bot.telegram.sendMessage(chatId, text, { parse_mode: undefined });
              res.writeHead(200, { 'Content-Type': 'application/json' });
              res.end(JSON.stringify({ ok: true, chatId }));
          } catch (err) {
              res.writeHead(500, { 'Content-Type': 'application/json' });
              res.end(JSON.stringify({ error: err.message }));
          }

        } else {
          res.writeHead(404, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'Unknown API route', available: [
            'GET /api/status',
            'GET /api/intel?group=&count=',
            'POST /api/message',
            'GET /api/outbox',
            'POST /api/outbox/ack',
            'GET /api/comms/log?count=',
            'POST /api/tg/send',
            'POST /router/register',
            'POST /router/heartbeat',
            'GET /router/route/:userId',
            'GET /router/topology',
          ]}));
        }

      // ============ Shard Proxy Processing ============
      // Allows any shard (including primary) to process messages forwarded from peers
      } else if (req.url === '/shard/process' && req.method === 'POST') {
        try {
            const body = await readBody(req);
            const payload = JSON.parse(body);
            const response = await chat(
              payload.chatId || 'proxy',
              payload.userName || 'proxy',
              payload.text,
              payload.chatType || 'private'
            );
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ ok: true, text: response.text, shardId: getShardInfo().id }));
        } catch (err) {
            res.writeHead(500, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: err.message }));
        }

      // ============ Router API (Shard Network) ============
      } else if (req.url?.startsWith('/router/')) {
        const routerUrl = new URL(req.url, `http://localhost:${healthPort}`);
        const routerResult = handleRouterRequest(req, routerUrl);

        if (!routerResult) {
          res.writeHead(404, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'Unknown router route' }));
        } else if (routerResult.parse) {
          try {
              const body = await readBody(req);
              const payload = JSON.parse(body);
              const data = processRouterBody(routerResult.handler, payload, routerResult.userId);
              res.writeHead(200, { 'Content-Type': 'application/json' });
              res.end(JSON.stringify(data));
          } catch (err) {
              res.writeHead(400, { 'Content-Type': 'application/json' });
              res.end(JSON.stringify({ error: err.message }));
          }
        } else {
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify(routerResult.data));
        }

      // ============ Consensus API (BFT + CRPC) ============
      } else if (req.url?.startsWith('/consensus/') || req.url?.startsWith('/crpc/')) {
        const reqUrl = new URL(req.url, `http://localhost:${healthPort}`);
        const path = reqUrl.pathname;

        // Consensus endpoints
        const consensusHandler = handleConsensusRequest(path, req.method);
        if (consensusHandler) {
          if (consensusHandler === 'state') {
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify(getConsensusState()));
          } else {
            try {
              const body = await readBody(req);
              const payload = JSON.parse(body);
              const signature = req.headers['x-shard-signature'] || null;
              const data = await processConsensusBody(consensusHandler, payload, signature);
              res.writeHead(200, { 'Content-Type': 'application/json' });
              res.end(JSON.stringify(data || { ok: true }));
            } catch (err) {
              res.writeHead(400, { 'Content-Type': 'application/json' });
              res.end(JSON.stringify({ error: err.message }));
            }
          }
          return;
        }

        // CORS for CRPC endpoints (frontend at Vercel needs cross-origin access)
        const crpcCors = {
          'Access-Control-Allow-Origin': config.web?.corsOrigins?.[0] || '*',
          'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
          'Access-Control-Allow-Headers': 'Content-Type',
        };
        if (req.url?.startsWith('/crpc/') && req.method === 'OPTIONS') {
          res.writeHead(204, crpcCors);
          res.end();
          return;
        }

        // CRPC endpoints
        const crpcHandler = handleCRPCRequest(path, req.method);
        if (crpcHandler) {
          if (crpcHandler === 'stats' || crpcHandler === 'protocol' || crpcHandler === 'dashboard') {
            const data = await processCRPCBody(crpcHandler);
            if (data?._html) {
              res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', ...crpcCors });
              res.end(data._html);
            } else {
              res.writeHead(200, { 'Content-Type': 'application/json', ...crpcCors });
              res.end(JSON.stringify(data, null, 2));
            }
          } else if (crpcHandler === 'demo') {
            // Demo endpoint — runs full 4-phase CRPC with real LLM calls
            // Supports GET (default prompt) and POST { prompt: "..." }
            try {
              let prompt = null;
              if (req.method === 'POST') {
                const body = await readBody(req);
                if (body) prompt = JSON.parse(body).prompt;
              }
              const trace = await runCRPCDemo(prompt);
              res.writeHead(200, { 'Content-Type': 'application/json', ...crpcCors });
              res.end(JSON.stringify(trace, null, 2));
            } catch (err) {
              res.writeHead(500, { 'Content-Type': 'application/json', ...crpcCors });
              res.end(JSON.stringify({ error: err.message, stack: err.stack?.split('\n').slice(0, 3) }));
            }
          } else {
            try {
              const body = await readBody(req);
              const payload = JSON.parse(body);
              const data = await processCRPCBody(crpcHandler, payload);
              res.writeHead(200, { 'Content-Type': 'application/json' });
              res.end(JSON.stringify(data));
            } catch (err) {
              res.writeHead(400, { 'Content-Type': 'application/json' });
              res.end(JSON.stringify({ error: err.message }));
            }
          }
          return;
        }

        res.writeHead(404, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Unknown consensus/crpc route' }));

      // ============ Knowledge Chain API ============
      } else if (req.url?.startsWith('/knowledge-chain/') || req.url?.startsWith('/knowledge/')) {
        const kcUrl = new URL(req.url, `http://localhost:${healthPort}`);
        const kcPath = kcUrl.pathname;
        const kcHandler = handleKnowledgeChainRequest(kcPath, req.method);

        if (!kcHandler) {
          res.writeHead(404, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'Unknown knowledge-chain route' }));
        } else if (kcHandler === 'epoch') {
          try {
              const body = await readBody(req);
              const payload = JSON.parse(body);
              const data = await processKnowledgeChainBody(kcHandler, payload);
              res.writeHead(200, { 'Content-Type': 'application/json' });
              res.end(JSON.stringify(data));
          } catch (err) {
              res.writeHead(400, { 'Content-Type': 'application/json' });
              res.end(JSON.stringify({ error: err.message }));
          }
        } else {
          const query = Object.fromEntries(kcUrl.searchParams);
          const data = await processKnowledgeChainBody(kcHandler, null, query);
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify(data));
        }
      // ============ Shard Update Receiver ============
      // Receives dispatched TG updates from the shard router
      } else if (req.url === '/shard/update' && req.method === 'POST') {
        try {
          const body = await readBody(req);
          const update = JSON.parse(body);
          // Feed the update directly into Telegraf's processing pipeline
          await bot.handleUpdate(update);
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ ok: true }));
        } catch (err) {
          console.error(`[shard] Update processing failed: ${err.message}`);
          res.writeHead(500, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: err.message }));
        }

      // ============ Cross-Shard Learning Bus Receiver ============
      // Receives learned insights from other shards (via router broadcast)
      } else if (req.url === '/shard/learn' && req.method === 'POST') {
        try {
          const body = await readBody(req);
          const { type, data, fromShard } = JSON.parse(body);
          console.log(`[shard] Learning from ${fromShard}: ${type}`);

          // Process different learning types
          switch (type) {
            case 'token_alert':
              // Another shard found a good token — surface it here too
              if (data.chatId && data.message) {
                await bot.telegram.sendMessage(data.chatId, `[Cross-shard from ${fromShard}]\n${data.message}`).catch(() => {});
              }
              break;
            case 'insight':
              // General insight — log for now, will integrate into context later
              console.log(`[shard] Insight from ${fromShard}: ${JSON.stringify(data).slice(0, 200)}`);
              break;
            case 'ckb_update':
              // CKB knowledge propagation — another shard learned something important
              console.log(`[shard] CKB update from ${fromShard}: ${data.key}`);
              break;
            default:
              console.log(`[shard] Unknown learning type: ${type}`);
          }

          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ ok: true }));
        } catch (err) {
          console.error(`[shard] Learn processing failed: ${err.message}`);
          res.writeHead(500, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: err.message }));
        }

      } else {
        res.writeHead(404);
        res.end('Not found');
      }
    });
    global._httpServer = httpServer;
    httpServer.listen(healthPort, () => {
      console.log(`[jarvis] Health endpoint: http://0.0.0.0:${healthPort}/health`);
      console.log(`[jarvis] Transcript webhook: http://0.0.0.0:${healthPort}/transcript`);
      console.log(`[jarvis] Fireflies webhook: http://0.0.0.0:${healthPort}/fireflies ${config.fireflies?.apiKey ? '(API key set)' : '(no API key)'}`);
      console.log(`[jarvis] Claude Code API: http://0.0.0.0:${healthPort}/api/* ${config.claudeCodeApiSecret ? '(secured)' : '(NO SECRET SET — disabled)'}`);
      console.log(`[jarvis] Web Portal API: http://0.0.0.0:${healthPort}/web/* (public, rate-limited)`);
      console.log(`[jarvis] Mini App: http://0.0.0.0:${healthPort}/app/ (Telegram WebApp)`);
      console.log(`[jarvis] Shard endpoints: /shard/update, /shard/learn`);
    });
  }

  // Register commands with Telegram (shows in command menu)
  try {
    await bot.telegram.setMyCommands([
      { command: 'start', description: 'Start JARVIS' },
      { command: 'whoami', description: 'Show your Telegram user info' },
      { command: 'mystats', description: 'Your contribution profile' },
      { command: 'groupstats', description: 'Group contribution stats' },
      { command: 'linkwallet', description: 'Link your wallet address' },
      { command: 'connect', description: 'Connect wallet for VIBE rewards' },
      { command: 'vibe', description: 'Your VIBE balance + daily rate' },
      { command: 'vibelb', description: 'VIBE leaderboard — top earners' },
      { command: 'walletstatus', description: 'Wallet status + VIBE balance' },
      { command: 'linkminer', description: 'Link mobile miner to Telegram' },
      { command: 'digest', description: 'Daily community digest' },
      { command: 'weeklydigest', description: 'Weekly community digest' },
      { command: 'archive', description: 'Archive current conversation thread' },
      { command: 'threads', description: 'View archived threads' },
      { command: 'brain', description: 'JARVIS intelligence stats' },
      { command: 'modlog', description: 'View moderation log' },
      { command: 'spamlog', description: 'View anti-spam log' },
      { command: 'health', description: 'JARVIS health check' },
      { command: 'model', description: 'Switch AI model (opus/sonnet)' },
      { command: 'clear', description: 'Clear conversation history' },
      { command: 'backlog', description: 'View/add suggestion backlog' },
      { command: 'learned', description: 'Learning stats' },
      { command: 'knowledge', description: 'View learned knowledge (add "group" for group)' },
      { command: 'skills', description: 'View skills learned from corrections' },
      { command: 'privacy', description: 'Encryption status (owner only)' },
      { command: 'inner', description: 'Inner dialogue / self-reflection (owner only)' },
      { command: 'shard', description: 'Shard identity and status (owner only)' },
      { command: 'network', description: 'Mind Network topology (owner only)' },
      { command: 'mine', description: 'Launch shard miner (Mini App)' },
      { command: 'balance', description: 'JUL balance, compute stats, CKB info' },
      { command: 'economy', description: 'Pool-level compute economics (owner)' },
      { command: 'tip', description: 'Tip jar address' },
      { command: 'quality', description: 'Wardenclyffe intelligence level' },
    ]);
  } catch {}

  // Write running heartbeat
  await writeHeartbeat('running');

  // Notify owner of boot status
  try {
    const lines = ['JARVIS online.'];
    if (!lastShutdown.clean && !lastShutdown.firstBoot) {
      lines[0] = `JARVIS online. (unclean shutdown detected — down ~${lastShutdown.downtime}min)`;
    }
    lines.push(`Context: ${report.loaded.length}/${report.loaded.length + report.missing.length} files (${report.totalChars} chars)`);
    if (report.missing.length > 0) {
      lines.push(`Missing: ${report.missing.join(', ')}`);
    }
    lines.push(`Model: ${config.anthropic.model}`);
    lines.push(`Shard: ${shardResult.id} (${isMultiShard() ? 'multi' : 'single'}-shard)`);
    await bot.telegram.sendMessage(config.ownerUserId, lines.join('\n'));
  } catch (err) {
    console.warn(`[jarvis] Could not notify owner: ${err.message}`);
  }

  // Flush all data every 5 minutes — harmonic tick (all shards pulse at same wall-clock boundary)
  scheduleHarmonicTick(async () => {
    await flushTracker();
    await saveConversations();
    await flushModeration();
    await flushAntispam();
    await flushThreads();
    await flushLearning();
    await flushCollisionHistory();
    try { await readLearnings(); await archiveExpired(); } catch {}
    // Inner dialogue: generate self-reflections (rate-limited to 1x/hour internally)
    try {
      const stats = await getLearningStats(config.ownerUserId, null);
      const skills = getSkills();
      await generateInnerDialogue(stats, skills);
    } catch (err) {
      console.warn(`[jarvis] Inner dialogue generation error: ${err.message}`);
    }
    await flushInnerDialogue();
    await flushShadow();
    await flushOperators();
    await flushCRPC();
    await persistChain();
    await flushHell();
    await flushLimni();
    await flushContextMemory();
    await flushPreferences();
    await flushScheduler();
    await flushTaskQueue();
    flushWallet();
    flushSocialOutbound();
    flushProactive();
    await flushGroupContext();
    await flushXP();
    await flushEmissions();
    await flushPredictions();
    await flushSocial();
    await flushAutonomous();
    await flushDirectives();
    // CKB compression: compress high-utilization CKBs periodically
    try {
      await compressCKB(config.ownerUserId);
    } catch {}
    pruneOldMessages();
    await saveComms();
    // Check shard health (mark dead shards, trigger failover)
    if (isMultiShard()) {
      checkShardHealth();
    }
    // Knowledge chain: produce epoch + sync + broadcast + retry missed
    const epoch = await produceEpoch();
    if (epoch && isMultiShard()) {
      await broadcastEpoch(epoch);
      await retryMissedEpochs();
      await syncWithPeers();
    }
    // Anchor: periodically commit Merkle super-roots to local proof chain
    await maybeAnchor();
  }, 5 * 60 * 1000);

  // Scheduled daily digest — send at configured hour (default 18:00 UTC)
  const digestHour = config.digestHour || 18;
  setInterval(async () => {
    const now = new Date();
    if (now.getUTCHours() === digestHour && now.getUTCMinutes() === 0) {
      if (config.communityGroupId) {
        try {
          const digest = await generateDigest(config.communityGroupId);
          if (digest) {
            await bot.telegram.sendMessage(config.communityGroupId, digest);
          }
        } catch (err) { console.warn(`[digest] Failed: ${err.message}`); }
      }
    }
  }, 60 * 1000); // Check every minute

  // VIBE emission tick — distribute VIBE to active users every hour
  setInterval(async () => {
    try {
      await processEmissionTick();
    } catch (err) { console.warn(`[vibe-emissions] Tick failed: ${err.message}`); }
  }, 60 * 60 * 1000); // Every hour

  // Auto-sync: pull from git + reload context periodically
  if (config.autoSyncInterval > 0) {
    setInterval(async () => {
      try {
        const pullResult = await gitPull();
        if (!pullResult.includes('0 changes, 0 insertions, 0 deletions')) {
          await reloadSystemPrompt();
          // Re-read shard learnings after git pull brings new entries
          await readLearnings();
        }
      } catch (err) { console.warn(`[auto-sync] Failed: ${err.message}`); }
    }, config.autoSyncInterval);
  }

  if (config.autoBackupInterval > 0) {
    setInterval(async () => {
      try { await backupData(); } catch (err) { console.warn(`[auto-backup] Failed: ${err.message}`); }
    }, config.autoBackupInterval);
  }

  // Reputation: refresh scores from tracker data every 10 minutes
  setInterval(async () => {
    try {
      const { updateScore } = await import('./reputation-consensus.js');
      const allUsers = getAllUsers();
      for (const [id, user] of Object.entries(allUsers)) {
        const stats = getUserStats(user.telegramId);
        if (stats && stats.contributions > 0) {
          updateScore(id, stats);
        }
      }
      await flushReputation();
    } catch (err) { console.warn(`[reputation] Refresh failed: ${err.message}`); }
  }, 10 * 60 * 1000);

  // Heartbeat: update every 5 minutes to prove we're alive
  setInterval(() => writeHeartbeat('running'), 5 * 60 * 1000);

  // ============ Memory Health Monitor ============
  // Fly.io gives us 512MB. If we approach that, we'll get OOM-killed with no warning.
  // Monitor heap usage and take progressive action:
  //   - 70% (358MB): Log warning, hint GC
  //   - 80% (410MB): Alert Will, force GC if available, trim caches
  //   - 90% (461MB): Save state and restart process cleanly (better than OOM kill)
  const MEM_CHECK_INTERVAL = 2 * 60 * 1000; // Every 2 min
  const MEM_LIMIT_MB = 512;
  let lastMemAlert = 0;
  setInterval(async () => {
    const mem = process.memoryUsage();
    const rssMB = Math.round(mem.rss / 1024 / 1024);
    const heapMB = Math.round(mem.heapUsed / 1024 / 1024);
    const pct = Math.round(rssMB / MEM_LIMIT_MB * 100);

    if (pct >= 90) {
      // CRITICAL — save state and restart before OOM
      console.error(`[mem-monitor] CRITICAL: ${rssMB}MB / ${MEM_LIMIT_MB}MB (${pct}%) — restarting to avoid OOM`);
      try {
        await bot.telegram.sendMessage(config.ownerUserId,
          `[MEM-MONITOR] CRITICAL: ${rssMB}MB (${pct}%). Restarting to avoid OOM kill.`
        );
      } catch {}
      await persistCrashEntry('mem_restart', { message: `RSS ${rssMB}MB (${pct}%)`, heap: heapMB });
      try { await saveConversations(); } catch {}
      try { await writeHeartbeat('mem_restart'); } catch {}
      try { await releaseInstanceLock(); } catch {}
      process.exit(1); // Fly.io will restart us
    } else if (pct >= 80) {
      // WARNING — trim caches, alert (max once per 10min)
      if (Date.now() - lastMemAlert > 10 * 60 * 1000) {
        console.warn(`[mem-monitor] WARNING: ${rssMB}MB / ${MEM_LIMIT_MB}MB (${pct}%)`);
        try {
          await bot.telegram.sendMessage(config.ownerUserId,
            `[MEM-MONITOR] Warning: ${rssMB}MB (${pct}%). Trimming caches...`
          );
        } catch {}
        lastMemAlert = Date.now();
      }
      // Trim conversation cache — keep only last 20 per chat instead of unlimited
      trimConversationCache(20);
      // Hint GC if exposed
      if (global.gc) global.gc();
    } else if (pct >= 70) {
      // Hint GC proactively
      if (global.gc) global.gc();
    }
  }, MEM_CHECK_INTERVAL);

  // ============ Status Pulse — Smart Frequency ============
  // Instead of spamming every 3min (480 DMs/day), pulse every 30min normally.
  // BUT: immediately notify on state changes (degradation, memory warnings, recovery).
  const STATUS_PULSE_INTERVAL = 30 * 60 * 1000; // 30 min (was 3 min)
  let lastPulseState = { degraded: false, memWarning: false, pollingOk: true };
  setInterval(async () => {
    try {
      const uptime = process.uptime();
      const uptimeStr = uptime > 3600
        ? `${Math.floor(uptime / 3600)}h ${Math.floor((uptime % 3600) / 60)}m`
        : `${Math.floor(uptime / 60)}m`;
      const mem = process.memoryUsage();
      const memMB = Math.round(mem.rss / 1024 / 1024);
      const heapMB = Math.round(mem.heapUsed / 1024 / 1024);
      const provider = getProviderName();
      const model = getModelName();
      const degradation = checkDegradation();
      const shardInfo = getShardInfo();

      // Memory warning threshold — 80% of 512MB limit
      const MEM_WARN_MB = 410;
      const memWarning = memMB > MEM_WARN_MB;

      // Detect state changes for immediate notification
      const currentState = {
        degraded: !!degradation?.degraded,
        memWarning,
        pollingOk: pollingRestartAttempts === 0,
      };
      const stateChanged = (
        currentState.degraded !== lastPulseState.degraded ||
        currentState.memWarning !== lastPulseState.memWarning ||
        currentState.pollingOk !== lastPulseState.pollingOk
      );
      lastPulseState = currentState;

      const parts = [`JARVIS | up ${uptimeStr} | ${memMB}MB (heap ${heapMB}MB) | ${provider}/${model}`];
      if (degradation?.degraded) {
        parts.push(`DEGRADED: ${degradation.provider} (${degradation.quality}% quality)`);
      }
      if (memWarning) {
        parts.push(`MEM WARNING: ${memMB}MB / 512MB (${Math.round(memMB / 512 * 100)}%)`);
      }
      if (shardInfo?.peers?.length > 0) {
        parts.push(`peers: ${shardInfo.peers.length}`);
      }
      if (stateChanged) {
        parts.unshift('[STATE CHANGE]');
      }
      await bot.telegram.sendMessage(config.ownerUserId, parts.join('\n'));
    } catch {}
  }, STATUS_PULSE_INTERVAL);

  // Graceful shutdown — save everything + mark clean shutdown
  // Hard timeout: 20s max to prevent Fly.io forced kill (30s default)
  async function gracefulShutdown(signal) {
    console.log(`[jarvis] Shutting down (${signal}) — saving all data...`);
    const shutdownTimer = setTimeout(() => {
      console.error('[jarvis] SHUTDOWN TIMEOUT (20s) — forcing exit');
      process.exit(1);
    }, 20000);

    const flushOps = [
      ['shard', shutdownShard],
      ['tracker', flushTracker],
      ['conversations', saveConversations],
      ['moderation', flushModeration],
      ['antispam', flushAntispam],
      ['threads', flushThreads],
      ['learning', flushLearning],
      ['inner-dialogue', flushInnerDialogue],
      ['shadow', flushShadow],
      ['operators', flushOperators],
      ['crpc', flushCRPC],
      ['chain', persistChain],
      ['compute', flushComputeEconomics],
      ['mining', flushMining],
      ['preferences', flushPreferences],
      ['scheduler', flushScheduler],
      ['task-queue', flushTaskQueue],
      ['wallet', flushWallet],
      ['social-outbound', flushSocialOutbound],
      ['proactive', flushProactive],
      ['group-context', flushGroupContext],
      ['xp', flushXP],
      ['emissions', flushEmissions],
      ['predictions', flushPredictions],
      ['social', flushSocial],
      ['autonomous', flushAutonomous],
      ['broadcast', flushBroadcast],
      ['directives', flushDirectives],
      ['reputation', flushReputation],
      ['comms', saveComms],
      ['user-memory', flushUserMemory],
      ['timezones', flushTimezones],
      ['attribution', flushAttribution],
      ['relay', flushRelay],
    ];

    let flushed = 0;
    for (const [name, fn] of flushOps) {
      try { await fn(); flushed++; } catch (err) {
        console.error(`[shutdown] ${name} flush failed: ${err.message}`);
      }
    }
    console.log(`[jarvis] Flushed ${flushed}/${flushOps.length} modules`);

    stopScheduler();
    stopTaskQueue();
    stopProactive();
    nervosStopSchedule();
    stopAutonomous();
    stopGroupContext();
    stopCRPC();
    // Close HTTP server — stop accepting new connections during shutdown
    if (global._httpServer) {
      global._httpServer.close();
    }
    await writeHeartbeat('stopped');
    await releaseInstanceLock();
    clearTimeout(shutdownTimer);
    bot.stop(signal);
  }
  process.once('SIGINT', () => gracefulShutdown('SIGINT'));
  process.once('SIGTERM', () => gracefulShutdown('SIGTERM'));
}

// ============ Persistent Crash Log ============
// Writes errors to DATA_DIR so they survive restarts.
// Fly.io logs are ephemeral — this is the permanent record.

const CRASH_LOG_FILE = join(config.dataDir, 'crash-log.jsonl');
const MAX_CRASH_LOG_BYTES = 512 * 1024; // 512KB cap

async function persistCrashEntry(type, error) {
  const entry = {
    type,
    timestamp: new Date().toISOString(),
    message: error?.message || String(error),
    stack: error?.stack || null,
    uptime: process.uptime(),
    pid: process.pid,
    memory: process.memoryUsage(),
  };
  const line = JSON.stringify(entry) + '\n';
  try {
    // Rotate if too large
    try {
      const { size } = await import('fs').then(fs => fs.promises.stat(CRASH_LOG_FILE));
      if (size > MAX_CRASH_LOG_BYTES) {
        const data = await readFile(CRASH_LOG_FILE, 'utf-8');
        const lines = data.trim().split('\n');
        // Keep the most recent half
        await writeFile(CRASH_LOG_FILE, lines.slice(Math.floor(lines.length / 2)).join('\n') + '\n');
      }
    } catch { /* file doesn't exist yet */ }
    await appendFile(CRASH_LOG_FILE, line);
  } catch { /* last resort — can't write to disk */ }
}

// ============ Process-Level Crash Guards ============
// Prevent transient errors (API timeouts, network blips, Telegram errors)
// from killing the entire process. Log to console AND persistent file.

process.on('uncaughtException', (err) => {
  console.error('[jarvis] UNCAUGHT EXCEPTION (process survived):', err.message);
  console.error(err.stack);
  persistCrashEntry('uncaughtException', err);
});

process.on('unhandledRejection', (reason) => {
  console.error('[jarvis] UNHANDLED REJECTION (process survived):', reason);
  persistCrashEntry('unhandledRejection', reason instanceof Error ? reason : { message: String(reason) });
});

main().catch((err) => {
  console.error('[jarvis] FATAL — main() crashed:', err.message);
  console.error(err.stack);
  persistCrashEntry('fatal', err).finally(() => {
    // If main() itself fails (startup error), exit so Fly restarts us
    process.exit(1);
  });
});
