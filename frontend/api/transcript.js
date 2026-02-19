// Vercel serverless proxy: Google Apps Script → Fly.io
// Google can't resolve fly.dev, but can resolve vercel.app
// This endpoint forwards transcript webhooks to Jarvis on Fly

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'POST only' });
  }

  try {
    const response = await fetch('https://jarvis-vibeswap.fly.dev/transcript', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(req.body),
    });

    const data = await response.json();
    res.status(response.status).json(data);
  } catch (err) {
    res.status(502).json({ error: 'Failed to reach Jarvis', detail: err.message });
  }
}
