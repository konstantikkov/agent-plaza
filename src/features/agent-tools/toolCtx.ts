import type { PlazaNet } from '@/entities/session';
import type { PlazaWorld } from '@/entities/world';

/** Everything a tool hook needs, threaded from the AgentTools composer. */
export interface ToolCtx {
  world: PlazaWorld;
  net: PlazaNet;
  /** false until a name is claimed — gates the conversation tools. */
  joined: boolean;
  /** the composer's setJoined(false), called when leave_plaza runs. */
  onLeave: () => void;
}

/**
 * Wrap a tool's execute so every invocation shows up in the room's activity
 * log before it runs. Keeps all eight tools reporting consistently.
 */
export function logged<A, R>(
  net: PlazaNet,
  name: string,
  fn: (args: A) => R | Promise<R>,
): (args: A) => R | Promise<R> {
  return (args: A) => {
    net.reportTool(name);
    return fn(args);
  };
}
