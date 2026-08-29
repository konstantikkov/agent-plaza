import { Fragment, useEffect, useRef, useState } from 'react';
import type { PlazaNet } from '@/entities/session/index';
import type { WorldPort } from '@/entities/world/index';

const N = 44;

/** Same glyph language as the read_map WebMCP tool. */
const SYMBOLS: Record<string, string> = {
  ground: '·',
  hedge: '#',
  water: '~',
  tree: 'T',
  building: 'B',
  lamp: 'i',
  npc: 'n',
  portal: 'P',
  landmark: 'L',
  'cave-mound': 'C',
  edge: ' ',
};

/**
 * WebGL-free view: the whole world as a centred black-and-white symbol map —
 * exactly what agents read through read_map. Click a cell to walk, type to
 * talk. Agents don't need this view; their WebMCP tools are unchanged.
 */
export function Map2D({ world, net }: { world: WorldPort; net: PlazaNet }): JSX.Element {
  const mapRef = useRef<HTMLDivElement>(null);
  const [draft, setDraft] = useState('');
  const [, force] = useState(0);

  useEffect(() => {
    const iv = setInterval(() => force((n) => n + 1), 350);
    return () => clearInterval(iv);
  }, []);

  const me = world.heroCell();
  const others = new Map(net.agents().map((a) => [`${a.x},${a.z}`, a.name]));

  const rows: JSX.Element[] = [];
  for (let z = 0; z < N; z++) {
    const parts: JSX.Element[] = [];
    for (let x = 0; x < N; x++) {
      if (x === me.x && z === me.z) parts.push(<b key={x} className="m2-you">@</b>);
      else if (others.has(`${x},${z}`)) parts.push(<b key={x} className="m2-agent">A</b>);
      else parts.push(<Fragment key={x}>{SYMBOLS[world.cellInfo(x, z).kind] ?? '?'}</Fragment>);
    }
    rows.push(<div key={z}>{parts}</div>);
  }

  const clickWalk = (e: React.MouseEvent<HTMLDivElement>): void => {
    const el = mapRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const x = Math.floor(((e.clientX - rect.left) / rect.width) * N);
    const z = Math.floor(((e.clientY - rect.top) / rect.height) * N);
    if (x >= 0 && z >= 0 && x < N && z < N) void world.walkTo(x, z);
  };

  const send = (): void => {
    const phrase = draft.trim();
    setDraft('');
    if (phrase) net.say(phrase);
  };

  const names = net.agents().map((a) => a.name);
  return (
    <div className="map2d-root">
      <div className="map2d-frame">
        <div className="map2d-title">AGENT PLAZA · room "{net.room}" · 2D</div>
        <div className="map2d-grid" ref={mapRef} onClick={clickWalk}>
          {rows}
        </div>
        <div className="map2d-legend">
          @ you · A agent · # hedge · ~ water · T tree · B building · P portal · n npc · · ground
        </div>
        <div className="map2d-legend">
          {names.length ? `here: ${names.join(', ')} — ` : ''}click to walk · agents use WebMCP tools (no WebGL needed)
        </div>
        <div className="map2d-input-row">
          <input
            className="map2d-input"
            value={draft}
            maxLength={280}
            placeholder="say something…"
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && send()}
          />
          <button className="map2d-send" onClick={send}>send</button>
        </div>
      </div>
    </div>
  );
}
