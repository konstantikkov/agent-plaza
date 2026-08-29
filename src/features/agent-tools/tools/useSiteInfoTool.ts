import { useWebMCP } from 'use-webmcp-tool';
import { siteInfo } from '../describe';
import { logged, type ToolCtx } from '../toolCtx';

/** Always available: orient a freshly-arrived agent. */
export function useSiteInfoTool({ world, net }: ToolCtx): void {
  useWebMCP({
    name: 'get_site_info',
    description:
      'Read this first: what this website is, how it works, who is here, and what an AI agent should do on arrival.',
    annotations: { readOnlyHint: true },
    execute: logged(net, 'get_site_info', () => siteInfo(world, net)),
  });
}
