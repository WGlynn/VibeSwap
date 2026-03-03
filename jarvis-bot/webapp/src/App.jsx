// ============ Jarvis Shard Miner — Telegram Mini App ============

import React from 'react';
import { useShardIdentity } from './hooks/useShardIdentity';
import { useMiner } from './hooks/useMiner';
import { useShardConnection } from './hooks/useShardConnection';
import MiningDashboard from './components/MiningDashboard';
import ShardStatus from './components/ShardStatus';
import ControlPanel from './components/ControlPanel';
import { themeColor, getColorScheme } from './lib/telegram';

export default function App() {
  const identity = useShardIdentity();
  const miner = useMiner(identity.shardId);
  const connection = useShardConnection(identity.shardId, miner.hashrate, miner.julMined);

  const isDark = getColorScheme() === 'dark';

  return (
    <div style={{
      minHeight: '100vh',
      background: themeColor('bg_color', isDark ? '#0d0d1a' : '#f5f5f7'),
      color: themeColor('text_color', isDark ? '#ffffff' : '#1a1a2e'),
      fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
      padding: '16px 12px',
      boxSizing: 'border-box',
    }}>
      {/* Header */}
      <div style={{
        textAlign: 'center',
        marginBottom: 20,
      }}>
        <div style={{
          fontSize: 28,
          fontWeight: 800,
          letterSpacing: -0.5,
          background: 'linear-gradient(135deg, #5b7fff, #a855f7)',
          WebkitBackgroundClip: 'text',
          WebkitTextFillColor: 'transparent',
        }}>
          JARVIS
        </div>
        <div style={{
          fontSize: 12,
          color: themeColor('hint_color', '#8888aa'),
          letterSpacing: 2,
          textTransform: 'uppercase',
          marginTop: 2,
        }}>
          Shard Miner
        </div>
      </div>

      {/* Identity not yet created */}
      {!identity.hasIdentity && !identity.loading && (
        <div style={{
          textAlign: 'center',
          padding: '40px 20px',
        }}>
          <div style={{
            fontSize: 48,
            marginBottom: 16,
          }}>
            {/* Lightning bolt via CSS */}
            <span style={{
              display: 'inline-block',
              width: 48,
              height: 48,
              borderRadius: '50%',
              background: 'linear-gradient(135deg, #5b7fff, #a855f7)',
              lineHeight: '48px',
              fontSize: 24,
            }}>J</span>
          </div>
          <div style={{
            fontSize: 16,
            fontWeight: 600,
            color: themeColor('text_color', '#ffffff'),
            marginBottom: 8,
          }}>Launch Your Shard</div>
          <div style={{
            fontSize: 13,
            color: themeColor('hint_color', '#8888aa'),
            maxWidth: 280,
            margin: '0 auto 24px',
            lineHeight: 1.5,
          }}>
            Mine JUL tokens with SHA-256 proof-of-work.
            Earn compute credits for the Mind Network.
          </div>
        </div>
      )}

      {/* Main Dashboard (visible after identity creation) */}
      {identity.hasIdentity && (
        <>
          <MiningDashboard miner={miner} />
          <ShardStatus
            shardId={identity.shardId}
            connection={connection}
            method={identity.method}
          />
        </>
      )}

      {/* Controls (always visible) */}
      <ControlPanel
        miner={miner}
        hasIdentity={identity.hasIdentity}
        onCreateIdentity={identity.createIdentity}
      />
    </div>
  );
}
