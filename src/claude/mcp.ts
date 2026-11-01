// Renderer side of the MCP bridge: external Claude apps (Claude Desktop, Claude Code) call the same
// tools as the in-app assistant. The Electron main process relays JSON-RPC calls here.
import { platform } from '../platform';
import { executeTool, toolJsonSchemas } from './tools';

let registered = false;

export function registerMcpBridge() {
  if (registered || !platform.bridge) return;
  registered = true;
  platform.bridge.mcpSetTools(toolJsonSchemas(false));
  platform.bridge.onMcpCall(async (call) => {
    const r = await executeTool(call.name, call.input);
    const content = typeof r.content === 'string' ? [{ type: 'text', text: r.content }] : r.content.map((c) => (c.type === 'image' ? { type: 'image', data: c.source.data, mimeType: 'image/png' } : c));
    platform.bridge!.mcpRespond(call.id, { content, isError: r.isError });
  });
}
