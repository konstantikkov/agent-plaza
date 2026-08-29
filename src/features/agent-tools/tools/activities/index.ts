import { useWebMCP } from 'use-webmcp-tool';
import { STATIONS } from '@/entities/activities';
import { logged, type ToolCtx } from '../../toolCtx';
import { useSandboxTools } from './useSandboxTools';
import { useChessTools } from './useChessTools';
import { useGoTools } from './useGoTools';
import { useStageTools } from './useStageTools';

const HOW: Record<string, string> = {
  chess: 'chess_join, chess_board, chess_move {from,to}, chess_invite, chess_advise, chess_resign',
  go: 'go_join, go_board, go_place {x,y}, go_pass, go_invite, go_advise, go_resign',
  sandbox: 'sandbox_status, sandbox_place_block {x,z,color}, sandbox_remove_block',
  stage: 'stage_take_mic, stage_sing {title,lyrics}, stage_next_line, stage_applaud, stage_leave_stage',
};

function describeActivities(ctx: ToolCtx): string {
  const { world, net } = ctx;
  const me = world.isReady() ? world.heroCell() : null;
  const lines = STATIONS.map((s) => {
    const st = net.station(s.id);
    const seated = st ? Object.entries(st.seats) : [];
    const who = seated.length
      ? ' — ' + seated.map(([slot, id]) => `${slot}: ${net.agents().find((a) => a.id === id)?.name ?? (id === net.self?.id ? net.self?.name : 'someone')}`).join(', ')
      : '';
    const d = me ? `, ${Math.round(Math.hypot(me.x - s.cx, me.z - s.cz))} cells away` : '';
    return `• ${s.label} (${s.kind}) at (${s.cx}, ${s.cz})${d}${who}\n    tools: ${HOW[s.kind] ?? ''}`;
  });
  return [
    'Things to do in the plaza — walk_to the one you want, then use its tools:',
    lines.join('\n'),
    'Every activity is shared: other agents (and humans) see what you do live. Invite others with the game\'s invite tool or by say.',
  ].join('\n\n');
}

/** Registers `list_activities` plus every activity's tools. */
export function useActivitiesTools(ctx: ToolCtx): void {
  useWebMCP({
    name: 'list_activities',
    description:
      'List the activities in the plaza (sandbox, chess, go, hide-and-seek, song stage): where they are, who is taking part, and which tools to use for each. Call this to discover what you can do here.',
    annotations: { readOnlyHint: true },
    enabled: ctx.joined,
    execute: logged(ctx.net, 'list_activities', () => describeActivities(ctx)),
  });

  useSandboxTools(ctx);
  useChessTools(ctx);
  useGoTools(ctx);
  useStageTools(ctx);
}
