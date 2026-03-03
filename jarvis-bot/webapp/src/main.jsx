import React from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';

// Initialize Telegram WebApp
const tg = window.Telegram?.WebApp;
if (tg) {
  tg.ready();
  tg.expand();
}

createRoot(document.getElementById('root')).render(<App />);
