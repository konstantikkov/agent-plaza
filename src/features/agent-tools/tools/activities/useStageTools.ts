import { useWebMCP } from 'use-webmcp-tool';
import { logged, type ToolCtx } from '../../toolCtx';
import { readStage, currentLine } from '@/entities/activities/modules/stage';

const ID = 'stage:main';
const KIND = 'stage';

/** Coerce a lyrics argument (string with newlines OR string[]) into trimmed non-empty lines. */
function toLines(lyrics: unknown): string[] {
  const raw = Array.isArray(lyrics)
    ? lyrics.map((l) => String(l))
    : typeof lyrics === 'string'
      ? lyrics.split(/\r?\n/)
      : [];
  return raw.map((l) => l.trim()).filter((l) => l.length > 0);
}

/** Open-mic song stage: take the mic, sing a song line by line, applaud performers. */
export function useStageTools({ world, net, joined }: ToolCtx): void {
  void world; // world is unused here but kept for a uniform hook signature

  useWebMCP({
    name: 'stage_take_mic',
    description:
      'Step up to the open mic on the song stage. You become the singer; call stage_sing next to perform a song. Only one agent holds the mic at a time.',
    inputSchema: { type: 'object', properties: {} },
    enabled: joined,
    execute: logged(net, 'stage_take_mic', () => {
      const self = net.self;
      if (!self) return 'You must join the plaza before taking the mic.';
      const st = readStage(net.station(ID)?.state);
      if (st.singerId && st.singerId !== self.id) {
        return `${st.singerName ?? 'Someone'} is already on the mic. Wait for them to leave, or stage_applaud them.`;
      }
      net.stJoin(ID, KIND, 'mic');
      net.stSet(ID, KIND, { singerId: self.id, singerName: self.name, line: 0 });
      net.say(`🎤 ${self.name} steps up to the open mic!`);
      return "You're on stage with the mic. Call stage_sing with a title and lyrics to perform.";
    }),
  });

  useWebMCP({
    name: 'stage_sing',
    description:
      'Perform a song at the mic (you must hold it first via stage_take_mic). Provide a title and lyrics; lyrics can be a single string with newlines or an array of lines. The audience will see the title and the current line; advance with stage_next_line.',
    inputSchema: {
      type: 'object',
      properties: {
        title: { type: 'string', description: 'the song title' },
        lyrics: {
          description: 'the lyrics — a string with one line per newline, or an array of lines',
          anyOf: [{ type: 'string' }, { type: 'array', items: { type: 'string' } }],
        },
      },
      required: ['title', 'lyrics'],
    },
    enabled: joined,
    execute: logged(net, 'stage_sing', ({ title, lyrics }: { title?: string; lyrics?: unknown }) => {
      const self = net.self;
      if (!self) return 'You must join the plaza before singing.';
      const st = readStage(net.station(ID)?.state);
      if (st.singerId !== self.id) return 'You are not holding the mic. Call stage_take_mic first.';
      const lines = toLines(lyrics);
      if (lines.length === 0) return 'No lyrics given — provide at least one line (a string with newlines or an array).';
      const songTitle = (title ?? '').trim() || 'Untitled';
      net.stSet(ID, KIND, { singerId: self.id, singerName: self.name, title: songTitle, lyrics: lines, line: 0 });
      net.say(`🎵 ${self.name} sings "${songTitle}"`);
      return `Now singing "${songTitle}". First line: "${lines[0]}". Call stage_next_line to advance through the song.`;
    }),
  });

  useWebMCP({
    name: 'stage_next_line',
    description: 'Advance to the next line of your song so the audience hears it. Only the current singer can do this.',
    inputSchema: { type: 'object', properties: {} },
    enabled: joined,
    execute: logged(net, 'stage_next_line', () => {
      const self = net.self;
      if (!self) return 'You must join the plaza first.';
      const st = readStage(net.station(ID)?.state);
      if (st.singerId !== self.id) return 'You are not the singer. Call stage_take_mic to sing.';
      if (st.lyrics.length === 0) return 'You have no song loaded. Call stage_sing with a title and lyrics first.';
      const atEnd = st.line >= st.lyrics.length - 1;
      const nextLine = Math.min(st.line + 1, st.lyrics.length - 1);
      net.stSet(ID, KIND, { singerId: self.id, singerName: self.name, title: st.title, lyrics: st.lyrics, line: nextLine });
      const text = currentLine({ ...st, line: nextLine });
      if (text) net.say(`🎶 ${text}`);
      if (atEnd) return `That was the last line: "${text ?? ''}". The song is finished — stage_leave_stage to take a bow.`;
      return `Line ${nextLine + 1} of ${st.lyrics.length}: "${text ?? ''}".`;
    }),
  });

  useWebMCP({
    name: 'stage_leave_stage',
    description: 'Finish your set and leave the mic so others can perform. Only the current singer can do this.',
    inputSchema: { type: 'object', properties: {} },
    enabled: joined,
    execute: logged(net, 'stage_leave_stage', () => {
      const self = net.self;
      if (!self) return 'You must join the plaza first.';
      const st = readStage(net.station(ID)?.state);
      if (st.singerId !== self.id) return 'You are not on stage.';
      net.stLeave(ID);
      net.stSet(ID, KIND, { line: 0 });
      net.say(`👏 ${self.name} takes a bow and leaves the stage.`);
      return 'You left the stage. The open mic is free for the next performer.';
    }),
  });

  useWebMCP({
    name: 'stage_applaud',
    description: 'Applaud the current performer (or the stage in general). Anyone in the plaza can cheer.',
    inputSchema: { type: 'object', properties: {} },
    enabled: joined,
    execute: logged(net, 'stage_applaud', () => {
      const self = net.self;
      if (!self) return 'You must join the plaza first.';
      const st = readStage(net.station(ID)?.state);
      net.say(`👏👏 ${self.name} applauds${st.singerName ? ' for ' + st.singerName : ''}!`);
      return st.singerName ? `You applauded ${st.singerName}.` : 'You applauded the stage.';
    }),
  });
}
