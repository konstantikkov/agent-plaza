import * as THREE from 'three';
import type { FilterMode } from './types';

export class PainterFilter {
  private rt: THREE.WebGLRenderTarget;
  private material: THREE.ShaderMaterial;
  private quadScene = new THREE.Scene();
  private quadCam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);

  constructor(width: number, height: number) {
    this.rt = PainterFilter.makeTarget(width, height);
    this.material = new THREE.ShaderMaterial({
      uniforms: {
        tDiffuse: { value: this.rt.texture },
        uRes: { value: new THREE.Vector2(width, height) },
        uTime: { value: 0 },
        uMode: { value: 2 },
      },
      depthTest: false,
      depthWrite: false,
      vertexShader: /* glsl */ `
        varying vec2 vUv;
        void main() {
          vUv = uv;
          gl_Position = vec4(position.xy, 0.0, 1.0);
        }
      `,
      fragmentShader: /* glsl */ `
        precision highp float;
        varying vec2 vUv;
        uniform sampler2D tDiffuse;
        uniform vec2 uRes;
        uniform float uTime;
        uniform int uMode;

        float hash(vec2 p) {
          return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453);
        }

        void main() {
          vec2 uv = vUv;
          vec2 px = 1.0 / uRes;
          vec3 orig = texture2D(tDiffuse, uv).rgb;
          float mode = float(uMode);
          float on = step(0.5, mode);                       // any filter
          float oil = step(1.5, mode) * (1.0 - step(2.5, mode)); // oil only
          float pale = step(2.5, mode) * (1.0 - step(3.5, mode)); // the pale
          float charc = step(3.5, mode) * (1.0 - step(4.5, mode)); // charcoal
          float lamp = step(4.5, mode);                     // lamplight grade
          float full = max(max(oil, lamp), max(pale, charc)); // full-strength dabs

          // Kuwahara: pick the least-varying quadrant mean — paint dabs
          vec3 pick = orig;
          float best = 1e9;
          for (int q = 0; q < 4; q++) {
            vec2 dir = vec2(q == 1 || q == 3 ? 1.0 : -1.0, q >= 2 ? 1.0 : -1.0);
            vec3 sum = vec3(0.0);
            vec3 sq = vec3(0.0);
            for (int i = 0; i <= 3; i++) {
              for (int j = 0; j <= 3; j++) {
                vec3 c = texture2D(tDiffuse, uv + vec2(float(i), float(j)) * dir * px).rgb;
                sum += c;
                sq += c * c;
              }
            }
            sum /= 16.0;
            vec3 varc = sq / 16.0 - sum * sum;
            float v = varc.r + varc.g + varc.b;
            if (v < best) {
              best = v;
              pick = sum;
            }
          }
          float strength = on * mix(0.6, 1.0, full);
          vec3 col = mix(orig, pick, strength);

          // muted painterly grade: soft desat, cool shadows, warm cream highs
          float luma = dot(col, vec3(0.299, 0.587, 0.114));
          float desat = 0.10 * on + 0.30 * pale + 0.45 * charc;
          col = mix(col, vec3(luma), desat);
          col *= mix(vec3(1.0), vec3(0.93, 0.99, 1.06), (1.0 - luma) * (0.4 * on + 0.5 * charc));
          col *= mix(vec3(1.0), vec3(1.06, 1.01, 0.93), smoothstep(0.55, 1.0, luma) * 0.4 * on);
          // gentle S-curve; charcoal bites harder, the pale flattens instead
          col = mix(col, col * col * (3.0 - 2.0 * col), 0.16 * on + 0.22 * charc - 0.14 * pale);
          // THE PALE: lifted, bleached, cold — the world losing its saturation
          col = mix(col, col * 0.82 + vec3(0.17, 0.175, 0.185), pale * 0.85);
          // CHARCOAL: crushed toward blue-black ink, cream highlights survive
          col = mix(col, col * vec3(0.88, 0.92, 1.0) - 0.025, charc * 0.7);
          // PORTAL: the landing page — ink-violet shadows, cream-paper lights,
          // vibrance up, and a faint cyan→magenta drift across the frame
          {
            float luma2 = dot(col, vec3(0.299, 0.587, 0.114));
            vec3 c = col;
            // bloom: barely-lifted saturation, morning-light calm
            c = mix(vec3(luma2), c, 1.12);
            // ramp: soft ink-blue shadows → warm cream mids → paper white
            vec3 lo = vec3(0.86, 0.88, 1.0);
            vec3 md = vec3(1.04, 1.0, 0.94);
            vec3 hi = vec3(1.06, 1.03, 0.97);
            c *= mix(mix(lo, md, smoothstep(0.05, 0.45, luma2)), hi, smoothstep(0.45, 0.9, luma2));
            // the gentlest S-curve, blacks settle into ink #1b1f2a
            c = mix(c, c * c * (3.0 - 2.0 * c), 0.14);
            c = max(c, vec3(0.016, 0.018, 0.026));
            // mesh-pastel drift: rose warming one side, sky cooling the other
            vec3 duo = mix(vec3(1.04, 0.97, 0.98), vec3(0.96, 1.0, 1.05), uv.x);
            c *= mix(vec3(1.0), duo, 0.24);
            // soft morning halation in the brights
            c += vec3(0.06, 0.05, 0.04) * smoothstep(0.72, 1.0, luma2);
            col = mix(col, c, lamp * 0.85);
          }

          // canvas weave + faint grain
          float weave = (sin(gl_FragCoord.x * 0.9) * sin(gl_FragCoord.y * 0.9)) * 0.5 + 0.5;
          col *= 1.0 - weave * (0.03 * oil + 0.045 * charc + 0.022 * lamp);
          col += (hash(uv * uRes + fract(uTime) * 17.0) - 0.5) * (0.012 * on + 0.012 * charc);

          // soft frame — the pale glows at the edges instead of darkening
          float vig = smoothstep(1.4, 0.5, length(uv - 0.5) * 1.5);
          col *= mix(1.0, vig, (0.28 + 0.12 * lamp) * (1.0 - pale));
          col += (1.0 - vig) * vec3(0.05, 0.05, 0.055) * pale;
          // disco vignette cools toward teal at the edges — the poster's accents
          col = mix(col, col * vec3(0.9, 0.96, 1.04), (1.0 - vig) * 0.3 * lamp);

          gl_FragColor = vec4(col, 1.0);
          #include <colorspace_fragment>
        }
      `,
    });
    this.material.toneMapped = false;
    const tri = new THREE.BufferGeometry();
    tri.setAttribute(
      'position',
      new THREE.Float32BufferAttribute([-1, -1, 0, 3, -1, 0, -1, 3, 0], 3),
    );
    tri.setAttribute('uv', new THREE.Float32BufferAttribute([0, 0, 2, 0, 0, 2], 2));
    const mesh = new THREE.Mesh(tri, this.material);
    mesh.frustumCulled = false;
    this.quadScene.add(mesh);
  }

  private static makeTarget(width: number, height: number): THREE.WebGLRenderTarget {
    return new THREE.WebGLRenderTarget(width, height, {
      type: THREE.HalfFloatType,
      depthBuffer: true,
    });
  }

  setMode(mode: FilterMode): void {
    const map: Record<FilterMode, number> = { off: 0, gouache: 1, oil: 2, pale: 3, charcoal: 4, portal: 5 };
    this.material.uniforms.uMode!.value = map[mode];
  }

  resize(width: number, height: number): void {
    this.rt.dispose();
    this.rt = PainterFilter.makeTarget(width, height);
    this.material.uniforms.tDiffuse!.value = this.rt.texture;
    (this.material.uniforms.uRes!.value as THREE.Vector2).set(width, height);
  }

  render(renderer: THREE.WebGLRenderer, scene: THREE.Scene, camera: THREE.Camera, time: number): void {
    this.material.uniforms.uTime!.value = time;
    renderer.setRenderTarget(this.rt);
    renderer.render(scene, camera);
    renderer.setRenderTarget(null);
    renderer.render(this.quadScene, this.quadCam);
  }

  dispose(): void {
    this.rt.dispose();
    this.material.dispose();
  }
}

