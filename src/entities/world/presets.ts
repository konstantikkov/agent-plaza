import type { LightingPreset } from '@/shared/engine/SkyV2';

/** Time-of-day lighting presets in the landing palette. */
export type Daytime = 'dawn' | 'day' | 'dusk' | 'night';
export type Weather = 'clear' | 'snow' | 'rain' | 'fog';

export const LIGHT_PRESETS: Record<Daytime, LightingPreset> = {
  // SPIRAL — the landing page at 3am: pale rose-lavender air, soft and lit
  dawn: {
    sunColor: 0xffe2d2, sunIntensity: 1.0, sunDir: [0.4, 0.5, 0.3],
    hemiSky: 0xe6dcf0, hemiGround: 0x8a8092, hemiIntensity: 1.05,
    fogColor: 0xf0e6e8, fogDensity: 0.008,
    zenith: 0xc2d0ec, mid: 0xf0dfe8, horizon: 0xfdf3ea, exposure: 1.18,
  },
  // BLOOM — cream page, soft mesh pastels, morning light
  day: {
    sunColor: 0xfff2dc, sunIntensity: 1.0, sunDir: [-0.3, 0.52, 0.3],
    hemiSky: 0xcfd9e8, hemiGround: 0x6e6874, hemiIntensity: 1.0,
    fogColor: 0xe9e1d2, fogDensity: 0.0085,
    zenith: 0xa9bedb, mid: 0xe9e2d6, horizon: 0xf7efe3, exposure: 1.16,
  },
  // QUASAR — violet-blue hour
  dusk: {
    sunColor: 0x7c5cff, sunIntensity: 1.2, sunDir: [-0.5, 0.32, 0.2],
    hemiSky: 0x5a4a9c, hemiGround: 0x1c1830, hemiIntensity: 0.75,
    fogColor: 0x4a3c78, fogDensity: 0.013,
    zenith: 0x101426, mid: 0x232a6e, horizon: 0x7c5cff, exposure: 1.18,
  },
  // CARNIVAL — ink night, magenta bleeding at the horizon
  night: {
    sunColor: 0x3fa9ff, sunIntensity: 0.55, sunDir: [-0.3, 0.6, 0.25],
    hemiSky: 0x2a2248, hemiGround: 0x14101c, hemiIntensity: 0.6,
    fogColor: 0x140f22, fogDensity: 0.016,
    zenith: 0x0d0a18, mid: 0x180e30, horizon: 0xff2d9b, exposure: 1.25,
  },
};

export const LAMP_FACTOR: Record<Daytime, number> = { dawn: 0.9, day: 0.7, dusk: 1.7, night: 2.4 };

