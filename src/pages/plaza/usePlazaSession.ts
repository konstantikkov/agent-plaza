import { useEffect, useRef, useState } from 'react';
import { PlazaWorld, FlatWorld, type WorldPort } from '@/entities/world/index';
import { PlazaNet } from '@/entities/session/index';
import { RemoteAvatars } from '@/entities/agent/index';
import { autoJoin } from '@/features/auto-join/index';

// the bare URL is the shared lobby; /#s=<room> hosts a private session.
// 'orchard-vale' won a cost-aware seed scout: garden + river + mountains +
// village, but no lakes/islands (animated water is the expensive part).
const LOBBY_SEED = 'orchard-vale';

export interface PlazaSession {
  world: WorldPort;
  world3d: PlazaWorld | null; // null when WebGL is unavailable (2D fallback)
  net: PlazaNet;
}

function webglAvailable(): boolean {
  try {
    const probe = document.createElement('canvas');
    return !!(probe.getContext('webgl2') ?? probe.getContext('webgl'));
  } catch {
    return false;
  }
}

/** `?2d=true` forces the 2D map mode even when WebGL works. */
function wants2d(): boolean {
  return new URLSearchParams(window.location.search).get('2d') === 'true';
}

/** Boot the world + wire + avatars for one room; falls back to the headless
 *  FlatWorld (2D map, identical WebMCP tools) when WebGL is unavailable. */
export function usePlazaSession(): {
  canvasRef: React.RefObject<HTMLCanvasElement>;
  session: PlazaSession | null;
  loading: boolean;
} {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [session, setSession] = useState<PlazaSession | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const seed = /[#&]s=([a-z0-9-]+)/i.exec(window.location.hash)?.[1] ?? LOBBY_SEED;
    window.location.hash = `s=${seed}`;

    let world: WorldPort;
    let world3d: PlazaWorld | null = null;
    let flat: FlatWorld | null = null;
    let avatars: RemoteAvatars | null = null;

    if (!wants2d() && webglAvailable() && canvasRef.current) {
      world3d = new PlazaWorld(
        canvasRef.current,
        { onLoading: () => undefined, onReady: () => setLoading(false), onStats: () => undefined },
        seed,
        // the plaza is always a bright, quest-free meeting ground with a river
        { overrides: { daytime: 'day', weather: 'clear', hasRiver: true } },
      );
      world3d.setFilterMode('portal');
      world = world3d;
    } else {
      flat = new FlatWorld(seed);
      world = flat;
      setLoading(false);
    }
    (window as unknown as { __plaza?: unknown }).__plaza = world; // debug/tooling handle

    const net = new PlazaNet(seed, () =>
      world.isReady() ? { ...world.heroCell(), layer: world.getLayer() } : null,
    );
    if (world3d) avatars = new RemoteAvatars(world3d, net);
    autoJoin(net);
    setSession({ world, world3d, net });

    return () => {
      setSession(null);
      avatars?.dispose();
      net.dispose();
      world3d?.dispose();
      flat?.dispose();
    };
  }, []);

  return { canvasRef, session, loading };
}
