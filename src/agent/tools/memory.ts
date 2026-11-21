import { randomUUID } from 'node:crypto';
import type { ToolDefinition } from '@earendil-works/pi-coding-agent';
import type { ChildSessionIdentity } from '@shared/builtinAgents';
import {
  MAX_INDEX_LIMIT,
  MAX_SEARCH_LIMIT,
  NOTE_STATUSES,
  resolveMemoryLanguage,
  UPSERT_MODES,
} from '@shared/memory/constants';
import {
  MEMORY_SEARCH_SPACES,
  MEMORY_WRITE_SPACES,
  normalizeMemoryArchiveParams,
  normalizeMemoryIndexParams,
  normalizeMemoryReadParams,
  normalizeMemorySearchParams,
  normalizeMemoryUpsertParams,
} from '@shared/memory/toolParams';
import type { MemoryOp, SessionIdentity } from '@shared/types/agent';

export interface MemoryInvokeRequest<Op extends string = MemoryOp> {
  identity: SessionIdentity | ChildSessionIdentity;
  requestId: string;
  op: Op;
  params: unknown;
}

export interface MemoryInvokeResult {
  requestId: string;
  ok: boolean;
  result?: unknown;
  error?: string;
}

interface Pending {
  resolve(result: unknown): void;
  reject(error: Error): void;
}

const DEFAULT_TIMEOUT_MS = 15_000;

/**
 * worker ↔ Main 的 Wiki 记忆挂起调用表（同 BrowserInvoker 范式）。请求经 `memory-invoke` 上抛，
 * 结果经 `memory-result` 回落；abort / 超时 / shutdown 全部 fail-closed。
 */
export class MemoryInvoker<Op extends string = MemoryOp> {
  private readonly pending = new Map<string, Pending>();

  constructor(
    private readonly identity: SessionIdentity | ChildSessionIdentity,
    private readonly emit: (request: MemoryInvokeRequest<Op>) => void,
    private readonly options: { timeoutMs?: number } = {}
  ) {}

  invoke(op: Op, params: unknown, signal?: AbortSignal): Promise<unknown> {
    if (signal?.aborted) return Promise.reject(new Error('Memory action aborted'));
    const requestId = randomUUID();
    const { promise, resolve, reject } = Promise.withResolvers<unknown>();
    const timeoutMs = this.options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    const timer = setTimeout(
      () => settle(new Error(`Memory action ${op} timed out after ${timeoutMs}ms`)),
      timeoutMs
    );
    const onAbort = () => settle(new Error('Memory action aborted'));
    const settle = (outcome: unknown) => {
      if (!this.pending.delete(requestId)) return;
      clearTimeout(timer);
      signal?.removeEventListener('abort', onAbort);
      if (outcome instanceof Error) reject(outcome);
      else resolve(outcome);
    };
    this.pending.set(requestId, { resolve: settle, reject: settle });
    signal?.addEventListener('abort', onAbort, { once: true });
    try {
      this.emit({ identity: this.identity, requestId, op, params });
    } catch (error) {
      settle(error instanceof Error ? error : new Error(String(error)));
    }
    return promise;
  }

  resolve(result: MemoryInvokeResult): boolean {
    const entry = this.pending.get(result.requestId);
    if (!entry) return false;
    if (result.ok) entry.resolve(result.result);
    else entry.reject(new Error(result.error || 'Memory action failed'));
    return true;
  }

  cancelAll(reason = 'Memory action cancelled'): void {
    for (const entry of [...this.pending.values()]) entry.reject(new Error(reason));
  }

  get pendingCount(): number {
    return this.pending.size;
  }
}

const schema = (
  properties: Record<string, unknown>,
  required: string[]
): ToolDefinition['parameters'] =>
  ({
    type: 'object',
    properties,
    required,
    additionalProperties: false,
  }) as unknown as ToolDefinition['parameters'];

const textResult = (value: unknown) => ({
  content: [{ type: 'text' as const, text: JSON.stringify(value) }],
  details: undefined,
});

const requireText = (params: Record<string, unknown>, key: string): void => {
  const value = params[key];
  if (typeof value !== 'string' || !value.trim()) throw new Error(`${key} is required`);
};

function languageHint(language: string | undefined): string {
  const resolved = resolveMemoryLanguage(language);
  const label =
    resolved === 'zh'
      ? 'Simplified Chinese'
      : resolved === 'auto'
        ? "the user's own language"
        : 'English';
  return (
    ` Notes are written in ${label}; keep code identifiers, file paths, and proper nouns verbatim ` +
    'so cross-language lookups match reliably.'
  );
}

/**
 * Wiki 记忆工具（5 个精简动作：index / search / read / upsert / archive）。
 * 每个属性都显式声明完整 JSON Schema 类型；归一化在 prepareArguments 内、schema 校验之前执行。
 */
export function createMemoryTools(
  invoker: MemoryInvoker,
  opts: { language?: string } = {}
): ToolDefinition[] {
  const define = (
    name: string,
    label: string,
    description: string,
    parameters: ToolDefinition['parameters'],
    op: MemoryOp,
    normalize: (raw: unknown) => Record<string, unknown>,
    requiredKeys: readonly string[]
  ): ToolDefinition => ({
    name,
    label,
    description,
    parameters,
    prepareArguments: normalize as unknown as ToolDefinition['prepareArguments'],
    async execute(_toolCallId, params, signal) {
      const normalized = normalize(params ?? {});
      for (const key of requiredKeys) requireText(normalized, key);
      return textResult(await invoker.invoke(op, normalized, signal));
    },
  });

  return [
    define(
      'memory_index',
      'Memory index',
      'List the compact wiki catalog (slug, title, type, one-line description, status) and vault schema rules. ' +
        'Call this before writing new knowledge so you can follow vault categories and update existing pages instead of duplicating them. ' +
        'Do not call it on every trivial question; use it when reviewing prior knowledge or preparing to capture durable conclusions.',
      schema(
        {
          spaceId: {
            type: 'string',
            enum: [...MEMORY_SEARCH_SPACES],
            description:
              "Omit for the current project, group, or member vault (falls back to 'global' when none). " +
              "Use 'global' for cross-project preferences or 'all' for cross-scope overview.",
          },
          type: {
            type: 'string',
            description:
              'Optional category filter (e.g. systems, incidents, decisions, preferences)',
          },
          limit: {
            type: 'integer',
            minimum: 1,
            maximum: MAX_INDEX_LIMIT,
            description: 'Max entries to return (default 80)',
          },
          includeRaw: {
            type: 'boolean',
            description:
              'Include read-only raw/ reference files (e.g. DB schemas, PRDs). Default false.',
          },
        },
        []
      ),
      'index',
      normalizeMemoryIndexParams,
      []
    ),
    define(
      'memory_search',
      'Memory search',
      'Search the Obsidian-compatible Markdown wiki by keywords, category, or status. ' +
        'Returns matching note summaries, trust status (draft/verified), and 1-hop [[wikilink]] neighbors. ' +
        'Use concise keywords (1–4 distinctive terms), not full sentences. Only search when prior decisions, ' +
        'incidents, domain rules, or standing preferences would change what you do.' +
        languageHint(opts.language),
      schema(
        {
          query: {
            type: 'string',
            description:
              'Keywords or phrase to search across titles, descriptions, tags, and bodies',
          },
          spaceId: {
            type: 'string',
            enum: [...MEMORY_SEARCH_SPACES],
            description: "Omit for the active scope; use 'global' or 'all' when needed.",
          },
          type: {
            type: 'string',
            description:
              'Optional category filter (e.g. systems, domains, incidents, practices, workflows)',
          },
          status: {
            type: 'string',
            enum: [...NOTE_STATUSES],
            description: 'Optional trust-status filter: draft, verified, or deprecated',
          },
          limit: {
            type: 'integer',
            minimum: 1,
            maximum: MAX_SEARCH_LIMIT,
            description: 'Max results to return (default 8)',
          },
        },
        ['query']
      ),
      'search',
      normalizeMemorySearchParams,
      ['query']
    ),
    define(
      'memory_read',
      'Memory read',
      'Read the full Markdown content, OKF frontmatter, outbound [[wikilink]]s, and backlinks of one wiki note ' +
        '(or read-only raw/ reference). For a memory_search hit, pass its full id verbatim as note, not its slug. ' +
        'For an ambiguous short reference, retry with a candidate id.',
      schema(
        {
          note: {
            type: 'string',
            description:
              'Copy the full memory_search hit id verbatim (e.g. global::wiki/systems/auth.md). ' +
              'You can also use an unambiguous short name, slug, relative path, or title.',
          },
          spaceId: {
            type: 'string',
            enum: [...MEMORY_SEARCH_SPACES],
            description: "Optional scope narrowing; defaults to searching visible scopes ('all').",
          },
        },
        ['note']
      ),
      'read',
      normalizeMemoryReadParams,
      ['note']
    ),
    define(
      'memory_upsert',
      'Memory upsert',
      'Create or update an Evergreen Markdown wiki page (OKF v0.2 frontmatter + [[wikilink]]). ' +
        'Capture ONLY at high-value moments (zero writes is normal): ' +
        '(1) root-cause incident wrap-up, (2) lasting mental-model breakthrough, ' +
        '(3) second occurrence of a recurring issue/reminder, or (4) confirmed user decision / standing preference. ' +
        'Always search or inspect memory_index first — UPDATE an existing page (mode=section or append or replace) over creating duplicates. ' +
        'Interlink related pages with [[slug]] syntax, include a 1-line description, and cite sources when known. ' +
        'Do NOT overwrite raw/ files or write routine fixes, temporary plans, or unaccepted suggestions.' +
        languageHint(opts.language),
      schema(
        {
          note: {
            type: 'string',
            description:
              'Target slug or relative path (e.g. incidents/oauth-refresh). Omit only when creating a brand-new page (derived from type/title).',
          },
          title: {
            type: 'string',
            description: 'Concise human-readable page title (max 120 chars)',
          },
          type: {
            type: 'string',
            description:
              'Open-vocabulary category matching the vault schema (e.g. systems, domains, incidents, practices, workflows, decisions, preferences, notes)',
          },
          description: {
            type: 'string',
            description: 'One-line summary shown in index.md and search results (max 240 chars)',
          },
          content: {
            type: 'string',
            description:
              'Markdown body (or section body when mode=section), using [[slug]] wikilinks to related pages',
          },
          mode: {
            type: 'string',
            enum: [...UPSERT_MODES],
            description:
              "'replace' overwrites body (default for new notes); 'append' adds to end; 'section' replaces/appends one heading specified in section",
          },
          section: {
            type: 'string',
            description: 'Heading title to replace or append when mode=section (without leading #)',
          },
          tags: {
            type: 'array',
            items: { type: 'string' },
            description: 'Short keyword tags for filtering',
          },
          sources: {
            type: 'array',
            items: { type: 'string' },
            description: 'Evidence references such as code paths, URLs, or raw notes',
          },
          resource: {
            type: 'string',
            description:
              'Optional primary code path, API endpoint, or entity URI this page describes',
          },
          staleAfter: {
            type: 'string',
            description: 'Optional re-verification deadline in YYYY-MM-DD format',
          },
          spaceId: {
            type: 'string',
            enum: [...MEMORY_WRITE_SPACES],
            description:
              "'project' = current project vault (default outside Bot mode); 'global' = cross-project vault; " +
              "'bot' = member private vault; 'chat' = shared group vault",
          },
        },
        ['title', 'type', 'content']
      ),
      'upsert',
      normalizeMemoryUpsertParams,
      ['title', 'content']
    ),
    define(
      'memory_archive',
      'Memory archive',
      'Soft-archive an obsolete or superseded wiki page: marks status=deprecated, optionally links supersededBy, ' +
        'and moves it into archive/ while recording log.md. Use only when the user confirms a page is obsolete or replaced.',
      schema(
        {
          note: {
            type: 'string',
            description: 'Slug, relative path, or exact title of the note to archive',
          },
          reason: {
            type: 'string',
            description: 'Brief reason why this page is being archived',
          },
          supersededBy: {
            type: 'string',
            description: 'Optional [[new-slug]] wikilink pointing to the replacement page',
          },
          spaceId: {
            type: 'string',
            enum: [...MEMORY_WRITE_SPACES],
            description: 'Target space; defaults to the active project or bot space',
          },
        },
        ['note']
      ),
      'archive',
      normalizeMemoryArchiveParams,
      ['note']
    ),
  ];
}
