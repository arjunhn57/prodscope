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

    // Prevent cached polling responses for job-status requests
    if (lowerName === 'if-none-match') continue;
    if (lowerName === 'if-modified-since') continue;

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
  const isStartStatus = targetPath.startsWith('/api/job-status/');
  const isJobStatus = targetPath.startsWith('/api/job-status/');

  return new Promise((resolve) => {
    let settled = false;
    let attempt = 0;
    const maxAttempts = isJobStatus ? 3 : 1;

    const finish = () => {
      if (settled) return;
      settled = true;
      resolve();
    };

    const makeAttempt = () => {
      attempt += 1;

      if (isStartJob || isJobStatus) {
        console.log(
          `[dev-server] Proxying ${req.method} ${targetPath} -> ${targetUrl} (attempt ${attempt}/${maxAttempts})`
        );
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
          if (isStartJob || isJobStatus) {
            console.log(
              `[dev-server] Upstream ${targetPath} responded with ${upstreamRes.statusCode || 502}`
            );
          }

          copyUpstreamHeaders(upstreamRes, res);

          if (isJobStatus) {
            res.setHeader('Cache-Control', 'no-store');
            res.removeHeader('etag');
          }

          res.writeHead(upstreamRes.statusCode || 502, upstreamRes.statusMessage);
          upstreamRes.pipe(res);

          upstreamRes.on('error', (error) => {
            if (
              isJobStatus &&
              !res.headersSent &&
              attempt < maxAttempts &&
              /ECONNRESET|socket hang up/i.test(error.message)
            ) {
              console.warn(
                `[dev-server] Job-status upstream response error for ${targetPath}: ${error.message}. Retrying...`
              );
              setTimeout(makeAttempt, 500);
              return;
            }

            if (!settled) {
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
            }
          });

          res.on('finish', finish);
          res.on('close', finish);
        }
      );

      const timeoutMs = isJobStatus ? Math.max(PROXY_TIMEOUT_MS, 120000) : PROXY_TIMEOUT_MS;

      upstreamReq.setTimeout(timeoutMs, () => {
        upstreamReq.destroy(new Error(`Proxy request timed out after ${timeoutMs}ms`));
      });

      upstreamReq.on('error', (error) => {
        const retryable =
          isJobStatus &&
          attempt < maxAttempts &&
          /ECONNRESET|socket hang up/i.test(error.message);

        if (retryable) {
          console.warn(
            `[dev-server] Proxy failed for ${targetPath}: ${error.message}. Retrying (${attempt}/${maxAttempts})...`
          );
          setTimeout(makeAttempt, 500);
          return;
        }

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
      });

      req.on('error', (error) => {
        if (settled) return;
        settled = true;
        console.error(`[dev-server] Client request failed for ${targetPath}:`, error.message);

        if (!res.headersSent) {
          writeJson(res, 502, {
            error: `Client request failed before reaching backend`,
            details: error.message,
          });
        } else {
          res.destroy(error);
        }

        resolve();
      });

      req.on('aborted', () => {
        upstreamReq.destroy(new Error('Client request aborted'));
        finish();
      });

      if (attempt === 1) {
        req.pipe(upstreamReq);
      } else {
        upstreamReq.end();
      }
    };

    makeAttempt();
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

    if (pathname.startsWith('/api/job-screenshot/') && req.method === 'GET') {
      await proxyRequest(req, res, pathname);
      return;
    }

    if (pathname.startsWith('/api/job-report/') && req.method === 'GET') {
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
