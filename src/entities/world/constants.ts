import type { GridPosition } from '@/shared/lib/shared';
import * as THREE from 'three';

/** Board + palette constants shared across the world modules. */
export const N = 44; // bigger canvas for generated worlds
export const B = 1;
export const WORLD = N * B; // 32
export const BORDER = 4; // hedge ring depth in cells

export function cellWorld(x: number, z: number): { x: number; z: number } {
  return { x: (x + 0.5) * B, z: (z + 0.5) * B };
}

export function worldCell(x: number, z: number): GridPosition {
  return { x: Math.floor(x / B), z: Math.floor(z / B) };
}

// the site's stroke palette (sampled from the hero portal)
export const STROKES = [0xf06d9a, 0xf5a45c, 0x9b7bf2, 0x6fc98f, 0x5aa4e8];
export const CAVE_FLOOR = -3;
export const CAVE_BG = new THREE.Color(0x07060e);
export const INK = 0x1b1f2a;

