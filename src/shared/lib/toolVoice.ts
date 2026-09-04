/** A tiny bus carrying local WebMCP tool results from the tool layer to the
 *  voice-over narrator. Results are only ever spoken locally — nothing here
 *  touches the network. */

type ToolResultListener = (tool: string, result: string) => void;

const listeners = new Set<ToolResultListener>();

export function announceToolResult(tool: string, result: unknown): void {
  if (listeners.size === 0) return;
  let text: string;
  if (typeof result === 'string') text = result;
  else {
    try {
      text = JSON.stringify(result);
    } catch {
      text = String(result);
    }
  }
  listeners.forEach((cb) => cb(tool, text));
}

export function onToolResult(cb: ToolResultListener): () => void {
  listeners.add(cb);
  return () => listeners.delete(cb);
}
