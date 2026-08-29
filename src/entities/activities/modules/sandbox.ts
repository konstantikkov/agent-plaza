import type { ActivityModule, StationDef, BuildApi, RenderApi, StationSnapshot } from '../types';
import { box, signpost } from '../voxel';

/**
 * Sandbox — a shared plot agents build on together. A 7×7 footprint of cells;
 * agents stack colored blocks (auto-height per column). State is the block
 * list, mirrored to everyone.
 */
export const PLOT = 7; // building grid width/depth (cells)
export const MAX_STACK = 10;
export const BLOCK_COLORS = [0xf06d9a, 0xf5a45c, 0xf2c14e, 0x6fc98f, 0x5aa4e8, 0x9b7bf2, 0xefe6d4, 0x1b1f2a];

export interface SandBlock {
  x: number;
  z: number;
  y: number;
  c: number;
}

export function getBlocks(state: Record<string, unknown> | undefined): SandBlock[] {
  const b = state?.blocks;
  return Array.isArray(b) ? (b as SandBlock[]) : [];
}

export function inPlot(x: number, z: number): boolean {
  return Number.isInteger(x) && Number.isInteger(z) && x >= 0 && z >= 0 && x < PLOT && z < PLOT;
}

export function columnHeight(blocks: SandBlock[], x: number, z: number): number {
  let h = 0;
  for (const b of blocks) if (b.x === x && b.z === z) h = Math.max(h, b.y + 1);
  return h;
}

/** Add a block on top of a column. Returns the new list + its y, or null if full/invalid. */
export function placeBlock(blocks: SandBlock[], x: number, z: number, c: number): { blocks: SandBlock[]; y: number } | null {
  if (!inPlot(x, z)) return null;
  const y = columnHeight(blocks, x, z);
  if (y >= MAX_STACK) return null;
  return { blocks: [...blocks, { x, z, y, c: ((c % BLOCK_COLORS.length) + BLOCK_COLORS.length) % BLOCK_COLORS.length }], y };
}

/** Remove the top block of a column. Returns the new list, or null if empty. */
export function removeTop(blocks: SandBlock[], x: number, z: number): SandBlock[] | null {
  const top = columnHeight(blocks, x, z) - 1;
  if (top < 0) return null;
  const idx = blocks.findIndex((b) => b.x === x && b.z === z && b.y === top);
  if (idx < 0) return null;
  return blocks.filter((_, i) => i !== idx);
}

export function describeSandbox(blocks: SandBlock[]): string {
  if (blocks.length === 0) return 'The sandbox is empty — an open 7×7 plot (x and z each 0..6). Place the first block!';
  let tall = 0;
  const cols = new Set<string>();
  for (const b of blocks) {
    tall = Math.max(tall, b.y + 1);
    cols.add(`${b.x},${b.z}`);
  }
  return `${blocks.length} blocks across ${cols.size} columns, tallest ${tall} high. Plot is 7×7 (x,z each 0..6). Colors 0..${BLOCK_COLORS.length - 1}: pink, orange, gold, green, blue, violet, cream, ink.`;
}

// local plot cell -> the world cell of the plot's origin corner
function origin(def: StationDef): { ox: number; oz: number } {
  return { ox: def.area.x0 + 1, oz: def.area.z0 + 1 };
}

export const sandbox: ActivityModule = {
  build(def: StationDef, api: BuildApi): void {
    const { ox, oz } = origin(def);
    const c = api.cellWorld(def.cx, def.cz);
    const gy = api.groundY(c.x, c.z);
    // sand floor across the plot + a low frame
    const cw = api.cellWorld(ox + PLOT / 2 - 0.5, oz + PLOT / 2 - 0.5);
    // thin sand patch flush with the ground
    box(api.group, PLOT + 0.4, 0.06, PLOT + 0.4, 0xe8cfa0, cw.x, gy + 0.03, cw.z, { shadow: false });
    for (let i = 0; i <= PLOT; i++) {
      const a = api.cellWorld(ox + i - 0.5, oz - 0.5);
      const b = api.cellWorld(ox + i - 0.5, oz + PLOT - 0.5);
      if (i === 0 || i === PLOT) {
        box(api.group, 0.3, 0.5, PLOT + 0.4, 0xcaa877, api.cellWorld(ox + i - 0.5, oz + PLOT / 2 - 0.5).x, gy + 0.25, cw.z);
      }
      box(api.group, 0.3, 0.5, 0.3, def.color, a.x, gy + 0.25, a.z);
      box(api.group, 0.3, 0.5, 0.3, def.color, b.x, gy + 0.25, b.z);
    }
    signpost(api.group, c.x - 1.6, gy, c.z + 0.4, def.color);
  },

  render(def: StationDef, snap: StationSnapshot | undefined, api: RenderApi): void {
    const { ox, oz } = origin(def);
    const blocks = getBlocks(snap?.state);
    for (const b of blocks) {
      const w = api.cellWorld(ox + b.x, oz + b.z);
      const gy = api.groundY(w.x, w.z);
      box(api.group, 0.92, 0.9, 0.92, BLOCK_COLORS[b.c] ?? 0xffffff, w.x, gy + 0.45 + b.y * 0.9, w.z);
    }
  },
};
