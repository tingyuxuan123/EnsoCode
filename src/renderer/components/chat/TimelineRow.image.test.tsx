import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import type { TimelineItem } from '@/stores/sessions/timeline';
import { ReadImagePreview, TimelineRow } from './TimelineRow';

const settings = vi.hoisted(() => ({ compactReadOnlyTools: false, expandLiveEdits: false }));

vi.mock('@/i18n', () => ({ useI18n: () => ({ t: (key: string) => key }) }));
vi.mock('@/stores/settings', () => ({
  useSettingsStore: (select: (state: object) => unknown) => select(settings),
}));
vi.mock('@/stores/sessions', () => ({ useSessionsStore: () => null }));
vi.mock('./Markdown', () => ({ Markdown: () => null }));
vi.mock('./EditDiff', () => ({ EditDiff: () => null }));
vi.mock('./ReadFileView', () => ({ ReadFileView: () => null }));

describe('ReadImagePreview', () => {
  it('按原文件渲染图片，并限制在卡片内的最大高度', () => {
    const html = renderToStaticMarkup(
      createElement(ReadImagePreview, {
        path: '/tmp/anim.svg',
        fallback: createElement('pre', null, 'code'),
      })
    );
    expect(html).toContain('data-slot="read-image"');
    expect(html).toContain('src="local-image://posix/tmp/anim.svg"');
    expect(html).toContain('max-h-80');
    expect(html).toContain('max-w-full');
    expect(html).toContain('object-contain');
    expect(html).not.toContain('code');
  });
});

const imageRead = (state: 'running' | 'ok'): Extract<TimelineItem, { kind: 'tool' }> => ({
  kind: 'tool',
  key: 'tool-img',
  name: 'read',
  summary: 'shot.png',
  output: 'Read image file [image/png]',
  state,
  edits: null,
  writeContent: null,
  todos: null,
  agentMeta: null,
  durationMs: null,
  imagePath: '/tmp/shot.png',
});

describe('运行中的图片 read', () => {
  it('开启「运行中自动展开文件改动」时展开预览，结束后和关闭开关时不展开', () => {
    settings.expandLiveEdits = true;
    const live = renderToStaticMarkup(createElement(TimelineRow, { item: imageRead('running') }));
    expect(live).toContain('data-slot="read-image"');

    const finished = renderToStaticMarkup(createElement(TimelineRow, { item: imageRead('ok') }));
    expect(finished).not.toContain('data-slot="read-image"');

    settings.expandLiveEdits = false;
    const held = renderToStaticMarkup(createElement(TimelineRow, { item: imageRead('running') }));
    expect(held).not.toContain('data-slot="read-image"');
  });
});

const generated = (
  name: string,
  state: Extract<TimelineItem, { kind: 'tool' }>['state']
): Extract<TimelineItem, { kind: 'tool' }> => ({
  ...imageRead('running'),
  name,
  state,
  output: null,
  imagePath: undefined,
});
const imageId = '12345678-1234-4123-8123-123456789abc';
const imagePath = `.xiaoman/images/${imageId}.png`;
const imageOutput = JSON.stringify({
  ok: true,
  image: { id: imageId, path: imagePath, mimeType: 'image/png' },
});

describe('生图过程卡片', () => {
  it.each(['generate_image', 'edit_image'])(
    '%s 运行中无需结果就显示独立动画，不依赖自动展开开关',
    (name) => {
      settings.expandLiveEdits = false;
      const html = renderToStaticMarkup(
        createElement(TimelineRow, { item: generated(name, 'running') })
      );
      expect(html).toContain('data-slot="image-generation-loading"');
      expect(html).toContain('role="status"');
      expect(html).toContain(name === 'edit_image' ? 'Editing image…' : 'Generating image…');
      expect(html).not.toContain('cursor-zoom-in');
      expect(html).not.toContain('data-slot="generated-image"');
    }
  );
  it.each(['error', 'reviewing', 'ok'] as const)('%s 没有有效产物时不残留无限加载动画', (state) => {
    const html = renderToStaticMarkup(
      createElement(TimelineRow, { item: generated('generate_image', state) })
    );
    expect(html).not.toContain('data-slot="image-generation-loading"');
    expect(html).not.toContain('data-slot="generated-image"');
  });
  it('成功后渲染可缩放图片，不再保留加载动画', () => {
    const item = {
      ...generated('edit_image', 'ok'),
      imagePath: `/workspace/${imagePath}`,
      output: imageOutput,
    };
    const html = renderToStaticMarkup(createElement(TimelineRow, { item }));
    expect(html).toContain('data-slot="generated-image"');
    expect(html).toContain('cursor-zoom-in');
    expect(html).not.toContain('data-slot="image-generation-loading"');
  });
  it('错误即使带有旧图片引用也不能显示成功预览', () => {
    const item = {
      ...generated('generate_image', 'error'),
      imagePath: `/workspace/${imagePath}`,
      output: imageOutput,
    };
    const html = renderToStaticMarkup(createElement(TimelineRow, { item }));
    expect(html).not.toContain('data-slot="generated-image"');
  });
});
