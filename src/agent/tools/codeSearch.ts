import path from 'node:path';
import type { JsonValue } from '@earendil-works/pi-ai';
import type { ToolDefinition } from '@earendil-works/pi-coding-agent';
import type { CodeSearchResult } from '../codeSearch/types';
import { renderSourceReferenceMarker } from '../sourceReference';

export interface CodeSearchToolDeps {
  run(
    input: { query: string; path?: string },
    cwd: string,
    signal: AbortSignal
  ): Promise<CodeSearchResult>;
}

function normalize(value: unknown): unknown {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return value;
  const record = value as Record<string, unknown>;
  return {
    ...record,
    ...(typeof record.query === 'string' ? { query: record.query.trim() } : {}),
    ...(typeof record.path === 'string' ? { path: record.path.trim() } : {}),
  };
}

const OUTPUT = {
  type: 'object',
  properties: {
    status: { type: 'string', enum: ['success', 'partial', 'no_matches', 'error'] },
    content: { type: 'string' },
    truncated: { type: 'boolean' },
    warnings: { type: 'array', items: { type: 'string' } },
    code: { type: 'string' },
    files: {
      type: 'array',
      maxItems: 8,
      items: {
        type: 'object',
        properties: {
          path: { type: 'string' },
          ranges: {
            type: 'array',
            maxItems: 16,
            items: {
              type: 'object',
              properties: {
                start: { type: 'integer', minimum: 1 },
                end: { type: 'integer', minimum: 1 },
                content: { type: 'string' },
              },
              required: ['start', 'end', 'content'],
              additionalProperties: false,
            },
          },
        },
        required: ['path', 'ranges'],
        additionalProperties: false,
      },
    },
  },
  required: ['status', 'files', 'content', 'truncated', 'warnings'],
  additionalProperties: false,
};

export function createCodeSearchTool(deps: CodeSearchToolDeps): ToolDefinition {
  return {
    name: 'code_search',
    label: 'Code search',
    description:
      'Cloud-assisted read-only code search in the current local workspace. Uses the selected Devin account; query, directory layout and selected code are sent to Devin/Windsurf. Returns bounded verified file ranges, not the internal search history.',
    promptSnippet:
      'code_search: locate an implementation by behavior or concept when you do not yet know its file or symbol name (read-only, cloud-assisted).',
    promptGuidelines: [
      'Pick the route by what you already have: a known file → read; an exact identifier or regex → grep; a behavior, data flow or relationship you can describe but not name → code_search, as the FIRST exploratory step rather than after a round of guessed grep keywords.',
      'One code_search call replaces several guess-and-grep rounds: describe the behavior or relationship to locate, not a keyword, and add path when you can narrow the subtree.',
      'Do not run code_search and grep on the same question in parallel: choose one route, then follow the verified paths it returns with read.',
      'Results may be partial. Read every returned path before editing; no_matches only covers examined scope, so if the result is thin, narrow the query or switch to grep instead of repeating it.',
    ],
    executionMode: 'sequential',
    annotations: {
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: true,
    },
    parameters: {
      type: 'object',
      properties: {
        query: {
          type: 'string',
          minLength: 1,
          maxLength: 8192,
          description: 'What implementation or relationship to locate.',
        },
        path: {
          type: 'string',
          maxLength: 1024,
          description:
            'Optional relative subdirectory within the session cwd. Defaults to the entire workspace.',
        },
      },
      required: ['query'],
      additionalProperties: false,
    } as ToolDefinition['parameters'],
    outputSchema: OUTPUT as ToolDefinition['outputSchema'],
    prepareArguments: normalize as ToolDefinition['prepareArguments'],
    async execute(toolCallId, params, caller, _onUpdate, ctx) {
      const input = normalize(params);
      if (!input || typeof input !== 'object' || Array.isArray(input))
        throw new Error('Invalid code search parameters.');
      const record = input as Record<string, unknown>;
      if (
        Object.keys(record).some((key) => key !== 'query' && key !== 'path') ||
        typeof record.query !== 'string' ||
        !record.query ||
        record.query.length > 8192
      )
        throw new Error('query must be nonempty and at most 8192 characters.');
      if (
        record.path !== undefined &&
        (typeof record.path !== 'string' ||
          record.path.length > 1024 ||
          path.isAbsolute(record.path) ||
          /^[A-Za-z]:|^\\\\/.test(record.path) ||
          record.path.split(/[\\/]/).includes('..'))
      )
        throw new Error('path must be a relative directory inside the session cwd.');
      const signal = caller ?? new AbortController().signal;
      if (signal.aborted) throw new Error('Code search cancelled.');
      const result = await deps.run(
        { query: record.query, ...(typeof record.path === 'string' ? { path: record.path } : {}) },
        ctx.cwd,
        signal
      );
      if (signal.aborted) throw new Error('Code search cancelled.');
      const files = result.files.map((file) => ({ ...file, ranges: [...file.ranges] }));
      const references = () =>
        files.map((file) => ({
          type: 'file' as const,
          path: path.resolve(ctx.cwd, file.path),
          toolName: 'code_search',
          toolCallId,
        }));
      let sourceReferences = references();
      let markers = sourceReferences.map(renderSourceReferenceMarker).join('\n');
      const max = 32 * 1024;
      const reserve = Buffer.byteLength(markers) + 160;
      const clipped = Buffer.byteLength(result.content) + reserve > max;
      let body = result.content;
      if (clipped) {
        const rebuild = () =>
          files
            .map((file) => `${file.path}\n${file.ranges.map((range) => range.content).join('\n')}`)
            .join('\n\n');
        while (
          files.length &&
          Buffer.byteLength(rebuild()) + Buffer.byteLength(markers) + 160 > max
        ) {
          const last = files.at(-1)!;
          if (last.ranges.length > 1) last.ranges.pop();
          else files.pop();
          sourceReferences = references();
          markers = sourceReferences.map(renderSourceReferenceMarker).join('\n');
        }
        body = `${rebuild()}\n[PARTIAL] Result text truncated. Narrow the search or use read for smaller windows.`;
      }
      const content = markers ? `${body}\n${markers}` : body;
      const structured = {
        ...result,
        files,
        content,
        ...(clipped
          ? {
              status: result.status === 'success' ? ('partial' as const) : result.status,
              truncated: true,
              warnings: [...result.warnings, 'Result text truncated.'],
            }
          : {}),
      };
      return {
        content: [{ type: 'text', text: content }],
        details: { ...structured, sourceReferences },
        structuredContent: JSON.parse(JSON.stringify(structured)) as JsonValue,
        isError: result.status === 'error',
      };
    },
  };
}
