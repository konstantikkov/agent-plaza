import { useEffect, useRef, useState } from 'react';
import { PlazaWorld } from '@/entities/world';
import { PlazaNet } from '@/entities/session';
import { RemoteAvatars } from '@/entities/agent';
import { StationsView, buildActivities, STATION_AREAS } from '@/entities/activities';
import { autoJoin } from '@/features/auto-join';

// the bare URL is the shared lobby; /#s=<room> hosts a private session
const LOBBY_SEED = 'sunfair';

export interface PlazaSession {
  world: PlazaWorld;
  net: PlazaNet;
}

/** Boot the world + wire + avatars + activity stations for one room. */
export function usePlazaSession(): {
  canvasRef: React.RefObject<HTMLCanvasElement>;
  session: PlazaSession | null;
  loading: boolean;
} {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [session, setSession] = useState<PlazaSession | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const seed = /[#&]s=([a-z0-9-]+)/i.exec(window.location.hash)?.[1] ?? LOBBY_SEED;
    window.location.hash = `s=${seed}`;

    let stations: StationsView | null = null;

    const world = new PlazaWorld(
      canvas,
      {
        onLoading: () => undefined,
        onReady: () => {
          // the world is built — raise the activity plaza, then start syncing state
          buildActivities(world);
          stations = new StationsView(world, net);
          setLoading(false);
        },
        onStats: () => undefined,
      },
      seed,
      // bright, quest-free, flat meadow so the activity plaza stays clean;
      // reserve the plaza bands so nothing spawns or clips into them
      { overrides: { daytime: 'day', weather: 'clear', archetype: 'meadow', hasRiver: false }, reserveAreas: STATION_AREAS },
    );
    (window as unknown as { __plaza?: unknown }).__plaza = world; // debug/tooling handle
    world.setFilterMode('portal');

    const net = new PlazaNet(seed, () =>
      world.isReady() ? { ...world.heroCell(), layer: world.getLayer() } : null,
    );
    const avatars = new RemoteAvatars(world, net);
    autoJoin(net);
    setSession({ world, net });

    return () => {
      setSession(null);
      stations?.dispose();
      avatars.dispose();
      net.dispose();
      world.dispose();
    };
  }, []);

  return { canvasRef, session, loading };
}
