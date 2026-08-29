import { createRng, hashString } from '@/shared/lib/shared';
import { N, STROKES } from './constants';
import type { Daytime, Weather } from './presets';

export interface WorldLayout {
  corridorX0: number;
  corridorMid: number;
  portal: { cx: number; cz: number; wx: number; wz: number };
  plaza: { x0: number; x1: number; z0: number; z1: number };
  pond: { x0: number; z0: number; size: number; cx: number; cz: number };
  hasRiver: boolean;
  riverAmp: number;
  riverPhase: number;
  riverFreq: number;
  bridgeZ0: number;
  village: { x: number; z: number };
  crystalsAt: { x: number; z: number };
  guide: { x: number; z: number };
  spawn: { x: number; z: number };
  archetype: 'meadow' | 'canyon' | 'garden' | 'mesa' | 'lakes';
  hillMul: number;
  hillBase: number;
  mesaCount: number;
  lakes: { x: number; z: number; r: number }[];
  treeTarget: number;
  flowerChance: number;
  paperTint: number;
  hueShift: number;
  daytimePick: Daytime;
  weatherPick: Weather;
  queueCount: number;
  villageCount: number;
  islandCount: number;
  cloudCount: number;
  mountains: { x: number; z: number; peak: number; r: number }[];
}

/** Optional forced traits — the text-to-map interpreter feeds these in. */
export interface LayoutOverrides {
  archetype?: WorldLayout['archetype'];
  daytime?: Daytime;
  weather?: Weather;
  hasRiver?: boolean;
}

/** Everything positional a map needs, derived purely from the seed. */
export function createLayout(
  seed: string,
  overrides?: LayoutOverrides,
): { layout: WorldLayout; strokes: number[] } {
  let strokes: number[] = STROKES;

    const rng = createRng(hashString(seed + '-layout'));
    const corridorX0 = 6 + Math.floor(rng() * (N - 25)); // corridor anywhere along the south
    const corridorMid = corridorX0 + 2;
    const pcx = corridorX0 + 1; // portal 2×2 sits on the corridor axis
    const pcz = Math.floor(N * 0.3) + Math.floor(rng() * 5);
    const west = corridorMid > 16;
    const pondX0 = west ? 4 + Math.floor(rng() * 4) : N - 12 + Math.floor(rng() * 3);
    const pondZ0 = 4 + Math.floor(rng() * 3);
    const villageWest = rng() < 0.5;
    const vx = Math.min(N - 8, Math.max(5, corridorX0 + (villageWest ? -8 : 6)));
    const sx = Math.min(N - 9, Math.max(5, corridorX0 + (villageWest ? 7 : -9)));
    const layout: WorldLayout = {
      corridorX0,
      corridorMid,
      portal: { cx: pcx, cz: pcz, wx: pcx + 1, wz: pcz + 1 },
      plaza: {
        x0: Math.max(4, pcx - 4),
        x1: Math.min(N - 5, pcx + 6),
        z0: Math.max(4, pcz - 2),
        z1: Math.min(N - 5, pcz + 5),
      },
      pond: { x0: pondX0, z0: pondZ0, size: 5, cx: pondX0 + 2.5, cz: pondZ0 + 2.5 },
      hasRiver: rng() < 0.85,
      riverAmp: 1.4 + rng() * 1.1,
      riverPhase: rng() * Math.PI * 2,
      riverFreq: 0.28 + rng() * 0.16,
      bridgeZ0: N - 13 + Math.floor(rng() * 4),
      village: { x: vx, z: N - 11 + Math.floor(rng() * 2) },
      crystalsAt: { x: sx, z: N - 11 + Math.floor(rng() * 3) },
      guide: { x: corridorX0 - 2 >= 5 ? corridorX0 - 2 : corridorX0 + 5, z: N - 11 },
      spawn: { x: corridorMid, z: N - 6 },
      archetype: 'meadow',
      hillMul: 1,
      hillBase: 0,
      mesaCount: 2,
      lakes: [],
      treeTarget: 9,
      flowerChance: 0.16,
      paperTint: 0xf5ecdf,
      hueShift: 0,
      daytimePick: 'dawn',
      weatherPick: 'snow',
      queueCount: 5,
      villageCount: 3,
      islandCount: 3,
      cloudCount: 6,
      mountains: [],
    };
    // ---- archetype: each seed rolls a different KIND of map ----
    const roll = rng();
    const L = layout;
    const forced = overrides?.archetype;
    const pick =
      forced ??
      (roll < 0.28
        ? 'meadow'
        : roll < 0.48
          ? 'canyon'
          : roll < 0.68
            ? 'garden'
            : roll < 0.86
              ? 'mesa'
              : 'lakes');
    if (pick === 'meadow') {
      L.archetype = 'meadow'; // gentle hills, river likely (the classic)
    } else if (pick === 'canyon') {
      L.archetype = 'canyon'; // high rims everywhere, the river cuts a gorge
      L.hillBase = 1;
      L.hillMul = 1.5;
      L.mesaCount = 1;
      L.treeTarget = 5;
      L.hasRiver = true;
    } else if (pick === 'garden') {
      L.archetype = 'garden'; // nearly flat, crowded with trees and flowers
      L.hillMul = 0.35;
      L.mesaCount = 0;
      L.treeTarget = 16;
      L.flowerChance = 0.34;
      L.hasRiver = rng() < 0.5;
    } else if (pick === 'mesa') {
      L.archetype = 'mesa'; // dry stepped buttes, no water at all
      L.hillMul = 1.25;
      L.mesaCount = 4;
      L.hasRiver = false;
      L.treeTarget = 6;
      L.flowerChance = 0.08;
    } else {
      L.archetype = 'lakes'; // still pools scattered across the north
      L.hasRiver = false;
      L.hillMul = 0.7;
      L.mesaCount = 1;
      L.treeTarget = 10;
      const lakeCount = 2 + Math.floor(rng() * 2);
      for (let li = 0; li < lakeCount; li++) {
        L.lakes.push({
          x: 5 + rng() * 22,
          z: 5 + rng() * (N / 2 - 6),
          r: 1.6 + rng() * 1.4,
        });
      }
    }
    // ---- look: paper tint, palette, hour, weather ----
    const papers = [0xf5ecdf, 0xf7f1e6, 0xf2ecf4, 0xecf2ea, 0xf6ede4];
    L.paperTint = papers[Math.floor(rng() * papers.length)]!;
    L.hueShift = (rng() - 0.5) * 0.12;
    const palettes = [
      [0xf06d9a, 0xf5a45c, 0x9b7bf2, 0x6fc98f, 0x5aa4e8],
      [0xff3b7b, 0xff9a2e, 0x2ecc71, 0x2e9bff, 0x8b3bff],
      [0x7c5cff, 0x3fa9ff, 0x41e0c8, 0xff7ab8, 0xb08bff],
      [0xe8618c, 0xf2a03d, 0x4fbf7f, 0x3b9be8, 0x8b5cf6],
    ];
    strokes = palettes[Math.floor(rng() * palettes.length)]!;
    const hours: Daytime[] = ['dawn', 'dawn', 'day', 'day', 'dusk', 'night'];
    L.daytimePick = hours[Math.floor(rng() * hours.length)]!;
    const skies: Weather[] = ['snow', 'snow', 'snow', 'clear', 'clear', 'fog', 'rain'];
    L.weatherPick = skies[Math.floor(rng() * skies.length)]!;
    // ---- counts ----
    // mountains: one or two proud peaks near the rim, caves love their flanks
    const mountainCount = 1 + (rng() < 0.7 ? 1 : 0);
    for (let mi = 0; mi < mountainCount; mi++) {
      const ma = rng() * Math.PI * 2;
      const mr = N * (0.32 + rng() * 0.1);
      L.mountains.push({
        x: N / 2 + Math.cos(ma) * mr,
        z: Math.min(N * 0.62, N / 2 + Math.sin(ma) * mr),
        peak: 6 + Math.floor(rng() * 3),
        r: 5 + rng() * 2.5,
      });
    }
    L.queueCount = 3 + Math.floor(rng() * 5);
    L.villageCount = 2 + Math.floor(rng() * 3);
    L.islandCount = Math.floor(rng() * 5);
    L.cloudCount = 3 + Math.floor(rng() * 6);
  if (overrides?.daytime) layout.daytimePick = overrides.daytime;
  if (overrides?.weather) layout.weatherPick = overrides.weather;
  if (overrides?.hasRiver !== undefined && layout.archetype !== 'mesa') {
    layout.hasRiver = overrides.hasRiver;
  }
  return { layout, strokes };
}
