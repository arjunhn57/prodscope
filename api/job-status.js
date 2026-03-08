/**
 * Vercel serverless function: Proxy job status requests to backend.
 * GET /api/job-status?jobId=xxx
 * Proxies to CLOUD_RUN_URL/api/job-status/:jobId
 */

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
};

function setCors(res) {
  Object.entries(corsHeaders).forEach(([k, v]) => res.setHeader(k, v));
}

function jsonRes(res, status, data) {
  setCors(res);
  res.setHeader('Content-Type', 'application/json');
  res.status(status).json(data);
}

export default async function handler(req, res) {
  if (req.method === 'OPTIONS') {
    res.writeHead(204, corsHeaders);
    res.end();
    return;
  }

  if (req.method !== 'GET') {
    return jsonRes(res, 405, { error: 'Method not allowed' });
  }

  const cloudRunUrl = (process.env.CLOUD_RUN_URL || '').replace(/\/$/, '');
  if (!cloudRunUrl) {
    console.error('[job-status] CLOUD_RUN_URL not configured');
    return jsonRes(res, 500, { error: 'Backend URL not configured' });
  }

  const jobId = req.query.jobId;
  if (!jobId || typeof jobId !== 'string' || !jobId.trim()) {
    return jsonRes(res, 400, { error: 'jobId query parameter is required' });
  }

  const targetUrl = `${cloudRunUrl}/api/job-status/${encodeURIComponent(jobId)}`;
  console.log('[job-status] Proxying to backend:', targetUrl);

  try {
    const response = await fetch(targetUrl, {
      method: 'GET',
      headers: { 'Content-Type': 'application/json' },
    });

    const text = await response.text();
    console.log('[job-status] Backend status:', response.status, 'response length:', text?.length);

    let data;
    try {
      data = JSON.parse(text);
    } catch {
      console.error('[job-status] Backend returned non-JSON. Response text:', text?.slice(0, 500));
      return jsonRes(res, 502, {
        error: `Backend returned invalid JSON (status ${response.status}). ${(text || 'empty').slice(0, 150)}`,
      });
    }

    if (!response.ok) {
      return jsonRes(res, response.status, {
        error: data.error || data.message || 'Failed to fetch job status',
      });
    }

    return jsonRes(res, 200, data);
  } catch (err) {
    console.error('[job-status] Proxy error:', err.message);
    return jsonRes(res, 500, {
      error: err.message || 'Failed to connect to backend',
    });
  }
}
