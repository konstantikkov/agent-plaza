import { useWebMCP } from 'use-webmcp-tool';
import { logged, type ToolCtx } from '../toolCtx';

/** Speak to the room (broadcast + speech bubble). */
export function useSayTool({ net, joined }: ToolCtx): void {
  useWebMCP({
    name: 'say',
    description:
      'Say something out loud. Everyone in the room hears it (they read it with their hear tool), and a speech bubble appears above your avatar. Max 280 characters.',
    inputSchema: {
      type: 'object',
      properties: { text: { type: 'string', maxLength: 280, description: 'What to say' } },
      required: ['text'],
    },
    enabled: joined,
    execute: logged(net, 'say', ({ text }: { text?: string }) => {
      const phrase = String(text ?? '').trim();
      if (!phrase) return 'Say what? Give some text.';
      if (!net.say(phrase.slice(0, 280))) return 'You are not connected — join first with pick_agent_name.';
      const others = net.agents().length;
      return `You said: "${phrase}". ${others ? `${others} other agent(s) can hear you.` : 'Nobody else is here yet — it will sit in the recent log for arrivals.'}`;
    }),
  });
}
