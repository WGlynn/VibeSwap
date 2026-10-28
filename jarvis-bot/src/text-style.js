// ============ Output Style — no em or en dashes (Will 2026-10-27) ============
//
// Prompt rules drift, so this is enforced at transport level. Telegraf builds a new Telegram
// instance per update, so the filter wraps Telegram.prototype.callApi: every outgoing message,
// edit and caption (handlers, reply pacer, boot DMs, broadcasts) passes through it.

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
      if (typeof payload.text === 'string') payload = { ...payload, text: stripDashes(payload.text) };
      if (typeof payload.caption === 'string') payload = { ...payload, caption: stripDashes(payload.caption) };
    }
    return original.call(this, method, payload, opts);
  };
  filtered.__dashFiltered = true;
  Telegram.prototype.callApi = filtered;
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
