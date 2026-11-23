import test from 'node:test';
import assert from 'node:assert/strict';
import {
  DIFFICULTIES,
  generateSudoku,
  gradePuzzle,
  stringToBoard,
  countSolutions,
  computeFilledMask,
  computeProgress,
  validateCompletedBoard,
} from '../src/sudoku.js';

test('generateSudoku creates valid unique-solution puzzles across all 6 difficulties', () => {
  assert.deepEqual(Object.keys(DIFFICULTIES), [
    'easy',
    'medium',
    'hard',
    'expert',
    'master',
    'extreme',
  ]);
  for (const diff of Object.keys(DIFFICULTIES)) {
    const generated = generateSudoku(diff);
    assert.equal(generated.puzzle.length, 81);
    assert.equal(generated.solution.length, 81);

    const puzzleBoard = stringToBoard(generated.puzzle);
    const solutionBoard = stringToBoard(generated.solution);

    // Every clue in puzzle matches solution
    for (let i = 0; i < 81; i++) {
      if (puzzleBoard[i] !== 0) {
        assert.equal(puzzleBoard[i], solutionBoard[i]);
      }
    }

    // Solution itself is valid
    const solCheck = validateCompletedBoard(solutionBoard, puzzleBoard);
    assert.equal(solCheck.complete, true);
    assert.equal(solCheck.valid, true);
    assert.deepEqual(solCheck.conflicts, []);

    // Unique solution guaranteed
    assert.equal(countSolutions(puzzleBoard, 2), 1);

    // Human-technique grader returns valid 1..6 tier
    const graded = gradePuzzle(puzzleBoard);
    assert.ok(graded.tier >= 1 && graded.tier <= 6);
  }
});

test('validateCompletedBoard returns incomplete when any cell is 0', () => {
  const { puzzle, solution } = generateSudoku('easy');
  const p = stringToBoard(puzzle);
  const b = stringToBoard(solution);
  const firstEmpty = p.indexOf(0);
  b[firstEmpty] = 0;

  const res = validateCompletedBoard(b, p);
  assert.equal(res.complete, false);
  assert.equal(res.valid, false);
});

test('validateCompletedBoard detects duplicates only when 100% filled', () => {
  const { puzzle, solution } = generateSudoku('medium');
  const p = stringToBoard(puzzle);
  const b = stringToBoard(solution);
  const firstEmpty = p.indexOf(0);
  b[firstEmpty] = (b[firstEmpty] % 9) + 1; // force wrong digit

  const res = validateCompletedBoard(b, p);
  assert.equal(res.complete, true);
  assert.equal(res.valid, false);
  assert.ok(res.conflicts.includes(firstEmpty));
  assert.ok(res.conflicts.length >= 2);
});

test('computeFilledMask and computeProgress track only player-entered non-clue cells', () => {
  const { puzzle } = generateSudoku('easy');
  const p = stringToBoard(puzzle);
  const b = p.slice();

  assert.equal(computeProgress(b, p), 0);
  assert.equal(computeFilledMask(b, p), '0'.repeat(81));

  const emptyIndices = [];
  for (let i = 0; i < 81; i++) {
    if (p[i] === 0) emptyIndices.push(i);
  }

  for (let k = 0; k < emptyIndices.length - 1; k++) {
    b[emptyIndices[k]] = 1;
  }
  const almostMask = computeFilledMask(b, p);
  assert.equal(almostMask[emptyIndices[0]], '1');
  assert.equal(almostMask[emptyIndices[emptyIndices.length - 1]], '0');
  assert.ok(computeProgress(b, p) < 100);

  b[emptyIndices[emptyIndices.length - 1]] = 2;
  assert.equal(computeProgress(b, p), 100);
});
