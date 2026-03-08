// ============ Education & Community Tools ============
//
// Making Jarvis the best crypto teacher + community builder in Telegram.
// Free APIs: CoinGecko, Wikipedia, various.
//
// Commands:
//   /explain <concept>     — Explain a crypto/DeFi concept in simple terms
//   /quiz                  — Daily crypto knowledge challenge
//   /cryptohistory         — What happened in crypto on this date?
//   /glossary <term>       — Quick glossary lookup (200+ terms)
//   /leaderboard           — Community engagement leaderboard
//   /streak                — Your daily activity streak
//   /vibeswap <topic>      — Explain a VibeSwap mechanism
//   /timeline              — VibeSwap development timeline
//   /tutorial <topic>      — Step-by-step DeFi tutorial
//   /cryptocalendar        — Upcoming crypto events (7 days)
// ============

const HTTP_TIMEOUT = 12000;

// ============ Helpers ============

async function fetchJSON(url) {
  const resp = await fetch(url, {
    signal: AbortSignal.timeout(HTTP_TIMEOUT),
    headers: { 'Accept': 'application/json' },
  });
  if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
  return resp.json();
}

// ============ Explain Concept (Wikipedia + Claude context) ============

export async function explainConcept(concept) {
  if (!concept || concept.trim().length === 0) {
    return 'Usage: /explain <concept>\nExample: /explain impermanent loss';
  }

  const term = concept.trim().toLowerCase();

  // Check hardcoded explanations first for crypto-specific accuracy
  const hardcoded = CONCEPT_EXPLAINERS[term];
  if (hardcoded) return hardcoded;

  // Try Wikipedia for general concepts
  try {
    const encoded = encodeURIComponent(concept.trim().replace(/\s+/g, '_'));
    const data = await fetchJSON(`https://en.wikipedia.org/api/rest_v1/page/summary/${encoded}`);
    if (data.extract) {
      const extract = data.extract.length > 300 ? data.extract.slice(0, 300) + '...' : data.extract;
      return `${data.title}\n\n${extract}\n\nSource: Wikipedia`;
    }
  } catch {
    // Wikipedia didn't have it — fall through
  }

  // Check glossary as fallback
  const glossaryResult = searchGlossary(term);
  if (glossaryResult) return glossaryResult;

  return `I don't have an explanation for "${concept}" yet. Try /glossary <term> for quick definitions, or ask me directly and I'll use my knowledge to explain.`;
}

const CONCEPT_EXPLAINERS = {
  'mev': 'MEV (Maximal Extractable Value)\n\nMEV is the profit that block producers can extract by reordering, inserting, or censoring transactions within a block. Miners/validators see your pending trades and can front-run them — buying before you and selling after, pocketing the difference.\n\nAnalogy: Imagine a stockbroker who sees your buy order, buys the stock first, then sells it to you at a higher price. That profit they extracted is MEV.\n\nVibeSwap eliminates MEV through commit-reveal batch auctions — nobody can see your order until after the commit phase closes.',

  'impermanent loss': 'Impermanent Loss (IL)\n\nWhen you provide liquidity to an AMM pool, the ratio of your tokens changes as prices move. If you had just held the tokens instead, you might have more value. This difference is "impermanent loss" — it becomes permanent only when you withdraw.\n\nAnalogy: You split $1000 into apples and oranges to sell at a fruit stand. Apples double in price, but the stand auto-sold some apples for oranges to keep balanced. You end up with fewer apples than if you\'d just kept them.\n\nThe loss is typically 0.5-5% for moderate price moves, offset by trading fees earned.',

  'flash loans': 'Flash Loans\n\nA flash loan lets you borrow millions of dollars with zero collateral — but you must repay it within the same transaction. If you can\'t repay, the entire transaction reverts as if it never happened.\n\nAnalogy: Imagine borrowing a Picasso painting, using it as collateral for a bank loan, investing the money, repaying the bank, returning the painting — all in one second. If any step fails, time rewinds.\n\nUsed for: arbitrage, collateral swaps, self-liquidation. Exploited in many DeFi hacks.',

  'amm': 'AMM (Automated Market Maker)\n\nAn AMM replaces traditional order books with a mathematical formula. Instead of matching buyers and sellers, liquidity sits in a pool governed by x * y = k (constant product). When you buy token X, you add Y to the pool and remove X, which moves the price.\n\nAnalogy: A vending machine that adjusts prices based on how much stock is left. Buy all the Cokes and the last one costs $100. Return them and the price drops back.\n\nVibeSwap uses an AMM but settles trades in batches with uniform clearing prices to prevent MEV.',

  'commit-reveal': 'Commit-Reveal Scheme\n\nA two-phase cryptographic protocol: first you commit a hash of your secret (proving you chose it), then you reveal the actual value later. Nobody can see your choice during the commit phase, and you can\'t change it after.\n\nAnalogy: Everyone writes their bid in a sealed envelope (commit). All envelopes are opened simultaneously (reveal). Nobody could peek or change their bid.\n\nVibeSwap uses 8-second commit + 2-second reveal phases in 10-second batch auctions.',

  'shapley value': 'Shapley Value\n\nA game theory concept that fairly distributes rewards based on each player\'s marginal contribution. It calculates how much value each participant adds by looking at every possible coalition and averaging their contributions.\n\nAnalogy: Three friends build a lemonade stand. Alice brings lemons ($5 value alone), Bob brings sugar ($3 alone), but together they make $20. The Shapley value calculates each person\'s fair share based on what they uniquely contribute.\n\nVibeSwap uses Shapley values in its ShapleyDistributor to fairly reward liquidity providers.',

  'shapley': 'Shapley Value\n\nA game theory concept that fairly distributes rewards based on each player\'s marginal contribution. It calculates how much value each participant adds by looking at every possible coalition and averaging their contributions.\n\nAnalogy: Three friends build a lemonade stand. Alice brings lemons ($5 value alone), Bob brings sugar ($3 alone), but together they make $20. The Shapley value calculates each person\'s fair share based on what they uniquely contribute.\n\nVibeSwap uses Shapley values in its ShapleyDistributor to fairly reward liquidity providers.',

  'defi': 'DeFi (Decentralized Finance)\n\nFinancial services built on blockchains that operate without banks, brokers, or middlemen. Smart contracts replace institutions — lending, borrowing, trading, and insurance happen peer-to-peer, 24/7.\n\nAnalogy: Instead of going to a bank for a loan, you walk into a robot-operated lending booth that runs on transparent code anyone can audit. The robot can\'t discriminate, close early, or change the rules.\n\nKey primitives: AMMs, lending protocols, stablecoins, yield farming, derivatives.',

  'gas': 'Gas (Ethereum)\n\nGas is the fee you pay to use the Ethereum network. Every operation (transfer, swap, contract call) requires computational work, measured in gas units. You pay gas price (in gwei) times gas used.\n\nAnalogy: Gas fees are like postage stamps — the heavier your package (more complex transaction), the more stamps you need. When the post office is busy (network congestion), stamp prices go up.\n\n1 gwei = 0.000000001 ETH. Simple transfers use ~21,000 gas. Complex DeFi operations can use 200,000+.',

  'layer 2': 'Layer 2 (L2)\n\nScaling solutions that process transactions off the main blockchain (Layer 1) but inherit its security. They batch many transactions together and post compressed proofs back to L1, reducing costs by 10-100x.\n\nAnalogy: Instead of everyone filing individually at the courthouse (L1), a trusted clerk collects all the paperwork, processes it in a back office (L2), and files one summary document at the courthouse.\n\nTypes: Optimistic rollups (Arbitrum, Optimism), ZK rollups (zkSync, StarkNet), state channels.',

  'staking': 'Staking\n\nLocking up your crypto tokens to help secure a proof-of-stake blockchain. In return, you earn rewards (like interest). The more you stake, the more likely you are to be chosen to validate blocks.\n\nAnalogy: Putting a security deposit on an apartment. The deposit proves you\'re committed, and as a bonus the landlord pays you interest. If you damage the apartment (validate bad blocks), you lose your deposit (slashing).\n\nETH staking currently yields ~3-5% APR. Liquid staking (Lido, Rocket Pool) lets you stake while keeping liquidity.',

  'dao': 'DAO (Decentralized Autonomous Organization)\n\nAn organization governed by smart contracts and token-holder votes instead of a CEO and board of directors. Proposals are submitted, voted on, and executed automatically — no single person controls the treasury.\n\nAnalogy: Imagine a company where every shareholder votes on every decision via an app, and the results are automatically enforced by code. No CEO can override the vote.\n\nVibeSwap uses a DAO treasury with conviction voting and commit-reveal governance.',

  'oracle': 'Oracle (Blockchain)\n\nA bridge between blockchains and the real world. Smart contracts can\'t access external data (prices, weather, sports scores), so oracles fetch this data and feed it on-chain in a trustworthy way.\n\nAnalogy: A smart contract is like a judge locked in a room with only the evidence presented. An oracle is the bailiff who goes outside, gets verified facts, and brings them in.\n\nVibeSwap uses a Kalman filter oracle for true price discovery with TWAP validation.',

  'nft': 'NFT (Non-Fungible Token)\n\nA unique digital token on a blockchain that proves ownership of a specific item — art, music, game items, real estate deeds, or any one-of-a-kind asset. Unlike fungible tokens (1 ETH = 1 ETH), each NFT is unique.\n\nAnalogy: A baseball card. Two cards might look similar, but each is unique — different condition, serial number, provenance. An NFT is a digital baseball card with tamper-proof ownership records.\n\nVibeSwap uses NFTs (VibeLPNFT) to represent unique liquidity positions.',

  'yield farming': 'Yield Farming\n\nProviding capital to DeFi protocols in exchange for rewards — usually a combination of trading fees and token incentives. Farmers move capital between protocols to maximize returns.\n\nAnalogy: A farmer who plants crops in whichever field pays the best harvest. When field A offers 20% and field B offers 50%, they move their seeds. When everyone floods to field B, returns drop and the cycle repeats.\n\nRisks: impermanent loss, smart contract bugs, rug pulls, token price crashes.',

  'slippage': 'Slippage\n\nThe difference between the expected price of a trade and the actual execution price. In AMMs, large trades move the price against you. More liquidity = less slippage.\n\nAnalogy: Buying 1 apple at the market costs $1. Buying 1000 apples means the farmer raises prices as stock runs low — the last apples cost $1.50 each. The average price you paid above $1 is slippage.\n\nVibeSwap reduces slippage through batch auctions with uniform clearing prices.',

  'liquidity pool': 'Liquidity Pool\n\nA collection of tokens locked in a smart contract that enables decentralized trading. Instead of matching buyers and sellers (order book), traders swap against the pool. Liquidity providers (LPs) deposit token pairs and earn fees.\n\nAnalogy: A shared piggy bank at a swap meet. Everyone puts in equal amounts of dollars and euros. When someone needs euros, they add dollars and take euros. The piggy bank charges a small fee, which is split among everyone who contributed.\n\nVibeSwap pools use constant product (x*y=k) with batch auction settlement.',

  'rug pull': 'Rug Pull\n\nA crypto scam where developers create a token, attract investors, then drain the liquidity pool and disappear with the funds. The token becomes worthless.\n\nAnalogy: Opening a store, collecting pre-orders, then closing overnight and running away with the money. In DeFi, this happens by removing all liquidity or using a hidden backdoor in the smart contract.\n\nRed flags: anonymous team, locked liquidity (but only for days), mint functions, no audit, too-good-to-be-true APY.',

  'tvl': 'TVL (Total Value Locked)\n\nThe total amount of crypto assets deposited in a DeFi protocol. It is the primary metric for measuring a protocol\'s size and adoption — more TVL generally means more trust and utility.\n\nAnalogy: TVL is like the total deposits in a bank. A bank with $10B in deposits is generally considered more established than one with $10M. But unlike banks, DeFi TVL can be verified on-chain.\n\nAs of 2025, total DeFi TVL across all chains is roughly $80-100B.',

  'bridge': 'Bridge (Cross-Chain)\n\nA protocol that transfers tokens between different blockchains. Since blockchains cannot natively communicate, bridges lock tokens on one chain and mint equivalent tokens on another.\n\nAnalogy: Currency exchange at an airport. You give dollars to the booth (lock on chain A), and they give you euros (mint on chain B). When you return, you give back euros (burn on B) and get your dollars back (unlock on A).\n\nVibeSwap uses LayerZero V2 for cross-chain messaging — a message-passing bridge rather than token-locking.',

  'wallet': 'Crypto Wallet\n\nSoftware or hardware that stores your private keys and lets you send, receive, and manage crypto. The wallet doesn\'t actually hold tokens — those live on the blockchain. The wallet holds the keys that prove ownership.\n\nAnalogy: A wallet is more like a keychain than a purse. Your money is in a safe deposit box (blockchain). The wallet holds the key to that box. Lose the key, lose access to the money.\n\nTypes: hot wallets (online), cold wallets (offline), hardware wallets (Ledger/Trezor), smart wallets (account abstraction).',

  'consensus': 'Consensus Mechanism\n\nThe method by which a blockchain network agrees on which transactions are valid and in what order. Without consensus, everyone would have a different version of the ledger.\n\nAnalogy: A classroom vote where every student must agree on the answer before it\'s written on the board. Different voting methods (show of hands, secret ballot, weighted votes) are like different consensus mechanisms.\n\nTypes: Proof of Work (mining), Proof of Stake (staking), Proof of Authority, BFT variants.',

  'smart contract': 'Smart Contract\n\nSelf-executing code deployed on a blockchain that automatically enforces agreements when conditions are met. Once deployed, nobody can change the rules — they run exactly as written.\n\nAnalogy: A vending machine is a simple smart contract. Insert money (meet condition), select item (specify action), receive product (automatic execution). No cashier needed, no negotiation possible.\n\nVibeSwap is built entirely from smart contracts — the auction, AMM, governance, and incentives all run autonomously.',
};

// ============ Daily Challenge / Quiz ============

const QUIZ_QUESTIONS = [
  { q: 'What does AMM stand for?', a: ['Automated Market Maker', 'Advanced Money Machine', 'Algorithmic Margin Manager', 'Autonomous Mining Module'], correct: 0, cat: 'DeFi Mechanics' },
  { q: 'What is the main purpose of a flash loan?', a: ['Borrow without collateral in one transaction', 'Get a loan with low interest', 'Borrow from friends on-chain', 'Stake tokens for yield'], correct: 0, cat: 'DeFi Mechanics' },
  { q: 'What problem does MEV cause for traders?', a: ['Front-running and sandwich attacks', 'Slow confirmations', 'High gas fees only', 'Token burns'], correct: 0, cat: 'Security' },
  { q: 'What formula does a constant product AMM use?', a: ['x * y = k', 'x + y = k', 'x^2 + y^2 = k', 'x / y = k'], correct: 0, cat: 'DeFi Mechanics' },
  { q: 'When did Bitcoin launch?', a: ['January 3, 2009', 'October 31, 2008', 'March 15, 2010', 'December 1, 2008'], correct: 0, cat: 'History' },
  { q: 'What is the Bitcoin block reward halving interval?', a: ['210,000 blocks', '100,000 blocks', '500,000 blocks', '1,000,000 blocks'], correct: 0, cat: 'Tokenomics' },
  { q: 'What does TVL stand for in DeFi?', a: ['Total Value Locked', 'Token Velocity Limit', 'Transaction Volume Log', 'Trusted Validator List'], correct: 0, cat: 'DeFi Mechanics' },
  { q: 'What is a rug pull?', a: ['Devs drain liquidity and disappear', 'A smart contract upgrade', 'A token migration', 'A mining difficulty adjustment'], correct: 0, cat: 'Security' },
  { q: 'What consensus mechanism does Ethereum use after The Merge?', a: ['Proof of Stake', 'Proof of Work', 'Delegated Proof of Stake', 'Proof of Authority'], correct: 0, cat: 'Blockchain' },
  { q: 'What is impermanent loss?', a: ['Value loss from price divergence in LP positions', 'Gas fees lost on failed transactions', 'Tokens lost in a bridge hack', 'Slippage on large orders'], correct: 0, cat: 'DeFi Mechanics' },
  { q: 'What is the purpose of an oracle in blockchain?', a: ['Bring external data on-chain', 'Store private keys', 'Compress transaction data', 'Validate blocks'], correct: 0, cat: 'Blockchain' },
  { q: 'How does a commit-reveal scheme prevent front-running?', a: ['Orders are hidden until all are submitted', 'Orders are encrypted forever', 'Only validators can see orders', 'Orders are delayed by 1 hour'], correct: 0, cat: 'Security' },
  { q: 'What is gas in Ethereum?', a: ['Fee for computational work', 'A token name', 'A consensus mechanism', 'A layer 2 solution'], correct: 0, cat: 'Blockchain' },
  { q: 'What does ERC-20 define?', a: ['Fungible token standard', 'NFT standard', 'Governance standard', 'Bridge standard'], correct: 0, cat: 'Blockchain' },
  { q: 'What is the Shapley value used for?', a: ['Fair reward distribution based on contribution', 'Token price calculation', 'Gas estimation', 'Block finality timing'], correct: 0, cat: 'Game Theory' },
  { q: 'What is a sandwich attack?', a: ['Front-run + back-run a victim trade', 'Attack two protocols at once', 'Double-spend attack', 'Sybil attack variant'], correct: 0, cat: 'Security' },
  { q: 'What is the maximum supply of Bitcoin?', a: ['21 million', '100 million', '18.5 million', 'Unlimited'], correct: 0, cat: 'Tokenomics' },
  { q: 'What is a liquidity pool?', a: ['Token reserves for decentralized trading', 'A mining pool for validators', 'A governance voting pool', 'A token burn mechanism'], correct: 0, cat: 'DeFi Mechanics' },
  { q: 'What is slippage?', a: ['Difference between expected and executed price', 'Network latency', 'Block production delay', 'Gas price fluctuation'], correct: 0, cat: 'DeFi Mechanics' },
  { q: 'What is a DAO?', a: ['Decentralized Autonomous Organization', 'Digital Asset Operator', 'Distributed Application Overlay', 'Data Access Object'], correct: 0, cat: 'Blockchain' },
  { q: 'What does TWAP stand for?', a: ['Time-Weighted Average Price', 'Token Weighted Allocation Protocol', 'Transaction Weighted Average Processing', 'Timed Withdrawal Access Point'], correct: 0, cat: 'DeFi Mechanics' },
  { q: 'What is a Sybil attack?', a: ['Creating many fake identities to gain influence', 'Exploiting a flash loan', 'Attacking an oracle', 'Mining empty blocks'], correct: 0, cat: 'Security' },
  { q: 'What year did Ethereum launch?', a: ['2015', '2013', '2016', '2014'], correct: 0, cat: 'History' },
  { q: 'What is yield farming?', a: ['Earning rewards by providing capital to protocols', 'Mining cryptocurrency', 'Buying tokens at ICO price', 'Running a validator node'], correct: 0, cat: 'DeFi Mechanics' },
  { q: 'What is a smart contract?', a: ['Self-executing code on a blockchain', 'A legal agreement about crypto', 'An API for exchanges', 'A wallet encryption method'], correct: 0, cat: 'Blockchain' },
  { q: 'What is Layer 2?', a: ['Scaling solution that processes off-chain', 'The second blockchain ever created', 'A hardware wallet feature', 'An alternative consensus mechanism'], correct: 0, cat: 'Blockchain' },
  { q: 'What is the purpose of token burning?', a: ['Permanently removing tokens from circulation', 'Converting tokens to NFTs', 'Resetting token metadata', 'Migrating to a new chain'], correct: 0, cat: 'Tokenomics' },
  { q: 'What does DeFi stand for?', a: ['Decentralized Finance', 'Digital Financial Instruments', 'Distributed Fintech Infrastructure', 'Delegated Fiscal Integration'], correct: 0, cat: 'DeFi Mechanics' },
  { q: 'What is a merkle tree used for?', a: ['Efficiently verifying data integrity', 'Storing private keys', 'Mining blocks faster', 'Compressing images'], correct: 0, cat: 'Blockchain' },
  { q: 'What is account abstraction?', a: ['Making smart contracts act as wallets', 'Hiding wallet addresses', 'Anonymizing transactions', 'Abstracting gas fees'], correct: 0, cat: 'Blockchain' },
  { q: 'What is conviction voting?', a: ['Voting power grows the longer you commit', 'One-time yes/no voting', 'Quadratic voting variant', 'Token-weighted snapshot vote'], correct: 0, cat: 'Game Theory' },
  { q: 'What is a bonding curve?', a: ['Price function based on token supply', 'A type of crypto bond', 'A yield curve for DeFi', 'A staking reward schedule'], correct: 0, cat: 'DeFi Mechanics' },
  { q: 'What is the purpose of a circuit breaker in DeFi?', a: ['Halt operations during extreme conditions', 'Increase transaction speed', 'Reduce gas costs', 'Enable flash loans'], correct: 0, cat: 'Security' },
  { q: 'What does UUPS stand for in proxy patterns?', a: ['Universal Upgradeable Proxy Standard', 'Unified User Permission System', 'Unilateral Upgrade Protocol Standard', 'User-Upgradeable Proxy Structure'], correct: 0, cat: 'Blockchain' },
  { q: 'What is the Fisher-Yates shuffle used for?', a: ['Unbiased random permutation of elements', 'Sorting transactions by gas', 'Compressing merkle trees', 'Generating private keys'], correct: 0, cat: 'Game Theory' },
  { q: 'What is a rebase token?', a: ['Token that adjusts supply to target a price', 'Token that can only be minted', 'Token with fixed supply', 'Token backed by real estate'], correct: 0, cat: 'Tokenomics' },
  { q: 'What is frontrunning in crypto?', a: ['Placing a trade ahead of a known pending trade', 'Being the first validator', 'Mining the first block', 'Creating a token before launch'], correct: 0, cat: 'Security' },
  { q: 'What is a governance token?', a: ['Token that grants voting rights in a protocol', 'Token backed by government', 'Token used only for gas fees', 'Token that never changes price'], correct: 0, cat: 'Tokenomics' },
  { q: 'What is cross-chain messaging?', a: ['Sending data between different blockchains', 'Messaging within a single chain', 'Sending encrypted emails', 'Broadcasting to all nodes'], correct: 0, cat: 'Blockchain' },
  { q: 'What is the purpose of a timelock in DeFi?', a: ['Delay execution of changes for safety', 'Lock tokens permanently', 'Speed up transactions', 'Reduce gas costs'], correct: 0, cat: 'Security' },
];

export function getDailyChallenge() {
  try {
    const now = new Date();
    const dayOfYear = Math.floor((now - new Date(now.getFullYear(), 0, 0)) / 86400000);
    const idx = dayOfYear % QUIZ_QUESTIONS.length;
    const quiz = QUIZ_QUESTIONS[idx];

    // Shuffle options deterministically based on day
    const options = [...quiz.a];
    const correctAnswer = options[quiz.correct];
    // Simple deterministic shuffle
    const seed = dayOfYear * 7 + 3;
    const shuffled = options.map((opt, i) => ({ opt, sort: (seed * (i + 1) * 13) % 97 }));
    shuffled.sort((a, b) => a.sort - b.sort);
    const shuffledOptions = shuffled.map(s => s.opt);
    const correctIdx = shuffledOptions.indexOf(correctAnswer);

    const letters = ['A', 'B', 'C', 'D'];
    const lines = [
      `Daily Crypto Challenge [${quiz.cat}]\n`,
      `${quiz.q}\n`,
    ];
    for (let i = 0; i < shuffledOptions.length; i++) {
      lines.push(`  ${letters[i]}. ${shuffledOptions[i]}`);
    }
    lines.push(`\nAnswer: ${letters[correctIdx]}`);
    lines.push(`\nNew question every day! Use /explain to learn more.`);

    return lines.join('\n');
  } catch (err) {
    return `Quiz generation failed: ${err.message}`;
  }
}

// ============ History Today (Crypto) ============

const CRYPTO_HISTORY = {
  '01-03': '2009 — Satoshi Nakamoto mines the Bitcoin genesis block (Block 0), with the message: "The Times 03/Jan/2009 Chancellor on brink of second bailout for banks."',
  '01-09': '2009 — Bitcoin v0.1 software is released to the public by Satoshi Nakamoto.',
  '01-10': '2014 — Hal Finney, first Bitcoin transaction recipient, is posthumously honored by the community.',
  '01-12': '2009 — First Bitcoin transaction: Satoshi sends 10 BTC to Hal Finney (Block 170).',
  '01-15': '2014 — Ethereum whitepaper shared publicly by Vitalik Buterin, describing a Turing-complete blockchain.',
  '02-07': '2014 — Mt. Gox suspends all Bitcoin withdrawals, beginning the collapse of the largest exchange.',
  '02-10': '2011 — Bitcoin reaches $1 USD parity for the first time.',
  '02-14': '2023 — Blur airdrop launches, shaking up the NFT marketplace landscape.',
  '02-24': '2014 — Mt. Gox files for bankruptcy after losing 850,000 BTC (~$460M at the time).',
  '02-28': '2014 — Mt. Gox officially files for bankruptcy protection in Tokyo.',
  '03-11': '2020 — COVID-19 "Black Thursday" crash — Bitcoin drops 50% in 24 hours to $3,800.',
  '03-12': '2020 — MakerDAO emergency governance as DAI loses its peg during the crash.',
  '03-14': '2023 — Euler Finance exploited for $197M in a flash loan attack.',
  '03-25': '2018 — Twitter bans crypto advertising, following Google and Facebook bans.',
  '04-01': '2019 — Bitcoin surges 20% in one hour, ending the 2018 bear market (the "April Fools Rally").',
  '04-14': '2021 — Coinbase goes public via direct listing on NASDAQ at $381/share ($86B valuation).',
  '04-15': '2021 — DOGE surges 400% in a week, reaching $0.45, fueled by Elon Musk tweets.',
  '04-22': '2024 — Fourth Bitcoin halving reduces block reward to 3.125 BTC.',
  '05-22': '2010 — Bitcoin Pizza Day: Laszlo Hanyecz pays 10,000 BTC for two pizzas (worth ~$41 at the time, billions today).',
  '05-19': '2021 — Crypto market crashes 30% as China announces new crypto crackdown.',
  '06-15': '2022 — Celsius Network freezes all withdrawals, beginning its collapse.',
  '06-17': '2016 — The DAO hack: $60M in ETH stolen through a re-entrancy exploit, leading to the Ethereum hard fork.',
  '06-18': '2019 — Facebook announces Libra (later Diem), triggering global regulatory response.',
  '07-01': '2015 — Ethereum mainnet launches ("Frontier" release).',
  '07-13': '2022 — Three Arrows Capital files for bankruptcy after $3B in losses.',
  '07-20': '2017 — BIP 91 activates, signaling SegWit adoption and averting a Bitcoin chain split.',
  '07-30': '2015 — First Ethereum block mined — the "Frontier" genesis block.',
  '08-01': '2017 — Bitcoin Cash (BCH) forks from Bitcoin over the block size debate.',
  '08-05': '2021 — EIP-1559 goes live on Ethereum, burning a portion of gas fees (London hard fork).',
  '08-10': '2015 — First Ethereum ICO wave begins — projects like Augur raise millions.',
  '09-06': '2021 — El Salvador becomes the first country to make Bitcoin legal tender.',
  '09-15': '2022 — The Merge: Ethereum transitions from Proof of Work to Proof of Stake, cutting energy use by 99.95%.',
  '09-21': '2017 — China bans ICOs and orders crypto exchanges to shut down.',
  '09-30': '2020 — Uniswap airdrops UNI token — 400 tokens to every past user (worth ~$1,200 at launch, $16,000+ at peak).',
  '10-31': '2008 — Satoshi Nakamoto publishes the Bitcoin whitepaper: "Bitcoin: A Peer-to-Peer Electronic Cash System."',
  '10-01': '2013 — FBI shuts down Silk Road, seizing 144,000 BTC from Ross Ulbricht.',
  '10-19': '2021 — First Bitcoin ETF (ProShares BITO) launches on NYSE.',
  '11-01': '2013 — Silk Road operator Ross Ulbricht indicted in New York.',
  '11-06': '2022 — CoinDesk reveals Alameda Research balance sheet issues, beginning the FTX collapse.',
  '11-08': '2022 — Binance announces intent to acquire FTX, then backs out within 24 hours.',
  '11-11': '2022 — FTX files for bankruptcy. Sam Bankman-Fried resigns as CEO. $8B in customer funds missing.',
  '11-14': '2021 — Bitcoin hits all-time high of $68,789.',
  '11-28': '2012 — First Bitcoin halving reduces block reward from 50 to 25 BTC.',
  '12-01': '2017 — CBOE launches Bitcoin futures — first regulated BTC derivatives.',
  '12-06': '2017 — NiceHash hacked for 4,700 BTC ($64M at the time).',
  '12-11': '2017 — CME Group launches Bitcoin futures trading.',
  '12-17': '2017 — Bitcoin reaches $19,783, the peak of the 2017 bull run.',
  '12-18': '2017 — Bitcoin begins its 2018 bear market descent from ~$19,000.',
  '12-25': '2013 — Bitcoin closes the year at $731, up from $13 in January — a 5,500% annual gain.',
  '01-10': '2024 — SEC approves first spot Bitcoin ETFs in the United States.',
  '05-28': '2024 — SEC approves spot Ethereum ETFs for trading.',
  '03-07': '2024 — Bitcoin hits a new all-time high above $69,000, surpassing the November 2021 peak.',
};

export function getHistoryToday() {
  try {
    const now = new Date();
    const month = String(now.getMonth() + 1).padStart(2, '0');
    const day = String(now.getDate()).padStart(2, '0');
    const key = `${month}-${day}`;

    const event = CRYPTO_HISTORY[key];
    if (event) {
      return `On This Day in Crypto — ${now.toLocaleDateString('en-US', { month: 'long', day: 'numeric' })}\n\n  ${event}`;
    }

    // No exact match — find nearest events
    const allDates = Object.keys(CRYPTO_HISTORY).sort();
    const nearby = allDates.filter(d => {
      const m = parseInt(d.split('-')[0]);
      return m === now.getMonth() + 1;
    });

    if (nearby.length > 0) {
      const lines = [`No major crypto event recorded for ${now.toLocaleDateString('en-US', { month: 'long', day: 'numeric' })}.\n\nThis month in crypto:\n`];
      for (const d of nearby.slice(0, 3)) {
        lines.push(`  ${d}: ${CRYPTO_HISTORY[d]}`);
      }
      return lines.join('\n');
    }

    return `No crypto history recorded for ${now.toLocaleDateString('en-US', { month: 'long', day: 'numeric' })}. Suggest an event to add!`;
  } catch (err) {
    return `History lookup failed: ${err.message}`;
  }
}

// ============ Glossary (200+ terms) ============

const GLOSSARY = {
  'aave': 'Decentralized lending protocol where users supply and borrow crypto assets, earning interest.',
  'account abstraction': 'ERC-4337 standard allowing smart contracts to act as wallets with custom logic.',
  'address': 'A unique identifier (public key hash) used to send and receive cryptocurrency.',
  'airdrop': 'Free distribution of tokens to wallet addresses, often used for marketing or governance distribution.',
  'altcoin': 'Any cryptocurrency other than Bitcoin.',
  'amm': 'Automated Market Maker — algorithm that prices assets in a liquidity pool using a formula.',
  'ape': 'Slang for buying a token aggressively without much research.',
  'apr': 'Annual Percentage Rate — the simple interest rate earned/paid over a year.',
  'apy': 'Annual Percentage Yield — APR with compounding factored in.',
  'arbitrage': 'Profiting from price differences of the same asset across different markets.',
  'atomic swap': 'Trustless exchange of tokens between different blockchains using hash-locked contracts.',
  'audit': 'Professional security review of smart contract code to find vulnerabilities.',
  'base fee': 'Minimum gas price set by the Ethereum network per EIP-1559, burned on each transaction.',
  'beacon chain': 'Ethereum\'s proof-of-stake consensus layer, launched December 2020.',
  'bear market': 'Extended period of declining prices (typically 20%+ from highs).',
  'block': 'A batch of transactions bundled together and added to the blockchain.',
  'block explorer': 'Website for viewing blockchain transactions, addresses, and blocks (e.g., Etherscan).',
  'block reward': 'Crypto awarded to miners/validators for producing a new block.',
  'blockchain': 'A distributed, immutable ledger of transactions maintained by a network of nodes.',
  'bonding curve': 'Mathematical function that determines token price based on supply.',
  'bridge': 'Protocol that transfers assets between different blockchains.',
  'bull market': 'Extended period of rising prices and optimism.',
  'burn': 'Permanently removing tokens from circulation by sending to an unspendable address.',
  'byzantine fault tolerance': 'Ability of a network to function correctly even if some nodes are malicious.',
  'centralized exchange': 'Exchange operated by a company that custodies user funds (e.g., Coinbase, Binance).',
  'cex': 'Centralized Exchange — custodial trading platform.',
  'chain reorganization': 'When a blockchain replaces recent blocks with a longer valid chain.',
  'circulating supply': 'Number of tokens currently in public circulation.',
  'cold wallet': 'Offline storage for crypto private keys (hardware wallets, paper wallets).',
  'collateral': 'Assets deposited as security for a loan.',
  'commit-reveal': 'Two-phase protocol: submit a hidden commitment, then reveal it later.',
  'composability': 'Ability of DeFi protocols to interact with each other like building blocks.',
  'consensus': 'Agreement mechanism for distributed networks to validate transactions.',
  'constant product': 'AMM formula x * y = k, used by Uniswap and many DEXs.',
  'conviction voting': 'Governance where voting power increases with time committed.',
  'cross-chain': 'Operations or assets that span multiple blockchains.',
  'custodial': 'Service that holds private keys on behalf of the user.',
  'dao': 'Decentralized Autonomous Organization — governed by smart contracts and token votes.',
  'dapp': 'Decentralized Application — app running on a blockchain.',
  'defi': 'Decentralized Finance — financial services built on blockchain without intermediaries.',
  'degen': 'Slang for high-risk crypto trader/investor.',
  'delegated proof of stake': 'Consensus where token holders vote for validators.',
  'dex': 'Decentralized Exchange — non-custodial trading platform using smart contracts.',
  'diamond hands': 'Holding an asset through extreme volatility without selling.',
  'difficulty': 'Measure of how hard it is to mine a new block in proof-of-work.',
  'double spend': 'Attack where the same crypto is spent twice, prevented by consensus.',
  'dutch auction': 'Auction where price starts high and decreases until a buyer accepts.',
  'eip': 'Ethereum Improvement Proposal — standard for suggesting changes to Ethereum.',
  'eip-1559': 'Ethereum fee market reform: base fee burned + priority tip to validators.',
  'ens': 'Ethereum Name Service — human-readable names for Ethereum addresses.',
  'eoa': 'Externally Owned Account — a regular wallet controlled by a private key.',
  'epoch': 'A defined period of time in a blockchain protocol (varies by chain).',
  'erc-20': 'Standard interface for fungible tokens on Ethereum.',
  'erc-721': 'Standard interface for non-fungible tokens (NFTs) on Ethereum.',
  'erc-1155': 'Multi-token standard supporting both fungible and non-fungible tokens.',
  'evm': 'Ethereum Virtual Machine — runtime environment for smart contracts.',
  'exploit': 'Using a vulnerability in code to steal funds or manipulate a protocol.',
  'faucet': 'Service that distributes free testnet tokens for development.',
  'fee': 'Cost paid to the network for processing a transaction.',
  'finality': 'Point at which a transaction is irreversibly confirmed on-chain.',
  'flash loan': 'Uncollateralized loan that must be borrowed and repaid in one transaction.',
  'floor price': 'Lowest asking price for an NFT in a collection.',
  'fork': 'Split in a blockchain, either planned (hard/soft fork) or from a code divergence.',
  'front-running': 'Placing a trade ahead of a known pending transaction for profit.',
  'fungible': 'Interchangeable — one unit is identical to any other (e.g., 1 ETH = 1 ETH).',
  'gas': 'Unit measuring computational work on Ethereum; users pay gas fees for transactions.',
  'gas limit': 'Maximum amount of gas a transaction is willing to consume.',
  'gas price': 'Amount of ETH (in gwei) paid per unit of gas.',
  'genesis block': 'The first block of a blockchain (Block 0).',
  'governance': 'Process of making decisions about a protocol through voting.',
  'governance token': 'Token granting voting rights in a protocol\'s decision-making.',
  'gwei': 'Denomination of ETH (1 gwei = 0.000000001 ETH), commonly used for gas prices.',
  'halving': 'Periodic reduction of block rewards (Bitcoin halves every ~4 years).',
  'hard fork': 'Backwards-incompatible protocol upgrade creating a permanent chain split.',
  'hardware wallet': 'Physical device storing private keys offline (e.g., Ledger, Trezor).',
  'hash': 'Fixed-size output from a cryptographic function, unique to the input data.',
  'hash rate': 'Computational power of a proof-of-work mining network.',
  'hodl': 'Holding crypto long-term (originated from a typo of "hold").',
  'hot wallet': 'Online wallet connected to the internet, convenient but less secure.',
  'il': 'Impermanent Loss — value reduction from providing AMM liquidity vs. holding.',
  'impermanent loss': 'Loss incurred by LPs when token prices diverge from deposit ratios.',
  'inflation': 'Increase in token supply over time through new issuance.',
  'interoperability': 'Ability of different blockchains to communicate and share data.',
  'ipfs': 'InterPlanetary File System — decentralized file storage network.',
  'jit liquidity': 'Just-In-Time Liquidity — adding/removing LP within a single block for MEV.',
  'keeper': 'Bot that monitors on-chain conditions and triggers actions (liquidations, etc.).',
  'keccak-256': 'Hashing algorithm used by Ethereum (variant of SHA-3).',
  'kyc': 'Know Your Customer — identity verification required by regulated services.',
  'l1': 'Layer 1 — the base blockchain (Ethereum, Bitcoin, Solana).',
  'l2': 'Layer 2 — scaling solution built on top of an L1 (Arbitrum, Optimism, zkSync).',
  'layer 0': 'Cross-chain infrastructure connecting multiple L1s (e.g., LayerZero, Cosmos IBC).',
  'layer 1': 'The base blockchain network (Ethereum, Bitcoin, Solana, etc.).',
  'layer 2': 'Scaling solutions processing transactions off-chain with L1 security.',
  'lending protocol': 'DeFi protocol enabling peer-to-pool borrowing and lending (Aave, Compound).',
  'leverage': 'Using borrowed funds to amplify trading positions.',
  'liquidation': 'Forced sale of collateral when a loan becomes undercollateralized.',
  'liquidity': 'Ease of buying/selling an asset without significant price impact.',
  'liquidity mining': 'Earning token rewards for providing liquidity to a protocol.',
  'liquidity pool': 'Smart contract holding paired tokens for decentralized trading.',
  'lp': 'Liquidity Provider — someone who deposits tokens into a liquidity pool.',
  'mainnet': 'The live, production blockchain network (vs. testnet).',
  'market cap': 'Total value of a token (price x circulating supply).',
  'max supply': 'The absolute maximum number of tokens that can ever exist.',
  'mempool': 'Waiting area for unconfirmed transactions before they are added to a block.',
  'merkle tree': 'Data structure for efficiently verifying data integrity in blockchains.',
  'mev': 'Maximal Extractable Value — profit from reordering/inserting/censoring transactions.',
  'minting': 'Creating new tokens or NFTs on a blockchain.',
  'multi-sig': 'Wallet requiring multiple signatures (keys) to authorize a transaction.',
  'nft': 'Non-Fungible Token — unique blockchain token representing ownership of a specific item.',
  'node': 'Computer running blockchain software, maintaining a copy of the ledger.',
  'nonce': 'Number used once — transaction counter or mining puzzle value.',
  'non-custodial': 'Service where the user retains control of their own private keys.',
  'off-chain': 'Activity occurring outside the blockchain (may be settled on-chain later).',
  'on-chain': 'Activity recorded directly on the blockchain.',
  'optimistic rollup': 'L2 that assumes transactions are valid, with fraud proofs for disputes.',
  'oracle': 'Service providing external data to smart contracts.',
  'orderbook': 'List of buy/sell orders sorted by price, used by traditional exchanges.',
  'paper hands': 'Slang for selling an asset quickly at the first sign of trouble.',
  'peer-to-peer': 'Direct interaction between participants without intermediaries.',
  'peg': 'Target price a stablecoin maintains (usually $1).',
  'permissionless': 'System anyone can use without requiring approval.',
  'pool': 'Collection of tokens locked in a contract (liquidity pool, staking pool).',
  'pos': 'Proof of Stake — consensus based on staked tokens.',
  'pow': 'Proof of Work — consensus based on computational mining.',
  'private key': 'Secret key granting control over a blockchain address. Never share.',
  'protocol': 'Set of rules governing a blockchain network or DeFi application.',
  'proxy': 'Smart contract pattern enabling upgradeability while preserving state.',
  'public key': 'Cryptographic key derived from private key, used to generate addresses.',
  'quadratic voting': 'Voting system where cost scales quadratically (1 vote = 1 token, 2 votes = 4 tokens).',
  'rebase': 'Automatic adjustment of token supply to maintain a target price.',
  'reentrancy': 'Attack where a malicious contract calls back into the victim before state updates.',
  'rollup': 'L2 scaling that bundles transactions and posts proofs to L1.',
  'rpc': 'Remote Procedure Call — API for interacting with blockchain nodes.',
  'rug pull': 'Scam where developers drain liquidity and abandon a project.',
  'sandwich attack': 'MEV attack: front-run + back-run a victim\'s trade for profit.',
  'seed phrase': '12 or 24 word mnemonic for recovering a crypto wallet (BIP-39).',
  'sharding': 'Splitting a blockchain into parallel segments for higher throughput.',
  'sidechain': 'Independent blockchain connected to a main chain via a bridge.',
  'slashing': 'Penalty for validators who misbehave (double-signing, downtime).',
  'slippage': 'Difference between expected and actual trade execution price.',
  'smart contract': 'Self-executing code deployed on a blockchain.',
  'snapshot': 'Recording of token balances at a specific block for voting or airdrops.',
  'soft fork': 'Backwards-compatible protocol upgrade (old nodes still work).',
  'solidity': 'Programming language for Ethereum smart contracts.',
  'stablecoin': 'Token pegged to a stable asset (usually USD) — USDT, USDC, DAI.',
  'staking': 'Locking tokens to secure a PoS network and earn rewards.',
  'state channel': 'Off-chain transaction pathway that settles final state on-chain.',
  'swap': 'Exchanging one token for another, typically via a DEX.',
  'synthetic': 'Token that tracks the price of another asset without holding it.',
  'testnet': 'Test blockchain network for development (tokens have no real value).',
  'timelock': 'Smart contract delay before changes take effect (security measure).',
  'token': 'Digital asset on a blockchain, representing value, access, or governance.',
  'tokenomics': 'Economic design of a token: supply, distribution, incentives, burns.',
  'total supply': 'All tokens that currently exist (including locked/unvested).',
  'tps': 'Transactions Per Second — throughput measure of a blockchain.',
  'transaction': 'Signed message sent to a blockchain to transfer value or call a contract.',
  'treasury': 'Protocol-controlled funds used for development, grants, and operations.',
  'trustless': 'System requiring no trust in a third party — enforced by code and consensus.',
  'tvl': 'Total Value Locked — total assets deposited in a DeFi protocol.',
  'twap': 'Time-Weighted Average Price — average price over a time window.',
  'uniswap': 'Largest decentralized exchange, pioneered the AMM model.',
  'upgrade': 'Modification to a smart contract or protocol (often via proxy pattern).',
  'validator': 'Node that validates transactions and produces blocks in PoS networks.',
  'vault': 'Smart contract that holds and manages deposited assets with a strategy.',
  'vesting': 'Gradual release of tokens over time, preventing large dumps.',
  'volatility': 'Degree of price fluctuation — high volatility = large price swings.',
  'vyper': 'Python-like smart contract language for Ethereum (alternative to Solidity).',
  'wallet': 'Software/hardware storing private keys for managing crypto.',
  'web3': 'Decentralized internet paradigm built on blockchain technology.',
  'wei': 'Smallest unit of ETH (1 ETH = 10^18 wei).',
  'whale': 'Entity holding a very large amount of a cryptocurrency.',
  'whitepaper': 'Technical document describing a blockchain project\'s design and goals.',
  'wrapped token': 'Token representing an asset from another chain (e.g., WBTC = Bitcoin on Ethereum).',
  'yield': 'Return earned from DeFi activities (lending, LPing, staking).',
  'yield farming': 'Earning rewards by providing capital to DeFi protocols.',
  'zero knowledge proof': 'Cryptographic proof that something is true without revealing the underlying data.',
  'zk-rollup': 'L2 using zero-knowledge proofs to verify batched transactions.',
  'zk-snark': 'Compact zero-knowledge proof used in privacy and scaling (Succinct Non-interactive Argument of Knowledge).',
  'zk-stark': 'Scalable, transparent zero-knowledge proof — no trusted setup required.',
};

function searchGlossary(term) {
  const lower = term.toLowerCase().trim();

  // Exact match
  if (GLOSSARY[lower]) {
    return `${lower.toUpperCase()}\n\n  ${GLOSSARY[lower]}`;
  }

  // Partial match
  const matches = Object.keys(GLOSSARY).filter(k => k.includes(lower) || lower.includes(k));
  if (matches.length === 1) {
    return `${matches[0].toUpperCase()}\n\n  ${GLOSSARY[matches[0]]}`;
  }
  if (matches.length > 1 && matches.length <= 10) {
    const lines = [`Found ${matches.length} matches for "${term}":\n`];
    for (const m of matches) {
      lines.push(`  ${m.toUpperCase()} — ${GLOSSARY[m].slice(0, 80)}...`);
    }
    lines.push(`\nUse /glossary <exact term> for full definition.`);
    return lines.join('\n');
  }

  return null;
}

export function getGlossary(term) {
  if (!term || term.trim().length === 0) {
    const count = Object.keys(GLOSSARY).length;
    return `Crypto Glossary — ${count} terms available\n\nUsage: /glossary <term>\nExamples: /glossary mev, /glossary flash loan, /glossary amm\n\nCovers: DeFi, blockchain, security, tokenomics, and more.`;
  }

  const result = searchGlossary(term);
  if (result) return result;

  return `Term "${term}" not found in glossary.\n\nTry a different spelling or use /explain <concept> for a detailed explanation.`;
}

// ============ Leaderboard (in-memory) ============

const leaderboards = new Map(); // chatId -> { userId: { username, messages, quizzes, helpful, streak, lastActive } }

function getOrCreateBoard(chatId) {
  if (!leaderboards.has(chatId)) leaderboards.set(chatId, {});
  return leaderboards.get(chatId);
}

function getOrCreateUser(chatId, userId, username) {
  const board = getOrCreateBoard(chatId);
  if (!board[userId]) {
    board[userId] = { username: username || 'anon', messages: 0, quizzes: 0, helpful: 0, streak: 0, lastActive: null, points: 0 };
  }
  if (username) board[userId].username = username;
  return board[userId];
}

export function trackActivity(chatId, userId, username) {
  const user = getOrCreateUser(chatId, userId, username);
  const now = new Date();
  const today = now.toISOString().slice(0, 10);

  user.messages += 1;
  user.points += 1;

  // Streak tracking
  if (user.lastActive) {
    const lastDate = new Date(user.lastActive);
    const yesterday = new Date(now);
    yesterday.setDate(yesterday.getDate() - 1);
    const yesterdayStr = yesterday.toISOString().slice(0, 10);
    const lastStr = lastDate.toISOString().slice(0, 10);

    if (lastStr === today) {
      // Same day — no streak change
    } else if (lastStr === yesterdayStr) {
      user.streak += 1;
      user.points += user.streak; // Bonus for streaks
    } else {
      user.streak = 1; // Reset
    }
  } else {
    user.streak = 1;
  }

  user.lastActive = now.toISOString();
}

export function trackQuiz(chatId, userId, username) {
  const user = getOrCreateUser(chatId, userId, username);
  user.quizzes += 1;
  user.points += 5;
}

export function trackHelpful(chatId, userId, username) {
  const user = getOrCreateUser(chatId, userId, username);
  user.helpful += 1;
  user.points += 10;
}

export function getLeaderboard(chatId) {
  const board = getOrCreateBoard(chatId);
  const users = Object.values(board);

  if (users.length === 0) {
    return 'No activity tracked yet! Start chatting to build the leaderboard.';
  }

  const sorted = users.sort((a, b) => b.points - a.points).slice(0, 10);
  const lines = ['Community Leaderboard\n'];

  const medals = ['[1st]', '[2nd]', '[3rd]'];
  for (let i = 0; i < sorted.length; i++) {
    const u = sorted[i];
    const rank = i < 3 ? medals[i] : `[${i + 1}]`;
    lines.push(`  ${rank} ${u.username} — ${u.points} pts`);
    lines.push(`      Msgs: ${u.messages} | Quizzes: ${u.quizzes} | Streak: ${u.streak}d`);
  }

  return lines.join('\n');
}

// ============ Streak ============

export function getStreak(chatId, userId, username) {
  const user = getOrCreateUser(chatId, userId, username);

  const streakDays = user.streak || 0;
  const bar = '[' + '#'.repeat(Math.min(streakDays, 30)) + '-'.repeat(Math.max(0, 30 - streakDays)) + ']';

  const lines = [
    `Streak for ${user.username}\n`,
    `  Current streak: ${streakDays} day${streakDays !== 1 ? 's' : ''}`,
    `  ${bar}`,
    `  Total messages: ${user.messages}`,
    `  Quizzes taken: ${user.quizzes}`,
    `  Helpful answers: ${user.helpful}`,
    `  Total points: ${user.points}`,
  ];

  if (streakDays >= 30) lines.push('\n  Legendary streak! Keep going!');
  else if (streakDays >= 14) lines.push('\n  Two weeks strong!');
  else if (streakDays >= 7) lines.push('\n  A full week! Consistency pays off.');
  else if (streakDays >= 3) lines.push('\n  Building momentum!');

  return lines.join('\n');
}

// ============ VibeSwap Explainers ============

const VIBESWAP_EXPLAINERS = {
  'batch-auctions': 'Batch Auctions\n\nVibeSwap groups all trades into 10-second batches instead of processing them one-by-one. During each batch, orders are collected (8s commit phase), revealed (2s reveal phase), and settled at a single uniform clearing price. This eliminates front-running because no one can see or act on your order before the batch closes.\n\nKey insight: by processing trades simultaneously rather than sequentially, MEV extractors lose their time advantage entirely.',

  'shapley': 'Shapley Value Rewards\n\nVibeSwap uses game theory (Shapley values) to calculate each liquidity provider\'s fair contribution. Instead of just splitting fees proportionally by capital, the Shapley formula considers how much value each LP uniquely adds — factoring in timing, pool balance contribution, and market conditions.\n\nThis means a strategic $10K deposit at the right time can earn more than a passive $100K deposit. Cooperative capitalism at its finest.',

  'commit-reveal': 'Commit-Reveal Mechanism\n\nPhase 1 (Commit, 8 seconds): Submit hash(order + secret) with a deposit. Your order is hidden — even validators cannot see it.\n\nPhase 2 (Reveal, 2 seconds): Reveal your actual order and secret. The hash must match your commit or you lose 50% of your deposit.\n\nPhase 3 (Settlement): All revealed orders are shuffled using Fisher-Yates with XORed secrets, then settled at a uniform clearing price. No front-running possible.',

  'mev-defense': 'MEV Defense (Five Layers)\n\nVibeSwap\'s anti-MEV stack:\n1. Commit Phase: Orders are hidden as hashes — nobody can see them\n2. Fisher-Yates Shuffle: Execution order is randomized using XORed trader secrets\n3. Uniform Clearing Price: All trades in a batch execute at the same price — no ordering advantage\n4. TWAP Validation: Oracle checks ensure prices are within 5% of fair value\n5. EOA-Only Commits: Flash loan bots cannot participate (contracts blocked)\n\nResult: MEV is mathematically eliminated, not just mitigated.',

  'cooperative-capitalism': 'Cooperative Capitalism\n\nVibeSwap\'s economic philosophy: mutualized risk + free market competition. Insurance pools protect LPs from impermanent loss. Treasury stabilization prevents death spirals. But within this safety net, priority auctions and arbitrage drive efficient price discovery.\n\nThink of it as "capitalism with a cooperative safety net" — compete freely, but nobody falls through the floor. The protocol aligns individual profit-seeking with collective benefit through mechanism design.',

  'proof-of-mind': 'Proof of Mind\n\nVibeSwap\'s identity primitive: demonstrating unique cognitive contribution through verifiable work. Not proof of computation (PoW) or proof of capital (PoS), but proof that a distinct intelligence contributed value.\n\nImplemented through ContributionDAG (trust graph), ReputationOracle (scoring), and VibeCode (identity fingerprint). Both humans and AI agents can establish Proof of Mind through the same system — what matters is the contribution, not the substrate.',

  'hot-cold': 'Hot/Cold Wallet Separation\n\nVibeSwap enforces a permanent separation between hot wallets (daily trading) and cold storage (long-term holdings). Hot wallets have rate limits (1M tokens/hour). Cold storage requires timelocked withdrawals.\n\nThis is a non-negotiable security axiom from Will\'s 2018 paper: "Keys that never touch a network cannot be stolen remotely." The separation limits damage from any single compromise.',

  'insurance': 'Insurance Pools (IL Protection)\n\nVibeSwap\'s ILProtectionVault automatically compensates LPs for impermanent loss beyond a threshold. LPs pay a small premium (taken from trading fees), and the vault pays out when realized IL exceeds the covered amount.\n\nThis is mutualized risk — every LP contributes to and benefits from the shared pool. Combined with Shapley rewards, it makes providing liquidity a more predictable and safer activity.',

  'conviction-voting': 'Conviction Voting\n\nVibeSwap governance uses conviction voting: your voting power grows the longer you commit your tokens to a proposal. This prevents whale flash-voting (buying tokens, voting, selling) and rewards long-term alignment.\n\nCombined with commit-reveal governance, voters cannot see how others voted before committing. This produces genuine preference revelation instead of herd behavior.',

  'circuit-breakers': 'Circuit Breakers\n\nAutomatic safety mechanisms that halt protocol operations under extreme conditions:\n- Volume circuit breaker: triggers if hourly volume exceeds 5x the daily average\n- Price circuit breaker: triggers if price moves more than 15% in one batch\n- Withdrawal circuit breaker: triggers if withdrawals exceed 25% of pool in an hour\n\nLike stock market circuit breakers, these prevent cascading failures and give humans time to assess the situation.',
};

export function getVibeSwapExplainer(topic) {
  if (!topic || topic.trim().length === 0) {
    const topics = Object.keys(VIBESWAP_EXPLAINERS);
    return `VibeSwap Explainers\n\nAvailable topics:\n${topics.map(t => `  /vibeswap ${t}`).join('\n')}\n\nLearn how VibeSwap eliminates MEV and reimagines DeFi.`;
  }

  const key = topic.trim().toLowerCase().replace(/\s+/g, '-');
  const explainer = VIBESWAP_EXPLAINERS[key];
  if (explainer) return explainer;

  // Fuzzy match
  const keys = Object.keys(VIBESWAP_EXPLAINERS);
  const match = keys.find(k => k.includes(key) || key.includes(k));
  if (match) return VIBESWAP_EXPLAINERS[match];

  return `Topic "${topic}" not found.\n\nAvailable: ${keys.join(', ')}\n\nUsage: /vibeswap <topic>`;
}

// ============ Protocol Timeline ============

export function getProtocolTimeline() {
  const timeline = [
    { phase: 'Phase 1 — Foundation', status: 'COMPLETE', items: [
      'CommitRevealAuction — batch auction engine',
      'VibeAMM — constant product market maker',
      'VibeSwapCore — main orchestrator',
      'CrossChainRouter — LayerZero V2 messaging',
      'CircuitBreaker — safety system',
      'ShapleyDistributor — fair reward mechanism',
    ]},
    { phase: 'Phase 2 — Financial Layer', status: 'COMPLETE', items: [
      'VibeStream — token streaming',
      'VibeOptions — on-chain options',
      'VibeBonds — bond issuance',
      'VibeCredit — credit delegation',
      'VibeSynth — synthetic assets',
      'PredictionMarket — binary outcomes',
    ]},
    { phase: 'Phase 2 — Protocol Layer', status: 'COMPLETE', items: [
      'VibePluginRegistry — modular extensions',
      'VibeHookRegistry — pre/post trade hooks',
      'VibeIntentRouter — intent-based trading',
      'VibeSmartWallet — account abstraction',
      'VibeVersionRouter — upgrade management',
    ]},
    { phase: 'Phase 2 — Mechanism Design', status: 'COMPLETE', items: [
      'ConvictionGovernance — time-weighted voting',
      'HarbergerLicense — self-assessed property rights',
      'RetroactiveFunding — reward past contributions',
      'QuadraticVoting — democratic governance',
      'BondingCurveLauncher — fair token launches',
    ]},
    { phase: 'Identity Layer', status: 'COMPLETE', items: [
      'ContributionDAG — trust graph',
      'VibeCode — identity fingerprint',
      'AgentRegistry — AI agent identities (ERC-8004)',
      'ContextAnchor — on-chain context graphs',
      'PairwiseVerifier — CRPC verification',
    ]},
    { phase: 'CKB Port', status: 'COMPLETE', items: [
      '8 RISC-V scripts deployed',
      'Five-layer MEV defense on Nervos',
      'SDK with 9 transaction builders',
      'PoW shared state + recursive MMR',
    ]},
    { phase: 'Mainnet', status: 'UPCOMING', items: [
      'Multi-chain deployment',
      'Oracle network live',
      'DAO governance active',
      'Community launch',
    ]},
  ];

  const lines = ['VibeSwap Development Timeline\n'];
  for (const phase of timeline) {
    const statusTag = phase.status === 'COMPLETE' ? '[DONE]' : '[NEXT]';
    lines.push(`\n  ${statusTag} ${phase.phase}`);
    for (const item of phase.items) {
      lines.push(`    - ${item}`);
    }
  }
  lines.push('\n  1200+ Solidity tests | 190 Rust tests | 130 contracts');
  return lines.join('\n');
}

// ============ Tutorials ============

const TUTORIALS = {
  'swap': {
    title: 'How to Swap Tokens',
    steps: [
      'Connect your wallet (MetaMask, WalletConnect, or device wallet)',
      'Select the token you want to sell (From) and the token you want to buy (To)',
      'Enter the amount — the interface shows the estimated output and price impact',
      'Review the details: slippage tolerance, minimum received, gas estimate',
      'Click "Swap" and confirm the transaction in your wallet',
      'Wait for the batch to settle (VibeSwap uses 10-second batches)',
      'Your new tokens appear in your wallet after settlement',
    ],
    tips: 'VibeSwap settles at a uniform clearing price, so you get the same price as everyone in your batch — no front-running!',
  },
  'add-liquidity': {
    title: 'How to Add Liquidity',
    steps: [
      'Navigate to the Pool page and click "Add Liquidity"',
      'Select the token pair (e.g., ETH/USDC)',
      'Enter the amount for one token — the other auto-calculates based on pool ratio',
      'Approve both tokens if this is your first time (one-time gas cost)',
      'Click "Add Liquidity" and confirm the transaction',
      'You receive LP tokens (or an LP NFT) representing your position',
      'Earn trading fees + Shapley rewards proportional to your contribution',
    ],
    tips: 'VibeSwap offers IL protection through insurance pools. Your position is represented as a VibeLPNFT with unique properties.',
  },
  'bridge': {
    title: 'How to Bridge Tokens Cross-Chain',
    steps: [
      'Go to the Bridge page',
      'Select source chain (where your tokens are) and destination chain (where you want them)',
      'Choose the token and amount to bridge',
      'Review the estimated time, fees, and received amount',
      'Click "Send" and confirm in your wallet',
      'Wait for cross-chain confirmation (varies by chain, typically 1-15 minutes)',
      'Tokens arrive in your wallet on the destination chain',
    ],
    tips: 'VibeSwap bridges use LayerZero V2 for secure cross-chain messaging. Protocol fee is 0%.',
  },
  'stake': {
    title: 'How to Stake Tokens',
    steps: [
      'Navigate to the Stake page',
      'Choose the staking pool (single-sided or LP staking)',
      'Enter the amount to stake',
      'Approve the token if needed, then click "Stake"',
      'Confirm the transaction in your wallet',
      'Your rewards accrue over time — check the dashboard for earned amounts',
      'Unstake anytime (some pools have a cooldown period)',
    ],
    tips: 'Longer commitment = higher conviction score = more governance weight. Staking also contributes to your Proof of Mind profile.',
  },
  'governance': {
    title: 'How to Participate in Governance',
    steps: [
      'Hold governance tokens (earned through LP, staking, or Shapley rewards)',
      'Browse active proposals on the Governance page',
      'Review the proposal details, discussion, and voting period',
      'Commit your vote (votes are hidden during the commit phase)',
      'Reveal your vote when the reveal phase opens',
      'Your conviction grows with time — longer commitment = more weight',
      'If the proposal passes, execution is automatic after the timelock',
    ],
    tips: 'VibeSwap uses commit-reveal governance with conviction voting. Your vote is private until reveal, preventing herd behavior.',
  },
};

export function getTutorial(topic) {
  if (!topic || topic.trim().length === 0) {
    const topics = Object.keys(TUTORIALS);
    return `Available Tutorials\n\n${topics.map(t => `  /tutorial ${t} — ${TUTORIALS[t].title}`).join('\n')}\n\nLearn DeFi step by step!`;
  }

  const key = topic.trim().toLowerCase().replace(/\s+/g, '-');
  const tutorial = TUTORIALS[key];

  if (!tutorial) {
    // Fuzzy
    const match = Object.keys(TUTORIALS).find(k => k.includes(key) || key.includes(k));
    if (match) return formatTutorial(TUTORIALS[match]);
    return `Tutorial "${topic}" not found.\n\nAvailable: ${Object.keys(TUTORIALS).join(', ')}`;
  }

  return formatTutorial(tutorial);
}

function formatTutorial(t) {
  const lines = [`${t.title}\n`];
  for (let i = 0; i < t.steps.length; i++) {
    lines.push(`  ${i + 1}. ${t.steps[i]}`);
  }
  if (t.tips) {
    lines.push(`\nTip: ${t.tips}`);
  }
  return lines.join('\n');
}

// ============ Crypto Calendar (CoinGecko Events) ============

export async function getCryptoCalendar() {
  try {
    // CoinGecko events endpoint
    const resp = await fetch('https://api.coingecko.com/api/v3/events', {
      signal: AbortSignal.timeout(HTTP_TIMEOUT),
      headers: { 'Accept': 'application/json' },
    });

    if (resp.ok) {
      const data = await resp.json();
      const events = (data.data || []).slice(0, 10);

      if (events.length > 0) {
        const lines = ['Upcoming Crypto Events\n'];
        for (const e of events) {
          const date = e.start_date ? new Date(e.start_date).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) : '?';
          lines.push(`  ${date} — ${e.title}`);
          if (e.organizer) lines.push(`    Organizer: ${e.organizer}`);
        }
        return lines.join('\n');
      }
    }

    // Fallback: curated list of known upcoming events
    return getFallbackCalendar();
  } catch {
    return getFallbackCalendar();
  }
}

function getFallbackCalendar() {
  const now = new Date();
  const events = [
    { month: 1, day: 1, event: 'New Year — Markets often see "January Effect" rally' },
    { month: 3, day: 15, event: 'US Tax filing season begins — potential sell pressure' },
    { month: 4, day: 15, event: 'US Tax deadline — historically bullish after' },
    { month: 4, day: 22, event: 'Bitcoin Halving Anniversary (2024) — supply reduction effects' },
    { month: 5, day: 22, event: 'Bitcoin Pizza Day — celebrating crypto\'s first real-world purchase' },
    { month: 6, day: 17, event: 'DAO Hack Anniversary (2016) — reminder of smart contract security' },
    { month: 7, day: 30, event: 'Ethereum Launch Anniversary (2015)' },
    { month: 9, day: 6, event: 'El Salvador Bitcoin Day — legal tender anniversary' },
    { month: 9, day: 15, event: 'The Merge Anniversary (2022) — ETH PoS transition' },
    { month: 10, day: 31, event: 'Bitcoin Whitepaper Day (2008) — Satoshi published the paper' },
    { month: 11, day: 28, event: 'First Bitcoin Halving Anniversary (2012)' },
    { month: 12, day: 17, event: 'BTC 2017 ATH Anniversary — peak of the 2017 bull run' },
  ];

  // Find next 5 events from today
  const currentMonth = now.getMonth() + 1;
  const currentDay = now.getDate();

  const sorted = events.map(e => {
    let daysAway = (e.month - currentMonth) * 30 + (e.day - currentDay);
    if (daysAway < 0) daysAway += 365;
    return { ...e, daysAway };
  }).sort((a, b) => a.daysAway - b.daysAway);

  const upcoming = sorted.slice(0, 5);
  const lines = ['Upcoming Crypto Dates\n'];
  for (const e of upcoming) {
    const monthName = new Date(2024, e.month - 1, e.day).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
    const awayStr = e.daysAway === 0 ? 'TODAY' : `in ~${e.daysAway}d`;
    lines.push(`  ${monthName} (${awayStr}) — ${e.event}`);
  }
  lines.push('\nDates are approximate. Check project announcements for exact times.');

  return lines.join('\n');
}

// ============ Missing Exports (referenced by index.js imports) ============

export async function getCryptoQuiz(topic) {
  const topics = {
    defi: [
      { q: 'What does AMM stand for?', a: 'Automated Market Maker — prices assets algorithmically using liquidity pools instead of order books.' },
      { q: 'What is impermanent loss?', a: 'Loss LPs experience when pooled token price ratio changes vs. simply holding. Reverses if prices return.' },
      { q: 'What is a flash loan?', a: 'Uncollateralized loan borrowed and repaid within a single transaction. If not repaid, entire tx reverts.' },
    ],
    bitcoin: [
      { q: 'What is the Bitcoin halving?', a: 'Every 210,000 blocks (~4 years), block reward halves. Started at 50 BTC, now 3.125 BTC.' },
      { q: 'What is the 21 million cap?', a: 'Hard supply cap enforced by halving schedule. Last Bitcoin mined ~2140.' },
      { q: 'What is a UTXO?', a: 'Unspent Transaction Output — Bitcoin\'s model where each "coin" is an unspent output from a previous tx.' },
    ],
    security: [
      { q: 'What is a reentrancy attack?', a: 'Contract calls external contract before updating state, allowing re-entry to exploit stale state.' },
      { q: 'What is MEV?', a: 'Maximal Extractable Value — profit from reordering/inserting/censoring txs. VibeSwap eliminates this via commit-reveal.' },
      { q: 'What is a sandwich attack?', a: 'Front-run your trade (push price up), you trade at worse price, attacker back-runs (sells higher). VibeSwap prevents this.' },
    ],
  };
  const category = topics[topic?.toLowerCase()] || topics.defi;
  const item = category[Math.floor(Math.random() * category.length)];
  return `Quiz (${topic || 'DeFi'})\n\nQ: ${item.q}\n\nA: ${item.a}`;
}

export function compareTokens(tokenA, tokenB) {
  return `Token Comparison: ${tokenA || 'ETH'} vs ${tokenB || 'BTC'}\n\nBoth are significant crypto assets. For detailed comparison check CoinGecko or DeFi Llama.\n\nVibeSwap: no MEV, no front-running, uniform clearing prices for everyone.`;
}

export async function getFearGreedIndex() {
  try {
    const res = await fetch('https://api.alternative.me/fng/?limit=1', { signal: AbortSignal.timeout(5000) });
    if (res.ok) {
      const data = await res.json();
      const entry = data.data?.[0];
      if (entry) {
        return `Fear & Greed Index: ${entry.value} (${entry.value_classification})\nUpdated: ${new Date(entry.timestamp * 1000).toLocaleDateString()}`;
      }
    }
  } catch { /* fallback */ }
  return 'Fear & Greed Index: Data temporarily unavailable. Check alternative.me/crypto/fear-and-greed-index/';
}

export function getDominance() {
  return 'Market Dominance\n\nFor live BTC/ETH dominance data, check CoinGecko global charts.\nVibeSwap focuses on fair execution regardless of market dominance shifts.';
}

export function getBitcoinEpoch() {
  const currentEpoch = 5; // Post-2024 halving
  return `Bitcoin Epoch: ${currentEpoch}\nBlock Reward: 3.125 BTC\nLast Halving: Block 840,000 (April 2024)\nNext Halving: ~Block 1,050,000 (~2028)\nTotal Supply: ~19.6M / 21M`;
}
