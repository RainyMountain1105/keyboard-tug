(() => {
  'use strict';

  const { KEY_ROWS, getKeyInfo } = window.KeyboardTugCore;
  const $ = (id) => document.getElementById(id);
  const canvas = $('gameCanvas');
  const ctx = canvas.getContext('2d');
  const shell = $('gameShell');
  const overlay = $('overlay');
  const roomPanel = $('roomPanel');
  const waitingPanel = $('waitingPanel');
  const resultStats = $('resultStats');
  const restartButton = $('restartButton');
  const roomInput = $('roomInput');
  const formError = $('formError');
  const announcement = $('announcement');

  let socket = null;
  let pendingAction = null;
  let side = null;
  let roomCode = '';
  let state = null;
  let restartRequested = false;
  let notice = '';
  let audioContext = null;
  let effects = [];
  let keyEffects = {};
  let announcementTimer = 0;
  let lastTime = performance.now();
  let layout = { unit: 60, originX: 0, originY: 0, rowGap: 75, width: 800, height: 400 };

  function socketUrl() {
    const protocol = location.protocol === 'https:' ? 'wss:' : 'ws:';
    return `${protocol}//${location.host}/ws`;
  }

  function setConnection(text, active = false) {
    $('connectionStatus').classList.toggle('active', active);
    $('connectionStatus').lastChild.textContent = text;
  }

  function ensureAudio() {
    if (!audioContext) {
      const AudioContextClass = window.AudioContext || window.webkitAudioContext;
      if (AudioContextClass) audioContext = new AudioContextClass();
    }
    if (audioContext) audioContext.resume();
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

  function showAnnouncement(text, danger = false) {
    announcement.textContent = text;
    announcement.classList.toggle('danger', danger);
    announcement.classList.add('visible');
    announcementTimer = 1.6;
  }

  function send(message) {
    if (socket && socket.readyState === WebSocket.OPEN) socket.send(JSON.stringify(message));
  }

  function connect(action) {
    pendingAction = action;
    notice = '';
    formError.textContent = '';
    if (socket && socket.readyState === WebSocket.OPEN) {
      const next = pendingAction;
      pendingAction = null;
      next();
      return;
    }
    if (socket && socket.readyState === WebSocket.CONNECTING) return;

    setConnection('连接中');
    socket = new WebSocket(socketUrl());
    socket.addEventListener('open', () => {
      setConnection('已连接', true);
      const next = pendingAction;
      pendingAction = null;
      if (next) next();
    });
    socket.addEventListener('message', (event) => {
      let message;
      try {
        message = JSON.parse(event.data);
      } catch {
        return;
      }
      handleMessage(message);
    });
    socket.addEventListener('close', () => {
      socket = null;
      pendingAction = null;
      setConnection('已断线');
      if (!notice) notice = '与服务器断开，请重新创建或加入房间。';
      showLobby(notice);
    });
    socket.addEventListener('error', () => {
      notice = '无法连接对战服务器，请稍后重试。';
    });
  }

  function showLobby(error = '') {
    overlay.hidden = false;
    roomPanel.hidden = false;
    waitingPanel.hidden = true;
    resultStats.hidden = true;
    restartButton.hidden = true;
    restartButton.disabled = false;
    restartButton.textContent = '再来一局';
    $('overlayEyebrow').textContent = '网页双人 · 无需安装';
    $('overlayTitle').textContent = '叫上朋友，抢下整片键区。';
    $('overlayDescription').textContent = '创建房间后，把四位房间码或链接发给一位朋友。按下字母键翻牌：红变绿，绿变红；每秒按双方键数结算积分，60 秒后积分高者获胜，提前清一色则立即获胜。';
    formError.textContent = error;
    state = null;
    side = null;
    roomCode = '';
    restartRequested = false;
    $('roomStatus').textContent = '尚未进入房间';
    $('greenBadge').textContent = '绿方';
    $('redBadge').textContent = '红方';
    effects = [];
    keyEffects = {};
    updateHud();
  }

  function showWaiting() {
    overlay.hidden = false;
    roomPanel.hidden = true;
    waitingPanel.hidden = false;
    resultStats.hidden = true;
    restartButton.hidden = true;
    $('overlayEyebrow').textContent = '房间已创建';
    $('overlayTitle').textContent = '等一位对手进场。';
    $('overlayDescription').textContent = '对方打开链接会自动加入；也可以手动输入下面的四位房间码。';
    $('roomCodeText').textContent = roomCode;
    const url = new URL('versus.html', location.href);
    url.search = '';
    url.searchParams.set('room', roomCode);
    $('shareLink').value = url.href;
    $('roomStatus').textContent = `房间 ${roomCode} · 等待对手`;
    formError.textContent = '';
  }

  function showError(message) {
    notice = '';
    showLobby(message);
    roomInput.focus();
  }

  function handleMessage(message) {
    if (message.t === 'created') {
      side = message.side;
      roomCode = message.room;
      setConnection('房间内', true);
      showWaiting();
      return;
    }
    if (message.t === 'joined') {
      side = message.side;
      roomCode = message.room;
      setConnection('已入场', true);
      $('roomStatus').textContent = `房间 ${roomCode} · 正在开局`;
      return;
    }
    if (message.t === 'start') {
      state = message.state;
      restartRequested = false;
      effects = [];
      keyEffects = {};
      overlay.hidden = true;
      restartButton.hidden = true;
      restartButton.disabled = false;
      restartButton.textContent = '再来一局';
      setConnection('对战中', true);
      $('roomStatus').textContent = `房间 ${roomCode}`;
      $('greenBadge').textContent = side === 'player' ? '你 · 绿' : '绿 · 对手';
      $('redBadge').textContent = side === 'bot' ? '你 · 红' : '红 · 对手';
      showAnnouncement(`你是${side === 'player' ? '绿方' : '红方'} · 对战开始`);
      updateHud();
      return;
    }
    if (message.t === 'state') {
      state = message.state;
      for (const event of message.events || []) addEventEffects(event);
      updateHud();
      if (state.status === 'finished' && overlay.hidden) finishGame();
      return;
    }
    if (message.t === 'restart_wait') {
      if (message.ready.includes(side)) {
        restartButton.disabled = true;
        restartButton.textContent = '等待对手确认…';
      } else {
        showAnnouncement('对手已准备再来一局');
      }
      return;
    }
    if (message.t === 'peer_left') {
      notice = '对手已离开，房间已关闭。你可以创建新房间。';
      if (socket) socket.close();
      return;
    }
    if (message.t === 'error') {
      showError(message.code === 'not_found' ? '没有找到这个房间，请检查房间码。' : '房间已满或已经开局。');
    }
  }

  function finishGame() {
    const won = state.winner === side;
    const draw = state.winner === 'draw';
    const mine = state.sides[side].stats;
    const attempts = mine.flips + mine.mistakes;
    const sweep = state.endReason === 'sweep';
    $('overlayEyebrow').textContent = won ? '翻牌胜利' : draw ? '平局' : '翻牌失败';
    $('overlayTitle').textContent = won
      ? (sweep ? '整片键区，都是你的颜色。' : '时间到，你的积分更高。')
      : draw
        ? '时间到，双方打成平手。'
        : (sweep ? '对手先完成了清一色。' : '时间到，对手积分更高。');
    $('overlayDescription').textContent = `最终积分 绿 ${state.score.player} : 红 ${state.score.bot}，键数 ${state.counts.player} : ${state.counts.bot}。双方都确认后立即开始下一局。`;
    roomPanel.hidden = true;
    waitingPanel.hidden = true;
    resultStats.innerHTML = `
      <div><span>我的翻绿</span><strong>${mine.flips}</strong></div>
      <div><span>我的失误</span><strong>${mine.mistakes}</strong></div>
      <div><span>命中率</span><strong>${attempts ? Math.round(mine.flips / attempts * 100) : 0}%</strong></div>`;
    resultStats.hidden = false;
    restartButton.hidden = false;
    restartButton.disabled = restartRequested;
    overlay.hidden = false;
    setConnection('本局结束', true);
  }

  function createRoom() {
    ensureAudio();
    connect(() => send({ t: 'create' }));
  }

  function joinRoom() {
    ensureAudio();
    const room = roomInput.value.toUpperCase().trim();
    if (!/^[A-Z2-9]{4}$/.test(room)) {
      formError.textContent = '请输入四位房间码。';
      roomInput.focus();
      return;
    }
    connect(() => send({ t: 'join', room }));
  }

  function strike(key) {
    if (!state || state.status !== 'playing' || !overlay.hidden || !side) return;
    ensureAudio();
    send({ t: 'strike', key });
  }

  function resizeCanvas() {
    const rect = shell.getBoundingClientRect();
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    canvas.width = Math.max(1, Math.round(rect.width * dpr));
    canvas.height = Math.max(1, Math.round(rect.height * dpr));
    canvas.dataset.dpr = dpr;
    const unit = Math.max(20, Math.min(88, (rect.width - 24) / 9.84, (rect.height - 24) / 3.34));
    layout = {
      unit,
      originX: (rect.width - 9 * unit) / 2,
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

  function addEventEffects(event) {
    if (!event.key) return;
    const own = event.side === side;
    const center = tileCenter(event.key);

    if (event.type === 'flip') {
      const ownerSide = event.side;
      const ownerColor = ownerSide === 'player' ? '86, 227, 155' : '255, 107, 98';
      keyEffects[event.key] = {
        color: ownerSide === 'player' ? '#7dffc4' : '#ff8b84',
        ttl: 0.28,
        duration: 0.28
      };
      effects.push({ type: 'ring', key: event.key, color: ownerColor, ttl: 0.4, duration: 0.4 });
      effects.push({
        type: 'float', x: center.x, y: center.y - layout.unit * 0.4,
        text: own ? '+1' : '对手',
        color: own ? '#a5f5ca' : '#ffb0aa', ttl: 0.75, duration: 0.75
      });
      playTone(own ? 320 : 190, own ? 580 : 120, own ? 'triangle' : 'sawtooth', 0.08, own ? 0.045 : 0.022);
    } else if (event.type === 'mistake') {
      const newOwner = event.side === 'player' ? 'bot' : 'player';
      const ownerColor = newOwner === 'player' ? '86, 227, 155' : '255, 107, 98';
      keyEffects[event.key] = {
        color: newOwner === 'player' ? '#7dffc4' : '#ff8b84',
        ttl: 0.25,
        duration: 0.25
      };
      effects.push({ type: 'ring', key: event.key, color: ownerColor, ttl: 0.35, duration: 0.35 });
      effects.push({
        type: 'float', x: center.x, y: center.y - layout.unit * 0.4,
        text: own ? '-1' : '对手失误',
        color: '#ff9d95', ttl: 0.75, duration: 0.75
      });
      playTone(own ? 130 : 170, 70, 'square', 0.1, 0.035);
    }
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
    const self = side && state ? state.sides[side] : null;
    const opponentSide = side === 'player' ? 'bot' : 'player';
    const opponent = side && state ? state.sides[opponentSide] : null;
    const counts = state ? state.counts : { player: 13, bot: 13 };
    const score = state ? state.score : { player: 0, bot: 0 };
    const remaining = state ? Math.max(0, Math.ceil(state.duration - state.time)) : 60;

    $('tugScoreText').textContent = `${counts.player} : ${counts.bot}`;
    $('tugPlayerFill').style.width = `${counts.player / 26 * 100}%`;
    $('greenScoreText').textContent = score.player;
    $('redScoreText').textContent = score.bot;
    $('vsTimeText').textContent = remaining;

    const stats = self ? self.stats : { flips: 0, mistakes: 0, streak: 0, bestStreak: 0 };
    $('flipsText').textContent = stats.flips;
    $('opponentFlipsText').textContent = opponent ? opponent.stats.flips : 0;
    $('mistakesText').textContent = stats.mistakes;
    $('streakText').textContent = stats.streak;
    $('bestStreakText').textContent = stats.bestStreak;
  }

  function drawBackground() {
    ctx.fillStyle = '#0c1320';
    ctx.fillRect(0, 0, layout.width, layout.height);
    const grid = Math.max(28, layout.unit * 0.65);
    ctx.strokeStyle = 'rgba(89, 113, 148, 0.055)';
    ctx.lineWidth = 1;
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
    if (!state) return;
    const unit = layout.unit;
    const size = unit * 0.84;
    for (const tile of state.keys) {
      const center = tileCenter(tile.key);
      const x = center.x - size / 2;
      const y = center.y - size / 2;
      const flash = keyEffects[tile.key];
      const green = tile.owner === 'player';
      const flashAlpha = flash ? Math.max(0, flash.ttl / flash.duration) : 0;

      ctx.save();
      roundedRect(x, y + unit * 0.06, size, size, unit * 0.09);
      ctx.fillStyle = 'rgba(2, 6, 13, 0.55)';
      ctx.fill();
      roundedRect(x, y, size, size, unit * 0.09);
      ctx.fillStyle = green ? 'rgba(27, 76, 56, 0.95)' : 'rgba(91, 33, 40, 0.95)';
      ctx.fill();
      if (flashAlpha > 0) {
        ctx.globalAlpha = flashAlpha * 0.55;
        ctx.fillStyle = flash.color;
        ctx.fill();
        ctx.globalAlpha = 1;
      }
      ctx.strokeStyle = green
        ? `rgba(93, 232, 166, ${0.55 + flashAlpha * 0.45})`
        : `rgba(255, 107, 98, ${0.5 + flashAlpha * 0.5})`;
      ctx.lineWidth = flash ? 2.4 : 1.6;
      roundedRect(x, y, size, size, unit * 0.09);
      ctx.stroke();

      ctx.font = `700 ${Math.max(10, unit * 0.31)}px "Consolas", monospace`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillStyle = green ? '#e2fff0' : '#ffe4e1';
      ctx.fillText(tile.key, center.x, center.y - unit * 0.01);
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
      } else {
        ctx.save();
        ctx.globalAlpha = Math.min(1, alpha * 2);
        ctx.fillStyle = effect.color;
        ctx.font = `700 ${Math.max(12, layout.unit * 0.22)}px "Consolas", "Microsoft YaHei", sans-serif`;
        ctx.textAlign = 'center';
        ctx.fillText(effect.text, effect.x, effect.y);
        ctx.restore();
      }
    }
  }

  function frame(now) {
    const dt = Math.min(0.05, Math.max(0, (now - lastTime) / 1000));
    lastTime = now;
    updateEffects(dt);
    const dpr = Number(canvas.dataset.dpr || 1);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, layout.width, layout.height);
    drawBackground();
    drawKeys();
    drawEffects();
    requestAnimationFrame(frame);
  }

  $('createButton').addEventListener('click', createRoom);
  $('joinButton').addEventListener('click', joinRoom);
  roomInput.addEventListener('input', () => {
    roomInput.value = roomInput.value.toUpperCase().replace(/[^A-Z2-9]/g, '').slice(0, 4);
    formError.textContent = '';
  });
  roomInput.addEventListener('keydown', (event) => {
    if (event.key === 'Enter') joinRoom();
  });
  $('copyButton').addEventListener('click', async () => {
    $('shareLink').select();
    try {
      await navigator.clipboard.writeText($('shareLink').value);
      $('copyButton').textContent = '已复制';
    } catch {
      document.execCommand('copy');
      $('copyButton').textContent = '已复制';
    }
    setTimeout(() => { $('copyButton').textContent = '复制'; }, 1400);
  });
  restartButton.addEventListener('click', () => {
    if (!state || state.status !== 'finished') return;
    restartRequested = true;
    restartButton.disabled = true;
    restartButton.textContent = '等待对手确认…';
    send({ t: 'restart' });
  });

  window.addEventListener('keydown', (event) => {
    if (event.target === roomInput || event.target === $('shareLink')) return;
    if (event.repeat) {
      if (/^[a-z]$/i.test(event.key)) event.preventDefault();
      return;
    }
    const key = event.key.toUpperCase();
    if (!/^[A-Z]$/.test(key)) return;
    event.preventDefault();
    strike(key);
  });

  canvas.addEventListener('pointerdown', (event) => {
    event.preventDefault();
    const rect = canvas.getBoundingClientRect();
    const x = event.clientX - rect.left;
    const y = event.clientY - rect.top;
    for (const row of KEY_ROWS) {
      for (const key of row) {
        const center = tileCenter(key);
        if (Math.abs(x - center.x) <= layout.unit * 0.48 && Math.abs(y - center.y) <= layout.unit * 0.48) {
          strike(key);
          return;
        }
      }
    }
  });
  canvas.addEventListener('contextmenu', (event) => event.preventDefault());

  new ResizeObserver(resizeCanvas).observe(shell);
  resizeCanvas();
  updateHud();
  requestAnimationFrame(frame);

  const initialRoom = new URLSearchParams(location.search).get('room');
  if (initialRoom) {
    roomInput.value = initialRoom.toUpperCase().replace(/[^A-Z2-9]/g, '').slice(0, 4);
    joinRoom();
  }
})();
