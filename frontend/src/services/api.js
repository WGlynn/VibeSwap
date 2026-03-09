// ============ API Client Service ============
// Centralized API client for backend communication

const API_BASE = import.meta.env.VITE_API_URL || '/api';

class ApiClient {
  constructor(baseUrl) {
    this.baseUrl = baseUrl;
  }

  async request(path, options = {}) {
    const url = `${this.baseUrl}${path}`;
    const config = {
      headers: {
        'Content-Type': 'application/json',
        ...options.headers,
      },
      ...options,
    };

    const response = await fetch(url, config);

    if (!response.ok) {
      const error = await response.json().catch(() => ({ message: response.statusText }));
      throw new Error(error.message || `API error: ${response.status}`);
    }

    return response.json();
  }

  // Price endpoints
  async getPrices() {
    return this.request('/prices');
  }

  async getPrice(symbol) {
    return this.request(`/prices/${symbol}`);
  }

  async getPairPrice(base, quote) {
    return this.request(`/prices/pairs/${base}/${quote}`);
  }

  // Token endpoints
  async getTokens(chainId) {
    if (chainId) {
      return this.request(`/tokens/${chainId}`);
    }
    return this.request('/tokens');
  }

  // Chain endpoints
  async getChains() {
    return this.request('/chains');
  }

  // Health
  async getHealth() {
    return this.request('/health');
  }
}

export const api = new ApiClient(API_BASE);

// ============ WebSocket Client (Multi-Channel) ============
// Supports channels: prices, batch, activity
// Subscribe/unsubscribe dynamically. Register handlers per message type.
export class VibeWebSocket {
  constructor() {
    this.ws = null;
    this.reconnectAttempts = 0;
    this.maxReconnectAttempts = 5;
    this.handlers = new Map(); // type -> Set<callback>
    this.pendingSubscriptions = new Set();
    this.activeSubscriptions = new Set();
  }

  connect(channels = ['prices']) {
    for (const ch of channels) this.pendingSubscriptions.add(ch);

    const wsUrl = import.meta.env.VITE_WS_URL ||
      `${window.location.protocol === 'https:' ? 'wss:' : 'ws:'}//${window.location.host}/ws`;

    this.ws = new WebSocket(wsUrl);

    this.ws.onopen = () => {
      this.reconnectAttempts = 0;
      // Subscribe to all pending channels
      if (this.pendingSubscriptions.size > 0) {
        this.ws.send(JSON.stringify({
          type: 'subscribe',
          channels: [...this.pendingSubscriptions],
        }));
        for (const ch of this.pendingSubscriptions) this.activeSubscriptions.add(ch);
        this.pendingSubscriptions.clear();
      }
    };

    this.ws.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data);
        const callbacks = this.handlers.get(data.type);
        if (callbacks) {
          for (const cb of callbacks) cb(data);
        }
        // Also fire wildcard handlers
        const wildcards = this.handlers.get('*');
        if (wildcards) {
          for (const cb of wildcards) cb(data);
        }
      } catch {
        // ignore parse errors
      }
    };

    this.ws.onclose = () => {
      // Move active back to pending for reconnect
      for (const ch of this.activeSubscriptions) this.pendingSubscriptions.add(ch);
      this.activeSubscriptions.clear();

      if (this.reconnectAttempts < this.maxReconnectAttempts) {
        const delay = Math.min(1000 * Math.pow(2, this.reconnectAttempts), 30000);
        this.reconnectAttempts++;
        setTimeout(() => this.connect(), delay);
      }
    };

    this.ws.onerror = () => {
      // onclose will handle reconnection
    };
  }

  subscribe(channels) {
    const list = Array.isArray(channels) ? channels : [channels];
    if (this.ws?.readyState === 1) {
      this.ws.send(JSON.stringify({ type: 'subscribe', channels: list }));
      for (const ch of list) this.activeSubscriptions.add(ch);
    } else {
      for (const ch of list) this.pendingSubscriptions.add(ch);
    }
  }

  unsubscribe(channels) {
    const list = Array.isArray(channels) ? channels : [channels];
    if (this.ws?.readyState === 1) {
      this.ws.send(JSON.stringify({ type: 'unsubscribe', channels: list }));
    }
    for (const ch of list) {
      this.activeSubscriptions.delete(ch);
      this.pendingSubscriptions.delete(ch);
    }
  }

  on(type, callback) {
    if (!this.handlers.has(type)) this.handlers.set(type, new Set());
    this.handlers.get(type).add(callback);
    return () => this.handlers.get(type)?.delete(callback); // returns unsubscribe fn
  }

  off(type, callback) {
    this.handlers.get(type)?.delete(callback);
  }

  send(msg) {
    if (this.ws?.readyState === 1) {
      this.ws.send(typeof msg === 'string' ? msg : JSON.stringify(msg));
    }
  }

  disconnect() {
    this.maxReconnectAttempts = 0;
    if (this.ws) {
      this.ws.close();
    }
    this.handlers.clear();
    this.activeSubscriptions.clear();
    this.pendingSubscriptions.clear();
  }
}

// ============ Backward-Compatible PriceWebSocket ============
// Wraps VibeWebSocket for existing usePriceFeed consumers
export class PriceWebSocket {
  constructor(onMessage) {
    this.vws = new VibeWebSocket();
    this.vws.on('*', onMessage);
  }

  connect() {
    this.vws.connect(['prices']);
  }

  disconnect() {
    this.vws.disconnect();
  }
}

// ============ Shared WebSocket Singleton ============
// All hooks share one connection to avoid multiple WS per page
let _sharedWS = null;

export function getSharedWebSocket() {
  if (!_sharedWS) {
    _sharedWS = new VibeWebSocket();
    _sharedWS.connect(['prices', 'batch', 'activity']);
  }
  return _sharedWS;
}
