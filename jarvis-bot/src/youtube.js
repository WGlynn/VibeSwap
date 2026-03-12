// ============ YouTube Intelligence — Video Understanding ============
//
// Detects YouTube URLs in messages, fetches transcripts + metadata,
// and provides context to JARVIS for intelligent responses.
// ============

import { YoutubeTranscript } from 'youtube-transcript';

// ============ URL Detection ============

const YT_REGEX = /(?:https?:\/\/)?(?:www\.)?(?:youtube\.com\/(?:watch\?v=|shorts\/|embed\/)|youtu\.be\/)([\w-]{11})/gi;

/**
 * Extract all YouTube video IDs from text.
 */
export function extractVideoIds(text) {
  const ids = [];
  let match;
  const re = new RegExp(YT_REGEX.source, YT_REGEX.flags);
  while ((match = re.exec(text)) !== null) {
    ids.push(match[1]);
  }
  return [...new Set(ids)];
}

// ============ Transcript Fetching ============

/**
 * Fetch transcript for a YouTube video. Returns { title, transcript, duration } or null.
 */
export async function fetchVideoContext(videoId) {
  try {
    // Fetch transcript segments
    const segments = await YoutubeTranscript.fetchTranscript(videoId);
    if (!segments || segments.length === 0) return null;

    // Combine segments into readable text
    const transcript = segments.map(s => s.text).join(' ');
    const duration = segments[segments.length - 1]?.offset
      ? Math.round((segments[segments.length - 1].offset + (segments[segments.length - 1].duration || 0)) / 1000)
      : null;

    // Fetch basic metadata via oEmbed (no API key needed)
    let title = null;
    try {
      const res = await fetch(`https://www.youtube.com/oembed?url=https://www.youtube.com/watch?v=${videoId}&format=json`, {
        signal: AbortSignal.timeout(5000),
      });
      if (res.ok) {
        const data = await res.json();
        title = data.title;
      }
    } catch { /* metadata is optional */ }

    return {
      videoId,
      title: title || `Video ${videoId}`,
      transcript: transcript.slice(0, 8000), // Cap at ~8k chars to stay within context limits
      duration,
      url: `https://www.youtube.com/watch?v=${videoId}`,
    };
  } catch (err) {
    console.warn(`[youtube] Failed to fetch transcript for ${videoId}: ${err.message}`);
    // Try metadata-only fallback
    try {
      const res = await fetch(`https://www.youtube.com/oembed?url=https://www.youtube.com/watch?v=${videoId}&format=json`, {
        signal: AbortSignal.timeout(5000),
      });
      if (res.ok) {
        const data = await res.json();
        return {
          videoId,
          title: data.title || `Video ${videoId}`,
          transcript: null,
          duration: null,
          url: `https://www.youtube.com/watch?v=${videoId}`,
          author: data.author_name,
        };
      }
    } catch { /* everything failed */ }
    return null;
  }
}

/**
 * Process a message for YouTube content. Returns context string to prepend to Claude prompt, or null.
 */
export async function processYouTubeLinks(text) {
  const ids = extractVideoIds(text);
  if (ids.length === 0) return null;

  const contexts = [];
  for (const id of ids.slice(0, 3)) { // Max 3 videos per message
    const ctx = await fetchVideoContext(id);
    if (ctx) {
      let block = `[YOUTUBE VIDEO: "${ctx.title}" — ${ctx.url}]`;
      if (ctx.duration) block += ` (${Math.floor(ctx.duration / 60)}m${ctx.duration % 60}s)`;
      if (ctx.author) block += ` by ${ctx.author}`;
      if (ctx.transcript) {
        block += `\n[TRANSCRIPT]: ${ctx.transcript}`;
      } else {
        block += `\n[No transcript available — respond based on title/metadata only]`;
      }
      contexts.push(block);
    }
  }

  return contexts.length > 0 ? contexts.join('\n\n') : null;
}
