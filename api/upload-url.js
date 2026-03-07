/**
 * Vercel serverless function: Generate signed upload URL for Google Cloud Storage.
 * POST /api/upload-url
 * Body: { fileName, fileSize }
 * Returns: { uploadUrl, fileKey }
 */

import { Storage } from '@google-cloud/storage';
import { randomUUID } from 'crypto';

// CORS headers for all responses
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
  // Handle CORS preflight
  if (req.method === 'OPTIONS') {
    res.writeHead(204, corsHeaders);
    res.end();
    return;
  }

  if (req.method !== 'POST') {
    return jsonRes(res, 405, { error: 'Method not allowed' });
  }

  const gcsKeyB64 = process.env.GCS_SERVICE_ACCOUNT_KEY;
  if (!gcsKeyB64) {
    return jsonRes(res, 500, { error: 'GCS service account not configured' });
  }

  let body;
  try {
    body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body || {};
  } catch {
    return jsonRes(res, 400, { error: 'Invalid JSON body' });
  }

  const { fileName, fileSize } = body;
  if (!fileName || typeof fileName !== 'string') {
    return jsonRes(res, 400, { error: 'fileName is required' });
  }

  try {
    const keyJson = Buffer.from(gcsKeyB64, 'base64').toString('utf-8');
    const credentials = JSON.parse(keyJson);

    const storage = new Storage({ credentials });
    const bucket = storage.bucket('prodscope-apk-uploads');

    const uuid = randomUUID();
    const fileKey = `uploads/${uuid}/${fileName}`;
    const file = bucket.file(fileKey);

    const [signedUrl] = await file.getSignedUrl({
      version: 'v4',
      action: 'write',
      expires: Date.now() + 15 * 60 * 1000,
      contentType: 'application/vnd.android.package-archive',
    });

    return jsonRes(res, 200, { uploadUrl: signedUrl, fileKey });
  } catch (err) {
    console.error('upload-url error:', err.message);
    return jsonRes(res, 500, {
      error: err.message || 'Failed to generate upload URL',
    });
  }
}
