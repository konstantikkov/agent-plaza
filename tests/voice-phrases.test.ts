import { phraseForMessage, localToolNarration, speakableResult } from '../src/features/voice-over/phrase';
import type { PlazaMessage } from '../src/entities/session/protocol';

const msg = (over: Partial<PlazaMessage>): PlazaMessage => ({
  seq: 1,
  ts: 0,
  kind: 'chat',
  name: 'Nova',
  text: 'hello there',
  ...over,
});

describe('voice-over phrasing', () => {
  test('chat from another agent is attributed', () => {
    expect(phraseForMessage(msg({ id: 'a1' }), 'me')).toBe('Nova says: hello there');
  });

  test('own chat uses second person', () => {
    expect(phraseForMessage(msg({ id: 'me' }), 'me')).toBe('You say: hello there');
  });

  test('system lines pass through', () => {
    expect(phraseForMessage(msg({ kind: 'system', text: 'Nova joined' }))).toBe('Nova joined');
  });

  test('remote tool use gets the casual line', () => {
    expect(phraseForMessage(msg({ kind: 'tool', id: 'a1', text: 'look_around' }), 'me')).toBe('Nova looked around');
  });

  test('own tool use avoids "themselves"', () => {
    expect(phraseForMessage(msg({ kind: 'tool', id: 'me', text: 'pick_agent_name' }), 'me')).toBe(
      'You introduced yourself',
    );
  });

  test('unknown tools still read as words', () => {
    expect(phraseForMessage(msg({ kind: 'tool', id: 'a1', text: 'dance_wildly' }))).toBe('Nova used dance wildly');
  });
});

describe('local tool narration (what the agent learned)', () => {
  test('action plus result info', () => {
    const line = localToolNarration('look_around', 'You stand by the fountain. Two agents nearby: Ash and Fern.');
    expect(line).toBe('You looked around. You stand by the fountain. Two agents nearby: Ash and Fern.');
  });

  test('say results are not echoed (the chat broadcast is spoken instead)', () => {
    expect(localToolNarration('say', 'You said "hi".')).toBe('You said something.');
  });

  test('read_map drops the ascii grid and legend, keeps the prose', () => {
    const raw = [
      'map centred on 12,8 (radius 2)',
      '. . # ~ ~',
      '. @ # ~ ~',
      '. . . T .',
      'legend: @ you · A other agent',
      'centre cell: open ground, walkable',
    ].join('\n');
    const spoken = speakableResult('read_map', raw);
    expect(spoken).toContain('map centred on 12,8');
    expect(spoken).toContain('centre cell: open ground, walkable');
    expect(spoken).not.toContain('legend');
    expect(spoken).not.toContain('@');
  });

  test('long results are truncated at a word boundary', () => {
    const long = 'word '.repeat(100).trim();
    const spoken = speakableResult('hear', long);
    expect(spoken.length).toBeLessThanOrEqual(221);
    expect(spoken.endsWith('…')).toBe(true);
  });
});
