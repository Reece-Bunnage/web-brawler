// Entry point: serves the browser client over http and runs the
// authoritative game server over WebSockets on the same port.
import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';
import { WebSocketServer } from 'ws';
import { Room } from './server/room.js';

const PORT = process.env.PORT || 3000;
const ROOT = fileURLToPath(new URL('.', import.meta.url));

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
};

// /shared is served alongside /client so the browser can import the same
// simulation modules the server runs (see instructions §5).
function resolvePath(urlPath) {
  const clean = normalize(urlPath).replace(/^(\.\.[/\\])+/, '');
  if (clean === '/' || clean === '') return join(ROOT, 'client', 'index.html');
  if (clean.startsWith('/shared/')) return join(ROOT, clean);
  return join(ROOT, 'client', clean);
}

const httpServer = http.createServer(async (req, res) => {
  const urlPath = decodeURIComponent(new URL(req.url, `http://${req.headers.host}`).pathname);
  const filePath = resolvePath(urlPath);
  try {
    const body = await readFile(filePath);
    res.writeHead(200, { 'Content-Type': MIME[extname(filePath)] || 'application/octet-stream' });
    res.end(body);
  } catch {
    res.writeHead(404, { 'Content-Type': 'text/plain' });
    res.end('Not found');
  }
});

// Compression is off (it defaults off, pinned here on purpose): it adds
// latency jitter, and the 60Hz snapshot stream is tiny anyway.
const wss = new WebSocketServer({ server: httpServer, perMessageDeflate: false });
const room = new Room();

wss.on('connection', (socket, req) => {
  // Nagle + delayed ACK batches small frequent messages into bursts — on a
  // LAN that turns the steady snapshot stream into visible chop. Send at once.
  req.socket.setNoDelay(true);
  console.log(`[ws] connection from ${req.socket.remoteAddress}`);
  room.addConnection(socket);
});

httpServer.listen(PORT, () => {
  console.log(`Web Brawler server listening on http://localhost:${PORT}`);
});
