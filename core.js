(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  root.KeyboardTugCore = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  const KEY_ROWS = Object.freeze(['QWERTYUIOP', 'ASDFGHJKL', 'ZXCVBNM']);
  const ROW_OFFSETS = Object.freeze([0, 0.35, 0.8]);
  const CONFIG = Object.freeze({
    duration: 60,
    scoreInterval: 1,
    botInterval: 0.55,
    botMinInterval: 0.4,
    botAccelPerSecond: 0.004,
    botJitter: 0.12,
    botRecentWindow: 2,
    teamSize: 13,
    // 以下参数仅供 versus.js 的双人联机模式使用，单人翻牌模式不再使用能量与保护期
    maxEnergy: 100,
    startEnergy: 50,
    flipGain: 4,
    ownPenalty: 10,
    lockoutDuration: 3,
    regenPerSecond: 2,
    repeatWindow: 0.18,
    protectDuration: 0.6
  });

  const DIFFICULTIES = Object.freeze({
    easy: Object.freeze({ label: '简单', botInterval: 0.95, botMinInterval: 0.7 }),
    normal: Object.freeze({ label: '普通', botInterval: 0.55, botMinInterval: 0.4 }),
    hard: Object.freeze({ label: '困难', botInterval: 0.4, botMinInterval: 0.27 })
  });

  function getKeyInfo(key) {
    const normalized = String(key).toUpperCase();
    if (normalized.length !== 1) return null;
    const row = KEY_ROWS.findIndex((letters) => letters.includes(normalized));
    if (row === -1) return null;
    const column = KEY_ROWS[row].indexOf(normalized);
    return { key: normalized, row, column, x: ROW_OFFSETS[row] + column };
  }

  class Game {
    constructor(options = {}) {
      this.random = options.random || Math.random;
      this.botEnabled = options.botEnabled ?? true;
      this.difficulty = DIFFICULTIES[options.difficulty] ? options.difficulty : 'normal';
      this.config = Object.freeze({ ...CONFIG, ...DIFFICULTIES[this.difficulty] });
      this.status = 'playing';
      this.endReason = null;
      this.time = 0;
      this.duration = this.config.duration;
      this.nextScoreAt = this.config.scoreInterval;
      this.score = { player: 0, bot: 0 };
      this.events = [];
      this.keys = this.shuffleTeams();
      this.keyMap = new Map(this.keys.map((state) => [state.key, state]));
      this.botTimer = this.currentBotInterval();
      this.stats = {
        flips: 0,
        mistakes: 0,
        streak: 0,
        bestStreak: 0,
        botFlips: 0,
        ticks: 0
      };
    }

    shuffleTeams() {
      const letters = KEY_ROWS.join('').split('');
      for (let i = letters.length - 1; i > 0; i -= 1) {
        const j = Math.min(i, Math.floor(this.random() * (i + 1)));
        [letters[i], letters[j]] = [letters[j], letters[i]];
      }
      return letters.map((key, index) => ({
        key,
        owner: index < this.config.teamSize ? 'player' : 'bot',
        capturedAt: 0
      }));
    }

    getKeyState(key) {
      const tile = getKeyInfo(key);
      return tile ? this.keyMap.get(tile.key) || null : null;
    }

    counts() {
      const result = { player: 0, bot: 0 };
      for (const state of this.keys) result[state.owner] += 1;
      return result;
    }

    currentBotInterval() {
      const base = Math.max(
        this.config.botMinInterval,
        this.config.botInterval - this.time * this.config.botAccelPerSecond
      );
      const jitter = 1 - this.config.botJitter / 2 + this.random() * this.config.botJitter;
      return base * jitter;
    }

    drainEvents() {
      const events = this.events;
      this.events = [];
      return events;
    }

    finish(status, reason) {
      this.status = status;
      this.endReason = reason;
    }

    finishByScore() {
      if (this.score.player > this.score.bot) this.finish('won', 'time');
      else if (this.score.player < this.score.bot) this.finish('lost', 'time');
      else this.finish('draw', 'time');
    }

    strike(rawKey) {
      const tile = getKeyInfo(rawKey);
      if (!tile || this.status !== 'playing') return { type: 'ignored' };

      const state = this.keyMap.get(tile.key);

      if (state.owner === 'player') {
        state.owner = 'bot';
        state.capturedAt = this.time;
        this.stats.mistakes += 1;
        this.stats.streak = 0;
        const counts = this.counts();
        if (counts.bot === this.keys.length) this.finish('lost', 'sweep');
        return { type: 'mistake', key: tile.key, counts, lost: this.status === 'lost' };
      }

      state.owner = 'player';
      state.capturedAt = this.time;
      this.stats.flips += 1;
      this.stats.streak += 1;
      this.stats.bestStreak = Math.max(this.stats.bestStreak, this.stats.streak);
      const counts = this.counts();
      if (counts.player === this.keys.length) this.finish('won', 'sweep');
      return { type: 'flip', key: tile.key, counts, won: this.status === 'won' };
    }

    botTurn() {
      if (this.status !== 'playing') return { type: 'bot-idle', reason: 'finished' };

      const owned = this.keys.filter((state) => state.owner === 'player');
      if (owned.length === 0) return { type: 'bot-idle', reason: 'no-targets' };

      const recent = owned.filter(
        (state) => this.time - state.capturedAt <= this.config.botRecentWindow
      );

      let target;
      if (recent.length > 0) {
        target = recent.reduce((latest, state) =>
          state.capturedAt > latest.capturedAt ? state : latest
        );
      } else {
        const index = Math.min(
          owned.length - 1,
          Math.floor(this.random() * owned.length)
        );
        target = owned[index];
      }

      target.owner = 'bot';
      target.capturedAt = this.time;
      this.stats.botFlips += 1;

      const counts = this.counts();
      if (counts.bot === this.keys.length) this.finish('lost', 'sweep');

      const event = {
        type: 'bot-flip',
        key: target.key,
        counts,
        lost: this.status === 'lost'
      };
      this.events.push(event);
      return event;
    }

    update(dt) {
      if (dt <= 0 || this.status !== 'playing') return;

      this.time += dt;

      while (this.nextScoreAt <= this.duration && this.time >= this.nextScoreAt) {
        const counts = this.counts();
        this.score.player += counts.player;
        this.score.bot += counts.bot;
        this.stats.ticks += 1;
        this.nextScoreAt += this.config.scoreInterval;
      }

      if (this.time >= this.duration) {
        this.finishByScore();
        return;
      }

      if (!this.botEnabled) return;

      this.botTimer -= dt;
      let guard = 0;
      while (this.botTimer <= 0 && this.status === 'playing' && guard < 20) {
        const result = this.botTurn();
        this.botTimer += result.type === 'bot-flip' ? this.currentBotInterval() : 0.05;
        guard += 1;
      }
      if (this.botTimer < 0) this.botTimer = 0;
    }
  }

  return { Game, KEY_ROWS, CONFIG, DIFFICULTIES, getKeyInfo };
});
