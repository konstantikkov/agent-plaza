import * as THREE from 'three';

const INK = 0x1b1f2a;

/** A lambert box; the workhorse for voxel builds. */
export function box(
  parent: THREE.Object3D,
  w: number,
  h: number,
  d: number,
  color: number,
  x: number,
  y: number,
  z: number,
  opts: { basic?: boolean; shadow?: boolean } = {},
): THREE.Mesh {
  const mat = opts.basic
    ? new THREE.MeshBasicMaterial({ color, toneMapped: false })
    : new THREE.MeshLambertMaterial({ color });
  const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
  m.position.set(x, y, z);
  if (opts.shadow !== false) {
    m.castShadow = true;
    m.receiveShadow = true;
  }
  parent.add(m);
  return m;
}

/** A flat plinth/deck the activity sits on, with an ink rim. */
export function deck(parent: THREE.Object3D, cx: number, y: number, cz: number, w: number, d: number, color: number): void {
  box(parent, w, 0.24, d, color, cx, y + 0.12, cz);
  box(parent, w + 0.16, 0.1, d + 0.16, INK, cx, y + 0.05, cz);
}

/** A small signpost with a colored placard, to mark the station entrance. */
export function signpost(parent: THREE.Object3D, x: number, y: number, z: number, color: number): void {
  box(parent, 0.12, 1.1, 0.12, 0x8a6b46, x, y + 0.55, z);
  box(parent, 0.7, 0.42, 0.09, color, x, y + 1.15, z);
  box(parent, 0.78, 0.5, 0.05, INK, x, y + 1.15, z - 0.03);
}

/** Warm point light (lanterns, spotlights). */
export function glow(parent: THREE.Object3D, x: number, y: number, z: number, color: number, intensity: number, dist: number): THREE.PointLight {
  const light = new THREE.PointLight(color, intensity, dist, 2);
  light.position.set(x, y, z);
  parent.add(light);
  return light;
}

/** A floating text placard (lyrics, seat labels, scores). Returns a Sprite. */
export function textSprite(lines: string[], opts: { size?: number; bg?: string; fg?: string } = {}): THREE.Sprite {
  const scale = 4;
  const pad = 10 * scale;
  const fontSize = (opts.size ?? 15) * scale;
  const canvas = document.createElement('canvas');
  const ctx = canvas.getContext('2d')!;
  ctx.font = `600 ${fontSize}px "Segoe UI", system-ui, sans-serif`;
  const w = Math.max(...lines.map((l) => ctx.measureText(l).width), 1) + pad * 2;
  const lineH = fontSize * 1.28;
  canvas.width = Math.ceil(w);
  canvas.height = Math.ceil(lineH * lines.length + pad * 2);
  ctx.font = `600 ${fontSize}px "Segoe UI", system-ui, sans-serif`;
  ctx.textBaseline = 'top';
  ctx.fillStyle = opts.bg ?? 'rgba(27,31,42,0.82)';
  ctx.beginPath();
  ctx.roundRect(0, 0, canvas.width, canvas.height, 14 * scale);
  ctx.fill();
  ctx.fillStyle = opts.fg ?? '#f7efe3';
  lines.forEach((l, i) => ctx.fillText(l, pad, pad + i * lineH));
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, depthTest: false, transparent: true }));
  const worldH = 0.42 * lines.length + 0.24;
  sprite.scale.set((worldH * canvas.width) / canvas.height, worldH, 1);
  sprite.renderOrder = 30;
  return sprite;
}

export function disposeGroup(g: THREE.Object3D): void {
  g.traverse((o) => {
    const m = o as THREE.Mesh;
    if (m.geometry) m.geometry.dispose();
    const mat = m.material as THREE.Material | THREE.Material[] | undefined;
    if (Array.isArray(mat)) mat.forEach((x) => x.dispose());
    else mat?.dispose();
  });
}
