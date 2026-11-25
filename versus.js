(function (root, factory) {
  const isNode = typeof module === 'object' && module.exports;
  const core = isNode ? require('./core.js') : root.KeyboardTugCore;
  const api = factory(core);
  if (isNode) module.exports = api;
  root.KeyboardTugVersus = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function (core) {
  'use strict';

  const { KEY_ROWS, CONFIG, getKeyInfo } = core;
  const SIDES = ['player', 'bot'];

  function otherSide(side) {
    return side === 'player' ? 'bot' : 'player';
  }

  function makeSide() {
    return {
      stats: { flips: 0, mistakes: 0, streak: 0, bestStreak: 0 }
    };
  }

  class VersusGame {
    constructor(options = {}) {
      this.random = options.random || Math.random;
      this.config = Object.freeze({ ...CONFIG, ...(options.config || {}) });
      this.time = 0;
      this.duration = this.config.duration;
      this.nextScoreAt = this.config.scoreInterval;
      this.score = { player: 0, bot: 0 };
      this.status = 'playing';
      this.winner = null;
      this.endReason = null;
      this.keys = this.shuffleTeams();
      this.keyMap = new Map(this.keys.map((state) => [state.key, state]));
      this.sides = { player: makeSide(), bot: makeSide() };
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

    counts() {
      const result = { player: 0, bot: 0 };
      for (const state of this.keys) result[state.owner] += 1;
      return result;
    }

    finish(winner, reason) {
      this.status = 'finished';
      this.winner = winner;
      this.endReason = reason;
    }

    finishByScore() {
      if (this.score.player > this.score.bot) this.finish('player', 'time');
      else if (this.score.player < this.score.bot) this.finish('bot', 'time');
      else this.finish('draw', 'time');
    }

    strike(side, rawKey) {
      const self = this.sides[side];
      const tile = getKeyInfo(rawKey);
      if (!self || !tile || this.status !== 'playing') return { type: 'ignored', side };

      const state = this.keyMap.get(tile.key);

      if (state.owner === side) {
        const rival = otherSide(side);
        state.owner = rival;
        state.capturedAt = this.time;
        self.stats.mistakes += 1;
        self.stats.streak = 0;
        const counts = this.counts();
        if (counts[rival] === this.keys.length) this.finish(rival, 'sweep');
        return { type: 'mistake', side, key: tile.key, counts, lost: this.winner === rival };
      }

      state.owner = side;
      state.capturedAt = this.time;
      self.stats.flips += 1;
      self.stats.streak += 1;
      self.stats.bestStreak = Math.max(self.stats.bestStreak, self.stats.streak);
      const counts = this.counts();
      if (counts[side] === this.keys.length) this.finish(side, 'sweep');
      return { type: 'flip', side, key: tile.key, counts, won: this.winner === side };
    }

    update(dt) {
      if (dt <= 0 || this.status !== 'playing') return;

      this.time += dt;

      while (this.nextScoreAt <= this.duration && this.time >= this.nextScoreAt) {
        const counts = this.counts();
        this.score.player += counts.player;
        this.score.bot += counts.bot;
        this.nextScoreAt += this.config.scoreInterval;
      }

      if (this.time >= this.duration) this.finishByScore();
    }

    snapshot() {
      const sides = {};
      for (const side of SIDES) {
        sides[side] = { stats: { ...this.sides[side].stats } };
      }
      return {
        time: this.time,
        duration: this.duration,
        status: this.status,
        winner: this.winner,
        endReason: this.endReason,
        score: { ...this.score },
        counts: this.counts(),
        keys: this.keys.map((state) => ({
          key: state.key,
          owner: state.owner,
          capturedAt: state.capturedAt
        })),
        sides
      };
    }
  }

  return { VersusGame };
});
