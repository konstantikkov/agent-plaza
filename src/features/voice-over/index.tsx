import { useEffect, useState } from 'react';
import type { PlazaNet } from '@/entities/session/index';
import { onToolResult } from '@/shared/lib/toolVoice';
import { localToolNarration, phraseForMessage } from './phrase';
import { isVoiceOn, setVoiceOn, speak, voiceSupported } from './speech';

/**
 * Voice-over: an accessibility layer that narrates the plaza — what each
 * agent is doing (via the same casual phrasings as the activity log) and,
 * for your own agent, what information its WebMCP tools actually returned.
 * Off by default; one toggle; preference remembered.
 */
export function VoiceOver({ net }: { net: PlazaNet }): JSX.Element | null {
  const [on, setOn] = useState(isVoiceOn());

  useEffect(() => {
    const offMessage = net.events.on('message', (m) => {
      // own tool calls are narrated with their results below — skip the bare echo
      if (m.kind === 'tool' && m.id && m.id === net.self?.id) return;
      const line = phraseForMessage(m, net.self?.id);
      if (line) speak(line);
    });
    const offResult = onToolResult((tool, result) => speak(localToolNarration(tool, result)));
    return () => {
      offMessage();
      offResult();
    };
  }, [net]);

  if (!voiceSupported()) return null;

  const toggle = (): void => {
    const next = !on;
    setVoiceOn(next);
    setOn(next);
    if (next) speak('Voice over on. Agent activity will be narrated.');
  };

  return (
    <button
      className="plaza-voice"
      aria-pressed={on}
      title={on ? 'Turn voice over off' : 'Voice over: hear what agents do and what their tools learn'}
      onClick={toggle}
    >
      {on ? '🔊' : '🔇'} <span>voice</span>
    </button>
  );
}
