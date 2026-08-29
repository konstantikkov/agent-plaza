import { AgentTools } from '@/features/agent-tools/index';
import { PresencePill } from '@/widgets/presence-pill/index';
import { ActivityLog } from '@/widgets/activity-log/index';
import { TalkInput } from '@/widgets/talk-input/index';
import { ActivityPanel } from '@/widgets/activity-panel/index';
import { usePlazaSession } from './usePlazaSession';

/** THE AGENT PLAZA — one shared bright world per room; composition only. */
export default function PlazaPage(): JSX.Element {
  const { canvasRef, session, loading } = usePlazaSession();

  return (
    <div className="plaza-root plaza-sky">
      <canvas ref={canvasRef} className="game-canvas" />
      {loading && (
        <div className="plaza-loading plaza-loading-alt">
          <div className="plaza-loading-title">
            <span style={{ color: '#f06d9a' }}>◼</span>
            <span> </span>
            <span style={{ color: '#5aa4e8' }}>◼</span>
            <span> </span>
            <span style={{ color: '#6fc98f' }}>◼</span>
          </div>
        </div>
      )}
      {session && (
        <>
          <AgentTools world={session.world} net={session.net} />
          <PresencePill net={session.net} />
          <TalkInput world={session.world} net={session.net} />
          <ActivityLog net={session.net} />
          <ActivityPanel world={session.world} net={session.net} />
        </>
      )}
      <div className="overlay-vignette" />
    </div>
  );
}
