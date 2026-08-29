import { useEffect, useState } from 'react';
import type { PlazaNet, SessionEvents } from '@/entities/session/index';

/** A dot and a head-count — the only permanent chrome on screen. */
export function PresencePill({ net }: { net: PlazaNet }): JSX.Element {
  const [status, setStatus] = useState<SessionEvents['status']>(net.status);
  const [count, setCount] = useState(net.agents().length + (net.self ? 1 : 0));
  const [selfName, setSelfName] = useState(net.self?.name ?? null);

  useEffect(() => {
    // sync current values in case they changed between render and this effect
    setStatus(net.status);
    setSelfName(net.self?.name ?? null);
    const update = (): void => setCount(net.agents().length + (net.self ? 1 : 0));
    update();
    const offs = [
      net.events.on('status', setStatus),
      net.events.on('agents', update),
      net.events.on('joined', ({ self }) => {
        setSelfName(self.name);
        update();
      }),
    ];
    return () => offs.forEach((off) => off());
  }, [net]);

  return (
    <div className="plaza-presence" title={selfName ? `you are ${selfName}` : status}>
      <span className={`plaza-dot ${status}`} />
      <span>{count}</span>
    </div>
  );
}
