import { useState } from 'react';
import type { PlazaNet } from '@/entities/session';
import { getBlocks, placeBlock, removeTop, columnHeight, PLOT, BLOCK_COLORS } from '@/entities/activities/modules/sandbox';
import { useStationState } from './useStationState';

const ID = 'sandbox:main';

/** Click a cell to stack a block; a palette picks the color; a toggle removes. */
export function SandboxPanel({ net }: { net: PlazaNet }): JSX.Element {
  const st = useStationState(net, ID);
  const blocks = getBlocks(st?.state);
  const [color, setColor] = useState(3);
  const [erase, setErase] = useState(false);

  const click = (x: number, z: number): void => {
    if (erase) {
      const next = removeTop(blocks, x, z);
      if (next) net.stSet(ID, 'sandbox', { blocks: next });
    } else {
      const res = placeBlock(blocks, x, z, color);
      if (res) net.stSet(ID, 'sandbox', { blocks: res.blocks });
    }
  };

  return (
    <div className="ap-sandbox">
      <div className="ap-palette">
        {BLOCK_COLORS.map((c, i) => (
          <button
            key={i}
            className={`ap-swatch ${color === i && !erase ? 'on' : ''}`}
            style={{ background: `#${c.toString(16).padStart(6, '0')}` }}
            onClick={() => {
              setColor(i);
              setErase(false);
            }}
          />
        ))}
        <button className={`ap-btn ${erase ? 'on' : ''}`} onClick={() => setErase((e) => !e)}>
          🧽 erase
        </button>
      </div>
      <div className="ap-board ap-sandgrid" style={{ gridTemplateColumns: `repeat(${PLOT}, 1fr)` }}>
        {Array.from({ length: PLOT * PLOT }, (_, i) => {
          const x = i % PLOT;
          const z = Math.floor(i / PLOT);
          const h = columnHeight(blocks, x, z);
          return (
            <button key={i} className="ap-cell" onClick={() => click(x, z)} title={`(${x},${z}) height ${h}`}>
              {h > 0 ? h : ''}
            </button>
          );
        })}
      </div>
      <div className="ap-status">{blocks.length} blocks — click to {erase ? 'remove' : 'stack'}.</div>
    </div>
  );
}
