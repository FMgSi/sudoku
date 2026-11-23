/**
 * Pure, lightweight Sudoku generator and validator (zero dependencies).
 * Works identically in browser ES modules and Node.js tests.
 */

export const DIFFICULTIES = {
  easy: { label: 'Dễ', targetClues: 44 },
  medium: { label: 'Trung bình', targetClues: 36 },
  hard: { label: 'Khó', targetClues: 30 },
  expert: { label: 'Chuyên gia', targetClues: 25 },
};

const ROW_OF = new Uint8Array(81);
const COL_OF = new Uint8Array(81);
const BOX_OF = new Uint8Array(81);

for (let i = 0; i < 81; i++) {
  const r = (i / 9) | 0;
  const c = i % 9;
  ROW_OF[i] = r;
  COL_OF[i] = c;
  BOX_OF[i] = ((r / 3) | 0) * 3 + ((c / 3) | 0);
}

const ALL_DIGITS_MASK = 0x3fe; // bits 1..9 set

function shuffle(arr) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = (Math.random() * (i + 1)) | 0;
    const tmp = arr[i];
    arr[i] = arr[j];
    arr[j] = tmp;
  }
  return arr;
}

function buildMasks(board) {
  const rows = new Uint16Array(9);
  const cols = new Uint16Array(9);
  const boxes = new Uint16Array(9);

  for (let i = 0; i < 81; i++) {
    const val = board[i];
    if (val >= 1 && val <= 9) {
      const bit = 1 << val;
      const r = ROW_OF[i];
      const c = COL_OF[i];
      const b = BOX_OF[i];
      if ((rows[r] & bit) || (cols[c] & bit) || (boxes[b] & bit)) {
        return null;
      }
      rows[r] |= bit;
      cols[c] |= bit;
      boxes[b] |= bit;
    }
  }
  return { rows, cols, boxes };
}

function popCount9(mask) {
  let count = 0;
  let m = mask;
  while (m) {
    m &= m - 1;
    count++;
  }
  return count;
}

function findBestEmptyCell(board, rows, cols, boxes) {
  let bestIdx = -1;
  let bestMask = 0;
  let bestCount = 10;

  for (let i = 0; i < 81; i++) {
    if (board[i] !== 0) continue;
    const used = rows[ROW_OF[i]] | cols[COL_OF[i]] | boxes[BOX_OF[i]];
    const avail = ALL_DIGITS_MASK & ~used;
    const cnt = popCount9(avail);
    if (cnt === 0) return { idx: i, mask: 0, count: 0 };
    if (cnt < bestCount) {
      bestCount = cnt;
      bestIdx = i;
      bestMask = avail;
      if (cnt === 1) break;
    }
  }
  return { idx: bestIdx, mask: bestMask, count: bestCount };
}

function fillRandomSolution(board, rows, cols, boxes) {
  const { idx, mask, count } = findBestEmptyCell(board, rows, cols, boxes);
  if (idx === -1) return true;
  if (count === 0) return false;

  const candidates = [];
  for (let d = 1; d <= 9; d++) {
    if (mask & (1 << d)) candidates.push(d);
  }
  shuffle(candidates);

  const r = ROW_OF[idx];
  const c = COL_OF[idx];
  const b = BOX_OF[idx];

  for (let k = 0; k < candidates.length; k++) {
    const d = candidates[k];
    const bit = 1 << d;
    board[idx] = d;
    rows[r] |= bit;
    cols[c] |= bit;
    boxes[b] |= bit;

    if (fillRandomSolution(board, rows, cols, boxes)) return true;

    board[idx] = 0;
    rows[r] &= ~bit;
    cols[c] &= ~bit;
    boxes[b] &= ~bit;
  }
  return false;
}

export function countSolutions(boardInput, limit = 2) {
  const board = Array.from(boardInput);
  const masks = buildMasks(board);
  if (!masks) return 0;
  const { rows, cols, boxes } = masks;

  let solutions = 0;

  function search() {
    if (solutions >= limit) return;
    const { idx, mask, count } = findBestEmptyCell(board, rows, cols, boxes);
    if (idx === -1) {
      solutions++;
      return;
    }
    if (count === 0) return;

    const r = ROW_OF[idx];
    const c = COL_OF[idx];
    const b = BOX_OF[idx];

    for (let d = 1; d <= 9; d++) {
      const bit = 1 << d;
      if (!(mask & bit)) continue;

      board[idx] = d;
      rows[r] |= bit;
      cols[c] |= bit;
      boxes[b] |= bit;

      search();

      board[idx] = 0;
      rows[r] &= ~bit;
      cols[c] &= ~bit;
      boxes[b] &= ~bit;

      if (solutions >= limit) return;
    }
  }

  search();
  return solutions;
}

export function generateSudoku(difficulty = 'medium') {
  const cfg = DIFFICULTIES[difficulty] || DIFFICULTIES.medium;
  let bestPuzzle = null;
  let bestSolution = null;
  let bestClues = 81;

  // Try up to 4 times to get close to targetClues for hard/expert
  for (let attempt = 0; attempt < 4; attempt++) {
    const solution = new Array(81).fill(0);
    const masks = buildMasks(solution);
    fillRandomSolution(solution, masks.rows, masks.cols, masks.boxes);

    const puzzle = solution.slice();
    const indices = shuffle(Array.from({ length: 81 }, (_, i) => i));
    let clues = 81;

    for (let k = 0; k < indices.length && clues > cfg.targetClues; k++) {
      const idx = indices[k];
      const backup = puzzle[idx];
      puzzle[idx] = 0;

      if (countSolutions(puzzle, 2) === 1) {
        clues--;
      } else {
        puzzle[idx] = backup;
      }
    }

    if (clues < bestClues) {
      bestClues = clues;
      bestPuzzle = puzzle;
      bestSolution = solution;
    }
    if (clues <= cfg.targetClues + 2) break;
  }

  return {
    puzzle: boardToString(bestPuzzle),
    solution: boardToString(bestSolution),
    clues: bestClues,
    difficulty: DIFFICULTIES[difficulty] ? difficulty : 'medium',
  };
}

export function boardToString(board) {
  return board.map((n) => (n >= 1 && n <= 9 ? String(n) : '0')).join('');
}

export function stringToBoard(str) {
  if (typeof str !== 'string' || str.length !== 81) {
    return new Array(81).fill(0);
  }
  const arr = new Array(81);
  for (let i = 0; i < 81; i++) {
    const code = str.charCodeAt(i) - 48;
    arr[i] = code >= 1 && code <= 9 ? code : 0;
  }
  return arr;
}

export function computeFilledMask(board, puzzle) {
  let mask = '';
  for (let i = 0; i < 81; i++) {
    const isClue = puzzle[i] >= 1 && puzzle[i] <= 9;
    const isFilled = !isClue && board[i] >= 1 && board[i] <= 9;
    mask += isFilled ? '1' : '0';
  }
  return mask;
}

export function computeProgress(board, puzzle) {
  let totalEmpty = 0;
  let filled = 0;
  for (let i = 0; i < 81; i++) {
    if (puzzle[i] === 0) {
      totalEmpty++;
      if (board[i] >= 1 && board[i] <= 9) {
        filled++;
      }
    }
  }
  if (totalEmpty === 0) return 100;
  if (filled === totalEmpty) return 100;
  return Math.min(99, Math.round((filled / totalEmpty) * 100));
}

/**
 * Validates the board ONLY when 100% (all 81 cells) are filled.
 * Checks standard Sudoku uniqueness across rows, columns, and 3x3 boxes
 * (and ensures original puzzle clues are preserved).
 */
export function validateCompletedBoard(board, puzzle) {
  if (!Array.isArray(board) || board.length !== 81) {
    return { complete: false, valid: false, conflicts: [] };
  }

  for (let i = 0; i < 81; i++) {
    if (board[i] < 1 || board[i] > 9) {
      return { complete: false, valid: false, conflicts: [] };
    }
  }

  const conflictSet = new Set();

  // Ensure clues were not altered
  if (Array.isArray(puzzle) && puzzle.length === 81) {
    for (let i = 0; i < 81; i++) {
      if (puzzle[i] >= 1 && puzzle[i] <= 9 && board[i] !== puzzle[i]) {
        conflictSet.add(i);
      }
    }
  }

  const checkGroup = (indices) => {
    const seen = new Map();
    for (const idx of indices) {
      const val = board[idx];
      if (seen.has(val)) {
        conflictSet.add(idx);
        conflictSet.add(seen.get(val));
      } else {
        seen.set(val, idx);
      }
    }
  };

  for (let g = 0; g < 9; g++) {
    const rowIdx = [];
    const colIdx = [];
    const boxIdx = [];
    const br = ((g / 3) | 0) * 3;
    const bc = (g % 3) * 3;
    for (let k = 0; k < 9; k++) {
      rowIdx.push(g * 9 + k);
      colIdx.push(k * 9 + g);
      boxIdx.push((br + ((k / 3) | 0)) * 9 + (bc + (k % 3)));
    }
    checkGroup(rowIdx);
    checkGroup(colIdx);
    checkGroup(boxIdx);
  }

  const conflicts = Array.from(conflictSet).sort((a, b) => a - b);
  return {
    complete: true,
    valid: conflicts.length === 0,
    conflicts,
  };
}

export function formatDuration(ms) {
  const totalSec = Math.max(0, Math.floor(ms / 1000));
  const mins = Math.floor(totalSec / 60);
  const secs = totalSec % 60;
  return `${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
}
