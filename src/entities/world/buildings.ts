import * as THREE from 'three';
import { createRng, hashString } from '@/shared/lib/shared';
import type { Grid } from '@/shared/lib/game-core/grid';
import { N, INK, cellWorld } from './constants';
import { makeVoxelFolk, type VoxelFolk } from './folk';
import type { WorldLayout } from './layout';

/** Everything the settlement builder needs from the game world. */
export interface BuildingsCtx {
  seed: string;
  layout: WorldLayout;
  strokes: number[];
  levels: Int8Array;
  bridgeSet: Set<number>;
  caveMask: Uint8Array;
  roomMask: Uint8Array;
  caveFloorH: Float32Array;
  entranceSet: Set<string>;
  grid: Grid;
  worldSurface: THREE.Group;
  caveGroup: THREE.Group;
  interactCells: Map<string, { id: string; label: string }>;
  landmarks: { kind: string; x: number; z: number }[];
  lanterns: { mat: THREE.MeshBasicMaterial; hue: THREE.Color }[];
  interiorLights: { light: THREE.PointLight; base: number }[];
  buildingRects: { x0: number; z0: number; x1: number; z1: number; kind?: string; doorX?: number; doorZ?: number }[];
  folk: VoxelFolk[];
}

// ---------- buildings: enterable, typed, furnished ----------
export function buildBuildings(ctx: BuildingsCtx): void {
  const rng = createRng(hashString(ctx.seed + '-houses'));
  const L = ctx.layout;
  type BType = 'cottage' | 'tavern' | 'cathedral';
  const plan: BType[] = ['cottage'];
  if (rng() < 0.7) plan.push('tavern');
  if (rng() < 0.55) plan.push('cathedral');
  if (rng() < 0.4) plan.push('cottage');
  // biggest first — easier to place
  plan.sort((p1, p2) => (p1 === 'cathedral' ? -1 : p2 === 'cathedral' ? 1 : p1 === 'tavern' ? -1 : 1));

  const DIMS: Record<BType, { w: number; d: number; h: number }> = {
    cottage: { w: 6, d: 5, h: 3 },
    tavern: { w: 8, d: 6, h: 4 },
    cathedral: { w: 7, d: 9, h: 5 },
  };
  let built = 0;
  const siteOk = (bx: number, bz: number, bw: number, bd: number): number | null => {
    if (bx < 8 || bz < 8 || bx + bw > N - 8 || bz + bd > N - 8) return null;
    // keep clear of the fixed south-band furniture: village, crystals, guide
    const clash = (rx0: number, rz0: number, rx1: number, rz1: number): boolean =>
      bx + bw > rx0 && bx < rx1 && bz + bd > rz0 && bz < rz1;
    if (clash(L.village.x - 2, L.village.z - 2, L.village.x + 3, L.village.z + 3)) return null;
    if (clash(L.crystalsAt.x - 1, L.crystalsAt.z - 1, L.crystalsAt.x + 3, L.crystalsAt.z + 3)) return null;
    if (clash(L.guide.x - 1, L.guide.z - 1, L.guide.x + 2, L.guide.z + 2)) return null;
    if (bx + bw >= L.corridorX0 - 1 && bx <= L.corridorX0 + 4) return null;
    if (
      bx + bw >= L.plaza.x0 - 1 &&
      bx <= L.plaza.x1 + 1 &&
      bz + bd >= L.plaza.z0 - 1 &&
      bz <= L.plaza.z1 + 1
    ) {
      return null;
    }
    // breathing room from other buildings
    for (const r of ctx.buildingRects) {
      if (bx + bw > r.x0 - 2 && bx < r.x1 + 2 && bz + bd > r.z0 - 2 && bz < r.z1 + 2) return null;
    }
    const lvl0 = ctx.levels[bz * N + bx]!;
    if (lvl0 < 0) return null;
    // footprint AND a one-cell ring must be free (walls need air)
    for (let z = bz - 1; z < bz + bd + 1; z++) {
      for (let x = bx - 1; x < bx + bw + 1; x++) {
        if (x < 4 || z < 4 || x >= N - 4 || z >= N - 4) return null;
        const i = z * N + x;
        const inFoot = x >= bx && x < bx + bw && z >= bz && z < bz + bd;
        if (inFoot && ctx.levels[i]! !== lvl0) return null;
        if (ctx.bridgeSet.has(i)) return null;
        if (ctx.levels[i]! < 0) return null;
        if (ctx.grid.occupantAt(x, z) !== undefined) return null;
      }
    }
    const doorX = bx + Math.floor(bw / 2);
    const doorZ = bz + bd - 1;
    const outside = (doorZ + 1) * N + doorX;
    if (
      doorZ + 1 > N - 5 ||
      ctx.levels[outside]! < 0 ||
      Math.abs(ctx.levels[outside]! - lvl0) > 1 ||
      ctx.grid.occupantAt(doorX, doorZ + 1) !== undefined
    ) {
      return null;
    }
    return lvl0;
  };
  for (const btype of plan) {
    const base = DIMS[btype];
    const bw = base.w + (btype === 'cathedral' ? 0 : Math.floor(rng() * 2));
    const bd = base.d + (btype === 'cathedral' ? Math.floor(rng() * 2) : Math.floor(rng() * 2));
    const wallH = base.h;
    // collect every legal site, then score: spread from other buildings,
    // lean toward the village, add a little seeded whimsy
    const candidates: { bx: number; bz: number; lvl0: number; score: number }[] = [];
    for (let bz = 8; bz <= N - 8 - bd; bz++) {
      for (let bx = 8; bx <= N - 8 - bw; bx++) {
        const lvl0 = siteOk(bx, bz, bw, bd);
        if (lvl0 === null) continue;
        const cx = bx + bw / 2;
        const cz = bz + bd / 2;
        let nearest = 99;
        for (const r of ctx.buildingRects) {
          nearest = Math.min(
            nearest,
            Math.hypot(cx - (r.x0 + r.x1) / 2, cz - (r.z0 + r.z1) / 2),
          );
        }
        const spread = Math.min(nearest, 10);
        const toVillage = Math.hypot(cx - L.village.x, cz - L.village.z);
        const edgeRoom = Math.min(bx - 4, bz - 4, N - 4 - (bx + bw), N - 4 - (bz + bd), 6);
        candidates.push({
          bx,
          bz,
          lvl0,
          score: spread * 1.3 - toVillage * 0.35 + edgeRoom * 0.8 + rng() * 4,
        });
      }
    }
    if (candidates.length === 0) {
      console.info(`[plaza] no site found for ${btype} (seed ${ctx.seed})`);
      continue;
    }
    candidates.sort((c1, c2) => c2.score - c1.score);
    const pick = candidates[Math.floor(rng() * Math.min(3, candidates.length))]!;
    erectBuilding(
      ctx,
      btype,
      pick.bx,
      pick.bz,
      bw,
      bd,
      wallH,
      pick.lvl0 * 0.5,
      pick.bx + Math.floor(bw / 2),
      pick.bz + bd - 1,
      built,
      rng,
    );
    ctx.buildingRects.push({
      x0: pick.bx,
      z0: pick.bz,
      x1: pick.bx + bw,
      z1: pick.bz + bd,
      kind: btype,
      doorX: pick.bx + Math.floor(bw / 2),
      doorZ: pick.bz + bd - 1,
    });
    built++;
  }
  console.info(`[plaza] buildings: ${built}/${plan.length} placed`);
}

function erectBuilding(
  ctx: BuildingsCtx,
  btype: 'cottage' | 'tavern' | 'cathedral',
  bx: number,
  bz: number,
  bw: number,
  bd: number,
  wallH: number,
  floorY: number,
  doorX: number,
  doorZ: number,
  index: number,
  _rng: () => number,
): void {
  // ---- occupancy + interior carve ----
  for (let z = bz; z < bz + bd; z++) {
    for (let x = bx; x < bx + bw; x++) {
      if (x === doorX && z === doorZ) continue;
      try {
        ctx.grid.place(`house-${x}-${z}`, x, z, { width: 1, depth: 1 });
      } catch {
        /* claimed */
      }
    }
  }
  for (let z = bz + 1; z < bz + bd - 1; z++) {
    for (let x = bx + 1; x < bx + bw - 1; x++) {
      const i = z * N + x;
      ctx.caveMask[i] = 1;
      ctx.roomMask[i] = 1;
      ctx.caveFloorH[i] = floorY;
    }
  }
  const di = doorZ * N + doorX;
  ctx.caveMask[di] = 1;
  ctx.roomMask[di] = 1;
  ctx.caveFloorH[di] = floorY;
  ctx.entranceSet.add(`${doorX},${doorZ}`);

  // ---- shared materials ----
  const ink = new THREE.MeshLambertMaterial({ color: INK });
  const stone = new THREE.MeshLambertMaterial({ color: 0xcfc8bc });
  const wood = new THREE.MeshLambertMaterial({ color: 0xb9905e });
  const roofMat = new THREE.MeshLambertMaterial({ color: ctx.strokes[index % ctx.strokes.length]! });
  const glowWarm = (): THREE.MeshBasicMaterial =>
    new THREE.MeshBasicMaterial({ color: 0xffd9a0, toneMapped: false });

  // ---- exterior walls, Minecraft-village style ----
  const cobble = new THREE.MeshLambertMaterial({ color: 0x9a9a92 });
  const plank = new THREE.MeshLambertMaterial({ color: 0xc8a06a });
  const plankLight = new THREE.MeshLambertMaterial({ color: 0xd6b17e });
  const log = new THREE.MeshLambertMaterial({ color: 0x7c5c3a });
  const stoneBrick = new THREE.MeshLambertMaterial({ color: 0xb5b0a4 });
  const stoneDark = new THREE.MeshLambertMaterial({ color: 0x8d887c });
  for (let z = bz; z < bz + bd; z++) {
    for (let x = bx; x < bx + bw; x++) {
      const edge = x === bx || x === bx + bw - 1 || z === bz || z === bz + bd - 1;
      if (!edge) continue;
      if (x === doorX && z === doorZ) continue;
      const corner =
        (x === bx || x === bx + bw - 1) && (z === bz || z === bz + bd - 1);
      const frameCol =
        btype !== 'cottage' && !corner && ((x + z) % 3 === 0); // timber/pillar rhythm
      for (let hh = 0; hh < wallH; hh++) {
        let mat = hh % 2 === 0 ? plank : plankLight;
        if (btype === 'cathedral') {
          mat = hh === 0 ? stoneDark : corner || frameCol ? stoneDark : stoneBrick;
        } else {
          if (hh === 0) mat = cobble;
          else if (corner || (btype === 'tavern' && frameCol)) mat = log;
        }
        const size = corner ? 1.06 : 1.0;
        const block = new THREE.Mesh(new THREE.BoxGeometry(size, 0.5, size), mat);
        block.position.set(x + 0.5, floorY + 0.25 + hh * 0.5, z + 0.5);
        block.castShadow = true;
        ctx.worldSurface.add(block);
      }
      // corner logs poke above the wall line, MC-style
      if (corner && btype !== 'cathedral') {
        const cap = new THREE.Mesh(new THREE.BoxGeometry(1.0, 0.3, 1.0), log);
        cap.position.set(x + 0.5, floorY + wallH * 0.5 + 0.15, z + 0.5);
        ctx.worldSurface.add(cap);
      }
    }
  }
  // cathedral buttresses along the long sides
  if (btype === 'cathedral') {
    for (const side of [bx - 0.15, bx + bw + 0.15]) {
      for (let z = bz + 1.5; z < bz + bd - 1; z += 2.4) {
        const buttress = new THREE.Mesh(new THREE.BoxGeometry(0.5, wallH * 0.42, 0.6), stoneDark);
        buttress.position.set(side, floorY + wallH * 0.21, z);
        buttress.castShadow = true;
        ctx.worldSurface.add(buttress);
      }
    }
  }

  // ---- door assembly ----    // ---- door assembly ----
  const doorWide = btype === 'cathedral' ? 1.5 : 0.8;
  const dark = new THREE.Mesh(
    new THREE.BoxGeometry(doorWide, btype === 'cathedral' ? 1.9 : 1.3, 0.9),
    new THREE.MeshBasicMaterial({ color: 0x0a0910 }),
  );
  dark.position.set(doorX + 0.5, floorY + (btype === 'cathedral' ? 0.95 : 0.65), doorZ + 0.5);
  ctx.worldSurface.add(dark);
  for (const side of [-1, 1]) {
    const post = new THREE.Mesh(
      new THREE.BoxGeometry(0.16, btype === 'cathedral' ? 1.9 : 1.3, 0.2),
      log,
    );
    post.position.set(
      doorX + 0.5 + side * (doorWide / 2 + 0.1),
      floorY + (btype === 'cathedral' ? 0.95 : 0.65),
      doorZ + 0.95,
    );
    ctx.worldSurface.add(post);
  }
  const lintel = new THREE.Mesh(new THREE.BoxGeometry(doorWide + 0.4, 0.2, 0.98), ink);
  lintel.position.set(doorX + 0.5, floorY + (btype === 'cathedral' ? 2.0 : 1.4), doorZ + 0.5);
  ctx.worldSurface.add(lintel);
  const doorLamp = new THREE.Mesh(new THREE.BoxGeometry(0.14, 0.14, 0.14), glowWarm());
  doorLamp.position.set(doorX + 0.5, floorY + (btype === 'cathedral' ? 2.2 : 1.62), doorZ + 0.98);
  ctx.worldSurface.add(doorLamp);
  // a worn path of flat stones leading from the door
  for (let pi = 1; pi <= 3; pi++) {
    const flag = new THREE.Mesh(
      new THREE.BoxGeometry(0.7 - pi * 0.08, 0.06, 0.55),
      new THREE.MeshLambertMaterial({ color: 0xb8ac96 }),
    );
    flag.position.set(doorX + 0.5, floorY + 0.03, doorZ + 0.7 + pi * 0.62);
    ctx.worldSurface.add(flag);
  }

  // ---- windows per type ----
  const frontZ = bz + bd - 1 + 0.99;
  if (btype === 'cottage') {
    for (const wx of [doorX - 1.5, doorX + 1.5]) {
      if (wx < bx + 0.5 || wx > bx + bw - 0.5) continue;
      const frame = new THREE.Mesh(new THREE.BoxGeometry(0.56, 0.56, 0.06), ink);
      frame.position.set(wx + 0.5, floorY + 0.95, frontZ - 0.01);
      ctx.worldSurface.add(frame);
      const win = new THREE.Mesh(new THREE.BoxGeometry(0.4, 0.4, 0.08), glowWarm());
      win.position.set(wx + 0.5, floorY + 0.95, frontZ);
      ctx.worldSurface.add(win);
      // flower box
      const box = new THREE.Mesh(
        new THREE.BoxGeometry(0.5, 0.12, 0.14),
        new THREE.MeshLambertMaterial({ color: ctx.strokes[(index + 1) % ctx.strokes.length]! }),
      );
      box.position.set(wx + 0.5, floorY + 0.68, frontZ + 0.06);
      ctx.worldSurface.add(box);
    }
  } else if (btype === 'tavern') {
    for (const wx of [bx + 1, doorX - 1.6, doorX + 1.6, bx + bw - 2]) {
      if (wx < bx + 0.4 || wx > bx + bw - 0.4) continue;
      const frame = new THREE.Mesh(new THREE.BoxGeometry(0.6, 0.6, 0.06), ink);
      frame.position.set(wx + 0.5, floorY + 0.95, frontZ - 0.01);
      ctx.worldSurface.add(frame);
      const win = new THREE.Mesh(new THREE.BoxGeometry(0.44, 0.44, 0.08), glowWarm());
      win.position.set(wx + 0.5, floorY + 0.95, frontZ);
      ctx.worldSurface.add(win);
      const upper = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.3, 0.08), glowWarm());
      upper.position.set(wx + 0.5, floorY + 1.55, frontZ);
      ctx.worldSurface.add(upper);
    }
  } else {
    // stained glass: colour stacks down both long sides + a rose window
    for (const [sx, off] of [
      [bx, -0.04],
      [bx + bw - 1, 1.04],
    ] as const) {
      for (let z = bz + 1; z < bz + bd - 1; z += 2) {
        for (let g = 0; g < 3; g++) {
          const pane = new THREE.Mesh(
            new THREE.BoxGeometry(0.08, 0.42, 0.4),
            new THREE.MeshBasicMaterial({
              color: ctx.strokes[(z + g) % ctx.strokes.length]!,
              toneMapped: false,
            }),
          );
          pane.position.set(sx + off, floorY + 1.0 + g * 0.5, z + 0.5);
          ctx.worldSurface.add(pane);
        }
      }
    }
    const roseOffsets: [number, number][] = [
      [0, 0],
      [0.34, 0],
      [-0.34, 0],
      [0, 0.34],
      [0, -0.34],
    ];
    roseOffsets.forEach(([ox, oy], ri) => {
      const pane = new THREE.Mesh(
        new THREE.BoxGeometry(0.28, 0.28, 0.08),
        new THREE.MeshBasicMaterial({ color: ctx.strokes[ri % ctx.strokes.length]!, toneMapped: false }),
      );
      pane.rotation.z = Math.PI / 4;
      pane.position.set(doorX + 0.5 + ox, floorY + 2.65 + oy, frontZ);
      ctx.worldSurface.add(pane);
    });
  }

  // ---- roofline: stepped gable, the Minecraft silhouette ----
  const wallTop = floorY + wallH * 0.5;
  const roofDark = new THREE.MeshLambertMaterial({
    color: btype === 'cathedral' ? 0x8d887c : 0x8a5f38,
  });
  const roofDarker = new THREE.MeshLambertMaterial({
    color: btype === 'cathedral' ? 0x7c766a : 0x74502e,
  });
  const gable = (topY: number, gw: number, gd: number, cx2: number, cz2: number): number => {
    let width = gw + 0.9;
    let y = topY;
    let stepI = 0;
    while (width > 1.5) {
      const slab = new THREE.Mesh(
        new THREE.BoxGeometry(width, 0.34, gd + 0.9),
        stepI++ % 2 === 0 ? roofDark : roofDarker,
      );
      slab.position.set(cx2, y + 0.17, cz2);
      slab.castShadow = true;
      ctx.worldSurface.add(slab);
      y += 0.34;
      width -= 1.35;
    }
    const ridge = new THREE.Mesh(new THREE.BoxGeometry(1.3, 0.3, gd + 1.0), roofMat);
    ridge.position.set(cx2, y + 0.15, cz2);
    ridge.castShadow = true;
    ctx.worldSurface.add(ridge);
    return y + 0.3;
  };
  if (btype === 'cottage') {
    gable(wallTop, bw, bd, bx + bw / 2, bz + bd / 2);
    const chimney = new THREE.Mesh(new THREE.BoxGeometry(0.4, 1.3, 0.4), cobble);
    chimney.position.set(bx + 1.2, wallTop + 1.0, bz + 1.2);
    ctx.worldSurface.add(chimney);
  } else if (btype === 'tavern') {
    gable(wallTop, bw, bd, bx + bw / 2, bz + bd / 2);
    // hanging sign by the door
    const pole = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.08, 0.9), ink);
    pole.position.set(doorX + 1.6, floorY + 1.9, doorZ + 0.9);
    ctx.worldSurface.add(pole);
    const sign = new THREE.Mesh(
      new THREE.BoxGeometry(0.55, 0.4, 0.06),
      new THREE.MeshLambertMaterial({ color: ctx.strokes[(index + 3) % ctx.strokes.length]! }),
    );
    sign.position.set(doorX + 1.6, floorY + 1.55, doorZ + 1.25);
    ctx.worldSurface.add(sign);
    const mug = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.16, 0.1), glowWarm());
    mug.position.set(doorX + 1.6, floorY + 1.55, doorZ + 1.29);
    ctx.worldSurface.add(mug);
    // striped awning sheltering the door
    const awning = new THREE.Mesh(
      new THREE.BoxGeometry(2.0, 0.1, 0.9),
      new THREE.MeshLambertMaterial({ color: ctx.strokes[(index + 1) % ctx.strokes.length]! }),
    );
    awning.position.set(doorX + 0.5, floorY + 1.7, doorZ + 1.15);
    awning.rotation.x = 0.28;
    awning.castShadow = true;
    ctx.worldSurface.add(awning);
    // attic window glowing in the gable
    const attic = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.3, 0.1), glowWarm());
    attic.position.set(bx + bw / 2, wallTop + 0.9, bz + bd / 2 + bd / 2 + 0.42);
    ctx.worldSurface.add(attic);
    for (let bi = 0; bi < 2; bi++) {
      const barrel = new THREE.Mesh(new THREE.CylinderGeometry(0.24, 0.24, 0.5, 8), wood);
      barrel.position.set(bx - 0.5, floorY + 0.25, bz + bd - 1.4 - bi * 0.7);
      barrel.castShadow = true;
      ctx.worldSurface.add(barrel);
    }
    // lantern posts flanking the door
    for (const side of [-1.2, 2.2]) {
      const post = new THREE.Mesh(new THREE.BoxGeometry(0.12, 1.1, 0.12), log);
      post.position.set(doorX + side + 0.5, floorY + 0.55, doorZ + 1.3);
      ctx.worldSurface.add(post);
      const lampCube = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.2, 0.2), glowWarm());
      lampCube.position.set(doorX + side + 0.5, floorY + 1.2, doorZ + 1.3);
      ctx.worldSurface.add(lampCube);
    }
  } else {
    // cathedral: stone gable + belfry tower over the entrance corner
    const ridgeTop = gable(wallTop, bw, bd, bx + bw / 2, bz + bd / 2);
    let ty = wallTop;
    for (let t = 0; t < 3; t++) {
      const tier = new THREE.Mesh(new THREE.BoxGeometry(1.7 - t * 0.1, 1.0, 1.7 - t * 0.1), stoneBrick);
      tier.position.set(bx + 1.3, ty + 0.5, bz + 1.3);
      tier.castShadow = true;
      ctx.worldSurface.add(tier);
      ty += 1.0;
    }
    // belfry openings + glowing bell
    for (const [ox, oz] of [
      [0.81, 0],
      [-0.81, 0],
      [0, 0.81],
      [0, -0.81],
    ] as const) {
      const opening = new THREE.Mesh(
        new THREE.BoxGeometry(ox === 0 ? 0.5 : 0.1, 0.6, oz === 0 ? 0.5 : 0.1),
        new THREE.MeshBasicMaterial({ color: 0x0a0910 }),
      );
      opening.position.set(bx + 1.3 + ox, ty - 0.5, bz + 1.3 + oz);
      ctx.worldSurface.add(opening);
    }
    const bell = new THREE.Mesh(new THREE.BoxGeometry(0.24, 0.28, 0.24), glowWarm());
    bell.position.set(bx + 1.3, ty - 0.5, bz + 1.3);
    ctx.worldSurface.add(bell);
    // stepped pyramid cap + spire
    let capSize = 1.9;
    for (let t = 0; t < 3; t++) {
      const cap = new THREE.Mesh(new THREE.BoxGeometry(capSize, 0.3, capSize), roofDark);
      cap.position.set(bx + 1.3, ty + 0.15 + t * 0.3, bz + 1.3);
      ctx.worldSurface.add(cap);
      capSize *= 0.62;
    }
    const spire = new THREE.Mesh(new THREE.BoxGeometry(0.18, 1.1, 0.18), ink);
    spire.position.set(bx + 1.3, ty + 1.4, bz + 1.3);
    ctx.worldSurface.add(spire);
    const tip = new THREE.Mesh(
      new THREE.BoxGeometry(0.16, 0.16, 0.16),
      new THREE.MeshBasicMaterial({ color: ctx.strokes[0]!, toneMapped: false }),
    );
    tip.position.set(bx + 1.3, ty + 2.0, bz + 1.3);
    ctx.worldSurface.add(tip);
    // a small annex chapel leaning on the east wall
    const annexW = 1.8;
    const annexD = 3;
    const annexH = wallH * 0.5 * 0.55;
    const annex = new THREE.Mesh(new THREE.BoxGeometry(annexW, annexH, annexD), stoneBrick);
    annex.position.set(bx + bw + annexW / 2 - 0.1, floorY + annexH / 2, bz + bd / 2);
    annex.castShadow = true;
    ctx.worldSurface.add(annex);
    const annexRoof = new THREE.Mesh(new THREE.BoxGeometry(annexW + 0.4, 0.26, annexD + 0.4), roofDark);
    annexRoof.position.set(bx + bw + annexW / 2 - 0.1, floorY + annexH + 0.13, bz + bd / 2);
    ctx.worldSurface.add(annexRoof);
    const annexPane = new THREE.Mesh(
      new THREE.BoxGeometry(0.08, 0.5, 0.4),
      new THREE.MeshBasicMaterial({ color: ctx.strokes[1]!, toneMapped: false }),
    );
    annexPane.position.set(bx + bw + annexW - 0.06, floorY + annexH / 2, bz + bd / 2);
    ctx.worldSurface.add(annexPane);
    // lantern posts at the entrance + finials on the ridge ends
    for (const side of [-1.6, 2.6]) {
      const post = new THREE.Mesh(new THREE.BoxGeometry(0.14, 1.4, 0.14), stoneDark);
      post.position.set(doorX + side + 0.5, floorY + 0.7, doorZ + 1.4);
      ctx.worldSurface.add(post);
      const lamp2 = new THREE.Mesh(new THREE.BoxGeometry(0.22, 0.22, 0.22), glowWarm());
      lamp2.position.set(doorX + side + 0.5, floorY + 1.5, doorZ + 1.4);
      ctx.worldSurface.add(lamp2);
    }
    for (const fz of [bz - 0.3, bz + bd + 0.3]) {
      const finial = new THREE.Mesh(
        new THREE.BoxGeometry(0.18, 0.34, 0.18),
        new THREE.MeshLambertMaterial({ color: ctx.strokes[0]! }),
      );
      finial.position.set(bx + bw / 2, ridgeTop + 0.1, fz);
      ctx.worldSurface.add(finial);
    }
  }

  // ---- interiors: roomy and furnished per type ----    // ---- interiors: roomy and furnished per type ----
  const innerCX = bx + bw / 2;
  const innerCZ = bz + bd / 2;
  const addLight = (x: number, y: number, z: number, hex: number, power: number): void => {
    const light = new THREE.PointLight(hex, power, 8, 2);
    light.position.set(x, y, z);
    ctx.caveGroup.add(light);
    ctx.interiorLights.push({ light, base: power });
  };
  const hearthAt = (hx: number, hz: number): void => {
    const hearthMat = new THREE.MeshBasicMaterial({ color: 0xff9a2e, toneMapped: false });
    const hearth = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.4, 0.3), hearthMat);
    hearth.position.set(hx, floorY + 0.2, hz);
    ctx.caveGroup.add(hearth);
    const mantle = new THREE.Mesh(new THREE.BoxGeometry(0.7, 0.16, 0.5), stone);
    mantle.position.set(hx, floorY + 0.55, hz);
    ctx.caveGroup.add(mantle);
    ctx.lanterns.push({ mat: hearthMat, hue: new THREE.Color(0xff9a2e) });
    addLight(hx, floorY + 1.0, hz, 0xffb054, 18);
  };

  if (btype === 'cottage') {
    const rug = new THREE.Mesh(
      new THREE.BoxGeometry(1.6, 0.05, 1.2),
      new THREE.MeshLambertMaterial({ color: ctx.strokes[(index + 2) % ctx.strokes.length]! }),
    );
    rug.position.set(innerCX, floorY + 0.03, innerCZ);
    ctx.caveGroup.add(rug);
    const bed = new THREE.Mesh(new THREE.BoxGeometry(0.75, 0.3, 1.4), wood);
    bed.position.set(bx + 1.6, floorY + 0.15, bz + 1.9);
    ctx.caveGroup.add(bed);
    const blanket = new THREE.Mesh(
      new THREE.BoxGeometry(0.75, 0.12, 0.8),
      new THREE.MeshLambertMaterial({ color: ctx.strokes[(index + 1) % ctx.strokes.length]! }),
    );
    blanket.position.set(bx + 1.6, floorY + 0.34, bz + 2.15);
    ctx.caveGroup.add(blanket);
    const pillow = new THREE.Mesh(
      new THREE.BoxGeometry(0.5, 0.16, 0.4),
      new THREE.MeshLambertMaterial({ color: 0xf4ede0 }),
    );
    pillow.position.set(bx + 1.6, floorY + 0.4, bz + 1.4);
    ctx.caveGroup.add(pillow);
    const table = new THREE.Mesh(new THREE.BoxGeometry(0.7, 0.08, 0.7), wood);
    table.position.set(bx + bw - 2.2, floorY + 0.44, bz + bd - 2.4);
    ctx.caveGroup.add(table);
    for (const [lx, lz] of [
      [-0.26, -0.26],
      [0.26, -0.26],
      [-0.26, 0.26],
      [0.26, 0.26],
    ] as const) {
      const leg = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.42, 0.08), wood);
      leg.position.set(bx + bw - 2.2 + lx, floorY + 0.21, bz + bd - 2.4 + lz);
      ctx.caveGroup.add(leg);
    }
    // a picture on the wall — ink frame, palette canvas
    const artFrame = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.4, 0.05), new THREE.MeshLambertMaterial({ color: INK }));
    artFrame.position.set(innerCX + 1, floorY + 1.15, bz + 1.06);
    ctx.caveGroup.add(artFrame);
    const artCanvas = new THREE.Mesh(
      new THREE.BoxGeometry(0.38, 0.28, 0.06),
      new THREE.MeshLambertMaterial({ color: ctx.strokes[(index + 4) % ctx.strokes.length]! }),
    );
    artCanvas.position.set(innerCX + 1, floorY + 1.15, bz + 1.07);
    ctx.caveGroup.add(artCanvas);
    for (const [sx2, sz2] of [
      [bx + bw - 2.9, bz + bd - 2.4],
      [bx + bw - 1.5, bz + bd - 2.4],
    ] as const) {
      const stool = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.26, 0.3), wood);
      stool.position.set(sx2, floorY + 0.13, sz2);
      ctx.caveGroup.add(stool);
    }
    // shelf with glowing jars
    const shelf = new THREE.Mesh(new THREE.BoxGeometry(1.2, 0.08, 0.3), wood);
    shelf.position.set(innerCX, floorY + 1.2, bz + 1.2);
    ctx.caveGroup.add(shelf);
    for (let j = 0; j < 3; j++) {
      const jar = new THREE.Mesh(
        new THREE.BoxGeometry(0.12, 0.16, 0.12),
        new THREE.MeshBasicMaterial({ color: ctx.strokes[j % ctx.strokes.length]!, toneMapped: false }),
      );
      jar.position.set(innerCX - 0.4 + j * 0.4, floorY + 1.32, bz + 1.2);
      ctx.caveGroup.add(jar);
    }
    // warm window light from inside too
    for (const wx of [doorX - 1.5, doorX + 1.5]) {
      if (wx < bx + 0.5 || wx > bx + bw - 0.5) continue;
      const innerWin = new THREE.Mesh(new THREE.BoxGeometry(0.36, 0.36, 0.06), glowWarm());
      innerWin.position.set(wx + 0.5, floorY + 0.95, bz + bd - 1.02);
      ctx.caveGroup.add(innerWin);
    }
    const mug = new THREE.Mesh(
      new THREE.BoxGeometry(0.12, 0.14, 0.12),
      new THREE.MeshLambertMaterial({ color: ctx.strokes[(index + 3) % ctx.strokes.length]! }),
    );
    mug.position.set(bx + bw - 2.2, floorY + 0.52, bz + bd - 2.4);
    ctx.caveGroup.add(mug);
    hearthAt(bx + bw - 1.6, bz + 1.5);
    // picket fence framing a little front yard
    const picket = new THREE.MeshLambertMaterial({ color: 0xd6c9a8 });
    for (const fx of [doorX - 1.5, doorX + 2.5]) {
      for (let fz = 0; fz < 3; fz++) {
        const post = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.5, 0.1), picket);
        post.position.set(fx, floorY + 0.25, doorZ + 1.2 + fz * 0.7);
        ctx.worldSurface.add(post);
      }
      const rail = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.08, 2.0), picket);
      rail.position.set(fx, floorY + 0.4, doorZ + 1.9);
      ctx.worldSurface.add(rail);
    }
    // flowers hugging the front wall
    for (let fi = 0; fi < 3; fi++) {
      const flower = new THREE.Mesh(
        new THREE.BoxGeometry(0.12, 0.12, 0.12),
        new THREE.MeshLambertMaterial({ color: ctx.strokes[fi % ctx.strokes.length]! }),
      );
      flower.position.set(bx + 0.8 + fi * ((bw - 1.6) / 2), floorY + 0.1, doorZ + 1.15);
      ctx.worldSurface.add(flower);
    }
    ctx.interactCells.set(`c:${Math.floor(innerCX)},${Math.floor(innerCZ)}`, { id: 'hearth', label: 'Hearth' });
    ctx.landmarks.push({ kind: 'house', x: Math.floor(innerCX), z: Math.floor(innerCZ) });
  } else if (btype === 'tavern') {
    const runner = new THREE.Mesh(
      new THREE.BoxGeometry(1.2, 0.05, bd - 2.4),
      new THREE.MeshLambertMaterial({ color: ctx.strokes[(index + 2) % ctx.strokes.length]! }),
    );
    runner.position.set(doorX + 0.5, floorY + 0.03, innerCZ);
    ctx.caveGroup.add(runner);
    // the bar along the back wall, keeper behind it
    for (let bi = 0; bi < 3; bi++) {
      const counter = new THREE.Mesh(new THREE.BoxGeometry(0.9, 0.55, 0.5), wood);
      counter.position.set(innerCX - 1 + bi, floorY + 0.27, bz + 1.9);
      ctx.caveGroup.add(counter);
    }
    const keeper = makeVoxelFolk(ctx.strokes[(index + 1) % ctx.strokes.length]!, 0.95);
    keeper.baseY = floorY;
    keeper.group.position.set(innerCX, floorY, bz + 1.3);
    keeper.group.rotation.y = Math.PI; // facing the door
    ctx.caveGroup.add(keeper.group);
    ctx.folk.push(keeper);
    // stools at the bar
    for (let si = 0; si < 3; si++) {
      const stool = new THREE.Mesh(new THREE.BoxGeometry(0.28, 0.3, 0.28), wood);
      stool.position.set(innerCX - 1 + si, floorY + 0.15, bz + 2.7);
      ctx.caveGroup.add(stool);
    }
    // bottle shelf glowing behind the bar
    for (let j = 0; j < 5; j++) {
      const bottle = new THREE.Mesh(
        new THREE.BoxGeometry(0.1, 0.2, 0.1),
        new THREE.MeshBasicMaterial({ color: ctx.strokes[j % ctx.strokes.length]!, toneMapped: false }),
      );
      bottle.position.set(innerCX - 1 + j * 0.5, floorY + 1.45, bz + 1.15);
      ctx.caveGroup.add(bottle);
    }
    // mugs lined up on the counter
    for (let mi = 0; mi < 3; mi++) {
      const barMug = new THREE.Mesh(
        new THREE.BoxGeometry(0.11, 0.13, 0.11),
        new THREE.MeshLambertMaterial({ color: ctx.strokes[mi % ctx.strokes.length]! }),
      );
      barMug.position.set(innerCX - 0.9 + mi * 0.8, floorY + 0.62, bz + 1.9);
      ctx.caveGroup.add(barMug);
    }
    // two tables with benches and a candle each
    for (const tx of [bx + 1.7, bx + bw - 1.7]) {
      const table = new THREE.Mesh(new THREE.BoxGeometry(0.8, 0.45, 0.8), wood);
      table.position.set(tx, floorY + 0.22, bz + bd - 2.2);
      ctx.caveGroup.add(table);
      const bench = new THREE.Mesh(new THREE.BoxGeometry(0.8, 0.22, 0.26), wood);
      bench.position.set(tx, floorY + 0.11, bz + bd - 1.6);
      ctx.caveGroup.add(bench);
      const candle = new THREE.Mesh(new THREE.BoxGeometry(0.07, 0.16, 0.07), glowWarm());
      candle.position.set(tx, floorY + 0.53, bz + bd - 2.2);
      ctx.caveGroup.add(candle);
      addLight(tx, floorY + 0.9, bz + bd - 2.2, 0xffd9a0, 6);
    }
    // barrel stack in the corner
    for (const [ox, oy] of [
      [0, 0],
      [0.55, 0],
      [0.27, 0.5],
    ] as const) {
      const barrel = new THREE.Mesh(new THREE.CylinderGeometry(0.24, 0.24, 0.48, 8), wood);
      barrel.rotation.z = Math.PI / 2;
      barrel.position.set(bx + 1.3 + ox, floorY + 0.26 + oy, bz + 1.4);
      ctx.caveGroup.add(barrel);
    }
    hearthAt(bx + bw - 1.6, bz + bd - 1.7);
    // candle chandelier over the room
    const ring = new THREE.Mesh(new THREE.BoxGeometry(0.9, 0.07, 0.9), wood);
    ring.position.set(innerCX, floorY + 1.65, innerCZ);
    ctx.caveGroup.add(ring);
    for (const [chx, chz] of [
      [-0.35, -0.35],
      [0.35, -0.35],
      [-0.35, 0.35],
      [0.35, 0.35],
    ] as const) {
      const candle = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.14, 0.08), glowWarm());
      candle.position.set(innerCX + chx, floorY + 1.76, innerCZ + chz);
      ctx.caveGroup.add(candle);
    }
    addLight(innerCX, floorY + 1.6, innerCZ, 0xffc98a, 15);
    ctx.interactCells.set(`c:${Math.floor(innerCX)},${Math.floor(innerCZ)}`, { id: 'tavern', label: 'Tavern' });
    ctx.landmarks.push({ kind: 'tavern', x: Math.floor(innerCX), z: Math.floor(innerCZ) });
  } else {
    // cathedral: aisle, pews, altar under coloured light
    const runner = new THREE.Mesh(
      new THREE.BoxGeometry(1.1, 0.05, bd - 2.6),
      new THREE.MeshLambertMaterial({ color: ctx.strokes[0]! }),
    );
    runner.position.set(doorX + 0.5, floorY + 0.03, innerCZ);
    ctx.caveGroup.add(runner);
    for (let row = 0; row < 3; row++) {
      for (const px of [doorX - 1.4, doorX + 2.4]) {
        const pew = new THREE.Mesh(new THREE.BoxGeometry(1.4, 0.3, 0.4), wood);
        pew.position.set(px, floorY + 0.15, bz + bd - 2.4 - row * 1.3);
        ctx.caveGroup.add(pew);
        const back = new THREE.Mesh(new THREE.BoxGeometry(1.4, 0.34, 0.1), wood);
        back.position.set(px, floorY + 0.42, bz + bd - 2.6 - row * 1.3);
        ctx.caveGroup.add(back);
      }
    }
    // interior pillars
    for (const pz of [bz + 2.6, bz + bd - 3.4]) {
      for (const px of [bx + 1.4, bx + bw - 1.4]) {
        const pillar = new THREE.Mesh(new THREE.BoxGeometry(0.4, 2.1, 0.4), stone);
        pillar.position.set(px, floorY + 1.05, pz);
        ctx.caveGroup.add(pillar);
      }
    }
    // altar platform at the far end
    const dais = new THREE.Mesh(new THREE.BoxGeometry(2.6, 0.24, 1.4), stone);
    dais.position.set(innerCX, floorY + 0.12, bz + 1.7);
    ctx.caveGroup.add(dais);
    const altar = new THREE.Mesh(new THREE.BoxGeometry(0.7, 0.6, 0.45), stone);
    altar.position.set(innerCX, floorY + 0.54, bz + 1.6);
    ctx.caveGroup.add(altar);
    const relic = new THREE.Mesh(
      new THREE.OctahedronGeometry(0.2),
      new THREE.MeshBasicMaterial({ color: ctx.strokes[2]!, toneMapped: false }),
    );
    relic.position.set(innerCX, floorY + 1.02, bz + 1.6);
    ctx.caveGroup.add(relic);
    for (const cx2 of [innerCX - 0.9, innerCX + 0.9]) {
      const candle = new THREE.Mesh(
        new THREE.BoxGeometry(0.08, 0.22, 0.08),
        new THREE.MeshBasicMaterial({ color: 0xffe9a8, toneMapped: false }),
      );
      candle.position.set(cx2, floorY + 0.36, bz + 1.7);
      ctx.caveGroup.add(candle);
    }
    for (const cz3 of [bz + 3.4, bz + bd - 3.2]) {
      for (const cx3 of [doorX - 0.7, doorX + 1.7]) {
        const stand = new THREE.Mesh(new THREE.BoxGeometry(0.09, 0.9, 0.09), ink);
        stand.position.set(cx3, floorY + 0.45, cz3);
        ctx.caveGroup.add(stand);
        const flame2 = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.12, 0.1), glowWarm());
        flame2.position.set(cx3, floorY + 0.96, cz3);
        ctx.caveGroup.add(flame2);
      }
      addLight(doorX + 0.5, floorY + 1.3, cz3, 0xffd9a0, 8);
    }
    addLight(innerCX, floorY + 1.4, bz + 2.2, ctx.strokes[2]!, 15);
    addLight(innerCX, floorY + 1.6, bz + bd - 2.5, ctx.strokes[4]!, 11);
    const altarCell = `c:${Math.floor(innerCX)},${bz + 2}`;
    ctx.interactCells.set(altarCell, { id: 'cathedral', label: 'Altar' });
    ctx.landmarks.push({ kind: 'cathedral', x: Math.floor(innerCX), z: bz + 2 });
  }
}

