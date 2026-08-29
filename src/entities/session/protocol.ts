/** Wire types shared with api/plaza.js. */

export interface PlazaAgentInfo {
  id: string;
  name: string;
  color: number;
  kind: 'agent' | 'human';
  x: number;
  z: number;
  layer: 'surface' | 'cave';
}

export interface PlazaMessage {
  seq: number;
  ts: number;
  kind: 'chat' | 'system' | 'tool';
  id?: string;
  name: string;
  agentKind?: 'agent' | 'human';
  x?: number;
  z?: number;
  text: string;
}

export type JoinResult = { ok: true } | { ok: false; code: string; message: string };

/** An activity station's shared state (opaque to the server, owned by clients). */
export interface StationState {
  id: string;
  kind: string;
  seats: Record<string, string>; // slot -> agentId
  state: Record<string, unknown>;
  version: number;
}

export type SessionEvents = {
  status: 'connecting' | 'online' | 'offline';
  joined: { self: PlazaAgentInfo };
  agents: PlazaAgentInfo[];
  moved: { id: string; x: number; z: number; layer: 'surface' | 'cave' };
  left: { id: string };
  message: PlazaMessage;
  station: { id: string };
};
