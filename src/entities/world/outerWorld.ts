import * as THREE from 'three';
import { createRng, hashString } from '@/shared/lib/shared';
import { N } from './constants';
import type { WorldLayout } from './layout';

export interface OuterWorldCtx {
  seed: string;
  layout: WorldLayout;
  strokes: number[];
  noise: { a: number; b: number; c: number; d: number };
  worldSurface: THREE.Group;
}

/**
 * The world beyond the board: an endless block wilderness. Foothills climb
 * into fog-wrapped mountains (snow on the high tops), pastel forest fills
 * the low ground, a valley pass lines up with the south gate, and a far
 * ridge closes the horizon so the page never shows its edge.
 */
export function buildOuterWorld(ctx: OuterWorldCtx): void {
  const rng = createRng(hashString(ctx.seed + '-outerworld'));
  const EXT = 20;
  const L = ctx.layout;
  const geo = new THREE.BoxGeometry(1, 1, 1);
  const shades = new Float32Array(24 * 3);
  for (let v = 0; v < 24; v++) {
    const face = Math.floor(v / 4);
    const sh = face === 2 ? 1.0 : face === 3 ? 0.6 : face >= 4 ? 0.85 : 0.76;
    shades[v * 3] = sh;
    shades[v * 3 + 1] = sh;
    shades[v * 3 + 2] = sh;
  }
  geo.setAttribute('color', new THREE.BufferAttribute(shades, 3));

  const cols: { x: number; z: number; lvl: number; d: number }[] = [];
  for (let oz = -EXT; oz < N + EXT; oz++) {
    for (let ox = -EXT; ox < N + EXT; ox++) {
      if (ox >= 0 && ox < N && oz >= 0 && oz < N) continue;
      const d = Math.max(ox < 0 ? -ox : ox - N + 1, oz < 0 ? -oz : oz - N + 1, 0);
      const n =
        Math.sin(ox * 0.4 + ctx.noise.a) * Math.cos(oz * 0.37 + ctx.noise.b) * 0.6 +
        Math.sin(ox * 0.9 + ctx.noise.c) * Math.sin(oz * 0.8 + ctx.noise.d) * 0.4;
      let lvl = Math.max(0, Math.floor((n + 0.7) * 2.2 + d * 0.85 + Math.max(0, d - 6) * 0.6));
      if (oz >= N && ox >= L.corridorX0 - 1 && ox <= L.corridorX0 + 4) {
        lvl = Math.min(lvl, Math.max(0, d - 8)); // the valley pass out of the gate
      }
      lvl = Math.min(26, lvl);
      cols.push({ x: ox, z: oz, lvl, d });
    }
  }
  const mesh = new THREE.InstancedMesh(geo, new THREE.MeshLambertMaterial({ vertexColors: true }), cols.length);
  const m = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const sc = new THREE.Vector3();
  const pos = new THREE.Vector3();
  const tint = new THREE.Color();
  const cream = new THREE.Color(ctx.layout.paperTint);
  const haze = new THREE.Color(0xded7cb);
  const snowCol = new THREE.Color(0xf4f4f6);
  const forestFloor = new THREE.Color(0xcfe4cd);
  cols.forEach((col, i) => {
    const top = col.lvl * 0.5;
    const height = top + 1.6;
    pos.set(col.x + 0.5, top - height / 2, col.z + 0.5);
    sc.set(1, height, 1);
    m.compose(pos, q, sc);
    mesh.setMatrixAt(i, m);
    tint.copy(col.lvl <= 4 ? forestFloor : cream);
    if (col.lvl > 14) tint.lerp(snowCol, Math.min(1, (col.lvl - 14) / 6));
    tint.lerp(haze, Math.min(0.65, (col.d / EXT) * 0.65));
    mesh.setColorAt(i, tint);
  });
  mesh.instanceMatrix.needsUpdate = true;
  if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
  ctx.worldSurface.add(mesh);

  // the endless forest — dense on the low ground AND up the mountainsides,
  // thinning only at the snow line
  const treeSpots = cols.filter((c) => {
    if (c.d <= 1 || c.lvl > 16) return false;
    const density = c.lvl <= 4 ? 0.55 : c.lvl <= 9 ? 0.45 : c.lvl <= 13 ? 0.3 : 0.12;
    return rng() < density;
  });
  if (treeSpots.length > 0) {
    const trunk = new THREE.InstancedMesh(
      new THREE.BoxGeometry(0.22, 0.7, 0.22),
      new THREE.MeshLambertMaterial({ color: 0xc9a97c }),
      treeSpots.length,
    );
    const crown = new THREE.InstancedMesh(
      new THREE.BoxGeometry(0.8, 0.8, 0.8),
      new THREE.MeshLambertMaterial(),
      treeSpots.length,
    );
    const greens = [0x6fc98f, 0x8fd9a8, 0x5fae7d, 0x9fd9b4];
    const highGreens = [0x4e8f68, 0x3f7d59, 0x5fae7d]; // mountain conifers, darker
    treeSpots.forEach((spot, i) => {
      const tx = spot.x + 0.2 + rng() * 0.6;
      const tz = spot.z + 0.2 + rng() * 0.6;
      const ty = spot.lvl * 0.5;
      const sscale = (0.7 + rng() * 0.8) * (spot.lvl > 9 ? 0.8 : 1); // smaller up high
      q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), rng() * Math.PI);
      m.compose(pos.set(tx, ty + 0.35 * sscale, tz), q, sc.set(sscale, sscale, sscale));
      trunk.setMatrixAt(i, m);
      m.compose(pos.set(tx, ty + 1.1 * sscale, tz), q, sc.set(sscale, sscale, sscale));
      crown.setMatrixAt(i, m);
      const uphill = spot.lvl > 6;
      const palette = uphill ? highGreens : greens;
      const hex =
        rng() < (uphill ? 0.97 : 0.9)
          ? palette[Math.floor(rng() * palette.length)]!
          : ctx.strokes[Math.floor(rng() * ctx.strokes.length)]!;
      tint.setHex(hex);
      if (spot.lvl > 12) tint.lerp(new THREE.Color(0xf4f4f6), 0.3); // frost dust
      tint.lerp(haze, Math.min(0.5, (spot.d / EXT) * 0.55));
      crown.setColorAt(i, tint);
    });
    trunk.instanceMatrix.needsUpdate = true;
    crown.instanceMatrix.needsUpdate = true;
    if (crown.instanceColor) crown.instanceColor.needsUpdate = true;
    ctx.worldSurface.add(trunk);
    ctx.worldSurface.add(crown);
  }

  // the far ridge: a broken ring of huge dim ranges swallowed by fog
  for (let i = 0; i < 26; i++) {
    const a = (i / 26) * Math.PI * 2 + rng() * 0.2;
    const r = N * 1.5 + rng() * N * 0.5;
    const w = 12 + rng() * 18;
    const h = 8 + rng() * 14;
    const range = new THREE.Mesh(
      new THREE.BoxGeometry(w, h, 8 + rng() * 6),
      new THREE.MeshLambertMaterial({ color: 0xb8b2c2 }),
    );
    range.position.set(N / 2 + Math.cos(a) * r, h / 2 - 1.5, N / 2 + Math.sin(a) * r);
    range.rotation.y = a + Math.PI / 2 + (rng() - 0.5) * 0.4;
    ctx.worldSurface.add(range);
  }
}

