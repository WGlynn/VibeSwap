// ============================================
// DAFT PUNK SOUNDBOARD — ACTION-TO-AUDIO MAP
// ============================================
// Maps user actions to Daft Punk "Harder, Better, Faster, Stronger" snippets.
// Audio files are expected in /public/audio/ — add the MP3 clips later.

// ============================================
// AUDIO CLIP PATHS
// ============================================
export const SOUNDBOARD_CLIPS = {
  swap:         '/audio/work-it-harder.mp3',
  pool:         '/audio/make-it-better.mp3',
  connect:      '/audio/do-it-faster.mp3',
  contribution: '/audio/makes-us-stronger.mp3',
  referral:     '/audio/more-than-ever.mp3',
  rankUp:       '/audio/hour-after-hour.mp3',
  bounty:       '/audio/work-is-never-over.mp3',
}

// ============================================
// DISPLAY LABELS (for UI if needed)
// ============================================
export const SOUNDBOARD_LABELS = {
  swap:         'Work it harder',
  pool:         'Make it better',
  connect:      'Do it faster',
  contribution: 'Makes us stronger',
  referral:     'More than ever',
  rankUp:       'Hour after hour',
  bounty:       'Work is never over',
}

// ============================================
// VALID ACTIONS (for validation)
// ============================================
export const SOUNDBOARD_ACTIONS = Object.keys(SOUNDBOARD_CLIPS)

// ============================================
// DEFAULTS
// ============================================
export const SOUNDBOARD_DEFAULTS = {
  volume: 0.3,
  muted: false,
  storageKeyMuted: 'vibeswap-soundboard-muted',
  storageKeyVolume: 'vibeswap-soundboard-volume',
}
