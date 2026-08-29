import * as THREE from 'three';

/**
 * The shared visual language of the placeholder world: a muted, painterly,
 * melancholic palette with hard toon steps. Every placeholder asset pulls
 * colors from here so the prototype reads as one intentional style.
 */
export const PALETTE = {
  night: 0x0c0b10,
  fogPlum: 0x161221,
  floorA: 0x35304a,
  floorB: 0x2c2740,
  floorC: 0x3d3554,
  raised: 0x46405e,
  wallStone: 0x241f33,
  water: 0x1c3550,
  rust: 0xb3552d,
  cream: 0xe8dcc3,
  teal: 0x3e7c74,
  plumWood: 0x5d3a4a,
  slate: 0x4a5568,
  moss: 0x5d7052,
  magenta: 0xc33d7b,
  yellow: 0xe3b341,
  redPortal: 0xd4453a,
  bluePortal: 0x3b5bd9,
  lampGlow: 0xffc27a,
  outline: 0x0a080e,
} as const;

export const RARITY_COLORS: Record<string, number> = {
  common: 0x8a8fa3,
  rare: 0x4f8fe0,
  epic: 0xb05ce0,
  legendary: 0xe3b341,
};

let gradient: THREE.DataTexture | null = null;

/** Hard 3-step toon ramp shared by every material. */
export function toonGradient(): THREE.DataTexture {
  if (gradient) return gradient;
  const data = new Uint8Array([70, 140, 255]);
  gradient = new THREE.DataTexture(data, data.length, 1, THREE.RedFormat);
  gradient.minFilter = THREE.NearestFilter;
  gradient.magFilter = THREE.NearestFilter;
  gradient.needsUpdate = true;
  return gradient;
}

const matCache = new Map<string, THREE.MeshToonMaterial>();

export function toonMat(
  color: number,
  opts: { emissive?: number; emissiveIntensity?: number } = {},
): THREE.MeshToonMaterial {
  const key = `${color}:${opts.emissive ?? 0}:${opts.emissiveIntensity ?? 0}`;
  let mat = matCache.get(key);
  if (!mat) {
    mat = new THREE.MeshToonMaterial({
      color,
      gradientMap: toonGradient(),
      emissive: opts.emissive ?? 0x000000,
      emissiveIntensity: opts.emissiveIntensity ?? 1,
    });
    matCache.set(key, mat);
  }
  return mat;
}

/** Cheap inverted-hull outline for hero objects (characters, key props). */
export function addOutline(target: THREE.Mesh, thickness = 1.045): void {
  const outline = new THREE.Mesh(
    target.geometry,
    new THREE.MeshBasicMaterial({ color: PALETTE.outline, side: THREE.BackSide }),
  );
  outline.scale.setScalar(thickness);
  outline.raycast = () => undefined; // never intercept picking
  target.add(outline);
}

/** Convert loaded GLB materials to the toon look so generated assets fit in. */
export function toonify(root: THREE.Object3D): void {
  root.traverse((obj) => {
    const mesh = obj as THREE.Mesh;
    if (!mesh.isMesh) return;
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    const convert = (m: THREE.Material): THREE.Material => {
      const std = m as THREE.MeshStandardMaterial;
      if (!std.isMeshStandardMaterial) return m;
      return new THREE.MeshToonMaterial({
        color: std.color?.clone() ?? new THREE.Color(0xffffff),
        map: std.map ?? null,
        gradientMap: toonGradient(),
      });
    };
    mesh.material = Array.isArray(mesh.material)
      ? mesh.material.map(convert)
      : convert(mesh.material);
  });
}

const radialCache = new Map<string, THREE.CanvasTexture>();

/** Soft radial gradient texture — sun patches, glows, clouds, dapples. */
export function radialTexture(inner = 'rgba(255,255,255,1)', outer = 'rgba(255,255,255,0)'): THREE.CanvasTexture {
  const key = `${inner}|${outer}`;
  let tex = radialCache.get(key);
  if (!tex) {
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = 128;
    const ctx = canvas.getContext('2d')!;
    const grad = ctx.createRadialGradient(64, 64, 4, 64, 64, 64);
    grad.addColorStop(0, inner);
    grad.addColorStop(1, outer);
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, 128, 128);
    tex = new THREE.CanvasTexture(canvas);
    radialCache.set(key, tex);
  }
  return tex;
}

const signCache = new Map<string, THREE.CanvasTexture>();

/** Glowing vertical/horizontal sign texture — Hong Kong neon typography. */
export function neonSignTexture(text: string, color: string, vertical = true): THREE.CanvasTexture {
  const key = `${text}|${color}|${vertical}`;
  let tex = signCache.get(key);
  if (!tex) {
    const canvas = document.createElement('canvas');
    const chars = [...text];
    canvas.width = vertical ? 64 : 64 * chars.length;
    canvas.height = vertical ? 64 * chars.length : 64;
    const ctx = canvas.getContext('2d')!;
    ctx.fillStyle = '#0a0710';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.strokeStyle = color;
    ctx.lineWidth = 3;
    ctx.strokeRect(4, 4, canvas.width - 8, canvas.height - 8);
    ctx.font = 'bold 44px "Hiragino Sans", "Noto Sans CJK", sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.shadowColor = color;
    ctx.shadowBlur = 14;
    ctx.fillStyle = color;
    chars.forEach((ch, i) => {
      const cx = vertical ? 32 : 32 + i * 64;
      const cy = vertical ? 32 + i * 64 : 32;
      ctx.fillText(ch, cx, cy);
      ctx.fillText(ch, cx, cy); // double pass = hotter glow core
    });
    tex = new THREE.CanvasTexture(canvas);
    signCache.set(key, tex);
  }
  return tex;
}

/** Utility mesh factory with shadows on. */
export function box(
  w: number,
  h: number,
  d: number,
  color: number,
  opts: { emissive?: number; emissiveIntensity?: number } = {},
): THREE.Mesh {
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), toonMat(color, opts));
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  return mesh;
}

export function cylinder(
  rTop: number,
  rBottom: number,
  h: number,
  color: number,
  segments = 8,
  opts: { emissive?: number; emissiveIntensity?: number } = {},
): THREE.Mesh {
  const mesh = new THREE.Mesh(
    new THREE.CylinderGeometry(rTop, rBottom, h, segments),
    toonMat(color, opts),
  );
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  return mesh;
}
