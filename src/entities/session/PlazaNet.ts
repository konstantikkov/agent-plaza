import { Emitter } from '@/shared/lib/shared';
import type { JoinResult, PlazaAgentInfo, PlazaMessage, SessionEvents, StationState } from './protocol';

/**
 * The plaza wire: one WebSocket per tab, room = map seed. The world is
 * deterministic from the seed, so only presence, positions and chat travel
 * here. On every (re)connect the client re-announces its name + position —
 * a fresh server instance converges without a database. Pure state + events;
 * rendering lives in entities/agent.
 */
export class PlazaNet {
  readonly events = new Emitter<SessionEvents>();
  status: SessionEvents['status'] = 'offline';
  self: PlazaAgentInfo | null = null;
  msgs: PlazaMessage[] = [];
  stations = new Map<string, StationState>();

  private ws: WebSocket | null = null;
  private agentsById = new Map<string, PlazaAgentInfo>();
  private lastSeq = 0;
  private wantedName: string | null = null;
  private wantedKind: 'agent' | 'human' = 'human';
  private joinWaiter: ((r: JoinResult) => void) | null = null;
  private reconnectDelay = 1000;
  private timers: ReturnType<typeof setTimeout>[] = [];
  private moveTimer: ReturnType<typeof setInterval>;
  private lastSent = '';
  private disposed = false;

  constructor(
    readonly room: string,
    /** Where the local avatar stands right now (null while the world loads). */
    private getSelfState: () => { x: number; z: number; layer: 'surface' | 'cave' } | null,
  ) {
    this.connect();
    // stream our own movement: one message per cell entered, checked at 10 Hz
    this.moveTimer = setInterval(() => this.streamPosition(), 100);
  }

  agents(): PlazaAgentInfo[] {
    return [...this.agentsById.values()].filter((a) => a.id !== this.self?.id);
  }

  /** Pick (or change) a name and enter the plaza. */
  join(name: string, kind: 'agent' | 'human'): Promise<JoinResult> {
    this.wantedName = name;
    this.wantedKind = kind;
    return new Promise((resolve) => {
      this.joinWaiter = resolve;
      if (this.status === 'online') this.sendHello();
      this.timers.push(
        setTimeout(() => {
          if (this.joinWaiter === resolve) {
            this.joinWaiter = null;
            resolve({ ok: false, code: 'timeout', message: 'The plaza is not answering. Try again.' });
          }
        }, 8000),
      );
    });
  }

  say(text: string): boolean {
    if (!this.self || this.status !== 'online') return false;
    this.send({ t: 'say', text });
    return true;
  }

  /** Announce a WebMCP tool invocation so the room's activity log sees it. */
  reportTool(tool: string): void {
    if (this.self && this.status === 'online') this.send({ t: 'tool', tool });
  }

  // ---------- activity stations ----------
  station(id: string): StationState | undefined {
    return this.stations.get(id);
  }
  // Apply a change locally first (so the acting agent's next read + the view
  // see it immediately), then send; the server echo reconciles authoritatively.
  private applyLocal(id: string, kind: string, mutate: (st: StationState) => void): void {
    const cur = this.stations.get(id) ?? { id, kind, seats: {}, state: {}, version: 0 };
    const next: StationState = { id, kind: kind || cur.kind, seats: { ...cur.seats }, state: { ...cur.state }, version: cur.version + 1 };
    mutate(next);
    this.stations.set(id, next);
    this.events.emit('station', { id });
  }
  stJoin(id: string, kind: string, slot: string): void {
    this.applyLocal(id, kind, (st) => {
      for (const k of Object.keys(st.seats)) if (st.seats[k] === this.self?.id) delete st.seats[k];
      if (slot && this.self) st.seats[slot] = this.self.id;
    });
    this.send({ t: 'st-join', id, kind, slot });
  }
  stLeave(id: string): void {
    this.applyLocal(id, '', (st) => {
      for (const k of Object.keys(st.seats)) if (st.seats[k] === this.self?.id) delete st.seats[k];
    });
    this.send({ t: 'st-leave', id });
  }
  stSet(id: string, kind: string, state: Record<string, unknown>): void {
    this.applyLocal(id, kind, (st) => {
      st.state = state;
    });
    this.send({ t: 'st-set', id, kind, state });
  }
  stPatch(id: string, kind: string, patch: Record<string, unknown>): void {
    this.applyLocal(id, kind, (st) => {
      st.state = { ...st.state, ...patch };
    });
    this.send({ t: 'st-patch', id, kind, patch });
  }

  leave(): void {
    this.wantedName = null;
    this.self = null;
    this.ws?.close();
  }

  dispose(): void {
    this.disposed = true;
    clearInterval(this.moveTimer);
    this.timers.forEach(clearTimeout);
    this.ws?.close();
    this.events.clear();
  }

  // ---------- connection ----------
  private connect(): void {
    if (this.disposed) return;
    this.setStatus('connecting');
    // VITE_PLAZA_WS_URL points at a standalone server (e.g. the persistent AWS
    // host) when the static site is hosted elsewhere; default is same-origin.
    const configured = (import.meta.env as Record<string, string | undefined>).VITE_PLAZA_WS_URL;
    const proto = location.protocol === 'https:' ? 'wss' : 'ws';
    const base = configured || `${proto}://${location.host}/api/plaza`;
    const ws = new WebSocket(`${base}?room=${encodeURIComponent(this.room)}`);
    this.ws = ws;
    const ping = setInterval(() => this.send({ t: 'ping' }), 25000);
    ws.onopen = () => {
      this.reconnectDelay = 1000;
      this.setStatus('online');
      if (this.wantedName) this.sendHello(); // rejoin after a drop: same name, same spot
    };
    ws.onmessage = (event) => {
      let data: Record<string, unknown> & { t?: string };
      try {
        data = JSON.parse(String(event.data));
      } catch {
        return;
      }
      this.handle(data);
    };
    ws.onclose = () => {
      clearInterval(ping);
      this.ws = null;
      if (this.disposed) return;
      this.setStatus('offline');
      this.timers.push(setTimeout(() => this.connect(), this.reconnectDelay));
      this.reconnectDelay = Math.min(this.reconnectDelay * 2, 15000);
    };
    ws.onerror = () => ws.close();
  }

  private setStatus(status: SessionEvents['status']): void {
    this.status = status;
    this.events.emit('status', status);
  }

  private send(msg: unknown): void {
    if (this.ws?.readyState === WebSocket.OPEN) this.ws.send(JSON.stringify(msg));
  }

  private sendHello(): void {
    const at = this.getSelfState() ?? { x: 22, z: 22, layer: 'surface' as const };
    this.send({
      t: 'hello',
      name: this.wantedName,
      kind: this.wantedKind,
      color: this.self?.color ?? 0xf06d9a,
      ...at,
    });
  }

  private streamPosition(): void {
    if (!this.self || this.status !== 'online') return;
    const at = this.getSelfState();
    if (!at) return;
    const key = `${at.x},${at.z},${at.layer}`;
    if (key === this.lastSent) return;
    this.lastSent = key;
    Object.assign(this.self, at);
    this.send({ t: 'move', ...at });
  }

  // ---------- inbound ----------
  private handle(msg: Record<string, unknown> & { t?: string }): void {
    switch (msg.t) {
      case 'roster':
      case 'welcome': {
        const list = (msg.agents as PlazaAgentInfo[]) ?? [];
        this.agentsById = new Map(list.map((a) => [a.id, a]));
        for (const st of (msg.stations as StationState[]) ?? []) {
          this.stations.set(st.id, st);
          this.events.emit('station', { id: st.id });
        }
        if (msg.t === 'welcome') {
          const mine = list.find((a) => a.name.toLowerCase() === this.wantedName?.toLowerCase());
          if (mine) this.self = { ...mine, kind: this.wantedKind };
          for (const m of (msg.msgs as PlazaMessage[]) ?? []) this.pushMsg(m, false);
          this.lastSent = ''; // re-broadcast position after (re)connect
          this.joinWaiter?.({ ok: true });
          this.joinWaiter = null;
          if (this.self) this.events.emit('joined', { self: this.self });
        }
        this.events.emit('agents', this.agents());
        break;
      }
      case 'error': {
        const code = String(msg.code ?? 'error');
        if (this.joinWaiter && ['name-taken', 'bad-name', 'room-full'].includes(code)) {
          const resolve = this.joinWaiter;
          this.joinWaiter = null;
          this.wantedName = null;
          resolve({ ok: false, code, message: String(msg.message ?? '') });
        }
        break;
      }
      case 'joined':
      case 'renamed': {
        const agent = msg.agent as PlazaAgentInfo;
        this.agentsById.set(agent.id, agent);
        if (msg.sys) this.pushMsg(msg.sys as PlazaMessage);
        this.events.emit('agents', this.agents());
        break;
      }
      case 'left': {
        this.agentsById.delete(String(msg.id));
        if (msg.sys) this.pushMsg(msg.sys as PlazaMessage);
        this.events.emit('left', { id: String(msg.id) });
        this.events.emit('agents', this.agents());
        break;
      }
      case 'moved': {
        const move = msg as unknown as SessionEvents['moved'];
        const agent = this.agentsById.get(move.id);
        if (agent) Object.assign(agent, { x: move.x, z: move.z, layer: move.layer });
        this.events.emit('moved', move);
        break;
      }
      case 'said':
      case 'tool':
        this.pushMsg(msg as unknown as PlazaMessage);
        break;
      case 'st': {
        // the server is authoritative and WS is in-order — always accept its
        // snapshot (it reconciles any optimistic local change we applied).
        const st = msg as unknown as StationState;
        this.stations.set(st.id, { id: st.id, kind: st.kind, seats: st.seats, state: st.state, version: st.version });
        this.events.emit('station', { id: st.id });
        break;
      }
    }
  }

  private pushMsg(m: PlazaMessage, emit = true): void {
    if (m.seq <= this.lastSeq) return;
    this.msgs.push(m);
    this.lastSeq = m.seq;
    if (this.msgs.length > 250) this.msgs.splice(0, this.msgs.length - 250);
    if (emit) this.events.emit('message', m);
  }
}
