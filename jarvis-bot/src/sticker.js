/**
 * @module sticker
 * @description VibeSwap sticker generator — text-to-sticker, image-to-sticker, pack management
 *
 * Telegram sticker requirements:
 * - Static stickers: PNG with alpha, exactly 512px on one side, other side <= 512px
 * - WebP stickers: Same dimensions, max 64KB
 * - Animated/video stickers: WebM, 512x512, 1-3 seconds
 */

import { writeFile, readFile, unlink, mkdir } from 'fs/promises';
import { join } from 'path';
import { config } from './config.js';
import { createCanvas, GlobalFonts, loadImage } from '@napi-rs/canvas';

// ============ Constants ============

const STICKER_SIZE = 512;
const STICKER_DIR = join(config.dataDir, 'stickers');

// VibeSwap brand colors
const BRAND = {
  primary: '#6C5CE7',     // Purple
  secondary: '#00D2D3',   // Teal
  accent: '#FD79A8',      // Pink
  dark: '#2D3436',        // Near-black
  light: '#DFE6E9',       // Light grey
  white: '#FFFFFF',
  gradient: ['#6C5CE7', '#00D2D3'], // Purple → Teal
};

// Pre-built style templates
const STYLES = {
  default: {
    bg: BRAND.primary,
    text: BRAND.white,
    accent: BRAND.secondary,
    fontSize: 48,
    fontWeight: 'bold',
  },
  hype: {
    bg: '#FF6B6B',
    text: BRAND.white,
    accent: '#FFE66D',
    fontSize: 56,
    fontWeight: 'bold',
  },
  chill: {
    bg: BRAND.secondary,
    text: BRAND.dark,
    accent: BRAND.primary,
    fontSize: 44,
    fontWeight: 'normal',
  },
  dark: {
    bg: BRAND.dark,
    text: BRAND.white,
    accent: BRAND.primary,
    fontSize: 48,
    fontWeight: 'bold',
  },
  punk: {
    bg: '#000000',
    text: '#FF0040',
    accent: '#FFD700',
    fontSize: 52,
    fontWeight: 'bold',
  },
};

// Font family — Noto Sans on Docker (installed via Dockerfile), system sans-serif locally
const FONT_FAMILY = 'Noto Sans, Arial, Helvetica, sans-serif';

// ============ Initialization ============

export async function initStickers() {
  await mkdir(STICKER_DIR, { recursive: true });

  // Register system fonts so @napi-rs/canvas can find them
  const fontDirs = [
    '/usr/share/fonts',           // Linux (Docker)
    '/usr/local/share/fonts',     // Linux alt
    'C:\\Windows\\Fonts',         // Windows
  ];

  let registered = 0;
  for (const dir of fontDirs) {
    try {
      registered += GlobalFonts.loadFontsFromDir(dir);
    } catch {
      // Directory doesn't exist on this platform — skip
    }
  }

  const families = GlobalFonts.families;
  console.log(`[sticker] Sticker engine initialized (${registered} fonts from ${families.length} families)`);
  if (families.length === 0) {
    console.warn('[sticker] WARNING: No fonts found! Stickers will render blank text.');
  }
}

// ============ Text-to-Sticker ============

/**
 * Generate a branded sticker image from text
 * @param {string} text - Text to render on the sticker
 * @param {string} [style='default'] - Style template name
 * @returns {Promise<Buffer>} PNG buffer (512x512 with transparency)
 */
export async function textToSticker(text, style = 'default') {
  const s = STYLES[style] || STYLES.default;
  const canvas = createCanvas(STICKER_SIZE, STICKER_SIZE);
  const ctx = canvas.getContext('2d');

  // Transparent background
  ctx.clearRect(0, 0, STICKER_SIZE, STICKER_SIZE);

  // Draw rounded rectangle background with padding
  const padding = 24;
  const radius = 32;
  drawRoundedRect(ctx, padding, padding, STICKER_SIZE - padding * 2, STICKER_SIZE - padding * 2, radius, s.bg);

  // Add subtle border glow
  ctx.strokeStyle = s.accent;
  ctx.lineWidth = 3;
  drawRoundedRectPath(ctx, padding, padding, STICKER_SIZE - padding * 2, STICKER_SIZE - padding * 2, radius);
  ctx.stroke();

  // Draw VibeSwap logo mark (top-left corner)
  drawVibeLogo(ctx, padding + 16, padding + 16, 28, s.accent);

  // Draw text (word-wrapped, centered)
  ctx.fillStyle = s.text;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';

  const maxWidth = STICKER_SIZE - padding * 2 - 40;
  const lines = wrapText(ctx, text, maxWidth, s.fontSize, s.fontWeight);

  const lineHeight = s.fontSize * 1.3;
  const totalHeight = lines.length * lineHeight;
  const startY = STICKER_SIZE / 2 - totalHeight / 2 + lineHeight / 2;

  for (let i = 0; i < lines.length; i++) {
    ctx.font = `${s.fontWeight} ${s.fontSize}px ${FONT_FAMILY}`;
    ctx.fillText(lines[i], STICKER_SIZE / 2, startY + i * lineHeight, maxWidth);
  }

  // Add "VIBESWAP" watermark at bottom
  ctx.font = `bold 14px ${FONT_FAMILY}`;
  ctx.fillStyle = s.accent;
  ctx.globalAlpha = 0.6;
  ctx.fillText('VIBESWAP', STICKER_SIZE / 2, STICKER_SIZE - padding - 12);
  ctx.globalAlpha = 1.0;

  return canvas.toBuffer('image/png');
}

// ============ Image-to-Sticker ============

/**
 * Convert an image to sticker format (512x512 PNG with transparency)
 * @param {Buffer} imageBuffer - Raw image data
 * @returns {Promise<Buffer>} PNG buffer sized for sticker
 */
export async function imageToSticker(imageBuffer) {
  const img = await loadImage(imageBuffer);

  const canvas = createCanvas(STICKER_SIZE, STICKER_SIZE);
  const ctx = canvas.getContext('2d');

  // Clear with transparency
  ctx.clearRect(0, 0, STICKER_SIZE, STICKER_SIZE);

  // Scale image to fit within 512x512 maintaining aspect ratio
  const scale = Math.min(STICKER_SIZE / img.width, STICKER_SIZE / img.height);
  const w = img.width * scale;
  const h = img.height * scale;
  const x = (STICKER_SIZE - w) / 2;
  const y = (STICKER_SIZE - h) / 2;

  // Draw with rounded corners for sticker feel
  const radius = 24;
  ctx.beginPath();
  ctx.roundRect(x, y, w, h, radius);
  ctx.closePath();
  ctx.clip();

  ctx.drawImage(img, x, y, w, h);

  // Add thin brand border
  ctx.strokeStyle = BRAND.primary;
  ctx.lineWidth = 4;
  ctx.beginPath();
  ctx.roundRect(x, y, w, h, radius);
  ctx.closePath();
  ctx.stroke();

  return canvas.toBuffer('image/png');
}

// ============ Image + Text Overlay ============

/**
 * Add text overlay to an image for sticker
 * @param {Buffer} imageBuffer - Raw image data
 * @param {string} text - Text to overlay
 * @param {string} [position='bottom'] - 'top' or 'bottom'
 * @returns {Promise<Buffer>} PNG buffer
 */
export async function imageWithText(imageBuffer, text, position = 'bottom') {
  const img = await loadImage(imageBuffer);

  const canvas = createCanvas(STICKER_SIZE, STICKER_SIZE);
  const ctx = canvas.getContext('2d');

  ctx.clearRect(0, 0, STICKER_SIZE, STICKER_SIZE);

  // Draw image (fill canvas)
  const scale = Math.min(STICKER_SIZE / img.width, STICKER_SIZE / img.height);
  const w = img.width * scale;
  const h = img.height * scale;
  const x = (STICKER_SIZE - w) / 2;
  const y = (STICKER_SIZE - h) / 2;

  ctx.drawImage(img, x, y, w, h);

  // Text banner (semi-transparent background)
  const bannerHeight = 80;
  const bannerY = position === 'top' ? 0 : STICKER_SIZE - bannerHeight;

  ctx.fillStyle = 'rgba(0, 0, 0, 0.7)';
  ctx.fillRect(0, bannerY, STICKER_SIZE, bannerHeight);

  // Accent line
  ctx.fillStyle = BRAND.primary;
  const lineY = position === 'top' ? bannerHeight - 3 : bannerY;
  ctx.fillRect(0, lineY, STICKER_SIZE, 3);

  // Text
  ctx.font = `bold 32px ${FONT_FAMILY}`;
  ctx.fillStyle = BRAND.white;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(text, STICKER_SIZE / 2, bannerY + bannerHeight / 2, STICKER_SIZE - 40);

  return canvas.toBuffer('image/png');
}

// ============ Sticker Pack Management ============

/**
 * Create a new sticker pack or add to existing
 * @param {object} telegram - Telegraf telegram instance
 * @param {number} userId - User who owns the pack
 * @param {string} botUsername - Bot username (for pack name suffix)
 * @param {Buffer} pngBuffer - Sticker PNG data
 * @param {string} emoji - Emoji associated with sticker
 * @returns {Promise<{packName: string, added: boolean}>}
 */
export async function addToStickerPack(telegram, userId, botUsername, pngBuffer, emoji = '\u{1F680}') {
  const packName = `vibeswap_by_${botUsername}`;
  const packTitle = 'VibeSwap Stickers';

  // Save temp file (Telegram API needs file path or InputFile)
  const tmpFile = join(STICKER_DIR, `tmp_${Date.now()}.png`);
  await writeFile(tmpFile, pngBuffer);

  try {
    // Try adding to existing pack first
    try {
      await telegram.addStickerToSet(userId, packName, {
        sticker: { source: tmpFile },
        emoji_list: [emoji],
        format: 'static',
      });
      return { packName, added: true, created: false };
    } catch (addErr) {
      // Pack doesn't exist — create it
      if (addErr.message.includes('STICKERSET_INVALID') || addErr.message.includes('not found')) {
        await telegram.createNewStickerSet(userId, packName, packTitle, {
          stickers: [{
            sticker: { source: tmpFile },
            emoji_list: [emoji],
            format: 'static',
          }],
        });
        return { packName, added: true, created: true };
      }
      throw addErr;
    }
  } finally {
    await unlink(tmpFile).catch(() => {});
  }
}

// ============ Drawing Helpers ============

function drawRoundedRect(ctx, x, y, w, h, r, fillColor) {
  ctx.fillStyle = fillColor;
  ctx.beginPath();
  ctx.roundRect(x, y, w, h, r);
  ctx.closePath();
  ctx.fill();
}

function drawRoundedRectPath(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.roundRect(x, y, w, h, r);
  ctx.closePath();
}

function drawVibeLogo(ctx, x, y, size, color) {
  // Simple "V" mark
  ctx.strokeStyle = color;
  ctx.lineWidth = 3;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.beginPath();
  ctx.moveTo(x, y);
  ctx.lineTo(x + size / 2, y + size);
  ctx.lineTo(x + size, y);
  ctx.stroke();
}

function wrapText(ctx, text, maxWidth, fontSize, fontWeight) {
  ctx.font = `${fontWeight} ${fontSize}px ${FONT_FAMILY}`;
  const words = text.split(' ');
  const lines = [];
  let currentLine = '';

  for (const word of words) {
    const testLine = currentLine ? `${currentLine} ${word}` : word;
    const metrics = ctx.measureText(testLine);

    if (metrics.width > maxWidth && currentLine) {
      lines.push(currentLine);
      currentLine = word;
    } else {
      currentLine = testLine;
    }
  }

  if (currentLine) {
    lines.push(currentLine);
  }

  // If text is too long, reduce font size and re-wrap
  if (lines.length > 5) {
    const smallerSize = Math.max(24, fontSize - 8);
    ctx.font = `${fontWeight} ${smallerSize}px ${FONT_FAMILY}`;
    return wrapText(ctx, text, maxWidth, smallerSize, fontWeight);
  }

  return lines;
}

// ============ Available Styles ============

export function getStyleList() {
  return Object.keys(STYLES).map(name => {
    const s = STYLES[name];
    return `  - **${name}**: ${s.bg} bg, ${s.fontSize}px`;
  }).join('\n');
}

export const AVAILABLE_STYLES = Object.keys(STYLES);
