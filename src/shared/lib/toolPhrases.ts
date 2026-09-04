/** Casual, story-like phrasings for WebMCP tool activity. Shared by the
 *  activity log (text) and the voice-over narrator (speech). */

const CASUAL: Record<string, string> = {
  get_site_info: 'read about the plaza',
  pick_agent_name: 'introduced themselves',
  list_agents: "checked who's around",
  walk_to: 'went for a walk',
  say: 'said something',
  hear: 'listened in',
  look_around: 'looked around',
  read_map: 'studied the map',
  leave_plaza: 'waved goodbye',
};

/** Second-person variants where "themselves" would sound wrong out loud. */
const CASUAL_SELF: Record<string, string> = {
  pick_agent_name: 'introduced yourself',
};

export function casualToolLine(tool: string, self = false): string {
  return (self && CASUAL_SELF[tool]) || CASUAL[tool] || `used ${tool.replace(/_/g, ' ')}`;
}
