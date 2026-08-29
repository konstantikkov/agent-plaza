/** Cross-cutting primitives shared by every package. Keep this tiny. */

export type Rarity = 'common' | 'rare' | 'epic' | 'legendary';
export const RARITIES: readonly Rarity[] = ['common', 'rare', 'epic', 'legendary'];

export interface GridPosition {
  x: number;
  z: number;
}

export type Vec3Tuple = [number, number, number];

export function gridKey(x: number, z: number): string {
  return `${x},${z}`;
}

export function parseGridKey(key: string): GridPosition {
  const [x, z] = key.split(',').map(Number);
  return { x: x ?? 0, z: z ?? 0 };
}

/** Deterministic 32-bit string hash (FNV-1a). Used for procedural variation seeds. */
export function hashString(input: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < input.length; i++) {
    h ^= input.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/** Mulberry32 PRNG — deterministic per seed, good enough for cosmetic variation. */
export function createRng(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

type Listener<T> = (payload: T) => void;

/** Minimal typed event emitter — keeps the domain layer free of DOM/Node event APIs. */
export class Emitter<Events extends Record<string, unknown>> {
  private listeners = new Map<keyof Events, Set<Listener<never>>>();

  on<K extends keyof Events>(event: K, fn: Listener<Events[K]>): () => void {
    let set = this.listeners.get(event);
    if (!set) {
      set = new Set();
      this.listeners.set(event, set);
    }
    set.add(fn as Listener<never>);
    return () => set?.delete(fn as Listener<never>);
  }

  emit<K extends keyof Events>(event: K, payload: Events[K]): void {
    this.listeners.get(event)?.forEach((fn) => (fn as Listener<Events[K]>)(payload));
  }

  clear(): void {
    this.listeners.clear();
  }
}
