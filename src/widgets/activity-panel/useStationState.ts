import { useEffect, useState } from 'react';
import type { PlazaNet, StationState } from '@/entities/session';

/** Subscribe a component to one station's live state. */
export function useStationState(net: PlazaNet, id: string): StationState | undefined {
  const [, force] = useState(0);
  useEffect(() => {
    const off = net.events.on('station', ({ id: sid }) => {
      if (sid === id) force((n) => n + 1);
    });
    return off;
  }, [net, id]);
  return net.station(id);
}
