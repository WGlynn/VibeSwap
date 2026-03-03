// ============ Control Panel — Start/Stop, Thread Slider ============

import React from 'react';
import { themeColor } from '../lib/telegram';

export default function ControlPanel({ miner, hasIdentity, onCreateIdentity }) {
  const {
    mining, threads, setThreads, maxThreads,
    startMining, stopMining, error, log,
  } = miner;

  return (
    <div>
      {/* Thread Control */}
      {hasIdentity && (
        <div style={{
          background: themeColor('secondary_bg_color', '#1e1e2e'),
          borderRadius: 12,
          padding: '14px 16px',
          marginBottom: 12,
        }}>
          <div style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            marginBottom: 8,
          }}>
            <span style={{
              fontSize: 13,
              color: themeColor('text_color', '#ffffff'),
              fontWeight: 600,
            }}>Threads</span>
            <span style={{
              fontSize: 13,
              color: themeColor('hint_color', '#8888aa'),
            }}>{threads} / {maxThreads}</span>
          </div>

          <input
            type="range"
            min={1}
            max={maxThreads}
            value={threads}
            onChange={e => setThreads(parseInt(e.target.value))}
            disabled={mining}
            style={{
              width: '100%',
              accentColor: themeColor('button_color', '#5b7fff'),
            }}
          />
        </div>
      )}

      {/* Error Display */}
      {error && (
        <div style={{
          background: '#2d1111',
          border: '1px solid #ef4444',
          borderRadius: 12,
          padding: '10px 14px',
          marginBottom: 12,
          fontSize: 12,
          color: '#ef4444',
        }}>{error}</div>
      )}

      {/* Main Button */}
      <button
        onClick={!hasIdentity ? onCreateIdentity : mining ? stopMining : startMining}
        style={{
          width: '100%',
          padding: '16px 0',
          borderRadius: 12,
          border: 'none',
          fontSize: 16,
          fontWeight: 700,
          cursor: 'pointer',
          color: themeColor('button_text_color', '#ffffff'),
          background: mining
            ? '#ef4444'
            : themeColor('button_color', '#5b7fff'),
          marginBottom: 12,
          transition: 'background 0.2s',
        }}
      >
        {!hasIdentity ? 'Create Shard Identity' : mining ? 'Stop Mining' : 'Start Mining'}
      </button>

      {/* Mining Log */}
      {log.length > 0 && (
        <div style={{
          background: themeColor('secondary_bg_color', '#1e1e2e'),
          borderRadius: 12,
          padding: '10px 14px',
          maxHeight: 160,
          overflowY: 'auto',
        }}>
          <div style={{
            fontSize: 11,
            color: themeColor('hint_color', '#8888aa'),
            textTransform: 'uppercase',
            letterSpacing: 1,
            marginBottom: 6,
          }}>Log</div>
          {log.map((entry, i) => (
            <div key={i} style={{
              fontSize: 11,
              fontFamily: 'monospace',
              color: themeColor('text_color', '#ccccdd'),
              padding: '2px 0',
              borderBottom: i < log.length - 1 ? `1px solid ${themeColor('bg_color', '#0d0d1a')}` : 'none',
            }}>
              <span style={{ color: themeColor('hint_color', '#666688'), marginRight: 6 }}>
                {entry.time}
              </span>
              {entry.msg}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
