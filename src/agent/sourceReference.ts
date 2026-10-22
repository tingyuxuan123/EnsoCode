import type { ToolDefinition } from '@earendil-works/pi-coding-agent';

export type SourceReference =
  | { type: 'file'; path: string; toolName: string; toolCallId: string }
  | { type: 'web'; url: string; toolName: string; toolCallId: string };

const SKIP_TOOLS = new Set(['bash', 'powershell', 'exec', 'code_search']);
const PATH_KEYS = ['path', 'file_path', 'target'] as const;
const URL_KEYS = ['url', 'href'] as const;

function escapeAttr(value: string): string {
  return value.replaceAll('&', '&amp;').replaceAll('"', '&quot;').replaceAll('<', '&lt;');
}

export function extractSourceReferences(
  toolName: string,
  args: unknown,
  toolCallId: string
): SourceReference[] {
  if (SKIP_TOOLS.has(toolName) || !args || typeof args !== 'object' || Array.isArray(args)) {
    return [];
  }
  const record = args as Record<string, unknown>;
  for (const key of URL_KEYS) {
    const url = record[key];
    if (typeof url === 'string' && /^https?:\/\//i.test(url.trim())) {
      return [{ type: 'web', url: url.trim(), toolName, toolCallId }];
    }
  }
  for (const key of PATH_KEYS) {
    const filePath = record[key];
    if (typeof filePath === 'string' && filePath.trim()) {
      return [{ type: 'file', path: filePath.trim(), toolName, toolCallId }];
    }
  }
  return [];
}

export function renderSourceReferenceMarker(reference: SourceReference): string {
  return reference.type === 'web'
    ? `<source_reference type="web" url="${escapeAttr(reference.url)}" />`
    : `<source_reference type="file" path="${escapeAttr(reference.path)}" />`;
}

function mergeDetails(details: unknown, references: SourceReference[]): Record<string, unknown> {
  const base =
    details && typeof details === 'object' && !Array.isArray(details)
      ? (details as Record<string, unknown>)
      : {};
  return { ...base, sourceReferences: references };
}

export function withSourceReference(definition: ToolDefinition): ToolDefinition {
  return {
    ...definition,
    async execute(toolCallId, params, signal, onUpdate, ctx) {
      const result = await definition.execute(toolCallId, params, signal, onUpdate, ctx);
      const references = extractSourceReferences(definition.name, params, toolCallId);
      if (references.length === 0) return result;
      const marker = references.map(renderSourceReferenceMarker).join('\n');
      const content = [...(result.content ?? [])];
      const firstText = content.find((part) => part.type === 'text');
      if (firstText && firstText.type === 'text') {
        firstText.text = `${firstText.text}\n${marker}`;
      } else {
        content.push({ type: 'text', text: marker });
      }
      return { ...result, content, details: mergeDetails(result.details, references) };
    },
  };
}
