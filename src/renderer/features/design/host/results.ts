import type { DesignToolContent, DesignToolResult } from '@shared/types/design';

export function toDesignToolResult(value: unknown): DesignToolResult {
  if (value && typeof value === 'object' && 'content' in value && Array.isArray(value.content)) {
    const content: DesignToolContent[] = value.content.map((item: unknown) => {
      if (!item || typeof item !== 'object') throw new Error('Invalid design tool content');
      if ('type' in item && item.type === 'text' && 'text' in item && typeof item.text === 'string')
        return { type: 'text', text: item.text };
      if ('type' in item && item.type === 'image') {
        if (
          'data' in item &&
          typeof item.data === 'string' &&
          'mimeType' in item &&
          typeof item.mimeType === 'string'
        )
          return { type: 'image', data: item.data, mimeType: item.mimeType };
        const url = 'dataUrl' in item ? item.dataUrl : 'url' in item ? item.url : null;
        const match =
          typeof url === 'string'
            ? /^data:(image\/[\w.+-]+);base64,([A-Za-z0-9+/=\s]+)$/.exec(url)
            : null;
        if (match) return { type: 'image', data: match[2], mimeType: match[1] };
      }
      throw new Error('Unsupported design tool content');
    });
    return { content, ...('details' in value ? { details: value.details } : {}) };
  }
  return {
    ...(value && typeof value === 'object' && 'cards' in value
      ? { details: { cards: value.cards } }
      : {}),
    content: [
      { type: 'text', text: typeof value === 'string' ? value : (JSON.stringify(value) ?? '') },
    ],
  };
}
