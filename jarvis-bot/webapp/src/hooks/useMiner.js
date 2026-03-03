// ============ Miner Hook — Web Worker Lifecycle + Proof Submission ============

import { useState, useEffect, useRef, useCallback } from 'react';
import { fetchMiningTarget, submitMiningProof } from '../lib/api';
import { getTelegramInitData } from '../lib/telegram';

const CHALLENGE_REFRESH = 5 * 60 * 1000;  // 5 min
const MAX_THREADS = Math.min(navigator.hardwareConcurrency || 2, 4);

export function useMiner(shardId) {
  const [mining, setMining] = useState(false);
  const [hashrate, setHashrate] = useState(0);
  const [julMined, setJulMined] = useState(0);
  const [proofsAccepted, setProofsAccepted] = useState(0);
  const [proofsRejected, setProofsRejected] = useState(0);
  const [threads, setThreads] = useState(1);
  const [difficulty, setDifficulty] = useState(0);
  const [epoch, setEpoch] = useState(0);
  const [reward, setReward] = useState(0);
  const [epochProgress, setEpochProgress] = useState('0/100');
  const [challenge, setChallenge] = useState('');
  const [error, setError] = useState(null);
  const [log, setLog] = useState([]);

  const workersRef = useRef([]);
  const challengeRef = useRef('');
  const challengeTimerRef = useRef(null);
  const miningRef = useRef(false);

  const addLog = useCallback((msg) => {
    setLog(prev => [...prev.slice(-49), { time: new Date().toLocaleTimeString(), msg }]);
  }, []);

  // Fetch challenge from server
  const refreshChallenge = useCallback(async () => {
    try {
      const target = await fetchMiningTarget();
      challengeRef.current = target.challenge;
      setChallenge(target.challenge);
      setDifficulty(target.difficulty);
      setEpoch(target.epoch);
      setReward(target.reward);
      setEpochProgress(target.epochProgress);
      setError(null);
      return target;
    } catch (err) {
      setError(`Failed to fetch target: ${err.message}`);
      return null;
    }
  }, []);

  // Submit proof to server
  const handleProof = useCallback(async (nonce, hash) => {
    if (!shardId || !challengeRef.current) return;

    try {
      const initData = getTelegramInitData();
      const result = await submitMiningProof(shardId, nonce, hash, challengeRef.current, initData);

      if (result.accepted) {
        setProofsAccepted(prev => prev + 1);
        setJulMined(result.julBalance || 0);
        addLog(`Proof accepted! +${result.reward?.toFixed(2)} JUL`);
      } else {
        setProofsRejected(prev => prev + 1);
        addLog(`Proof rejected: ${result.reason}`);
        // Refresh challenge if stale
        if (result.reason === 'stale_challenge') {
          refreshChallenge();
        }
      }
    } catch (err) {
      addLog(`Submit error: ${err.message}`);
    }
  }, [shardId, addLog, refreshChallenge]);

  // Start mining
  const startMining = useCallback(async () => {
    if (miningRef.current || !shardId) return;

    const target = await refreshChallenge();
    if (!target) return;

    miningRef.current = true;
    setMining(true);
    addLog(`Mining started — difficulty ${target.difficulty}, ${threads} thread(s)`);

    // Spawn workers
    const workers = [];
    for (let i = 0; i < threads; i++) {
      const worker = new Worker(
        new URL('../workers/miner-worker.js', import.meta.url),
        { type: 'module' }
      );

      worker.onmessage = (e) => {
        if (e.data.type === 'proof') {
          handleProof(e.data.nonce, e.data.hash);
        } else if (e.data.type === 'hashrate') {
          // Sum hashrates from all workers
          setHashrate(prev => {
            // Simple averaging approach: report latest from this worker
            return e.data.rate * threads;
          });
        }
      };

      worker.onerror = (err) => {
        addLog(`Worker error: ${err.message}`);
      };

      worker.postMessage({
        type: 'start',
        challenge: target.challenge,
        difficulty: target.difficulty,
      });

      workers.push(worker);
    }

    workersRef.current = workers;

    // Set up challenge refresh timer
    challengeTimerRef.current = setInterval(async () => {
      const newTarget = await refreshChallenge();
      if (newTarget && miningRef.current) {
        // Restart workers with new challenge
        workersRef.current.forEach(w => {
          w.postMessage({ type: 'stop' });
          w.postMessage({
            type: 'start',
            challenge: newTarget.challenge,
            difficulty: newTarget.difficulty,
          });
        });
        addLog(`Challenge rotated — difficulty ${newTarget.difficulty}`);
      }
    }, CHALLENGE_REFRESH);
  }, [shardId, threads, refreshChallenge, handleProof, addLog]);

  // Stop mining
  const stopMining = useCallback(() => {
    miningRef.current = false;
    setMining(false);
    setHashrate(0);

    workersRef.current.forEach(w => {
      w.postMessage({ type: 'stop' });
      w.terminate();
    });
    workersRef.current = [];

    if (challengeTimerRef.current) {
      clearInterval(challengeTimerRef.current);
      challengeTimerRef.current = null;
    }

    addLog('Mining stopped');
  }, [addLog]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      workersRef.current.forEach(w => {
        w.postMessage({ type: 'stop' });
        w.terminate();
      });
      if (challengeTimerRef.current) {
        clearInterval(challengeTimerRef.current);
      }
    };
  }, []);

  return {
    mining,
    hashrate,
    julMined,
    proofsAccepted,
    proofsRejected,
    threads,
    setThreads,
    maxThreads: MAX_THREADS,
    difficulty,
    epoch,
    reward,
    epochProgress,
    challenge,
    error,
    log,
    startMining,
    stopMining,
  };
}
