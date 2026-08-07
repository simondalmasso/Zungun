import { createServer, request as httpRequest } from 'node:http';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

const port = Number(process.env.PROXY_PORT ?? 18789);
const upstream = new URL(process.env.UPSTREAM_URL ?? 'http://127.0.0.1:18788');
const stateDir = resolve(process.env.PROXY_STATE_DIR ?? '.tmp/order076-proxy');
const modeFile = resolve(process.env.PROXY_MODE_FILE ?? `${stateDir}/mode`);
mkdirSync(stateDir, { recursive: true });

const readMode = () => {
  try { return readFileSync(modeFile, 'utf8').trim() || 'pass'; } catch { return 'pass'; }
};
const bodyOf = async (req) => {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  return Buffer.concat(chunks);
};
const prefix = /^\/negative\/(missing|tampered|mismatch|future|expired|revoked)(\/.*)$/;

function upstreamCall(method, pathname, headers, body) {
  return new Promise((resolveCall, rejectCall) => {
    const req = httpRequest({
      hostname: upstream.hostname,
      port: upstream.port,
      method,
      path: pathname,
      headers: { ...headers, host: upstream.host, 'content-length': body.length },
    }, (response) => {
      const chunks = [];
      response.on('data', (chunk) => chunks.push(chunk));
      response.on('end', () => resolveCall({
        status: response.statusCode ?? 502,
        headers: response.headers,
        body: Buffer.concat(chunks),
      }));
    });
    req.on('error', rejectCall);
    if (body.length) req.write(body);
    req.end();
  });
}

function mutateNegative(mode, path, response) {
  if (response.status >= 400 || !response.body.length) return response;
  const json = JSON.parse(response.body.toString('utf8'));
  if (path.endsWith('/api/v1/operations')) {
    const finalPath = resolve(stateDir, 'final-response.json');
    const finalJson = JSON.parse(readFileSync(finalPath, 'utf8'));
    if (mode === 'missing') finalJson.receipt = null;
    if (mode === 'tampered') finalJson.receipt.payload.applicationReference = 'tampered-reference';
    return { ...response, body: Buffer.from(JSON.stringify(finalJson)) };
  }
  if (path.endsWith('/api/v1/keys') && ['future', 'expired', 'revoked'].includes(mode)) {
    const now = Date.now();
    for (const item of json.items) {
      if (mode === 'future') item.validFromMs = now + 86_400_000;
      if (mode === 'expired') item.validUntilMs = now - 1;
      if (mode === 'revoked') item.revokedAtMs = now - 1;
    }
    return { ...response, body: Buffer.from(JSON.stringify(json)) };
  }
  return response;
}

const server = createServer(async (req, res) => {
  try {
    const incoming = new URL(req.url ?? '/', `http://${req.headers.host ?? 'localhost'}`);
    const negative = incoming.pathname.match(prefix);
    const mode = negative?.[1] ?? null;
    const upstreamPath = negative ? `${negative[2]}${incoming.search}` : `${incoming.pathname}${incoming.search}`;
    const requestBody = await bodyOf(req);
    const response = await upstreamCall(req.method ?? 'GET', upstreamPath, req.headers, requestBody);

    if (!negative && req.method === 'POST' && incoming.pathname === '/api/v1/operations') {
      writeFileSync(resolve(stateDir, 'last-operation-response.json'), response.body);
      const parsed = JSON.parse(response.body.toString('utf8'));
      if (parsed.receipt) writeFileSync(resolve(stateDir, 'final-response.json'), JSON.stringify(parsed));
      if (readMode() === 'drop') {
        const accepted = response.status >= 200 && response.status < 300 &&
          typeof parsed.operationId === 'string' && parsed.operationId.length > 0;
        if (accepted) {
          writeFileSync(resolve(stateDir, 'drop-observed'), `${parsed.operationId}\t${Date.now()}\n`, { flag: 'a' });
          req.socket.destroy();
          return;
        }
      }
    }

    const outgoing = mode ? mutateNegative(mode, upstreamPath, response) : response;
    res.writeHead(outgoing.status, {
      'content-type': outgoing.headers['content-type'] ?? 'application/json',
      'content-length': outgoing.body.length,
      'cache-control': 'no-store',
    });
    res.end(outgoing.body);
  } catch (error) {
    const body = Buffer.from(JSON.stringify({ error: error instanceof Error ? error.message : String(error) }));
    res.writeHead(502, { 'content-type': 'application/json', 'content-length': body.length });
    res.end(body);
  }
});
server.listen(port, '0.0.0.0', () => console.log(JSON.stringify({ event: 'proxy_started', port, upstream: upstream.href })));
