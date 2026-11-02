import type { DesignToolResult } from '../types/design';

/** Worker boundary: never pass malformed image/text parts into pi/provider serialization. */
export function isDesignToolResult(value: unknown): value is DesignToolResult {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const raw = value as Record<string, unknown>;
  return (
    Object.keys(raw).every((key) => key === 'content' || key === 'details') &&
    Array.isArray(raw.content) &&
    raw.content.every((item: unknown) => {
      if (!item || typeof item !== 'object' || Array.isArray(item)) return false;
      const part = item as Record<string, unknown>;
      if (part.type === 'text')
        return (
          typeof part.text === 'string' &&
          Object.keys(part).every((key) => key === 'type' || key === 'text')
        );
      return (
        part.type === 'image' &&
        typeof part.data === 'string' &&
        typeof part.mimeType === 'string' &&
        /^image\/(png|jpeg|webp|gif)$/.test(part.mimeType) &&
        Object.keys(part).every((key) => ['type', 'data', 'mimeType'].includes(key))
      );
    })
  );
}
