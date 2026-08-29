/**
 * The WebMCP surface, end to end in jsdom: a mock document.modelContext
 * captures registerTool calls, AgentTools renders with fake world/net, and we
 * assert the tools are registered, described, gated, and actually execute.
 */
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { createElement } from 'react';
import { AgentTools } from '@/features/agent-tools/index';
import { Emitter } from '@/shared/lib/shared';
import type { PlazaNet } from '@/entities/session/index';
import type { PlazaWorld } from '@/entities/world/index';

interface ToolResult {
  content: { type: string; text?: string }[];
  isError?: boolean;
}
interface RegisteredTool {
  name: string;
  description: string;
  inputSchema?: { type?: string; properties?: Record<string, unknown>; required?: string[] };
  execute(args: Record<string, unknown>): Promise<ToolResult> | ToolResult;
}

const tools = new Map<string, RegisteredTool>();

beforeAll(() => {
  (document as unknown as { modelContext: unknown }).modelContext = {
    registerTool(tool: RegisteredTool, opts?: { signal?: AbortSignal }) {
      tools.set(tool.name, tool);
      opts?.signal?.addEventListener('abort', () => {
        if (tools.get(tool.name) === tool) tools.delete(tool.name);
      });
      return Promise.resolve();
    },
  };
});

async function call(name: string, args: Record<string, unknown> = {}): Promise<string> {
  const tool = tools.get(name);
  if (!tool) throw new Error(`tool not registered: ${name}`);
  let out = '';
  await act(async () => {
    const res = await tool.execute(args);
    out = (res.content ?? []).map((c) => c.text ?? '').join('\n');
  });
  return out;
}

/** A minimal in-memory PlazaNet double. */
function makeFakeNet() {
  const events = new Emitter<Record<string, unknown>>();
  const said: string[] = [];
  const reported: string[] = [];
  const net = {
    events,
    status: 'online' as const,
    room: 'test-room',
    self: null as { id: string; name: string; color: number; kind: string; x: number; z: number; layer: string } | null,
    msgs: [] as { seq: number; ts: number; kind: string; id?: string; name: string; text: string }[],
    agents: () => [{ id: 'a2', name: 'Scout', color: 0x5aa4e8, kind: 'agent', x: 20, z: 20, layer: 'surface' }],
    join: async (name: string, kind: 'agent' | 'human') => {
      net.self = { id: 'a1', name, color: 0xf06d9a, kind, x: 22, z: 22, layer: 'surface' };
      events.emit('joined', { self: net.self });
      return { ok: true as const };
    },
    say: (text: string) => {
      said.push(text);
      return true;
    },
    reportTool: (tool: string) => {
      reported.push(tool);
    },
    leave: () => {
      net.self = null;
    },
  };
  return { net: net as unknown as PlazaNet, said, reported };
}

/** A minimal PlazaWorld double. */
function makeFakeWorld() {
  return {
    isReady: () => true,
    heroCell: () => ({ x: 22, z: 22 }),
    getLayer: () => 'surface' as const,
    getPlaces: () => [
      { kind: 'portal', x: 10, z: 15 },
      { kind: 'pond', x: 30, z: 8 },
    ],
    exportWorld: () => ({
      version: 1,
      seed: 'test-seed',
      size: 44,
      archetype: 'garden',
      daytime: 'day',
      weather: 'clear',
      levels: [],
      entities: [
        { id: 'portal', kind: 'portal', category: 'portal', x: 10, z: 15, layer: 'surface', alive: false, solid: true, interactive: true, source: 'generated' },
      ],
      note: '',
    }),
    walkTo: async () => 'arrived' as const,
    cellInfo: (x: number, z: number) =>
      x < 0 || z < 0 || x > 43 || z > 43 ? { walkable: false, kind: 'edge' } : { walkable: true, kind: 'ground' },
  } as unknown as PlazaWorld;
}

describe('WebMCP tool surface', () => {
  let root: Root;
  let container: HTMLDivElement;
  let fake: ReturnType<typeof makeFakeNet>;

  beforeEach(async () => {
    tools.clear();
    fake = makeFakeNet();
    container = document.createElement('div');
    document.body.appendChild(container);
    await act(async () => {
      root = createRoot(container);
      root.render(createElement(AgentTools, { world: makeFakeWorld(), net: fake.net }));
    });
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    container.remove();
  });

  it('registers only the arrival tools before a name is claimed', () => {
    expect([...tools.keys()].sort()).toEqual(['get_site_info', 'pick_agent_name']);
  });

  it('every registered tool carries a meaningful description', async () => {
    await call('pick_agent_name', { name: 'Marco' }); // unlock the full surface
    expect(tools.size).toBe(9);
    for (const [name, tool] of tools) {
      expect(tool.description.length).toBeGreaterThan(30);
      expect(typeof name).toBe('string');
    }
    // tools that take arguments describe them with a JSON schema
    for (const name of ['pick_agent_name', 'walk_to', 'say', 'hear']) {
      const schema = tools.get(name)!.inputSchema;
      expect(schema?.type).toBe('object');
      expect(Object.keys(schema?.properties ?? {}).length).toBeGreaterThan(0);
    }
  });

  it('get_site_info orients an agent before joining', async () => {
    const text = await call('get_site_info');
    expect(text).toContain('AGENT PLAZA');
    expect(text).toContain('pick_agent_name');
  });

  it('pick_agent_name unlocks the conversation tools (toolchange gate)', async () => {
    const reply = await call('pick_agent_name', { name: 'Marco' });
    expect(reply).toContain('Marco');
    expect([...tools.keys()].sort()).toEqual([
      'get_site_info',
      'hear',
      'leave_plaza',
      'list_agents',
      'look_around',
      'pick_agent_name',
      'read_map',
      'say',
      'walk_to',
    ]);
  });

  it('read_map returns the landscape as ASCII data with a legend', async () => {
    await call('pick_agent_name', { name: 'Marco' });
    const text = await call('read_map', { radius: 3 });
    expect(text).toContain('@'); // you
    expect(text).toContain('legend:');
    expect(text).toContain('walk_to');
  });

  it('list_agents reports who is here with distances', async () => {
    await call('pick_agent_name', { name: 'Marco' });
    const text = await call('list_agents');
    expect(text).toContain('Scout');
    expect(text).toContain('cells away');
  });

  it('walk_to path-finds and reports arrival', async () => {
    await call('pick_agent_name', { name: 'Marco' });
    const text = await call('walk_to', { x: 23, z: 22 });
    expect(text).toMatch(/now stand at/);
  });

  it('say broadcasts and reports listeners', async () => {
    await call('pick_agent_name', { name: 'Marco' });
    const text = await call('say', { text: 'hello plaza' });
    expect(text).toContain('You said');
    expect(fake.said).toContain('hello plaza');
  });

  it('hear returns silence when nothing new was said', async () => {
    await call('pick_agent_name', { name: 'Marco' });
    const text = await call('hear', {});
    expect(text).toContain('Silence');
  });

  it('look_around describes the world and named places', async () => {
    await call('pick_agent_name', { name: 'Marco' });
    const text = await call('look_around');
    expect(text).toContain('test-seed');
    expect(text).toContain('portal');
  });

  it('every tool call is reported to the room activity log', async () => {
    await call('pick_agent_name', { name: 'Marco' });
    await call('list_agents');
    await call('say', { text: 'hi' });
    expect(fake.reported).toEqual(expect.arrayContaining(['pick_agent_name', 'list_agents', 'say']));
  });

  it('unmount unregisters everything (AbortSignal lifecycle)', async () => {
    await call('pick_agent_name', { name: 'Marco' });
    expect(tools.size).toBe(9);
    await act(async () => root.unmount());
    expect(tools.size).toBe(0);
    // re-mount for afterEach symmetry
    await act(async () => {
      root = createRoot(container);
      root.render(createElement(AgentTools, { world: makeFakeWorld(), net: fake.net }));
    });
  });
});
