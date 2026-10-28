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
