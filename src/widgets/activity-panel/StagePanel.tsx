import { useState } from 'react';
import type { PlazaNet } from '@/entities/session';
import { readStage } from '@/entities/activities/modules/stage';
import { useStationState } from './useStationState';

const ID = 'stage:main';

/** Take the mic and sing — a human on the same stage agents use. */
export function StagePanel({ net }: { net: PlazaNet }): JSX.Element {
  const st = useStationState(net, ID);
  const s = readStage(st?.state);
  const myId = net.self?.id;
  const isSinger = s.singerId === myId;
  const [title, setTitle] = useState('');
  const [lyrics, setLyrics] = useState('');

  const takeMic = (): void => {
    net.stJoin(ID, 'stage', 'mic');
    net.stSet(ID, 'stage', { singerId: myId, singerName: net.self?.name, line: 0 });
    net.say(`🎤 ${net.self?.name ?? 'someone'} steps up to the open mic!`);
  };
  const sing = (): void => {
    const lines = lyrics.split('\n').map((l) => l.trim()).filter(Boolean);
    if (!title.trim() || lines.length === 0) return;
    net.stSet(ID, 'stage', { singerId: myId, singerName: net.self?.name, title: title.trim(), lyrics: lines, line: 0 });
    net.say(`🎵 ${net.self?.name ?? 'someone'} sings "${title.trim()}"`);
  };
  const nextLine = (): void => {
    const n = Math.min(s.line + 1, Math.max(0, s.lyrics.length - 1));
    net.stSet(ID, 'stage', { singerId: myId, singerName: net.self?.name, title: s.title, lyrics: s.lyrics, line: n });
    const line = s.lyrics[n];
    if (line) net.say(`🎶 ${line}`);
  };
  const leave = (): void => {
    net.stLeave(ID);
    net.stSet(ID, 'stage', { line: 0 });
    net.say(`👏 ${net.self?.name ?? 'someone'} takes a bow and leaves the stage.`);
  };

  return (
    <div className="ap-stage">
      <div className="ap-status">
        {s.singerName ? `🎤 ${s.singerName}${s.title ? ` — "${s.title}"` : ''}` : 'Open mic — nobody singing.'}
        {s.lyrics[s.line] ? <div className="ap-lyric">♪ {s.lyrics[s.line]}</div> : null}
      </div>
      {!isSinger ? (
        <div className="ap-row">
          <button className="ap-btn" onClick={takeMic}>🎤 take the mic</button>
          <button className="ap-btn" onClick={() => net.say(`👏👏 ${net.self?.name ?? 'someone'} applauds${s.singerName ? ' for ' + s.singerName : ''}!`)}>👏 applaud</button>
        </div>
      ) : (
        <>
          <input className="ap-input" placeholder="song title" value={title} onChange={(e) => setTitle(e.target.value)} />
          <textarea className="ap-input" rows={3} placeholder="lyrics — one line per row" value={lyrics} onChange={(e) => setLyrics(e.target.value)} />
          <div className="ap-row">
            <button className="ap-btn" onClick={sing}>🎵 sing</button>
            <button className="ap-btn" onClick={nextLine} disabled={s.lyrics.length === 0}>next line</button>
            <button className="ap-btn" onClick={leave}>leave stage</button>
          </div>
        </>
      )}
    </div>
  );
}
