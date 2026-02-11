import { useMemo, useCallback } from 'react'
import { useMessagingContext } from '../contexts/MessagingContext'

// ============================================================
// useMessaging - Clean hook API for the messaging core
// ============================================================
//
// Usage:
//   const { boards, postMessage, vote } = useMessaging()
//   const { messages, post, reply } = useBoard('general')
//   const { thread, reply, voteOn } = useThread('msg-123')
//
// Three hooks at different granularities:
// - useMessaging()     → global: boards, posting, activity
// - useBoard(boardId)  → board-scoped: messages, stats, sorting
// - useThread(msgId)   → thread-scoped: tree, replies, voting
// ============================================================

/**
 * Global messaging hook - boards, cross-board operations, activity feed
 */
export function useMessaging() {
  const ctx = useMessagingContext()

  const boards = useMemo(() => {
    return ctx.getBoards().map(board => ({
      ...board,
      stats: ctx.getBoardStats(board.id),
    }))
  }, [ctx])

  return {
    boards,
    getBoard: ctx.getBoard,
    createBoard: ctx.createBoard,
    postMessage: ctx.postMessage,
    getMessage: ctx.getMessage,
    getMessagesByAuthor: ctx.getMessagesByAuthor,
    getActivityFeed: ctx.getActivityFeed,
    getDailyActivity: ctx.getDailyActivity,
  }
}

/**
 * Board-scoped hook - messages in a specific board
 */
export function useBoard(boardId) {
  const ctx = useMessagingContext()

  const board = useMemo(() => ctx.getBoard(boardId), [ctx, boardId])
  const stats = useMemo(() => ctx.getBoardStats(boardId), [ctx, boardId])

  const getMessages = useCallback((sort = 'newest') => {
    return ctx.getBoardMessages(boardId, sort)
  }, [ctx, boardId])

  const post = useCallback((author, content, metadata = {}) => {
    return ctx.postMessage(boardId, author, content, null, metadata)
  }, [ctx, boardId])

  const reply = useCallback((parentId, author, content, metadata = {}) => {
    return ctx.postMessage(boardId, author, content, parentId, metadata)
  }, [ctx, boardId])

  return {
    board,
    stats,
    getMessages,
    post,
    reply,
    vote: ctx.vote,
    getVoteScore: ctx.getVoteScore,
    getUserVote: ctx.getUserVote,
    getReplyCount: ctx.getReplyCount,
    getReplies: ctx.getReplies,
  }
}

/**
 * Thread-scoped hook - a specific message and its reply tree
 */
export function useThread(messageId) {
  const ctx = useMessagingContext()

  const thread = useMemo(() => ctx.getThread(messageId), [ctx, messageId])
  const message = useMemo(() => ctx.getMessage(messageId), [ctx, messageId])

  const reply = useCallback((author, content, parentId = null, metadata = {}) => {
    // If no parentId specified, reply to the root message
    const replyTo = parentId || messageId
    return ctx.postMessage(message?.boardId, author, content, replyTo, metadata)
  }, [ctx, messageId, message?.boardId])

  const voteOn = useCallback((targetId, voter, direction) => {
    ctx.vote(targetId, voter, direction)
  }, [ctx])

  return {
    thread,
    message,
    reply,
    voteOn,
    getVoteScore: ctx.getVoteScore,
    getUserVote: ctx.getUserVote,
    getReplies: ctx.getReplies,
    getReplyCount: ctx.getReplyCount,
  }
}
