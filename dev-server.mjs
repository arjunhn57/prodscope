import http from 'node:http';
import https from 'node:https';
import { createReadStream, promises as fs } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
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
  'keep-alive',
  'proxy-authenticate',
  'proxy-authorization',
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
    const lowerName = name.toLowerCase();
    if (lowerName === 'host') continue;
    if (HOP_BY_HOP_HEADERS.has(lowerName)) continue;
    forwarded[name] = value;
  }
  return forwarded;
}

function copyUpstreamHeaders(upstream, res) {
  for (const [name, value] of Object.entries(upstream.headers)) {
    if (value == null) continue;
    if (HOP_BY_HOP_HEADERS.has(name.toLowerCase())) continue;
    res.setHeader(name, value);
  }
}

function proxyRequest(req, res, targetPath) {
  const targetUrl = `${BACKEND_BASE}${targetPath}`;
  const target = new URL(targetUrl);
  const transport = target.protocol === 'https:' ? https : http;
  const isStartJob = targetPath === '/api/start-job';

  return new Promise((resolve) => {
    let settled = false;

    const finish = () => {
      if (settled) return;
      settled = true;
      resolve();
    };

    const failProxy = (error) => {
      if (settled) return;
      settled = true;
      console.error(`[dev-server] Proxy failed for ${targetPath}:`, error.message);

      if (!res.headersSent) {
        writeJson(res, 502, {
          error: `VM backend is unreachable at ${targetUrl}`,
          details: error.message,
        });
      } else {
        res.destroy(error);
      }

      resolve();
    };

    if (isStartJob) {
      console.log(`[dev-server] Proxying ${req.method} ${targetPath} -> ${targetUrl}`);
    }

    const upstreamReq = transport.request(
      {
        protocol: target.protocol,
        hostname: target.hostname,
        port: target.port || (target.protocol === 'https:' ? 443 : 80),
        method: req.method,
        path: `${target.pathname}${target.search}`,
        headers: getForwardHeaders(req.headers),
      },
      (upstreamRes) => {
        if (isStartJob) {
          console.log(`[dev-server] Upstream ${targetPath} responded with ${upstreamRes.statusCode || 502}`);
        }

        copyUpstreamHeaders(upstreamRes, res);
        res.writeHead(upstreamRes.statusCode || 502, upstreamRes.statusMessage);
        upstreamRes.pipe(res);

        upstreamRes.on('error', failProxy);
        res.on('finish', finish);
        res.on('close', finish);
      }
    );

    upstreamReq.setTimeout(PROXY_TIMEOUT_MS, () => {
      upstreamReq.destroy(new Error(`Proxy request timed out after ${PROXY_TIMEOUT_MS}ms`));
    });

    upstreamReq.on('error', failProxy);
    req.on('error', failProxy);
    req.on('aborted', () => {
      upstreamReq.destroy(new Error('Client request aborted'));
      finish();
    });

    req.pipe(upstreamReq);
  });
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
