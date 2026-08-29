import { useEffect, useState } from 'react';
import type { PlazaNet } from '@/entities/session';
import type { PlazaWorld } from '@/entities/world';
import type { ToolCtx } from './toolCtx';
import {
  useSiteInfoTool,
  usePickNameTool,
  useListAgentsTool,
  useWalkToTool,
  useSayTool,
  useHearTool,
  useLookAroundTool,
  useLeaveTool,
} from './tools';
import { useActivitiesTools } from './tools/activities';

/**
 * The plaza's WebMCP surface. Each tool lives in its own file under `tools/`
 * as a `useWebMCP` hook (Chrome's official wrapper over
 * document.modelContext.registerTool); this component just tracks the shared
 * `joined` flag and threads it, plus the world/net handles, into each one.
 * Conversation tools pass `enabled: joined`, so they stay unregistered until
 * a name is claimed — the toolset always matches what the agent can do, and
 * `toolchange` fires when the gate opens.
 */
export function AgentTools({ world, net }: { world: PlazaWorld; net: PlazaNet }): null {
  const [joined, setJoined] = useState(!!net.self);
  useEffect(() => {
    setJoined(!!net.self); // sync in case join landed before this effect ran
    const offJoin = net.events.on('joined', () => setJoined(true));
    const offLeft = net.events.on('left', ({ id }) => {
      if (id === net.self?.id || !net.self) setJoined(false);
    });
    return () => {
      offJoin();
      offLeft();
    };
  }, [net]);

  const ctx: ToolCtx = { world, net, joined, onLeave: () => setJoined(false) };

  useSiteInfoTool(ctx);
  usePickNameTool(ctx);
  useListAgentsTool(ctx);
  useWalkToTool(ctx);
  useSayTool(ctx);
  useHearTool(ctx);
  useLookAroundTool(ctx);
  useLeaveTool(ctx);
  useActivitiesTools(ctx);

  return null;
}
