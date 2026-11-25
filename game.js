(() => {
  'use strict';

  const { Game, KEY_ROWS, DIFFICULTIES, getKeyInfo } = window.KeyboardTugCore;
  const canvas = document.getElementById('gameCanvas');
  const ctx = canvas.getContext('2d');
  const shell = document.getElementById('gameShell');
  const overlay = document.getElementById('overlay');
  const overlayEyebrow = document.getElementById('overlayEyebrow');
  const overlayTitle = document.getElementById('overlayTitle');
  const overlayDescription = document.getElementById('overlayDescription');
  const instructions = document.getElementById('instructions');
  const resultStats = document.getElementById('resultStats');
  const startButton = document.getElementById('startButton');
  const startButtonText = document.getElementById('startButtonText');
  const difficultyPicker = document.getElementById('difficultyPicker');
  const difficultyText = document.getElementById('difficultyText');
  const difficultyButtons = [...document.querySelectorAll('[data-difficulty]')];
  const tugScoreText = document.getElementById('tugScoreText');
  const tugPlayerFill = document.getElementById('tugPlayerFill');
  const playerScoreText = document.getElementById('playerScoreText');
  const botScoreText = document.getElementById('botScoreText');
  const timeText = document.getElementById('timeText');
  const flipsText = document.getElementById('flipsText');
  const mistakesText = document.getElementById('mistakesText');
  const lostText = document.getElementById('lostText');
  const streakText = document.getElementById('streakText');
  const bestStreakText = document.getElementById('bestStreakText');
  const botPaceText = document.getElementById('botPaceText');
  const announcement = document.getElementById('announcement');

  const ALL_KEYS = KEY_ROWS.join('').split('');

  let game = new Game({ botEnabled: true });
  let selectedDifficulty = 'normal';
  let started = false;
  let paused = true;
  let lastTenShown = false;
  let lastTime = performance.now();
  let announcementTimer = 0;
  let audioContext = null;
  let effects = [];
  let keyEffects = {};
  let layout = { unit: 70, originX: 100, originY: 100, rowGap: 88, width: 1000, height: 500 };

  function resizeCanvas() {
    const rect = shell.getBoundingClientRect();
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    canvas.width = Math.max(1, Math.round(rect.width * dpr));
    canvas.height = Math.max(1, Math.round(rect.height * dpr));
    canvas.dataset.dpr = dpr;
    const unit = Math.max(42, Math.min(92, (rect.width - 70) / 11.2, (rect.height - 60) / 3.65));
    layout = {
      unit,
      originX: (rect.width - 11 * unit) / 2 + 1.5 * unit,
      originY: (rect.height - 2.5 * unit) / 2,
      rowGap: unit * 1.25,
      width: rect.width,
      height: rect.height
    };
  }

  function tileCenter(key) {
    const tile = getKeyInfo(key);
    return {
      x: layout.originX + tile.x * layout.unit,
      y: layout.originY + tile.row * layout.rowGap
    };
  }

  function roundedRect(x, y, width, height, radius) {
    ctx.beginPath();
    ctx.roundRect(x, y, width, height, radius);
  }

  function showAnnouncement(text, danger = false) {
    announcement.textContent = text;
    announcement.classList.toggle('danger', danger);
    announcement.classList.add('visible');
    announcementTimer = 2.1;
  }

  function setDifficulty(name) {
    if (!DIFFICULTIES[name]) return;
    selectedDifficulty = name;
    difficultyText.textContent = DIFFICULTIES[name].label;
    difficultyButtons.forEach((button) => {
      button.classList.toggle('is-active', button.dataset.difficulty === name);
    });
  }

  function playTone(startFreq, endFreq, type, duration, volume) {
    if (!audioContext) return;
    const now = audioContext.currentTime;
    const oscillator = audioContext.createOscillator();
    const gain = audioContext.createGain();
    oscillator.type = type;
    oscillator.frequency.setValueAtTime(startFreq, now);
    oscillator.frequency.exponentialRampToValueAtTime(Math.max(20, endFreq), now + duration);
    gain.gain.setValueAtTime(volume, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + duration);
    oscillator.connect(gain);
    gain.connect(audioContext.destination);
    oscillator.start(now);
    oscillator.stop(now + duration + 0.01);
  }

  function pushRing(key, color) {
    effects.push({ type: 'ring', key, color, ttl: 0.4, duration: 0.4 });
  }

  function pushFloat(key, text, color) {
    const center = tileCenter(key);
    effects.push({
      type: 'float',
      x: center.x,
      y: center.y - layout.unit * 0.4,
      text,
      color,
      ttl: 0.9,
      duration: 0.9
    });
  }

  function flashKey(key, color) {
    keyEffects[key] = { color, ttl: 0.28, duration: 0.28 };
  }

  function addStrikeEffects(result) {
    if (result.type === 'flip') {
      flashKey(result.key, '#7dffc4');
      pushRing(result.key, '125, 255, 190');
      pushFloat(result.key, '+1', '#8ff0bc');
      playTone(300, 560, 'triangle', 0.09, 0.05);
    } else if (result.type === 'mistake') {
      flashKey(result.key, '#ff8b84');
      pushRing(result.key, '255, 107, 98');
      pushFloat(result.key, '-1', '#ff9d95');
      playTone(130, 70, 'square', 0.1, 0.04);
    }
  }

  function addBotEffects(event) {
    flashKey(event.key, '#ff9a92');
    pushRing(event.key, '255, 107, 98');
    pushFloat(event.key, 'BOT', '#ff9d95');
    playTone(190, 120, 'sawtooth', 0.07, 0.025);
  }

  function startGame() {
    game = new Game({ botEnabled: true, difficulty: selectedDifficulty });
    effects = [];
    keyEffects = {};
    started = true;
    paused = false;
    lastTenShown = false;
    overlay.hidden = true;
    resultStats.hidden = true;
    instructions.hidden = false;
    difficultyPicker.hidden = false;
    lastTime = performance.now();
    showAnnouncement('红键翻绿，绿键别碰 · 60 秒后积分高者胜');
    if (!audioContext) {
      const AudioContextClass = window.AudioContext || window.webkitAudioContext;
      if (AudioContextClass) audioContext = new AudioContextClass();
    }
    if (audioContext) audioContext.resume();
  }

  function pauseGame() {
    if (!started || game.status !== 'playing') return;
    paused = true;
    overlayEyebrow.textContent = '对局暂停';
    overlayTitle.textContent = '翻牌尚未结束。';
    overlayDescription.textContent = '休息一下。继续后，Bot 会从当前积分接着翻牌。';
    instructions.hidden = true;
    difficultyPicker.hidden = true;
    resultStats.hidden = true;
    startButtonText.textContent = '继续翻牌';
    overlay.hidden = false;
  }

  function resumeGame() {
    paused = false;
    overlay.hidden = true;
    lastTime = performance.now();
  }

  function finishGame() {
    paused = true;
    const counts = game.counts();
    const won = game.status === 'won';
    const lost = game.status === 'lost';
    const sweep = game.endReason === 'sweep';

    overlayEyebrow.textContent = won ? '翻牌胜利' : lost ? '翻牌失败' : '平局';
    overlayTitle.textContent = won
      ? (sweep ? '整片键区，都是你的颜色。' : '时间到，你的积分更高。')
      : lost
        ? (sweep ? '最后一张牌也被翻红了。' : '时间到，Bot 的积分更高。')
        : '时间到，双方打成平手。';
    overlayDescription.textContent = sweep
      ? `26 个键已经全部同色，本局提前结束。最终积分 ${game.score.player} : ${game.score.bot}。`
      : `60 秒结束，最终积分 ${game.score.player} : ${game.score.bot}，键数 ${counts.player} : ${counts.bot}。`;

    instructions.hidden = true;
    difficultyPicker.hidden = false;
    resultStats.innerHTML = `
      <div><span>翻绿</span><strong>${game.stats.flips}</strong></div>
      <div><span>失误</span><strong>${game.stats.mistakes}</strong></div>
      <div><span>被夺回</span><strong>${game.stats.botFlips}</strong></div>`;
    resultStats.hidden = false;
    startButtonText.textContent = '再来一局';
    overlay.hidden = false;
  }

  function updateEffects(dt) {
    for (const effect of effects) {
      effect.ttl -= dt;
      if (effect.type === 'float') effect.y -= 30 * dt;
    }
    effects = effects.filter((effect) => effect.ttl > 0);
    for (const [key, effect] of Object.entries(keyEffects)) {
      effect.ttl -= dt;
      if (effect.ttl <= 0) delete keyEffects[key];
    }
    if (announcementTimer > 0) {
      announcementTimer -= dt;
      if (announcementTimer <= 0) announcement.classList.remove('visible');
    }
  }

  function updateHud() {
    const counts = game.counts();
    tugScoreText.textContent = `${counts.player} : ${counts.bot}`;
    tugPlayerFill.style.width = `${counts.player / ALL_KEYS.length * 100}%`;
    playerScoreText.textContent = game.score.player;
    botScoreText.textContent = game.score.bot;
    timeText.textContent = Math.max(0, Math.ceil(game.duration - game.time));

    flipsText.textContent = game.stats.flips;
    mistakesText.textContent = game.stats.mistakes;
    lostText.textContent = game.stats.botFlips;
    streakText.textContent = game.stats.streak;
    bestStreakText.textContent = game.stats.bestStreak;

    const basePace = Math.max(
      game.config.botMinInterval,
      game.config.botInterval - game.time * game.config.botAccelPerSecond
    );
    botPaceText.textContent = `${basePace.toFixed(2)} 秒/键`;
  }

  function drawBackground() {
    const gradient = ctx.createLinearGradient(0, 0, 0, layout.height);
    gradient.addColorStop(0, '#111a2a');
    gradient.addColorStop(0.55, '#0c1422');
    gradient.addColorStop(1, '#090f1a');
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, layout.width, layout.height);

    const greenGlow = ctx.createRadialGradient(
      0, layout.height, 0,
      0, layout.height, layout.width * 0.6
    );
    greenGlow.addColorStop(0, 'rgba(67, 214, 145, 0.1)');
    greenGlow.addColorStop(1, 'rgba(20, 30, 50, 0)');
    ctx.fillStyle = greenGlow;
    ctx.fillRect(0, 0, layout.width, layout.height);

    const redGlow = ctx.createRadialGradient(
      layout.width, layout.height, 0,
      layout.width, layout.height, layout.width * 0.6
    );
    redGlow.addColorStop(0, 'rgba(255, 90, 84, 0.1)');
    redGlow.addColorStop(1, 'rgba(20, 30, 50, 0)');
    ctx.fillStyle = redGlow;
    ctx.fillRect(0, 0, layout.width, layout.height);

    ctx.strokeStyle = 'rgba(116, 139, 171, 0.045)';
    ctx.lineWidth = 1;
    const grid = layout.unit * 0.5;
    for (let x = 0; x < layout.width; x += grid) {
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.lineTo(x, layout.height);
      ctx.stroke();
    }
    for (let y = 0; y < layout.height; y += grid) {
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(layout.width, y);
      ctx.stroke();
    }
  }

  function drawKeys() {
    const unit = layout.unit;
    const size = unit * 0.84;

    for (const state of game.keys) {
      const center = tileCenter(state.key);
      const x = center.x - size / 2;
      const y = center.y - size / 2;
      const flash = keyEffects[state.key];
      const isPlayer = state.owner === 'player';
      const flashAlpha = flash ? Math.max(0, flash.ttl / flash.duration) : 0;

      ctx.save();
      roundedRect(x, y + unit * 0.06, size, size, unit * 0.09);
      ctx.fillStyle = 'rgba(2, 6, 13, 0.55)';
      ctx.fill();

      roundedRect(x, y, size, size, unit * 0.09);
      ctx.fillStyle = isPlayer ? 'rgba(27, 76, 56, 0.95)' : 'rgba(91, 33, 40, 0.95)';
      ctx.fill();

      if (flashAlpha > 0) {
        ctx.globalAlpha = flashAlpha * 0.55;
        roundedRect(x, y, size, size, unit * 0.09);
        ctx.fillStyle = flash.color;
        ctx.fill();
        ctx.globalAlpha = 1;
      }

      ctx.strokeStyle = isPlayer
        ? `rgba(93, 232, 166, ${0.55 + flashAlpha * 0.45})`
        : `rgba(255, 107, 98, ${0.5 + flashAlpha * 0.5})`;
      ctx.lineWidth = flash ? 2.4 : 1.6;
      roundedRect(x, y, size, size, unit * 0.09);
      ctx.stroke();

      ctx.fillStyle = isPlayer ? 'rgba(200, 255, 228, 0.2)' : 'rgba(255, 196, 190, 0.18)';
      ctx.fillRect(center.x - size * 0.26, y + size * 0.78, size * 0.52, 1);

      ctx.font = `700 ${unit * 0.31}px "Consolas", monospace`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.lineWidth = Math.max(2, unit * 0.055);
      ctx.strokeStyle = 'rgba(5, 9, 15, 0.9)';
      if (flash) ctx.strokeText(state.key, center.x, center.y - unit * 0.01);
      ctx.fillStyle = flash
        ? '#ffffff'
        : isPlayer
          ? '#e2fff0'
          : '#ffe4e1';
      ctx.fillText(state.key, center.x, center.y - unit * 0.01);
      ctx.restore();
    }
  }

  function drawEffects() {
    for (const effect of effects) {
      const alpha = Math.max(0, effect.ttl / effect.duration);
      if (effect.type === 'ring') {
        const center = tileCenter(effect.key);
        ctx.save();
        ctx.strokeStyle = `rgba(${effect.color}, ${alpha})`;
        ctx.lineWidth = 2.4;
        ctx.beginPath();
        ctx.arc(center.x, center.y, layout.unit * (0.28 + (1 - alpha) * 0.55), 0, Math.PI * 2);
        ctx.stroke();
        ctx.restore();
      } else if (effect.type === 'float') {
        ctx.save();
        ctx.globalAlpha = Math.min(1, alpha * 2);
        ctx.fillStyle = effect.color;
        ctx.font = `700 ${Math.max(15, layout.unit * 0.22)}px "Consolas", monospace`;
        ctx.textAlign = 'center';
        ctx.fillText(effect.text, effect.x, effect.y);
        ctx.restore();
      }
    }
  }

  function render() {
    const dpr = Number(canvas.dataset.dpr || 1);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, layout.width, layout.height);
    drawBackground();
    drawKeys();
    drawEffects();
  }

  function frame(now) {
    const dt = Math.min(0.05, Math.max(0, (now - lastTime) / 1000));
    lastTime = now;
    if (started && !paused && game.status === 'playing') {
      game.update(dt);
      for (const event of game.drainEvents()) {
        if (event.type === 'bot-flip') addBotEffects(event);
      }
      updateEffects(dt);
      if (!lastTenShown && game.duration - game.time <= 10) {
        lastTenShown = true;
        showAnnouncement('最后 10 秒，积分冲刺！');
      }
    }
    if (started && game.status !== 'playing' && overlay.hidden) finishGame();
    updateHud();
    render();
    requestAnimationFrame(frame);
  }

  window.addEventListener('keydown', (event) => {
    if (event.repeat) {
      if (/^[a-z]$/i.test(event.key)) event.preventDefault();
      return;
    }
    if (event.key === 'Enter') {
      event.preventDefault();
      if (!started || game.status !== 'playing') startGame();
      else if (paused) resumeGame();
      return;
    }
    if (/^[1-3]$/.test(event.key) && !overlay.hidden && (!started || game.status !== 'playing')) {
      event.preventDefault();
      setDifficulty(['easy', 'normal', 'hard'][Number(event.key) - 1]);
      return;
    }
    if (event.key === 'Escape') {
      event.preventDefault();
      if (!started || game.status !== 'playing') return;
      if (paused) resumeGame();
      else pauseGame();
      return;
    }
    if (!started || paused || game.status !== 'playing') return;
    const key = event.key.toUpperCase();
    if (!/^[A-Z]$/.test(key)) return;
    event.preventDefault();
    const result = game.strike(key);
    if (result.type === 'flip' || result.type === 'mistake') addStrikeEffects(result);
  });

  startButton.addEventListener('click', () => {
    if (started && paused && game.status === 'playing') resumeGame();
    else startGame();
  });

  difficultyButtons.forEach((button) => {
    button.addEventListener('click', () => setDifficulty(button.dataset.difficulty));
  });

  document.addEventListener('visibilitychange', () => {
    if (document.hidden && started && !paused && game.status === 'playing') pauseGame();
  });

  new ResizeObserver(resizeCanvas).observe(shell);
  resizeCanvas();
  updateHud();
  requestAnimationFrame(frame);
})();
