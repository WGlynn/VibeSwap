// ============================================================
// clipboard.js — Clipboard utilities
// Share URLs, copy formatted data, export helpers
// ============================================================

/**
 * Copy text to clipboard with fallback
 */
export async function copyToClipboard(text) {
  try {
    await navigator.clipboard.writeText(text)
    return true
  } catch {
    const el = document.createElement('textarea')
    el.value = text
    el.style.position = 'fixed'
    el.style.opacity = '0'
    document.body.appendChild(el)
    el.select()
    const success = document.execCommand('copy')
    document.body.removeChild(el)
    return success
  }
}

/**
 * Generate a share URL for the current page
 */
export function getShareUrl(path) {
  const base = window.location.origin
  return `${base}${path || window.location.pathname}`
}

/**
 * Copy a transaction hash with explorer link
 */
export function formatTxForClipboard(hash, explorer = 'https://etherscan.io') {
  return `${hash}\n${explorer}/tx/${hash}`
}

/**
 * Export data as CSV string
 */
export function toCSV(headers, rows) {
  const headerLine = headers.join(',')
  const dataLines = rows.map((row) =>
    row.map((cell) => {
      const str = String(cell ?? '')
      return str.includes(',') || str.includes('"') ? `"${str.replace(/"/g, '""')}"` : str
    }).join(',')
  )
  return [headerLine, ...dataLines].join('\n')
}

/**
 * Trigger a file download from string content
 */
export function downloadFile(content, filename, mimeType = 'text/csv') {
  const blob = new Blob([content], { type: mimeType })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
  URL.revokeObjectURL(url)
}
