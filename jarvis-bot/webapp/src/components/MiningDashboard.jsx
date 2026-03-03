// ============ Mining Dashboard — Hashrate, JUL Balance, Proofs, Epoch ============

import React from 'react';
import { themeColor } from '../lib/telegram';

function formatHashrate(rate) {
  if (rate >= 1_000_000) return `${(rate / 1_000_000).toFixed(1)} MH/s`;
  if (rate >= 1_000) return `${(rate / 1_000).toFixed(1)} KH/s`;
  return `${rate} H/s`;
}

function StatCard({ label, value, sub }) {
  return (
    <div style={{
      background: themeColor('secondary_bg_color', '#1e1e2e'),
      borderRadius: 12,
      padding: '14px 16px',
      flex: '1 1 45%',
      minWidth: 120,
    }}>
      <div style={{
        fontSize: 11,
        color: themeColor('hint_color', '#8888aa'),
        textTransform: 'uppercase',
        letterSpacing: 1,
        marginBottom: 4,
      }}>{label}</div>
      <div style={{
        fontSize: 22,
        fontWeight: 700,
        color: themeColor('text_color', '#ffffff'),
      }}>{value}</div>
      {sub && <div style={{
        fontSize: 11,
        color: themeColor('hint_color', '#8888aa'),
        marginTop: 2,
      }}>{sub}</div>}
    </div>
  );
}

export default function MiningDashboard({ miner }) {
  const {
    hashrate, julMined, proofsAccepted, proofsRejected,
    difficulty, epoch, reward, epochProgress,
  } = miner;

  // Parse epoch progress for bar
  const [epochCurrent, epochTotal] = (epochProgress || '0/100').split('/').map(Number);
  const epochPct = epochTotal > 0 ? (epochCurrent / epochTotal) * 100 : 0;

  return (
    <div>
      {/* Stats Grid */}
      <div style={{
        display: 'flex',
        flexWrap: 'wrap',
        gap: 8,
        marginBottom: 12,
      }}>
        <StatCard
          label="Hashrate"
          value={formatHashrate(hashrate)}
        />
        <StatCard
          label="JUL Mined"
          value={julMined.toFixed(2)}
          sub={`= ${(julMined * 1000).toFixed(0)} API tokens`}
        />
        <StatCard
          label="Proofs"
          value={proofsAccepted}
          sub={proofsRejected > 0 ? `${proofsRejected} rejected` : null}
        />
        <StatCard
          label="Reward"
          value={`${reward.toFixed(2)} JUL`}
          sub="per proof"
        />
      </div>

      {/* Epoch Progress */}
      <div style={{
        background: themeColor('secondary_bg_color', '#1e1e2e'),
        borderRadius: 12,
        padding: '12px 16px',
        marginBottom: 12,
      }}>
        <div style={{
          display: 'flex',
          justifyContent: 'space-between',
          fontSize: 12,
          color: themeColor('hint_color', '#8888aa'),
          marginBottom: 6,
        }}>
          <span>Epoch {epoch}</span>
          <span>{epochProgress} proofs</span>
        </div>
        <div style={{
          background: themeColor('bg_color', '#0d0d1a'),
          borderRadius: 6,
          height: 8,
          overflow: 'hidden',
        }}>
          <div style={{
            background: themeColor('button_color', '#5b7fff'),
            height: '100%',
            width: `${epochPct}%`,
            borderRadius: 6,
            transition: 'width 0.3s ease',
          }} />
        </div>
        <div style={{
          fontSize: 11,
          color: themeColor('hint_color', '#8888aa'),
          marginTop: 4,
        }}>
          Difficulty: {difficulty} bits (~{Math.pow(2, difficulty).toLocaleString()} hashes avg)
        </div>
      </div>
    </div>
  );
}
