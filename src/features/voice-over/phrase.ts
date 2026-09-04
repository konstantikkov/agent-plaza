import type { PlazaMessage } from '@/entities/session/index';
import { casualToolLine } from '@/shared/lib/toolPhrases';

/** Pure text → speech-text shaping. Everything here is testable without a
 *  browser: what to say for room events, and how to turn a tool's raw
 *  result into something worth hearing. */

const MAX_SPOKEN = 220;

/** What to say for a broadcast room event (chat, tool use, arrivals). */
export function phraseForMessage(m: PlazaMessage, selfId?: string): string | null {
  const isSelf = Boolean(m.id && m.id === selfId);
  if (m.kind === 'system') return m.text;
  if (m.kind === 'chat') return isSelf ? `You say: ${m.text}` : `${m.name} says: ${m.text}`;
  // tool
  return `${isSelf ? 'You' : m.name} ${casualToolLine(m.text, isSelf)}`;
}

/** "You looked around. Two agents nearby…" — action plus what it learned. */
export function localToolNarration(tool: string, result: string): string {
  const action = `You ${casualToolLine(tool, true)}.`;
  const info = speakableResult(tool, result);
  return info ? `${action} ${info}` : action;
}

/** Turn a tool's raw return value into something listenable. */
export function speakableResult(tool: string, result: string): string {
  // the chat message broadcast already gets spoken; don't echo the receipt
  if (tool === 'say') return '';
  let text = result;
  if (tool === 'read_map') text = mapSummary(result);
  text = text
    .replace(/\s+/g, ' ')
    .replace(/[·•|]+/g, ', ')
    .trim();
  return truncateAtWord(text, MAX_SPOKEN);
}

/** The ASCII grid is meaningless out loud — keep only the prose lines. */
function mapSummary(result: string): string {
  return result
    .split('\n')
    .filter((line) => /[a-z]{3}/i.test(line) && !/^legend:/i.test(line.trim()))
    .join('. ');
}

function truncateAtWord(text: string, max: number): string {
  if (text.length <= max) return text;
  const cut = text.slice(0, max);
  const space = cut.lastIndexOf(' ');
  return `${cut.slice(0, space > max * 0.6 ? space : max)}…`;
}
