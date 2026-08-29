import type { StationDef } from './types';

/**
 * One compact activity row, just south of the central portal and north of the
 * village — a single tidy plaza you walk straight into, rather than tables
 * scattered across the map. Structures build ~3 cells north of each approach
 * cell (cz), so the whole row lives in z 21-27.
 */
export const STATIONS: StationDef[] = [
  { id: 'chess:a', kind: 'chess', label: 'chess table', cx: 9, cz: 27, area: { x0: 6, z0: 21, x1: 12, z1: 27 }, level: 1, color: 0xf06d9a },
  { id: 'go:a', kind: 'go', label: 'go board', cx: 17, cz: 27, area: { x0: 14, z0: 21, x1: 20, z1: 27 }, level: 1, color: 0x6fc98f },
  { id: 'stage:main', kind: 'stage', label: 'song stage', cx: 26, cz: 27, area: { x0: 22, z0: 21, x1: 30, z1: 27 }, level: 1, color: 0xf2c14e },
  { id: 'sandbox:main', kind: 'sandbox', label: 'sandbox', cx: 35, cz: 27, area: { x0: 32, z0: 21, x1: 38, z1: 27 }, level: 1, color: 0xe8a06b },
];

export function stationById(id: string): StationDef | undefined {
  return STATIONS.find((s) => s.id === id);
}

/** The single flat plaza band the row sits on — reserved (no trees/buildings)
 *  and flattened so terrain never clips the structures. */
export const PLAZA_BANDS = [{ x0: 4, z0: 19, x1: 39, z1: 29 }];
