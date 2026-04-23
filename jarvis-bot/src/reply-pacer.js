// ============ Reply Pacer ============
//
// Long-running reply generation reads as a stall to users watching an
// empty chat. Telegraf's sendChatAction('typing') only paints for ~5s
// and doesn't persist. This module sends a visible placeholder message
// when generation is running abnormally long (mean + 2σ over the rolling
// latency window), then edits the placeholder to carry the real reply
// when it arrives. One message in the chat, no doubled output, user sees
// liveliness.
//
// Cold-start: while we have fewer than COLD_START_MIN_SAMPLES, use a
// fixed COLD_START_THRESHOLD_MS. Floor: never fire faster than
// MIN_PACER_FLOOR_MS regardless of distribution — short replies that
// complete in 500ms should NEVER trigger a placeholder.
//
// Failure modes:
//  - Placeholder send fails → log + continue; real reply goes out
//    via normal ctx.reply path.
//  - Edit fails (e.g. message too old, rate limited) → fall back to a
//    new reply message. User sees two messages; acceptable degradation.

const LATENCY_WINDOW_MAX = 50;
const MIN_PACER_FLOOR_MS = 8_000;
const COLD_START_THRESHOLD_MS = 10_000;
const COLD_START_MIN_SAMPLES = 10;

// Variety so the placeholder doesn't feel templatized. Each is short,
// in-voice for JARVIS (no emojis, no corporate). The rule (see persona
// rule 11 BREVITY REFLEX) applies here too — 1 sentence max.
const PLACEHOLDER_MESSAGES = [
  'one sec — thinking on this.',
  'hold on, pulling some context.',
  'working through it, give me a moment.',
  'bear with me — this one needs some thought.',
  'digging through the archive, back in a beat.',
  'one moment, composing.',
];

const latencies = [];

function pickPlaceholder() {
  return PLACEHOLDER_MESSAGES[Math.floor(Math.random() * PLACEHOLDER_MESSAGES.length)];
}

function computeStats() {
  if (latencies.length === 0) return { mean: 0, stddev: 0, samples: 0 };
  const n = latencies.length;
  const mean = latencies.reduce((a, b) => a + b, 0) / n;
  const variance = latencies.reduce((acc, v) => acc + (v - mean) * (v - mean), 0) / n;
  return { mean, stddev: Math.sqrt(variance), samples: n };
}

function thresholdMs() {
  const { mean, stddev, samples } = computeStats();
  if (samples < COLD_START_MIN_SAMPLES) return COLD_START_THRESHOLD_MS;
  return Math.max(MIN_PACER_FLOOR_MS, mean + 2 * stddev);
}

function recordLatency(ms) {
  latencies.push(ms);
  if (latencies.length > LATENCY_WINDOW_MAX) latencies.shift();
}

// ============ Public API ============

/**
 * Start a pacer around an LLM reply generation. The caller should either
 * call `pacer.replyWith(text)` when the reply is ready, or `pacer.cancel()`
 * if no reply will be sent (error path, silenced chat, etc).
 *
 * `opts.replyToMessageId` — if provided and the placeholder fires, it
 *   replies to the originating message so the user sees the thread link.
 */
export function startReplyPacer(ctx, opts = {}) {
  const startTs = Date.now();
  const threshold = thresholdMs();
  let placeholderMsgId = null;
  let fired = false;
  let stopped = false;

  const timer = setTimeout(async () => {
    if (stopped) return;
    try {
      const replyOpts = {};
      if (opts.replyToMessageId) replyOpts.reply_to_message_id = opts.replyToMessageId;
      const sent = await ctx.reply(pickPlaceholder(), replyOpts);
      placeholderMsgId = sent?.message_id || null;
      fired = true;
    } catch (err) {
      console.warn(`[reply-pacer] placeholder send failed: ${err.message}`);
    }
  }, threshold);
  if (timer.unref) timer.unref();

  return {
    /**
     * Send the real reply. If a placeholder was posted, edit it in place
     * (single message). Otherwise, send a new reply normally.
     * Returns the sent-or-edited Message, or null on hard failure.
     */
    async replyWith(replyText, extra = {}) {
      clearTimeout(timer);
      stopped = true;
      recordLatency(Date.now() - startTs);

      if (!replyText || typeof replyText !== 'string') return null;

      if (fired && placeholderMsgId) {
        try {
          await ctx.telegram.editMessageText(ctx.chat.id, placeholderMsgId, undefined, replyText);
          return { message_id: placeholderMsgId, edited: true };
        } catch (err) {
          console.warn(`[reply-pacer] edit of placeholder failed, falling back to new message: ${err.message}`);
          // Fall through to send a fresh reply
        }
      }

      try {
        return await ctx.reply(replyText, extra);
      } catch (err) {
        console.warn(`[reply-pacer] reply failed: ${err.message}`);
        return null;
      }
    },

    /**
     * Abandon this pacer without sending a reply. Still records the
     * elapsed time so the rolling distribution stays honest.
     */
    cancel() {
      clearTimeout(timer);
      stopped = true;
      recordLatency(Date.now() - startTs);
    },

    /** For debugging / /pacer status commands */
    introspect() {
      const stats = computeStats();
      return {
        elapsedMs: Date.now() - startTs,
        thresholdMs: threshold,
        placeholderFired: fired,
        samples: stats.samples,
        meanMs: Math.round(stats.mean),
        stddevMs: Math.round(stats.stddev),
      };
    },
  };
}

export function getPacerStats() {
  const stats = computeStats();
  return {
    samples: stats.samples,
    meanMs: Math.round(stats.mean),
    stddevMs: Math.round(stats.stddev),
    currentThresholdMs: thresholdMs(),
  };
}
