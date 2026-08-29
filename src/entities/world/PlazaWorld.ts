import * as THREE from 'three';
import { createRng, hashString } from '@/shared/lib/shared';
import { Grid, findPath, type GridPosition } from '@/shared/lib/game-core/index';
import { CameraV2 } from '@/shared/engine/CameraV2';
import { TouchInput } from '@/shared/engine/TouchInput';
import { SkyV2, type LightingPreset } from '@/shared/engine/SkyV2';
import { radialTexture } from '@/shared/engine/materials';
import { useGameStore } from '@/shared/engine/gameStore';

/**
 * PlazaWorld — the shared voxel world under Agent Plaza.
 * Deterministic from its seed: terraced block terrain, a portal plaza,
 * ponds and rivers with bridges, enterable buildings (cottage / tavern /
 * cathedral), caves as a second walkable layer, an endless painted horizon.
 * Same seed, same world — so a room only ever syncs presence and chat.
 */
import { N, B, WORLD, BORDER, STROKES, CAVE_FLOOR, CAVE_BG, INK, cellWorld, worldCell } from './constants';
import { LIGHT_PRESETS, LAMP_FACTOR } from './presets';
import { SWIRL_FRAG } from './shaders';
import { PainterFilter } from './PainterFilter';
import { makeVoxelFolk, type VoxelFolk } from './folk';
import { createLayout, type LayoutOverrides, type WorldLayout } from './layout';
import { buildBuildings as buildSettlement } from './buildings';
import { buildOuterWorld } from './outerWorld';
import type {
  WorldCallbacks,
  FilterMode,
  WorldStats,
  WorldEntity,
  WorldManifest,
} from './types';
import type { Daytime, Weather } from './presets';

export type {
  WorldCallbacks,
  FilterMode,
  WorldStats,
  WorldEntity,
  WorldManifest,
} from './types';
export type { Daytime, Weather } from './presets';

export class PlazaWorld {
  private renderer: THREE.WebGLRenderer;
  private scene = new THREE.Scene();
  private sky!: SkyV2;
  private cameraCtl!: CameraV2;
  private grid = new Grid(N, N, 'floor');
  private filter!: PainterFilter;

  private hero!: VoxelFolk;
  private stridePhase = 0;
  private path: GridPosition[] = [];
  private pathIndex = 0;
  private heading = Math.PI;
  private pendingInteract: string | null = null;

  private guide?: VoxelFolk;
  private guideTalked = false;
  private pondSeen = false;
  private portalSeen = false;

  private hoverQuad!: THREE.Mesh;
  private targetRing!: THREE.Mesh;
  private targetPulse = 0;

  private touchInput?: TouchInput;
  private raycaster = new THREE.Raycaster();
  private pointer = new THREE.Vector2();
  private ground!: THREE.Mesh;
  private downAt: { x: number; y: number; t: number } | null = null;
  private interactCells = new Map<string, { id: string; label: string }>();

  // atmosphere
  private snow!: THREE.InstancedMesh;
  private snowData: { x: number; y: number; z: number; speed: number; phase: number }[] = [];
  private rain!: THREE.InstancedMesh;
  private rainData: { x: number; y: number; z: number; speed: number }[] = [];
  private fogSprites: THREE.Sprite[] = [];
  private lampLights: { light: THREE.PointLight; base: number }[] = [];
  private interiorLights: { light: THREE.PointLight; base: number }[] = [];
  private daytime: Daytime = 'dawn';
  private weather: Weather = 'snow';

  // the portal
  private portalWheel?: THREE.Group;
  private portalParticles?: THREE.InstancedMesh;
  private portalLight?: THREE.PointLight;
  private swirlUniform = { uTime: { value: 0 } };
  private folk: VoxelFolk[] = [];

  // smoother locomotion + living landscape
  private moveBlend = 0;
  private baseY = 0;
  private yVel = 0;
  private bridgeSet = new Set<number>();
  private waterTex?: THREE.CanvasTexture;
  private clouds: { group: THREE.Group; speed: number }[] = [];
  private islands: { group: THREE.Group; baseY: number; phase: number }[] = [];
  private crystals: THREE.Mesh[] = [];
  private landmarks: { kind: string; x: number; z: number }[] = [];
  private chestLid?: THREE.Mesh;
  private chestOpened = false;

  // the underground: a second walkable layer beneath the blocks
  private layer: 'surface' | 'cave' = 'surface';
  private worldSurface = new THREE.Group();
  private caveGroup = new THREE.Group();
  private caveGrid = new Grid(N, N, 'floor');
  private caveMask = new Uint8Array(N * N);
  private roomMask = new Uint8Array(N * N);
  private caveFloor?: THREE.InstancedMesh;
  private entranceSet = new Set<string>();
  private hasCaves = false;
  private groundGroup!: THREE.Group;

  private buildingRects: { x0: number; z0: number; x1: number; z1: number; kind?: string; doorX?: number; doorZ?: number }[] = [];
  private caveFloorH = new Float32Array(N * N).fill(CAVE_FLOOR);
  private veil = 0;
  private caveAmbient = new THREE.AmbientLight(0xb89b7a, 0);
  private heroTorch = new THREE.PointLight(0xffb054, 0, 14, 2);
  private torchFlame?: THREE.Mesh;
  private torchGroup?: THREE.Group;
  private fogBase = 0.01;
  private expBase = 1.18;
  private lanterns: { mat: THREE.MeshBasicMaterial; hue: THREE.Color }[] = [];

  // plaza: outside layers (multiplayer, agent tools) ride the game loop
  private tickHooks = new Set<(dt: number, time: number) => void>();
  private walkResolve: ((r: 'arrived' | 'interrupted') => void) | null = null;

  private clock = new THREE.Clock();
  private raf = 0;
  private disposed = false;
  private frames = 0;
  private fpsAccum = 0;
  private fps = 0;
  private unsub: Array<() => void> = [];

  private strokes: number[] = STROKES;

  private layout!: WorldLayout;

  private computeLayout(): void {
    const generated = createLayout(this.seed, this.opts.overrides);
    this.layout = generated.layout;
    this.strokes = generated.strokes;
  }

  private riverXAt(z: number): number {
    return this.layout.pond.cx + this.layout.riverAmp * Math.sin(z * this.layout.riverFreq + this.layout.riverPhase);
  }

  constructor(
    private canvas: HTMLCanvasElement,
    private cb: WorldCallbacks,
    private seed: string = 'portal-227',
    private opts: { overrides?: LayoutOverrides } = {},
  ) {
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: false, powerPreference: 'high-performance' });
    // rendering budget: cap the backbuffer at 1.5× and use plain PCF shadows —
    // the paint filter hides the difference, frame time drops noticeably
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.5));
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFShadowMap;
    // the scene is mostly static: re-render the shadow map at ~10 fps (in the
    // loop) instead of every frame — the shadow pass is a whole extra draw
    this.renderer.shadowMap.autoUpdate = false;
    this.renderer.shadowMap.needsUpdate = true;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    const size = new THREE.Vector2();
    this.renderer.getDrawingBufferSize(size);
    this.filter = new PainterFilter(Math.max(2, size.x), Math.max(2, size.y));
    this.computeLayout();
    this.daytime = this.layout.daytimePick;
    this.weather = this.layout.weatherPick;
    this.resize();
    // defer: the world builds synchronously, and callers must be able to hold
    // a reference before onReady fires (no TDZ traps in page callbacks)
    queueMicrotask(() => {
      if (!this.disposed) this.init();
    });
  }

  setFilterMode(mode: FilterMode): void {
    this.filter.setMode(mode);
  }

  setDaytime(mode: Daytime): void {
    this.daytime = mode;
    this.applyEnvironment();
  }

  setWeather(mode: Weather): void {
    this.weather = mode;
    this.applyEnvironment();
  }

  private applyEnvironment(): void {
    const p = LIGHT_PRESETS[this.daytime];
    this.sky.applyPreset(p);
    const underground = this.layer === 'cave';
    const sunMul = (this.weather === 'rain' ? 0.7 : this.weather === 'fog' ? 0.78 : 1) * (underground ? 0.34 : 1);
    this.sky.sun.intensity = p.sunIntensity * sunMul;
    const fog = this.scene.fog as THREE.FogExp2 | null;
    if (fog) {
      fog.density = underground
        ? 0.035
        : p.fogDensity * (this.weather === 'fog' ? 2.3 : this.weather === 'rain' ? 1.25 : 1);
      if (underground) fog.color.setHex(0x0d0a18);
    }
    this.fogBase = fog ? fog.density : 0.01;
    this.expBase = underground ? p.exposure * 0.9 : p.exposure;
    this.renderer.toneMappingExposure = this.expBase;
    this.caveAmbient.intensity = underground ? 1.0 : 0;
    this.sky.group.visible = !underground;
    this.scene.background = underground ? CAVE_BG : null;
    const above = !underground;
    if (this.snow) this.snow.visible = above && this.weather === 'snow';
    if (this.rain) this.rain.visible = above && this.weather === 'rain';
    for (const sprite of this.fogSprites) sprite.visible = above && this.weather === 'fog';
  }

  private init(): void {
    this.cb.onLoading('Stacking the blocks…');
    this.sky = new SkyV2(this.scene, {
      center: { x: WORLD / 2, z: WORLD / 2 },
      worldRadius: 90,
      shadowHalf: 26,
    });
    this.scene.add(this.sky.group);
    this.applyEnvironment();

    this.scene.add(this.worldSurface);
    this.scene.add(this.caveGroup);
    this.scene.add(this.caveAmbient);
    this.scene.add(this.heroTorch);
    this.caveGroup.visible = false;
    this.buildLevels();
    this.buildGround();
    this.buildCellFeedback();
    this.buildHedges();
    this.buildPond();
    this.buildLamps();
    this.buildPortal();
    this.buildFolk();
    this.buildBuildings();
    this.buildTreesAndGarden();
    this.buildFarShapes();
    this.buildSky();
    this.buildLandmarks();
    this.buildCaves();
    this.buildWeather();

    // occupancy: hedge ring blocks the outer cells, gate stays open south
    for (let z = 0; z < N; z++) {
      for (let x = 0; x < N; x++) {
        const border = x < BORDER || z < BORDER || x >= N - BORDER || z >= N - BORDER;
        const gate =
          x >= this.layout.corridorX0 && x <= this.layout.corridorX0 + 3 && z >= N - BORDER && z <= N - 3;
        if (border && !gate) {
          try {
            this.grid.place(`hedge-${x}-${z}`, x, z, { width: 1, depth: 1 });
          } catch {
            /* claimed */
          }
        }
      }
    }
    for (let z = 0; z < N; z++) {
      for (let x = 0; x < N; x++) {
        if (this.levels[z * N + x]! < 0) {
          try {
            this.grid.place(`water-${x}-${z}`, x, z, { width: 1, depth: 1 });
          } catch {
            /* claimed */
          }
        }
      }
    }
    for (let gx = this.layout.corridorX0; gx <= this.layout.corridorX0 + 3; gx++) {
      for (const gz of [N - 3, N - 2, N - 1]) this.interactCells.set(`${gx},${gz}`, { id: 'edge', label: 'Page Edge' });
    }

    this.cb.onLoading('Waking the wanderer…');
    this.hero = makeVoxelFolk(0x5aa4e8, 1.12);
    // a rose scarf, because heists demand style
    const scarf = new THREE.Mesh(
      new THREE.BoxGeometry(0.4, 0.1, 0.34),
      new THREE.MeshLambertMaterial({ color: 0xf06d9a }),
    );
    scarf.position.y = 0.9;
    this.hero.group.add(scarf);
    // a real torch for the dark: stick + flame, raised in the right hand
    this.torchGroup = new THREE.Group();
    const stick = new THREE.Mesh(
      new THREE.BoxGeometry(0.07, 0.42, 0.07),
      new THREE.MeshLambertMaterial({ color: INK }),
    );
    stick.position.y = 0.21;
    this.torchGroup.add(stick);
    this.torchFlame = new THREE.Mesh(
      new THREE.BoxGeometry(0.12, 0.15, 0.12),
      new THREE.MeshBasicMaterial({ color: 0xff9a3c }), // tone-mapped: glows, never blows out
    );
    this.torchFlame.position.y = 0.5;
    this.torchGroup.add(this.torchFlame);
    this.torchGroup.position.set(0.5, 0.42, 0.3);
    this.torchGroup.rotation.z = -0.38;
    this.torchGroup.visible = false;
    this.hero.group.add(this.torchGroup);

    const spawn = cellWorld(this.layout.spawn.x, this.layout.spawn.z);
    this.hero.group.position.set(spawn.x, this.groundHeight(spawn.x, spawn.z), spawn.z);
    this.baseY = this.groundHeight(spawn.x, spawn.z);
    this.hero.group.rotation.y = Math.PI;
    this.heading = Math.PI;
    this.scene.add(this.hero.group);

    this.cameraCtl = new CameraV2(
      this.canvas,
      new THREE.Vector3(spawn.x, 0, spawn.z),
      (x: number, z: number) => this.groundHeight(x, z),
      { distance: 8.5, pitch: 0.55, yaw: 0 }, // start close to the avatar; wheel/pinch zooms 3-18
    );

    // mobile: swipe = walk that way, V3-style (length decides distance)
    this.touchInput = new TouchInput(this.canvas, (dx, dy, len) => this.swipeTo(dx, dy, len));
    this.canvas.addEventListener('pointerdown', this.onPointerDown);
    this.canvas.addEventListener('pointerup', this.onPointerUp);
    this.canvas.addEventListener('pointermove', this.onPointerMove);
    window.addEventListener('resize', this.resize);
    document.addEventListener('visibilitychange', this.onVisibility);
    window.addEventListener('keydown', this.onKeyDown);
    this.wireStore();
    this.cb.onReady();
    this.loop();
  }

  // ---------- world ----------
  /** Quantized block levels — terraces, mesas and a carved river. */
  private levels = new Int8Array(N * N);

  private noiseA = 0;
  private noiseB = 0;
  private noiseC = 0;
  private noiseD = 0;

  private buildLevels(): void {
    const rng = createRng(hashString(this.seed + '-terrain'));
    this.noiseA = rng() * 6.28;
    this.noiseB = rng() * 6.28;
    this.noiseC = rng() * 6.28;
    this.noiseD = rng() * 6.28;
    const L = this.layout;
    const flat = (x: number, z: number): boolean =>
      (x >= L.plaza.x0 && x <= L.plaza.x1 && z >= L.plaza.z0 && z <= L.plaza.z1) ||
      (x >= L.pond.x0 - 1 && x <= L.pond.x0 + L.pond.size && z >= L.pond.z0 - 1 && z <= L.pond.z0 + L.pond.size) ||
      (x >= L.corridorX0 && x <= L.corridorX0 + 3) ||
      (z >= N - 15 && z <= N - 5 && x >= 4 && x <= N - 5);
    for (let z = 0; z < N; z++) {
      for (let x = 0; x < N; x++) {
        const i = z * N + x;
        // the river: carved below zero, flowing from the pond to the south
        const inRiver =
          L.hasRiver &&
          z >= L.pond.z0 + L.pond.size + 1 &&
          z <= N - 5 &&
          x >= 4 &&
          x < N - 4 &&
          Math.abs(x + 0.5 - this.riverXAt(z)) < 1.35 &&
          !(x >= L.corridorX0 && x <= L.corridorX0 + 3);
        if (inRiver) {
          if (z === L.bridgeZ0 || z === L.bridgeZ0 + 1) {
            this.levels[i] = 0; // the bridge deck
            this.bridgeSet.add(i);
          } else {
            this.levels[i] = -1;
          }
          continue;
        }
        let lvl = 0;
        if (!flat(x, z)) {
          const n =
            Math.sin(x * 0.55 + this.noiseA) * Math.cos(z * 0.5 + this.noiseB) * 0.5 +
            Math.sin(x * 1.3 + this.noiseC) * Math.sin(z * 1.1 + this.noiseD) * 0.34 +
            (rng() - 0.5) * 0.3;
          const d = Math.hypot(x - L.portal.wx, z - N * 0.45);
          const rise = Math.max(0, (d - 6.5) / 8.5) * L.hillMul;
          lvl = Math.max(
            0,
            Math.min(5, L.hillBase + Math.floor((n + 0.55) * 2.8 * rise + rise * 1.8)),
          );
          // mesas: proud flat-topped hills, away from the pond
          const mesaX = L.pond.x0 < N / 2 ? N - 6.5 : 6.5;
          const mesaSpots: [number, number, number, number][] = [
            [mesaX, 5.5, 4.2, 3],
            [mesaX, N * 0.38, 3.2, 2],
            [N - 1 - mesaX, N * 0.5, 3.6, 3],
            [mesaX, N * 0.22, 2.6, 4],
          ];
          for (let mi = 0; mi < Math.min(L.mesaCount, mesaSpots.length); mi++) {
            const [mx, mz, mr, ml] = mesaSpots[mi]!;
            if (Math.hypot(x - mx, z - mz) < mr) lvl = Math.max(lvl, ml);
          }
          // still lakes: carve pools wherever the archetype scattered them
          for (const mtn of L.mountains) {
            const md = Math.hypot(x + 0.5 - mtn.x, z + 0.5 - mtn.z);
            if (md < mtn.r) {
              lvl = Math.max(lvl, Math.min(8, Math.round(mtn.peak * (1 - md / mtn.r) + 1)));
            }
          }
          for (const lake of L.lakes) {
            if (Math.hypot(x + 0.5 - lake.x, z + 0.5 - lake.z) < lake.r) lvl = -9;
          }
          if (lvl === -9) {
            this.levels[i] = -1;
            continue;
          }
        }
        this.levels[i] = lvl;
      }
    }
    // walkable terraces: no cliff between neighbours taller than one level
    for (let pass = 0; pass < 5; pass++) {
      for (let z = 0; z < N; z++) {
        for (let x = 0; x < N; x++) {
          const i = z * N + x;
          if (this.levels[i]! < 0) continue;
          let low = 127;
          const check = (j: number): void => {
            const lv = this.levels[j]!;
            if (lv >= 0 && lv < low) low = lv;
          };
          if (x > 0) check(i - 1);
          if (x < N - 1) check(i + 1);
          if (z > 0) check(i - N);
          if (z < N - 1) check(i + N);
          if (low < 127 && this.levels[i]! > low + 1) this.levels[i] = (low + 1) as never;
        }
      }
    }
  }

  private groundHeight(x: number, z: number): number {
    if (this.layer === 'cave') {
      const ccx = Math.min(N - 1, Math.max(0, Math.floor(x)));
      const ccz = Math.min(N - 1, Math.max(0, Math.floor(z)));
      return this.caveFloorH[ccz * N + ccx]!;
    }
    const cx = Math.min(N - 1, Math.max(0, Math.floor(x)));
    const cz = Math.min(N - 1, Math.max(0, Math.floor(z)));
    const lvl = this.levels[cz * N + cx]!;
    return lvl < 0 ? -0.3 : lvl * 0.5;
  }

  private activeGrid(): Grid {
    return this.layer === 'cave' ? this.caveGrid : this.grid;
  }

  private interactKey(x: number, z: number): string {
    return (this.layer === 'cave' ? 'c:' : '') + `${x},${z}`;
  }

  /** Step through a cave mouth: swap layers, dim the world, let the spring drop you. */
  private toggleLayer(): void {
    this.layer = this.layer === 'surface' ? 'cave' : 'surface';
    this.worldSurface.visible = this.layer === 'surface';
    this.caveGroup.visible = this.layer === 'cave';
    this.path = [];
    this.pathIndex = 0;
    this.targetRing.visible = false;
    this.pendingInteract = null;
    this.veil = 1; // a breath of darkness while the world changes over
    this.applyEnvironment();
  }

  /** The page rebuilt from blocks: slabs, turf caps, flowers, a living river. */
  private buildGround(): void {
    // ground visuals live in one disposable group so the editor can rebuild
    if (this.groundGroup) {
      this.worldSurface.remove(this.groundGroup);
      this.groundGroup.traverse((o) => {
        const mesh = o as THREE.Mesh;
        if (mesh.geometry) mesh.geometry.dispose();
        const m = mesh.material as THREE.Material | THREE.Material[] | undefined;
        if (Array.isArray(m)) m.forEach((mm) => mm.dispose());
        else if (m) m.dispose();
      });
    }
    this.groundGroup = new THREE.Group();
    this.worldSurface.add(this.groundGroup);
    const rng = createRng(hashString(this.seed + '-blocks'));
    // shared block texture: paper face with a fine ink border
    const bc = document.createElement('canvas');
    bc.width = bc.height = 64;
    const bctx = bc.getContext('2d')!;
    bctx.fillStyle = '#ffffff';
    bctx.fillRect(0, 0, 64, 64);
    bctx.strokeStyle = 'rgba(27,31,42,0.22)';
    bctx.lineWidth = 2.4;
    bctx.strokeRect(1.2, 1.2, 61.6, 61.6);
    for (let i = 0; i < 26; i++) {
      bctx.fillStyle = `rgba(27,31,42,${0.02 + rng() * 0.035})`;
      bctx.fillRect(rng() * 60 + 2, rng() * 60 + 2, 1.4, 1.4);
    }
    const blockTex = new THREE.CanvasTexture(bc);
    blockTex.colorSpace = THREE.SRGBColorSpace;
    blockTex.anisotropy = 4;

    const geo = new THREE.BoxGeometry(1, 0.5, 1);
    const shades = new Float32Array(24 * 3);
    for (let v = 0; v < 24; v++) {
      const face = Math.floor(v / 4);
      const sh = face === 2 ? 1.0 : face === 3 ? 0.62 : face >= 4 ? 0.86 : 0.78;
      shades[v * 3] = sh;
      shades[v * 3 + 1] = sh;
      shades[v * 3 + 2] = sh;
    }
    geo.setAttribute('color', new THREE.BufferAttribute(shades, 3));

    const K = N / 32;
    const washes: [number, number, number, number][] = [
      [0xf06d9a, 4.5 * K, 3.2 * K, 0.14],
      [0x5aa4e8, 27.5 * K, 5.1 * K, 0.15],
      [0x9b7bf2, 16 * K, 28.8 * K, 0.16],
      [0xf5a45c, 6.4 * K, 23 * K, 0.13],
      [0x6fc98f, 25.6 * K, 19.8 * K, 0.12],
    ];
    const cream = new THREE.Color(this.layout.paperTint);
    const honey = new THREE.Color(0xe2c28e);
    const cellColor = (x: number, z: number): THREE.Color => {
      if (this.bridgeSet.has(z * N + x)) return honey.clone(); // wooden bridge deck
      const c = cream.clone();
      for (const [hex, wx, wz, a] of washes) {
        const d = Math.hypot(x + 0.5 - wx, z + 0.5 - wz);
        c.lerp(new THREE.Color(hex), a * Math.exp(-(d * d) / (90 * K * K)));
      }
      c.offsetHSL(0, 0, (rng() - 0.5) * 0.04);
      return c;
    };

    // biome turf tints: mint groves, rose plaza, sky banks, marigold village
    const biome = (x: number, z: number): number | null => {
      const cx = x + 0.5;
      const cz = z + 0.5;
      if (this.levels[z * N + x]! < 0 || this.bridgeSet.has(z * N + x)) return null;
      const L2 = this.layout;
      const nearWater =
        (L2.hasRiver && z >= L2.pond.z0 + L2.pond.size && z <= N - 5 && Math.abs(cx - this.riverXAt(z)) < 2.6) ||
        Math.hypot(cx - L2.pond.cx, cz - L2.pond.cz) < 3.8;
      if (nearWater) return 0xaad2f2;
      if (Math.hypot(cx - L2.portal.wx, cz - L2.portal.wz) < 5.5) return 0xf6b6cc;
      if (Math.hypot(cx - L2.village.x, cz - L2.village.z) < 4) return 0xf8cf9e;
      if (Math.hypot(cx - L2.crystalsAt.x, cz - L2.crystalsAt.z) < 3.4) return 0x9fe0b8;
      return rng() < 0.16 ? 0xdff0d0 : null;
    };

    // slabs
    let slabCount = 0;
    for (let z = 0; z < N; z++) {
      for (let x = 0; x < N; x++) {
        const lvl = this.levels[z * N + x]!;
        slabCount += lvl < 0 ? 1 : lvl + 2;
      }
    }
    const mesh = new THREE.InstancedMesh(
      geo,
      new THREE.MeshLambertMaterial({ map: blockTex, vertexColors: true }),
      slabCount,
    );
    const m = new THREE.Matrix4();
    const tint = new THREE.Color();
    const bed = new THREE.Color(0x51649c);
    let i = 0;
    const turfCells: { x: number; z: number; top: number; hex: number }[] = [];
    for (let z = 0; z < N; z++) {
      for (let x = 0; x < N; x++) {
        const lvl = this.levels[z * N + x]!;
        if (lvl < 0) {
          // riverbed slab, deep-blue paper
          m.makeTranslation(x + 0.5, -0.75, z + 0.5);
          mesh.setMatrixAt(i, m);
          mesh.setColorAt(i, bed);
          i++;
          continue;
        }
        const color = cellColor(x, z);
        for (let sIdx = -2; sIdx < lvl; sIdx++) {
          m.makeTranslation(x + 0.5, (sIdx + 1) * 0.5 - 0.25, z + 0.5);
          mesh.setMatrixAt(i, m);
          const depth = lvl - 1 - sIdx;
          tint.copy(color).multiplyScalar(1 - Math.min(0.18, depth * 0.06));
          mesh.setColorAt(i, tint);
          i++;
        }
        const hex = biome(x, z);
        if (hex !== null) turfCells.push({ x, z, top: lvl * 0.5, hex });
      }
    }
    mesh.instanceMatrix.needsUpdate = true;
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    mesh.receiveShadow = true;
    mesh.castShadow = true;
    this.ground = mesh;
    this.groundGroup.add(mesh);

    // turf caps — biome-coloured tops, Minecraft grass style
    const turf = new THREE.InstancedMesh(
      new THREE.BoxGeometry(0.98, 0.09, 0.98),
      new THREE.MeshLambertMaterial(),
      turfCells.length,
    );
    const flowerSpots: { x: number; z: number; y: number }[] = [];
    turfCells.forEach((cell, ti) => {
      m.makeTranslation(cell.x + 0.5, cell.top + 0.045, cell.z + 0.5);
      turf.setMatrixAt(ti, m);
      tint.setHex(cell.hex).offsetHSL(this.layout.hueShift, 0, (rng() - 0.5) * 0.05);
      turf.setColorAt(ti, tint);
      if (rng() < this.layout.flowerChance) {
        flowerSpots.push({ x: cell.x + 0.25 + rng() * 0.5, z: cell.z + 0.25 + rng() * 0.5, y: cell.top + 0.16 });
      }
    });
    turf.instanceMatrix.needsUpdate = true;
    if (turf.instanceColor) turf.instanceColor.needsUpdate = true;
    turf.receiveShadow = true;
    this.groundGroup.add(turf);

    // tiny cube flowers in the stroke colours
    if (flowerSpots.length > 0) {
      const flowers = new THREE.InstancedMesh(
        new THREE.BoxGeometry(0.14, 0.14, 0.14),
        new THREE.MeshLambertMaterial(),
        flowerSpots.length,
      );
      flowerSpots.forEach((f, fi) => {
        m.makeTranslation(f.x, f.y, f.z);
        flowers.setMatrixAt(fi, m);
        tint.setHex(this.strokes[fi % this.strokes.length]!);
        flowers.setColorAt(fi, tint);
      });
      flowers.instanceMatrix.needsUpdate = true;
      if (flowers.instanceColor) flowers.instanceColor.needsUpdate = true;
      flowers.castShadow = true;
      this.groundGroup.add(flowers);
    }

    // the river surface — marbled liquid strokes, slowly flowing
    const wc = document.createElement('canvas');
    wc.width = wc.height = 256;
    const wctx = wc.getContext('2d')!;
    wctx.fillStyle = '#2b3a6b';
    wctx.fillRect(0, 0, 256, 256);
    const liquid = ['124,92,255', '90,164,232', '111,201,143', '240,109,154'];
    for (let li = 0; li < 90; li++) {
      wctx.strokeStyle = `rgba(${liquid[Math.floor(rng() * liquid.length)]},${0.1 + rng() * 0.2})`;
      wctx.lineWidth = 1.5 + rng() * 3;
      const lx = rng() * 256;
      const ly = rng() * 256;
      wctx.beginPath();
      wctx.moveTo(lx, ly);
      wctx.lineTo(lx + (rng() - 0.5) * 10, ly + 20 + rng() * 60);
      wctx.stroke();
    }
    this.waterTex = new THREE.CanvasTexture(wc);
    this.waterTex.colorSpace = THREE.SRGBColorSpace;
    this.waterTex.wrapS = this.waterTex.wrapT = THREE.RepeatWrapping;
    const wPos: number[] = [];
    const wUv: number[] = [];
    const wIdx: number[] = [];
    for (let z = 0; z < N; z++) {
      for (let x = 0; x < N; x++) {
        if (this.levels[z * N + x]! >= 0) continue;
        const base = wPos.length / 3;
        wPos.push(x, -0.16, z + 1, x + 1, -0.16, z + 1, x + 1, -0.16, z, x, -0.16, z);
        wUv.push(x / 4, (z + 1) / 4, (x + 1) / 4, (z + 1) / 4, (x + 1) / 4, z / 4, x / 4, z / 4);
        wIdx.push(base, base + 1, base + 2, base, base + 2, base + 3);
      }
    }
    const wGeo = new THREE.BufferGeometry();
    wGeo.setAttribute('position', new THREE.Float32BufferAttribute(wPos, 3));
    wGeo.setAttribute('uv', new THREE.Float32BufferAttribute(wUv, 2));
    wGeo.setIndex(wIdx);
    wGeo.computeVertexNormals();
    const water = new THREE.Mesh(
      wGeo,
      new THREE.MeshLambertMaterial({ map: this.waterTex, transparent: true, opacity: 0.95 }),
    );
    this.groundGroup.add(water);

    // dotted ink path on the flat corridor, gate → portal
    const dotMat = new THREE.MeshBasicMaterial({ color: INK, transparent: true, opacity: 0.3 });
    for (let z = N - 4.5; z > this.layout.plaza.z1 + 0.7; z -= 0.8) {
      const dot = new THREE.Mesh(new THREE.CircleGeometry(0.08, 10), dotMat);
      dot.rotation.x = -Math.PI / 2;
      dot.position.set(this.layout.corridorMid, this.groundHeight(this.layout.corridorMid, z) + 0.012, z);
      this.groundGroup.add(dot);
    }

    // the page continues beyond the blocks
    const apron = new THREE.Mesh(
      new THREE.PlaneGeometry(260, 260),
      new THREE.MeshStandardMaterial({ color: 0xefe5d5, roughness: 1 }),
    );
    apron.rotation.x = -Math.PI / 2;
    apron.position.set(WORLD / 2, -1.03, WORLD / 2);
    apron.receiveShadow = true;
    this.groundGroup.add(apron);
  }

  private buildCellFeedback(): void {
    this.hoverQuad = new THREE.Mesh(
      new THREE.PlaneGeometry(B * 0.94, B * 0.94),
      new THREE.MeshBasicMaterial({ color: 0x5aa4e8, transparent: true, opacity: 0.22, depthWrite: false }),
    );
    this.hoverQuad.rotation.x = -Math.PI / 2;
    this.hoverQuad.visible = false;
    this.scene.add(this.hoverQuad);
    this.targetRing = new THREE.Mesh(
      new THREE.RingGeometry(B * 0.28, B * 0.4, 28),
      new THREE.MeshBasicMaterial({ color: 0xf06d9a, transparent: true, opacity: 0.85, depthWrite: false, side: THREE.DoubleSide }),
    );
    this.targetRing.rotation.x = -Math.PI / 2;
    this.targetRing.visible = false;
    this.scene.add(this.targetRing);
  }

  /** The map border: a block wall riding the terraces, leafy pastel cubes. */
  private buildHedges(): void {
    const rng = createRng(hashString(this.seed + '-wall'));
    const geo = new THREE.BoxGeometry(0.94, 0.5, 0.94);
    const spots: { x: number; z: number; y: number; s: number; c: number }[] = [];
    const pick = (): number => {
      const r = rng();
      if (r < 0.68) return r < 0.34 ? 0x6fc98f : 0x8fd9a8;
      return this.strokes[Math.floor(rng() * this.strokes.length)]!;
    };
    for (let z = 0; z < N; z++) {
      for (let x = 0; x < N; x++) {
        const border = x < BORDER || z < BORDER || x >= N - BORDER || z >= N - BORDER;
        const gate = x >= 14 && x <= 17 && z >= N - BORDER;
        if (!border || gate) continue;
        // wall on the border ring's inner edge only — one block thick
        const inner =
          x === BORDER - 1 || z === BORDER - 1 || x === N - BORDER || z === N - BORDER;
        if (!inner) continue;
        const top = Math.max(0, this.levels[z * N + x]!) * 0.5;
        const tall = 2 + (rng() < 0.3 ? 1 : 0);
        for (let h = 0; h < tall; h++) {
          spots.push({ x: x + 0.5, z: z + 0.5, y: top + 0.25 + h * 0.5, s: 1 - h * 0.05, c: pick() });
        }
      }
    }
    const mesh = new THREE.InstancedMesh(geo, new THREE.MeshLambertMaterial(), spots.length);
    const m = new THREE.Matrix4();
    const color = new THREE.Color();
    spots.forEach((sp, i) => {
      m.makeScale(sp.s, 1, sp.s);
      m.setPosition(sp.x, sp.y, sp.z);
      mesh.setMatrixAt(i, m);
      color.setHex(sp.c).offsetHSL(0, 0, (rng() - 0.5) * 0.06);
      mesh.setColorAt(i, color);
    });
    mesh.instanceMatrix.needsUpdate = true;
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    this.worldSurface.add(mesh);
  }

  /** Voxel trees, spinning crystals and the approach arch. */
  private buildTreesAndGarden(): void {
    const rng = createRng(hashString(this.seed + '-garden'));
    const trunkMat = new THREE.MeshLambertMaterial({ color: 0xd9b98c });
    const tree = (cx: number, cz: number, canopyHex: number, scale: number): void => {
      const wx = cx + 1;
      const wz = cz + 1;
      const baseY = this.groundHeight(wx, wz);
      const group = new THREE.Group();
      const tall = 3 + Math.floor(rng() * 2);
      for (let t = 0; t < tall; t++) {
        const seg = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.32, 0.3), trunkMat);
        seg.position.y = 0.16 + t * 0.32;
        seg.castShadow = true;
        group.add(seg);
      }
      const canopyMat = new THREE.MeshLambertMaterial({ color: canopyHex });
      const accentMat = new THREE.MeshLambertMaterial({ color: 0xf06d9a });
      const crownY = tall * 0.32 + 0.35;
      for (let b2 = 0; b2 < 10; b2++) {
        const cube = new THREE.Mesh(
          new THREE.BoxGeometry(0.52, 0.52, 0.52),
          b2 < 8 ? canopyMat : accentMat,
        );
        cube.position.set(
          (rng() - 0.5) * 1.35,
          crownY + (rng() - 0.5) * 0.9,
          (rng() - 0.5) * 1.35,
        );
        cube.rotation.y = rng() * 0.6;
        cube.castShadow = true;
        group.add(cube);
      }
      group.scale.setScalar(scale);
      group.position.set(wx, baseY, wz);
      this.worldSurface.add(group);
      try {
        this.grid.place(`tree-${cx}-${cz}`, cx, cz, { width: 2, depth: 2 });
      } catch {
        /* ok */
      }
    };
    // scatter groves wherever the map allows — every seed forests differently
    const L3 = this.layout;
    const canopies = [0x6fc98f, 0x8fd9a8, 0x9b7bf2, 0xf06d9a, 0x6fc98f, 0x8fd9a8];
    let planted = 0;
    const treeTarget = this.layout.treeTarget;
    for (let attempt = 0; attempt < 260 && planted < treeTarget; attempt++) {
      const tx = 5 + Math.floor(rng() * (N - 12));
      const tz = 5 + Math.floor(rng() * (N - 12));
      const inPlaza = tx >= L3.plaza.x0 - 1 && tx <= L3.plaza.x1 && tz >= L3.plaza.z0 - 1 && tz <= L3.plaza.z1;
      const inCorridor = tx >= L3.corridorX0 - 1 && tx <= L3.corridorX0 + 4;
      const inPond = tx >= L3.pond.x0 - 2 && tx <= L3.pond.x0 + L3.pond.size + 1 && tz >= L3.pond.z0 - 2 && tz <= L3.pond.z0 + L3.pond.size + 1;
      const onWater = this.levels[tz * N + tx]! < 0 || this.levels[(tz + 1) * N + tx + 1]! < 0;
      if (inPlaza || inCorridor || inPond || onWater) continue;
      if (this.grid.occupantAt(tx, tz) !== undefined || this.grid.occupantAt(tx + 1, tz + 1) !== undefined) continue;
      tree(tx, tz, canopies[planted % canopies.length]!, 0.8 + rng() * 0.4);
      planted++;
    }

    // spinning crystals on pedestals — the sculpture garden, reborn
    const C = this.layout.crystalsAt;
    for (const [sx, sz, hex] of [
      [C.x + 0.2, C.z + 0.1, 0x9b7bf2],
      [C.x + 1.4, C.z + 1.7, 0x5aa4e8],
      [C.x - 0.4, C.z + 2.4, 0xf06d9a],
    ] as const) {
      const gy = this.groundHeight(sx, sz);
      const pedestal = new THREE.Mesh(
        new THREE.BoxGeometry(0.7, 0.3, 0.7),
        new THREE.MeshLambertMaterial({ color: 0xefe6d4 }),
      );
      pedestal.position.set(sx, gy + 0.15, sz);
      pedestal.castShadow = true;
      this.worldSurface.add(pedestal);
      const crystal = new THREE.Mesh(
        new THREE.OctahedronGeometry(0.42),
        new THREE.MeshLambertMaterial({ color: hex }),
      );
      crystal.position.set(sx, gy + 1.0, sz);
      crystal.userData.baseY = gy + 1.0;
      crystal.castShadow = true;
      this.worldSurface.add(crystal);
      this.crystals.push(crystal);
    }
    try {
      this.grid.place('sculpt', Math.max(4, C.x - 1), Math.max(4, C.z - 1), { width: 3, depth: 3 });
    } catch {
      /* ok */
    }

    // the approach arch — two stroke posts and a painted arc over the path
    const archMat1 = new THREE.MeshLambertMaterial({ color: 0xf06d9a });
    const archMat2 = new THREE.MeshLambertMaterial({ color: 0xf5a45c });
    const AR = this.layout;
    for (const [ax, mat] of [
      [AR.corridorX0 + 0.4, archMat1],
      [AR.corridorX0 + 3.6, archMat2],
    ] as const) {
      const post = new THREE.Mesh(new THREE.CapsuleGeometry(0.22, 2.0, 4, 10), mat);
      post.position.set(ax, 1.2, N - 10.5);
      post.castShadow = true;
      this.worldSurface.add(post);
    }
    const arc = new THREE.Mesh(
      new THREE.TorusGeometry(1.85, 0.18, 8, 24, Math.PI),
      new THREE.MeshLambertMaterial({ color: 0x9b7bf2 }),
    );
    arc.position.set(AR.corridorMid, 2.2, N - 10.5);
    arc.castShadow = true;
    this.worldSurface.add(arc);
    try {
      this.grid.place('arch-l', AR.corridorX0, N - 11, { width: 1, depth: 1 });
      this.grid.place('arch-r', AR.corridorX0 + 3, N - 11, { width: 1, depth: 1 });
    } catch {
      /* ok */
    }
  }

  /** A marbled liquid pond — the landing's fluid, poured into the ground. */
  private buildPond(): void {
    const swirlMat = new THREE.ShaderMaterial({
      uniforms: { uTime: this.swirlUniform.uTime },
      transparent: true,
      depthWrite: false,
      vertexShader: 'varying vec2 vUv; void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
      fragmentShader: SWIRL_FRAG,
    });
    swirlMat.toneMapped = false;
    const pond = new THREE.Mesh(new THREE.CircleGeometry(2.2, 48), swirlMat);
    pond.rotation.x = -Math.PI / 2;
    const pc = this.layout.pond;
    pond.position.set(pc.cx, 0.03 + this.groundHeight(pc.cx, pc.cz), pc.cz);
    this.worldSurface.add(pond);
    const rim = new THREE.Mesh(
      new THREE.TorusGeometry(2.24, 0.06, 8, 48),
      new THREE.MeshLambertMaterial({ color: INK }),
    );
    rim.rotation.x = Math.PI / 2;
    rim.position.copy(pond.position);
    this.worldSurface.add(rim);
    const rng = createRng(hashString('v8-pond'));
    for (let i = 0; i < 8; i++) {
      const a = rng() * Math.PI * 2;
      const pebble = new THREE.Mesh(
        new THREE.CapsuleGeometry(0.12 + rng() * 0.1, 0.3 + rng() * 0.5, 4, 8),
        new THREE.MeshLambertMaterial({ color: this.strokes[Math.floor(rng() * this.strokes.length)]! }),
      );
      pebble.position.set(pc.cx + Math.cos(a) * (2.6 + rng() * 0.5), 0.16, pc.cz + Math.sin(a) * (2.6 + rng() * 0.5));
      pebble.rotation.set(Math.PI / 2 + (rng() - 0.5) * 0.4, rng() * Math.PI, 0);
      pebble.castShadow = true;
      this.worldSurface.add(pebble);
    }
    try {
      this.grid.place('pond', pc.x0, pc.z0, { width: pc.size, depth: pc.size });
    } catch {
      /* ok */
    }
    for (let dz = 0; dz < pc.size; dz++) {
      for (let dx = 0; dx < pc.size; dx++) {
        this.interactCells.set(`${pc.x0 + dx},${pc.z0 + dz}`, { id: 'pond', label: 'Liquid Demo' });
      }
    }
  }

  /** Lamp posts, third design: a slim ink pillar with a FLOATING glowing
   *  lantern cube spinning above it, ringed by three orbiting mote-cubes. */
  private lampSpinners: { core: THREE.Mesh; minis: THREE.Mesh[]; baseY: number; phase: number }[] = [];

  private buildLamps(): void {
    const rng = createRng(hashString(this.seed + '-lamps'));
    const ink = new THREE.MeshLambertMaterial({ color: INK });
    const plz = this.layout.plaza;
    const cells: [number, number][] = [
      [plz.x0 + 1, plz.z0 + 1],
      [plz.x1 - 1, plz.z0 + 1],
      [plz.x0 + 1, plz.z1 - 1],
      [plz.x1 - 1, plz.z1 - 1],
    ];
    cells.forEach(([cx, cz], i) => {
      if (this.levels[cz * N + cx]! < 0) return;
      const w = cellWorld(cx, cz);
      const baseY = this.groundHeight(w.x, w.z);
      const hex = this.strokes[i % this.strokes.length]!;
      const group = new THREE.Group();
      const plinth = new THREE.Mesh(new THREE.BoxGeometry(0.46, 0.16, 0.46), ink);
      plinth.position.y = 0.08;
      group.add(plinth);
      const pillar = new THREE.Mesh(new THREE.BoxGeometry(0.14, 1.5, 0.14), ink);
      pillar.position.y = 0.91;
      pillar.castShadow = true;
      group.add(pillar);
      const tip = new THREE.Mesh(new THREE.BoxGeometry(0.22, 0.08, 0.22), ink);
      tip.position.y = 1.7;
      group.add(tip);
      // the lantern floats free above the pillar
      const coreMat = new THREE.MeshBasicMaterial({ color: hex, toneMapped: false });
      const core = new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.34, 0.34), coreMat);
      core.position.y = 2.2;
      group.add(core);
      this.lanterns.push({ mat: coreMat, hue: new THREE.Color(hex) });
      const minis: THREE.Mesh[] = [];
      for (let k = 0; k < 3; k++) {
        const mini = new THREE.Mesh(
          new THREE.BoxGeometry(0.09, 0.09, 0.09),
          new THREE.MeshBasicMaterial({ color: this.strokes[(i + k + 1) % this.strokes.length]!, toneMapped: false }),
        );
        group.add(mini);
        minis.push(mini);
      }
      group.position.set(w.x, baseY, w.z);
      this.worldSurface.add(group);
      this.lampSpinners.push({ core, minis, baseY: 2.2, phase: rng() * Math.PI * 2 });
      const light = new THREE.PointLight(hex, 8, 9, 2);
      light.position.set(w.x, baseY + 2.2, w.z);
      this.worldSurface.add(light);
      this.lampLights.push({ light, base: 8 });
      try {
        this.grid.place(`lamp-${cx}-${cz}`, cx, cz, { width: 1, depth: 1 });
      } catch {
        /* ok */
      }
    });
  }

  /** PORTAL 227  /** PORTAL 227  /** PORTAL 227 — painted arcs around a churning marble, like the hero shot. */
  private buildPortal(): void {
    const cx = this.layout.portal.wx;
    const cz = this.layout.portal.wz;
    const group = new THREE.Group();
    group.position.set(cx, this.groundHeight(cx, cz), cz);
    const rng = createRng(hashString(this.seed + '-portal'));

    const dais = new THREE.Mesh(
      new THREE.CylinderGeometry(2.2, 2.4, 0.2, 28),
      new THREE.MeshLambertMaterial({ color: 0xefe6d4 }),
    );
    dais.position.y = 0.1;
    dais.receiveShadow = true;
    group.add(dais);

    const wheel = new THREE.Group();
    wheel.position.y = 2.25;
    // the ring: overlapping painted arcs, fat and confident
    for (let i = 0; i < 11; i++) {
      const arcLen = 0.9 + rng() * 1.4;
      const start = rng() * Math.PI * 2;
      const tube = 0.12 + rng() * 0.14;
      const radius = 1.7 + (rng() - 0.5) * 0.28;
      const arc = new THREE.Mesh(
        new THREE.TorusGeometry(radius, tube, 8, 26, arcLen),
        new THREE.MeshLambertMaterial({ color: this.strokes[i % this.strokes.length]! }),
      );
      arc.rotation.z = start;
      arc.position.z = (rng() - 0.5) * 0.24;
      arc.rotation.y = (rng() - 0.5) * 0.12;
      arc.castShadow = true;
      wheel.add(arc);
    }
    // two thin ink arcs for definition
    for (let i = 0; i < 2; i++) {
      const inkArc = new THREE.Mesh(
        new THREE.TorusGeometry(1.72 + i * 0.14, 0.03, 6, 30, 1.2 + rng() * 1.2),
        new THREE.MeshBasicMaterial({ color: INK }),
      );
      inkArc.rotation.z = rng() * Math.PI * 2;
      inkArc.position.z = 0.18;
      wheel.add(inkArc);
    }
    // the churning marble inside
    const swirlMat = new THREE.ShaderMaterial({
      uniforms: { uTime: this.swirlUniform.uTime },
      transparent: true,
      depthWrite: false,
      side: THREE.DoubleSide,
      vertexShader: 'varying vec2 vUv; void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
      fragmentShader: SWIRL_FRAG,
    });
    swirlMat.toneMapped = false;
    wheel.add(new THREE.Mesh(new THREE.CircleGeometry(1.58, 56), swirlMat));
    group.add(wheel);
    this.portalWheel = wheel;

    // grass strokes at the base, like the screenshot's tufts
    for (let i = 0; i < 7; i++) {
      const a = Math.PI * (0.15 + rng() * 0.7); // front arc
      const tuft = new THREE.Mesh(
        new THREE.CapsuleGeometry(0.08 + rng() * 0.06, 0.35 + rng() * 0.4, 4, 8),
        new THREE.MeshLambertMaterial({ color: rng() < 0.75 ? 0x6fc98f : 0xf06d9a }),
      );
      tuft.position.set(Math.cos(a) * (1.9 + rng() * 0.5), 0.3, Math.sin(a) * (1.3 + rng() * 0.6));
      tuft.rotation.x = (rng() - 0.5) * 0.5;
      tuft.rotation.z = (rng() - 0.5) * 0.6;
      tuft.castShadow = true;
      group.add(tuft);
    }

    const glow = new THREE.Sprite(
      new THREE.SpriteMaterial({
        map: radialTexture('rgba(255,255,255,0.5)', 'rgba(255,255,255,0)'),
        color: 0xb9d4ec,
        transparent: true,
        opacity: 0.38,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
      }),
    );
    glow.position.y = 2.25;
    glow.scale.set(7.5, 7.5, 1);
    group.add(glow);

    this.portalParticles = new THREE.InstancedMesh(
      new THREE.SphereGeometry(0.05, 6, 4),
      new THREE.MeshBasicMaterial({ toneMapped: false }),
      36,
    );
    const pc = new THREE.Color();
    for (let i = 0; i < 36; i++) {
      pc.setHex(this.strokes[i % this.strokes.length]!);
      this.portalParticles.setColorAt(i, pc);
    }
    if (this.portalParticles.instanceColor) this.portalParticles.instanceColor.needsUpdate = true;
    group.add(this.portalParticles);

    this.portalLight = new THREE.PointLight(0xf06d9a, 13, 12, 2);
    this.portalLight.position.y = 2.3;
    group.add(this.portalLight);

    this.worldSurface.add(group);
    const pcell = this.layout.portal;
    try {
      this.grid.place('portal', pcell.cx, pcell.cz, { width: 2, depth: 2 });
    } catch {
      /* ok */
    }
    for (let dz = 0; dz < 2; dz++) {
      for (let dx = 0; dx < 2; dx++) {
        this.interactCells.set(`${pcell.cx + dx},${pcell.cz + dz}`, { id: 'portal', label: 'Portal 227' });
      }
    }
  }

  /** The queue at the portal, the village gossip circle, and the Guide. */
  private buildFolk(): void {
    const P = this.layout.portal;
    const queue: [number, number][] = (
      (
        [
          [-3, 2],
          [-4, 3],
          [-2, 4],
          [-1, 3],
          [3, 3],
          [4, 2],
          [2, 4],
        ] as [number, number][]
      ).slice(0, this.layout.queueCount)
    ).map(([ox, oz]) => [
      Math.min(26, Math.max(5, P.cx + ox)),
      Math.min(26, Math.max(5, P.cz + oz)),
    ]);
    queue.forEach(([cx, cz], i) => {
      const folk = makeVoxelFolk(this.strokes[i % this.strokes.length]!, 0.8 + (i % 3) * 0.12);
      const w = cellWorld(cx, cz);
      folk.baseY = this.groundHeight(w.x, w.z);
      folk.group.position.set(w.x, folk.baseY, w.z);
      folk.group.rotation.y = Math.atan2(P.wx - w.x, P.wz - w.z);
      this.worldSurface.add(folk.group);
      this.folk.push(folk);
      try {
        this.grid.place(`queue-${cx}-${cz}`, cx, cz, { width: 1, depth: 1 });
      } catch {
        /* ok */
      }
      this.interactCells.set(`${cx},${cz}`, { id: 'queue', label: 'The Queue' });
    });
    // gossip circle, south-east
    const V = this.layout.village;
    const circle: [number, number][] = (
      [
        [V.x, V.z],
        [Math.min(26, V.x + 1), V.z + 1],
        [Math.max(5, V.x - 1), V.z + 1],
        [V.x, V.z + 2],
      ] as [number, number][]
    ).slice(0, this.layout.villageCount);
    circle.forEach(([cx, cz], i) => {
      const folk = makeVoxelFolk(this.strokes[(i + 2) % this.strokes.length]!, 0.85 + i * 0.1);
      const w = cellWorld(cx, cz);
      folk.baseY = this.groundHeight(w.x, w.z);
      folk.group.position.set(w.x, folk.baseY, w.z);
      folk.group.rotation.y = Math.atan2(V.x + 0.3 - w.x, V.z + 0.8 - w.z) + Math.PI;
      this.worldSurface.add(folk.group);
      this.folk.push(folk);
      try {
        this.grid.place(`villager-${cx}-${cz}`, cx, cz, { width: 1, depth: 1 });
      } catch {
        /* ok */
      }
      this.interactCells.set(`${cx},${cz}`, { id: 'village', label: 'Locals' });
    });
    // the Guide, flag and all
    const guide = makeVoxelFolk(0xf5a45c, 1.05);
    const flagPole = new THREE.Mesh(
      new THREE.CylinderGeometry(0.025, 0.025, 1.5, 6),
      new THREE.MeshLambertMaterial({ color: INK }),
    );
    flagPole.position.set(0.34, 1.15, 0);
    guide.group.add(flagPole);
    const flag = new THREE.Mesh(
      new THREE.BoxGeometry(0.42, 0.28, 0.02),
      new THREE.MeshLambertMaterial({ color: 0xf06d9a, side: THREE.DoubleSide }),
    );
    flag.position.set(0.56, 1.75, 0);
    guide.group.add(flag);
    const gw = cellWorld(this.layout.guide.x, this.layout.guide.z);
    guide.baseY = this.groundHeight(gw.x, gw.z);
    guide.group.position.set(gw.x, guide.baseY, gw.z);
    this.worldSurface.add(guide.group);
    this.guide = guide;
    this.folk.push(guide);
    try {
      this.grid.place('guide', this.layout.guide.x, this.layout.guide.z, { width: 1, depth: 1 });
    } catch {
      /* ok */
    }
    this.interactCells.set(`${this.layout.guide.x},${this.layout.guide.z}`, { id: 'guide', label: 'The Guide' });
  }

  // ---------- outer world: see outerWorld.ts ----------
  private buildFarShapes(): void {
    buildOuterWorld({
      seed: this.seed,
      layout: this.layout,
      strokes: this.strokes,
      noise: { a: this.noiseA, b: this.noiseB, c: this.noiseC, d: this.noiseD },
      worldSurface: this.worldSurface,
    });
  }

  // ---------- landmarks: the quest furniture ----------
  private placeLandmark(kind: string, label: string, cx: number, cz: number): boolean {
    if (cx < 4 || cz < 4 || cx >= N - 4 || cz >= N - 4) return false;
    if (this.levels[cz * N + cx]! < 0) return false;
    if (this.grid.occupantAt(cx, cz) !== undefined) return false;
    try {
      this.grid.place(`lm-${kind}-${cx}-${cz}`, cx, cz, { width: 1, depth: 1 });
    } catch {
      return false;
    }
    this.interactCells.set(`${cx},${cz}`, { id: kind, label });
    this.landmarks.push({ kind, x: cx, z: cz });
    return true;
  }

  private buildLandmarks(): void {
    const rng = createRng(hashString(this.seed + '-landmarks'));
    const L = this.layout;
    const tryPlace = (
      kind: string,
      label: string,
      build: (w: { x: number; z: number }, y: number) => void,
      pred?: (cx: number, cz: number) => boolean,
    ): boolean => {
      for (let t = 0; t < 90; t++) {
        const cx = 5 + Math.floor(rng() * (N - 11));
        const cz = 5 + Math.floor(rng() * (N - 11));
        if (pred && !pred(cx, cz)) continue;
        if (this.placeLandmark(kind, label, cx, cz)) {
          const w = cellWorld(cx, cz);
          build(w, this.groundHeight(w.x, w.z));
          return true;
        }
      }
      return false;
    };
    const high = (lvl: number) => (cx: number, cz: number): boolean => this.levels[cz * N + cx]! >= lvl;
    const farFromPortal = (cx: number, cz: number): boolean =>
      Math.hypot(cx - L.portal.wx, cz - L.portal.wz) > N * 0.32;

    const campCx = Math.min(N - 6, Math.max(5, L.village.x - 2));
    if (this.placeLandmark('camp', 'Campfire', campCx, L.village.z)) {
      const w = cellWorld(campCx, L.village.z);
      this.buildCampfire(w, this.groundHeight(w.x, w.z));
    }
    tryPlace('chest', 'Lost Chest', (w, y) => this.buildChest(w, y), farFromPortal);
    this.buildSignpost();

    const arch = L.archetype;
    if (arch === 'canyon') {
      tryPlace('tower', 'Watchtower', (w, y) => this.buildTower(w, y), high(2));
      tryPlace('tower', 'Watchtower', (w, y) => this.buildTower(w, y), high(2));
    } else if (arch === 'mesa') {
      tryPlace('stone', 'Standing Stone', (w, y) => this.buildObelisk(w, y), high(3));
      tryPlace('stone', 'Standing Stone', (w, y) => this.buildObelisk(w, y), high(2));
      tryPlace('tower', 'Watchtower', (w, y) => this.buildTower(w, y), high(2));
    } else if (arch === 'garden') {
      tryPlace('circle', 'Stone Circle', (w, y) => this.buildCircle(w, y));
      for (let b = 0; b < 3; b++) tryPlace('bush', 'Berry Bush', (w, y) => this.buildBush(w, y));
    } else if (arch === 'lakes') {
      tryPlace('circle', 'Stone Circle', (w, y) => this.buildCircle(w, y));
      tryPlace('stone', 'Standing Stone', (w, y) => this.buildObelisk(w, y));
    } else {
      tryPlace('stone', 'Standing Stone', (w, y) => this.buildObelisk(w, y));
      for (let b = 0; b < 2; b++) tryPlace('bush', 'Berry Bush', (w, y) => this.buildBush(w, y));
      if (rng() < 0.5) tryPlace('tower', 'Watchtower', (w, y) => this.buildTower(w, y), high(1));
    }
  }

  private buildObelisk(w: { x: number; z: number }, y: number): void {
    const stone = new THREE.Mesh(
      new THREE.BoxGeometry(0.5, 2.3, 0.5),
      new THREE.MeshLambertMaterial({ color: INK }),
    );
    stone.position.set(w.x, y + 1.15, w.z);
    stone.rotation.y = 0.5;
    stone.rotation.z = 0.04;
    stone.castShadow = true;
    this.worldSurface.add(stone);
    const rune = new THREE.Mesh(
      new THREE.BoxGeometry(0.22, 0.22, 0.06),
      new THREE.MeshBasicMaterial({ color: this.strokes[2]!, toneMapped: false }),
    );
    rune.position.set(w.x, y + 1.5, w.z + 0.26);
    rune.rotation.y = 0.5;
    this.worldSurface.add(rune);
  }

  private buildTower(w: { x: number; z: number }, y: number): void {
    const cream = new THREE.MeshLambertMaterial({ color: 0xefe6d4 });
    let size = 0.9;
    let ty = y;
    for (let t = 0; t < 4; t++) {
      const block = new THREE.Mesh(new THREE.BoxGeometry(size, 0.55, size), cream);
      block.position.set(w.x, ty + 0.275, w.z);
      block.rotation.y = t * 0.18;
      block.castShadow = true;
      this.worldSurface.add(block);
      ty += 0.55;
      size *= 0.82;
    }
    const deck = new THREE.Mesh(new THREE.BoxGeometry(0.95, 0.1, 0.95), new THREE.MeshLambertMaterial({ color: INK }));
    deck.position.set(w.x, ty + 0.05, w.z);
    this.worldSurface.add(deck);
    const beacon = new THREE.Mesh(
      new THREE.BoxGeometry(0.26, 0.26, 0.26),
      new THREE.MeshBasicMaterial({ color: this.strokes[3]!, toneMapped: false }),
    );
    beacon.position.set(w.x, ty + 0.3, w.z);
    this.worldSurface.add(beacon);
    const light = new THREE.PointLight(this.strokes[3]!, 6, 8, 2);
    light.position.set(w.x, ty + 0.4, w.z);
    this.worldSurface.add(light);
    this.lampLights.push({ light, base: 6 });
  }

  private buildCampfire(w: { x: number; z: number }, y: number): void {
    const wood = new THREE.MeshLambertMaterial({ color: 0xd9b98c });
    for (let i = 0; i < 3; i++) {
      const log = new THREE.Mesh(new THREE.BoxGeometry(0.7, 0.14, 0.14), wood);
      log.position.set(w.x, y + 0.08, w.z);
      log.rotation.y = (i / 3) * Math.PI;
      this.worldSurface.add(log);
    }
    const flameMat = new THREE.MeshBasicMaterial({ color: 0xff9a2e, toneMapped: false });
    const flame = new THREE.Mesh(new THREE.BoxGeometry(0.24, 0.34, 0.24), flameMat);
    flame.position.set(w.x, y + 0.32, w.z);
    flame.rotation.y = 0.6;
    this.worldSurface.add(flame);
    this.lanterns.push({ mat: flameMat, hue: new THREE.Color(0xff9a2e) });
    const light = new THREE.PointLight(0xff9a2e, 9, 7, 2);
    light.position.set(w.x, y + 0.7, w.z);
    this.worldSurface.add(light);
    this.lampLights.push({ light, base: 9 });
  }

  private buildChest(w: { x: number; z: number }, y: number): void {
    const box = new THREE.Mesh(
      new THREE.BoxGeometry(0.52, 0.3, 0.4),
      new THREE.MeshLambertMaterial({ color: 0xd9b98c }),
    );
    box.position.set(w.x, y + 0.15, w.z);
    box.rotation.y = 0.4;
    box.castShadow = true;
    this.worldSurface.add(box);
    this.chestLid = new THREE.Mesh(
      new THREE.BoxGeometry(0.54, 0.12, 0.42),
      new THREE.MeshLambertMaterial({ color: INK }),
    );
    this.chestLid.position.set(w.x, y + 0.36, w.z);
    this.chestLid.rotation.y = 0.4;
    this.worldSurface.add(this.chestLid);
    const lock = new THREE.Mesh(
      new THREE.BoxGeometry(0.09, 0.09, 0.05),
      new THREE.MeshBasicMaterial({ color: this.strokes[1]!, toneMapped: false }),
    );
    lock.position.set(w.x + Math.sin(0.4) * 0.2, y + 0.3, w.z + Math.cos(0.4) * 0.2);
    this.worldSurface.add(lock);
  }

  private buildCircle(w: { x: number; z: number }, y: number): void {
    const ink = new THREE.MeshLambertMaterial({ color: INK });
    for (let i = 0; i < 6; i++) {
      const a = (i / 6) * Math.PI * 2;
      const slab = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.9 + (i % 2) * 0.3, 0.46), ink);
      slab.position.set(w.x + Math.cos(a) * 1.5, y + 0.5, w.z + Math.sin(a) * 1.5);
      slab.rotation.y = -a;
      slab.castShadow = true;
      this.worldSurface.add(slab);
    }
    const cap = new THREE.Mesh(
      new THREE.BoxGeometry(0.9, 0.08, 0.9),
      new THREE.MeshLambertMaterial({ color: this.strokes[0]! }),
    );
    cap.position.set(w.x, y + 0.04, w.z);
    this.worldSurface.add(cap);
  }

  private buildBush(w: { x: number; z: number }, y: number): void {
    const leaf = new THREE.MeshLambertMaterial({ color: 0x6fc98f });
    for (let i = 0; i < 3; i++) {
      const cube = new THREE.Mesh(new THREE.BoxGeometry(0.4, 0.36, 0.4), leaf);
      cube.position.set(w.x + (i - 1) * 0.24, y + 0.2 + (i % 2) * 0.12, w.z + ((i * 7) % 3 - 1) * 0.16);
      cube.rotation.y = i * 0.5;
      cube.castShadow = true;
      this.worldSurface.add(cube);
    }
    for (let i = 0; i < 3; i++) {
      const berry = new THREE.Mesh(
        new THREE.BoxGeometry(0.1, 0.1, 0.1),
        new THREE.MeshBasicMaterial({ color: this.strokes[(i + 1) % this.strokes.length]!, toneMapped: false }),
      );
      berry.position.set(w.x + (i - 1) * 0.2, y + 0.45 + (i % 2) * 0.1, w.z + 0.14);
      this.worldSurface.add(berry);
    }
  }

  private buildSignpost(): void {
    const L = this.layout;
    const x = L.corridorX0 - 0.6;
    const z = N - 5.2;
    const y = this.groundHeight(x, z);
    const pole = new THREE.Mesh(
      new THREE.BoxGeometry(0.1, 1.6, 0.1),
      new THREE.MeshLambertMaterial({ color: INK }),
    );
    pole.position.set(x, y + 0.8, z);
    this.worldSurface.add(pole);
    for (let i = 0; i < 2; i++) {
      const board = new THREE.Mesh(
        new THREE.BoxGeometry(0.7, 0.16, 0.05),
        new THREE.MeshLambertMaterial({ color: this.strokes[i]! }),
      );
      board.position.set(x + 0.18, y + 1.2 - i * 0.26, z);
      board.rotation.y = -0.4 + i * 0.9;
      this.worldSurface.add(board);
    }
  }

  // ---------- buildings: see buildings.ts ----------
  private buildBuildings(): void {
    buildSettlement({
      seed: this.seed,
      layout: this.layout,
      strokes: this.strokes,
      levels: this.levels,
      bridgeSet: this.bridgeSet,
      caveMask: this.caveMask,
      roomMask: this.roomMask,
      caveFloorH: this.caveFloorH,
      entranceSet: this.entranceSet,
      grid: this.grid,
      worldSurface: this.worldSurface,
      caveGroup: this.caveGroup,
      interactCells: this.interactCells,
      landmarks: this.landmarks,
      lanterns: this.lanterns,
      interiorLights: this.interiorLights,
      buildingRects: this.buildingRects,
      folk: this.folk,
    });
  }

  // ---------- caves: the world under the blocks ----------
  private buildCaves(): void {
    const rng = createRng(hashString(this.seed + '-caves'));
    const L = this.layout;
    this.hasCaves = L.archetype === 'canyon' || L.archetype === 'mesa' || rng() < 0.6;
    const sealUnderground = (): void => {
      for (let z = 0; z < N; z++) {
        for (let x = 0; x < N; x++) {
          if (this.caveMask[z * N + x] === 1) continue; // house rooms stay open
          try {
            this.caveGrid.place(`cw-${x}-${z}`, x, z, { width: 1, depth: 1 });
          } catch {
            /* claimed */
          }
        }
      }
    };
    if (!this.hasCaves) {
      sealUnderground();
      this.renderUnderground(rng);
      return;
    }

    // 1. cave mouths: free surface cells, mountainsides preferred, spread out
    const mouths: { x: number; z: number }[] = [];
    const mouthOk = (cx: number, cz: number): boolean =>
      cx >= 6 &&
      cz >= 6 &&
      cx < N - 6 &&
      cz < N - 6 &&
      this.levels[cz * N + cx]! >= 0 &&
      this.grid.occupantAt(cx, cz) === undefined &&
      !this.entranceSet.has(`${cx},${cz}`) &&
      mouths.every((mo) => Math.hypot(mo.x - cx, mo.z - cz) > N * 0.28);
    const wantMouths = 2 + (rng() < 0.5 ? 1 : 0);
    for (let pass = 0; pass < 2 && mouths.length < wantMouths; pass++) {
      for (let t = 0; t < 160 && mouths.length < wantMouths; t++) {
        const cx = 6 + Math.floor(rng() * (N - 12));
        const cz = 6 + Math.floor(rng() * (N - 12));
        if (!mouthOk(cx, cz)) continue;
        if (pass === 0 && this.levels[cz * N + cx]! < 1) continue;
        mouths.push({ x: cx, z: cz });
      }
    }
    if (mouths.length < 2) {
      this.hasCaves = false;
      sealUnderground();
      this.renderUnderground(rng);
      return;
    }

    // 2. carve drunken tunnels between mouths, blow chambers along the way
    const carve = (cx: number, cz: number): void => {
      if (cx < 4 || cz < 4 || cx >= N - 4 || cz >= N - 4) return;
      if (this.levels[cz * N + cx]! < 0) return;
      if (this.roomMask[cz * N + cx] === 1) return; // not through the parlour
      this.caveMask[cz * N + cx] = 1;
    };
    const chamber = (cx: number, cz: number, r: number): void => {
      for (let dz = -Math.ceil(r); dz <= r; dz++) {
        for (let dx = -Math.ceil(r); dx <= r; dx++) {
          if (Math.hypot(dx, dz) <= r) carve(cx + dx, cz + dz);
        }
      }
    };
    for (let mi = 0; mi < mouths.length; mi++) {
      const from = mouths[mi]!;
      const to = mouths[(mi + 1) % mouths.length]!;
      let x = from.x;
      let z = from.z;
      let guard = 0;
      while ((x !== to.x || z !== to.z) && guard++ < 400) {
        carve(x, z);
        if (rng() < 0.3) carve(x + (rng() < 0.5 ? 1 : -1), z);
        if (rng() < 0.3) carve(x, z + (rng() < 0.5 ? 1 : -1));
        if (rng() < 0.62) {
          if (Math.abs(to.x - x) > Math.abs(to.z - z)) x += Math.sign(to.x - x);
          else z += Math.sign(to.z - z);
        } else {
          if (rng() < 0.5) x += rng() < 0.5 ? 1 : -1;
          else z += rng() < 0.5 ? 1 : -1;
        }
        x = Math.min(N - 5, Math.max(4, x));
        z = Math.min(N - 5, Math.max(4, z));
        if (guard % 60 === 30) chamber(x, z, 1.6 + rng() * 1.2);
      }
      chamber(to.x, to.z, 1.4);
      chamber(from.x, from.z, 1.4);
    }
    chamber(
      Math.round((mouths[0]!.x + mouths[1]!.x) / 2),
      Math.round((mouths[0]!.z + mouths[1]!.z) / 2),
      2.2 + rng() * 1.2,
    );

    // 3. cave grid: everything not carved is rock
    for (let z = 0; z < N; z++) {
      for (let x = 0; x < N; x++) {
        if (this.caveMask[z * N + x] === 0) {
          try {
            this.caveGrid.place(`cw-${x}-${z}`, x, z, { width: 1, depth: 1 });
          } catch {
            /* claimed */
          }
        }
      }
    }
    for (const mo of mouths) this.entranceSet.add(`${mo.x},${mo.z}`);

    // seamless descent: near a mouth the cave floor climbs to the surface —
    // you WALK down into the earth, nothing drops
    for (let z = 0; z < N; z++) {
      for (let x = 0; x < N; x++) {
        if (this.caveMask[z * N + x] === 0) continue;
        if (this.roomMask[z * N + x] === 1) continue; // rooms keep their floor
        let h = CAVE_FLOOR;
        for (const mo of mouths) {
          const d = Math.hypot(mo.x - x, mo.z - z);
          if (d < 4.2) {
            const surfY = this.levels[mo.z * N + mo.x]! * 0.5;
            h = Math.max(h, surfY + (CAVE_FLOOR - surfY) * (d / 4.2));
          }
        }
        this.caveFloorH[z * N + x] = h;
      }
    }

    const floorCells = this.renderUnderground(rng);

    // glowing veins (never inside a house)
    let lit = 0;
    for (let t = 0; t < 16 && floorCells.length > 0; t++) {
      const cell = floorCells[Math.floor(rng() * floorCells.length)]!;
      if (this.roomMask[cell.z * N + cell.x] === 1) continue;
      const hex = this.strokes[Math.floor(rng() * this.strokes.length)]!;
      const shard = new THREE.Mesh(
        new THREE.OctahedronGeometry(0.16 + rng() * 0.14),
        new THREE.MeshBasicMaterial({ color: hex, toneMapped: false }),
      );
      shard.position.set(
        cell.x + 0.2 + rng() * 0.6,
        this.caveFloorH[cell.z * N + cell.x]! + 0.16,
        cell.z + 0.2 + rng() * 0.6,
      );
      shard.rotation.y = rng() * Math.PI;
      this.caveGroup.add(shard);
      if (lit < 11 && rng() < 0.75) {
        const light = new THREE.PointLight(hex, 12, 11, 2);
        light.position.set(shard.position.x, shard.position.y + 0.75, shard.position.z);
        this.caveGroup.add(light);
        lit++;
      }
    }

    // the geode: farthest treasure from any mouth
    let best: { x: number; z: number } | null = null;
    let bestD = -1;
    for (const cell of floorCells) {
      if (this.roomMask[cell.z * N + cell.x] === 1) continue;
      const d = Math.min(...mouths.map((mo) => Math.hypot(mo.x - cell.x, mo.z - cell.z)));
      if (d > bestD) {
        bestD = d;
        best = cell;
      }
    }
    if (best) {
      for (let g = 0; g < 5; g++) {
        const shard = new THREE.Mesh(
          new THREE.OctahedronGeometry(0.2 + rng() * 0.22),
          new THREE.MeshBasicMaterial({ color: this.strokes[g % this.strokes.length]!, toneMapped: false }),
        );
        shard.position.set(
          best.x + 0.5 + Math.cos(g * 1.7) * 0.35,
          this.caveFloorH[best.z * N + best.x]! + 0.2 + (g % 2) * 0.18,
          best.z + 0.5 + Math.sin(g * 1.7) * 0.35,
        );
        this.caveGroup.add(shard);
      }
      const light = new THREE.PointLight(this.strokes[0]!, 22, 13, 2);
      light.position.set(best.x + 0.5, this.caveFloorH[best.z * N + best.x]! + 1.1, best.z + 0.5);
      this.caveGroup.add(light);
      this.interactCells.set(`c:${best.x},${best.z}`, { id: 'geode', label: 'Glowing Geode' });
      this.landmarks.push({ kind: 'geode', x: best.x, z: best.z });
    }

    // entrance furniture: rock mound wrapping the mouth, dark arch facing
    // the approach — a hill you walk INTO
    const rock = new THREE.MeshLambertMaterial({ color: 0x8b8b96 });
    const rockDark = new THREE.MeshLambertMaterial({ color: 0x6e6e7c });
    for (const mo of mouths) {
      const w = cellWorld(mo.x, mo.z);
      const y = this.levels[mo.z * N + mo.x]! * 0.5;
      let bestDir: [number, number] = [0, 1];
      let bestScore = Infinity;
      for (const [dx, dz] of [
        [0, 1],
        [0, -1],
        [1, 0],
        [-1, 0],
      ] as const) {
        const ax = mo.x + dx;
        const az = mo.z + dz;
        if (ax < 1 || az < 1 || ax >= N - 1 || az >= N - 1) continue;
        if (this.grid.occupantAt(ax, az) !== undefined) continue;
        const lv = this.levels[az * N + ax]!;
        if (lv >= 0 && lv < bestScore) {
          bestScore = lv;
          bestDir = [dx, dz];
        }
      }
      const [fx, fz] = bestDir;
      for (const [dx, dz] of [
        [-fx, -fz],
        [fz, fx],
        [-fz, -fx],
        [fz - fx, fx - fz],
        [-fz - fx, -fx - fz],
      ] as const) {
        const cxr = mo.x + dx;
        const czr = mo.z + dz;
        if (cxr < 1 || czr < 1 || cxr >= N - 1 || czr >= N - 1) continue;
        try {
          this.grid.place(`mound-${cxr}-${czr}`, cxr, czr, { width: 1, depth: 1 });
        } catch {
          continue;
        }
        const tall = dx === -fx && dz === -fz ? 3 : 2;
        const baseLvl = Math.max(0, this.levels[czr * N + cxr]!) * 0.5;
        for (let hh = 0; hh < tall; hh++) {
          const block = new THREE.Mesh(
            new THREE.BoxGeometry(0.98 - hh * 0.08, 0.5, 0.98 - hh * 0.08),
            hh % 2 === 0 ? rock : rockDark,
          );
          block.position.set(cxr + 0.5, baseLvl + 0.25 + hh * 0.5, czr + 0.5);
          block.rotation.y = (hh + cxr + czr) * 0.12;
          block.castShadow = true;
          this.worldSurface.add(block);
        }
      }
      for (const side of [-1, 1]) {
        const cheek = new THREE.Mesh(new THREE.BoxGeometry(0.3, 1.3, 0.3), rockDark);
        cheek.position.set(w.x + fz * side * 0.42, y + 0.65, w.z + fx * side * 0.42);
        this.worldSurface.add(cheek);
      }
      const lintel = new THREE.Mesh(
        new THREE.BoxGeometry(Math.abs(fz) * 1.1 + 0.3, 0.34, Math.abs(fx) * 1.1 + 0.3),
        rock,
      );
      lintel.position.set(w.x, y + 1.42, w.z);
      lintel.castShadow = true;
      this.worldSurface.add(lintel);
      const dark = new THREE.Mesh(
        new THREE.BoxGeometry(Math.abs(fz) * 0.84 + 0.5, 1.24, Math.abs(fx) * 0.84 + 0.5),
        new THREE.MeshBasicMaterial({ color: 0x07060e }),
      );
      dark.position.set(w.x - fx * 0.18, y + 0.62, w.z - fz * 0.18);
      this.worldSurface.add(dark);
      const lamp = new THREE.Mesh(
        new THREE.BoxGeometry(0.16, 0.16, 0.16),
        new THREE.MeshBasicMaterial({ color: this.strokes[4]!, toneMapped: false }),
      );
      lamp.position.set(w.x + fx * 0.5, y + 1.66, w.z + fz * 0.5);
      this.worldSurface.add(lamp);
      const exitGlow = new THREE.Mesh(
        new THREE.BoxGeometry(0.2, 0.2, 0.2),
        new THREE.MeshBasicMaterial({ color: this.strokes[4]!, toneMapped: false }),
      );
      exitGlow.position.set(w.x, CAVE_FLOOR + 1.7, w.z);
      this.caveGroup.add(exitGlow);
      const exitLight = new THREE.PointLight(this.strokes[4]!, 14, 11, 2);
      exitLight.position.set(w.x, CAVE_FLOOR + 1.4, w.z);
      this.caveGroup.add(exitLight);
    }
  }

  /** Render every underground cell: cave rock or house room, one mesh set. */
  private renderUnderground(rng: () => number): { x: number; z: number }[] {
    const floorCells: { x: number; z: number }[] = [];
    for (let z = 0; z < N; z++) {
      for (let x = 0; x < N; x++) {
        if (this.caveMask[z * N + x] === 1) floorCells.push({ x, z });
      }
    }
    if (floorCells.length === 0) return floorCells;
    const floorGeo = new THREE.BoxGeometry(1, 0.5, 1);
    this.caveFloor = new THREE.InstancedMesh(
      floorGeo,
      new THREE.MeshLambertMaterial({ color: 0xffffff }),
      floorCells.length,
    );
    const m = new THREE.Matrix4();
    const tint = new THREE.Color();
    floorCells.forEach((cell, i) => {
      const idx = cell.z * N + cell.x;
      m.makeTranslation(cell.x + 0.5, this.caveFloorH[idx]! - 0.25, cell.z + 0.5);
      this.caveFloor!.setMatrixAt(i, m);
      if (this.roomMask[idx] === 1) {
        tint.setHex(0xcaa26c).offsetHSL(0, 0, (rng() - 0.5) * 0.05); // house wood
      } else {
        tint.setHex(0x2c3350).offsetHSL((rng() - 0.5) * 0.04, 0, (rng() - 0.5) * 0.05);
      }
      this.caveFloor!.setColorAt(i, tint);
    });
    this.caveFloor.instanceMatrix.needsUpdate = true;
    if (this.caveFloor.instanceColor) this.caveFloor.instanceColor.needsUpdate = true;
    this.caveFloor.receiveShadow = true;
    this.caveGroup.add(this.caveFloor);

    const wallSet = new Set<string>();
    for (const cell of floorCells) {
      for (const [dx, dz] of [
        [1, 0],
        [-1, 0],
        [0, 1],
        [0, -1],
      ] as const) {
        const nx = cell.x + dx;
        const nz = cell.z + dz;
        if (nx < 0 || nz < 0 || nx >= N || nz >= N) continue;
        if (this.caveMask[nz * N + nx] === 0) wallSet.add(`${nx},${nz}`);
      }
    }
    const walls = [...wallSet];
    const wallMesh = new THREE.InstancedMesh(
      new THREE.BoxGeometry(1, 2.2, 1),
      new THREE.MeshLambertMaterial({ color: 0xffffff }),
      walls.length,
    );
    walls.forEach((key, i) => {
      const [wx, wz] = key.split(',').map(Number) as [number, number];
      let base = CAVE_FLOOR;
      let nextToRoom = false;
      for (const [dx, dz] of [
        [1, 0],
        [-1, 0],
        [0, 1],
        [0, -1],
      ] as const) {
        const ax = wx + dx;
        const az = wz + dz;
        if (ax < 0 || az < 0 || ax >= N || az >= N) continue;
        if (this.caveMask[az * N + ax] === 1) {
          base = Math.max(base, this.caveFloorH[az * N + ax]!);
          if (this.roomMask[az * N + ax] === 1) nextToRoom = true;
        }
      }
      m.makeTranslation(wx + 0.5, base - 0.2 + 1.1, wz + 0.5);
      wallMesh.setMatrixAt(i, m);
      if (nextToRoom) {
        tint.setHex(0xeadfc6).offsetHSL(0, 0, (rng() - 0.5) * 0.04); // plaster
      } else {
        tint.setHex(0x1d2338).offsetHSL(0, 0, (rng() - 0.5) * 0.05);
      }
      wallMesh.setColorAt(i, tint);
    });
    wallMesh.instanceMatrix.needsUpdate = true;
    if (wallMesh.instanceColor) wallMesh.instanceColor.needsUpdate = true;
    this.caveGroup.add(wallMesh);

    const under = new THREE.Mesh(
      new THREE.PlaneGeometry(300, 300),
      new THREE.MeshBasicMaterial({ color: 0x07060e }),
    );
    under.rotation.x = -Math.PI / 2;
    under.position.set(N / 2, CAVE_FLOOR - 0.6, N / 2);
    this.caveGroup.add(under);

    // the ceiling: downward-facing planes — looking up shows rock (or beams),
    // while the camera above sees straight through (backface culled)
    const ceilGeo = new THREE.PlaneGeometry(1.02, 1.02);
    ceilGeo.rotateX(Math.PI / 2); // normal points down
    const ceiling = new THREE.InstancedMesh(
      ceilGeo,
      new THREE.MeshLambertMaterial({ color: 0xffffff }),
      floorCells.length,
    );
    floorCells.forEach((cell, i) => {
      const idx = cell.z * N + cell.x;
      m.makeTranslation(cell.x + 0.5, this.caveFloorH[idx]! + 2.0, cell.z + 0.5);
      ceiling.setMatrixAt(i, m);
      if (this.roomMask[idx] === 1) {
        tint.setHex(0x9a7a50).offsetHSL(0, 0, (rng() - 0.5) * 0.04); // wooden beams
      } else {
        tint.setHex(0x141a2c).offsetHSL(0, 0, (rng() - 0.5) * 0.03); // rock above
      }
      ceiling.setColorAt(i, tint);
    });
    ceiling.instanceMatrix.needsUpdate = true;
    if (ceiling.instanceColor) ceiling.instanceColor.needsUpdate = true;
    this.caveGroup.add(ceiling);
    return floorCells;
  }

  /**
   * The complete machine-readable world: every rendered gameplay entity as JSON.
   * NPCs carry alive:true; multi-cell occupants collapse to one entity with a
   * footprint rect in meta. Pure decor (flowers, turf, clouds, sky islands,
   * outer wilderness) is intentionally absent — if it matters to the game, it
   * must be an entity, and everything that is an entity is on the map.
   */
  exportWorld(): WorldManifest {
    const entities: WorldEntity[] = [];
    // footprints: one bbox per unique occupant id from the walkability grid
    const boxes = new Map<string, { x0: number; z0: number; x1: number; z1: number }>();
    for (let z = 0; z < N; z++) {
      for (let x = 0; x < N; x++) {
        const id = this.grid.occupantAt(x, z);
        if (id === undefined) continue;
        const b = boxes.get(id);
        if (!b) boxes.set(id, { x0: x, z0: z, x1: x, z1: z });
        else {
          b.x0 = Math.min(b.x0, x);
          b.z0 = Math.min(b.z0, z);
          b.x1 = Math.max(b.x1, x);
          b.z1 = Math.max(b.z1, z);
        }
      }
    }
    const isInteractive = (b: { x0: number; z0: number; x1: number; z1: number }): boolean => {
      for (let z = b.z0 - 1; z <= b.z1 + 1; z++)
        for (let x = b.x0 - 1; x <= b.x1 + 1; x++)
          if (this.interactCells.has(`${x},${z}`)) return true;
      return false;
    };
    const add = (
      id: string,
      kind: string,
      category: WorldEntity['category'],
      b: { x0: number; z0: number; x1: number; z1: number },
      opts: Partial<WorldEntity> = {},
    ): void => {
      const multi = b.x1 > b.x0 || b.z1 > b.z0;
      entities.push({
        id,
        kind,
        category,
        x: Math.round((b.x0 + b.x1) / 2),
        z: Math.round((b.z0 + b.z1) / 2),
        layer: 'surface',
        alive: false,
        solid: true,
        interactive: isInteractive(b),
        source: 'generated',
        ...(multi ? { meta: { footprint: { ...b }, ...(opts.meta ?? {}) } } : {}),
        ...opts,
      });
    };
    for (const [id, b] of boxes) {
      if (
        id.startsWith('hedge-') ||
        id.startsWith('water-') ||
        id.startsWith('edit-water-') ||
        id.startsWith('house-')
      )
        continue; // terrain: hedges/water live in levels, house cells in buildings below
      if (id.startsWith('tree-')) add(id, 'tree', 'nature', b);
      else if (id.startsWith('mound-')) add(id, 'rock', 'nature', b);
      else if (id.startsWith('lamp-')) add(id, 'lamp', 'object', b);
      else if (id === 'sculpt') add(id, 'crystal-cluster', 'object', b);
      else if (id === 'arch-l' || id === 'arch-r') add(id, 'gate-arch', 'object', b);
      else if (id === 'pond') add(id, 'pond', 'terrain', b, { solid: false });
      else if (id === 'portal') add(id, 'portal', 'portal', b);
      else if (id === 'guide') add(id, 'guide', 'npc', b, { alive: true });
      else if (id.startsWith('queue-')) add(id, 'onlooker', 'npc', b, { alive: true });
      else if (id.startsWith('villager-')) add(id, 'villager', 'npc', b, { alive: true });
      else if (id.startsWith('lm-')) {
        const kind = id.slice(3, id.indexOf('-', 3));
        add(id, kind, 'object', b);
      } else add(id, id, 'object', b);
    }
    // buildings: rect + typed kind + door; interiors live on the cave layer
    const doorKeys = new Set<string>();
    for (let bi = 0; bi < this.buildingRects.length; bi++) {
      const r = this.buildingRects[bi]!;
      if (r.doorX !== undefined) doorKeys.add(`${r.doorX},${r.doorZ}`);
      entities.push({
        id: `building-${bi}`,
        kind: r.kind ?? 'building',
        category: 'building',
        x: r.doorX ?? Math.round((r.x0 + r.x1) / 2),
        z: r.doorZ ?? Math.round((r.z0 + r.z1) / 2),
        layer: 'surface',
        alive: false,
        solid: true,
        interactive: true,
        source: 'generated',
        meta: { footprint: { x0: r.x0, z0: r.z0, x1: r.x1, z1: r.z1 }, door: { x: r.doorX, z: r.doorZ }, interiorLayer: 'cave' },
      });
      if (r.kind === 'tavern') {
        const lm = this.landmarks.find((l) => l.kind === 'tavern');
        entities.push({
          id: `keeper-${bi}`,
          kind: 'keeper',
          category: 'npc',
          x: lm ? lm.x : Math.round((r.x0 + r.x1) / 2),
          z: lm ? lm.z : Math.round((r.z0 + r.z1) / 2),
          layer: 'cave',
          alive: true,
          solid: false,
          interactive: true,
          source: 'generated',
        });
      }
    }
    // cave mouths: entrances that are not building doors
    let mi = 0;
    for (const key of this.entranceSet) {
      if (doorKeys.has(key)) continue;
      const [mx, mz] = key.split(',').map(Number);
      entities.push({
        id: `cave-mouth-${mi++}`,
        kind: 'cave-mouth',
        category: 'entrance',
        x: mx!,
        z: mz!,
        layer: 'surface',
        alive: false,
        solid: false,
        interactive: true,
        source: 'generated',
      });
    }
    // cave-layer landmarks (geode) — placed without a surface grid claim
    for (const lm of this.landmarks) {
      if (lm.kind !== 'geode') continue;
      entities.push({
        id: `geode-${lm.x}-${lm.z}`,
        kind: 'geode',
        category: 'object',
        x: lm.x,
        z: lm.z,
        layer: 'cave',
        alive: false,
        solid: false,
        interactive: true,
        source: 'generated',
      });
    }
    const levels: number[][] = [];
    for (let z = 0; z < N; z++) {
      const row: number[] = [];
      for (let x = 0; x < N; x++) row.push(this.levels[z * N + x]!);
      levels.push(row);
    }
    return {
      version: 1,
      seed: this.seed,
      size: N,
      archetype: this.layout.archetype,
      daytime: this.daytime,
      weather: this.weather,
      levels,
      entities,
      note: 'levels: -1 water, 0-8 terraces, border ring is rock. Decor (flowers, turf, clouds, sky islands, outer wilderness) is not data on purpose. NPC entities carry alive:true.',
    };
  }

  /** Floating block islands and drifting flat clouds — the sky lives too. */
  private buildSky(): void {
    const rng = createRng(hashString(this.seed + '-sky'));
    const turfMat = new THREE.MeshLambertMaterial({ color: 0x9fe0b8 });
    const stoneMat = new THREE.MeshLambertMaterial({ color: 0xe8dcc6 });
    const trunkMat = new THREE.MeshLambertMaterial({ color: 0xd9b98c });
    const islandSpots: [number, number, number][] = [];
    for (let ii = 0; ii < this.layout.islandCount; ii++) {
      islandSpots.push([
        4 + rng() * (N - 8),
        5 + rng() * 2,
        rng() < 0.5 ? 3 + rng() * 6 : N - 9 + rng() * 6,
      ]);
    }
    for (const [ix, iy, iz] of islandSpots) {
      const group = new THREE.Group();
      const base = new THREE.Mesh(new THREE.BoxGeometry(2, 0.5, 2), stoneMat);
      base.castShadow = true;
      group.add(base);
      const under = new THREE.Mesh(new THREE.BoxGeometry(1.2, 0.5, 1.2), stoneMat);
      under.position.y = -0.5;
      group.add(under);
      const cap = new THREE.Mesh(new THREE.BoxGeometry(2, 0.1, 2), turfMat);
      cap.position.y = 0.3;
      group.add(cap);
      const trunk = new THREE.Mesh(new THREE.BoxGeometry(0.22, 0.6, 0.22), trunkMat);
      trunk.position.y = 0.65;
      group.add(trunk);
      const crown = new THREE.Mesh(
        new THREE.BoxGeometry(0.9, 0.7, 0.9),
        new THREE.MeshLambertMaterial({ color: this.strokes[Math.floor(rng() * this.strokes.length)]! }),
      );
      crown.position.y = 1.3;
      crown.castShadow = true;
      group.add(crown);
      group.position.set(ix, iy, iz);
      this.worldSurface.add(group);
      this.islands.push({ group, baseY: iy, phase: rng() * Math.PI * 2 });
    }
    const cloudMat = new THREE.MeshLambertMaterial({ color: 0xffffff });
    for (let i = 0; i < this.layout.cloudCount; i++) {
      const group = new THREE.Group();
      const puffs = 3 + Math.floor(rng() * 2);
      for (let pu = 0; pu < puffs; pu++) {
        const puff = new THREE.Mesh(
          new THREE.BoxGeometry(1.6 + rng() * 1.8, 0.35, 1.0 + rng() * 1.0),
          cloudMat,
        );
        puff.position.set((rng() - 0.5) * 3, (rng() - 0.5) * 0.3, (rng() - 0.5) * 1.6);
        group.add(puff);
      }
      group.position.set(rng() * (WORLD + 40) - 20, 10 + rng() * 3.5, rng() * WORLD);
      this.worldSurface.add(group);
      this.clouds.push({ group, speed: 0.25 + rng() * 0.4 });
    }
  }

  private buildWeather(): void {
    // MOTES — round pastel bokeh, drifting upward
    const count = 260;
    this.snow = new THREE.InstancedMesh(
      new THREE.PlaneGeometry(0.17, 0.17),
      new THREE.MeshBasicMaterial({
        map: radialTexture('rgba(255,255,255,0.95)', 'rgba(255,255,255,0)'),
        transparent: true,
        opacity: 0.6,
        depthWrite: false,
        side: THREE.DoubleSide,
        toneMapped: false,
      }),
      count,
    );
    this.snow.frustumCulled = false;
    const moteColor = new THREE.Color();
    for (let i = 0; i < count; i++) {
      this.snowData.push({
        x: Math.random() * (WORLD + 20) - 10,
        y: Math.random() * 10,
        z: Math.random() * (WORLD + 24) - 6,
        speed: 0.22 + Math.random() * 0.35,
        phase: Math.random() * Math.PI * 2,
      });
      moteColor.setHex(this.strokes[i % this.strokes.length]!);
      this.snow.setColorAt(i, moteColor);
    }
    if (this.snow.instanceColor) this.snow.instanceColor.needsUpdate = true;
    this.scene.add(this.snow);

    const rainCount = 340;
    this.rain = new THREE.InstancedMesh(
      new THREE.PlaneGeometry(0.012, 0.5),
      new THREE.MeshBasicMaterial({ color: 0x5aa4e8, transparent: true, opacity: 0.26, depthWrite: false }),
      rainCount,
    );
    this.rain.frustumCulled = false;
    this.rain.visible = false;
    for (let i = 0; i < rainCount; i++) {
      this.rainData.push({
        x: Math.random() * (WORLD + 20) - 10,
        y: Math.random() * 14,
        z: Math.random() * (WORLD + 24) - 6,
        speed: 12 + Math.random() * 5,
      });
    }
    this.scene.add(this.rain);

    const fogTex = radialTexture('rgba(236,228,238,0.5)', 'rgba(236,228,238,0)');
    for (let i = 0; i < 7; i++) {
      const sprite = new THREE.Sprite(
        new THREE.SpriteMaterial({ map: fogTex, transparent: true, opacity: 0.15, depthWrite: false }),
      );
      const a = (i / 7) * Math.PI * 2;
      const r = 5 + (i % 3) * 4.5;
      sprite.position.set(WORLD / 2 + Math.cos(a) * r, 0.9, WORLD / 2 + Math.sin(a) * r);
      sprite.scale.set(11 + (i % 3) * 4, 3.2, 1);
      sprite.userData.phase = a;
      sprite.visible = false;
      this.fogSprites.push(sprite);
      this.scene.add(sprite);
    }
    this.applyEnvironment();
  }

  /** Swipe → path toward the swiped direction; long swipes go far (and run). */
  private swipeTo(dx: number, dy: number, lengthPx: number): void {
    if (useGameStore.getState().dialogue) return;
    const l = Math.hypot(dx, dy);
    if (l < 1) return;
    const dir = new THREE.Vector3(dx / l, 0, dy / l).applyAxisAngle(
      new THREE.Vector3(0, 1, 0),
      this.cameraCtl.yaw,
    );
    const heroPos = this.hero.group.position;
    const heroCell = worldCell(heroPos.x, heroPos.z);
    const dist = THREE.MathUtils.clamp(lengthPx / 45, 1.5, 14);
    for (let d = dist; d >= 1; d -= 0.8) {
      const tx = THREE.MathUtils.clamp(heroPos.x + dir.x * d, 0.5, WORLD - 0.5);
      const tz = THREE.MathUtils.clamp(heroPos.z + dir.z * d, 0.5, WORLD - 0.5);
      const cell = worldCell(tx, tz);
      if (!this.activeGrid().isWalkable(cell.x, cell.z)) continue;
      if (cell.x === heroCell.x && cell.z === heroCell.z) break;
      const path = findPath(this.activeGrid(), heroCell, cell);
      if (path) {
        this.pendingInteract = null;
        this.setPath(path);
        return;
      }
    }
  }

  // ---------- input ----------
  private setPointer(e: PointerEvent): void {
    const rect = this.canvas.getBoundingClientRect();
    this.pointer.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
    this.pointer.y = -((e.clientY - rect.top) / rect.height) * 2 + 1;
  }

  private cellFromPointer(): GridPosition | null {
    this.raycaster.setFromCamera(this.pointer, this.cameraCtl.camera);
    const pick = this.layer === 'cave' && this.caveFloor ? this.caveFloor : this.ground;
    const hit = this.raycaster.intersectObject(pick, false)[0];
    if (!hit) return null;
    const cell = worldCell(hit.point.x, hit.point.z);
    if (cell.x < 0 || cell.z < 0 || cell.x >= N || cell.z >= N) return null;
    return cell;
  }

  private onPointerDown = (e: PointerEvent): void => {
    if (e.button !== 0) return;
    this.downAt = { x: e.clientX, y: e.clientY, t: performance.now() };
  };

  private onPointerUp = (e: PointerEvent): void => {
    if (e.button !== 0 || !this.downAt) return;
    const moved = Math.hypot(e.clientX - this.downAt.x, e.clientY - this.downAt.y);
    const dt = performance.now() - this.downAt.t;
    this.downAt = null;
    if (moved > 7 || dt > 500) return;
    if (useGameStore.getState().dialogue) return;
    this.setPointer(e);
    const cell = this.cellFromPointer();
    if (!cell) return;
    this.handleCellClick(cell);
  };

  private onPointerMove = (e: PointerEvent): void => {
    this.setPointer(e);
    const cell = this.cellFromPointer();
    if (cell && this.activeGrid().isWalkable(cell.x, cell.z)) {
      const w = cellWorld(cell.x, cell.z);
      this.hoverQuad.position.set(w.x, 0.02 + this.groundHeight(w.x, w.z), w.z);
      this.hoverQuad.visible = true;
      this.canvas.style.cursor = 'pointer';
    } else if (cell && this.interactCells.has(this.interactKey(cell.x, cell.z))) {
      this.hoverQuad.visible = false;
      this.canvas.style.cursor = 'pointer';
    } else {
      this.hoverQuad.visible = false;
      this.canvas.style.cursor = 'default';
    }
  };

  private handleCellClick(cell: GridPosition): void {
    const grid = this.activeGrid();
    const heroCell = worldCell(this.hero.group.position.x, this.hero.group.position.z);
    const interact = this.interactCells.get(this.interactKey(cell.x, cell.z));
    if (interact) {
      const near = Math.max(Math.abs(cell.x - heroCell.x), Math.abs(cell.z - heroCell.z)) <= 1;
      if (near) {
        this.runInteract(interact.id);
        return;
      }
      const owner =
        grid.occupantAt(cell.x, cell.z) !== undefined ? grid.occupantAt(cell.x, cell.z)! : null;
      const approach = owner
        ? grid.nearestAdjacentWalkable(owner, heroCell)
        : grid.isWalkable(cell.x, cell.z)
          ? cell
          : null;
      if (!approach) return;
      const path = findPath(grid, heroCell, approach);
      if (path) {
        this.setPath(path);
        this.pendingInteract = interact.id;
      }
      return;
    }
    if (!grid.isWalkable(cell.x, cell.z)) {
      useGameStore.getState().showToast('A very confident brush stroke. It is not moving.');
      return;
    }
    const path = findPath(grid, heroCell, cell);
    if (!path) {
      useGameStore.getState().showToast('No way through.');
      return;
    }
    this.pendingInteract = null;
    this.setPath(path);
  }

  private setPath(path: GridPosition[]): void {
    if (this.walkResolve) {
      const resolve = this.walkResolve;
      this.walkResolve = null;
      resolve('interrupted');
    }
    const heroCell = worldCell(this.hero.group.position.x, this.hero.group.position.z);
    this.path = path.filter((c, i) => !(i === 0 && c.x === heroCell.x && c.z === heroCell.z));
    this.pathIndex = 0;
    const last = this.path[this.path.length - 1];
    if (last) {
      const w = cellWorld(last.x, last.z);
      this.targetRing.position.set(w.x, 0.03 + this.groundHeight(w.x, w.z), w.z);
      this.targetRing.visible = true;
      this.targetPulse = 0;
    }
  }

  private runInteract(id: string): void {
    const store = useGameStore.getState();
    if (id === 'guide') {
      this.guideTalked = true;
      return;
    }
    if (id === 'pond') {
      if (!this.pondSeen) {
        this.pondSeen = true;
        store.showToast('The liquid ripples: marbled, confident, unhelpful. Demo satisfactory.');
        if (this.guideTalked) store.setObjective('Respect the queue, then report to Portal 227.');
      } else {
        store.showToast('Still swirling. Still smug about it.');
      }
      return;
    }
    if (id === 'portal') {
      this.portalSeen = true;
      return;
    }
    if (id === 'chest') {
      if (!this.chestOpened) {
        this.chestOpened = true;
        if (this.chestLid) {
          this.chestLid.rotation.x = -1.05;
          this.chestLid.position.y += 0.16;
        }
      }
      return;
    }
    if (
      id === 'stone' ||
      id === 'tower' ||
      id === 'circle' ||
      id === 'camp' ||
      id === 'bush' ||
      id === 'geode' ||
      id === 'hearth' ||
      id === 'tavern' ||
      id === 'cathedral'
    ) {
      return;
    }
    if (id === 'queue') {
      store.showToast('They have queued all night for the goat heist. They will absolutely not let you cut in.');
      return;
    }
    if (id === 'village') {
      store.showToast('“…and I heard the goat has a BODYGUARD.” The locals nod gravely. Nobody knows anything.');
      return;
    }
    if (id === 'edge') {
      store.showToast('The page ends here. Beyond: tomorrow’s portal, probably.');
    }
  }

  private wireStore(): void {
    this.unsub.push(
      useGameStore.subscribe(
        (s) => s.dialogueEndedNpcId,
        (npcId) => {
          if (!npcId) return;
          useGameStore.getState().consumeDialogueEnded();
          if (npcId === 'v9-guide' && !this.guideTalked) {
            this.guideTalked = true;
            useGameStore.getState().setObjective('Inspect the liquid demo — the pond in the north-west.');
          }
          if (npcId === 'v9-portal' && !this.portalSeen) {
            this.portalSeen = true;
            useGameStore.getState().setObjective('Portal 227 acknowledges you. The goat heist begins… tomorrow.');
          }
        },
      ),
    );
  }

  private onKeyDown = (e: KeyboardEvent): void => {
    const store = useGameStore.getState();
    if ((e.key === ' ' || e.key === 'Enter') && store.dialogue) {
      e.preventDefault();
      store.advanceDialogue();
    }
  };

  // ---------- loop ----------
  private resize = (): void => {
    const w = this.canvas.clientWidth || window.innerWidth;
    const h = this.canvas.clientHeight || window.innerHeight;
    this.renderer.setSize(w, h, false);
    const size = new THREE.Vector2();
    this.renderer.getDrawingBufferSize(size);
    this.filter.resize(Math.max(2, size.x), Math.max(2, size.y));
    this.cameraCtl?.updateAspect();
  };

  // Hidden tabs get a slow 4 fps interval tick instead of rAF: the GPU rests,
  // but simulation still advances — an agent driving from a background tab can
  // finish its walk_to. On return, rAF resumes at full rate.
  private hiddenTick: ReturnType<typeof setInterval> | null = null;

  private onVisibility = (): void => {
    if (document.hidden) {
      cancelAnimationFrame(this.raf);
      if (!this.hiddenTick) this.hiddenTick = setInterval(() => this.loop(), 250);
    } else {
      if (this.hiddenTick) clearInterval(this.hiddenTick);
      this.hiddenTick = null;
      if (!this.disposed) {
        this.clock.getDelta(); // swallow the gap so dt doesn't spike
        this.loop();
      }
    }
  };

  private lastFrameMs = 0;
  private shadowPhase = 0;

  private loop = (): void => {
    if (this.disposed) return;
    this.raf = requestAnimationFrame(this.loop);
    // 30 fps cap: plenty for this art style, and on 60-120 Hz displays it
    // halves-to-quarters the GPU/CPU burn (the paint filter is the hot part)
    const nowMs = performance.now();
    if (nowMs - this.lastFrameMs < 31) return;
    this.lastFrameMs = nowMs;
    if (++this.shadowPhase % 3 === 0) this.renderer.shadowMap.needsUpdate = true;
    const dt = Math.min(this.clock.getDelta(), 0.1);
    const time = this.clock.elapsedTime;
    const heroPos = this.hero.group.position;

    for (const hook of this.tickHooks) hook(dt, time);

    const running = this.path.length - this.pathIndex > 10;
    const speed = running ? 5.0 : 2.7;
    let moving = false;
    if (this.pathIndex < this.path.length) {
      moving = true;
      const target = this.path[this.pathIndex]!;
      const w = cellWorld(target.x, target.z);
      const dx = w.x - heroPos.x;
      const dz = w.z - heroPos.z;
      const dist = Math.hypot(dx, dz);
      const step = speed * dt;
      if (dist <= step) {
        heroPos.set(w.x, heroPos.y, w.z);
        this.pathIndex++;
        if (this.entranceSet.has(`${target.x},${target.z}`)) {
          this.toggleLayer();
        }
        if (this.pathIndex >= this.path.length) {
          this.path = [];
          this.targetRing.visible = false;
          if (this.walkResolve) {
            const resolve = this.walkResolve;
            this.walkResolve = null;
            resolve('arrived');
          }
          if (this.pendingInteract) {
            const id = this.pendingInteract;
            this.pendingInteract = null;
            this.runInteract(id);
          }
        }
      } else {
        heroPos.x += (dx / dist) * step;
        heroPos.z += (dz / dist) * step;
        const targetHeading = Math.atan2(dx, dz);
        let delta = targetHeading - this.heading;
        while (delta > Math.PI) delta -= Math.PI * 2;
        while (delta < -Math.PI) delta += Math.PI * 2;
        this.heading += delta * Math.min(1, dt * 11);
        this.hero.group.rotation.y = this.heading;
      }
    }
    // grounding spring: terrace steps become springy little hops
    {
      const gy = this.groundHeight(heroPos.x, heroPos.z);
      this.yVel += (gy - this.baseY) * 110 * dt;
      this.yVel *= Math.exp(-10 * dt);
      this.baseY += this.yVel * dt;
      if (Math.abs(this.baseY - gy) > 4.5) {
        this.baseY = gy;
        this.yVel = 0;
      }
    }

    // eased voxel walk: the stride blends in and out instead of snapping
    this.moveBlend += ((moving ? 1 : 0) - this.moveBlend) * Math.min(1, dt * 7);
    const blend = this.moveBlend;
    if (blend > 0.01) this.stridePhase += dt * (moving ? speed : 2.2) * 3.1 * Math.max(0.4, blend);
    const swing = Math.sin(this.stridePhase) * blend;
    this.hero.legs[0].rotation.x = swing * 0.7;
    this.hero.legs[1].rotation.x = -swing * 0.7;
    this.hero.arms[0].rotation.x = -swing * 0.45;
    this.hero.arms[1].rotation.x = swing * 0.45;
    // subtle body roll with the stride
    this.hero.group.rotation.z = Math.sin(this.stridePhase) * 0.03 * blend;
    const strideBob = Math.abs(Math.cos(this.stridePhase)) * 0.05 * blend;
    const breatheBob = (Math.sin(time * 1.6) * 0.5 + 0.5) * 0.03 * (1 - blend);
    heroPos.y = this.baseY + strideBob + breatheBob;

    // the folk breathe and shuffle; the guide tracks the hero
    for (const folk of this.folk) {
      folk.group.position.y = folk.baseY + (Math.sin(time * 1.5 + folk.phase) * 0.5 + 0.5) * 0.05;
      folk.group.rotation.z = Math.sin(time * 1.1 + folk.phase * 2) * 0.02;
    }
    if (this.guide) {
      const gp = this.guide.group.position;
      const targetYaw = Math.atan2(heroPos.x - gp.x, heroPos.z - gp.z);
      let delta = targetYaw - this.guide.group.rotation.y;
      while (delta > Math.PI) delta -= Math.PI * 2;
      while (delta < -Math.PI) delta += Math.PI * 2;
      this.guide.group.rotation.y += delta * Math.min(1, dt * 3);
    }

    if (this.targetRing.visible) {
      this.targetPulse += dt * 3;
      this.targetRing.scale.setScalar(1 + Math.sin(this.targetPulse * 2) * 0.12);
    }

    // weather
    const camYaw = Math.atan2(
      this.cameraCtl.camera.position.x - heroPos.x,
      this.cameraCtl.camera.position.z - heroPos.z,
    );
    const m = new THREE.Matrix4();
    if (this.snow.visible) {
      const q = new THREE.Quaternion().setFromEuler(new THREE.Euler(0, camYaw, 0));
      for (let i = 0; i < this.snowData.length; i++) {
        const p = this.snowData[i]!;
        p.y += p.speed * dt;
        p.x += Math.sin(time * 0.7 + p.phase) * dt * 0.4;
        p.z += Math.cos(time * 0.55 + p.phase) * dt * 0.25;
        if (p.y > 9.5) {
          p.y = 0.1;
          p.x = heroPos.x + (Math.random() - 0.5) * 34;
          p.z = heroPos.z + (Math.random() - 0.5) * 34;
        }
        const tw = 0.8 + Math.sin(time * 3 + p.phase * 5) * 0.2;
        m.compose(new THREE.Vector3(p.x, p.y, p.z), q, new THREE.Vector3(tw, tw, tw));
        this.snow.setMatrixAt(i, m);
      }
      this.snow.instanceMatrix.needsUpdate = true;
    }
    if (this.rain.visible) {
      const q = new THREE.Quaternion().setFromEuler(new THREE.Euler(0, camYaw, 0.05));
      for (let i = 0; i < this.rainData.length; i++) {
        const p = this.rainData[i]!;
        p.y -= p.speed * dt;
        if (p.y < 0) {
          p.y = 12 + Math.random() * 4;
          p.x = heroPos.x + (Math.random() - 0.5) * 36;
          p.z = heroPos.z + (Math.random() - 0.5) * 36;
        }
        m.compose(new THREE.Vector3(p.x, p.y, p.z), q, new THREE.Vector3(1, 1, 1));
        this.rain.setMatrixAt(i, m);
      }
      this.rain.instanceMatrix.needsUpdate = true;
    }
    for (const bank of this.fogSprites) {
      if (!bank.visible) break;
      bank.position.x += Math.sin(time * 0.1 + bank.userData.phase) * 0.004;
      bank.position.z += Math.cos(time * 0.09 + bank.userData.phase) * 0.003;
      (bank.material as THREE.SpriteMaterial).opacity = 0.13 + Math.sin(time * 0.35 + bank.userData.phase) * 0.045;
    }

    // interior lights hold steady (a hearth doesn't care what time it is)
    for (let i = 0; i < this.interiorLights.length; i++) {
      const entry = this.interiorLights[i]!;
      entry.light.intensity = entry.base * (0.92 + Math.sin(time * 7 + i * 2.1) * 0.08);
    }
    // lamps breathe with the daytime
    const lampFactor = LAMP_FACTOR[this.daytime];
    for (let i = 0; i < this.lampLights.length; i++) {
      const entry = this.lampLights[i]!;
      const flicker = 0.95 + Math.sin(time * 2.2 + i * 1.9) * 0.05;
      entry.light.intensity = entry.base * lampFactor * flicker;
      const lantern = this.lanterns[i];
      if (lantern) lantern.mat.color.copy(lantern.hue).multiplyScalar(0.82 + flicker * 0.18);
    }

    // the portal churns
    this.swirlUniform.uTime.value = time;
    if (this.portalWheel && this.portalLight && this.portalParticles) {
      this.portalWheel.rotation.z += dt * 0.06;
      const cyc = time * 0.25;
      const idx = Math.floor(cyc) % this.strokes.length;
      const c1 = new THREE.Color(this.strokes[idx]!);
      const c2 = new THREE.Color(this.strokes[(idx + 1) % this.strokes.length]!);
      this.portalLight.color.copy(c1.lerp(c2, cyc - Math.floor(cyc)));
      this.portalLight.intensity = 13 * (0.9 + Math.sin(time * 2.4) * 0.1);
      const pm = new THREE.Matrix4();
      for (let i = 0; i < 36; i++) {
        const a = time * (0.4 + (i % 5) * 0.06) + i * 0.175;
        const r = 2.15 + Math.sin(time * 0.8 + i) * 0.12;
        pm.makeScale(1, 1, 1);
        pm.setPosition(Math.cos(a) * r, 2.25 + Math.sin(a) * r, Math.sin(time * 1.3 + i) * 0.2);
        this.portalParticles.setMatrixAt(i, pm);
      }
      this.portalParticles.instanceMatrix.needsUpdate = true;
    }

    // the landscape breathes: river flows, clouds drift, islands hover
    if (this.waterTex) this.waterTex.offset.y -= dt * 0.045;
    for (const cloud of this.clouds) {
      cloud.group.position.x += cloud.speed * dt;
      if (cloud.group.position.x > WORLD + 26) cloud.group.position.x = -26;
    }
    for (const island of this.islands) {
      island.group.position.y = island.baseY + Math.sin(time * 0.5 + island.phase) * 0.25;
      island.group.rotation.y = Math.sin(time * 0.2 + island.phase) * 0.08;
    }
    for (let ci = 0; ci < this.crystals.length; ci++) {
      const crystal = this.crystals[ci]!;
      crystal.rotation.y += dt * 0.7;
      crystal.position.y = (crystal.userData.baseY as number) + Math.sin(time * 1.1 + ci * 2) * 0.09;
    }

    // the hero's torch: warm firelight that travels with you underground
    this.heroTorch.position.set(heroPos.x, heroPos.y + 1.6, heroPos.z);
    const torchTarget = this.layer === 'cave' ? 30 : 0;
    this.heroTorch.intensity +=
      (torchTarget * (0.92 + Math.sin(time * 9) * 0.05 + Math.sin(time * 23) * 0.03) - this.heroTorch.intensity) *
      Math.min(1, dt * 6);
    if (this.torchGroup) this.torchGroup.visible = this.layer === 'cave';
    if (this.torchFlame && this.layer === 'cave') {
      const fl = 0.9 + Math.sin(time * 11) * 0.12 + Math.sin(time * 27) * 0.06;
      this.torchFlame.scale.set(fl, 1.1 + Math.sin(time * 13) * 0.15, fl);
      // colour stays put; only the flame's size breathes
    }

    // the darkness veil eases off after a layer change
    if (this.veil > 0.001) {
      this.veil *= Math.exp(-3.2 * dt);
      const fogNow = this.scene.fog as THREE.FogExp2 | null;
      if (fogNow) fogNow.density = this.fogBase * (1 + this.veil * 6);
      this.renderer.toneMappingExposure = this.expBase * (1 - this.veil * 0.4);
    }

    // floating lanterns spin, their motes orbit
    for (const sp of this.lampSpinners) {
      sp.core.position.y = sp.baseY + Math.sin(time * 1.4 + sp.phase) * 0.08;
      sp.core.rotation.y += dt * 0.8;
      sp.core.rotation.x += dt * 0.3;
      for (let k = 0; k < sp.minis.length; k++) {
        const a = time * 1.2 + sp.phase + (k * Math.PI * 2) / 3;
        sp.minis[k]!.position.set(
          Math.cos(a) * 0.42,
          sp.core.position.y + Math.sin(a * 1.7) * 0.12,
          Math.sin(a) * 0.42,
        );
      }
    }

    this.cameraCtl.update(dt, heroPos);
    this.sky.followSun(heroPos);
    this.sky.update(time);
    this.filter.render(this.renderer, this.scene, this.cameraCtl.camera, time);

    this.fpsAccum += dt;
    if (++this.frames >= 30) {
      this.fps = Math.round(this.frames / this.fpsAccum);
      this.frames = 0;
      this.fpsAccum = 0;
      this.adaptResolution();
      this.cb.onStats({
        fps: this.fps,
        drawCalls: this.renderer.info.render.calls,
        triangles: this.renderer.info.render.triangles,
        coveragePercent: 100,
        fallbackIds: [],
        playerCell: worldCell(heroPos.x, heroPos.z),
      });
    }
  };

  // ---------- adaptive resolution ----------
  private pixelCap = Math.min(window.devicePixelRatio, 1.5);
  private renderScale = 1;

  private filterDowngraded = false;

  /** Called once per FPS sample (~every half second): step the backbuffer
   *  scale down while the frame rate struggles, back up when it recovers.
   *  If we're already at the floor and still below 30 fps, drop the paint
   *  filter too — a plain render beats a beautiful slideshow. */
  private adaptResolution(): void {
    if (document.hidden) return;
    let next = this.renderScale;
    if (this.fps < 40 && this.renderScale > 0.7) next = Math.max(0.7, this.renderScale - 0.15);
    else if (this.fps > 55 && this.renderScale < 1) next = Math.min(1, this.renderScale + 0.1);
    if (this.fps < 30 && this.renderScale <= 0.7 && !this.filterDowngraded) {
      this.filterDowngraded = true;
      this.setFilterMode('off');
    }
    if (Math.abs(next - this.renderScale) < 0.01) return;
    this.renderScale = next;
    this.renderer.setPixelRatio(this.pixelCap * this.renderScale);
    this.resize(); // propagate the new backbuffer size to the paint filter
  }

  // ---------- plaza seams: multiplayer + WebMCP agent tools ----------
  /** Run a callback every frame (returns an unsubscribe). */
  addTickHook(fn: (dt: number, time: number) => void): () => void {
    this.tickHooks.add(fn);
    return () => this.tickHooks.delete(fn);
  }

  getScene(): THREE.Scene {
    return this.scene;
  }

  getHeroGroup(): THREE.Group | null {
    return this.hero ? this.hero.group : null;
  }

  /** World point → CSS pixel position on the canvas (for floating UI). */
  projectToScreen(x: number, y: number, z: number): { x: number; y: number; behind: boolean } {
    const v = new THREE.Vector3(x, y, z).project(this.cameraCtl.camera);
    const w = this.canvas.clientWidth || window.innerWidth;
    const h = this.canvas.clientHeight || window.innerHeight;
    return { x: ((v.x + 1) / 2) * w, y: ((1 - v.y) / 2) * h, behind: v.z > 1 };
  }

  getLayer(): 'surface' | 'cave' {
    return this.layer;
  }

  heroCell(): GridPosition {
    return worldCell(this.hero.group.position.x, this.hero.group.position.z);
  }

  groundHeightAt(x: number, z: number): number {
    return this.groundHeight(x, z);
  }

  /** Semantic cell lookup for read_map and the 2D fallback map. */
  cellInfo(x: number, z: number): { walkable: boolean; kind: string } {
    if (x < 0 || z < 0 || x >= N || z >= N) return { walkable: false, kind: 'edge' };
    const grid = this.activeGrid();
    const occupant = grid.occupantAt(x, z);
    if (!occupant) return { walkable: grid.isWalkable(x, z), kind: 'ground' };
    const kind = occupant.startsWith('hedge-')
      ? 'hedge'
      : occupant.startsWith('water-') || occupant === 'pond'
        ? 'water'
        : occupant.startsWith('tree-')
          ? 'tree'
          : occupant.startsWith('house-')
            ? 'building'
            : occupant.startsWith('lamp-')
              ? 'lamp'
              : occupant.startsWith('villager-') || occupant.startsWith('queue-') || occupant === 'guide'
                ? 'npc'
                : occupant === 'portal'
                  ? 'portal'
                  : occupant.startsWith('lm-')
                    ? 'landmark'
                    : occupant.startsWith('mound-')
                      ? 'cave-mound'
                      : occupant.replace(/[-\d]+$/, '') || 'object';
    return { walkable: grid.isWalkable(x, z), kind };
  }

  gridFor(layer: 'surface' | 'cave'): Grid {
    return layer === 'cave' ? this.caveGrid : this.grid;
  }

  isReady(): boolean {
    return !!this.hero;
  }

  /** Named places an agent can walk to by name. */
  getPlaces(): { kind: string; x: number; z: number }[] {
    const L = this.layout;
    const places: { kind: string; x: number; z: number }[] = [
      { kind: 'portal', x: L.portal.cx, z: L.portal.cz },
      { kind: 'pond', x: L.pond.cx, z: L.pond.cz },
      { kind: 'village', x: L.village.x, z: L.village.z },
      { kind: 'guide', x: L.guide.x, z: L.guide.z },
      { kind: 'spawn', x: L.spawn.x, z: L.spawn.z },
    ];
    for (const lm of this.landmarks) places.push({ ...lm });
    for (const b of this.buildingRects) {
      if (b.kind && b.doorX !== undefined && b.doorZ !== undefined) {
        places.push({ kind: b.kind, x: b.doorX, z: b.doorZ });
      }
    }
    return places;
  }

  /**
   * Walk the hero to a cell (or the nearest approach if it is occupied).
   * Resolves when the walk ends; 'interrupted' if something replaced the path.
   */
  walkTo(x: number, z: number): Promise<'arrived' | 'blocked' | 'no-path' | 'interrupted'> {
    if (!this.hero) return Promise.resolve('blocked');
    const grid = this.activeGrid();
    const heroCell = this.heroCell();
    let target: GridPosition = { x, z };
    if (x === heroCell.x && z === heroCell.z) return Promise.resolve('arrived');
    if (!grid.isWalkable(x, z)) {
      const owner = grid.occupantAt(x, z);
      const approach = owner ? grid.nearestAdjacentWalkable(owner, heroCell) : undefined;
      if (!approach) return Promise.resolve('blocked');
      target = approach;
      if (target.x === heroCell.x && target.z === heroCell.z) return Promise.resolve('arrived');
    }
    const path = findPath(grid, heroCell, target);
    if (!path) return Promise.resolve('no-path');
    this.pendingInteract = null;
    this.setPath(path);
    if (this.path.length === 0) return Promise.resolve('arrived');
    return new Promise((resolve) => {
      this.walkResolve = resolve;
    });
  }

  dispose(): void {
    this.disposed = true;
    cancelAnimationFrame(this.raf);
    this.touchInput?.dispose();
    this.canvas.removeEventListener('pointerdown', this.onPointerDown);
    this.canvas.removeEventListener('pointerup', this.onPointerUp);
    this.canvas.removeEventListener('pointermove', this.onPointerMove);
    window.removeEventListener('resize', this.resize);
    window.removeEventListener('keydown', this.onKeyDown);
    document.removeEventListener('visibilitychange', this.onVisibility);
    if (this.hiddenTick) clearInterval(this.hiddenTick);
    this.unsub.forEach((u) => u());
    this.cameraCtl?.dispose();
    this.filter.dispose();
    this.renderer.dispose();
  }
}
