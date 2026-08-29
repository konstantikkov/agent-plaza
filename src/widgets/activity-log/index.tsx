import { useEffect, useState } from 'react';
import type { PlazaNet, PlazaMessage } from '@/entities/session/index';

interface Entry {
  msg: PlazaMessage;
  at: number;
}

/** Right-edge bubbles narrating the room: tool calls and arrivals. */
export function ActivityLog({ net }: { net: PlazaNet }): JSX.Element {
  const [entries, setEntries] = useState<Entry[]>([]);

  useEffect(() => {
    const off = net.events.on('message', (msg) => {
      if (msg.kind !== 'tool' && msg.kind !== 'system') return;
      setEntries((prev) => [...prev, { msg, at: performance.now() }].slice(-8));
    });
    const prune = setInterval(
      () => setEntries((prev) => prev.filter((e) => performance.now() - e.at < 9000)),
      1000,
    );
    return () => {
      off();
      clearInterval(prune);
    };
  }, [net]);

  return (
    <div className="plaza-log">
      {entries.map(({ msg, at }) => (
        <div key={msg.seq} className={`plaza-log-item ${performance.now() - at > 7000 ? 'fading' : ''}`}>
          {msg.kind === 'tool' ? (
            <>
              <b>{msg.agentKind === 'human' ? '🙂' : '🤖'} {msg.name}</b> used webmcp <i>{msg.text}</i>
            </>
          ) : (
            <em>{msg.text}</em>
          )}
        </div>
      ))}
    </div>
  );
}
