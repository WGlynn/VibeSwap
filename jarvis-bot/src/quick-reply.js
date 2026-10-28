// ============ Quick replies: no model for trivial turns ============
//
// Will 2026-10-28: "i just said hello to the bot and it took almost a minute". The meter showed
// why: a greeting went out with a 23k-token system prompt, through two 503s and a model
// rotation. A greeting, a thanks or an "ok" needs no model at all. This answers those in
// milliseconds and costs no quota.
//
// Conservative on purpose: the WHOLE message (mention and punctuation stripped) must be one of
// the patterns and at most five words. "hello? my tx failed" does not match. Anything with a
// question that is not a plain "you there?" goes to the model.

const GREETING = /^(hi|hiya|hello|hey|heya|yo|sup|wassup|gm|good (morning|afternoon|evening|night)|morning|evening|howdy|hola|ahoy)( there| jarvis| j| bot| man| mate| fam| all| everyone)?$/i;
const THANKS = /^(thanks|thank you|thx|ty|tyvm|cheers|appreciate(d| it)|nice one)( jarvis| man| mate| a lot| so much)?$/i;
const ACK = /^(ok|okay|k|kk|cool|nice|got it|understood|sounds good|great|perfect|roger|copy|noted|yep|yup|yes|no|nah|lol|haha|ha)$/i;
const PRESENCE = /^(you (there|up|alive|online|awake)|still (there|up|alive)|u (there|up)|jarvis\?*|ping|anyone (there|home))$/i;
const BYE = /^(bye|goodbye|good night|gn|night|later|see ya|see you|ttyl|brb|afk)( jarvis| all| everyone)?$/i;

function pick(list, seed) {
  return list[Math.abs(seed) % list.length];
}

export function normalizeForQuickReply(text, botUsername) {
  let t = String(text || '').trim();
  if (botUsername) t = t.replace(new RegExp(`@${botUsername}\\b`, 'ig'), ' ');
  t = t.replace(/[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/gu, ' '); // emoji do not change the class
  t = t.replace(/[!?.,:;~*_`'"()]+/g, ' ').replace(/\s+/g, ' ').trim();
  return t;
}

// Returns a reply string, or null when the model should answer.
export function quickReply(text, { name, botUsername, uptimeSec, model } = {}) {
  const t = normalizeForQuickReply(text, botUsername);
  if (!t || t.split(' ').length > 5) return null;
  const who = name ? ` ${name}` : '';
  const seed = t.length + (name ? name.length : 0) + new Date().getUTCHours();

  if (GREETING.test(t)) {
    return pick([
      `hey${who}. what are we working on?`,
      `hi${who}. i'm here.`,
      `hey${who}. go ahead.`,
    ], seed);
  }
  if (THANKS.test(t)) {
    return pick([`any time${who}.`, `of course.`, `glad it helped.`], seed);
  }
  if (ACK.test(t)) {
    return null; // an ack needs no reply at all in a DM; the caller decides (see index.js)
  }
  if (PRESENCE.test(t)) {
    const up = uptimeSec ? ` up ${Math.floor(uptimeSec / 3600)}h ${Math.floor((uptimeSec % 3600) / 60)}m` : '';
    return `here${who}.${up}${model ? ` on ${model}` : ''}.`;
  }
  if (BYE.test(t)) {
    return pick([`later${who}.`, `night${who}.`, `see you${who}.`], seed);
  }
  return null;
}

// True when the message is a bare acknowledgement that needs no reply (DM only; groups never
// get here because the bot only answers tags there).
export function isBareAck(text, botUsername) {
  const t = normalizeForQuickReply(text, botUsername);
  return !!t && ACK.test(t);
}
