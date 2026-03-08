import http from 'node:http';
import { createReadStream, promises as fs } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';

const ROOT = process.cwd();
const BACKEND_BASE = (process.env.BACKEND_BASE || 'http://34.10.240.173:8080').replace(/\/$/, '');
const PORT = Number(process.env.PORT || 3000);
const PROXY_TIMEOUT_MS = Number(process.env.PROXY_TIMEOUT_MS || 8000);

const MIME_TYPES = {
  '.css': 'text/css; charset=utf-8',
  '.html': 'text/html; charset=utf-8',
  '.ico': 'image/x-icon',
  '.jpeg': 'image/jpeg',
  '.jpg': 'image/jpeg',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.map': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.txt': 'text/plain; charset=utf-8',
};

const HOP_BY_HOP_HEADERS = new Set([
  'connection',
  'content-length',
  'host',
  'keep-alive',
  'origin',
  'proxy-authenticate',
  'proxy-authorization',
  'referer',
  'te',
  'trailer',
  'transfer-encoding',
  'upgrade',
]);

function writeJson(res, status, payload) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(payload));
}

function getForwardHeaders(headers) {
  const forwarded = {};
  for (const [name, value] of Object.entries(headers)) {
    if (value == null) continue;
    if (HOP_BY_HOP_HEADERS.has(name.toLowerCase())) continue;
    forwarded[name] = value;
  }
  return forwarded;
}

function copyUpstreamHeaders(upstream, res) {
  for (const [name, value] of upstream.headers) {
    if (HOP_BY_HOP_HEADERS.has(name.toLowerCase())) continue;
    res.setHeader(name, value);
  }
}

async function proxyRequest(req, res, targetPath) {
  const targetUrl = `${BACKEND_BASE}${targetPath}`;
  const init = {
    method: req.method,
    headers: getForwardHeaders(req.headers),
    signal: AbortSignal.timeout(PROXY_TIMEOUT_MS),
  };

  if (req.method !== 'GET' && req.method !== 'HEAD') {
    init.body = req;
    init.duplex = 'half';
  }

  try {
    const upstream = await fetch(targetUrl, init);
    copyUpstreamHeaders(upstream, res);
    res.statusCode = upstream.status;

    if (req.method === 'HEAD' || !upstream.body) {
      res.end();
      return;
    }

    await pipeline(Readable.fromWeb(upstream.body), res);
  } catch (error) {
    console.error(`[dev-server] Proxy failed for ${targetPath}:`, error.message);
    writeJson(res, 502, {
      error: `VM backend is unreachable at ${targetUrl}`,
      details: error.message,
    });
  }
}

async function serveStatic(req, res, pathname) {
  if (pathname === '/favicon.ico') {
    res.writeHead(204);
    res.end();
    return;
  }

  const requestedPath = pathname === '/' ? '/app.html' : pathname;
  const resolvedPath = path.resolve(ROOT, `.${requestedPath}`);

  if (!resolvedPath.startsWith(ROOT)) {
    writeJson(res, 403, { error: 'Forbidden' });
    return;
  }

  let filePath = resolvedPath;
  let stats;

  try {
    stats = await fs.stat(filePath);
  } catch {
    writeJson(res, 404, { error: `File not found: ${requestedPath}` });
    return;
  }

  if (stats.isDirectory()) {
    filePath = path.join(filePath, 'index.html');
    try {
      stats = await fs.stat(filePath);
    } catch {
      writeJson(res, 404, { error: `File not found: ${requestedPath}` });
      return;
    }
  }

  const ext = path.extname(filePath).toLowerCase();
  res.writeHead(200, {
    'Cache-Control': ext === '.html' ? 'no-store' : 'no-cache',
    'Content-Type': MIME_TYPES[ext] || 'application/octet-stream',
  });

  await pipeline(createReadStream(filePath), res);
}

export function createServer() {
  return http.createServer(async (req, res) => {
    const url = new URL(req.url || '/', `http://${req.headers.host || 'localhost'}`);
    const { pathname } = url;

    if (pathname === '/health' && req.method === 'GET') {
      writeJson(res, 200, { status: 'ok', backend: BACKEND_BASE });
      return;
    }

    if (pathname === '/api/start-job' && req.method === 'POST') {
      await proxyRequest(req, res, '/api/start-job');
      return;
    }

    if (pathname.startsWith('/api/job-status/') && req.method === 'GET') {
      await proxyRequest(req, res, pathname);
      return;
    }

    await serveStatic(req, res, pathname);
  });
}

const entryPath = fileURLToPath(import.meta.url);

if (process.argv[1] === entryPath) {
  const server = createServer();
  server.listen(PORT, '0.0.0.0', () => {
    console.log(`ProdScope local build server running at http://localhost:${PORT}/app.html`);
    console.log(`Proxying API requests to ${BACKEND_BASE}`);
  });
}
