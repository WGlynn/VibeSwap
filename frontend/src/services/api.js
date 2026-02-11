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

// ============ WebSocket Client ============
export class PriceWebSocket {
  constructor(onMessage) {
    this.onMessage = onMessage;
    this.ws = null;
    this.reconnectAttempts = 0;
    this.maxReconnectAttempts = 5;
  }

  connect() {
    const wsUrl = import.meta.env.VITE_WS_URL ||
      `${window.location.protocol === 'https:' ? 'wss:' : 'ws:'}//${window.location.host}/ws`;

    this.ws = new WebSocket(wsUrl);

    this.ws.onopen = () => {
      this.reconnectAttempts = 0;
      this.ws.send(JSON.stringify({ type: 'subscribe', channel: 'prices' }));
    };

    this.ws.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data);
        this.onMessage(data);
      } catch {
        // ignore parse errors
      }
    };

    this.ws.onclose = () => {
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

  disconnect() {
    this.maxReconnectAttempts = 0;
    if (this.ws) {
      this.ws.close();
    }
  }
}
