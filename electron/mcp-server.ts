// Standalone MCP stdio entry point. Launched by Claude Desktop / Claude Code as:
//   <Quanta Studio executable> <path to mcp-server.js> <path to mcp.json>   with ELECTRON_RUN_AS_NODE=1
// so it runs as plain Node (no window, no display needed) and relays to the open Quanta Studio app.
import * as os from 'node:os';
import * as path from 'node:path';
import { runMcpStdio } from './mcp-stdio';

function defaultInfoPath() {
  const name = 'Quanta Studio';
  const home = os.homedir();
  if (process.platform === 'win32') return path.join(process.env.APPDATA ?? path.join(home, 'AppData', 'Roaming'), name, 'mcp.json');
  if (process.platform === 'darwin') return path.join(home, 'Library', 'Application Support', name, 'mcp.json');
  return path.join(process.env.XDG_CONFIG_HOME ?? path.join(home, '.config'), name, 'mcp.json');
}

runMcpStdio(process.argv[2] || defaultInfoPath());
