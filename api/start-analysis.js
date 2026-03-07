/**
 * Vercel serverless function: Trigger Cloud Run backend to start analysis.
 * POST /api/start-analysis
 * Body: { fileKey, email, credentials, goldenPath, painPoints, goals }
 * Returns: { jobId, status }
 */

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
};

function jsonRes(res, status, data) {
  res.setHeader('Content-Type', 'application/json');
  Object.entries(corsHeaders).forEach(([k, v]) => res.setHeader(k, v));
  res.status(status).json(data);
}

export default async function handler(req, res) {
  if (req.method === 'OPTIONS') {
    res.writeHead(204, corsHeaders);
    res.end();
    return;
  }

  if (req.method !== 'POST') {
    return jsonRes(res, 405, { error: 'Method not allowed' });
  }

  const cloudRunUrl = process.env.CLOUD_RUN_URL?.replace(/\/$/, '');
  if (!cloudRunUrl) {
    return jsonRes(res, 500, { error: 'Cloud Run URL not configured' });
  }

  let body;
  try {
    body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body || {};
  } catch {
    return jsonRes(res, 400, { error: 'Invalid JSON body' });
  }

  const { fileKey, email, credentials, goldenPath, painPoints, goals } = body;

  if (!fileKey || typeof fileKey !== 'string') {
    return jsonRes(res, 400, { error: 'fileKey is required' });
  }
  if (!email || typeof email !== 'string') {
    return jsonRes(res, 400, { error: 'email is required' });
  }

  const gcsUrl = `gs://prodscope-apk-uploads/${fileKey}`;

  const payload = {
    gcsUrl,
    email: email.trim(),
    credentials: credentials || {},
    goldenPath: goldenPath || '',
    painPoints: painPoints || '',
    goals: goals || '',
  };

  try {
    const response = await fetch(`${cloudRunUrl}/api/start-job`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });

    const data = await response.json();

    if (!response.ok) {
      return jsonRes(res, response.status, {
        error: data.error || data.message || 'Failed to start analysis',
      });
    }

    return jsonRes(res, 200, {
      jobId: data.jobId,
      status: data.status || 'started',
    });
  } catch (err) {
    console.error('start-analysis error:', err.message);
    return jsonRes(res, 500, {
      error: err.message || 'Failed to connect to analysis service',
    });
  }
}
