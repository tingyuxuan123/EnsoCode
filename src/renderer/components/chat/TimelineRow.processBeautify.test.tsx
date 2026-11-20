// @vitest-environment happy-dom
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { parseHTML } from 'linkedom';
import { parse } from 'postcss';
import { act, createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { TimelineItem } from '@/stores/sessions/timeline';

vi.mock('@/i18n', () => ({
  useI18n: () => ({
    t: (key: string, params?: Record<string, string | number>) =>
      key.replace(/\{\{(\w+)\}\}/g, (_, name: string) => String(params?.[name] ?? '')),
  }),
}));
vi.mock('@/stores/settings', () => ({
  useSettingsStore: (select: (state: object) => unknown) =>
    select({
      compactReadOnlyTools: false,
      expandLiveEdits: false,
      expandLiveReasoning: false,
    }),
}));
vi.mock('@/stores/sessions', () => ({ useSessionsStore: () => null }));
vi.mock('./Markdown', () => ({ Markdown: () => null }));
vi.mock('./EditDiff', () => ({ EditDiff: () => null }));
vi.mock('./ReadFileView', () => ({ ReadFileView: () => null }));
vi.mock('./snippetHighlighter', () => ({
  codeToHtml: vi.fn(async () => '<pre><code>const x = 1</code></pre>'),
}));

import { CodeBlock } from './CodeBlock';
import { TimelineRow } from './TimelineRow';

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('conversation process beautification', () => {
  it('renders a framed 22px step icon badge that highlights running and failed tool states', () => {
    const runningHtml = renderToStaticMarkup(
      createElement(TimelineRow, {
        item: {
          kind: 'tool',
          key: 'run-1',
          name: 'bash',
          summary: 'pnpm test',
          output: null,
          state: 'running',
          edits: null,
          writeContent: null,
          todos: null,
          durationMs: null,
          agentMeta: null,
        },
      })
    );
    const runningDoc = parseHTML(runningHtml).document;
    const badge = runningDoc.querySelector('[data-step-icon]');
    expect(badge).not.toBeNull();
    expect(badge?.classList.contains('codekiln-step-icon-live')).toBe(true);
    expect(runningHtml).toContain('t-shimmer');
    // Keep top-level bash summary free of font-mono per TimelineRow.nested regression.
    expect(runningHtml).not.toContain('font-mono');

    const failedHtml = renderToStaticMarkup(
      createElement(TimelineRow, {
        item: {
          kind: 'tool',
          key: 'fail-1',
          name: 'bash',
          summary: 'bad-cmd',
          output: 'command failed',
          state: 'error',
          edits: null,
          writeContent: null,
          todos: null,
          durationMs: 120,
          agentMeta: null,
        },
      })
    );
    const failedDoc = parseHTML(failedHtml).document;
    expect(failedDoc.querySelector('[data-step-icon]')?.getAttribute('data-state')).toBe('failed');
  });

  it('uses the mini Enso orbital beacon in running WorklogHead instead of a generic spinner', () => {
    const html = renderToStaticMarkup(
      createElement(TimelineRow, {
        item: {
          kind: 'tool-group',
          key: 'wl-1',
          expanded: true,
          count: 2,
          stats: { commands: 1, reads: 1, searches: 0, others: 0 },
          exploring: true,
          children: [],
          worklog: {
            status: 'running',
            forced: true,
            thinking: 1,
            failed: 0,
            startedAt: Date.now() - 2000,
          },
        },
      })
    );
    expect(html).toContain('codekiln-status-orbit');
    expect(html).not.toContain('lucide-loader-circle');
  });

  it('renders embedded CodeBlock flush without outer border while keeping chat typography', () => {
    const html = renderToStaticMarkup(
      createElement(CodeBlock, { code: 'const a = 1;', language: 'javascript', embedded: true })
    );
    const doc = parseHTML(html).document;
    const codeEl = doc.querySelector('[data-chat-code]');
    expect(codeEl?.getAttribute('style')).toContain('--chat-code-block-scale');
    expect(codeEl?.className).not.toContain('border');
    expect(codeEl?.className).not.toContain('my-2');
  });

  it('renders expanded SandboxOutput as structured Script / Calls / Output sections without nested borders', async () => {
    vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
    const container = document.createElement('div');
    document.body.appendChild(container);
    const root = createRoot(container);

    const item: Extract<TimelineItem, { kind: 'tool' }> = {
      kind: 'tool',
      key: 'sb-1',
      name: 'codemode',
      summary: 'read ×2',
      source: 'const files = ["a.ts"];\nconsole.log(files);',
      output: 'line 1\nline 2',
      state: 'ok',
      edits: null,
      writeContent: null,
      todos: null,
      durationMs: 420,
      agentMeta: null,
      sandbox: {
        status: 'completed',
        calls: [
          { name: 'read', ok: true, summary: 'a.ts' },
          { name: 'read', ok: true, summary: 'b.ts' },
        ],
        value: 'line 1\nline 2',
      },
    };

    try {
      await act(async () => root.render(createElement(TimelineRow, { item })));
      const trigger = container.querySelector<HTMLButtonElement>('button.group\\/tool-summary');
      expect(trigger).not.toBeNull();
      await act(async () => trigger?.click());

      const details = container.querySelector('[data-slot="tool-details"]');
      expect(details).not.toBeNull();
      expect(details?.querySelector('[data-sandbox-section="script"]')).not.toBeNull();
      expect(details?.querySelector('[data-sandbox-section="calls"]')).not.toBeNull();
      expect(details?.querySelector('[data-sandbox-section="output"]')).not.toBeNull();
      // Script CodeBlock inside sandbox card must be embedded (flush, no redundant border).
      const embeddedCode = details?.querySelector(
        '[data-sandbox-section="script"] [data-chat-code]'
      );
      expect(embeddedCode?.className).not.toContain('border');
      expect(details?.textContent).toContain('Script');
      expect(details?.textContent).toContain('Output');
      expect(details?.textContent).toContain('read');
      expect(details?.textContent).toContain('×2');
    } finally {
      await act(async () => root.unmount());
      container.remove();
    }
  });

  it('defines live process entrance, icon-live, and worklog orbit CSS with reduced-motion guards', () => {
    const css = parse(
      readFileSync(path.resolve(import.meta.dirname, '../../styles/shared.css'), 'utf8')
    );
    for (const selector of [
      '.t-process-enter',
      '.codekiln-step-icon-live',
      '.codekiln-status-orbit',
      '.codekiln-status-core',
    ]) {
      const normal = new Map<string, string>();
      const reduced = new Map<string, string>();
      css.walkRules((rule) => {
        if (!rule.selectors.includes(selector)) return;
        const parent = rule.parent;
        const target =
          parent?.type === 'atrule' && parent.params === '(prefers-reduced-motion: reduce)'
            ? reduced
            : normal;
        rule.walkDecls((decl) => {
          target.set(decl.prop, decl.value);
        });
      });
      expect(normal.get('animation'), selector).toBeDefined();
      expect(reduced.get('animation'), selector).toContain('none');
      if (selector === '.codekiln-status-orbit') {
        expect(normal.get('fill')).toBe('none');
        expect(normal.get('stroke')).toContain('--brand');
      }
    }
  });

  it('uses bespoke script-orchestration and thinking glyphs and borderless tool icons inside step badges', () => {
    const renderTool = (name: string) =>
      renderToStaticMarkup(
        createElement(TimelineRow, {
          item: {
            kind: 'tool',
            key: `icon-${name}`,
            name,
            summary: 'demo',
            output: null,
            state: 'ok',
            edits: null,
            writeContent: null,
            todos: null,
            durationMs: 100,
            agentMeta: null,
          },
        })
      );

    for (const name of ['codemode', 'exec', 'workflow']) {
      const html = renderTool(name);
      expect(html, name).toContain('data-step-glyph="script-orchestration"');
      expect(html, name).not.toContain('lucide-square-dashed');
      expect(html, name).not.toContain('lucide-box-select');
    }

    const thinkingHtml = renderToStaticMarkup(
      createElement(TimelineRow, {
        item: {
          kind: 'thinking',
          key: 'th-icon',
          text: 'reasoning',
          streaming: false,
          durationMs: 1400,
        },
      })
    );
    expect(thinkingHtml).toContain('data-step-glyph="thinking"');
    expect(thinkingHtml).not.toContain('lucide-brain');

    const bashHtml = renderTool('bash');
    expect(bashHtml).toContain('lucide-terminal');
    expect(bashHtml).not.toContain('lucide-square-terminal');

    const exploreHtml = renderToStaticMarkup(
      createElement(TimelineRow, {
        item: {
          kind: 'tool-group',
          key: 'exp-icon',
          expanded: false,
          count: 3,
          stats: { commands: 0, reads: 2, searches: 1, others: 0 },
          exploring: false,
          children: [],
          explore: { goal: 'check', report: 'done', steps: false },
        },
      })
    );
    expect(exploreHtml).toContain('lucide-compass');
    expect(exploreHtml).not.toContain('lucide-fold-vertical');

    expect(renderTool('memory_search')).toContain('lucide-bookmark');
    expect(renderTool('generate_image')).toContain('lucide-wand-sparkles');
    expect(renderTool('ask_user')).toContain('lucide-message-circle-question');
    expect(renderTool('message_coworker')).toContain('lucide-send');
    expect(renderTool('device_tap')).toContain('lucide-smartphone');
    expect(renderTool('tool_search')).toContain('lucide-search');
  });
});
