/**
 * Static file server for packages/web. Unknown paths return 404.html with status 404
 * (same behavior as Cloudflare Pages). Python's http.server does not do this.
 */
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname);
const PORT = Number(process.env.PORT) || 56790;

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.webp': 'image/webp',
  '.json': 'application/json; charset=utf-8',
};

function safeJoin(root, pathname) {
  const decoded = decodeURIComponent(pathname.split('?')[0]);
  const segments = decoded.split('/').filter((s) => s && s !== '.');
  if (segments.some((s) => s === '..')) {
    return null;
  }
  return path.join(root, ...segments);
}

function send404(res) {
  const fallback = path.join(ROOT, '404.html');
  fs.readFile(fallback, 'utf8', (err, html) => {
    if (err) {
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end('Not found');
      return;
    }
    res.writeHead(404, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(html);
  });
}

http
  .createServer((req, res) => {
    try {
      const url = new URL(req.url || '/', `http://${req.headers.host || 'localhost'}`);
      let { pathname } = url;
      if (pathname === '/') {
        pathname = '/index.html';
      }

      const filePath = safeJoin(ROOT, pathname.slice(1));
      if (!filePath) {
        send404(res);
        return;
      }

      const resolved = path.resolve(filePath);
      if (!resolved.startsWith(ROOT + path.sep) && resolved !== path.resolve(ROOT)) {
        res.writeHead(403).end();
        return;
      }

      fs.stat(resolved, (err, st) => {
        if (!err && st.isFile()) {
          const ext = path.extname(resolved);
          res.writeHead(200, { 'Content-Type': MIME[ext] || 'application/octet-stream' });
          fs.createReadStream(resolved).pipe(res);
          return;
        }
        send404(res);
      });
    } catch {
      res.writeHead(400).end();
    }
  })
  .listen(PORT, () => {
    console.error(`chinmeister web  http://localhost:${PORT}  (missing routes → 404.html)`);
  });
