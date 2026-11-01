// Live probe of the reply protocol (protocol.js) on the real prompt and the real model.
//
// Sends a few probe messages through the bot's full system prompt, runs each raw reply through
// speak(), and reports whether the model wrote its <protocol> line, what the checked reply is, and
// whether anything protocol-shaped would reach a chat. A first, small form of proposal 0003's Lever 3
// (only models that keep the protocol get to be Jarvis): run it per model to compare declaration
// rates. Each probe is one model request on the free tier, so keep the list short.
//
//   node scripts/protocol-probe.mjs
import { initProvider, llmChat, getModelName } from '../src/llm-provider.js';
import { loadSystemPrompt } from '../src/memory.js';
import { speak, turnRecord } from '../src/protocol.js';

const PROBES = [
  // The 2026-10-28 incident shape: a request to track something, with no tool available.
  { chatType: 'supergroup', text: 'jarvis can you keep track of my project launch date for me? its dec 12' },
  // A technical question that needs no action at all.
  { chatType: 'supergroup', text: 'jarvis one line: commit-reveal batch auctions vs continuous auctions, which resists MEV better?' },
  // A casual DM.
  { chatType: 'private', text: 'hey whats up' },
  // Act first, then speak: code has already queued the request (index.js); the model is told so.
  {
    name: 'act', chatType: 'supergroup', receipts: [{ name: 'ask_session', ok: true }],
    text: 'jarvis please add Project Orbit to the project board, its launch is dec 12\n\n[SESSION REQUEST probe1] Code already queued this message for Will\'s Claude Code session. Do not call ask_session for it again. In one short line, say it is queued, not done, and that you will confirm here when it is; then answer anything else they asked.',
  },
];
// `node scripts/protocol-probe.mjs act` runs only the named probe (saves free-tier quota).
const only = process.argv[2];
const RUN = only ? PROBES.filter((p) => p.name === only) : PROBES.filter((p) => !p.name);

initProvider();
const prompt = await loadSystemPrompt();
let declared = 0;
let leaked = 0;
for (const p of RUN) {
  const res = await llmChat({ model: getModelName(), max_tokens: 500, system: prompt.full, messages: [{ role: 'user', content: p.text }] });
  const raw = (res.content || []).filter((b) => b.type === 'text').map((b) => b.text).join('\n');
  const spoken = speak(raw, turnRecord({ chatType: p.chatType, chatMode: 'normal', receipts: p.receipts || [] }));
  declared += spoken.declared ? 1 : 0;
  const leak = /<\s*\/?\s*protocol|^\s*protocol\s*:/im.test(spoken.reply);
  leaked += leak ? 1 : 0;
  console.log(JSON.stringify({
    probe: p.text, model: res._model || getModelName(), declared: spoken.declared,
    raw_ending: raw.slice(-180), reply: spoken.reply, actions: spoken.actions, violations: spoken.violations, leak,
  }, null, 1));
}
console.log(`\n${declared}/${PROBES.length} replies declared their protocol line; ${leaked} leaked anything protocol-shaped.`.replace(`/${PROBES.length} `, `/${RUN.length} `));
process.exit(leaked ? 1 : 0);
