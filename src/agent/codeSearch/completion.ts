import { normalizeDevinSessionToken } from '@shared/providers/devin';
import {
  chatRequest,
  gzipFrame,
  JWT_PATH,
  jwtRequest,
  jwtResponse,
  type Message,
  MODEL,
  STREAM_PATH,
  streamText,
} from './protocol';
import { boundedBody, check, deadline, fail, redact, request } from './safety';

export interface Completion {
  complete(
    system: string,
    messages: Message[],
    tools: string,
    signal: AbortSignal
  ): Promise<string>;
}

export interface CompletionSession {
  access(signal?: AbortSignal): Promise<{ token: string; signal: AbortSignal }>;
}

export interface CompletionOptions {
  fetch?: typeof fetch;
  base?: string;
  timeoutMs?: number;
}

/** Private search client; deliberately not a general model adapter. */
export class WindsurfCompletion implements Completion {
  private cached?: { token: string; jwt: string; until: number };
  private version = 0;
  readonly model = MODEL; // Endpoint's current default; no unverified protobuf model field is invented.

  constructor(
    private readonly sessions: CompletionSession,
    private readonly options: CompletionOptions = {}
  ) {}

  /** Force a fresh JWT on the next call without touching the shared credential. */
  invalidate(): void {
    this.version++;
    this.cached = undefined;
  }

  async complete(
    system: string,
    messages: Message[],
    tools: string,
    caller: AbortSignal
  ): Promise<string> {
    const access = await this.sessions.access(caller);
    const signal = deadline(access.signal, this.options.timeoutMs ?? 30_000);
    const rawToken = access.token;
    const token = normalizeDevinSessionToken(rawToken);
    const version = this.version;
    const fetcher = this.options.fetch ?? fetch;
    const post = async (path: string, body: Buffer, framed = false): Promise<Buffer> => {
      const response = await request(
        `${this.options.base ?? 'https://server.self-serve.windsurf.com'}${path}`,
        {
          method: 'POST',
          headers: {
            'content-type': framed ? 'application/connect+proto' : 'application/proto',
            'connect-protocol-version': '1',
            ...(framed
              ? {
                  'connect-accept-encoding': 'gzip',
                  'connect-content-encoding': 'gzip',
                  'connect-timeout-ms': '30000',
                }
              : {}),
          },
          body: new Uint8Array(body),
        },
        signal,
        fetcher
      );
      if (response.status === 401 || response.status === 403) {
        await response.body?.cancel();
        // The credential store is shared with normal chat; never delete it from a search failure.
        this.invalidate();
        return fail('login', 'Devin session rejected; sign in again before searching.');
      }
      if (!response.ok) {
        await response.body?.cancel();
        return fail('network', 'Devin completion request failed.');
      }
      return boundedBody(response, signal, framed ? 4 * 1024 * 1024 : 64 * 1024);
    };
    let jwt: string;
    if (this.cached?.token === token && this.cached.until > Date.now()) {
      jwt = this.cached.jwt;
    } else {
      jwt = jwtResponse(await post(JWT_PATH, jwtRequest(token))) ?? '';
      if (!jwt || jwt.length > 16_384)
        return fail('protocol', 'Devin returned no valid search JWT.');
      check(signal);
      if (version !== this.version) {
        return fail('cancelled', 'Devin credentials changed during search.');
      }
      this.cached = {
        token,
        jwt,
        until: Math.min(jwtExpiry(jwt), Date.now() + 5 * 60_000),
      };
    }
    const text = streamText(
      await post(STREAM_PATH, gzipFrame(chatRequest(token, jwt, system, messages, tools)), true)
    );
    check(signal);
    if (version !== this.version) {
      return fail('cancelled', 'Devin credentials changed during search.');
    }
    return redact(text, [rawToken, token, jwt]);
  }
}

function jwtExpiry(token: string, now = Date.now()): number {
  try {
    const body = JSON.parse(
      Buffer.from(token.split('.')[1] ?? '', 'base64url').toString('utf8')
    ) as {
      exp?: unknown;
    };
    if (typeof body.exp === 'number' && Number.isFinite(body.exp) && body.exp > 0) {
      return body.exp * 1000 - 60_000;
    }
  } catch {
    // Opaque search JWTs are only cached for the short window above.
  }
  return now + 5 * 60_000;
}
