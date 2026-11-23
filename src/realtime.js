import { firebaseConfig as fileConfig, isFirebaseConfigured } from '../firebase-config.js';
import { generateSudoku, computeFilledMask, computeProgress, stringToBoard } from './sudoku.js';

export const PLAYER_COLORS = [
  { name: 'Cam vàng', card: '#fcd34d', miniCell: '#f59e0b', avatar: '#fde68a', badge: '#f59e0b' },
  { name: 'Vàng chanh', card: '#fef08a', miniCell: '#eab308', avatar: '#fef9c3', badge: '#eab308' },
  { name: 'Hồng phấn', card: '#fbcfe8', miniCell: '#ec4899', avatar: '#fce7f3', badge: '#ec4899' },
  { name: 'Xanh ngọc', card: '#99f6e4', miniCell: '#14b8a6', avatar: '#ccfbf1', badge: '#14b8a6' },
  { name: 'Xanh dương', card: '#bae6fd', miniCell: '#0ea5e9', avatar: '#e0f2fe', badge: '#0ea5e9' },
  { name: 'Tím nhạt', card: '#ddd6fe', miniCell: '#8b5cf6', avatar: '#ede9fe', badge: '#8b5cf6' },
];

const LOCAL_CONFIG_KEY = 'usdoku_firebase_config_override';
const FIREBASE_CDN_BASE = 'https://www.gstatic.com/firebasejs/13.4.0';

export function getEffectiveFirebaseConfig() {
  if (isFirebaseConfigured(fileConfig)) {
    return { config: fileConfig, source: 'file' };
  }
  try {
    const raw = localStorage.getItem(LOCAL_CONFIG_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (isFirebaseConfigured(parsed)) {
        return { config: parsed, source: 'local' };
      }
    }
  } catch {
    // ignore malformed storage
  }
  return { config: null, source: null };
}

export function saveLocalFirebaseConfig(rawText) {
  const cleaned = rawText
    .trim()
    .replace(/^(?:export\s+)?(?:const|let|var)\s+\w+\s*=\s*/, '')
    .replace(/;$/, '');
  let parsed = null;
  try {
    parsed = JSON.parse(cleaned);
  } catch {
    const noLineComments = cleaned.replace(/^\s*\/\/.*$/gm, '');
    const extracted = {};
    const pairRegex = /(['"]?)([a-zA-Z0-9_]+)\1\s*:\s*(['"])((?:\\.|(?!\3).)*)\3/g;
    let match;
    while ((match = pairRegex.exec(noLineComments)) !== null) {
      extracted[match[2]] = match[4];
    }
    if (Object.keys(extracted).length > 0) {
      parsed = extracted;
    }
  }
  if (!isFirebaseConfigured(parsed)) {
    throw new Error('Config thiếu apiKey hoặc databaseURL hợp lệ.');
  }
  localStorage.setItem(LOCAL_CONFIG_KEY, JSON.stringify(parsed));
  return parsed;
}

export function clearLocalFirebaseConfig() {
  localStorage.removeItem(LOCAL_CONFIG_KEY);
}

export function generateRoomCode() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let code = '';
  for (let i = 0; i < 6; i++) {
    code += chars[(Math.random() * chars.length) | 0];
  }
  return code;
}

export function getOrCreatePlayerId() {
  const key = 'usdoku_player_id';
  let id = sessionStorage.getItem(key);
  if (!id) {
    id = 'p_' + Math.random().toString(36).slice(2, 10);
    sessionStorage.setItem(key, id);
  }
  return id;
}

/**
 * Firebase Realtime Database transport (no backend required).
 */
export class FirebaseTransport {
  constructor() {
    this.mode = 'firebase';
    this.sdk = null;
    this.db = null;
    this.roomCode = null;
    this.playerId = getOrCreatePlayerId();
    this.unsubRoom = null;
    this.unsubOffset = null;
    this.serverTimeOffset = 0;
    this.onUpdate = null;
  }

  async ensureReady() {
    if (this.db) return;
    const { config } = getEffectiveFirebaseConfig();
    if (!config) {
      throw new Error('Chưa cấu hình Firebase. Hãy dán firebaseConfig hoặc chơi chế độ Demo.');
    }

    const [appMod, dbMod, authMod] = await Promise.all([
      import(`${FIREBASE_CDN_BASE}/firebase-app.js`),
      import(`${FIREBASE_CDN_BASE}/firebase-database.js`),
      import(`${FIREBASE_CDN_BASE}/firebase-auth.js`),
    ]);

    this.sdk = { ...appMod, ...dbMod, ...authMod };
    const existing = appMod.getApps();
    const app = existing.length ? existing[0] : appMod.initializeApp(config);

    // Optional anonymous auth: works whether enabled or open test-mode RTDB
    try {
      const auth = authMod.getAuth(app);
      if (!auth.currentUser) {
        await authMod.signInAnonymously(auth);
      }
    } catch {
      // Ignore if Anonymous Auth isn't enabled in Firebase Console
    }

    this.db = dbMod.getDatabase(app);
    const offsetRef = dbMod.ref(this.db, '.info/serverTimeOffset');
    this.unsubOffset = dbMod.onValue(offsetRef, (snap) => {
      this.serverTimeOffset = snap.val() || 0;
    });
  }

  nowServer() {
    return Date.now() + (this.serverTimeOffset || 0);
  }

  async createRoom({ playerName, difficulty, onUpdate }) {
    await this.ensureReady();
    const { ref, get, set } = this.sdk;

    let code = generateRoomCode();
    for (let attempt = 0; attempt < 5; attempt++) {
      const snap = await get(ref(this.db, `rooms/${code}`));
      if (!snap.exists()) break;
      code = generateRoomCode();
    }

    const initialRoom = {
      code,
      hostId: this.playerId,
      difficulty,
      status: 'lobby',
      round: 0,
      puzzle: '',
      createdAt: Date.now(),
      startedAt: 0,
      players: {
        [this.playerId]: {
          id: this.playerId,
          name: playerName,
          colorIndex: 0,
          joinedAt: Date.now(),
          online: true,
          progress: 0,
          filledMask: '0'.repeat(81),
          finished: false,
          finishTimeMs: null,
        },
      },
    };

    await set(ref(this.db, `rooms/${code}`), initialRoom);
    this.subscribe(code, onUpdate);
    return code;
  }

  async joinRoom({ roomCode, playerName, onUpdate }) {
    await this.ensureReady();
    const { ref, get, update } = this.sdk;
    const code = roomCode.trim().toUpperCase();
    const roomRef = ref(this.db, `rooms/${code}`);
    const snap = await get(roomRef);

    if (!snap.exists()) {
      throw new Error(`Không tìm thấy phòng "${code}". Kiểm tra lại mã nhé!`);
    }

    const room = snap.val();
    const players = room.players || {};
    const existing = players[this.playerId];

    if (existing) {
      await update(ref(this.db, `rooms/${code}/players/${this.playerId}`), {
        name: playerName || existing.name,
        online: true,
      });
    } else {
      const usedColors = new Set(Object.values(players).map((p) => p.colorIndex));
      let colorIndex = 0;
      while (usedColors.has(colorIndex) && colorIndex < PLAYER_COLORS.length) {
        colorIndex++;
      }
      colorIndex = colorIndex % PLAYER_COLORS.length;

      await update(ref(this.db, `rooms/${code}/players/${this.playerId}`), {
        id: this.playerId,
        name: playerName,
        colorIndex,
        joinedAt: Date.now(),
        online: true,
        progress: 0,
        filledMask: '0'.repeat(81),
        finished: false,
        finishTimeMs: null,
      });
    }

    this.subscribe(code, onUpdate);
    return code;
  }

  subscribe(code, onUpdate) {
    const { ref, onValue, onDisconnect } = this.sdk;
    if (this.unsubRoom) this.unsubRoom();
    this.roomCode = code;
    this.onUpdate = onUpdate;

    const onlineRef = ref(this.db, `rooms/${code}/players/${this.playerId}/online`);
    onDisconnect(onlineRef).set(false).catch(() => {});

    const roomRef = ref(this.db, `rooms/${code}`);
    this.unsubRoom = onValue(roomRef, (snap) => {
      if (!snap.exists()) {
        this.onUpdate?.(null);
        return;
      }
      this.onUpdate?.(snap.val());
    });
  }

  async setDifficulty(difficulty) {
    if (!this.roomCode) return;
    const { ref, update } = this.sdk;
    await update(ref(this.db, `rooms/${this.roomCode}`), { difficulty });
  }

  async claimHost() {
    if (!this.roomCode) return;
    const { ref, update } = this.sdk;
    await update(ref(this.db, `rooms/${this.roomCode}`), { hostId: this.playerId });
  }

  async startGame(difficulty, currentRoom) {
    if (!this.roomCode) return;
    const { ref, update, serverTimestamp } = this.sdk;
    const diff = difficulty || currentRoom?.difficulty || 'medium';
    const { puzzle } = generateSudoku(diff);
    const nextRound = (currentRoom?.round || 0) + 1;

    const updates = {
      status: 'playing',
      difficulty: diff,
      puzzle,
      round: nextRound,
      startedAt: serverTimestamp(),
    };

    const players = currentRoom?.players || {};
    for (const pid of Object.keys(players)) {
      updates[`players/${pid}/progress`] = 0;
      updates[`players/${pid}/filledMask`] = '0'.repeat(81);
      updates[`players/${pid}/finished`] = false;
      updates[`players/${pid}/finishTimeMs`] = null;
    }

    await update(ref(this.db, `rooms/${this.roomCode}`), updates);
  }

  async updatePlayerState({ progress, filledMask, finished, finishTimeMs }) {
    if (!this.roomCode) return;
    const { ref, update } = this.sdk;
    await update(ref(this.db, `rooms/${this.roomCode}/players/${this.playerId}`), {
      progress,
      filledMask,
      finished: Boolean(finished),
      finishTimeMs: finishTimeMs ?? null,
      online: true,
    });
  }

  async sendChat(playerName, colorIndex, text) {
    if (!this.roomCode || !text.trim()) return;
    const { ref, push } = this.sdk;
    await push(ref(this.db, `rooms/${this.roomCode}/chat`), {
      playerId: this.playerId,
      name: playerName,
      colorIndex,
      text: text.trim().slice(0, 160),
      ts: Date.now(),
    });
  }

  async leaveRoom(currentRoom) {
    const code = this.roomCode;
    if (this.unsubRoom) {
      this.unsubRoom();
      this.unsubRoom = null;
    }
    this.roomCode = null;
    if (!code || !this.db) return;

    const { ref, remove, update } = this.sdk;
    try {
      const players = currentRoom?.players || {};
      const remainingOnline = Object.values(players).filter(
        (p) => p.id !== this.playerId && p.online !== false
      );

      if (remainingOnline.length === 0) {
        // Last person leaving cleans up the temporary room completely
        await remove(ref(this.db, `rooms/${code}`));
      } else {
        const updates = { [`players/${this.playerId}/online`]: false };
        if (currentRoom?.hostId === this.playerId) {
          remainingOnline.sort((a, b) => (a.joinedAt || 0) - (b.joinedAt || 0));
          updates.hostId = remainingOnline[0].id;
        }
        await update(ref(this.db, `rooms/${code}`), updates);
      }
    } catch {
      // Ignore network errors while leaving
    }
  }
}

/**
 * Local offline 3-player simulation so users can test the full UX immediately without Firebase.
 */
export class DemoTransport {
  constructor() {
    this.mode = 'demo';
    this.playerId = getOrCreatePlayerId();
    this.room = null;
    this.onUpdate = null;
    this.timers = [];
    this.botSolutions = new Map();
    this.botBoards = new Map();
  }

  nowServer() {
    return Date.now();
  }

  clearTimers() {
    while (this.timers.length) {
      const t = this.timers.pop();
      clearTimeout(t);
      clearInterval(t);
    }
  }

  emit() {
    if (this.onUpdate && this.room) {
      this.onUpdate(JSON.parse(JSON.stringify(this.room)));
    }
  }

  async createRoom({ playerName, difficulty, onUpdate }) {
    this.clearTimers();
    this.onUpdate = onUpdate;
    const code = 'DEMO' + String((Math.random() * 90 + 10) | 0);

    this.room = {
      code,
      hostId: this.playerId,
      difficulty,
      status: 'lobby',
      round: 0,
      puzzle: '',
      createdAt: Date.now(),
      startedAt: 0,
      players: {
        [this.playerId]: {
          id: this.playerId,
          name: playerName || 'Bạn',
          colorIndex: 0,
          joinedAt: Date.now(),
          online: true,
          progress: 0,
          filledMask: '0'.repeat(81),
          finished: false,
          finishTimeMs: null,
        },
      },
      chat: {},
    };
    this.emit();

    // Simulate 2 friends joining lobby shortly after
    this.timers.push(
      setTimeout(() => {
        if (!this.room) return;
        this.room.players.bot_1 = {
          id: 'bot_1',
          name: 'Hiệp nè',
          colorIndex: 1,
          joinedAt: Date.now(),
          online: true,
          progress: 0,
          filledMask: '0'.repeat(81),
          finished: false,
          finishTimeMs: null,
        };
        this.emit();
      }, 650)
    );

    this.timers.push(
      setTimeout(() => {
        if (!this.room) return;
        this.room.players.bot_2 = {
          id: 'bot_2',
          name: 'Hoàng',
          colorIndex: 2,
          joinedAt: Date.now(),
          online: true,
          progress: 0,
          filledMask: '0'.repeat(81),
          finished: false,
          finishTimeMs: null,
        };
        this.emit();
      }, 1250)
    );

    return code;
  }

  async setDifficulty(difficulty) {
    if (!this.room) return;
    this.room.difficulty = difficulty;
    this.emit();
  }

  async claimHost() {
    if (!this.room) return;
    this.room.hostId = this.playerId;
    this.emit();
  }

  async startGame(difficulty) {
    if (!this.room) return;
    this.clearTimers();
    const diff = difficulty || this.room.difficulty || 'medium';
    const { puzzle, solution } = generateSudoku(diff);

    // Ensure demo friends exist even if user pressed Start Game right away
    if (!this.room.players.bot_1) {
      this.room.players.bot_1 = {
        id: 'bot_1',
        name: 'Hiệp nè',
        colorIndex: 1,
        joinedAt: Date.now(),
        online: true,
        progress: 0,
        filledMask: '0'.repeat(81),
        finished: false,
        finishTimeMs: null,
      };
    }
    if (!this.room.players.bot_2) {
      this.room.players.bot_2 = {
        id: 'bot_2',
        name: 'Hoàng',
        colorIndex: 2,
        joinedAt: Date.now() + 1,
        online: true,
        progress: 0,
        filledMask: '0'.repeat(81),
        finished: false,
        finishTimeMs: null,
      };
    }

    this.room.status = 'playing';
    this.room.difficulty = diff;
    this.room.puzzle = puzzle;
    this.room.round = (this.room.round || 0) + 1;
    this.room.startedAt = Date.now();

    for (const p of Object.values(this.room.players)) {
      p.progress = 0;
      p.filledMask = '0'.repeat(81);
      p.finished = false;
      p.finishTimeMs = null;
    }
    this.emit();

    if (this.room.round === 1) {
      this.timers.push(
        setTimeout(() => {
          if (this.room?.status === 'playing') {
            this.sendChat('Hiệp nè', 1, 'Chúc mọi người giải vui nhé!');
          }
        }, 3500)
      );
    }

    this.startBots(puzzle, solution);
  }

  startBots(puzzleStr, solutionStr) {
    const puzzleArr = stringToBoard(puzzleStr);
    const solArr = stringToBoard(solutionStr);
    const emptyCells = [];
    for (let i = 0; i < 81; i++) {
      if (puzzleArr[i] === 0) emptyCells.push(i);
    }

    const bots = [
      { id: 'bot_1', intervalMs: 2600 },
      { id: 'bot_2', intervalMs: 3600 },
    ];

    for (const bot of bots) {
      if (!this.room.players[bot.id]) continue;
      const order = emptyCells.slice().sort(() => Math.random() - 0.5);
      const board = puzzleArr.slice();
      this.botBoards.set(bot.id, board);
      this.botSolutions.set(bot.id, solArr);

      let cursor = 0;
      const timer = setInterval(() => {
        if (!this.room || this.room.status !== 'playing') {
          clearInterval(timer);
          return;
        }
        const player = this.room.players[bot.id];
        if (!player || player.finished) {
          clearInterval(timer);
          return;
        }
        if (cursor < order.length) {
          const cellIdx = order[cursor++];
          board[cellIdx] = solArr[cellIdx];
          player.filledMask = computeFilledMask(board, puzzleArr);
          player.progress = computeProgress(board, puzzleArr);
          if (cursor >= order.length) {
            player.progress = 100;
            player.finished = true;
            player.finishTimeMs = Date.now() - this.room.startedAt;
            clearInterval(timer);
          }
          this.emit();
        }
      }, bot.intervalMs);

      this.timers.push(timer);
    }
  }

  async updatePlayerState({ progress, filledMask, finished, finishTimeMs }) {
    if (!this.room || !this.room.players[this.playerId]) return;
    const p = this.room.players[this.playerId];
    p.progress = progress;
    p.filledMask = filledMask;
    p.finished = Boolean(finished);
    p.finishTimeMs = finishTimeMs ?? null;
    this.emit();
  }

  async sendChat(playerName, colorIndex, text) {
    if (!this.room || !text.trim()) return;
    const id = 'm_' + Date.now() + '_' + Math.random().toString(36).slice(2, 6);
    this.room.chat = this.room.chat || {};
    this.room.chat[id] = {
      playerId: this.playerId,
      name: playerName,
      colorIndex,
      text: text.trim().slice(0, 160),
      ts: Date.now(),
    };
    this.emit();
  }

  async leaveRoom() {
    this.clearTimers();
    this.room = null;
  }
}
