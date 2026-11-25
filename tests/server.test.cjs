'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const net = require('node:net');
const path = require('node:path');
const WebSocket = require('ws');

const ROOT = path.resolve(__dirname, '..');

class Client {
  constructor(url) {
    this.ws = new WebSocket(url);
    this.messages = [];
    this.waiters = [];
    this.ws.on('message', (data) => {
      const message = JSON.parse(data.toString());
      const index = this.waiters.findIndex((waiter) => waiter.predicate(message));
      if (index >= 0) {
        const [waiter] = this.waiters.splice(index, 1);
        clearTimeout(waiter.timer);
        waiter.resolve(message);
      } else {
        this.messages.push(message);
      }
    });
  }

  async open() {
    if (this.ws.readyState === WebSocket.OPEN) return;
    await new Promise((resolve, reject) => {
      this.ws.once('open', resolve);
      this.ws.once('error', reject);
    });
  }

  send(message) {
    this.ws.send(JSON.stringify(message));
  }

  waitFor(predicate, timeout = 3000) {
    const index = this.messages.findIndex(predicate);
    if (index >= 0) return Promise.resolve(this.messages.splice(index, 1)[0]);
    return new Promise((resolve, reject) => {
      const waiter = { predicate, resolve };
      waiter.timer = setTimeout(() => {
        const index = this.waiters.indexOf(waiter);
        if (index >= 0) this.waiters.splice(index, 1);
        reject(new Error('等待服务端消息超时'));
      }, timeout);
      this.waiters.push(waiter);
    });
  }

  close() {
    this.ws.close();
  }
}

function getPort() {
  return new Promise((resolve, reject) => {
    const probe = net.createServer();
    probe.once('error', reject);
    probe.listen(0, '127.0.0.1', () => {
      const { port } = probe.address();
      probe.close((error) => error ? reject(error) : resolve(port));
    });
  });
}

function startServer(port) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ['server.js'], {
      cwd: ROOT,
      env: { ...process.env, PORT: String(port) },
      stdio: ['ignore', 'pipe', 'pipe']
    });
    const timer = setTimeout(() => reject(new Error('服务器启动超时')), 3000);
    child.stdout.once('data', () => {
      clearTimeout(timer);
      resolve(child);
    });
    child.stderr.once('data', (data) => {
      clearTimeout(timer);
      reject(new Error(data.toString()));
    });
    child.once('error', reject);
  });
}

test('双客户端可建房、加入、互抢、结算、共同重开并处理断线', { timeout: 15000 }, async (t) => {
  const port = await getPort();
  const server = await startServer(port);
  const clients = [];
  const connect = async () => {
    const client = new Client(`ws://127.0.0.1:${port}/ws`);
    clients.push(client);
    await client.open();
    return client;
  };
  t.after(() => {
    for (const client of clients) client.close();
    server.kill();
  });

  const missing = await connect();
  missing.send({ t: 'join', room: 'NONE' });
  assert.equal((await missing.waitFor((msg) => msg.t === 'error')).code, 'not_found');
  missing.close();

  const green = await connect();
  green.send({ t: 'create' });
  const created = await green.waitFor((msg) => msg.t === 'created');
  assert.match(created.room, /^[A-Z2-9]{4}$/);
  assert.equal(created.side, 'player');

  const red = await connect();
  red.send({ t: 'join', room: created.room.toLowerCase() });
  assert.equal((await red.waitFor((msg) => msg.t === 'joined')).side, 'bot');
  const starts = await Promise.all([
    green.waitFor((msg) => msg.t === 'start'),
    red.waitFor((msg) => msg.t === 'start')
  ]);
  for (const { state } of starts) {
    assert.equal(state.keys.length, 26);
    assert.equal(state.counts.player, 13);
    assert.equal(state.counts.bot, 13);
  }

  const full = await connect();
  full.send({ t: 'join', room: created.room });
  assert.equal((await full.waitFor((msg) => msg.t === 'error')).code, 'full');
  full.close();

  let state = starts[0].state;
  const greenTarget = state.keys.find((key) => key.owner === 'bot').key;
  green.send({ t: 'strike', key: greenTarget });
  const greenFlip = await red.waitFor((msg) =>
    msg.t === 'state' && msg.events.some((event) => event.type === 'flip' && event.key === greenTarget)
  );
  assert.equal(greenFlip.state.keys.find((key) => key.key === greenTarget).owner, 'player');

  const redTarget = greenFlip.state.keys.find((key) => key.owner === 'player' && key.key !== greenTarget).key;
  red.send({ t: 'strike', key: redTarget });
  const redFlip = await green.waitFor((msg) =>
    msg.t === 'state' && msg.events.some((event) => event.type === 'flip' && event.side === 'bot')
  );
  state = redFlip.state;

  // 翻牌制没有保护期，任何一方都可以立刻把键翻回来。
  for (const tile of state.keys.filter((key) => key.owner === 'bot')) {
    green.send({ t: 'strike', key: tile.key });
    const result = await green.waitFor((msg) =>
      msg.t === 'state' && msg.events.some((event) => event.side === 'player' && event.key === tile.key)
    );
    assert.equal(result.events.find((event) => event.key === tile.key).type, 'flip');
    state = result.state;
  }
  assert.equal(state.status, 'finished');
  assert.equal(state.winner, 'player');
  assert.equal(state.counts.player, 26);

  green.send({ t: 'restart' });
  const waiting = await red.waitFor((msg) => msg.t === 'restart_wait');
  assert.deepEqual(waiting.ready, ['player']);
  red.send({ t: 'restart' });
  const restarted = await green.waitFor((msg) => msg.t === 'start');
  assert.equal(restarted.state.counts.player, 13);
  assert.equal(restarted.state.counts.bot, 13);

  red.close();
  await green.waitFor((msg) => msg.t === 'peer_left');
  const late = await connect();
  late.send({ t: 'join', room: created.room });
  assert.equal((await late.waitFor((msg) => msg.t === 'error')).code, 'not_found');

  const [singlePlayer, versusPage, clientScript] = await Promise.all([
    fetch(`http://127.0.0.1:${port}/`),
    fetch(`http://127.0.0.1:${port}/versus.html`),
    fetch(`http://127.0.0.1:${port}/versus-client.js`)
  ]);
  assert.equal(singlePlayer.status, 200);
  assert.equal(versusPage.status, 200);
  assert.match(await versusPage.text(), /id="gameCanvas"/);
  assert.equal(clientScript.status, 200);
});
