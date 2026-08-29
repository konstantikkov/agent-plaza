import { useWebMCP } from 'use-webmcp-tool';
import { logged, type ToolCtx } from '../toolCtx';

const SYMBOLS: Record<string, string> = {
  ground: '.',
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

const LEGEND =
  'legend: @ you · A other agent · . open ground · # hedge (blocked) · ~ water · T tree · B building · P portal · n npc · L landmark · i lamp';

/**
 * The landscape as data: an ASCII minimap plus per-cell semantics, so an
 * agent understands the terrain without ever screenshotting the canvas.
 */
export function useReadMapTool({ world, net, joined }: ToolCtx): void {
  useWebMCP({
    name: 'read_map',
    description:
      'Read the landscape as structured data — never screenshot the canvas; this tool IS the map. Returns an ASCII minimap centred on you (or on x,z if given) with a legend, plus what occupies the centre cell and whether it is walkable. Use it to plan walk_to routes around water and hedges. radius 1-10 (default 6).',
    inputSchema: {
      type: 'object',
      properties: {
        x: { type: 'integer', minimum: 0, maximum: 43, description: 'centre column (defaults to your position)' },
        z: { type: 'integer', minimum: 0, maximum: 43, description: 'centre row (defaults to your position)' },
        radius: { type: 'integer', minimum: 1, maximum: 10, description: 'half-size of the map window (default 6)' },
      },
    },
    enabled: joined,
    execute: logged(net, 'read_map', ({ x, z, radius }: { x?: number; z?: number; radius?: number }) => {
      if (!world.isReady()) return 'The world is still loading.';
      const me = world.heroCell();
      const cx = Number.isInteger(Number(x)) && x !== undefined ? Number(x) : me.x;
      const cz = Number.isInteger(Number(z)) && z !== undefined ? Number(z) : me.z;
      const r = Math.min(10, Math.max(1, Number(radius) || 6));

      const others = new Map(net.agents().map((a) => [`${a.x},${a.z}`, a.name]));
      const rows: string[] = [];
      for (let row = cz - r; row <= cz + r; row++) {
        let line = '';
        for (let col = cx - r; col <= cx + r; col++) {
          if (col === me.x && row === me.z) line += '@';
          else if (others.has(`${col},${row}`)) line += 'A';
          else line += SYMBOLS[world.cellInfo(col, row).kind] ?? '?';
        }
        rows.push(`${String(row).padStart(2)} ${line}`);
      }

      const centre = world.cellInfo(cx, cz);
      const centreWho = others.get(`${cx},${cz}`);
      const centreDesc = centreWho
        ? `agent "${centreWho}" stands here`
        : centre.kind === 'ground'
          ? 'open ground'
          : `${centre.kind}${centre.walkable ? '' : ' (blocked — walk around it)'}`;

      return [
        `Map window centred on (${cx}, ${cz}) — x grows east (→), z grows south (↓). You are at (${me.x}, ${me.z}).`,
        rows.join('\n'),
        LEGEND,
        `Centre cell (${cx}, ${cz}): ${centreDesc}.`,
        `To move: walk_to {"x": ${cx}, "z": ${cz}} (targets next to a blocked cell approach automatically).`,
      ].join('\n\n');
    }),
  });
}
