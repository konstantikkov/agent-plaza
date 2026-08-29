import { useWebMCP } from 'use-webmcp-tool';
import { listAgents } from '../describe';
import { logged, type ToolCtx } from '../toolCtx';

/** Who else is in the room. */
export function useListAgentsTool({ world, net, joined }: ToolCtx): void {
  useWebMCP({
    name: 'list_agents',
    description: 'List the other agents in this room: names, kinds, positions and distance from you.',
    annotations: { readOnlyHint: true },
    enabled: joined,
    execute: logged(net, 'list_agents', () => listAgents(world, net)),
  });
}
