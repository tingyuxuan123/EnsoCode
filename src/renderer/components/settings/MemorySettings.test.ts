import type { CompilableSessionDto, MemoryJobsSnapshot } from '@shared/memory/dto';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  estimateRemainingMs,
  formatDuration,
  groupSessionsByProject,
  localChatBlocksDistill,
  MemorySettings,
  needsBulkPrompt,
} from './MemorySettings';

const harness = vi.hoisted(() => ({
  state: {} as Record<string, unknown>,
  jobs: { compile: [] } as MemoryJobsSnapshot,
  pickerProps: null as Record<string, unknown> | null,
}));

vi.mock('react', async (importOriginal) => {
  const react = await importOriginal<typeof import('react')>();
  return {
    ...react,
    useState: (initial: unknown) => {
      if (initial && typeof initial === 'object' && 'compile' in initial)
        return [harness.jobs, () => {}];
      // biome-ignore lint/correctness/useHookAtTopLevel: SSR test adapter retains actual hooks except the jobs DTO fixture.
      return react.useState(initial);
    },
  };
});

vi.mock('@/i18n', async () => {
  const { translate } = await import('@shared/i18n');
  return {
    useI18n: () => ({
      t: (key: string, params?: Record<string, string | number>) =>
        translate(harness.state.language === 'zh' ? 'zh' : 'en', key, params),
    }),
  };
});

vi.mock('@/stores/settings', () => ({
  useSettingsStore: (selector: (state: Record<string, unknown>) => unknown) =>
    selector(harness.state),
}));

vi.mock('@/components/chat/ModelPicker', () => ({
  MODEL_PICKER_FORM_TRIGGER_CLASS: 'form-trigger',
  ModelPicker: (props: Record<string, unknown>) => {
    harness.pickerProps = props;
    return createElement('i', {
      'data-model-picker': `${String(props.providerId)}/${String(props.modelId)}`,
    });
  },
}));

function setState(overrides: Record<string, unknown> = {}) {
  harness.state = {
    disabledBuiltinTools: [],
    providers: [{ id: 'p1', name: 'Provider One' }],
    memoryModelIdleMinutes: 10,
    setMemoryModelIdleMinutes: vi.fn(),
    memoryChatModel: 'remote',
    setMemoryChatModel: vi.fn(),
    memoryDistillEnabled: false,
    setMemoryDistillEnabled: vi.fn(),
    memoryDistillModel: null,
    setMemoryDistillModel: vi.fn(),
    memoryLanguage: 'zh',
    setMemoryLanguage: vi.fn(),
    ...overrides,
  };
}

beforeEach(() => {
  setState();
  harness.jobs = { compile: [] };
  harness.pickerProps = null;
  Object.defineProperty(globalThis, 'window', {
    configurable: true,
    value: {
      electronAPI: {
        memory: {
          stats: () => Promise.resolve(null),
          jobs: () => Promise.resolve(harness.jobs),
          chatModels: () => Promise.resolve([]),
          onChatModelProgress: () => () => {},
          distillableSessions: () => Promise.resolve([]),
          onChanged: () => () => {},
        },
      },
      setInterval: () => 0,
      clearInterval: () => {},
    },
  });
});

describe('localChatBlocksDistill', () => {
  const gemma = { downloadable: true as const, state: 'missing' as const };

  it('flags a selected local model that is not on disk', () => {
    expect(localChatBlocksDistill({ ...gemma, state: 'missing' })).toBe('missing');
    expect(localChatBlocksDistill({ ...gemma, state: 'downloading' })).toBe('downloading');
  });

  it('does not block remote or a ready local model', () => {
    expect(localChatBlocksDistill(null)).toBeNull();
    expect(localChatBlocksDistill({ downloadable: false, state: 'ready' })).toBeNull();
    expect(localChatBlocksDistill({ ...gemma, state: 'ready' })).toBeNull();
  });
});

describe('needsBulkPrompt', () => {
  it('asks before a batch that would skip already-compiled sessions', () => {
    expect(needsBulkPrompt([{ compiled: false }, { compiled: false }])).toBe(false);
    expect(needsBulkPrompt([{ compiled: true }, { compiled: false }])).toBe(true);
    expect(needsBulkPrompt([{ compiled: true }])).toBe(true);
    expect(needsBulkPrompt([])).toBe(false);
  });
});

describe('estimateRemainingMs / formatDuration', () => {
  it('extrapolates remaining duration accurately', () => {
    expect(estimateRemainingMs({ done: 0, total: 5, startedAt: 0 }, 10_000)).toBeNull();
    expect(estimateRemainingMs({ done: 2, total: 5, startedAt: 0 }, 20_000)).toBe(30_000);
    expect(estimateRemainingMs({ done: 5, total: 5, startedAt: 0 }, 50_000)).toBeNull();
    expect(formatDuration(200)).toBe('1s');
    expect(formatDuration(150_000)).toBe('2m 30s');
  });
});

describe('groupSessionsByProject', () => {
  const session = (over: Partial<CompilableSessionDto>): CompilableSessionDto => ({
    sessionId: 's1',
    title: 'Fix retry loop',
    projectId: 'p1',
    projectName: 'enso-code',
    messageCount: 4,
    compiled: false,
    updatedAt: '2026-11-01T00:00:00.000Z',
    ...over,
  });

  it('groups by project and sinks project-less sessions last', () => {
    const groups = groupSessionsByProject([
      session({ sessionId: 'x', projectId: null, projectName: null }),
      session({ sessionId: 'a', projectId: 'p1', projectName: 'enso-code' }),
      session({ sessionId: 'b', projectId: 'p2', projectName: 'other-app' }),
    ]);
    expect(groups.map((g) => g.name)).toEqual(['enso-code', 'other-app', 'No project']);
  });
});

describe('MemorySettings', () => {
  it.each([
    [5, '5 min', '5 分钟'],
    [10, '10 min', '10 分钟'],
    [30, '30 min', '30 分钟'],
    [0, 'Never', '永不'],
  ])('空闲卸载 %i 显示中英文标签', (minutes, en, zh) => {
    setState({ memoryModelIdleMinutes: minutes });
    expect(renderToStaticMarkup(createElement(MemorySettings))).toContain(`>${en}</span>`);
    setState({ memoryModelIdleMinutes: minutes, language: 'zh' });
    const html = renderToStaticMarkup(createElement(MemorySettings));
    expect(html).toContain(`>${zh}</span>`);
    expect(html).toContain('空闲自动卸载');
  });

  it('keeps Built-in tools pointer and no self-disable switch', () => {
    const html = renderToStaticMarkup(createElement(MemorySettings));
    expect(html).toContain('data-settings-row="memory.root"');
    expect(html).toContain('data-settings-row="memory.vaults"');
    expect(html).toContain('data-settings-row="memory.lint"');
    expect(html).toContain('Turn memory off in Built-in tools.');
    expect(html).toContain('Compile sessions automatically');
    expect(html).toContain('idle for 30 minutes');
    expect(html).not.toContain('Extract entities');
    expect(html).toContain('No wiki notes yet.');
    expect(html).toContain('Nothing running.');
  });
});
