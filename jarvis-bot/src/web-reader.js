// ============ Web Reader — URL Content Extraction ============
//
// Detects non-YouTube URLs in messages, fetches page content,
// and returns clean text summaries for JARVIS context.
// ============

// ============ Constants ============

import { safeFetch } from './url-guard.js';

const MAX_URLS = 2;
const FETCH_TIMEOUT_MS = 5000;
const MAX_BODY_CHARS = 2000;
const MAX_RESPONSE_BYTES = 512 * 1024; // BOT-301: 512KB cap on response body
const USER_AGENT = 'JarvisBot/1.0 (VibeSwap; +https://vibeswap.io)';
const HTML_TYPES = /text\/html|application\/xhtml/;

// BOT-300 (SSRF) lives in url-guard.js since 2026-11-04, shared with every other fetch of an
// outside URL: the old host-name check here let a public name that resolves to 127.0.0.1 through.

// ============ URL Detection ============

const URL_REGEX = /https?:\/\/[^\s<>\"'\])}]+/gi;

const SKIP_PATTERNS = [
  /(?:youtube\.com|youtu\.be)/i,
  /(?:t\.me|telegram\.org|telegram\.me)/i,
  /\.(?:png|jpg|jpeg|gif|webp|svg|bmp|ico|mp4|webm|mov|avi|mkv)(?:\?|$)/i,
];

/**
 * Extract non-YouTube, non-Telegram, non-media URLs from text.
 * @param {string} text - Message text to scan
 * @returns {string[]} Array of URLs (max MAX_URLS)
 */
export function extractUrls(text) {
  if (!text || typeof text !== 'string') return [];

  const matches = text.match(URL_REGEX) || [];
  const filtered = matches.filter(url =>
    !SKIP_PATTERNS.some(pattern => pattern.test(url))
  );

  return [...new Set(filtered)].slice(0, MAX_URLS);
}

// ============ HTML Parsing ============

/**
 * Extract title from raw HTML.
 */
function extractTitle(html) {
  const match = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  return match ? match[1].replace(/\s+/g, ' ').trim() : null;
}

/**
 * Extract author from HTML meta tags (og:author, twitter:creator, article:author, author).
 */
function extractAuthor(html) {
  // Try JSON-LD structured data first (most reliable)
  const jsonLdMatch = html.match(/<script[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/i);
  if (jsonLdMatch) {
    try {
      const ld = JSON.parse(jsonLdMatch[1]);
      const authorObj = ld.author || ld[0]?.author;
      if (authorObj) {
        const name = typeof authorObj === 'string' ? authorObj
          : Array.isArray(authorObj) ? authorObj[0]?.name
          : authorObj.name;
        if (name && name.length < 100) return name.trim();
      }
    } catch { /* malformed JSON-LD, fall through */ }
  }

  // Meta tag patterns
  const patterns = [
    /<meta[^>]*(?:name|property)=["'](?:author|article:author|og:author|twitter:creator)["'][^>]*content=["']([^"']+)["']/i,
    /<meta[^>]*content=["']([^"']+)["'][^>]*(?:name|property)=["'](?:author|article:author|og:author|twitter:creator)["']/i,
    /<a[^>]*class=["'][^"']*author[^"']*["'][^>]*>([^<]+)</i,
    /<span[^>]*class=["'][^"']*author[^"']*["'][^>]*>([^<]+)</i,
    // rel="author" link
    /<a[^>]*rel=["']author["'][^>]*>([^<]+)</i,
  ];
  for (const re of patterns) {
    const match = html.match(re);
    if (match) {
      const author = match[1].replace(/^@/, '').trim();
      if (author && author.length < 100) return author;
    }
  }
  return null;
}

/**
 * Extract subreddit from Reddit HTML.
 */
function extractSubreddit(html) {
  const match = html.match(/(?:property=["']og:title["'][^>]*content=["']r\/(\w+)|<title[^>]*>[^<]*r\/(\w+))/i);
  return match ? `r/${match[1] || match[2]}` : null;
}

/**
 * Extract meta description from raw HTML.
 */
function extractMetaDescription(html) {
  const match = html.match(
    /<meta[^>]*name=["']description["'][^>]*content=["']([\s\S]*?)["'][^>]*\/?>/i
  ) || html.match(
    /<meta[^>]*content=["']([\s\S]*?)["'][^>]*name=["']description["'][^>]*\/?>/i
  ) || html.match(
    /<meta[^>]*property=["']og:description["'][^>]*content=["']([\s\S]*?)["'][^>]*\/?>/i
  ) || html.match(
    /<meta[^>]*content=["']([\s\S]*?)["'][^>]*property=["']og:description["'][^>]*\/?>/i
  );
  return match ? match[1].replace(/\s+/g, ' ').trim() : null;
}

/**
 * Strip HTML tags and extract clean body text.
 */
function extractBodyText(html) {
  // Remove script, style, noscript, nav, header, footer blocks
  let cleaned = html
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/<noscript[\s\S]*?<\/noscript>/gi, '')
    .replace(/<nav[\s\S]*?<\/nav>/gi, '')
    .replace(/<header[\s\S]*?<\/header>/gi, '')
    .replace(/<footer[\s\S]*?<\/footer>/gi, '');

  // Strip remaining tags
  cleaned = cleaned.replace(/<[^>]+>/g, ' ');

  // Decode common HTML entities
  cleaned = cleaned
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, ' ')
    .replace(/&#\d+;/g, '');

  // Collapse whitespace
  cleaned = cleaned.replace(/\s+/g, ' ').trim();

  return cleaned.slice(0, MAX_BODY_CHARS);
}

// ============ Page Fetching ============

/**
 * Fetch a single URL and return structured content.
 * @param {string} url
 * @returns {Promise<{title: string, description: string, body: string, url: string} | null>}
 */
async function fetchPage(url) {
  try {
    // url-guard.js: the resolved address must be public (BOT-300), every redirect hop is checked
    // again, the body stops at MAX_RESPONSE_BYTES (BOT-301), and a non-HTML body is not read.
    const response = await safeFetch(url, {
      timeoutMs: FETCH_TIMEOUT_MS,
      maxBytes: MAX_RESPONSE_BYTES,
      maxRedirects: 3,
      contentType: HTML_TYPES,
      headers: {
        'User-Agent': USER_AGENT,
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.5',
      },
    });

    if (response.status < 200 || response.status >= 300) {
      console.warn(`[web-reader] HTTP ${response.status} for ${url}`);
      return null;
    }
    if (response.skipped) {
      console.warn(`[web-reader] Non-HTML content-type for ${url}: ${response.headers['content-type'] || ''}`);
      return null;
    }
    if (response.truncated) {
      console.warn(`[web-reader] Response exceeded ${MAX_RESPONSE_BYTES} bytes for ${url}, truncated`);
    }
    const html = response.body;
    const title = extractTitle(html) || 'Untitled';
    const description = extractMetaDescription(html);
    const body = extractBodyText(html);
    const author = extractAuthor(html);
    const subreddit = extractSubreddit(html);

    return { title, description, body, url, author, subreddit };
  } catch (err) {
    console.warn(`[web-reader] Failed to fetch ${url}: ${err.message}`);
    return null;
  }
}

// ============ Content Formatting ============

/**
 * Format a page result into context string.
 */
function formatPage(page) {
  let result = `[WEB PAGE: "${page.title}" — ${page.url}]`;
  if (page.description) {
    result += `\n[DESCRIPTION]: ${page.description}`;
  }
  result += `\n[CONTENT]: ${page.body}`;
  return result;
}

// ============ Main Export ============

/**
 * Detect URLs in text, fetch their content, and return context string.
 * Also attaches structured metadata (.pages) for attribution pipeline.
 *
 * @param {string} text - Message text potentially containing URLs
 * @returns {Promise<string | null>} Formatted context string (with .pages metadata) or null
 */
export async function processWebLinks(text) {
  try {
    const urls = extractUrls(text);
    if (urls.length === 0) return null;

    const results = await Promise.allSettled(urls.map(fetchPage));
    const pages = results
      .filter(r => r.status === 'fulfilled' && r.value !== null)
      .map(r => r.value);

    if (pages.length === 0) return null;

    const formatted = pages.map(formatPage).join('\n\n');
    // Attach structured page data for attribution pipeline (non-enumerable so it doesn't show in string)
    const result = new String(formatted);
    result.pages = pages;
    return result;
  } catch (err) {
    console.warn(`[web-reader] processWebLinks error: ${err.message}`);
    return null;
  }
}
