import * as THREE from 'three';

/** Canvas-drawn floating labels: name tags and speech bubbles. */
export function makeLabelSprite(lines: string[], opts: { big?: boolean }): THREE.Sprite {
  const canvas = document.createElement('canvas');
  const scale = 4;
  const pad = 10 * scale;
  const fontSize = (opts.big ? 21 : 13) * scale;
  const ctx = canvas.getContext('2d')!;
  ctx.font = `600 ${fontSize}px "Segoe UI", system-ui, sans-serif`;
  const width = Math.max(...lines.map((l) => ctx.measureText(l).width)) + pad * 2;
  const lineH = fontSize * 1.25;
  canvas.width = Math.ceil(width);
  canvas.height = Math.ceil(lineH * lines.length + pad * 2);
  ctx.font = `600 ${fontSize}px "Segoe UI", system-ui, sans-serif`;
  ctx.textBaseline = 'top';
  ctx.fillStyle = opts.big ? 'rgba(247,239,227,0.94)' : 'rgba(27,31,42,0.72)';
  ctx.beginPath();
  ctx.roundRect(0, 0, canvas.width, canvas.height, 14 * scale);
  ctx.fill();
  ctx.fillStyle = opts.big ? '#1b1f2a' : '#f7efe3';
  lines.forEach((line, i) => ctx.fillText(line, pad, pad + i * lineH));

  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  const sprite = new THREE.Sprite(
    new THREE.SpriteMaterial({ map: texture, depthTest: false, transparent: true }),
  );
  const worldH = (opts.big ? 0.62 : 0.34) * lines.length + 0.22;
  sprite.scale.set((worldH * canvas.width) / canvas.height, worldH, 1);
  sprite.renderOrder = 30;
  return sprite;
}

export function wrapText(text: string, max = 26): string[] {
  const lines: string[] = [];
  let cur = '';
  for (const word of text.split(/\s+/)) {
    if (cur && (cur + ' ' + word).length > max) {
      lines.push(cur);
      cur = word;
    } else {
      cur = cur ? cur + ' ' + word : word;
    }
  }
  if (cur) lines.push(cur);
  return lines.slice(0, 5);
}

export function disposeSprite(sprite: THREE.Sprite): void {
  sprite.material.map?.dispose();
  sprite.material.dispose();
}
