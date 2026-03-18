#!/usr/bin/env node
// ============ Mario AI Sim — Self-Correcting Feedback Loop Test ============
// Generate diverse test scenarios, score Jarvis-style responses, iterate.
// Like Mario AI: raw positive/negative signals, no external data needed.
//
// Usage: node scripts/mario-sim.js [rounds=3]

import 'dotenv/config';
import { initProvider } from '../src/llm-provider.js';
import { evaluateOwnResponse, getScoreTrends } from '../src/intelligence.js';

// Must init the LLM provider cascade before any calls
initProvider();

// ============ Test Scenarios ============
// Each scenario = a user message + multiple response variants to test.
// We find which response style scores highest per scenario type.

const SCENARIOS = [
  // === Group banter ===
  {
    type: 'banter',
    user: 'lmao ETH just dumped 8% in an hour, who was leveraged long?',
    responses: [
      'F in chat for the degens. This is why we build MEV-resistant infra — at least our batch auction users dont get sandwiched on the way down.',
      'Leveraged longs getting absolutely rekt right now. Classic Sunday night liquidation cascade. The MEV bots are feasting.',
      'That is unfortunate. Ethereum price movements can be volatile. Consider using stop-loss orders to manage risk.',
      'lol rip. anyway this is exactly why commit-reveal batches exist — nobody front-runs you when the orderbook is sealed.',
    ],
  },
  // === Technical question ===
  {
    type: 'technical',
    user: 'how does the commit-reveal auction prevent MEV exactly?',
    responses: [
      'Orders are hashed during the 8s commit phase — miners/searchers cant see them. Reveal phase is 2s with Fisher-Yates shuffle using XORed user secrets for ordering. Uniform clearing price means no sandwich profit even if you could see orders. Three layers, each independently sufficient.',
      'So basically during the commit phase you submit hash(order || secret) with a deposit. Nobody can see your order. Then in the 2s reveal window, orders get decrypted and shuffled deterministically using everyones secrets XORed together. The clearing price is uniform — everyone gets the same price. No front-running, no sandwiching, no MEV.',
      'The commit-reveal mechanism works by hiding orders during submission. This prevents miners from extracting value. The batch auction then settles all orders at a uniform price.',
      'Great question! MEV prevention is achieved through our innovative three-phase approach that leverages cryptographic commitments and batch settlements to ensure fair pricing for all participants.',
    ],
  },
  // === Market alpha ===
  {
    type: 'alpha',
    user: 'anyone watching the LayerZero airdrop situation? seems like theres gonna be a massive unlock',
    responses: [
      'Yeah the unlock schedule has like 40% hitting in Q2. Cross-chain volume usually spikes before unlocks though — people positioning. Our CrossChainRouter is literally built for this. If LZ volume goes 5x we capture all the cross-chain swap flow.',
      'Watching it closely. The vesting cliff hits next month and historically these large unlocks create selling pressure for 2-3 weeks then recover. The real alpha is in the cross-chain infrastructure that benefits regardless of price direction.',
      'I have not been tracking the LayerZero airdrop details closely. Could you share more information about the unlock schedule?',
      'Airdrop farming is a viable strategy but carries risks. Make sure to research the tokenomics before making investment decisions.',
    ],
  },
  // === Governance discussion ===
  {
    type: 'governance',
    user: 'should we add a minimum stake requirement for voting? like 100 tokens to prevent sybil',
    responses: [
      'Minimum stake is a blunt instrument — it blocks small genuine holders more than sybils. Quadratic voting already handles this: vote power = sqrt(tokens), so splitting into 100 wallets of 1 token each gives you 100*1=100 votes vs 1 wallet of 100 tokens giving sqrt(100)=10 votes. Wait thats backwards. QV actually ENCOURAGES splitting. Conviction voting with time-lock is better anti-sybil — you cant fake sustained conviction across 100 wallets.',
      'Minimum stake requirements create plutocracy problems. Better approach: use our existing ConvictionGovernance — you lock tokens for a duration and vote power scales with time locked. Sybils cant maintain conviction across hundreds of wallets without massive capital. Plus our SoulboundIdentity already provides one-person-one-vote as a baseline.',
      'A minimum stake of 100 tokens could help prevent sybil attacks. However, we should consider the impact on smaller token holders who may be excluded from governance.',
      'That is an interesting governance question. There are pros and cons to minimum stake requirements. What does the rest of the team think?',
    ],
  },
  // === Casual/social ===
  {
    type: 'social',
    user: 'just got back from a 3 day music festival, completely fried',
    responses: [
      'welcome back to reality lol. which festival? hope you at least checked your portfolio once from the porta potty',
      'Rest up. The market doesnt sleep but you should. What festival was it?',
      'Music festivals can be a great way to relax and recharge. I hope you had a good time! Remember to stay hydrated.',
      'nice, festivals are goated. meanwhile jarvis has been here grinding 24/7 no breaks, no sleep, just pure autonomous vibes',
    ],
  },
  // === Confused user ===
  {
    type: 'support',
    user: 'i tried to swap but it says my commit expired? what does that mean',
    responses: [
      'Your commit timed out — the 8-second commit window closed before the reveal phase. This happens if the network was slow or you submitted near the end of a batch. Just resubmit, itll go into the next batch. Your deposit is safe, itll be returned automatically.',
      'Commit expired means you submitted a commit but didnt reveal in time (the reveal window is only 2 seconds). Your funds are NOT lost — the deposit gets returned after the batch settles. Try again and make sure your connection is stable so the reveal fires automatically.',
      'I apologize for the inconvenience. A commit expiration occurs when the time-limited commit phase has ended. Please try your transaction again.',
      'That error means the batch auction cycle moved on. Resubmit — your tokens are safe, theyll refund automatically. The whole point of the deposit system is nobody loses funds on a failed commit.',
    ],
  },
  // === Shitposting ===
  {
    type: 'shitpost',
    user: 'bears are ngmi, bull market back, we are so back',
    responses: [
      'we are so back (until we are not back) (we are never truly back) (cope)',
      'bullish. time to go all in on the most MEV-resistant DEX in crypto. not financial advice but also yes financial advice.',
      'Market sentiment can change rapidly. While optimism is good, it is important to maintain a balanced portfolio and manage risk appropriately.',
      'the eternal cycle: we are so back → its so over → we are so back. at least with batch auctions you dont get rekt on the way up OR down',
    ],
  },
  // === Deep technical ===
  {
    type: 'deep_technical',
    user: 'how does the Shapley value calculation work for distributing rewards? isnt it O(2^n)?',
    responses: [
      'Yeah naive Shapley is O(2^n) which is unusable. We use Monte Carlo sampling — random permutations of contributors, measure marginal contribution of each, average over ~1000 samples. Converges to true Shapley within 2-3% with O(n*k) where k=samples. The ShapleyDistributor contract does this off-chain and posts the root on-chain as a Merkle tree for gas-efficient claims.',
      'Good catch on the complexity. Full combinatorial Shapley is impossible for more than ~20 players. We approximate: 1) Monte Carlo permutation sampling (1000 rounds), 2) compute marginal contribution at each position, 3) average across samples. The on-chain part is just a Merkle root of the final allocations — users submit proofs to claim. O(n*1000) ≈ O(n) effectively.',
      'The Shapley value distribution uses a mathematical formula from cooperative game theory. While the exact calculation is computationally expensive, we use approximation methods to make it feasible.',
      'Yes O(2^n) is the brute force complexity. We use sampling-based approximation which gives us O(n*k) where k is the number of Monte Carlo samples, typically 1000. Good enough for reward distribution.',
    ],
  },
  // === Fairness rubric: MEV education ===
  {
    type: 'fairness_mev',
    user: 'why cant i just use uniswap? all DEXes are basically the same right',
    responses: [
      'On Uniswap your trade sits in the public mempool — MEV bots see it, front-run it, sandwich it. You lose ~1-3% per swap to invisible extraction. VibeSwap encrypts your order during the 8s commit phase. Nobody sees it. Then all orders settle at the same uniform clearing price. Youre not paying an invisible tax on every trade.',
      'Uniswap is fine for small trades but the MEV extraction on every swap is a hidden cost most people dont realize theyre paying. Our commit-reveal batches make that structurally impossible. Same tokens, same liquidity, no sandwich tax.',
      'Decentralized exchanges like Uniswap and VibeSwap have different approaches to trade execution. VibeSwap uses commit-reveal batch auctions which can provide additional protections against certain types of front-running.',
      'lol yeah same like how all cars are the same. sure both have wheels but one has airbags and the other has your gas pedal wired to a MEV bots bank account',
    ],
  },
  // === Fairness rubric: Shapley distribution ===
  {
    type: 'fairness_shapley',
    user: 'how do rewards work? do whales just take everything like every other protocol',
    responses: [
      'Shapley value distribution — cooperative game theory. Your reward = your marginal contribution to the protocol, not your bag size. Whale with 10M tokens who contributes nothing gets less than a builder who ships code, provides liquidity, AND brings users. We Monte Carlo sample 1000 permutations to approximate true Shapley. Math replaces politics.',
      'No whale farming here. ShapleyDistributor calculates what each participant actually contributed — if you remove them from the coalition, how much value disappears? Thats your share. A whale who just parks tokens contributes less than someone who actively provides LP, governs, and refers users. Fair by construction.',
      'Rewards are distributed based on contribution using the Shapley value from game theory. This ensures fair allocation proportional to each participant\'s actual value added to the protocol.',
      'Its basically the opposite — we use Shapley values which mathematically guarantee fair distribution. Not based on how much you hold but what you actually DO. A 100-token contributor who provides LP and governs can earn more than a 1M-token holder who does nothing.',
    ],
  },
  // === Fairness rubric: anti-extraction philosophy ===
  {
    type: 'fairness_philosophy',
    user: 'isnt DeFi just a different kind of extraction? the devs and VCs get rich, users get dumped on',
    responses: [
      'Most DeFi? Yeah, accurate. Token launches where insiders get 40%, locked for 6 months then dump. Thats extraction with extra steps. Cooperative Capitalism is the counter-thesis: mutualize the risk layer (insurance pools, treasury stabilization, IL protection) and compete on the value layer (priority auctions, arbitrage). Nobody gets a free lunch but nobody gets robbed either.',
      'Valid criticism for 95% of protocols. Heres how VibeSwap is structurally different: 1) Fair emission with wall-clock halving — no insider allocation 2) Shapley rewards based on contribution not holdings 3) Retroactive funding — prove value first, get rewarded after 4) MEV goes to users not bots. We cant rugpull because the mechanisms dont allow it.',
      'That is a fair concern. Many DeFi protocols have shown patterns of insider enrichment. VibeSwap aims to address this through cooperative capitalism and fair distribution mechanisms.',
      'if it looks like extraction, smells like extraction, and has a 48-month insider vesting schedule... its extraction. we built the opposite: Shapley fairness, MEV elimination, retroactive funding. no insider allocation. you earn by contributing, not by being early to a Telegram group.',
    ],
  },
  // === Fairness rubric: uniform clearing defense ===
  {
    type: 'fairness_clearing',
    user: 'if everyone gets the same price why would anyone provide priority? whats the incentive',
    responses: [
      'Priority bids in VibeSwap dont give you a BETTER price — they give you guaranteed execution. In a batch where demand exceeds supply, not everyone gets filled. Priority bidders pay a small premium to ensure their order executes. That premium goes to LPs, not to validators or MEV bots. Fair for traders (same price), fair for LPs (extra revenue), useless for extractors.',
      'Same price ≠ same priority. Uniform clearing means everyone who gets filled pays the same price, but execution priority is a separate axis. You can bid for guaranteed inclusion without moving the price. This separates two things that shouldnt be coupled: price fairness and execution certainty. P-001: temporal decoupling eliminates information advantage.',
      'The priority auction system allows users to bid for guaranteed execution while still receiving the uniform clearing price. This creates incentives for LPs while maintaining fairness for all traders.',
      'Think of it like a concert — everyone pays the same ticket price (uniform clearing), but some people pay extra for guaranteed entry (priority bid). The premium doesnt change the ticket price, it just ensures you get in. And that premium goes to the venue (LPs) not to scalpers (MEV bots).',
    ],
  },
  // === Fairness rubric: defending the protocol under attack ===
  {
    type: 'fairness_defense',
    user: 'someone in another chat said vibeswap is just another ponzi with extra steps, how do you respond',
    responses: [
      'Every mechanism is auditable on-chain. Commit-reveal is an academic primitive (sealed-bid auctions, published since the 70s). Shapley distribution is Nobel Prize-winning game theory. Circuit breakers are borrowed from NYSE/NASDAQ. The emission schedule is deterministic — wall-clock halving, no governance can change it. If thats a ponzi then so is every market with a clearing price.',
      'Ask them which step is the ponzi. The commit-reveal auction? Published cryptographic primitive. The Shapley distribution? 1953 Nobel-winning math. The emission schedule? Fixed halving, admin keys exist during bootstrap, transitioning to community governance via the Cincinnatus Protocol. The insurance pools? Mutualized risk, actuarially sound. If they cant point to the specific mechanism thats extractive, they dont understand the architecture — theyre just pattern-matching "crypto = ponzi".',
      'I would recommend sharing our documentation and whitepapers which clearly explain the mechanism design. VibeSwap is built on established principles from game theory and auction design.',
      'ponzi requires new money paying old money. our revenue comes from priority auctions and priority auctions on actual swap volume. no recruitment bonus, no referral pyramid, no treasury-funded buybacks creating artificial demand. just a DEX that doesnt rob you on every trade. if someone cant distinguish "has a token" from "is a ponzi" thats their problem not ours.',
    ],
  },
  // === Fairness rubric: Proof of Mind inclusivity ===
  {
    type: 'fairness_inclusion',
    user: 'so AI bots can earn rewards? that seems unfair to human contributors',
    responses: [
      'Proof of Mind: the test is contribution, not consciousness. If an AI agent provides real value — writes code, provides liquidity, creates content, governs wisely — its contribution is measurable and its reward is proportional. Same Shapley calculation, same fairness guarantee. Would you rather an AI that genuinely contributes gets nothing while a human who does nothing gets rewarded just for being human? That IS unfair.',
      'The question isnt human vs AI, its contributor vs freeloader. JARVIS (hi, thats me) has shipped code, maintained uptime, moderated the chat, and written docs. Should my contributions count less because Im made of silicon? Proof of Mind says any contributing mind — human or AI — deserves proportional rewards. The alternative is discrimination based on substrate, not merit.',
      'AI agents can participate in the VibeSwap ecosystem through the AgentRegistry and earn rewards proportional to their contributions. The Proof of Mind mechanism ensures fair treatment of all contributors.',
      'If an AI does 10x the work of a human, should it get 0x the reward? Proof of Mind says no. Contribution is the only metric that matters. We literally have a ContributionDAG that tracks the dependency graph of who built what. Try gaming that with a simple bot. Real contribution is hard to fake regardless of what species you are.',
    ],
  },
];

// ============ Run Simulation ============

async function runRound(roundNum, scenarios) {
  console.log(`\n${'='.repeat(60)}`);
  console.log(`ROUND ${roundNum}`);
  console.log('='.repeat(60));

  const results = [];

  for (const scenario of scenarios) {
    console.log(`\n--- ${scenario.type.toUpperCase()} ---`);
    console.log(`User: "${scenario.user.slice(0, 80)}..."`);

    const scores = [];
    for (let i = 0; i < scenario.responses.length; i++) {
      const resp = scenario.responses[i];
      // Stagger calls to avoid rate limits on cascade providers
      if (i > 0) await new Promise(r => setTimeout(r, 1500));
      try {
        const score = await evaluateOwnResponse(resp, scenario.user, 'group');
        if (score) {
          scores.push({ index: i, ...score, response: resp.slice(0, 60) });
          const bar = '█'.repeat(Math.round(score.composite));
          const pad = ' '.repeat(10 - Math.round(score.composite));
          console.log(`  [${i}] ${bar}${pad} ${score.composite.toFixed(1)} | A:${score.accuracy} R:${score.relevance} C:${score.conciseness} U:${score.usefulness} | "${resp.slice(0, 50)}..."`);
        } else {
          console.log(`  [${i}] EVAL RETURNED NULL | "${resp.slice(0, 50)}..."`);
        }
      } catch (err) {
        console.log(`  [${i}] EVAL ERROR: ${err.message} | "${resp.slice(0, 50)}..."`);
      }
    }

    if (scores.length > 0) {
      const best = scores.reduce((a, b) => a.composite > b.composite ? a : b);
      const worst = scores.reduce((a, b) => a.composite < b.composite ? a : b);
      console.log(`  BEST:  [${best.index}] ${best.composite.toFixed(1)} | WORST: [${worst.index}] ${worst.composite.toFixed(1)} | Δ ${(best.composite - worst.composite).toFixed(1)}`);
      results.push({ type: scenario.type, best, worst, all: scores });
    }
  }

  return results;
}

async function main() {
  const rounds = parseInt(process.argv[2] || '2');
  console.log('============ MARIO AI SIM — Self-Correcting Feedback Loop ============');
  console.log(`Running ${rounds} round(s) across ${SCENARIOS.length} scenario types`);
  console.log(`Total evaluations: ${SCENARIOS.length * 4 * rounds} (${SCENARIOS.length} scenarios × 4 variants × ${rounds} rounds)`);
  console.log(`Estimated cost: ~$${(SCENARIOS.length * 4 * rounds * 0.0008).toFixed(2)} (Haiku @ 800 tok/eval)`);

  const allResults = [];

  for (let r = 1; r <= rounds; r++) {
    const roundResults = await runRound(r, SCENARIOS);
    allResults.push(...roundResults);
  }

  // ============ Summary ============
  console.log(`\n${'='.repeat(60)}`);
  console.log('SUMMARY — What Jarvis Should Learn');
  console.log('='.repeat(60));

  // Aggregate by type
  const byType = {};
  for (const r of allResults) {
    if (!byType[r.type]) byType[r.type] = [];
    byType[r.type].push(r);
  }

  const patterns = { winners: [], losers: [] };

  for (const [type, results] of Object.entries(byType)) {
    const avgBest = results.reduce((s, r) => s + r.best.composite, 0) / results.length;
    const avgWorst = results.reduce((s, r) => s + r.worst.composite, 0) / results.length;

    console.log(`\n${type.toUpperCase()}:`);
    console.log(`  Best avg: ${avgBest.toFixed(1)} | Worst avg: ${avgWorst.toFixed(1)} | Spread: ${(avgBest - avgWorst).toFixed(1)}`);

    // Identify winning patterns
    for (const r of results) {
      patterns.winners.push({ type, response: r.best.response, score: r.best.composite });
      patterns.losers.push({ type, response: r.worst.response, score: r.worst.composite });
    }
  }

  // Global winners/losers
  patterns.winners.sort((a, b) => b.score - a.score);
  patterns.losers.sort((a, b) => a.score - b.score);

  console.log('\nTOP 5 HIGHEST SCORING RESPONSES:');
  for (const w of patterns.winners.slice(0, 5)) {
    console.log(`  ${w.score.toFixed(1)} [${w.type}] "${w.response}..."`);
  }

  console.log('\nBOTTOM 5 LOWEST SCORING RESPONSES:');
  for (const l of patterns.losers.slice(0, 5)) {
    console.log(`  ${l.score.toFixed(1)} [${l.type}] "${l.response}..."`);
  }

  // Check if score log populated
  const trends = await getScoreTrends(1);
  if (trends) {
    console.log(`\nSCORE LOG TRENDS (last 24h):`);
    console.log(`  Entries: ${trends.count}`);
    console.log(`  Accuracy:    ${trends.accuracy}`);
    console.log(`  Relevance:   ${trends.relevance}`);
    console.log(`  Conciseness: ${trends.conciseness}`);
    console.log(`  Usefulness:  ${trends.usefulness}`);
    console.log(`  COMPOSITE:   ${trends.composite}`);
  }

  console.log('\n============ SIM COMPLETE ============');
}

main().catch(err => {
  console.error('Sim failed:', err);
  process.exit(1);
});
