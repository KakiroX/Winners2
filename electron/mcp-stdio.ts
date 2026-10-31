// Minimal Model Context Protocol server over stdio (JSON-RPC 2.0, newline-delimited).
// It relays tool calls to the running Quanta Studio window through a localhost endpoint
// described in <userData>/mcp.json (port + bearer token), written when the user enables MCP access.
import * as fs from 'node:fs';
import * as http from 'node:http';
import * as readline from 'node:readline';

const PROTOCOL_VERSION = '2025-06-18';

function readInfo(infoPath: string): { port: number; token: string; tools: any[] } | null {
  try {
    return JSON.parse(fs.readFileSync(infoPath, 'utf8'));
  } catch {
    return null;
  }
}

function post(info: { port: number; token: string }, route: string, body: any): Promise<any> {
  return new Promise((resolve, reject) => {
    const data = JSON.stringify(body);
    const req = http.request({ host: '127.0.0.1', port: info.port, path: route, method: 'POST', headers: { 'content-type': 'application/json', 'content-length': Buffer.byteLength(data), authorization: `Bearer ${info.token}` } }, (res) => {
      let out = '';
      res.on('data', (c) => (out += c));
      res.on('end', () => {
        try {
          resolve(JSON.parse(out));
        } catch (e) {
          reject(e);
        }
      });
    });
    req.on('error', reject);
    req.end(data);
  });
}

const NOT_RUNNING = 'Quanta Studio is not running, or external Claude access is disabled. Open Quanta Studio and enable "Allow external Claude apps" in Settings → Claude.';

export function runMcpStdio(infoPath: string) {
  const write = (msg: any) => process.stdout.write(JSON.stringify(msg) + '\n');
  const rl = readline.createInterface({ input: process.stdin });
  rl.on('line', async (line) => {
    if (!line.trim()) return;
    let msg: any;
    try {
      msg = JSON.parse(line);
    } catch {
      write({ jsonrpc: '2.0', id: null, error: { code: -32700, message: 'Parse error' } });
      return;
    }
    const { id, method, params } = msg;
    const reply = (result: any) => id !== undefined && write({ jsonrpc: '2.0', id, result });
    const fail = (code: number, message: string) => id !== undefined && write({ jsonrpc: '2.0', id, error: { code, message } });
    try {
      switch (method) {
        case 'initialize':
          return reply({ protocolVersion: params?.protocolVersion ?? PROTOCOL_VERSION, capabilities: { tools: { listChanged: false } }, serverInfo: { name: 'quanta-studio', version: '1.0.0' }, instructions: 'Tools operate on the project currently open in Quanta Studio: data tables, statistical analyses, graphs, MATLAB-language code and figures.' });
        case 'notifications/initialized':
        case 'notifications/cancelled':
          return;
        case 'ping':
          return reply({});
        case 'tools/list': {
          const info = readInfo(infoPath);
          const tools = (info?.tools ?? []).map((t: any) => ({ name: t.name, description: t.description, inputSchema: t.input_schema }));
          return reply({ tools });
        }
        case 'tools/call': {
          const info = readInfo(infoPath);
          if (!info?.port) return reply({ content: [{ type: 'text', text: NOT_RUNNING }], isError: true });
          try {
            const r = await post(info, '/call', { name: params?.name, arguments: params?.arguments ?? {} });
            return reply(r);
          } catch {
            return reply({ content: [{ type: 'text', text: NOT_RUNNING }], isError: true });
          }
        }
        default:
          return fail(-32601, `Method not found: ${method}`);
      }
    } catch (e: any) {
      return fail(-32603, e?.message ?? String(e));
    }
  });
  rl.on('close', () => process.exit(0));
}
