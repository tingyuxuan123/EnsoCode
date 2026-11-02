import { expect, it } from 'vitest';
import { toDesignToolResult } from './results';

it('keeps structured data observable as text', () => {
  expect(toDesignToolResult({ frames: 2 })).toEqual({
    content: [{ type: 'text', text: '{"frames":2}' }],
  });
});
it('translates upstream text and data URL images', () => {
  expect(
    toDesignToolResult({
      content: [
        { type: 'text', text: 'ok' },
        { type: 'image', dataUrl: 'data:image/png;base64,YQ==' },
      ],
      details: { path: 'a' },
    })
  ).toEqual({
    content: [
      { type: 'text', text: 'ok' },
      { type: 'image', data: 'YQ==', mimeType: 'image/png' },
    ],
    details: { path: 'a' },
  });
});
it('rejects malformed images rather than silently dropping them', () => {
  expect(() =>
    toDesignToolResult({ content: [{ type: 'image', dataUrl: 'https://evil/image' }] })
  ).toThrow();
});
it('preserves upstream out-of-band cards for later message mounts', () => {
  const cards = [{ type: 'vetd-screenshot', payload: { frame: 'a' } }];
  expect(toDesignToolResult({ ok: true, cards }).details).toEqual({ cards });
});
