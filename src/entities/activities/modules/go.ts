import type { ActivityModule, StationDef, BuildApi, RenderApi, StationSnapshot } from '../types';
import { box, deck, signpost, textSprite } from '../voxel';

/**
 * Go (weiqi / baduk) — a shared 9×9 board. Two seats, 'black' and 'white',
 * alternate placing stones. State is a flat 81-char board string plus turn,
 * capture tallies and a pass counter, mirrored to every client.
 */
export type GoStone = 'b' | 'w';
export type GoState = {
  /** 81 chars, '.'|'b'|'w', row-major: index = y*9 + x, with x,y in 0..8. */
  board: string;
  turn: GoStone;
  captures: { b: number; w: number };
  passes: number;
  result?: string;
};

export const BOARD_N = 9;
const CELLS = BOARD_N * BOARD_N; // 81

// ---------- pure logic ----------

/** A fresh, empty 9×9 board string (81 dots). */
export function initialGo(): string {
  return '.'.repeat(CELLS);
}

/** Normalise an opaque station state record into a well-formed GoState. */
export function parseGo(raw: Record<string, unknown> | undefined): GoState {
  const board = typeof raw?.board === 'string' && raw.board.length === CELLS ? raw.board : initialGo();
  const turn: GoStone = raw?.turn === 'w' ? 'w' : 'b';
  const cRaw = (raw?.captures ?? {}) as { b?: unknown; w?: unknown };
  const captures = { b: Number(cRaw.b) || 0, w: Number(cRaw.w) || 0 };
  const passes = Number(raw?.passes) || 0;
  const result = typeof raw?.result === 'string' ? raw.result : undefined;
  return { board, turn, captures, passes, result };
}

function idx(x: number, y: number): number {
  return y * BOARD_N + x;
}

function onBoard(x: number, y: number): boolean {
  return Number.isInteger(x) && Number.isInteger(y) && x >= 0 && x < BOARD_N && y >= 0 && y < BOARD_N;
}

const NEIGHBORS: ReadonlyArray<readonly [number, number]> = [
  [1, 0],
  [-1, 0],
  [0, 1],
  [0, -1],
];

/**
 * Flood-fill the orthogonally connected same-colour group containing (sx,sy),
 * returning its member indices and its liberty count (distinct empty adjacent
 * points). Assumes (sx,sy) is on-board and holds a stone.
 */
function groupInfo(arr: string[], sx: number, sy: number): { cells: number[]; libs: number } {
  const color = arr[idx(sx, sy)] ?? '.';
  const seen = new Set<number>();
  const libs = new Set<number>();
  const stack: Array<[number, number]> = [[sx, sy]];
  while (stack.length > 0) {
    const cur = stack.pop();
    if (!cur) break;
    const [x, y] = cur;
    const i = idx(x, y);
    if (seen.has(i)) continue;
    if ((arr[i] ?? '.') !== color) continue;
    seen.add(i);
    for (const [dx, dy] of NEIGHBORS) {
      const nx = x + dx;
      const ny = y + dy;
      if (!onBoard(nx, ny)) continue;
      const ni = idx(nx, ny);
      const nc = arr[ni] ?? '.';
      if (nc === '.') libs.add(ni);
      else if (nc === color && !seen.has(ni)) stack.push([nx, ny]);
    }
  }
  return { cells: [...seen], libs: libs.size };
}

/**
 * Place a stone of the side to move at (x,y). Rejects off-board and occupied
 * points. After placing, any adjacent opponent group with zero liberties is
 * captured (removed, added to the mover's tally). A move that would leave the
 * placed group with no liberties and captured nothing is rejected as suicidal.
 * On success the turn toggles and the pass counter resets.
 */
export function placeStone(state: GoState, x: number, y: number): { ok: true; state: GoState } | { ok: false; error: string } {
  if (!onBoard(x, y)) return { ok: false, error: `off-board — x and y must both be 0..8 (got ${x}, ${y})` };
  const arr = state.board.split('');
  const i = idx(x, y);
  if ((arr[i] ?? '.') !== '.') return { ok: false, error: `(${x}, ${y}) is already occupied` };

  const me = state.turn;
  const opp: GoStone = me === 'b' ? 'w' : 'b';
  arr[i] = me;

  let captured = 0;
  for (const [dx, dy] of NEIGHBORS) {
    const nx = x + dx;
    const ny = y + dy;
    if (!onBoard(nx, ny)) continue;
    if ((arr[idx(nx, ny)] ?? '.') !== opp) continue;
    const g = groupInfo(arr, nx, ny);
    if (g.libs === 0) {
      for (const ci of g.cells) arr[ci] = '.';
      captured += g.cells.length;
    }
  }

  const mine = groupInfo(arr, x, y);
  if (mine.libs === 0 && captured === 0) {
    return { ok: false, error: 'suicidal move — that point would leave your group with no liberties' };
  }

  const captures = { b: state.captures.b, w: state.captures.w };
  captures[me] += captured;
  return {
    ok: true,
    state: { board: arr.join(''), turn: opp, captures, passes: 0, result: undefined },
  };
}

/** Pass the turn. Two passes in a row ends the game for counting. */
export function pass(state: GoState): GoState {
  const passes = state.passes + 1;
  return {
    board: state.board,
    turn: state.turn === 'b' ? 'w' : 'b',
    captures: { b: state.captures.b, w: state.captures.w },
    passes,
    result: passes >= 2 ? 'both passed — count the board' : state.result,
  };
}

function glyph(c: string): string {
  return c === 'b' ? 'X' : c === 'w' ? 'O' : '.';
}

/** An ASCII rendering of the board (x across, y down) plus turn + captures. */
export function goText(state: GoState): string {
  const head = '    ' + Array.from({ length: BOARD_N }, (_, x) => x).join(' ');
  const rows: string[] = [head];
  for (let y = 0; y < BOARD_N; y++) {
    const cells: string[] = [];
    for (let x = 0; x < BOARD_N; x++) cells.push(glyph(state.board[idx(x, y)] ?? '.'));
    rows.push(`${y}   ${cells.join(' ')}`);
  }
  rows.push('');
  rows.push(`Black (X) captured ${state.captures.b}   |   White (O) captured ${state.captures.w}`);
  rows.push(`Turn: ${state.turn === 'b' ? 'Black (X)' : 'White (O)'} to play`);
  if (state.result) rows.push(`Result: ${state.result}`);
  return rows.join('\n');
}

// ---------- 3D build + render ----------

const SPACING = 0.2; // miniature board — humans zoom in to play
const TABLE_H = 0.62; // tabletop centre above the ground
const SURF = 0.12; // half the tabletop thickness (top face offset)
const TAN = 0xd8b98a;
const LINE = 0x3a2f22;
const BLACK_STONE = 0x22262e;
const WHITE_STONE = 0xefe6d4;

interface GoLayout {
  cx: number;
  cz: number;
  gy: number;
  top: number; // world Y of the tabletop's top face
}

/** Shared board geometry, computed identically by build() and render(). */
function layout(def: StationDef, api: BuildApi | RenderApi): GoLayout {
  // Centre horizontally in the footprint; sit north of the south approach cell.
  const bcx = (def.area.x0 + def.area.x1) / 2;
  const bcz = def.area.z0 + 2.5;
  const c = api.cellWorld(bcx, bcz);
  const gy = api.groundY(c.x, c.z);
  return { cx: c.x, cz: c.z, gy, top: gy + TABLE_H + SURF };
}

/** World position of grid intersection (x,y), x,y in 0..8 (y=0 is north). */
function intersection(l: GoLayout, x: number, y: number): { x: number; z: number } {
  return { x: l.cx + (x - (BOARD_N - 1) / 2) * SPACING, z: l.cz + (y - (BOARD_N - 1) / 2) * SPACING };
}


export const go: ActivityModule = {
  build(def: StationDef, api: BuildApi): void {
    const l = layout(def, api);
    const span = (BOARD_N - 1) * SPACING; // grid extent, corner to corner
    const bw = span + 0.8; // tabletop footprint

    // legs
    for (const sx of [-1, 1]) {
      for (const sz of [-1, 1]) {
        box(api.group, 0.18, TABLE_H, 0.18, 0x8a6b46, l.cx + sx * (bw / 2 - 0.25), l.gy + TABLE_H / 2, l.cz + sz * (bw / 2 - 0.25));
      }
    }
    // tabletop (tan surface) with an ink rim
    deck(api.group, l.cx, l.gy + TABLE_H - SURF, l.cz, bw, bw, TAN);

    // 9×9 grid drawn as thin dark line-boxes on the surface
    const lineY = l.top + 0.011;
    for (let i = 0; i < BOARD_N; i++) {
      const a = intersection(l, i, (BOARD_N - 1) / 2); // vertical line at column i
      box(api.group, 0.03, 0.02, span, LINE, a.x, lineY, l.cz);
      const b = intersection(l, (BOARD_N - 1) / 2, i); // horizontal line at row i
      box(api.group, span, 0.02, 0.03, LINE, b.x, lineY, b.z);
    }

    // stools east / west (kept off the south approach)
    box(api.group, 0.5, 0.5, 0.5, 0x9c7a4d, l.cx + bw / 2 + 0.9, l.gy + 0.25, l.cz, { shadow: true });
    box(api.group, 0.5, 0.5, 0.5, 0x9c7a4d, l.cx - bw / 2 - 0.9, l.gy + 0.25, l.cz, { shadow: true });

    // signpost + lantern at the south approach
    const ap = api.cellWorld(def.cx, def.cz);
    const apy = api.groundY(ap.x, ap.z);
    signpost(api.group, ap.x - 1.4, apy, ap.z, def.color);
    box(api.group, 0.12, 1.6, 0.12, 0x6b532f, l.cx + bw / 2 + 0.9, l.gy + 0.8, l.cz - bw / 2 - 0.2);
    box(api.group, 0.28, 0.28, 0.28, 0xffd98a, l.cx + bw / 2 + 0.9, l.gy + 1.7, l.cz - bw / 2 - 0.2, { basic: true });
  },

  render(def: StationDef, snap: StationSnapshot | undefined, api: RenderApi): void {
    const l = layout(def, api);
    const state = parseGo(snap?.state);

    for (let y = 0; y < BOARD_N; y++) {
      for (let x = 0; x < BOARD_N; x++) {
        const c = state.board[idx(x, y)] ?? '.';
        if (c !== 'b' && c !== 'w') continue;
        const p = intersection(l, x, y);
        box(api.group, 0.16, 0.07, 0.16, c === 'b' ? BLACK_STONE : WHITE_STONE, p.x, l.top + 0.035, p.z);
      }
    }

    // seat placards
    const seats = snap?.seats ?? {};
    const span = (BOARD_N - 1) * SPACING;
    const blackId = seats.black;
    const whiteId = seats.white;
    const blackName = blackId ? api.nameOf(blackId) : 'open';
    const whiteName = whiteId ? api.nameOf(whiteId) : 'open';

    const bp = textSprite([`● black`, blackName], { fg: '#f7efe3' });
    bp.position.set(l.cx + span / 2 + 0.6, l.top + 0.9, l.cz);
    api.group.add(bp);

    const wp = textSprite([`○ white`, whiteName], { fg: '#f7efe3' });
    wp.position.set(l.cx - span / 2 - 0.6, l.top + 0.9, l.cz);
    api.group.add(wp);
  },
};
