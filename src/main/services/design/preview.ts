import { randomUUID } from 'node:crypto';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import type { DesignPreviewRequest, DesignPreviewResponse } from '@shared/types/design';
import { DesignServiceError, MAX_FILE_BYTES, tooLarge } from './errors';

export const DESIGN_PREVIEW_CSP =
  "default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data: blob:; font-src data:; media-src data: blob:; connect-src 'none'; frame-src 'self' about:; base-uri 'none'; form-action 'none'; sandbox allow-scripts";
const services = new Set<DesignPreviewService>();
export function designPreviewPorts(owner: number): ReadonlySet<number> {
  return new Set([...services].flatMap((service) => service.portFor(owner)));
}

/** No disk paths, preload, external fetches, or CORS API are exposed by this server. */
export class DesignPreviewService {
  private readonly entries = new Map<string, { owner: number; html: string }>();
  private readonly closed = new Set<number>();
  private server?: Server;
  private starting?: Promise<number>;
  private port?: number;
  private disposed = false;
  constructor() {
    services.add(this);
  }
  portFor(owner: number): number[] {
    return this.port && [...this.entries.values()].some((entry) => entry.owner === owner)
      ? [this.port]
      : [];
  }
  private start(): Promise<number> {
    if (this.starting) return this.starting;
    this.starting = new Promise((resolve, reject) => {
      const server = createServer((request, response) => {
        response.setHeader('Cache-Control', 'no-store');
        response.setHeader('X-Content-Type-Options', 'nosniff');
        response.setHeader('Referrer-Policy', 'no-referrer');
        if (request.method !== 'GET') {
          response.writeHead(405).end();
          return;
        }
        if (request.headers.host !== `127.0.0.1:${this.port}`) {
          response.writeHead(403).end();
          return;
        }
        const token = request.url?.match(/^\/([0-9a-f-]{36})\/index\.html(?:\?.*)?$/)?.[1];
        const entry = token ? this.entries.get(token) : null;
        if (!entry) {
          response.writeHead(404).end();
          return;
        }
        response.writeHead(200, {
          'Content-Type': 'text/html; charset=utf-8',
          'Content-Security-Policy': DESIGN_PREVIEW_CSP,
        });
        response.end(entry.html);
      });
      this.server = server;
      server.once('error', reject);
      server.listen(0, '127.0.0.1', () => {
        this.port = (server.address() as AddressInfo).port;
        resolve(this.port);
      });
    });
    return this.starting;
  }
  async request(owner: number, request: DesignPreviewRequest): Promise<DesignPreviewResponse> {
    if (this.disposed || this.closed.has(owner))
      throw new DesignServiceError('ABORTED', 'Preview owner closed');
    if (request.op === 'close') {
      const entry = this.entries.get(request.previewId);
      if (entry && entry.owner !== owner)
        throw new DesignServiceError('PERMISSION_DENIED', 'Preview belongs to another window');
      this.entries.delete(request.previewId);
      return { ok: true };
    }
    if (Buffer.byteLength(request.html) > MAX_FILE_BYTES) tooLarge();
    const port = await this.start();
    if (this.disposed || this.closed.has(owner))
      throw new DesignServiceError('ABORTED', 'Preview owner closed');
    if ([...this.entries.values()].filter((entry) => entry.owner === owner).length >= 8)
      throw new DesignServiceError('ENGINE_LIMIT', 'At most 8 share previews can be open');
    const previewId = randomUUID();
    this.entries.set(previewId, { owner, html: request.html });
    return { ok: true, previewId, url: `http://127.0.0.1:${port}/${previewId}/index.html` };
  }
  releaseOwner(owner: number): void {
    this.closed.add(owner);
    for (const [id, entry] of this.entries) if (entry.owner === owner) this.entries.delete(id);
  }
  async dispose(): Promise<void> {
    this.disposed = true;
    this.entries.clear();
    services.delete(this);
    if (this.starting) await this.starting.catch(() => {});
    this.server?.closeAllConnections();
    if (this.server?.listening)
      await new Promise<void>((resolve) => this.server!.close(() => resolve()));
  }
}
