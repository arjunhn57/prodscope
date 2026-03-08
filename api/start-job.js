/**
 * Vercel serverless function: Proxy multipart form-data to backend.
 * POST /api/start-job
 * Accepts: multipart/form-data with apk, email, credentials, goldenPath, painPoints, goals
 * Forwards to CLOUD_RUN_URL/api/start-job and returns response unchanged.
 */

import formidable from 'formidable';
import FormData from 'form-data';
import { readFileSync } from 'fs';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
};

function setCors(res) {
  Object.entries(corsHeaders).forEach(([k, v]) => res.setHeader(k, v));
}

function jsonError(res, status, error) {
  setCors(res);
  res.setHeader('Content-Type', 'application/json');
  res.status(status).json({ error: typeof error === 'string' ? error : (error?.message || 'Unknown error') });
}

export default async function handler(req, res) {
  if (req.method === 'OPTIONS') {
    res.writeHead(204, corsHeaders);
    res.end();
    return;
  }

  if (req.method !== 'POST') {
    return jsonError(res, 405, 'Method not allowed');
  }

  const backendUrl = (process.env.CLOUD_RUN_URL || '').replace(/\/$/, '');
  if (!backendUrl) {
    console.error('[start-job] CLOUD_RUN_URL not configured');
    return jsonError(res, 500, 'Backend URL not configured');
  }

  const targetUrl = `${backendUrl}/api/start-job`;
  console.log('[start-job] Proxying to backend:', targetUrl);

  try {
    const form = formidable({ multiples: false });
    const [fields, files] = await new Promise((resolve, reject) => {
      form.parse(req, (err, fields, files) => {
        if (err) reject(err);
        else resolve([fields, files]);
      });
    });

    const apkFile = files.apk?.[0] || files.apk;
    if (!apkFile?.filepath) {
      console.error('[start-job] No apk file in request');
      return jsonError(res, 400, 'apk file is required');
    }

    const outForm = new FormData();
    outForm.append('apk', readFileSync(apkFile.filepath), {
      filename: apkFile.originalFilename || 'upload.apk',
      contentType: apkFile.mimetype || 'application/vnd.android.package-archive',
    });
    outForm.append('email', Array.isArray(fields.email) ? fields.email[0] : (fields.email || ''));
    outForm.append('credentials', Array.isArray(fields.credentials) ? fields.credentials[0] : (fields.credentials || '{}'));
    outForm.append('goldenPath', Array.isArray(fields.goldenPath) ? fields.goldenPath[0] : (fields.goldenPath || ''));
    outForm.append('painPoints', Array.isArray(fields.painPoints) ? fields.painPoints[0] : (fields.painPoints || ''));
    outForm.append('goals', Array.isArray(fields.goals) ? fields.goals[0] : (fields.goals || ''));

    const response = await fetch(targetUrl, {
      method: 'POST',
      body: outForm,
      headers: outForm.getHeaders(),
    });

    const text = await response.text();
    console.log('[start-job] Backend status:', response.status, 'response length:', text?.length);

    if (!response.ok) {
      console.error('[start-job] Backend error response:', text?.slice(0, 500));
      let errBody;
      try {
        errBody = JSON.parse(text);
      } catch {
        errBody = { error: `Backend returned ${response.status}: ${(text || 'empty').slice(0, 200)}` };
      }
      setCors(res);
      res.setHeader('Content-Type', 'application/json');
      return res.status(response.status).json(errBody);
    }

    setCors(res);
    res.setHeader('Content-Type', 'application/json');
    res.status(response.status).send(text);
  } catch (err) {
    console.error('[start-job] Proxy error:', err.message);
    return jsonError(res, 500, err.message || 'Failed to connect to backend');
  }
}
