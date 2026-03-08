/**
 * Vercel serverless function: Poll job status from Cloud Run.
 * GET /api/job-status?jobId=xxx
 * Returns: status object from Cloud Run
 */

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
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

  if (req.method !== 'GET') {
    return jsonRes(res, 405, { error: 'Method not allowed' });
  }

  const cloudRunUrl = process.env.CLOUD_RUN_URL?.replace(/\/$/, '');
  if (!cloudRunUrl) {
    return jsonRes(res, 500, { error: 'Cloud Run URL not configured' });
  }

  const jobId = req.query.jobId;
  if (!jobId || typeof jobId !== 'string') {
    return jsonRes(res, 400, { error: 'jobId query parameter is required' });
  }

  try {
    const response = await fetch(`${cloudRunUrl}/api/job-status/${encodeURIComponent(jobId)}`, {
      method: 'GET',
      headers: { 'Content-Type': 'application/json' },
    });

    let data;
    try {
      data = await response.json();
    } catch {
      return jsonRes(res, 502, { error: 'Invalid response from backend' });
    }

    if (!response.ok) {
      return jsonRes(res, response.status, {
        error: data.error || data.message || 'Failed to fetch job status',
      });
    }

    return jsonRes(res, 200, data);
  } catch (err) {
    console.error('job-status error:', err.message);
    return jsonRes(res, 500, {
      error: err.message || 'Failed to connect to analysis service',
    });
  }
}
