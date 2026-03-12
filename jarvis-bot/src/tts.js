// ============ Text-to-Speech — JARVIS Voice Engine ============
//
// Priority: ElevenLabs (MCU JARVIS voice) → Google TTS (British fallback)
//
// ElevenLabs voices for JARVIS feel:
//   - "George" (JBFqnCBsd6RMkjVDRZzb) — warm British male, articulate
//   - "Daniel" (onwK4e9ZLuTAKqWW03F9) — deep British male, authoritative
//   - "Charlie" (IKne3meq5aSn9XLyUdCD) — natural British male, conversational
//   - Community "Jarvis" voices available in voice library
//
// Set ELEVENLABS_VOICE_ID to any voice ID from elevenlabs.io/voice-library
// ============

import { config } from './config.js';
import { writeFile, unlink } from 'fs/promises';
import { join } from 'path';

// ============ ElevenLabs TTS ============

async function elevenLabsTTS(text, outputPath) {
  const { apiKey, voiceId, model } = config.elevenlabs || {};
  if (!apiKey) return null;

  const res = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${voiceId}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'xi-api-key': apiKey,
    },
    body: JSON.stringify({
      text: text.slice(0, 5000), // ElevenLabs free tier limit
      model_id: model,
      voice_settings: {
        stability: 0.6,        // Slightly varied for natural feel
        similarity_boost: 0.8, // High fidelity to voice
        style: 0.3,            // Subtle expressiveness
        speed: 1.05,           // Slightly brisk — JARVIS is efficient
      },
    }),
    signal: AbortSignal.timeout(15000), // 15s — TTS generation can be slow but shouldn't hang
  });

  if (!res.ok) {
    const err = await res.text().catch(() => 'unknown');
    console.warn(`[tts] ElevenLabs error ${res.status}: ${err}`);
    return null;
  }

  const audioBuffer = Buffer.from(await res.arrayBuffer());
  await writeFile(outputPath, audioBuffer);
  return outputPath;
}

// ============ Google TTS Fallback ============

async function googleTTSFallback(text, outputPath) {
  try {
    const googleTTS = (await import('google-tts-api')).default;
    const audioSegments = await googleTTS.getAllAudioBase64(text.slice(0, 500), {
      lang: 'en',
      slow: false,
      host: 'https://translate.google.co.uk', // British accent
    });
    const audioBuffers = audioSegments.map(seg => Buffer.from(seg.base64, 'base64'));
    const fullAudio = Buffer.concat(audioBuffers);
    await writeFile(outputPath, fullAudio);
    return outputPath;
  } catch (err) {
    console.warn(`[tts] Google TTS fallback failed: ${err.message}`);
    return null;
  }
}

// ============ Public API ============

/**
 * Generate speech audio from text. Returns path to MP3 file or null.
 * Priority: ElevenLabs → Google TTS → null (text-only fallback)
 */
export async function speak(text, tag = '') {
  if (!text || text.trim().length === 0) return null;

  const filename = `tts_${tag ? tag + '_' : ''}${Date.now()}.mp3`;
  const outputPath = join(config.dataDir || 'data', filename);

  // Try ElevenLabs first (MCU JARVIS voice)
  const result = await elevenLabsTTS(text, outputPath);
  if (result) {
    console.log(`[tts] ElevenLabs voice generated (${text.length} chars)`);
    return result;
  }

  // Fallback to Google TTS (British accent)
  const fallback = await googleTTSFallback(text, outputPath);
  if (fallback) {
    console.log(`[tts] Google TTS fallback used (${text.length} chars)`);
    return fallback;
  }

  return null;
}

/**
 * Clean up a TTS audio file after sending.
 */
export async function cleanup(filePath) {
  if (filePath) {
    await unlink(filePath).catch(() => {});
  }
}
