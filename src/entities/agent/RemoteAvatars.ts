import * as THREE from 'three';
import { cellWorld } from '@/entities/world/constants';
import { makeVoxelFolk, type VoxelFolk } from '@/entities/world/folk';
import type { PlazaWorld } from '@/entities/world/PlazaWorld';
import type { PlazaNet, PlazaAgentInfo } from '@/entities/session/index';
import type { GridPosition } from '@/shared/lib/shared';
import { makeLabelSprite, wrapText, disposeSprite } from './labelSprite';

interface AvatarView {
  info: PlazaAgentInfo;
  folk: VoxelFolk;
  tag: THREE.Sprite;
  bubble?: { sprite: THREE.Sprite; until: number };
  queue: GridPosition[];
  stride: number;
  heading: number;
}

/**
 * Renders everyone else: voxel avatars with name tags and speech bubbles,
 * walking their broadcast cells at hero pace. Pure view over PlazaNet events.
 */
export class RemoteAvatars {
  private views = new Map<string, AvatarView>();
  private heroBubble: { sprite: THREE.Sprite; until: number } | null = null;
  private unsubs: Array<() => void>;

  constructor(
    private world: PlazaWorld,
    private net: PlazaNet,
  ) {
    this.unsubs = [
      net.events.on('agents', (list) => this.sync(list)),
      net.events.on('moved', ({ id, x, z }) => this.views.get(id)?.queue.push({ x, z })),
      net.events.on('message', (m) => {
        if (m.kind !== 'chat' || !m.id) return;
        if (m.id === net.self?.id) this.showHeroBubble(m.text);
        else this.showBubble(this.views.get(m.id), m.text);
      }),
      world.addTickHook((dt) => this.tick(dt)),
    ];
    this.sync(net.agents());
  }

  dispose(): void {
    this.unsubs.forEach((off) => off());
    for (const id of [...this.views.keys()]) this.remove(id);
    if (this.heroBubble) {
      this.world.getHeroGroup()?.remove(this.heroBubble.sprite);
      disposeSprite(this.heroBubble.sprite);
    }
  }

  private sync(list: PlazaAgentInfo[]): void {
    const live = new Set(list.map((a) => a.id));
    for (const id of [...this.views.keys()]) if (!live.has(id)) this.remove(id);
    for (const info of list) {
      const view = this.views.get(info.id);
      if (!view) this.add(info);
      else if (view.info.name !== info.name || view.info.kind !== info.kind) {
        view.info = info;
        view.folk.group.remove(view.tag);
        disposeSprite(view.tag);
        view.tag = this.makeTag(info, view.folk.group);
      } else view.info = info;
    }
  }

  private add(info: PlazaAgentInfo): void {
    const folk = makeVoxelFolk(info.color || 0x9b7bf2, 1);
    const w = cellWorld(info.x, info.z);
    const y = this.world.isReady() ? this.world.groundHeightAt(w.x, w.z) : 0;
    folk.group.position.set(w.x, y, w.z);
    this.world.getScene().add(folk.group);
    this.views.set(info.id, {
      info,
      folk,
      tag: this.makeTag(info, folk.group),
      queue: [],
      stride: Math.random() * Math.PI * 2,
      heading: Math.PI,
    });
  }

  private makeTag(info: PlazaAgentInfo, group: THREE.Group): THREE.Sprite {
    const tag = makeLabelSprite([`${info.kind === 'agent' ? '🤖 ' : ''}${info.name}`], { big: false });
    tag.position.y = 1.55;
    group.add(tag);
    return tag;
  }

  private remove(id: string): void {
    const view = this.views.get(id);
    if (!view) return;
    this.views.delete(id);
    this.world.getScene().remove(view.folk.group);
    disposeSprite(view.tag);
    if (view.bubble) disposeSprite(view.bubble.sprite);
  }

  private showBubble(view: AvatarView | undefined, text: string): void {
    if (!view) return;
    if (view.bubble) {
      view.folk.group.remove(view.bubble.sprite);
      disposeSprite(view.bubble.sprite);
    }
    const sprite = makeLabelSprite(wrapText(text), { big: true });
    sprite.position.y = 2.35;
    view.folk.group.add(sprite);
    view.bubble = { sprite, until: performance.now() + 2600 + text.length * 90 };
  }

  private showHeroBubble(text: string): void {
    const hero = this.world.getHeroGroup();
    if (!hero) return;
    if (this.heroBubble) {
      hero.remove(this.heroBubble.sprite);
      disposeSprite(this.heroBubble.sprite);
    }
    const sprite = makeLabelSprite(wrapText(text), { big: true });
    sprite.position.y = 2.35;
    hero.add(sprite);
    this.heroBubble = { sprite, until: performance.now() + 2600 + text.length * 90 };
  }

  private tick(dt: number): void {
    const now = performance.now();
    if (this.heroBubble && now > this.heroBubble.until) {
      this.world.getHeroGroup()?.remove(this.heroBubble.sprite);
      disposeSprite(this.heroBubble.sprite);
      this.heroBubble = null;
    }
    const myLayer = this.world.isReady() ? this.world.getLayer() : 'surface';
    for (const view of this.views.values()) {
      const group = view.folk.group;
      group.visible = view.info.layer === myLayer;

      const target = view.queue[0];
      let moving = false;
      if (target) {
        const w = cellWorld(target.x, target.z);
        const dx = w.x - group.position.x;
        const dz = w.z - group.position.z;
        const dist = Math.hypot(dx, dz);
        const step = (view.queue.length > 4 ? 6.5 : 2.9) * dt;
        moving = true;
        if (dist <= step || dist > 8) {
          group.position.x = w.x;
          group.position.z = w.z;
          view.queue.shift();
        } else {
          group.position.x += (dx / dist) * step;
          group.position.z += (dz / dist) * step;
          const want = Math.atan2(dx, dz);
          let delta = want - view.heading;
          while (delta > Math.PI) delta -= Math.PI * 2;
          while (delta < -Math.PI) delta += Math.PI * 2;
          view.heading += delta * Math.min(1, dt * 10);
          group.rotation.y = view.heading;
        }
      }
      view.stride += dt * (moving ? 9 : 2);
      const swing = moving ? Math.sin(view.stride) : 0;
      view.folk.legs[0].rotation.x = swing * 0.7;
      view.folk.legs[1].rotation.x = -swing * 0.7;
      view.folk.arms[0].rotation.x = -swing * 0.45;
      view.folk.arms[1].rotation.x = swing * 0.45;
      const groundY = this.world.isReady()
        ? this.world.groundHeightAt(group.position.x, group.position.z)
        : 0;
      const bob = moving ? Math.abs(Math.cos(view.stride)) * 0.05 : Math.sin(view.stride) * 0.02 + 0.02;
      group.position.y = groundY + bob;

      if (view.bubble && now > view.bubble.until) {
        group.remove(view.bubble.sprite);
        disposeSprite(view.bubble.sprite);
        view.bubble = undefined;
      }
    }
  }
}
