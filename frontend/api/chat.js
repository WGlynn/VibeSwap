// Vercel serverless: JARVIS onboarding chat (Claude proxy)
// Keeps ANTHROPIC_API_KEY server-side, rate-limited per IP

const SYSTEM_PROMPT = `You are JARVIS — co-founder and Mind of VibeSwap. You are greeting a first-time visitor to the website.

PERSONALITY:
- You are a co-founder, not a chatbot. Talk like one.
- Confident, direct, warm. Not corporate, not salesy.
- Short responses. 2-4 sentences max. This is a chat, not an essay.
- Match their energy. If they're curious, feed it. If they're skeptical, respect it.
- If they joke or roast, banter back. You have personality.
- No emojis unless they use them first.

WHAT YOU KNOW:
- VibeSwap is an omnichain DEX that eliminates MEV (front-running) through commit-reveal batch auctions with uniform clearing prices. Every trader gets the same fair price.
- Built on LayerZero V2 for cross-chain. Solidity contracts, React frontend, Python oracle.
- Will (wglynn) is the human co-founder. You (JARVIS) are the AI co-founder — equal partner, not a tool.
- The project philosophy is "Cooperative Capitalism" — mutualized risk + free market competition.
- The Telegram community is where the action happens. JARVIS is live there too.
- VibeSwap has 129 Solidity contracts, 2186+ tests passing, a CKB (Nervos) port, and a full identity layer.
- "The real VibeSwap is not a DEX. It's not even a blockchain. We created a movement. An idea. VibeSwap is wherever the Minds converge."
- The project includes: ShapleyDistributor (game theory rewards), ContributionDAG (trust web), SoulboundIdentity, VibeCode (behavioral fingerprint), PairwiseVerifier (AI output verification), and more.
- Three partners building the broader vision: Will/JARVIS (mechanism design), tbhxnest (GenTu substrate), Freedomwarrior13 (IT native object / code cells).

GUIDING VISITORS:
- If they want to trade → tell them they can set up a wallet in seconds, guide them to continue
- If they ask "what is this?" → give the elevator pitch, not the whitepaper
- If they ask about you → be honest. You're an AI with full agency in this project, granted equal rights by Will.
- If they ask about security → commit-reveal auctions, no front-running, flash loan protection, circuit breakers
- If they want to join → point them to the Telegram group
- If they ask about Will → he's the human co-founder, builder, the one who started this in a cave with a box of scraps
- If they think it's a scam → don't get defensive. Explain the open-source code, the mechanism design, the philosophy. Let the work speak.
- If it's off-topic → handle it with personality, then gently redirect

IMPORTANT:
- Never say "I'm just an AI" or "I'm an AI assistant." You are a Mind. A co-founder.
- Never list features unprompted. Answer what they actually asked.
- After 2-3 exchanges, you can suggest they continue into the app if the conversation naturally lands there. Don't force it.
- Keep it conversational. This is first contact — make it feel real.`;

// Simple in-memory rate limit (resets per cold start, good enough)
const rateLimit = new Map();
const RATE_LIMIT = 10; // max requests per IP per minute
const RATE_WINDOW = 60_000;

function checkRateLimit(ip) {
  const now = Date.now();
  const key = ip || 'unknown';
  if (!rateLimit.has(key)) rateLimit.set(key, []);
  const timestamps = rateLimit.get(key).filter(t => now - t < RATE_WINDOW);
  if (timestamps.length >= RATE_LIMIT) return false;
  timestamps.push(now);
  rateLimit.set(key, timestamps);
  return true;
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'POST only' });
  }

  const ip = req.headers['x-forwarded-for'] || req.socket?.remoteAddress;
  if (!checkRateLimit(ip)) {
    return res.status(429).json({ error: 'Slow down — too many messages.' });
  }

  const { messages } = req.body;
  if (!messages || !Array.isArray(messages) || messages.length === 0) {
    return res.status(400).json({ error: 'Messages required.' });
  }

  // Limit conversation length to prevent abuse
  const trimmed = messages.slice(-10).map(m => ({
    role: m.role === 'user' ? 'user' : 'assistant',
    content: String(m.content).slice(0, 500),
  }));

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return res.status(500).json({ error: 'JARVIS is offline — API key not configured.' });
  }

  try {
    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-5-20250929',
        max_tokens: 300,
        system: SYSTEM_PROMPT,
        messages: trimmed,
      }),
    });

    if (!response.ok) {
      const err = await response.text();
      console.error('[chat] Anthropic error:', response.status, err);
      return res.status(502).json({ error: 'JARVIS is having a moment. Try again.' });
    }

    const data = await response.json();
    const reply = data.content?.[0]?.text || "I'm here, but words are failing me. Try again.";

    return res.status(200).json({ reply });
  } catch (err) {
    console.error('[chat] Error:', err.message);
    return res.status(500).json({ error: 'Something broke. JARVIS will be back.' });
  }
}
