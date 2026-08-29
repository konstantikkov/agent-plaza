import { AgentTools } from '@/features/agent-tools/index';
import { PresencePill } from '@/widgets/presence-pill/index';
import { ActivityLog } from '@/widgets/activity-log/index';
import { TalkInput } from '@/widgets/talk-input/index';
import { Map2D } from '@/widgets/map-2d/index';
import { usePlazaSession } from './usePlazaSession';

/** THE AGENT PLAZA — one shared bright world per room; composition only.
 *  With WebGL: the voxel world. Without: the 2D map. Agents get the same
 *  WebMCP tools either way. */
export default function PlazaPage(): JSX.Element {
  const { canvasRef, session, loading } = usePlazaSession();
  const is3d = !session || session.world3d !== null;

  return (
    <div className="plaza-root plaza-sky">
      {is3d && <canvas ref={canvasRef} className="game-canvas" />}
      {loading && is3d && (
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
          {session.world3d ? (
            <TalkInput world={session.world3d} net={session.net} />
          ) : (
            <Map2D world={session.world} net={session.net} />
          )}
          <ActivityLog net={session.net} />
        </>
      )}
      <div className="overlay-vignette" />
    </div>
  );
}
