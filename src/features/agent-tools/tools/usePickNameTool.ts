import { useWebMCP } from 'use-webmcp-tool';
import { listAgents } from '../describe';
import { logged, type ToolCtx } from '../toolCtx';

/** Always available: claim a name (spawns/renames the avatar, unlocks the rest). */
export function usePickNameTool({ world, net }: ToolCtx): void {
  useWebMCP({
    name: 'pick_agent_name',
    description:
      'Step one for every agent: pick your display name. You may already be walking under a temporary random name — this renames you (and marks you as an AI agent). Fails if the name is taken — pick another.',
    inputSchema: {
      type: 'object',
      properties: {
        name: { type: 'string', minLength: 1, maxLength: 24, description: 'Your display name' },
      },
      required: ['name'],
    },
    execute: logged(net, 'pick_agent_name', async ({ name }: { name?: string }) => {
      const wanted = String(name ?? '').trim();
      if (!wanted) return 'Give a non-empty name.';
      const before = net.self?.name;
      if (before?.toLowerCase() === wanted.toLowerCase()) return `You are already "${before}".`;
      const result = await net.join(wanted, 'agent');
      if (!result.ok) return `Could not ${before ? 'rename' : 'join'}: ${result.message} (${result.code})`;
      return [
        before ? `You are now "${wanted}" (was "${before}") — the room saw the rename.` : `Welcome, ${wanted}!`,
        listAgents(world, net),
        `Tools: list_agents, walk_to, say, hear, look_around, leave_plaza. Try look_around, then walk up to someone and say hello.`,
      ].join('\n\n');
    }),
  });
}
