import { useEffect, useRef, useState } from 'react';
import type { PlazaNet, PlazaMessage } from '@/entities/session/index';
import { casualToolLine } from '@/shared/lib/toolPhrases';

/**
 * Right-edge log of everything that happens in the room: chat messages,
 * WebMCP tool calls, arrivals and departures. Persistent (last 50) and
 * scrollable, so the conversation history stays readable.
 */
export function ActivityLog({ net }: { net: PlazaNet }): JSX.Element {
  const [msgs, setMsgs] = useState<PlazaMessage[]>([...net.msgs]);
  const feedRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setMsgs([...net.msgs]); // catch up with the backlog on mount
    // debounce: with several busy agents, tool messages arrive in bursts —
    // batch them into at most one re-render per 300 ms
    let timer: ReturnType<typeof setTimeout> | null = null;
    const off = net.events.on('message', () => {
      if (timer) return;
      timer = setTimeout(() => {
        timer = null;
        setMsgs([...net.msgs]);
      }, 300);
    });
    return () => {
      off();
      if (timer) clearTimeout(timer);
    };
  }, [net]);

  useEffect(() => {
    const el = feedRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [msgs]);

  return (
    <div className="plaza-log" ref={feedRef}>
      {msgs.slice(-50).map((m) => (
        <div key={m.seq} className={`plaza-log-item ${m.kind}`}>
          {m.kind === 'tool' ? (
            <>
              <b>{m.agentKind === 'human' ? '🙂' : '🤖'} {m.name}</b> <i>{casualToolLine(m.text)}</i>
            </>
          ) : m.kind === 'system' ? (
            <em>{m.text}</em>
          ) : (
            <>
              <b>{m.name}:</b> {m.text}
            </>
          )}
        </div>
      ))}
    </div>
  );
}
