/**
 * Pure, lightweight Sudoku generator, unique-solution solver,
 * human-technique difficulty grader (6 tiers matching Sudoku.com),
 * and 100%-completion validator (zero dependencies).
 */

export const DIFFICULTIES = {
  easy: { label: 'Dễ', targetClues: 40, minClues: 36, tier: 1 },
  medium: { label: 'Trung bình', targetClues: 33, minClues: 30, tier: 2 },
  hard: { label: 'Khó', targetClues: 27, minClues: 23, tier: 3 },
  expert: { label: 'Chuyên gia', targetClues: 24, minClues: 21, tier: 4 },
  master: { label: 'Bậc thầy', targetClues: 22, minClues: 19, tier: 5 },
  extreme: { label: 'Cực khó', targetClues: 20, minClues: 17, tier: 6 },
};

const ROW_OF = new Uint8Array(81);
const COL_OF = new Uint8Array(81);
const BOX_OF = new Uint8Array(81);
const ALL_UNITS = [];
const PEERS = Array.from({ length: 81 }, () => []);
const PEER_SETS = Array.from({ length: 81 }, () => new Set());

for (let i = 0; i < 81; i++) {
  const r = (i / 9) | 0;
  const c = i % 9;
  ROW_OF[i] = r;
  COL_OF[i] = c;
  BOX_OF[i] = ((r / 3) | 0) * 3 + ((c / 3) | 0);
}

for (let g = 0; g < 9; g++) {
  const row = [];
  const col = [];
  const box = [];
  const br = ((g / 3) | 0) * 3;
  const bc = (g % 3) * 3;
  for (let k = 0; k < 9; k++) {
    row.push(g * 9 + k);
    col.push(k * 9 + g);
    box.push((br + ((k / 3) | 0)) * 9 + (bc + (k % 3)));
  }
  ALL_UNITS.push(row, col, box);
}

for (let i = 0; i < 81; i++) {
  for (let j = 0; j < 81; j++) {
    if (i === j) continue;
    if (ROW_OF[i] === ROW_OF[j] || COL_OF[i] === COL_OF[j] || BOX_OF[i] === BOX_OF[j]) {
      PEERS[i].push(j);
      PEER_SETS[i].add(j);
    }
  }
}

const ALL_DIGITS_MASK = 0x3fe; // bits 1..9

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

function lowestDigit(mask) {
  for (let d = 1; d <= 9; d++) {
    if (mask & (1 << d)) return d;
  }
  return 0;
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

function countSearchNodes(boardInput) {
  const board = Array.from(boardInput);
  const masks = buildMasks(board);
  if (!masks) return 9999;
  const { rows, cols, boxes } = masks;
  let branches = 0;

  function solve() {
    const { idx, mask, count } = findBestEmptyCell(board, rows, cols, boxes);
    if (idx === -1) return true;
    if (count === 0) return false;
    if (count > 1) branches += count - 1;

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
      if (solve()) return true;
      board[idx] = 0;
      rows[r] &= ~bit;
      cols[c] &= ~bit;
      boxes[b] &= ~bit;
    }
    return false;
  }

  solve();
  return branches;
}

/**
 * Grades a Sudoku puzzle using human solving techniques to match Sudoku.com's 6 tiers:
 * Tier 1: easy | Tier 2: medium | Tier 3: hard | Tier 4: expert | Tier 5: master | Tier 6: extreme
 */
export function gradePuzzle(puzzleInput) {
  const board = Array.from(puzzleInput);
  const masks = buildMasks(board);
  if (!masks) return { tier: 6, level: 'extreme', score: 999, clues: 81 };

  let clues = 0;
  const cands = new Uint16Array(81);
  for (let i = 0; i < 81; i++) {
    if (board[i] !== 0) {
      clues++;
    } else {
      const used = masks.rows[ROW_OF[i]] | masks.cols[COL_OF[i]] | masks.boxes[BOX_OF[i]];
      cands[i] = ALL_DIGITS_MASK & ~used;
    }
  }

  let maxTechTier = 1;
  let score = 0;
  let hiddenSingles = 0;
  let emptyRemaining = 81 - clues;

  const place = (idx, d) => {
    board[idx] = d;
    cands[idx] = 0;
    emptyRemaining--;
    const bitMask = ~(1 << d);
    const peers = PEERS[idx];
    for (let k = 0; k < peers.length; k++) {
      cands[peers[k]] &= bitMask;
    }
  };

  while (emptyRemaining > 0) {
    let progressed = false;

    // 1. Naked Singles
    for (let i = 0; i < 81; i++) {
      if (board[i] === 0 && popCount9(cands[i]) === 1) {
        place(i, lowestDigit(cands[i]));
        score += 1;
        progressed = true;
      }
    }
    if (progressed) continue;

    // 2. Hidden Singles
    for (let u = 0; u < ALL_UNITS.length; u++) {
      const unit = ALL_UNITS[u];
      for (let d = 1; d <= 9; d++) {
        const bit = 1 << d;
        let spot = -1;
        let count = 0;
        for (let k = 0; k < 9; k++) {
          const idx = unit[k];
          if (board[idx] === 0 && (cands[idx] & bit)) {
            spot = idx;
            count++;
            if (count > 1) break;
          }
        }
        if (count === 1) {
          place(spot, d);
          hiddenSingles++;
          score += 2;
          progressed = true;
          break;
        }
      }
      if (progressed) break;
    }
    if (progressed) continue;

    // 3. Locked Candidates (Pointing & Claiming) -> Hard (Tier 3)
    for (let b = 0; b < 9 && !progressed; b++) {
      const box = ALL_UNITS[b * 3 + 2];
      for (let d = 1; d <= 9; d++) {
        const bit = 1 << d;
        let rMask = 0;
        let cMask = 0;
        let cnt = 0;
        for (let k = 0; k < 9; k++) {
          const idx = box[k];
          if (board[idx] === 0 && (cands[idx] & bit)) {
            rMask |= 1 << ROW_OF[idx];
            cMask |= 1 << COL_OF[idx];
            cnt++;
          }
        }
        if (cnt >= 2 && popCount9(rMask) === 1) {
          const r = Math.log2(rMask) | 0;
          const rowUnit = ALL_UNITS[r * 3];
          for (let k = 0; k < 9; k++) {
            const idx = rowUnit[k];
            if (BOX_OF[idx] !== b && board[idx] === 0 && (cands[idx] & bit)) {
              cands[idx] &= ~bit;
              progressed = true;
            }
          }
        }
        if (cnt >= 2 && popCount9(cMask) === 1) {
          const c = Math.log2(cMask) | 0;
          const colUnit = ALL_UNITS[c * 3 + 1];
          for (let k = 0; k < 9; k++) {
            const idx = colUnit[k];
            if (BOX_OF[idx] !== b && board[idx] === 0 && (cands[idx] & bit)) {
              cands[idx] &= ~bit;
              progressed = true;
            }
          }
        }
        if (progressed) {
          maxTechTier = Math.max(maxTechTier, 3);
          score += 8;
          break;
        }
      }
    }
    if (progressed) continue;

    // Claiming (Line -> Box)
    for (let g = 0; g < 9 && !progressed; g++) {
      for (const unitOffset of [0, 1]) {
        const unit = ALL_UNITS[g * 3 + unitOffset];
        for (let d = 1; d <= 9; d++) {
          const bit = 1 << d;
          let bMask = 0;
          let cnt = 0;
          for (let k = 0; k < 9; k++) {
            const idx = unit[k];
            if (board[idx] === 0 && (cands[idx] & bit)) {
              bMask |= 1 << BOX_OF[idx];
              cnt++;
            }
          }
          if (cnt >= 2 && popCount9(bMask) === 1) {
            const b = Math.log2(bMask) | 0;
            const box = ALL_UNITS[b * 3 + 2];
            for (let k = 0; k < 9; k++) {
              const idx = box[k];
              const sameLine = unitOffset === 0 ? ROW_OF[idx] === g : COL_OF[idx] === g;
              if (!sameLine && board[idx] === 0 && (cands[idx] & bit)) {
                cands[idx] &= ~bit;
                progressed = true;
              }
            }
            if (progressed) {
              maxTechTier = Math.max(maxTechTier, 3);
              score += 9;
              break;
            }
          }
        }
        if (progressed) break;
      }
    }
    if (progressed) continue;

    // 4. Naked Pairs & Hidden Pairs -> Hard (Tier 3)
    for (let u = 0; u < ALL_UNITS.length && !progressed; u++) {
      const unit = ALL_UNITS[u];
      const pairCells = [];
      for (let k = 0; k < 9; k++) {
        const idx = unit[k];
        if (board[idx] === 0 && popCount9(cands[idx]) === 2) {
          pairCells.push(idx);
        }
      }
      for (let a = 0; a < pairCells.length && !progressed; a++) {
        for (let b = a + 1; b < pairCells.length; b++) {
          const i1 = pairCells[a];
          const i2 = pairCells[b];
          if (cands[i1] === cands[i2]) {
            const pairMask = cands[i1];
            for (let k = 0; k < 9; k++) {
              const idx = unit[k];
              if (idx !== i1 && idx !== i2 && board[idx] === 0 && (cands[idx] & pairMask)) {
                cands[idx] &= ~pairMask;
                progressed = true;
              }
            }
            if (progressed) {
              maxTechTier = Math.max(maxTechTier, 3);
              score += 10;
              break;
            }
          }
        }
      }
    }
    if (progressed) continue;

    // Hidden Pairs
    for (let u = 0; u < ALL_UNITS.length && !progressed; u++) {
      const unit = ALL_UNITS[u];
      const digitPositions = new Array(10).fill(0);
      for (let d = 1; d <= 9; d++) {
        const bit = 1 << d;
        for (let k = 0; k < 9; k++) {
          const idx = unit[k];
          if (board[idx] === 0 && (cands[idx] & bit)) {
            digitPositions[d] |= 1 << k;
          }
        }
      }
      for (let d1 = 1; d1 <= 9 && !progressed; d1++) {
        if (popCount9(digitPositions[d1]) !== 2) continue;
        for (let d2 = d1 + 1; d2 <= 9; d2++) {
          if (digitPositions[d1] === digitPositions[d2]) {
            const keepMask = (1 << d1) | (1 << d2);
            const posMask = digitPositions[d1];
            for (let k = 0; k < 9; k++) {
              if (posMask & (1 << k)) {
                const idx = unit[k];
                if (cands[idx] & ~keepMask) {
                  cands[idx] &= keepMask;
                  progressed = true;
                }
              }
            }
            if (progressed) {
              maxTechTier = Math.max(maxTechTier, 3);
              score += 12;
              break;
            }
          }
        }
      }
    }
    if (progressed) continue;

    // 5. Naked Triples -> Expert (Tier 4)
    for (let u = 0; u < ALL_UNITS.length && !progressed; u++) {
      const unit = ALL_UNITS[u];
      const candCells = [];
      for (let k = 0; k < 9; k++) {
        const idx = unit[k];
        const cnt = board[idx] === 0 ? popCount9(cands[idx]) : 0;
        if (cnt === 2 || cnt === 3) candCells.push(idx);
      }
      for (let a = 0; a < candCells.length && !progressed; a++) {
        for (let b = a + 1; b < candCells.length && !progressed; b++) {
          for (let c = b + 1; c < candCells.length; c++) {
            const i1 = candCells[a];
            const i2 = candCells[b];
            const i3 = candCells[c];
            const union = cands[i1] | cands[i2] | cands[i3];
            if (popCount9(union) === 3) {
              for (let k = 0; k < 9; k++) {
                const idx = unit[k];
                if (idx !== i1 && idx !== i2 && idx !== i3 && board[idx] === 0 && (cands[idx] & union)) {
                  cands[idx] &= ~union;
                  progressed = true;
                }
              }
              if (progressed) {
                maxTechTier = Math.max(maxTechTier, 4);
                score += 16;
                break;
              }
            }
          }
        }
      }
    }
    if (progressed) continue;

    // 6. X-Wing -> Expert (Tier 4)
    for (let d = 1; d <= 9 && !progressed; d++) {
      const bit = 1 << d;
      const rowCols = [];
      const colRows = [];
      for (let g = 0; g < 9; g++) {
        let rm = 0;
        let cm = 0;
        for (let k = 0; k < 9; k++) {
          if (board[g * 9 + k] === 0 && (cands[g * 9 + k] & bit)) rm |= 1 << k;
          if (board[k * 9 + g] === 0 && (cands[k * 9 + g] & bit)) cm |= 1 << k;
        }
        if (popCount9(rm) === 2) rowCols.push({ line: g, mask: rm });
        if (popCount9(cm) === 2) colRows.push({ line: g, mask: cm });
      }
      for (let a = 0; a < rowCols.length && !progressed; a++) {
        for (let b = a + 1; b < rowCols.length; b++) {
          if (rowCols[a].mask === rowCols[b].mask) {
            const r1 = rowCols[a].line;
            const r2 = rowCols[b].line;
            for (let c = 0; c < 9; c++) {
              if (rowCols[a].mask & (1 << c)) {
                for (let r = 0; r < 9; r++) {
                  if (r !== r1 && r !== r2 && board[r * 9 + c] === 0 && (cands[r * 9 + c] & bit)) {
                    cands[r * 9 + c] &= ~bit;
                    progressed = true;
                  }
                }
              }
            }
            if (progressed) {
              maxTechTier = Math.max(maxTechTier, 4);
              score += 22;
              break;
            }
          }
        }
      }
      for (let a = 0; a < colRows.length && !progressed; a++) {
        for (let b = a + 1; b < colRows.length; b++) {
          if (colRows[a].mask === colRows[b].mask) {
            const c1 = colRows[a].line;
            const c2 = colRows[b].line;
            for (let r = 0; r < 9; r++) {
              if (colRows[a].mask & (1 << r)) {
                for (let c = 0; c < 9; c++) {
                  if (c !== c1 && c !== c2 && board[r * 9 + c] === 0 && (cands[r * 9 + c] & bit)) {
                    cands[r * 9 + c] &= ~bit;
                    progressed = true;
                  }
                }
              }
            }
            if (progressed) {
              maxTechTier = Math.max(maxTechTier, 4);
              score += 22;
              break;
            }
          }
        }
      }
    }
    if (progressed) continue;

    // 7. XY-Wing -> Expert (Tier 4)
    const bivalues = [];
    for (let i = 0; i < 81; i++) {
      if (board[i] === 0 && popCount9(cands[i]) === 2) bivalues.push(i);
    }
    for (let p = 0; p < bivalues.length && !progressed; p++) {
      const pivot = bivalues[p];
      const pMask = cands[pivot];
      const peersOfPivot = bivalues.filter((idx) => idx !== pivot && PEER_SETS[pivot].has(idx));
      for (let a = 0; a < peersOfPivot.length && !progressed; a++) {
        for (let b = a + 1; b < peersOfPivot.length; b++) {
          const q = peersOfPivot[a];
          const r = peersOfPivot[b];
          const qMask = cands[q];
          const rMask = cands[r];
          if ((qMask & pMask) === 0 || (rMask & pMask) === 0) continue;
          if (qMask === pMask || rMask === pMask || qMask === rMask) continue;
          if (popCount9(pMask | qMask | rMask) !== 3) continue;
          const commonWing = qMask & rMask;
          if (popCount9(commonWing) !== 1 || (commonWing & pMask)) continue;

          for (let z = 0; z < 81; z++) {
            if (
              z !== pivot &&
              z !== q &&
              z !== r &&
              board[z] === 0 &&
              (cands[z] & commonWing) &&
              PEER_SETS[q].has(z) &&
              PEER_SETS[r].has(z)
            ) {
              cands[z] &= ~commonWing;
              progressed = true;
            }
          }
          if (progressed) {
            maxTechTier = Math.max(maxTechTier, 4);
            score += 28;
            break;
          }
        }
      }
    }
    if (progressed) continue;

    // 8. Swordfish -> Master (Tier 5)
    for (let d = 1; d <= 9 && !progressed; d++) {
      const bit = 1 << d;
      const rowCols = [];
      for (let r = 0; r < 9; r++) {
        let rm = 0;
        for (let c = 0; c < 9; c++) {
          if (board[r * 9 + c] === 0 && (cands[r * 9 + c] & bit)) rm |= 1 << c;
        }
        const cnt = popCount9(rm);
        if (cnt === 2 || cnt === 3) rowCols.push({ r, mask: rm });
      }
      for (let a = 0; a < rowCols.length && !progressed; a++) {
        for (let b = a + 1; b < rowCols.length && !progressed; b++) {
          for (let c = b + 1; c < rowCols.length; c++) {
            const union = rowCols[a].mask | rowCols[b].mask | rowCols[c].mask;
            if (popCount9(union) === 3) {
              const rA = rowCols[a].r;
              const rB = rowCols[b].r;
              const rC = rowCols[c].r;
              for (let col = 0; col < 9; col++) {
                if (union & (1 << col)) {
                  for (let row = 0; row < 9; row++) {
                    if (
                      row !== rA &&
                      row !== rB &&
                      row !== rC &&
                      board[row * 9 + col] === 0 &&
                      (cands[row * 9 + col] & bit)
                    ) {
                      cands[row * 9 + col] &= ~bit;
                      progressed = true;
                    }
                  }
                }
              }
              if (progressed) {
                maxTechTier = Math.max(maxTechTier, 5);
                score += 36;
                break;
              }
            }
          }
        }
      }
    }
    if (progressed) continue;

    // Stalled past Swordfish -> requires Forcing Chains / Trial & Error (Master or Extreme)
    const branchCount = countSearchNodes(board);
    score += 40 + branchCount * 4 + emptyRemaining;
    maxTechTier = emptyRemaining >= 24 || branchCount >= 8 || clues <= 22 ? 6 : 5;
    break;
  }

  let finalTier = maxTechTier;
  if (finalTier === 1) {
    // Distinguish Easy vs Medium within Singles-solvable puzzles
    finalTier = hiddenSingles >= 4 || clues <= 35 ? 2 : 1;
  }

  const levelNames = ['', 'easy', 'medium', 'hard', 'expert', 'master', 'extreme'];
  return {
    tier: finalTier,
    level: levelNames[finalTier],
    score,
    clues,
    hiddenSingles,
    emptyRemainingAtStall: emptyRemaining,
  };
}

function buildPuzzleCandidate(minClues) {
  const solution = new Array(81).fill(0);
  const masks = buildMasks(solution);
  fillRandomSolution(solution, masks.rows, masks.cols, masks.boxes);

  const puzzle = solution.slice();
  const indices = shuffle(Array.from({ length: 81 }, (_, i) => i));
  let clues = 81;

  for (let k = 0; k < indices.length && clues > minClues; k++) {
    const idx = indices[k];
    const backup = puzzle[idx];
    puzzle[idx] = 0;
    if (countSolutions(puzzle, 2) === 1) {
      clues--;
    } else {
      puzzle[idx] = backup;
    }
  }

  const grade = gradePuzzle(puzzle);
  return { puzzle, solution, grade };
}

export function generateSudoku(difficulty = 'medium') {
  const key = DIFFICULTIES[difficulty] ? difficulty : 'medium';
  const cfg = DIFFICULTIES[key];
  const targetTier = cfg.tier;

  // Time-boxed search so even Master/Extreme never stalls a mobile browser
  const startMs = Date.now();
  const maxMs = targetTier >= 3 ? 350 : 140;
  const maxAttempts = targetTier >= 3 ? 30 : 10;

  let best = null;
  let bestDistance = Infinity;

  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    // Vary clue floor slightly so easy/medium hit their natural sweet spot cleanly
    const floor =
      targetTier <= 2
        ? cfg.minClues + ((Math.random() * 4) | 0)
        : cfg.minClues;

    const candidate = buildPuzzleCandidate(floor);
    const tierDist = Math.abs(candidate.grade.tier - targetTier);
    const clueDist = Math.abs(candidate.grade.clues - cfg.targetClues) * 0.05;
    const distance = tierDist * 10 + clueDist;

    if (distance < bestDistance) {
      bestDistance = distance;
      best = candidate;
    }

    if (candidate.grade.tier === targetTier) {
      break;
    }
    if (Date.now() - startMs > maxMs && best) {
      break;
    }
  }

  return {
    puzzle: boardToString(best.puzzle),
    solution: boardToString(best.solution),
    clues: best.grade.clues,
    difficulty: key,
    gradedLevel: best.grade.level,
    gradedTier: best.grade.tier,
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
