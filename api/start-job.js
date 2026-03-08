/**
 * Vercel serverless function: Proxy multipart form-data to backend.
 * POST /api/start-job
 * Accepts: multipart/form-data with apk, email, credentials, goldenPath, painPoints, goals
 * Forwards to CLOUD_RUN_URL/api/start-job and returns response unchanged.
 */

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
};

function setCors(res) {
  Object.entries(corsHeaders).forEach(([k, v]) => res.setHeader(k, v));
}

export default async function handler(req, res) {
  if (req.method === 'OPTIONS') {
    res.writeHead(204, corsHeaders);
    res.end();
    return;
  }

  if (req.method !== 'POST') {
    res.setHeader('Content-Type', 'application/json');
    setCors(res);
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const backendUrl = process.env.CLOUD_RUN_URL?.replace(/\/$/, '');
  if (!backendUrl) {
    res.setHeader('Content-Type', 'application/json');
    setCors(res);
    return res.status(500).json({ error: 'Backend URL not configured' });
  }

  const contentType = req.headers['content-type'];
  if (!contentType || !contentType.includes('multipart/form-data')) {
    res.setHeader('Content-Type', 'application/json');
    setCors(res);
    return res.status(400).json({ error: 'Content-Type must be multipart/form-data' });
  }

  try {
    const body = await new Promise((resolve, reject) => {
      const chunks = [];
      req.on('data', (chunk) => chunks.push(chunk));
      req.on('end', () => resolve(Buffer.concat(chunks)));
      req.on('error', reject);
    });

    const response = await fetch(`${backendUrl}/api/start-job`, {
      method: 'POST',
      headers: { 'Content-Type': contentType },
      body,
    });

    const text = await response.text();
    setCors(res);
    res.setHeader('Content-Type', 'application/json');
    res.status(response.status).send(text);
  } catch (err) {
    console.error('start-job proxy error:', err.message);
    res.setHeader('Content-Type', 'application/json');
    setCors(res);
    res.status(500).json({
      error: err.message || 'Failed to connect to backend',
    });
  }
}
