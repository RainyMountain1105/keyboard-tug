'use strict';

const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { WebSocketServer } = require('ws');
const { VersusGame } = require('./versus.js');

const ROOT = __dirname;
const PORT = Number(process.env.PORT || 8080);
const TICK_MS = 100;
const CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon'
};

const server = http.createServer((req, res) => {
  let pathname;
  try {
    pathname = decodeURIComponent(new URL(req.url, 'http://localhost').pathname);
  } catch {
    res.writeHead(400).end();
    return;
  }
  if (pathname === '/') pathname = '/index.html';

  if (pathname.split('/').some((segment) => segment.startsWith('.'))) {
    res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' }).end('Not Found');
    return;
  }

  const file = path.normalize(path.join(ROOT, pathname));
  if (!file.startsWith(ROOT + path.sep)) {
    res.writeHead(403).end();
    return;
  }

  fs.stat(file, (err, stat) => {
    if (err || !stat.isFile()) {
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' }).end('Not Found');
      return;
    }
    res.writeHead(200, {
      'Content-Type': MIME[path.extname(file)] || 'application/octet-stream',
      'Cache-Control': 'no-cache'
    });
    fs.createReadStream(file).pipe(res);
  });
});

const wss = new WebSocketServer({ server, path: '/ws' });
const rooms = new Map();

function makeCode() {
  let code = '';
  const bytes = crypto.randomBytes(4);
  for (let i = 0; i < 4; i += 1) code += CODE_ALPHABET[bytes[i] % CODE_ALPHABET.length];
  return code;
}

function send(ws, message) {
  if (ws.readyState === ws.OPEN) ws.send(JSON.stringify(message));
}

function broadcast(room, message) {
  for (const player of room.players) send(player.ws, message);
}

function stopTimer(room) {
  if (room.timer) {
    clearInterval(room.timer);
    room.timer = null;
  }
}

function startMatch(room) {
  stopTimer(room);
  room.game = new VersusGame({});
  room.ready = new Set();
  room.status = 'playing';
  broadcast(room, { t: 'start', state: room.game.snapshot() });
  room.timer = setInterval(() => {
    room.game.update(TICK_MS / 1000);
    broadcast(room, { t: 'state', state: room.game.snapshot(), events: [] });
    if (room.game.status !== 'playing') {
      stopTimer(room);
      room.status = 'finished';
    }
  }, TICK_MS);
}

function attach(ws, room, side) {
  ws.room = room;
  ws.side = side;
  room.players.push({ ws, side });
}

wss.on('connection', (ws) => {
  ws.room = null;
  ws.side = null;
  ws.isAlive = true;
  ws.on('pong', () => { ws.isAlive = true; });

  ws.on('message', (data) => {
    let msg;
    try {
      msg = JSON.parse(data.toString());
    } catch {
      return;
    }

    if (msg.t === 'create') {
      if (ws.room) return;
      let code = makeCode();
      while (rooms.has(code)) code = makeCode();
      const room = { id: code, players: [], game: null, timer: null, ready: new Set(), status: 'waiting' };
      rooms.set(code, room);
      attach(ws, room, 'player');
      send(ws, { t: 'created', room: code, side: 'player' });
      return;
    }

    if (msg.t === 'join') {
      if (ws.room) return;
      const room = rooms.get(String(msg.room || '').toUpperCase().trim());
      if (!room) {
        send(ws, { t: 'error', code: 'not_found' });
        return;
      }
      if (room.players.length >= 2 || room.status !== 'waiting') {
        send(ws, { t: 'error', code: 'full' });
        return;
      }
      attach(ws, room, 'bot');
      send(ws, { t: 'joined', room: room.id, side: 'bot' });
      startMatch(room);
      return;
    }

    if (msg.t === 'strike') {
      const room = ws.room;
      if (!room || room.status !== 'playing' || !room.game) return;
      const result = room.game.strike(ws.side, String(msg.key || ''));
      if (result.type === 'ignored') return;
      broadcast(room, { t: 'state', state: room.game.snapshot(), events: [result] });
      if (room.game.status !== 'playing') {
        stopTimer(room);
        room.status = 'finished';
      }
      return;
    }

    if (msg.t === 'restart') {
      const room = ws.room;
      if (!room || room.status !== 'finished') return;
      room.ready.add(ws.side);
      if (room.ready.size === 2) {
        startMatch(room);
      } else {
        broadcast(room, { t: 'restart_wait', ready: [...room.ready] });
      }
    }
  });

  ws.on('close', () => {
    const room = ws.room;
    if (!room) return;
    stopTimer(room);
    room.players = room.players.filter((player) => player.ws !== ws);
    rooms.delete(room.id);
    if (room.players.length > 0) {
      room.status = 'aborted';
      broadcast(room, { t: 'peer_left' });
    }
  });

  ws.on('error', () => {});
});

setInterval(() => {
  for (const ws of wss.clients) {
    if (!ws.isAlive) {
      ws.terminate();
      continue;
    }
    ws.isAlive = false;
    ws.ping();
  }
}, 30000);

server.listen(PORT, () => {
  console.log(`键区拔河服务器已启动：http://localhost:${PORT}`);
  console.log(`联机入口：http://localhost:${PORT}/versus.html`);
});
