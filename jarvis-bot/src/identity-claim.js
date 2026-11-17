// ============ /claim, /unclaim and /identity: the Vibeswap chat identity (2026-11-17) ============
//
// Will: "give each user in the vibeswap chat that is active ... a soulbound token that only they can
// claim", on Noesis, holders become members. Slice A3 of Desktop/Research/vibeswap-sbt/DESIGN.md.
//
//   /claim <noesis address>   DM only. Checks the address format, that this account holds no identity,
//                             that no one else holds the address, and the bars (post-counter.js). Writes a
//                             registry row (identity-registry.js); a member also gets a members-list entry,
//                             matched by id only. Queues one identity_mint request for Will's session
//                             (session-requests.js), so the session can mint. Sent again by an identity-tier
//                             holder, it re-checks the member bar and upgrades the tier.
//   /unclaim [confirm]        DM only. The holder withdraws: tier revoked, off the members list.
//   /identity ...             DM, Will only: status, open, close, revoke <serial|telegram id>,
//                             rebind <serial|telegram id> <address> (once per identity).
//
// Telegram sets ctx.from.id in a private chat, so only that account can claim for itself. In a group all
// three are silent, as unauthorized() is, so no username is ever publicly linked to an address. Claims
// are CLOSED by default ("claimsOpen" in data/identity-registry.json): while closed only Will can claim,
// for testing, and everyone else is told they are not open yet. While closed, /claim is in no help text
// and no command menu.
//
// Replies never say "minted": the registry row is the queue, and the session's mint tool reads it
// (scripts/export-mint-batch.js), so "queued for the next mint batch" is true the moment the row is saved.
// The load, the checks and the save run with no await between them, so two claims cannot interleave.

import { config } from './config.js';
import * as R from './identity-registry.js';
import { eligibilityFor, MEMBER_BAR } from './post-counter.js';
import { queueSessionRequest } from './session-requests.js';
import { addClaimedMember, removeClaimedMember, isListedByHand } from './airspace-monitor.js';
import { recordHealthEvent } from './feed.js';

const isPrivate = (ctx) => ctx.chat?.type === 'private';
const isOwnerCtx = (ctx) => String(ctx.from?.id) === String(config.ownerUserId);
const argsOf = (ctx) => String(ctx.message?.text || '').trim().split(/\s+/).slice(1);
const short = (a) => `${a.slice(0, 8)}...${a.slice(-6)}`;

export const TEXT = {
  notOpen: 'Vibeswap identity claims are not open yet.',
  usage: 'Usage: /claim <your Noesis address> (the 64 hex characters your Noesis wallet shows).',
  badAddress: 'That is not a Noesis address. A Noesis address is exactly 64 hex characters (0-9, a-f) with no 0x, as your Noesis wallet shows it.',
  taken: 'That address is already bound to a Vibeswap identity. One identity per address.',
  belowBar: 'I have no counted posts from you in the Vibeswap chat yet, so there is nothing to claim. Post there, then send /claim again.',
  withdrawn: 'The Vibeswap identity of this account was withdrawn. Only Will can change that.',
  unavailable: 'Claims are unavailable right now. Try again later.',
  noIdentity: 'You hold no active Vibeswap identity.',
};

const memberBarText = (e) =>
  `The member tier needs ${MEMBER_BAR.posts} counted posts in the Vibeswap chat on ${MEMBER_BAR.days} different days, ` +
  `the first ${MEMBER_BAR.ageDays} or more days before you claim; you have ${e.counted} on ${e.days} ` +
  `${e.days === 1 ? 'day' : 'days'}${e.moderated ? ', and a moderation action in the chat keeps the tier at identity' : ''}. ` +
  'Send /claim again once you clear it.';

const queuedText = 'The on-chain copy on Noesis is queued for the next mint batch; it is not on chain yet.';
const privacyText = 'Once it is, your address is publicly linked to "a Vibeswap chat identity" (never your Telegram name). /unclaim withdraws it.';

// One identity_mint request for Will's session. The payload is serials only; the session reads the
// rest from the registry and re-checks it. No address, no name.
function queueMint(ctx, serials, why) {
  const q = queueSessionRequest(
    {
      chatId: ctx.chat?.id, chatType: ctx.chat?.type, chatTitle: null, messageId: ctx.message?.message_id,
      userId: ctx.from?.id, userName: null, isOwner: isOwnerCtx(ctx),
    },
    {
      action: 'identity_mint',
      summary: `Vibeswap identity serial ${serials.join(', ')} pending for the next mint batch (${why}). ` +
        'Export with scripts/export-mint-batch.js, mint, then record it with scripts/mark-minted.js.',
    },
    { internal: true },
  );
  if (q.error) recordHealthEvent({ kind: 'identity_mint_not_queued', serials, error: q.error });
  return q;
}

function loadOrFail(ctx) {
  try {
    return R.loadRegistry();
  } catch (err) {
    console.warn(`[identity] registry unreadable: ${err.message}`);
    recordHealthEvent({ kind: 'identity_registry_error', error: String(err.message).slice(0, 200) });
    ctx.reply(TEXT.unavailable);
    return null;
  }
}

function memberListLine(ok) {
  return ok
    ? 'You are on the members list now: a bigger daily allowance with me, and a lighter throttle in the group.'
    : 'Your members-list entry could not be written yet; Will\'s session has a note to fix it.';
}

function addMember(row, now) {
  const ok = addClaimedMember(row.telegramId, row.serial, now);
  if (!ok) recordHealthEvent({ kind: 'identity_members_list_error', serial: row.serial });
  return ok;
}

// ============ /claim ============

export function handleClaim(ctx, { now = Date.now() } = {}) {
  if (!isPrivate(ctx)) return; // groups: silent
  const reg = loadOrFail(ctx);
  if (!reg) return;
  if (!R.claimsOpen(reg) && !isOwnerCtx(ctx)) return ctx.reply(TEXT.notOpen);
  const [arg] = argsOf(ctx);

  const existing = R.currentRow(reg, ctx.from.id);
  if (existing) {
    if (existing.status !== 'active') return ctx.reply(TEXT.withdrawn);
    if (arg && R.parseNoesisAddress(arg) !== existing.address) {
      return ctx.reply(`You already hold Vibeswap identity #${existing.serial}, bound to ${short(existing.address)}. Only Will can re-bind it to a new address.`);
    }
    if (existing.tier === 'member') {
      return ctx.reply(`You already hold Vibeswap identity #${existing.serial}, tier member, bound to ${short(existing.address)}.`);
    }
    // An identity-tier holder asking again: re-check the member bar.
    const e = eligibilityFor(ctx.from.id, now);
    if (e.tier !== 'member') {
      return ctx.reply(`You hold Vibeswap identity #${existing.serial}, tier identity. ${memberBarText(e)}`);
    }
    R.upgradeToMember(reg, existing.serial, now);
    R.saveRegistry(reg);
    const listed = addMember(existing, now);
    queueMint(ctx, [existing.serial], 're-tier to member');
    return ctx.reply([`Upgraded: Vibeswap identity #${existing.serial} is now tier member.`, memberListLine(listed), queuedText].join('\n'));
  }

  if (!arg) return ctx.reply(TEXT.usage);
  const address = R.parseNoesisAddress(arg);
  if (!address) return ctx.reply(TEXT.badAddress);
  if (R.addressHolder(reg, address)) return ctx.reply(TEXT.taken);
  const e = eligibilityFor(ctx.from.id, now);
  if (!e.tier) return ctx.reply(TEXT.belowBar);

  const { row, error } = R.addClaim(reg, { telegramId: ctx.from.id, address, tier: e.tier, now });
  if (error) return ctx.reply(TEXT.unavailable); // the checks above make this unreachable
  R.saveRegistry(reg);
  const lines = [`Recorded: Vibeswap identity #${row.serial}, tier ${row.tier}, bound to ${short(row.address)}.`];
  if (row.tier === 'member') lines.push(memberListLine(addMember(row, now)));
  else lines.push(memberBarText(e));
  queueMint(ctx, [row.serial], `new claim, tier ${row.tier}`);
  lines.push(queuedText, privacyText);
  return ctx.reply(lines.join('\n'));
}

// ============ /unclaim ============

export function handleUnclaim(ctx, { now = Date.now() } = {}) {
  if (!isPrivate(ctx)) return;
  const reg = loadOrFail(ctx);
  if (!reg) return;
  if (!R.claimsOpen(reg) && !isOwnerCtx(ctx)) return ctx.reply(TEXT.notOpen);
  const row = R.currentRow(reg, ctx.from.id);
  if (!row || row.status !== 'active') return ctx.reply(TEXT.noIdentity);
  if (argsOf(ctx)[0] !== 'confirm') {
    return ctx.reply(`This withdraws Vibeswap identity #${row.serial} for good: it leaves the members list, its on-chain copy is re-tiered to revoked, and this account cannot claim again. Send /unclaim confirm to go ahead.`);
  }
  R.withdraw(reg, row.serial, 'unclaimed', now);
  R.saveRegistry(reg);
  removeClaimedMember(row.telegramId);
  const onChain = R.isPending(row);
  if (onChain) queueMint(ctx, [row.serial], 'withdrawn by the holder, re-tier to revoked');
  return ctx.reply(`Withdrawn: Vibeswap identity #${row.serial} is revoked${onChain ? '; the re-tier of its on-chain copy is queued for the next mint batch' : ''}.`);
}

// ============ /identity (Will only) ============

const ADMIN_USAGE = 'Usage: /identity [status | open | close | revoke <serial|telegram id> | rebind <serial|telegram id> <address>]';

function findRow(reg, key) {
  if (!/^\d+$/.test(String(key || ''))) return null;
  return R.rowBySerial(reg, key) || R.currentRow(reg, key);
}

export function handleIdentityAdmin(ctx, { now = Date.now() } = {}) {
  if (!isPrivate(ctx) || !isOwnerCtx(ctx)) return; // silent for everyone else
  const reg = loadOrFail(ctx);
  if (!reg) return;
  const [sub = 'status', key, address] = argsOf(ctx);

  if (sub === 'status') {
    const s = R.summary(reg);
    return ctx.reply(`Claims ${s.claimsOpen ? 'OPEN' : 'closed'}. Active identities ${s.active} (member ${s.member}, identity ${s.identity}); withdrawn ${s.withdrawn}; pending for the next mint batch ${s.pending}; next serial ${s.nextSerial}.`);
  }
  if (sub === 'open' || sub === 'close') {
    reg.claimsOpen = sub === 'open';
    R.saveRegistry(reg);
    return ctx.reply(reg.claimsOpen ? 'Claims are OPEN: anyone who clears the bars can /claim in a DM.' : 'Claims are closed: only you can claim.');
  }
  if (sub === 'revoke') {
    const row = findRow(reg, key);
    if (!row || row.status !== 'active') return ctx.reply('No active identity with that serial or Telegram id.');
    R.withdraw(reg, row.serial, 'revoked', now);
    R.saveRegistry(reg);
    const unlisted = removeClaimedMember(row.telegramId);
    const onChain = R.isPending(row);
    if (onChain) queueMint(ctx, [row.serial], 'revoked by Will, re-tier to revoked');
    const notes = [];
    if (!unlisted) notes.push('the members file could not be updated');
    if (isListedByHand(row.telegramId)) notes.push('their hand-added members-list entry stays; edit throttle-members.json to remove it');
    return ctx.reply(`Revoked identity #${row.serial}${onChain ? '; the on-chain re-tier is queued for the next mint batch' : ' (never minted, nothing on chain)'}.${notes.length ? ' Note: ' + notes.join('; ') + '.' : ''}`);
  }
  if (sub === 'rebind') {
    const row = findRow(reg, key);
    if (!row) return ctx.reply('No identity with that serial or Telegram id.');
    const r = R.rebind(reg, row.serial, address, now);
    if (r.error) {
      const why = { not_active: 'it is not active', rebind_used: 'its one re-bind is used', bad_address: 'that is not a Noesis address (64 hex, no 0x)', address_taken: 'that address is already bound' }[r.error];
      return ctx.reply(`Not re-bound: ${why}.`);
    }
    R.saveRegistry(reg);
    if (r.row.tier === 'member') addMember(r.row, now);
    const serials = R.isPending(r.old) ? [r.old.serial, r.row.serial] : [r.row.serial];
    queueMint(ctx, serials, `re-bound by Will: #${r.old.serial} to revoked, #${r.row.serial} new`);
    return ctx.reply(`Re-bound: identity #${r.old.serial} is revoked and #${r.row.serial} (tier ${r.row.tier}) holds ${short(r.row.address)}. Queued for the next mint batch.`);
  }
  return ctx.reply(ADMIN_USAGE);
}
