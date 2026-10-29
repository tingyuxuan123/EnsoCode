import { mkdtempSync, rmSync } from 'node:fs';
import http from 'node:http';
import { tmpdir } from 'node:os';
import path from 'node:path';
import type { McpServerEntry } from '@shared/types';
import { afterEach, expect, it, vi } from 'vitest';

const fixture = vi.hoisted(() => ({ dir: '' }));
vi.mock('electron', () => ({ app: { getPath: () => fixture.dir } }));

import { listMcpOccupancyTools } from './mcpOccupancy';

let server: http.Server;
afterEach(async () => {
  server?.closeAllConnections();
  if (server) await new Promise<void>((resolve) => server.close(() => resolve()));
  if (fixture.dir) rmSync(fixture.dir, { recursive: true, force: true });
});

it.each(['http', 'sse'] as const)(
  '%s 探测请求携带 headers，轮换后重新请求而非复用缓存',
  async (transport) => {
    fixture.dir = mkdtempSync(path.join(tmpdir(), 'enso-occupancy-headers-'));
    const requests: { method: string; authorization: string | undefined }[] = [];
    let stream: http.ServerResponse | undefined;
    server = http.createServer(async (req, res) => {
      requests.push({ method: req.method!, authorization: req.headers.authorization });
      if (req.method === 'GET' && transport === 'sse') {
        stream = res;
        res.writeHead(200, { 'Content-Type': 'text/event-stream' });
        res.write('event: endpoint\ndata: /messages\n\n');
        return;
      }
      if (req.method !== 'POST') {
        res.writeHead(405).end();
        return;
      }
      let body = '';
      for await (const chunk of req) body += chunk;
      const message = JSON.parse(body);
      if (!('id' in message)) {
        res.writeHead(202).end();
        return;
      }
      const result =
        message.method === 'initialize'
          ? {
              protocolVersion: '2024-11-05',
              capabilities: { tools: {} },
              serverInfo: { name: 'fixture', version: '1' },
            }
          : { tools: [{ name: 'find', inputSchema: { type: 'object' } }] };
      const reply = JSON.stringify({ jsonrpc: '2.0', id: message.id, result });
      if (transport === 'sse') {
        res.writeHead(202).end();
        stream!.write(`event: message\ndata: ${reply}\n\n`);
      } else {
        res.writeHead(200, { 'Content-Type': 'application/json' }).end(reply);
      }
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('missing port');
    const entry: McpServerEntry = {
      id: transport,
      name: 'remote',
      transport,
      url: `http://127.0.0.1:${address.port}/mcp`,
      headers: { Authorization: 'Bearer fake-first' },
      source: 'manual',
      enabled: true,
    };
    expect(await listMcpOccupancyTools(entry)).toHaveLength(1);
    expect(requests.length).toBeGreaterThan(0);
    expect(requests.every((request) => request.authorization === 'Bearer fake-first')).toBe(true);
    const count = requests.length;
    await listMcpOccupancyTools(entry);
    expect(requests).toHaveLength(count);
    await listMcpOccupancyTools({ ...entry, headers: { Authorization: 'Bearer fake-second' } });
    expect(requests.length).toBeGreaterThan(count);
    expect(
      requests.slice(count).every((request) => request.authorization === 'Bearer fake-second')
    ).toBe(true);
    if (transport === 'sse')
      expect(requests.some((request) => request.method === 'GET')).toBe(true);
  }
);
