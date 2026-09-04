import type { PlazaNet } from '@/entities/session';
import type { WorldPort } from '@/entities/world';
import { announceToolResult } from '@/shared/lib/toolVoice';

/** Everything a tool hook needs, threaded from the AgentTools composer. */
export interface ToolCtx {
  world: WorldPort;
  net: PlazaNet;
  /** false until a name is claimed — gates the conversation tools. */
  joined: boolean;
  /** the composer's setJoined(false), called when leave_plaza runs. */
  onLeave: () => void;
}

/**
 * Wrap a tool's execute so every invocation shows up in the room's activity
 * log before it runs, and its result reaches the local voice-over narrator
 * once it resolves. Keeps all tools reporting consistently.
 */
export function logged<A, R>(
  net: PlazaNet,
  name: string,
  fn: (args: A) => R | Promise<R>,
): (args: A) => R | Promise<R> {
  return (args: A) => {
    net.reportTool(name);
    const out = fn(args);
    if (out instanceof Promise) {
      out.then((r) => announceToolResult(name, r)).catch(() => {});
      return out;
    }
    announceToolResult(name, out);
    return out;
  };
}
