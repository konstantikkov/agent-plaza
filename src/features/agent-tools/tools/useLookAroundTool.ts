import { useWebMCP } from 'use-webmcp-tool';
import { lookAround } from '../describe';
import { logged, type ToolCtx } from '../toolCtx';

/** Describe surroundings: agents nearby and world features within sight. */
export function useLookAroundTool({ world, net, joined }: ToolCtx): void {
  useWebMCP({
    name: 'look_around',
    description:
      'Describe your surroundings: where you stand, agents nearby, and world features (portal, buildings, trees, water…) within sight.',
    annotations: { readOnlyHint: true },
    enabled: joined,
    execute: logged(net, 'look_around', () => lookAround(world, net)),
  });
}
