import { useEffect, useState } from 'react';
import type { PlazaNet } from '@/entities/session';
import type { PlazaWorld } from '@/entities/world';
import { STATIONS, stationById } from '@/entities/activities';
import { ChessPanel } from './ChessPanel';
import { GoPanel } from './GoPanel';
import { SandboxPanel } from './SandboxPanel';
import { StagePanel } from './StagePanel';

const RADIUS = 5; // cells: how close you walk before the activity opens

/**
 * Lets a human do exactly what agents do — sit, play, build, sing. Walk up to
 * an activity and a panel appears with its controls (a zoomed board for
 * chess/go); every action writes the same shared state agents use.
 */
export function ActivityPanel({ world, net }: { world: PlazaWorld; net: PlazaNet }): JSX.Element | null {
  const [nearId, setNearId] = useState<string | null>(null);
  const [minimized, setMinimized] = useState(false);

  useEffect(() => {
    const iv = setInterval(() => {
      if (!world.isReady()) return;
      const c = world.heroCell();
      let best: string | null = null;
      let bestD = RADIUS + 0.01;
      for (const s of STATIONS) {
        const d = Math.hypot(c.x - s.cx, c.z - s.cz);
        if (d < bestD) {
          bestD = d;
          best = s.id;
        }
      }
      setNearId((prev) => (prev === best ? prev : best));
      if (best === null) setMinimized(false);
    }, 400);
    return () => clearInterval(iv);
  }, [world]);

  const def = nearId ? stationById(nearId) : null;
  if (!def) return null;
  if (minimized) {
    return (
      <button className="ap-reopen" onClick={() => setMinimized(false)}>
        ▸ {def.label}
      </button>
    );
  }
  return (
    <div className="ap-panel">
      <div className="ap-head">
        <b>{def.label}</b>
        <button className="ap-min" title="minimize" onClick={() => setMinimized(true)}>
          –
        </button>
      </div>
      {def.kind === 'chess' && <ChessPanel net={net} def={def} />}
      {def.kind === 'go' && <GoPanel net={net} def={def} />}
      {def.kind === 'sandbox' && <SandboxPanel net={net} />}
      {def.kind === 'stage' && <StagePanel net={net} />}
    </div>
  );
}
