const test = require('node:test');
const assert = require('node:assert/strict');
const { VersusGame } = require('../versus.js');
const { KEY_ROWS, CONFIG } = require('../core.js');

const ALL_KEYS = KEY_ROWS.join('').split('');

function makeGame(options = {}) {
  return new VersusGame({ random: () => 0.5, ...options });
}

function setOwners(game, greenKeys) {
  const green = new Set(greenKeys);
  for (const state of game.keys) {
    state.owner = green.has(state.key) ? 'player' : 'bot';
    state.capturedAt = 0;
  }
}

test('双人开局 13/13，双方积分为 0，对局时长 60 秒', () => {
  const game = makeGame();

  assert.equal(game.counts().player, 13);
  assert.equal(game.counts().bot, 13);
  assert.deepEqual(game.score, { player: 0, bot: 0 });
  assert.equal(game.duration, CONFIG.duration);
  assert.equal(game.winner, null);
});

test('翻牌：把敌方颜色翻成自己的颜色并计入翻绿', () => {
  const game = makeGame();
  setOwners(game, ['A']);

  const result = game.strike('player', 'B');

  assert.equal(result.type, 'flip');
  assert.equal(game.keys.find((state) => state.key === 'B').owner, 'player');
  assert.equal(game.counts().player, 2);
  assert.equal(game.sides.player.stats.flips, 1);
  assert.equal(game.sides.player.stats.mistakes, 0);
});

test('同一个键连按两次会翻回原色，没有保护期和重复输入窗口', () => {
  const game = makeGame();
  setOwners(game, []);

  assert.equal(game.strike('player', 'Q').type, 'flip');
  assert.equal(game.keys.find((state) => state.key === 'Q').owner, 'player');

  assert.equal(game.strike('player', 'Q').type, 'mistake');
  assert.equal(game.keys.find((state) => state.key === 'Q').owner, 'bot');
  assert.equal(game.sides.player.stats.flips, 1);
  assert.equal(game.sides.player.stats.mistakes, 1);
});

test('双方可以立刻互相翻回同一个键，互不影响', () => {
  const game = makeGame();
  setOwners(game, ['A']);

  assert.equal(game.strike('player', 'Q').type, 'flip');
  assert.equal(game.strike('bot', 'Q').type, 'flip');
  assert.equal(game.keys.find((state) => state.key === 'Q').owner, 'bot');
  assert.equal(game.sides.bot.stats.flips, 1);

  assert.equal(game.strike('player', 'Q').type, 'flip');
  assert.equal(game.keys.find((state) => state.key === 'Q').owner, 'player');
  assert.equal(game.sides.player.stats.flips, 2);
});

test('每秒按当前键数为双方累加积分', () => {
  const game = makeGame();
  setOwners(game, ALL_KEYS.slice(0, 20));

  game.update(0.5);
  assert.deepEqual(game.score, { player: 0, bot: 0 });

  game.update(0.5);
  assert.deepEqual(game.score, { player: 20, bot: 6 });

  game.update(1);
  assert.deepEqual(game.score, { player: 40, bot: 12 });
});

test('60 秒结束后按总积分判定胜负与平局', () => {
  const win = makeGame();
  setOwners(win, ALL_KEYS.slice(0, 20));
  win.time = 59.5;
  win.nextScoreAt = 60;
  win.score = { player: 100, bot: 50 };
  win.update(0.6);
  assert.equal(win.status, 'finished');
  assert.equal(win.winner, 'player');
  assert.equal(win.endReason, 'time');
  assert.deepEqual(win.score, { player: 120, bot: 56 });

  const lose = makeGame();
  setOwners(lose, ALL_KEYS.slice(0, 6));
  lose.time = 59.5;
  lose.nextScoreAt = 60;
  lose.score = { player: 50, bot: 100 };
  lose.update(0.6);
  assert.equal(lose.winner, 'bot');

  const draw = makeGame();
  setOwners(draw, ALL_KEYS.slice(0, 13));
  draw.time = 59.5;
  draw.nextScoreAt = 60;
  draw.score = { player: 10, bot: 10 };
  draw.update(0.6);
  assert.equal(draw.winner, 'draw');
  assert.equal(draw.endReason, 'time');
});

test('任一方先清一色即获胜，之后输入被忽略', () => {
  const game = makeGame();
  setOwners(game, []);

  for (const key of ALL_KEYS) {
    assert.equal(game.strike('player', key).type, 'flip');
  }

  assert.equal(game.status, 'finished');
  assert.equal(game.winner, 'player');
  assert.equal(game.endReason, 'sweep');
  assert.equal(game.strike('bot', 'Q').type, 'ignored');

  const snapshot = game.snapshot();
  assert.equal(snapshot.counts.player, 26);
  assert.equal(snapshot.winner, 'player');
  assert.equal(snapshot.score.player, 0);
  assert.equal(snapshot.keys.length, 26);
  assert.equal(snapshot.sides.player.stats.flips, 26);
});

test('误按自己的最后一个绿键会直接让对手清一色获胜', () => {
  const game = makeGame();
  setOwners(game, ['Q']);

  const result = game.strike('player', 'Q');

  assert.equal(result.type, 'mistake');
  assert.equal(result.lost, true);
  assert.equal(game.winner, 'bot');
  assert.equal(game.counts().bot, 26);
});

test('红方翻走最后一个绿键也会立即结束对局', () => {
  const game = makeGame();
  setOwners(game, ['Q']);

  const result = game.strike('bot', 'Q');

  assert.equal(result.type, 'flip');
  assert.equal(result.won, true);
  assert.equal(game.status, 'finished');
  assert.equal(game.winner, 'bot');
  assert.equal(game.endReason, 'sweep');
});
