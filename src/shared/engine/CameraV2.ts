import * as THREE from 'three';
import { getHeightAtWorldPosition } from './TerrainShim';

type HeightFn = (x: number, z: number) => number;

/**
 * Third-person anime-RPG camera: orbits the hero with smooth damping,
 * mouse-drag rotation, wheel zoom, and a terrain-aware floor so it never
 * clips under the ground.
 */
export class CameraV2 {
  readonly camera: THREE.PerspectiveCamera;
  yaw = Math.PI; // behind the hero looking north
  private pitch = 0.32;
  private distance = 7.5;
  private target = new THREE.Vector3();
  private pointerDown = false;
  private lastX = 0;
  private lastY = 0;
  /** touch: single finger is reserved for swipe-movement; two fingers orbit/zoom */
  private touchPoints = new Map<number, { x: number; y: number }>();
  private pinchDist = 0;

  private heightAt: HeightFn;

  constructor(
    private canvas: HTMLCanvasElement,
    start: THREE.Vector3,
    heightAt?: HeightFn,
    opts: { distance?: number; pitch?: number; yaw?: number } = {},
  ) {
    this.heightAt = heightAt ?? getHeightAtWorldPosition;
    if (opts.distance) this.distance = opts.distance;
    if (opts.pitch) this.pitch = opts.pitch;
    if (opts.yaw !== undefined) this.yaw = opts.yaw;
    this.camera = new THREE.PerspectiveCamera(50, 1, 0.1, 600);
    this.target.copy(start);
    this.updateAspect();
    canvas.addEventListener('wheel', this.onWheel, { passive: false });
    canvas.addEventListener('pointerdown', this.onPointerDown);
    window.addEventListener('pointermove', this.onPointerMove);
    window.addEventListener('pointerup', this.onPointerUp);
    window.addEventListener('pointercancel', this.onPointerUp);
    canvas.addEventListener('contextmenu', (e) => e.preventDefault());
  }

  private onWheel = (e: WheelEvent): void => {
    e.preventDefault();
    this.distance = THREE.MathUtils.clamp(this.distance + e.deltaY * 0.008, 3, 18);
  };

  private onPointerDown = (e: PointerEvent): void => {
    if (e.pointerType === 'touch') {
      this.touchPoints.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (this.touchPoints.size === 2) {
        const [a, b] = [...this.touchPoints.values()];
        this.pinchDist = Math.hypot(a!.x - b!.x, a!.y - b!.y);
      }
      return;
    }
    if (e.button !== 0 && e.button !== 2) return;
    this.pointerDown = true;
    this.lastX = e.clientX;
    this.lastY = e.clientY;
  };

  private onPointerMove = (e: PointerEvent): void => {
    if (e.pointerType === 'touch') {
      if (!this.touchPoints.has(e.pointerId)) return;
      if (this.touchPoints.size === 2) {
        const points = this.touchPoints;
        const [a, b] = [...points.values()];
        const prevMidX = (a!.x + b!.x) / 2;
        const prevMidY = (a!.y + b!.y) / 2;
        points.set(e.pointerId, { x: e.clientX, y: e.clientY });
        const [a2, b2] = [...points.values()];
        const midX = (a2!.x + b2!.x) / 2;
        const midY = (a2!.y + b2!.y) / 2;
        this.yaw -= (midX - prevMidX) * 0.006;
        this.pitch = THREE.MathUtils.clamp(this.pitch + (midY - prevMidY) * 0.004, 0.05, 1.15);
        const nd = Math.hypot(a2!.x - b2!.x, a2!.y - b2!.y);
        this.distance = THREE.MathUtils.clamp(this.distance - (nd - this.pinchDist) * 0.02, 3, 18);
        this.pinchDist = nd;
      } else {
        this.touchPoints.set(e.pointerId, { x: e.clientX, y: e.clientY });
      }
      return;
    }
    if (!this.pointerDown) return;
    const dx = e.clientX - this.lastX;
    const dy = e.clientY - this.lastY;
    this.lastX = e.clientX;
    this.lastY = e.clientY;
    this.yaw -= dx * 0.0052;
    this.pitch = THREE.MathUtils.clamp(this.pitch + dy * 0.0038, 0.05, 1.15);
  };

  private onPointerUp = (e: PointerEvent): void => {
    if (e.pointerType === 'touch') {
      this.touchPoints.delete(e.pointerId);
      return;
    }
    this.pointerDown = false;
  };

  updateAspect(): void {
    const w = this.canvas.clientWidth || window.innerWidth;
    const h = this.canvas.clientHeight || window.innerHeight;
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  }

  update(dt: number, heroPos: THREE.Vector3): void {
    const focus = heroPos.clone().add(new THREE.Vector3(0, 1.5, 0));
    this.target.lerp(focus, Math.min(1, dt * 7));

    const offset = new THREE.Vector3(
      Math.sin(this.yaw) * Math.cos(this.pitch),
      Math.sin(this.pitch),
      Math.cos(this.yaw) * Math.cos(this.pitch),
    ).multiplyScalar(this.distance);
    const pos = this.target.clone().add(offset);

    // keep above terrain
    const floor = this.heightAt(pos.x, pos.z) + 0.6;
    if (pos.y < floor) pos.y = floor;

    this.camera.position.lerp(pos, Math.min(1, dt * 10));
    this.camera.lookAt(this.target);
  }

  dispose(): void {
    this.canvas.removeEventListener('wheel', this.onWheel);
    this.canvas.removeEventListener('pointerdown', this.onPointerDown);
    window.removeEventListener('pointermove', this.onPointerMove);
    window.removeEventListener('pointerup', this.onPointerUp);
    window.removeEventListener('pointercancel', this.onPointerUp);
  }
}
