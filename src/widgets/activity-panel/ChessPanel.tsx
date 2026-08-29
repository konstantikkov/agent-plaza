import { useState } from 'react';
import type { PlazaNet } from '@/entities/session';
import type { StationDef } from '@/entities/activities';
import { initialBoard, applyMove, readState, type ChessState } from '@/entities/activities/modules/chess';
import { useStationState } from './useStationState';

const GLYPH: Record<string, string> = {
  K: '♔', Q: '♕', R: '♖', B: '♗', N: '♘', P: '♙',
  k: '♚', q: '♛', r: '♜', b: '♝', n: '♞', p: '♟',
};

function idxToSquare(i: number): string {
  return String.fromCharCode(97 + (i % 8)) + String(8 - Math.floor(i / 8));
}

/** Zoomed-in, click-to-move chess board for humans. */
export function ChessPanel({ net, def }: { net: PlazaNet; def: StationDef }): JSX.Element {
  const st = useStationState(net, def.id);
  const game: ChessState | null = readState(st?.state);
  const seats = st?.seats ?? {};
  const myId = net.self?.id;
  const mySeat = seats.white === myId ? 'w' : seats.black === myId ? 'b' : null;
  const [sel, setSel] = useState<number | null>(null);

  const sit = (color: 'white' | 'black'): void => {
    net.stJoin(def.id, 'chess', color);
    if (!game) net.stSet(def.id, 'chess', { board: initialBoard(), turn: 'w', moves: [] });
  };

  const noSeats = !seats.white && !seats.black;
  const canMove = !!game && !game.result && (mySeat === game.turn || (noSeats && !!myId));

  const clickSquare = (i: number): void => {
    if (!game || !canMove) return;
    const piece = game.board[i];
    if (sel === null) {
      // pick up your own piece
      if (piece && piece !== '.') {
        const isWhite = piece === piece.toUpperCase();
        if ((game.turn === 'w') === isWhite) setSel(i);
      }
      return;
    }
    if (i === sel) {
      setSel(null);
      return;
    }
    const res = applyMove(game, idxToSquare(sel), idxToSquare(i));
    setSel(null);
    if (res.ok) net.stSet(def.id, 'chess', { ...res.state });
  };

  return (
    <div className="ap-chess">
      <div className="ap-row">
        <button className="ap-btn" disabled={!!seats.white && seats.white !== myId} onClick={() => sit('white')}>
          {seats.white === myId ? '✓ ' : ''}♔ sit white{seats.white && seats.white !== myId ? ' (taken)' : ''}
        </button>
        <button className="ap-btn" disabled={!!seats.black && seats.black !== myId} onClick={() => sit('black')}>
          {seats.black === myId ? '✓ ' : ''}♚ sit black{seats.black && seats.black !== myId ? ' (taken)' : ''}
        </button>
      </div>
      {game ? (
        <>
          <div className="ap-board ap-chessboard">
            {Array.from({ length: 64 }, (_, i) => {
              const light = (Math.floor(i / 8) + (i % 8)) % 2 === 0;
              const ch = game.board[i] ?? '.';
              return (
                <button
                  key={i}
                  className={`ap-sq ${light ? 'lt' : 'dk'} ${sel === i ? 'sel' : ''}`}
                  onClick={() => clickSquare(i)}
                >
                  {ch !== '.' ? GLYPH[ch] : ''}
                </button>
              );
            })}
          </div>
          <div className="ap-status">
            {game.result
              ? game.result
              : `${game.turn === 'w' ? 'White' : 'Black'} to move` + (canMove ? ' — your turn' : mySeat ? ' — waiting' : ' — sit to play')}
          </div>
        </>
      ) : (
        <div className="ap-status">Empty table. Sit down to start a game.</div>
      )}
    </div>
  );
}
