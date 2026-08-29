import * as THREE from 'three';
import type { ActivityModule, StationDef, BuildApi, RenderApi, StationSnapshot } from '../types';
import { box, deck, signpost, textSprite } from '../voxel';

/**
 * Song stage — an open-mic activity. One agent takes the mic, sings a titled
 * song line by line, and the audience hears each line + applauds. The stage
 * (raised wooden deck + backdrop + spotlights + mic) is built toward the NORTH
 * of the footprint; rows of stools sit in the south, facing it.
 */

const WOOD = 0x8a6b46;
const PLANK = 0xb5895a;
const BACKDROP = 0x3a2f4a;
const CREAM = 0xefe6d4;
const INK = 0x1b1f2a;

export interface StageState {
  singerId?: string;
  singerName?: string;
  title?: string;
  lyrics: string[]; // readStage always normalizes to an array
  line: number;
}

/** Read a station's raw state into a guarded StageState (arrays/fields may be absent). */
export function readStage(state: Record<string, unknown> | undefined): StageState {
  const s = state ?? {};
  const rawLyrics = (s as { lyrics?: unknown }).lyrics;
  const lyrics = Array.isArray(rawLyrics) ? rawLyrics.filter((l): l is string => typeof l === 'string') : [];
  const rawLine = (s as { line?: unknown }).line;
  const line = typeof rawLine === 'number' && Number.isFinite(rawLine) ? Math.max(0, Math.floor(rawLine)) : 0;
  const singerId = typeof (s as { singerId?: unknown }).singerId === 'string' ? (s as { singerId: string }).singerId : undefined;
  const singerName =
    typeof (s as { singerName?: unknown }).singerName === 'string' ? (s as { singerName: string }).singerName : undefined;
  const title = typeof (s as { title?: unknown }).title === 'string' ? (s as { title: string }).title : undefined;
  return { singerId, singerName, title, lyrics, line };
}

/** The current lyric line, clamped to the available lines (or undefined if none). */
export function currentLine(st: StageState): string | undefined {
  if (st.lyrics.length === 0) return undefined;
  const i = Math.max(0, Math.min(st.line, st.lyrics.length - 1));
  return st.lyrics[i];
}

// Stage geometry, all in cell space. North is the low-z edge of the footprint.
function layout(def: StationDef): { midX: number; northZ: number; deckZ: number; audienceZ0: number } {
  const midX = (def.area.x0 + def.area.x1) / 2;
  const northZ = def.area.z0; // back of the stage
  return { midX, northZ, deckZ: northZ + 1.3, audienceZ0: northZ + 4 };
}

export const stage: ActivityModule = {
  build(def: StationDef, api: BuildApi): void {
    const { midX, northZ, deckZ, audienceZ0 } = layout(def);
    const stageWorld = api.cellWorld(midX, deckZ);
    const gy = api.groundY(stageWorld.x, stageWorld.z);

    const deckW = (def.area.x1 - def.area.x0) - 0.6; // world units ~= cell span
    const deckD = 2.6;
    const riserH = 0.6;
    const stageTop = gy + riserH;

    // raised riser + wooden deck plank on top
    box(api.group, deckW, riserH, deckD, WOOD, stageWorld.x, gy + riserH / 2, stageWorld.z);
    deck(api.group, stageWorld.x, stageTop - 0.24, stageWorld.z, deckW, deckD, PLANK);

    // backdrop wall behind the stage (further north / lower z)
    const backWorld = api.cellWorld(midX, northZ + 0.4);
    box(api.group, deckW + 0.4, 2.4, 0.3, BACKDROP, backWorld.x, stageTop + 1.2, backWorld.z);
    box(api.group, deckW + 0.4, 0.2, 0.34, def.color, backWorld.x, stageTop + 2.3, backWorld.z);

    // two spotlight posts flanking the stage, each topped with a warm lamp + glow
    for (const side of [-1, 1] as const) {
      const px = midX + side * ((deckW / 2) - 0.4);
      const post = api.cellWorld(px, deckZ - 0.4);
      const py = api.groundY(post.x, post.z);
      box(api.group, 0.16, 2.6, 0.16, INK, post.x, py + 1.3, post.z);
      box(api.group, 0.34, 0.24, 0.34, def.color, post.x, py + 2.5, post.z, { basic: true });
    }

    // microphone stand: thin post + small box mic, centre-stage
    const mic = api.cellWorld(midX, deckZ + 0.4);
    box(api.group, 0.07, 1.15, 0.07, INK, mic.x, stageTop + 0.575, mic.z);
    box(api.group, 0.16, 0.22, 0.16, 0x2c2c2c, mic.x, stageTop + 1.2, mic.z);

    // audience stools in the south, facing the stage (north). Skip the approach cell.
    for (let r = 0; r < 2; r++) {
      const rz = audienceZ0 + r * 1.4;
      for (const cx of [midX - 1.6, midX, midX + 1.6]) {
        if (Math.round(cx) === def.cx && Math.round(rz) === def.cz) continue; // keep approach clear
        const w = api.cellWorld(cx, rz);
        const sy = api.groundY(w.x, w.z);
        box(api.group, 0.3, 0.44, 0.3, INK, w.x, sy + 0.22, w.z);
        box(api.group, 0.44, 0.1, 0.44, WOOD, w.x, sy + 0.49, w.z);
      }
    }

    signpost(api.group, api.cellWorld(def.cx, def.cz).x - 1.4, gy, api.cellWorld(def.cx, def.cz).z, def.color);
  },

  render(def: StationDef, snap: StationSnapshot | undefined, api: RenderApi): void {
    const { midX, deckZ } = layout(def);
    const st = readStage(snap?.state);
    const stageWorld = api.cellWorld(midX, deckZ);
    const gy = api.groundY(stageWorld.x, stageWorld.z);
    const stageTop = gy + 0.6;

    // singer token at the mic when someone holds it
    if (st.singerId) {
      const mic = api.cellWorld(midX, deckZ + 0.4);
      const singer = new THREE.Group();
      singer.name = 'singer';
      singer.position.set(mic.x, stageTop, mic.z);
      singer.userData.baseY = stageTop;
      box(singer, 0.42, 0.72, 0.34, def.color, 0, 0.36, 0);
      box(singer, 0.36, 0.36, 0.36, CREAM, 0, 0.9, 0);
      api.group.add(singer);
    }

    // big floating lyric / open-mic placard above the stage
    const placardY = stageTop + 3.1;
    if (st.singerId) {
      const cur = currentLine(st) ?? '♪ ♪ ♪';
      const title = st.title && st.title.length > 0 ? `🎵 ${st.title}` : '🎵 open mic';
      const lines = [title, cur];
      const sprite = textSprite(lines, { size: 22, bg: 'rgba(122,84,20,0.9)', fg: '#fff4d8' });
      sprite.position.set(stageWorld.x, placardY, stageWorld.z);
      api.group.add(sprite);
    } else {
      const sprite = textSprite(['🎤 open mic — take_the_mic to sing'], { size: 16, bg: 'rgba(122,84,20,0.82)', fg: '#fff4d8' });
      sprite.position.set(stageWorld.x, placardY, stageWorld.z);
      api.group.add(sprite);
    }
  },

  tick(_def: StationDef, _snap: StationSnapshot | undefined, api: RenderApi): void {
    const singer = api.group.getObjectByName('singer');
    if (singer) {
      const baseY = typeof singer.userData.baseY === 'number' ? singer.userData.baseY : singer.position.y;
      singer.position.y = baseY + Math.sin(api.time * 3) * 0.06;
    }
  },
};
