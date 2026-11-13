import type { ModelProvider } from '@shared/types';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { SmartCompactPicker } from './SmartCompactPicker';

const providers: ModelProvider[] = [
  {
    id: 'api',
    name: 'API entry',
    api: 'openai-completions',
    apiKey: 'secret',
    baseUrl: 'https://example.test/v1',
    enabled: true,
    models: [{ id: 'model', label: 'Cheap compact' }],
  },
];

const harness = vi.hoisted(() => ({
  state: {
    smartCompactEnabled: true,
    smartCompactModel: null as { providerId: string; modelId: string } | null,
    smartCompactMode: 'auto' as 'auto' | 'fast' | 'balanced' | 'thorough',
    microcompactEnabled: true,
  },
  setSmartCompactEnabled: vi.fn(),
  setSmartCompactModel: vi.fn(),
  setSmartCompactMode: vi.fn(),
  setMicrocompactEnabled: vi.fn(),
  pickerProps: null as Record<string, unknown> | null,
  switchProps: null as {
    checked?: boolean;
    onCheckedChange?: (value: boolean) => void;
  } | null,
}));

vi.mock('@/i18n', () => ({
  useI18n: () => ({
    t: (key: string) => key,
  }),
}));

vi.mock('@/stores/settings', () => ({
  useSettingsStore: (selector: (state: Record<string, unknown>) => unknown) =>
    selector({
      providers,
      smartCompactEnabled: harness.state.smartCompactEnabled,
      smartCompactModel: harness.state.smartCompactModel,
      smartCompactMode: harness.state.smartCompactMode,
      microcompactEnabled: harness.state.microcompactEnabled,
      setSmartCompactEnabled: harness.setSmartCompactEnabled,
      setSmartCompactModel: harness.setSmartCompactModel,
      setSmartCompactMode: harness.setSmartCompactMode,
      setMicrocompactEnabled: harness.setMicrocompactEnabled,
    }),
}));

vi.mock('@/components/ui/switch', () => ({
  Switch: (props: { checked?: boolean; onCheckedChange?: (value: boolean) => void }) => {
    harness.switchProps = props;
    return createElement('i', { 'data-microcompact-switch': String(props.checked) });
  },
}));

vi.mock('@/stores/oauthCredentials', () => ({
  useOauthCredentialStore: (
    selector: (state: {
      snapshot: {
        revision: number;
        availability: { status: 'ready'; authenticatedAccountKeys: ReadonlySet<string> };
      };
    }) => unknown
  ) =>
    selector({
      snapshot: {
        revision: 1,
        availability: { status: 'ready', authenticatedAccountKeys: new Set() },
      },
    }),
  usableProvidersForOauthSnapshot: (entries: ModelProvider[]) => entries,
}));

vi.mock('@/components/chat/ModelPicker', () => ({
  MODEL_PICKER_FORM_TRIGGER_CLASS: 'form-trigger',
  ModelPicker: (props: Record<string, unknown>) => {
    harness.pickerProps = props;
    return createElement('i', {
      'data-smart-compact-picker': 'true',
      'data-reasoning-controls': String(props.showReasoningControls),
    });
  },
}));

describe('SmartCompactPicker', () => {
  it('开启时展示模型选择，未选独立模型时跟随会话模型', () => {
    harness.state.smartCompactEnabled = true;
    harness.state.smartCompactModel = null;
    const html = renderToStaticMarkup(createElement(SmartCompactPicker));
    expect(html).toContain('data-smart-compact-picker="true"');
    expect(html).toContain('data-reasoning-controls="false"');
    expect(harness.pickerProps?.emptyLabel).toBe('Follows the session model');

    const onSelect = harness.pickerProps?.onSelect;
    if (typeof onSelect === 'function') onSelect('api', 'model');
    expect(harness.setSmartCompactModel).toHaveBeenCalledWith({
      providerId: 'api',
      modelId: 'model',
    });
  });

  it('已选独立模型时展示模型名与跟随会话重置入口', () => {
    harness.state.smartCompactEnabled = true;
    harness.state.smartCompactModel = { providerId: 'api', modelId: 'model' };
    const html = renderToStaticMarkup(createElement(SmartCompactPicker));
    expect(harness.pickerProps?.modelId).toBe('model');
    expect(harness.pickerProps?.providerId).toBe('api');
    expect(html).toContain('Follow session model');
  });

  it('关闭时不渲染模型选择行', () => {
    harness.state.smartCompactEnabled = false;
    harness.state.smartCompactModel = null;
    harness.pickerProps = null;
    const html = renderToStaticMarkup(createElement(SmartCompactPicker));
    expect(html).not.toContain('data-smart-compact-picker');
    expect(harness.pickerProps).toBeNull();
  });

  it('开启时展示档位选择', () => {
    harness.state.smartCompactEnabled = true;
    harness.state.smartCompactMode = 'balanced';
    const html = renderToStaticMarkup(createElement(SmartCompactPicker));
    expect(html).toContain('data-smart-compact-mode="balanced"');
  });

  it('独立于压缩策略展示 microcompaction 开关并写回设置', () => {
    for (const enabled of [true, false]) {
      harness.state.smartCompactEnabled = enabled;
      harness.state.microcompactEnabled = true;
      const html = renderToStaticMarkup(createElement(SmartCompactPicker));
      expect(html).toContain('data-settings-row="general.microcompactEnabled"');
      expect(html).toContain('data-microcompact-switch="true"');
      expect(html).toContain('Microcompaction');
      expect(html).toContain(
        'Clears only older successful text-only read and search tool results, keeps the latest 5 and never calls the model.'
      );
      expect(html).toContain(
        'Turning it off stops future clearing; context that is already cleared cannot be restored.'
      );
      expect(html).toContain('Applies to open conversations on the next request.');
    }

    harness.state.microcompactEnabled = false;
    const off = renderToStaticMarkup(createElement(SmartCompactPicker));
    expect(off).toContain('data-microcompact-switch="false"');
    harness.switchProps?.onCheckedChange?.(true);
    expect(harness.setMicrocompactEnabled).toHaveBeenCalledWith(true);
  });
});
