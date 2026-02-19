// ============ Google Apps Script — Meet Transcript → Jarvis ============
// Deploy this in Google Apps Script (script.google.com) using the project Gmail.
//
// Setup:
// 1. Go to script.google.com → New Project
// 2. Paste this entire file
// 3. Set JARVIS_WEBHOOK_URL and WEBHOOK_SECRET below
// 4. Run → installTrigger() once (grants permissions)
// 5. Done — it checks for new transcript content every 60 seconds

// ============ CONFIG ============
const JARVIS_WEBHOOK_URL = 'https://jarvis-vibeswap.fly.dev/transcript';
const WEBHOOK_SECRET = 'vibeswap-transcript-2026';
const CHECK_INTERVAL_MINUTES = 1;
const TRANSCRIPT_FOLDER_NAME = 'Meet Recordings';

// ============ State Tracking ============

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
  const folders = DriveApp.getFoldersByName(TRANSCRIPT_FOLDER_NAME);
  if (!folders.hasNext()) {
    checkRecentTranscriptDocs_();
    return;
  }

  const folder = folders.next();
  const files = folder.getFilesByType(MimeType.GOOGLE_DOCS);
  const lastProcessed = getLastProcessed();
  const now = new Date();

  while (files.hasNext()) {
    const file = files.next();
    const lastUpdated = file.getLastUpdated();
    const ageMs = now.getTime() - lastUpdated.getTime();
    if (ageMs > 3600000) continue;
    processTranscriptFile_(file, lastProcessed);
  }

  checkRecentTranscriptDocs_();
}

function checkRecentTranscriptDocs_() {
  const now = new Date();
  const today = Utilities.formatDate(now, Session.getScriptTimeZone(), 'yyyy-MM-dd');
  const yesterday = Utilities.formatDate(new Date(now.getTime() - 86400000), Session.getScriptTimeZone(), 'yyyy-MM-dd');
  const lastProcessed = getLastProcessed();

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

  if (fullText.length <= lastCharIndex) return;

  const newContent = fullText.substring(lastCharIndex);
  if (newContent.trim().length < 10) return;

  const chunks = parseTranscriptChunks_(newContent);
  const meetingTitle = file.getName().replace(' - Transcript', '').trim();

  for (const chunk of chunks) {
    sendToJarvis_(chunk.speaker, chunk.text, meetingTitle);
  }

  setLastProcessed(fileId, fullText.length);
}

// ============ Parse Google Meet Transcript Format ============

function parseTranscriptChunks_(text) {
  const chunks = [];
  const lines = text.split('\n').filter(l => l.trim());
  let i = 0;

  while (i < lines.length) {
    const line = lines[i].trim();

    if (line.length < 50 && !line.match(/^\d+:\d+/) && i + 1 < lines.length) {
      const nextLine = lines[i + 1]?.trim() || '';

      if (nextLine.match(/^\d+:\d+/)) {
        const speaker = line;
        let textLines = [];
        let j = i + 2;

        while (j < lines.length) {
          const candidate = lines[j].trim();
          if (j + 1 < lines.length && lines[j + 1]?.trim().match(/^\d+:\d+/) && candidate.length < 50) {
            break;
          }
          if (candidate.match(/^\d+:\d+:\d+$/) || candidate.match(/^\d+:\d+$/)) {
            j++;
            continue;
          }
          textLines.push(candidate);
          j++;
        }

        if (textLines.length > 0) {
          chunks.push({ speaker: speaker, text: textLines.join(' ') });
        }
        i = j;
        continue;
      }
    }

    if (line.length >= 10 && !line.match(/^\d+:\d+/)) {
      chunks.push({ speaker: 'Unknown', text: line });
    }
    i++;
  }

  return chunks;
}

// ============ Send to Jarvis ============

function sendToJarvis_(speaker, text, meetingTitle) {
  if (text.trim().length < 10) return;

  const payload = {
    secret: WEBHOOK_SECRET,
    speaker: speaker,
    transcript: text,
    meeting_title: meetingTitle,
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
    if (code === 200) {
      console.log('Sent to Jarvis: ' + speaker + ' (' + text.length + ' chars)');
    } else {
      console.log('Jarvis returned ' + code + ': ' + response.getContentText());
    }
  } catch (err) {
    console.log('Webhook failed: ' + err.message);
  }
}

// ============ Install Trigger (run once) ============

function installTrigger() {
  const triggers = ScriptApp.getProjectTriggers();
  for (const trigger of triggers) {
    if (trigger.getHandlerFunction() === 'checkTranscripts') {
      ScriptApp.deleteTrigger(trigger);
    }
  }

  ScriptApp.newTrigger('checkTranscripts')
    .timeBased()
    .everyMinutes(CHECK_INTERVAL_MINUTES)
    .create();

  console.log('Trigger installed: checkTranscripts runs every ' + CHECK_INTERVAL_MINUTES + ' minute(s)');
}

// ============ Manual Test ============

function testWebhook() {
  sendToJarvis_('Will', 'We should add a circuit breaker threshold for CKB pool cells that triggers when reserve ratio deviates more than 15 percent from the TWAP oracle price. This prevents manipulation of the PoW difficulty target through artificial volume.', 'CKB Architecture Call');
  console.log('Test sent. Check Telegram for Jarvis voice response.');
}
