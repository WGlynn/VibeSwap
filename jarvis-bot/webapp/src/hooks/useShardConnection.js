// ============ Shard Connection Hook — Register, Heartbeat, Topology ============

import { useState, useEffect, useRef, useCallback } from 'react';
import { registerShard, sendHeartbeat, fetchTopology } from '../lib/api';

const HEARTBEAT_INTERVAL = 30_000; // 30s
const TOPOLOGY_REFRESH = 60_000;   // 60s

export function useShardConnection(shardId, hashrate, julBalance) {
  const [registered, setRegistered] = useState(false);
  const [peers, setPeers] = useState(0);
  const [networkHealth, setNetworkHealth] = useState('unknown');
  const [topology, setTopology] = useState(null);
  const [error, setError] = useState(null);

  const heartbeatRef = useRef(null);
  const topologyRef = useRef(null);

  // Register with router
  const connect = useCallback(async () => {
    if (!shardId) return;

    try {
      await registerShard(shardId, 'light', { mining: true, mobile: true });
      setRegistered(true);
      setError(null);
    } catch (err) {
      setError(`Registration failed: ${err.message}`);
      setRegistered(false);
    }
  }, [shardId]);

  // Send heartbeat
  const doHeartbeat = useCallback(async () => {
    if (!shardId || !registered) return;

    try {
      await sendHeartbeat(shardId, {
        load: hashrate || 0,
        julBalance: julBalance || 0,
        mobile: true,
      });
    } catch (err) {
      console.warn('[shard] Heartbeat failed:', err.message);
    }
  }, [shardId, registered, hashrate, julBalance]);

  // Fetch topology
  const refreshTopology = useCallback(async () => {
    try {
      const topo = await fetchTopology();
      setTopology(topo);
      setPeers(topo.shards?.length || topo.totalShards || 0);
      setNetworkHealth(topo.healthy ? 'healthy' : 'degraded');
    } catch (err) {
      console.warn('[shard] Topology fetch failed:', err.message);
    }
  }, []);

  // Auto-register on shardId change
  useEffect(() => {
    if (shardId) connect();
  }, [shardId, connect]);

  // Heartbeat + topology polling
  useEffect(() => {
    if (!registered) return;

    // Initial topology fetch
    refreshTopology();

    heartbeatRef.current = setInterval(doHeartbeat, HEARTBEAT_INTERVAL);
    topologyRef.current = setInterval(refreshTopology, TOPOLOGY_REFRESH);

    return () => {
      if (heartbeatRef.current) clearInterval(heartbeatRef.current);
      if (topologyRef.current) clearInterval(topologyRef.current);
    };
  }, [registered, doHeartbeat, refreshTopology]);

  return {
    registered,
    peers,
    networkHealth,
    topology,
    error,
    connect,
    refreshTopology,
  };
}
