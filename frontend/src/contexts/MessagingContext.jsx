import { createContext, useContext, useState, useEffect, useCallback, useRef } from 'react'

// ============================================================
// MESSAGING CORE - Layer Zero
// ============================================================
//
// Pure messaging primitive. No game theory, no governance, no trust chains.
// Those are layers that compose ON TOP of this.
//
// Design principles:
// 1. Messages are the atom - everything is a message (posts, replies, reactions)
// 2. Boards are namespaces - messages belong to boards
// 3. Votes are first-class - up/down on any message
// 4. Threading via parentId - flat storage, tree rendering
// 5. metadata:{} is the extensibility hook - wiki, algorithms, social all hang here
// 6. Storage adapter pattern - localStorage now, real backend later
//    Swap the adapter, everything else stays the same
//
// This is the FIRST LIVE piece of the protocol.
// Everything else (contributions, governance, rewards) builds on this.
// ============================================================

const MessagingContext = createContext()

// ============ Storage Adapter Interface ============
// Any adapter must implement: load(), save(state), subscribe?(onChange)
// This lets us swap localStorage for a real API/WebSocket backend
// without changing a single component.

function createLocalStorageAdapter(key) {
  return {
    load() {
      try {
        const raw = localStorage.getItem(key)
        return raw ? JSON.parse(raw) : null
      } catch {
        return null
      }
    },
    save(state) {
      try {
        localStorage.setItem(key, JSON.stringify(state))
      } catch (e) {
        console.warn('MessagingContext: localStorage save failed', e)
      }
    },
  }
}

// ============ Default Boards ============
const DEFAULT_BOARDS = [
  {
    id: 'general',
    name: 'General',
    description: 'Open discussion about anything',
    createdAt: Date.now(),
    metadata: {},
  },
  {
    id: 'trading',
    name: 'Trading',
    description: 'Market discussion, trade ideas, price action',
    createdAt: Date.now(),
    metadata: {},
  },
  {
    id: 'development',
    name: 'Development',
    description: 'Protocol development, features, bugs',
    createdAt: Date.now(),
    metadata: {},
  },
  {
    id: 'governance',
    name: 'Governance',
    description: 'Proposals, voting, protocol direction',
    createdAt: Date.now(),
    metadata: {},
  },
]

// ============ Seed Messages ============
// Bootstrap with real conversation to show the board isn't empty
const SEED_MESSAGES = [
  {
    id: 'msg-seed-001',
    boardId: 'general',
    parentId: null,
    author: 'Faraday1',
    content: 'Welcome to the VibeSwap message board. This is the first live piece of the protocol — raw messaging and gossip. Everything else builds on top of this.\n\nPost anything. Reply to anyone. Upvote what matters. Downvote what doesn\'t.\n\nNo algorithms. No curation. Just messages.',
    createdAt: Date.now() - 86400000 * 2,
    editedAt: null,
    votes: { up: ['Matt', 'Bill'], down: [] },
    metadata: { pinned: true },
  },
  {
    id: 'msg-seed-002',
    boardId: 'general',
    parentId: null,
    author: 'Matt',
    content: 'Like the simplicity. One thing — will there be a way to search old threads? If this becomes the foundation for everything, discoverability matters.',
    createdAt: Date.now() - 86400000 * 1.5,
    editedAt: null,
    votes: { up: ['Faraday1', 'Bill'], down: [] },
    metadata: {},
  },
  {
    id: 'msg-seed-003',
    boardId: 'general',
    parentId: 'msg-seed-002',
    author: 'Faraday1',
    content: 'Good call. Search, tagging, and wiki-style cross-referencing are all on the roadmap as layers on top. Core layer stays pure messaging — the layers above handle discovery.',
    createdAt: Date.now() - 86400000,
    editedAt: null,
    votes: { up: ['Matt'], down: [] },
    metadata: {},
  },
  {
    id: 'msg-seed-004',
    boardId: 'development',
    parentId: null,
    author: 'Faraday1',
    content: 'Dev board is live. Use this for protocol discussion, feature requests, bug reports. The existing contribution system will eventually pull from messages posted here.',
    createdAt: Date.now() - 86400000,
    editedAt: null,
    votes: { up: [], down: [] },
    metadata: {},
  },
  {
    id: 'msg-seed-005',
    boardId: 'trading',
    parentId: null,
    author: 'Bill',
    content: 'Curious about the fee structure. If exchange fees go 100% to LPs and governance is token-funded, how does the protocol sustain itself long-term?',
    createdAt: Date.now() - 43200000,
    editedAt: null,
    votes: { up: ['Matt', 'Faraday1'], down: [] },
    metadata: {},
  },
  {
    id: 'msg-seed-006',
    boardId: 'trading',
    parentId: 'msg-seed-005',
    author: 'Faraday1',
    content: 'The mechanism insulation principle. Fees reward capital providers. Tokens reward protocol stewards. If you mix them, arbitrators get incentivized to favor high-volume traders — that\'s capture, not decentralization. The protocol sustains through token value creation, not fee extraction.',
    createdAt: Date.now() - 36000000,
    editedAt: null,
    votes: { up: ['Bill'], down: [] },
    metadata: {},
  },
]

// ============ Initial State ============
function getInitialState() {
  return {
    boards: DEFAULT_BOARDS,
    messages: SEED_MESSAGES,
    version: 1,
  }
}

// ============ ID Generation ============
let counter = 0
function generateId(prefix = 'msg') {
  counter++
  return `${prefix}-${Date.now()}-${counter}-${Math.random().toString(36).slice(2, 6)}`
}

// ============ Provider ============
export function MessagingProvider({ children, storageAdapter }) {
  const adapter = useRef(
    storageAdapter || createLocalStorageAdapter('vibeswap_messaging')
  )

  // Load state from adapter, fall back to initial
  const [state, setState] = useState(() => {
    const saved = adapter.current.load()
    if (saved && saved.version === 1) {
      return saved
    }
    return getInitialState()
  })

  // Persist on change
  useEffect(() => {
    adapter.current.save(state)
  }, [state])

  // ============ Board Operations ============

  const getBoards = useCallback(() => {
    return state.boards
  }, [state.boards])

  const getBoard = useCallback((boardId) => {
    return state.boards.find(b => b.id === boardId) || null
  }, [state.boards])

  const createBoard = useCallback((name, description, metadata = {}) => {
    const board = {
      id: generateId('board'),
      name,
      description,
      createdAt: Date.now(),
      metadata,
    }
    setState(prev => ({
      ...prev,
      boards: [...prev.boards, board],
    }))
    return board
  }, [])

  // ============ Message Operations ============

  const postMessage = useCallback((boardId, author, content, parentId = null, metadata = {}) => {
    const message = {
      id: generateId('msg'),
      boardId,
      parentId,
      author,
      content,
      createdAt: Date.now(),
      editedAt: null,
      votes: { up: [], down: [] },
      metadata,
    }
    setState(prev => ({
      ...prev,
      messages: [message, ...prev.messages],
    }))
    return message
  }, [])

  const editMessage = useCallback((messageId, newContent, editor) => {
    setState(prev => ({
      ...prev,
      messages: prev.messages.map(m => {
        if (m.id !== messageId) return m
        // Only the author can edit
        if (m.author !== editor) return m
        return { ...m, content: newContent, editedAt: Date.now() }
      }),
    }))
  }, [])

  const deleteMessage = useCallback((messageId, deleter) => {
    setState(prev => ({
      ...prev,
      messages: prev.messages.map(m => {
        if (m.id !== messageId) return m
        // Only author can delete. Content replaced, message stays for thread integrity.
        if (m.author !== deleter) return m
        return {
          ...m,
          content: '[deleted]',
          metadata: { ...m.metadata, deleted: true, deletedAt: Date.now() },
        }
      }),
    }))
  }, [])

  // ============ Vote Operations ============

  const vote = useCallback((messageId, voter, direction) => {
    // direction: 'up' | 'down' | null (null = remove vote)
    setState(prev => ({
      ...prev,
      messages: prev.messages.map(m => {
        if (m.id !== messageId) return m
        const newVotes = {
          up: m.votes.up.filter(v => v !== voter),
          down: m.votes.down.filter(v => v !== voter),
        }
        if (direction === 'up') {
          newVotes.up.push(voter)
        } else if (direction === 'down') {
          newVotes.down.push(voter)
        }
        // direction === null means remove vote (already filtered above)
        return { ...m, votes: newVotes }
      }),
    }))
  }, [])

  const getVoteScore = useCallback((message) => {
    return (message.votes?.up?.length || 0) - (message.votes?.down?.length || 0)
  }, [])

  const getUserVote = useCallback((message, voter) => {
    if (message.votes?.up?.includes(voter)) return 'up'
    if (message.votes?.down?.includes(voter)) return 'down'
    return null
  }, [])

  // ============ Query Operations ============

  // Get top-level messages for a board (no parentId), sorted newest first
  const getBoardMessages = useCallback((boardId, sort = 'newest') => {
    const msgs = state.messages.filter(m => m.boardId === boardId && m.parentId === null)

    switch (sort) {
      case 'newest':
        return msgs.sort((a, b) => b.createdAt - a.createdAt)
      case 'oldest':
        return msgs.sort((a, b) => a.createdAt - b.createdAt)
      case 'top':
        return msgs.sort((a, b) => {
          const scoreA = (a.votes?.up?.length || 0) - (a.votes?.down?.length || 0)
          const scoreB = (b.votes?.up?.length || 0) - (b.votes?.down?.length || 0)
          return scoreB - scoreA
        })
      case 'controversial':
        return msgs.sort((a, b) => {
          const totalA = (a.votes?.up?.length || 0) + (a.votes?.down?.length || 0)
          const totalB = (b.votes?.up?.length || 0) + (b.votes?.down?.length || 0)
          return totalB - totalA
        })
      default:
        return msgs
    }
  }, [state.messages])

  // Get all replies to a message (direct children)
  const getReplies = useCallback((messageId) => {
    return state.messages
      .filter(m => m.parentId === messageId)
      .sort((a, b) => a.createdAt - b.createdAt)
  }, [state.messages])

  // Get a single message by ID
  const getMessage = useCallback((messageId) => {
    return state.messages.find(m => m.id === messageId) || null
  }, [state.messages])

  // Get full thread tree for a message (recursive)
  const getThread = useCallback((messageId) => {
    const root = state.messages.find(m => m.id === messageId)
    if (!root) return null

    function buildTree(parentId) {
      const children = state.messages
        .filter(m => m.parentId === parentId)
        .sort((a, b) => a.createdAt - b.createdAt)

      return children.map(child => ({
        ...child,
        replies: buildTree(child.id),
      }))
    }

    return {
      ...root,
      replies: buildTree(root.id),
    }
  }, [state.messages])

  // Count replies for a message (recursive, all descendants)
  const getReplyCount = useCallback((messageId) => {
    let count = 0
    function countChildren(parentId) {
      const children = state.messages.filter(m => m.parentId === parentId)
      count += children.length
      children.forEach(child => countChildren(child.id))
    }
    countChildren(messageId)
    return count
  }, [state.messages])

  // Get all messages by a specific author
  const getMessagesByAuthor = useCallback((author) => {
    return state.messages
      .filter(m => m.author === author)
      .sort((a, b) => b.createdAt - a.createdAt)
  }, [state.messages])

  // Get message count per board
  const getBoardStats = useCallback((boardId) => {
    const boardMsgs = state.messages.filter(m => m.boardId === boardId)
    const authors = new Set(boardMsgs.map(m => m.author))
    const latest = boardMsgs.reduce((latest, m) => m.createdAt > latest ? m.createdAt : latest, 0)
    return {
      messageCount: boardMsgs.length,
      authorCount: authors.size,
      latestActivity: latest,
    }
  }, [state.messages])

  // ============ Metadata Operations ============
  // These are the extensibility hooks. Layers above (wiki, algorithms, etc.)
  // write to metadata without the core needing to know about them.

  const setMessageMetadata = useCallback((messageId, key, value) => {
    setState(prev => ({
      ...prev,
      messages: prev.messages.map(m => {
        if (m.id !== messageId) return m
        return { ...m, metadata: { ...m.metadata, [key]: value } }
      }),
    }))
  }, [])

  const setBoardMetadata = useCallback((boardId, key, value) => {
    setState(prev => ({
      ...prev,
      boards: prev.boards.map(b => {
        if (b.id !== boardId) return b
        return { ...b, metadata: { ...b.metadata, [key]: value } }
      }),
    }))
  }, [])

  // ============ Activity Feed (for ContributionGraph integration) ============
  // Returns a flat list of all activity events sorted by time

  const getActivityFeed = useCallback((limit = 50) => {
    const events = []

    state.messages.forEach(m => {
      events.push({
        type: m.parentId ? 'reply' : 'post',
        messageId: m.id,
        boardId: m.boardId,
        author: m.author,
        timestamp: m.createdAt,
      })
    })

    // Sort newest first and limit
    return events
      .sort((a, b) => b.timestamp - a.timestamp)
      .slice(0, limit)
  }, [state.messages])

  // Get daily activity counts for the contribution graph
  const getDailyActivity = useCallback((author = null) => {
    const counts = {}
    state.messages.forEach(m => {
      if (author && m.author !== author) return
      const day = new Date(m.createdAt).toISOString().split('T')[0]
      counts[day] = (counts[day] || 0) + 1
    })
    return counts
  }, [state.messages])

  return (
    <MessagingContext.Provider value={{
      // Board operations
      getBoards,
      getBoard,
      createBoard,
      // Message operations
      postMessage,
      editMessage,
      deleteMessage,
      // Vote operations
      vote,
      getVoteScore,
      getUserVote,
      // Query operations
      getBoardMessages,
      getReplies,
      getMessage,
      getThread,
      getReplyCount,
      getMessagesByAuthor,
      getBoardStats,
      // Metadata (extensibility hooks)
      setMessageMetadata,
      setBoardMetadata,
      // Activity (ContributionGraph integration)
      getActivityFeed,
      getDailyActivity,
      // Raw state (for debugging / advanced use)
      _state: state,
    }}>
      {children}
    </MessagingContext.Provider>
  )
}

export function useMessagingContext() {
  const context = useContext(MessagingContext)
  if (!context) {
    throw new Error('useMessagingContext must be used within a MessagingProvider')
  }
  return context
}
