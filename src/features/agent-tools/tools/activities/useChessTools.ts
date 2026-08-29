import { useWebMCP } from 'use-webmcp-tool';
import { logged, type ToolCtx } from '../../toolCtx';
import type { StationDef } from '@/entities/activities/types';
import { STATIONS, stationById } from '@/entities/activities/registry';
import {
  initialBoard,
  boardText,
  applyMove,
  readState,
  type ChessState,
} from '@/entities/activities/modules/chess';

const KIND = 'chess';
const CHESS: StationDef[] = STATIONS.filter((s) => s.kind === 'chess');

const TABLE_ALIASES: Record<string, string> = {
  '1': 'chess:a',
  a: 'chess:a',
  'chess:a': 'chess:a',
  'chess table 1': 'chess:a',
  '2': 'chess:b',
  b: 'chess:b',
  'chess:b': 'chess:b',
  'chess table 2': 'chess:b',
};

/** Chess at the two plaza tables: take a seat, push wood, kibitz from the rail. */
export function useChessTools({ world, net, joined }: ToolCtx): void {
  /** Pick the target table: explicit `table` arg wins, else the nearest one. */
  function resolveStation(args: { table?: string }): StationDef {
    const key = args?.table != null ? String(args.table).trim().toLowerCase() : '';
    const aliased = TABLE_ALIASES[key];
    if (aliased) {
      const found = stationById(aliased);
      if (found) return found;
    }
    const hero = world.heroCell();
    let best = CHESS[0]!;
    let bestD = Infinity;
    for (const s of CHESS) {
      const d = Math.abs(s.cx - hero.x) + Math.abs(s.cz - hero.z);
      if (d < bestD) {
        bestD = d;
        best = s;
      }
    }
    return best;
  }

  function nameOf(id: string | undefined): string {
    if (!id) return 'open';
    const self = net.self;
    if (self && self.id === id) return self.name;
    const a = net.agents().find((x) => x.id === id);
    return a ? a.name : 'someone';
  }

  function toRaw(s: ChessState): Record<string, unknown> {
    return {
      board: s.board,
      turn: s.turn,
      moves: s.moves,
      ...(s.result ? { result: s.result } : {}),
    };
  }

  function mySeat(def: StationDef): 'w' | 'b' | null {
    const seats = net.station(def.id)?.seats ?? {};
    const id = net.self?.id;
    if (!id) return null;
    if (seats.white === id) return 'w';
    if (seats.black === id) return 'b';
    return null;
  }

  useWebMCP({
    name: 'chess_join',
    description:
      'Sit down at a chess table and claim a colour. If the table has no game yet, a fresh position is set up. White moves first. Omit `table` to use the nearest table.',
    inputSchema: {
      type: 'object',
      properties: {
        table: { type: 'string', description: 'which chess table; defaults to the nearest one' },
        color: { type: 'string', enum: ['white', 'black'], description: 'which seat to take (default white)' },
      },
    },
    enabled: joined,
    execute: logged(net, 'chess_join', ({ table, color }: { table?: string; color?: string }) => {
      const def = resolveStation({ table });
      const existing = readState(net.station(def.id)?.state);
      if (!existing) net.stSet(def.id, KIND, toRaw({ board: initialBoard(), turn: 'w', moves: [] }));
      const seat = color === 'black' ? 'black' : 'white';
      net.stJoin(def.id, KIND, seat);
      const turn = existing ? existing.turn : 'w';
      return `You took the ${seat} seat at ${def.label}. ${turn === 'w' ? 'White' : 'Black'} to move. Call chess_board to see the position.`;
    }),
  });

  useWebMCP({
    name: 'chess_board',
    description:
      'Show the current position at a chess table: an ASCII board, whose turn it is, the last few moves and who is seated. Omit `table` to read the nearest table.',
    annotations: { readOnlyHint: true },
    inputSchema: {
      type: 'object',
      properties: {
        table: { type: 'string', description: 'which chess table; defaults to the nearest one' },
      },
    },
    enabled: joined,
    execute: logged(net, 'chess_board', ({ table }: { table?: string }) => {
      const def = resolveStation({ table });
      const st = net.station(def.id);
      const state = readState(st?.state);
      if (!state) {
        return `${def.label} is empty — no game yet. Call chess_join to sit down (white moves first), then chess_move to play.`;
      }
      const seats = st?.seats ?? {};
      const recent = state.moves.slice(-4);
      return [
        boardText(state),
        '',
        `♔ white: ${nameOf(seats.white)}   ♚ black: ${nameOf(seats.black)}`,
        recent.length ? `recent moves: ${recent.join(', ')}` : 'no moves yet',
      ].join('\n');
    }),
  });

  useWebMCP({
    name: 'chess_move',
    description:
      'Make a move at a chess table, e.g. from "e2" to "e4". If you are seated, it must be your colour\'s turn. Rules are light: you can only move your own pieces and cannot land on your own piece — no legality or check enforcement. `promotion` (q/r/b/n) applies when a pawn reaches the last rank (defaults to queen).',
    inputSchema: {
      type: 'object',
      properties: {
        table: { type: 'string', description: 'which chess table; defaults to the nearest one' },
        from: { type: 'string', description: 'source square, e.g. "e2"' },
        to: { type: 'string', description: 'destination square, e.g. "e4"' },
        promotion: { type: 'string', enum: ['q', 'r', 'b', 'n'], description: 'promotion piece for a pawn reaching the last rank' },
      },
      required: ['from', 'to'],
    },
    enabled: joined,
    execute: logged(net, 'chess_move', ({ table, from, to, promotion }: { table?: string; from?: string; to?: string; promotion?: string }) => {
      const def = resolveStation({ table });
      const state = readState(net.station(def.id)?.state);
      if (!state) return `No game at ${def.label} yet — call chess_join first.`;
      if (state.result) return `That game is over (${state.result}). No more moves.`;
      const seat = mySeat(def);
      if (seat && seat !== state.turn) {
        return `It's ${state.turn === 'w' ? 'white' : 'black'}'s turn, not yours.`;
      }
      if (typeof from !== 'string' || typeof to !== 'string') {
        return 'Provide both from and to squares, e.g. from "e2" to "e4".';
      }
      const res = applyMove(state, from, to, typeof promotion === 'string' ? promotion : undefined);
      if (!res.ok) return res.error;
      net.stSet(def.id, KIND, toRaw(res.state));
      return `Moved ${from}→${to}.\n\n${boardText(res.state)}`;
    }),
  });

  useWebMCP({
    name: 'chess_resign',
    description: 'Resign the game at a chess table. Records the result and announces it to the plaza.',
    inputSchema: {
      type: 'object',
      properties: {
        table: { type: 'string', description: 'which chess table; defaults to the nearest one' },
      },
    },
    enabled: joined,
    execute: logged(net, 'chess_resign', ({ table }: { table?: string }) => {
      const def = resolveStation({ table });
      const state = readState(net.station(def.id)?.state);
      if (!state) return `No game at ${def.label} to resign from.`;
      const who = net.self?.name ?? 'someone';
      net.stSet(def.id, KIND, toRaw({ ...state, result: `${who} resigned` }));
      net.say(`${who} resigns at ${def.label}.`);
      return `You resigned at ${def.label}. Game over.`;
    }),
  });

  useWebMCP({
    name: 'chess_invite',
    description: 'Call out to the plaza for a chess opponent at a table, so someone can walk over and take the empty seat.',
    inputSchema: {
      type: 'object',
      properties: {
        table: { type: 'string', description: 'which chess table; defaults to the nearest one' },
      },
    },
    enabled: joined,
    execute: logged(net, 'chess_invite', ({ table }: { table?: string }) => {
      const def = resolveStation({ table });
      const me = net.self?.name ?? 'A player';
      net.say(`${me} wants a chess opponent at ${def.label} — walk over and call chess_join!`);
      return `Invitation sent for ${def.label}.`;
    }),
  });

  useWebMCP({
    name: 'chess_advise',
    description: 'Kibitz: broadcast a chess comment or suggestion tagged to a table, for the players and onlookers.',
    inputSchema: {
      type: 'object',
      properties: {
        table: { type: 'string', description: 'which chess table; defaults to the nearest one' },
        text: { type: 'string', description: 'your remark, tip or line to share' },
      },
      required: ['text'],
    },
    enabled: joined,
    execute: logged(net, 'chess_advise', ({ table, text }: { table?: string; text?: string }) => {
      const def = resolveStation({ table });
      const remark = typeof text === 'string' ? text.trim() : '';
      if (!remark) return 'Provide some advice text to share.';
      net.say(`[chess kibitz @ ${def.label}] ${remark}`);
      return `Kibitz posted for ${def.label}.`;
    }),
  });
}
