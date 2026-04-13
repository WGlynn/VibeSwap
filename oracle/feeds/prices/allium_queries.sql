-- ============================================================
-- ALLIUM EXPLORER QUERIES — VibeSwap Research
-- Run at: app.allium.so (Explorer tab)
-- Budget: 5 of 100 Explorer credits
-- Each query replaces 1000-10000 Developer API calls
-- ============================================================


-- ============================================================
-- QUERY 1: GEV Sandwich Frequency by Chain + DEX
-- Cost: 1 Explorer credit
-- Replaces: ~5000 API calls
-- Use in: "Cross-Chain MEV Tax" Medium article
-- ============================================================

SELECT
    chain,
    dex_name,
    COUNT(*) as total_trades,
    COUNT(CASE WHEN swap_count > 2 THEN 1 END) as multi_swap_txs,
    ROUND(
        COUNT(CASE WHEN swap_count > 2 THEN 1 END) * 100.0 / NULLIF(COUNT(*), 0),
        2
    ) as multi_swap_pct,
    ROUND(AVG(amount_usd), 2) as avg_trade_size_usd,
    ROUND(SUM(amount_usd), 2) as total_volume_usd,
    COUNT(DISTINCT sender) as unique_traders
FROM crosschain.dex.trades_evm
WHERE block_timestamp >= CURRENT_TIMESTAMP - INTERVAL '7 days'
    AND amount_usd > 100
GROUP BY chain, dex_name
ORDER BY total_volume_usd DESC
LIMIT 50;


-- ============================================================
-- QUERY 2: Cross-Chain Price Divergence (Hourly)
-- Cost: 1 Explorer credit
-- Replaces: ~10000 API calls
-- Use in: Kalman filter observation noise calibration
-- ============================================================

SELECT
    DATE_TRUNC('hour', block_timestamp) as hour,
    token_out_symbol,
    chain,
    ROUND(AVG(amount_usd / NULLIF(token_out_amount, 0)), 4) as avg_price,
    ROUND(STDDEV(amount_usd / NULLIF(token_out_amount, 0)), 6) as price_stddev,
    COUNT(*) as trade_count,
    ROUND(SUM(amount_usd), 2) as volume_usd
FROM crosschain.dex.trades_evm
WHERE block_timestamp >= CURRENT_TIMESTAMP - INTERVAL '24 hours'
    AND token_out_symbol IN ('WETH', 'USDC', 'USDT', 'WBTC')
    AND amount_usd > 1000
    AND token_out_amount > 0
GROUP BY 1, 2, 3
HAVING COUNT(*) >= 5
ORDER BY hour DESC, token_out_symbol, chain;


-- ============================================================
-- QUERY 3: Natural Batch Sizes in 10-Second Windows
-- Cost: 1 Explorer credit
-- Replaces: ~2000 API calls
-- Use in: Validates 8s commit + 2s reveal window design
-- ============================================================

SELECT
    chain,
    DATE_TRUNC('minute', block_timestamp) as minute,
    COUNT(*) as trades_per_minute,
    COUNT(DISTINCT transaction_hash) as unique_txs,
    ROUND(SUM(amount_usd), 2) as volume_usd,
    ROUND(MAX(amount_usd), 2) as largest_trade_usd,
    ROUND(MIN(amount_usd), 2) as smallest_trade_usd,
    ROUND(AVG(amount_usd), 2) as avg_trade_usd
FROM crosschain.dex.trades_evm
WHERE block_timestamp >= CURRENT_TIMESTAMP - INTERVAL '1 hour'
    AND chain = 'ethereum'
    AND amount_usd > 100
GROUP BY 1, 2
ORDER BY trades_per_minute DESC
LIMIT 100;


-- ============================================================
-- QUERY 4: Stablecoin Peg Deviation Across Chains
-- Cost: 1 Explorer credit
-- Replaces: ~3000 API calls
-- Use in: Oracle StablecoinConfig validation
-- ============================================================

SELECT
    chain,
    token_out_symbol as stablecoin,
    DATE_TRUNC('hour', block_timestamp) as hour,
    ROUND(AVG(amount_usd / NULLIF(token_out_amount, 0)), 6) as implied_price,
    ROUND(ABS(AVG(amount_usd / NULLIF(token_out_amount, 0)) - 1.0) * 10000, 2) as deviation_bps,
    COUNT(*) as trade_count,
    ROUND(SUM(amount_usd), 2) as volume_usd
FROM crosschain.dex.trades_evm
WHERE block_timestamp >= CURRENT_TIMESTAMP - INTERVAL '7 days'
    AND token_out_symbol IN ('USDC', 'USDT', 'DAI')
    AND amount_usd > 500
    AND token_out_amount > 0
GROUP BY 1, 2, 3
HAVING COUNT(*) >= 3
ORDER BY deviation_bps DESC
LIMIT 200;


-- ============================================================
-- QUERY 5: Top Volume Wallets (LP / Bot Detection)
-- Cost: 1 Explorer credit
-- Replaces: ~5000 API calls
-- Use in: Circuit breaker threshold calibration
-- ============================================================

SELECT
    chain,
    sender,
    COUNT(*) as trade_count,
    COUNT(DISTINCT dex_name) as dexes_used,
    ROUND(SUM(amount_usd), 2) as total_volume_usd,
    ROUND(AVG(amount_usd), 2) as avg_trade_size,
    MIN(block_timestamp) as first_trade,
    MAX(block_timestamp) as last_trade,
    ROUND(
        EXTRACT(EPOCH FROM MAX(block_timestamp) - MIN(block_timestamp)) / NULLIF(COUNT(*) - 1, 0),
        1
    ) as avg_seconds_between_trades
FROM crosschain.dex.trades_evm
WHERE block_timestamp >= CURRENT_TIMESTAMP - INTERVAL '24 hours'
    AND chain = 'ethereum'
    AND amount_usd > 100
GROUP BY 1, 2
HAVING COUNT(*) >= 10
ORDER BY total_volume_usd DESC
LIMIT 50;
