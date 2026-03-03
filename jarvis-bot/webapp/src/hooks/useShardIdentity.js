// ============ Shard Identity Hook ============
//
// Creates a persistent shard identity using WebAuthn (if available)
// or falls back to random UUID in localStorage.
// No ethers dependency — uses crypto.subtle for hashing.
// ============

import { useState, useEffect, useCallback } from 'react';
import { getTelegramUserId } from '../lib/telegram';

const STORAGE_KEY = 'jarvis-shard-identity';

function generateRandomId() {
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  return Array.from(bytes).map(b => b.toString(16).padStart(2, '0')).join('');
}

async function deriveShardId(credentialId, telegramUserId) {
  const encoder = new TextEncoder();
  const data = encoder.encode(`${credentialId}:${telegramUserId}`);
  const hashBuffer = await crypto.subtle.digest('SHA-256', data);
  const hashArray = new Uint8Array(hashBuffer);
  return Array.from(hashArray).map(b => b.toString(16).padStart(2, '0')).join('');
}

export function useShardIdentity() {
  const [shardId, setShardId] = useState(null);
  const [displayName, setDisplayName] = useState('');
  const [method, setMethod] = useState(null); // 'webauthn' | 'random'
  const [loading, setLoading] = useState(true);

  // Load existing identity on mount
  useEffect(() => {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored) {
      try {
        const parsed = JSON.parse(stored);
        setShardId(parsed.shardId);
        setDisplayName(parsed.displayName || '');
        setMethod(parsed.method);
        setLoading(false);
        return;
      } catch { /* fall through */ }
    }
    setLoading(false);
  }, []);

  const createIdentity = useCallback(async () => {
    setLoading(true);
    const telegramUserId = getTelegramUserId() || 'anonymous';

    try {
      // Try WebAuthn first (biometric / passkey)
      if (window.PublicKeyCredential) {
        const challenge = crypto.getRandomValues(new Uint8Array(32));
        const id = crypto.getRandomValues(new Uint8Array(16));

        const credential = await navigator.credentials.create({
          publicKey: {
            challenge,
            rp: { name: 'Jarvis Mind Network', id: window.location.hostname || 'localhost' },
            user: {
              id,
              name: `shard-${telegramUserId}`,
              displayName: 'Jarvis Shard',
            },
            pubKeyCredParams: [
              { type: 'public-key', alg: -7 },  // ES256
              { type: 'public-key', alg: -257 }, // RS256
            ],
            authenticatorSelection: {
              authenticatorAttachment: 'platform',
              userVerification: 'preferred',
            },
            timeout: 60000,
          },
        });

        if (credential) {
          const credentialIdHex = Array.from(new Uint8Array(credential.rawId))
            .map(b => b.toString(16).padStart(2, '0')).join('');
          const derived = await deriveShardId(credentialIdHex, telegramUserId);
          const sid = `mobile-${derived.slice(0, 16)}`;

          const identity = { shardId: sid, method: 'webauthn', credentialId: credentialIdHex, displayName: `Shard ${sid.slice(-8)}` };
          localStorage.setItem(STORAGE_KEY, JSON.stringify(identity));
          setShardId(sid);
          setDisplayName(identity.displayName);
          setMethod('webauthn');
          setLoading(false);
          return sid;
        }
      }
    } catch (err) {
      console.warn('[identity] WebAuthn failed, falling back to random:', err.message);
    }

    // Fallback: random UUID
    const randomHex = generateRandomId();
    const sid = `mobile-${randomHex.slice(0, 16)}`;
    const identity = { shardId: sid, method: 'random', displayName: `Shard ${sid.slice(-8)}` };
    localStorage.setItem(STORAGE_KEY, JSON.stringify(identity));
    setShardId(sid);
    setDisplayName(identity.displayName);
    setMethod('random');
    setLoading(false);
    return sid;
  }, []);

  const clearIdentity = useCallback(() => {
    localStorage.removeItem(STORAGE_KEY);
    setShardId(null);
    setDisplayName('');
    setMethod(null);
  }, []);

  return {
    shardId,
    displayName,
    method,
    loading,
    hasIdentity: !!shardId,
    createIdentity,
    clearIdentity,
  };
}
