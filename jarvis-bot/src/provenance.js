// ============ Fact provenance: where a fact was learned decides where it may be offered ============
//
// Proposal 0003 (agreed by Will 2026-11-01): "Every stored fact carries where it was learned (a DM or a
// group, which chat, when) and whether it is public. A fact learned in a DM is simply not offered in a
// group prompt." Constitution 2.1 and 2.2: the chat voice says only what is safe to say in public.
//
// The rule: a fact may be offered in a one-to-one chat with the person (their DM, or their own web
// chat, where nobody else hears it), in the group it was learned in, or anywhere if it was learned in a
// group anyone can read. A fact stored before provenance existed has no record of where it came from,
// so it is treated as private.
//
// Honest floor: provenance says where a fact was learned, not whether its content is sensitive. An
// address someone states in a group is offered in that group.

import { scopeOf } from './protocol.js';

export { scopeOf };

export function learnedIn({ chatType, chatId = null, chatPublic = false, at = new Date().toISOString() } = {}) {
  const scope = scopeOf(chatType);
  // Only a group can be public: Telegram gives a DM chat the person's own username.
  return { scope, chatId: chatId == null ? null : String(chatId), public: scope === 'group' && chatPublic === true, at };
}

// turn: { scope, chatId }, as in protocol.js turnRecord. No turn means only what may be said anywhere.
export function offerable(learned, turn) {
  if (learned?.public === true) return true;
  if (!turn) return false;
  if (turn.scope === 'dm' || turn.scope === 'web') return true;
  return learned?.scope === 'group' && learned.chatId === String(turn.chatId);
}

export const offerableFacts = (facts, turn) => (facts || []).filter((f) => offerable(f?.learned, turn));

// A merged fact is offered only where every part may be. Public parts restrict nothing; the rest must
// all come from one chat for the merge to stay offerable there, otherwise only one-to-one chats get it.
export function mergedProvenance(parts) {
  if (parts.length === 0 || parts.some((p) => !p)) return null;
  const at = parts.map((p) => p.at).sort()[0];
  const restricted = parts.filter((p) => !p.public);
  if (restricted.length === 0) return { ...parts[0], at };
  const [first] = restricted;
  const oneChat = restricted.every((p) => p.scope === first.scope && p.chatId === first.chatId);
  return oneChat ? { ...first, at } : { scope: 'mixed', chatId: null, public: false, at };
}
