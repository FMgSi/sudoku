import {
  DIFFICULTIES,
  computeFilledMask,
  computeProgress,
  formatDuration,
  stringToBoard,
  validateCompletedBoard,
} from './sudoku.js';
import {
  DemoTransport,
  FirebaseTransport,
  PLAYER_COLORS,
  clearLocalFirebaseConfig,
  getEffectiveFirebaseConfig,
  saveLocalFirebaseConfig,
} from './realtime.js';

const $ = (id) => document.getElementById(id);

const STATE_STORAGE_PREFIX = 'usdoku_local_board_';
const LAST_NAME_KEY = 'usdoku_last_player_name';
const AUTO_NOTES_KEY = 'usdoku_auto_remove_notes';
const NOTES_SOUND_KEY = 'usdoku_notes_sound';
const PROGRESS_CIRCUMFERENCE = 2 * Math.PI * 20; // r = 20 -> ~125.66

let transport = null;
let currentRoom = null;
let selectedDifficulty = 'medium';
let newRoundDifficulty = 'medium';

// Local player game state
let activeRound = 0;
let puzzleArr = new Array(81).fill(0);
let boardArr = new Array(81).fill(0);
let notesArr = new Array(81).fill(0);
let historyStack = [];
let selectedCell = -1;
let notesMode = false;
let localFinished = false;
let localFinishTimeMs = null;
let conflictSet = new Set();
let timerInterval = null;
let lastSeenChatCount = 0;
let chatOpen = false;
let autoRemoveNotes = localStorage.getItem(AUTO_NOTES_KEY) !== 'false';
let notesSoundEnabled = localStorage.getItem(NOTES_SOUND_KEY) !== 'false';
let clearConfirmPending = false;
let clearConfirmTimer = null;
let audioCtx = null;

function playNotesToggleSound(isOn) {
  if (!notesSoundEnabled) return;
  try {
    const AudioContextCtor = window.AudioContext || window.webkitAudioContext;
    if (!AudioContextCtor) return;
    if (!audioCtx) {
      audioCtx = new AudioContextCtor();
    }
    if (audioCtx.state === 'suspended') {
      audioCtx.resume();
    }

    const now = audioCtx.currentTime;
    const osc = audioCtx.createOscillator();
    const gain = audioCtx.createGain();
    osc.type = 'triangle';

    const startFreq = isOn ? 587.33 : 659.25;
    const endFreq = isOn ? 880 : 440;
    osc.frequency.setValueAtTime(startFreq, now);
    osc.frequency.exponentialRampToValueAtTime(endFreq, now + 0.08);

    gain.gain.setValueAtTime(0.001, now);
    gain.gain.linearRampToValueAtTime(0.45, now + 0.015);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.13);

    osc.connect(gain);
    gain.connect(audioCtx.destination);
    osc.start(now);
    osc.stop(now + 0.14);
  } catch {
    // Ignore audio errors on restricted devices
  }
}

// ---------- Utilities ----------
function escapeHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function showToast(msg, type = 'info') {
  const container = $('toast-container');
  const el = document.createElement('div');
  el.className = `toast ${type}`;
  el.textContent = msg;
  container.appendChild(el);
  setTimeout(() => {
    el.remove();
  }, 2800);
}

function showView(name) {
  for (const id of ['view-home', 'view-lobby', 'view-game']) {
    $(id).classList.toggle('active', id === `view-${name}`);
  }
}

function openModal(id) {
  $(id).classList.remove('hidden');
}

function closeModal(id) {
  $(id).classList.add('hidden');
}

function setDiffGroupActive(containerId, diff) {
  const buttons = $(containerId).querySelectorAll('.diff-btn');
  buttons.forEach((btn) => {
    btn.classList.toggle('active', btn.dataset.diff === diff);
  });
}

function updateFirebaseBadge() {
  const { config, source } = getEffectiveFirebaseConfig();
  const badge = $('connection-badge');
  if (config) {
    badge.className = 'status-pill status-ok';
    badge.textContent = source === 'local' ? 'Firebase (Cấu hình tạm)' : 'Firebase đã sẵn sàng';
  } else {
    badge.className = 'status-pill status-warn';
    badge.textContent = 'Chưa gắn Firebase';
  }
}

function getBoardStorageKey(code, round, playerId) {
  return `${STATE_STORAGE_PREFIX}${code}_${round}_${playerId}`;
}

function saveLocalBoard() {
  if (!currentRoom || !transport) return;
  try {
    const key = getBoardStorageKey(currentRoom.code, activeRound, transport.playerId);
    localStorage.setItem(
      key,
      JSON.stringify({
        puzzle: currentRoom.puzzle,
        board: boardArr,
        notes: notesArr,
        finished: localFinished,
        finishTimeMs: localFinishTimeMs,
      })
    );
  } catch {
    // Ignore quota errors
  }
}

function tryRestoreLocalBoard(code, round, playerId, expectedPuzzle) {
  try {
    const raw = localStorage.getItem(getBoardStorageKey(code, round, playerId));
    if (!raw) return null;
    const data = JSON.parse(raw);
    if (
      data &&
      data.puzzle === expectedPuzzle &&
      Array.isArray(data.board) &&
      data.board.length === 81 &&
      Array.isArray(data.notes) &&
      data.notes.length === 81
    ) {
      return data;
    }
  } catch {
    // Ignore parse errors
  }
  return null;
}

function clearSavedBoardForRoom(code) {
  try {
    const prefix = `${STATE_STORAGE_PREFIX}${code}_`;
    for (let i = localStorage.length - 1; i >= 0; i--) {
      const k = localStorage.key(i);
      if (k && k.startsWith(prefix)) {
        localStorage.removeItem(k);
      }
    }
  } catch {
    // Ignore
  }
}

// ---------- Player Sorting & Rendering ----------
function getSortedPlayers(room) {
  const list = Object.values(room?.players || {});
  return list.slice().sort((a, b) => {
    if (a.finished && b.finished) {
      return (a.finishTimeMs ?? Infinity) - (b.finishTimeMs ?? Infinity);
    }
    if (a.finished) return -1;
    if (b.finished) return 1;
    if ((b.progress || 0) !== (a.progress || 0)) {
      return (b.progress || 0) - (a.progress || 0);
    }
    return (a.joinedAt || 0) - (b.joinedAt || 0);
  });
}

function renderLobby(room) {
  showView('lobby');
  $('lobby-room-code').textContent = room.code;
  $('lobby-mode-badge').textContent = transport?.mode === 'demo' ? 'Demo Offline' : 'Online Firebase';

  const diffCfg = DIFFICULTIES[room.difficulty] || DIFFICULTIES.medium;
  $('lobby-diff-badge').textContent = diffCfg.label;

  const isHost = room.hostId === transport.playerId;
  $('lobby-diff-controls').classList.toggle('hidden', !isHost);
  setDiffGroupActive('lobby-diff-controls', room.difficulty || 'medium');

  $('btn-start-game').classList.toggle('hidden', !isHost);
  $('lobby-wait-msg').classList.toggle('hidden', isHost);

  const players = Object.values(room.players || {}).sort(
    (a, b) => (a.joinedAt || 0) - (b.joinedAt || 0)
  );
  $('lobby-player-count').textContent = `${players.length} người`;

  const hostPlayer = room.players?.[room.hostId];
  const canClaimHost = !isHost && (!hostPlayer || hostPlayer.online === false);
  $('btn-claim-host').classList.toggle('hidden', !canClaimHost);

  const ul = $('lobby-players-list');
  ul.innerHTML = players
    .map((p) => {
      const color = PLAYER_COLORS[(p.colorIndex || 0) % PLAYER_COLORS.length];
      const initial = escapeHtml((p.name || '?').trim().charAt(0).toUpperCase() || '?');
      const isMe = p.id === transport.playerId;
      const isRoomHost = p.id === room.hostId;
      const onlineClass = p.online === false ? 'online-dot offline' : 'online-dot';
      return `
        <li class="lobby-player-item">
          <div class="lobby-player-left">
            <span class="avatar-circle" style="background:${color.avatar}">${initial}</span>
            <div>
              <strong>${escapeHtml(p.name)}</strong>
              ${isMe ? '<span style="color:#2563eb;font-size:0.8rem;font-weight:700;"> (Bạn)</span>' : ''}
            </div>
          </div>
          <div style="display:flex;align-items:center;gap:8px;">
            ${isRoomHost ? '<span class="host-tag">Chủ phòng</span>' : ''}
            <span class="${onlineClass}" title="${p.online === false ? 'Mất kết nối' : 'Đang online'}"></span>
          </div>
        </li>
      `;
    })
    .join('');
}

function buildSudokuGridDom() {
  const boardEl = $('sudoku-board');
  boardEl.innerHTML = '';
  for (let i = 0; i < 81; i++) {
    const r = (i / 9) | 0;
    const c = i % 9;
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'cell';
    btn.dataset.index = String(i);
    if (c === 2 || c === 5) btn.classList.add('border-right-thick');
    if (r === 2 || r === 5) btn.classList.add('border-bottom-thick');
    if (c === 8) btn.classList.add('no-right-border');
    if (r === 8) btn.classList.add('no-bottom-border');
    boardEl.appendChild(btn);
  }
}

function renderSudokuBoard() {
  const boardEl = $('sudoku-board');
  const cells = boardEl.children;
  if (cells.length !== 81) return;

  const selRow = selectedCell >= 0 ? (selectedCell / 9) | 0 : -1;
  const selCol = selectedCell >= 0 ? selectedCell % 9 : -1;
  const selBox = selectedCell >= 0 ? ((selRow / 3) | 0) * 3 + ((selCol / 3) | 0) : -1;
  const selVal = selectedCell >= 0 ? boardArr[selectedCell] : 0;

  for (let i = 0; i < 81; i++) {
    const cell = cells[i];
    const r = (i / 9) | 0;
    const c = i % 9;
    const b = ((r / 3) | 0) * 3 + ((c / 3) | 0);
    const val = boardArr[i];
    const isClue = puzzleArr[i] !== 0;

    cell.classList.toggle('is-clue', isClue);
    cell.classList.toggle('is-selected', i === selectedCell);
    cell.classList.toggle(
      'is-peer',
      selectedCell >= 0 && i !== selectedCell && (r === selRow || c === selCol || b === selBox)
    );
    cell.classList.toggle(
      'is-same-num',
      selVal > 0 && i !== selectedCell && val === selVal
    );
    cell.classList.toggle('is-conflict', conflictSet.has(i));

    if (val > 0) {
      cell.textContent = String(val);
    } else if (notesArr[i] > 0) {
      let html = '<span class="cell-notes">';
      for (let d = 1; d <= 9; d++) {
        const has = (notesArr[i] & (1 << d)) !== 0;
        const sameNoteCls = has && selVal === d ? ' is-same-note' : '';
        html += `<span class="note-digit${sameNoteCls}">${has ? d : ''}</span>`;
      }
      html += '</span>';
      cell.innerHTML = html;
    } else {
      cell.textContent = '';
    }
  }

  const numBtns = $('numpad').children;
  for (let k = 0; k < numBtns.length; k++) {
    const btn = numBtns[k];
    btn.classList.toggle('is-active-num', selVal > 0 && Number(btn.dataset.num) === selVal);
  }
}

function renderProgressRing(progress) {
  const pct = Math.max(0, Math.min(100, progress));
  const offset = PROGRESS_CIRCUMFERENCE * (1 - pct / 100);
  $('progress-ring-circle').style.strokeDashoffset = String(offset);
  $('progress-ring-text').textContent = `${pct}%`;
}

function renderTopPlayersBar(sortedPlayers) {
  const bar = $('top-players-bar');
  bar.innerHTML = sortedPlayers
    .map((p, idx) => {
      const color = PLAYER_COLORS[(p.colorIndex || 0) % PLAYER_COLORS.length];
      const initial = escapeHtml((p.name || '?').trim().charAt(0).toUpperCase() || '?');
      const isMe = p.id === transport.playerId;
      const pct = isMe ? computeProgress(boardArr, puzzleArr) : p.progress || 0;
      const rankBg = idx === 0 ? '#fcd34d' : '#e2e8f0';
      return `
        <div class="top-player-cell ${isMe ? 'is-me' : ''}">
          <div class="avatar-circle" style="background:${color.avatar}">
            ${initial}
            <span class="rank-corner-badge" style="background:${rankBg}">${idx + 1}</span>
          </div>
          <div class="top-player-info">
            <span class="top-player-name">${escapeHtml(p.name)}</span>
            <span class="top-player-pct">${pct}%${p.finished ? ' ✓' : ''}</span>
          </div>
        </div>
      `;
    })
    .join('');
}

function renderMiniBoardHtml(filledMask, color) {
  let html = '<div class="mini-board" aria-hidden="true">';
  for (let i = 0; i < 81; i++) {
    const r = (i / 9) | 0;
    const c = i % 9;
    const isClue = puzzleArr[i] !== 0;
    const isFilled = !isClue && filledMask && filledMask[i] === '1';

    let cls = 'mini-cell';
    if (c === 2 || c === 5) cls += ' mini-br';
    if (r === 2 || r === 5) cls += ' mini-bb';
    if (isClue) cls += ' mini-clue';

    const style = isFilled ? ` style="background:${color.miniCell}"` : '';
    html += `<span class="${cls}"${style}></span>`;
  }
  html += '</div>';
  return html;
}

function renderStandings(sortedPlayers) {
  const container = $('standings-list');
  container.innerHTML = sortedPlayers
    .map((p, idx) => {
      const color = PLAYER_COLORS[(p.colorIndex || 0) % PLAYER_COLORS.length];
      const isMe = p.id === transport.playerId;
      const pct = isMe ? computeProgress(boardArr, puzzleArr) : p.progress || 0;
      const mask = isMe ? computeFilledMask(boardArr, puzzleArr) : p.filledMask || '0'.repeat(81);

      let statusText = 'Still solving';
      if (p.finished) {
        statusText = `Hoàn thành • ${formatDuration(p.finishTimeMs || 0)}`;
      } else if (pct === 100) {
        statusText = 'Đủ 100% • Đang kiểm tra lại lỗi';
      } else if (p.online === false) {
        statusText = 'Đang giải • Mất kết nối';
      }

      return `
        <article class="standing-card" style="background:${color.card}">
          <span class="standing-rank">${idx + 1}</span>
          ${renderMiniBoardHtml(mask, color)}
          <div class="standing-info">
            <div class="standing-name-row">
              <span class="color-square" style="background:${color.miniCell}"></span>
              <span class="standing-name-text">${escapeHtml(p.name)}${isMe ? ' (Bạn)' : ''}</span>
            </div>
            <div class="standing-status">${statusText}</div>
          </div>
          <span class="standing-pct">${pct}%</span>
        </article>
      `;
    })
    .join('');
}

function updateBannerAndButtons() {
  const banner = $('game-status-banner');
  const isHost = currentRoom?.hostId === transport?.playerId;
  $('btn-new-round-top').classList.toggle('hidden', !isHost);

  if (localFinished) {
    const sorted = getSortedPlayers(currentRoom);
    const myRank = sorted.findIndex((p) => p.id === transport.playerId) + 1;
    banner.className = 'game-banner victory';
    banner.innerHTML = `
      <div>Chúc mừng! Bạn đã hoàn thành đúng 100% trong <strong>${formatDuration(localFinishTimeMs || 0)}</strong> (Hạng #${myRank || 1}).</div>
      ${isHost ? '<button id="banner-new-round-btn" class="btn btn-primary btn-small" type="button">Mở ván mới cho cả phòng</button>' : ''}
    `;
    banner.classList.remove('hidden');
    const newRoundBtn = $('banner-new-round-btn');
    if (newRoundBtn) {
      newRoundBtn.onclick = () => openNewRoundModal();
    }
  } else if (conflictSet.size > 0) {
    banner.className = 'game-banner error';
    banner.textContent =
      'Bạn đã điền đủ 100% nhưng bảng chưa chính xác! Các ô đang trùng số trong hàng/cột/khối 3×3 được tô đỏ — hãy sửa lại nhé.';
    banner.classList.remove('hidden');
  } else {
    banner.classList.add('hidden');
    banner.textContent = '';
  }
}

function renderChat(room) {
  const messagesObj = room?.chat || {};
  const list = Object.values(messagesObj).sort((a, b) => (a.ts || 0) - (b.ts || 0));

  if (!chatOpen && list.length > lastSeenChatCount) {
    $('chat-unread-dot').classList.remove('hidden');
  }
  if (chatOpen) {
    lastSeenChatCount = list.length;
    $('chat-unread-dot').classList.add('hidden');
  }

  const box = $('chat-messages');
  box.innerHTML =
    list.length === 0
      ? '<p style="color:#6b7280;text-align:center;margin:auto;font-size:0.86rem;">Chưa có tin nhắn nào. Hãy nhắn gì đó!</p>'
      : list
          .map((m) => {
            const color = PLAYER_COLORS[(m.colorIndex || 0) % PLAYER_COLORS.length];
            return `
              <div class="chat-msg" style="border-left: 4px solid ${color.miniCell}">
                <span class="chat-msg-author">${escapeHtml(m.name)}:</span>
                <span>${escapeHtml(m.text)}</span>
              </div>
            `;
          })
          .join('');
  box.scrollTop = box.scrollHeight;
}

function startTimerLoop() {
  if (timerInterval) clearInterval(timerInterval);
  const updateClock = () => {
    if (!currentRoom || currentRoom.status !== 'playing' || !transport) return;
    if (localFinished && localFinishTimeMs != null) {
      $('game-timer').textContent = formatDuration(localFinishTimeMs);
      return;
    }
    const elapsed = Math.max(0, transport.nowServer() - (currentRoom.startedAt || transport.nowServer()));
    $('game-timer').textContent = formatDuration(elapsed);
  };
  updateClock();
  timerInterval = setInterval(updateClock, 500);
}

function syncRoundIfChanged(room) {
  if (room.status !== 'playing' || !room.puzzle) return;
  if (room.round === activeRound && puzzleArr.some((n) => n > 0)) return;

  activeRound = room.round;
  puzzleArr = stringToBoard(room.puzzle);
  selectedCell = puzzleArr.findIndex((n) => n === 0);
  notesMode = false;
  $('btn-notes').classList.remove('active');
  $('btn-notes').setAttribute('aria-pressed', 'false');
  $('notes-badge').textContent = 'OFF';
  historyStack = [];
  conflictSet = new Set();

  const restored = tryRestoreLocalBoard(room.code, activeRound, transport.playerId, room.puzzle);
  if (restored) {
    boardArr = restored.board;
    notesArr = restored.notes;
    localFinished = Boolean(restored.finished);
    localFinishTimeMs = restored.finishTimeMs ?? null;
    if (!localFinished && computeProgress(boardArr, puzzleArr) === 100) {
      const check = validateCompletedBoard(boardArr, puzzleArr);
      if (!check.valid) conflictSet = new Set(check.conflicts);
    }
  } else {
    boardArr = puzzleArr.slice();
    notesArr = new Array(81).fill(0);
    localFinished = false;
    localFinishTimeMs = null;
  }

  startTimerLoop();
}

function handleRoomUpdate(room) {
  if (!room) {
    showToast('Phòng đã đóng.', 'info');
    resetToHome();
    return;
  }
  currentRoom = room;

  if (room.status === 'lobby') {
    if (timerInterval) {
      clearInterval(timerInterval);
      timerInterval = null;
    }
    activeRound = 0;
    renderLobby(room);
    return;
  }

  if (room.status === 'playing') {
    syncRoundIfChanged(room);
    showView('game');

    $('game-room-badge').textContent = room.code;
    const diffCfg = DIFFICULTIES[room.difficulty] || DIFFICULTIES.medium;
    $('game-diff-badge').textContent = diffCfg.label;

    const me = room.players?.[transport.playerId];
    const myColor = PLAYER_COLORS[(me?.colorIndex || 0) % PLAYER_COLORS.length];
    $('settings-player-swatch').style.background = myColor.miniCell;
    $('settings-player-name').textContent = me?.name || 'Bạn';
    $('btn-clear-board').disabled = localFinished;

    const sorted = getSortedPlayers(room);
    renderTopPlayersBar(sorted);
    renderStandings(sorted);
    renderSudokuBoard();
    renderProgressRing(computeProgress(boardArr, puzzleArr));
    updateBannerAndButtons();
    renderChat(room);
  }
}

// ---------- Player Input & Validation Only at 100% ----------
function pushHistory() {
  historyStack.push({
    board: boardArr.slice(),
    notes: notesArr.slice(),
  });
  if (historyStack.length > 200) {
    historyStack.shift();
  }
}

function clearPeerNotes(cellIdx, digit) {
  const bitMask = ~(1 << digit);
  const r = (cellIdx / 9) | 0;
  const c = cellIdx % 9;
  const br = ((r / 3) | 0) * 3;
  const bc = ((c / 3) | 0) * 3;

  for (let k = 0; k < 9; k++) {
    notesArr[r * 9 + k] &= bitMask;
    notesArr[k * 9 + c] &= bitMask;
    notesArr[(br + ((k / 3) | 0)) * 9 + (bc + (k % 3))] &= bitMask;
  }
}

async function evaluateAndSyncProgress() {
  const progress = computeProgress(boardArr, puzzleArr);
  const filledMask = computeFilledMask(boardArr, puzzleArr);

  conflictSet = new Set();

  // Check ONLY when 100% of empty cells have been filled!
  if (progress === 100) {
    const check = validateCompletedBoard(boardArr, puzzleArr);
    if (check.complete && check.valid) {
      localFinished = true;
      localFinishTimeMs = Math.max(
        1000,
        transport.nowServer() - (currentRoom.startedAt || transport.nowServer())
      );
      showToast('Chính xác 100%! Hoàn thành xuất sắc!', 'success');
    } else {
      conflictSet = new Set(check.conflicts);
      showToast('Đã điền 100% nhưng vẫn còn ô chưa đúng!', 'error');
    }
  }

  saveLocalBoard();
  renderSudokuBoard();
  renderProgressRing(progress);
  updateBannerAndButtons();

  // Immediately re-render local player standing while waiting for Firebase roundtrip
  const sorted = getSortedPlayers(currentRoom);
  renderTopPlayersBar(sorted);
  renderStandings(sorted);

  try {
    await transport.updatePlayerState({
      progress,
      filledMask,
      finished: localFinished,
      finishTimeMs: localFinishTimeMs,
    });
  } catch (err) {
    showToast('Lỗi đồng bộ mạng: ' + (err?.message || err), 'error');
  }
}

async function copyTextSafe(text) {
  if (navigator.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch {
      // Fall through to execCommand fallback
    }
  }
  const ta = document.createElement('textarea');
  ta.value = text;
  ta.style.position = 'fixed';
  ta.style.opacity = '0';
  document.body.appendChild(ta);
  ta.select();
  let ok = false;
  try {
    ok = document.execCommand('copy');
  } catch {
    ok = false;
  }
  ta.remove();
  return ok;
}

function handleDigitInput(digit) {
  if (!currentRoom || currentRoom.status !== 'playing' || localFinished) return;
  if (selectedCell < 0 || puzzleArr[selectedCell] !== 0) return;

  if (notesMode) {
    pushHistory();
    const hadDigit = boardArr[selectedCell] !== 0;
    if (hadDigit) {
      boardArr[selectedCell] = 0;
    }
    notesArr[selectedCell] ^= 1 << digit;
    if (hadDigit) {
      evaluateAndSyncProgress();
    } else {
      saveLocalBoard();
      renderSudokuBoard();
    }
    return;
  }

  if (boardArr[selectedCell] === digit) return;
  pushHistory();
  boardArr[selectedCell] = digit;
  notesArr[selectedCell] = 0;
  if (autoRemoveNotes) {
    clearPeerNotes(selectedCell, digit);
  }
  evaluateAndSyncProgress();
}

function handleErase() {
  if (!currentRoom || currentRoom.status !== 'playing' || localFinished) return;
  if (selectedCell < 0 || puzzleArr[selectedCell] !== 0) return;
  if (boardArr[selectedCell] === 0 && notesArr[selectedCell] === 0) return;

  pushHistory();
  const hadDigit = boardArr[selectedCell] !== 0;
  boardArr[selectedCell] = 0;
  notesArr[selectedCell] = 0;

  if (hadDigit) {
    evaluateAndSyncProgress();
  } else {
    saveLocalBoard();
    renderSudokuBoard();
  }
}

function handleUndo() {
  if (!currentRoom || currentRoom.status !== 'playing' || localFinished) return;
  if (historyStack.length === 0) return;

  const prev = historyStack.pop();
  const boardChanged = prev.board.some((v, idx) => v !== boardArr[idx]);
  boardArr = prev.board;
  notesArr = prev.notes;

  if (boardChanged) {
    evaluateAndSyncProgress();
  } else {
    saveLocalBoard();
    renderSudokuBoard();
  }
}

function toggleNotesMode() {
  notesMode = !notesMode;
  $('btn-notes').classList.toggle('active', notesMode);
  $('btn-notes').setAttribute('aria-pressed', String(notesMode));
  $('notes-badge').textContent = notesMode ? 'ON' : 'OFF';
  playNotesToggleSound(notesMode);
}

function resetClearConfirm() {
  clearConfirmPending = false;
  if (clearConfirmTimer) {
    clearTimeout(clearConfirmTimer);
    clearConfirmTimer = null;
  }
  const btn = $('btn-clear-board');
  btn.classList.remove('is-confirming');
  $('clear-board-title').textContent = 'Xóa toàn bộ bảng';
  $('clear-board-desc').textContent = 'Điền sai nhiều? Xóa hết số và ghi chú bạn đã nhập để làm lại từ đầu.';
}

function closeSettingsPopover() {
  $('game-settings-popover').classList.add('hidden');
  $('btn-game-settings').setAttribute('aria-expanded', 'false');
  resetClearConfirm();
}

function handleClearBoard() {
  if (!currentRoom || currentRoom.status !== 'playing') return;
  if (localFinished) {
    showToast('Bạn đã hoàn thành bảng rồi!', 'info');
    return;
  }

  if (!clearConfirmPending) {
    clearConfirmPending = true;
    $('btn-clear-board').classList.add('is-confirming');
    $('clear-board-title').textContent = 'Bấm lại lần nữa để xác nhận xóa hết!';
    $('clear-board-desc').textContent = 'Toàn bộ số bạn đã điền và ghi chú sẽ bị xóa về trạng thái ban đầu.';
    clearConfirmTimer = setTimeout(resetClearConfirm, 3500);
    return;
  }

  resetClearConfirm();
  pushHistory();
  boardArr = puzzleArr.slice();
  notesArr = new Array(81).fill(0);
  conflictSet = new Set();
  closeSettingsPopover();
  evaluateAndSyncProgress();
  showToast('Đã xóa toàn bộ bảng! (Bấm Undo nếu muốn khôi phục)', 'info');
}

function openNewRoundModal() {
  newRoundDifficulty = currentRoom?.difficulty || 'medium';
  setDiffGroupActive('new-round-diff-group', newRoundDifficulty);
  openModal('new-round-modal');
}

async function resetToHome() {
  closeSettingsPopover();
  if (timerInterval) {
    clearInterval(timerInterval);
    timerInterval = null;
  }
  const oldCode = currentRoom?.code;
  if (transport) {
    await transport.leaveRoom(currentRoom);
    transport = null;
  }
  if (oldCode) clearSavedBoardForRoom(oldCode);
  currentRoom = null;
  activeRound = 0;
  localFinished = false;
  localFinishTimeMs = null;
  conflictSet = new Set();
  showView('home');
}

// ---------- Wire Events ----------
function setupDifficultyPicker(containerId, onSelect) {
  $(containerId).addEventListener('click', (e) => {
    const btn = e.target.closest('.diff-btn');
    if (!btn) return;
    const diff = btn.dataset.diff;
    setDiffGroupActive(containerId, diff);
    onSelect(diff);
  });
}

function init() {
  buildSudokuGridDom();
  updateFirebaseBadge();

  // Pre-fill last name and invite link room code
  const savedName = localStorage.getItem(LAST_NAME_KEY) || '';
  if (savedName) {
    $('create-name').value = savedName;
    $('join-name').value = savedName;
  }
  const params = new URLSearchParams(window.location.search);
  const urlRoom = params.get('room');
  if (urlRoom) {
    $('join-code').value = urlRoom.toUpperCase().slice(0, 8);
  }

  setupDifficultyPicker('create-difficulty-group', (diff) => {
    selectedDifficulty = diff;
  });

  setupDifficultyPicker('lobby-diff-controls', async (diff) => {
    if (transport && currentRoom?.hostId === transport.playerId) {
      await transport.setDifficulty(diff);
    }
  });

  setupDifficultyPicker('new-round-diff-group', (diff) => {
    newRoundDifficulty = diff;
  });

  // Create online room
  $('btn-create-room').addEventListener('click', async () => {
    const name = $('create-name').value.trim();
    if (!name) {
      showToast('Vui lòng nhập tên của bạn!', 'error');
      $('create-name').focus();
      return;
    }
    localStorage.setItem(LAST_NAME_KEY, name);
    $('join-name').value = name;

    const btn = $('btn-create-room');
    btn.disabled = true;
    try {
      transport = new FirebaseTransport();
      await transport.createRoom({
        playerName: name,
        difficulty: selectedDifficulty,
        onUpdate: handleRoomUpdate,
      });
    } catch (err) {
      transport = null;
      showToast(err.message || 'Không thể tạo phòng.', 'error');
      if (!getEffectiveFirebaseConfig().config) {
        openModal('config-modal');
      }
    } finally {
      btn.disabled = false;
    }
  });

  // Join online room
  $('btn-join-room').addEventListener('click', async () => {
    const name = $('join-name').value.trim();
    const code = $('join-code').value.trim().toUpperCase();
    if (!name) {
      showToast('Vui lòng nhập tên của bạn!', 'error');
      $('join-name').focus();
      return;
    }
    if (code.length < 4) {
      showToast('Vui lòng nhập mã phòng hợp lệ!', 'error');
      $('join-code').focus();
      return;
    }
    localStorage.setItem(LAST_NAME_KEY, name);
    $('create-name').value = name;

    const btn = $('btn-join-room');
    btn.disabled = true;
    try {
      transport = new FirebaseTransport();
      await transport.joinRoom({
        roomCode: code,
        playerName: name,
        onUpdate: handleRoomUpdate,
      });
    } catch (err) {
      transport = null;
      showToast(err.message || 'Không thể vào phòng.', 'error');
      if (!getEffectiveFirebaseConfig().config) {
        openModal('config-modal');
      }
    } finally {
      btn.disabled = false;
    }
  });

  // Demo mode (3-player simulated)
  $('btn-demo-mode').addEventListener('click', async () => {
    const name = $('create-name').value.trim() || $('join-name').value.trim() || 'Bạn';
    localStorage.setItem(LAST_NAME_KEY, name);
    transport = new DemoTransport();
    await transport.createRoom({
      playerName: name,
      difficulty: selectedDifficulty,
      onUpdate: handleRoomUpdate,
    });
    showToast('Đang chạy chế độ Demo 3 người!', 'success');
  });

  // Lobby actions
  $('btn-copy-code').addEventListener('click', async () => {
    if (!currentRoom?.code) return;
    const ok = await copyTextSafe(currentRoom.code);
    showToast(ok ? `Đã copy mã phòng ${currentRoom.code}` : `Mã phòng: ${currentRoom.code}`, ok ? 'success' : 'info');
  });

  $('btn-copy-link').addEventListener('click', async () => {
    if (!currentRoom?.code) return;
    const url = new URL(window.location.href);
    url.searchParams.set('room', currentRoom.code);
    const ok = await copyTextSafe(url.toString());
    showToast(ok ? 'Đã copy link mời bạn bè!' : 'Hãy copy URL trên thanh địa chỉ.', ok ? 'success' : 'info');
  });

  $('btn-start-game').addEventListener('click', async () => {
    if (!transport || !currentRoom) return;
    $('btn-start-game').disabled = true;
    try {
      await transport.startGame(currentRoom.difficulty, currentRoom);
    } catch (err) {
      showToast(err.message || 'Lỗi bắt đầu game', 'error');
    } finally {
      $('btn-start-game').disabled = false;
    }
  });

  $('btn-claim-host').addEventListener('click', async () => {
    await transport?.claimHost();
  });

  $('btn-leave-lobby').addEventListener('click', resetToHome);
  $('btn-leave-game').addEventListener('click', resetToHome);

  // Sudoku board selection
  $('sudoku-board').addEventListener('click', (e) => {
    const cell = e.target.closest('.cell');
    if (!cell) return;
    selectedCell = Number(cell.dataset.index);
    renderSudokuBoard();
  });

  // Numpad & controls
  $('numpad').addEventListener('click', (e) => {
    const btn = e.target.closest('.num-btn');
    if (!btn) return;
    handleDigitInput(Number(btn.dataset.num));
  });

  $('btn-notes').addEventListener('click', toggleNotesMode);
  $('btn-erase').addEventListener('click', handleErase);
  $('btn-undo').addEventListener('click', handleUndo);

  // Keyboard support for desktop testing
  document.addEventListener('keydown', (e) => {
    if (!$('view-game').classList.contains('active')) return;
    if (chatOpen || !$('new-round-modal').classList.contains('hidden')) return;

    if (e.key >= '1' && e.key <= '9') {
      e.preventDefault();
      handleDigitInput(Number(e.key));
    } else if (e.key === 'Backspace' || e.key === 'Delete' || e.key === '0') {
      e.preventDefault();
      handleErase();
    } else if (e.key === 'n' || e.key === 'N') {
      toggleNotesMode();
    } else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') {
      e.preventDefault();
      handleUndo();
    } else if (selectedCell >= 0) {
      const r = (selectedCell / 9) | 0;
      const c = selectedCell % 9;
      if (e.key === 'ArrowUp' && r > 0) selectedCell -= 9;
      else if (e.key === 'ArrowDown' && r < 8) selectedCell += 9;
      else if (e.key === 'ArrowLeft' && c > 0) selectedCell -= 1;
      else if (e.key === 'ArrowRight' && c < 8) selectedCell += 1;
      else return;
      e.preventDefault();
      renderSudokuBoard();
    }
  });

  // Chat modal
  $('btn-chat').addEventListener('click', () => {
    chatOpen = true;
    openModal('chat-modal');
    if (currentRoom) renderChat(currentRoom);
    $('chat-input').focus();
  });
  $('btn-close-chat').addEventListener('click', () => {
    chatOpen = false;
    closeModal('chat-modal');
  });
  $('chat-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const input = $('chat-input');
    const text = input.value.trim();
    if (!text || !transport || !currentRoom) return;
    const me = currentRoom.players?.[transport.playerId];
    input.value = '';
    await transport.sendChat(me?.name || 'Bạn', me?.colorIndex || 0, text);
  });

  // New round modal
  $('btn-new-round-top').addEventListener('click', openNewRoundModal);
  $('btn-close-new-round').addEventListener('click', () => closeModal('new-round-modal'));
  $('btn-confirm-new-round').addEventListener('click', async () => {
    closeModal('new-round-modal');
    await transport?.startGame(newRoundDifficulty, currentRoom);
  });

  // In-game settings popover (Clear board, auto remove notes, notes sound)
  $('toggle-auto-remove-notes').checked = autoRemoveNotes;
  $('toggle-notes-sound').checked = notesSoundEnabled;

  $('btn-game-settings').addEventListener('click', (e) => {
    e.stopPropagation();
    const popover = $('game-settings-popover');
    const willOpen = popover.classList.contains('hidden');
    if (willOpen) {
      resetClearConfirm();
      popover.classList.remove('hidden');
      $('btn-game-settings').setAttribute('aria-expanded', 'true');
    } else {
      closeSettingsPopover();
    }
  });

  $('game-settings-popover').addEventListener('click', (e) => {
    e.stopPropagation();
  });

  $('btn-clear-board').addEventListener('click', handleClearBoard);

  $('toggle-auto-remove-notes').addEventListener('change', (e) => {
    autoRemoveNotes = e.target.checked;
    localStorage.setItem(AUTO_NOTES_KEY, String(autoRemoveNotes));
  });

  $('toggle-notes-sound').addEventListener('change', (e) => {
    notesSoundEnabled = e.target.checked;
    localStorage.setItem(NOTES_SOUND_KEY, String(notesSoundEnabled));
    if (notesSoundEnabled) playNotesToggleSound(true);
  });

  document.addEventListener('click', () => {
    if (!$('game-settings-popover').classList.contains('hidden')) {
      closeSettingsPopover();
    }
  });

  // Firebase config modal
  $('btn-open-config').addEventListener('click', () => {
    const { config } = getEffectiveFirebaseConfig();
    $('config-textarea').value = config ? JSON.stringify(config, null, 2) : '';
    openModal('config-modal');
  });
  $('btn-close-config').addEventListener('click', () => closeModal('config-modal'));
  $('btn-save-config').addEventListener('click', () => {
    try {
      saveLocalFirebaseConfig($('config-textarea').value);
      updateFirebaseBadge();
      closeModal('config-modal');
      showToast('Đã lưu cấu hình Firebase tạm trên trình duyệt!', 'success');
    } catch (err) {
      showToast(err.message || 'JSON không hợp lệ', 'error');
    }
  });
  $('btn-clear-saved-config').addEventListener('click', () => {
    clearLocalFirebaseConfig();
    $('config-textarea').value = '';
    updateFirebaseBadge();
    showToast('Đã xóa cấu hình tạm.', 'info');
  });

  // Backdrop clicks close modals
  document.querySelectorAll('.modal-backdrop').forEach((bd) => {
    bd.addEventListener('click', () => {
      const id = bd.dataset.close;
      if (id === 'chat-modal') chatOpen = false;
      closeModal(id);
    });
  });
}

init();
