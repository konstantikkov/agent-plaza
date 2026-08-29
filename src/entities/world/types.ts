import type { GridPosition } from '@/shared/lib/shared';

/** Public API types: filter modes, stats, callbacks. */
export type FilterMode = 'off' | 'gouache' | 'oil' | 'pale' | 'charcoal' | 'portal';

export interface WorldStats {
  fps: number;
  drawCalls: number;
  triangles: number;
  coveragePercent: number;
  fallbackIds: string[];
  playerCell: GridPosition;
}

export interface WorldCallbacks {
  onLoading(phase: string): void;
  onReady(): void;
  onStats(stats: WorldStats): void;
}

/** One thing that exists in the world — everything on the map is one of these. */
export interface WorldEntity {
  id: string;
  kind: string;
  category: 'npc' | 'building' | 'object' | 'nature' | 'portal' | 'entrance' | 'terrain';
  x: number;
  z: number;
  layer: 'surface' | 'cave';
  alive: boolean;
  solid: boolean;
  interactive: boolean;
  source: 'generated';
  meta?: Record<string, unknown>;
}

/** The complete machine-readable map: everything an agent needs to reason about proximity. */
export interface WorldManifest {
  version: 1;
  seed: string;
  size: number;
  archetype: string;
  daytime: string;
  weather: string;
  /** size x size rows of block levels; -1 = water. Border ring is implicit rock. */
  levels: number[][];
  entities: WorldEntity[];
  note: string;
}
