import type { ActivityModule, StationDef, BuildApi, RenderApi, StationSnapshot } from '../types';
import { box, signpost, textSprite } from '../voxel';

/**
 * Chess — two shared tables where agents/humans take the white or black seat.
 * State is a 64-char board (index 0 = a8 … 63 = h1; uppercase = white KQRBNP,
 * lowercase = black, '.' = empty) plus whose turn it is and the move list.
 * Moves are validated for real per-piece movement (pawn steps & captures,
 * knight L, bishop/rook/queen sliding with a clear path, king one square).
 * Check / checkmate / castling / en-passant are intentionally out of scope.
 */
export interface ChessState {
  board: string;
  turn: 'w' | 'b';
  moves: string[];
  result?: string;
}

const CREAM = 0xf3ead2;
const DARK = 0x2a2f3a;
const LIGHT_SQ = 0xe8d7b0;
const DARK_SQ = 0x7a5230;
const WOOD = 0x8a6b46;
const TILE = 0.3; // per-square world size (board ≈ 2.4 units — roomy for pieces)

export function initialBoard(): string {
  return 'rnbqkbnr' + 'pppppppp' + '.'.repeat(32) + 'PPPPPPPP' + 'RNBQKBNR';
}

export function squareToIdx(sq: string): number | null {
  if (typeof sq !== 'string' || sq.length !== 2) return null;
  const file = sq.toLowerCase().charCodeAt(0) - 97;
  const rank = sq.charCodeAt(1) - 48;
  if (file < 0 || file > 7 || rank < 1 || rank > 8) return null;
  return (8 - rank) * 8 + file;
}

export function boardText(state: ChessState): string {
  const b = state.board.length === 64 ? state.board : initialBoard();
  const lines: string[] = [];
  for (let row = 0; row < 8; row++) {
    const cells: string[] = [];
    for (let file = 0; file < 8; file++) cells.push(b[row * 8 + file] || '.');
    lines.push(`${8 - row} ${cells.join(' ')}`);
  }
  lines.push('  a b c d e f g h');
  lines.push(state.turn === 'w' ? 'White to move' : 'Black to move');
  if (state.result) lines.push(`Result: ${state.result}`);
  return lines.join('\n');
}

function isWhitePiece(ch: string): boolean {
  return ch >= 'A' && ch <= 'Z';
}

/** Is this a legal movement for the piece on `fi` to `ti`? (destination already
 *  checked to not hold a friendly piece.) */
function legalPieceMove(board: string, fi: number, ti: number, white: boolean): boolean {
  const fc = fi % 8;
  const fr = Math.floor(fi / 8);
  const tc = ti % 8;
  const tr = Math.floor(ti / 8);
  const df = tc - fc;
  const dr = tr - fr;
  const type = (board[fi] ?? '.').toLowerCase();
  const dest = board[ti] ?? '.';
  const destEnemy = dest !== '.' && isWhitePiece(dest) !== white;

  const pathClear = (): boolean => {
    const sc = Math.sign(df);
    const sr = Math.sign(dr);
    let c = fc + sc;
    let r = fr + sr;
    while (c !== tc || r !== tr) {
      if ((board[r * 8 + c] ?? '.') !== '.') return false;
      c += sc;
      r += sr;
    }
    return true;
  };

  switch (type) {
    case 'n':
      return (Math.abs(df) === 1 && Math.abs(dr) === 2) || (Math.abs(df) === 2 && Math.abs(dr) === 1);
    case 'b':
      return df !== 0 && Math.abs(df) === Math.abs(dr) && pathClear();
    case 'r':
      return (df === 0) !== (dr === 0) && pathClear();
    case 'q':
      return ((df !== 0 && Math.abs(df) === Math.abs(dr)) || ((df === 0) !== (dr === 0))) && pathClear();
    case 'k':
      return Math.max(Math.abs(df), Math.abs(dr)) === 1;
    case 'p': {
      const fwd = white ? -1 : 1; // white moves toward rank 8 (row decreases)
      const startRow = white ? 6 : 1;
      if (df === 0) {
        if (dest !== '.') return false;
        if (dr === fwd) return true;
        if (dr === 2 * fwd && fr === startRow && (board[(fr + fwd) * 8 + fc] ?? '.') === '.') return true;
        return false;
      }
      return Math.abs(df) === 1 && dr === fwd && destEnemy;
    }
    default:
      return false;
  }
}

export function applyMove(
  state: ChessState,
  from: string,
  to: string,
  promotion?: string,
): { ok: true; state: ChessState } | { ok: false; error: string } {
  const board = state.board;
  if (typeof board !== 'string' || board.length !== 64) return { ok: false, error: 'No game in progress.' };
  if (state.result) return { ok: false, error: `The game is over (${state.result}).` };
  const fi = squareToIdx(from);
  const ti = squareToIdx(to);
  if (fi === null) return { ok: false, error: `"${from}" is not a valid square (a1..h8).` };
  if (ti === null) return { ok: false, error: `"${to}" is not a valid square (a1..h8).` };
  if (fi === ti) return { ok: false, error: 'The from and to squares are the same.' };

  const piece = board[fi];
  if (!piece || piece === '.') return { ok: false, error: `There is no piece on ${from}.` };
  const white = isWhitePiece(piece);
  if ((state.turn === 'w') !== white) {
    return { ok: false, error: `It is ${state.turn === 'w' ? 'white' : 'black'} to move; ${from} holds a ${white ? 'white' : 'black'} piece.` };
  }
  const dest = board[ti] ?? '.';
  if (dest !== '.' && isWhitePiece(dest) === white) return { ok: false, error: `${to} is occupied by your own piece.` };

  const NAMES: Record<string, string> = { p: 'pawn', n: 'knight', b: 'bishop', r: 'rook', q: 'queen', k: 'king' };
  if (!legalPieceMove(board, fi, ti, white)) {
    return { ok: false, error: `A ${NAMES[piece.toLowerCase()] ?? 'piece'} can't move ${from}→${to} like that.` };
  }

  let placed = piece;
  const isPawn = piece === 'P' || piece === 'p';
  const lastRank = white ? ti < 8 : ti >= 56;
  if (isPawn && lastRank) {
    const promo = promotion && 'qrbn'.includes(promotion.toLowerCase()) ? promotion.toLowerCase() : 'q';
    placed = white ? promo.toUpperCase() : promo;
  }

  const arr = board.split('');
  const captured = arr[ti] !== '.';
  arr[fi] = '.';
  arr[ti] = placed;

  // capturing a king ends it (we don't detect check, so this is the win line)
  const result = dest.toLowerCase() === 'k' ? `${white ? 'White' : 'Black'} wins (captured the king)` : undefined;

  const next: ChessState = {
    board: arr.join(''),
    turn: state.turn === 'w' ? 'b' : 'w',
    moves: [...state.moves, `${from}${to}${captured ? 'x' : ''}`],
    ...(result ? { result } : {}),
  };
  return { ok: true, state: next };
}

export function readState(raw: Record<string, unknown> | undefined): ChessState | null {
  if (!raw) return null;
  const board = raw.board;
  if (typeof board !== 'string' || board.length !== 64) return null;
  const turn: 'w' | 'b' = raw.turn === 'b' ? 'b' : 'w';
  const moves = Array.isArray(raw.moves) ? raw.moves.filter((m): m is string => typeof m === 'string') : [];
  const result = typeof raw.result === 'string' ? raw.result : undefined;
  return { board, turn, moves, ...(result ? { result } : {}) };
}

// ---- geometry ----
function pieceHeight(type: string): number {
  return { p: 0.22, n: 0.3, b: 0.32, r: 0.34, q: 0.42, k: 0.48 }[type] ?? 0.26;
}

function squareWorld(cx: number, cz: number, i: number): { x: number; z: number } {
  return { x: cx + ((i % 8) - 3.5) * TILE, z: cz + (Math.floor(i / 8) - 3.5) * TILE };
}

function tableCenter(def: StationDef, api: { cellWorld(x: number, z: number): { x: number; z: number } }): { x: number; z: number } {
  return api.cellWorld((def.area.x0 + def.area.x1) / 2, def.cz - 3);
}

const TABLE_H = 0.85;

export const chess: ActivityModule = {
  build(def: StationDef, api: BuildApi): void {
    const c = tableCenter(def, api);
    const gy = api.groundY(c.x, c.z);
    const board = TILE * 8;
    const topY = gy + TABLE_H; // playing surface

    // legs + a solid tabletop slab (one box — no z-fighting)
    const legInset = board / 2 - 0.1;
    for (const sx of [-1, 1])
      for (const sz of [-1, 1]) box(api.group, 0.14, TABLE_H - 0.12, 0.14, WOOD, c.x + sx * legInset, gy + (TABLE_H - 0.12) / 2, c.z + sz * legInset);
    box(api.group, board + 0.36, 0.12, board + 0.36, WOOD, c.x, topY - 0.06, c.z);

    // 8×8 checkerboard, sitting just proud of the tabletop
    for (let i = 0; i < 64; i++) {
      const light = ((i % 8) + Math.floor(i / 8)) % 2 === 0;
      const p = squareWorld(c.x, c.z, i);
      box(api.group, TILE, 0.04, TILE, light ? LIGHT_SQ : DARK_SQ, p.x, topY + 0.02, p.z, { shadow: false });
    }

    // two stools
    const seatOff = board / 2 + 0.55;
    box(api.group, 0.46, 0.46, 0.46, def.color, c.x, gy + 0.23, c.z + seatOff);
    box(api.group, 0.46, 0.46, 0.46, def.color, c.x, gy + 0.23, c.z - seatOff);

    const ap = api.cellWorld(def.cx, def.cz);
    signpost(api.group, ap.x - 1.4, api.groundY(ap.x - 1.4, ap.z), ap.z, def.color);
  },

  render(def: StationDef, snap: StationSnapshot | undefined, api: RenderApi): void {
    const c = tableCenter(def, api);
    const gy = api.groundY(c.x, c.z);
    const topY = gy + TABLE_H + 0.04; // on top of the tiles
    const boardStr = typeof snap?.state?.board === 'string' ? (snap.state.board as string) : '';

    if (boardStr.length === 64) {
      for (let i = 0; i < 64; i++) {
        const ch = boardStr[i];
        if (!ch || ch === '.') continue;
        const type = ch.toLowerCase();
        const white = isWhitePiece(ch);
        const h = pieceHeight(type);
        const col = white ? CREAM : DARK;
        const p = squareWorld(c.x, c.z, i);
        box(api.group, 0.17, h, 0.17, col, p.x, topY + h / 2, p.z);
        if (type === 'k') box(api.group, 0.07, 0.1, 0.07, col, p.x, topY + h + 0.05, p.z);
        else if (type === 'q') box(api.group, 0.13, 0.07, 0.13, col, p.x, topY + h + 0.035, p.z);
      }
    }

    const seats = snap?.seats ?? {};
    const board = TILE * 8;
    const wp = textSprite([`♔ white: ${seats.white ? api.nameOf(seats.white) : 'open'}`]);
    wp.position.set(c.x, topY + 1.15, c.z + board / 2 + 0.55);
    api.group.add(wp);
    const bp = textSprite([`♚ black: ${seats.black ? api.nameOf(seats.black) : 'open'}`]);
    bp.position.set(c.x, topY + 1.15, c.z - board / 2 - 0.55);
    api.group.add(bp);
    if (snap?.state?.result) {
      const rp = textSprite([String(snap.state.result)], { bg: 'rgba(240,109,154,0.92)' });
      rp.position.set(c.x, topY + 1.7, c.z);
      api.group.add(rp);
    }
  },
};
