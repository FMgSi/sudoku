import test from 'node:test';
import assert from 'node:assert/strict';

// Minimal Web Storage shim for testing realtime.js in Node
const store = new Map();
globalThis.localStorage = {
  getItem: (k) => (store.has(k) ? store.get(k) : null),
  setItem: (k, v) => store.set(k, String(v)),
  removeItem: (k) => store.delete(k),
};
const sessStore = new Map();
globalThis.sessionStorage = {
  getItem: (k) => (sessStore.has(k) ? sessStore.get(k) : null),
  setItem: (k, v) => sessStore.set(k, String(v)),
  removeItem: (k) => sessStore.delete(k),
};

const {
  saveLocalFirebaseConfig,
  clearLocalFirebaseConfig,
  getEffectiveFirebaseConfig,
  generateRoomCode,
  DemoTransport,
} = await import('../src/realtime.js');

test('saveLocalFirebaseConfig parses JS object snippet containing https:// URLs safely', () => {
  clearLocalFirebaseConfig();
  const snippet = `const firebaseConfig = {
    apiKey: "AIzaSyFakeKey123456",
    authDomain: "demo-app.firebaseapp.com",
    databaseURL: "https://demo-app-default-rtdb.asia-southeast1.firebasedatabase.app",
    projectId: "demo-app",
    appId: "1:12345:web:abcde",
  };`;
  const parsed = saveLocalFirebaseConfig(snippet);
  assert.equal(parsed.apiKey, 'AIzaSyFakeKey123456');
  assert.equal(
    parsed.databaseURL,
    'https://demo-app-default-rtdb.asia-southeast1.firebasedatabase.app'
  );
  const stored = JSON.parse(localStorage.getItem('usdoku_firebase_config_override'));
  assert.equal(stored.projectId, 'demo-app');
  const eff = getEffectiveFirebaseConfig();
  assert.ok(eff.source === 'file' || eff.source === 'local');
  assert.ok(eff.config && eff.config.apiKey);
  clearLocalFirebaseConfig();
});

test('generateRoomCode returns 6 uppercase unambiguous characters', () => {
  for (let i = 0; i < 20; i++) {
    const code = generateRoomCode();
    assert.match(code, /^[A-HJ-NP-Z2-9]{6}$/);
  }
});

test('DemoTransport creates lobby, starts game with 3 players, and accepts updates', async () => {
  const demo = new DemoTransport();
  let latestRoom = null;
  await demo.createRoom({
    playerName: 'Tester',
    difficulty: 'easy',
    onUpdate: (r) => {
      latestRoom = r;
    },
  });
  assert.equal(latestRoom.status, 'lobby');
  assert.equal(latestRoom.difficulty, 'easy');

  await demo.startGame('easy');
  assert.equal(latestRoom.status, 'playing');
  assert.equal(latestRoom.puzzle.length, 81);
  assert.equal(Object.keys(latestRoom.players).length, 3);

  await demo.updatePlayerState({
    progress: 50,
    filledMask: '1'.repeat(20) + '0'.repeat(61),
    finished: false,
    finishTimeMs: null,
  });
  assert.equal(latestRoom.players[demo.playerId].progress, 50);

  await demo.sendChat('Tester', 0, 'Hello');
  assert.equal(Object.keys(latestRoom.chat).length, 1);

  await demo.leaveRoom();
});
