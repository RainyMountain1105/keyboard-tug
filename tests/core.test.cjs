const test = require('node:test');
const assert = require('node:assert/strict');
const { Game, KEY_ROWS, CONFIG, getKeyInfo } = require('../core.js');

const ALL_KEYS = KEY_ROWS.join('').split('');

function makeGame(options = {}) {
  return new Game({ botEnabled: false, random: () => 0, ...options });
}

function setOwner(game, playerKeys) {
  const green = new Set(playerKeys);
  for (const state of game.keys) {
    state.owner = green.has(state.key) ? 'player' : 'bot';
    state.capturedAt = 0;
  }
}

test('键盘布局保留三排错位关系和 26 个字母', () => {
  assert.deepEqual(KEY_ROWS, ['QWERTYUIOP', 'ASDFGHJKL', 'ZXCVBNM']);
  assert.equal(KEY_ROWS.join('').length, 26);
  assert.equal(getKeyInfo('Q').row, 0);
  assert.equal(getKeyInfo('A').row, 1);
  assert.equal(getKeyInfo('Z').row, 2);
  assert.ok(getKeyInfo('A').x > getKeyInfo('Q').x);
  assert.ok(getKeyInfo('Z').x > getKeyInfo('A').x);
  assert.equal(getKeyInfo('a').key, 'A');
  assert.equal(getKeyInfo('1'), null);
});

test('开局随机分配，恰好 13 键属于玩家、13 键属于 Bot', () => {
  for (const rand of [() => 0, () => 0.37, () => 0.99, Math.random]) {
    const game = new Game({ botEnabled: false, random: rand });
    const counts = game.counts();
    assert.equal(counts.player, 13);
    assert.equal(counts.bot, 13);
    assert.equal(game.score.player, 0);
    assert.equal(game.score.bot, 0);
  }
});

test('按红色键：翻成绿色并计一次成功翻牌', () => {
  const game = makeGame();
  setOwner(game, ['B']);

  const result = game.strike('A');

  assert.equal(result.type, 'flip');
  assert.equal(game.getKeyState('A').owner, 'player');
  assert.equal(game.counts().player, 2);
  assert.equal(game.counts().bot, 24);
  assert.equal(game.stats.flips, 1);
  assert.equal(game.stats.mistakes, 0);
});

test('按绿色键：会把自己的键翻回红色，这是误按惩罚', () => {
  const game = makeGame();
  setOwner(game, ['A', 'B']);
  game.stats.streak = 5;

  const result = game.strike('A');

  assert.equal(result.type, 'mistake');
  assert.equal(game.getKeyState('A').owner, 'bot');
  assert.equal(game.counts().player, 1);
  assert.equal(game.counts().bot, 25);
  assert.equal(game.stats.mistakes, 1);
  assert.equal(game.stats.streak, 0);
});

test('同一个键连续按两次会翻回原色，没有重复输入保护', () => {
  const game = makeGame();
  setOwner(game, []);

  assert.equal(game.strike('A').type, 'flip');
  assert.equal(game.getKeyState('A').owner, 'player');

  assert.equal(game.strike('A').type, 'mistake');
  assert.equal(game.getKeyState('A').owner, 'bot');
  assert.equal(game.stats.flips, 1);
  assert.equal(game.stats.mistakes, 1);
});

test('Bot 会自动翻绿键，红方键数增加', () => {
  const game = makeGame({ botEnabled: true, random: () => 0.5 });
  const before = game.counts();

  game.update(1);

  assert.equal(game.stats.botFlips, 1);
  assert.equal(game.counts().bot, before.bot + 1);
  assert.ok(game.events.some((event) => event.type === 'bot-flip'));
});

test('Bot 优先翻玩家最近翻绿的键', () => {
  const game = makeGame({ botEnabled: true });
  setOwner(game, ['A', 'B', 'C']);
  game.time = 5;
  game.getKeyState('B').capturedAt = 1;
  game.getKeyState('C').capturedAt = 4.9;
  game.getKeyState('A').capturedAt = 4;

  const result = game.botTurn();

  assert.equal(result.type, 'bot-flip');
  assert.equal(result.key, 'C');
});

test('每秒按当前键数结算积分', () => {
  const game = makeGame();
  setOwner(game, ALL_KEYS.slice(0, 20));

  game.update(0.5);
  assert.deepEqual(game.score, { player: 0, bot: 0 });

  game.update(0.5);
  assert.deepEqual(game.score, { player: 20, bot: 6 });
  assert.equal(game.stats.ticks, 1);

  game.update(1);
  assert.deepEqual(game.score, { player: 40, bot: 12 });
  assert.equal(game.stats.ticks, 2);
});

test('60 秒结束后按总积分判定胜负与平局', () => {
  const win = makeGame();
  setOwner(win, ALL_KEYS.slice(0, 20));
  win.time = 59.5;
  win.nextScoreAt = 60;
  win.score = { player: 100, bot: 50 };
  win.update(0.6);
  assert.equal(win.status, 'won');
  assert.equal(win.endReason, 'time');
  assert.deepEqual(win.score, { player: 120, bot: 56 });

  const lose = makeGame();
  setOwner(lose, ALL_KEYS.slice(0, 6));
  lose.time = 59.5;
  lose.nextScoreAt = 60;
  lose.score = { player: 50, bot: 100 };
  lose.update(0.6);
  assert.equal(lose.status, 'lost');

  const draw = makeGame();
  setOwner(draw, ALL_KEYS.slice(0, 13));
  draw.time = 59.5;
  draw.nextScoreAt = 60;
  draw.score = { player: 10, bot: 10 };
  draw.update(0.6);
  assert.equal(draw.status, 'draw');
});

test('把 26 个键全部翻绿会提前获胜，不用等时间', () => {
  const game = makeGame();
  setOwner(game, ALL_KEYS.slice(0, 25));
  game.time = 10;

  const result = game.strike(ALL_KEYS[25]);

  assert.equal(result.won, true);
  assert.equal(game.status, 'won');
  assert.equal(game.endReason, 'sweep');
  assert.equal(game.counts().player, 26);
});

test('全部键被翻红会提前失败，时间未到也立即结束', () => {
  const game = makeGame();
  setOwner(game, ['Q']);
  game.time = 10;

  const result = game.strike('Q');

  assert.equal(result.type, 'mistake');
  assert.equal(result.lost, true);
  assert.equal(game.status, 'lost');
  assert.equal(game.endReason, 'sweep');
  assert.equal(game.counts().bot, 26);
});

test('对局结束后按键不再生效', () => {
  const game = makeGame();
  setOwner(game, ['Q']);
  game.time = 10;
  game.strike('Q');
  assert.equal(game.status, 'lost');

  const result = game.strike('A');
  assert.equal(result.type, 'ignored');
  assert.equal(game.getKeyState('A').owner, 'bot');
});

test('难度档位只影响 Bot 节奏，未知难度回退普通', () => {
  const easy = new Game({ botEnabled: false, difficulty: 'easy' });
  const normal = new Game({ botEnabled: false, difficulty: 'normal' });
  const hard = new Game({ botEnabled: false, difficulty: 'hard' });

  assert.ok(easy.config.botInterval > normal.config.botInterval);
  assert.ok(normal.config.botInterval > hard.config.botInterval);
  assert.ok(easy.config.botMinInterval > hard.config.botMinInterval);
  assert.equal(easy.duration, CONFIG.duration);

  const fallback = new Game({ botEnabled: false, difficulty: 'nightmare' });
  assert.equal(fallback.difficulty, 'normal');
});

test('简单难度的 Bot 第一次行动晚于普通难度', () => {
  const easy = new Game({ botEnabled: true, difficulty: 'easy', random: () => 0.5 });
  const normal = new Game({ botEnabled: true, difficulty: 'normal', random: () => 0.5 });

  easy.update(0.75);
  normal.update(0.75);

  assert.equal(easy.stats.botFlips, 0);
  assert.equal(normal.stats.botFlips, 1);
});
