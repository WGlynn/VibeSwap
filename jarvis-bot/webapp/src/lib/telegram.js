// ============ Telegram WebApp SDK Helpers ============

const tg = window.Telegram?.WebApp;

export function getTelegram() {
  return tg;
}

export function getTelegramUser() {
  return tg?.initDataUnsafe?.user || null;
}

export function getTelegramUserId() {
  return tg?.initDataUnsafe?.user?.id?.toString() || null;
}

export function getTelegramInitData() {
  return tg?.initData || '';
}

export function getThemeParams() {
  return tg?.themeParams || {};
}

export function getColorScheme() {
  return tg?.colorScheme || 'dark';
}

/**
 * Get a Telegram theme color with fallback.
 */
export function themeColor(key, fallback) {
  const params = getThemeParams();
  return params[key] || fallback;
}

/**
 * Show a native Telegram alert.
 */
export function showAlert(message) {
  if (tg?.showAlert) {
    tg.showAlert(message);
  } else {
    alert(message);
  }
}

/**
 * Close the Mini App.
 */
export function closeApp() {
  if (tg?.close) {
    tg.close();
  }
}

/**
 * Send data back to the bot when closing.
 */
export function sendData(data) {
  if (tg?.sendData) {
    tg.sendData(typeof data === 'string' ? data : JSON.stringify(data));
  }
}
