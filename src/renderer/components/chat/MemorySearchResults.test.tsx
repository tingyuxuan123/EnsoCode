import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { MemoryCaptureResult, MemorySearchResults } from './MemorySearchResults';
import type { MemoryCaptureView, MemorySearchHit } from './memorySearchHits';

vi.mock('@/i18n', () => ({ useI18n: () => ({ t: (key: string) => `[${key}]` }) }));

const render = (hits: MemorySearchHit[]): string =>
  renderToStaticMarkup(createElement(MemorySearchResults, { hits }));

const hit = (over: Partial<MemorySearchHit> = {}): MemorySearchHit => ({
  id: 'proj:1::wiki/decisions/rtk.md',
  slug: 'decisions/rtk',
  title: 'RTK 采用官方 prebuilt',
  content: '随应用分发，默认开启',
  noteType: 'decisions',
  status: 'verified',
  space: 'project',
  ...over,
});

describe('MemorySearchResults', () => {
  it('每条命中展示标题、slug、类型、状态、空间与正文，默认折叠', () => {
    const html = render([
      hit(),
      hit({
        id: 'global::wiki/preferences/lang.md',
        slug: 'preferences/lang',
        title: '全局偏好',
        space: 'global',
        status: 'draft',
      }),
    ]);

    expect(html).toContain('RTK 采用官方 prebuilt');
    expect(html).toContain('[[decisions/rtk]]');
    expect(html).toContain('随应用分发，默认开启');
    expect(html).toContain('decisions');
    expect(html).toContain('[Verified]');
    expect(html).toContain('[Draft]');
    expect(html).toContain('[Project]');
    expect(html).toContain('[Global]');
    expect(html.match(/<li/g)).toHaveLength(2);
    expect(html).toContain('aria-expanded="false"');
    expect(html).toContain('line-clamp-2');
  });

  it('可选元数据缺失时不渲染空徽标', () => {
    const html = render([hit({ slug: null, noteType: null, status: null, space: null })]);

    expect(html).not.toContain('[Project]');
    expect(html).not.toContain('[Global]');
    expect(html).not.toContain('decisions');
    expect(html).not.toContain('[[');
  });

  it('空结果显示无匹配提示，而不是空白卡片', () => {
    expect(render([])).toContain('[No results]');
  });
});

describe('MemoryCaptureResult', () => {
  const renderCapture = (view: MemoryCaptureView): string =>
    renderToStaticMarkup(createElement(MemoryCaptureResult, { view }));

  it('新建成功：这一条默认展开，不用再点一次', () => {
    const html = renderCapture({
      written: true,
      action: 'created',
      memory: hit({ status: 'draft' }),
    });

    expect(html).toContain('RTK 采用官方 prebuilt');
    expect(html).toContain('随应用分发，默认开启');
    expect(html).toContain('aria-expanded="true"');
    expect(html).not.toContain('line-clamp-2');
  });

  it('更新既有页面时显示更新提示', () => {
    const html = renderCapture({ written: true, action: 'updated', memory: hit() });
    expect(html).toContain('[Updated existing wiki note]');
  });

  it('待审批写入提示进入收件箱审批', () => {
    const html = renderCapture({
      written: false,
      pendingReview: true,
      memory: hit({ status: 'draft' }),
    });
    expect(html).toContain('[Queued for approval in Inbox]');
    expect(html).toContain('aria-expanded="true"');
  });
});
