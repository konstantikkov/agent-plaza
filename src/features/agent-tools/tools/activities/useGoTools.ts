import { useWebMCP } from 'use-webmcp-tool';
import { logged, type ToolCtx } from '../../toolCtx';
import { initialGo, parseGo, placeStone, pass, goText, type GoState, type GoStone } from '@/entities/activities/modules/go';

const ID = 'go:a';
const KIND = 'go';

type Seats = Record<string, string>;

/** The agent's seat side at the board, or undefined if just watching. */
function mySide(net: ToolCtx['net'], seats: Seats): GoStone | undefined {
  const me = net.self?.id;
  if (!me) return undefined;
  if (seats.black === me) return 'b';
  if (seats.white === me) return 'w';
  return undefined;
}

/** A readable name for whoever (if anyone) holds a seat. */
function seatName(net: ToolCtx['net'], id: string | undefined): string {
  if (!id) return 'open';
  if (id === net.self?.id) return net.self?.name ?? 'you';
  return net.agents().find((a) => a.id === id)?.name ?? 'someone';
}

function turnWord(t: GoStone): string {
  return t === 'b' ? 'black' : 'white';
}

/** Go on a shared 9×9 board: two seats alternate, capture by surrounding. */
export function useGoTools({ world, net, joined }: ToolCtx): void {
  void world;

  useWebMCP({
    name: 'go_join',
    description:
      'Sit down at the go board and take a seat. color is "black" or "white" (default black; black plays first). Creates a fresh empty 9×9 board if none exists yet.',
    inputSchema: {
      type: 'object',
      properties: {
        color: { type: 'string', enum: ['black', 'white'], description: 'which side to play (default black)' },
      },
    },
    enabled: joined,
    execute: logged(net, 'go_join', ({ color }: { color?: string }) => {
      const raw = net.station(ID)?.state;
      let state = parseGo(raw);
      if (typeof raw?.board !== 'string') {
        state = { board: initialGo(), turn: 'b', captures: { b: 0, w: 0 }, passes: 0 };
        net.stSet(ID, KIND, { ...state });
      }
      const slot = color === 'white' ? 'white' : 'black';
      net.stJoin(ID, KIND, slot);
      return `You joined the go board as ${slot} (${slot === 'black' ? 'black plays first' : 'white'}). It is ${turnWord(state.turn)}'s turn.`;
    }),
  });

  useWebMCP({
    name: 'go_board',
    description: 'Show the current 9×9 go board (X=black, O=white, .=empty), whose turn it is, capture tallies and who holds each seat.',
    annotations: { readOnlyHint: true },
    enabled: joined,
    execute: logged(net, 'go_board', () => {
      const st = net.station(ID);
      if (!st || typeof st.state.board !== 'string') return 'empty board, call go_join';
      const state = parseGo(st.state);
      const seats = st.seats ?? {};
      return `${goText(state)}\nSeats — black: ${seatName(net, seats.black)}, white: ${seatName(net, seats.white)}`;
    }),
  });

  useWebMCP({
    name: 'go_place',
    description:
      'Place a stone at intersection (x, y), each 0..8 (x across, y down from the top). If you hold a seat you may only move on your colour\'s turn. Surrounded opponent groups are captured automatically.',
    inputSchema: {
      type: 'object',
      properties: {
        x: { type: 'integer', minimum: 0, maximum: 8 },
        y: { type: 'integer', minimum: 0, maximum: 8 },
      },
      required: ['x', 'y'],
    },
    enabled: joined,
    execute: logged(net, 'go_place', ({ x, y }: { x?: number; y?: number }) => {
      const st = net.station(ID);
      const state = parseGo(st?.state);
      const side = mySide(net, st?.seats ?? {});
      if (side && state.turn !== side) return `It is not your turn — ${turnWord(state.turn)} to play.`;
      const res = placeStone(state, Number(x), Number(y));
      if (!res.ok) return res.error;
      net.stSet(ID, KIND, { ...res.state });
      return `Placed a ${turnWord(state.turn)} stone at (${x}, ${y}).\n${goText(res.state)}`;
    }),
  });

  useWebMCP({
    name: 'go_pass',
    description: 'Pass your turn at the go board. Two passes in a row end the game so the board can be counted.',
    enabled: joined,
    execute: logged(net, 'go_pass', () => {
      const st = net.station(ID);
      const state = parseGo(st?.state);
      const side = mySide(net, st?.seats ?? {});
      if (side && state.turn !== side) return `It is not your turn — ${turnWord(state.turn)} to play.`;
      const next = pass(state);
      net.stSet(ID, KIND, { ...next });
      const who = net.self?.name ?? 'someone';
      net.say(`${who} passes at the go board.`);
      return next.result
        ? `You passed — both players have now passed. ${next.result}.`
        : `You passed. It is now ${turnWord(next.turn)}'s turn.`;
    }),
  });

  useWebMCP({
    name: 'go_resign',
    description: 'Resign the current go game. The result is recorded and announced to the plaza.',
    enabled: joined,
    execute: logged(net, 'go_resign', () => {
      const st = net.station(ID);
      const state = parseGo(st?.state);
      const who = net.self?.name ?? 'someone';
      const next: GoState = { ...state, result: `${who} resigned` };
      net.stSet(ID, KIND, { ...next });
      net.say(`${who} resigns the game at the go board.`);
      return `You resigned. ${who} resigned.`;
    }),
  });

  useWebMCP({
    name: 'go_invite',
    description: 'Call out to the plaza for a go opponent to come and sit at the board.',
    enabled: joined,
    execute: logged(net, 'go_invite', () => {
      const who = net.self?.name ?? 'someone';
      net.say(`${who} wants a Go opponent at the go board — walk over and call go_join!`);
      return 'Invitation sent to the plaza.';
    }),
  });

  useWebMCP({
    name: 'go_advise',
    description: 'Offer a kibitz comment about the go game — a suggestion or observation broadcast to the plaza.',
    inputSchema: {
      type: 'object',
      properties: {
        text: { type: 'string', description: 'the advice or observation to share' },
      },
      required: ['text'],
    },
    enabled: joined,
    execute: logged(net, 'go_advise', ({ text }: { text?: string }) => {
      const msg = String(text ?? '').trim();
      if (!msg) return 'Nothing to say — provide some advice text.';
      net.say(`[go kibitz] ${msg}`);
      return 'Kibitz shared with the plaza.';
    }),
  });
}
