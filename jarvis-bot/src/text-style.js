// ============ Output Style — no em or en dashes (Will 2026-10-27) ============
//
// Prompt rules drift, so this is enforced at transport level. Telegraf builds a new Telegram
// instance per update, so the filter wraps Telegram.prototype.callApi: every outgoing message,
// edit and caption (handlers, reply pacer, boot DMs, broadcasts) passes through it. The same
// filter removes anything protocol-shaped (protocol.js stripProtocolBlocks) and a closing
// availability line (stripSignOff below).

import { stripProtocolBlocks } from './protocol.js';

const DASHES = /[—–]/;

export function stripDashes(text) {
  if (!DASHES.test(text)) return text;
  return text
    .replace(/(\d)\s*[–—]\s*(\d)/g, '$1-$2') // ranges: 3–5 -> 3-5
    .replace(/^[ \t]*[—–][ \t]*/gm, '')    // a dash opening a line
    .replace(/[ \t]*[—–][ \t]*(?=\n|$)/g, '') // a dash closing a line
    .replace(/\s*[—–]\s*/g, ', ')          // clause dashes -> comma
    .replace(/,(\s*,)+/g, ',');
}

export function installDashFilter(Telegram) {
  const original = Telegram.prototype.callApi;
  if (original.__dashFiltered) return;
  const filtered = function (method, payload, opts) {
    if (payload && typeof payload === 'object') {
      if (typeof payload.text === 'string') payload = { ...payload, text: stripSignOff(stripDashes(stripProtocolBlocks(payload.text))) };
      if (typeof payload.caption === 'string') payload = { ...payload, caption: stripSignOff(stripDashes(stripProtocolBlocks(payload.caption))) };
      // A new message that is only an availability line is not sent. An edit keeps its text, so a
      // reply pacer placeholder is never left behind.
      if (method === 'sendMessage' && isSignOffOnly(payload.text)) return holdSignOff.call(this, original, payload, opts);
    }
    return original.call(this, method, payload, opts);
  };
  filtered.__dashFiltered = true;
  Telegram.prototype.callApi = filtered;
}

// ============ No availability sign-offs (Will 2026-11-03) ============
//
// Replies kept closing on an availability line ("ready when Will spins up the indexer.", "ready
// whenever"), which Will calls an on-the-nose AI trope. Prompt rule 25 (memory.js) asks for this;
// the transport enforces it. Only a closing sentence that is nothing but such a line goes, and only
// while other content remains; nothing before it is touched. A sentence with its own subject ("the
// build is ready when the tests pass, then we ship") is a claim, not a sign-off, so it stays.

const REST = String.raw`[^.!?,:;\n]*`; // the rest of that clause, never a second clause
const SIGN_OFF = new RegExp(
  String.raw`^(?:(?:ok(?:ay)?|cool|alright|anyway|so|and)[,.!]?\s+)?` // an optional lead-in word
  + String.raw`(?:(?:i'?m|i am|i'?ll be|i will be|still|just|we'?re|we are)\s+)?` // an optional subject
  + '(?:' + [
    String.raw`(?:ready|all set)(?:\s+to\s+(?:go|roll|help|start|dig in|jump in))?\s+(?:when(?:ever)?|once)\b${REST}`, // ready when you are, ready whenever
    String.raw`ready\s+(?:and waiting|for (?:the next (?:one|step)|more|whatever'?s next))`,
    String.raw`standing by(?:\s+(?:for|if|until|in case|when(?:ever)?)\b${REST})?`,
    String.raw`(?:here|around)\s+(?:if|when(?:ever)?)\b${REST}`, // here whenever you need me
    String.raw`(?:let me know|lmk|ping me|holler)\s+(?:when(?:ever)?|once|if)\s+(?:you|there'?s anything|anything)\b${REST}`,
    String.raw`(?:just\s+)?say the word`,
    String.raw`when(?:ever)?\s+you(?:'re|\s+are)\s+ready`,
  ].join('|') + ')'
  + String.raw`(?:,\s*\p{L}+)?[\s.!\u2026\p{Extended_Pictographic}\uFE0F\u200D]*$`, // an optional name, then the end
  'iu',
);

export function isSignOffOnly(text) {
  return typeof text === 'string' && SIGN_OFF.test(text.replace(/[\u2018\u2019]/g, "'").trim());
}

// The closing sentence starts after the last sentence end that is followed by a space, or a line break.
const BOUNDARY = /[.!?\u2026]+["'\u201D\u2019)\]]*\s+|\n\s*/g;

export function stripSignOff(text) {
  if (typeof text !== 'string') return text;
  let out = text;
  for (;;) {
    const body = out.replace(/\s+$/, '');
    let cut = -1;
    for (const m of body.matchAll(BOUNDARY)) cut = m.index + m[0].length;
    const head = cut > 0 ? body.slice(0, cut).replace(/\s+$/, '') : '';
    if (!head || !isSignOffOnly(body.slice(cut))) return out;
    out = head;
  }
}

// A new message that is only an availability line is not sent. In a group, the message it answers
// gets a thumbs-up instead when the payload names it (a threaded reply); otherwise it is dropped and
// logged. Either way the call resolves, so no caller falls back to sending text.
async function holdSignOff(original, payload, opts) {
  const chatId = payload.chat_id;
  const answered = payload.reply_parameters?.message_id ?? payload.reply_to_message_id;
  const preview = payload.text.slice(0, 60).replace(/\n/g, ' ');
  if (answered && String(chatId).startsWith('-')) {
    try {
      await original.call(this, 'setMessageReaction', { chat_id: chatId, message_id: answered, reaction: [{ type: 'emoji', emoji: THUMBS_UP }] }, opts);
      console.log(`[sign-off] reply was only an availability line ("${preview}"): reacted to message ${answered} in chat ${chatId} instead`);
    } catch (err) {
      console.warn(`[sign-off] reply was only an availability line ("${preview}"): not sent to chat ${chatId}, and the reaction failed: ${err.message}`);
    }
    return true;
  }
  console.log(`[sign-off] reply was only an availability line ("${preview}"): not sent to chat ${chatId}`);
  return true;
}

// ============ Third wheel: react, do not reply (Will 2026-11-03) ============
//
// In "Will, Blake and Jarvis" Will wrote to Blake, not to the bot, and the proactive path posted a
// reply anyway. Will: "as the third wheel of that exchange, a thumbs up reaction to my message will
// suffice." A group message that does not address the bot gets this reaction where the proactive
// path would have replied (index.js). A failed reaction is logged and nothing is sent in its place.

export const THUMBS_UP = '👍';

export async function reactInstead(ctx) {
  try {
    await ctx.react(THUMBS_UP);
    console.log(`[airspace] third-wheel: reacted instead of replying in chat ${ctx.chat?.id}`);
    return true;
  } catch (err) {
    console.warn(`[airspace] third-wheel: reaction failed in chat ${ctx.chat?.id}, nothing sent: ${err.message}`);
    return false;
  }
}

// ============ Room Register — fit the chat's own humans (Will 2026-10-28) ============
//
// "blend into chats, substance over performance": casual turns get one block sized from how this
// chat's humans actually write. Technical turns use registerLine in claude.js instead. Voice untouched.

export const ROOM_MIN_SAMPLES = 5;
export const ROOM_AIM_MULT = 3; // the one knob the learning loop may tune

export function wordCount(text) {
  return String(text || '')
    .replace(/https?:\/\/\S+/g, ' ')
    .replace(/@\w+/g, ' ')
    .split(/\s+/)
    .filter(Boolean).length;
}

export function roomLine({ isGroup, humanTexts = [], recentReplies = [] }) {
  const lines = [];
  // Zeros dropped so bare tags do not drag the median to 0.
  const counts = humanTexts.map(wordCount).filter(n => n > 0).sort((a, b) => a - b);
  if (isGroup && counts.length >= ROOM_MIN_SAMPLES) {
    const median = counts[Math.floor((counts.length - 1) / 2)];
    const aim = Math.max(12, Math.min(40, ROOM_AIM_MULT * median));
    lines.push(`- People here write about ${median} words a message. Land near ${aim} words; run longer only when the point needs it, and put the point first. Same voice and wit, just sized to the room.`);
  }
  if (isGroup) {
    lines.push("- If you were only tagged, answer what the room was just saying or keep it to a short hello. Bring up your own setup or models only if someone here asks. Never bring up anything from Will's DMs in a group, even if asked.");
  }
  const asked = recentReplies.slice(-6).filter(r => /\?\s*$/.test(String(r).trim())).length;
  if (asked >= 2) {
    lines.push('- Your recent replies here kept ending on a question. End on your point; ask only when you need the answer.');
  }
  return lines.length ? '\n\n## ROOM THIS TURN\n' + lines.join('\n') : '';
}
