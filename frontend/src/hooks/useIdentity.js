import { useState, useEffect, useCallback } from 'react'
import { ethers } from 'ethers'
import { useWallet } from './useWallet'

// Contract addresses (will be updated after deployment)
const IDENTITY_ADDRESS = import.meta.env.VITE_IDENTITY_CONTRACT || '0x0000000000000000000000000000000000000000'
const FORUM_ADDRESS = import.meta.env.VITE_FORUM_CONTRACT || '0x0000000000000000000000000000000000000000'

// Simplified ABI for frontend
const IDENTITY_ABI = [
  'function mintIdentity(string username) returns (uint256)',
  'function changeUsername(string newUsername)',
  'function updateAvatar((uint8,uint8,uint8,uint8,uint8,uint8) newTraits)',
  'function vote(uint256 contributionId, bool upvote)',
  'function getIdentity(address addr) view returns ((string,uint256,uint256,int256,uint256,uint256,uint256,uint256,(uint8,uint8,uint8,uint8,uint8,uint8)))',
  'function getIdentityByTokenId(uint256 tokenId) view returns ((string,uint256,uint256,int256,uint256,uint256,uint256,uint256,(uint8,uint8,uint8,uint8,uint8,uint8)))',
  'function hasIdentity(address addr) view returns (bool)',
  'function addressToTokenId(address) view returns (uint256)',
  'function usernameTaken(string) view returns (bool)',
  'function getContributionsByIdentity(uint256 tokenId) view returns (uint256[])',
  'function getContribution(uint256 contributionId) view returns ((address,uint256,bytes32,uint8,uint256,uint256,uint256))',
  'function totalIdentities() view returns (uint256)',
  'function totalContributions() view returns (uint256)',
  'event IdentityMinted(address indexed owner, uint256 indexed tokenId, string username)',
  'event XPGained(uint256 indexed tokenId, uint256 amount, string reason)',
  'event LevelUp(uint256 indexed tokenId, uint256 newLevel)',
]

const FORUM_ABI = [
  'function createPost(uint256 categoryId, string title, bytes32 contentHash) returns (uint256)',
  'function createReply(uint256 postId, bytes32 contentHash, uint256 parentReplyId) returns (uint256)',
  'function getCategory(uint256 categoryId) view returns ((string,string,uint256,bool))',
  'function getCategoryPosts(uint256 categoryId, uint256 offset, uint256 limit) view returns ((uint256,uint256,uint256,address,string,bytes32,uint256,uint256,uint256,bool,bool)[])',
  'function getPostReplies(uint256 postId, uint256 offset, uint256 limit) view returns ((uint256,uint256,uint256,address,bytes32,uint256,uint256)[])',
  'function posts(uint256) view returns (uint256,uint256,uint256,address,string,bytes32,uint256,uint256,uint256,bool,bool)',
  'function totalCategories() view returns (uint256)',
  'function totalPosts() view returns (uint256)',
]

// Level thresholds
const LEVEL_THRESHOLDS = [0, 100, 300, 600, 1000, 1500, 2500, 4000, 6000, 10000]

// Level titles
const LEVEL_TITLES = [
  'Newcomer',
  'Apprentice',
  'Trader',
  'Merchant',
  'Expert',
  'Master',
  'Grandmaster',
  'Legend',
  'Mythic',
  'Transcendent'
]

// Level colors
const LEVEL_COLORS = [
  '#6b7280', // gray
  '#3b82f6', // blue
  '#22c55e', // green
  '#a855f7', // purple
  '#f59e0b', // amber
  '#ef4444', // red
  '#00ff41', // matrix green
  '#00d4ff', // cyan
  '#ff3366', // pink
  '#ffd700', // gold
]

export function useIdentity() {
  const { address, isConnected, signer, provider } = useWallet()

  const [identity, setIdentity] = useState(null)
  const [tokenId, setTokenId] = useState(null)
  const [hasIdentity, setHasIdentity] = useState(false)
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState(null)

  // Parse identity from contract response
  const parseIdentity = (data) => {
    if (!data) return null

    return {
      username: data[0],
      level: Number(data[1]),
      xp: Number(data[2]),
      alignment: Number(data[3]),
      contributions: Number(data[4]),
      reputation: Number(data[5]),
      createdAt: Number(data[6]),
      lastActive: Number(data[7]),
      avatar: {
        background: data[8][0],
        body: data[8][1],
        eyes: data[8][2],
        mouth: data[8][3],
        accessory: data[8][4],
        aura: data[8][5],
      },
    }
  }

  // Load identity on connect
  useEffect(() => {
    const loadIdentity = async () => {
      if (!isConnected || !address || !provider) {
        setIdentity(null)
        setTokenId(null)
        setHasIdentity(false)
        setIsLoading(false)
        return
      }

      try {
        setIsLoading(true)
        setError(null)

        // For demo/dev mode, use mock data
        if (IDENTITY_ADDRESS === '0x0000000000000000000000000000000000000000') {
          // Check localStorage for mock identity
          const stored = localStorage.getItem(`vibeswap_identity_${address}`)
          if (stored) {
            const mockIdentity = JSON.parse(stored)
            setIdentity(mockIdentity)
            setTokenId(mockIdentity.tokenId || 1)
            setHasIdentity(true)
          } else {
            setHasIdentity(false)
          }
          setIsLoading(false)
          return
        }

        const contract = new ethers.Contract(IDENTITY_ADDRESS, IDENTITY_ABI, provider)

        const has = await contract.hasIdentity(address)
        setHasIdentity(has)

        if (has) {
          const tid = await contract.addressToTokenId(address)
          setTokenId(Number(tid))

          const data = await contract.getIdentity(address)
          setIdentity(parseIdentity(data))
        }
      } catch (err) {
        console.error('Error loading identity:', err)
        setError(err.message)
      } finally {
        setIsLoading(false)
      }
    }

    loadIdentity()
  }, [isConnected, address, provider])

  // Mint new identity
  const mintIdentity = useCallback(async (username) => {
    if (!signer || !address) throw new Error('Wallet not connected')

    // Dev mode - use localStorage
    if (IDENTITY_ADDRESS === '0x0000000000000000000000000000000000000000') {
      // Check if username taken
      const allKeys = Object.keys(localStorage).filter(k => k.startsWith('vibeswap_identity_'))
      for (const key of allKeys) {
        const stored = JSON.parse(localStorage.getItem(key))
        if (stored.username.toLowerCase() === username.toLowerCase()) {
          throw new Error('Username already taken')
        }
      }

      // Generate random avatar
      const seed = ethers.keccak256(ethers.toUtf8Bytes(address + Date.now()))
      const seedNum = BigInt(seed)

      const mockIdentity = {
        tokenId: allKeys.length + 1,
        username,
        level: 1,
        xp: 0,
        alignment: 0,
        contributions: 0,
        reputation: 0,
        createdAt: Math.floor(Date.now() / 1000),
        lastActive: Math.floor(Date.now() / 1000),
        avatar: {
          background: Number(seedNum % 16n),
          body: Number((seedNum >> 8n) % 16n),
          eyes: Number((seedNum >> 16n) % 16n),
          mouth: Number((seedNum >> 24n) % 16n),
          accessory: Number((seedNum >> 32n) % 16n),
          aura: 0,
        },
      }

      localStorage.setItem(`vibeswap_identity_${address}`, JSON.stringify(mockIdentity))
      setIdentity(mockIdentity)
      setTokenId(mockIdentity.tokenId)
      setHasIdentity(true)
      return mockIdentity.tokenId
    }

    const contract = new ethers.Contract(IDENTITY_ADDRESS, IDENTITY_ABI, signer)
    const tx = await contract.mintIdentity(username)
    const receipt = await tx.wait()

    // Parse event for tokenId
    const event = receipt.logs.find(log => {
      try {
        const parsed = contract.interface.parseLog(log)
        return parsed.name === 'IdentityMinted'
      } catch { return false }
    })

    const tid = event ? Number(contract.interface.parseLog(event).args.tokenId) : 1

    // Reload identity
    const data = await contract.getIdentity(address)
    setIdentity(parseIdentity(data))
    setTokenId(tid)
    setHasIdentity(true)

    return tid
  }, [signer, address])

  // Check username availability
  const checkUsername = useCallback(async (username) => {
    if (!username || username.length < 3) return false

    // Dev mode
    if (IDENTITY_ADDRESS === '0x0000000000000000000000000000000000000000') {
      const allKeys = Object.keys(localStorage).filter(k => k.startsWith('vibeswap_identity_'))
      for (const key of allKeys) {
        const stored = JSON.parse(localStorage.getItem(key))
        if (stored.username.toLowerCase() === username.toLowerCase()) {
          return false
        }
      }
      return true
    }

    const contract = new ethers.Contract(IDENTITY_ADDRESS, IDENTITY_ABI, provider)
    const taken = await contract.usernameTaken(username)
    return !taken
  }, [provider])

  // Add XP (dev mode only)
  const addXP = useCallback((amount, reason) => {
    if (!identity || IDENTITY_ADDRESS !== '0x0000000000000000000000000000000000000000') return

    const newXP = identity.xp + amount
    const newLevel = calculateLevel(newXP)

    const updated = {
      ...identity,
      xp: newXP,
      level: newLevel,
      lastActive: Math.floor(Date.now() / 1000),
    }

    localStorage.setItem(`vibeswap_identity_${address}`, JSON.stringify(updated))
    setIdentity(updated)
  }, [identity, address])

  // Add contribution (dev mode)
  const addContribution = useCallback((type) => {
    if (!identity) return

    const xpMap = { post: 10, reply: 5, proposal: 50, code: 100, trade: 10 }
    const xpGain = xpMap[type] || 10

    const updated = {
      ...identity,
      contributions: identity.contributions + 1,
      xp: identity.xp + xpGain,
      level: calculateLevel(identity.xp + xpGain),
      lastActive: Math.floor(Date.now() / 1000),
    }

    localStorage.setItem(`vibeswap_identity_${address}`, JSON.stringify(updated))
    setIdentity(updated)
  }, [identity, address])

  // Utility functions
  const calculateLevel = (xp) => {
    for (let i = LEVEL_THRESHOLDS.length - 1; i >= 0; i--) {
      if (xp >= LEVEL_THRESHOLDS[i]) return i + 1
    }
    return 1
  }

  const getXPProgress = () => {
    if (!identity) return 0
    const currentThreshold = LEVEL_THRESHOLDS[identity.level - 1] || 0
    const nextThreshold = LEVEL_THRESHOLDS[identity.level] || LEVEL_THRESHOLDS[LEVEL_THRESHOLDS.length - 1]
    if (nextThreshold === currentThreshold) return 100
    return ((identity.xp - currentThreshold) / (nextThreshold - currentThreshold)) * 100
  }

  const getLevelTitle = (level) => LEVEL_TITLES[level - 1] || LEVEL_TITLES[0]
  const getLevelColor = (level) => LEVEL_COLORS[level - 1] || LEVEL_COLORS[0]

  const getAlignmentLabel = (alignment) => {
    if (alignment <= -50) return 'Chaotic'
    if (alignment <= -20) return 'Rebellious'
    if (alignment < 20) return 'Neutral'
    if (alignment < 50) return 'Lawful'
    return 'Orderly'
  }

  return {
    identity,
    tokenId,
    hasIdentity,
    isLoading,
    error,
    mintIdentity,
    checkUsername,
    addXP,
    addContribution,
    getXPProgress,
    getLevelTitle,
    getLevelColor,
    getAlignmentLabel,
    LEVEL_THRESHOLDS,
    LEVEL_TITLES,
    LEVEL_COLORS,
  }
}

export function useForum() {
  const { provider, signer, address } = useWallet()
  const { hasIdentity, addContribution } = useIdentity()

  const [categories, setCategories] = useState([])
  const [isLoading, setIsLoading] = useState(true)

  // Default categories for dev mode
  const DEFAULT_CATEGORIES = [
    { id: 1, name: 'General', description: 'General discussion about VibeSwap', postCount: 3, active: true },
    { id: 2, name: 'Trading', description: 'Trading strategies and insights', postCount: 5, active: true },
    { id: 3, name: 'Proposals', description: 'Governance proposals and discussions', postCount: 2, active: true },
    { id: 4, name: 'Development', description: 'Technical development and contributions', postCount: 1, active: true },
    { id: 5, name: 'Support', description: 'Help and support requests', postCount: 4, active: true },
  ]

  // Load categories
  useEffect(() => {
    const load = async () => {
      try {
        setIsLoading(true)

        // Dev mode
        if (FORUM_ADDRESS === '0x0000000000000000000000000000000000000000') {
          setCategories(DEFAULT_CATEGORIES)
          setIsLoading(false)
          return
        }

        const contract = new ethers.Contract(FORUM_ADDRESS, FORUM_ABI, provider)
        const total = await contract.totalCategories()

        const cats = []
        for (let i = 1; i <= Number(total); i++) {
          const data = await contract.getCategory(i)
          cats.push({
            id: i,
            name: data[0],
            description: data[1],
            postCount: Number(data[2]),
            active: data[3],
          })
        }
        setCategories(cats)
      } catch (err) {
        console.error('Error loading categories:', err)
        setCategories(DEFAULT_CATEGORIES)
      } finally {
        setIsLoading(false)
      }
    }

    load()
  }, [provider])

  // Get posts for a category
  const getPosts = useCallback(async (categoryId, offset = 0, limit = 20) => {
    // Dev mode - return mock posts from localStorage
    if (FORUM_ADDRESS === '0x0000000000000000000000000000000000000000') {
      const stored = localStorage.getItem('vibeswap_forum_posts') || '[]'
      const allPosts = JSON.parse(stored)
      return allPosts
        .filter(p => p.categoryId === categoryId)
        .sort((a, b) => b.createdAt - a.createdAt)
        .slice(offset, offset + limit)
    }

    const contract = new ethers.Contract(FORUM_ADDRESS, FORUM_ABI, provider)
    const posts = await contract.getCategoryPosts(categoryId, offset, limit)

    return posts.map(p => ({
      id: Number(p[0]),
      categoryId: Number(p[1]),
      authorTokenId: Number(p[2]),
      author: p[3],
      title: p[4],
      contentHash: p[5],
      createdAt: Number(p[6]),
      lastReplyAt: Number(p[7]),
      replyCount: Number(p[8]),
      pinned: p[9],
      locked: p[10],
    }))
  }, [provider])

  // Create a post
  const createPost = useCallback(async (categoryId, title, content) => {
    if (!hasIdentity) throw new Error('Must have identity to post')

    // Dev mode
    if (FORUM_ADDRESS === '0x0000000000000000000000000000000000000000') {
      const stored = localStorage.getItem('vibeswap_forum_posts') || '[]'
      const posts = JSON.parse(stored)

      const identityData = localStorage.getItem(`vibeswap_identity_${address}`)
      const identity = identityData ? JSON.parse(identityData) : null

      const newPost = {
        id: posts.length + 1,
        categoryId,
        authorTokenId: identity?.tokenId || 1,
        authorUsername: identity?.username || 'Anonymous',
        author: address,
        title,
        content, // Store content directly in dev mode
        contentHash: ethers.keccak256(ethers.toUtf8Bytes(content)),
        createdAt: Math.floor(Date.now() / 1000),
        lastReplyAt: Math.floor(Date.now() / 1000),
        replyCount: 0,
        pinned: false,
        locked: false,
        upvotes: 0,
        downvotes: 0,
      }

      posts.push(newPost)
      localStorage.setItem('vibeswap_forum_posts', JSON.stringify(posts))

      addContribution('post')

      return newPost.id
    }

    const contract = new ethers.Contract(FORUM_ADDRESS, FORUM_ABI, signer)
    const contentHash = ethers.keccak256(ethers.toUtf8Bytes(content))
    // Note: In production, content would be uploaded to IPFS first

    const tx = await contract.createPost(categoryId, title, contentHash)
    await tx.wait()

    addContribution('post')
  }, [signer, hasIdentity, address, addContribution])

  // Get replies for a post
  const getReplies = useCallback(async (postId) => {
    // Dev mode
    if (FORUM_ADDRESS === '0x0000000000000000000000000000000000000000') {
      const stored = localStorage.getItem('vibeswap_forum_replies') || '[]'
      const allReplies = JSON.parse(stored)
      return allReplies
        .filter(r => r.postId === postId)
        .sort((a, b) => a.createdAt - b.createdAt)
    }

    const contract = new ethers.Contract(FORUM_ADDRESS, FORUM_ABI, provider)
    const replies = await contract.getPostReplies(postId, 0, 100)

    return replies.map(r => ({
      id: Number(r[0]),
      postId: Number(r[1]),
      authorTokenId: Number(r[2]),
      author: r[3],
      contentHash: r[4],
      createdAt: Number(r[5]),
      parentReplyId: Number(r[6]),
    }))
  }, [provider])

  // Create a reply
  const createReply = useCallback(async (postId, content, parentReplyId = 0) => {
    if (!hasIdentity) throw new Error('Must have identity to reply')

    // Dev mode
    if (FORUM_ADDRESS === '0x0000000000000000000000000000000000000000') {
      const stored = localStorage.getItem('vibeswap_forum_replies') || '[]'
      const replies = JSON.parse(stored)

      const identityData = localStorage.getItem(`vibeswap_identity_${address}`)
      const identity = identityData ? JSON.parse(identityData) : null

      const newReply = {
        id: replies.length + 1,
        postId,
        authorTokenId: identity?.tokenId || 1,
        authorUsername: identity?.username || 'Anonymous',
        author: address,
        content,
        contentHash: ethers.keccak256(ethers.toUtf8Bytes(content)),
        createdAt: Math.floor(Date.now() / 1000),
        parentReplyId,
        upvotes: 0,
        downvotes: 0,
      }

      replies.push(newReply)
      localStorage.setItem('vibeswap_forum_replies', JSON.stringify(replies))

      // Update post reply count
      const postsStored = localStorage.getItem('vibeswap_forum_posts') || '[]'
      const posts = JSON.parse(postsStored)
      const postIndex = posts.findIndex(p => p.id === postId)
      if (postIndex >= 0) {
        posts[postIndex].replyCount++
        posts[postIndex].lastReplyAt = Math.floor(Date.now() / 1000)
        localStorage.setItem('vibeswap_forum_posts', JSON.stringify(posts))
      }

      addContribution('reply')

      return newReply.id
    }

    const contract = new ethers.Contract(FORUM_ADDRESS, FORUM_ABI, signer)
    const contentHash = ethers.keccak256(ethers.toUtf8Bytes(content))

    const tx = await contract.createReply(postId, contentHash, parentReplyId)
    await tx.wait()

    addContribution('reply')
  }, [signer, hasIdentity, address, addContribution])

  return {
    categories,
    isLoading,
    getPosts,
    createPost,
    getReplies,
    createReply,
  }
}
