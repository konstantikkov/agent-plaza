import * as THREE from 'three';
import { radialTexture } from './materials';
import { PLAYABLE_SIZE } from './TerrainShim';

export interface SkyOptions {
  /** world-space center of the playable area */
  center?: { x: number; z: number };
  /** approximate world radius the sky/lighting should embrace */
  worldRadius?: number;
  fogDensity?: number;
  fogColor?: number;
  /** tight shadow frustum half-size that follows the hero */
  shadowHalf?: number;
}

/** Runtime-switchable lighting mood (time of day). */
export interface LightingPreset {
  sunColor: number;
  sunIntensity: number;
  /** normalized direction the sun shines FROM */
  sunDir: [number, number, number];
  hemiSky: number;
  hemiGround: number;
  hemiIntensity: number;
  fogColor: number;
  fogDensity: number;
  zenith: number;
  mid: number;
  horizon: number;
  exposure: number;
}

/**
 * Bright anime sky: gradient dome with sun glow, drifting clouds, and a warm
 * directional sun whose tight shadow frustum FOLLOWS the hero (snapped to
 * texels) — crisp character/building shadows instead of one blurry blob map
 * stretched over the whole world.
 */
export class SkyV2 {
  readonly group = new THREE.Group();
  readonly sun: THREE.DirectionalLight;
  private clouds: THREE.Sprite[] = [];
  private sunDir = new THREE.Vector3(0.55, 0.6, 0.38).normalize();
  private snap: number;
  private hemi: THREE.HemisphereLight;
  private domeUniforms!: {
    uSunDir: { value: THREE.Vector3 };
    uZenith: { value: THREE.Color };
    uMid: { value: THREE.Color };
    uHorizon: { value: THREE.Color };
  };
  private scene: THREE.Scene;

  constructor(scene: THREE.Scene, opts: SkyOptions = {}) {
    this.scene = scene;
    const center = opts.center ?? { x: PLAYABLE_SIZE / 2, z: PLAYABLE_SIZE / 2 };
    const radius = opts.worldRadius ?? 240;
    const shadowHalf = opts.shadowHalf ?? 22;
    scene.fog = new THREE.FogExp2(opts.fogColor ?? 0xcfe5f2, opts.fogDensity ?? 0.0044);

    this.domeUniforms = {
      uSunDir: { value: this.sunDir.clone() },
      uZenith: { value: new THREE.Color(0x3370d6) },
      uMid: { value: new THREE.Color(0x6ba8f0) },
      uHorizon: { value: new THREE.Color(0xdbedfc) },
    };
    const dome = new THREE.Mesh(
      new THREE.SphereGeometry(radius * 2, 32, 20),
      new THREE.ShaderMaterial({
        side: THREE.BackSide,
        fog: false,
        depthWrite: false,
        uniforms: this.domeUniforms,
        vertexShader: /* glsl */ `
          varying vec3 vDir;
          void main() {
            vDir = normalize(position);
            gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
          }
        `,
        fragmentShader: /* glsl */ `
          uniform vec3 uSunDir;
          uniform vec3 uZenith;
          uniform vec3 uMid;
          uniform vec3 uHorizon;
          varying vec3 vDir;
          void main() {
            float h = clamp(vDir.y, -0.05, 1.0);
            vec3 col = h < 0.22
              ? mix(uHorizon, uMid, smoothstep(-0.05, 0.22, h))
              : mix(uMid, uZenith, smoothstep(0.22, 0.85, h));
            float sunAmt = max(0.0, dot(normalize(vDir), uSunDir));
            col += vec3(1.0, 0.93, 0.75) * pow(sunAmt, 350.0) * 2.2;
            col += vec3(1.0, 0.9, 0.7) * pow(sunAmt, 18.0) * 0.2;
            gl_FragColor = vec4(col, 1.0);
          }
        `,
      }),
    );
    dome.position.set(center.x, 0, center.z);
    this.group.add(dome);

    const tex = radialTexture('rgba(255,255,255,0.95)', 'rgba(255,255,255,0)');
    for (let i = 0; i < 9; i++) {
      const cloud = new THREE.Sprite(
        new THREE.SpriteMaterial({ map: tex, transparent: true, opacity: 0.75, fog: false, depthWrite: false }),
      );
      const angle = (i / 9) * Math.PI * 2;
      const r = radius * (0.6 + (i % 3) * 0.25);
      cloud.position.set(center.x + Math.cos(angle) * r, 55 + (i % 4) * 16, center.z + Math.sin(angle) * r);
      const s = 52 + (i % 3) * 30;
      cloud.scale.set(s, s * 0.38, 1);
      cloud.userData.drift = 0.6 + (i % 3) * 0.35;
      this.clouds.push(cloud);
      this.group.add(cloud);
    }

    // lighting rig — strong warm key against cool sky fill for contrast
    this.hemi = new THREE.HemisphereLight(0xbcd8ff, 0x5d7c44, 0.6);
    this.group.add(this.hemi);

    this.sun = new THREE.DirectionalLight(0xffedc8, 3.0);
    this.sun.castShadow = true;
    this.sun.shadow.mapSize.set(2048, 2048); // 4096 was a heavy GPU tax for a stylized scene
    this.sun.shadow.camera.left = -shadowHalf;
    this.sun.shadow.camera.right = shadowHalf;
    this.sun.shadow.camera.top = shadowHalf;
    this.sun.shadow.camera.bottom = -shadowHalf;
    this.sun.shadow.camera.near = 5;
    this.sun.shadow.camera.far = 160;
    this.sun.shadow.bias = -0.0004;
    this.sun.shadow.normalBias = 0.02;
    this.snap = (shadowHalf * 2) / 4096;
    this.group.add(this.sun, this.sun.target);
    this.followSun(new THREE.Vector3(center.x, 0, center.z));

    const bounce = new THREE.DirectionalLight(0xcfe0ff, 0.28);
    bounce.position.set(-40, 30, -20);
    this.group.add(bounce);
  }

  /** Switch the whole mood at runtime: sun, ambient, fog, sky dome. */
  applyPreset(p: LightingPreset): void {
    this.sunDir.set(...p.sunDir).normalize();
    this.sun.color.set(p.sunColor);
    this.sun.intensity = p.sunIntensity;
    this.hemi.color.set(p.hemiSky);
    this.hemi.groundColor.set(p.hemiGround);
    this.hemi.intensity = p.hemiIntensity;
    this.scene.fog = new THREE.FogExp2(p.fogColor, p.fogDensity);
    this.domeUniforms.uSunDir.value.copy(this.sunDir);
    this.domeUniforms.uZenith.value.set(p.zenith);
    this.domeUniforms.uMid.value.set(p.mid);
    this.domeUniforms.uHorizon.value.set(p.horizon);
  }

  /** Keep the crisp shadow window centered on the hero (texel-snapped). */
  followSun(target: THREE.Vector3): void {
    const snap = Math.max(this.snap * 8, 0.1);
    const tx = Math.round(target.x / snap) * snap;
    const tz = Math.round(target.z / snap) * snap;
    this.sun.target.position.set(tx, 0, tz);
    this.sun.position.set(tx + this.sunDir.x * 70, this.sunDir.y * 70 + target.y, tz + this.sunDir.z * 70);
  }

  update(time: number): void {
    for (const cloud of this.clouds) {
      cloud.position.x += Math.sin(time * 0.02 + cloud.userData.drift) * 0.008 + 0.006 * cloud.userData.drift;
      if (cloud.position.x > 300) cloud.position.x = -220;
    }
  }
}
