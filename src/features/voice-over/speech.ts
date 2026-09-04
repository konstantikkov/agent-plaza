/** The speaking half of voice-over: a small queue over the Web Speech API.
 *  Off by default (audio should never start itself), preference persisted,
 *  backlog capped so a burst of agent activity doesn't narrate the past. */

const STORAGE_KEY = 'plaza-voice-over';
const MAX_QUEUE = 3;

let enabled = false;
let pending = 0;

try {
  enabled = localStorage.getItem(STORAGE_KEY) === 'on';
} catch {
  /* storage may be unavailable; stay off */
}

export function voiceSupported(): boolean {
  return typeof window !== 'undefined' && 'speechSynthesis' in window;
}

export function isVoiceOn(): boolean {
  return enabled && voiceSupported();
}

export function setVoiceOn(on: boolean): void {
  enabled = on;
  try {
    localStorage.setItem(STORAGE_KEY, on ? 'on' : 'off');
  } catch {
    /* fine */
  }
  if (!on && voiceSupported()) {
    window.speechSynthesis.cancel();
    pending = 0;
  }
}

export function speak(text: string): void {
  if (!isVoiceOn() || !text) return;
  const synth = window.speechSynthesis;
  if (pending >= MAX_QUEUE) {
    // several busy agents can outpace speech; keep the present, drop the backlog
    synth.cancel();
    pending = 0;
  }
  const u = new SpeechSynthesisUtterance(text);
  u.rate = 1.06;
  u.lang = 'en-GB';
  u.onend = () => {
    pending = Math.max(0, pending - 1);
  };
  u.onerror = u.onend as never;
  pending++;
  synth.speak(u);
}
