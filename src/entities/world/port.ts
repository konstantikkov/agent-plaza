import type { WorldManifest } from './types';

/** One grid cell, described semantically (for read_map / the 2D fallback). */
export interface CellInfo {
  walkable: boolean;
  /** what occupies the cell: 'water' | 'hedge' | 'tree' | 'building' | 'portal' | … */
  kind: string;
}

/**
 * The world surface every consumer (WebMCP tools, presence wire, 2D map)
 * programs against. Implemented by the WebGL engine (PlazaWorld) and by the
 * headless FlatWorld fallback used when WebGL is unavailable — so agents get
 * the exact same tool surface either way.
 */
export interface WorldPort {
  isReady(): boolean;
  heroCell(): { x: number; z: number };
  getLayer(): 'surface' | 'cave';
  getPlaces(): { kind: string; x: number; z: number }[];
  exportWorld(): WorldManifest;
  walkTo(x: number, z: number): Promise<'arrived' | 'blocked' | 'no-path' | 'interrupted'>;
  cellInfo(x: number, z: number): CellInfo;
}
