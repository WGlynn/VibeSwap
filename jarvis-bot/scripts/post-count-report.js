#!/usr/bin/env node
// Post-count report for the Vibeswap identity bars (src/post-counter.js). Prints COUNTS ONLY: no names,
// no usernames, no Telegram ids, no text. Reads DATA_DIR (default jarvis-bot/data).
//   node scripts/post-count-report.js

import { chatPostStats, tierFor, MEMBER_BAR } from '../src/post-counter.js';
import { config } from '../src/config.js';

const now = Date.now();
const { records, stats, moderated } = chatPostStats(config.dataDir, config.identityChatId);
let counted = 0, member = 0, identity = 0, sixPlus = 0, threeDays = 0;
for (const [id, s] of stats) {
  counted += s.counted;
  if (s.counted >= MEMBER_BAR.posts) sixPlus++;
  if (s.days >= MEMBER_BAR.days) threeDays++;
  const tier = tierFor(s, now, { moderated: moderated.has(id) });
  if (tier === 'member') member++;
  else if (tier === 'identity') identity++;
}
console.log([
  `messages in the logs for the chat: ${records}`,
  `counted posts: ${counted}`,
  `people with a counted post: ${stats.size}`,
  `people with ${MEMBER_BAR.posts}+ counted posts: ${sixPlus}`,
  `people with counted posts on ${MEMBER_BAR.days}+ days: ${threeDays}`,
  `people with a moderation action: ${moderated.size}`,
  `clear the member bar today: ${member}`,
  `clear the identity bar only: ${identity}`,
].join('\n'));
