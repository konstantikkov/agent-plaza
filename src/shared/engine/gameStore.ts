import { create } from 'zustand';
import { subscribeWithSelector } from 'zustand/middleware';

/**
 * Minimal UI store. The engine writes
 * dialogue/toast/objective UI from this state; here it simply tracks the
 * values here; the plaza plays wordlessly.
 */

export interface DialogueState {
  npcId: string;
  npcName: string;
  lines: string[];
  index: number;
}

interface GameState {
  dialogue: DialogueState | null;
  dialogueEndedNpcId: string | null;
  objective: string;
  toast: string | null;
  setObjective(text: string): void;
  showToast(text: string): void;
  openDialogue(input: { npcId: string; npcName: string; lines: string[] }): void;
  advanceDialogue(): void;
  consumeDialogueEnded(): void;
}

export const useGameStore = create<GameState>()(
  subscribeWithSelector((set, get) => ({
    dialogue: null,
    dialogueEndedNpcId: null,
    objective: '',
    toast: null,
    setObjective: (text) => set({ objective: text }),
    showToast: (text) => set({ toast: text }),
    openDialogue: (input) => set({ dialogue: { ...input, index: 0 } }),
    advanceDialogue: () => {
      const d = get().dialogue;
      if (!d) return;
      if (d.index + 1 >= d.lines.length) {
        set({ dialogue: null, dialogueEndedNpcId: d.npcId });
      } else {
        set({ dialogue: { ...d, index: d.index + 1 } });
      }
    },
    consumeDialogueEnded: () => set({ dialogueEndedNpcId: null }),
  })),
);
