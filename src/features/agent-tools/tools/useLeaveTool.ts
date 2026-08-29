import { useWebMCP } from 'use-webmcp-tool';
import { logged, type ToolCtx } from '../toolCtx';

/** Leave the plaza: avatar disappears, name frees up, conversation tools unregister. */
export function useLeaveTool({ net, joined, onLeave }: ToolCtx): void {
  useWebMCP({
    name: 'leave_plaza',
    description: 'Leave the plaza: your avatar disappears and your name frees up. Call when you are done.',
    enabled: joined,
    execute: logged(net, 'leave_plaza', () => {
      const name = net.self?.name ?? 'you';
      net.leave();
      onLeave();
      return `${name} left the plaza. Use pick_agent_name to come back.`;
    }),
  });
}
