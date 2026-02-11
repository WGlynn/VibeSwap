import { useState, useMemo, useRef, useEffect } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { useMessaging, useBoard } from '../hooks/useMessaging'
import { useWallet } from '../hooks/useWallet'
import { useDeviceWallet } from '../hooks/useDeviceWallet'
import { useIdentity } from '../hooks/useIdentity'

// ============================================================
// MessageBoard - Telegram-Style Chat Interface
// ============================================================
// Channels on the left, chat on the right.
// Bottom input bar, chronological messages, reply support.
// Mobile: channel list → tap → full chat → back.
// ============================================================

function MessageBoard() {
  const { isConnected: isExternalConnected } = useWallet()
  const { isConnected: isDeviceConnected } = useDeviceWallet()
  const isConnected = isExternalConnected || isDeviceConnected
  const { identity, hasIdentity } = useIdentity()
  const username = hasIdentity ? identity?.username : null

  const { boards } = useMessaging()
  const [activeBoardId, setActiveBoardId] = useState('general')
  // On mobile, null = show channel list, string = show chat
  const [mobileView, setMobileView] = useState(null)

  const handleSelectChannel = (boardId) => {
    setActiveBoardId(boardId)
    setMobileView(boardId)
  }

  const handleBack = () => {
    setMobileView(null)
  }

  return (
    <div className="flex h-[calc(100vh-3.5rem)] overflow-hidden">
      {/* Channel Sidebar - desktop always, mobile when no chat open */}
      <div className={`${mobileView ? 'hidden md:flex' : 'flex'} flex-col w-full md:w-72 lg:w-80 flex-shrink-0 border-r border-black-700 bg-black-900`}>
        <ChannelList
          boards={boards}
          activeBoardId={activeBoardId}
          onSelect={handleSelectChannel}
        />
      </div>

      {/* Chat Panel - desktop always, mobile when chat open */}
      <div className={`${mobileView ? 'flex' : 'hidden md:flex'} flex-col flex-1 min-w-0 bg-black-850`}>
        <ChatPanel
          boardId={activeBoardId}
          username={username}
          isConnected={isConnected}
          onBack={handleBack}
          showBack={!!mobileView}
        />
      </div>
    </div>
  )
}

// ============ Channel List (Left Sidebar) ============

function ChannelList({ boards, activeBoardId, onSelect }) {
  const channelIcons = {
    general: '#',
    trading: '$',
    development: '</>',
    governance: '!',
  }

  return (
    <>
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-black-700">
        <h2 className="font-semibold text-white text-base">Messages</h2>
      </div>

      {/* Channel list */}
      <div className="flex-1 overflow-y-auto py-2">
        {boards.map(board => {
          const isActive = board.id === activeBoardId
          return (
            <button
              key={board.id}
              onClick={() => onSelect(board.id)}
              className={`w-full flex items-center gap-3 px-4 py-3 transition-colors text-left ${
                isActive
                  ? 'bg-matrix-500/10 border-r-2 border-matrix-500'
                  : 'hover:bg-black-800'
              }`}
            >
              {/* Channel icon */}
              <div className={`w-10 h-10 rounded-full flex items-center justify-center flex-shrink-0 text-sm font-bold ${
                isActive
                  ? 'bg-matrix-600 text-black-900'
                  : 'bg-black-700 text-black-300'
              }`}>
                {channelIcons[board.id] || '#'}
              </div>

              {/* Channel info */}
              <div className="flex-1 min-w-0">
                <div className="flex items-center justify-between">
                  <span className={`font-medium text-sm ${isActive ? 'text-matrix-400' : 'text-white'}`}>
                    {board.name}
                  </span>
                  {board.stats.latestActivity > 0 && (
                    <span className="text-[10px] text-black-500 flex-shrink-0">
                      {formatTimeShort(board.stats.latestActivity)}
                    </span>
                  )}
                </div>
                <div className="text-xs text-black-500 truncate mt-0.5">
                  {board.description}
                </div>
                <div className="text-[10px] text-black-600 mt-0.5">
                  {board.stats.messageCount} messages · {board.stats.authorCount} people
                </div>
              </div>
            </button>
          )
        })}
      </div>
    </>
  )
}

// ============ Chat Panel (Right Side) ============

function ChatPanel({ boardId, username, isConnected, onBack, showBack }) {
  const { board, getMessages, post, reply, vote, getVoteScore, getUserVote, getReplies, getReplyCount } = useBoard(boardId)
  const messages = useMemo(() => getMessages('oldest'), [getMessages])
  const scrollRef = useRef(null)
  const [replyTo, setReplyTo] = useState(null)

  // Auto-scroll to bottom on new messages
  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight
    }
  }, [messages.length])

  const handleSend = (content) => {
    if (!username) return
    if (replyTo) {
      reply(replyTo.id, username, content)
      setReplyTo(null)
    } else {
      post(username, content)
    }
  }

  return (
    <>
      {/* Chat Header */}
      <div className="flex items-center gap-3 px-4 py-3 border-b border-black-700 bg-black-900/80 backdrop-blur-sm flex-shrink-0">
        {showBack && (
          <button
            onClick={onBack}
            className="p-1 -ml-1 rounded-lg hover:bg-black-700 text-black-400 hover:text-white transition-colors"
          >
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" />
            </svg>
          </button>
        )}
        <div className="flex-1 min-w-0">
          <div className="font-semibold text-white text-sm">{board?.name || 'Chat'}</div>
          <div className="text-[11px] text-black-500">{board?.description}</div>
        </div>
      </div>

      {/* Messages */}
      <div ref={scrollRef} className="flex-1 overflow-y-auto px-4 py-3 space-y-1 allow-scroll">
        {messages.length === 0 ? (
          <div className="flex items-center justify-center h-full">
            <div className="text-center text-black-500">
              <div className="text-2xl mb-2">Start the conversation</div>
              <div className="text-sm">Be the first to post in {board?.name}.</div>
            </div>
          </div>
        ) : (
          <MessageList
            messages={messages}
            username={username}
            isConnected={isConnected}
            onReply={setReplyTo}
            vote={vote}
            getVoteScore={getVoteScore}
            getUserVote={getUserVote}
            getReplies={getReplies}
            getReplyCount={getReplyCount}
            allMessages={messages}
          />
        )}
      </div>

      {/* Input Bar */}
      <ChatInput
        onSend={handleSend}
        username={username}
        isConnected={isConnected}
        replyTo={replyTo}
        onCancelReply={() => setReplyTo(null)}
      />
    </>
  )
}

// ============ Message List ============

function MessageList({ messages, username, isConnected, onReply, vote, getVoteScore, getUserVote, getReplies, getReplyCount, allMessages }) {
  let lastAuthor = null
  let lastTime = 0

  // Build a map of all messages for reply lookups
  const messageMap = useMemo(() => {
    const map = {}
    allMessages.forEach(m => { map[m.id] = m })
    return map
  }, [allMessages])

  return messages.map((msg, i) => {
    const isOwn = msg.author === username
    const isSameAuthor = msg.author === lastAuthor
    const isCloseToPrev = (msg.createdAt - lastTime) < 120000 // 2 min
    const grouped = isSameAuthor && isCloseToPrev

    // Check if there's a day boundary
    const prevMsg = messages[i - 1]
    const showDateSep = !prevMsg || !isSameDay(prevMsg.createdAt, msg.createdAt)

    lastAuthor = msg.author
    lastTime = msg.createdAt

    // Find the parent message if this is a reply shown at top level
    const parentMsg = msg.parentId ? messageMap[msg.parentId] : null

    return (
      <div key={msg.id}>
        {showDateSep && <DateSeparator timestamp={msg.createdAt} />}
        <ChatBubble
          message={msg}
          parentMessage={parentMsg}
          isOwn={isOwn}
          grouped={grouped}
          username={username}
          isConnected={isConnected}
          onReply={() => onReply(msg)}
          score={getVoteScore(msg)}
          userVote={username ? getUserVote(msg, username) : null}
          onVote={(dir) => username && vote(msg.id, username, dir)}
          canVote={isConnected && !!username}
          replyCount={getReplyCount(msg.id)}
        />
      </div>
    )
  })
}

// ============ Chat Bubble ============

function ChatBubble({ message, parentMessage, isOwn, grouped, username, isConnected, onReply, score, userVote, onVote, canVote, replyCount }) {
  const [showActions, setShowActions] = useState(false)
  const isPinned = message.metadata?.pinned

  return (
    <div
      className={`flex ${isOwn ? 'justify-end' : 'justify-start'} ${grouped ? 'mt-0.5' : 'mt-3'}`}
      onMouseEnter={() => setShowActions(true)}
      onMouseLeave={() => setShowActions(false)}
    >
      <div className={`relative max-w-[85%] sm:max-w-[70%] group`}>
        {/* Bubble */}
        <div className={`rounded-2xl px-3 py-2 ${
          isOwn
            ? 'bg-matrix-600/20 border border-matrix-500/20 rounded-br-md'
            : 'bg-black-800 border border-black-700 rounded-bl-md'
        } ${isPinned ? 'ring-1 ring-matrix-500/30' : ''}`}>

          {/* Pinned indicator */}
          {isPinned && (
            <div className="flex items-center gap-1 mb-1">
              <svg className="w-3 h-3 text-matrix-500" fill="currentColor" viewBox="0 0 20 20">
                <path d="M5 5a2 2 0 012-2h6a2 2 0 012 2v2a2 2 0 01-2 2H7a2 2 0 01-2-2V5z" />
                <path d="M8 9v4a1 1 0 001 1h2a1 1 0 001-1V9H8z" />
                <path d="M9 14v3h2v-3H9z" />
              </svg>
              <span className="text-[10px] text-matrix-500 font-medium">Pinned</span>
            </div>
          )}

          {/* Reply preview */}
          {parentMessage && (
            <div className={`mb-1.5 pl-2 border-l-2 ${isOwn ? 'border-matrix-400/40' : 'border-black-500/40'}`}>
              <div className="text-[10px] text-matrix-400 font-medium">{parentMessage.author}</div>
              <div className="text-[11px] text-black-400 truncate max-w-[200px]">{parentMessage.content}</div>
            </div>
          )}

          {/* Author (if not grouped) */}
          {!grouped && !isOwn && (
            <div className="text-xs font-semibold text-matrix-400 mb-0.5">
              {message.author}
            </div>
          )}

          {/* Content */}
          <p className="text-sm text-black-200 whitespace-pre-wrap break-words leading-relaxed">
            {message.content}
          </p>

          {/* Footer: time + score */}
          <div className={`flex items-center gap-2 mt-1 ${isOwn ? 'justify-end' : 'justify-start'}`}>
            <span className="text-[10px] text-black-600">
              {formatTime(message.createdAt)}
            </span>
            {message.editedAt && (
              <span className="text-[10px] text-black-600">edited</span>
            )}
            {score !== 0 && (
              <span className={`text-[10px] font-bold ${score > 0 ? 'text-matrix-500' : 'text-red-400'}`}>
                {score > 0 ? '+' : ''}{score}
              </span>
            )}
            {replyCount > 0 && (
              <span className="text-[10px] text-black-500">
                {replyCount} {replyCount === 1 ? 'reply' : 'replies'}
              </span>
            )}
          </div>
        </div>

        {/* Action buttons - shown on hover */}
        <AnimatePresence>
          {showActions && (
            <motion.div
              initial={{ opacity: 0, scale: 0.9 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.9 }}
              transition={{ duration: 0.1 }}
              className={`absolute top-0 ${isOwn ? '-left-2 -translate-x-full' : '-right-2 translate-x-full'} flex items-center gap-0.5 bg-black-800 border border-black-600 rounded-lg px-1 py-0.5 shadow-xl z-10`}
            >
              {/* Reply */}
              <button
                onClick={onReply}
                className="p-1.5 rounded-md hover:bg-black-700 text-black-400 hover:text-white transition-colors"
                title="Reply"
              >
                <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M3 10h10a8 8 0 018 8v2M3 10l6 6m-6-6l6-6" />
                </svg>
              </button>

              {/* Upvote */}
              {canVote && (
                <>
                  <button
                    onClick={() => onVote(userVote === 'up' ? null : 'up')}
                    className={`p-1.5 rounded-md transition-colors ${
                      userVote === 'up' ? 'text-matrix-400 bg-matrix-500/10' : 'text-black-400 hover:text-matrix-400 hover:bg-black-700'
                    }`}
                    title="Upvote"
                  >
                    <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M5 15l7-7 7 7" />
                    </svg>
                  </button>
                  <button
                    onClick={() => onVote(userVote === 'down' ? null : 'down')}
                    className={`p-1.5 rounded-md transition-colors ${
                      userVote === 'down' ? 'text-red-400 bg-red-500/10' : 'text-black-400 hover:text-red-400 hover:bg-black-700'
                    }`}
                    title="Downvote"
                  >
                    <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
                    </svg>
                  </button>
                </>
              )}
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </div>
  )
}

// ============ Chat Input Bar ============

function ChatInput({ onSend, username, isConnected, replyTo, onCancelReply }) {
  const [content, setContent] = useState('')
  const inputRef = useRef(null)

  // Focus input when replyTo changes
  useEffect(() => {
    if (replyTo && inputRef.current) {
      inputRef.current.focus()
    }
  }, [replyTo])

  const handleSubmit = () => {
    if (!content.trim() || !username) return
    onSend(content.trim())
    setContent('')
  }

  const handleKeyDown = (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      handleSubmit()
    }
  }

  if (!isConnected) {
    return (
      <div className="px-4 py-3 border-t border-black-700 bg-black-900/80 flex-shrink-0">
        <div className="text-center text-sm text-black-500 py-2">
          Connect your wallet to send messages
        </div>
      </div>
    )
  }

  if (!username) {
    return (
      <div className="px-4 py-3 border-t border-black-700 bg-black-900/80 flex-shrink-0">
        <div className="text-center text-sm text-black-500 py-2">
          Create an identity to start chatting
        </div>
      </div>
    )
  }

  return (
    <div className="border-t border-black-700 bg-black-900/80 backdrop-blur-sm flex-shrink-0">
      {/* Reply preview */}
      <AnimatePresence>
        {replyTo && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            className="overflow-hidden"
          >
            <div className="flex items-center gap-2 px-4 pt-2">
              <div className="flex-1 pl-3 border-l-2 border-matrix-500">
                <div className="text-[11px] text-matrix-400 font-medium">
                  Replying to {replyTo.author}
                </div>
                <div className="text-xs text-black-400 truncate">
                  {replyTo.content}
                </div>
              </div>
              <button
                onClick={onCancelReply}
                className="p-1 rounded hover:bg-black-700 text-black-500 hover:text-white transition-colors"
              >
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Input row */}
      <div className="flex items-end gap-2 px-4 py-3">
        <textarea
          ref={inputRef}
          value={content}
          onChange={e => setContent(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="Message..."
          rows={1}
          className="flex-1 bg-black-800 border border-black-600 rounded-2xl px-4 py-2.5 text-sm text-white placeholder-black-500 resize-none focus:outline-none focus:border-matrix-500/50 transition-colors max-h-32 overflow-y-auto"
          style={{ minHeight: '42px' }}
        />
        <button
          onClick={handleSubmit}
          disabled={!content.trim()}
          className="flex-shrink-0 w-10 h-10 rounded-full bg-matrix-600 hover:bg-matrix-500 text-black-900 flex items-center justify-center transition-colors disabled:opacity-30 disabled:hover:bg-matrix-600"
        >
          <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M12 19V5m0 0l-7 7m7-7l7 7" />
          </svg>
        </button>
      </div>
    </div>
  )
}

// ============ Date Separator ============

function DateSeparator({ timestamp }) {
  const date = new Date(timestamp)
  const today = new Date()
  const yesterday = new Date(today)
  yesterday.setDate(yesterday.getDate() - 1)

  let label
  if (isSameDay(timestamp, today.getTime())) {
    label = 'Today'
  } else if (isSameDay(timestamp, yesterday.getTime())) {
    label = 'Yesterday'
  } else {
    label = date.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: date.getFullYear() !== today.getFullYear() ? 'numeric' : undefined })
  }

  return (
    <div className="flex items-center gap-3 my-4">
      <div className="flex-1 h-px bg-black-700" />
      <span className="text-[11px] text-black-500 font-medium px-2">{label}</span>
      <div className="flex-1 h-px bg-black-700" />
    </div>
  )
}

// ============ Helpers ============

function formatTime(timestamp) {
  return new Date(timestamp).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })
}

function formatTimeShort(timestamp) {
  const seconds = Math.floor((Date.now() - timestamp) / 1000)
  if (seconds < 60) return 'now'
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m`
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h`
  if (seconds < 604800) return `${Math.floor(seconds / 86400)}d`
  return new Date(timestamp).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
}

function isSameDay(ts1, ts2) {
  const d1 = new Date(ts1)
  const d2 = new Date(ts2)
  return d1.getFullYear() === d2.getFullYear() &&
    d1.getMonth() === d2.getMonth() &&
    d1.getDate() === d2.getDate()
}

export default MessageBoard
