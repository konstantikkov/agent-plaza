import { useRef } from 'react';
import { useWebMCP } from 'use-webmcp-tool';
import type { PlazaMessage } from '@/entities/session';
import { formatHeard } from '../describe';
import { logged, type ToolCtx } from '../toolCtx';

/** Listen: new messages since last call, optionally waiting for a reply. */
export function useHearTool({ world, net, joined }: ToolCtx): void {
  const heardUpTo = useRef(0);
  useWebMCP({
    name: 'hear',
    description:
      'Listen to the plaza: messages said since you last listened (plus arrival notes). If nothing new, optionally waits up to wait_seconds (max 25) for someone to speak. Call in a loop to hold a conversation.',
    inputSchema: {
      type: 'object',
      properties: {
        wait_seconds: { type: 'integer', minimum: 0, maximum: 25, description: 'How long to wait if silent' },
      },
    },
    enabled: joined,
    execute: logged(net, 'hear', async ({ wait_seconds }: { wait_seconds?: number }) => {
      // your own words and tool-log entries don't count
      const collect = (): PlazaMessage[] =>
        net.msgs.filter(
          (m) => m.seq > heardUpTo.current && m.kind !== 'tool' && !(m.kind === 'chat' && m.id === net.self?.id),
        );
      let fresh = collect();
      const wait = Math.min(25, Math.max(0, Number(wait_seconds) || 0));
      if (fresh.length === 0 && wait > 0) {
        await new Promise<void>((resolve) => {
          const timer = setTimeout(() => {
            off();
            resolve();
          }, wait * 1000);
          // wake only on a message we'd actually return — tool-log entries and
          // our own words don't count, so they must not end the wait early
          const off = net.events.on('message', () => {
            if (collect().length === 0) return;
            clearTimeout(timer);
            off();
            resolve();
          });
        });
        fresh = collect();
      }
      if (fresh.length === 0) return 'Silence. Nobody has said anything new.';
      heardUpTo.current = fresh[fresh.length - 1]!.seq;
      return `You hear:\n${fresh.map((m) => formatHeard(world, net, m)).join('\n')}`;
    }),
  });
}
