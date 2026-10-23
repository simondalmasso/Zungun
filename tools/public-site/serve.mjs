import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../cloudflare/public');
const routeFiles = new Map([
  ['/', 'index.html'],
  ['/developers', 'developers/index.html'],
  ['/control', 'control/index.html'],
  ['/messages', 'messages/index.html'],
  ['/ops', 'ops/index.html'],
  ['/ops/legacy', 'ops/legacy/index.html'],
  ['/chat/', 'chat/index.html'],
]);
const types = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.txt': 'text/plain; charset=utf-8',
  '.xml': 'application/xml; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json; charset=utf-8',
};

const server = createServer(async (request, response) => {
  if (request.method !== 'GET' && request.method !== 'HEAD') {
    response.writeHead(405, { 'content-type': 'application/json; charset=utf-8', allow: 'GET, HEAD' });
    response.end(request.method === 'HEAD' ? undefined : JSON.stringify({ ok: false, error: 'METHOD_NOT_ALLOWED' }));
    return;
  }

  const url = new URL(request.url || '/', 'http://127.0.0.1');
  if (url.pathname === '/chat') {
    response.writeHead(308, { location: '/chat/', 'cache-control': 'no-store' });
    response.end();
    return;
  }
  if (url.pathname.startsWith('/api/')) {
    response.writeHead(401, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
    response.end(request.method === 'HEAD' ? undefined : JSON.stringify({ ok: false, error: 'UNAUTHORIZED' }));
    return;
  }

  let pathname;
  try {
    pathname = decodeURIComponent(url.pathname);
  } catch {
    response.writeHead(400);
    response.end();
    return;
  }

  const relative = routeFiles.get(pathname) || pathname.replace(/^\\/+/, '');
  const filename = path.resolve(root, relative);
  if (filename !== root && !filename.startsWith(root + path.sep)) {
    response.writeHead(403);
    response.end();
    return;
  }

  let bytes;
  try {
    bytes = await readFile(filename);
  } catch {
    response.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' });
    response.end(request.method === 'HEAD' ? undefined : 'Not found');
    return;
  }

  response.writeHead(200, {
    'content-type': types[path.extname(filename)] || 'application/octet-stream',
    'cache-control': 'no-store',
    'x-content-type-options': 'nosniff',
  });
  response.end(request.method === 'HEAD' ? undefined : bytes);
});

const port = Number(process.env.PORT || 4173);
server.listen(port, '127.0.0.1', () => {
  process.stdout.write('Zungun public-site test server listening on http://127.0.0.1:' + port + '\n');
});
