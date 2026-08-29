/**
 * The full 2D-mode pipeline: FlatWorld walking → PlazaNet position streaming
 * over the (mocked) WebSocket — proving a 2D-mode agent's movement reaches
 * the wire, i.e. is visible to everyone in 3D mode.
 */
import { FlatWorld } from '@/entities/world/FlatWorld';
import { PlazaNet } from '@/entities/session/PlazaNet';

class FakeWS {
  static OPEN = 1;
  static instances: FakeWS[] = [];
  sent: string[] = [];
  readyState = 0;
  onopen: (() => void) | null = null;
  onmessage: ((e: { data: string }) => void) | null = null;
  onclose: (() => void) | null = null;
  onerror: (() => void) | null = null;

  constructor(public url: string) {
    FakeWS.instances.push(this);
  }
  send(data: string): void {
    this.sent.push(data);
  }
  close(): void {
    this.readyState = 3;
    this.onclose?.();
  }
  // test helpers
  open(): void {
    this.readyState = 1;
    this.onopen?.();
  }
  receive(obj: unknown): void {
    this.onmessage?.({ data: JSON.stringify(obj) });
  }
  frames(): { t: string; [k: string]: unknown }[] {
    return this.sent.map((s) => JSON.parse(s));
  }
}

describe('2D-mode movement reaches the wire (2D↔3D sync)', () => {
  let world: FlatWorld;
  let net: PlazaNet;
  let ws: FakeWS;

  beforeEach(async () => {
    jest.useFakeTimers();
    FakeWS.instances = [];
    (globalThis as Record<string, unknown>).WebSocket = FakeWS;

    world = new FlatWorld('orchard-vale');
    net = new PlazaNet('test-room', () => ({ ...world.heroCell(), layer: world.getLayer() }));
    ws = FakeWS.instances[0]!;
    const joinP = net.join('Walker', 'agent');
    ws.open(); // hello goes out
    const spawn = world.heroCell();
    ws.receive({
      t: 'welcome',
      id: 'a1',
      room: 'test-room',
      agents: [{ id: 'a1', name: 'Walker', color: 1, kind: 'agent', x: spawn.x, z: spawn.z, layer: 'surface' }],
      msgs: [],
    });
    await joinP;
  });

  afterEach(() => {
    net.dispose();
    world.dispose();
    jest.useRealTimers();
  });

  it('streams move messages while walking in the 2D world', async () => {
    const from = world.heroCell();
    const walk = world.walkTo(from.x, from.z - 4);
    for (let i = 0; i < 30; i++) jest.advanceTimersByTime(100); // ~3s: walk + stream
    await expect(walk).resolves.toBe('arrived');

    const moves = ws.frames().filter((f) => f.t === 'move');
    expect(moves.length).toBeGreaterThanOrEqual(3); // one per cell entered
    const last = moves[moves.length - 1]!;
    expect(last.x).toBe(from.x);
    expect(last.z).toBe(from.z - 4);
  });

  it('keeps streaming correctly under background-tab throttling (1s ticks)', async () => {
    const from = world.heroCell();
    const walk = world.walkTo(from.x, from.z - 4);
    // browser throttles timers to 1 Hz: 6 coarse ticks of 1000 ms
    for (let i = 0; i < 6; i++) jest.advanceTimersByTime(1000);
    await expect(walk).resolves.toBe('arrived');

    const moves = ws.frames().filter((f) => f.t === 'move');
    expect(moves.length).toBeGreaterThanOrEqual(1);
    const last = moves[moves.length - 1]!;
    expect(last.x).toBe(from.x);
    expect(last.z).toBe(from.z - 4); // wall-clock stepping: arrival on time despite coarse ticks
  });
});
