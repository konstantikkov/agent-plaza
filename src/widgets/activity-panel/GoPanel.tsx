import type { PlazaNet } from '@/entities/session';
import type { StationDef } from '@/entities/activities';
import { initialGo, parseGo, placeStone, pass, BOARD_N } from '@/entities/activities/modules/go';
import { useStationState } from './useStationState';

/** Zoomed-in, click-to-place go board for humans. */
export function GoPanel({ net, def }: { net: PlazaNet; def: StationDef }): JSX.Element {
  const st = useStationState(net, def.id);
  const game = parseGo(st?.state);
  const seats = st?.seats ?? {};
  const myId = net.self?.id;
  const mySeat = seats.black === myId ? 'b' : seats.white === myId ? 'w' : null;
  const started = typeof st?.state?.board === 'string';
  const noSeats = !seats.black && !seats.white;
  const canMove = !game.result && (mySeat === game.turn || (noSeats && !!myId));

  const sit = (color: 'black' | 'white'): void => {
    net.stJoin(def.id, 'go', color);
    if (!started) net.stSet(def.id, 'go', { board: initialGo(), turn: 'b', captures: { b: 0, w: 0 }, passes: 0 });
  };

  const click = (x: number, y: number): void => {
    if (!canMove) return;
    const res = placeStone(game, x, y);
    if (res.ok) net.stSet(def.id, 'go', { ...res.state });
  };

  return (
    <div className="ap-go">
      <div className="ap-row">
        <button className="ap-btn" disabled={!!seats.black && seats.black !== myId} onClick={() => sit('black')}>
          {seats.black === myId ? '✓ ' : ''}● sit black{seats.black && seats.black !== myId ? ' (taken)' : ''}
        </button>
        <button className="ap-btn" disabled={!!seats.white && seats.white !== myId} onClick={() => sit('white')}>
          {seats.white === myId ? '✓ ' : ''}○ sit white{seats.white && seats.white !== myId ? ' (taken)' : ''}
        </button>
      </div>
      <div className="ap-board ap-goboard" style={{ gridTemplateColumns: `repeat(${BOARD_N}, 1fr)` }}>
        {Array.from({ length: BOARD_N * BOARD_N }, (_, i) => {
          const x = i % BOARD_N;
          const y = Math.floor(i / BOARD_N);
          const c = game.board[y * BOARD_N + x] ?? '.';
          return (
            <button key={i} className="ap-gopt" onClick={() => click(x, y)}>
              {c === 'b' ? <span className="ap-stone b" /> : c === 'w' ? <span className="ap-stone w" /> : ''}
            </button>
          );
        })}
      </div>
      <div className="ap-row">
        <button className="ap-btn" disabled={!canMove} onClick={() => canMove && net.stSet(def.id, 'go', { ...pass(game) })}>
          pass
        </button>
        <span className="ap-status">
          {game.result
            ? game.result
            : `${game.turn === 'b' ? 'Black' : 'White'} to move · captures ●${game.captures.b} ○${game.captures.w}`}
        </span>
      </div>
    </div>
  );
}
