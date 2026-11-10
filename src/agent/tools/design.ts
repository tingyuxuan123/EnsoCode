import { randomUUID } from 'node:crypto';
import type { ToolDefinition } from '@earendil-works/pi-coding-agent';
import { isDesignToolResult } from '@shared/design/toolResult';
import { DESIGN_TOOL_SCHEMAS, type DesignArgumentSchema } from '@shared/design/toolSchemas';
import type { ChildSessionIdentity, SessionIdentity } from '@shared/types/agent';
import {
  type DesignToolName,
  type DesignToolResult,
  designToolTimeoutMs,
} from '@shared/types/design';

export interface DesignInvokeRequest {
  identity: SessionIdentity | ChildSessionIdentity;
  requestId: string;
  tool: DesignToolName;
  params: unknown;
}
interface DesignInvokeResult {
  requestId: string;
  ok: boolean;
  result?: unknown;
  error?: string;
}
interface Pending {
  settle(result: DesignToolResult | Error, cancelRemote?: boolean): void;
}

/** Same lifetime contract as BrowserInvoker; Main owns the renderer-side execution. */
export class DesignInvoker {
  private readonly pending = new Map<string, Pending>();
  constructor(
    private readonly identity: SessionIdentity | ChildSessionIdentity,
    private readonly emit: (request: DesignInvokeRequest) => void,
    private readonly options: { emitCancel?: (requestId: string) => void } = {}
  ) {}
  invoke(tool: DesignToolName, params: unknown, signal?: AbortSignal): Promise<DesignToolResult> {
    if (signal?.aborted) return Promise.reject(new Error('Design action aborted'));
    const requestId = randomUUID();
    const { promise, resolve, reject } = Promise.withResolvers<DesignToolResult>();
    const timeoutMs = designToolTimeoutMs(tool);
    const timer = setTimeout(
      () => settle(new Error(`Design action ${tool} timed out after ${timeoutMs}ms`), true),
      timeoutMs
    );
    const onAbort = () => settle(new Error('Design action aborted'), true);
    const settle = (result: DesignToolResult | Error, cancelRemote = false) => {
      if (!this.pending.delete(requestId)) return;
      clearTimeout(timer);
      signal?.removeEventListener('abort', onAbort);
      if (cancelRemote) {
        try {
          this.options.emitCancel?.(requestId);
        } catch {
          /* Main also cancels ended generations. */
        }
      }
      if (result instanceof Error) reject(result);
      else resolve(result);
    };
    this.pending.set(requestId, { settle });
    signal?.addEventListener('abort', onAbort, { once: true });
    try {
      this.emit({ identity: this.identity, requestId, tool, params });
    } catch (error) {
      settle(error instanceof Error ? error : new Error(String(error)));
    }
    return promise;
  }
  resolve(result: DesignInvokeResult): boolean {
    const entry = this.pending.get(result.requestId);
    if (!entry) return false;
    entry.settle(
      result.ok && isDesignToolResult(result.result)
        ? result.result
        : new Error(result.error || 'Design action failed or returned malformed content')
    );
    return true;
  }
  cancelAll(reason = 'Design action cancelled'): void {
    for (const entry of [...this.pending.values()]) entry.settle(new Error(reason), true);
  }
  get pendingCount(): number {
    return this.pending.size;
  }
}

function normalizeArgument(value: unknown, schema: DesignArgumentSchema): unknown {
  if (typeof value === 'string' && ['object', 'array'].includes(schema.type)) {
    try {
      value = JSON.parse(value);
    } catch {
      return value;
    }
  }
  if (schema.type === 'object' && value && typeof value === 'object' && !Array.isArray(value)) {
    return Object.fromEntries(
      Object.entries(value).flatMap(([key, item]) => {
        if (item === undefined) return [];
        const field =
          schema.properties?.[key] ??
          (typeof schema.additionalProperties === 'object'
            ? schema.additionalProperties
            : undefined);
        if (field) return [[key, normalizeArgument(item, field)]];
        return schema.additionalProperties === false ? [] : [[key, item]];
      })
    );
  }
  if (schema.type === 'array' && Array.isArray(value) && schema.items)
    return value.map((item) => normalizeArgument(item, schema.items!));
  if (
    schema.type === 'number' &&
    typeof value === 'string' &&
    value.trim() &&
    Number.isFinite(Number(value))
  )
    return Number(value);
  if (schema.type === 'boolean' && typeof value === 'string') {
    if (value.trim().toLowerCase() === 'true') return true;
    if (value.trim().toLowerCase() === 'false') return false;
  }
  if (schema.enum && typeof value === 'string') return value.trim().toLowerCase();
  return value;
}

function assertArguments(value: unknown, schema: DesignArgumentSchema, path = 'arguments'): void {
  if (schema.type === 'object') {
    if (!value || typeof value !== 'object' || Array.isArray(value))
      throw new Error(`${path} must be an object`);
    const record = value as Record<string, unknown>;
    for (const key of schema.required ?? [])
      if (record[key] === undefined) throw new Error(`${path}.${key} is required`);
    for (const [key, item] of Object.entries(record)) {
      const field =
        schema.properties?.[key] ??
        (typeof schema.additionalProperties === 'object' ? schema.additionalProperties : undefined);
      if (field) assertArguments(item, field, `${path}.${key}`);
    }
  } else if (schema.type === 'array') {
    if (!Array.isArray(value)) throw new Error(`${path} must be an array`);
    if (value.length < (schema.minItems ?? 0) || value.length > (schema.maxItems ?? Infinity))
      throw new Error(`${path} has an invalid number of items`);
    if (schema.items) for (const item of value) assertArguments(item, schema.items, path);
  } else if (typeof value !== schema.type || (typeof value === 'number' && !Number.isFinite(value)))
    throw new Error(`${path} must be ${schema.type}`);
  if (schema.enum && !schema.enum.includes(value as string))
    throw new Error(`${path} is not allowed`);
}

function omitEmptyScreenshotSelectors(params: unknown): unknown {
  if (!params || typeof params !== 'object' || Array.isArray(params)) return params;
  const result = { ...params } as Record<string, unknown>;
  const blank = (value: unknown) => typeof value === 'string' && value.trim() === '';
  // Some models fill inactive optional fields (e.g. frame: '', frames: [''], all: true).
  // Leave non-empty conflicts and invalid types for the usual validation.
  if (blank(result.frame)) delete result.frame;
  if (Array.isArray(result.frames) && result.frames.every(blank)) delete result.frames;
  return result;
}

export function createDesignTools(
  invoker: DesignInvoker,
  options: { created?: () => void } = {}
): ToolDefinition[] {
  return DESIGN_TOOL_SCHEMAS.map(({ name, description, parameters }) => {
    const prepare = (raw: unknown) => {
      const params = normalizeArgument(raw ?? {}, parameters);
      return name === 'vetd_screenshot' ? omitEmptyScreenshotSelectors(params) : params;
    };
    return {
      name,
      label: name.replaceAll('_', ' '),
      description,
      parameters: parameters as unknown as ToolDefinition['parameters'],
      // SDK calls this before schema validation, including nested codemode calls.
      prepareArguments: prepare as ToolDefinition['prepareArguments'],
      executionMode: 'sequential',
      async execute(_id, raw, signal) {
        const params = prepare(raw);
        assertArguments(params, parameters);
        const result = await invoker.invoke(name, params, signal);
        if (name === 'vetd_create' && designCreated(result)) options.created?.();
        return { content: result.content, details: result.details };
      },
    };
  });
}

/** Runtime returns the upstream handler's object as JSON text (including ok:false). */
function designCreated(result: DesignToolResult): boolean {
  const success = (value: unknown) =>
    Boolean(
      value &&
        typeof value === 'object' &&
        (('ok' in value && value.ok === true) ||
          ('created' in value &&
            value.created === true &&
            'vetdPath' in value &&
            typeof value.vetdPath === 'string' &&
            value.vetdPath.endsWith('.vetd')))
    );
  if (success(result.details)) return true;
  return result.content.some((part) => {
    if (part.type !== 'text') return false;
    try {
      return success(JSON.parse(part.text));
    } catch {
      return false;
    }
  });
}
