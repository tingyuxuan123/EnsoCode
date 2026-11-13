import { expect, it } from 'vitest';
import { artifactPreviewKind } from './artifacts';
import { describePluginNotice } from './pluginNotice';

it('projects only known notices with a valid plugin identity', () => {
  expect(
    describePluginNotice({
      kind: 'auto-updated',
      pluginId: 'local.test',
      name: 'Test',
      version: '2',
    })?.type
  ).toBe('success');
  expect(
    describePluginNotice({ kind: 'inject-denied', pluginId: '../bad', name: 'Bad' })
  ).toBeNull();
  expect(
    describePluginNotice({ kind: 'unknown', pluginId: 'local.test', name: 'Test' })
  ).toBeNull();
});
it('previews raster images and textual MIME types but never active SVG/HTML as an image', () => {
  expect(artifactPreviewKind('image/png')).toBe('image');
  expect(artifactPreviewKind('image/svg+xml')).toBe('text');
  expect(artifactPreviewKind('application/problem+json')).toBe('text');
  expect(artifactPreviewKind('application/octet-stream')).toBe('file');
});
