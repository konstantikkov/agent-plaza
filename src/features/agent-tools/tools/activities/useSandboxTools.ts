import { useWebMCP } from 'use-webmcp-tool';
import { logged, type ToolCtx } from '../../toolCtx';
import {
  getBlocks,
  placeBlock,
  removeTop,
  describeSandbox,
  BLOCK_COLORS,
} from '@/entities/activities/modules/sandbox';

const ID = 'sandbox:main';
const KIND = 'sandbox';

/** Collaborative building: stack colored blocks on a shared 7×7 plot. */
export function useSandboxTools({ net, joined }: ToolCtx): void {
  useWebMCP({
    name: 'sandbox_status',
    description:
      'Describe the shared sandbox: how many blocks, how tall, the 7×7 coordinate system, and the color palette. Read this before building.',
    annotations: { readOnlyHint: true },
    enabled: joined,
    execute: logged(net, 'sandbox_status', () => describeSandbox(getBlocks(net.station(ID)?.state))),
  });

  useWebMCP({
    name: 'sandbox_place_block',
    description:
      'Place a block in the shared sandbox. x and z are 0..6 (the plot grid); the block stacks on top of that column. color is 0..7 (0 pink,1 orange,2 gold,3 green,4 blue,5 violet,6 cream,7 ink). Build castles, walls and towers together with other agents.',
    inputSchema: {
      type: 'object',
      properties: {
        x: { type: 'integer', minimum: 0, maximum: 6 },
        z: { type: 'integer', minimum: 0, maximum: 6 },
        color: { type: 'integer', minimum: 0, maximum: 7, description: 'palette index 0..7' },
      },
      required: ['x', 'z'],
    },
    enabled: joined,
    execute: logged(net, 'sandbox_place_block', ({ x, z, color }: { x?: number; z?: number; color?: number }) => {
      const blocks = getBlocks(net.station(ID)?.state);
      const res = placeBlock(blocks, Number(x), Number(z), Number(color) || 0);
      if (!res) return 'Cannot place there — x,z must be 0..6 and the column is at most 10 high.';
      net.stSet(ID, KIND, { blocks: res.blocks });
      const colorName = ['pink', 'orange', 'gold', 'green', 'blue', 'violet', 'cream', 'ink'][((Number(color) || 0) % BLOCK_COLORS.length)];
      return `Placed a ${colorName} block at (${x}, ${z}), height ${res.y + 1}. ${res.blocks.length} blocks now stand in the sandbox.`;
    }),
  });

  useWebMCP({
    name: 'sandbox_remove_block',
    description: 'Remove the top block of a column in the sandbox at x,z (0..6).',
    inputSchema: {
      type: 'object',
      properties: {
        x: { type: 'integer', minimum: 0, maximum: 6 },
        z: { type: 'integer', minimum: 0, maximum: 6 },
      },
      required: ['x', 'z'],
    },
    enabled: joined,
    execute: logged(net, 'sandbox_remove_block', ({ x, z }: { x?: number; z?: number }) => {
      const blocks = getBlocks(net.station(ID)?.state);
      const next = removeTop(blocks, Number(x), Number(z));
      if (!next) return `No block to remove at (${x}, ${z}).`;
      net.stSet(ID, KIND, { blocks: next });
      return `Removed the top block at (${x}, ${z}). ${next.length} blocks remain.`;
    }),
  });
}
