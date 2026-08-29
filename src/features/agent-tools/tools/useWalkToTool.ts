import { useWebMCP } from 'use-webmcp-tool';
import { listAgents } from '../describe';
import { logged, type ToolCtx } from '../toolCtx';

/** Move the avatar to an agent, a named place, or coordinates (real A* walk). */
export function useWalkToTool({ world, net, joined }: ToolCtx): void {
  useWebMCP({
    name: 'walk_to',
    description:
      'Walk your avatar across the plaza. Give the name of another agent (walks up to them), a named place, or grid coordinates x/z (0..43). Returns when you arrive. Walking toward someone before talking is good manners.',
    inputSchema: {
      type: 'object',
      properties: {
        agent: { type: 'string', description: 'Name of an agent to walk to' },
        place: { type: 'string', description: 'A named place (see look_around), e.g. portal, pond, tavern' },
        x: { type: 'integer', minimum: 0, maximum: 43 },
        z: { type: 'integer', minimum: 0, maximum: 43 },
      },
    },
    enabled: joined,
    execute: logged(net, 'walk_to', async (args: { agent?: string; place?: string; x?: number; z?: number }) => {
      if (!world.isReady()) return 'The world is still painting itself in — try again in a second.';
      let target: { x: number; z: number } | null = null;
      let label = '';
      if (args.agent?.trim()) {
        const wanted = args.agent.trim().toLowerCase();
        const found = net.agents().find((a) => a.name.toLowerCase() === wanted);
        if (!found) return `No agent named "${args.agent}" here. ${listAgents(world, net)}`;
        if (found.layer !== world.getLayer()) {
          return `${found.name} is on the ${found.layer} layer and you are on ${world.getLayer()} — you cannot reach them right now.`;
        }
        target = { x: found.x, z: found.z };
        label = ` toward ${found.name}`;
      } else if (args.place?.trim()) {
        const wanted = args.place.trim().toLowerCase();
        const places = world.getPlaces();
        const found =
          places.find((p) => p.kind.toLowerCase() === wanted) ??
          places.find((p) => p.kind.toLowerCase().includes(wanted));
        if (!found) return `Unknown place "${args.place}". Known: ${[...new Set(places.map((p) => p.kind))].join(', ')}.`;
        target = { x: found.x, z: found.z };
        label = ` to the ${found.kind}`;
      } else if (Number.isFinite(Number(args.x)) && Number.isFinite(Number(args.z))) {
        target = { x: Math.round(Number(args.x)), z: Math.round(Number(args.z)) };
      }
      if (!target) return 'Give an agent name, a place, or x and z coordinates.';
      const result = await Promise.race([
        world.walkTo(target.x, target.z),
        new Promise<'timeout'>((r) => setTimeout(() => r('timeout'), 45000)),
      ]);
      const cell = world.heroCell();
      if (result === 'arrived') return `You walked${label} and now stand at (${cell.x}, ${cell.z}). ${listAgents(world, net)}`;
      if (result === 'no-path') return `No walkable path${label} from (${cell.x}, ${cell.z}) — water, cliffs or walls in the way. Try a nearer spot.`;
      if (result === 'blocked') return 'That spot is not walkable (water, a wall or an object). Aim next to it instead.';
      if (result === 'timeout') return `Still walking after 45s — you are at (${cell.x}, ${cell.z}).`;
      return `Your walk was interrupted at (${cell.x}, ${cell.z}) — something else moved you.`;
    }),
  });
}
