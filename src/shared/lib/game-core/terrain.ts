export const TERRAIN_TYPES = [
  'floor',
  'raised',
  'water',
  'void',
  'wall',
  'stairs',
  'bridge',
] as const;

export type TerrainType = (typeof TERRAIN_TYPES)[number];

export const TERRAIN_WALKABLE: Record<TerrainType, boolean> = {
  floor: true,
  raised: true,
  stairs: true,
  bridge: true,
  water: false,
  void: false,
  wall: false,
};

/** Visual height of the walkable surface, in world units. Rendering-only hint. */
export const TERRAIN_SURFACE_HEIGHT: Record<TerrainType, number> = {
  floor: 0,
  raised: 0.25,
  stairs: 0.12,
  bridge: 0.1,
  water: -0.22,
  void: -2,
  wall: 1.1,
};
