// ============ Shard Status — Peers, Consensus, Network Health ============

import React from 'react';
import { themeColor } from '../lib/telegram';

function StatusDot({ color }) {
  return (
    <span style={{
      display: 'inline-block',
      width: 8,
      height: 8,
      borderRadius: '50%',
      background: color,
      marginRight: 8,
      boxShadow: `0 0 6px ${color}`,
    }} />
  );
}

export default function ShardStatus({ shardId, connection, method }) {
  const { registered, peers, networkHealth } = connection;

  const healthColor = networkHealth === 'healthy' ? '#4ade80'
    : networkHealth === 'degraded' ? '#facc15'
    : '#888';

  const statusColor = registered ? '#4ade80' : '#ef4444';
  const statusText = registered ? 'Connected' : 'Disconnected';

  return (
    <div style={{
      background: themeColor('secondary_bg_color', '#1e1e2e'),
      borderRadius: 12,
      padding: '14px 16px',
      marginBottom: 12,
    }}>
      <div style={{
        fontSize: 13,
        fontWeight: 600,
        color: themeColor('text_color', '#ffffff'),
        marginBottom: 10,
      }}>Shard Status</div>

      <div style={{
        display: 'flex',
        flexDirection: 'column',
        gap: 6,
        fontSize: 13,
        color: themeColor('text_color', '#ddddee'),
      }}>
        <div style={{ display: 'flex', alignItems: 'center' }}>
          <StatusDot color={statusColor} />
          <span>{statusText}</span>
        </div>

        <div style={{ display: 'flex', justifyContent: 'space-between' }}>
          <span style={{ color: themeColor('hint_color', '#8888aa') }}>Shard ID</span>
          <span style={{ fontFamily: 'monospace', fontSize: 12 }}>
            {shardId ? `${shardId.slice(0, 8)}...${shardId.slice(-4)}` : '—'}
          </span>
        </div>

        <div style={{ display: 'flex', justifyContent: 'space-between' }}>
          <span style={{ color: themeColor('hint_color', '#8888aa') }}>Identity</span>
          <span>{method === 'webauthn' ? 'Biometric' : method === 'random' ? 'UUID' : '—'}</span>
        </div>

        <div style={{ display: 'flex', justifyContent: 'space-between' }}>
          <span style={{ color: themeColor('hint_color', '#8888aa') }}>Peers</span>
          <span>{peers}</span>
        </div>

        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <span style={{ color: themeColor('hint_color', '#8888aa') }}>Network</span>
          <span style={{ display: 'flex', alignItems: 'center' }}>
            <StatusDot color={healthColor} />
            {networkHealth}
          </span>
        </div>
      </div>
    </div>
  );
}
