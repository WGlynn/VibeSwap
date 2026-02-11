import { useState, useMemo } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { useMessaging, useBoard } from '../hooks/useMessaging'
import { useWallet } from '../hooks/useWallet'
import { useDeviceWallet } from '../hooks/useDeviceWallet'
import { useIdentity } from '../hooks/useIdentity'

// ============================================================
// MessageBoard - Core UI
// ============================================================
// Raw messaging. Boards, threads, votes. No frills.
// Layers above (wiki, algorithms, social) render on top of this.
// ============================================================

function MessageBoard() {
  const { isConnected: isExternalConnected } = useWallet()
  const { isConnected: isDeviceConnected } = useDeviceWallet()
  const isConnected = isExternalConnected || isDeviceConnected
  const { identity, hasIdentity } = useIdentity()

  const { boards } = useMessaging()
  const [activeBoardId, setActiveBoardId] = useState('general')
  const [sort, setSort] = useState('newest')
  const [expandedThread, setExpandedThread] = useState(null)
  const [showCompose, setShowCompose] = useState(false)

  return (
    <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 py-6">
      {/* Header */}
      <div className="mb-6">
        <h1 className="text-2xl font-display font-bold text-white">
          Message Board
        </h1>
        <p className="text-sm text-black-400 mt-1">
          Raw messaging and gossip. Everything else builds on top.
        </p>
      </div>

      <div className="flex gap-6">
        {/* Board List - Sidebar */}
        <div className="hidden md:block w-48 flex-shrink-0 space-y-1">
          {boards.map(board => (
            <button
              key={board.id}
              onClick={() => { setActiveBoardId(board.id); setExpandedThread(null) }}
              className={`w-full text-left px-3 py-2 rounded-lg text-sm transition-colors ${
                activeBoardId === board.id
                  ? 'bg-matrix-500/15 text-matrix-400 border border-matrix-500/30'
                  : 'text-black-400 hover:text-white hover:bg-black-800'
              }`}
            >
              <div className="font-medium">{board.name}</div>
              <div className="text-xs text-black-500 mt-0.5">
                {board.stats.messageCount} msgs
              </div>
            </button>
          ))}
        </div>

        {/* Main Content */}
        <div className="flex-1 min-w-0">
          {/* Mobile board selector */}
          <div className="md:hidden flex gap-2 mb-4 overflow-x-auto pb-1">
            {boards.map(board => (
              <button
                key={board.id}
                onClick={() => { setActiveBoardId(board.id); setExpandedThread(null) }}
                className={`flex-shrink-0 px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${
                  activeBoardId === board.id
                    ? 'bg-matrix-500/15 text-matrix-400 border border-matrix-500/30'
                    : 'bg-black-800 text-black-400'
                }`}
              >
                {board.name}
              </button>
            ))}
          </div>

          {/* Toolbar */}
          <div className="flex items-center justify-between mb-4">
            <div className="flex gap-1">
              {[
                { id: 'newest', label: 'New' },
                { id: 'top', label: 'Top' },
                { id: 'controversial', label: 'Active' },
              ].map(s => (
                <button
                  key={s.id}
                  onClick={() => setSort(s.id)}
                  className={`px-3 py-1 rounded text-xs font-medium transition-colors ${
                    sort === s.id
                      ? 'bg-black-700 text-white'
                      : 'text-black-500 hover:text-white'
                  }`}
                >
                  {s.label}
                </button>
              ))}
            </div>
            <button
              onClick={() => setShowCompose(true)}
              className="px-3 py-1.5 rounded-lg bg-matrix-600 hover:bg-matrix-500 text-black-900 text-sm font-semibold transition-colors"
            >
              + Post
            </button>
          </div>

          {/* Thread view or board view */}
          {expandedThread ? (
            <ThreadView
              messageId={expandedThread}
              boardId={activeBoardId}
              onBack={() => setExpandedThread(null)}
              username={hasIdentity ? identity?.username : null}
              isConnected={isConnected}
            />
          ) : (
            <BoardView
              boardId={activeBoardId}
              sort={sort}
              onOpenThread={setExpandedThread}
              username={hasIdentity ? identity?.username : null}
              isConnected={isConnected}
            />
          )}
        </div>
      </div>

      {/* Compose Modal */}
      <AnimatePresence>
        {showCompose && (
          <ComposeModal
            boardId={activeBoardId}
            username={hasIdentity ? identity?.username : null}
            isConnected={isConnected}
            onClose={() => setShowCompose(false)}
          />
        )}
      </AnimatePresence>
    </div>
  )
}

// ============ Board View - List of top-level messages ============

function BoardView({ boardId, sort, onOpenThread, username, isConnected }) {
  const { getMessages, getReplyCount, vote, getVoteScore, getUserVote } = useBoard(boardId)
  const messages = useMemo(() => getMessages(sort), [getMessages, sort])

  if (messages.length === 0) {
    return (
      <div className="text-center py-16 text-black-500">
        <div className="text-3xl mb-2">silence</div>
        <div className="text-sm">No messages yet. Be the first to post.</div>
      </div>
    )
  }

  return (
    <div className="space-y-2">
      {messages.map(msg => (
        <MessageRow
          key={msg.id}
          message={msg}
          replyCount={getReplyCount(msg.id)}
          score={getVoteScore(msg)}
          userVote={username ? getUserVote(msg, username) : null}
          onVote={(dir) => username && vote(msg.id, username, dir)}
          onOpen={() => onOpenThread(msg.id)}
          canVote={isConnected && !!username}
        />
      ))}
    </div>
  )
}

// ============ Message Row - Single message in the board list ============

function MessageRow({ message, replyCount, score, userVote, onVote, onOpen, canVote }) {
  const isPinned = message.metadata?.pinned

  return (
    <motion.div
      initial={{ opacity: 0, y: 4 }}
      animate={{ opacity: 1, y: 0 }}
      className={`flex items-start gap-3 p-3 rounded-lg border transition-colors cursor-pointer hover:border-black-500 ${
        isPinned
          ? 'bg-matrix-500/5 border-matrix-500/20'
          : 'bg-black-800 border-black-700'
      }`}
      onClick={onOpen}
    >
      {/* Vote column */}
      <div className="flex flex-col items-center gap-0.5 pt-0.5" onClick={e => e.stopPropagation()}>
        <button
          onClick={() => canVote && onVote(userVote === 'up' ? null : 'up')}
          className={`p-1 rounded transition-colors ${
            userVote === 'up' ? 'text-matrix-400' : 'text-black-600 hover:text-black-300'
          } ${!canVote ? 'cursor-default' : ''}`}
          disabled={!canVote}
        >
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M5 15l7-7 7 7" />
          </svg>
        </button>
        <span className={`text-xs font-bold tabular-nums ${
          score > 0 ? 'text-matrix-400' : score < 0 ? 'text-red-400' : 'text-black-500'
        }`}>
          {score}
        </span>
        <button
          onClick={() => canVote && onVote(userVote === 'down' ? null : 'down')}
          className={`p-1 rounded transition-colors ${
            userVote === 'down' ? 'text-red-400' : 'text-black-600 hover:text-black-300'
          } ${!canVote ? 'cursor-default' : ''}`}
          disabled={!canVote}
        >
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
          </svg>
        </button>
      </div>

      {/* Content */}
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 mb-1">
          {isPinned && (
            <span className="text-[10px] px-1.5 py-0.5 rounded bg-matrix-500/20 text-matrix-400 font-medium">
              PINNED
            </span>
          )}
          <span className="text-xs text-black-400 font-medium">
            {message.author}
          </span>
          <span className="text-xs text-black-600">
            {formatTime(message.createdAt)}
          </span>
          {message.editedAt && (
            <span className="text-[10px] text-black-600">(edited)</span>
          )}
        </div>
        <p className="text-sm text-black-200 whitespace-pre-wrap break-words line-clamp-3">
          {message.content}
        </p>
        {replyCount > 0 && (
          <div className="mt-1.5 text-xs text-black-500">
            {replyCount} {replyCount === 1 ? 'reply' : 'replies'}
          </div>
        )}
      </div>
    </motion.div>
  )
}

// ============ Thread View - Expanded message with nested replies ============

function ThreadView({ messageId, boardId, onBack, username, isConnected }) {
  const { getMessage, getReplies, vote, getVoteScore, getUserVote } = useBoard(boardId)
  const { reply } = useBoard(boardId)
  const message = useMemo(() => getMessage(messageId), [getMessage, messageId])
  const [replyingTo, setReplyingTo] = useState(null)

  if (!message) {
    return (
      <div className="text-center py-8 text-black-500">Message not found.</div>
    )
  }

  return (
    <div>
      {/* Back button */}
      <button
        onClick={onBack}
        className="flex items-center gap-1 text-sm text-black-400 hover:text-white mb-4 transition-colors"
      >
        <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
        </svg>
        Back
      </button>

      {/* Root message */}
      <div className="p-4 rounded-lg bg-black-800 border border-black-600 mb-4">
        <div className="flex items-start gap-3">
          <VoteButtons
            score={getVoteScore(message)}
            userVote={username ? getUserVote(message, username) : null}
            onVote={(dir) => username && vote(message.id, username, dir)}
            canVote={isConnected && !!username}
          />
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 mb-2">
              <span className="text-sm text-black-300 font-medium">{message.author}</span>
              <span className="text-xs text-black-600">{formatTime(message.createdAt)}</span>
              {message.metadata?.pinned && (
                <span className="text-[10px] px-1.5 py-0.5 rounded bg-matrix-500/20 text-matrix-400 font-medium">PINNED</span>
              )}
            </div>
            <p className="text-sm text-black-200 whitespace-pre-wrap break-words">
              {message.content}
            </p>
            <div className="mt-3">
              <button
                onClick={() => setReplyingTo(replyingTo === message.id ? null : message.id)}
                className="text-xs text-black-500 hover:text-matrix-400 transition-colors"
              >
                Reply
              </button>
            </div>
          </div>
        </div>

        {/* Reply input */}
        <AnimatePresence>
          {replyingTo === message.id && (
            <ReplyInput
              onSubmit={(content) => {
                reply(message.id, username, content)
                setReplyingTo(null)
              }}
              onCancel={() => setReplyingTo(null)}
              username={username}
            />
          )}
        </AnimatePresence>
      </div>

      {/* Nested replies */}
      <ReplyTree
        parentId={messageId}
        boardId={boardId}
        depth={0}
        username={username}
        isConnected={isConnected}
        replyingTo={replyingTo}
        setReplyingTo={setReplyingTo}
      />
    </div>
  )
}

// ============ Recursive Reply Tree ============

function ReplyTree({ parentId, boardId, depth, username, isConnected, replyingTo, setReplyingTo }) {
  const { getReplies, vote, getVoteScore, getUserVote } = useBoard(boardId)
  const { reply } = useBoard(boardId)
  const replies = useMemo(() => getReplies(parentId), [getReplies, parentId])

  if (replies.length === 0) return null

  return (
    <div className={depth > 0 ? 'ml-4 border-l border-black-700 pl-3' : ''}>
      {replies.map(msg => (
        <div key={msg.id} className="mb-2">
          <div className="flex items-start gap-2 p-2.5 rounded-lg bg-black-800/60 border border-black-700/50">
            <VoteButtons
              score={getVoteScore(msg)}
              userVote={username ? getUserVote(msg, username) : null}
              onVote={(dir) => username && vote(msg.id, username, dir)}
              canVote={isConnected && !!username}
              small
            />
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 mb-1">
                <span className="text-xs text-black-400 font-medium">{msg.author}</span>
                <span className="text-[11px] text-black-600">{formatTime(msg.createdAt)}</span>
                {msg.editedAt && <span className="text-[10px] text-black-600">(edited)</span>}
              </div>
              <p className="text-sm text-black-300 whitespace-pre-wrap break-words">
                {msg.content}
              </p>
              {depth < 4 && (
                <button
                  onClick={() => setReplyingTo(replyingTo === msg.id ? null : msg.id)}
                  className="mt-1 text-[11px] text-black-600 hover:text-matrix-400 transition-colors"
                >
                  Reply
                </button>
              )}
            </div>
          </div>

          {/* Reply input */}
          <AnimatePresence>
            {replyingTo === msg.id && (
              <ReplyInput
                onSubmit={(content) => {
                  reply(msg.id, username, content)
                  setReplyingTo(null)
                }}
                onCancel={() => setReplyingTo(null)}
                username={username}
              />
            )}
          </AnimatePresence>

          {/* Recurse */}
          {depth < 4 && (
            <ReplyTree
              parentId={msg.id}
              boardId={boardId}
              depth={depth + 1}
              username={username}
              isConnected={isConnected}
              replyingTo={replyingTo}
              setReplyingTo={setReplyingTo}
            />
          )}
        </div>
      ))}
    </div>
  )
}

// ============ Vote Buttons ============

function VoteButtons({ score, userVote, onVote, canVote, small = false }) {
  const sz = small ? 'w-3 h-3' : 'w-4 h-4'
  return (
    <div className="flex flex-col items-center gap-0" onClick={e => e.stopPropagation()}>
      <button
        onClick={() => canVote && onVote(userVote === 'up' ? null : 'up')}
        className={`p-0.5 rounded transition-colors ${
          userVote === 'up' ? 'text-matrix-400' : 'text-black-600 hover:text-black-300'
        } ${!canVote ? 'cursor-default' : ''}`}
        disabled={!canVote}
      >
        <svg className={sz} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M5 15l7-7 7 7" />
        </svg>
      </button>
      <span className={`text-[10px] font-bold tabular-nums ${
        score > 0 ? 'text-matrix-400' : score < 0 ? 'text-red-400' : 'text-black-600'
      }`}>
        {score}
      </span>
      <button
        onClick={() => canVote && onVote(userVote === 'down' ? null : 'down')}
        className={`p-0.5 rounded transition-colors ${
          userVote === 'down' ? 'text-red-400' : 'text-black-600 hover:text-black-300'
        } ${!canVote ? 'cursor-default' : ''}`}
        disabled={!canVote}
      >
        <svg className={sz} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
        </svg>
      </button>
    </div>
  )
}

// ============ Reply Input ============

function ReplyInput({ onSubmit, onCancel, username }) {
  const [content, setContent] = useState('')

  if (!username) {
    return (
      <motion.div
        initial={{ opacity: 0, height: 0 }}
        animate={{ opacity: 1, height: 'auto' }}
        exit={{ opacity: 0, height: 0 }}
        className="mt-2 ml-8 p-3 rounded-lg bg-black-900 border border-black-700 text-xs text-black-500"
      >
        Create an identity to reply.
      </motion.div>
    )
  }

  return (
    <motion.div
      initial={{ opacity: 0, height: 0 }}
      animate={{ opacity: 1, height: 'auto' }}
      exit={{ opacity: 0, height: 0 }}
      className="mt-2 ml-8"
    >
      <div className="p-2 rounded-lg bg-black-900 border border-black-700">
        <div className="text-[11px] text-black-500 mb-1">
          Replying as <span className="text-matrix-400">{username}</span>
        </div>
        <textarea
          value={content}
          onChange={e => setContent(e.target.value)}
          placeholder="Write a reply..."
          rows={2}
          className="w-full bg-transparent text-sm text-black-200 placeholder-black-600 resize-none focus:outline-none"
          autoFocus
        />
        <div className="flex justify-end gap-2 mt-1">
          <button
            onClick={onCancel}
            className="px-2 py-1 text-xs text-black-500 hover:text-white transition-colors"
          >
            Cancel
          </button>
          <button
            onClick={() => {
              if (content.trim()) {
                onSubmit(content.trim())
                setContent('')
              }
            }}
            disabled={!content.trim()}
            className="px-2 py-1 rounded text-xs bg-matrix-600 hover:bg-matrix-500 text-black-900 font-medium transition-colors disabled:opacity-40"
          >
            Reply
          </button>
        </div>
      </div>
    </motion.div>
  )
}

// ============ Compose Modal ============

function ComposeModal({ boardId, username, isConnected, onClose }) {
  const { post } = useBoard(boardId)
  const [content, setContent] = useState('')
  const [author, setAuthor] = useState(username || '')

  const handleSubmit = () => {
    if (!content.trim() || !author.trim()) return
    post(author.trim(), content.trim())
    onClose()
  }

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
    >
      <div className="absolute inset-0 bg-black/70 backdrop-blur-sm" onClick={onClose} />
      <motion.div
        initial={{ scale: 0.95, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        exit={{ scale: 0.95, opacity: 0 }}
        className="relative w-full max-w-lg bg-black-800 rounded-xl border border-black-600 shadow-2xl"
      >
        <div className="p-4 border-b border-black-700 flex items-center justify-between">
          <h3 className="font-semibold text-white text-sm">New Post</h3>
          <button onClick={onClose} className="p-1 rounded hover:bg-black-700 text-black-400">
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        <div className="p-4 space-y-3">
          {/* Author */}
          {username ? (
            <div className="text-xs text-black-500">
              Posting as <span className="text-matrix-400 font-medium">{username}</span>
            </div>
          ) : (
            <div>
              <label className="text-xs text-black-500 block mb-1">Name</label>
              <input
                type="text"
                value={author}
                onChange={e => setAuthor(e.target.value)}
                placeholder="Anonymous"
                className="w-full px-3 py-2 rounded-lg bg-black-900 border border-black-600 text-sm text-white placeholder-black-500 focus:border-matrix-500 focus:outline-none"
              />
            </div>
          )}

          {/* Content */}
          <div>
            <textarea
              value={content}
              onChange={e => setContent(e.target.value)}
              placeholder="What's on your mind?"
              rows={5}
              className="w-full px-3 py-2 rounded-lg bg-black-900 border border-black-600 text-sm text-white placeholder-black-500 focus:border-matrix-500 focus:outline-none resize-none"
              autoFocus
            />
          </div>
        </div>

        <div className="p-4 border-t border-black-700 flex justify-end gap-3">
          <button
            onClick={onClose}
            className="px-3 py-1.5 text-sm text-black-400 hover:text-white transition-colors"
          >
            Cancel
          </button>
          <button
            onClick={handleSubmit}
            disabled={!content.trim() || !author.trim()}
            className="px-4 py-1.5 rounded-lg bg-matrix-600 hover:bg-matrix-500 text-black-900 text-sm font-semibold transition-colors disabled:opacity-40"
          >
            Post
          </button>
        </div>
      </motion.div>
    </motion.div>
  )
}

// ============ Helpers ============

function formatTime(timestamp) {
  const seconds = Math.floor((Date.now() - timestamp) / 1000)
  if (seconds < 60) return 'just now'
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m`
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h`
  if (seconds < 604800) return `${Math.floor(seconds / 86400)}d`
  return new Date(timestamp).toLocaleDateString()
}

export default MessageBoard
