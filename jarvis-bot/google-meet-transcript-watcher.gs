// ============ Google Apps Script — Meet Transcript → Jarvis Webhook ============
// Deploy this in Google Apps Script (script.google.com) using the project Gmail.
//
// Setup:
// 1. Go to script.google.com → New Project
// 2. Paste this entire file
// 3. Set JARVIS_WEBHOOK_URL and WEBHOOK_SECRET below
// 4. Run → installTrigger() once (grants permissions)
// 5. Done — it checks for new transcript content every 60 seconds

// ============ CONFIG ============
const JARVIS_WEBHOOK_URL = 'https://YOUR_JARVIS_HOST:8080/transcript'; // ← set this
const WEBHOOK_SECRET = 'your-secret-here'; // ← match TRANSCRIPT_WEBHOOK_SECRET in .env
const CHECK_INTERVAL_MINUTES = 1; // How often to check for new transcript content
const TRANSCRIPT_FOLDER_NAME = 'Meet Recordings'; // Google Meet saves transcripts here

// ============ State Tracking ============
// Uses PropertiesService to remember what we've already sent

function getLastProcessed() {
  const props = PropertiesService.getScriptProperties();
  return JSON.parse(props.getProperty('lastProcessed') || '{}');
}

function setLastProcessed(fileId, charIndex) {
  const props = PropertiesService.getScriptProperties();
  const data = JSON.parse(props.getProperty('lastProcessed') || '{}');
  data[fileId] = charIndex;
  props.setProperty('lastProcessed', JSON.stringify(data));
}

// ============ Main: Check for New Transcript Content ============

function checkTranscripts() {
  // Find the Meet Recordings folder
  const folders = DriveApp.getFoldersByName(TRANSCRIPT_FOLDER_NAME);
  if (!folders.hasNext()) {
    // Also check root for transcript docs (Google Meet sometimes puts them at root)
    checkRecentTranscriptDocs_();
    return;
  }

  const folder = folders.next();
  const files = folder.getFilesByType(MimeType.GOOGLE_DOCS);
  const lastProcessed = getLastProcessed();
  const now = new Date();

  while (files.hasNext()) {
    const file = files.next();

    // Only process files modified in the last hour (active meetings)
    const lastUpdated = file.getLastUpdated();
    const ageMs = now.getTime() - lastUpdated.getTime();
    if (ageMs > 3600000) continue; // Skip files older than 1 hour

    processTranscriptFile_(file, lastProcessed);
  }

  // Also check root-level docs
  checkRecentTranscriptDocs_();
}

function checkRecentTranscriptDocs_() {
  // Google Meet transcript docs are named like "Meeting transcript - YYYY-MM-DD"
  const now = new Date();
  const today = Utilities.formatDate(now, Session.getScriptTimeZone(), 'yyyy-MM-dd');
  const yesterday = Utilities.formatDate(new Date(now.getTime() - 86400000), Session.getScriptTimeZone(), 'yyyy-MM-dd');

  const lastProcessed = getLastProcessed();

  // Search for transcript docs from today and yesterday
  const query = `title contains "transcript" and mimeType = "application/vnd.google-apps.document" and (title contains "${today}" or title contains "${yesterday}")`;
  const results = DriveApp.searchFiles(query);

  while (results.hasNext()) {
    const file = results.next();
    const lastUpdated = file.getLastUpdated();
    const ageMs = now.getTime() - lastUpdated.getTime();
    if (ageMs > 3600000) continue;

    processTranscriptFile_(file, lastProcessed);
  }
}

function processTranscriptFile_(file, lastProcessed) {
  const fileId = file.getId();
  const doc = DocumentApp.openById(fileId);
  const body = doc.getBody();
  const fullText = body.getText();
  const lastCharIndex = lastProcessed[fileId] || 0;

  // Only process new content
  if (fullText.length <= lastCharIndex) return;

  const newContent = fullText.substring(lastCharIndex);
  if (newContent.trim().length < 10) return;

  // Parse transcript lines: "Speaker Name\nHH:MM:SS\nWhat they said"
  // Google Meet format varies but generally has speaker + timestamp + text blocks
  const chunks = parseTranscriptChunks_(newContent);

  for (const chunk of chunks) {
    sendToJarvis_(chunk.speaker, chunk.text, file.getName());
  }

  // Update processed position
  setLastProcessed(fileId, fullText.length);
}

// ============ Parse Google Meet Transcript Format ============

function parseTranscriptChunks_(text) {
  const chunks = [];
  // Google Meet transcripts typically look like:
  // Speaker Name
  // 0:15:30
  // What they said blah blah
  //
  // Another Speaker
  // 0:16:45
  // Their response
  const lines = text.split('\n').filter(l => l.trim());
  let i = 0;

  while (i < lines.length) {
    const line = lines[i].trim();

    // Check if this looks like a speaker name (no timestamp format, relatively short)
    if (line.length < 50 && !line.match(/^\d+:\d+/) && i + 1 < lines.length) {
      const nextLine = lines[i + 1]?.trim() || '';

      // Check if next line is a timestamp
      if (nextLine.match(/^\d+:\d+/)) {
        // Collect all text lines after the timestamp until next speaker
        const speaker = line;
        let textLines = [];
        let j = i + 2;

        while (j < lines.length) {
          const candidate = lines[j].trim();
          // If next line looks like a new speaker block, stop
          if (j + 1 < lines.length && lines[j + 1]?.trim().match(/^\d+:\d+/) && candidate.length < 50) {
            break;
          }
          // If it's a timestamp line, skip
          if (candidate.match(/^\d+:\d+:\d+$/) || candidate.match(/^\d+:\d+$/)) {
            j++;
            continue;
          }
          textLines.push(candidate);
          j++;
        }

        if (textLines.length > 0) {
          chunks.push({
            speaker: speaker,
            text: textLines.join(' ')
          });
        }

        i = j;
        continue;
      }
    }

    // Fallback: treat as anonymous speech
    if (line.length >= 10 && !line.match(/^\d+:\d+/)) {
      chunks.push({ speaker: 'Unknown', text: line });
    }
    i++;
  }

  return chunks;
}

// ============ Send to Jarvis Webhook ============

function sendToJarvis_(speaker, text, meetingTitle) {
  if (text.trim().length < 10) return;

  const payload = {
    secret: WEBHOOK_SECRET,
    speaker: speaker,
    transcript: text,
    meeting_title: meetingTitle.replace(' - Transcript', '').trim(),
    timestamp: new Date().toISOString(),
    source: 'google_meet'
  };

  try {
    const response = UrlFetchApp.fetch(JARVIS_WEBHOOK_URL, {
      method: 'post',
      contentType: 'application/json',
      payload: JSON.stringify(payload),
      muteHttpExceptions: true
    });

    const code = response.getResponseCode();
    if (code !== 200) {
      console.log('Jarvis webhook returned ' + code + ': ' + response.getContentText());
    }
  } catch (err) {
    console.log('Failed to send to Jarvis: ' + err.message);
  }
}

// ============ Install Trigger (run once) ============

function installTrigger() {
  // Remove any existing triggers first
  const triggers = ScriptApp.getProjectTriggers();
  for (const trigger of triggers) {
    if (trigger.getHandlerFunction() === 'checkTranscripts') {
      ScriptApp.deleteTrigger(trigger);
    }
  }

  // Install new time-based trigger
  ScriptApp.newTrigger('checkTranscripts')
    .timeBased()
    .everyMinutes(CHECK_INTERVAL_MINUTES)
    .create();

  console.log('Trigger installed: checkTranscripts runs every ' + CHECK_INTERVAL_MINUTES + ' minute(s)');
}

// ============ Manual Test ============

function testWebhook() {
  sendToJarvis_('Will', 'Testing Jarvis meeting integration. Can you hear me?', 'Test Meeting');
  console.log('Test webhook sent. Check Telegram for Jarvis response.');
}
